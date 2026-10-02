// CardForge shared layout engine — M1 adaptive tiles, M2 top-N showcase, M4 justified catalog.
import { ALL_CATS, tierKey } from './shared.js';

export const TIER_COLORS = { select: '#9ba8b9', deluxe: '#4aa8ff', premium: '#b44bf0', ultra: '#ff5d7b', exclusive: '#ffc45e' };
export const TIER_RANK = { select: 0, deluxe: 1, premium: 2, ultra: 3, exclusive: 4 };

const PREMIUM_TIERS = ['premium', 'ultra', 'exclusive'];

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

function makeTile(pick, i, cat, tall, editable) {
  const t = el('span', 'skin tile' + (tall ? ' tall' : ''));
  t.dataset.cat = cat;
  t.dataset.vp = String(i);
  t.style.borderLeftColor = tierColorOf(pick);
  const label = pickLabel(pick);
  const img = image(pick.icon || pick.img || '', label);
  img.title = label;
  t.append(img, el('span', 'tname', pick.name || ''));
  if (pick.level >= 2) t.appendChild(lvChip(pick.level));
  if (editable) t.appendChild(removeBtn(pick));
  return t;
}

/* Overflow note only — the catalog it used to jump to no longer exists.
   Live surfaces scroll instead, so chips appear only in capped exports. */
function moreChip(n) {
  const s = el('span', 'jchip');
  s.textContent = `+${n} MORE`;
  const note = el('i', 'more-note', ' — scrolls on your listing');
  s.appendChild(note);
  s.title = `+${n} more skins — buyers scroll them on the published listing`;
  return s;
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
  const chosen = payload && payload.layout;
  if (chosen === 'm1' || chosen === 'm2' || chosen === 'm3') return chosen;
  return 'm1'; /* legacy 'm4' payloads and AUTO both land on TILES */
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
    slots.classList.add('melee-grid');
    if (opts.showAll) {
      skins.forEach((s, i) => slots.appendChild(skinCell(s, i, opts.editable)));
      return;
    }
    const rows = Math.max(1, Math.floor((H + 6) / 80));
    const cap = rows * 2;
    const chip = count > cap;
    const shown = chip ? cap - 1 : Math.min(count, cap);
    for (let i = 0; i < shown; i++) slots.appendChild(skinCell(skins[i], i, opts.editable));
    if (chip) slots.appendChild(moreChip(count - shown));
    return;
  }
  const capRows = Math.floor((H + 6) / 70);
  if (opts.showAll) {
    if (count <= capRows) {
      skins.forEach((s, i) => slots.appendChild(skinCell(s, i, opts.editable)));
      return;
    }
    const cols = clamp(2, Math.floor(W / 110), 4);
    slots.classList.add('tiles');
    slots.style.setProperty('--cols', String(cols));
    skins.forEach((s, i) => slots.appendChild(makeTile(skins[i], i, cat, false, opts.editable)));
    return;
  }
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
  for (let i = 0; i < take; i++) slots.appendChild(makeTile(skins[i], i, cat, false, opts.editable));
  if (count > take) slots.appendChild(moreChip(count - take));
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
  const H = slots.clientHeight;
  if (cat === 'Melees') {
    slots.classList.add('melee-grid');
    if (opts.showAll) {
      skins.forEach((s, i) => slots.appendChild(skinCell(s, i, opts.editable)));
      return;
    }
    const rows = Math.max(1, Math.floor((H + 6) / 80));
    const cap = rows * 2;
    const chip = count > cap;
    const shown = chip ? cap - 1 : Math.min(count, cap);
    for (let i = 0; i < shown; i++) slots.appendChild(skinCell(skins[i], i, opts.editable));
    if (chip) slots.appendChild(moreChip(count - shown));
    return;
  }
  const sorted = sortedSkins(skins);
  if (opts.showAll) {
    for (let i = 0; i < sorted.length; i++) slots.appendChild(namedRow(sorted[i], skins.indexOf(sorted[i]), opts.editable));
    return;
  }
  const N = Math.min(count, Math.floor((H - 46) / 50));
  for (let i = 0; i < N; i++) slots.appendChild(namedRow(sorted[i], skins.indexOf(sorted[i]), opts.editable));
  if (count > N) slots.appendChild(moreChip(count - N));
}

/* CLASSIC: one column per gun type — full-width rows, own space, own scroll */
function renderSlotsClassic(panel, skins, opts) {
  const slots = panel.querySelector('.slots');
  if (!slots) return;
  resetSlots(slots);
  const count = skins.length;
  if (!count) { renderEmpty(slots, panel.dataset.cat); return; }
  const H = slots.clientHeight;
  if (opts.showAll) {
    skins.forEach((s, i) => slots.appendChild(skinCell(s, i, opts.editable)));
    return;
  }
  const cap = Math.max(1, Math.floor((H + 6) / 70));
  const chip = count > cap;
  const shown = chip ? cap - 1 : count;
  for (let i = 0; i < shown; i++) slots.appendChild(skinCell(skins[i], i, opts.editable));
  if (chip) slots.appendChild(moreChip(count - shown));
}

// ── orchestrator ──────────────────────────────────────────────────
export function applyLayout(card, payload, mode, page, opts) {
  opts = opts || {};
  card.classList.remove('mode-m1', 'mode-m2', 'mode-m3');
  card.classList.add('mode-' + mode);
  ALL_CATS.forEach(cat => {
    if (cat === 'Flex') return;
    const panel = card.querySelector(`.panel[data-cat="${cat}"]`);
    if (!panel) return;
    const skins = pickList(payload, cat);
    if (mode === 'm2') renderSlotsM2(panel, skins, opts);
    else if (mode === 'm3') renderSlotsClassic(panel, skins, opts);
    else renderSlotsM1(panel, skins, opts);
  });
  return { pages: 1, page: 1 };
}