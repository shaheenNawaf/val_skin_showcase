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
const mcard = CF.$('mcard');
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
  CF.ALL_CATS.forEach(cat => {
    const slots = card.querySelector(`.panel[data-cat="${cat}"] .slots`);
    const skins = picks[cat] || [];
    slots.innerHTML = skins.length
      ? skins.map(skinCell).join('')
      : '<div class="slotbox empty"></div>';
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

// ── mobile-native layout (<=700px): same payload, readable single column ──
const MOBILE_SKELETON = `
<section class="mhead"><div class="mcode" data-m="code">K486</div><div class="mvlogin" data-m="vlogin">RIOT ID</div></section>
<section class="mbox mranks">
  <div class="mrank"><label>CURRENT</label><img class="mrankbadge" data-mrank="crank" alt=""><b data-m="crank">DIAMOND 2</b></div>
  <div class="mrank"><label>PEAK</label><img class="mrankbadge" data-mrank="prank" alt=""><b data-m="prank">IMMORTAL 3</b></div>
  <div class="mcurrow">
    <span class="mlvl">LEVEL <b data-m="level">376</b></span>
    <span class="mcur"><i class="mico">V</i><b data-m="vp">420</b></span>
    <span class="mcur"><i class="mico">R</i><b data-m="rp">140</b></span>
    <span class="mcur"><i class="mico">K</i><b data-m="kc">6422</b></span>
  </div>
</section>
<section class="mbox mstats">
  <div class="mcounts">
    <div class="mstat"><label>PREMIUM</label><b data-m="prems">42</b></div>
    <div class="mstat mlimited"><label>LIMITED</label><b data-m="limited">02</b></div>
    <div class="mstat"><label>SEMI PREM</label><b data-m="semis">00</b></div>
    <div class="mstat"><label>BATTLEPASS</label><b data-m="bpass">10</b></div>
  </div>
  <div class="minforow"><span data-m="wtr">WTR: YES</span><span data-m="receipts">RECEIPTS: YES</span><span data-m="owner">0TH OWNER</span></div>
  <div class="minforow"><span data-m="cname">CHANGE NAME</span><span class="mwarn" data-m="cstatus">NOT READY</span><span data-m="date">2/6/2026</span></div>
  <div class="minforow"><span data-m="premier">PREMIER</span><span class="mwarn" data-m="vlink">UNLINKED</span><span data-m="price">PRICE OFFER</span></div>
</section>
<section class="mskins"></section>
<section class="mbox mseller">
  <img class="mpcard" alt="Player card" hidden>
  <div class="msellerrow">
    <img class="mavatar" alt="Seller avatar">
    <div class="msellertext">
      <div class="mtag" data-m="tag">FS/FT+ADD</div>
      <a class="mlink" data-m="link" rel="noopener">https://www.facebook.com/Your.Page.Here</a>
    </div>
  </div>
</section>
<div class="mstrip"><span>Card Forge</span><span data-mwm="slug">Listing</span><span data-mwm="stamp"></span></div>`;

function renderMobile(listing) {
  if (!mcard) return;
  const payload = listing.payload || {};
  const texts = payload.texts || {};
  mcard.innerHTML = MOBILE_SKELETON;

  mcard.querySelectorAll('[data-m]').forEach(el => {
    const v = texts[el.dataset.m];
    if (v != null && v !== '') el.textContent = v;
  });

  const ranks = payload.ranks || {};
  ['crank', 'prank'].forEach(key => {
    const badge = mcard.querySelector(`.mrankbadge[data-mrank="${key}"]`);
    if (ranks[key]) badge.src = ranks[key];
    else badge.removeAttribute('src');
  });

  const picks = payload.picks || {};
  const wrap = mcard.querySelector('.mskins');
  let any = false;
  CF.ALL_CATS.forEach(cat => {
    const skins = picks[cat] || [];
    if (!skins.length) return;
    any = true;
    const sec = document.createElement('div');
    sec.className = 'mcat';
    const h = document.createElement('h3');
    h.textContent = cat;
    const g = document.createElement('div');
    g.className = 'mgrid';
    skins.forEach(s => {
      const cell = document.createElement('figure');
      cell.className = 'mskin';
      const img = document.createElement('img');
      img.src = s.icon || s.img || '';
      img.alt = `${s.weapon || ''} — ${s.name || ''}`;
      img.loading = 'lazy';
      const cap = document.createElement('figcaption');
      cap.textContent = [s.weapon, s.name].filter(Boolean).join(' — ');
      cell.append(img, cap);
      g.append(cell);
    });
    sec.append(h, g);
    wrap.append(sec);
  });
  if (!any) {
    const e = document.createElement('div');
    e.className = 'mempty';
    e.textContent = 'No skins in this listing.';
    wrap.append(e);
  }

  const assets = payload.assets || {};
  mcard.querySelector('.mavatar').src = assets.avatar || AVATAR_PLACEHOLDER;
  if (assets.pcard) {
    const pc = mcard.querySelector('.mpcard');
    pc.src = assets.pcard;
    pc.hidden = false;
  }
  if (assets.buddies?.length) {
    const sec = document.createElement('section');
    sec.className = 'mbuddies';
    const h = document.createElement('h3');
    h.textContent = 'Buddies';
    const g = document.createElement('div');
    g.className = 'mbuddygrid';
    assets.buddies.forEach(url => {
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Gun buddy';
      img.loading = 'lazy';
      g.append(img);
    });
    sec.append(h, g);
    mcard.querySelector('.mseller').before(sec);
  }
  const linkEl = mcard.querySelector('.mlink');
  const link = (texts.link || '').trim();
  if (/^https?:\/\//.test(link)) linkEl.href = link;

  const wmSlug = mcard.querySelector('[data-mwm="slug"]');
  if (wmSlug && slug) wmSlug.textContent = 'Listing ' + slug;
  const wmStamp = mcard.querySelector('[data-mwm="stamp"]');
  if (wmStamp) wmStamp.textContent = new Date().toISOString().slice(0, 10);
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
  CF.status('No listing specified — open a published share link.', 'err');
} else {
  const wmSlug = card.querySelector('[data-wm="slug"]');
  if (wmSlug) wmSlug.textContent = 'Listing ' + slug;
  const wmStamp = card.querySelector('[data-wm="stamp"]');
  if (wmStamp) wmStamp.textContent = new Date().toISOString().slice(0, 10);
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
    CF.status('Listing not found.', 'err');
  } else {
    renderListing(listing);
    renderMobile(listing);
    totalViews = Number(listing.views) || 0;
    CF.status('Listing loaded.', 'ok');

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
