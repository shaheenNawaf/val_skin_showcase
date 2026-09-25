// Renders review PNGs of both pages with the system Edge/Chrome via playwright-core.
// Seeds a realistic draft + published listing first so pages render with content.
// Usage: node scripts/screenshot.mjs [outDir]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = process.argv[2] || '.zcode/review';
mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:3000';

// build a realistic payload from the live community API
const api = async (p) => (await (await fetch(`https://valorant-api.com/v1/${p}`)).json()).data;
const [weapons, tiersets] = await Promise.all([api('weapons?language=en-US'), api('competitivetiers?language=en-US')]);
const vandal = weapons.find(w => w.displayName === 'Vandal');
const reaver = vandal.skins.find(s => s.displayName === 'Reaver Vandal');
const imm3 = tiersets[tiersets.length - 1].tiers.find(t => t.tierName === 'IMMORTAL 3');
const skin = {
  id: reaver.uuid, weapon: 'Vandal', name: 'Reaver Vandal', tier: 'Premium',
  icon: reaver.displayIcon || reaver.chromas[0].displayIcon
};
const op = weapons.find(w => w.displayName === 'Operator');
const opSkin = op.skins.find(s => s.displayName !== 'Standard' && (s.displayIcon || s.chromas?.[0]?.displayIcon));
const flexSkin = {
  id: opSkin.uuid, weapon: 'Operator', name: opSkin.displayName, tier: 'Exclusive',
  icon: opSkin.displayIcon || opSkin.chromas[0].displayIcon
};
const meleeW = weapons.find(w => (w.category || '').toLowerCase().includes('melee'));
const meleeSkin = meleeW.skins.find(s => s.displayIcon || s.chromas?.[0]?.displayIcon);
const bpSkin = {
  id: meleeSkin.uuid, weapon: meleeW.displayName, name: meleeSkin.displayName, tier: 'Deluxe',
  icon: meleeSkin.displayIcon || meleeSkin.chromas[0].displayIcon
};
const payload = {
  theme: 'reaver',
  texts: {
    code: 'K486', vp: '420', rp: '140', kc: '6422', level: '376',
    tag: 'FS/FT+ADD', link: 'https://www.facebook.com/Your.Page.Here',
    prems: '42', limited: '02', semis: '00', bpass: '10',
    crank: 'DIAMOND 2', prank: 'IMMORTAL 3',
    wtr: 'WTR: YES', receipts: 'RECEIPTS: YES', owner: '0TH OWNER',
    cname: 'CHANGE NAME', cstatus: 'NOT READY', date: '2/6/2026',
    premier: 'PREMIER', vlink: 'UNLINKED', price: 'PRICE OFFER'
  },
  ranks: { crank: null, prank: imm3.displayIcon || imm3.largeIcon },
  picks: { Rifles: [skin], Flex: [flexSkin], Battlepass: [bpSkin] },
  assets: { avatar: null, pcard: null, buddies: [] }
};
const SEED = `
  localStorage.setItem('vcard-draft-v2', ${JSON.stringify(JSON.stringify(payload))});
  localStorage.setItem('vlistings', ${JSON.stringify(JSON.stringify({ demo2026: { slug: 'demo2026', theme: 'reaver', payload, at: Date.now() } }))});
  localStorage.setItem('vc-edit-demo2026', 'seed');
  localStorage.setItem('vc-draft-id', 'demo2026');
`;

const browser = await chromium.launch({ channel: 'msedge', headless: true }).catch(() =>
  chromium.launch({ channel: 'chrome', headless: true }));

async function shoot(name, url, { width = 1440, height = 900, before } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript(SEED);
  const page = await context.newPage();
  await page.goto(BASE + url, { waitUntil: 'networkidle' }).catch(() => page.goto(BASE + url));
  await page.waitForTimeout(2500);
  if (before) await before(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await context.close();
  console.log('shot', name);
}

// desktop editor with the seeded draft restored
await shoot('editor-desktop', '/index.html');
// picker modal open with a search applied
await shoot('editor-modal', '/index.html', {
  before: async (page) => {
    await page.locator('.panel[data-cat="Rifles"] .add').click();
    await page.locator('#mSearch').fill('vandal');
    await page.waitForTimeout(600);
  }
});
// desktop viewer with the seeded listing
await shoot('viewer-desktop', '/view.html?slug=demo2026');
// riot token import modal (opened directly — needs no Supabase to render)
await shoot('editor-import', '/index.html', {
  before: async (page) => {
    await page.evaluate(() => { document.getElementById('importModal').hidden = false; });
    await page.waitForTimeout(300);
  }
});
// mobile editor + viewer (real 390px viewport)
await shoot('editor-mobile', '/index.html', { width: 390, height: 844 });
await shoot('viewer-mobile', '/view.html?slug=demo2026', { width: 390, height: 844 });
// arctic theme viewer
await shoot('viewer-arctic', '/view.html?slug=demo2026', {
  before: async (page) => {
    await page.evaluate(() => document.documentElement.dataset.theme = 'arctic');
  }
});

await browser.close();
