/* One-time vendor step for the card's two display families.
   WHY: the PNG export rasterizes the card inside an SVG <foreignObject>, where no
   external resource can load — fonts must be inlined as data URIs. html-to-image
   builds that inline set by reading document.styleSheets[].cssRules, which throws
   SecurityError on the cross-origin Google Fonts stylesheets, so every export fell
   back to the generic sans (+13% Chakra Petch / +42% Anton width drift). Same-origin
   @font-face rules are readable, so vendoring the files fixes the capture with zero
   changes to captureCardBlob(). See design-plans/006-export-png-fidelity.md.

   Run:  node scripts/fetch-fonts.mjs
   Output: fonts/*.woff2 + css/fonts.css  (both committed; copy-static.mjs ships them) */

import { mkdirSync, writeFileSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const FAMILIES = [
  { css: 'family=Anton', name: 'Anton', weights: [400] },
  { css: 'family=Chakra+Petch:wght@400;500;600;700', name: 'Chakra Petch', weights: [400, 500, 600, 700] }
];

mkdirSync('fonts', { recursive: true });

const faces = [];
for (const fam of FAMILIES) {
  const res = await fetch(`https://fonts.googleapis.com/css2?${fam.css}&display=swap`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Google Fonts CSS ${res.status} for ${fam.name}`);
  const css = await res.text();
  // keep only the `/* latin */` block per weight — latin-ext/vietnamese subsets would
  // bloat every exported SVG for glyphs the card never prints
  const blocks = css.split('/* latin */').slice(1);
  for (const block of blocks) {
    const weight = Number((block.match(/font-weight:\s*(\d+)/) || [])[1]);
    const url = (block.match(/src:\s*url\((https:[^)]+\.woff2)\)/) || [])[1];
    const range = (block.match(/unicode-range:\s*([^;]+);/) || [])[1];
    if (!weight || !url || !fam.weights.includes(weight)) continue;
    const file = `${fam.name.toLowerCase().replace(/\s+/g, '-')}-${weight}.woff2`;
    const bin = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!bin.ok) throw new Error(`woff2 ${bin.status} for ${fam.name} ${weight}`);
    const buf = Buffer.from(await bin.arrayBuffer());
    writeFileSync(`fonts/${file}`, buf);
    faces.push(
      `@font-face{\n` +
      `  font-family:'${fam.name}';\n` +
      `  font-style:normal;\n` +
      `  font-weight:${weight};\n` +
      `  font-display:swap;\n` +
      `  src:url('../fonts/${file}') format('woff2');\n` +
      `  unicode-range:${range.trim()};\n` +
      `}`
    );
    console.log(`  fonts/${file}  ${(buf.length / 1024).toFixed(1)} KB`);
  }
}

writeFileSync('css/fonts.css',
  '/* Vendored card fonts — Anton + Chakra Petch, latin only.\n' +
  '   Regenerate with: node scripts/fetch-fonts.mjs\n' +
  '   Must stay SAME-ORIGIN: the PNG export inlines @font-face by reading\n' +
  '   document.styleSheets cssRules, which is blocked for cross-origin sheets. */\n' +
  faces.join('\n') + '\n');

console.log(`Wrote ${faces.length} @font-face rules -> css/fonts.css`);
