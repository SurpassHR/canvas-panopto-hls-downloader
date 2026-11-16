import type {
  PanoptoCaptionEvent,
  PanoptoCaptionInfo,
  PanoptoDeliveryInfo,
  SubtitleCue,
  SubtitleFormat,
  SubtitleTrack,
} from './types';
import { absoluteUrl } from './utils';

interface LanguageMeta {
  label: string;
  code: string;
}

const LANGUAGE_META: Record<number, LanguageMeta> = {
  0: { label: 'English (United States)', code: 'en-US' },
  1: { label: 'English (United Kingdom)', code: 'en-GB' },
  2: { label: 'Español (México)', code: 'es-MX' },
  3: { label: 'Español (España)', code: 'es-ES' },
  4: { label: 'Deutsch', code: 'de-DE' },
  5: { label: 'Français', code: 'fr-FR' },
  6: { label: 'Nederlands', code: 'nl-NL' },
  7: { label: 'ไทย', code: 'th-TH' },
  8: { label: '简体中文', code: 'zh-CN' },
  9: { label: '繁體中文', code: 'zh-HK' },
  10: { label: '한국어', code: 'ko-KR' },
  11: { label: '日本語', code: 'ja-JP' },
  12: { label: 'Русский', code: 'ru-RU' },
  13: { label: 'Português', code: 'pt-PT' },
  14: { label: 'Język polski', code: 'pl-PL' },
  15: { label: 'English (Australia)', code: 'en-AU' },
  16: { label: 'Dansk', code: 'da-DK' },
  17: { label: 'Suomi', code: 'fi-FI' },
  18: { label: 'Magyar', code: 'hu-HU' },
  19: { label: 'Norsk', code: 'nb-NO' },
  20: { label: 'Svenska', code: 'sv-SE' },
  21: { label: 'Italiano', code: 'it-IT' },
  22: { label: 'Cymraeg', code: 'cy-GB' },
  23: { label: 'Català', code: 'ca-ES' },
  24: { label: 'Galego', code: 'gl-ES' },
  25: { label: 'Euskara', code: 'eu-ES' },
  26: { label: 'العربية', code: 'ar-AR' },
  27: { label: 'हिन्दी', code: 'hi-HI' },
  28: { label: 'Français (Canada)', code: 'fr-CA' },
  29: { label: 'עברית', code: 'he-HE' },
  30: { label: 'tiếng Việt', code: 'vi-VN' },
  31: { label: 'Ελληνικά', code: 'el-GR' },
};

export function getLanguageFriendlyName(language: number | string | undefined): string {
  const numeric = typeof language === 'number' ? language : Number(language);
  if (Number.isInteger(numeric) && numeric >= 0) {
    try {
      const helper = window.PanoptoReactComponents?.Helpers?.getLanguageFriendlyName;
      if (typeof helper === 'function') {
        const friendly = helper(numeric);
        if (friendly) return friendly;
      }
    } catch {
      // Fall back to the bundled language table.
    }
    return LANGUAGE_META[numeric]?.label || `语言 ${numeric}`;
  }
  return typeof language === 'string' && language.trim() ? language.trim() : '字幕';
}

export function getLanguageCode(language: number | string | undefined): string {
  const numeric = typeof language === 'number' ? language : Number(language);
  if (Number.isInteger(numeric)) return LANGUAGE_META[numeric]?.code || `lang-${numeric}`;
  return typeof language === 'string' ? language.trim().toLowerCase() : '';
}

export function isSubtitleUrl(value: string): boolean {
  return /\.(?:vtt|webvtt|srt)(?:[?#]|$)/i.test(value || '');
}

export function subtitleUrlLabel(value: string): string {
  try {
    const url = new URL(value);
    const filename = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
    return filename || url.hostname;
  } catch {
    return '外部字幕';
  }
}

function decodeCaptionHtml(value: string): string {
  if (!value) return '';
  const source = value
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li)>/gi, '\n');

  let decoded = '';
  if (typeof DOMParser !== 'undefined') {
    try {
      decoded = new DOMParser().parseFromString(`<body>${source}</body>`, 'text/html').body.textContent || '';
    } catch {
      decoded = source.replace(/<[^>]+>/g, '');
    }
  } else {
    decoded = source
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  }

  return decoded
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, '').trimStart())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseTimestamp(value: string): number | null {
  const parts = value.trim().replace(',', '.').split(':');
  if (!parts.length || parts.length > 3) return null;
  const numbers = parts.map(Number);
  if (numbers.some((part) => !Number.isFinite(part))) return null;
  if (numbers.length === 3) return (numbers[0] || 0) * 3600 + (numbers[1] || 0) * 60 + (numbers[2] || 0);
  if (numbers.length === 2) return (numbers[0] || 0) * 60 + (numbers[1] || 0);
  return numbers[0] ?? null;
}

function normalizeCues(cues: SubtitleCue[]): SubtitleCue[] {
  const sorted = cues
    .filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.text.trim())
    .map((cue) => ({
      start: Math.max(0, cue.start),
      end: Math.max(cue.start + 0.001, cue.end),
      text: decodeCaptionHtml(cue.text),
    }))
    .filter((cue) => cue.text)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const deduped: SubtitleCue[] = [];
  const seen = new Set<string>();
  for (const cue of sorted) {
    const key = `${cue.start.toFixed(3)}|${cue.end.toFixed(3)}|${cue.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(cue);
  }
  return deduped;
}

export function parseWebVtt(text: string): SubtitleCue[] {
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    if (!block.trim()) continue;
    if (/^(?:WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/i.test(block.trimStart())) continue;
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const timingLine = lines[timingIndex] || '';
    const match = timingLine.match(/^\s*([^\s]+)\s+-->\s+([^\s]+)/);
    if (!match) continue;
    const start = parseTimestamp(match[1] || '');
    const end = parseTimestamp(match[2] || '');
    if (start === null || end === null) continue;
    const cueText = lines.slice(timingIndex + 1).join('\n').trim();
    if (!cueText) continue;
    cues.push({ start, end, text: cueText });
  }
  return normalizeCues(cues);
}

export function parseSrt(text: string): SubtitleCue[] {
  return parseWebVtt(text);
}

export function parseSubtitleText(text: string, hint?: 'vtt' | 'srt' | 'unknown'): SubtitleCue[] {
  if (hint === 'srt') return parseSrt(text);
  if (hint === 'vtt') return parseWebVtt(text);
  if (/^\s*WEBVTT/i.test(text) || /-->/.test(text)) return parseWebVtt(text);
  return [];
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function captionArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  for (const key of ['d', 'Captions', 'captions', 'Results', 'results']) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

export function parsePanoptoCaptions(payload: unknown): SubtitleCue[] {
  const events = captionArray(payload) as PanoptoCaptionEvent[];
  const partial = events
    .map((event) => {
      const start = finiteNumber(event.Time) ?? finiteNumber(event.StartTime) ?? finiteNumber(event.Start) ?? finiteNumber(event.AbsoluteTime);
      const duration = finiteNumber(event.CaptionDuration) ?? finiteNumber(event.Duration);
      const text = String(event.Caption ?? event.Text ?? '').trim();
      if (start === null || !text) return null;
      return { start, end: start + (duration && duration > 0 ? duration : 0), text };
    })
    .filter((cue): cue is SubtitleCue => cue !== null)
    .sort((a, b) => a.start - b.start);

  partial.forEach((cue, index) => {
    if (cue.end <= cue.start) {
      const next = partial[index + 1];
      cue.end = next && next.start > cue.start ? next.start : cue.start + 2;
    }
  });
  return normalizeCues(partial);
}

function formatTimestamp(seconds: number, separator: ',' | '.'): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`;
}

function cueText(cue: SubtitleCue): string {
  return decodeCaptionHtml(cue.text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

export function serializeSrt(cues: SubtitleCue[]): string {
  const normalized = normalizeCues(cues);
  return normalized
    .map((cue, index) => `${index + 1}\n${formatTimestamp(cue.start, ',')} --> ${formatTimestamp(cue.end, ',')}\n${cueText(cue)}`)
    .join('\n\n')
    .concat(normalized.length ? '\n' : '');
}

export function serializeVtt(cues: SubtitleCue[]): string {
  const normalized = normalizeCues(cues);
  const body = normalized
    .map((cue) => `${formatTimestamp(cue.start, '.')} --> ${formatTimestamp(cue.end, '.')}\n${cueText(cue)}`)
    .join('\n\n');
  return `WEBVTT\n\n${body}${body ? '\n' : ''}`;
}

export function serializeTranscript(cues: SubtitleCue[]): string {
  const paragraphs = normalizeCues(cues)
    .map((cue) => cueText(cue))
    .filter(Boolean);
  return paragraphs.length ? `${paragraphs.join('\n\n')}\n` : '';
}

export function serializeSubtitles(cues: SubtitleCue[], format: SubtitleFormat): string {
  if (format === 'vtt') return serializeVtt(cues);
  if (format === 'txt') return serializeTranscript(cues);
  return serializeSrt(cues);
}

export function subtitleMimeType(format: SubtitleFormat): string {
  if (format === 'vtt') return 'text/vtt;charset=utf-8';
  if (format === 'srt') return 'application/x-subrip;charset=utf-8';
  return 'text/plain;charset=utf-8';
}

export function subtitleFilenameSuffix(track: SubtitleTrack): string {
  const raw = track.languageCode || track.label || 'subtitles';
  return raw
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 60) || 'subtitles';
}

async function fetchTextResource(url: string): Promise<{ text: string; finalUrl: string }> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return { text: await response.text(), finalUrl: response.url || url };
}

async function fetchSubtitlePlaylist(playlistUrl: string): Promise<SubtitleCue[]> {
  const playlist = await fetchTextResource(playlistUrl);
  const segmentUrls = playlist.text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => absoluteUrl(line, playlist.finalUrl))
    .filter(Boolean)
    .slice(0, 500);

  if (!segmentUrls.length) throw new Error('字幕播放列表中没有分片');
  const results = await Promise.allSettled(segmentUrls.map((url) => fetchTextResource(url)));
  const cues: SubtitleCue[] = [];
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const format = /\.srt(?:[?#]|$)/i.test(result.value.finalUrl) ? 'srt' : 'vtt';
    cues.push(...parseSubtitleText(result.value.text, format));
  }
  if (!cues.length) throw new Error('字幕分片中没有可解析的文本');
  return normalizeCues(cues);
}

export async function fetchSubtitleTrackCues(track: SubtitleTrack): Promise<SubtitleCue[]> {
  if (track.cues?.length) return track.cues;
  if (!track.url) throw new Error('字幕地址为空');
  if (/\.m3u8(?:[?#]|$)/i.test(track.url)) return fetchSubtitlePlaylist(track.url);

  const file = await fetchTextResource(track.url);
  const hint = /\.srt(?:[?#]|$)/i.test(file.finalUrl) ? 'srt' : 'vtt';
  const cues = parseSubtitleText(file.text, hint);
  if (!cues.length) throw new Error('没有解析到字幕内容');
  return cues;
}

function deliveryInfoUrl(appRoot: string): string {
  const root = appRoot.replace(/\/$/, '');
  return `${location.origin}${root}/Pages/Viewer/DeliveryInfo.aspx`;
}

async function postDeliveryInfo(url: string, params: Record<string, string>): Promise<unknown> {
  const body = new URLSearchParams(params);
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return response.json();
}

export async function fetchPanoptoSubtitleTracks(deliveryId: string, appRoot: string): Promise<SubtitleTrack[]> {
  if (!deliveryId) return [];
  const url = deliveryInfoUrl(appRoot);
  const info = (await postDeliveryInfo(url, {
    deliveryId,
    responseType: 'json',
  })) as PanoptoDeliveryInfo & { ErrorCode?: unknown; ErrorMessage?: unknown };
  if (info.ErrorCode !== undefined && info.ErrorCode !== null && Number(info.ErrorCode) !== 0) {
    throw new Error(String(info.ErrorMessage || `Panopto 错误 ${String(info.ErrorCode)}`).replace(/<[^>]+>/g, ' '));
  }
  const available = info.Delivery?.AvailableCaptions ?? info.AvailableCaptions ?? [];
  if (!Array.isArray(available) || !available.length) return [];

  const unique = new Map<number, PanoptoCaptionInfo>();
  for (const caption of available) {
    const language = Number(caption?.Language);
    if (Number.isInteger(language) && language >= 0) unique.set(language, caption);
  }

  const results = await Promise.allSettled(
    [...unique.values()].map(async (caption): Promise<SubtitleTrack> => {
      const language = Number(caption.Language);
      const payload = await postDeliveryInfo(url, {
        deliveryId,
        getCaptions: 'true',
        language: String(language),
        responseType: 'json',
      });
      const cues = parsePanoptoCaptions(payload);
      if (!cues.length) throw new Error(getLanguageFriendlyName(language) + ' 字幕为空');
      return {
        id: `panopto:${language}`,
        label: getLanguageFriendlyName(language),
        languageCode: getLanguageCode(language),
        source: 'panopto',
        cues,
      };
    }),
  );

  const tracks: SubtitleTrack[] = [];
  let firstError: unknown;
  for (const result of results) {
    if (result.status === 'fulfilled') tracks.push(result.value);
    else if (firstError === undefined) firstError = result.reason;
  }
  if (!tracks.length && firstError !== undefined) {
    throw firstError instanceof Error ? firstError : new Error(String(firstError));
  }
  return tracks.sort((a, b) => a.label.localeCompare(b.label));
}
