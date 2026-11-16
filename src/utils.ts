export function absoluteUrl(value: string | null | undefined, base = location.href): string {
  if (!value || typeof value !== 'string') return '';
  try {
    return new URL(value.trim(), base).href;
  } catch {
    return '';
  }
}

export function isM3u8Url(value: string): boolean {
  return /\.m3u8(?:[?#]|$)/i.test(value || '');
}

export function isLikelyMasterUrl(value: string): boolean {
  try {
    return /\/master\.m3u8(?:[?#]|$)/i.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

export function shortUrl(value: string, maxLength = 78): string {
  try {
    const url = new URL(value);
    const path = decodeURIComponent(url.pathname);
    const textValue = url.host + path + (url.search ? url.search.slice(0, 18) : '');
    return textValue.length > maxLength ? `${textValue.slice(0, maxLength - 1)}…` : textValue;
  } catch {
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
  }
}

export function getVideoTitle(): string {
  const candidates: string[] = [];
  try {
    const heading = document.querySelector('h1')?.textContent?.trim();
    if (heading) candidates.push(heading);
  } catch {
    // Ignore DOM issues from players that replace their document.
  }

  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
  if (ogTitle) candidates.push(ogTitle);
  if (document.title) candidates.push(document.title);

  const title = (candidates.find(Boolean) || 'video')
    .replace(/\s*[-–|]\s*Panopto.*$/i, '')
    .replace(/\s*[-–|]\s*Audio playing.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return title || 'video';
}

export function sanitizeFilename(value: string): string {
  const cleaned = String(value || 'video')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 150);
  return cleaned || 'video';
}

export function formatBytes(bytes: number): string {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const scaled = value / 1024 ** exponent;
  return `${scaled >= 100 || exponent === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[exponent]}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function friendlyError(error: unknown, prefix: string): string {
  const message = error instanceof Error ? error.message : String(error || '未知错误');
  if (/HTTP 401|HTTP 403/i.test(message)) return `${prefix}：链接可能已过期，请刷新页面并重新播放视频。`;
  if (/Failed to fetch|Load failed|NetworkError/i.test(message)) {
    return `${prefix}：网络或跨域限制导致读取失败。请确认视频已开始播放，或点击视频右下角的“在 Panopto 中观看”后重试。`;
  }
  if (/decode|padding|operation failed/i.test(message)) {
    return `${prefix}：AES-128 解密失败，播放列表可能使用了特殊密钥参数。`;
  }
  return `${prefix}：${message}`;
}

export function getPanoptoAppRoot(): string {
  const configured = window.Panopto?.appRoot;
  if (configured?.startsWith('/')) return configured.replace(/\/$/, '');
  const marker = '/Pages/';
  const index = location.pathname.indexOf(marker);
  return index > 0 ? location.pathname.slice(0, index) : '/Panopto';
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
