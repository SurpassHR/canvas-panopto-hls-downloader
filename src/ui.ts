export const UI_HTML = `
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

export interface UiRefs {
  host: HTMLDivElement;
  shadow: ShadowRoot;
  fab: HTMLButtonElement;
  badge: HTMLSpanElement;
  pulse: HTMLSpanElement;
  panel: HTMLElement;
  close: HTMLButtonElement;
  notice: HTMLDivElement;
  sourceField: HTMLDivElement;
  source: HTMLSelectElement;
  qualityField: HTMLDivElement;
  quality: HTMLSelectElement;
  subtitleField: HTMLDivElement;
  subtitleLanguage: HTMLSelectElement;
  subtitleFormat: HTMLSelectElement;
  subtitleDownload: HTMLButtonElement;
  subtitleHint: HTMLDivElement;
  manual: HTMLInputElement;
  load: HTMLButtonElement;
  meta: HTMLDivElement;
  metaMain: HTMLDivElement;
  metaSub: HTMLDivElement;
  metaWarning: HTMLDivElement;
  progressWrap: HTMLDivElement;
  progressText: HTMLSpanElement;
  progressPct: HTMLSpanElement;
  progressBar: HTMLDivElement;
  refresh: HTMLButtonElement;
  download: HTMLButtonElement;
  cancel: HTMLButtonElement;
}

function byId<T extends HTMLElement>(root: ShadowRoot, id: string): T {
  const element = root.getElementById(id);
  if (!element) throw new Error(`Missing UI element: ${id}`);
  return element as T;
}

export function mountUi(): UiRefs | null {
  if (!document.body) return null;
  const existing = document.getElementById('canvas-hls-downloader-host');
  if (existing) {
    const shadow = existing.shadowRoot;
    if (!shadow) return null;
    return readUi(existing as HTMLDivElement, shadow);
  }

  const host = document.createElement('div');
  host.id = 'canvas-hls-downloader-host';
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = UI_HTML;
  document.body.appendChild(host);
  return readUi(host, shadow);
}

function readUi(host: HTMLDivElement, shadow: ShadowRoot): UiRefs {
  return {
    host,
    shadow,
    fab: byId<HTMLButtonElement>(shadow, 'hls-fab'),
    badge: byId<HTMLSpanElement>(shadow, 'hls-badge'),
    pulse: byId<HTMLSpanElement>(shadow, 'hls-pulse'),
    panel: byId<HTMLElement>(shadow, 'hls-panel'),
    close: byId<HTMLButtonElement>(shadow, 'hls-close'),
    notice: byId<HTMLDivElement>(shadow, 'hls-notice'),
    sourceField: byId<HTMLDivElement>(shadow, 'hls-source-field'),
    source: byId<HTMLSelectElement>(shadow, 'hls-source'),
    qualityField: byId<HTMLDivElement>(shadow, 'hls-quality-field'),
    quality: byId<HTMLSelectElement>(shadow, 'hls-quality'),
    subtitleField: byId<HTMLDivElement>(shadow, 'hls-subtitle-field'),
    subtitleLanguage: byId<HTMLSelectElement>(shadow, 'hls-subtitle-language'),
    subtitleFormat: byId<HTMLSelectElement>(shadow, 'hls-subtitle-format'),
    subtitleDownload: byId<HTMLButtonElement>(shadow, 'hls-subtitle-download'),
    subtitleHint: byId<HTMLDivElement>(shadow, 'hls-subtitle-hint'),
    manual: byId<HTMLInputElement>(shadow, 'hls-manual'),
    load: byId<HTMLButtonElement>(shadow, 'hls-load'),
    meta: byId<HTMLDivElement>(shadow, 'hls-meta'),
    metaMain: byId<HTMLDivElement>(shadow, 'hls-meta-main'),
    metaSub: byId<HTMLDivElement>(shadow, 'hls-meta-sub'),
    metaWarning: byId<HTMLDivElement>(shadow, 'hls-meta-warning'),
    progressWrap: byId<HTMLDivElement>(shadow, 'hls-progress-wrap'),
    progressText: byId<HTMLSpanElement>(shadow, 'hls-progress-text'),
    progressPct: byId<HTMLSpanElement>(shadow, 'hls-progress-pct'),
    progressBar: byId<HTMLDivElement>(shadow, 'hls-progress-bar'),
    refresh: byId<HTMLButtonElement>(shadow, 'hls-refresh'),
    download: byId<HTMLButtonElement>(shadow, 'hls-download'),
    cancel: byId<HTMLButtonElement>(shadow, 'hls-cancel'),
  };
}
