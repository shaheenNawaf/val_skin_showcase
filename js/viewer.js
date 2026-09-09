// CardForge viewer — renders a published listing from Supabase (public share
// links) or, as a fallback, from this browser's localStorage.
import * as CF from './shared.js';

const CONFIG = window.CARDFORGE_CONFIG || {};
let supabase = null;
if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && window.supabase) {
  supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}

const AVATAR_PLACEHOLDER = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='100%25' height='100%25' fill='%232A3540'/><circle cx='32' cy='25' r='11' fill='%23768390'/><rect x='14' y='40' width='36' height='19' rx='6' fill='%23768390'/></svg>";

const card = CF.$('card');
let totalViews = 0;

function updateBadge(nowViewing) {
  const badge = CF.$('viewBadge');
  CF.$('viewText').textContent = `${nowViewing} viewing now • ${totalViews} total views`;
  badge.hidden = false;
}

function skinCell(s) {
  const label = `${s.weapon || ''} — ${s.name || ''}`;
  const src = s.icon || s.img || '';
  return `<span class="skin"><img src="${CF.esc(src)}" alt="${CF.esc(label)}" title="${CF.esc(label)}"></span>`;
}

function renderListing(listing) {
  const payload = listing.payload || {};
  const theme = listing.theme || payload.theme || 'protocol';
  const texts = payload.texts || {};

  CF.applyTheme(theme);

  document.querySelectorAll('#card [data-key]').forEach(el => {
    const v = texts[el.dataset.key];
    if (v != null && v !== '') el.textContent = v;
  });

  const ranks = payload.ranks || {};
  ['crank', 'prank'].forEach(key => {
    const row = card.querySelector(`.rankrow[data-rank="${key}"]`);
    if (!row) return;
    const badge = row.querySelector('.rankbadge');
    if (ranks[key]) badge.src = ranks[key];
    else badge.removeAttribute('src');
  });

  const picks = payload.picks || {};
  CF.CATS.forEach(cat => {
    const panel = card.querySelector(`.panel[data-cat="${cat}"]`);
    const skins = picks[cat] || [];
    panel.innerHTML = `<h3>${cat}</h3><div class="slots">${
      skins.length ? skins.map(skinCell).join('') : '<div class="slotbox empty"></div>'
    }</div>`;
  });

  const assets = payload.assets || {};
  const avatar = card.querySelector('.avatar');
  if (assets.avatar) avatar.src = assets.avatar;
  else avatar.src = AVATAR_PLACEHOLDER;

  if (assets.pcard) {
    const pcard = card.querySelector('.pcard');
    pcard.style.backgroundImage = `url("${assets.pcard}")`;
    pcard.querySelector('.hint')?.remove();
  }

  if (assets.buddies?.length) {
    const box = card.querySelector('.charms-box');
    box.querySelector('.hint')?.remove();
    assets.buddies.forEach(url => {
      const img = new Image();
      img.src = url;
      img.alt = 'Gun buddy';
      box.appendChild(img);
    });
  }
}

// ── presence ──────────────────────────────────────────────────────
function startSupabasePresence(slug) {
  const channel = supabase.channel('listing:' + slug)
    .on('presence', { event: 'sync' }, () => {
      updateBadge(Object.keys(channel.presenceState()).length);
    })
    .subscribe(async st => {
      if (st === 'SUBSCRIBED') await channel.track({ sid: CF.randomId(8), online_at: Date.now() });
    });
}

// ── boot ──────────────────────────────────────────────────────────
const fit = CF.makeFitter({ card, sizer: CF.$('sizer'), topbar: CF.$('topbar'), stage: CF.$('stage') });
fit();

const slug = new URLSearchParams(location.search).get('slug');
if (!slug) {
  CF.status('No listing specified — open a published share link.');
} else {
  CF.status('Loading listing…');
  let listing = null;

  if (supabase) {
    try {
      const { data, error } = await supabase.from('listing_public').select('*').eq('slug', slug).maybeSingle();
      if (error) throw error;
      listing = data;
    } catch {
      CF.status('Supabase unavailable — trying local copy…');
    }
  }

  if (!listing) {
    const local = CF.readJSON('vlistings', {})[slug];
    // legacy entries stored {picks, html}; current ones store {payload}
    if (local) listing = { payload: local.payload || { picks: local.picks || {} }, theme: local.theme, views: 0 };
  }

  if (!listing) {
    CF.status('Listing not found.');
  } else {
    renderListing(listing);
    totalViews = Number(listing.views) || 0;
    CF.status('Listing loaded.');

    const link = (listing.payload?.texts?.link || '').trim();
    const contactBtn = CF.$('contactBtn');
    if (/^https?:\/\//.test(link)) {
      contactBtn.hidden = false;
      contactBtn.addEventListener('click', () => window.open(link, '_blank', 'noopener'));
    }

    if (localStorage.getItem('vc-edit-' + slug)) {
      const editBtn = CF.$('editBtn');
      editBtn.hidden = false;
      editBtn.addEventListener('click', () => {
        location.href = 'index.html?edit=' + encodeURIComponent(slug);
      });
    }

    CF.$('copyLinkBtn').addEventListener('click', () => CF.copyText(location.href));

    fit();
    if (supabase) {
      startSupabasePresence(slug);
      try {
        const { data, error } = await supabase.rpc('bump_views', { p_slug: slug });
        if (!error && data != null) totalViews = Number(data);
      } catch { /* view count is best-effort */ }
      updateBadge(1);
    } else {
      CF.startLocalPresence(slug, updateBadge);
      updateBadge(1);
    }
  }
}
