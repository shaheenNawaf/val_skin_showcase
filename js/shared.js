// CardForge shared helpers — used by both editor.js and viewer.js.

export const DESIGN_W = 1920;
export const DESIGN_H = 1080;
export const CATS = ['Sidearms', 'SMGs', 'Shotguns', 'Rifles', 'Sniper Rifles', 'Machine Guns', 'Melees'];
// free-slot groups: not tied to a weapon category, picker offers the whole catalog
export const FREE_CATS = ['Flex', 'Battlepass'];
export const ALL_CATS = [...CATS, ...FREE_CATS];
const TIER_ORDER = ['select', 'deluxe', 'premium', 'ultra', 'exclusive'];

export const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (id) => document.getElementById(id);

export function tierClass(t) {
  const k = (t || '').toLowerCase();
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
  clearTimeout(statusTimer);
  if (kind !== 'err') statusTimer = setTimeout(() => el.classList.add('dim'), 6000);
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
export function makeFitter({ card, sizer, topbar, stage, floor = 0.35 }) {
  function fit() {
    const tbh = topbar ? topbar.offsetHeight : 52;
    document.documentElement.style.setProperty('--tbh', tbh + 'px');
    const availW = innerWidth - 16;
    const availH = innerHeight - tbh - 34; // 34px clearance for the disclaimer bar
    const natural = Math.min(availW / DESIGN_W, availH / DESIGN_H);
    const s = Math.min(Math.max(natural, floor), 1);
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

export async function loadCatalog() {
  const [wJ, tJ, cJ, bJ, pJ] = await Promise.all([
    fetchJSON('https://valorant-api.com/v1/weapons?language=en-US'),
    fetchJSON('https://valorant-api.com/v1/contenttiers?language=en-US'),
    fetchJSON('https://valorant-api.com/v1/competitivetiers?language=en-US'),
    fetchJSON('https://valorant-api.com/v1/buddies?language=en-US'),
    fetchJSON('https://valorant-api.com/v1/playercards?language=en-US')
  ]);
  const tiers = Object.fromEntries((tJ.data || []).map(t => [t.uuid, t.displayName]));
  const DB = {};
  (wJ.data || []).forEach(w => {
    const cat = mapCategory(w.category);
    if (!cat) return;
    (w.skins || []).forEach(s => {
      if (s.displayName === 'Standard') return;
      const icon = s.displayIcon || (s.chromas && s.chromas[0] && s.chromas[0].displayIcon);
      if (!icon) return;
      (DB[cat] = DB[cat] || []).push({ id: s.uuid, weapon: w.displayName, name: s.displayName, icon, tier: tiers[s.contentTierUuid] || '' });
    });
  });
  Object.values(DB).forEach(a => a.sort((x, y) => (x.weapon + x.name).localeCompare(y.weapon + y.name)));

  const tierSet = new Set();
  Object.values(DB).forEach(a => a.forEach(s => { if (s.tier) tierSet.add(s.tier); }));
  const TIERS = [...tierSet].sort((a, b) => {
    const ia = TIER_ORDER.indexOf(a.toLowerCase()), ib = TIER_ORDER.indexOf(b.toLowerCase());
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const set = (cJ.data || []).slice(-1)[0];
  const seenRanks = new Set(['UNRANKED']); // the icon-less literal below wins
  const RANKS = [
    { name: 'UNRANKED', icon: null, order: -1, flat: 0 },
    // tierName is already the full display name ("IRON 1"); divisionName is
    // just the tier group ("IRON"). "Unused" entries are placeholder data.
    ...(set?.tiers || [])
      .filter(t => t.tierName && !/^unused/i.test(t.tierName))
      .map(t => ({
        name: t.tierName,
        icon: t.displayIcon || t.largeIcon,
        color: t.color || '#888',
        order: (t.tier || 0) * 10 + (t.division || 0),
        flat: (t.tier || 0) ? (t.tier || 0) * 3 + (t.division || 1) - 1 : 0
      }))
      .filter(t => (seenRanks.has(t.name) ? false : seenRanks.add(t.name)))
      .sort((a, b) => a.order - b.order)
  ];

  // gun buddies + player cards, keyed by every uuid Riot may hand back
  // (level-0 ids from entitlements, level ids from equipped loadouts)
  const BUDDIES = {};
  (bJ.data || []).forEach(b => {
    const icon = b.displayIcon || (b.levels && b.levels[0] && b.levels[0].displayIcon);
    if (!icon) return;
    BUDDIES[b.uuid] = icon;
    (b.levels || []).forEach(l => { BUDDIES[l.uuid] = l.displayIcon || icon; });
  });
  const CARDS = {};
  (pJ.data || []).forEach(c => {
    const wide = c.wideArt || c.displayIcon;
    if (!wide) return;
    CARDS[c.uuid] = { wide, icon: c.displayIcon || wide };
  });

  return { DB, TIERS, RANKS, BUDDIES, CARDS };
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
export async function exportCard(card) {
  document.body.classList.add('exporting');
  // wait a frame so the exporting styles apply — with a setTimeout escape
  // because backgrounded tabs never fire requestAnimationFrame
  await new Promise(r => { requestAnimationFrame(r); setTimeout(r, 120); });
  const swaps = [];
  try {
    for (const img of card.querySelectorAll('img')) {
      const src = img.getAttribute('src');
      if (!src || src.startsWith('data:')) continue;
      const d = await toDataUrl(src);
      if (d) { swaps.push([img, src]); img.src = d; }
    }
    const canvas = await html2canvas(card, { scale: 2, useCORS: true, backgroundColor: null });
    const a = document.createElement('a');
    a.download = 'showcase-card-3840x2160.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  } finally {
    swaps.forEach(([img, src]) => { img.src = src; });
    document.body.classList.remove('exporting');
  }
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
