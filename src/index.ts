import {
  deliveryIdFromUrl,
  harvestPerformanceEntries,
  harvestTrackElements,
  installNetworkHooks,
  installPerformanceObserver,
  type CaptureHandlers,
} from './capture';
import {
  estimatePlaylistBytes,
  makeDirectFilePlan,
  parseMasterPlaylist,
  parseMediaPlaylist,
  parseSubtitleRenditions,
  variantLabel,
} from './hls';
import {
  fetchPanoptoSubtitleTracks,
  fetchSubtitleTrackCues,
  getLanguageCode,
  isSubtitleUrl,
  parsePanoptoCaptions,
  parseSubtitleText,
  parseWebVtt,
  serializeSrt,
  serializeTranscript,
  serializeVtt,
  subtitleFilenameSuffix,
  subtitleMimeType,
  subtitleUrlLabel,
} from './subtitles';
import type {
  CapturedUrl,
  DownloadSink,
  HlsKey,
  HlsSegment,
  HlsSubtitleRendition,
  HlsVariant,
  MediaPlaylist,
  MediaResource,
  SubtitleCue,
  SubtitleFormat,
  SubtitleTrack,
} from './types';
import { mountUi, type UiRefs } from './ui';
import {
  absoluteUrl,
  formatBytes,
  formatDuration,
  friendlyError,
  getPanoptoAppRoot,
  getVideoTitle,
  isLikelyMasterUrl,
  isM3u8Url,
  sanitizeFilename,
  shortUrl,
  sleep,
} from './utils';

const VERSION = __VERSION__;
const STORAGE_KEY = '__canvas_panopto_hls_downloader_v1__';
const MAX_CAPTURED_STREAMS = 120;
const MAX_CAPTURED_SUBTITLES = 40;

const windowFlags = window as unknown as Window & Record<string, unknown>;
if (windowFlags[STORAGE_KEY]) {
  // Another copy is already active in this frame.
} else {
  windowFlags[STORAGE_KEY] = true;
  start();
}

interface MasterInfo {
  url: string;
  finalUrl: string;
  text: string;
  variants: HlsVariant[];
  subtitles: HlsSubtitleRendition[];
}

interface AppState {
  ui: UiRefs | null;
  panelOpen: boolean;
  master: MasterInfo | null;
  variants: HlsVariant[];
  variantIndex: number;
  playlist: MediaPlaylist | null;
  preparedUrl: string;
  loadingToken: number;
  busy: boolean;
  downloading: boolean;
  abortController: AbortController | null;
  title: string;
  lastCaptureCount: number;
  deliveryId: string;
  panoptoSubtitles: SubtitleTrack[];
  subtitleLoadedFor: string;
  subtitleLoading: boolean;
  subtitleError: string;
  subtitleDownloading: boolean;
  subtitleLoadToken: number;
}

function start(): void {
  const captured = new Map<string, CapturedUrl>();
  const capturedSubtitles = new Map<string, CapturedUrl>();
  const perfSeen = new Set<string>();
  const keyCache = new Map<string, Uint8Array>();

  const state: AppState = {
    ui: null,
    panelOpen: false,
    master: null,
    variants: [],
    variantIndex: -1,
    playlist: null,
    preparedUrl: '',
    loadingToken: 0,
    busy: false,
    downloading: false,
    abortController: null,
    title: '',
    lastCaptureCount: -1,
    deliveryId: deliveryIdFromUrl(location.href),
    panoptoSubtitles: [],
    subtitleLoadedFor: '',
    subtitleLoading: false,
    subtitleError: '',
    subtitleDownloading: false,
    subtitleLoadToken: 0,
  };

  let refreshTimer = 0;
  let subtitleTimer = 0;

  function noteM3u8(rawUrl: string, source: string, force = false): void {
    if (!rawUrl || typeof rawUrl !== 'string') return;
    const url = absoluteUrl(rawUrl);
    if (!/^https?:/i.test(url)) return;
    if (!force && !isM3u8Url(url)) return;

    const previous = captured.get(url);
    captured.set(url, {
      url,
      source: source || previous?.source || 'network',
      firstSeen: previous?.firstSeen || Date.now(),
      lastSeen: Date.now(),
    });

    if (captured.size > MAX_CAPTURED_STREAMS) {
      const oldest = [...captured.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
      if (oldest) captured.delete(oldest[0]);
    }
    scheduleDetectedRefresh();
  }

  function noteSubtitleUrl(rawUrl: string, source: string): void {
    if (!rawUrl || !isSubtitleUrl(rawUrl)) return;
    const url = absoluteUrl(rawUrl);
    if (!/^https?:/i.test(url)) return;
    const previous = capturedSubtitles.get(url);
    capturedSubtitles.set(url, {
      url,
      source: source || previous?.source || 'network',
      firstSeen: previous?.firstSeen || Date.now(),
      lastSeen: Date.now(),
    });
    if (capturedSubtitles.size > MAX_CAPTURED_SUBTITLES) {
      const oldest = [...capturedSubtitles.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
      if (oldest) capturedSubtitles.delete(oldest[0]);
    }
    if (state.ui) window.setTimeout(renderSubtitleOptions, 60);
  }

  function noteDeliveryId(deliveryId: string): void {
    if (!deliveryId || state.deliveryId === deliveryId) return;
    state.deliveryId = deliveryId;
    state.panoptoSubtitles = [];
    state.subtitleLoadedFor = '';
    state.subtitleError = '';
    if (state.ui) scheduleSubtitleRefresh(180);
  }

  function capturedUrls(): string[] {
    return [...captured.values()]
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((item) => item.url);
  }

  function scheduleDetectedRefresh(): void {
    if (refreshTimer) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = 0;
      if (state.ui) refreshSourceOptions({ autoLoad: state.panelOpen && !state.playlist });
      updateBadge();
    }, 180);
  }

  function scheduleSubtitleRefresh(delay = 240): void {
    if (subtitleTimer) return;
    subtitleTimer = window.setTimeout(() => {
      subtitleTimer = 0;
      if (state.ui) void refreshSubtitleTracks();
    }, delay);
  }

  const captureHandlers: CaptureHandlers = {
    noteMediaUrl: noteM3u8,
    noteSubtitleUrl,
    noteDeliveryId,
  };

  function preferredCapturedUrls(): string[] {
    const urls = capturedUrls();
    const masters = urls.filter(isLikelyMasterUrl);
    return masters.length ? masters : urls;
  }

  function setPanelOpen(open: boolean): void {
    const ui = state.ui;
    if (!ui) return;
    state.panelOpen = open;
    ui.panel.hidden = !open;
    if (!open) return;
    noteDeliveryId(deliveryIdFromUrl(location.href));
    harvestPerformanceEntries(captureHandlers, perfSeen);
    harvestTrackElements(captureHandlers);
    refreshSourceOptions({ autoLoad: !state.playlist });
    if (!getSubtitleTracks().length) void refreshSubtitleTracks({ force: true });
  }

  function setNotice(message: string, kind = 'info'): void {
    if (!state.ui) return;
    state.ui.notice.textContent = message;
    state.ui.notice.dataset.kind = kind;
  }

  function setBusy(busy: boolean): void {
    state.busy = busy;
    const ui = state.ui;
    if (!ui) return;
    ui.refresh.disabled = busy || state.downloading;
    ui.load.disabled = busy || state.downloading;
    ui.source.disabled = busy || state.downloading;
    ui.quality.disabled = busy || state.downloading || state.variants.length < 2;
    ui.download.disabled = busy || state.downloading || !state.playlist;
    renderSubtitleOptions();
  }

  function updateBadge(): void {
    if (!state.ui) return;
    const count = preferredCapturedUrls().length;
    if (count === state.lastCaptureCount) return;
    state.lastCaptureCount = count;
    state.ui.badge.hidden = count === 0;
    state.ui.badge.textContent = String(Math.min(count, 99));
  }

  function refreshSourceOptions({ autoLoad = false } = {}): void {
    const ui = state.ui;
    if (!ui) return;
    const urls = preferredCapturedUrls();
    const previous = ui.source.value;

    ui.source.replaceChildren();
    for (const url of urls) {
      const option = document.createElement('option');
      option.value = url;
      option.textContent = shortUrl(url, 70);
      ui.source.append(option);
    }

    ui.sourceField.hidden = urls.length === 0;
    if (urls.length && urls.includes(previous)) ui.source.value = previous;

    if (autoLoad && urls.length && !state.playlist && !state.busy && !state.downloading) {
      void loadManifest(ui.source.value || urls[0] || '', { auto: true });
    }
  }

  async function fetchText(url: string, signal?: AbortSignal): Promise<{ text: string; finalUrl: string; response: Response }> {
    const response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return { text: await response.text(), finalUrl: response.url || url, response };
  }

  async function loadManifest(url: string, { auto = false }: { userInitiated?: boolean; auto?: boolean } = {}): Promise<void> {
    const ui = state.ui;
    if (!ui) return;
    if (state.downloading) {
      setNotice('请等待当前下载完成或先取消下载。', 'warning');
      return;
    }

    const normalized = absoluteUrl(url);
    if (!normalized) {
      setNotice('m3u8 地址格式无效。', 'error');
      return;
    }

    const token = ++state.loadingToken;
    setBusy(true);
    state.playlist = null;
    state.master = null;
    state.variants = [];
    state.variantIndex = -1;
    ui.meta.hidden = true;
    ui.progressWrap.hidden = true;
    ui.qualityField.hidden = true;
    setNotice(auto ? '已自动捕获视频，正在读取播放列表…' : '正在读取播放列表…');

    try {
      const result = await fetchText(normalized);
      if (token !== state.loadingToken) return;

      const isMaster = /^#EXT-X-STREAM-INF:/m.test(result.text);
      if (isMaster) {
        const variants = parseMasterPlaylist(result.text, result.finalUrl);
        if (!variants.length) throw new Error('主播放列表中没有可用码流');
        const subtitles = parseSubtitleRenditions(result.text, result.finalUrl);
        state.master = { url: normalized, finalUrl: result.finalUrl, text: result.text, variants, subtitles };
        state.variants = variants;
        ui.qualityField.hidden = false;
        renderQualityOptions();
        await loadVariant(0, token);
      } else {
        state.variants = [];
        const playlist = parseMediaPlaylist(result.text, result.finalUrl);
        state.playlist = playlist;
        state.variantIndex = -1;
        state.preparedUrl = normalized;
        state.title = getVideoTitle();
        ui.qualityField.hidden = true;
        renderPlaylistInfo({});
        setNotice('播放列表已载入，可以开始下载。', 'success');
        setBusy(false);
      }
      renderSubtitleOptions();
      scheduleSubtitleRefresh(300);
    } catch (error) {
      if (token !== state.loadingToken) return;
      console.error('[Canvas HLS] load manifest failed', error);
      setNotice(friendlyError(error, '读取播放列表失败'), 'error');
      setBusy(false);
    }
  }

  function renderQualityOptions(): void {
    const ui = state.ui;
    if (!ui) return;
    ui.quality.replaceChildren();
    state.variants.forEach((variant, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = variantLabel(variant, index);
      ui.quality.append(option);
    });
    if (state.variantIndex >= 0) ui.quality.value = String(state.variantIndex);
    ui.quality.disabled = state.busy || state.variants.length < 2;
  }

  async function loadVariant(index: number, existingToken?: number): Promise<void> {
    const ui = state.ui;
    const variant = state.variants[index];
    if (!ui || !variant) return;
    const token = existingToken || ++state.loadingToken;
    state.variantIndex = index;
    state.playlist = null;
    state.preparedUrl = '';
    ui.quality.value = String(index);
    setBusy(true);
    ui.download.disabled = true;
    ui.meta.hidden = true;
    setNotice(`正在读取 ${variantLabel(variant, index)}…`);

    try {
      const result = await fetchText(variant.url);
      if (token !== state.loadingToken) return;
      const playlist = parseMediaPlaylist(result.text, result.finalUrl);
      if (!playlist.segments.length) throw new Error('该码流没有可下载的分片');
      playlist.variant = variant;
      state.playlist = playlist;
      state.preparedUrl = state.master?.url || variant.url;
      state.title = getVideoTitle();
      renderPlaylistInfo(variant);
      setNotice('播放列表已载入，可以开始下载。', 'success');
      setBusy(false);
    } catch (error) {
      if (token !== state.loadingToken) return;
      console.error('[Canvas HLS] load variant failed', error);
      setNotice(friendlyError(error, '读取视频码流失败'), 'error');
      setBusy(false);
    }
  }

  function renderPlaylistInfo(variant: Partial<HlsVariant> = {}): void {
    const ui = state.ui;
    const playlist = state.playlist;
    if (!ui || !playlist) return;
    const resolution = variant.width && variant.height ? `${variant.width}×${variant.height}` : '自适应画质';
    const bitrate = variant.bandwidth ? ` · ${(variant.bandwidth / 1e6).toFixed(2)} Mbps` : '';
    const duration = playlist.duration ? formatDuration(playlist.duration) : '时长未知';
    const estimatedBytes = estimatePlaylistBytes(playlist);
    const size = estimatedBytes ? ` · 约 ${formatBytes(estimatedBytes)}` : '';
    const plan = makeDirectFilePlan(playlist);

    ui.meta.hidden = false;
    ui.metaMain.textContent = `${resolution}${bitrate} · ${duration}${size}`;
    ui.metaSub.textContent = `${playlist.segments.length} 个分片 · 输出 .${playlist.ext}${plan ? ' · 单文件加速下载' : ''}`;

    const warnings = [...playlist.warnings];
    if (variant.audioGroup && variant.codecs && !/(mp4a|ac-3|ec-3|opus|vorbis)/i.test(variant.codecs)) {
      warnings.push('该码流含独立音频组；当前版本只保存所选视频轨。');
    }
    ui.metaWarning.hidden = warnings.length === 0;
    ui.metaWarning.textContent = warnings.join(' ');
    ui.download.disabled = false;
  }

  function getSubtitleTracks(): SubtitleTrack[] {
    const tracks = [...state.panoptoSubtitles];
    const knownUrls = new Set<string>();

    const renditions = state.master?.subtitles || [];
    renditions.forEach((rendition, index) => {
      knownUrls.add(rendition.url);
      const format = /\.srt(?:[?#]|$)/i.test(rendition.url)
        ? 'srt'
        : /\.(?:vtt|webvtt)(?:[?#]|$)/i.test(rendition.url)
          ? 'vtt'
          : 'unknown';
      tracks.push({
        id: `hls:${index}:${rendition.url}`,
        label: rendition.name || rendition.language || `字幕 ${index + 1}`,
        languageCode: rendition.language || getLanguageCode(rendition.name),
        source: 'hls',
        url: rendition.url,
        format,
      });
    });

    for (const subtitle of [...capturedSubtitles.values()].sort((a, b) => b.lastSeen - a.lastSeen)) {
      if (knownUrls.has(subtitle.url)) continue;
      knownUrls.add(subtitle.url);
      tracks.push({
        id: `network:${subtitle.url}`,
        label: subtitleUrlLabel(subtitle.url),
        languageCode: '',
        source: 'network',
        url: subtitle.url,
        format: /\.srt(?:[?#]|$)/i.test(subtitle.url) ? 'srt' : 'vtt',
      });
    }

    return tracks;
  }

  function renderSubtitleOptions(): void {
    const ui = state.ui;
    if (!ui) return;
    const tracks = getSubtitleTracks();
    const previous = ui.subtitleLanguage.value;
    ui.subtitleLanguage.replaceChildren();

    if (!tracks.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = state.subtitleLoading ? '正在检测字幕…' : '未检测到字幕';
      ui.subtitleLanguage.append(option);
    } else {
      for (const track of tracks) {
        const option = document.createElement('option');
        option.value = track.id;
        const source = track.source === 'panopto' ? 'Panopto' : track.source === 'hls' ? 'HLS' : '网页';
        option.textContent = `${track.label} · ${source}`;
        ui.subtitleLanguage.append(option);
      }
      ui.subtitleLanguage.value = tracks.some((track) => track.id === previous) ? previous : tracks[0]?.id || '';
    }

    const disabled = state.busy || state.downloading || state.subtitleDownloading || !tracks.length;
    ui.subtitleLanguage.disabled = disabled;
    ui.subtitleFormat.disabled = disabled;
    ui.subtitleDownload.disabled = disabled;

    ui.subtitleHint.dataset.kind = '';
    if (state.subtitleLoading && !tracks.length) {
      ui.subtitleHint.textContent = '正在读取 Panopto 字幕…';
    } else if (state.subtitleError) {
      ui.subtitleHint.textContent = state.subtitleError;
      ui.subtitleHint.dataset.kind = 'error';
    } else if (tracks.length) {
      ui.subtitleHint.textContent = `已找到 ${tracks.length} 条字幕，可单独下载；视频与字幕分开保存。`;
    } else if (state.deliveryId) {
      ui.subtitleHint.textContent = '该视频没有可下载字幕。若确认有字幕，请播放几秒后点“重新扫描”。';
    } else {
      ui.subtitleHint.textContent = '暂未找到字幕。请先播放视频；若需要，打开播放器字幕设置后再扫描。';
    }
  }

  async function refreshSubtitleTracks({ force = false }: { force?: boolean } = {}): Promise<void> {
    const ui = state.ui;
    if (!ui) return;
    const deliveryId = state.deliveryId;
    if (!force && deliveryId && state.subtitleLoadedFor === deliveryId) {
      renderSubtitleOptions();
      return;
    }

    state.subtitleError = '';
    if (!deliveryId) {
      state.subtitleLoading = false;
      renderSubtitleOptions();
      return;
    }

    const token = ++state.subtitleLoadToken;
    state.subtitleLoading = true;
    renderSubtitleOptions();
    try {
      const tracks = await fetchPanoptoSubtitleTracks(deliveryId, getPanoptoAppRoot());
      if (token !== state.subtitleLoadToken) return;
      state.panoptoSubtitles = tracks;
      state.subtitleLoadedFor = deliveryId;
      state.subtitleError = '';
    } catch (error) {
      if (token !== state.subtitleLoadToken) return;
      console.error('[Canvas HLS] subtitle load failed', error);
      state.subtitleError = friendlyError(error, '读取字幕失败');
    } finally {
      if (token === state.subtitleLoadToken) {
        state.subtitleLoading = false;
        renderSubtitleOptions();
      }
    }
  }

  function triggerBlobDownload(filename: string, content: BlobPart, mime: string): void {
    const blob = new Blob([content], { type: mime });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }

  async function downloadSubtitle(): Promise<void> {
    const ui = state.ui;
    if (!ui || state.subtitleDownloading || state.downloading || state.busy) return;
    const track = getSubtitleTracks().find((item) => item.id === ui.subtitleLanguage.value);
    if (!track) {
      setNotice('没有可下载的字幕。', 'warning');
      return;
    }

    const format = ui.subtitleFormat.value as SubtitleFormat;
    state.subtitleDownloading = true;
    renderSubtitleOptions();
    try {
      setNotice(`正在读取${track.label}字幕…`);
      const cues = await fetchSubtitleTrackCues(track);
      if (!cues.length) throw new Error('没有解析到字幕内容');
      track.cues = cues;
      const content = format === 'vtt'
        ? serializeVtt(cues)
        : format === 'txt'
          ? serializeTranscript(cues)
          : serializeSrt(cues);
      const filename = `${sanitizeFilename(state.title || getVideoTitle())}.${subtitleFilenameSuffix(track)}.${format}`;
      triggerBlobDownload(filename, content, subtitleMimeType(format));
      setNotice(`字幕已交给浏览器保存：${filename}`, 'success');
    } catch (error) {
      console.error('[Canvas HLS] subtitle download failed', error);
      setNotice(friendlyError(error, '下载字幕失败'), 'error');
    } finally {
      state.subtitleDownloading = false;
      renderSubtitleOptions();
    }
  }

  async function createSink(filename: string, mime: string): Promise<DownloadSink> {
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const extension = filename.endsWith('.ts') ? 'ts' : 'mp4';
        const options = {
          suggestedName: filename,
          types: [{
            description: extension === 'ts' ? 'MPEG-TS 视频' : 'MP4 视频',
            accept: extension === 'ts' ? { 'video/mp2t': ['.ts'] } : { 'video/mp4': ['.mp4'] },
          }],
        };
        const handle = await window.showSaveFilePicker(options);
        const writable = await handle.createWritable();
        return {
          kind: 'file',
          write: async (data) => {
            await writable.write(data as BlobPart);
          },
          close: () => writable.close(),
          abort: () => writable.abort(),
        };
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        console.warn('[Canvas HLS] File System Access unavailable, falling back to memory', error);
      }
    }

    const parts: BlobPart[] = [];
    return {
      kind: 'memory',
      write: async (data) => {
        parts.push(data as BlobPart);
      },
      close: async () => {
        triggerBlobDownload(filename, new Blob(parts, { type: mime || 'application/octet-stream' }), mime || 'application/octet-stream');
        parts.length = 0;
      },
      abort: async () => {
        parts.length = 0;
      },
    };
  }

  async function startDownload(): Promise<void> {
    const ui = state.ui;
    const playlist = state.playlist;
    if (!ui || !playlist || state.downloading) return;
    if (playlist.hasUnsupportedEncryption) {
      setNotice('该视频使用了不支持的加密方式，无法下载。', 'error');
      return;
    }
    if (!playlist.segments.length) {
      setNotice('没有可下载的分片。', 'error');
      return;
    }

    const directPlan = makeDirectFilePlan(playlist);
    const extension = playlist.ext === 'ts' ? 'ts' : 'mp4';
    const filename = `${sanitizeFilename(state.title || getVideoTitle() || 'video')}.${extension}`;

    let sink: DownloadSink;
    try {
      sink = await createSink(filename, playlist.mime);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error('[Canvas HLS] create sink failed', error);
        setNotice('无法创建输出文件。', 'error');
      }
      return;
    }

    state.downloading = true;
    state.abortController = new AbortController();
    state.busy = false;
    ui.download.hidden = true;
    ui.cancel.hidden = false;
    ui.refresh.disabled = true;
    ui.load.disabled = true;
    ui.source.disabled = true;
    ui.quality.disabled = true;
    ui.progressWrap.hidden = false;
    ui.pulse.hidden = false;
    renderSubtitleOptions();
    setNotice('正在下载…', 'info');

    try {
      if (directPlan) {
        await downloadDirectFile(directPlan, sink, state.abortController.signal);
      } else {
        await downloadSegments(playlist, sink, state.abortController.signal);
      }
      await sink.close();
      if (sink.kind === 'memory') {
        setNotice(`已在内存中合成 ${filename}，浏览器已开始保存。`, 'success');
        ui.progressText.textContent = '已交给浏览器保存';
      } else {
        setNotice(`下载完成：${filename}`, 'success');
        ui.progressText.textContent = '下载完成';
      }
      ui.progressPct.textContent = '100%';
      ui.progressBar.style.width = '100%';
    } catch (error) {
      console.error('[Canvas HLS] download failed', error);
      try {
        await sink.abort();
      } catch (abortError) {
        console.debug('[Canvas HLS] sink abort failed', abortError);
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        setNotice('下载已取消。', 'warning');
        ui.progressText.textContent = '已取消';
      } else {
        setNotice(friendlyError(error, '下载失败'), 'error');
        ui.progressText.textContent = '下载失败';
      }
    } finally {
      state.downloading = false;
      state.abortController = null;
      ui.download.hidden = false;
      ui.cancel.hidden = true;
      ui.pulse.hidden = true;
      setBusy(false);
      ui.download.disabled = !state.playlist;
    }
  }

  function cancelDownload(): void {
    state.abortController?.abort();
  }

  async function downloadDirectFile(plan: { url: string; length: number }, sink: DownloadSink, signal: AbortSignal): Promise<void> {
    const response = await fetch(plan.url, {
      credentials: 'include',
      headers: { Range: `bytes=0-${Math.max(0, plan.length - 1)}` },
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

    if (!response.body || typeof response.body.getReader !== 'function') {
      const buffer = new Uint8Array(await response.arrayBuffer()).subarray(0, plan.length);
      await sink.write(buffer);
      reportProgress(buffer.byteLength, plan.length);
      return;
    }

    const reader = response.body.getReader();
    let received = 0;
    try {
      while (received < plan.length) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        const remaining = plan.length - received;
        const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
        await sink.write(chunk);
        received += chunk.byteLength;
        reportProgress(received, plan.length);
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // The stream is already closed in most cases.
      }
    }

    if (received < plan.length) {
      throw new Error(`下载不完整：${formatBytes(received)} / ${formatBytes(plan.length)}`);
    }
  }

  async function downloadSegments(playlist: MediaPlaylist, sink: DownloadSink, signal: AbortSignal): Promise<void> {
    const totalBytes = estimatePlaylistBytes(playlist);
    const totalSegments = playlist.segments.length;
    let writtenBytes = 0;
    let doneSegments = 0;
    let lastMap: HlsSegment['map'] = null;

    for (const segment of playlist.segments) {
      if (signal.aborted) throw new DOMException('Download cancelled', 'AbortError');

      if (segment.map && segment.map !== lastMap) {
        const mapData = await fetchMediaItem(segment.map, signal);
        const clearMap = await decryptIfNeeded(mapData, segment.map.key, segment.sequence);
        await sink.write(clearMap);
        writtenBytes += clearMap.byteLength;
        lastMap = segment.map;
      }

      if (!segment.gap) {
        const ciphertext = await fetchMediaItem(segment, signal);
        const plaintext = await decryptIfNeeded(ciphertext, segment.key, segment.sequence);
        await sink.write(plaintext);
        writtenBytes += plaintext.byteLength;
      }

      doneSegments += 1;
      reportProgress(
        totalBytes ? Math.min(writtenBytes, totalBytes) : doneSegments,
        totalBytes || totalSegments,
        `${doneSegments}/${totalSegments} 分片 · ${formatBytes(writtenBytes)}`,
      );
    }
  }

  async function fetchMediaItem(item: MediaResource, signal: AbortSignal): Promise<Uint8Array> {
    const headers: Record<string, string> = {};
    if (item.range) {
      const start = item.range.offset;
      const end = start + item.range.length - 1;
      headers.Range = `bytes=${start}-${end}`;
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(item.url, {
          credentials: 'include',
          headers,
          signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
        const buffer = new Uint8Array(await response.arrayBuffer());

        if (item.range && buffer.byteLength !== item.range.length) {
          if (response.status === 206) {
            throw new Error(`分片长度不符：期望 ${item.range.length}，实际 ${buffer.byteLength}`);
          }
          const start = item.range.offset;
          const end = start + item.range.length;
          if (buffer.byteLength >= end) return buffer.subarray(start, end);
          throw new Error('服务器未正确处理 Range 请求');
        }
        return buffer;
      } catch (error) {
        lastError = error;
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        if (attempt === 2) throw error;
        await sleep(350 * (attempt + 1));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || '分片下载失败'));
  }

  async function decryptIfNeeded(data: Uint8Array, keyInfo: HlsKey | null, sequence: number): Promise<Uint8Array> {
    if (!keyInfo?.method || keyInfo.method === 'NONE') return data;
    if (keyInfo.method !== 'AES-128' || keyInfo.unsupported) {
      throw new Error(keyInfo.reason || `不支持 ${keyInfo.method} 加密`);
    }
    if (!keyInfo.url) throw new Error('AES-128 密钥地址无效');

    let keyBytes = keyCache.get(keyInfo.url);
    if (!keyBytes) {
      const response = await fetch(keyInfo.url, { credentials: 'include' });
      if (!response.ok) throw new Error(`读取 AES-128 密钥失败：HTTP ${response.status}`);
      keyBytes = new Uint8Array(await response.arrayBuffer());
      if (keyBytes.byteLength !== 16) throw new Error('AES-128 密钥长度无效');
      keyCache.set(keyInfo.url, keyBytes);
    }

    const iv = keyInfo.iv ? parseIv(keyInfo.iv) : sequenceToIv(sequence);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes as unknown as BufferSource,
      { name: 'AES-CBC' },
      false,
      ['decrypt'],
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: iv as unknown as BufferSource },
      cryptoKey,
      data as unknown as BufferSource,
    );
    return new Uint8Array(plaintext);
  }

  function parseIv(value: string): Uint8Array {
    let hex = String(value).trim().replace(/^0x/i, '');
    if (hex.length % 2) hex = `0${hex}`;
    if (hex.length > 32) hex = hex.slice(-32);
    if (hex.length < 32) hex = hex.padStart(32, '0');
    if (!/^[0-9a-f]+$/i.test(hex)) throw new Error('AES IV 格式无效');
    const bytes = new Uint8Array(16);
    for (let index = 0; index < 16; index += 1) {
      bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
  }

  function sequenceToIv(sequence: number): Uint8Array {
    const iv = new Uint8Array(16);
    let value = BigInt(Math.max(0, Number(sequence) || 0));
    for (let index = 15; index >= 8; index -= 1) {
      iv[index] = Number(value & 0xffn);
      value >>= 8n;
    }
    return iv;
  }

  function reportProgress(current: number, total: number, detail = ''): void {
    const ui = state.ui;
    if (!ui) return;
    const ratio = total > 0 ? Math.min(1, current / total) : 0;
    const percent = Math.round(ratio * 100);
    ui.progressBar.style.width = `${ratio * 100}%`;
    ui.progressPct.textContent = total > 0 ? `${percent}%` : '';
    if (detail) ui.progressText.textContent = detail;
    else if (total > 0) ui.progressText.textContent = `${formatBytes(current)} / ${formatBytes(total)}`;
  }

  function wireUi(ui: UiRefs): void {
    ui.fab.addEventListener('click', () => setPanelOpen(!state.panelOpen));
    ui.close.addEventListener('click', () => setPanelOpen(false));
    ui.refresh.addEventListener('click', () => {
      harvestPerformanceEntries(captureHandlers, perfSeen);
      harvestTrackElements(captureHandlers);
      const streams = preferredCapturedUrls();
      const masters = streams.filter(isLikelyMasterUrl);
      if (streams.length) {
        const detail = masters.length
          ? `已捕获 ${masters.length} 个主播放列表（共 ${captured.size} 个 m3u8 请求）。`
          : `已捕获 ${streams.length} 个 m3u8 地址。`;
        setNotice(detail, 'info');
      } else {
        setNotice('暂未捕获到 m3u8；请先在页面中播放视频。', 'warning');
      }
      refreshSourceOptions({ autoLoad: !state.playlist });
      void refreshSubtitleTracks({ force: true });
    });
    ui.load.addEventListener('click', () => {
      const value = ui.manual.value.trim();
      if (!value) {
        setNotice('请先粘贴 m3u8 地址。', 'warning');
        ui.manual.focus();
        return;
      }
      noteM3u8(value, 'manual', true);
      void loadManifest(value, { userInitiated: true });
    });
    ui.manual.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        ui.load.click();
      }
    });
    ui.source.addEventListener('change', () => {
      if (ui.source.value) void loadManifest(ui.source.value, { userInitiated: true });
    });
    ui.quality.addEventListener('change', () => {
      void loadVariant(Number(ui.quality.value));
    });
    ui.download.addEventListener('click', () => {
      void startDownload();
    });
    ui.cancel.addEventListener('click', cancelDownload);
    ui.subtitleDownload.addEventListener('click', () => {
      void downloadSubtitle();
    });
    ui.subtitleLanguage.addEventListener('change', () => {
      ui.subtitleHint.dataset.kind = '';
    });
  }

  function ensureUi(): void {
    if (state.ui) return;
    const ui = mountUi();
    if (!ui) {
      document.addEventListener('DOMContentLoaded', ensureUi, { once: true });
      return;
    }
    state.ui = ui;
    wireUi(ui);
    ui.panel.hidden = true;
    renderSubtitleOptions();
    harvestPerformanceEntries(captureHandlers, perfSeen);
    harvestTrackElements(captureHandlers);
    refreshSourceOptions({ autoLoad: false });
    scheduleSubtitleRefresh(500);
  }

  installNetworkHooks(captureHandlers);
  harvestPerformanceEntries(captureHandlers, perfSeen);
  installPerformanceObserver(captureHandlers, perfSeen);
  ensureUi();
  window.setTimeout(() => harvestPerformanceEntries(captureHandlers, perfSeen), 1_500);
  window.setTimeout(() => harvestTrackElements(captureHandlers), 1_500);
  window.setInterval(() => {
    noteDeliveryId(deliveryIdFromUrl(location.href));
    harvestPerformanceEntries(captureHandlers, perfSeen);
    harvestTrackElements(captureHandlers);
  }, 5_000);

  window.__CANVAS_HLS_DOWNLOADER__ = {
    version: VERSION,
    get captured() {
      return capturedUrls();
    },
    get capturedSubtitles() {
      return [...capturedSubtitles.values()].map((item) => item.url);
    },
    parseMasterPlaylist,
    parseSubtitleRenditions,
    parseMediaPlaylist,
    parseWebVtt,
    parseSubtitleText,
    parsePanoptoCaptions,
    serializeSrt,
    serializeVtt,
    serializeTranscript,
    makeDirectFilePlan,
    estimatePlaylistBytes,
    loadManifest,
    refreshSubtitles: () => refreshSubtitleTracks({ force: true }),
    downloadSubtitle,
    open: () => setPanelOpen(true),
  };
}
