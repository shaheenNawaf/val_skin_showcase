// CardForge editor — card builder, PNG export, draft storage, listing publish.
import * as CF from './shared.js';
import { applyLayout, resolveLayout, renderSlotsM1, renderSlotsM2, renderSlotsClassic } from './layouts.js';

const CONFIG = window.CARDFORGE_CONFIG || {};
let supabase = null;
if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && window.supabase) {
  supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}

const AVATAR_PLACEHOLDER = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='100%25' height='100%25' fill='%232A3540'/><circle cx='32' cy='25' r='11' fill='%23768390'/><rect x='14' y='40' width='36' height='19' rx='6' fill='%23768390'/></svg>";

const DRAFT_KEY = 'vcard-draft-v2';   // structured payload (current)
const LEGACY_DRAFT_KEY = 'vcard-builder-v1'; // old innerHTML-based drafts

const card = CF.$('card');
const modal = CF.$('modal');
const importModal = CF.$('importModal');
const mGrid = CF.$('mGrid');
const mSearch = CF.$('mSearch');
const fileInput = CF.$('fileInput');

const state = {
  theme: 'protocol',
  texts: {},
  ranks: { crank: null, prank: null },
  picks: Object.fromEntries(CF.ALL_CATS.map(c => [c, []])),
  assets: { avatar: null, pcard: null, buddies: [] },
  owned: {},
  ownedLevels: {}, ownedVariants: [], ownedBuddies: [], ownedCards: []
};
state.layout = 'auto';
state.page = 1;

let DB = {}, TIERS = [], RANKS = [], BUDDIES = {}, CARDS = {}, SKIN_BY_ID = new Map(), LEVEL_MAP = {}, CHROMA_MAP = {}, BUDDIES_LIST = [], BUDDY_BY_ANY = {}, CARDS_LIST = [];
let FLEX_BY_ID = new Map();
let catalogSource = 'api';
let list = [], currentPool = [], currentCat = null, pickerMode = 'skin', rankRow = null, rankKey = null, variantCat = null, variantIdx = -1;
const TIER_RANK = { select: 1, deluxe: 2, premium: 3, ultra: 4, exclusive: 5 };
let filterWeapon = '', filterTier = '', filterOwned = false, filterAnim = false, tierOnly = false;
let lastTierCounts = {};
let vpMuted = false;
let pendingUpload = null, editSlug = null, lastFocus = null, exporting = false;

// Old #l=<id> viewer links move to the unified viewer page.
const hashListing = location.hash.match(/^#l=(.+)$/);
if (hashListing) {
  location.replace(new URL('view.html?slug=' + encodeURIComponent(hashListing[1]), location.href).href);
}

// ── rendering ─────────────────────────────────────────────────────
function renderPanel(cat, { animateLast = false } = {}) {
  const el = document.querySelector(`.panel[data-cat="${cat}"]`);
  const picks = state.picks[cat];
  const slots = el.querySelector('.slots');
  if (!picks.length) {
    slots.innerHTML = '<div class="slotbox empty"><span class="hint">+ add</span></div>';
    slots.className = 'slots';
  } else {
    const mode = state.layout === 'auto' ? resolveLayout(buildPayload()) : state.layout;
    const opts = { editable: true, showAll: true };
    if (mode === 'm2') renderSlotsM2(el, picks, opts);
    else if (mode === 'm3') renderSlotsClassic(el, picks, opts);
    else renderSlotsM1(el, picks, opts);
  }
  const add = el.querySelector('.add');
  if (add) add.textContent = `+ Add (${picks.length})`;
  if (animateLast) {
    const skins = slots.querySelectorAll('.skin');
    skins[skins.length - 1]?.classList.add('added');
  }
}
const renderAll = (opts) => { CF.ALL_CATS.forEach(c => renderPanel(c, opts)); refreshLayout(); };

function hydrateTexts() {
  card.querySelectorAll('[data-key]').forEach(el => {
    const v = state.texts[el.dataset.key];
    if (v != null) el.textContent = v;
  });
}

function hydrateRanks() {
  ['crank', 'prank'].forEach(key => {
    const row = card.querySelector(`.rankrow[data-rank="${key}"]`);
    if (!row) return;
    const badge = row.querySelector('.rankbadge');
    if (state.ranks[key]) {
      badge.src = state.ranks[key];
      badge.removeAttribute('hidden');
      badge.style.display = '';
    } else {
      badge.removeAttribute('src');
      badge.style.display = 'none';
    }
    const txt = state.texts[key];
    if (txt != null) row.querySelector('b').textContent = txt;
  });
}

function hydrateAssets() {
  const avatar = card.querySelector('.avatar');
  avatar.src = state.assets.avatar || AVATAR_PLACEHOLDER;
  const pcard = card.querySelector('.pcard');
  if (state.assets.pcard) {
    pcard.style.backgroundImage = `url("${state.assets.pcard}")`;
    pcard.querySelector('.hint')?.remove();
  }
  const box = card.querySelector('.charms-box');
  if (state.assets.buddies.length) {
    box.querySelector('.hint')?.remove();
    box.querySelectorAll('img').forEach(i => i.remove());
    state.assets.buddies.forEach(url => {
      const img = new Image();
      img.src = url;
      img.alt = 'Gun buddy';
      box.appendChild(img);
    });
  }
}

function renderFromState() {
  CF.applyTheme(state.theme);
  hydrateTexts();
  hydrateRanks();
  renderAll();
  hydrateAssets();
  syncFormFromState(); /* FM: import/draft/edit-mode/boot-restore repopulate the phone form */
}

function captureTexts() {
  card.querySelectorAll('[data-key]').forEach(el => {
    state.texts[el.dataset.key] = el.textContent.trim();
  });
}

// ── picker modal ──────────────────────────────────────────────────
function modalVis({ search = true, filters = true, grid = true, variant = false, upload = false } = {}) {
  mSearch.style.display = search ? '' : 'none';
  CF.$('mFilters').style.display = filters ? '' : 'none';
  CF.$('mLadder').style.display = filters ? '' : 'none';
  const mb = CF.$('mBody'); if (mb) mb.classList.toggle('noladder', !filters);
  mGrid.style.display = grid ? '' : 'none';
  CF.$('mVariant').hidden = !variant;
  if (!variant) modal.querySelectorAll('video').forEach((v) => { try { v.pause(); } catch {} });
  modal.classList.toggle('variant-wide', variant);
  CF.$('mUpload').hidden = !upload;
}
function openModal() {
  lastFocus = document.activeElement;
  modal.hidden = false;
  mSearch.focus();
}
function closeModal() {
  modal.querySelectorAll('video').forEach((v) => {
    try { v.pause(); } catch {}
  });
  modal.hidden = true;
  if (lastFocus?.isConnected) lastFocus.focus();
}

function openPicker(cat) {
  pickerMode = 'skin';
  currentCat = cat;
  filterWeapon = '';
  filterTier = '';
  filterOwned = false;
  filterAnim = false;
  tierOnly = false;
  CF.$('mTitle').textContent = 'Add ' + cat;
  modalVis();
  CF.$('mLadder').style.display = '';
  currentPool = CF.FREE_CATS.includes(cat)
    ? Object.values(DB).flat().sort((x, y) => (x.weapon + x.name).localeCompare(y.weapon + y.name))
    : (DB[cat] || []);
  const wCounts = {};
  currentPool.forEach(s => {
    wCounts[s.weapon] = (wCounts[s.weapon] || 0) + 1;
  });
  const w = Object.keys(wCounts).sort();
  const ownedN = (state.owned[cat] || []).length;
  CF.$('mWeapons').innerHTML = (ownedN
    ? `<button class="chip" data-owned="1">Owned (${ownedN})</button>`
    : '') +
    '<button class="chip active" data-w="">All</button>' +
    w.map(x => `<button class="chip" data-w="${CF.esc(x)}">${CF.esc(x)} (${wCounts[x]})</button>`).join('');
  const addOwned = CF.$('mAddOwned');
  addOwned.hidden = !ownedN || CF.FREE_CATS.includes(cat);
  addOwned.textContent = `Add all owned (${ownedN})`;
  CF.$('mTiers').style.display = TIERS.length ? '' : 'none';
  const animCount = currentPool.filter(s => (s.maxLevel || 1) >= 2).length;
  CF.$('mTiers').innerHTML = `<button class="chip${filterAnim ? ' active' : ''}" data-anim="1">✦ Animated (${animCount})</button>`;
  mSearch.value = '';
  renderGrid();
  openModal();
}

function openRankPickerForKey(key) {
  pickerMode = 'rank';
  rankRow = card.querySelector('.rankrow[data-rank="' + key + '"]');
  rankKey = key;
  CF.$('mTitle').textContent = 'Select rank';
  modalVis({ filters: false });
  mSearch.value = '';
  renderGrid();
  openModal();
}

function openRankPicker(btn) {
  openRankPickerForKey(btn.closest('.rankrow').dataset.rank);
}

function paintChips() {
  document.querySelectorAll('#mWeapons .chip').forEach(c => {
    if (c.dataset.owned !== undefined) c.classList.toggle('active', filterOwned);
    else if (c.dataset.allcards !== undefined) c.classList.toggle('active', !filterOwned);
    else c.classList.toggle('active', !filterOwned && (c.dataset.w || '') === filterWeapon);
  });
  document.querySelectorAll('#mTiers .chip').forEach(c => {
    if (c.dataset.anim !== undefined) c.classList.toggle('active', filterAnim);
  });
}

function paintLadder(countsByTier) {
  document.querySelectorAll('#mLadder .rung').forEach(rung => {
    const t = rung.dataset.tier;
    const name = rung.querySelector('span').textContent;
    const n = countsByTier[t] || 0;
    rung.querySelector('b').textContent = n;
    rung.classList.toggle('zero', n === 0);
    rung.classList.toggle('on', filterTier === t && !tierOnly);
    rung.classList.toggle('only', filterTier === t && tierOnly);
    rung.title = `Show only ${name} — click again for ${name} and above, third click clears`;
  });
}

function renderGrid() {
  const q = mSearch.value.toLowerCase();
  if (pickerMode !== 'card') mGrid.parentElement.querySelector('.gridcap')?.remove();
  if (pickerMode === 'rank') {
    list = RANKS.filter(r => !q || r.name.toLowerCase().includes(q));
    CF.$('mCount').textContent = list.length + ' results';
    mGrid.innerHTML = list.map((r, i) =>
      `<button class="item" data-i="${i}">${r.icon
        ? `<img loading="lazy" src="${CF.esc(r.icon)}" alt="" style="height:44px">`
        : '<span class="noicon">—</span>'}<b>${CF.esc(r.name)}</b><span>competitive tier</span>${r.icon ? `<i class="tdot" style="background:${r.color}"></i>` : ''}</button>`
    ).join('') || '<p class="none">No matches.</p>';
    return;
  }
  if (pickerMode === 'buddy') {
    const q = mSearch.value.toLowerCase();
    const ownedSet = new Set(state.ownedBuddies || []);
    const onCard = new Set(state.assets.buddies);
    list = currentPool.filter(b =>
      (!filterOwned || ownedSet.has(b.uuid)) &&
      (!q || b.name.toLowerCase().includes(q)));
    CF.$('mCount').textContent = list.length + ' results';
    mGrid.innerHTML = list.map((b, i) =>
      `<button class="item" data-i="${i}"${onCard.has(b.icon) ? ' aria-label="' + CF.esc(b.name) + ', already on card"' : ''}>${onCard.has(b.icon) ? '<i class="cnt">✓</i>' : ''}<img loading="lazy" src="${CF.esc(b.icon)}" alt=""><b>${CF.esc(b.name)}</b><span>gun buddy</span></button>`
    ).join('') || '<p class="none">No matches.</p>';
    return;
  }
  if (pickerMode === 'card') {
    const ownedSet = new Set(state.ownedCards || []);
    const shown = state.assets.pcard;
    list = currentPool.filter(c =>
      (!filterOwned || ownedSet.has(c.uuid)) &&
      (!q || c.name.toLowerCase().includes(q)));
    CF.$('mCount').textContent = list.length + ' results';
    mGrid.innerHTML = list.map((c, i) => {
      const active = !!shown && c.wide === shown;
      return `<button class="item cardcell" data-i="${i}"${active ? ' aria-label="' + CF.esc(c.name) + ', currently shown"' : ''}>${active ? '<i class="cnt">✓</i>' : ''}${ownedSet.has(c.uuid) ? '<i class="ownlv">owned</i>' : ''}<img loading="lazy" src="${CF.esc(c.icon)}" alt=""><b>${CF.esc(c.name)}</b><span>Player card</span></button>`;
    }).join('') || '<p class="none">No matches.</p>';
    if (!mGrid.parentElement.querySelector('.gridcap')) {
      mGrid.insertAdjacentHTML('afterend', '<p class="gridcap">Player card</p>');
    }
    return;
  }
  const counts = {};
  (state.picks[currentCat] || []).forEach(p => counts[p.id] = (counts[p.id] || 0) + 1);
  const ownedSet = filterOwned && (state.owned[currentCat] || []).length ? new Set(state.owned[currentCat]) : null;
  lastTierCounts = {};
  currentPool.forEach(s => {
    if (filterWeapon && s.weapon !== filterWeapon) return;
    if (filterAnim && (s.maxLevel || 1) < 2) return;
    if (ownedSet && !ownedSet.has(s.id)) return;
    if (q && !(s.name + ' ' + s.weapon).toLowerCase().includes(q)) return;
    const t = CF.tierKey(s.tier);
    lastTierCounts[t] = (lastTierCounts[t] || 0) + 1;
  });
  paintLadder(lastTierCounts);
  list = currentPool.filter(s =>
    (!filterWeapon || s.weapon === filterWeapon) &&
    (!filterTier || ((CF.tierKey(s.tier) === CF.tierKey(filterTier) && tierOnly) || (!tierOnly && TIER_RANK[CF.tierKey(s.tier)] >= TIER_RANK[CF.tierKey(filterTier)]))) &&
    (!filterAnim || (s.maxLevel || 1) >= 2) &&
    (!q || (s.name + ' ' + s.weapon).toLowerCase().includes(q)));
  if (ownedSet) list = list.filter(s => ownedSet.has(s.id));
  list.sort((a, b) => (TIER_RANK[CF.tierKey(b.tier)] || 0) - (TIER_RANK[CF.tierKey(a.tier)] || 0) || a.name.localeCompare(b.name));
  CF.$('mCount').textContent = list.length + ' results' + (filterTier ? ' · ' + filterTier.toUpperCase() + (tierOnly ? ' only' : '+') : '');
  mGrid.innerHTML = list.map((s, i) => {
    const anim = (s.maxLevel || 1) >= 2;
    const ownLv = (state.ownedLevels || {})[s.id] || 0;
    return `<button class="item" data-i="${i}"${counts[s.id] ? ' aria-label="' + CF.esc(s.name) + ', already on card ' + counts[s.id] + '×"' : ''}>${counts[s.id] ? `<i class="cnt">×${counts[s.id]}</i>` : ''}${ownLv >= 2 ? `<i class="ownlv">L${ownLv}</i>` : ''}<img loading="lazy" src="${CF.esc(s.icon)}" alt=""><b>${CF.esc(s.name)}</b><span>${CF.esc(s.weapon)}${s.tier ? ' • ' + CF.esc(s.tier) : ''}${anim ? ' • <em class="anim" title="Has upgrade levels (animations)">✦</em>' : ''}</span>${s.tier ? `<i class="dot tdot ${CF.tierClass(s.tier)}"></i>` : ''}${s.chromas && s.chromas.length > 1 ? `<span class="vdots">${s.chromas.slice(0, 5).map((c, ci) => `<span class="vd" data-ch="${ci}" title="${CF.esc(c.label)}"><img loading="lazy" src="${CF.esc(c.sw || c.icon)}" alt=""></span>`).join('')}</span>` : ''}</button>`;
  }).join('') || '<p class="none">No matches.</p>';
}

function addSkin(cat, s, chroma) {
  const lvl = (state.ownedLevels || {})[s.id] || 0;
  state.picks[cat].push({ id: s.id, weapon: s.weapon, name: s.name, tier: s.tier, icon: chroma ? chroma.icon : s.icon, ...(chroma ? { level: chroma.unlock || s.maxLevel || 2, variant: { name: chroma.label, icon: chroma.icon } } : (lvl >= 2 ? { level: lvl } : {})) });
  renderPanel(cat, { animateLast: true });
  recountStats();      /* CF-27: counters track manual edits */
  refreshLayout();
  afterPicksChange(); /* FM: refresh phone form skins + stats */
}

function applyRank(r) {
  state.texts[rankKey] = r.name;
  state.ranks[rankKey] = r.icon || null;
  rankRow.querySelector('b').textContent = r.name;
  const badge = rankRow.querySelector('.rankbadge');
  if (r.icon) badge.src = r.icon;
  else badge.removeAttribute('src');
  const fn = document.getElementById('f-' + rankKey + '-name'); /* FM: phone form rank label */
  if (fn) fn.textContent = r.name;
  const fb = document.getElementById('f-' + rankKey + '-badge');
  if (fb) { if (r.icon) fb.src = r.icon; else fb.removeAttribute('src'); }
  closeModal();
  refreshLayout();
}

function paintVariantPreview() {
  const p = state.picks[variantCat] && state.picks[variantCat][variantIdx]; if (!p) return;
  const s = SKIN_BY_ID.get(p.id) || {};
  const levels = s.levels || [];
  const lv = p.level || 1;
  const ld = levels[lv - 1];
  const chromas = s.chromas || [];
  const k = p.variant ? chromas.findIndex(c => c.icon === p.variant.icon) : 0;
  const c = chromas[Math.max(0, k)];
  const cv = k > 0 && chromas[k] && chromas[k].video;
  const mute = `<button class="vp-mute" type="button" data-vp-mute aria-pressed="${vpMuted ? 'true' : 'false'}" aria-label="${vpMuted ? 'Unmute preview' : 'Mute preview'}">${vpMuted ? '🔇' : '🔊'}</button>`;
  let levelHtml;
  if (cv) {
    levelHtml = `<video src="${CF.esc(chromas[k].video)}" loop autoplay playsinline></video>${mute}<span class="vpnote">${CF.esc(chromas[k].label || '')} showcase · L${lv}</span>`;
  } else if (ld && ld.video) {
    levelHtml = `<video src="${CF.esc(ld.video)}" loop autoplay playsinline></video>${mute}<span class="vpnote">Level ${lv} animation${k > 0 ? ' · default colorway footage' : ''}</span>`;
  } else {
    levelHtml = '<span class="vpnote">No preview footage for this skin.</span>';
  }
  CF.$('vpLevel').innerHTML = levelHtml;
  CF.$('vpChroma').innerHTML = c ? `<img src="${CF.esc(c.full || c.icon)}" alt="${CF.esc(c.label || '')}"><span class="vpnote">${CF.esc(c.label || '')}</span>` : '<span class="vpnote">no colorways</span>';
  CF.$('vPrev').hidden = !(levels.length > 1 || chromas.length > 1);
  const vv = CF.$('vpLevel').querySelector('video'); if (vv) vv.play().then(() => {}).catch(() => { vv.muted = true; vpMuted = true; const mb = CF.$('vpLevel').querySelector('[data-vp-mute]'); if (mb) { mb.textContent = '🔇'; mb.setAttribute('aria-pressed', 'false'); mb.setAttribute('aria-label', 'Unmute preview'); } });
}

function ensureRichSkin(s) {
  if (!s || s._rich) return;
  s._rich = true;
  const needs = !(s.levels || []).some(l => l.video) || (s.chromas || []).some(c => !c.full);
  if (!needs) return;
  fetch('https://valorant-api.com/v1/weapons/skins/' + encodeURIComponent(s.id))
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      const d = j && j.data;
      if (!d) return;
      s.levels = (d.levels || []).map((l, i) => ({ level: i + 1, video: l.streamedVideo || '' }));
      s.chromas = (s.chromas || []).map((c, i) => {
        const dc = (d.chromas || [])[i] || {};
        return Object.assign({}, c, { full: c.full || dc.fullRender || '', sw: c.sw || dc.swatch || '', video: c.video || dc.streamedVideo || '' });
      });
      paintVariantPreview();
    })
    .catch(() => {});
}

function openVariantModal(cat, idx) {
  pickerMode = 'variant';
  variantCat = cat; variantIdx = idx;
  const p = state.picks[cat][idx];
  if (!p) return;
  const s = SKIN_BY_ID.get(p.id) || { maxLevel: 1, chromas: [] };
  CF.$('mTitle').textContent = `${p.weapon} — ${p.name}`;
  CF.$('mCount').textContent = '';
  modalVis({ search: false, filters: false, grid: false, variant: true });
  CF.$('mAddOwned').hidden = true;
  const maxLevel = s.maxLevel || 1;
  CF.$('vLevels').innerHTML = maxLevel > 1
    ? Array.from({ length: maxLevel }, (_, k) =>
        `<button class="chip${(p.level || 1) === k + 1 ? ' active' : ''}" data-lv="${k + 1}">L${k + 1}${k === 0 ? ' · base' : ''}</button>`).join('')
    : '<span class="vnote">Base skin — no upgrade levels.</span>';
  const chromas = s.chromas || [];
  const ownedSet = new Set(state.ownedVariants || []);
  CF.$('vChromas').innerHTML = chromas.length > 1
    ? chromas.map((c, k) => {
        const sel = p.variant ? p.variant.icon === c.icon : k === 0;
        return `<button class="vchroma${sel ? ' active' : ''}" data-ch="${k}" title="${CF.esc(c.label)}">${ownedSet.has(c.uuid) ? '<i class="own">✓</i>' : ''}<img loading="lazy" src="${CF.esc(c.icon)}" alt=""><b>${CF.esc(c.label)}</b>${c.unlock ? `<span>unlocks L${c.unlock}</span>` : ''}</button>`;
      }).join('')
    : '<span class="vnote">No color variants.</span>';
  openModal();
  CF.$('vDone').focus();
  ensureRichSkin(s);
  paintVariantPreview();
}

async function openBuddyPicker() {
  if (!BUDDIES_LIST.length) {
    CF.status('Loading the buddy database…', 'info');
    const ok = await ensureBuddyCardData();
    if (!ok) return;
  }
  pickerMode = 'buddy';
  currentPool = BUDDIES_LIST;
  filterOwned = false;
  CF.$('mTitle').textContent = 'Add gun buddies';
  CF.$('mCount').textContent = '';
  modalVis({ search: true, filters: true, grid: true, upload: true });
  CF.$('mLadder').style.display = 'none';
  CF.$('mBody').classList.add('noladder');
  const ownedN = (state.ownedBuddies || []).length;
  CF.$('mWeapons').innerHTML = ownedN
    ? `<button class="chip" data-owned="1">Owned (${ownedN})</button>`
    : '';
  CF.$('mTiers').style.display = 'none';
  const addOwned = CF.$('mAddOwned');
  addOwned.hidden = !ownedN;
  addOwned.textContent = `Add all owned (${Math.min(ownedN, 12)})`;
  mSearch.value = '';
  renderGrid();
  openModal();
}

function addBuddy(b) {
  if (!b) return;
  if (state.assets.buddies.includes(b.icon)) {
    CF.status(`${b.name} is already on the card.`, 'info');
    return;
  }
  state.assets.buddies.push(b.icon);
  const box = card.querySelector('.charms-box');
  box.querySelector('.hint')?.remove();
  const img = new Image();
  img.src = b.icon;
  img.alt = 'Gun buddy';
  box.appendChild(img);
  refreshLayout();
  renderFormBuddies(); /* FM: keep phone form buddy grid in sync */
}

async function openCardPicker() {
  if (!CARDS_LIST.length) {
    CF.status('Loading the player-card database…', 'info');
    const ok = await ensureBuddyCardData();
    if (!ok) return;
  }
  pickerMode = 'card';
  currentPool = CARDS_LIST;
  filterOwned = (state.ownedCards || []).length > 0;
  CF.$('mTitle').textContent = 'Choose a player card';
  CF.$('mCount').textContent = '';
  modalVis({ search: true, filters: true, grid: true, upload: true });
  CF.$('mLadder').style.display = 'none';
  CF.$('mBody').classList.add('noladder');
  const ownedN = (state.ownedCards || []).length;
  CF.$('mWeapons').innerHTML =
    (ownedN ? `<button class="chip" data-owned="1">Owned (${ownedN})</button>` : '') +
    '<button class="chip" data-allcards="1">All cards</button>';
  CF.$('mTiers').style.display = 'none';
  CF.$('mAddOwned').hidden = true;
  mSearch.value = '';
  paintChips();
  renderGrid();
  openModal();
}

function applyCard(c) {
  if (!c) return;
  state.assets.pcard = c.wide;
  const pc = card.querySelector('.pcard');
  pc.style.backgroundImage = `url("${c.wide}")`;
  pc.querySelector('.hint')?.remove();
  closeModal();
  refreshLayout();
  syncFormArt(); /* FM: keep the phone form player-card tile in sync */
}

// ── modal events ──────────────────────────────────────────────────
CF.$('mWeapons').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  if (c.dataset.allcards !== undefined) { filterOwned = false; paintChips(); renderGrid(); return; }
  if (c.dataset.owned !== undefined) { filterOwned = !filterOwned; paintChips(); renderGrid(); return; }
  filterWeapon = c.dataset.w || ''; paintChips(); renderGrid();
});
CF.$('mTiers').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  if (c.dataset.anim !== undefined) { filterAnim = !filterAnim; paintChips(); renderGrid(); }
});
CF.$('mLadder').addEventListener('click', e => {
  const rung = e.target.closest('.rung');
  if (rung) {
    const t = rung.dataset.tier;
    if (filterTier !== t) { filterTier = t; tierOnly = true; }
    else if (tierOnly) { tierOnly = false; }
    else { filterTier = ''; }
    paintLadder(lastTierCounts); renderGrid();
    return;
  }
  if (e.target.closest('#mLadderClear')) {
    filterTier = ''; tierOnly = false;
    paintLadder(lastTierCounts); renderGrid();
  }
});
CF.$('mAddOwned').addEventListener('click', () => {
  if (pickerMode === 'buddy') {
    const ownedSet = new Set(state.ownedBuddies || []);
    const onCard = new Set(state.assets.buddies);
    BUDDIES_LIST.filter(b => ownedSet.has(b.uuid) && !onCard.has(b.icon)).slice(0, 12).forEach(addBuddy);
    renderGrid();
    return;
  }
  const ids = state.owned[currentCat] || [];
  if (!ids.length) return;
  const idSet = new Set(ids);
  const have = new Set(state.picks[currentCat].map(p => p.id));
  (DB[currentCat] || []).forEach(s => {
    if (idSet.has(s.id) && !have.has(s.id)) {
      const lvl = (state.ownedLevels || {})[s.id] || 0;
      state.picks[currentCat].push({ id: s.id, weapon: s.weapon, name: s.name, tier: s.tier, icon: s.icon, ...(lvl >= 2 ? { level: lvl } : {}) });
      have.add(s.id);
    }
  });
  renderPanel(currentCat);
  refreshLayout();
  renderGrid();
  afterPicksChange(); /* FM: bulk add supplies the missing recount */
});
mGrid.addEventListener('click', e => {
  const vd = e.target.closest('.vd');
  if (vd && pickerMode === 'skin') {
    const item = vd.closest('.item');
    const s = list[+item.dataset.i];
    const c = +vd.dataset.ch > 0 ? s.chromas[+vd.dataset.ch] : null;
    addSkin(currentCat, s, c); renderGrid(); return;
  }
  const b = e.target.closest('.item'); if (!b) return;
  if (pickerMode === 'rank') { applyRank(list[+b.dataset.i]); return; }
  if (pickerMode === 'buddy') { addBuddy(list[+b.dataset.i]); renderGrid(); return; }
  if (pickerMode === 'card') { applyCard(list[+b.dataset.i]); return; }
  addSkin(currentCat, list[+b.dataset.i]);
  renderGrid();
});
mSearch.addEventListener('input', renderGrid);
mSearch.addEventListener('keydown', e => {
  if (e.key === 'Enter' && list.length) {
    if (pickerMode === 'rank') applyRank(list[0]);
    else if (pickerMode === 'buddy') { addBuddy(list[0]); renderGrid(); }
    else if (pickerMode === 'card') applyCard(list[0]);
    else { addSkin(currentCat, list[0]); renderGrid(); }
  }
});
CF.$('mClose').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
CF.$('mUpload').addEventListener('click', () => {
  pendingUpload = pickerMode === 'card' ? card.querySelector('.pcard') : card.querySelector('.charms-box');
  fileInput.click();
});
CF.$('vLevels').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c || pickerMode !== 'variant') return;
  const p = state.picks[variantCat]?.[variantIdx]; if (!p) return;
  const lv = +c.dataset.lv;
  if (lv >= 2) p.level = lv; else delete p.level;
  renderPanel(variantCat);
  CF.$('vLevels').querySelectorAll('.chip').forEach(x => x.classList.toggle('active', +x.dataset.lv === (p.level || 1)));
  paintVariantPreview();
  refreshLayout();
  afterPicksChange(); /* FM: level change updates form tiles + stats */
});
CF.$('vChromas').addEventListener('click', e => {
  const b = e.target.closest('.vchroma'); if (!b || pickerMode !== 'variant') return;
  const p = state.picks[variantCat]?.[variantIdx]; if (!p) return;
  const s = SKIN_BY_ID.get(p.id);
  const chromas = (s && s.chromas) || [];
  const c = chromas[+b.dataset.ch]; if (!c) return;
  if (+b.dataset.ch === 0) {
    delete p.variant;
    if (s) p.icon = s.icon;
  } else {
    p.variant = { name: c.label, icon: c.icon };
    p.icon = c.icon;
    p.level = c.unlock || s.maxLevel || p.level;
  }
  renderPanel(variantCat);
  CF.$('vChromas').querySelectorAll('.vchroma').forEach(x => {
    const k = +x.dataset.ch;
    x.classList.toggle('active', p.variant ? chromas[k].icon === p.variant.icon : k === 0);
  });
  CF.$('vLevels').querySelectorAll('.chip').forEach(x => x.classList.toggle('active', +x.dataset.lv === (p.level || 1)));
  paintVariantPreview();
  refreshLayout();
  afterPicksChange(); /* FM: chroma change updates form tiles + stats */
});
CF.$('vpLevel').addEventListener('click', e => {
  const mute = e.target.closest('[data-vp-mute]');
  if (mute) {
    vpMuted = !vpMuted;
    const v = CF.$('vpLevel').querySelector('video');
    if (v) v.muted = vpMuted;
    mute.textContent = vpMuted ? '🔇' : '🔊';
    mute.setAttribute('aria-pressed', vpMuted ? 'true' : 'false');
    mute.setAttribute('aria-label', vpMuted ? 'Unmute preview' : 'Mute preview');
    return;
  }
});
CF.$('vRemove').addEventListener('click', () => {
  if (pickerMode !== 'variant') return;
  const arr = state.picks[variantCat];
  if (arr && arr[variantIdx]) { arr.splice(variantIdx, 1); renderPanel(variantCat); recountStats(); }
  closeModal();
  refreshLayout();
  afterPicksChange(); /* FM: precise remove updates form tiles + stats */
});
CF.$('vDone').addEventListener('click', () => { if (pickerMode === 'variant') closeModal(); refreshLayout(); });

// ── riot token import (Explorant-style account pull) ────────────
CF.$('importBtn').addEventListener('click', () => {
  iStatus('');
  if (!supabase) {
    CF.status('Token import needs Supabase configured — see SETUP.md (riot-import).', 'err');
    return;
  }
  importModal.hidden = false;
  CF.$('iToken').focus();
});
CF.$('iClose').addEventListener('click', () => { importModal.hidden = true; });
importModal.addEventListener('click', e => { if (e.target === importModal) importModal.hidden = true; });

// Decode a JWT's payload claims (base64url) without verifying the signature.
// Only used to read `exp`; multi-byte values elsewhere are irrelevant to us.
function jwtClaims(jwt) {
  try {
    const part = String(jwt).split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(pad));
  } catch { return null; }
}

const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// Parse whatever the seller pasted into { token, entitlements }, or return an
// actionable { code, message } explaining why it can't be used. Accepts a bare
// JWT, the opt_in redirect URL (#access_token=...), or the local-client
// entitlements JSON ({"accessToken":...,"token":...}).
function parseTokenInput(raw) {
  const v = (raw || '').trim();
  if (!v) return { code: 'empty', message: 'Paste your Riot access token first.' };

  let token = '';
  let entitlements = '';

  if (v.startsWith('{')) {
    try {
      const o = JSON.parse(v);
      token = String(o.accessToken || o.access_token || '').trim();
      entitlements = String(
        o.token || o.entitlements || o.entitlements_token || o.entitlementsToken || o.ent_token || ''
      ).trim();
    } catch {
      return { code: 'malformed', message: "That looks like JSON but didn't parse. Copy the full entitlements response, or just the access token (starts with eyJ…)." };
    }
  } else if (v.includes('access_token=') || v.includes('accessToken=')) {
    const compact = v.replace(/\s+/g, '');
    const m = compact.match(/(?:access_token|accessToken)=([^&#\s]+)/);
    if (m) { try { token = decodeURIComponent(m[1]); } catch { token = m[1]; } }
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
    // A URL with no access_token in it (e.g. a stripped opt_in redirect).
    return { code: 'no-token', message: "Couldn't find an access token in that URL. If it's the opt_in redirect, copy it before the page redirects — the #access_token=… part is stripped within seconds. Or paste the token itself (starts with eyJ…)." };
  } else {
    token = v;
  }

  if (!token) {
    return { code: 'no-token', message: "Couldn't find an access token in that. If you pasted the opt_in URL, copy it before the page redirects — the #access_token=… part is stripped within seconds. Or paste the token itself (starts with eyJ…)." };
  }
  if (!JWT_RE.test(token)) {
    return { code: 'malformed', message: "That doesn't look like a Riot access token (expected a JWT starting with eyJ…). Re-copy the token, not the surrounding URL or JSON." };
  }
  const exp = jwtClaims(token) && jwtClaims(token).exp;
  if (typeof exp === 'number') {
    const secsLeft = exp - Math.floor(Date.now() / 1000);
    if (secsLeft <= 0) {
      const mins = Math.max(1, Math.round(-secsLeft / 60));
      return { code: 'expired', message: `That access token expired ~${mins} min ago — Riot tokens last ~1h. Grab a fresh one.` };
    }
  }
  return { token, entitlements };
}

function iStatus(text, kind) {
  const el = CF.$('iStatus');
  if (!el) return;
  el.textContent = text || '';
  if (kind) el.setAttribute('data-kind', kind);
  else el.removeAttribute('data-kind');
}

CF.$('iRun').addEventListener('click', async () => {
  const btn = CF.$('iRun');
  const parsed = parseTokenInput(CF.$('iToken').value);
  if (!parsed.token) {
    if (parsed.code === 'expired') { iStatus(''); importModal.hidden = true; CF.status(parsed.message, 'err'); }
    else iStatus(parsed.message, 'err');
    CF.$('iToken').focus();
    return;
  }
  const ent = CF.$('iEnt').value.trim() || parsed.entitlements || '';
  btn.disabled = true;
  btn.textContent = 'Importing…';
  iStatus('Importing account — checking your Riot ID, inventory and rank. This takes a few seconds.', 'busy');
  try {
    const r = await fetch(CONFIG.SUPABASE_URL + '/functions/v1/riot-import', {
      method: 'POST',
      headers: { apikey: CONFIG.SUPABASE_ANON_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        accessToken: parsed.token,
        entitlements: ent,
        region: CF.$('iRegion').value
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
    /* CF-24: the import maps owned buddies/cards through the lazy picker
       data, so load it before applying — the import is the one flow that
       needs it immediately */
    if (j.buddiesOwned || j.charms || j.cardsOwned) await ensureBuddyCardData();
    applyImport(j);
    iStatus('');
    importModal.hidden = true;
    CF.$('iToken').value = '';
    CF.$('iEnt').value = '';
    CF.status(`Imported ${j.name || 'account'}#${j.tag || ''} — level ${j.level ?? '?'}` +
      (j.skins ? ` · ${j.skins.length} skins owned (${Object.values(state.ownedLevels).filter(l => l >= 2).length} animated)` : '') +
      (j.errors && j.errors.length ? ' · partial: ' + j.errors.join(', ') : '') + '.', 'ok');
    refreshLayout();
  } catch (e) {
    const msg = 'Import failed: ' + (e.message || e);
    if (/expired/i.test(e.message || '')) { iStatus(''); importModal.hidden = true; CF.status(msg, 'err'); }
    else iStatus(msg, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import';
  }
});

function applyImport(j) {
  if (j.level != null) state.texts.level = String(j.level);
  if (j.name) state.texts.vlogin = j.tag ? j.name + '#' + j.tag : j.name;
  if (j.vp != null) state.texts.vp = String(j.vp);
  if (j.rp != null) state.texts.rp = String(j.rp);
  if (j.kc != null) state.texts.kc = String(j.kc);
  if (j.rankTier) {
    const r = CF.rankByFlat(j.rankTier, RANKS);
    if (r && r.name !== 'UNRANKED') { state.texts.crank = r.name; const crankIcon = r.icon || (RANKS.find(x => x.name === r.name) || {}).icon || null; state.ranks.crank = crankIcon; }
  }
  if (j.peakTier) {
    const r = CF.rankByFlat(j.peakTier, RANKS);
    if (r && r.name !== 'UNRANKED') { state.texts.prank = r.name; const prankIcon = r.icon || (RANKS.find(x => x.name === r.name) || {}).icon || null; state.ranks.prank = prankIcon; }
  }
  if (j.playerCard) {
    const wide = (CARDS[j.playerCard] || {}).wide ||
      `https://media.valorant-api.com/playercards/${j.playerCard}/wideart.png`;
    if (wide) state.assets.pcard = wide;
  }
  const charmIcons = (j.charms || []).map(id => BUDDIES[id]).filter(Boolean);
  if (charmIcons.length) state.assets.buddies = charmIcons.slice(0, 12);
  if (j.skins) {
    const ownedLevels = {};
    j.skins.forEach(u => {
      const m = LEVEL_MAP[u];
      if (m) ownedLevels[m.id] = Math.max(ownedLevels[m.id] || 0, m.level);
      else if (SKIN_BY_ID.has(u)) ownedLevels[u] = Math.max(ownedLevels[u] || 1, 1);
    });
    state.ownedLevels = ownedLevels;
    state.owned = {};
    CF.ALL_CATS.forEach(c => state.owned[c] = []);
    CF.ALL_CATS.forEach(c => { state.picks[c] = []; });
    const union = [];
    SKIN_BY_ID.forEach(s => { if (ownedLevels[s.id]) union.push(s.id); });
    CF.CATS.forEach(c => {
      state.owned[c] = (DB[c] || []).filter(s => ownedLevels[s.id]).map(s => s.id);
    });
    state.owned['Flex'] = union;
    const used = new Set();
    const scoreOf = (s) => {
      const tr = TIER_RANK[CF.tierKey(s.tier)] || 0;
      return (tr >= 3 ? 1000 - tr : 0) + ((s.maxLevel || 1) >= 2 ? 100 : 0) + (s.maxLevel || 1);
    };
    CF.CATS.forEach(c => {
      const pool = (state.owned[c] || []).map((id) => SKIN_BY_ID.get(id)).filter(Boolean).filter((s) => !used.has(s.id));
      if (!pool.length) return;
      pool.sort((a, b) => scoreOf(b) - scoreOf(a) || a.name.localeCompare(b.name));
      pool.forEach(s => {
        used.add(s.id);
        const lvl = state.ownedLevels[s.id] || 0;
        state.picks[c].push({ id: s.id, weapon: s.weapon, name: s.name, tier: s.tier, icon: s.icon, ...(lvl >= 2 ? { level: lvl } : {}) });
      });
    });
    CF.ALL_CATS.forEach(c => state.picks[c].forEach(p => {
      const l = ownedLevels[p.id];
      if (l >= 2) p.level = l;
      else if (l === 1) delete p.level;
    }));
  }
  const ownedSkins = SKIN_BY_ID ? [...new Set(Object.keys(state.ownedLevels))]
    .map(id => SKIN_BY_ID.get(id)).filter(Boolean) : [];
  const keyOf = s => CF.tierKey(s.tier);
  const counts = {
    prems: ownedSkins.filter(s => ['premium', 'ultra', 'exclusive'].includes(keyOf(s))).length,
    limited: ownedSkins.filter(s => ['ultra', 'exclusive'].includes(keyOf(s))).length,
    semis: ownedSkins.filter(s => keyOf(s) === 'deluxe').length,
    anims: ownedSkins.filter(s => (state.ownedLevels[s.id] || 0) >= 2).length,
  };
  Object.keys(counts).forEach(k => {
    const v = String(counts[k]).padStart(2, '0');
    state.texts[k] = v;
    const el = card.querySelector(`.stat b[data-key="${k}"]`);
    if (el) el.textContent = v;
  });
  if (j.variantsOwned) state.ownedVariants = j.variantsOwned.filter(u => CHROMA_MAP[u]);
  if (j.cardsOwned) state.ownedCards = j.cardsOwned.filter(u => CARDS[u]);
  if (j.buddiesOwned || j.charms) {
    const set = new Set();
    [...(j.buddiesOwned || []), ...(j.charms || [])].forEach(u => {
      const base = BUDDY_BY_ANY[u];
      if (base) set.add(base);
    });
    state.ownedBuddies = [...set];
  }
  if (j.flexOwned) {
    state.picks.Flex = j.flexOwned.map(id => FLEX_BY_ID.get(id)).filter(Boolean)
      .map(f => ({ id: f.uuid, weapon: 'Flex', name: f.name, tier: '', icon: f.icon }));
  }
  renderFromState();
  updateWm();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!importModal.hidden) { importModal.hidden = true; return; }
    const fm = CF.$('faceModal');
    if (fm && !fm.hidden) { fm.hidden = true; return; }
    const rq = CF.$('reqModal');
    if (rq && !rq.hidden) { rq.hidden = true; return; }
    if (!modal.hidden) { closeModal(); return; }
    return;
  }
  if (modal.hidden) return;
  if (e.key === '/' && document.activeElement !== mSearch) { e.preventDefault(); mSearch.focus(); }
  if (e.key === 'Tab') {
    const focusables = [...modal.querySelectorAll('button,input')].filter(el => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

/* Clicking the dimmed backdrop (outside the panel) cancels, same as Esc.
   The press must start AND end on the backdrop so text-dragging inside the
   panel and releasing outside never closes it. routeGate stays choice-locked:
   a new card has to pick artwork or normal, so it gets no cancel path. */
[['modal', () => closeModal()],
 ['faceModal', el => { el.hidden = true; }],
 ['reqModal', el => { el.hidden = true; }],
 ['importModal', el => { el.hidden = true; }]].forEach(([id, close]) => {
  const ov = CF.$(id);
  if (!ov) return;
  let downOnBackdrop = false;
  ov.addEventListener('pointerdown', e => { downOnBackdrop = e.target === ov; });
  ov.addEventListener('click', e => {
    if (downOnBackdrop && e.target === ov) close(ov);
    downOnBackdrop = false;
  });
});

function recountStats() {
  const all = CF.ALL_CATS.flatMap(c => state.picks[c] || []);
  const keyOf = p => CF.tierKey(p.tier);
  const counts = {
    prems: all.filter(p => ['premium', 'ultra', 'exclusive'].includes(keyOf(p))).length,
    limited: all.filter(p => keyOf(p) === 'ultra').length,
    semis: all.filter(p => keyOf(p) === 'deluxe').length,
    anims: all.filter(p => (p.level || 0) >= 2).length,
  };
  Object.keys(counts).forEach(k => {
    const v = String(counts[k]).padStart(2, '0');
    state.texts[k] = v;
    const el = card.querySelector(`.stat b[data-key="${k}"]`);
    if (el) el.textContent = v;
  });
}

// ── card interactions ─────────────────────────────────────────────
card.addEventListener('click', e => {
  const auto = e.target.closest('[data-auto]');
  if (auto) {
    const n = auto.dataset.auto === 'anims'
      ? Object.values(state.picks).flat().filter(p => (p.level || 0) >= 2).length
      : Object.values(state.picks).flat().filter(p => ['premium', 'ultra', 'exclusive'].includes(CF.tierKey(p.tier))).length;
    auto.closest('.stat').querySelector('b').textContent = String(n).padStart(2, '0');
    return;
  }
  const buddy = e.target.closest('.charms-box img');
  if (buddy) {
    const i = state.assets.buddies.indexOf(buddy.src);
    if (i > -1) state.assets.buddies.splice(i, 1);
    buddy.remove();
    renderFormBuddies(); /* FM: keep phone form buddy grid in sync */
    return;
  }
  const cbox = e.target.closest('.charms-box');
  if (cbox) { openBuddyPicker(); return; }
  const rm = e.target.closest('.rm');
  if (rm) {
    const skinEl = rm.closest('.skin');
    skinEl?.classList.add('removing');
    setTimeout(() => {
      const cat = rm.closest('.panel')?.dataset.cat;
      if (cat) {
        const arr = state.picks[cat];
        const i = arr.findIndex(p => p.id === rm.dataset.remove);
        if (i > -1) arr.splice(i, 1);
        renderPanel(cat);
        recountStats();      /* CF-27 */
        refreshLayout();
        afterPicksChange(); /* FM: card-side removal updates form tiles + stats */
      }
    }, 160);
    return;
  }
  const vs = e.target.closest('.skin');
  if (vs) {
    const cat = vs.closest('.panel')?.dataset.cat;
    const idx = +vs.dataset.vp;
    if (cat && state.picks[cat] && state.picks[cat][idx]) openVariantModal(cat, idx);
    return;
  }
  const rp = e.target.closest('[data-rankpick]');
  if (rp) { openRankPicker(rp); return; }
  const add = e.target.closest('.add');
  if (add) { openPicker(add.dataset.add); return; }
  const pc = e.target.closest('.pcard');
  if (pc) { openCardPicker(); return; }
  const up = e.target.closest('[data-upload]');
  if (up) { pendingUpload = up; fileInput.click(); return; }
});

fileInput.addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f || !pendingUpload) return;
  try {
    const url = await CF.resizeToDataUrl(f, 1600);
    const t = pendingUpload;
    const kind = t.dataset.upload;
    if (kind === 'avatar') {
      t.src = url;
      state.assets.avatar = url;
      syncFormArt(); /* FM: phone form avatar preview */
    } else if (kind === 'pcard') {
      t.style.backgroundImage = `url("${url}")`;
      t.querySelector('.hint')?.remove();
      state.assets.pcard = url;
      closeModal();
      syncFormArt(); /* FM: phone form player-card preview */
    } else {
      t.querySelector('.hint')?.remove();
      const img = new Image();
      img.src = url;
      img.alt = 'Gun buddy';
      t.appendChild(img);
      state.assets.buddies.push(url);
      syncFormArt(); renderFormBuddies(); /* FM: art previews + buddy grid stay current */
    }
  } catch {
    CF.status('Could not read that image.', 'err');
  }
  pendingUpload = null;
  fileInput.value = '';
});

// ── export ────────────────────────────────────────────────────────
CF.$('exportBtn').addEventListener('click', async () => {
  if (exporting) return;
  exporting = true;
  CF.$('exportBtn').disabled = true;
  CF.status('Rendering PNG — the card at 2× plus the QR band…');
  try {
    const qrSlug = editSlug || localStorage.getItem('vc-draft-id');
    const qrUrl = qrSlug
      ? new URL('view.html?slug=' + encodeURIComponent(qrSlug), location.href).href
      : null;
    const dims = await CF.exportCard(card, { qrUrl });
    CF.status(dims
      ? `PNG exported — ${dims.width}×${dims.height}: the 1920×1080 card at 2× plus the QR band, exactly what your preview shows.`
      : 'PNG exported.', 'ok');
  } catch (e) {
    CF.status('Export failed: ' + (e.message || e), 'err');
  } finally {
    exporting = false;
    CF.$('exportBtn').disabled = false;
    fit();
  }
});

// ── sale-post text (the text half of the template workflow) ─────
CF.$('postBtn').addEventListener('click', () => {
  captureTexts();
  const t = state.texts;
  const slug = editSlug || localStorage.getItem('vc-draft-id');
  const link = slug
    ? new URL('view.html?slug=' + encodeURIComponent(slug), location.href).href
    : '(unpublished — publish to get a share link)';
  const counts = CF.CATS.map(c => `${c}: ${(state.picks[c] || []).length}`).join(' · ');
  const txt = [
    `${t.code || ''} • ${t.vlogin || ''} • ${t.tag || ''}`,
    `LEVEL ${t.level || '?'} • ${t.crank || 'UNRANKED'} (peak ${t.prank || 'UNRANKED'})`,
    `PREMIUM ${t.prems || '00'} | LIMITED ${t.limited || '00'} | SEMI PREM ${t.semis || '00'} | ANIMATED ${t.anims || '00'}`,
    `${t.wtr || ''} | ${t.receipts || ''} | ${t.owner || ''}`,
    `${t.cname || ''} | ${t.cstatus || ''} | ${t.date || ''}`,
    `${t.premier || ''} | ${t.vlink || ''} | ${t.price || ''}`,
    counts,
    `Link: ${link}`,
    `Contact: ${t.link || ''}`
  ].join('\n');
  CF.copyText(txt);
  CF.status('Sale-post text copied to clipboard.', 'ok');
});

function updateWm() {
  const slugEl = card.querySelector('[data-wm="slug"]');
  const stampEl = card.querySelector('[data-wm="stamp"]');
  const slug = editSlug || localStorage.getItem('vc-draft-id');
  if (slugEl) slugEl.textContent = slug ? 'Listing ' + slug : 'Draft — not published';
  if (stampEl) stampEl.textContent = new Date().toISOString().slice(0, 10);
}

// ── drafts ────────────────────────────────────────────────────────
CF.$('saveBtn').addEventListener('click', () => {
  captureTexts();
  state.theme = document.documentElement.dataset.theme;
  if (CF.$('showAllCards')) state.showAllCards = CF.$('showAllCards').checked;
  try {
    CF.writeJSON(DRAFT_KEY, state);
    CF.status('Draft saved.', 'ok');
  } catch {
    CF.status('Save failed (storage quota).', 'err');
  }
});

CF.$('loadBtn').addEventListener('click', () => {
  const draft = CF.readJSON(DRAFT_KEY, null);
  if (draft) {
    Object.assign(state, {
      showAllCards: draft.showAllCards || false,
      theme: draft.theme || 'protocol',
      layout: draft.layout === 'm4' ? 'auto' : (draft.layout || 'auto'),
      texts: draft.texts || {},
      ranks: draft.ranks || { crank: null, prank: null },
      picks: Object.fromEntries(CF.ALL_CATS.map(c => [c, draft.picks?.[c] || []])),
      assets: Object.assign({ avatar: null, pcard: null, buddies: [] }, draft.assets),
      owned: draft.owned || {},
      ownedLevels: draft.ownedLevels || {}, ownedVariants: draft.ownedVariants || [], ownedBuddies: draft.ownedBuddies || [], ownedCards: draft.ownedCards || []
    });
    if (CF.$('showAllCards')) CF.$('showAllCards').checked = !!state.showAllCards;
    renderFromState();
    refreshLayout();
    CF.status('Draft loaded.', 'ok');
    return;
  }
  // one-time migration from the old innerHTML-based draft
  const legacy = CF.readJSON(LEGACY_DRAFT_KEY, null);
  if (legacy?.picks) {
    state.picks = Object.fromEntries(CF.ALL_CATS.map(c =>
      [c, (legacy.picks[c] || []).map(s => ({ id: s.id, weapon: s.weapon, name: s.name, tier: s.tier, icon: s.icon || s.img }))]));
    if (legacy.theme) state.theme = legacy.theme;
    renderFromState();
    CF.status('Old draft migrated — text fields were reset to defaults.', 'ok');
    return;
  }
  CF.status('Nothing saved yet.');
});

// ── listing face: auto card vs edited artwork (creation-time input) ──
const face = { on: false, mode: 'card', blob: null, ext: 'jpg', existing: null, route: null };

function faceSync() {
  const seg = CF.$('faceSeg');
  const art = CF.$('faceArt');
  const mseg = CF.$('faceModeSeg');
  if (!seg || !art || !mseg) return;
  seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.face === 'art') === face.on));
  art.hidden = !face.on;
  mseg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.fmode === face.mode));
  const ff = CF.$('faceFields');
  if (ff) ff.hidden = !(face.on && face.route === 'art');
  mseg.hidden = face.route === 'art';
  const publishBtn = CF.$('publishBtn');
  if (publishBtn) publishBtn.textContent = face.route === 'art' ? 'Publish artwork' : 'Publish listing';
  const prev = CF.$('facePrev');
  const rm = CF.$('faceRemove');
  const src = face.blob ? (prev ? prev.src : '') : face.existing;
  const has = face.on && !!src;
  if (prev) { prev.hidden = !has; if (has && !face.blob) prev.src = face.existing; }
  if (rm) rm.hidden = !has;
}

function faceInit() {
  const seg = CF.$('faceSeg');
  if (!seg) return;
  seg.addEventListener('click', e => {
    const b = e.target.closest('button[data-face]');
    if (!b) return;
    face.on = b.dataset.face === 'art';
    faceSync();
  });
  const mseg = CF.$('faceModeSeg');
  if (mseg) mseg.addEventListener('click', e => {
    const b = e.target.closest('button[data-fmode]');
    if (!b) return;
    face.mode = b.dataset.fmode;
    faceSync();
  });
  const fileBtn = CF.$('faceFileBtn');
  const file = CF.$('faceFile');
  if (fileBtn && file) {
    fileBtn.addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { CF.status('Only PNG, JPEG or WebP images.', 'err'); return; }
      if (f.size > 10 * 1024 * 1024) { CF.status('Image too large — pick one under 10 MB.', 'err'); return; }
      CF.resizeToDataUrl(f, 1280).then(dataUrl => fetch(dataUrl).then(r => r.blob()).then(blob => {
        face.blob = blob;
        face.ext = blob.type === 'image/png' ? 'png' : 'jpg';
        const prev = CF.$('facePrev');
        if (prev) { prev.src = dataUrl; prev.hidden = false; }
        const rm = CF.$('faceRemove');
        if (rm) rm.hidden = false;
        CF.status('Artwork ready — it will attach when you publish.', 'ok');
      })).catch(() => CF.status('Could not read that image file.', 'err'));
    });
  }
  const rm = CF.$('faceRemove');
  if (rm) rm.addEventListener('click', () => {
    face.blob = null;
    face.existing = null;
    const prev = CF.$('facePrev');
    if (prev) { prev.hidden = true; prev.src = ''; }
    rm.hidden = true;
    faceSync();
  });
  const faceMenuBtn = CF.$('faceMenuBtn');
  const faceModal = CF.$('faceModal');
  if (faceMenuBtn && faceModal) {
    faceMenuBtn.addEventListener('click', () => {
      faceModal.hidden = false;
      faceSync();
    });
    const faceClose = CF.$('faceClose');
    if (faceClose) faceClose.addEventListener('click', () => { faceModal.hidden = true; });
  }
  const routeGate = CF.$('routeGate');
  const rgArt = CF.$('rgArt');
  const rgNormal = CF.$('rgNormal');
  if (routeGate && rgArt && rgNormal) {
    rgArt.addEventListener('click', () => {
      face.route = 'art';
      face.on = true;
      face.mode = 'card';
      routeGate.hidden = true;
      if (faceModal) faceModal.hidden = false;
      faceSync();
    });
    rgNormal.addEventListener('click', () => {
      face.route = 'normal';
      face.on = false;
      routeGate.hidden = true;
      faceSync();
    });
  }
  if (routeGate && new URLSearchParams(location.search).has('edit')) routeGate.hidden = true;
  const facePublish = CF.$('facePublish');
  if (facePublish) facePublish.addEventListener('click', () => {
    if (face.route === 'art' && !face.blob && !face.existing) {
      CF.status('Upload the artwork image first.', 'err');
      return;
    }
    const modal = CF.$('faceModal');
    if (modal) modal.hidden = true;
    const pub = CF.$('publishBtn');
    if (pub) pub.click();
  });
  faceSync();
}

// ── publish ───────────────────────────────────────────────────────
function buildPayload() {
  captureTexts();
  state.theme = document.documentElement.dataset.theme;
  return {
    theme: state.theme,
    layout: state.layout,
    showAllCards: !!CF.$('showAllCards') && CF.$('showAllCards').checked,
    texts: state.texts,
    ranks: state.ranks,
    picks: state.picks,
    assets: state.assets,
    owned: state.owned,
    ownedLevels: state.ownedLevels, ownedVariants: state.ownedVariants, ownedBuddies: state.ownedBuddies, ownedCards: state.ownedCards
  };
}

function artPayload() {
  const v = id => { const el = CF.$(id); return el ? el.value.trim() : ''; };
  const texts = {
    code: v('ff-code') || 'ART',
    cname: v('ff-name'),
    crank: v('ff-rank'), prank: v('ff-prank'),
    price: v('ff-price'),
    link: v('ff-contact'),
    wtr: v('ff-obo') ? 'offers' : '',
    receipts: '', owner: ''
  };
  return {
    theme: document.documentElement.dataset.theme || 'protocol',
    layout: 'auto',
    showAllCards: false,
    texts: texts,
    ranks: { crank: null, prank: null },
    picks: {},
    assets: { avatar: null, pcard: null, buddies: [] },
    owned: {}, ownedLevels: {}, ownedVariants: [], ownedBuddies: [], ownedCards: []
  };
}

function refreshLayout() {
  const payload = buildPayload();
  const mode = state.layout === 'auto' ? resolveLayout(payload) : state.layout;
  applyLayout(CF.$('card'), payload, mode, 1, { editable: true, showAll: true });
  /* CF-06: the resolved mode is stated, not implied by the export label */
  const MODE_NAMES = { m1: 'TILES', m2: 'SHOWCASE', m3: 'CLASSIC' };
  const badge = CF.$('layoutBadge');
  const auto = state.layout === 'auto';
  badge.textContent = auto ? 'AUTO → ' + MODE_NAMES[mode] : MODE_NAMES[mode];
  badge.title = auto ? 'AUTO resolves to TILES — the catalog layout was removed.' : 'Layout set manually.';
  const ex = CF.$('exportBtn');
  ex.textContent = 'Export PNG';
  ex.title = 'Exports the card exactly as previewed: 1920×1080 at 2× (3840×2160) plus a QR band below (3840×2440).';
  CF.$('layoutSel').value = state.layout;
}

/* CF-05: the More menu — outside click and Escape close it */
(function () {
  const btn = CF.$('moreBtn'), menu = CF.$('moreMenu');
  function setOpen(open) {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'More ▴' : 'More ▾';
  }
  btn.addEventListener('click', e => {
    e.stopPropagation();
    setOpen(menu.hidden);
  });
  document.addEventListener('click', e => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) setOpen(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus(); }
  });
  menu.querySelectorAll('.mm-item').forEach(i => i.addEventListener('click', () => setOpen(false)));
})();

/* Requirements picker — overlay modal, no layout impact. No Issue / With Issues
   write the card's WTR field; Premier Unlinked writes vlink. Marketplace
   filters read exactly those (browse.js normalize()). */
(function () {
  const modal = CF.$('reqModal');
  const btn = CF.$('reqMenuBtn');
  if (!modal || !btn) return;

  function fieldText(k) {
    if (state.texts[k] != null && state.texts[k] !== '') return String(state.texts[k]);
    const el = card.querySelector('[data-key="' + k + '"]');
    return el ? el.textContent : '';
  }
  function setField(k, v) {
    state.texts[k] = v;
    const el = card.querySelector('[data-key="' + k + '"]');
    if (el) el.textContent = v;
    const input = document.querySelector('#formMode input[data-fkey="' + k + '"]');
    if (input) input.value = v;
  }
  function sync() {
    const wtr = fieldText('wtr');
    const vlink = fieldText('vlink');
    const no = /yes/i.test(wtr);
    const issues = /no/i.test(wtr);
    document.querySelectorAll('#reqSeg button').forEach(b => {
      b.classList.toggle('on', b.dataset.req === 'noissue' ? no : issues);
    });
    const prem = CF.$('rqPrem');
    if (prem) prem.checked = /unlinked/i.test(vlink);
  }

  btn.addEventListener('click', () => { modal.hidden = false; sync(); });
  const close = CF.$('reqClose');
  if (close) close.addEventListener('click', () => { modal.hidden = true; });
  document.querySelectorAll('#reqSeg button').forEach(b => {
    b.addEventListener('click', () => {
      setField('wtr', b.dataset.req === 'noissue' ? 'WTR: YES' : 'WTR: NO');
      sync();
    });
  });
  const prem = CF.$('rqPrem');
  if (prem) prem.addEventListener('change', () => { setField('vlink', prem.checked ? 'UNLINKED' : 'LINKED'); });
})();

/* TT-110 / FM: relocate live topbar nodes (never clone) to fit each width band.
   >760: tb-left original order (logo→themes→layoutSel→layoutBadge) + pubswitch last in More.
   701-760: themes prepend + pubswitch last in More; layoutSel/badge stay in tb-left.
   ≤700: themes→#fThemeSlot, layoutSel→#fLayoutSlot, layoutBadge→#fBadgeSlot, pubswitch→#fPubSlot. */
const phoneMQ = window.matchMedia('(max-width:760px)');
const phoneMq700 = window.matchMedia('(max-width:700px)');
const themesEl = document.querySelector('.themes');
const tbLeft = document.querySelector('.tb-left');
const layoutSelEl = CF.$('layoutSel');
const layoutBadgeEl = CF.$('layoutBadge');
const pubswitchEl = document.querySelector('.pubswitch');
const formPrevEl = CF.$('formPrevBtn');
const moreMenu = CF.$('moreMenu');
function placeRelocatables() {
  if (phoneMq700.matches) {
    CF.$('fThemeSlot').appendChild(themesEl);
    CF.$('fLayoutSlot').appendChild(layoutSelEl);
    CF.$('fBadgeSlot').appendChild(layoutBadgeEl);
    CF.$('fPubSlot').appendChild(pubswitchEl);
  } else if (phoneMQ.matches) {
    moreMenu.prepend(themesEl);
    tbLeft.insertBefore(layoutSelEl, formPrevEl);
    tbLeft.insertBefore(layoutBadgeEl, formPrevEl);
    moreMenu.appendChild(pubswitchEl);
  } else {
    tbLeft.insertBefore(themesEl, formPrevEl);
    tbLeft.insertBefore(layoutSelEl, formPrevEl);
    tbLeft.insertBefore(layoutBadgeEl, formPrevEl);
    moreMenu.appendChild(pubswitchEl);
  }
}
placeRelocatables();
phoneMQ.addEventListener('change', placeRelocatables);
phoneMq700.addEventListener('change', e => {
  placeRelocatables();
  if (e.matches) {
    syncFormFromState(); /* FM: fill the freshly visible form */
  } else {
    document.body.classList.remove('stage-peek');
    if (formPrevEl) formPrevEl.textContent = 'Preview';
  }
});

/* FM: phone form mode — sync + renders + delegated wiring */
function syncFormArt() {
  const av = document.getElementById('fAvatar');
  if (av) av.src = state.assets.avatar || AVATAR_PLACEHOLDER;
  const pc = document.getElementById('fPcard');
  if (pc) {
    if (state.assets.pcard) { pc.src = state.assets.pcard; pc.hidden = false; }
    else pc.hidden = true;
  }
}

function syncStatsInputs() {
  ['prems', 'limited', 'semis', 'anims'].forEach(k => {
    const el = document.querySelector('#formMode input[data-fkey="' + k + '"]');
    const b = card.querySelector('b[data-key="' + k + '"]');
    if (el && b) el.value = b.textContent.trim();
  });
}

function renderFormSkins() {
  if (!phoneMq700.matches) return;
  const wrap = document.getElementById('fskinCats');
  if (!wrap) return;
  let total = 0;
  wrap.innerHTML = CF.ALL_CATS.map(cat => {
    const picks = state.picks[cat] || [];
    total += picks.length;
    const label = cat === 'Sniper Rifles' ? 'Snipers' : cat;
    const tiles = picks.map((s, i) => {
      const tier = (String(s.tier || '').toLowerCase().match(/exclusive|ultra|premium|deluxe|select/) || [''])[0];
      let cap = s.name || s.weapon || 'Skin';
      if (s.variant?.name && !cap.includes(s.variant.name)) cap += ' · ' + s.variant.name;
      const icon = s.icon || s.img || '';
      const alt = (s.weapon || 'Skin') + ' — ' + (s.name || '');
      return `<figure class="fskin" data-tier="${CF.esc(tier)}" data-fcat="${CF.esc(cat)}" data-fidx="${i}" role="button" tabindex="0" title="Edit ${CF.esc(String(s.level || 1))}/variant">` +
        (s.level >= 2 ? `<i class="flv">LV${CF.esc(String(s.level))}</i>` : '') +
        `<img loading="lazy" src="${CF.esc(icon)}" alt="${CF.esc(alt)}">` +
        `<figcaption>${CF.esc(cap)}</figcaption></figure>`;
    }).join('');
    return `<div class="fcat"><div class="fcat-h"><b>${CF.esc(label)}</b><span class="cnt">${picks.length}</span>` +
      `<button type="button" class="fbtn accent" data-fadd="${CF.esc(cat)}">+ Add</button></div>` +
      (picks.length ? `<div class="fskin-grid">${tiles}</div>` : '<div class="fempty">No skins yet — tap + Add</div>') +
      `</div>`;
  }).join('');
  const totalEl = document.getElementById('fskinTotal');
  if (totalEl) totalEl.textContent = total + ' total';
}

function renderFormBuddies() {
  if (!phoneMq700.matches) return;
  const grid = document.getElementById('fbuddyGrid');
  if (!grid) return;
  grid.innerHTML = state.assets.buddies.map((u, i) =>
    `<span class="fbuddy"><img loading="lazy" src="${CF.esc(u)}" alt="Gun buddy"><span class="x" role="button" tabindex="0" data-fbuddy="${i}" title="Remove buddy">×</span></span>`
  ).join('');
}

function syncFormFromState() {
  document.querySelectorAll('#formMode input[data-fkey]').forEach(el => {
    const k = el.dataset.fkey;
    const t = card.querySelector('[data-key="' + k + '"]');
    el.value = (state.texts[k] != null && state.texts[k] !== '')
      ? state.texts[k]
      : (t ? t.textContent : '').trim();
  });
  ['crank', 'prank'].forEach(k => {
    const t = card.querySelector('[data-key="' + k + '"]');
    const name = (state.texts[k] != null && state.texts[k] !== '')
      ? state.texts[k]
      : (t ? t.textContent : '').trim();
    const nameEl = document.getElementById('f-' + k + '-name');
    if (nameEl) nameEl.textContent = name;
    const badgeEl = document.getElementById('f-' + k + '-badge');
    if (badgeEl) {
      if (state.ranks[k]) badgeEl.src = state.ranks[k];
      else badgeEl.removeAttribute('src');
    }
  });
  const codeEl = card.querySelector('[data-key="code"]');
  const titleEl = document.getElementById('fheroTitle');
  if (titleEl) titleEl.textContent = 'EDITING · ' + (state.texts.code || (codeEl ? codeEl.textContent.trim() : '') || 'DRAFT');
  const statusEl = document.getElementById('fheroStatus');
  if (statusEl) statusEl.textContent = editSlug ? 'PUBLISHED' : 'DRAFT';
  const ownedEl = document.getElementById('fOwned');
  if (ownedEl) ownedEl.textContent = state.ownedCards?.length
    ? 'Owned collection: ' + state.ownedCards.length + ' player cards (from Riot import) — published with the toggle below.'
    : 'Owned collection: import your account to attach the full card collection.';
  syncFormArt();
  renderFormSkins();
  renderFormBuddies();
}

function afterPicksChange() {
  recountStats();
  if (phoneMq700.matches) { renderFormSkins(); syncStatsInputs(); }
}

const formMode = CF.$('formMode');
formMode?.addEventListener('input', e => {
  const el = e.target.closest('input[data-fkey]');
  if (!el) return;
  const k = el.dataset.fkey;
  const v = el.value;
  state.texts[k] = v;
  const t = card.querySelector('[data-key="' + k + '"]');
  if (t) t.textContent = v;
  if (k === 'code') {
    const titleEl = document.getElementById('fheroTitle');
    if (titleEl) titleEl.textContent = 'EDITING · ' + (v || 'DRAFT');
  }
});

const fskinCatsEl = document.getElementById('fskinCats');
fskinCatsEl?.addEventListener('click', e => {
  const add = e.target.closest('[data-fadd]');
  if (add) { openPicker(add.dataset.fadd); return; }
  const tile = e.target.closest('.fskin');
  if (tile) openVariantModal(tile.dataset.fcat, +tile.dataset.fidx);
});
fskinCatsEl?.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const tile = e.target.closest('.fskin');
  if (!tile) return;
  e.preventDefault();
  openVariantModal(tile.dataset.fcat, +tile.dataset.fidx);
});

const fbuddyGridEl = document.getElementById('fbuddyGrid');
fbuddyGridEl?.addEventListener('click', e => {
  const x = e.target.closest('[data-fbuddy]');
  if (!x) return;
  state.assets.buddies.splice(+x.dataset.fbuddy, 1);
  hydrateAssets();
  renderFormBuddies();
});

formMode?.addEventListener('click', e => {
  const rp = e.target.closest('[data-frankpick]');
  if (rp) { openRankPickerForKey(rp.dataset.frankpick); return; }
  const up = e.target.closest('[data-fupload]');
  if (!up) return;
  const k = up.dataset.fupload;
  if (k === 'avatar') { pendingUpload = card.querySelector('.avatar'); CF.$('fileInput').click(); }
  else if (k === 'pcard') openCardPicker();
  else if (k === 'charms') openBuddyPicker();
});

CF.$('fRecount')?.addEventListener('click', () => {
  recountStats();
  syncStatsInputs();
  CF.status('Stats recounted from skins.', 'ok');
});

formPrevEl?.addEventListener('click', () => {
  document.body.classList.toggle('stage-peek');
  const peek = document.body.classList.contains('stage-peek');
  formPrevEl.textContent = peek ? '← Form' : 'Preview';
  if (peek) fit();
  else syncFormFromState();
});

document.getElementById('fnav')?.addEventListener('click', e => {
  const chip = e.target.closest('.fnav-chip');
  if (!chip) return;
  document.querySelectorAll('#fnav .fnav-chip').forEach(c => c.setAttribute('aria-current', String(c === chip)));
  const sec = document.getElementById('fsec-' + chip.dataset.sec);
  if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

CF.$('layoutSel').addEventListener('change', () => {
  state.layout = CF.$('layoutSel').value;
  refreshLayout();
  /* CF-06: layout changes finally say what they did */
  const NAMES = { m1: 'TILES', m2: 'SHOWCASE', m3: 'CLASSIC' };
  const mode = state.layout === 'auto' ? resolveLayout(buildPayload()) : state.layout;
  CF.status(state.layout === 'auto' ? 'Layout: AUTO → ' + NAMES[mode] + '.' : 'Layout: ' + NAMES[mode] + '.', 'info');
});
document.querySelector('.themes')?.addEventListener('click', e => {
  if (e.target.closest('.swatch')) refreshLayout();
});

/* CF-21: a publish gate. buildPayload() used to go straight to
   create_listing — an empty card full of placeholder text published to the
   public marketplace. Blocking items say exactly what to fix. */
function publishGate() {
  if (face.route === 'art') return { blocking: [], pass: true };
  const t = state.texts || {};
  const checks = [];
  const skins = CF.ALL_CATS.reduce((n, c) => n + (state.picks[c] || []).length, 0);
  checks.push({
    ok: skins > 0,
    label: 'the card has no skins on it',
    fix: 'add at least one skin so buyers see an inventory',
  });
  const titleSet = (t.cname || '').trim() && t.cname !== 'CHANGE NAME';
  checks.push({
    ok: !!titleSet,
    label: 'the card title still says “CHANGE NAME”',
    fix: 'click the title on the card and type the listing name',
  });
  const priceSet = (t.price || '').trim() && t.price !== 'PRICE OFFER';
  checks.push({
    ok: !!priceSet,
    label: 'the price is still the placeholder',
    fix: 'type an asking price, or something like “offers” in its place',
  });
  const link = (t.link || '').trim();
  checks.push({
    ok: link.length > 0 && link !== 'https://www.facebook.com/Your.Page.Here',
    label: 'no contact link is set',
    fix: 'set a Discord or other contact in the seller box so buyers can reach you',
  });
  return {
    blocking: checks.filter(c => !c.ok),
    pass: checks.every(c => c.ok),
  };
}

async function publishListing() {
  const payload = (face.route === 'art') ? artPayload() : buildPayload();
  const btn = CF.$('publishBtn');

  if (face.route === 'art' && !face.blob && !face.existing) {
    CF.status('Upload the artwork image first.');
    return;
  }

  /* CF-21: run the gate first — an empty or placeholder card never goes live */
  const gate = publishGate();
  if (!gate.pass) {
    const lines = gate.blocking.map(b => `• ${b.label} — ${b.fix}`).join('\n');
    CF.status('Publish blocked — ' + gate.blocking.length + ' item' + (gate.blocking.length === 1 ? '' : 's') + ' to fix. Hover this message for exactly what.', 'err');
    const el = document.getElementById('status');
    if (el) el.title = lines;
    return;
  }

  btn.disabled = true;
  CF.status(supabase ? 'Publishing listing…' : 'Publishing (this browser)…');
  try {
    let slug = editSlug || localStorage.getItem('vc-draft-id') || CF.randomId(7);
    if (supabase) {
      const existingToken = localStorage.getItem('vc-edit-' + slug);
      const token = existingToken || CF.randomId(40);
      const hash = await CF.hashToken(token);
      if (existingToken) {
        const { error } = await supabase.rpc('update_listing', {
          p_slug: slug, p_edit_token_hash: hash, p_payload: payload, p_theme: payload.theme
        });
        if (error) throw error;
      } else {
        let created = false, lastErr = null;
        for (let i = 0; i < 3 && !created; i++) {
          const { error } = await supabase.rpc('create_listing', {
            p_slug: slug, p_edit_token_hash: hash, p_payload: payload, p_theme: payload.theme
          });
          if (!error) { created = true; break; }
          lastErr = error;
          if (error.code === '23505' || /duplicate|unique|slug/i.test(error.message || '')) slug = CF.randomId(7);
          else if (/sign-in required|not a registered seller/i.test(error.message || '')) {
            CF.status('Publishing is restricted to the signed-in seller. Complete sign-in, then publish again.', 'err');
            initAuthGate({ force: true });
            return;
          }
          else throw error;
        }
        if (!created) throw lastErr || new Error('create_listing failed');
        localStorage.setItem('vc-edit-' + slug, token);
      }
      localStorage.setItem('vc-draft-id', slug);
    } else {
      const all = CF.readJSON('vlistings', {});
      all[slug] = { slug, theme: payload.theme, payload, at: Date.now() };
      try {
        CF.writeJSON('vlistings', all);
      } catch {
        CF.status('Browser storage is full — remove some uploads and retry.', 'err');
        return;
      }
      // token is unused server-side in this mode; it just marks this browser
      // as the owner so the viewer offers the "← Editor" button
      if (!localStorage.getItem('vc-edit-' + slug)) localStorage.setItem('vc-edit-' + slug, CF.randomId(40));
      localStorage.setItem('vc-draft-id', slug);
    }
    editSlug = slug;
    updateWm();
    btn.textContent = supabase ? 'Update listing' : 'Republish';

    /* CF-20: upload the card render as the listing's share image. The
       publish link then carries the card into Discord/Facebook embeds
       instead of a text stub. Best-effort — a failure must not lose the
       publish. */
    if (supabase) {
      const pubMode = state.layout === 'auto' ? resolveLayout(payload) : state.layout;
      try {
        applyLayout(CF.$('card'), payload, pubMode, 1, { editable: false });
        const blob = await CF.captureCardBlob(card, 'image/jpeg', .82);
        if (blob) {
          const { error: upErr } = await supabase.storage
            .from('listing-images')
            .upload(slug + '.jpg', blob, { upsert: true, contentType: 'image/jpeg' });
          if (upErr) CF.status('Published, but the share image failed to upload: ' + (upErr.message || upErr), 'err');
        }
      } catch (e) {
        CF.status('Published, but the share image failed: ' + (e.message || e), 'err');
      } finally {
        renderAll();
      }
      try {
        const { data: curRow } = await supabase.from('listing_public').select('payload,theme').eq('slug', slug).maybeSingle();
        if (curRow) {
          const pl = Object.assign({}, curRow.payload || {});
          if (face.on && (face.blob || face.existing)) {
            let src = face.existing;
            if (face.blob) {
              const path = slug + '-thumb.' + face.ext;
              const { error: aErr } = await supabase.storage.from('listing-images').upload(path, face.blob, { upsert: true, contentType: face.blob.type });
              if (aErr) throw aErr;
              src = supabase.storage.from('listing-images').getPublicUrl(path).data.publicUrl + '?v=' + Date.now();
            }
            pl.thumb = { src: src, label: '' };
            if (face.mode === 'card') pl.thumbMode = 'card'; else delete pl.thumbMode;
          } else {
            delete pl.thumb;
            delete pl.thumbMode;
          }
          const changed = JSON.stringify(pl) !== JSON.stringify(curRow.payload || {});
          if (changed) {
            const h = await CF.hashToken(localStorage.getItem('vc-edit-' + slug) || '');
            const { error: uErr } = await supabase.rpc('update_listing', { p_slug: slug, p_edit_token_hash: h, p_payload: pl, p_theme: curRow.theme || 'protocol' });
            if (uErr) throw uErr;
          }
          if (face.route === 'art') {
            const pv = (CF.$('ff-price') ? CF.$('ff-price').value.trim() : '');
            const num = Number(pv);
            const obo = !!(CF.$('ff-obo') && CF.$('ff-obo').checked);
            const h2 = await CF.hashToken(localStorage.getItem('vc-edit-' + slug) || '');
            if (pv && isFinite(num) && num >= 0) {
              const { error: pErr } = await supabase.rpc('owner_set_listing', { p_slug: slug, p_edit_token_hash: h2, p_price: num, p_negotiable: obo });
              if (pErr) throw pErr;
            } else if (obo) {
              const { error: nErr } = await supabase.rpc('owner_set_listing', { p_slug: slug, p_edit_token_hash: h2, p_negotiable: true });
              if (nErr) throw nErr;
            }
          }
        }
      } catch (e) {
        CF.status('Published, but the artwork setting failed to save: ' + ((e && e.message) || e), 'err');
      }
    }

    const url = new URL('view.html?slug=' + encodeURIComponent(slug), location.href).href;
    CF.copyText(url);
    /* CF-23: edit access lives only in this browser's localStorage. Show the
       recovery key once at first publish so a lost browser doesn't mean a
       listing that can never be edited or marked sold again. */
    const firstPublish = !localStorage.getItem('cf-key-shown-' + slug);
    const key = localStorage.getItem('vc-edit-' + slug) || '';
    const keyMsg = firstPublish && key
      ? ' Recovery key (shown once, save it somewhere safe — it is the only way to edit this listing from another browser): ' + key
      : '';
    if (firstPublish) localStorage.setItem('cf-key-shown-' + slug, '1');
    CF.status(supabase
      ? 'Published! Share link copied.' + keyMsg + ' Attach your edited artwork any time from the dashboard → THUMB.'
      : 'Published for this browser. Link copied — add Supabase keys in js/config.js for public links.' + keyMsg, 'ok');
    face.existing = face.on ? (face.existing || null) : null;
    face.blob = null;
    if (keyMsg) {
      const el = document.getElementById('status');
      if (el) el.title = 'Recovery key: ' + key;
    }
  } catch (e) {
    CF.status('Publish failed: ' + (e.message || e), 'err');
  } finally {
    btn.disabled = false;
  }
}
CF.$('publishBtn').addEventListener('click', publishListing);

// ── v1.3.1: single-seller auth gate ──
/* Re-entry safe via gate.dataset.wired: the publish-failure path calls this
   again to reopen the gate over intact editor state — listeners must not
   stack. { force: true } skips the ?edit= bypass and the magic-link race so
   a 42501 publish failure always gets a visible gate. */
async function initAuthGate(opts) {
  if (!supabase) return;
  const force = !!(opts && opts.force);
  if (!force && new URLSearchParams(location.search).get('edit')) return;
  const gate = CF.$('authGate');
  if (!gate) return;
  const agForm = CF.$('agForm');
  const agEmail = CF.$('agEmail');
  const agPass = CF.$('agPass');
  const agOtp = CF.$('agOtp');
  const agSend = CF.$('agSend');
  const agMsg = CF.$('agMsg');
  const agSent = CF.$('agSent');
  const agBack = CF.$('agBack');
  const agSigned = CF.$('agSigned');
  const agWho = CF.$('agWho');
  const agOut = CF.$('agOut');
  const agWait = CF.$('agWait');
  const signOutBtn = CF.$('signOutBtn');
  if (!agForm || !agEmail || !agSend || !agMsg || !agSent || !agBack || !agSigned || !agWho || !agOut || !signOutBtn) return;

  async function applyGateSession(session) {
    if (agWait) agWait.hidden = true;
    if (!session) {
      gate.hidden = false;
      agForm.hidden = false;
      agSent.hidden = true;
      agSigned.hidden = true;
      if (!window.matchMedia('(pointer: coarse)').matches) {
        try { agEmail.focus({ preventScroll: true }); } catch { /* older browsers */ }
      }
      return;
    }
    let isSeller = false;
    try {
      const { data } = await supabase.rpc('am_i_seller');
      isSeller = data === true;
    } catch { /* network error -> treat as not-seller */ }
    if (isSeller) {
      gate.hidden = true;
      signOutBtn.hidden = false;
      return;
    }
    gate.hidden = false;
    agForm.hidden = true;
    agSent.hidden = true;
    agSigned.hidden = false;
    agWho.textContent = (session.user && session.user.email) || 'your account';
    try { agOut.focus({ preventScroll: true }); } catch { /* older browsers */ }
  }

  if (!gate.dataset.wired) {
    gate.dataset.wired = '1';

    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') applyGateSession(session);
    });

    const sendLabel = agSend.textContent;
    const otpLabel = agOtp ? agOtp.textContent : '';

    agSend.addEventListener('click', async () => {
      const email = agEmail.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        agMsg.textContent = 'Enter a valid email address.';
        agMsg.className = 'ag-msg err';
        return;
      }
      const password = agPass.value;
      if (!password) {
        agMsg.textContent = 'Enter your password.';
        agMsg.className = 'ag-msg err';
        return;
      }
      agSend.disabled = true;
      agSend.textContent = 'Signing in…';
      agMsg.textContent = '';
      agMsg.className = 'ag-msg';
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      agSend.disabled = false;
      agSend.textContent = sendLabel;
      agPass.value = '';
      if (error) {
        agMsg.className = 'ag-msg err';
        agMsg.textContent = /invalid login credentials/i.test(error.message)
          ? 'Wrong email or password.'
          : /email not confirmed/i.test(error.message)
            ? 'That account still needs to be confirmed by the marketplace owner.'
            : 'Sign-in failed: ' + error.message;
        return;
      }
    });

    if (agOtp) agOtp.addEventListener('click', async () => {
      const email = agEmail.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        agMsg.textContent = 'Enter a valid email address.';
        agMsg.className = 'ag-msg err';
        return;
      }
      agOtp.disabled = true;
      agOtp.textContent = 'Sending link…';
      agMsg.textContent = '';
      agMsg.className = 'ag-msg';
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
      agOtp.disabled = false;
      agOtp.textContent = otpLabel;
      if (error) {
        agMsg.className = 'ag-msg err';
        agMsg.textContent = (error.message && /security purposes|rate limit/i.test(error.message))
          ? 'Too many requests — wait a minute and try again.'
          : 'Sign-in link failed: ' + error.message;
        return;
      }
      agForm.hidden = true;
      agSent.hidden = false;
      agSigned.hidden = true;
    });

    agBack.addEventListener('click', () => {
      agForm.hidden = false;
      agSent.hidden = true;
      agMsg.textContent = '';
    });

    const signOut = async () => {
      await supabase.auth.signOut();
      location.reload();
    };
    agOut.addEventListener('click', signOut);
    signOutBtn.addEventListener('click', signOut);

    /* a11y: keep Tab cycling inside the overlay while the gate is up */
    gate.addEventListener('keydown', e => {
      if (e.key !== 'Tab' || gate.hidden) return;
      const focusables = Array.from(gate.querySelectorAll('input:not([disabled]),button:not([disabled]),a[href]'))
        .filter(el => el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  if (!force && (location.search.includes('code=') || location.hash.includes('access_token'))) {
    /* Returning from a magic link: hold a calm "signing you in" state while
       the SDK exchanges the code (<=4s) instead of flashing the raw form. */
    gate.hidden = false;
    agForm.hidden = true;
    agSent.hidden = true;
    agSigned.hidden = true;
    if (agWait) agWait.hidden = false;
    await Promise.race([
      new Promise(resolve => { supabase.auth.onAuthStateChange(() => resolve()); }),
      new Promise(resolve => setTimeout(resolve, 4000))
    ]);
  }
  applyGateSession((await supabase.auth.getSession()).data.session);
}

// ── edit mode (?edit=<slug>) ──────────────────────────────────────
async function loadListingForEdit(slug) {
  if (supabase) {
    try {
      const { data, error } = await supabase.from('listing_public').select('payload,theme').eq('slug', slug).maybeSingle();
      if (!error && data) return data;
    } catch { /* fall through to localStorage */ }
  }
  const local = CF.readJSON('vlistings', {})[slug];
  return local ? { payload: local.payload, theme: local.theme } : null;
}

async function initEditMode() {
  const params = new URLSearchParams(location.search);
  const slug = params.get('edit');
  if (!slug) return;
  const listing = await loadListingForEdit(slug);
  if (!listing) {
    CF.status(`Listing "${slug}" not found on this device.`, 'err');
    return;
  }
  editSlug = slug;
  /* CF-23: recovery-key re-entry. Without the local edit token this browser
     could load the listing but never update it (update_listing checks the
     token hash). With a key, the seller regains control from any browser. */
  if (!localStorage.getItem('vc-edit-' + slug)) {
    const key = (params.get('key') || '').trim() || (window.prompt(
      'This listing was published from another browser.\n\n' +
      'Paste the recovery key you saved when you published it — it is the only way to edit or mark this listing sold from here.'
    ) || '').trim();
    if (key) {
      localStorage.setItem('vc-edit-' + slug, key);
      CF.status('Recovery key accepted — it will be verified when you publish changes.', 'info');
    } else {
      CF.status('Viewing in read-only mode: this browser has no edit key for that listing. Re-open with ?edit=' + slug + '&key=… to edit.', 'err');
    }
  }
  const p = listing.payload || {};
  Object.assign(state, {
    showAllCards: p.showAllCards || false,
    theme: listing.theme || p.theme || 'protocol',
    layout: p.layout === 'm4' ? 'auto' : (p.layout || 'auto'),
    texts: p.texts || {},
    ranks: p.ranks || { crank: null, prank: null },
    picks: Object.fromEntries(CF.ALL_CATS.map(c => [c, p.picks?.[c] || []])),
    assets: Object.assign({ avatar: null, pcard: null, buddies: [] }, p.assets),
    owned: p.owned || {},
    ownedLevels: p.ownedLevels || {}, ownedVariants: p.ownedVariants || [], ownedBuddies: p.ownedBuddies || [], ownedCards: p.ownedCards || []
  });
  const pthumb = p.thumb && typeof p.thumb.src === 'string' && p.thumb.src.startsWith('https://') ? p.thumb : null;
  face.route = pthumb ? 'art' : 'normal';
  face.on = !!pthumb;
  face.existing = pthumb ? pthumb.src : null;
  face.mode = p.thumbMode === 'card' ? 'card' : 'cover';
  const routeGate = CF.$('routeGate');
  if (routeGate) routeGate.hidden = true;
  if (face.route === 'art') {
    const texts = p.texts || {};
    const ffSet = (id, val) => { const el = CF.$(id); if (el) el.value = val; };
    ffSet('ff-code', texts.code && texts.code !== 'ART' ? texts.code : '');
    ffSet('ff-name', texts.cname || '');
    ffSet('ff-price', texts.price || '');
    ffSet('ff-rank', texts.crank || '');
    ffSet('ff-prank', texts.prank || '');
    ffSet('ff-contact', texts.link || '');
    const obo = CF.$('ff-obo'); if (obo) obo.checked = !!texts.wtr;
  }
  faceSync();
  if (CF.$('showAllCards')) CF.$('showAllCards').checked = !!state.showAllCards;
  renderFromState();
  updateWm();
  CF.$('publishBtn').textContent = supabase ? 'Update listing' : 'Republish';
  CF.status(`Editing listing ${slug} — publish to update it.`, 'ok');
}

// ── boot ──────────────────────────────────────────────────────────
CF.initThemeSwitch();
faceInit();
CF.initDisclaimerCollapse();
CF.initStatusDismiss();
renderAll();
recountStats();
card.classList.add('is-live'); /* editor preview scrolls like the live surfaces */
const fit = CF.makeFitter({ card, sizer: CF.$('sizer'), topbar: CF.$('chrome'), stage: CF.$('stage') });
fit();

// a draft saved earlier is restored automatically so a refresh never
// wipes the card (or an accidental republish of an empty one)
const bootDraft = CF.readJSON(DRAFT_KEY, null);
if (bootDraft) {
  Object.assign(state, {
    theme: bootDraft.theme || 'protocol',
    layout: bootDraft.layout === 'm4' ? 'auto' : (bootDraft.layout || 'auto'),
    texts: bootDraft.texts || {},
    ranks: bootDraft.ranks || { crank: null, prank: null },
    picks: Object.fromEntries(CF.ALL_CATS.map(c => [c, bootDraft.picks?.[c] || []])),
    assets: Object.assign({ avatar: null, pcard: null, buddies: [] }, bootDraft.assets),
    owned: bootDraft.owned || {},
    ownedLevels: bootDraft.ownedLevels || {}, ownedVariants: bootDraft.ownedVariants || [], ownedBuddies: bootDraft.ownedBuddies || [], ownedCards: bootDraft.ownedCards || []
  });
  renderFromState();
}
updateWm();
syncFormFromState(); /* FM: populate the phone form with defaults when no draft exists */

function bootStatus() {
  CF.status(editSlug
    ? `Editing listing ${editSlug} — publish to update it.`
    : `Ready — ${Object.values(DB).flat().length} skins${catalogSource === 'cache' ? ' · Supabase cache' : ''}, ${TIERS.length} tiers, ${RANKS.length - 1} ranks.` +
      (bootDraft ? ' Draft restored.' : ''), editSlug ? 'ok' : 'info');
}

initEditMode().finally(async () => {
  try {
    /* CF-24: boot without the 1.28 MB of buddy/card picker data —
       ensureBuddyCardData() loads it on first use instead */
    const catalog = await CF.loadCatalog(supabase, { extras: false });
    DB = catalog.DB; TIERS = catalog.TIERS; RANKS = catalog.RANKS;
    BUDDIES = catalog.BUDDIES; CARDS = catalog.CARDS; CARDS_LIST = catalog.CARDS_LIST || [];
    SKIN_BY_ID = catalog.SKIN_BY_ID; LEVEL_MAP = catalog.LEVEL_MAP; CHROMA_MAP = catalog.CHROMA_MAP;
    FLEX_BY_ID = catalog.FLEX_BY_ID || new Map();
    BUDDIES_LIST = catalog.BUDDIES_LIST; BUDDY_BY_ANY = catalog.BUDDY_BY_ANY;
    catalogSource = catalog.source || 'api';
  } catch (e) {
    CF.status('Skin database failed to load: ' + (e.message || e), 'err');
    return;
  }
  bootStatus();
});

/* CF-24: one-shot lazy load for the buddy/card pickers. The import path
   that maps owned buddies needs it too, so the import flow pre-warms it. */
let extrasPromise = null;
function ensureBuddyCardData() {
  if (BUDDIES_LIST.length && CARDS_LIST.length) return Promise.resolve(true);
  if (!extrasPromise) {
    extrasPromise = CF.loadCatalogExtras(supabase)
      .then(x => {
        BUDDIES = x.BUDDIES; BUDDIES_LIST = x.BUDDIES_LIST; BUDDY_BY_ANY = x.BUDDY_BY_ANY;
        CARDS = x.CARDS; CARDS_LIST = x.CARDS_LIST;
        return true;
      })
      .catch(e => {
        CF.status('Buddy/card database failed to load: ' + (e.message || e), 'err');
        extrasPromise = null;
        return false;
      });
  }
  return extrasPromise;
}

initAuthGate();
