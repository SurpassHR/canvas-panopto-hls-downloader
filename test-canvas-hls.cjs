const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const SCRIPT = fs.readFileSync(path.join(__dirname, 'canvas-panopto-hls-downloader.user.js'), 'utf8');
const MASTER =
  '#EXTM3U\n' +
  '#EXT-X-STREAM-INF:BANDWIDTH=900000,AVERAGE-BANDWIDTH=800000,RESOLUTION=1280x720,CODECS="avc1.4d002a,mp4a.40.2"\n' +
  '720/index.m3u8\n' +
  '#EXT-X-STREAM-INF:BANDWIDTH=400000,AVERAGE-BANDWIDTH=350000,RESOLUTION=640x360,CODECS="avc1.4d002a,mp4a.40.2"\n' +
  '360/index.m3u8\n';
const MEDIA =
  '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:10\n#EXT-X-PLAYLIST-TYPE:VOD\n' +
  '#EXT-X-MAP:URI="fragmented.mp4",BYTERANGE="4@0"\n' +
  '#EXTINF:4.0,\n#EXT-X-BYTERANGE:8@4\nfragmented.mp4\n' +
  '#EXTINF:4.0,\n#EXT-X-BYTERANGE:6@12\nfragmented.mp4\n' +
  '#EXT-X-ENDLIST\n';
const VIDEO = Buffer.from('INITAAAABBBBCCCCDD');
const AES_KEY = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const AES_IV = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
const AES_PLAINTEXT_1 = Buffer.from('hello aes segment one');
const AES_PLAINTEXT_2 = Buffer.from('hello aes segment two');
function aesEncrypt(plaintext) {
  const cipher = crypto.createCipheriv('aes-128-cbc', AES_KEY, AES_IV);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}
const AES_CIPHERTEXT_1 = aesEncrypt(AES_PLAINTEXT_1);
const AES_CIPHERTEXT_2 = aesEncrypt(AES_PLAINTEXT_2);
const AES_MEDIA =
  '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:7\n#EXT-X-PLAYLIST-TYPE:VOD\n' +
  '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x000102030405060708090a0b0c0d0e0f\n' +
  '#EXTINF:2.0,\nseg1.ts\n#EXTINF:2.0,\nseg2.ts\n#EXT-X-ENDLIST\n';
let sawRange = '';
const CAPTIONS = {
  0: [
    { Time: 0.36, Caption: 'Hello <b>world</b>', CaptionDuration: 2 },
    { Time: 3, Caption: 'A second subtitle line', CaptionDuration: 1.5 },
  ],
  8: [{ Time: 0, Caption: '中文字幕内容', CaptionDuration: 2 }],
};

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url?.startsWith('/Panopto/Pages/Viewer.aspx')) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(
      '<!doctype html><html><head><title>week7_1 - Audio playing</title></head><body><h1>week7_1</h1><p>fixture</p></body></html>',
    );
    return;
  }
  if (req.url?.startsWith('/Panopto/Pages/Viewer/DeliveryInfo.aspx')) {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const params = new URLSearchParams(body);
      res.setHeader('content-type', 'application/json; charset=utf-8');
      if (params.get('getCaptions') === 'true') {
        res.end(JSON.stringify(CAPTIONS[Number(params.get('language'))] || []));
        return;
      }
      res.end(JSON.stringify({ Delivery: { AvailableCaptions: [{ Language: 0 }, { Language: 8 }] } }));
    });
    return;
  }
  if (req.url === '/master.m3u8') {
    res.setHeader('content-type', 'application/x-mpegURL');
    res.end(MASTER);
    return;
  }
  if (req.url === '/720/index.m3u8' || req.url === '/360/index.m3u8') {
    res.setHeader('content-type', 'application/x-mpegURL');
    res.end(MEDIA);
    return;
  }
  if (req.url === '/720/fragmented.mp4' || req.url === '/360/fragmented.mp4') {
    const range = req.headers.range || '';
    sawRange = range;
    const match = range.match(/bytes=(\d+)-(\d+)/);
    if (match) {
      const start = Number(match[1]);
      const end = Number(match[2]);
      const chunk = VIDEO.subarray(start, end + 1);
      res.statusCode = 206;
      res.setHeader('content-range', `bytes ${start}-${end}/${VIDEO.length}`);
      res.setHeader('content-length', String(chunk.length));
      res.end(chunk);
      return;
    }
    res.setHeader('content-length', String(VIDEO.length));
    res.end(VIDEO);
    return;
  }
  if (req.url === '/aes/master.m3u8') {
    res.setHeader('content-type', 'application/x-mpegURL');
    res.end(
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000,RESOLUTION=320x180,CODECS="avc1.42e01e,mp4a.40.2"\nindex.m3u8\n',
    );
    return;
  }
  if (req.url === '/aes/index.m3u8') {
    res.setHeader('content-type', 'application/x-mpegURL');
    res.end(AES_MEDIA);
    return;
  }
  if (req.url === '/aes/key.bin') {
    res.end(AES_KEY);
    return;
  }
  if (req.url === '/aes/seg1.ts') {
    res.end(AES_CIPHERTEXT_1);
    return;
  }
  if (req.url === '/aes/seg2.ts') {
    res.end(AES_CIPHERTEXT_2);
    return;
  }
  res.statusCode = 404;
  res.end('not found');
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
  });
  await page.goto(`http://127.0.0.1:${port}/Panopto/Pages/Viewer.aspx?id=fixture-delivery`);
  await page.evaluate(() => fetch('/master.m3u8').then((r) => r.text()));
  await page.addScriptTag({ content: SCRIPT });
  await page.waitForFunction(() => window.__CANVAS_HLS_DOWNLOADER__?.version === '1.1.0');
  await page.evaluate(() => window.__CANVAS_HLS_DOWNLOADER__.open());
  await page.waitForFunction(() => {
    const host = document.querySelector('#canvas-hls-downloader-host');
    const main = host?.shadowRoot?.getElementById('hls-meta-main')?.textContent || '';
    return main.includes('1280×720');
  });
  await page.waitForFunction(() => {
    const host = document.querySelector('#canvas-hls-downloader-host');
    const select = host?.shadowRoot?.getElementById('hls-subtitle-language');
    return select && [...select.options].some((option) => option.value === 'panopto:0');
  });

  const snapshot = await page.evaluate(() => {
    const root = document.querySelector('#canvas-hls-downloader-host').shadowRoot;
    return {
      meta: root.getElementById('hls-meta-main').textContent,
      detail: root.getElementById('hls-meta-sub').textContent,
      quality: [...root.getElementById('hls-quality').options].map((option) => option.textContent),
      downloadDisabled: root.getElementById('hls-download').disabled,
      subtitles: [...root.getElementById('hls-subtitle-language').options].map((option) => option.textContent),
      subtitleHint: root.getElementById('hls-subtitle-hint').textContent,
    };
  });
  await page.screenshot({ path: '/tmp/canvas-hls-ui.png', fullPage: false });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.evaluate(() => {
      const root = document.querySelector('#canvas-hls-downloader-host').shadowRoot;
      root.getElementById('hls-download').click();
    }),
  ]);
  const downloadPath = await download.path();
  const downloaded = fs.readFileSync(downloadPath);

  const [subtitleDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.evaluate(() => {
      const root = document.querySelector('#canvas-hls-downloader-host').shadowRoot;
      root.getElementById('hls-subtitle-language').value = 'panopto:0';
      root.getElementById('hls-subtitle-format').value = 'srt';
      root.getElementById('hls-subtitle-download').click();
    }),
  ]);
  const subtitleText = fs.readFileSync(await subtitleDownload.path(), 'utf8');

  const parserChecks = await page.evaluate(
    ({ media }) => {
      const api = window.__CANVAS_HLS_DOWNLOADER__;
      const parsed = api.parseMediaPlaylist(media, 'https://example.test/720/index.m3u8');
      const plan = api.makeDirectFilePlan(parsed);
      const hlsSubtitles = api.parseSubtitleRenditions(
        '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="subs/en.m3u8"\n',
        'https://example.test/master.m3u8',
      );
      return {
        segments: parsed.segments.length,
        duration: parsed.duration,
        ext: parsed.ext,
        directLength: plan?.length || 0,
        estimated: api.estimatePlaylistBytes(parsed),
        hlsSubtitles,
        ranges: parsed.segments.map((segment) => ({ ...segment.range, seq: segment.sequence })),
      };
    },
    { media: MEDIA },
  );
  const subtitleChecks = await page.evaluate(() => {
    const api = window.__CANVAS_HLS_DOWNLOADER__;
    const cues = api.parseWebVtt('WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello <b>there</b>\n');
    return {
      cues,
      srt: api.serializeSrt(cues),
      vtt: api.serializeVtt(cues),
    };
  });

  console.log(
    JSON.stringify(
      {
        snapshot,
        sawRange,
        downloadedHex: downloaded.toString('hex'),
        downloadedLength: downloaded.length,
        parserChecks,
        subtitleDownload: subtitleDownload.suggestedFilename(),
        subtitleText,
        subtitleChecks,
      },
      null,
      2,
    ),
  );

  if (!snapshot.meta.includes('1280×720')) throw new Error('quality metadata missing');
  if (snapshot.downloadDisabled) throw new Error('download button disabled');
  if (!snapshot.subtitles.some((text) => text.includes('English (United States)'))) {
    throw new Error('Panopto caption language missing');
  }
  if (!download.suggestedFilename().endsWith('.mp4')) throw new Error('wrong filename');
  if (!downloaded.equals(VIDEO)) throw new Error('downloaded bytes mismatch');
  if (sawRange !== 'bytes=0-17') throw new Error(`unexpected range header: ${sawRange}`);
  if (parserChecks.directLength !== 18) throw new Error('direct plan length mismatch');
  if (parserChecks.estimated !== 18) throw new Error('estimated byte count mismatch');
  if (parserChecks.hlsSubtitles[0]?.url !== 'https://example.test/subs/en.m3u8') {
    throw new Error('HLS subtitle rendition parsing mismatch');
  }
  if (!subtitleDownload.suggestedFilename().endsWith('.en-US.srt')) throw new Error('wrong subtitle filename');
  if (!subtitleText.includes('00:00:00,360 --> 00:00:02,360\nHello world')) {
    throw new Error('SRT cue conversion mismatch');
  }
  if (!subtitleChecks.srt.includes('Hello there') || !subtitleChecks.vtt.startsWith('WEBVTT')) {
    throw new Error('WebVTT parser/serializer mismatch');
  }

  await page.waitForFunction(() => {
    const root = document.querySelector('#canvas-hls-downloader-host').shadowRoot;
    return !root.getElementById('hls-download').hidden && root.getElementById('hls-progress-text').textContent.includes('已交给');
  });
  await page.evaluate(({ url }) => {
    const root = document.querySelector('#canvas-hls-downloader-host').shadowRoot;
    root.getElementById('hls-manual').value = url;
    root.getElementById('hls-load').click();
  }, { url: `http://127.0.0.1:${port}/aes/master.m3u8` });
  await page.waitForFunction(() => {
    const root = document.querySelector('#canvas-hls-downloader-host').shadowRoot;
    return root.getElementById('hls-meta-sub').textContent.includes('.ts');
  });

  const aesSnapshot = await page.evaluate(() => {
    const root = document.querySelector('#canvas-hls-downloader-host').shadowRoot;
    return {
      meta: root.getElementById('hls-meta-main').textContent,
      detail: root.getElementById('hls-meta-sub').textContent,
      notice: root.getElementById('hls-notice').textContent,
    };
  });
  const [aesDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.evaluate(() => {
      const root = document.querySelector('#canvas-hls-downloader-host').shadowRoot;
      root.getElementById('hls-download').click();
    }),
  ]);
  const aesDownloaded = fs.readFileSync(await aesDownload.path());
  const expectedAes = Buffer.concat([AES_PLAINTEXT_1, AES_PLAINTEXT_2]);
  console.log(JSON.stringify({ aesSnapshot, aesDownloaded: aesDownloaded.toString(), expectedAes: expectedAes.toString() }, null, 2));
  if (!aesDownload.suggestedFilename().endsWith('.ts')) throw new Error('AES download should be .ts');
  if (!aesDownloaded.equals(expectedAes)) throw new Error('AES decrypt/download mismatch');

  await browser.close();
  server.close();
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
