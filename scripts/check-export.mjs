/* Export-fidelity regression harness (plan 006, phase 0).
   Boots the real editor with a seeded draft across 5 theme/layout combos, runs the
   real captureCardBlob, and asserts the three properties that regressed:
     1. font drift   — card fonts must rasterize at live metrics (<2% width drift)
     2. geometry     — captured grid rows + grid height must equal live, every frame
     3. dimensions   — blob pixels must equal the download-name label
   Run: npm run check:export   (needs a Chromium/Chrome/Edge install)
   Writes the first combo's PNG to %TEMP%\opencode\cf-after-export.png (CF_EXPORT_OUT
   overrides) for visual diffing against the pre-fix cf-before-export.png. */

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = 3100;
/* CF_BASE=https://staging--cardforge-showcase.netlify.app verifies a deployed build
   instead of the working tree (skips the local static server) */
const BASE = (process.env.CF_BASE || '').replace(/\/+$/, '') || null;
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\\/, '');
    const file = join(ROOT, path === '/' || path === '' ? 'index.html' : path);
    const buf = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('nope'); }
});
if (!BASE) {
  await new Promise(ok => server.listen(PORT, ok));
} else {
  server.close();
}

let browser;
for (const opts of [{ channel: 'chrome' }, { channel: 'msedge' }, {}]) {
  try { browser = await chromium.launch({ headless: true, ...opts }); break; } catch { /* next */ }
}
if (!browser) { console.error('check:export — no Chromium/Chrome/Edge found for playwright-core'); process.exit(2); }

/* hermetic icons: same-origin data URIs, 4:1 like real displayicons, so the
   layout math runs for real without any network dependency */
const icon = (w, h, fill) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect x="4" y="${h / 2 - 6}" width="${w - 8}" height="12" rx="3" fill="${fill}"/><rect x="${w / 2 - 10}" y="${h / 2 - 14}" width="26" height="28" rx="4" fill="${fill}" opacity=".7"/></svg>`);
const skin = (id, weapon, name, tier, level, fill) => ({ id, weapon, name, tier, level, icon: icon(800, 200, fill) });

const draft = {
  theme: 'protocol', layout: 'auto', showAllCards: false,
  texts: {
    code: 'K486', vlogin: 'Jackson#QwQ', prems: '23', limited: '01', semis: '00', anims: '19',
    wtr: 'WTR: YES', receipts: 'RECEIPTS: YES', owner: '0TH OWNER',
    cname: 'CHANGE NAME', cstatus: 'NOT READY', date: '2/6/2026',
    premier: 'PREMIER', vlink: 'UNLINKED', price: 'PRICE 12',
    crank: 'DIAMOND 2', prank: 'IMMORTAL 3', level: '180', vp: '105', rp: '0', kc: '6422'
  },
  ranks: { crank: icon(64, 64, '#4aa8ff'), prank: icon(64, 64, '#b44bf0') },
  picks: {
    Sidearms: [skin(1, 'Sheriff', 'A', 'exclusive', 4, '#c9a227'), skin(2, 'Ghost', 'B', 'premium', 4, '#d8d8d8'), skin(3, 'Sheriff', 'C', 'ultra', 4, '#e8a7c8'), skin(4, 'Shorty', 'D', 'select', 4, '#8a6a4f')],
    SMGs: [],
    Shotguns: [skin(5, 'Judge', 'E', 'exclusive', 4, '#c9a227'), skin(6, 'Bucky', 'F', 'ultra', 4, '#e8a7c8')],
    Rifles: [skin(7, 'Vandal', 'G', 'exclusive', 4, '#c9a227'), skin(8, 'Phantom', 'H', 'premium', 4, '#d8d8d8'), skin(9, 'Vandal', 'I', 'select', 4, '#7a8450'), skin(10, 'Vandal', 'J', 'deluxe', 4, '#3fae8c'), skin(11, 'Phantom', 'K', 'ultra', 4, '#e8a7c8'), skin(12, 'Guardian', 'L', 'select', 4, '#6b4a2f')],
    'Sniper Rifles': [skin(13, 'Operator', 'M', 'exclusive', 4, '#3b53d8'), skin(14, 'Marshal', 'N', 'ultra', 4, '#e8a7c8')],
    'Machine Guns': [skin(15, 'Odin', 'O', 'exclusive', 4, '#c9a227')],
    Melees: [skin(16, 'Knife', 'P', 'exclusive', 2, '#5b5b5b'), skin(17, 'Sword', 'Q', 'deluxe', 2, '#c9a227'), skin(18, 'Knife', 'R', 'ultra', 2, '#d8b12f'), skin(19, 'Sword', 'S', 'premium', 2, '#e8a7c8'), skin(20, 'Knife', 'T', 'select', 2, '#cfd6dd'), skin(21, 'Knife', 'U', 'deluxe', 2, '#58c14a'), skin(22, 'Sword', 'V', 'select', 2, '#8f98a3'), skin(23, 'Knife', 'W', 'premium', 2, '#4a5560')],
    Flex: []
  },
  assets: { avatar: null, pcard: null, buddies: [] }, owned: {}
};

/* runs in the page against the real shared.js capture path */
const RUN_CHECKS = async () => {
  const CF = await import('/js/shared.js');
  const card = document.getElementById('card');
  const out = { checks: [] };
  const ok = (name, pass, detail) => out.checks.push({ name, pass, detail });

  /* 1 — font drift: rasterize a probe through the capture path and compare its
         inked width against canvas measureText with the live fonts.
         No letter-spacing on the probe: SVG text layout counts one trailing
         advance that canvas measureText does not (phantom ~9%/~27% drift). */
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:900px;background:#111;color:#fff;z-index:99999';
  probe.innerHTML =
    '<div style="font:700 14px Chakra Petch,sans-serif;white-space:nowrap">DIAMOND 2 IMMORTAL 3</div>' +
    '<div style="font:400 52px Anton,sans-serif;white-space:nowrap;margin-top:10px">K486</div>';
  document.body.appendChild(probe);
  const cv = document.createElement('canvas').getContext('2d');
  const Q = String.fromCharCode(39);
  cv.font = '700 14px ' + Q + 'Chakra Petch' + Q + ', sans-serif';
  const domChakra = cv.measureText('DIAMOND 2 IMMORTAL 3').width;
  cv.font = '400 52px Anton, sans-serif';
  const domAnton = cv.measureText('K486').width;
  const dataUrl = await window.htmlToImage.toSvg(probe, { pixelRatio: 1 });
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const c2 = document.createElement('canvas');
  c2.width = img.width; c2.height = img.height;
  const g = c2.getContext('2d');
  g.drawImage(img, 0, 0);
  const ink = (y0, y1) => {
    const d = g.getImageData(0, y0, img.width, y1 - y0).data;
    let a = 1e9, b = -1;
    for (let y = 0; y < y1 - y0; y++) for (let x = 0; x < img.width; x++)
      if (d[(y * img.width + x) * 4] > 60) { if (x < a) a = x; if (x > b) b = x; }
    return b < 0 ? 0 : b - a + 1;
  };
  const driftChakra = Math.abs(ink(0, 24) / domChakra - 1);
  const driftAnton = Math.abs(ink(26, img.height) / domAnton - 1);
  probe.remove();
  ok('font drift Chakra Petch < 2%', driftChakra < .02, (driftChakra * 100).toFixed(1) + '%');
  ok('font drift Anton < 2%', driftAnton < .02, (driftAnton * 100).toFixed(1) + '%');

  /* 2 — geometry: sample grid rows + grid offsetHeight every frame while a real
         capture runs; both must equal the live values on every sample. offsetHeight
         (not rect) because the editor fitter scales #card with a transform. The
         card BOX growing to 1220 is the QR band and is expected — the grid inside
         it must not move. */
  const gridEl = card.querySelector('.grid');
  const rowsOf = () => getComputedStyle(gridEl).gridTemplateRows
    .split(' ').map(v => Math.round(parseFloat(v))).join(' ') + '|' + gridEl.offsetHeight;
  const liveGeom = rowsOf();
  const samples = new Set();
  let sampling = true;
  (function sample() {
    if (document.body.classList.contains('exporting')) samples.add(rowsOf());
    if (sampling) requestAnimationFrame(sample);
  })();
  const blob = await CF.captureCardBlob(card, 'image/png', undefined, { qrUrl: 'https://example.com/view.html?slug=pr62d5g' });
  sampling = false;

  /* 3 — dimensions: blob pixels must equal the download-name label */
  const dims = await CF.blobDims(blob);
  ok('blob is 3840×2440', dims.width === 3840 && dims.height === 2440, dims.width + '×' + dims.height);
  ok('download name matches blob', CF.pngName(dims.width, dims.height) === 'showcase-card-3840x2440.png', CF.pngName(dims.width, dims.height));

  const bad = [...samples].filter(s => s !== liveGeom);
  ok('grid rows + grid height identical during capture', bad.length === 0, bad.length ? 'drifted: ' + [...bad].join(', ') + ' vs live ' + liveGeom : liveGeom);

  const fr = new FileReader();
  out.pngBase64 = await new Promise(res => { fr.onload = () => res(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
  return out;
};

/* all five themes × the three layout modes (auto resolves to TILES) */
const COMBOS = [['protocol', 'auto'], ['holo', 'm1'], ['reaver', 'm2'], ['oni', 'm3'], ['arctic', 'auto']];
let failed = 0;
let firstPng = null;
for (const [theme, layout] of COMBOS) {
  draft.theme = theme;
  draft.layout = layout;
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  await page.addInitScript(d => {
    localStorage.setItem('vcard-draft-v2', JSON.stringify(d));
    localStorage.setItem('vc-draft-id', 'pr62d5g');
  }, draft);
  await page.goto(`${BASE || `http://localhost:${PORT}`}/build.html`);
  await page.waitForSelector('#card .skin', { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  const report = await page.evaluate(RUN_CHECKS);
  if (firstPng === null) firstPng = report.pngBase64;
  const bad = report.checks.filter(c => !c.pass);
  failed += bad.length;
  console.log(`  [${theme}/${layout}] ` + (bad.length
    ? 'FAIL ' + bad.map(c => c.name + ' (' + c.detail + ')').join('; ')
    : 'PASS ' + report.checks.map(c => c.detail).join(' | ')));
  await ctx.close();
}

const OUT = process.env.CF_EXPORT_OUT || 'C:/Users/shahe/AppData/Local/Temp/opencode/cf-after-export.png';
await writeFile(OUT, Buffer.from(firstPng, 'base64'));
console.log(failed ? `\ncheck:export — ${failed} assertion(s) failed` : `\ncheck:export — all assertions passed across ${COMBOS.length} theme/layout combos; PNG at ${OUT}`);
await browser.close();
if (!BASE) server.close();
process.exit(failed ? 1 : 0);
