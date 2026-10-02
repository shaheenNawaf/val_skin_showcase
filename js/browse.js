// CardForge browse — Direction-D marketplace over live Supabase listings.
// Summary cards come from browse_listings_v2 (legacy browse_listings as a
// fallback); the quick-view modal carries the REAL shared.css #card.
import { esc, $, status, initDisclaimerCollapse, ALL_CATS, DESIGN_W, DESIGN_H } from './shared.js';

const CONFIG = window.CARDFORGE_CONFIG || {};
let supabase = null;
if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && window.supabase) {
  supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}

const AVATAR_PLACEHOLDER = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='100%25' height='100%25' fill='%232A3540'/><circle cx='32' cy='25' r='11' fill='%23768390'/><rect x='14' y='40' width='36' height='19' rx='6' fill='%23768390'/></svg>";

const IMGERR = "onerror=\"this.closest('[data-imgwrap]')?.setAttribute('data-imgfail','1')\"";

const THEME_ACCENTS = {
  protocol: { label: 'PROTOCOL', bg: '#0F1923', panel: '#1F2731', accent: '#FF4655', ink: '#ECE8E1', mut: '#8A99A9' },
  holo: { label: 'HOLO', bg: '#04101A', panel: '#0A1E30', accent: '#46F6FF', ink: '#DFF6FF', mut: '#7E9CB2' },
  reaver: { label: 'REAVER', bg: '#0D0A14', panel: '#180F2A', accent: '#B44BFF', ink: '#EFE9FF', mut: '#9D92BA' },
  oni: { label: 'ONI', bg: '#120B0B', panel: '#201114', accent: '#FF5540', ink: '#F5E9DC', mut: '#AF9889' },
  arctic: { label: 'ARCTIC', bg: '#DAD5CB', panel: '#F2EEE6', accent: '#C22E3C', ink: '#0F1923', mut: '#525D6B' }
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
function pickLevel(p) { return Number(p.level) || 1; }
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

function tierFor(l) {
  let maxLv = 0;
  Object.values(l.picks || {}).forEach(arr => {
    if (!Array.isArray(arr)) return;
    arr.forEach(p => { const lv = Number(p.level) || 0; if (lv > maxLv) maxLv = lv; });
  });
  if (maxLv >= 4) return 'ultra';
  if (maxLv === 3) return 'premium';
  if (maxLv === 2) return 'deluxe';
  return 'select';
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
    views: Number(r.views) || 0,
    daysAgo: daysAgo(r.updated_at),
    rankNow: { name: r.crank_name || 'UNRANKED', icon: r.crank_icon || '', tier: rankTier(r.crank_name) },
    rankPeak: { name: r.prank_name || 'UNRANKED', icon: r.prank_icon || '', tier: rankTier(r.prank_name) },
    stats: {
      skins: r.skins || 0, premium: r.prems || 0, limited: r.limited || 0, animated: r.anims || 0, level: r.level || 0, vp: r.vp || 0, rp: r.rp || 0, kc: r.kc || 0
    },
    flags: {
      wtr: /yes/i.test(r.wtr || ''), receipts: /yes/i.test(r.receipts || ''),
      owner: (r.owner || '').replace(/\s*owner\s*$/i, '') || '—'
    },
    seller: { name: r.tag || r.vlogin || r.slug },
    vlogin: r.vlogin || '',
    link: (r.link || '').trim(),
    picks: r.picks_top || {}
  };
}

// ── facets (rows built into the empty fieldsets) ──────────────────
function buildFacets() {
  const themeRows = Object.keys(THEME_ACCENTS).map(k => {
    const t = THEME_ACCENTS[k];
    return '<label><input type="checkbox" value="' + k + '"><span class="sw sw-' + k + '"></span><span class="ftxt">' + esc(t.label) + '</span><span class="fc" data-theme-count="' + k + '">(0)</span></label>';
  }).join('');
  $('fTheme').innerHTML = '<legend>THEME</legend>' + themeRows;

  const rankRows = [
    { v: '', l: 'Any' }, { v: 'gold', l: 'GOLD+' }, { v: 'plat', l: 'PLATINUM+' },
    { v: 'dia', l: 'DIAMOND+' }, { v: 'asc', l: 'ASCENDANT+' }, { v: 'imm', l: 'IMMORTAL+' }, { v: 'rad', l: 'RADIANT' }
  ].map((r, i) => '<label class="frow"><input type="radio" name="minrank" value="' + r.v + '"' + (i === 0 ? ' checked' : '') + '><span class="fl">' + esc(r.l) + '</span><span class="fbar"><i></i></span><span class="fn">0</span></label>').join('');
  $('fRank').innerHTML = '<legend>MIN RANK</legend>' + rankRows;

  const priceRows = [
    { v: '', l: 'Any' }, { v: 'u100', l: 'Under $100' }, { v: 'r300', l: '$100–$300' },
    { v: 'r600', l: '$300–$600' }, { v: 'o600', l: '$600+' }, { v: 'off', l: 'Offers only' }
  ].map((r, i) => '<label><input type="radio" name="price" value="' + r.v + '"' + (i === 0 ? ' checked' : '') + '><span class="ftxt">' + esc(r.l) + '</span><span class="fn">0</span></label>').join('');
  $('fPrice').innerHTML = '<legend>PRICE</legend>' + priceRows;

  const flagRows = [
    { v: 'anim', l: 'Animated skins' }, { v: 'wtr', l: 'Full access — WTR' },
    { v: 'rec', l: 'Receipts' }, { v: 'own0', l: '0th owner' }
  ].map(r => '<label><input type="checkbox" value="' + r.v + '"><span class="ftxt">' + esc(r.l) + '</span><span class="fn">0</span></label>').join('');
  $('fFlags').innerHTML = '<legend>REQUIREMENTS</legend>' + flagRows;
}

function themeCounts() {
  Object.keys(THEME_ACCENTS).forEach(k => {
    const el = document.querySelector('[data-theme-count="' + k + '"]');
    if (el) el.textContent = '(' + listings.filter(l => l.theme === k).length + ')';
  });
}

function priceCounts() {
  document.querySelectorAll('#fPrice input[name="price"]').forEach(r => {
    const v = r.value;
    let count;
    if (!v) count = listings.length;
    else if (v === 'off') count = listings.filter(l => l.price === null).length;
    else count = listings.filter(l => {
      const p = l.price;
      if (p === null) return false;
      if (v === 'u100') return p < 100;
      if (v === 'r300') return p >= 100 && p < 300;
      if (v === 'r600') return p >= 300 && p < 600;
      if (v === 'o600') return p >= 600;
      return false;
    }).length;
    const row = r.closest('label');
    const fn = row ? row.querySelector('.fn') : null;
    if (fn) fn.textContent = count;
  });
}

function rankCounts() {
  const N = listings.length || 1;
  document.querySelectorAll('#fRank input[name="minrank"]').forEach(r => {
    const v = r.value;
    let count;
    if (!v) count = listings.length;
    else {
      const need = RANK_THRESHOLDS[v];
      count = listings.filter(l => need && l.rankNow.tier >= need).length;
    }
    const row = r.closest('.frow');
    if (!row) return;
    const fn = row.querySelector('.fn');
    if (fn) fn.textContent = count;
    const bar = row.querySelector('.fbar i');
    if (bar) bar.style.setProperty('--w', (count > 0 ? Math.max(4, count / N * 100) : 0) + '%');
  });
}

function flagCounts() {
  const map = {
    anim: l => l.stats.animated > 0,
    wtr: l => l.flags.wtr,
    rec: l => l.flags.receipts,
    own0: l => l.flags.owner === '0TH'
  };
  document.querySelectorAll('#fFlags input').forEach(cb => {
    const row = cb.closest('label');
    const fn = row ? row.querySelector('.fn') : null;
    const test = map[cb.value];
    if (fn && test) fn.textContent = listings.filter(test).length;
  });
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
const CUR_SYMBOL = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
function moneyHTML(l, cls) {
  if (l.price == null) return '<span class="' + (cls || 'lc-offer') + '">CONTACT FOR PRICE</span>';
  const sym = CUR_SYMBOL[l.currency] || (l.currency ? esc(l.currency) + ' ' : '$');
  return '<span class="' + (cls || 'lc-price') + '">' + sym + esc(l.price) + '</span>';
}

function chipsGrid(l) {
  let c = '<span>' + esc(l.stats.skins) + ' SKINS</span><span>' + esc(l.stats.premium) + ' PREMIUM</span>';
  if (l.stats.animated > 0) c += '<span>' + esc(l.stats.animated) + ' ANIMATED</span>';
  /* CF-19: WTR and receipts are the buyer's first trust question — they
     were list-mode-only before */
  if (l.flags.wtr) c += '<span>WTR</span>';
  if (l.flags.receipts) c += '<span>RECEIPTS</span>';
  c += '<span>' + esc(l.flags.owner) + ' OWNER</span>';
  return c;
}

function chipsList(l) {
  let c = '<span class="chip">' + esc(l.stats.skins) + ' SKINS</span><span class="chip">' + esc(l.stats.premium) + ' PREMIUM</span>';
  if (l.stats.animated > 0) c += '<span class="chip">' + esc(l.stats.animated) + ' ANIMATED</span>';
  if (l.flags.wtr) c += '<span class="chip">WTR</span>';
  if (l.flags.receipts) c += '<span class="chip">RECEIPTS</span>';
  return c;
}

function priceHTML(l) {
  /* CF-16: negotiable is rendered — a buyer should know the price is soft
     before they contact anyone. It was normalised and never shown. */
  const neg = l.negotiable ? '<span class="lc-neg">open to offers</span>' : '';
  return moneyHTML(l) + neg;
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
  const rn = l.rankNow;
  const st = l.stats;
  return '<div class="mc">'
    + '<div class="mc-head"><span></span><span class="mc-rank">' + rankImg(rn) + esc(rn.name) + '</span></div>'
    + '<div class="mc-grid">' + g + '</div>'
    + '<div class="mc-foot"><span>SKINS ' + esc(st.skins) + ' · PREM ' + esc(st.premium) + ' · ANIM ' + esc(st.animated) + '</span><span>LV ' + esc(st.level) + '</span></div>'
    + '</div>';
}

function cardHTML(l, i) {
  const t = THEME_ACCENTS[l.theme] || THEME_ACCENTS.protocol;
  const rn = l.rankNow;
  const rp = l.rankPeak;
  const arctic = l.theme === 'arctic' ? ' data-theme-tile="arctic"' : '';
  const price = moneyHTML(l, 'gc-price') + (l.negotiable ? '<span class="gc-neg">open to offers</span>' : '');
  if (l.price == null) { /* moneyHTML already handles the offer case */ }
  const priceCell = l.price == null
    ? '<span class="gc-offer">CONTACT FOR PRICE</span>' + (l.negotiable ? '<span class="gc-neg">open to offers</span>' : '')
    : price;
  return '<button type="button" class="gcard" data-slug="' + esc(l.slug) + '" data-i="' + i + '">'
    + '<div class="gc-preview tt-' + tierFor(l) + '"' + arctic + ' data-imgwrap>'
    + '<span class="gc-badges">' + badgesGrid(l) + '</span>'
    + '<span class="gc-theme">' + esc(t.label) + '</span>'
    + previewInner(l, state.style)
    + '</div>'
    + '<div class="gc-body">'
    + '<h2>' + esc(l.title) + '</h2>'
    + '<div class="gc-code">' + esc(l.code) + '</div>'
    + '<div class="gc-ranks">' + rankImg(rn) + '<span>' + esc(rn.name) + '</span><i>·</i><span class="pk">PEAK ' + esc(rp.name) + '</span></div>'
    + '<div class="gc-chips">' + chipsGrid(l) + '</div>'
    + '<div class="gc-seller">' + img(AVATAR_PLACEHOLDER, 'Seller avatar') + '<span>' + esc(l.seller.name) + '</span></div>'
    + '</div>'
    + '<div class="gc-foot">' + priceCell
    + '<span class="gc-meta">' + esc(l.views) + ' views · ' + esc(agoText(l.daysAgo)) + '</span>'
    + '<span class="gc-go">VIEW →</span>'
    + '</div></button>';
}

function rowHTML(l) {
  const rn = l.rankNow;
  const rp = l.rankPeak;
  const icons = flattenPicks(l, FEATURE_ORDER).slice(0, 2).map(pickIconWrap).join('');
  return '<button type="button" class="arow" data-slug="' + esc(l.slug) + '">'
    + '<div class="lr-thumb" data-imgwrap><div class="lc-icons">' + icons + '</div></div>'
    + '<div class="lr-main"><div class="lr-title"><h2>' + esc(l.title) + '</h2><span class="lr-badges">' + badgesGrid(l) + '</span></div></div>'
    + '<div class="lr-ranks"><div class="r">' + rankImg(rn) + '<span>' + esc(rn.name) + '</span></div><div class="r">' + rankImg(rp) + '<span class="pk">PEAK ' + esc(rp.name) + '</span></div></div>'
    + '<div class="lr-chips">' + chipsList(l) + '</div>'
    + '<div class="lr-price">' + priceHTML(l) + '<span class="lc-meta">' + esc(l.views) + ' views · ' + esc(agoText(l.daysAgo)) + '</span></div>'
    + '<div class="lr-go lc-go">VIEW →</div>'
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
  return '<div class="gfeat" data-slug="' + esc(l.slug) + '">'
    + '<div class="gf-preview" data-imgwrap>'
    + '<span class="gf-ribbon">FEATURED</span>'
    + '<div class="gf-skins">' + sk + '</div>'
    + '<div class="gf-strip"><span>PREM ' + esc(s.premium) + '</span><span>LIM ' + esc(s.limited) + '</span><span>ANIM ' + esc(s.animated) + '</span><span>LV ' + esc(s.level) + '</span></div>'
    + '<div class="gf-ranks"><span class="gfr">' + rankImg(rn) + '<b>' + esc(rn.name) + '</b></span><span class="gfr">' + rankImg(rp) + '<b>PEAK ' + esc(rp.name) + '</b></span></div>'
    + '</div>'
    + '<div class="gf-info">'
    + '<span class="gf-theme">' + esc(t.label) + '</span>'
    + '<h2>' + esc(l.title) + '</h2>'
    + '<div class="gf-seller">' + img(AVATAR_PLACEHOLDER, 'Seller avatar') + '<div><b>' + esc(l.seller.name) + '</b><span>' + flags + '</span></div></div>'
    + '<div class="gf-rankrow">' + rankImg(rn) + '<span>' + esc(rn.name) + '</span><i>·</i><span class="m">PEAK ' + esc(rp.name) + '</span></div>'
    + '<div class="gf-price">' + price + '</div>'
    + '<div class="gf-meta">' + esc(l.views) + ' VIEWS · UPDATED ' + esc(agoText(l.daysAgo).toUpperCase()) + '</div>'
    + '<button type="button" class="gf-cta" data-slug="' + esc(l.slug) + '">View full card →</button>'
    + '</div></div>';
}

function ctaHTML() {
  return '<a class="cta-tile" href="index.html">'
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

function matches(l) {
  if (state.q) {
    const q = state.q.toLowerCase();
    const hay = (l.title + ' ' + l.code + ' ' + l.seller.name + ' ' + l.vlogin).toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (state.themes.size && !state.themes.has(l.theme)) return false;
  if (state.minRank) {
    const need = RANK_THRESHOLDS[state.minRank];
    if (!need || l.rankNow.tier < need) return false;
  }
  if (state.price) {
    const p = l.price;
    if (state.price === 'off') { if (p !== null) return false; }
    else if (p === null) return false;
    else if (state.price === 'u100' && !(p < 100)) return false;
    else if (state.price === 'r300' && !(p >= 100 && p < 300)) return false;
    else if (state.price === 'r600' && !(p >= 300 && p < 600)) return false;
    else if (state.price === 'o600' && !(p >= 600)) return false;
  }
  if (state.flags.size) {
    if (state.flags.has('anim') && !(l.stats.animated > 0)) return false;
    if (state.flags.has('wtr') && !l.flags.wtr) return false;
    if (state.flags.has('rec') && !l.flags.receipts) return false;
    if (state.flags.has('own0') && l.flags.owner !== '0TH') return false;
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
  const rest = listings.filter(l => l !== feat);
  const fRest = rest.filter(matches).sort(cmp);
  hideStateBox();
  const featVis = !!(feat && matches(feat));
  const total = fRest.length + (featVis ? 1 : 0);
  $('count').textContent = total + (total === 1 ? ' listing' : ' listings');
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
  themeCounts();
  priceCounts();
  rankCounts();
  flagCounts();
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
    '<a class="sbtn" href="index.html">Build a card instead</a></span>');
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
    '<span class="sb-actions"><a class="sbtn primary" href="index.html">Build the first card</a></span>');
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
function skinCell(s) {
  const lv = pickLevel(s);
  const label = (pickWeapon(s) || '') + ' — ' + (pickName(s) || '') + (lv >= 2 ? ' · LV' + lv : '') + (s.variant ? ' · ' + s.variant.name : '');
  return '<span class="skin"><img src="' + esc(pickIcon(s)) + '" alt="' + esc(label) + '" title="' + esc(label) + '">' + (lv >= 2 ? '<i class="lv">LV' + lv + '</i>' : '') + '</span>';
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
}

function fitCard() {
  if (qv.hidden) return;
  const stage = qv.querySelector('.qv-stage');
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
  bar.querySelector('#qvTitle').textContent = l.title;
  bar.querySelector('.qv-code').textContent = l.code;
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
      $('card').dataset.theme = 'protocol';
      fitCard();
      $('qvContact').hidden = true;
      status('Could not load full listing.', 'err');
      return;
    }
    const payload = data.payload || {};
    fillCard(payload, slug);
    $('card').dataset.theme = data.theme || payload.theme || 'protocol';
    fitCard();
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
  qv.hidden = false;
  document.body.classList.add('modal-open');
  if (qvClose) qvClose.focus();
  fillBar(l, slug);
  fitCard();
  loadFull(slug);
}

function closeQV() {
  if (qv.hidden) return;
  qv.hidden = true;
  document.body.classList.remove('modal-open');
  if (qvLastFocus && qvLastFocus.focus) qvLastFocus.focus();
  if (location.search.indexOf('slug=') !== -1) window.history.replaceState(null, '', location.pathname + location.hash);
}

// ── wiring ────────────────────────────────────────────────────────
function wire() {
  $('q').addEventListener('input', e => { state.q = e.target.value; render(); });
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
    requestAnimationFrame(() => { qvResizePending = false; fitCard(); });
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

async function fetchPage(offset) {
  const res = await supabase.rpc('browse_listings_v2', { p_limit: PAGE_SIZE + 1, p_offset: offset });
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

async function load() {
  if (!supabase) {
    status('Browse needs Supabase configured — see SETUP.md.', 'err');
    return;
  }
  status('Loading listings…');
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
        prems: null, limited: null, anims: null, level: null,
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
  skeleton();
  setTimeout(() => {
    render();
    if (deepSlug) openQV(deepSlug, null);
  }, 400);
}

// ── boot ──────────────────────────────────────────────────────────
buildFacets();
wire();
const savedStyle = localStorage.getItem('cf-card-style');
if (savedStyle === 'mini' || savedStyle === 'rail') state.style = savedStyle;
applyStyle();
load();

initDisclaimerCollapse();