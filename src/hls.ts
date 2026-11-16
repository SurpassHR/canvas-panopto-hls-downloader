import type {
  ByteRange,
  DirectFilePlan,
  HlsInitSection,
  HlsKey,
  HlsSegment,
  HlsSubtitleRendition,
  HlsVariant,
  MediaPlaylist,
  MediaResource,
} from './types';
import { absoluteUrl } from './utils';

export function parseAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const regex = /([A-Z0-9-]+)=("((?:[^"\\]|\\.)*)"|[^,]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value || ''))) {
    const key = (match[1] || '').toUpperCase();
    const quoted = match[3];
    attributes[key] = (quoted !== undefined ? quoted : (match[2] || '').trim()).replace(/\\"/g, '"');
  }
  return attributes;
}

export function parseMasterPlaylist(text: string, baseUrl: string): HlsVariant[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const variants: HlsVariant[] = [];
  let pending: Record<string, string> | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      pending = parseAttributes(line.slice('#EXT-X-STREAM-INF:'.length));
      continue;
    }
    if (line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) continue;
    if (line.startsWith('#')) continue;
    if (!pending) continue;

    const url = absoluteUrl(line, baseUrl);
    if (!url) {
      pending = null;
      continue;
    }

    const bandwidth = Number(pending['AVERAGE-BANDWIDTH'] || pending.BANDWIDTH || 0) || 0;
    const [widthText = '', heightText = ''] = (pending.RESOLUTION || '').split('x');
    variants.push({
      url,
      bandwidth,
      width: Number(widthText) || 0,
      height: Number(heightText) || 0,
      frameRate: Number(pending['FRAME-RATE'] || 0) || 0,
      codecs: pending.CODECS || '',
      audioGroup: pending.AUDIO || '',
      attributes: pending,
    });
    pending = null;
  }

  variants.sort((a, b) => {
    if (b.bandwidth !== a.bandwidth) return b.bandwidth - a.bandwidth;
    return b.width * b.height - a.width * a.height;
  });
  return variants;
}

export function parseSubtitleRenditions(text: string, baseUrl: string): HlsSubtitleRendition[] {
  const renditions: HlsSubtitleRendition[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('#EXT-X-MEDIA:')) continue;
    const attrs = parseAttributes(line.slice('#EXT-X-MEDIA:'.length));
    if ((attrs.TYPE || '').toUpperCase() !== 'SUBTITLES') continue;
    const url = absoluteUrl(attrs.URI, baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    renditions.push({
      url,
      groupId: attrs['GROUP-ID'] || '',
      name: attrs.NAME || attrs.LANGUAGE || '字幕',
      language: attrs.LANGUAGE || '',
      isDefault: (attrs.DEFAULT || '').toUpperCase() === 'YES',
      forced: (attrs.FORCED || '').toUpperCase() === 'YES',
      attributes: attrs,
    });
  }

  return renditions;
}

export function parseByteRange(value: string, fallbackOffset = 0): ByteRange | null {
  const textValue = String(value || '').trim();
  const match = textValue.match(/^(\d+)(?:@(\d+))?$/);
  if (!match) return null;
  return {
    length: Number(match[1]),
    offset: match[2] === undefined ? fallbackOffset : Number(match[2]),
  };
}

export function parseMediaPlaylist(text: string, baseUrl: string): MediaPlaylist {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const segments: HlsSegment[] = [];
  const warnings: string[] = [];
  const rangeEnds = new Map<string, number>();

  let mediaSequence = 0;
  let targetDuration = 0;
  let endList = false;
  let playlistType = '';
  let currentDuration = 0;
  let pendingRange: ByteRange | null = null;
  let currentKey: HlsKey | null = null;
  let currentMap: HlsInitSection | null = null;
  let currentGap = false;
  let segmentIndex = 0;
  let hasUnsupportedEncryption = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = Math.max(0, Number(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length)) || 0);
      continue;
    }
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = Number(line.slice('#EXT-X-TARGETDURATION:'.length)) || 0;
      continue;
    }
    if (line.startsWith('#EXT-X-PLAYLIST-TYPE:')) {
      playlistType = line.slice('#EXT-X-PLAYLIST-TYPE:'.length).trim().toUpperCase();
      continue;
    }
    if (line === '#EXT-X-ENDLIST') {
      endList = true;
      continue;
    }
    if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributes(line.slice('#EXT-X-KEY:'.length));
      const method = (attrs.METHOD || '').toUpperCase();
      if (!method || method === 'NONE') {
        currentKey = null;
      } else if (method === 'AES-128') {
        const keyUrl = absoluteUrl(attrs.URI, baseUrl);
        if (keyUrl) {
          currentKey = { method, url: keyUrl, iv: attrs.IV || '' };
        } else {
          currentKey = { method, unsupported: true, reason: 'AES-128 密钥地址无效' };
          hasUnsupportedEncryption = true;
        }
      } else {
        currentKey = { method, unsupported: true, reason: `不支持 ${method} 加密` };
        hasUnsupportedEncryption = true;
      }
      continue;
    }
    if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributes(line.slice('#EXT-X-MAP:'.length));
      const mapUrl = absoluteUrl(attrs.URI, baseUrl);
      if (!mapUrl) {
        warnings.push('初始化分片地址无效。');
        currentMap = null;
        continue;
      }
      const fallback = rangeEnds.get(mapUrl) || 0;
      const range = attrs.BYTERANGE ? parseByteRange(attrs.BYTERANGE, fallback) : null;
      currentMap = { url: mapUrl, range, key: currentKey };
      if (range) rangeEnds.set(mapUrl, range.offset + range.length);
      continue;
    }
    if (line.startsWith('#EXT-X-BYTERANGE:')) {
      pendingRange = parseByteRange(line.slice('#EXT-X-BYTERANGE:'.length));
      continue;
    }
    if (line.startsWith('#EXTINF:')) {
      currentDuration = Number(line.slice('#EXTINF:'.length).split(',')[0]) || 0;
      continue;
    }
    if (line === '#EXT-X-GAP') {
      currentGap = true;
      continue;
    }
    if (line.startsWith('#')) continue;

    const segmentUrl = absoluteUrl(line, baseUrl);
    if (!segmentUrl) continue;
    const fallback = rangeEnds.get(segmentUrl) || 0;
    const range = pendingRange
      ? { length: pendingRange.length, offset: pendingRange.offset ?? fallback }
      : null;

    segments.push({
      url: segmentUrl,
      range,
      duration: currentDuration,
      sequence: mediaSequence + segmentIndex,
      key: currentKey,
      map: currentMap,
      gap: currentGap,
    });
    if (range) rangeEnds.set(segmentUrl, range.offset + range.length);

    segmentIndex += 1;
    currentDuration = 0;
    pendingRange = null;
    currentGap = false;
  }

  const duration = segments.reduce((sum, segment) => sum + (segment.duration || 0), 0);
  const hasMap = segments.some((segment) => !!segment.map);
  const hasTs = segments.some((segment) => /\.ts(?:[?#]|$)/i.test(segment.url));
  const isFragmentedMp4 = hasMap || segments.some((segment) => /\.(?:m4s|mp4)(?:[?#]|$)/i.test(segment.url));
  const ext: MediaPlaylist['ext'] = isFragmentedMp4 || !hasTs ? 'mp4' : 'ts';
  const mime = ext === 'mp4' ? 'video/mp4' : 'video/mp2t';

  if (!segments.length) warnings.push('播放列表中没有可下载的分片。');
  if (!endList) warnings.push('播放列表尚未结束，可能只能下载当前已加载的片段。');
  if (hasUnsupportedEncryption) warnings.push('该视频使用了脚本不支持的加密方式。');
  if (segments.some((segment) => segment.gap)) {
    warnings.push('播放列表含缺失片段（EXT-X-GAP），下载结果可能有短暂中断。');
  }

  return {
    segments,
    warnings,
    mediaSequence,
    targetDuration,
    endList,
    playlistType,
    duration,
    hasMap,
    hasTs,
    ext,
    mime,
    hasUnsupportedEncryption,
  };
}

export function variantLabel(variant: HlsVariant, index: number): string {
  const resolution = variant.width && variant.height ? `${variant.width}×${variant.height}` : '未知分辨率';
  const bitrate = variant.bandwidth ? `${(variant.bandwidth / 1e6).toFixed(2)} Mbps` : '未知码率';
  const suffix = variant.codecs ? ` · ${variant.codecs}` : '';
  return `${index + 1}. ${resolution} · ${bitrate}${suffix}`;
}

export function estimatePlaylistBytes(playlist: MediaPlaylist | null): number {
  if (!playlist) return 0;
  let total = 0;
  let hasBytes = false;
  const maps = new Set<HlsInitSection>();
  for (const segment of playlist.segments) {
    if (segment.map && !maps.has(segment.map)) {
      maps.add(segment.map);
      if (segment.map.range?.length) {
        total += segment.map.range.length;
        hasBytes = true;
      }
    }
    if (segment.range?.length && !segment.gap) {
      total += segment.range.length;
      hasBytes = true;
    }
  }
  return hasBytes ? total : 0;
}

export function makeDirectFilePlan(playlist: MediaPlaylist | null): DirectFilePlan | null {
  if (!playlist || !playlist.segments.length || playlist.hasUnsupportedEncryption) return null;
  const items: MediaResource[] = [];
  const maps = new Set<HlsInitSection>();
  for (const segment of playlist.segments) {
    if (segment.key?.method && segment.key.method !== 'NONE') return null;
    if (segment.map?.key?.method && segment.map.key.method !== 'NONE') return null;
    if (segment.map && !maps.has(segment.map)) {
      maps.add(segment.map);
      items.push(segment.map);
    }
    if (!segment.gap) items.push(segment);
  }
  if (!items.length) return null;
  for (const item of items) {
    if (!item.range) return null;
  }
  const first = items[0];
  if (!first || items.some((item) => item.url !== first.url)) return null;

  const ranged = items.map((item) => ({ url: item.url, range: item.range as ByteRange }));
  ranged.sort((a, b) => a.range.offset - b.range.offset);
  let cursor = 0;
  for (const item of ranged) {
    if (item.range.offset !== cursor) return null;
    cursor += item.range.length;
  }
  return cursor > 0 ? { url: first.url, length: cursor } : null;
}
