// CardForge - Phase 1 MVP Application
// Structured persistence + Supabase integration

const CONFIG = {
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL || '',
  SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  STORAGE_BUCKET: 'cardforge-assets'
};

const DESIGN_W = 1920, DESIGN_H = 1080;
const CATS = ['Sidearms', 'SMGs', 'Shotguns', 'Rifles', 'Sniper Rifles', 'Machine Guns', 'Melees'];
const TIER_COLORS = { Select: '#9ba8b9', Deluxe: '#4aa8ff', Premium: '#b44bf0', Ultra: '#ff5d7b', Exclusive: '#ffc45e' };
const TIER_COLORS_LC = Object.fromEntries(Object.entries(TIER_COLORS).map(([k, v]) => [k.toLowerCase(), v]));

const tierColor = (t) => TIER_COLORS_LC[(t || '').toLowerCase()] || '#888';

// State management
let state = {
  picks: Object.fromEntries(CATS.map(c => [c, []])),
  texts: {},
  assets: { avatar: null, pcard: null, buddies: [] },
  theme: 'protocol'
};

let DB = {}, TIERS = [], RANKS = [];
let list = [], currentCat = null, pending = null, viewmode = false, pickerMode = 'skin', rankRow = null;
let filterWeapon = '', filterTier = '';
let supabase = null;
let currentListing = null;
let viewerChannel = null;

const $ = (id) => document.getElementById(id);
const card = $('card');
const modal = $('modal');
const mGrid = $('mGrid');
const mSearch = $('mSearch');
const fileInput = $('fileInput');

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const status = (m) => $('status').textContent = m;

// Initialize Supabase client
function initSupabase() {
  if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
    const { createClient } = supajs;
    supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    return true;
  }
  return false;
}

// Fit card to viewport
function fit() {
  const s = Math.min((innerWidth - 16) / DESIGN_W, (innerHeight - 52 - 16) / DESIGN_H);
  card.style.transform = `scale(${Math.min(s, 1)})`;
}
addEventListener('resize', fit);

// Theme management
document.querySelectorAll('.swatch').forEach(b => b.onclick = () => {
  applyTheme(b.dataset.theme);
  state.theme = b.dataset.theme;
});

function applyTheme(t) {
  if (!document.querySelector(`.swatch[data-theme="${t}"]`)) t = 'protocol';
  document.documentElement.dataset.theme = t;
  document.querySelectorAll('.swatch').forEach(x => x.classList.toggle('active', x.dataset.theme === t));
}
applyTheme(localStorage.getItem('vc-theme') || 'protocol');

// Render panel for a category
function renderPanel(cat) {
  const el = document.querySelector(`.panel[data-cat="${cat}"]`);
  const picks = state.picks[cat];
  const cells = picks.length
    ? picks.map(s => `<span class="skin" data-skin-id="${s.id}"><img src="${s.img}" title="${esc(s.weapon)} — ${esc(s.name)}" data-skin-img="${s.img}">
        <button class="rm" data-remove="${cat}" data-id="${s.id}">×</button></span>`).join('')
    : '<div class="slotbox empty"></div>';
  el.innerHTML = `<h3>${cat}</h3><div class="slots">${cells}</div>
    <button class="add" data-add="${cat}">+ Add (${picks.length})</button>`;
}

const renderAll = () => CATS.forEach(renderPanel);

// Map weapon category to our categories
function mapCategory(c) {
  c = (c || '').toLowerCase();
  if (c.includes('sidearm')) return 'Sidearms';
  if (c.includes('smg')) return 'SMGs';
  if (c.includes('shotgun')) return 'Shotguns';
  if (c.includes('sniper')) return 'Sniper Rifles';
  if (c.includes('machine') || c.includes('lmg')) return 'Machine Guns';
  if (c.includes('melee')) return 'Melees';
  if (c.includes('rifle')) return 'Rifles';
  return null;
}

// Initialize app - load skin database
async function init() {
  renderAll();
  fit();
  
  try {
    // Try to load from Supabase first, fallback to community API
    let weaponsData, tiersData, contentTiersData;
    
    if (supabase) {
      try {
        const { data: skinsData, error } = await supabase.from('skins').select('*');
        if (!error && skinsData && skinsData.length > 0) {
          // Group by category
          skinsData.forEach(s => {
            const cat = s.category;
            if (!DB[cat]) DB[cat] = [];
            DB[cat].push({
              id: s.uuid,
              weapon: s.weapon,
              name: s.name,
              icon: s.icon_url,
              img: s.icon_url,
              tier: s.tier
            });
          });
          
          // Extract unique tiers
          const tierSet = new Set(skinsData.map(s => s.tier).filter(Boolean));
          TIERS = [...tierSet].sort();
          
          status(`Loaded ${skinsData.length} skins from database`);
        } else {
          throw new Error('No skins in database');
        }
      } catch (e) {
        console.log('Falling back to community API:', e.message);
        await loadFromCommunityAPI();
      }
    } else {
      await loadFromCommunityAPI();
    }
    
    // Sort skins
    Object.values(DB).forEach(a => a.sort((x, y) => (x.weapon + x.name).localeCompare(y.weapon + y.name)));
    
  } catch (e) {
    status('Skin DB failed to load: ' + e.message);
  }
}

async function loadFromCommunityAPI() {
  const [wR, tR, cR] = await Promise.all([
    fetch('https://valorant-api.com/v1/weapons?language=en-US'),
    fetch('https://valorant-api.com/v1/contenttiers?language=en-US'),
    fetch('https://valorant-api.com/v1/competitivetiers?language=en-US')
  ]);
  
  const wJ = await wR.json(), tJ = await tR.json(), cJ = await cR.json();
  const tiers = Object.fromEntries((tJ.data || []).map(t => [t.uuid, t.displayName]));
  
  (wJ.data || []).forEach(w => {
    const cat = mapCategory(w.category);
    if (!cat) return;
    (w.skins || []).forEach(s => {
      if (s.displayName === 'Standard') return;
      const icon = s.displayIcon || (s.chromas && s.chromas[0] && s.chromas[0].displayIcon);
      if (!icon) return;
      (DB[cat] = DB[cat] || []).push({
        id: s.uuid,
        weapon: w.displayName,
        name: s.displayName,
        icon: icon,
        img: icon,
        tier: tiers[s.contentTierUuid] || ''
      });
    });
  });
  
  // Build tier list from data
  const TIER_ORDER = ['select', 'deluxe', 'premium', 'ultra', 'exclusive'];
  const tierSet = new Set();
  Object.values(DB).forEach(a => a.forEach(s => { if (s.tier) tierSet.add(s.tier); }));
  TIERS = [...tierSet].sort((a, b) => {
    const ia = TIER_ORDER.indexOf(a.toLowerCase()), ib = TIER_ORDER.indexOf(b.toLowerCase());
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  
  // Load ranks
  const set = (cJ.data || []).slice(-1)[0];
  RANKS = [
    { name: 'UNRANKED', icon: null, color: '#555', order: -1 },
    ...(set?.tiers || []).filter(t => t.tierName).map(t => ({
      name: (t.tierName + ' ' + (t.divisionName || '')).trim(),
      icon: t.displayIcon || t.largeIcon,
      color: t.color || '#888',
      order: (t.tier || 0) * 10 + (t.division || 0)
    })).sort((a, b) => a.order - b.order)
  ];
  
  status(`Ready — ${Object.values(DB).flat().length} skins, ${TIERS.length} tiers, ${RANKS.length - 1} ranks.`);
}

// Fast-add picker
function openPicker(cat) {
  pickerMode = 'skin';
  currentCat = cat;
  filterWeapon = '';
  filterTier = '';
  $('mTitle').textContent = 'Add ' + cat;
  $('mFilters').style.display = '';
  
  const wCounts = {}, tCounts = {};
  (DB[cat] || []).forEach(s => {
    wCounts[s.weapon] = (wCounts[s.weapon] || 0) + 1;
    if (s.tier) tCounts[s.tier] = (tCounts[s.tier] || 0) + 1;
  });
  
  const w = Object.keys(wCounts).sort();
  $('mWeapons').innerHTML = '<button class="chip active" data-w="">All</button>' +
    w.map(x => `<button class="chip" data-w="${esc(x)}">${esc(x)} (${wCounts[x]})</button>`).join('');
  
  $('mTiers').style.display = TIERS.length ? '' : 'none';
  $('mTiers').innerHTML = '<button class="chip active" data-t="">Any tier</button>' +
    TIERS.filter(t => tCounts[t]).map(t => `<button class="chip" data-t="${esc(t)}"><i class="dot" style="background:${tierColor(t)}"></i>${esc(t)} (${tCounts[t]})</button>`).join('');
  
  mSearch.value = '';
  renderGrid();
  modal.hidden = false;
  setTimeout(() => mSearch.focus(), 60);
}

function openRankPicker(btn) {
  pickerMode = 'rank';
  rankRow = btn.closest('.rankrow');
  $('mTitle').textContent = 'Select rank';
  $('mFilters').style.display = 'none';
  mSearch.value = '';
  renderGrid();
  modal.hidden = false;
  setTimeout(() => mSearch.focus(), 60);
}

function paintChips() {
  document.querySelectorAll('#mWeapons .chip').forEach(c => c.classList.toggle('active', (c.dataset.w || '') === filterWeapon));
  document.querySelectorAll('#mTiers .chip').forEach(c => c.classList.toggle('active', (c.dataset.t || '') === filterTier));
}

$('mWeapons').onclick = e => {
  const c = e.target.closest('.chip');
  if (!c) return;
  filterWeapon = c.dataset.w || '';
  paintChips();
  renderGrid();
};

$('mTiers').onclick = e => {
  const c = e.target.closest('.chip');
  if (!c) return;
  filterTier = c.dataset.t || '';
  paintChips();
  renderGrid();
};

function renderGrid() {
  const q = mSearch.value.toLowerCase();
  
  if (pickerMode === 'rank') {
    list = RANKS.filter(r => !q || r.name.toLowerCase().includes(q));
    $('mCount').textContent = list.length + ' results';
    mGrid.innerHTML = list.map((r, i) => `<button class="item" data-i="${i}"><img loading="lazy" src="${r.icon || ''}" style="height:44px"><b>${esc(r.name)}</b><span>competitive tier</span>${r.icon ? `<i class="tdot" style="background:${r.color}"></i>` : ''}</button>`).join('') || '<p class="none">No matches.</p>';
    return;
  }
  
  const counts = {};
  (state.picks[currentCat] || []).forEach(p => counts[p.id] = (counts[p.id] || 0) + 1);
  
  list = (DB[currentCat] || []).filter(s =>
    (!filterWeapon || s.weapon === filterWeapon) &&
    (!filterTier || (s.tier || '').toLowerCase() === filterTier.toLowerCase()) &&
    (!q || (s.name + ' ' + s.weapon).toLowerCase().includes(q))
  );
  
  $('mCount').textContent = list.length + ' results';
  mGrid.innerHTML = list.map((s, i) => `<button class="item" data-i="${i}">${counts[s.id] ? `<i class="cnt">×${counts[s.id]}</i>` : ''}<img loading="lazy" src="${s.icon}"><b>${esc(s.name)}</b><span>${esc(s.weapon)}${s.tier ? ' • ' + esc(s.tier) : ''}</span>${s.tier ? `<i class="tdot" style="background:${tierColor(s.tier)}"></i>` : ''}</button>`).join('') || '<p class="none">No matches.</p>';
}

mGrid.onclick = e => {
  const b = e.target.closest('.item');
  if (!b) return;
  if (pickerMode === 'rank') {
    applyRank(list[+b.dataset.i]);
    return;
  }
  addSkin(currentCat, list[+b.dataset.i]);
  renderGrid();
};

mSearch.oninput = renderGrid;

mSearch.addEventListener('keydown', e => {
  if (e.key === 'Enter' && list.length) {
    if (pickerMode === 'rank') applyRank(list[0]);
    else {
      addSkin(currentCat, list[0]);
      renderGrid();
    }
  }
});

document.addEventListener('keydown', e => {
  if (modal.hidden) return;
  if (e.key === 'Escape') {
    modal.hidden = true;
    return;
  }
  if (e.key === '/' && document.activeElement !== mSearch) {
    e.preventDefault();
    mSearch.focus();
  }
});

$('mClose').onclick = () => modal.hidden = true;
modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });

function applyRank(r) {
  const badge = rankRow.querySelector('.rankbadge');
  const txt = rankRow.querySelector('b');
  txt.textContent = r.name;
  if (!r.icon) {
    modal.hidden = true;
    return;
  }
  toDataUrl(r.icon).then(d => badge.src = d && d.startsWith('data:') ? d : r.icon);
  modal.hidden = true;
}

function addSkin(cat, s) {
  state.picks[cat].push({ ...s });
  renderPanel(cat);
  toDataUrl(s.icon).then(d => {
    if (d && d.startsWith('data:')) {
      state.picks[cat].forEach(p => { if (p.id === s.id) p.img = d; });
      renderPanel(cat);
    }
  });
}

function toDataUrl(u) {
  return fetch(u).then(r => r.blob()).then(b => new Promise(res => {
    const f = new FileReader();
    f.onload = () => res(f.result);
    f.readAsDataURL(b);
  })).catch(() => u);
}

// Card interactions
card.addEventListener('click', e => {
  if (viewmode) return;
  
  const auto = e.target.closest('[data-auto]');
  if (auto) {
    const n = Object.values(state.picks).flat().filter(p => ['premium', 'ultra', 'exclusive'].includes((p.tier || '').toLowerCase())).length;
    card.querySelector('.stats .stat b').textContent = String(n).padStart(2, '0');
    return;
  }
  
  const ch = e.target.closest('.charms-box img');
  if (ch) { ch.remove(); return; }
  
  const rm = e.target.closest('.rm');
  if (rm) {
    const a = state.picks[rm.dataset.remove];
    const i = a.findIndex(p => p.id === rm.dataset.id);
    if (i > -1) { a.splice(i, 1); renderPanel(rm.dataset.remove); }
    return;
  }
  
  const rp = e.target.closest('[data-rankpick]');
  if (rp) { openRankPicker(rp); return; }
  
  const add = e.target.closest('.add');
  if (add) { openPicker(add.dataset.add); return; }
  
  const up = e.target.closest('[data-upload]');
  if (up) { pending = up; fileInput.click(); return; }
});

// File upload handling
fileInput.onchange = e => {
  const f = e.target.files[0];
  if (!f || !pending) return;
  
  resizeToDataUrl(f, 1600).then(url => {
    const t = pending;
    if (t.dataset.upload === 'avatar') {
      t.src = url;
      state.assets.avatar = url;
    } else if (t.dataset.upload === 'pcard') {
      t.style.backgroundImage = `url(${url})`;
      t.querySelector('.hint')?.remove();
      state.assets.pcard = url;
    } else {
      t.querySelector('.hint')?.remove();
      const img = document.createElement('img');
      img.src = url;
      t.appendChild(img);
      state.assets.buddies.push(url);
    }
    pending = null;
    fileInput.value = '';
  });
};

function resizeToDataUrl(file, max) {
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

// Export functionality
$('exportBtn').onclick = async () => {
  status('Rendering 1080p PNG…');
  document.body.classList.add('exporting');
  await new Promise(r => requestAnimationFrame(r));
  try {
    const canvas = await html2canvas(card, { scale: 2, useCORS: true });
    const a = document.createElement('a');
    a.download = 'showcase-card-1080p.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
    status('Exported 3840×2160 (1080p canvas @2×).');
  } finally {
    document.body.classList.remove('exporting');
    fit();
  }
};

// Save/Load with structured data
$('saveBtn').onclick = () => {
  captureTexts();
  try {
    localStorage.setItem('vcard-structured', JSON.stringify(state));
    status('Draft saved.');
  } catch (e) {
    status('Save failed (quota).');
  }
};

$('loadBtn').onclick = () => {
  const raw = localStorage.getItem('vcard-structured');
  if (!raw) {
    status('Nothing saved.');
    return;
  }
  const d = JSON.parse(raw);
  state = { ...state, ...d };
  applyTheme(state.theme || 'protocol');
  renderAll();
  restoreTexts();
  restoreAssets();
  status('Draft loaded.');
};

// Capture editable text fields
function captureTexts() {
  state.texts = {};
  card.querySelectorAll('[contenteditable]').forEach((el, i) => {
    const key = el.dataset.key || `text-${i}`;
    state.texts[key] = el.textContent.trim();
  });
}

// Restore text fields
function restoreTexts() {
  Object.entries(state.texts || {}).forEach(([key, value]) => {
    const el = card.querySelector(`[data-key="${key}"]`) || card.querySelector(`[contenteditable]:nth-of-type(${parseInt(key.split('-')[1]) + 1})`);
    if (el) el.textContent = value;
  });
}

// Restore assets
function restoreAssets() {
  if (state.assets.avatar) {
    card.querySelector('.avatar').src = state.assets.avatar;
  }
  if (state.assets.pcard) {
    const pcard = card.querySelector('.pcard');
    pcard.style.backgroundImage = `url(${state.assets.pcard})`;
    pcard.querySelector('.hint')?.remove();
  }
  if (state.assets.buddies && state.assets.buddies.length > 0) {
    const box = card.querySelector('.charms-box');
    box.innerHTML = '';
    state.assets.buddies.forEach(url => {
      const img = document.createElement('img');
      img.src = url;
      box.appendChild(img);
    });
  }
}

// Publish to Supabase
$('publishBtn').onclick = async () => {
  if (!supabase) {
    alert('Supabase not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.');
    return;
  }
  
  captureTexts();
  
  const slug = Math.random().toString(36).slice(2, 8);
  const editToken = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  
  const payload = {
    texts: state.texts,
    picks: state.picks,
    assets: state.assets,
    timestamp: Date.now()
  };
  
  try {
    const { data, error } = await supabase.rpc('create_listing', {
      p_slug: slug,
      p_edit_token_hash: await hashToken(editToken),
      p_payload: payload,
      p_theme: state.theme
    });
    
    if (error) throw error;
    
    const url = `${window.location.origin}/view.html?slug=${slug}`;
    const editUrl = `${window.location.origin}/edit.html?slug=${slug}&token=${editToken}`;
    
    await copyText(url);
    status('Published! Link copied. Edit link saved to localStorage.');
    localStorage.setItem(`edit-${slug}`, editToken);
    
    // Navigate to view page
    window.location.href = `/view.html?slug=${slug}`;
    
  } catch (e) {
    status('Publish failed: ' + e.message);
    console.error(e);
  }
};

async function hashToken(token) {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function copyText(t) {
  if (navigator.clipboard && location.protocol !== 'file:') {
    return navigator.clipboard.writeText(t).catch(() => prompt('Copy this link:', t));
  } else {
    prompt('Copy this link:', t);
  }
}

// Check for listing slug on load
async function checkForListing() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('slug');
  
  if (slug && supabase) {
    try {
      const { data, error } = await supabase.from('listing_public').select('*').eq('slug', slug).single();
      
      if (error) throw error;
      
      currentListing = data;
      loadListing(data);
      return true;
    } catch (e) {
      console.error('Failed to load listing:', e);
      status('Listing not found');
    }
  }
  return false;
}

function loadListing(listing) {
  viewmode = true;
  document.body.classList.add('viewmode');
  
  state.theme = listing.theme || 'protocol';
  applyTheme(state.theme);
  
  const payload = listing.payload;
  state.picks = payload.picks || {};
  state.texts = payload.texts || {};
  state.assets = payload.assets || {};
  
  renderAll();
  restoreTexts();
  restoreAssets();
  
  // Hide editor buttons
  ['saveBtn', 'loadBtn', 'publishBtn', 'exportBtn'].forEach(i => $(i).hidden = true);
  
  // Show viewer elements
  startPresence(listing.slug, listing.views || 0);
}

// Real-time presence with Supabase Realtime
function startPresence(slug, initialViews) {
  if (!supabase) {
    // Fallback to BroadcastChannel for local testing
    startLocalPresence(slug, initialViews);
    return;
  }
  
  const sessionId = Math.random().toString(36).slice(2);
  
  // Subscribe to presence channel
  viewerChannel = supabase.channel(`listing:${slug}`)
    .on('presence', { event: 'sync' }, () => {
      const state = viewerChannel.presenceState();
      const count = Object.keys(state).length;
      updateViewerBadge(count, initialViews);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await viewerChannel.track({ sessionId, online_at: Date.now() });
      }
    });
  
  // Bump views counter
  await bumpViews(slug);
  
  updateViewerBadge(1, initialViews + 1);
}

function startLocalPresence(slug, initialViews) {
  const bc = new BroadcastChannel('vc-' + slug);
  const peers = new Map();
  const sid = Math.random().toString(36).slice(2);
  peers.set(sid, Date.now());
  
  const prune = () => {
    const n = Date.now();
    for (const [k, v] of peers) {
      if (k !== sid && n - v > 8000) peers.delete(k);
    }
  };
  
  const badge = () => {
    $('viewBadge').textContent = `👁 ${peers.size} viewing now • ${initialViews} total views`;
  };
  
  bc.onmessage = e => {
    const { t, s } = e.data;
    if (s === sid) return;
    if (t === 'hello') {
      peers.set(s, Date.now());
      bc.postMessage({ t: 'here', s: sid });
    } else if (t === 'here' || t === 'ping') {
      peers.set(s, Date.now());
    } else if (t === 'bye') {
      peers.delete(s);
    }
    prune();
    badge();
  };
  
  bc.postMessage({ t: 'hello', s: sid });
  setInterval(() => {
    bc.postMessage({ t: 'ping', s: sid });
    prune();
    badge();
  }, 2500);
  
  addEventListener('beforeunload', () => bc.postMessage({ t: 'bye', s: sid }));
  badge();
}

function updateViewerBadge(nowViewing, totalViews) {
  $('viewBadge').textContent = `👁 ${nowViewing} viewing now • ${totalViews} total views`;
}

async function bumpViews(slug) {
  if (!supabase) return;
  try {
    await supabase.rpc('bump_views', { p_slug: slug });
  } catch (e) {
    console.error('Failed to bump views:', e);
  }
}

// Contact seller button
$('contactBtn').onclick = () => {
  const link = card.querySelector('.link')?.textContent.trim();
  if (link && /^https?:\/\//.test(link)) {
    window.open(link, '_blank');
  }
};

// Initialize app
async function main() {
  const hasSupabase = initSupabase();
  
  if (hasSupabase) {
    const isListing = await checkForListing();
    if (isListing) {
      fit();
      return;
    }
  }
  
  init();
}

main();
