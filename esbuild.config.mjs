import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const banner = `// ==UserScript==
// @name         Canvas 课程视频下载器（Panopto HLS + 字幕）
// @namespace    https://github.com/SurpassHR/canvas-panopto-hls-downloader
// @version      ${pkg.version}
// @description  自动捕获 Canvas 内嵌 Panopto 播放器加载的 HLS，并下载视频及 SRT/VTT/TXT 字幕。
// @author       Codex
// @match        https://*.panopto.eu/*
// @match        https://*.panopto.com/*
// @match        https://*.panoptocloud.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
`;

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'canvas-panopto-hls-downloader.user.js',
  format: 'iife',
  platform: 'browser',
  target: ['chrome100', 'firefox100', 'safari15'],
  charset: 'utf8',
  legalComments: 'none',
  minify: false,
  banner: { js: banner },
  define: { __VERSION__: JSON.stringify(pkg.version) },
});
