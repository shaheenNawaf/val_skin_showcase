// Generate the vendored Battlepass weapon-skin UUID set.
// Riot/valorant-api expose no "battlepass" flag, so the only reliable identifier
// is the official VALORANT wiki cosmetics navbox (Battle Pass section) joined to
// valorant-api themes. Run: node scripts/gen-bp-skins.mjs

import { writeFileSync } from 'node:fs';

const WIKI = 'https://wiki.playvalorant.com/en-us/api.php?action=parse&page=Template:Navbox_cosmetics&prop=wikitext&format=json';
const API = 'https://valorant-api.com/v1';
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const j = await (await fetch(WIKI)).json();
const wt = j.parse.wikitext['*'];
const i = wt.indexOf('![[Battle Pass]]');
if (i < 0) {
  console.error('could not find "![[Battle Pass]]" in the cosmetics navbox wikitext — source layout changed');
  process.exit(1);
}
const table = wt.slice(i, wt.indexOf('|}', i));

const names = [];
for (const row of table.split('|-')) {
  for (const m of row.matchAll(/\{\{\s*(collection|capsule)\s*\|\s*([^}|]+)(?:\|([^}]+))?\}\}/g)) {
    names.push({ p1: m[2].trim(), p2: m[3] ? m[3].trim() : '' });
  }
}

const themes = (await (await fetch(`${API}/themes?language=en-US`)).json()).data;
const byNorm = new Map();
themes.forEach(t => {
  const k = norm(t.displayName);
  if (!byNorm.has(k)) byNorm.set(k, []);
  byNorm.get(k).push(t);
});

const themeUuids = new Set();
for (const n of names) {
  for (const nm of [n.p2, n.p1]) {
    const hits = byNorm.get(norm(nm));
    if (hits) hits.forEach(t => themeUuids.add(t.uuid));
  }
}

const weapons = (await (await fetch(`${API}/weapons?language=en-US`)).json()).data;
const skins = new Map();
weapons.forEach(w => w.skins.forEach(s => {
  if (themeUuids.has(s.themeUuid) && s.displayName !== 'Standard'
    && !/^Standard /.test(s.displayName) && !/^Random Favorite/.test(s.displayName)) {
    skins.set(s.uuid, s.displayName);
  }
}));

if (skins.size === 0 || skins.size < 400) {
  console.error(`battlepass skin set is empty or too small (${skins.size}) — source layout changed`);
  process.exit(1);
}

const uuids = [...skins.keys()].sort();

writeFileSync('js/vendor/bp-skins.js',
  '// Battlepass weapon-skin UUIDs. Generated data — refresh when a new act ships:\n' +
  '//   node scripts/gen-bp-skins.mjs\n' +
  '// Source: VALORANT wiki cosmetics navbox (Battle Pass collections) joined to\n' +
  '// valorant-api themes; compilation collections carry no gun skins. 2026-10-06: ' + skins.size + ' skins.\n' +
  'export const BP_SKINS = new Set([\n' +
  uuids.map(u => `"${u}"`).join(',\n') +
  '\n]);\n');

console.log(`battlepass skins: ${skins.size} (from ${themeUuids.size} themes / ${names.length} collections)`);
console.log('wrote js/vendor/bp-skins.js');