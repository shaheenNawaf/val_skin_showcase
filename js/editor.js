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
  owned: {}
};

let DB = {}, TIERS = [], RANKS = [], BUDDIES = {}, CARDS = {};
let list = [], currentPool = [], currentCat = null, pickerMode = 'skin', rankRow = null, rankKey = null;
let filterWeapon = '', filterTier = '', filterOwned = false;
let pendingUpload = null, editSlug = null, lastFocus = null, exporting = false;

// Old #l=<id> viewer links move to the unified viewer page.
const hashListing = location.hash.match(/^#l=(.+)$/);
if (hashListing) {
  location.replace(new URL('view.html?slug=' + encodeURIComponent(hashListing[1]), location.href).href);
}

// ── rendering ─────────────────────────────────────────────────────
function skinCell(s) {
  const label = `${s.weapon} — ${s.name}`;
  return `<span class="skin"><img src="${CF.esc(s.icon)}" alt="${CF.esc(label)}" title="${CF.esc(label)}">` +
    `<button class="rm" data-remove="${CF.esc(s.id)}" aria-label="Remove ${CF.esc(s.name)}">×</button></span>`;
}

function renderPanel(cat, { animateLast = false } = {}) {
  const el = document.querySelector(`.panel[data-cat="${cat}"]`);
  const picks = state.picks[cat];
  const slots = el.querySelector('.slots');
  slots.innerHTML = picks.length
    ? picks.map(skinCell).join('')
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
    if (state.ranks[key]) badge.src = state.ranks[key];
    else badge.removeAttribute('src');
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
  CF.$('mTitle').textContent = 'Add ' + cat;
  CF.$('mFilters').style.display = '';
  currentPool = CF.FREE_CATS.includes(cat)
    ? Object.values(DB).flat().sort((x, y) => (x.weapon + x.name).localeCompare(y.weapon + y.name))
    : (DB[cat] || []);
  const wCounts = {}, tCounts = {};
  currentPool.forEach(s => {
    wCounts[s.weapon] = (wCounts[s.weapon] || 0) + 1;
    if (s.tier) tCounts[s.tier] = (tCounts[s.tier] || 0) + 1;
  });
  const w = Object.keys(wCounts).sort();
  const ownedN = (state.owned[cat] || []).length;
  CF.$('mWeapons').innerHTML = (ownedN
    ? `<button class="chip" data-owned="1">Owned (${ownedN})</button>`
    : '') +
    '<button class="chip active" data-w="">All</button>' +
    w.map(x => `<button class="chip" data-w="${CF.esc(x)}">${CF.esc(x)} (${wCounts[x]})</button>`).join('');
  const addOwned = CF.$('mAddOwned');
  addOwned.hidden = !ownedN;
  addOwned.textContent = `Add all owned (${ownedN})`;
  CF.$('mTiers').style.display = TIERS.length ? '' : 'none';
  CF.$('mTiers').innerHTML = '<button class="chip active" data-t="">Any tier</button>' +
    TIERS.filter(t => tCounts[t]).map(t =>
      `<button class="chip" data-t="${CF.esc(t)}"><i class="dot ${CF.tierClass(t)}"></i>${CF.esc(t)} (${tCounts[t]})</button>`).join('');
  mSearch.value = '';
  renderGrid();
  openModal();
}

function openRankPicker(btn) {
  pickerMode = 'rank';
  rankRow = btn.closest('.rankrow');
  rankKey = btn.dataset.rankpick;
  CF.$('mTitle').textContent = 'Select rank';
  CF.$('mFilters').style.display = 'none';
  mSearch.value = '';
  renderGrid();
  openModal();
}

function paintChips() {
  document.querySelectorAll('#mWeapons .chip').forEach(c => {
    if (c.dataset.owned !== undefined) c.classList.toggle('active', filterOwned);
    else c.classList.toggle('active', !filterOwned && (c.dataset.w || '') === filterWeapon);
  });
  document.querySelectorAll('#mTiers .chip').forEach(c => c.classList.toggle('active', (c.dataset.t || '') === filterTier));
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
  const counts = {};
  (state.picks[currentCat] || []).forEach(p => counts[p.id] = (counts[p.id] || 0) + 1);
  list = currentPool.filter(s =>
    (!filterWeapon || s.weapon === filterWeapon) &&
    (!filterTier || (s.tier || '').toLowerCase() === filterTier.toLowerCase()) &&
    (!q || (s.name + ' ' + s.weapon).toLowerCase().includes(q)));
  if (filterOwned && (state.owned[currentCat] || []).length) {
    const os = new Set(state.owned[currentCat]);
    list = list.filter(s => os.has(s.id));
  }
  CF.$('mCount').textContent = list.length + ' results';
  mGrid.innerHTML = list.map((s, i) =>
    `<button class="item" data-i="${i}"${counts[s.id] ? ' aria-label="' + CF.esc(s.name) + ', already on card ' + counts[s.id] + '×"' : ''}>${counts[s.id] ? `<i class="cnt">×${counts[s.id]}</i>` : ''}<img loading="lazy" src="${CF.esc(s.icon)}" alt=""><b>${CF.esc(s.name)}</b><span>${CF.esc(s.weapon)}${s.tier ? ' • ' + CF.esc(s.tier) : ''}</span>${s.tier ? `<i class="dot tdot ${CF.tierClass(s.tier)}"></i>` : ''}</button>`
  ).join('') || '<p class="none">No matches.</p>';
}

function addSkin(cat, s) {
  state.picks[cat].push({ id: s.id, weapon: s.weapon, name: s.name, tier: s.tier, icon: s.icon });
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

// ── modal events ──────────────────────────────────────────────────
CF.$('mWeapons').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  if (c.dataset.owned !== undefined) { filterOwned = !filterOwned; paintChips(); renderGrid(); return; }
  filterWeapon = c.dataset.w || ''; paintChips(); renderGrid();
});
CF.$('mTiers').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  filterTier = c.dataset.t || ''; paintChips(); renderGrid();
});
CF.$('mAddOwned').addEventListener('click', () => {
  const ids = state.owned[currentCat] || [];
  if (!ids.length) return;
  const idSet = new Set(ids);
  const have = new Set(state.picks[currentCat].map(p => p.id));
  (DB[currentCat] || []).forEach(s => {
    if (idSet.has(s.id) && !have.has(s.id)) {
      state.picks[currentCat].push({ id: s.id, weapon: s.weapon, name: s.name, tier: s.tier, icon: s.icon });
      have.add(s.id);
    }
  });
  renderPanel(currentCat);
  renderGrid();
});
mGrid.addEventListener('click', e => {
  const b = e.target.closest('.item'); if (!b) return;
  if (pickerMode === 'rank') { applyRank(list[+b.dataset.i]); return; }
  addSkin(currentCat, list[+b.dataset.i]);
  renderGrid();
});
mSearch.addEventListener('input', renderGrid);
mSearch.addEventListener('keydown', e => {
  if (e.key === 'Enter' && list.length) {
    if (pickerMode === 'rank') applyRank(list[0]);
    else { addSkin(currentCat, list[0]); renderGrid(); }
  }
});
CF.$('mClose').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

// ── riot token import (Explorant-style account pull) ────────────
CF.$('importBtn').addEventListener('click', () => {
  if (!supabase) {
    CF.status('Token import needs Supabase configured — see SETUP.md (riot-import).');
    return;
  }
  importModal.hidden = false;
  CF.$('iToken').focus();
});
CF.$('iClose').addEventListener('click', () => { importModal.hidden = true; });
importModal.addEventListener('click', e => { if (e.target === importModal) importModal.hidden = true; });

CF.$('iRun').addEventListener('click', async () => {
  const btn = CF.$('iRun');
  btn.disabled = true;
  CF.status('Importing account…');
  try {
    const r = await fetch(CONFIG.SUPABASE_URL + '/functions/v1/riot-import', {
      method: 'POST',
      headers: { apikey: CONFIG.SUPABASE_ANON_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        accessToken: CF.$('iToken').value.trim(),
        entitlements: CF.$('iEnt').value.trim(),
        region: CF.$('iRegion').value
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
    applyImport(j);
    importModal.hidden = true;
    CF.$('iToken').value = '';
    CF.$('iEnt').value = '';
    CF.status(`Imported ${j.name || 'account'}#${j.tag || ''} — level ${j.level ?? '?'}${j.errors && j.errors.length ? ' · partial: ' + j.errors.join(', ') : ''}.`);
  } catch (e) {
    CF.status('Import failed: ' + (e.message || e));
  } finally {
    btn.disabled = false;
  }
});

function applyImport(j) {
  if (j.level != null) state.texts.level = String(j.level);
  if (j.vp != null) state.texts.vp = String(j.vp);
  if (j.rp != null) state.texts.rp = String(j.rp);
  if (j.rankTier) {
    const r = CF.rankByFlat(j.rankTier, RANKS);
    if (r && r.name !== 'UNRANKED') { state.texts.crank = r.name; state.ranks.crank = r.icon || null; }
  }
  if (j.peakTier) {
    const r = CF.rankByFlat(j.peakTier, RANKS);
    if (r && r.name !== 'UNRANKED') { state.texts.prank = r.name; state.ranks.prank = r.icon || null; }
  }
  if (j.playerCard && CARDS[j.playerCard]) state.assets.pcard = CARDS[j.playerCard].wide;
  const charmIcons = (j.charms || []).map(id => BUDDIES[id]).filter(Boolean);
  if (charmIcons.length) state.assets.buddies = charmIcons.slice(0, 12);
  if (j.skins) {
    state.owned = {};
    const set = new Set(j.skins);
    CF.CATS.forEach(c => {
      const ids = (DB[c] || []).filter(s => set.has(s.id)).map(s => s.id);
      if (ids.length) state.owned[c] = ids;
    });
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
    const n = Object.values(state.picks).flat()
      .filter(p => ['premium', 'ultra', 'exclusive'].includes((p.tier || '').toLowerCase())).length;
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
  const rp = e.target.closest('[data-rankpick]');
  if (rp) { openRankPicker(rp); return; }
  const add = e.target.closest('.add');
  if (add) { openPicker(add.dataset.add); return; }
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
    } else {
      t.querySelector('.hint')?.remove();
      const img = new Image();
      img.src = url;
      img.alt = 'Gun buddy';
      t.appendChild(img);
      state.assets.buddies.push(url);
    }
  } catch {
    CF.status('Could not read that image.');
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
    CF.status('PNG exported (3840×2160).');
  } catch (e) {
    CF.status('Export failed: ' + (e.message || e));
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
    `${t.code || ''} • ${t.tag || ''}`,
    `LEVEL ${t.level || '?'} • ${t.crank || 'UNRANKED'} (peak ${t.prank || 'UNRANKED'})`,
    `PREMIUM ${t.prems || '00'} | LIMITED ${t.limited || '00'} | SEMI PREM ${t.semis || '00'} | BATTLEPASS ${t.bpass || '00'}`,
    `${t.wtr || ''} | ${t.receipts || ''} | ${t.owner || ''}`,
    `${t.cname || ''} | ${t.cstatus || ''} | ${t.date || ''}`,
    `${t.premier || ''} | ${t.vlink || ''} | ${t.price || ''}`,
    counts,
    `Link: ${link}`,
    `Contact: ${t.link || ''}`
  ].join('\n');
  CF.copyText(txt);
  CF.status('Sale-post text copied to clipboard.');
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
    CF.status('Draft saved.');
  } catch {
    CF.status('Save failed (storage quota).');
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
      owned: draft.owned || {}
    });
    renderFromState();
    CF.status('Draft loaded.');
    return;
  }
  // one-time migration from the old innerHTML-based draft
  const legacy = CF.readJSON(LEGACY_DRAFT_KEY, null);
  if (legacy?.picks) {
    state.picks = Object.fromEntries(CF.ALL_CATS.map(c =>
      [c, (legacy.picks[c] || []).map(s => ({ id: s.id, weapon: s.weapon, name: s.name, tier: s.tier, icon: s.icon || s.img }))]));
    if (legacy.theme) state.theme = legacy.theme;
    renderFromState();
    CF.status('Old draft migrated — text fields were reset to defaults.');
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
    owned: state.owned
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
        CF.status('Browser storage is full — remove some uploads and retry.');
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
      : 'Published for this browser. Link copied — add Supabase keys in js/config.js for public links.');
  } catch (e) {
    CF.status('Publish failed: ' + (e.message || e));
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
    CF.status(`Listing "${slug}" not found on this device.`);
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
    owned: p.owned || {}
  });
  renderFromState();
  updateWm();
  CF.$('publishBtn').textContent = supabase ? 'Update listing' : 'Republish';
  CF.status(`Editing listing ${slug} — publish to update it.`);
}

// ── boot ──────────────────────────────────────────────────────────
CF.initThemeSwitch();
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
    owned: bootDraft.owned || {}
  });
  renderFromState();
}
updateWm();

function bootStatus() {
  CF.status(editSlug
    ? `Editing listing ${editSlug} — publish to update it.`
    : `Ready — ${Object.values(DB).flat().length} skins, ${TIERS.length} tiers, ${RANKS.length - 1} ranks.` +
      (bootDraft ? ' Draft restored.' : ''));
}

initEditMode().finally(async () => {
  try {
    const catalog = await CF.loadCatalog();
    DB = catalog.DB; TIERS = catalog.TIERS; RANKS = catalog.RANKS;
    BUDDIES = catalog.BUDDIES; CARDS = catalog.CARDS;
  } catch (e) {
    CF.status('Skin database failed to load: ' + (e.message || e));
    return;
  }
  bootStatus();
});
