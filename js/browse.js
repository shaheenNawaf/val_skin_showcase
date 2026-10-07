// CardForge browse — Direction-D marketplace over live Supabase listings.
// Summary cards come from browse_listings_v2 (legacy browse_listings as a
// fallback); the quick-view modal carries the REAL shared.css #card.
import { esc, $, status, initDisclaimerCollapse, initStatusDismiss, ALL_CATS, DESIGN_W, DESIGN_H, isPlaceholderTitle } from './shared.js';

const CONFIG = window.CARDFORGE_CONFIG || {};
let supabase = null;
if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && window.supabase) {
  supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}
let isSeller = false;
/* v1.5: the marketplace is the front door — public sign-in is password-only.
   The magic-link button in the login modal is revealed with ?magic=1
   (recovery hatch so OTP-only sellers can never be locked out). */
const MAGIC = new URLSearchParams(location.search).has('magic');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AVATAR_PLACEHOLDER = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='100%25' height='100%25' fill='%232A3540'/><circle cx='32' cy='25' r='11' fill='%23768390'/><rect x='14' y='40' width='36' height='19' rx='6' fill='%23768390'/></svg>";

/* CF-31: a failed skin icon used to become visibility:hidden behind a
   gradient — a silent gap with no alt and no per-skin signal. Mark the
   wrap so CSS can show an honest placeholder instead. */
const IMGERR = "onerror=\"this.setAttribute('data-imgfail','1');this.closest('[data-imgwrap]')?.setAttribute('data-imgfail','1')\"";

const THEME_ACCENTS = {
  protocol: { label: 'High Ranks', bg: '#0F1923', panel: '#1F2731', accent: '#FF4655', ink: '#ECE8E1', mut: '#8A99A9' },
  holo: { label: 'With Champions', bg: '#04101A', panel: '#0A1E30', accent: '#46F6FF', ink: '#DFF6FF', mut: '#7E9CB2' },
  reaver: { label: 'Latest Skins', bg: '#0D0A14', panel: '#180F2A', accent: '#B44BFF', ink: '#EFE9FF', mut: '#9D92BA' },
  oni: { label: 'Budget-friendly', bg: '#120B0B', panel: '#201114', accent: '#FF5540', ink: '#F5E9DC', mut: '#AF9889' },
  arctic: { label: 'High Prem', bg: '#171310', panel: '#221B15', accent: '#D8434E', ink: '#F2EEE6', mut: '#A79B8B' }
  , standard: { label: 'Normal', bg: '#141719', panel: '#1F2427', accent: '#AFC2CE', ink: '#EEF0EF', mut: '#96A0A4' }
};

const RANK_THRESHOLDS = { gold: 10, plat: 13, dia: 16, asc: 19, imm: 22, rad: 27 };
const FEATURE_ORDER = ['Rifles', 'Melees', 'Sniper Rifles', 'Sidearms', 'SMGs', 'Machine Guns'];

const state = { q: '', themes: new Set(), minRank: '', price: '', flags: new Set(), sort: 'new', view: 'grid', style: 'mini' };
let listings = [];
const bySlug = {};

const deepSlug = new URLSearchParams(location.search).get('slug');
const qv = $('qv');
const qvClose = qv ? qv.querySelector('.qv-close') : null;
let qvLastFocus = null;
let qvResizePending = false;
let qvPicks = null; /* QV-T: last payload picks, so a resize can re-render the phone thumbs */
let qvSlug = '';

const CARD_DEFAULTS = new Map();
document.querySelectorAll('#card [data-key]').forEach(el => CARD_DEFAULTS.set(el, el.textContent));

// ── helpers ───────────────────────────────────────────────────────
function rankTier(name) {
  const s = String(name || '').toUpperCase();
  if (s.includes('RADIANT')) return 27;
  const groups = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'ASCENDANT', 'IMMORTAL'];
  const i = groups.findIndex(g => s.includes(g));
  if (i < 0) return 0;
  const d = s.match(/(\d)\s*$/);
  return i * 3 + 1 + (d ? Number(d[1]) - 1 : 0);
}

function daysAgo(iso) {
  const t = new Date(iso).getTime();
  if (!iso || Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 864e5));
}

function agoText(d) {
  return d === 0 ? 'today' : (d === 1 ? '1d ago' : d + 'd ago');
}

function img(src, alt, cls) {
  return '<img' + (cls ? ' class="' + cls + '"' : '') + ' src="' + esc(src) + '" alt="' + esc(alt) + '" loading="lazy" ' + IMGERR + '>';
}

function pickIcon(p) { return p.icon || p.img || ''; }
function pickName(p) { return p.name || ''; }
function pickWeapon(p) { return p.weapon || ''; }
function pickAlt(p) { return pickWeapon(p) + ' — ' + pickName(p); }

function catPicks(l, key) {
  const a = l.picks[key];
  return Array.isArray(a) ? a : [];
}

function flattenPicks(l, order) {
  return order.flatMap(k => catPicks(l, k));
}

function pickSrcImg(p) {
  const src = pickIcon(p);
  return src ? img(src, pickAlt(p)) : '';
}

function pickIconWrap(p) {
  const src = pickIcon(p);
  return src ? '<span data-imgwrap>' + img(src, pickAlt(p)) + '</span>' : '';
}

function pickWrap(p, cls) {
  const src = pickIcon(p);
  return src ? '<span data-imgwrap class="' + cls + '">' + img(src, pickAlt(p)) + '</span>' : '';
}

function rankImg(r) {
  return (typeof r.icon === 'string' && r.icon) ? img(r.icon, r.name || 'Rank') : '';
}

function setThemeVars(el, key) {
  const t = THEME_ACCENTS[key] || THEME_ACCENTS.protocol;
  if (!el) return;
  el.style.setProperty('--th-bg', t.bg);
  el.style.setProperty('--th-panel', t.panel);
  el.style.setProperty('--th-accent', t.accent);
  el.style.setProperty('--th-ink', t.ink);
  el.style.setProperty('--th-mut', t.mut);
}

function normalize(r) {
  return {
    slug: r.slug,
    title: r.title || r.slug,
    code: r.code || '',
    theme: r.theme || 'protocol',
    price: r.price == null ? null : Number(r.price),
    currency: r.currency || null, /* CF-16: was normalised away, so every price rendered a hardcoded $ */
    negotiable: !!r.negotiable,
    featured: !!r.featured, /* v1.3: owner-pinned (v3 only; v2 rows default false) */
    views: Number(r.views) || 0,
    daysAgo: daysAgo(r.updated_at),
    rankNow: { name: r.crank_name || 'UNRANKED', icon: r.crank_icon || '', tier: rankTier(r.crank_name) },
    rankPeak: { name: r.prank_name || 'UNRANKED', icon: r.prank_icon || '', tier: rankTier(r.prank_name) },
    stats: {
      skins: r.skins || 0, premium: r.prems || 0, limited: r.limited || 0, bpass: r.bpass || 0, level: r.level || 0, vp: r.vp || 0, rp: r.rp || 0, kc: r.kc || 0
    },
    flags: {
      wtr: /yes/i.test(r.wtr || ''), receipts: /yes/i.test(r.receipts || ''),
      wtrIssues: /no/i.test(r.wtr || ''),
      premierUnlinked: /unlinked/i.test(r.vlink || ''),
      owner: (r.owner || '').replace(/\s*owner\s*$/i, '') || '—'
    },
    seller: { name: r.tag || ((r.vlogin && r.vlogin !== 'RIOT ID') ? r.vlogin : '') || r.slug },
    vlogin: r.vlogin || '',
    link: (r.link || '').trim(),
    picks: r.picks_top || {},
    thumb: (typeof r.thumb_src === 'string' && r.thumb_src.startsWith('https://'))
      ? { src: r.thumb_src, label: r.thumb_label || '' }
      : null
  };
}

// ── facets (rows built into the empty fieldsets) ──────────────────
function buildFacets() {
  const themeRows = Object.keys(THEME_ACCENTS).map(k => {
    const t = THEME_ACCENTS[k];
    return '<label><input type="checkbox" value="' + k + '"><span class="sw sw-' + k + '"></span><span class="ftxt">' + esc(t.label) + '</span><span class="fn zero" data-theme-count="' + k + '">0</span></label>';
  }).join('');
  $('fTheme').innerHTML = '<legend>THEME</legend>' + themeRows;

  const rankRows = [
    { v: '', l: 'Any' }, { v: 'gold', l: 'GOLD+' }, { v: 'plat', l: 'PLATINUM+' },
    { v: 'dia', l: 'DIAMOND+' }, { v: 'asc', l: 'ASCENDANT+' }, { v: 'imm', l: 'IMMORTAL+' }, { v: 'rad', l: 'RADIANT' }
  ].map((r, i) => '<label class="frow"><input type="radio" name="minrank" value="' + r.v + '"' + (i === 0 ? ' checked' : '') + '><span class="fl">' + esc(r.l) + '</span><span class="fbar"><i></i></span><span class="fn">0</span></label>').join('');
  $('fRank').innerHTML = '<legend>MIN RANK</legend>' + rankRows;

  const priceRows = [
    { v: '', l: 'Any' }, { v: 'u1000', l: 'Under ₱1,000' }, { v: 'r3000', l: '₱1,000–₱3,000' },
    { v: 'r6000', l: '₱4,000–₱6,000' }, { v: 'r10000', l: '₱7,000–₱10,000' }, { v: 'off', l: 'For Offers' }
  ].map((r, i) => '<label><input type="radio" name="price" value="' + r.v + '"' + (i === 0 ? ' checked' : '') + '><span class="ftxt">' + esc(r.l) + '</span><span class="fn">0</span></label>').join('');
  $('fPrice').innerHTML = '<legend>PRICE</legend>' + priceRows;

  const flagRows = [
    { v: 'noissue', l: 'No Issue' }, { v: 'issues', l: 'With Issues' }, { v: 'premunl', l: 'Premier Unlinked' }
  ].map(r => '<label><input type="checkbox" value="' + r.v + '"><span class="ftxt">' + esc(r.l) + '</span><span class="fn">0</span></label>').join('');
  $('fFlags').innerHTML = '<legend>REQUIREMENTS</legend>' + flagRows;
}

/* CF-30: facet counts come from the set filtered by every OTHER dimension,
   so each row shows what choosing it would yield — they used to be computed
   from the unfiltered list and never moved as filters changed. */
function facetBase(skip) { return listings.filter(l => matches(l, skip)); }

function themeCounts() {
  const base = facetBase('themes');
  Object.keys(THEME_ACCENTS).forEach(k => {
    const el = document.querySelector('[data-theme-count="' + k + '"]');
    if (el) {
      const n = base.filter(l => l.theme === k).length;
      el.textContent = n;
      el.classList.toggle('zero', n === 0);
    }
  });
}

function priceCounts() {
  const base = facetBase('price');
  document.querySelectorAll('#fPrice input[name="price"]').forEach(r => {
    const v = r.value;
    let count;
    if (!v) count = base.length;
    else if (v === 'off') count = base.filter(l => l.price === null).length;
    else count = base.filter(l => {
      const p = l.price;
      if (p === null) return false;
      if (v === 'u1000') return p < 1000;
      if (v === 'r3000') return p >= 1000 && p < 3000;
      if (v === 'r6000') return p >= 4000 && p < 6000;
      if (v === 'r10000') return p >= 7000 && p <= 10000;
      return false;
    }).length;
    const row = r.closest('label');
    const fn = row ? row.querySelector('.fn') : null;
    if (fn) { fn.textContent = count; fn.classList.toggle('zero', count === 0); }
    if (row) row.title = count + ' matching listings';
  });
}

function rankCounts() {
  const base = facetBase('rank');
  const N = listings.length || 1;
  document.querySelectorAll('#fRank input[name="minrank"]').forEach(r => {
    const v = r.value;
    let count;
    if (!v) count = base.length;
    else {
      const need = RANK_THRESHOLDS[v];
      count = base.filter(l => need && l.rankNow.tier >= need).length;
    }
    const row = r.closest('.frow');
    if (!row) return;
    const fn = row.querySelector('.fn');
    if (fn) { fn.textContent = count; fn.classList.toggle('zero', count === 0); }
    row.title = count + ' matching listings';
    const bar = row.querySelector('.fbar i');
    if (bar) bar.style.setProperty('--w', (count > 0 ? Math.max(4, count / N * 100) : 0) + '%');
  });
}

function flagCounts() {
  const base = facetBase('flags');
  const map = {
    noissue: l => l.flags.wtr,
    issues: l => l.flags.wtrIssues,
    premunl: l => l.flags.premierUnlinked
  };
  document.querySelectorAll('#fFlags input').forEach(cb => {
    const row = cb.closest('label');
    const fn = row ? row.querySelector('.fn') : null;
    const test = map[cb.value];
    if (fn && test) {
      const n = base.filter(test).length;
      fn.textContent = n;
      fn.classList.toggle('zero', n === 0);
    }
  });
}

/* F: active-filter chips at the top of the sidebar — what's applied right
   now, removable in one click; CLEAR ALL only earns its place when set */
function syncFilterChips() {
  const box = $('fchips');
  const chips = [];
  document.querySelectorAll('#fTheme input:checked').forEach(cb => {
    const t = THEME_ACCENTS[cb.value];
    chips.push({ facet: 'theme', value: cb.value, label: t ? t.label : cb.value });
  });
  document.querySelectorAll('#fFlags input:checked').forEach(cb => {
    const l = cb.closest('label');
    const f = l ? l.querySelector('.ftxt') : null;
    chips.push({ facet: 'flag', value: cb.value, label: f ? f.textContent : cb.value });
  });
  [['minrank', '#fRank'], ['price', '#fPrice']].forEach(pair => {
    const r = document.querySelector(pair[1] + ' input[name="' + pair[0] + '"]:checked');
    if (r && r.value) {
      const l = r.closest('label');
      const t = l ? (l.querySelector('.fl') || l.querySelector('.ftxt')) : null;
      chips.push({ facet: pair[0], value: r.value, label: t ? t.textContent : r.value });
    }
  });
  if (box) {
    box.hidden = chips.length === 0;
    box.innerHTML = chips.map(c => '<button type="button" class="fchip" data-facet="' + c.facet + '" data-value="' + esc(c.value) + '" title="Remove this filter">' + esc(c.label) + ' ×</button>').join('');
  }
  const clear = $('clearAll');
  if (clear) clear.hidden = chips.length === 0;
}

// ── renderers ─────────────────────────────────────────────────────
function badgesGrid(l) {
  let b = '';
  if (l.daysAgo <= 3) b += '<span class="b-new">NEW</span>';
  if (l.views >= 500) b += '<span class="b-hot">HOT</span>';
  return b;
}

/* CF-16: the symbol comes from the listing's own currency column — it was
   hardcoded '$' while the RPC returned EUR/GBP listings untouched. */
const CUR_SYMBOL = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', PHP: '₱' };
function moneyHTML(l, cls) {
  if (l.price == null) return '<span class="' + (cls || 'lc-offer') + '">CONTACT FOR PRICE</span>';
  const sym = CUR_SYMBOL[l.currency] || (l.currency ? esc(l.currency) + ' ' : '$');
  return '<span class="' + (cls || 'lc-price') + '">' + sym + esc(l.price) + '</span>';
}

/* Stats and trust are separate rows: stats are per-offering inventory,
   trust is the buyer's risk question. A listing with no inventory at all
   (the artwork path) renders NO stat row — a row of zeros is a lie, not
   a fact. */
function statsEmpty(l) {
  const s = l.stats;
  return !s || (s.skins === 0 && s.premium === 0 && s.limited === 0 && s.bpass === 0 && s.level === 0);
}
function statChips(l) {
  if (statsEmpty(l)) return '';
  const s = l.stats;
  return '<div class="gc-chips">'
    + '<span><b>' + esc(s.skins) + '</b> skins</span>'
    + '<span><b>' + esc(s.premium) + '</b> prem</span>'
    + '<span><b>' + esc(s.limited) + '</b> limited</span>'
    + '<span><b>' + esc(s.bpass) + '</b> bp</span>'
    + '<span>lv <b>' + esc(s.level) + '</b></span>'
    + '</div>';
}

/* Single flag: set false and WTR issues degrade to a muted "WTR not
   stated" chip — no second code path, per the stakeholder-removable
   requirement. */
const SHOW_WTR_ISSUES = true;
function trustChips(l) {
  const f = l.flags;
  const w = (f.wtrIssues && SHOW_WTR_ISSUES) ? { c: 'bad', t: 'WTR issues' }
          : f.wtr ? { c: 'ok', t: 'WTR verified' }
          : { c: 'na', t: 'WTR not stated' };
  let c = '<span class="hasdot ' + w.c + '">' + w.t + '</span>';
  if (f.receipts) c += '<span class="hasdot ok">Receipts</span>';
  if (f.premierUnlinked) c += '<span class="hasdot warn">Premier unlinked</span>';
  return '<div class="gc-chips">' + c + '</div>';
}

function chipsList(l) {
  let c = '<span class="chip">' + esc(l.stats.skins) + ' SKINS</span><span class="chip">' + esc(l.stats.premium) + ' PREMIUM</span>';
  if (l.stats.bpass > 0) c += '<span class="chip">' + esc(l.stats.bpass) + ' BATTLEPASS</span>';
  if (l.flags.wtr) c += '<span class="chip">WTR</span>';
  if (l.flags.receipts) c += '<span class="chip">RECEIPTS</span>';
  return c;
}

/* v1.5.4: mobile commerce card — one-row skin strip (replaces the 6-panel
   mosaic on phones), price slot on the title row, chip cap with +N, and
   correct view grammar. Desktop keeps the existing anatomy via CSS. */
/* v1.5.4's mobile-only nodes (icon strip, price slot, chip cap) are gone —
   the card is one anatomy at every width now. */
const viewsText = l => esc(l.views) + (Number(l.views) === 1 ? ' view · ' : ' views · ');

function priceHTML(l) {
  /* CF-16: negotiable is rendered — a buyer should know the price is soft
     before they contact anyone. It was normalised and never shown. */
  const neg = l.negotiable ? '<span class="lc-neg">open to offers</span>' : '';
  return moneyHTML(l) + neg;
}

/* Bare "₱4,500" for the grid foot; moneyHTML() wraps it in a classed span
   for the list/featured views. */
function priceText(l) {
  const sym = CUR_SYMBOL[l.currency] || (l.currency ? esc(l.currency) + ' ' : '$');
  return sym + esc(l.price);
}

/* Still used by the FEATURED tile (.gf-trow), which is out of scope for
   this ship. The grid card no longer emits a price slot. */
function pslotHTML(l) {
  return '<span class="gc-pslot">'
    + (l.price == null ? '<span class="gp-offer">Contact for price</span>' : moneyHTML(l, 'gp-val'))
    + (l.negotiable ? '<span class="gp-obo">OBO</span>' : '')
    + '</span>';
}

function previewInner(l, style) {
  if (style === 'rail') {
    const rows = [
      { l: 'RIFLES', keys: catPicks(l, 'Rifles').slice(0, 4) },
      { l: 'SIDE+SMG', keys: catPicks(l, 'Sidearms').slice(0, 2).concat(catPicks(l, 'SMGs').slice(0, 2)) },
      { l: 'SNIP+MG+MELEE', keys: catPicks(l, 'Sniper Rifles').slice(0, 1).concat(catPicks(l, 'Machine Guns').slice(0, 1), catPicks(l, 'Melees').slice(0, 2)) }
    ];
    return '<div class="rl">' + rows.map(r => {
      let icons = r.keys.map(p => pickWrap(p, 'mc-iw')).join('');
      if (!icons) icons = '<span class="mc-empty"></span>';
      return '<div class="rl-row"><span class="rl-l">' + esc(r.l) + '</span><span class="rl-icons">' + icons + '</span></div>';
    }).join('') + '</div>';
  }
  const panels = [
    { l: 'RIFLES', k: 'Rifles' }, { l: 'SNIPERS', k: 'Sniper Rifles' }, { l: 'MGS', k: 'Machine Guns' },
    { l: 'SIDEARMS', k: 'Sidearms' }, { l: 'SMGS', k: 'SMGs' }, { l: 'MELEES', k: 'Melees' }
  ];
  const g = panels.map(p => {
    let icons = catPicks(l, p.k).slice(0, 3).map(x => pickWrap(x, 'mc-iw')).join('');
    if (!icons) icons = '<span class="mc-empty"></span>';
    return '<section class="mc-panel"><label>' + esc(p.l) + '</label><div class="mc-icons">' + icons + '</div></section>';
  }).join('');
  /* Mosaic is panels only — the head rank and foot stat strip repeated
     rows already rendered below the preview. */
  return '<div class="mc"><div class="mc-grid">' + g + '</div></div>';
}

/* The listing ID is the title everywhere; custom name / Riot ID drop to the subline.
   The placeholder guard is the shared matcher — the old exact 'CHANGE NAME'
   compare missed the live "CHANGE NAMsE" (mixed case + typo). */
const entryTitle = l => (l.code && l.code.trim()) || l.title;
const entrySub = l => {
  const t = entryTitle(l);
  if (l.code && l.code.trim() && l.code !== t) return l.code;
  const cn = (l.title && !isPlaceholderTitle(l.title) && l.title !== t) ? l.title : '';
  return cn || ((l.vlogin && l.vlogin !== 'RIOT ID') ? l.vlogin : '');
};

function cardHTML(l, i) {
  const t = THEME_ACCENTS[l.theme] || THEME_ACCENTS.protocol;
  const rn = l.rankNow;
  const rp = l.rankPeak;
  const cover = l.thumb
    ? '<img class="gc-cover" src="' + esc(l.thumb.src) + '" alt="" loading="lazy" ' + IMGERR + '>'
    : '';
  /* Peak as an icon. prank_icon already ships in browse_listings_v3 and
     normalize() parses it; only the grid card wasted it. Listings with no
     icon (the artwork path) fall back to the name so the row never lies. */
  const peak = rp.icon
    ? '<i class="up" aria-hidden="true">&#8593;</i><img class="pk-badge" src="' + esc(rp.icon) + '" alt="Peak rank ' + esc(rp.name) + '">'
    : '<i class="up" aria-hidden="true">&#8593;</i><span class="pk">' + esc(rp.name) + '</span>';
  const amt = l.price == null
    ? '<span class="big offer">Contact for price</span>'
    : '<span class="big">' + priceText(l) + '</span>';
  return '<button type="button" class="gcard" data-slug="' + esc(l.slug) + '" data-i="' + i + '">'
    + '<div class="gc-head">'
    +   '<div class="gc-id"><span class="gc-idcode">' + esc(entryTitle(l)) + '</span>'
    +     '<span class="gc-sub">' + esc(entrySub(l)) + '</span></div>'
    +   '<div class="gc-flags">' + badgesGrid(l) + '<span class="gc-themechip">' + esc(t.label) + '</span></div>'
    + '</div>'
    + '<div class="gc-preview"' + (l.thumb ? ' data-thumb' : '') + ' data-imgwrap>'
    +   cover
    +   (l.thumb ? '' : previewInner(l, state.style))
    + '</div>'
    + '<div class="gc-ranks">' + rankImg(rn) + '<b>' + esc(rn.name) + '</b>' + peak + '</div>'
    + statChips(l)
    + trustChips(l)
    + '<div class="gc-foot"><span class="gc-amt">' + amt
    +   '<span class="sub">' + (l.negotiable ? 'open to offers' : 'fixed price') + '</span></span>'
    +   '<span class="gc-cta">View card</span>'
    + '</div></button>';
}

function rowHTML(l) {
  const rn = l.rankNow;
  const rp = l.rankPeak;
  const icons = flattenPicks(l, FEATURE_ORDER).slice(0, 2).map(pickIconWrap).join('');
  const thumbInner = l.thumb
    ? '<img class="lr-cover" src="' + esc(l.thumb.src) + '" alt="" loading="lazy" ' + IMGERR + '>'
    : '<div class="lc-icons">' + icons + '</div>';
  return '<button type="button" class="arow" data-slug="' + esc(l.slug) + '">'
    + '<div class="lr-thumb" data-imgwrap>' + thumbInner + '</div>'
    + '<div class="lr-main"><div class="lr-title"><h2>' + esc(entryTitle(l)) + '</h2><span class="lr-badges">' + badgesGrid(l) + '</span></div></div>'
    + '<div class="lr-ranks"><div class="r">' + rankImg(rn) + '<span>' + esc(rn.name) + '</span></div><div class="r">' + rankImg(rp) + '<span class="pk">PEAK ' + esc(rp.name) + '</span></div></div>'
    + '<div class="lr-chips">' + chipsList(l) + '</div>'
    + '<div class="lr-price">' + priceHTML(l) + '<span class="lc-meta">' + viewsText(l) + esc(agoText(l.daysAgo)) + '</span></div>'
    + '<div class="lr-go lc-go">View card →</div>'
    + '</button>';
}

function featHTML(l) {
  const t = THEME_ACCENTS[l.theme] || THEME_ACCENTS.protocol;
  const rn = l.rankNow;
  const rp = l.rankPeak;
  const s = l.stats;
  const sk = flattenPicks(l, FEATURE_ORDER).slice(0, 5).map(pickSrcImg).join('');
  const sym = CUR_SYMBOL[l.currency] || (l.currency ? esc(l.currency) + ' ' : '$');
  const price = l.price != null
    ? '<b>' + sym + esc(l.price) + (l.negotiable ? '<i>open to offers</i>' : '') + '</b><span>one-time · full access</span>'
    : '<b class="offer">Contact for price</b><span>' + (l.negotiable ? 'open to offers' : 'seller accepts trades') + '</span>';
  const flags = esc(l.flags.owner + ' OWNER · ' + (l.flags.wtr ? 'WTR' : 'NO-WTR') + ' · ' + (l.flags.receipts ? 'RECEIPTS' : 'NO RECEIPTS'));
  /* v1.5.2: artwork listings have no skin mosaic — the featured tile used to
     render an empty preview for them; show the owner's cover instead */
  const cover = l.thumb
    ? '<img class="gf-cover" src="' + esc(l.thumb.src) + '" alt="" loading="lazy" ' + IMGERR + '>'
    : '';
  return '<div class="gfeat" data-slug="' + esc(l.slug) + '">'
    + '<div class="gf-preview" data-imgwrap>'
    + '<span class="gf-ribbon">FEATURED</span>'
    + cover
    + (l.thumb ? '' : '<div class="gf-skins">' + sk + '</div>')
    + '<div class="gf-strip"><span>PREM ' + esc(s.premium) + '</span><span>LIM ' + esc(s.limited) + '</span><span>BP ' + esc(s.bpass) + '</span><span>LV ' + esc(s.level) + '</span></div>'
    + '<div class="gf-ranks"><span class="gfr">' + rankImg(rn) + '<b>' + esc(rn.name) + '</b></span><span class="gfr">' + rankImg(rp) + '<b>PEAK ' + esc(rp.name) + '</b></span></div>'
    + '</div>'
    + '<div class="gf-info">'
    + '<span class="gf-theme">' + esc(t.label) + '</span>'
    + '<div class="gf-trow"><h2>' + esc(entryTitle(l)) + '</h2>' + pslotHTML(l) + '</div>'
    + '<div class="gf-seller">' + img(AVATAR_PLACEHOLDER, 'Seller avatar') + '<div><b>' + esc(l.seller.name) + '</b><span>' + flags + '</span></div></div>'
    + '<div class="gf-rankrow">' + rankImg(rn) + '<span>' + esc(rn.name) + '</span><i>·</i><span class="m">PEAK ' + esc(rp.name) + '</span></div>'
    + '<div class="gf-price">' + price + '</div>'
    + '<div class="gf-meta">' + esc(l.views) + (Number(l.views) === 1 ? ' VIEW · UPDATED ' : ' VIEWS · UPDATED ') + esc(agoText(l.daysAgo).toUpperCase()) + '</div>'
    + '<button type="button" class="gf-cta" data-slug="' + esc(l.slug) + '">View full card →</button>'
    + '</div></div>';
}

function ctaHTML() {
  if (!isSeller) return '';
  return '<a class="cta-tile" href="build.html?new=1">'
    + '<b>Your card could hang here</b>'
    + '<span>Publish a showcase card and it appears on this floor instantly.</span>'
    + '<span class="ct-link">Build your card →</span>'
    + '</a>';
}

// ── filtering, sorting, render ────────────────────────────────────
function applyView() {
  const grid = $('grid');
  const list = $('list');
  const empty = $('empty');
  const statebox = $('statebox');
  const zero = !empty.hidden || !statebox.hidden;
  grid.hidden = zero || state.view !== 'grid';
  list.hidden = zero || state.view !== 'list';
  $('vGrid').setAttribute('aria-pressed', state.view === 'grid' ? 'true' : 'false');
  $('vList').setAttribute('aria-pressed', state.view === 'list' ? 'true' : 'false');
}

function applyStyle() {
  document.querySelectorAll('.cardtog button').forEach(b => {
    b.setAttribute('aria-pressed', b.getAttribute('data-style') === state.style ? 'true' : 'false');
  });
}

function matches(l, skip) {
  if (state.q && skip !== 'q') {
    const q = state.q.toLowerCase();
    /* CF-29: the matcher used to cover title/code/seller/vlogin only —
       searching "reaver" found nothing even when cards showed Reaver skins */
    const skinNames = Object.values(l.picks_top || {})
      .flat()
      .map(p => p && (p.name || '')).filter(Boolean);
    const hay = (l.title + ' ' + l.code + ' ' + l.seller.name + ' ' + l.vlogin
      + ' ' + skinNames.join(' ')).toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (skip !== 'themes' && state.themes.size && !state.themes.has(l.theme)) return false;
  if (skip !== 'rank' && state.minRank) {
    const need = RANK_THRESHOLDS[state.minRank];
    if (!need || l.rankNow.tier < need) return false;
  }
  if (skip !== 'price' && state.price) {
    const p = l.price;
    if (state.price === 'off') { if (p !== null) return false; }
    else if (p === null) return false;
    else if (state.price === 'u1000' && !(p < 1000)) return false;
    else if (state.price === 'r3000' && !(p >= 1000 && p < 3000)) return false;
    else if (state.price === 'r6000' && !(p >= 4000 && p < 6000)) return false;
    else if (state.price === 'r10000' && !(p >= 7000 && p <= 10000)) return false;
  }
  if (skip !== 'flags' && state.flags.size) {
    if (state.flags.has('noissue') && !l.flags.wtr) return false;
    if (state.flags.has('issues') && !l.flags.wtrIssues) return false;
    if (state.flags.has('premunl') && !l.flags.premierUnlinked) return false;
  }
  return true;
}

function cmpPrice(a, b, dir) {
  if (a.price == null && b.price == null) return 0;
  if (a.price == null) return 1;
  if (b.price == null) return -1;
  return dir * (a.price - b.price);
}

function cmp(a, b) {
  if (state.sort === 'views') return b.views - a.views;
  if (state.sort === 'skins') return b.stats.skins - a.stats.skins;
  if (state.sort === 'price-asc') return cmpPrice(a, b, 1);
  if (state.sort === 'price-desc') return cmpPrice(a, b, -1);
  return a.daysAgo - b.daysAgo;
}

function featuredListing() {
  /* v1.3: the owner's pinned listing wins the feature tile. With nothing
     pinned (or on the v2 fallback, which has no `featured` column) the
     most-views heuristic below is unchanged. */
  const pinned = listings.find(l => l.featured);
  if (pinned) return pinned;
  let best = null;
  listings.forEach(l => {
    if (!best || l.views > best.views || (l.views === best.views && l.daysAgo < best.daysAgo)) best = l;
  });
  return best;
}

function render() {
  const feature = $('feature');
  const grid = $('grid');
  const list = $('list');
  const empty = $('empty');
  const feat = featuredListing();
  /* v1.5.5: the featured listing now also renders in the grid/list — a listing
     that only existed as the big tile read as "gone" to sellers scanning the
     grid, which is exactly the vanish report. Count matches what's scannable. */
  const fRest = listings.filter(matches).sort(cmp);
  hideStateBox();
  const featVis = !!(feat && matches(feat));
  const total = fRest.length;
  $('count').textContent = total + (total === 1 ? ' listing' : ' listings');
  /* CF-30: facet counts update on every render — the zero-result early
     return below used to skip them, so the sidebar froze mid-filter */
  themeCounts();
  priceCounts();
  rankCounts();
  flagCounts();
  syncFilterChips();
  if (total === 0) {
    feature.hidden = true;
    feature.innerHTML = '';
    grid.innerHTML = '';
    list.innerHTML = '';
    empty.hidden = false;
    applyView();
    return;
  }
  empty.hidden = true;
  if (featVis) {
    feature.hidden = false;
    feature.innerHTML = featHTML(feat);
    setThemeVars(feature.querySelector('.gfeat'), feat.theme);
  } else {
    feature.hidden = true;
    feature.innerHTML = '';
  }
  grid.innerHTML = fRest.map((l, i) => cardHTML(l, i)).join('') + (total < 12 ? ctaHTML() : '') + moreBar();
  list.innerHTML = fRest.map(rowHTML).join('') + moreBar();
  const lmb = document.getElementById('loadMoreBtn');
  if (lmb) lmb.addEventListener('click', loadMore);
  document.querySelectorAll('#grid .gcard').forEach(el => {
    const l = bySlug[el.getAttribute('data-slug')];
    if (l) setThemeVars(el, l.theme);
    el.style.setProperty('--i', el.getAttribute('data-i'));
  });
  document.querySelectorAll('#list .arow').forEach(el => {
    const l = bySlug[el.getAttribute('data-slug')];
    if (l) setThemeVars(el, l.theme);
  });
  applyView();
}

/* CF-04 + CF-17: failure and emptiness are rendered states, not a blank
   page or a 5-second toast. #statebox so #empty's #clearBtn survives. */
function stateBox(html) {
  const sb = $('statebox');
  sb.hidden = false;
  sb.innerHTML = html;
  $('empty').hidden = true;
  applyView();
  return sb;
}
function hideStateBox() { $('statebox').hidden = true; }

function renderError(detail) {
  $('count').textContent = '—';
  status('Could not load the marketplace.', 'err');
  $('feature').hidden = true;
  $('feature').innerHTML = '';
  $('grid').innerHTML = '';
  $('list').innerHTML = '';
  const sb = stateBox(
    '<b>Could not load the marketplace</b>' +
    '<span>The listing service did not answer. Nothing was lost — your cards and drafts live in this browser.</span>' +
    (detail ? '<code>' + String(detail).slice(0, 140).replace(/[<>]/g, '') + '</code>' : '') +
    '<span class="sb-actions"><button type="button" class="sbtn primary">Try again</button>' +
    (isSeller ? '<a class="sbtn" href="build.html?new=1">Build a card instead</a>' : '') +
    '</span>');
  sb.querySelector('.primary').addEventListener('click', load);
}

function showCtaOnly() {  $('count').textContent = '0 listings';
  $('feature').hidden = true;
  $('feature').innerHTML = '';
  $('grid').innerHTML = '';
  $('list').innerHTML = '';
  /* CF-17: a persistent empty state that explains itself, not a promo tile
     plus a toast that fades in 5s and leaves the page unexplained */
  stateBox(
    '<b>No listings yet</b>' +
    '<span>This is the very first day — the marketplace is empty but not broken. The moment anyone publishes, their card appears here.</span>' +
    (isSeller ? '<span class="sb-actions"><a class="sbtn primary" href="build.html?new=1">Build the first card</a></span>' : ''));
}

function resetAll() {
  state.q = '';
  state.themes = new Set();
  state.minRank = '';
  state.price = '';
  state.flags = new Set();
  state.sort = 'new';
  $('q').value = '';
  document.querySelectorAll('#aside input[type=checkbox]').forEach(cb => { cb.checked = false; });
  const mr = document.querySelector('#fRank input[value=""]');
  if (mr) mr.checked = true;
  const pr = document.querySelector('#fPrice input[value=""]');
  if (pr) pr.checked = true;
  $('sort').value = 'new';
  render();
}

// ── pulse ─────────────────────────────────────────────────────────
function buildPulse() {
  let views = 0;
  let skinsTotal = 0;
  listings.forEach(l => { views += l.views; skinsTotal += l.stats.skins; });
  const prices = listings.filter(l => l.price != null).map(l => l.price);
  const avg = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
  /* CF-16: the pulse row's average uses the listings' dominant currency
     instead of a hardcoded $ over mixed-currency data */
  const curTally = {};
  listings.filter(l => l.price != null).forEach(l => { curTally[l.currency || 'USD'] = (curTally[l.currency || 'USD'] || 0) + 1; });
  const domCur = Object.entries(curTally).sort((a, b) => b[1] - a[1])[0]?.[0] || 'USD';
  const domSym = CUR_SYMBOL[domCur] || domCur + ' ';
  const sellers = {};
  listings.forEach(l => { sellers[l.seller.name] = 1; });
  const cells = [
    { v: listings.length, label: 'LISTINGS', prefix: '' },
    { v: views, label: 'TOTAL VIEWS', prefix: '' },
    { v: skinsTotal, label: 'SKINS TRACKED', prefix: '' },
    prices.length ? { v: avg, label: 'AVG PRICE' + (domCur !== 'USD' ? ' (' + domCur + ')' : ''), prefix: domSym } : { text: '—', label: 'AVG PRICE' },
    { v: Object.keys(sellers).length, label: 'SELLERS', prefix: '' }
  ];
  $('pulse').innerHTML = cells.map(c => {
    if (c.text != null) return '<div class="pcell"><b>' + esc(c.text) + '</b><label>' + esc(c.label) + '</label></div>';
    return '<div class="pcell"><b data-count="' + esc(c.v) + '" data-prefix="' + esc(c.prefix) + '">' + esc(c.prefix + '0') + '</b><label>' + esc(c.label) + '</label></div>';
  }).join('');
}

function countUp() {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('#pulse [data-count]').forEach(el => {
    const target = Number(el.getAttribute('data-count')) || 0;
    const prefix = el.getAttribute('data-prefix') || '';
    if (reduce || target === 0) { el.textContent = prefix + target.toLocaleString('en-US'); return; }
    const start = Date.now();
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / 600);
      el.textContent = prefix + Math.round(target * p).toLocaleString('en-US');
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function skeleton() {
  $('feature').innerHTML = '<div class="sk sk-feat" aria-hidden="true"></div>';
  let out = '';
  for (let i = 0; i < 8; i++) out += '<div class="sk" aria-hidden="true"></div>';
  $('grid').innerHTML = out;
}

// ── quick-view modal (REAL card) ──────────────────────────────────
function pickLevel(p) { return Number(p.level) || 1; }
function skinCell(s) {
  const lv = pickLevel(s);
  const label = (pickWeapon(s) || '') + ' — ' + (pickName(s) || '') + (lv >= 2 ? ' · LV' + lv : '') + (s.variant ? ' · ' + s.variant.name : '');
  return '<span class="skin"><img src="' + esc(pickIcon(s)) + '" alt="' + esc(label) + '" title="' + esc(label) + '">' + (lv >= 2 ? '<i class="lv">LV' + lv + '</i>' : '') + '</span>';
}

/* QV-T: phone quick-view swaps the unreadable 0.19× card for a tier-ordered
   hero-skin thumb strip; above 700px nothing changes. */
const TIER_RANK = { exclusive: 5, ultra: 4, premium: 3, deluxe: 2, select: 1 };
function tierKey(t) { return (String(t || '').toLowerCase().match(/exclusive|ultra|premium|deluxe|select/) || [''])[0]; }
function heroThumbs(picks) {
  return ALL_CATS.flatMap(cat => (picks && picks[cat]) || [])
    .map((s, i) => ({ s, i, rank: TIER_RANK[tierKey(s.tier)] || 0 }))
    .sort((a, b) => b.rank - a.rank || a.i - b.i)
    .slice(0, 6)
    .map(x => ({ name: pickName(x.s) || pickWeapon(x.s) || 'Skin', weapon: pickWeapon(x.s), icon: pickIcon(x.s), tier: tierKey(x.s.tier) }));
}

function renderThumbs(picks, slug) {
  const artImg = qv.querySelector('.qv-art');
  if (artImg && !artImg.hidden) return;
  const stage = qv.querySelector('.qv-stage');
  if (!stage) return;
  const bar = qv.querySelector('.qv-bar');
  let box = qv.querySelector('.qv-thumbs');
  if (innerWidth > 700) {
    stage.hidden = false;
    if (box) { box.innerHTML = ''; box.hidden = true; }
    return;
  }
  stage.hidden = true;
  if (!box) {
    box = document.createElement('div');
    box.className = 'qv-thumbs';
    if (bar && bar.parentNode) bar.parentNode.insertBefore(box, bar);
    else qv.querySelector('.qv-modal').appendChild(box);
  }
  const thumbs = heroThumbs(picks);
  if (!thumbs.length) { box.innerHTML = ''; box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = thumbs.map(t => '<a class="qv-thumb" href="view.html?slug=' + encodeURIComponent(slug) + '" data-tier="' + esc(t.tier) + '">'
    + '<img loading="lazy" src="' + esc(t.icon) + '" alt="' + esc(t.weapon + ' — ' + t.name) + '">'
    + '<span>' + esc(t.name) + '</span></a>').join('');
}

function resetCard() {
  const card = $('card');
  card.querySelectorAll('[data-key]').forEach(el => { el.textContent = CARD_DEFAULTS.get(el) ?? ''; });
  ALL_CATS.forEach(cat => {
    const slots = card.querySelector('.panel[data-cat="' + cat + '"] .slots');
    if (slots) slots.innerHTML = '';
  });
  const box = card.querySelector('.charms-box');
  if (box) box.innerHTML = '<span class="hint">No buddies added</span>';
  const pcard = card.querySelector('.pcard');
  if (pcard) {
    pcard.style.backgroundImage = '';
    pcard.innerHTML = '<span class="hint">Player card</span>';
  }
  const avatar = card.querySelector('.avatar');
  if (avatar) avatar.src = AVATAR_PLACEHOLDER;
  const wmSlug = card.querySelector('[data-wm="slug"]');
  if (wmSlug) wmSlug.textContent = '';
  const wmStamp = card.querySelector('[data-wm="stamp"]');
  if (wmStamp) wmStamp.textContent = '';
}

function fillCard(payload, slug) {
  resetCard();
  const card = $('card');
  const texts = payload.texts || {};
  card.querySelectorAll('[data-key]').forEach(el => {
    const v = texts[el.dataset.key];
    if (v != null && v !== '') el.textContent = v;
  });

  const ranks = payload.ranks || {};
  ['crank', 'prank'].forEach(key => {
    const row = card.querySelector('.rankrow[data-rank="' + key + '"]');
    if (!row) return;
    const badge = row.querySelector('.rankbadge');
    const src = ranks[key];
    if (typeof src === 'string' && src) badge.src = src;
    else badge.removeAttribute('src');
  });

  const picks = payload.picks || {};
  ALL_CATS.forEach(cat => {
    const slots = card.querySelector('.panel[data-cat="' + cat + '"] .slots');
    if (!slots) return;
    const skins = picks[cat] || [];
    slots.innerHTML = skins.length ? skins.map(skinCell).join('') : '<div class="slotbox empty"></div>';
  });

  const assets = payload.assets || {};
  const avatar = card.querySelector('.avatar');
  if (assets.avatar) avatar.src = assets.avatar;
  else avatar.src = AVATAR_PLACEHOLDER;

  if (assets.pcard) {
    const pcard = card.querySelector('.pcard');
    pcard.style.backgroundImage = 'url("' + assets.pcard + '")';
    const hint = pcard.querySelector('.hint');
    if (hint) hint.remove();
  }

  if (assets.buddies && assets.buddies.length) {
    const box = card.querySelector('.charms-box');
    const hint = box.querySelector('.hint');
    if (hint) hint.remove();
    assets.buddies.forEach(url => {
      if (typeof url !== 'string' || !url) return;
      const b = new Image();
      b.src = url;
      b.alt = 'Gun buddy';
      box.appendChild(b);
    });
  }

  const wmSlug = card.querySelector('[data-wm="slug"]');
  if (wmSlug) wmSlug.textContent = 'Listing ' + slug;
  const wmStamp = card.querySelector('[data-wm="stamp"]');
  if (wmStamp) wmStamp.textContent = new Date().toISOString().slice(0, 10);

  qvPicks = picks;
  qvSlug = slug;
  renderThumbs(qvPicks, qvSlug);
}

function setQvArt(src) {
  const sizer = qv.querySelector('.qv-sizer');
  let img = qv.querySelector('.qv-art');
  if (!src) {
    if (img) img.hidden = true;
    if (sizer) sizer.style.display = '';
    return;
  }
  if (!img) {
    img = document.createElement('img');
    img.className = 'qv-art';
    img.alt = '';
    img.addEventListener('error', () => { img.hidden = true; if (sizer) sizer.style.display = ''; });
    const stage = qv.querySelector('.qv-stage');
    if (stage) stage.appendChild(img);
  }
  img.src = src;
  img.hidden = false;
  if (sizer) sizer.style.display = 'none';
  const stage = qv.querySelector('.qv-stage');
  if (stage) stage.hidden = false;
}

function fitCard() {
  if (qv.hidden) return;
  const stage = qv.querySelector('.qv-stage');
  if (stage.hidden) return; /* QV-T: phone thumbs replace the scaled card */
  const sizer = qv.querySelector('.qv-sizer');
  const card = $('card');
  if (!stage || !sizer || !card) return;
  const w = stage.clientWidth;
  if (!w) return;
  const s = w / DESIGN_W;
  sizer.style.width = DESIGN_W * s + 'px';
  sizer.style.height = DESIGN_H * s + 'px';
  card.style.transform = 'scale(' + s + ')';
}

function fillBar(l, slug) {
  const bar = qv.querySelector('.qv-bar');
  bar.querySelector('#qvTitle').textContent = entryTitle(l);
  bar.querySelector('.qv-code').textContent = entrySub(l);
  bar.querySelector('.qv-meta').textContent = l.views + ' VIEWS · UPDATED ' + agoText(l.daysAgo).toUpperCase() + ' · ' + l.seller.name;
  const price = bar.querySelector('.qv-price');
  const offer = bar.querySelector('.qv-offer');
  if (l.price != null) {
    price.textContent = (CUR_SYMBOL[l.currency] || l.currency || '$') + l.price;
    price.hidden = false;
    offer.hidden = true;
  } else {
    price.hidden = true;
    offer.hidden = false;
    offer.textContent = 'CONTACT FOR PRICE';
  }
  bar.querySelector('.qv-cta').setAttribute('href', 'view.html?slug=' + encodeURIComponent(slug));
  $('qvContact').hidden = true;
}

async function loadFull(slug) {
  if (!supabase) {
    status('Could not load full listing.', 'err');
    return;
  }
  try {
    const { data, error } = await supabase.from('listing_public').select('*').eq('slug', slug).maybeSingle();
    if (error) throw error;
    if (!data) {
      /* blank the placeholder card so a dead deep link never shows fake data */
      fillCard({ picks: {}, texts: {} }, slug);
      setQvArt(null);
      $('card').dataset.theme = 'protocol';
      fitCard();
      $('qvContact').hidden = true;
      status('Could not load full listing.', 'err');
      return;
    }
    const payload = data.payload || {};
    const artSrc = payload.thumb && typeof payload.thumb.src === 'string' && payload.thumb.src.startsWith('https://') ? payload.thumb.src : null;
    setQvArt(artSrc);
    if (!artSrc) {
      fillCard(payload, slug);
      $('card').dataset.theme = data.theme || payload.theme || 'protocol';
      fitCard();
    }
    const link = (payload.texts && payload.texts.link ? payload.texts.link : '').trim();
    const contact = $('qvContact');
    if (/^https?:\/\//.test(link)) {
      contact.hidden = false;
      contact.onclick = () => window.open(link, '_blank', 'noopener');
    }
  } catch {
    status('Could not load full listing.', 'err');
  }
}

function openQV(slug, opener) {
  const l = bySlug[slug];
  if (!l) { /* CF-17: a dead deep link says so instead of doing nothing */ 
    if (slug) status('That listing is not available — it may have been removed or sold.', 'err');
    return; }
  qvLastFocus = opener || null;
  /* QV-F: never flash the previous listing while loading */
  const stage = qv.querySelector('.qv-stage'); if (stage) stage.hidden = true;
  const box = qv.querySelector('.qv-thumbs'); if (box) { box.innerHTML = ''; box.hidden = true; }
  qv.hidden = false;
  $('card').classList.add('is-live'); /* live surface: categories scroll instead of clipping */
  document.body.classList.add('modal-open');
  if (qvClose) qvClose.focus();
  fillBar(l, slug);
  setQvArt(l.thumb ? l.thumb.src : null);
  fitCard();
  loadFull(slug);
}

function closeQV() {
  if (qv.hidden) return;
  qv.hidden = true;
  setQvArt(null);
  document.body.classList.remove('modal-open');
  if (qvLastFocus && qvLastFocus.focus) qvLastFocus.focus();
  if (location.search.indexOf('slug=') !== -1) window.history.replaceState(null, '', location.pathname + location.hash);
}

// ── wiring ────────────────────────────────────────────────────────
function wire() {
  /* CF-29: debounce — every keystroke used to re-render the featured tile,
     the whole grid, the list and all facet counts */
  let qTimer = null;
  $('q').addEventListener('input', e => {
    state.q = e.target.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(render, 140);
  });
  document.querySelectorAll('#fTheme input').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.themes.add(cb.value); else state.themes.delete(cb.value);
      render();
    });
  });
  document.querySelectorAll('#fFlags input').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.flags.add(cb.value); else state.flags.delete(cb.value);
      render();
    });
  });
  document.querySelectorAll('#fRank input[name="minrank"]').forEach(r => {
    r.addEventListener('change', () => { if (r.checked) { state.minRank = r.value; render(); } });
  });
  document.querySelectorAll('#fPrice input[name="price"]').forEach(r => {
    r.addEventListener('change', () => { if (r.checked) { state.price = r.value; render(); } });
  });
  $('sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
  $('vGrid').addEventListener('click', () => { state.view = 'grid'; applyView(); });
  $('vList').addEventListener('click', () => { state.view = 'list'; applyView(); });
  document.querySelectorAll('.cardtog button').forEach(b => {
    b.addEventListener('click', () => {
      state.style = b.getAttribute('data-style');
      localStorage.setItem('cf-card-style', state.style);
      applyStyle();
      render();
    });
  });
  $('clearAll').addEventListener('click', resetAll);
  $('clearBtn').addEventListener('click', resetAll);
  /* removing a chip re-drives the real input so state + counts stay honest */
  $('fchips').addEventListener('click', e => {
    const b = e.target.closest('.fchip');
    if (!b) return;
    const facet = b.dataset.facet, value = b.dataset.value;
    if (facet === 'theme' || facet === 'flag') {
      const cb = document.querySelector((facet === 'theme' ? '#fTheme' : '#fFlags') + ' input[value="' + value + '"]');
      if (cb) { cb.checked = false; cb.dispatchEvent(new window.Event('change')); }
    } else {
      const any = document.querySelector((facet === 'minrank' ? '#fRank' : '#fPrice') + ' input[value=""]');
      if (any) { any.checked = true; any.dispatchEvent(new window.Event('change')); }
    }
  });
  $('filtersBtn').addEventListener('click', () => {
    const open = document.body.classList.toggle('drawer');
    $('scrim').hidden = !open;
  });
  $('scrim').addEventListener('click', () => {
    document.body.classList.remove('drawer');
    $('scrim').hidden = true;
  });

  if (qvClose) qvClose.addEventListener('click', closeQV);
  qv.addEventListener('click', e => { if (e.target === qv) closeQV(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !qv.hidden) closeQV(); });
  document.addEventListener('click', e => {
    /* .gfeat (the featured tile wrapper) carries data-slug too — the whole
       tile is the affordance, not just the bottom button */
    const t = e.target.closest('.gcard,.arow,.gf-cta,.gfeat');
    if (!t) return;
    if (t.classList.contains('gfeat') && e.target.closest('button:not(.gf-cta)')) return;
    const slug = t.getAttribute('data-slug');
    if (!slug || !bySlug[slug]) return;
    e.preventDefault();
    openQV(slug, t);
  });
  window.addEventListener('resize', () => {
    if (qv.hidden || qvResizePending) return;
    qvResizePending = true;
    requestAnimationFrame(() => { qvResizePending = false; renderThumbs(qvPicks, qvSlug); fitCard(); });
  });
}

async function loadMore() {
  if (!hasMore || !supabase) return;
  const btn = document.getElementById('loadMoreBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  try {
    const rows = await fetchPage(shownCount);
    rows.map(normalize).forEach(l => {
      if (!bySlug[l.slug]) { listings.push(l); bySlug[l.slug] = l; }
    });
    shownCount = listings.length;
    render();
    status(shownCount + ' listings loaded.', 'ok');
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Load more'; }
    status('Could not load more listings — ' + (e.message || e), 'err');
  }
}

// ── data load ─────────────────────────────────────────────────────
/* CF-18: the RPC caps at p_limit 60 by default and the caller used to pass
   no arguments — listings past 60 were never fetched, with no indication.
   Now we page through with p_offset and disclose exactly what is shown. */
const PAGE_SIZE = 60;
let shownCount = 0;
let hasMore = false;

// ── v1.5: seller chrome + login modal (the marketplace is the front door) ──
async function probeSeller() {
  try { const { data } = await supabase.rpc('am_i_seller'); return data === true; } catch { return false; }
}

function applySellerChrome() {
  const navLogin = $('navLogin');
  const navNew = $('navNewCard');
  const navDash = $('navDashboard');
  const navOut = $('navSignOut');
  const navMore = $('navMoreM');
  if (navLogin) navLogin.hidden = isSeller;
  if (navNew) navNew.hidden = !isSeller;
  if (navDash) navDash.hidden = !isSeller;
  if (navOut) navOut.hidden = !isSeller;
  if (navMore) {
    navMore.hidden = !isSeller;
    if (!isSeller) $('navMoreMenuM').hidden = true;
  }
}

function initLoginModal() {
  const modal = $('loginModal');
  if (!modal || !supabase) return;
  const form = $('lgForm'), sent = $('lgSent'), signed = $('lgSigned');
  const email = $('lgEmail'), pass = $('lgPass'), send = $('lgSend');
  const otp = $('lgOtp'), msg = $('lgMsg');
  if (MAGIC && otp) otp.hidden = false;

  function setMsg(text, isErr) {
    msg.textContent = text || '';
    msg.className = isErr ? 'lg-msg err' : 'lg-msg';
  }
  function show(which) {
    form.hidden = which !== 'form';
    sent.hidden = which !== 'sent';
    signed.hidden = which !== 'signed';
  }

  let lastFocus = null;
  async function open() {
    lastFocus = document.activeElement;
    show('form');
    setMsg('');
    pass.value = '';
    modal.hidden = false;
    if (!window.matchMedia('(pointer: coarse)').matches) {
      try { email.focus({ preventScroll: true }); } catch { /* older browsers */ }
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (session && !isSeller) {
      // signed in but not allow-listed: explained state, not a bare form
      show('signed');
      $('lgWho').textContent = (session.user && session.user.email) || 'your account';
      try { $('lgOut').focus({ preventScroll: true }); } catch { /* older browsers */ }
    }
  }
  function close() {
    modal.hidden = true;
    if (lastFocus && lastFocus.focus) {
      try { lastFocus.focus({ preventScroll: true }); } catch { /* older browsers */ }
    }
  }

  const navLogin = $('navLogin');
  if (navLogin) navLogin.addEventListener('click', open);
  $('lgClose').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });

  /* a11y: keep Tab cycling inside the modal while it is open */
  modal.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || modal.hidden) return;
    const focusables = Array.from(modal.querySelectorAll('input:not([disabled]),button:not([disabled]),a[href]'))
      .filter(el => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  const sendLabel = send.textContent;
  const otpLabel = otp ? otp.textContent : '';

  send.addEventListener('click', async () => {
    const em = email.value.trim();
    if (!EMAIL_RE.test(em)) { setMsg('Enter a valid email address.', true); return; }
    if (!pass.value) { setMsg('Enter your password.', true); return; }
    send.disabled = true;
    send.textContent = 'Signing in…';
    setMsg('');
    const { error } = await supabase.auth.signInWithPassword({ email: em, password: pass.value });
    pass.value = '';
    if (error) {
      send.disabled = false;
      send.textContent = sendLabel;
      setMsg(/invalid login credentials/i.test(error.message || '')
        ? 'Wrong email or password.'
        : /email not confirmed/i.test(error.message || '')
          ? 'That account still needs to be confirmed by the marketplace owner.'
          : 'Sign-in failed: ' + (error.message || 'unknown error'), true);
      return;
    }
    // success: sellers land on the dashboard; everyone else gets the explained state
    setMsg('Checking seller access…');
    isSeller = await probeSeller();
    applySellerChrome();
    if (isSeller) { location.href = 'dashboard.html'; return; }
    send.disabled = false;
    send.textContent = sendLabel;
    const { data: { session } } = await supabase.auth.getSession();
    show('signed');
    $('lgWho').textContent = (session && session.user && session.user.email) || em;
    try { $('lgOut').focus({ preventScroll: true }); } catch { /* older browsers */ }
  });

  if (otp) otp.addEventListener('click', async () => {
    const em = email.value.trim();
    if (!EMAIL_RE.test(em)) { setMsg('Enter a valid email address.', true); return; }
    otp.disabled = true;
    otp.textContent = 'Sending link…';
    setMsg('');
    const { error } = await supabase.auth.signInWithOtp({ email: em, options: { emailRedirectTo: location.origin + location.pathname } });
    otp.disabled = false;
    otp.textContent = otpLabel;
    if (error) {
      setMsg(/security purposes|rate limit/i.test(error.message || '')
        ? 'Too many requests — wait a minute and try again.'
        : 'Sign-in link failed: ' + (error.message || 'unknown error'), true);
      return;
    }
    show('sent');
  });

  $('lgBack').addEventListener('click', () => { show('form'); setMsg(''); });

  const signOut = async () => {
    await supabase.auth.signOut();
    location.reload();
  };
  $('lgOut').addEventListener('click', signOut);
  const navOut = $('navSignOut');
  if (navOut) navOut.addEventListener('click', signOut);
  const mSignOut = $('mSignOut');
  if (mSignOut) mSignOut.addEventListener('click', signOut);

  /* mobile More ▾ overflow (CF-05 pattern): My accounts + Sign out on phones */
  const moreM = $('navMoreM'), moreMenuM = $('navMoreMenuM');
  if (moreM && moreMenuM) {
    const setM = open => {
      moreMenuM.hidden = !open;
      moreM.setAttribute('aria-expanded', String(open));
    };
    moreM.addEventListener('click', e => { e.stopPropagation(); setM(moreMenuM.hidden); });
    document.addEventListener('click', e => {
      if (!moreMenuM.hidden && !moreMenuM.contains(e.target) && e.target !== moreM) setM(false);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !moreMenuM.hidden) setM(false); });
    moreMenuM.querySelectorAll('a,button').forEach(i => i.addEventListener('click', () => setM(false)));
  }
}

async function fetchPage(offset) {
  /* v1.3: prefer browse_listings_v3 (adds `featured`); if migration 10 is not
     applied yet the RPC errors — fall back to v2 so browse behaves exactly as
     before. Same ladder as the v2 -> browse_listings fallback in load(). */
  let res = await supabase.rpc('browse_listings_v3', { p_limit: PAGE_SIZE + 1, p_offset: offset });
  if (res.error) res = await supabase.rpc('browse_listings_v2', { p_limit: PAGE_SIZE + 1, p_offset: offset });
  if (res.error) throw res.error;
  const rows = res.data || [];
  hasMore = rows.length > PAGE_SIZE;
  return rows.slice(0, PAGE_SIZE);
}

function moreBar() {
  if (!hasMore) return '';
  return '<div class="morebar">showing ' + shownCount + ' of more'
    + (hasMore ? ' · <button type="button" class="sbtn2" id="loadMoreBtn">Load more</button>' : '')
    + '</div>';
}

async function load(silent) {
  if (!supabase) {
    status('Browse needs Supabase configured — see SETUP.md.', 'err');
    return;
  }
  /* v1.5 magic-link return: supabase-js exchanges the URL code asynchronously —
     hold the seller probe until the session lands (≤4s) so a returning seller
     is recognised (and forwarded to the dashboard) instead of flashing the
     anonymous chrome. */
  if (!silent && (location.search.includes('code=') || location.hash.includes('access_token'))) {
    await Promise.race([
      new Promise(resolve => { supabase.auth.onAuthStateChange(() => resolve()); }),
      new Promise(resolve => setTimeout(resolve, 4000))
    ]);
  }
  isSeller = await probeSeller();
  applySellerChrome();
  if (isSeller && !silent && (location.search.includes('code=') || location.hash.includes('access_token'))) {
    location.replace('dashboard.html');
    return;
  }
  if (!silent) status('Loading listings…');
  let data = null;
  let limited = false;
  try {
    data = await fetchPage(0);
  } catch {
    try {
      const res = await supabase.rpc('browse_listings');
      if (res.error) throw res.error;
      data = (res.data || []).map(r => ({
        slug: r.slug, title: r.title, code: r.code, theme: r.theme,
        views: r.views, skins: r.skins, updated_at: r.updated_at,
        price: null, negotiable: false,
        featured: false,
        prems: null, limited: null, bpass: null, level: null,
        vp: null, rp: null, kc: null,
        crank_name: '', prank_name: '', crank_icon: '', prank_icon: '',
        vlogin: '', tag: '', link: '', wtr: '', receipts: '', owner: '', picks_top: {}
      }));
      hasMore = false;
      limited = true;
    } catch (e2) {
      /* CF-04: a fetch failure must render an error state, not a blank page.
         The catch used to return before render() — count empty, results
         empty, empty-state still hidden. */
      renderError(e2 && e2.message ? e2.message : 'Could not reach the listings service.');
      return;
    }
  }
  listings = data.map(normalize);
  listings.forEach(l => { bySlug[l.slug] = l; });
  shownCount = listings.length;
  buildPulse();
  countUp();
  if (!listings.length) {
    status('No listings yet.', 'info');
    showCtaOnly();
    return;
  }
  status(listings.length + ' listing(s) available.', 'ok');
  if (limited) status('Limited data — run migration 6_browse_listings_v2.sql', 'err');
  if (!silent) skeleton();
  if (silent) render();
  else setTimeout(() => {
    render();
    if (deepSlug) openQV(deepSlug, null);
  }, 400);
}

// ── boot ──────────────────────────────────────────────────────────
buildFacets();
wire();
initLoginModal();
const savedStyle = localStorage.getItem('cf-card-style');
if (savedStyle === 'mini' || savedStyle === 'rail') state.style = savedStyle;
applyStyle();
load();

/* v1.5.5: a marketplace tab left open in the background kept serving its
   boot-time snapshot — a seller publishing in another tab switched back and
   their fresh listing was "gone" until a manual reload. Re-fetch when the
   tab becomes visible again, but only after it was hidden a while. */
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  if (!hiddenAt || Date.now() - hiddenAt < 60000) return;
  hiddenAt = 0;
  load(true);
});

initDisclaimerCollapse();
initStatusDismiss();
