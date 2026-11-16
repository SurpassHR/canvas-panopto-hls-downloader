// ==UserScript==
// @name         Canvas 课程视频下载器（Panopto HLS + 字幕）
// @namespace    https://github.com/SurpassHR/canvas-panopto-hls-downloader
// @version      1.1.0
// @description  自动捕获 Canvas 内嵌 Panopto 播放器加载的 HLS，并下载视频及 SRT/VTT/TXT 字幕。
// @author       Codex
// @match        https://*.panopto.eu/*
// @match        https://*.panopto.com/*
// @match        https://*.panoptocloud.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

"use strict";
(() => {
  // src/utils.ts
  function absoluteUrl(value, base = location.href) {
    if (!value || typeof value !== "string") return "";
    try {
      return new URL(value.trim(), base).href;
    } catch {
      return "";
    }
  }
  function isM3u8Url(value) {
    return /\.m3u8(?:[?#]|$)/i.test(value || "");
  }
  function isLikelyMasterUrl(value) {
    try {
      return /\/master\.m3u8(?:[?#]|$)/i.test(new URL(value).pathname);
    } catch {
      return false;
    }
  }
  function shortUrl(value, maxLength = 78) {
    try {
      const url = new URL(value);
      const path = decodeURIComponent(url.pathname);
      const textValue = url.host + path + (url.search ? url.search.slice(0, 18) : "");
      return textValue.length > maxLength ? `${textValue.slice(0, maxLength - 1)}…` : textValue;
    } catch {
      return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
    }
  }
  function getVideoTitle() {
    const candidates = [];
    try {
      const heading = document.querySelector("h1")?.textContent?.trim();
      if (heading) candidates.push(heading);
    } catch {
    }
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content");
    if (ogTitle) candidates.push(ogTitle);
    if (document.title) candidates.push(document.title);
    const title = (candidates.find(Boolean) || "video").replace(/\s*[-–|]\s*Panopto.*$/i, "").replace(/\s*[-–|]\s*Audio playing.*$/i, "").replace(/\s+/g, " ").trim();
    return title || "video";
  }
  function sanitizeFilename(value) {
    const cleaned = String(value || "video").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").trim().slice(0, 150);
    return cleaned || "video";
  }
  function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const exponent = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    const scaled = value / 1024 ** exponent;
    return `${scaled >= 100 || exponent === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[exponent]}`;
  }
  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total % 3600 / 60);
    const secs = total % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
  }
  function friendlyError(error, prefix) {
    const message = error instanceof Error ? error.message : String(error || "未知错误");
    if (/HTTP 401|HTTP 403/i.test(message)) return `${prefix}：链接可能已过期，请刷新页面并重新播放视频。`;
    if (/Failed to fetch|Load failed|NetworkError/i.test(message)) {
      return `${prefix}：网络或跨域限制导致读取失败。请确认视频已开始播放，或点击视频右下角的“在 Panopto 中观看”后重试。`;
    }
    if (/decode|padding|operation failed/i.test(message)) {
      return `${prefix}：AES-128 解密失败，播放列表可能使用了特殊密钥参数。`;
    }
    return `${prefix}：${message}`;
  }
  function getPanoptoAppRoot() {
    const configured = window.Panopto?.appRoot;
    if (configured?.startsWith("/")) return configured.replace(/\/$/, "");
    const marker = "/Pages/";
    const index = location.pathname.indexOf(marker);
    return index > 0 ? location.pathname.slice(0, index) : "/Panopto";
  }
  function sleep(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  // src/subtitles.ts
  var LANGUAGE_META = {
    0: { label: "English (United States)", code: "en-US" },
    1: { label: "English (United Kingdom)", code: "en-GB" },
    2: { label: "Español (México)", code: "es-MX" },
    3: { label: "Español (España)", code: "es-ES" },
    4: { label: "Deutsch", code: "de-DE" },
    5: { label: "Français", code: "fr-FR" },
    6: { label: "Nederlands", code: "nl-NL" },
    7: { label: "ไทย", code: "th-TH" },
    8: { label: "简体中文", code: "zh-CN" },
    9: { label: "繁體中文", code: "zh-HK" },
    10: { label: "한국어", code: "ko-KR" },
    11: { label: "日本語", code: "ja-JP" },
    12: { label: "Русский", code: "ru-RU" },
    13: { label: "Português", code: "pt-PT" },
    14: { label: "Język polski", code: "pl-PL" },
    15: { label: "English (Australia)", code: "en-AU" },
    16: { label: "Dansk", code: "da-DK" },
    17: { label: "Suomi", code: "fi-FI" },
    18: { label: "Magyar", code: "hu-HU" },
    19: { label: "Norsk", code: "nb-NO" },
    20: { label: "Svenska", code: "sv-SE" },
    21: { label: "Italiano", code: "it-IT" },
    22: { label: "Cymraeg", code: "cy-GB" },
    23: { label: "Català", code: "ca-ES" },
    24: { label: "Galego", code: "gl-ES" },
    25: { label: "Euskara", code: "eu-ES" },
    26: { label: "العربية", code: "ar-AR" },
    27: { label: "हिन्दी", code: "hi-HI" },
    28: { label: "Français (Canada)", code: "fr-CA" },
    29: { label: "עברית", code: "he-HE" },
    30: { label: "tiếng Việt", code: "vi-VN" },
    31: { label: "Ελληνικά", code: "el-GR" }
  };
  function getLanguageFriendlyName(language) {
    const numeric = typeof language === "number" ? language : Number(language);
    if (Number.isInteger(numeric) && numeric >= 0) {
      try {
        const helper = window.PanoptoReactComponents?.Helpers?.getLanguageFriendlyName;
        if (typeof helper === "function") {
          const friendly = helper(numeric);
          if (friendly) return friendly;
        }
      } catch {
      }
      return LANGUAGE_META[numeric]?.label || `语言 ${numeric}`;
    }
    return typeof language === "string" && language.trim() ? language.trim() : "字幕";
  }
  function getLanguageCode(language) {
    const numeric = typeof language === "number" ? language : Number(language);
    if (Number.isInteger(numeric)) return LANGUAGE_META[numeric]?.code || `lang-${numeric}`;
    return typeof language === "string" ? language.trim().toLowerCase() : "";
  }
  function isSubtitleUrl(value) {
    return /\.(?:vtt|webvtt|srt)(?:[?#]|$)/i.test(value || "");
  }
  function subtitleUrlLabel(value) {
    try {
      const url = new URL(value);
      const filename = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
      return filename || url.hostname;
    } catch {
      return "外部字幕";
    }
  }
  function decodeCaptionHtml(value) {
    if (!value) return "";
    const source = value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/(?:p|div|li)>/gi, "\n");
    let decoded = "";
    if (typeof DOMParser !== "undefined") {
      try {
        decoded = new DOMParser().parseFromString(`<body>${source}</body>`, "text/html").body.textContent || "";
      } catch {
        decoded = source.replace(/<[^>]+>/g, "");
      }
    } else {
      decoded = source.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
    }
    return decoded.replace(/\u00a0/g, " ").split("\n").map((line) => line.replace(/[ \t]+$/g, "").trimStart()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function parseTimestamp(value) {
    const parts = value.trim().replace(",", ".").split(":");
    if (!parts.length || parts.length > 3) return null;
    const numbers = parts.map(Number);
    if (numbers.some((part) => !Number.isFinite(part))) return null;
    if (numbers.length === 3) return (numbers[0] || 0) * 3600 + (numbers[1] || 0) * 60 + (numbers[2] || 0);
    if (numbers.length === 2) return (numbers[0] || 0) * 60 + (numbers[1] || 0);
    return numbers[0] ?? null;
  }
  function normalizeCues(cues) {
    const sorted = cues.filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.text.trim()).map((cue) => ({
      start: Math.max(0, cue.start),
      end: Math.max(cue.start + 1e-3, cue.end),
      text: decodeCaptionHtml(cue.text)
    })).filter((cue) => cue.text).sort((a, b) => a.start - b.start || a.end - b.end);
    const deduped = [];
    const seen = /* @__PURE__ */ new Set();
    for (const cue of sorted) {
      const key = `${cue.start.toFixed(3)}|${cue.end.toFixed(3)}|${cue.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(cue);
    }
    return deduped;
  }
  function parseWebVtt(text) {
    const blocks = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim().split(/\n{2,}/);
    const cues = [];
    for (const block of blocks) {
      if (!block.trim()) continue;
      if (/^(?:WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/i.test(block.trimStart())) continue;
      const lines = block.split("\n");
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex < 0) continue;
      const timingLine = lines[timingIndex] || "";
      const match = timingLine.match(/^\s*([^\s]+)\s+-->\s+([^\s]+)/);
      if (!match) continue;
      const start2 = parseTimestamp(match[1] || "");
      const end = parseTimestamp(match[2] || "");
      if (start2 === null || end === null) continue;
      const cueText2 = lines.slice(timingIndex + 1).join("\n").trim();
      if (!cueText2) continue;
      cues.push({ start: start2, end, text: cueText2 });
    }
    return normalizeCues(cues);
  }
  function parseSrt(text) {
    return parseWebVtt(text);
  }
  function parseSubtitleText(text, hint) {
    if (hint === "srt") return parseSrt(text);
    if (hint === "vtt") return parseWebVtt(text);
    if (/^\s*WEBVTT/i.test(text) || /-->/.test(text)) return parseWebVtt(text);
    return [];
  }
  function finiteNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }
  function captionArray(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    const record = payload;
    for (const key of ["d", "Captions", "captions", "Results", "results"]) {
      if (Array.isArray(record[key])) return record[key];
    }
    return [];
  }
  function parsePanoptoCaptions(payload) {
    const events = captionArray(payload);
    const partial = events.map((event) => {
      const start2 = finiteNumber(event.Time) ?? finiteNumber(event.StartTime) ?? finiteNumber(event.Start) ?? finiteNumber(event.AbsoluteTime);
      const duration = finiteNumber(event.CaptionDuration) ?? finiteNumber(event.Duration);
      const text = String(event.Caption ?? event.Text ?? "").trim();
      if (start2 === null || !text) return null;
      return { start: start2, end: start2 + (duration && duration > 0 ? duration : 0), text };
    }).filter((cue) => cue !== null).sort((a, b) => a.start - b.start);
    partial.forEach((cue, index) => {
      if (cue.end <= cue.start) {
        const next = partial[index + 1];
        cue.end = next && next.start > cue.start ? next.start : cue.start + 2;
      }
    });
    return normalizeCues(partial);
  }
  function formatTimestamp(seconds, separator) {
    const totalMs = Math.max(0, Math.round(seconds * 1e3));
    const hours = Math.floor(totalMs / 36e5);
    const minutes = Math.floor(totalMs % 36e5 / 6e4);
    const secs = Math.floor(totalMs % 6e4 / 1e3);
    const millis = totalMs % 1e3;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
  }
  function cueText(cue) {
    return decodeCaptionHtml(cue.text).split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
  }
  function serializeSrt(cues) {
    const normalized = normalizeCues(cues);
    return normalized.map((cue, index) => `${index + 1}
${formatTimestamp(cue.start, ",")} --> ${formatTimestamp(cue.end, ",")}
${cueText(cue)}`).join("\n\n").concat(normalized.length ? "\n" : "");
  }
  function serializeVtt(cues) {
    const normalized = normalizeCues(cues);
    const body = normalized.map((cue) => `${formatTimestamp(cue.start, ".")} --> ${formatTimestamp(cue.end, ".")}
${cueText(cue)}`).join("\n\n");
    return `WEBVTT

${body}${body ? "\n" : ""}`;
  }
  function serializeTranscript(cues) {
    const paragraphs = normalizeCues(cues).map((cue) => cueText(cue)).filter(Boolean);
    return paragraphs.length ? `${paragraphs.join("\n\n")}
` : "";
  }
  function subtitleMimeType(format) {
    if (format === "vtt") return "text/vtt;charset=utf-8";
    if (format === "srt") return "application/x-subrip;charset=utf-8";
    return "text/plain;charset=utf-8";
  }
  function subtitleFilenameSuffix(track) {
    const raw = track.languageCode || track.label || "subtitles";
    return raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").trim().slice(0, 60) || "subtitles";
  }
  async function fetchTextResource(url) {
    const response = await fetch(url, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return { text: await response.text(), finalUrl: response.url || url };
  }
  async function fetchSubtitlePlaylist(playlistUrl) {
    const playlist = await fetchTextResource(playlistUrl);
    const segmentUrls = playlist.text.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).map((line) => absoluteUrl(line, playlist.finalUrl)).filter(Boolean).slice(0, 500);
    if (!segmentUrls.length) throw new Error("字幕播放列表中没有分片");
    const results = await Promise.allSettled(segmentUrls.map((url) => fetchTextResource(url)));
    const cues = [];
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const format = /\.srt(?:[?#]|$)/i.test(result.value.finalUrl) ? "srt" : "vtt";
      cues.push(...parseSubtitleText(result.value.text, format));
    }
    if (!cues.length) throw new Error("字幕分片中没有可解析的文本");
    return normalizeCues(cues);
  }
  async function fetchSubtitleTrackCues(track) {
    if (track.cues?.length) return track.cues;
    if (!track.url) throw new Error("字幕地址为空");
    if (/\.m3u8(?:[?#]|$)/i.test(track.url)) return fetchSubtitlePlaylist(track.url);
    const file = await fetchTextResource(track.url);
    const hint = /\.srt(?:[?#]|$)/i.test(file.finalUrl) ? "srt" : "vtt";
    const cues = parseSubtitleText(file.text, hint);
    if (!cues.length) throw new Error("没有解析到字幕内容");
    return cues;
  }
  function deliveryInfoUrl(appRoot) {
    const root = appRoot.replace(/\/$/, "");
    return `${location.origin}${root}/Pages/Viewer/DeliveryInfo.aspx`;
  }
  async function postDeliveryInfo(url, params) {
    const body = new URLSearchParams(params);
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return response.json();
  }
  async function fetchPanoptoSubtitleTracks(deliveryId, appRoot) {
    if (!deliveryId) return [];
    const url = deliveryInfoUrl(appRoot);
    const info = await postDeliveryInfo(url, {
      deliveryId,
      responseType: "json"
    });
    if (info.ErrorCode !== void 0 && info.ErrorCode !== null && Number(info.ErrorCode) !== 0) {
      throw new Error(String(info.ErrorMessage || `Panopto 错误 ${String(info.ErrorCode)}`).replace(/<[^>]+>/g, " "));
    }
    const available = info.Delivery?.AvailableCaptions ?? info.AvailableCaptions ?? [];
    if (!Array.isArray(available) || !available.length) return [];
    const unique = /* @__PURE__ */ new Map();
    for (const caption of available) {
      const language = Number(caption?.Language);
      if (Number.isInteger(language) && language >= 0) unique.set(language, caption);
    }
    const results = await Promise.allSettled(
      [...unique.values()].map(async (caption) => {
        const language = Number(caption.Language);
        const payload = await postDeliveryInfo(url, {
          deliveryId,
          getCaptions: "true",
          language: String(language),
          responseType: "json"
        });
        const cues = parsePanoptoCaptions(payload);
        if (!cues.length) throw new Error(getLanguageFriendlyName(language) + " 字幕为空");
        return {
          id: `panopto:${language}`,
          label: getLanguageFriendlyName(language),
          languageCode: getLanguageCode(language),
          source: "panopto",
          cues
        };
      })
    );
    const tracks = [];
    let firstError;
    for (const result of results) {
      if (result.status === "fulfilled") tracks.push(result.value);
      else if (firstError === void 0) firstError = result.reason;
    }
    if (!tracks.length && firstError !== void 0) {
      throw firstError instanceof Error ? firstError : new Error(String(firstError));
    }
    return tracks.sort((a, b) => a.label.localeCompare(b.label));
  }

  // src/capture.ts
  function deliveryIdFromUrl(value) {
    try {
      const url = new URL(value, location.href);
      if (!/\/(?:Viewer|Embed)\.aspx$/i.test(url.pathname)) return "";
      return url.searchParams.get("id") || url.searchParams.get("deliveryId") || "";
    } catch {
      return "";
    }
  }
  function deliveryIdFromBody(body) {
    try {
      if (body instanceof URLSearchParams) return body.get("deliveryId") || "";
      if (typeof FormData !== "undefined" && body instanceof FormData) {
        const value = body.get("deliveryId");
        return typeof value === "string" ? value : "";
      }
      if (typeof body === "string") return new URLSearchParams(body).get("deliveryId") || "";
    } catch {
    }
    return "";
  }
  function isDeliveryInfoUrl(value) {
    try {
      return /\/Pages\/Viewer\/DeliveryInfo\.aspx$/i.test(new URL(value, location.href).pathname);
    } catch {
      return false;
    }
  }
  function noteRequest(rawUrl, body, source, handlers) {
    const url = absoluteUrl(rawUrl);
    if (!url) return;
    if (isM3u8Url(url)) handlers.noteMediaUrl(url, source);
    if (isSubtitleUrl(url)) handlers.noteSubtitleUrl(url, source);
    if (isDeliveryInfoUrl(url)) {
      const deliveryId = deliveryIdFromBody(body);
      if (deliveryId) handlers.noteDeliveryId(deliveryId);
    }
  }
  function installNetworkHooks(handlers) {
    if (window.__canvasHlsDownloaderHooksV1__) return;
    window.__canvasHlsDownloaderHooksV1__ = true;
    const nativeFetch = window.fetch;
    if (typeof nativeFetch === "function") {
      window.fetch = function(input, init) {
        try {
          const rawUrl = input instanceof Request ? input.url : String(input);
          noteRequest(rawUrl, init?.body, "fetch", handlers);
          if (init?.body === void 0 && input instanceof Request && isDeliveryInfoUrl(input.url)) {
            void input.clone().text().then((body) => {
              const deliveryId = deliveryIdFromBody(body);
              if (deliveryId) handlers.noteDeliveryId(deliveryId);
            }).catch(() => void 0);
          }
        } catch (error) {
          console.debug("[Canvas HLS] fetch hook failed", error);
        }
        return nativeFetch.call(this, input, init);
      };
    }
    const nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, async = true, username, password) {
      try {
        noteRequest(typeof url === "string" ? url : String(url), null, "xhr", handlers);
      } catch (error) {
        console.debug("[Canvas HLS] XHR hook failed", error);
      }
      nativeOpen.call(this, method, url, async, username, password);
    };
    const nativeSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
      try {
        const deliveryId = deliveryIdFromBody(body);
        if (deliveryId) handlers.noteDeliveryId(deliveryId);
      } catch (error) {
        console.debug("[Canvas HLS] XHR send hook failed", error);
      }
      nativeSend.call(this, body ?? null);
    };
    try {
      const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
      if (srcDescriptor?.set && srcDescriptor?.get) {
        Object.defineProperty(HTMLMediaElement.prototype, "src", {
          configurable: srcDescriptor.configurable ?? true,
          enumerable: srcDescriptor.enumerable ?? false,
          get: srcDescriptor.get,
          set(value) {
            try {
              noteRequest(value, null, "media", handlers);
            } catch (error) {
              console.debug("[Canvas HLS] media hook failed", error);
            }
            srcDescriptor.set?.call(this, value);
          }
        });
      }
    } catch (error) {
      console.debug("[Canvas HLS] media hook failed", error);
    }
  }
  function harvestPerformanceEntries(handlers, seen) {
    try {
      for (const entry of performance.getEntriesByType("resource")) {
        if (!isM3u8Url(entry.name) && !isSubtitleUrl(entry.name) || seen.has(entry.name)) continue;
        seen.add(entry.name);
        if (isM3u8Url(entry.name)) handlers.noteMediaUrl(entry.name, "performance");
        if (isSubtitleUrl(entry.name)) handlers.noteSubtitleUrl(entry.name, "performance");
      }
    } catch (error) {
      console.debug("[Canvas HLS] performance scan failed", error);
    }
  }
  function harvestTrackElements(handlers) {
    try {
      for (const track of document.querySelectorAll("track[src]")) {
        if (track.kind && !/^(?:subtitles|captions)$/i.test(track.kind)) continue;
        const src = track.getAttribute("src");
        if (src) handlers.noteSubtitleUrl(absoluteUrl(src), "track");
      }
      for (const source of document.querySelectorAll("source[src]")) {
        handlers.noteSubtitleUrl(absoluteUrl(source.getAttribute("src")), "source");
      }
    } catch (error) {
      console.debug("[Canvas HLS] subtitle element scan failed", error);
    }
  }
  function installPerformanceObserver(handlers, seen) {
    try {
      if (typeof PerformanceObserver !== "function") return;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!isM3u8Url(entry.name) && !isSubtitleUrl(entry.name) || seen.has(entry.name)) continue;
          seen.add(entry.name);
          if (isM3u8Url(entry.name)) handlers.noteMediaUrl(entry.name, "performance-observer");
          if (isSubtitleUrl(entry.name)) handlers.noteSubtitleUrl(entry.name, "performance-observer");
        }
      });
      observer.observe({ type: "resource", buffered: true });
    } catch (error) {
      console.debug("[Canvas HLS] PerformanceObserver unavailable", error);
    }
  }

  // src/hls.ts
  function parseAttributes(value) {
    const attributes = {};
    const regex = /([A-Z0-9-]+)=("((?:[^"\\]|\\.)*)"|[^,]*)/gi;
    let match;
    while (match = regex.exec(value || "")) {
      const key = (match[1] || "").toUpperCase();
      const quoted = match[3];
      attributes[key] = (quoted !== void 0 ? quoted : (match[2] || "").trim()).replace(/\\"/g, '"');
    }
    return attributes;
  }
  function parseMasterPlaylist(text, baseUrl) {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
    const variants = [];
    let pending = null;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        pending = parseAttributes(line.slice("#EXT-X-STREAM-INF:".length));
        continue;
      }
      if (line.startsWith("#EXT-X-I-FRAME-STREAM-INF:")) continue;
      if (line.startsWith("#")) continue;
      if (!pending) continue;
      const url = absoluteUrl(line, baseUrl);
      if (!url) {
        pending = null;
        continue;
      }
      const bandwidth = Number(pending["AVERAGE-BANDWIDTH"] || pending.BANDWIDTH || 0) || 0;
      const [widthText = "", heightText = ""] = (pending.RESOLUTION || "").split("x");
      variants.push({
        url,
        bandwidth,
        width: Number(widthText) || 0,
        height: Number(heightText) || 0,
        frameRate: Number(pending["FRAME-RATE"] || 0) || 0,
        codecs: pending.CODECS || "",
        audioGroup: pending.AUDIO || "",
        attributes: pending
      });
      pending = null;
    }
    variants.sort((a, b) => {
      if (b.bandwidth !== a.bandwidth) return b.bandwidth - a.bandwidth;
      return b.width * b.height - a.width * a.height;
    });
    return variants;
  }
  function parseSubtitleRenditions(text, baseUrl) {
    const renditions = [];
    const seen = /* @__PURE__ */ new Set();
    for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line.startsWith("#EXT-X-MEDIA:")) continue;
      const attrs = parseAttributes(line.slice("#EXT-X-MEDIA:".length));
      if ((attrs.TYPE || "").toUpperCase() !== "SUBTITLES") continue;
      const url = absoluteUrl(attrs.URI, baseUrl);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      renditions.push({
        url,
        groupId: attrs["GROUP-ID"] || "",
        name: attrs.NAME || attrs.LANGUAGE || "字幕",
        language: attrs.LANGUAGE || "",
        isDefault: (attrs.DEFAULT || "").toUpperCase() === "YES",
        forced: (attrs.FORCED || "").toUpperCase() === "YES",
        attributes: attrs
      });
    }
    return renditions;
  }
  function parseByteRange(value, fallbackOffset = 0) {
    const textValue = String(value || "").trim();
    const match = textValue.match(/^(\d+)(?:@(\d+))?$/);
    if (!match) return null;
    return {
      length: Number(match[1]),
      offset: match[2] === void 0 ? fallbackOffset : Number(match[2])
    };
  }
  function parseMediaPlaylist(text, baseUrl) {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
    const segments = [];
    const warnings = [];
    const rangeEnds = /* @__PURE__ */ new Map();
    let mediaSequence = 0;
    let targetDuration = 0;
    let endList = false;
    let playlistType = "";
    let currentDuration = 0;
    let pendingRange = null;
    let currentKey = null;
    let currentMap = null;
    let currentGap = false;
    let segmentIndex = 0;
    let hasUnsupportedEncryption = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
        mediaSequence = Math.max(0, Number(line.slice("#EXT-X-MEDIA-SEQUENCE:".length)) || 0);
        continue;
      }
      if (line.startsWith("#EXT-X-TARGETDURATION:")) {
        targetDuration = Number(line.slice("#EXT-X-TARGETDURATION:".length)) || 0;
        continue;
      }
      if (line.startsWith("#EXT-X-PLAYLIST-TYPE:")) {
        playlistType = line.slice("#EXT-X-PLAYLIST-TYPE:".length).trim().toUpperCase();
        continue;
      }
      if (line === "#EXT-X-ENDLIST") {
        endList = true;
        continue;
      }
      if (line.startsWith("#EXT-X-KEY:")) {
        const attrs = parseAttributes(line.slice("#EXT-X-KEY:".length));
        const method = (attrs.METHOD || "").toUpperCase();
        if (!method || method === "NONE") {
          currentKey = null;
        } else if (method === "AES-128") {
          const keyUrl = absoluteUrl(attrs.URI, baseUrl);
          if (keyUrl) {
            currentKey = { method, url: keyUrl, iv: attrs.IV || "" };
          } else {
            currentKey = { method, unsupported: true, reason: "AES-128 密钥地址无效" };
            hasUnsupportedEncryption = true;
          }
        } else {
          currentKey = { method, unsupported: true, reason: `不支持 ${method} 加密` };
          hasUnsupportedEncryption = true;
        }
        continue;
      }
      if (line.startsWith("#EXT-X-MAP:")) {
        const attrs = parseAttributes(line.slice("#EXT-X-MAP:".length));
        const mapUrl = absoluteUrl(attrs.URI, baseUrl);
        if (!mapUrl) {
          warnings.push("初始化分片地址无效。");
          currentMap = null;
          continue;
        }
        const fallback2 = rangeEnds.get(mapUrl) || 0;
        const range2 = attrs.BYTERANGE ? parseByteRange(attrs.BYTERANGE, fallback2) : null;
        currentMap = { url: mapUrl, range: range2, key: currentKey };
        if (range2) rangeEnds.set(mapUrl, range2.offset + range2.length);
        continue;
      }
      if (line.startsWith("#EXT-X-BYTERANGE:")) {
        pendingRange = parseByteRange(line.slice("#EXT-X-BYTERANGE:".length));
        continue;
      }
      if (line.startsWith("#EXTINF:")) {
        currentDuration = Number(line.slice("#EXTINF:".length).split(",")[0]) || 0;
        continue;
      }
      if (line === "#EXT-X-GAP") {
        currentGap = true;
        continue;
      }
      if (line.startsWith("#")) continue;
      const segmentUrl = absoluteUrl(line, baseUrl);
      if (!segmentUrl) continue;
      const fallback = rangeEnds.get(segmentUrl) || 0;
      const range = pendingRange ? { length: pendingRange.length, offset: pendingRange.offset ?? fallback } : null;
      segments.push({
        url: segmentUrl,
        range,
        duration: currentDuration,
        sequence: mediaSequence + segmentIndex,
        key: currentKey,
        map: currentMap,
        gap: currentGap
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
    const ext = isFragmentedMp4 || !hasTs ? "mp4" : "ts";
    const mime = ext === "mp4" ? "video/mp4" : "video/mp2t";
    if (!segments.length) warnings.push("播放列表中没有可下载的分片。");
    if (!endList) warnings.push("播放列表尚未结束，可能只能下载当前已加载的片段。");
    if (hasUnsupportedEncryption) warnings.push("该视频使用了脚本不支持的加密方式。");
    if (segments.some((segment) => segment.gap)) {
      warnings.push("播放列表含缺失片段（EXT-X-GAP），下载结果可能有短暂中断。");
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
      hasUnsupportedEncryption
    };
  }
  function variantLabel(variant, index) {
    const resolution = variant.width && variant.height ? `${variant.width}×${variant.height}` : "未知分辨率";
    const bitrate = variant.bandwidth ? `${(variant.bandwidth / 1e6).toFixed(2)} Mbps` : "未知码率";
    const suffix = variant.codecs ? ` · ${variant.codecs}` : "";
    return `${index + 1}. ${resolution} · ${bitrate}${suffix}`;
  }
  function estimatePlaylistBytes(playlist) {
    if (!playlist) return 0;
    let total = 0;
    let hasBytes = false;
    const maps = /* @__PURE__ */ new Set();
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
  function makeDirectFilePlan(playlist) {
    if (!playlist || !playlist.segments.length || playlist.hasUnsupportedEncryption) return null;
    const items = [];
    const maps = /* @__PURE__ */ new Set();
    for (const segment of playlist.segments) {
      if (segment.key?.method && segment.key.method !== "NONE") return null;
      if (segment.map?.key?.method && segment.map.key.method !== "NONE") return null;
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
    const ranged = items.map((item) => ({ url: item.url, range: item.range }));
    ranged.sort((a, b) => a.range.offset - b.range.offset);
    let cursor = 0;
    for (const item of ranged) {
      if (item.range.offset !== cursor) return null;
      cursor += item.range.length;
    }
    return cursor > 0 ? { url: first.url, length: cursor } : null;
  }

  // src/ui.ts
  var UI_HTML = `
    <style>
      :host {
        all: initial;
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        color-scheme: dark;
      }

      *, *::before, *::after { box-sizing: border-box; }
      button, input, select { font: inherit; }
      [hidden] { display: none !important; }

      .hls-fab {
        pointer-events: auto;
        position: fixed;
        right: 14px;
        bottom: 72px;
        width: 44px;
        height: 44px;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 14px;
        background: linear-gradient(145deg, #6d5ce7, #4735bd);
        color: #fff;
        box-shadow: 0 10px 30px rgba(0,0,0,.38);
        display: grid;
        place-items: center;
        cursor: pointer;
        transition: transform .16s ease, box-shadow .16s ease, filter .16s ease;
      }
      .hls-fab:hover { transform: translateY(-1px); filter: brightness(1.08); box-shadow: 0 13px 34px rgba(0,0,0,.46); }
      .hls-fab:active { transform: translateY(0); }
      .hls-fab svg { width: 21px; height: 21px; }
      .hls-fab .badge {
        position: absolute;
        top: -4px;
        right: -4px;
        min-width: 17px;
        height: 17px;
        padding: 0 4px;
        border-radius: 999px;
        background: #00d4aa;
        color: #09251f;
        font-size: 10px;
        font-weight: 800;
        line-height: 17px;
        text-align: center;
        box-shadow: 0 2px 8px rgba(0,0,0,.35);
      }
      .hls-fab .pulse {
        position: absolute;
        inset: -5px;
        border-radius: 18px;
        border: 2px solid rgba(0,212,170,.58);
        animation: hls-pulse 1.45s ease-out infinite;
      }

      .hls-panel {
        pointer-events: auto;
        position: fixed;
        right: 14px;
        bottom: 126px;
        width: min(390px, calc(100vw - 28px));
        max-height: min(680px, calc(100vh - 146px));
        overflow: auto;
        color: #e8e8f0;
        background: rgba(18, 18, 33, .985);
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 16px;
        box-shadow: 0 22px 70px rgba(0,0,0,.58);
        backdrop-filter: blur(14px);
      }

      .hls-header {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 15px 12px;
        background: rgba(18, 18, 33, .98);
        border-bottom: 1px solid rgba(255,255,255,.08);
      }
      .hls-title { display: flex; align-items: center; gap: 9px; min-width: 0; }
      .hls-title svg { width: 20px; height: 20px; color: #9f91ff; flex: none; }
      .hls-title strong { font-size: 14px; letter-spacing: .01em; }
      .hls-version { color: #6f6f90; font-size: 10px; }
      .icon-btn {
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: #8585a5;
        cursor: pointer;
      }
      .icon-btn:hover { color: #fff; background: rgba(255,255,255,.07); }
      .icon-btn svg { width: 15px; height: 15px; }

      .hls-body { padding: 14px 15px 15px; }
      .notice {
        padding: 9px 10px;
        border: 1px solid rgba(124,92,252,.25);
        border-radius: 10px;
        background: rgba(124,92,252,.09);
        color: #b9b9ce;
        font-size: 11.5px;
        line-height: 1.55;
      }
      .notice[data-kind="success"] { border-color: rgba(0,212,170,.3); background: rgba(0,212,170,.08); color: #b8e8dc; }
      .notice[data-kind="error"] { border-color: rgba(255,82,82,.35); background: rgba(255,82,82,.09); color: #ffbaba; }
      .notice[data-kind="warning"] { border-color: rgba(255,183,77,.35); background: rgba(255,183,77,.08); color: #ead5ac; }

      .field { margin-top: 12px; }
      .field > label { display: block; margin-bottom: 6px; color: #8f8fab; font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
      select, input[type="text"] {
        width: 100%;
        min-height: 34px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 9px;
        outline: none;
        background: #1d1d36;
        color: #e8e8f0;
        padding: 7px 9px;
        font-size: 12px;
      }
      select:focus, input[type="text"]:focus { border-color: #7c5cfc; box-shadow: 0 0 0 3px rgba(124,92,252,.13); }
      select:disabled, input:disabled { opacity: .55; cursor: not-allowed; }
      option { background: #1d1d36; }

      .manual-row { display: flex; gap: 7px; }
      .manual-row input { min-width: 0; flex: 1; }
      .subtitle-controls { display: grid; grid-template-columns: minmax(0, 1fr) 92px auto; gap: 7px; }
      .subtitle-controls select, .subtitle-controls button { min-width: 0; }
      .subtitle-hint { margin-top: 6px; color: #6f6f8b; font-size: 10px; line-height: 1.55; }
      .subtitle-hint[data-kind="error"] { color: #e7a0a0; }
      .btn {
        min-height: 34px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 9px;
        padding: 7px 11px;
        background: #272744;
        color: #dadae8;
        font-size: 12px;
        font-weight: 650;
        cursor: pointer;
        white-space: nowrap;
        transition: filter .15s ease, background .15s ease, opacity .15s ease;
      }
      .btn:hover:not(:disabled) { filter: brightness(1.12); }
      .btn:disabled { opacity: .45; cursor: not-allowed; }
      .btn.primary { background: linear-gradient(145deg, #7c5cfc, #5c43d8); border-color: rgba(157,137,255,.45); color: #fff; }
      .btn.secondary { background: #22223b; color: #a9a9bf; }
      .btn.danger { background: rgba(255,82,82,.13); border-color: rgba(255,82,82,.28); color: #ff9d9d; }

      .meta {
        margin-top: 12px;
        padding: 10px;
        border-radius: 10px;
        background: rgba(255,255,255,.035);
        border: 1px solid rgba(255,255,255,.065);
      }
      .meta-main { color: #d7d7e6; font-size: 11.5px; line-height: 1.55; }
      .meta-sub { margin-top: 3px; color: #787894; font-size: 10.5px; line-height: 1.55; }
      .meta-warning { margin-top: 6px; color: #e0b86e; font-size: 10.5px; line-height: 1.5; }

      .progress-wrap { margin-top: 12px; }
      .progress-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 6px; color: #a9a9c0; font-size: 10.5px; }
      .progress-track { height: 7px; overflow: hidden; border-radius: 999px; background: #282842; }
      .progress-bar { width: 0; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #7c5cfc, #00d4aa); transition: width .12s linear; }

      .actions { display: flex; gap: 8px; margin-top: 13px; }
      .actions .btn { flex: 1; }
      .tip { margin-top: 10px; color: #62627f; font-size: 9.8px; line-height: 1.5; }

      @keyframes hls-pulse {
        0% { opacity: .9; transform: scale(.96); }
        100% { opacity: 0; transform: scale(1.22); }
      }
      @media (max-width: 480px) {
        .hls-fab { right: 9px; bottom: 58px; width: 40px; height: 40px; border-radius: 12px; }
        .hls-panel { right: 8px; bottom: 106px; width: calc(100vw - 16px); max-height: calc(100vh - 118px); }
      }
    </style>

    <button class="hls-fab" id="hls-fab" type="button" title="下载当前 HLS 视频" aria-label="打开视频下载器">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3v11"></path><path d="m7.5 10.5 4.5 4.5 4.5-4.5"></path><path d="M4 17.5v1.2A2.3 2.3 0 0 0 6.3 21h11.4a2.3 2.3 0 0 0 2.3-2.3v-1.2"></path>
      </svg>
      <span class="badge" id="hls-badge" hidden>0</span>
      <span class="pulse" id="hls-pulse" hidden></span>
    </button>

    <section class="hls-panel" id="hls-panel" hidden aria-label="HLS 视频下载器">
      <header class="hls-header">
        <div class="hls-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="3"></rect><path d="m10 9 5 3-5 3Z"></path>
          </svg>
          <strong>Canvas 视频下载器</strong>
          <span class="hls-version">HLS</span>
        </div>
        <button class="icon-btn" id="hls-close" type="button" aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>
        </button>
      </header>

      <div class="hls-body">
        <div class="notice" id="hls-notice">先点击视频播放几秒，脚本会自动捕获 m3u8。也可以直接粘贴播放列表地址。</div>

        <div class="field" id="hls-source-field" hidden>
          <label for="hls-source">检测到的视频流</label>
          <select id="hls-source"></select>
        </div>

        <div class="field" id="hls-quality-field" hidden>
          <label for="hls-quality">画质</label>
          <select id="hls-quality"></select>
        </div>

        <div class="field" id="hls-subtitle-field">
          <label for="hls-subtitle-language">字幕</label>
          <div class="subtitle-controls">
            <select id="hls-subtitle-language" aria-label="字幕语言"></select>
            <select id="hls-subtitle-format" aria-label="字幕格式">
              <option value="srt">SRT</option>
              <option value="vtt">WebVTT</option>
              <option value="txt">TXT</option>
            </select>
            <button class="btn secondary" id="hls-subtitle-download" type="button" disabled>下载字幕</button>
          </div>
          <div class="subtitle-hint" id="hls-subtitle-hint">播放视频后将自动检测字幕。</div>
        </div>

        <div class="field">
          <label for="hls-manual">手动载入 m3u8</label>
          <div class="manual-row">
            <input id="hls-manual" type="text" spellcheck="false" autocomplete="off" placeholder="https://…/master.m3u8">
            <button class="btn secondary" id="hls-load" type="button">载入</button>
          </div>
        </div>

        <div class="meta" id="hls-meta" hidden>
          <div class="meta-main" id="hls-meta-main"></div>
          <div class="meta-sub" id="hls-meta-sub"></div>
          <div class="meta-warning" id="hls-meta-warning" hidden></div>
        </div>

        <div class="progress-wrap" id="hls-progress-wrap" hidden>
          <div class="progress-head"><span id="hls-progress-text">准备中…</span><span id="hls-progress-pct"></span></div>
          <div class="progress-track"><div class="progress-bar" id="hls-progress-bar"></div></div>
        </div>

        <div class="actions">
          <button class="btn secondary" id="hls-refresh" type="button">重新扫描</button>
          <button class="btn primary" id="hls-download" type="button" disabled>下载视频</button>
          <button class="btn danger" id="hls-cancel" type="button" hidden>取消</button>
        </div>

        <div class="tip">仅用于保存你有权访问的课程资料。fMP4 输出 .mp4，MPEG-TS 输出 .ts；字幕可保存为 SRT、WebVTT 或 TXT。</div>
      </div>
    </section>`;
  function byId(root, id) {
    const element = root.getElementById(id);
    if (!element) throw new Error(`Missing UI element: ${id}`);
    return element;
  }
  function mountUi() {
    if (!document.body) return null;
    const existing = document.getElementById("canvas-hls-downloader-host");
    if (existing) {
      const shadow2 = existing.shadowRoot;
      if (!shadow2) return null;
      return readUi(existing, shadow2);
    }
    const host = document.createElement("div");
    host.id = "canvas-hls-downloader-host";
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = UI_HTML;
    document.body.appendChild(host);
    return readUi(host, shadow);
  }
  function readUi(host, shadow) {
    return {
      host,
      shadow,
      fab: byId(shadow, "hls-fab"),
      badge: byId(shadow, "hls-badge"),
      pulse: byId(shadow, "hls-pulse"),
      panel: byId(shadow, "hls-panel"),
      close: byId(shadow, "hls-close"),
      notice: byId(shadow, "hls-notice"),
      sourceField: byId(shadow, "hls-source-field"),
      source: byId(shadow, "hls-source"),
      qualityField: byId(shadow, "hls-quality-field"),
      quality: byId(shadow, "hls-quality"),
      subtitleField: byId(shadow, "hls-subtitle-field"),
      subtitleLanguage: byId(shadow, "hls-subtitle-language"),
      subtitleFormat: byId(shadow, "hls-subtitle-format"),
      subtitleDownload: byId(shadow, "hls-subtitle-download"),
      subtitleHint: byId(shadow, "hls-subtitle-hint"),
      manual: byId(shadow, "hls-manual"),
      load: byId(shadow, "hls-load"),
      meta: byId(shadow, "hls-meta"),
      metaMain: byId(shadow, "hls-meta-main"),
      metaSub: byId(shadow, "hls-meta-sub"),
      metaWarning: byId(shadow, "hls-meta-warning"),
      progressWrap: byId(shadow, "hls-progress-wrap"),
      progressText: byId(shadow, "hls-progress-text"),
      progressPct: byId(shadow, "hls-progress-pct"),
      progressBar: byId(shadow, "hls-progress-bar"),
      refresh: byId(shadow, "hls-refresh"),
      download: byId(shadow, "hls-download"),
      cancel: byId(shadow, "hls-cancel")
    };
  }

  // src/index.ts
  var VERSION = "1.1.0";
  var STORAGE_KEY = "__canvas_panopto_hls_downloader_v1__";
  var MAX_CAPTURED_STREAMS = 120;
  var MAX_CAPTURED_SUBTITLES = 40;
  var windowFlags = window;
  if (windowFlags[STORAGE_KEY]) {
  } else {
    windowFlags[STORAGE_KEY] = true;
    start();
  }
  function start() {
    const captured = /* @__PURE__ */ new Map();
    const capturedSubtitles = /* @__PURE__ */ new Map();
    const perfSeen = /* @__PURE__ */ new Set();
    const keyCache = /* @__PURE__ */ new Map();
    const state = {
      ui: null,
      panelOpen: false,
      master: null,
      variants: [],
      variantIndex: -1,
      playlist: null,
      preparedUrl: "",
      loadingToken: 0,
      busy: false,
      downloading: false,
      abortController: null,
      title: "",
      lastCaptureCount: -1,
      deliveryId: deliveryIdFromUrl(location.href),
      panoptoSubtitles: [],
      subtitleLoadedFor: "",
      subtitleLoading: false,
      subtitleError: "",
      subtitleDownloading: false,
      subtitleLoadToken: 0
    };
    let refreshTimer = 0;
    let subtitleTimer = 0;
    function noteM3u8(rawUrl, source, force = false) {
      if (!rawUrl || typeof rawUrl !== "string") return;
      const url = absoluteUrl(rawUrl);
      if (!/^https?:/i.test(url)) return;
      if (!force && !isM3u8Url(url)) return;
      const previous = captured.get(url);
      captured.set(url, {
        url,
        source: source || previous?.source || "network",
        firstSeen: previous?.firstSeen || Date.now(),
        lastSeen: Date.now()
      });
      if (captured.size > MAX_CAPTURED_STREAMS) {
        const oldest = [...captured.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
        if (oldest) captured.delete(oldest[0]);
      }
      scheduleDetectedRefresh();
    }
    function noteSubtitleUrl(rawUrl, source) {
      if (!rawUrl || !isSubtitleUrl(rawUrl)) return;
      const url = absoluteUrl(rawUrl);
      if (!/^https?:/i.test(url)) return;
      const previous = capturedSubtitles.get(url);
      capturedSubtitles.set(url, {
        url,
        source: source || previous?.source || "network",
        firstSeen: previous?.firstSeen || Date.now(),
        lastSeen: Date.now()
      });
      if (capturedSubtitles.size > MAX_CAPTURED_SUBTITLES) {
        const oldest = [...capturedSubtitles.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
        if (oldest) capturedSubtitles.delete(oldest[0]);
      }
      if (state.ui) window.setTimeout(renderSubtitleOptions, 60);
    }
    function noteDeliveryId(deliveryId) {
      if (!deliveryId || state.deliveryId === deliveryId) return;
      state.deliveryId = deliveryId;
      state.panoptoSubtitles = [];
      state.subtitleLoadedFor = "";
      state.subtitleError = "";
      if (state.ui) scheduleSubtitleRefresh(180);
    }
    function capturedUrls() {
      return [...captured.values()].sort((a, b) => b.lastSeen - a.lastSeen).map((item) => item.url);
    }
    function scheduleDetectedRefresh() {
      if (refreshTimer) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = 0;
        if (state.ui) refreshSourceOptions({ autoLoad: state.panelOpen && !state.playlist });
        updateBadge();
      }, 180);
    }
    function scheduleSubtitleRefresh(delay = 240) {
      if (subtitleTimer) return;
      subtitleTimer = window.setTimeout(() => {
        subtitleTimer = 0;
        if (state.ui) void refreshSubtitleTracks();
      }, delay);
    }
    const captureHandlers = {
      noteMediaUrl: noteM3u8,
      noteSubtitleUrl,
      noteDeliveryId
    };
    function preferredCapturedUrls() {
      const urls = capturedUrls();
      const masters = urls.filter(isLikelyMasterUrl);
      return masters.length ? masters : urls;
    }
    function setPanelOpen(open) {
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
    function setNotice(message, kind = "info") {
      if (!state.ui) return;
      state.ui.notice.textContent = message;
      state.ui.notice.dataset.kind = kind;
    }
    function setBusy(busy) {
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
    function updateBadge() {
      if (!state.ui) return;
      const count = preferredCapturedUrls().length;
      if (count === state.lastCaptureCount) return;
      state.lastCaptureCount = count;
      state.ui.badge.hidden = count === 0;
      state.ui.badge.textContent = String(Math.min(count, 99));
    }
    function refreshSourceOptions({ autoLoad = false } = {}) {
      const ui = state.ui;
      if (!ui) return;
      const urls = preferredCapturedUrls();
      const previous = ui.source.value;
      ui.source.replaceChildren();
      for (const url of urls) {
        const option = document.createElement("option");
        option.value = url;
        option.textContent = shortUrl(url, 70);
        ui.source.append(option);
      }
      ui.sourceField.hidden = urls.length === 0;
      if (urls.length && urls.includes(previous)) ui.source.value = previous;
      if (autoLoad && urls.length && !state.playlist && !state.busy && !state.downloading) {
        void loadManifest(ui.source.value || urls[0] || "", { auto: true });
      }
    }
    async function fetchText(url, signal) {
      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        ...signal ? { signal } : {}
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return { text: await response.text(), finalUrl: response.url || url, response };
    }
    async function loadManifest(url, { auto = false } = {}) {
      const ui = state.ui;
      if (!ui) return;
      if (state.downloading) {
        setNotice("请等待当前下载完成或先取消下载。", "warning");
        return;
      }
      const normalized = absoluteUrl(url);
      if (!normalized) {
        setNotice("m3u8 地址格式无效。", "error");
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
      setNotice(auto ? "已自动捕获视频，正在读取播放列表…" : "正在读取播放列表…");
      try {
        const result = await fetchText(normalized);
        if (token !== state.loadingToken) return;
        const isMaster = /^#EXT-X-STREAM-INF:/m.test(result.text);
        if (isMaster) {
          const variants = parseMasterPlaylist(result.text, result.finalUrl);
          if (!variants.length) throw new Error("主播放列表中没有可用码流");
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
          setNotice("播放列表已载入，可以开始下载。", "success");
          setBusy(false);
        }
        renderSubtitleOptions();
        scheduleSubtitleRefresh(300);
      } catch (error) {
        if (token !== state.loadingToken) return;
        console.error("[Canvas HLS] load manifest failed", error);
        setNotice(friendlyError(error, "读取播放列表失败"), "error");
        setBusy(false);
      }
    }
    function renderQualityOptions() {
      const ui = state.ui;
      if (!ui) return;
      ui.quality.replaceChildren();
      state.variants.forEach((variant, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = variantLabel(variant, index);
        ui.quality.append(option);
      });
      if (state.variantIndex >= 0) ui.quality.value = String(state.variantIndex);
      ui.quality.disabled = state.busy || state.variants.length < 2;
    }
    async function loadVariant(index, existingToken) {
      const ui = state.ui;
      const variant = state.variants[index];
      if (!ui || !variant) return;
      const token = existingToken || ++state.loadingToken;
      state.variantIndex = index;
      state.playlist = null;
      state.preparedUrl = "";
      ui.quality.value = String(index);
      setBusy(true);
      ui.download.disabled = true;
      ui.meta.hidden = true;
      setNotice(`正在读取 ${variantLabel(variant, index)}…`);
      try {
        const result = await fetchText(variant.url);
        if (token !== state.loadingToken) return;
        const playlist = parseMediaPlaylist(result.text, result.finalUrl);
        if (!playlist.segments.length) throw new Error("该码流没有可下载的分片");
        playlist.variant = variant;
        state.playlist = playlist;
        state.preparedUrl = state.master?.url || variant.url;
        state.title = getVideoTitle();
        renderPlaylistInfo(variant);
        setNotice("播放列表已载入，可以开始下载。", "success");
        setBusy(false);
      } catch (error) {
        if (token !== state.loadingToken) return;
        console.error("[Canvas HLS] load variant failed", error);
        setNotice(friendlyError(error, "读取视频码流失败"), "error");
        setBusy(false);
      }
    }
    function renderPlaylistInfo(variant = {}) {
      const ui = state.ui;
      const playlist = state.playlist;
      if (!ui || !playlist) return;
      const resolution = variant.width && variant.height ? `${variant.width}×${variant.height}` : "自适应画质";
      const bitrate = variant.bandwidth ? ` · ${(variant.bandwidth / 1e6).toFixed(2)} Mbps` : "";
      const duration = playlist.duration ? formatDuration(playlist.duration) : "时长未知";
      const estimatedBytes = estimatePlaylistBytes(playlist);
      const size = estimatedBytes ? ` · 约 ${formatBytes(estimatedBytes)}` : "";
      const plan = makeDirectFilePlan(playlist);
      ui.meta.hidden = false;
      ui.metaMain.textContent = `${resolution}${bitrate} · ${duration}${size}`;
      ui.metaSub.textContent = `${playlist.segments.length} 个分片 · 输出 .${playlist.ext}${plan ? " · 单文件加速下载" : ""}`;
      const warnings = [...playlist.warnings];
      if (variant.audioGroup && variant.codecs && !/(mp4a|ac-3|ec-3|opus|vorbis)/i.test(variant.codecs)) {
        warnings.push("该码流含独立音频组；当前版本只保存所选视频轨。");
      }
      ui.metaWarning.hidden = warnings.length === 0;
      ui.metaWarning.textContent = warnings.join(" ");
      ui.download.disabled = false;
    }
    function getSubtitleTracks() {
      const tracks = [...state.panoptoSubtitles];
      const knownUrls = /* @__PURE__ */ new Set();
      const renditions = state.master?.subtitles || [];
      renditions.forEach((rendition, index) => {
        knownUrls.add(rendition.url);
        const format = /\.srt(?:[?#]|$)/i.test(rendition.url) ? "srt" : /\.(?:vtt|webvtt)(?:[?#]|$)/i.test(rendition.url) ? "vtt" : "unknown";
        tracks.push({
          id: `hls:${index}:${rendition.url}`,
          label: rendition.name || rendition.language || `字幕 ${index + 1}`,
          languageCode: rendition.language || getLanguageCode(rendition.name),
          source: "hls",
          url: rendition.url,
          format
        });
      });
      for (const subtitle of [...capturedSubtitles.values()].sort((a, b) => b.lastSeen - a.lastSeen)) {
        if (knownUrls.has(subtitle.url)) continue;
        knownUrls.add(subtitle.url);
        tracks.push({
          id: `network:${subtitle.url}`,
          label: subtitleUrlLabel(subtitle.url),
          languageCode: "",
          source: "network",
          url: subtitle.url,
          format: /\.srt(?:[?#]|$)/i.test(subtitle.url) ? "srt" : "vtt"
        });
      }
      return tracks;
    }
    function renderSubtitleOptions() {
      const ui = state.ui;
      if (!ui) return;
      const tracks = getSubtitleTracks();
      const previous = ui.subtitleLanguage.value;
      ui.subtitleLanguage.replaceChildren();
      if (!tracks.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = state.subtitleLoading ? "正在检测字幕…" : "未检测到字幕";
        ui.subtitleLanguage.append(option);
      } else {
        for (const track of tracks) {
          const option = document.createElement("option");
          option.value = track.id;
          const source = track.source === "panopto" ? "Panopto" : track.source === "hls" ? "HLS" : "网页";
          option.textContent = `${track.label} · ${source}`;
          ui.subtitleLanguage.append(option);
        }
        ui.subtitleLanguage.value = tracks.some((track) => track.id === previous) ? previous : tracks[0]?.id || "";
      }
      const disabled = state.busy || state.downloading || state.subtitleDownloading || !tracks.length;
      ui.subtitleLanguage.disabled = disabled;
      ui.subtitleFormat.disabled = disabled;
      ui.subtitleDownload.disabled = disabled;
      ui.subtitleHint.dataset.kind = "";
      if (state.subtitleLoading && !tracks.length) {
        ui.subtitleHint.textContent = "正在读取 Panopto 字幕…";
      } else if (state.subtitleError) {
        ui.subtitleHint.textContent = state.subtitleError;
        ui.subtitleHint.dataset.kind = "error";
      } else if (tracks.length) {
        ui.subtitleHint.textContent = `已找到 ${tracks.length} 条字幕，可单独下载；视频与字幕分开保存。`;
      } else if (state.deliveryId) {
        ui.subtitleHint.textContent = "该视频没有可下载字幕。若确认有字幕，请播放几秒后点“重新扫描”。";
      } else {
        ui.subtitleHint.textContent = "暂未找到字幕。请先播放视频；若需要，打开播放器字幕设置后再扫描。";
      }
    }
    async function refreshSubtitleTracks({ force = false } = {}) {
      const ui = state.ui;
      if (!ui) return;
      const deliveryId = state.deliveryId;
      if (!force && deliveryId && state.subtitleLoadedFor === deliveryId) {
        renderSubtitleOptions();
        return;
      }
      state.subtitleError = "";
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
        state.subtitleError = "";
      } catch (error) {
        if (token !== state.subtitleLoadToken) return;
        console.error("[Canvas HLS] subtitle load failed", error);
        state.subtitleError = friendlyError(error, "读取字幕失败");
      } finally {
        if (token === state.subtitleLoadToken) {
          state.subtitleLoading = false;
          renderSubtitleOptions();
        }
      }
    }
    function triggerBlobDownload(filename, content, mime) {
      const blob = new Blob([content], { type: mime });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 6e4);
    }
    async function downloadSubtitle() {
      const ui = state.ui;
      if (!ui || state.subtitleDownloading || state.downloading || state.busy) return;
      const track = getSubtitleTracks().find((item) => item.id === ui.subtitleLanguage.value);
      if (!track) {
        setNotice("没有可下载的字幕。", "warning");
        return;
      }
      const format = ui.subtitleFormat.value;
      state.subtitleDownloading = true;
      renderSubtitleOptions();
      try {
        setNotice(`正在读取${track.label}字幕…`);
        const cues = await fetchSubtitleTrackCues(track);
        if (!cues.length) throw new Error("没有解析到字幕内容");
        track.cues = cues;
        const content = format === "vtt" ? serializeVtt(cues) : format === "txt" ? serializeTranscript(cues) : serializeSrt(cues);
        const filename = `${sanitizeFilename(state.title || getVideoTitle())}.${subtitleFilenameSuffix(track)}.${format}`;
        triggerBlobDownload(filename, content, subtitleMimeType(format));
        setNotice(`字幕已交给浏览器保存：${filename}`, "success");
      } catch (error) {
        console.error("[Canvas HLS] subtitle download failed", error);
        setNotice(friendlyError(error, "下载字幕失败"), "error");
      } finally {
        state.subtitleDownloading = false;
        renderSubtitleOptions();
      }
    }
    async function createSink(filename, mime) {
      if (typeof window.showSaveFilePicker === "function") {
        try {
          const extension = filename.endsWith(".ts") ? "ts" : "mp4";
          const options = {
            suggestedName: filename,
            types: [{
              description: extension === "ts" ? "MPEG-TS 视频" : "MP4 视频",
              accept: extension === "ts" ? { "video/mp2t": [".ts"] } : { "video/mp4": [".mp4"] }
            }]
          };
          const handle = await window.showSaveFilePicker(options);
          const writable = await handle.createWritable();
          return {
            kind: "file",
            write: async (data) => {
              await writable.write(data);
            },
            close: () => writable.close(),
            abort: () => writable.abort()
          };
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") throw error;
          console.warn("[Canvas HLS] File System Access unavailable, falling back to memory", error);
        }
      }
      const parts = [];
      return {
        kind: "memory",
        write: async (data) => {
          parts.push(data);
        },
        close: async () => {
          triggerBlobDownload(filename, new Blob(parts, { type: mime || "application/octet-stream" }), mime || "application/octet-stream");
          parts.length = 0;
        },
        abort: async () => {
          parts.length = 0;
        }
      };
    }
    async function startDownload() {
      const ui = state.ui;
      const playlist = state.playlist;
      if (!ui || !playlist || state.downloading) return;
      if (playlist.hasUnsupportedEncryption) {
        setNotice("该视频使用了不支持的加密方式，无法下载。", "error");
        return;
      }
      if (!playlist.segments.length) {
        setNotice("没有可下载的分片。", "error");
        return;
      }
      const directPlan = makeDirectFilePlan(playlist);
      const extension = playlist.ext === "ts" ? "ts" : "mp4";
      const filename = `${sanitizeFilename(state.title || getVideoTitle() || "video")}.${extension}`;
      let sink;
      try {
        sink = await createSink(filename, playlist.mime);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("[Canvas HLS] create sink failed", error);
          setNotice("无法创建输出文件。", "error");
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
      setNotice("正在下载…", "info");
      try {
        if (directPlan) {
          await downloadDirectFile(directPlan, sink, state.abortController.signal);
        } else {
          await downloadSegments(playlist, sink, state.abortController.signal);
        }
        await sink.close();
        if (sink.kind === "memory") {
          setNotice(`已在内存中合成 ${filename}，浏览器已开始保存。`, "success");
          ui.progressText.textContent = "已交给浏览器保存";
        } else {
          setNotice(`下载完成：${filename}`, "success");
          ui.progressText.textContent = "下载完成";
        }
        ui.progressPct.textContent = "100%";
        ui.progressBar.style.width = "100%";
      } catch (error) {
        console.error("[Canvas HLS] download failed", error);
        try {
          await sink.abort();
        } catch (abortError) {
          console.debug("[Canvas HLS] sink abort failed", abortError);
        }
        if (error instanceof DOMException && error.name === "AbortError") {
          setNotice("下载已取消。", "warning");
          ui.progressText.textContent = "已取消";
        } else {
          setNotice(friendlyError(error, "下载失败"), "error");
          ui.progressText.textContent = "下载失败";
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
    function cancelDownload() {
      state.abortController?.abort();
    }
    async function downloadDirectFile(plan, sink, signal) {
      const response = await fetch(plan.url, {
        credentials: "include",
        headers: { Range: `bytes=0-${Math.max(0, plan.length - 1)}` },
        signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      if (!response.body || typeof response.body.getReader !== "function") {
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
        }
      }
      if (received < plan.length) {
        throw new Error(`下载不完整：${formatBytes(received)} / ${formatBytes(plan.length)}`);
      }
    }
    async function downloadSegments(playlist, sink, signal) {
      const totalBytes = estimatePlaylistBytes(playlist);
      const totalSegments = playlist.segments.length;
      let writtenBytes = 0;
      let doneSegments = 0;
      let lastMap = null;
      for (const segment of playlist.segments) {
        if (signal.aborted) throw new DOMException("Download cancelled", "AbortError");
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
          `${doneSegments}/${totalSegments} 分片 · ${formatBytes(writtenBytes)}`
        );
      }
    }
    async function fetchMediaItem(item, signal) {
      const headers = {};
      if (item.range) {
        const start2 = item.range.offset;
        const end = start2 + item.range.length - 1;
        headers.Range = `bytes=${start2}-${end}`;
      }
      let lastError;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch(item.url, {
            credentials: "include",
            headers,
            signal
          });
          if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
          const buffer = new Uint8Array(await response.arrayBuffer());
          if (item.range && buffer.byteLength !== item.range.length) {
            if (response.status === 206) {
              throw new Error(`分片长度不符：期望 ${item.range.length}，实际 ${buffer.byteLength}`);
            }
            const start2 = item.range.offset;
            const end = start2 + item.range.length;
            if (buffer.byteLength >= end) return buffer.subarray(start2, end);
            throw new Error("服务器未正确处理 Range 请求");
          }
          return buffer;
        } catch (error) {
          lastError = error;
          if (error instanceof DOMException && error.name === "AbortError") throw error;
          if (attempt === 2) throw error;
          await sleep(350 * (attempt + 1));
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError || "分片下载失败"));
    }
    async function decryptIfNeeded(data, keyInfo, sequence) {
      if (!keyInfo?.method || keyInfo.method === "NONE") return data;
      if (keyInfo.method !== "AES-128" || keyInfo.unsupported) {
        throw new Error(keyInfo.reason || `不支持 ${keyInfo.method} 加密`);
      }
      if (!keyInfo.url) throw new Error("AES-128 密钥地址无效");
      let keyBytes = keyCache.get(keyInfo.url);
      if (!keyBytes) {
        const response = await fetch(keyInfo.url, { credentials: "include" });
        if (!response.ok) throw new Error(`读取 AES-128 密钥失败：HTTP ${response.status}`);
        keyBytes = new Uint8Array(await response.arrayBuffer());
        if (keyBytes.byteLength !== 16) throw new Error("AES-128 密钥长度无效");
        keyCache.set(keyInfo.url, keyBytes);
      }
      const iv = keyInfo.iv ? parseIv(keyInfo.iv) : sequenceToIv(sequence);
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "AES-CBC" },
        false,
        ["decrypt"]
      );
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-CBC", iv },
        cryptoKey,
        data
      );
      return new Uint8Array(plaintext);
    }
    function parseIv(value) {
      let hex = String(value).trim().replace(/^0x/i, "");
      if (hex.length % 2) hex = `0${hex}`;
      if (hex.length > 32) hex = hex.slice(-32);
      if (hex.length < 32) hex = hex.padStart(32, "0");
      if (!/^[0-9a-f]+$/i.test(hex)) throw new Error("AES IV 格式无效");
      const bytes = new Uint8Array(16);
      for (let index = 0; index < 16; index += 1) {
        bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
      }
      return bytes;
    }
    function sequenceToIv(sequence) {
      const iv = new Uint8Array(16);
      let value = BigInt(Math.max(0, Number(sequence) || 0));
      for (let index = 15; index >= 8; index -= 1) {
        iv[index] = Number(value & 0xffn);
        value >>= 8n;
      }
      return iv;
    }
    function reportProgress(current, total, detail = "") {
      const ui = state.ui;
      if (!ui) return;
      const ratio = total > 0 ? Math.min(1, current / total) : 0;
      const percent = Math.round(ratio * 100);
      ui.progressBar.style.width = `${ratio * 100}%`;
      ui.progressPct.textContent = total > 0 ? `${percent}%` : "";
      if (detail) ui.progressText.textContent = detail;
      else if (total > 0) ui.progressText.textContent = `${formatBytes(current)} / ${formatBytes(total)}`;
    }
    function wireUi(ui) {
      ui.fab.addEventListener("click", () => setPanelOpen(!state.panelOpen));
      ui.close.addEventListener("click", () => setPanelOpen(false));
      ui.refresh.addEventListener("click", () => {
        harvestPerformanceEntries(captureHandlers, perfSeen);
        harvestTrackElements(captureHandlers);
        const streams = preferredCapturedUrls();
        const masters = streams.filter(isLikelyMasterUrl);
        if (streams.length) {
          const detail = masters.length ? `已捕获 ${masters.length} 个主播放列表（共 ${captured.size} 个 m3u8 请求）。` : `已捕获 ${streams.length} 个 m3u8 地址。`;
          setNotice(detail, "info");
        } else {
          setNotice("暂未捕获到 m3u8；请先在页面中播放视频。", "warning");
        }
        refreshSourceOptions({ autoLoad: !state.playlist });
        void refreshSubtitleTracks({ force: true });
      });
      ui.load.addEventListener("click", () => {
        const value = ui.manual.value.trim();
        if (!value) {
          setNotice("请先粘贴 m3u8 地址。", "warning");
          ui.manual.focus();
          return;
        }
        noteM3u8(value, "manual", true);
        void loadManifest(value, { userInitiated: true });
      });
      ui.manual.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          ui.load.click();
        }
      });
      ui.source.addEventListener("change", () => {
        if (ui.source.value) void loadManifest(ui.source.value, { userInitiated: true });
      });
      ui.quality.addEventListener("change", () => {
        void loadVariant(Number(ui.quality.value));
      });
      ui.download.addEventListener("click", () => {
        void startDownload();
      });
      ui.cancel.addEventListener("click", cancelDownload);
      ui.subtitleDownload.addEventListener("click", () => {
        void downloadSubtitle();
      });
      ui.subtitleLanguage.addEventListener("change", () => {
        ui.subtitleHint.dataset.kind = "";
      });
    }
    function ensureUi() {
      if (state.ui) return;
      const ui = mountUi();
      if (!ui) {
        document.addEventListener("DOMContentLoaded", ensureUi, { once: true });
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
    window.setTimeout(() => harvestPerformanceEntries(captureHandlers, perfSeen), 1500);
    window.setTimeout(() => harvestTrackElements(captureHandlers), 1500);
    window.setInterval(() => {
      noteDeliveryId(deliveryIdFromUrl(location.href));
      harvestPerformanceEntries(captureHandlers, perfSeen);
      harvestTrackElements(captureHandlers);
    }, 5e3);
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
      open: () => setPanelOpen(true)
    };
  }
})();
