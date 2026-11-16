const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const masterUrl = process.env.REAL_MASTER_URL;
if (!masterUrl) {
  console.error('Set REAL_MASTER_URL to a live Panopto master.m3u8 URL.');
  process.exit(1);
}

const SCRIPT = fs.readFileSync(path.join(__dirname, 'canvas-panopto-hls-downloader.user.js'), 'utf8');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Keep the browser security origin identical to a real Panopto page so the
  // signed CloudFront manifest can enforce its normal CORS policy.
  await page.route('https://bham.cloud.panopto.eu/__hls_test__', async (route) => {
    await route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><head><title>week7_1</title></head><body><h1>week7_1</h1></body></html>',
    });
  });
  await page.goto('https://bham.cloud.panopto.eu/__hls_test__');
  await page.addScriptTag({ content: SCRIPT });
  await page.waitForFunction(() => window.__CANVAS_HLS_DOWNLOADER__?.version === '1.1.0');

  await page.evaluate(async (url) => {
    await window.__CANVAS_HLS_DOWNLOADER__.loadManifest(url, { userInitiated: true });
  }, masterUrl);
  const uiState = await page.evaluate(() => {
    window.__CANVAS_HLS_DOWNLOADER__.open();
    const root = document.querySelector('#canvas-hls-downloader-host').shadowRoot;
    return {
      meta: root.getElementById('hls-meta-main').textContent,
      detail: root.getElementById('hls-meta-sub').textContent,
      notice: root.getElementById('hls-notice').textContent,
      qualities: [...root.getElementById('hls-quality').options].map((option) => option.textContent),
    };
  });

  const result = await page.evaluate(async (url) => {
    const api = window.__CANVAS_HLS_DOWNLOADER__;
    const masterResponse = await fetch(url, { credentials: 'include' });
    if (!masterResponse.ok) throw new Error(`master HTTP ${masterResponse.status}`);
    const masterText = await masterResponse.text();
    const variants = api.parseMasterPlaylist(masterText, masterResponse.url || url);
    if (!variants.length) throw new Error('no variants');
    const mediaResponse = await fetch(variants[0].url, { credentials: 'include' });
    if (!mediaResponse.ok) throw new Error(`media HTTP ${mediaResponse.status}`);
    const mediaText = await mediaResponse.text();
    const playlist = api.parseMediaPlaylist(mediaText, mediaResponse.url || variants[0].url);
    const plan = api.makeDirectFilePlan(playlist);
    const rangeResponse = await fetch(playlist.segments[0].url, {
      credentials: 'include',
      headers: { Range: 'bytes=0-1023' },
    });
    const rangeBytes = new Uint8Array(await rangeResponse.arrayBuffer());
    return {
      variantCount: variants.length,
      firstVariant: variants[0],
      segmentCount: playlist.segments.length,
      duration: playlist.duration,
      estimatedBytes: api.estimatePlaylistBytes(playlist),
      directLength: plan?.length || 0,
      ext: playlist.ext,
      warnings: playlist.warnings,
      firstSegment: playlist.segments[0],
      rangeProbe: {
        status: rangeResponse.status,
        bytes: rangeBytes.byteLength,
        signature: new TextDecoder().decode(rangeBytes.subarray(4, 12)),
      },
    };
  }, masterUrl);

  console.log(JSON.stringify({ uiState, result }, null, 2));
  if (result.variantCount < 1) throw new Error('expected at least one variant');
  if (result.segmentCount < 1) throw new Error('expected at least one segment');
  if (result.directLength !== result.estimatedBytes) throw new Error('direct plan and byte estimate disagree');
  if (result.rangeProbe.status !== 206) throw new Error(`unexpected range status ${result.rangeProbe.status}`);
  if (result.rangeProbe.bytes !== 1024) throw new Error('unexpected range response size');
  if (result.rangeProbe.signature !== 'ftypiso5') throw new Error('unexpected MP4 signature');
  if (!uiState.meta.includes('1280×720')) throw new Error('UI metadata was not populated');
  if (!uiState.detail.includes('单文件加速下载')) throw new Error('UI did not detect direct download plan');
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
