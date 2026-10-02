// CardForge shared helpers — used by both editor.js and viewer.js.

export const DESIGN_W = 1920;
export const DESIGN_H = 1080;
export const CATS = ['Sidearms', 'SMGs', 'Shotguns', 'Rifles', 'Sniper Rifles', 'Machine Guns', 'Melees'];
// free-slot groups: not tied to a weapon category, picker offers the whole catalog
export const FREE_CATS = ['Flex'];
export const ALL_CATS = [...CATS, ...FREE_CATS];
const TIER_ORDER = ['select', 'deluxe', 'premium', 'ultra', 'exclusive'];

export const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (id) => document.getElementById(id);

export const tierKey = (t) => String(t || '').toLowerCase().replace(/\s*edition\s*$/, '').trim();

export function tierClass(t) {
  const k = tierKey(t);
  return TIER_ORDER.includes(k) ? 't-' + k : '';
}

export function mapCategory(c) {
  c = (c || '').toLowerCase();
  if (c.includes('sidearm')) return 'Sidearms';
  if (c.includes('smg')) return 'SMGs';
  if (c.includes('shotgun')) return 'Shotguns';
  if (c.includes('sniper')) return 'Sniper Rifles';
  if (c.includes('machine') || c.includes('lmg') || c.includes('heavy')) return 'Machine Guns';
  if (c.includes('melee')) return 'Melees';
  if (c.includes('rifle')) return 'Rifles';
  return null;
}

// Riot's flat competitive-tier numbers (TierAfterUpdate / CompetitiveTier) map
// onto the competitivetiers groups as group*3 + division - 1 (Iron 1 = 3 …
// Radiant = 27). A ±2 probe keeps older/newer offsets resolving correctly.
export function rankByFlat(n, RANKS) {
  const byFlat = new Map(RANKS.map(r => [r.flat, r]));
  return byFlat.get(n) || byFlat.get(n + 2) || byFlat.get(n - 2) || RANKS[0];
}

// ── status + persistence ──────────────────────────────────────────
// kind: 'info' (default) | 'ok' | 'err' — err persists, others auto-dim
let statusTimer = null;
export function status(m, kind = 'info') {
  const el = $('status');
  if (!el) return;
  el.textContent = m;
  el.dataset.kind = kind;
  el.classList.remove('dim');
  el.classList.remove('fade');
  el.title = kind === 'err' ? 'Click to dismiss' : '';
  clearTimeout(statusTimer);
  if (kind !== 'err') statusTimer = setTimeout(() => el.classList.add('fade'), 5000);
}

/* CF-32: errors used to pin themselves over the card forever with no way
   out except triggering another message. Every toast is now dismissible. */
export function initStatusDismiss() {
  const el = $('status');
  if (!el || el.dataset.dismissWired) return;
  el.dataset.dismissWired = '1';
  el.addEventListener('click', () => {
    el.classList.add('fade');
    clearTimeout(statusTimer);
  });
}

export function initDisclaimerCollapse() {
  const t = $('discToggle');
  const d = $('disclaimer');
  if (!t || !d) return;
  t.addEventListener('click', () => {
    const hidden = d.classList.toggle('disc-hidden');
    t.setAttribute('aria-expanded', String(!hidden));
    t.setAttribute('aria-label', hidden ? 'Show legal notice' : 'Hide legal notice');
    t.textContent = hidden ? '»' : '«';
  });
}

export function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function randomId(len) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

export async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export function copyText(t) {
  if (navigator.clipboard && location.protocol !== 'file:') {
    navigator.clipboard.writeText(t).catch(() => prompt('Copy this link:', t));
  } else {
    prompt('Copy this link:', t);
  }
}

// ── theme ─────────────────────────────────────────────────────────
export const THEMES = ['protocol', 'holo', 'reaver', 'oni', 'arctic'];

export function applyTheme(t) {
  if (!THEMES.includes(t)) t = 'protocol';
  document.documentElement.dataset.theme = t;
  document.querySelectorAll('.swatch').forEach(x => {
    const active = x.dataset.theme === t;
    x.classList.toggle('active', active);
    x.setAttribute('aria-pressed', String(active));
  });
}

export function initThemeSwitch(persist = true) {
  document.querySelectorAll('.swatch').forEach(b => b.addEventListener('click', () => {
    applyTheme(b.dataset.theme);
    if (persist) localStorage.setItem('vc-theme', b.dataset.theme);
  }));
  applyTheme(localStorage.getItem('vc-theme') || 'protocol');
}

// ── responsive scaling of the fixed-size card ─────────────────────
// The card keeps its 1920×1080 design size and is scaled into a #sizer box.
// A scale floor keeps the card readable on small screens; #stage scrolls
// (via margin:auto centering) whenever the floored card overflows.
export function makeFitter({ card, sizer, topbar, stage, floor = 0.35, getZoom }) {
  function fit() {
    const tbh = topbar ? topbar.offsetHeight : 52;
    document.documentElement.style.setProperty('--tbh', tbh + 'px');
    const availW = innerWidth - 16;
    const availH = innerHeight - tbh - 34; // 34px clearance for the disclaimer bar
    const natural = Math.min(availW / DESIGN_W, availH / DESIGN_H);
    /* CF-15 (option A): the host page can pin a manual zoom (1, 2, …).
       Pinned zoom pans; fit stays clamped to the floor like before. */
    const zoom = getZoom ? getZoom() : null;
    const s = zoom != null
      ? Math.min(Math.max(zoom, floor), 4)
      : Math.min(Math.max(natural, floor), 1);
    sizer.style.width = DESIGN_W * s + 'px';
    sizer.style.height = DESIGN_H * s + 'px';
    card.style.transform = `scale(${s})`;
    // when the floor forces overflow, top-anchor the card instead of
    // centering it so panning doesn't happen in a band of dead space
    if (stage) stage.classList.toggle('pan', s > natural);
  }
  addEventListener('resize', fit);
  // the topbar re-wraps when fonts finish loading or the status text changes;
  // a plain resize listener misses those, leaving the stage inset stale
  if (topbar && 'ResizeObserver' in window) new ResizeObserver(fit).observe(topbar);
  if (document.fonts?.ready) document.fonts.ready.then(fit).catch(() => {});
  return fit;
}

// ── skin catalog from the community API ───────────────────────────
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url.split('/v1/')[1] || url} → HTTP ${r.status}`);
  return r.json();
}

export function chromaLabel(skinName, dn) {
  const raw = String(dn || '').replace(/\r?\n/g, ' ').trim();
  const m = raw.match(/\(([^)]+)\)\s*$/);
  if (m) return m[1];
  return raw === skinName ? 'Standard' : (raw || 'Standard');
}

function buildRanks(ctData) {
  const set = (ctData || []).slice(-1)[0];
  const seenRanks = new Set(['UNRANKED']); // the icon-less literal below wins
  return [
    { name: 'UNRANKED', icon: null, order: -1, flat: 0 },
    // tierName is already the full display name ("IRON 1"); divisionName is
    // just the tier group ("IRON"). "Unused" entries are placeholder data.
    ...(set?.tiers || [])
      .filter(t => t.tierName && !/^unused/i.test(t.tierName))
      .map(t => ({
        name: t.tierName,
        icon: t.displayIcon || t.largeIcon,
        color: t.color || '#888',
        order: (t.tier || 0) * 10,
        flat: (t.tier || 0) || 0
      }))
      .filter(t => (seenRanks.has(t.name) ? false : seenRanks.add(t.name)))
      .sort((a, b) => a.order - b.order)
  ];
}

function buildBuddies(buddyData) {
  // gun buddies + player cards, keyed by every uuid Riot may hand back
  // (level-0 ids from entitlements, level ids from equipped loadouts)
  const BUDDIES = {};
  const BUDDIES_LIST = [];
  const BUDDY_BY_ANY = {};
  (buddyData || []).forEach(b => {
    const icon = b.displayIcon || (b.levels && b.levels[0] && b.levels[0].displayIcon);
    if (!icon) return;
    BUDDIES[b.uuid] = icon;
    BUDDIES_LIST.push({ uuid: b.uuid, name: b.displayName || 'Buddy', icon });
    BUDDY_BY_ANY[b.uuid] = b.uuid;
    (b.levels || []).forEach(l => { if (l.uuid) BUDDIES[l.uuid] = l.displayIcon || icon; });
    (b.levels || []).forEach(l => { if (l.uuid) BUDDY_BY_ANY[l.uuid] = b.uuid; });
  });
  BUDDIES_LIST.sort((a, b) => a.name.localeCompare(b.name));
  return { BUDDIES, BUDDIES_LIST, BUDDY_BY_ANY };
}

function buildCards(cardData) {
  const CARDS = {};
  const CARDS_LIST = [];
  (cardData || []).forEach(c => {
    const wide = c.wideArt || c.displayIcon;
    if (!wide) return;
    const icon = c.displayIcon || wide;
    CARDS[c.uuid] = { wide, icon };
    CARDS_LIST.push({ uuid: c.uuid, name: c.displayName || 'Player card', wide, icon });
  });
  CARDS_LIST.sort((a, b) => a.name.localeCompare(b.name));
  return { CARDS, CARDS_LIST };
}

async function loadCatalogFromCache(sb, opts) {
  if (!sb) return null;
  const withExtras = !(opts && opts.extras === false);
  try {
    const skinRows = [];
    for (let from = 0; from < 10000; from += 1000) {
      const { data, error } = await sb.from('skins')
        .select('uuid,weapon,category,name,tier,icon_url,max_level,chromas,levels')
        .order('uuid')
        .range(from, from + 999);
      if (error || !data) throw new Error(error?.message || 'skins query failed');
      skinRows.push(...data);
      if (data.length < 1000) break;
    }
    const { data: cacheRows, error: cacheErr } = await sb.from('catalog_cache')
      .select('key,data')
      .in('key', withExtras ? ['competitivetiers', 'buddies', 'playercards'] : ['competitivetiers']);
    if (cacheErr) throw new Error(cacheErr.message);
    const cache = Object.fromEntries((cacheRows || []).map(r => [r.key, r.data]));
    if (!skinRows.length || !cache.competitivetiers) return null;
    const DB = {};
    const LEVEL_MAP = {};
    const CHROMA_MAP = {};
    skinRows.forEach(r => {
      const chromas = (Array.isArray(r.chromas) ? r.chromas : []).map(c => ({ ...c, full: c.full || c.fullRender || '', sw: c.sw || c.swatch || '', video: c.streamedVideo || '' }));
      (DB[r.category] = DB[r.category] || []).push({ id: r.uuid, weapon: r.weapon, name: r.name, tier: r.tier || '', icon: r.icon_url, maxLevel: r.max_level || 1, chromas, levels: (Array.isArray(r.levels) ? r.levels : []).map(l => ({ level: l.level, video: l.video || '' })) });
      (Array.isArray(r.levels) ? r.levels : []).forEach(l => { if (l && l.uuid) LEVEL_MAP[l.uuid] = { id: r.uuid, level: l.level }; });
      chromas.forEach((c, i) => { if (c && c.uuid) CHROMA_MAP[c.uuid] = { id: r.uuid, idx: i }; });
    });
    Object.values(DB).forEach(a => a.sort((x, y) => (x.weapon + x.name).localeCompare(y.weapon + y.name)));
    const tierSet = new Set();
    Object.values(DB).forEach(a => a.forEach(s => { if (s.tier) tierSet.add(s.tier); }));
    const TIERS = [...tierSet].sort((a, b) => {
      const ia = TIER_ORDER.indexOf(tierKey(a)), ib = TIER_ORDER.indexOf(tierKey(b));
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const SKIN_BY_ID = new Map(Object.values(DB).flat().map(s => [s.id, s]));
    /* CF-24: buddies/player cards load on demand via loadCatalogExtras() */
    const { BUDDIES, BUDDIES_LIST, BUDDY_BY_ANY } = cache.buddies ? buildBuddies(cache.buddies) : { BUDDIES: {}, BUDDIES_LIST: [], BUDDY_BY_ANY: {} };
    const { CARDS, CARDS_LIST } = cache.playercards ? buildCards(cache.playercards) : { CARDS: {}, CARDS_LIST: [] };
    const RANKS = buildRanks(cache.competitivetiers);
    return { DB, TIERS, RANKS, BUDDIES, CARDS, CARDS_LIST, SKIN_BY_ID, LEVEL_MAP, CHROMA_MAP, BUDDIES_LIST, BUDDY_BY_ANY, source: 'cache', extrasLoaded: !!(cache.buddies && cache.playercards) };
  } catch {
    return null;
  }
}

export async function loadCatalogFromApi(opts) {
  const withExtras = !(opts && opts.extras === false);
  const [wJ, tJ, cJ, bJ, pJ] = await Promise.all([
    fetchJSON('https://valorant-api.com/v1/weapons?language=en-US'),
    fetchJSON('https://valorant-api.com/v1/contenttiers?language=en-US'),
    fetchJSON('https://valorant-api.com/v1/competitivetiers?language=en-US'),
    withExtras ? fetchJSON('https://valorant-api.com/v1/buddies?language=en-US') : Promise.resolve({ data: [] }),
    withExtras ? fetchJSON('https://valorant-api.com/v1/playercards?language=en-US') : Promise.resolve({ data: [] })
  ]);
  const tiers = Object.fromEntries((tJ.data || []).map(t => [t.uuid, t.displayName]));
  const DB = {};
  const LEVEL_MAP = {};
  const CHROMA_MAP = {};
  (wJ.data || []).forEach(w => {
    const cat = mapCategory(w.category);
    if (!cat) return;
    (w.skins || []).forEach(s => {
      if (s.displayName === 'Standard') return;
      const icon = s.displayIcon || (s.chromas && s.chromas[0] && s.chromas[0].displayIcon);
      if (!icon) return;
      const chromas = (s.chromas || []).map(c => {
        const cIcon = c.displayIcon || c.fullRender || c.swatch;
        if (!cIcon) return null;
        const raw = String(c.displayName || '').replace(/\r?\n/g, ' ').trim();
        const unlock = (raw.match(/Level (\d+)/) || [])[1];
        return { uuid: c.uuid, label: chromaLabel(s.displayName, c.displayName), icon: cIcon, swatch: c.swatch || null, unlock: unlock ? +unlock : null, full: c.fullRender || '', sw: c.swatch || '', video: c.streamedVideo || '' };
      }).filter(Boolean);
      (DB[cat] = DB[cat] || []).push({ id: s.uuid, weapon: w.displayName, name: s.displayName, icon, tier: tiers[s.contentTierUuid] || '', maxLevel: (s.levels || []).length || 1, chromas, levels: (s.levels || []).map((l, i) => ({ level: i + 1, video: l.streamedVideo || '' })) });
      (s.levels || []).forEach((l, i) => { if (l.uuid) LEVEL_MAP[l.uuid] = { id: s.uuid, level: i + 1 }; });
      chromas.forEach((c, i) => { if (c.uuid) CHROMA_MAP[c.uuid] = { id: s.uuid, idx: i }; });
    });
  });
  Object.values(DB).forEach(a => a.sort((x, y) => (x.weapon + x.name).localeCompare(y.weapon + y.name)));
  const SKIN_BY_ID = new Map(Object.values(DB).flat().map(s => [s.id, s]));

  const tierSet = new Set();
  Object.values(DB).forEach(a => a.forEach(s => { if (s.tier) tierSet.add(s.tier); }));
  const TIERS = [...tierSet].sort((a, b) => {
    const ia = TIER_ORDER.indexOf(tierKey(a)), ib = TIER_ORDER.indexOf(tierKey(b));
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const RANKS = buildRanks(cJ.data);
  const { BUDDIES, BUDDIES_LIST, BUDDY_BY_ANY } = buildBuddies(bJ.data);
  const { CARDS, CARDS_LIST } = buildCards(pJ.data);

  return { DB, TIERS, RANKS, BUDDIES, CARDS, CARDS_LIST, SKIN_BY_ID, LEVEL_MAP, CHROMA_MAP, BUDDIES_LIST, BUDDY_BY_ANY, source: 'api' };
}

export async function loadCatalog(supabaseClient, opts) {
  const cached = await loadCatalogFromCache(supabaseClient, opts);
  if (cached) return cached;
  return loadCatalogFromApi(opts);
}

/* CF-24: buddies (604 KB) and player cards (676 KB) were fetched eagerly at
   boot for every seller, though only the buddy/card pickers and the owned-
   collection opt-in use them. Load them on first use instead — the editor's
   boot drops from ~2.07 MB to ~0.79 MB on the wire. */
export async function loadCatalogExtras(supabaseClient) {
  let buddies = null, playercards = null;
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('catalog_cache')
        .select('key,data')
        .in('key', ['buddies', 'playercards']);
      if (!error && data) {
        const c = Object.fromEntries((data || []).map(r => [r.key, r.data]));
        buddies = c.buddies || null;
        playercards = c.playercards || null;
      }
    } catch { /* fall through to the API */ }
  }
  if (!buddies || !playercards) {
    const [bJ, pJ] = await Promise.all([
      fetchJSON('https://valorant-api.com/v1/buddies?language=en-US'),
      fetchJSON('https://valorant-api.com/v1/playercards?language=en-US'),
    ]);
    buddies = buddies || bJ.data || [];
    playercards = playercards || pJ.data || [];
  }
  const { BUDDIES, BUDDIES_LIST, BUDDY_BY_ANY } = buildBuddies(buddies);
  const { CARDS, CARDS_LIST } = buildCards(playercards);
  return { BUDDIES, BUDDIES_LIST, BUDDY_BY_ANY, CARDS, CARDS_LIST };
}

// ── images ────────────────────────────────────────────────────────
export function toDataUrl(u) {
  return fetch(u).then(r => r.blob()).then(b => new Promise(res => {
    const f = new FileReader();
    f.onload = () => res(f.result);
    f.readAsDataURL(b);
  })).catch(() => null);
}

export function resizeToDataUrl(file, max) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = img.width * sc;
        c.height = img.height * sc;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(file.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', .85));
      };
      img.onerror = rej;
      img.src = fr.result;
    };
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

// ── PNG export ────────────────────────────────────────────────────
// Remote icon URLs are swapped to data URLs for the capture only, so exported
// PNGs never taint the canvas and stored payloads stay small.
/* Shared capture used by the PNG export and by the publish flow, which
   uploads the same render as the listing's og:image (CF-20). */
export async function captureCardBlob(card, type = 'image/png', quality, opts = {}) {
  document.body.classList.add('exporting');
  if (opts.full) document.body.classList.add('exporting-full');
  // wait a frame so the exporting styles apply — with a setTimeout escape
  // because backgrounded tabs never fire requestAnimationFrame
  await new Promise(r => { requestAnimationFrame(r); setTimeout(r, 120); });
  if (opts.full) card.dataset.exportHeight = String(card.scrollHeight);
  const swaps = [];
  try {
    const imgs = [...card.querySelectorAll('img')].filter(im => { const s = im.getAttribute('src'); return s && !s.startsWith('data:'); });
    await Promise.all(imgs.map(async im => {
      const d = await toDataUrl(im.getAttribute('src'));
      if (d) { swaps.push([im, im.getAttribute('src')]); im.src = d; }
    }));
    const canvas = await html2canvas(card, { scale: 2, useCORS: true, backgroundColor: null });
    return await new Promise(res => canvas.toBlob(res, type, quality));
  } finally {
    swaps.forEach(([img, src]) => { img.src = src; });
    document.body.classList.remove('exporting');
    document.body.classList.remove('exporting-full');
  }
}

export async function exportCard(card, opts) {
  const blob = await captureCardBlob(card, 'image/png', undefined, opts);
  if (!blob) { return; }
  const a = document.createElement('a');
  const h = opts && opts.full && card.dataset.exportHeight ? Math.round(Number(card.dataset.exportHeight) * 2) : 2160;
  a.download = `showcase-card-3840x${h}.png`;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ── same-device presence (viewer fallback) ────────────────────────
export function startLocalPresence(channelId, onTick) {
  if (!('BroadcastChannel' in window)) { onTick(1); return () => {}; }
  const bc = new BroadcastChannel('cf-' + channelId);
  const sid = randomId(8);
  const peers = new Map([[sid, Date.now()]]);
  const prune = () => {
    const n = Date.now();
    for (const [k, v] of peers) if (k !== sid && n - v > 8000) peers.delete(k);
  };
  bc.onmessage = e => {
    const { t, s } = e.data || {};
    if (!s || s === sid) return;
    if (t === 'hello') { peers.set(s, Date.now()); bc.postMessage({ t: 'here', s: sid }); }
    else if (t === 'here' || t === 'ping') peers.set(s, Date.now());
    else if (t === 'bye') peers.delete(s);
    prune();
    onTick(peers.size);
  };
  bc.postMessage({ t: 'hello', s: sid });
  const iv = setInterval(() => { bc.postMessage({ t: 'ping', s: sid }); prune(); onTick(peers.size); }, 2500);
  addEventListener('beforeunload', () => bc.postMessage({ t: 'bye', s: sid }));
  onTick(peers.size);
  return () => clearInterval(iv);
}
