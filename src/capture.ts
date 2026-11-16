import { absoluteUrl, isM3u8Url } from './utils';
import { isSubtitleUrl } from './subtitles';

export interface CaptureHandlers {
  noteMediaUrl(url: string, source: string): void;
  noteSubtitleUrl(url: string, source: string): void;
  noteDeliveryId(deliveryId: string): void;
}

export function deliveryIdFromUrl(value: string): string {
  try {
    const url = new URL(value, location.href);
    if (!/\/(?:Viewer|Embed)\.aspx$/i.test(url.pathname)) return '';
    return url.searchParams.get('id') || url.searchParams.get('deliveryId') || '';
  } catch {
    return '';
  }
}

export function deliveryIdFromBody(body: unknown): string {
  try {
    if (body instanceof URLSearchParams) return body.get('deliveryId') || '';
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      const value = body.get('deliveryId');
      return typeof value === 'string' ? value : '';
    }
    if (typeof body === 'string') return new URLSearchParams(body).get('deliveryId') || '';
  } catch {
    // Ignore bodies that are not form encoded.
  }
  return '';
}

function isDeliveryInfoUrl(value: string): boolean {
  try {
    return /\/Pages\/Viewer\/DeliveryInfo\.aspx$/i.test(new URL(value, location.href).pathname);
  } catch {
    return false;
  }
}

function noteRequest(rawUrl: string, body: unknown, source: string, handlers: CaptureHandlers): void {
  const url = absoluteUrl(rawUrl);
  if (!url) return;
  if (isM3u8Url(url)) handlers.noteMediaUrl(url, source);
  if (isSubtitleUrl(url)) handlers.noteSubtitleUrl(url, source);
  if (isDeliveryInfoUrl(url)) {
    const deliveryId = deliveryIdFromBody(body);
    if (deliveryId) handlers.noteDeliveryId(deliveryId);
  }
}

export function installNetworkHooks(handlers: CaptureHandlers): void {
  if (window.__canvasHlsDownloaderHooksV1__) return;
  window.__canvasHlsDownloaderHooksV1__ = true;

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (this: Window, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      try {
        const rawUrl = input instanceof Request ? input.url : String(input);
        noteRequest(rawUrl, init?.body, 'fetch', handlers);
        if (init?.body === undefined && input instanceof Request && isDeliveryInfoUrl(input.url)) {
          void input.clone().text().then((body) => {
            const deliveryId = deliveryIdFromBody(body);
            if (deliveryId) handlers.noteDeliveryId(deliveryId);
          }).catch(() => undefined);
        }
      } catch (error) {
        console.debug('[Canvas HLS] fetch hook failed', error);
      }
      return nativeFetch.call(this, input, init);
    };
  }

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async = true,
    username?: string | null,
    password?: string | null,
  ): void {
    try {
      noteRequest(typeof url === 'string' ? url : String(url), null, 'xhr', handlers);
    } catch (error) {
      console.debug('[Canvas HLS] XHR hook failed', error);
    }
    (nativeOpen as (...args: unknown[]) => void).call(this, method, url, async, username, password);
  };

  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
    try {
      const deliveryId = deliveryIdFromBody(body);
      if (deliveryId) handlers.noteDeliveryId(deliveryId);
    } catch (error) {
      console.debug('[Canvas HLS] XHR send hook failed', error);
    }
    nativeSend.call(this, body ?? null);
  };

  try {
    const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (srcDescriptor?.set && srcDescriptor?.get) {
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        configurable: srcDescriptor.configurable ?? true,
        enumerable: srcDescriptor.enumerable ?? false,
        get: srcDescriptor.get,
        set(value: string) {
          try {
            noteRequest(value, null, 'media', handlers);
          } catch (error) {
            console.debug('[Canvas HLS] media hook failed', error);
          }
          srcDescriptor.set?.call(this, value);
        },
      });
    }
  } catch (error) {
    console.debug('[Canvas HLS] media hook failed', error);
  }
}

export function harvestPerformanceEntries(handlers: CaptureHandlers, seen: Set<string>): void {
  try {
    for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      if ((!isM3u8Url(entry.name) && !isSubtitleUrl(entry.name)) || seen.has(entry.name)) continue;
      seen.add(entry.name);
      if (isM3u8Url(entry.name)) handlers.noteMediaUrl(entry.name, 'performance');
      if (isSubtitleUrl(entry.name)) handlers.noteSubtitleUrl(entry.name, 'performance');
    }
  } catch (error) {
    console.debug('[Canvas HLS] performance scan failed', error);
  }
}

export function harvestTrackElements(handlers: CaptureHandlers): void {
  try {
    for (const track of document.querySelectorAll<HTMLTrackElement>('track[src]')) {
      if (track.kind && !/^(?:subtitles|captions)$/i.test(track.kind)) continue;
      const src = track.getAttribute('src');
      if (src) handlers.noteSubtitleUrl(absoluteUrl(src), 'track');
    }
    for (const source of document.querySelectorAll<HTMLSourceElement>('source[src]')) {
      handlers.noteSubtitleUrl(absoluteUrl(source.getAttribute('src')), 'source');
    }
  } catch (error) {
    console.debug('[Canvas HLS] subtitle element scan failed', error);
  }
}

export function installPerformanceObserver(handlers: CaptureHandlers, seen: Set<string>): void {
  try {
    if (typeof PerformanceObserver !== 'function') return;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
        if ((!isM3u8Url(entry.name) && !isSubtitleUrl(entry.name)) || seen.has(entry.name)) continue;
        seen.add(entry.name);
        if (isM3u8Url(entry.name)) handlers.noteMediaUrl(entry.name, 'performance-observer');
        if (isSubtitleUrl(entry.name)) handlers.noteSubtitleUrl(entry.name, 'performance-observer');
      }
    });
    observer.observe({ type: 'resource', buffered: true });
  } catch (error) {
    console.debug('[Canvas HLS] PerformanceObserver unavailable', error);
  }
}
