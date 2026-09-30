// CardForge editor — card builder, PNG export, draft storage, listing publish.
import * as CF from './shared.js';

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

let DB = {}, TIERS = [], RANKS = [], BUDDIES = {}, CARDS = {}, SKIN_BY_ID = new Map(), LEVEL_MAP = {}, CHROMA_MAP = {}, BUDDIES_LIST = [], BUDDY_BY_ANY = {}, CARDS_LIST = [];
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
function skinCell(s, i) {
  const label = `${s.weapon} — ${s.name}` + (s.level ? ` · LV${s.level}` : '') + (s.variant ? ` · ${s.variant.name}` : '');
  return `<span class="skin" data-vp="${i}"><img src="${CF.esc(s.icon)}" alt="${CF.esc(label)}" title="${CF.esc(label)}">` +
    `${s.level >= 2 ? `<i class="lv">LV${s.level}</i>` : ''}` +
    `<button class="rm" data-remove="${CF.esc(s.id)}" aria-label="Remove ${CF.esc(s.name)}">×</button></span>`;
}

function renderPanel(cat, { animateLast = false } = {}) {
  const el = document.querySelector(`.panel[data-cat="${cat}"]`);
  const picks = state.picks[cat];
  const slots = el.querySelector('.slots');
  slots.innerHTML = picks.length
    ? picks.map((s, i) => skinCell(s, i)).join('')
    : '<div class="slotbox empty"><span class="hint">+ add</span></div>';
  const add = el.querySelector('.add');
  if (add) add.textContent = `+ Add (${picks.length})`;
  if (animateLast) {
    const skins = slots.querySelectorAll('.skin');
    skins[skins.length - 1]?.classList.add('added');
  }
}
const renderAll = (opts) => CF.ALL_CATS.forEach(c => renderPanel(c, opts));

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
  modal.classList.toggle('variant-wide', variant);
  CF.$('mUpload').hidden = !upload;
}
function openModal() {
  lastFocus = document.activeElement;
  modal.hidden = false;
  mSearch.focus();
}
function closeModal() {
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

function openRankPicker(btn) {
  pickerMode = 'rank';
  rankRow = btn.closest('.rankrow');
  rankKey = btn.dataset.rankpick;
  CF.$('mTitle').textContent = 'Select rank';
  modalVis({ filters: false });
  mSearch.value = '';
  renderGrid();
  openModal();
}

function paintChips() {
  document.querySelectorAll('#mWeapons .chip').forEach(c => {
    if (c.dataset.owned !== undefined) c.classList.toggle('active', filterOwned);
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
      return `<button class="item" data-i="${i}"${active ? ' aria-label="' + CF.esc(c.name) + ', currently shown"' : ''}>${active ? '<i class="cnt">✓</i>' : ''}${ownedSet.has(c.uuid) ? '<i class="ownlv">owned</i>' : ''}<img loading="lazy" src="${CF.esc(c.icon)}" alt=""><b>${CF.esc(c.name)}</b><span>player card</span></button>`;
    }).join('') || '<p class="none">No matches.</p>';
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
}

function applyRank(r) {
  state.texts[rankKey] = r.name;
  state.ranks[rankKey] = r.icon || null;
  rankRow.querySelector('b').textContent = r.name;
  const badge = rankRow.querySelector('.rankbadge');
  if (r.icon) badge.src = r.icon;
  else badge.removeAttribute('src');
  closeModal();
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

function openBuddyPicker() {
  if (!BUDDIES_LIST.length) { CF.status('Buddy database still loading — try again in a moment.', 'info'); return; }
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
}

function openCardPicker() {
  if (!CARDS_LIST.length) { CF.status('Player-card database still loading — try again in a moment.', 'info'); return; }
  pickerMode = 'card';
  currentPool = CARDS_LIST;
  filterOwned = false;
  CF.$('mTitle').textContent = 'Choose a player card';
  CF.$('mCount').textContent = '';
  modalVis({ search: true, filters: true, grid: true, upload: true });
  CF.$('mLadder').style.display = 'none';
  CF.$('mBody').classList.add('noladder');
  const ownedN = (state.ownedCards || []).length;
  CF.$('mWeapons').innerHTML = ownedN
    ? `<button class="chip" data-owned="1">Owned (${ownedN})</button>`
    : '';
  CF.$('mTiers').style.display = 'none';
  CF.$('mAddOwned').hidden = true;
  mSearch.value = '';
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
}

// ── modal events ──────────────────────────────────────────────────
CF.$('mWeapons').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
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
  renderGrid();
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
  if (arr && arr[variantIdx]) { arr.splice(variantIdx, 1); renderPanel(variantCat); }
  closeModal();
});
CF.$('vDone').addEventListener('click', () => { if (pickerMode === 'variant') closeModal(); });

// ── riot token import (Explorant-style account pull) ────────────
CF.$('importBtn').addEventListener('click', () => {
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

CF.$('iRun').addEventListener('click', async () => {
  const btn = CF.$('iRun');
  const parsed = parseTokenInput(CF.$('iToken').value);
  if (!parsed.token) { CF.status(parsed.message, 'err'); CF.$('iToken').focus(); return; }
  const ent = CF.$('iEnt').value.trim() || parsed.entitlements || '';
  btn.disabled = true;
  CF.status('Importing account…');
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
    applyImport(j);
    importModal.hidden = true;
    CF.$('iToken').value = '';
    CF.$('iEnt').value = '';
    CF.status(`Imported ${j.name || 'account'}#${j.tag || ''} — level ${j.level ?? '?'}` +
      (j.skins ? ` · ${j.skins.length} skins owned (${Object.values(state.ownedLevels).filter(l => l >= 2).length} animated)` : '') +
      (j.errors && j.errors.length ? ' · partial: ' + j.errors.join(', ') : '') + '.', 'ok');
  } catch (e) {
    CF.status('Import failed: ' + (e.message || e), 'err');
  } finally {
    btn.disabled = false;
  }
});

function autoFillFlex() {
  const onCard = new Set(CF.ALL_CATS.flatMap(c => state.picks[c].map(p => p.id)));
  const cand = [];
  SKIN_BY_ID.forEach(s => {
    if (onCard.has(s.id)) return;
    const lvl = state.ownedLevels[s.id] || 0;
    if (!lvl) return;
    const tr = TIER_RANK[CF.tierKey(s.tier)] || 0;
    const prem = tr >= 3 ? tr : 0;
    if (prem || (s.maxLevel || 1) >= 2) cand.push({ s, lvl, prem });
  });
  cand.sort((a, b) => b.prem - a.prem || a.s.name.localeCompare(b.s.name));
  cand.slice(0, 24).forEach(({ s, lvl }) => {
    state.picks.Flex.push({ id: s.id, weapon: s.weapon, name: s.name, tier: s.tier, icon: s.icon, ...(lvl >= 2 ? { level: lvl } : {}) });
  });
}

function applyImport(j) {
  if (j.level != null) state.texts.level = String(j.level);
  if (j.name) state.texts.vlogin = j.tag ? j.name + '#' + j.tag : j.name;
  if (j.vp != null) state.texts.vp = String(j.vp);
  if (j.rp != null) state.texts.rp = String(j.rp);
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
    state.owned['Battlepass'] = union;
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
  const bpSet = new Set((DB['Battlepass'] || []).map(s => s.id));
  const keyOf = s => CF.tierKey(s.tier);
  const counts = {
    prems: ownedSkins.filter(s => ['premium', 'ultra', 'exclusive'].includes(keyOf(s))).length,
    limited: ownedSkins.filter(s => ['ultra', 'exclusive'].includes(keyOf(s))).length,
    semis: ownedSkins.filter(s => keyOf(s) === 'deluxe').length,
    bpass: ownedSkins.filter(s => bpSet.has(s.id)).length,
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
  renderFromState();
  updateWm();
}

document.addEventListener('keydown', e => {
  if (!importModal.hidden && e.key === 'Escape') { importModal.hidden = true; return; }
  if (modal.hidden) return;
  if (e.key === 'Escape') { closeModal(); return; }
  if (e.key === '/' && document.activeElement !== mSearch) { e.preventDefault(); mSearch.focus(); }
  if (e.key === 'Tab') {
    const focusables = [...modal.querySelectorAll('button,input')].filter(el => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

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
    } else if (kind === 'pcard') {
      t.style.backgroundImage = `url("${url}")`;
      t.querySelector('.hint')?.remove();
      state.assets.pcard = url;
      closeModal();
    } else {
      t.querySelector('.hint')?.remove();
      const img = new Image();
      img.src = url;
      img.alt = 'Gun buddy';
      t.appendChild(img);
      state.assets.buddies.push(url);
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
  CF.status('Rendering 3840×2160 PNG…');
  try {
    await CF.exportCard(card);
    CF.status('PNG exported (3840×2160).', 'ok');
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
    `PREMIUM ${t.prems || '00'} | LIMITED ${t.limited || '00'} | SEMI PREM ${t.semis || '00'} | BATTLEPASS ${t.bpass || '00'} | ANIMATED ${t.anims || '00'}`,
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
      theme: draft.theme || 'protocol',
      texts: draft.texts || {},
      ranks: draft.ranks || { crank: null, prank: null },
      picks: Object.fromEntries(CF.ALL_CATS.map(c => [c, draft.picks?.[c] || []])),
      assets: Object.assign({ avatar: null, pcard: null, buddies: [] }, draft.assets),
      owned: draft.owned || {},
      ownedLevels: draft.ownedLevels || {}, ownedVariants: draft.ownedVariants || [], ownedBuddies: draft.ownedBuddies || [], ownedCards: draft.ownedCards || []
    });
    renderFromState();
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

// ── publish ───────────────────────────────────────────────────────
function buildPayload() {
  captureTexts();
  state.theme = document.documentElement.dataset.theme;
  return {
    theme: state.theme,
    texts: state.texts,
    ranks: state.ranks,
    picks: state.picks,
    assets: state.assets,
    owned: state.owned,
    ownedLevels: state.ownedLevels, ownedVariants: state.ownedVariants, ownedBuddies: state.ownedBuddies, ownedCards: state.ownedCards
  };
}

async function publishListing() {
  const payload = buildPayload();
  const btn = CF.$('publishBtn');
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
    const url = new URL('view.html?slug=' + encodeURIComponent(slug), location.href).href;
    CF.copyText(url);
    CF.status(supabase
      ? 'Published! Share link copied.'
      : 'Published for this browser. Link copied — add Supabase keys in js/config.js for public links.', 'ok');
  } catch (e) {
    CF.status('Publish failed: ' + (e.message || e), 'err');
  } finally {
    btn.disabled = false;
  }
}
CF.$('publishBtn').addEventListener('click', publishListing);

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
  const slug = new URLSearchParams(location.search).get('edit');
  if (!slug) return;
  const listing = await loadListingForEdit(slug);
  if (!listing) {
    CF.status(`Listing "${slug}" not found on this device.`, 'err');
    return;
  }
  editSlug = slug;
  const p = listing.payload || {};
  Object.assign(state, {
    theme: listing.theme || p.theme || 'protocol',
    texts: p.texts || {},
    ranks: p.ranks || { crank: null, prank: null },
    picks: Object.fromEntries(CF.ALL_CATS.map(c => [c, p.picks?.[c] || []])),
    assets: Object.assign({ avatar: null, pcard: null, buddies: [] }, p.assets),
    owned: p.owned || {},
    ownedLevels: p.ownedLevels || {}, ownedVariants: p.ownedVariants || [], ownedBuddies: p.ownedBuddies || [], ownedCards: p.ownedCards || []
  });
  renderFromState();
  updateWm();
  CF.$('publishBtn').textContent = supabase ? 'Update listing' : 'Republish';
  CF.status(`Editing listing ${slug} — publish to update it.`, 'ok');
}

// ── boot ──────────────────────────────────────────────────────────
CF.initThemeSwitch();
CF.initDisclaimerCollapse();
renderAll();
const fit = CF.makeFitter({ card, sizer: CF.$('sizer'), topbar: CF.$('topbar'), stage: CF.$('stage') });
fit();

// a draft saved earlier is restored automatically so a refresh never
// wipes the card (or an accidental republish of an empty one)
const bootDraft = CF.readJSON(DRAFT_KEY, null);
if (bootDraft) {
  Object.assign(state, {
    theme: bootDraft.theme || 'protocol',
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

function bootStatus() {
  CF.status(editSlug
    ? `Editing listing ${editSlug} — publish to update it.`
    : `Ready — ${Object.values(DB).flat().length} skins${catalogSource === 'cache' ? ' · Supabase cache' : ''}, ${TIERS.length} tiers, ${RANKS.length - 1} ranks.` +
      (bootDraft ? ' Draft restored.' : ''), editSlug ? 'ok' : 'info');
}

initEditMode().finally(async () => {
  try {
    const catalog = await CF.loadCatalog(supabase);
    DB = catalog.DB; TIERS = catalog.TIERS; RANKS = catalog.RANKS;
    BUDDIES = catalog.BUDDIES; CARDS = catalog.CARDS; CARDS_LIST = catalog.CARDS_LIST || [];
    SKIN_BY_ID = catalog.SKIN_BY_ID; LEVEL_MAP = catalog.LEVEL_MAP; CHROMA_MAP = catalog.CHROMA_MAP;
    BUDDIES_LIST = catalog.BUDDIES_LIST; BUDDY_BY_ANY = catalog.BUDDY_BY_ANY;
    catalogSource = catalog.source || 'api';
  } catch (e) {
    CF.status('Skin database failed to load: ' + (e.message || e), 'err');
    return;
  }
  bootStatus();
});
