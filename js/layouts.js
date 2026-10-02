// CardForge shared layout engine — M1 adaptive tiles, M2 top-N showcase, M4 justified catalog.
import { $, ALL_CATS, tierKey } from './shared.js';

export const TIER_COLORS = { select: '#9ba8b9', deluxe: '#4aa8ff', premium: '#b44bf0', ultra: '#ff5d7b', exclusive: '#ffc45e' };
export const TIER_RANK = { select: 0, deluxe: 1, premium: 2, ultra: 3, exclusive: 4 };

const PREMIUM_TIERS = ['premium', 'ultra', 'exclusive'];
const GAP = 8;
const ASPECT = 1.7;
const HEAD_H = 30;
const ROW_MIN = 60;
const FALLBACK_W = 1856;
const FALLBACK_H = 880;

const clamp = (lo, v, hi) => Math.max(lo, Math.min(hi, v));

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function image(src, alt) {
  const i = document.createElement('img');
  i.src = src || '';
  i.alt = alt || '';
  i.loading = 'lazy';
  return i;
}

function pickLabel(pick) {
  return `${pick.weapon || ''} — ${pick.name || ''}` +
    (pick.level ? ` · LV${pick.level}` : '') +
    (pick.variant ? ` · ${pick.variant.name}` : '');
}

function tierColorOf(pick) {
  return TIER_COLORS[tierKey(pick.tier)] || TIER_COLORS.select;
}

function lvChip(level) {
  return el('i', 'lv', 'LV' + level);
}

function removeBtn(pick) {
  const b = el('button', 'rm', '×');
  b.dataset.remove = pick.id == null ? '' : String(pick.id);
  b.setAttribute('aria-label', 'Remove ' + (pick.name || ''));
  return b;
}

function skinCell(pick, i, editable) {
  const label = pickLabel(pick);
  const span = el('span', 'skin');
  span.dataset.vp = String(i);
  const img = image(pick.icon || pick.img || '', label);
  img.title = label;
  span.appendChild(img);
  if (pick.level >= 2) span.appendChild(lvChip(pick.level));
  if (editable) span.appendChild(removeBtn(pick));
  return span;
}

function namedRow(pick, i, editable) {
  const row = el('span', 'skin named');
  row.dataset.vp = String(i);
  row.style.borderLeftColor = tierColorOf(pick);
  const label = pickLabel(pick);
  const img = image(pick.icon || pick.img || '', label);
  img.title = label;
  row.append(img, el('span', 'tname', pick.name || ''));
  if (pick.level >= 2) row.appendChild(lvChip(pick.level));
  if (editable) row.appendChild(removeBtn(pick));
  return row;
}

function makeTile(pick, cat, tall, editable) {
  const t = el('span', 'skin tile' + (tall ? ' tall' : ''));
  t.dataset.cat = cat;
  t.style.borderLeftColor = tierColorOf(pick);
  const label = pickLabel(pick);
  const img = image(pick.icon || pick.img || '', label);
  img.title = label;
  t.append(img, el('span', 'tname', pick.name || ''));
  if (pick.level >= 2) t.appendChild(lvChip(pick.level));
  if (editable) t.appendChild(removeBtn(pick));
  return t;
}

function catalogChip(n, opts, wide) {
  const text = `+${n} MORE — FULL CATALOG`;
  const cls = wide ? 'jchip wide' : 'jchip';
  if (opts.gotoCatalog) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.dataset.goto = 'm4';
    b.textContent = text;
    return b;
  }
  return el('span', cls, text);
}

function resetSlots(slots) {
  slots.textContent = '';
  slots.className = 'slots';
  slots.removeAttribute('style');
}

function renderEmpty(slots, cat) {
  const n = cat === 'Melees' ? 4 : 3;
  for (let i = 0; i < n; i++) slots.appendChild(el('div', 'slotbox empty'));
}

// ── counts + layout resolution ────────────────────────────────────
export function countSkins(picks) {
  if (!picks) return 0;
  return ALL_CATS.reduce((n, cat) => n + ((picks[cat] && picks[cat].length) || 0), 0);
}

export function countPrems(picks) {
  if (!picks) return 0;
  let n = 0;
  ALL_CATS.forEach(cat => {
    ((picks[cat]) || []).forEach(s => { if (PREMIUM_TIERS.includes(tierKey(s.tier))) n++; });
  });
  return n;
}

export function resolveLayout(payload) {
  const picks = (payload && payload.picks) || {};
  const chosen = payload && payload.layout;
  if (chosen === 'm1' || chosen === 'm2' || chosen === 'm4') return chosen;
  return (countPrems(picks) >= 20 || countSkins(picks) >= 50) ? 'm4' : 'm1';
}

// ── shared data helpers ───────────────────────────────────────────
function pickList(payload, cat) {
  return (payload && payload.picks && payload.picks[cat]) || [];
}

function sortedSkins(skins) {
  return skins.slice().sort((a, b) =>
    ((b.level || 1) - (a.level || 1)) ||
    ((TIER_RANK[tierKey(b.tier)] || 0) - (TIER_RANK[tierKey(a.tier)] || 0)));
}

function catalogItems(payload) {
  const out = [];
  ALL_CATS.forEach(cat => {
    sortedSkins(pickList(payload, cat)).forEach(s => out.push({ skin: s, cat }));
  });
  return out;
}

function catCount(payload, cat) {
  return pickList(payload, cat).length;
}

function spanNote(items) {
  if (!items.length) return '';
  const first = items[0].cat.toUpperCase();
  const last = items[items.length - 1].cat.toUpperCase();
  return first === last ? first : `${first} → ${last}`;
}

function stageSize() {
  if (typeof document !== 'undefined') {
    const card = $('card');
    const stage = card && card.querySelector ? card.querySelector('.spread .jstage') : null;
    if (stage && stage.clientWidth > 0 && stage.clientHeight > 0) return { W: stage.clientWidth, H: stage.clientHeight };
  }
  return { W: FALLBACK_W, H: FALLBACK_H };
}

function dims(stage) {
  const W = stage.clientWidth || 0;
  const H = stage.clientHeight || 0;
  return (W > 0 && H > 0) ? { W, H } : { W: FALLBACK_W, H: FALLBACK_H };
}

// ── justified packer (category-pure rows, per-row height solve) ────
function packJustified(W, H, items, opts) {
  opts = opts || {};
  const h0 = opts.h0 || 110;
  const rows = [];
  rows.consumed = 0;
  if (!items.length) return rows;
  let i = 0;
  let y = 0;
  let prevCat = null;
  while (i < items.length) {
    const it = items[i];
    if (opts.onNewCategory && it.cat !== prevCat) {
      rows.push({ type: 'header', cat: it.cat, count: opts.countFor ? opts.countFor(it.cat) : 0, y });
      prevCat = it.cat;
      y += HEAD_H + GAP;
      continue;
    }
    prevCat = it.cat;
    const Hrem = H - y;
    if (Hrem < ROW_MIN) break;
    const r = Math.max(1, Math.floor((Hrem + GAP) / (h0 + GAP)));
    const h = (Hrem - (r - 1) * GAP) / r;
    const n = Math.max(1, Math.floor((W + GAP) / (ASPECT * h + GAP)));
    let remaining = 0;
    while (i + remaining < items.length && items[i + remaining].cat === it.cat) remaining++;
    const take = Math.min(n, remaining);
    rows.push({ type: 'row', cat: it.cat, items: items.slice(i, i + take), y, h, n, take, stretch: take >= remaining });
    i += take;
    y += h + GAP;
  }
  rows.consumed = i;
  return rows;
}

function computeM4Pages(W, H, items, payload) {
  const pages = [{ type: 'mosaic' }];
  let i = 0;
  let guard = 0;
  while (i < items.length && guard++ < 400) {
    const rem = items.slice(i);
    const rows = packJustified(W, H, rem, { h0: 110, onNewCategory: true, countFor: cat => catCount(payload, cat) });
    let consumed = rows.consumed > 0 ? rows.consumed : 1;
    let lastRow = null;
    for (let li = rows.length - 1; li >= 0; li--) {
      if (rows[li].type === 'row') { lastRow = rows[li]; break; }
    }
    if (lastRow && lastRow.y + lastRow.h > H + 0.5) consumed = Math.max(1, consumed - lastRow.take);
    pages.push({ type: 'catalog', start: i, items: rem.slice(0, consumed) });
    i += consumed;
  }
  return pages;
}

export function m4PageCount(payload) {
  const { W, H } = stageSize();
  return computeM4Pages(W, H, catalogItems(payload), payload).length;
}

// ── M4 mosaic overview ────────────────────────────────────────────
function buildMosaicCells(payload, W, H) {
  const cw = (W - 3 * 10) / 4;
  const ch = (H - 2 * 10) / 3;
  let entries = [];
  ALL_CATS.forEach(cat => {
    const skins = pickList(payload, cat);
    if (!skins.length) return;
    entries.push({ cat, count: skins.length, skins });
  });
  if (!entries.length) return [];
  entries.sort((a, b) => b.count - a.count);
  if (entries.length > 12) {
    const keep = entries.slice(0, 11);
    const rest = entries.slice(11);
    let skins = [];
    let cnt = 0;
    rest.forEach(e => { skins = skins.concat(e.skins); cnt += e.count; });
    keep.push({ cat: 'OTHER', count: cnt, skins });
    entries = keep;
  }
  const total = entries.reduce((s, e) => s + e.count, 0);
  const alloc = entries.map(() => 1);
  let used = entries.length;
  const quota = entries.map(e => e.count / total * 12);
  while (used < 12) {
    let best = 0;
    let bd = -Infinity;
    for (let i = 0; i < entries.length; i++) {
      const d = quota[i] - alloc[i];
      if (d > bd) { bd = d; best = i; }
    }
    alloc[best]++;
    used++;
  }
  const cells = [];
  entries.forEach((e, i) => {
    const sorted = sortedSkins(e.skins);
    const k = alloc[i];
    const base = Math.floor(sorted.length / k);
    const rem = sorted.length % k;
    let pos = 0;
    for (let ci = 0; ci < k; ci++) {
      const size = base + (ci < rem ? 1 : 0);
      const chunk = sorted.slice(pos, pos + size);
      pos += size;
      if (!chunk.length) continue;
      cells.push({ cat: e.cat, count: e.count, items: chunk.map(s => ({ skin: s, cat: e.cat })), cw, ch });
    }
  });
  return cells;
}

function fillMosaicBody(body, cell, W, H) {
  const rows = packJustified(W, H, cell.items, { h0: 64, onNewCategory: false });
  const truncated = rows.consumed < cell.items.length;
  const chipText = truncated ? `+${cell.items.length - rows.consumed + 1} MORE` : null;
  let lastRowIndex = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].type === 'row') { lastRowIndex = i; break; }
  }
  rows.forEach((row, ri) => {
    if (row.type !== 'row') return;
    const jr = el('div', 'jrow');
    jr.style.top = `${row.y}px`;
    jr.style.height = `${row.h}px`;
    jr.style.left = '0';
    jr.style.width = `${W}px`;
    const m = row.items.length;
    row.items.forEach((it, j) => {
      if (chipText != null && ri === lastRowIndex && j === m - 1) {
        jr.appendChild(el('span', 'jchip', chipText));
        return;
      }
      jr.appendChild(makeTile(it.skin, it.cat, false, false));
    });
    body.appendChild(jr);
  });
}

function renderMosaic(stage, payload, W, H) {
  const grid = el('div', 'spread-mosaic');
  stage.appendChild(grid);
  if (countSkins((payload && payload.picks) || {}) === 0) {
    ALL_CATS.forEach(cat => grid.appendChild(el('div', 'mcell empty', cat)));
    return;
  }
  const cells = buildMosaicCells(payload, W, H).map(c => {
    const cell = el('div', 'mcell');
    const head = el('div', 'mcellhead');
    head.append(el('span', null, c.cat), el('b', null, String(c.count)));
    const body = el('div', 'mcellbody');
    cell.append(head, body);
    grid.appendChild(cell);
    return { body, c };
  });
  cells.forEach(({ body, c }) => {
    const bh = body.clientHeight > 0 ? body.clientHeight : Math.max(0, c.ch - 26);
    fillMosaicBody(body, c, c.cw, bh);
  });
}

// ── M4 catalog pages ──────────────────────────────────────────────
function renderCatalog(stage, items, W, H, payload) {
  const rows = packJustified(W, H, items, { h0: 110, onNewCategory: true, countFor: cat => catCount(payload, cat) });
  rows.forEach(row => {
    if (row.type === 'header') {
      const hd = el('div', 'jhead');
      hd.style.top = `${row.y}px`;
      hd.style.height = `${HEAD_H}px`;
      hd.append(el('span', 'hn', row.cat), el('b', 'hc', String(row.count)));
      stage.appendChild(hd);
      return;
    }
    const jr = el('div', 'jrow');
    jr.style.top = `${row.y}px`;
    jr.style.height = `${row.h}px`;
    jr.style.left = '0';
    jr.style.width = `${W}px`;
    const tall = row.h >= 70;
    row.items.forEach(it => jr.appendChild(makeTile(it.skin, it.cat, tall, false)));
    stage.appendChild(jr);
  });
}

export function renderSpread(spread, payload, page) {
  spread.textContent = '';
  const stage = el('div', 'jstage');
  const foot = el('div', 'jpagefoot');
  const footSpan = el('span');
  const footPage = el('b');
  foot.append(footSpan, footPage);
  spread.append(stage, foot);
  const { W, H } = dims(stage);
  const items = catalogItems(payload);
  const pages = computeM4Pages(W, H, items, payload);
  const idx = clamp(1, Number(page) || 1, pages.length);
  const pg = pages[idx - 1];
  if (pg.type === 'mosaic') {
    footSpan.textContent = 'OVERVIEW';
    renderMosaic(stage, payload, W, H);
  } else {
    footSpan.textContent = spanNote(pg.items);
    renderCatalog(stage, pg.items, W, H, payload);
  }
  footPage.textContent = `PAGE ${idx} / ${pages.length}`;
}

// ── M1 adaptive tiles ─────────────────────────────────────────────
export function renderSlotsM1(panel, skins, opts) {
  opts = opts || {};
  const slots = panel.querySelector('.slots');
  if (!slots) return;
  resetSlots(slots);
  const cat = panel.dataset.cat;
  const count = skins.length;
  if (!count) { renderEmpty(slots, cat); return; }
  const W = slots.clientWidth;
  const H = slots.clientHeight;
  if (cat === 'Melees') {
    const cols = clamp(4, Math.floor(W / 76), 14);
    const chip = count > cols;
    const shown = chip ? cols - 1 : Math.min(count, cols);
    for (let i = 0; i < shown; i++) slots.appendChild(skinCell(skins[i], i, opts.editable));
    if (chip) slots.appendChild(el('span', 'jchip', `+${count - shown} MORE`));
    return;
  }
  const capRows = Math.floor((H + 6) / 40);
  if (count <= capRows) {
    skins.forEach((s, i) => slots.appendChild(skinCell(s, i, opts.editable)));
    return;
  }
  const cols = clamp(2, Math.floor(W / 110), 4);
  const visRows = Math.floor((H + 6) / 62);
  const visible = cols * visRows - 1;
  slots.classList.add('tiles');
  slots.style.setProperty('--cols', String(cols));
  const take = Math.min(count, visible);
  for (let i = 0; i < take; i++) slots.appendChild(makeTile(skins[i], cat, false, opts.editable));
  if (count > take) slots.appendChild(el('span', 'jchip', `+${count - take} MORE`));
}

// ── M2 top-N showcase ─────────────────────────────────────────────
export function renderSlotsM2(panel, skins, opts) {
  opts = opts || {};
  const slots = panel.querySelector('.slots');
  if (!slots) return;
  resetSlots(slots);
  const cat = panel.dataset.cat;
  const count = skins.length;
  if (!count) { renderEmpty(slots, cat); return; }
  const W = slots.clientWidth;
  const H = slots.clientHeight;
  if (cat === 'Melees') {
    const cols = clamp(4, Math.floor(W / 90), 10);
    const chip = count > cols;
    const shown = chip ? cols - 1 : Math.min(count, cols);
    for (let i = 0; i < shown; i++) slots.appendChild(skinCell(skins[i], i, opts.editable));
    if (chip) slots.appendChild(catalogChip(count - shown, opts, false));
    return;
  }
  const sorted = sortedSkins(skins);
  const N = Math.min(count, Math.floor((H - 46) / 50));
  for (let i = 0; i < N; i++) slots.appendChild(namedRow(sorted[i], skins.indexOf(sorted[i]), opts.editable));
  if (count > N) slots.appendChild(catalogChip(count - N, opts, true));
}

// ── orchestrator ──────────────────────────────────────────────────
export function applyLayout(card, payload, mode, page, opts) {
  opts = opts || {};
  const grid = card.querySelector('.grid');
  let spread = card.querySelector('.spread');
  if (!spread) {
    spread = el('div', 'spread');
    if (grid && grid.parentNode) grid.parentNode.insertBefore(spread, grid.nextSibling);
    else card.appendChild(spread);
  }
  card.classList.remove('mode-m1', 'mode-m2', 'mode-m4');
  card.classList.add('mode-' + mode);
  if (mode === 'm4') {
    renderSpread(spread, payload, page);
    return { pages: m4PageCount(payload), page };
  }
  spread.textContent = '';
  ALL_CATS.forEach(cat => {
    if (cat === 'Flex') return;
    const panel = card.querySelector(`.panel[data-cat="${cat}"]`);
    if (!panel) return;
    const skins = pickList(payload, cat);
    if (mode === 'm2') renderSlotsM2(panel, skins, opts);
    else renderSlotsM1(panel, skins, opts);
  });
  return { pages: 1, page };
}
