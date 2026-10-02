// CardForge viewer — renders a published listing from Supabase (public share
// links) or, as a fallback, from this browser's localStorage.
import * as CF from './shared.js';
import { applyLayout, resolveLayout } from './layouts.js';

const CONFIG = window.CARDFORGE_CONFIG || {};
let supabase = null;
let sbLoading = null;

/* CF-25: listing reads are anon REST — a plain fetch returns the row in
   ~1.5KB. The 209KB supabase.js SDK used to sit on the buyer's critical
   path just to do this; it now loads after first render, when presence
   actually needs it. */
async function restFetchListing(slug) {
  const r = await fetch(
    `${CONFIG.SUPABASE_URL}/rest/v1/listing_public?select=*&slug=eq.${encodeURIComponent(slug)}`,
    { headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}` } },
  );
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}
async function restBumpViews(slug) {
  const r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/bump_views`, {
    method: 'POST',
    headers: {
      apikey: CONFIG.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_slug: slug }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
function loadSupabase() {
  if (supabase) return Promise.resolve(supabase);
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) return Promise.resolve(null);
  if (!sbLoading) {
    sbLoading = new Promise(res => {
      const s = document.createElement('script');
      s.src = 'js/vendor/supabase.js';
      s.onload = () => {
        try { supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY); }
        catch { supabase = null; }
        res(supabase);
      };
      s.onerror = () => res(null);
      document.head.appendChild(s);
    });
  }
  return sbLoading;
}

const AVATAR_PLACEHOLDER = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='100%25' height='100%25' fill='%232A3540'/><circle cx='32' cy='25' r='11' fill='%23768390'/><rect x='14' y='40' width='36' height='19' rx='6' fill='%23768390'/></svg>";

const card = CF.$('card');
const mcard = CF.$('mcard');
let totalViews = 0;
const SPV_LIST = [];
let spv = null, spvFocus = null;
let spvMuted = false;
let viewMode = null;
let currentListing = null;

function updateBadge(nowViewing) {
  const badge = CF.$('viewBadge');
  CF.$('viewText').textContent = `${nowViewing} viewing now • ${totalViews} total views`;
  badge.hidden = false;
}

function skinCell(s, spi) {
  const label = `${s.weapon || ''} — ${s.name || ''}${s.level >= 2 ? ` · LV${s.level}` : ''}${s.variant ? ` · ${s.variant.name}` : ''}`;
  const src = s.icon || s.img || '';
  /* CF-26: inspect was hover-only and not keyboard reachable — the mobile
     figure got role/tabIndex but this desktop cell was a bare span. */
  const attrs = s.id
    ? ` class="skin spv-open" data-spi="${spi}" title="Inspect skin" role="button" tabindex="0" aria-label="Inspect ${CF.esc(label)}"`
    : ' class="skin"';
  /* CF-33: lazy icons — the desktop cells were the only renderer without it */
  return `<span${attrs}><img src="${CF.esc(src)}" alt="${CF.esc(label)}" title="${CF.esc(label)}" loading="lazy">${s.level >= 2 ? `<i class="lv">LV${s.level}</i>` : ''}</span>`;
}

function openCardsModal() {
  const m = document.getElementById('cardsModal');
  if (!m) return;
  m.hidden = false;
  m.querySelector('.spv-close')?.focus();
}
function closeCardsModal() {
  const m = document.getElementById('cardsModal');
  if (m) m.hidden = true;
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
      ? skins.map(s => {
          if (!s.id) return skinCell(s);
          SPV_LIST.push(s);
          return skinCell(s, SPV_LIST.length - 1);
        }).join('')
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

  const p = payload;
  /* CF-26: every image was labelled with the literal string 'Player card',
     so the collection had no accessible names. Numbered labels until the
     names ship with the payload. */
  const owned = (p.ownedCards || []).map((u, i) => ({ icon: `https://media.valorant-api.com/playercards/${u}/wideart.png`, name: `Player card ${i + 1} of ${p.ownedCards.length}` }));
  const grid = document.querySelector('#cardsGrid');
  const hint = document.querySelector('#cardsHint');
  const mcard = document.querySelector('#mcard');
  const showHint = !!(p.showAllCards && owned.length);
  if (hint) {
    hint.hidden = !showHint;
    if (showHint) {
      hint.textContent = `View all ${owned.length} player card${owned.length === 1 ? '' : 's'}`;
      const mcardShown = () => !!mcard && mcard.getBoundingClientRect().width > 0;
      const placeHint = () => {
        const live = [...document.querySelectorAll('.pcard')].find((el) => el.getBoundingClientRect().width > 0);
        if (live) {
          // overlay the player card by living inside its box — no coordinate
          // math, so every zoom level and layout mode stays correct
          const box = live;
          if (hint.parentElement !== box) box.appendChild(hint);
          hint.dataset.where = 'desktop';
          hint.classList.remove('is-inline');
          hint.classList.add('in-box');
          hint.style.left = '';
          hint.style.top = '';
        } else if (mcardShown()) {
          // #stage is display:none on mobile, so the button must move out of it. It must be a
          // SIBLING of #mcard, never a child: renderMobile() runs straight after this function
          // and does mcard.innerHTML = MOBILE_SKELETON, which would destroy a child.
          if (hint.dataset.where !== 'mobile') {
            hint.classList.add('is-inline');
            hint.classList.remove('in-box');
            hint.style.left = '';
            hint.style.top = '';
            mcard.insertAdjacentElement('afterend', hint);
            hint.dataset.where = 'mobile';
          }
        } else if (hint.dataset.where !== 'inline') {
          // a card layout with no player card is active (e.g. the M4 spread). there is nothing
          // to sit on, so stop floating on stale absolute coordinates and flow inline instead.
          hint.dataset.where = 'inline';
          hint.classList.add('is-inline');
          hint.classList.remove('in-box');
          hint.style.left = '';
          hint.style.top = '';
        }
      };
      placeHint();
      // the card layout is applied AFTER this function returns, so the player card can appear or
      // vanish underneath us. Re-check once it has settled. Both guards above are idempotent.
      requestAnimationFrame(placeHint);
      setTimeout(placeHint, 350);
      if (!hint.dataset.wired) {
        hint.dataset.wired = '1';
        hint.addEventListener('click', openCardsModal);
      }
    }
  }
  if (grid) {
    grid.innerHTML = showHint
      ? owned.map((c) => `<img loading="lazy" src="${CF.esc(c.icon)}" alt="${CF.esc(c.name || 'Player card')}" title="${CF.esc(c.name || '')}">`).join('')
      : '';
  }
  const cmTitle = document.getElementById('cardsModalTitle');
  const cmSub = document.getElementById('cardsModalSub');
  if (cmTitle) cmTitle.textContent = `Player cards (${owned.length})`;
  if (cmSub) cmSub.textContent = showHint ? 'Full collection published by the seller' : '';
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
    <div class="mstat"><label>ANIMATED</label><b data-m="anims">00</b></div>
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

function renderMobile(listing, force) {
  if (!mcard) return;
  /* CF-33: the mobile layout used to render unconditionally into a
     display:none container on every desktop visit — a full second set of
     skin icon downloads nobody ever saw. Render on first need instead. */
  if (!force && window.getComputedStyle(mcard).display === 'none') return;
  mcard.dataset.filled = '1';
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
    g.className = 'spread-mosaic';
    skins.forEach(s => {
      const cell = document.createElement('figure');
      if (s.id) {
        SPV_LIST.push(s);
        cell.className = 'mskin spv-open';
        cell.dataset.spi = String(SPV_LIST.length - 1);
        cell.title = 'Inspect skin';
        cell.setAttribute('role', 'button');
        cell.tabIndex = 0;
      } else {
        cell.className = 'mskin';
      }
      const img = document.createElement('img');
      img.src = s.icon || s.img || '';
      img.alt = `${s.weapon || ''} — ${s.name || ''}`;
      img.loading = 'lazy';
      const cap = document.createElement('figcaption');
      cap.textContent = [s.weapon, s.name].filter(Boolean).join(' — ') + (s.level >= 2 ? ` · L${s.level}` : '');
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

// ── buyer view switcher + catalog paging ──────────────────────────
/* CF-26: applyLayout renders the panel cells, so the inspect affordance is
   attached here — right after the layout pass, on the live DOM. Cells are
   real buttons now: focusable, labelled, Enter/Space opens the preview
   (the keydown handler already existed; the cells were never focusable). */
function markInspectCells(payload) {
  SPV_LIST.length = 0;
  const picks = payload.picks || {};
  card.querySelectorAll('.panel[data-cat]').forEach(panel => {
    const cat = panel.dataset.cat;
    const skins = picks[cat] || [];
    panel.querySelectorAll('.skin[data-vp]').forEach(cell => {
      const s = skins[+cell.dataset.vp];
      if (!s || !s.id) return;
      SPV_LIST.push(s);
      const spi = SPV_LIST.length - 1;
      cell.classList.add('spv-open');
      cell.dataset.spi = String(spi);
      cell.setAttribute('role', 'button');
      cell.setAttribute('tabindex', '0');
      const label = (s.weapon ? s.weapon + ' — ' : '') + (s.name || '');
      cell.setAttribute('aria-label', 'Inspect ' + label);
      cell.title = 'Inspect ' + label;
    });
  });
}

function viewRefresh(listing) {
  const payload = listing.payload || {};
  const auto = resolveLayout(payload);
  const mode = viewMode || auto;
  applyLayout(CF.$('card'), payload, mode, 1, { editable: false, showAll: true });
  markInspectCells(payload);
  document.querySelectorAll('#viewSwitch button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === mode)));
  fit();
  if (zoomMode == null) {
    CF.$('zoomNote').textContent = CF.$('stage').scrollHeight > CF.$('stage').clientHeight
      ? 'fit width — scroll to explore' : 'fit width';
  }
}

function syncUrl() {
  const u = new URL(location.href);
  if (viewMode) u.searchParams.set('view', viewMode);
  else u.searchParams.delete('view');
  window.history.replaceState(null, '', u);
}

CF.$('viewSwitch')?.addEventListener('click', e => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  /* CF-14: SIMPLE returns to the native mobile layout */
  if (btn.dataset.view === 'native') {
    viewMode = null;
    document.body.classList.remove('canvas-mode');
    CF.$('nativeBtn').hidden = true;
    renderMobile(currentListing, true); /* CF-33: fill the native layout on demand */
    viewRefresh(currentListing);
    syncUrl();
    fit();
    return;
  }
  viewMode = btn.dataset.view;
  /* CF-14: on a phone, picking a card view swaps the native layout for
     the zoomable canvas — the switch no longer disappears below 700px */
  if (innerWidth <= 700) {
    document.body.classList.add('canvas-mode');
    CF.$('nativeBtn').hidden = false;
  }
  viewRefresh(currentListing);
  syncUrl();
  fit();
});

// ── skin inspect overlay (preview-only; never mutates picks/listing) ──
function paintSpv() {
  if (!spv) return;
  const pick = spv.skin;
  const chromas = spv.chromas || [];
  const levels = spv.levels || [];
  const failed = !chromas.length && !levels.length;
  const fallbackIcon = pick.icon || pick.img || '';

  if (failed) {
    CF.$('spvLevels').innerHTML = '<button class="spv-chip" type="button" disabled>Level —</button>';
    CF.$('spvChromas').innerHTML = '<button class="spv-swatch" type="button" disabled>Variant —</button>';
  } else {
    CF.$('spvLevels').innerHTML = levels.length > 1
      ? levels.map((l, i) => `<button class="spv-chip${spv.lv === i + 1 ? ' active' : ''}" type="button" data-lv="${i + 1}">L${i + 1}</button>`).join('')
      : '<span class="spv-cap">Base skin</span>';
    CF.$('spvChromas').innerHTML = chromas.map((c, i) =>
      `<button class="spv-swatch${spv.k === i ? ' active' : ''}" type="button" data-ch="${i}" title="${CF.esc(c.label)}"><img loading="lazy" src="${CF.esc(c.sw || c.icon)}" alt=""><b>${CF.esc(c.label)}</b></button>`).join('');
  }

  const c = chromas[spv.k];
  const ld = levels[spv.lv - 1] || {};
  const cv = spv.k > 0 && c && c.video;
  const muteBtn = `<button class="spv-mute" type="button" data-spv-mute aria-pressed="${spvMuted}" aria-label="${spvMuted ? 'Unmute preview' : 'Mute preview'}">${spvMuted ? '🔇' : '🔊'}</button>`;

  let levelHtml;
  if (cv) {
    levelHtml = `<video src="${CF.esc(cv)}" loop autoplay playsinline></video><span class="spv-cap">${CF.esc(`${c.label} showcase · L${spv.lv}`)}</span>${muteBtn}`;
  } else if (ld.video) {
    const cap = spv.k > 0 ? `Level ${spv.lv} animation · default colorway footage` : `Level ${spv.lv} animation`;
    levelHtml = `<video src="${CF.esc(ld.video)}" loop autoplay playsinline></video><span class="spv-cap">${CF.esc(cap)}</span>${muteBtn}`;
  } else {
    levelHtml = '<p class="spv-note">No preview footage for this skin.</p>';
  }
  CF.$('spvLevel').innerHTML = levelHtml;

  CF.$('spvChroma').innerHTML = failed
    ? `<img src="${CF.esc(fallbackIcon)}" alt=""><span class="spv-cap">Preview unavailable — showing card art.</span>`
    : (c
      ? `<img src="${CF.esc(c.full || c.icon || fallbackIcon)}" alt="${CF.esc(c.label || '')}"><span class="spv-cap">${CF.esc(c.label || 'Standard')}</span>`
      : `<img src="${CF.esc(fallbackIcon)}" alt=""><span class="spv-cap">Standard</span>`);
  const vv = CF.$('spvLevel').querySelector('video'); if (vv) vv.play().then(() => {}).catch(() => { vv.muted = true; spvMuted = true; const mb = CF.$('spvLevel').querySelector('[data-spv-mute]'); if (mb) { mb.textContent = '🔇'; mb.setAttribute('aria-pressed', 'false'); mb.setAttribute('aria-label', 'Unmute preview'); } });
}

function openSpv(cell) {
  const pick = SPV_LIST[+cell.dataset.spi];
  const overlay = CF.$('skinPrev');
  if (!pick || !overlay) return;
  spvFocus = cell;
  spv = { skin: pick, chromas: [], levels: [], lv: pick.level || 1, k: 0 };
  CF.$('spvTitle').textContent = pick.name || 'Skin';
  CF.$('spvSub').textContent = [pick.weapon, pick.tier, pick.variant ? pick.variant.name : 'Standard'].filter(Boolean).join(' · ');
  CF.$('spvLevels').innerHTML = '';
  CF.$('spvChromas').innerHTML = '';
  CF.$('spvLevel').innerHTML = '<div class="spv-shimmer"></div>';
  CF.$('spvChroma').innerHTML = '<div class="spv-shimmer"></div>';
  overlay.hidden = false;
  document.body.classList.add('spv-lock');
  overlay.querySelector('.spv-close')?.focus();
  fetch('https://valorant-api.com/v1/weapons/skins/' + encodeURIComponent(pick.id))
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      const d = j && j.data;
      if (!d) throw new Error('no data');
      spv.chromas = (d.chromas || []).map(c => {
        const label = CF.chromaLabel(pick.name, c.displayName);
        const m = String(c.displayName || '').match(/Level\s+(\d+)/);
        return { label, icon: c.displayIcon || '', full: c.fullRender || '', video: c.streamedVideo || '', sw: c.swatch || '', unlock: m ? +m[1] : null };
      });
      spv.levels = (d.levels || []).map((l, i) => ({ level: i + 1, video: l.streamedVideo || '' }));
      spv.k = pick.variant ? spv.chromas.findIndex(c => c.icon === pick.variant.icon) : 0;
      spv.lv = pick.level || 1;
      paintSpv();
    })
    .catch(() => {
      if (!spv) return;
      spv.chromas = [];
      spv.levels = [];
      paintSpv();
    });
}

function closeSpv() {
  const overlay = CF.$('skinPrev');
  if (!overlay) return;
  overlay.hidden = true;
  document.body.classList.remove('spv-lock');
  const cell = spvFocus;
  spv = null;
  spvFocus = null;
  if (cell && cell.isConnected) cell.focus();
}

document.addEventListener('click', e => {
  const open = e.target.closest('.spv-open');
  if (open) { openSpv(open); return; }
  const overlay = CF.$('skinPrev');
  if (!overlay || overlay.hidden) return;
  if (e.target === overlay || e.target.closest('.spv-close')) { closeSpv(); return; }
  const lvBtn = e.target.closest('[data-lv]');
  if (lvBtn && spv) { spv.lv = +lvBtn.dataset.lv; paintSpv(); return; }  const chBtn = e.target.closest('[data-ch]');
  if (chBtn && spv) { spv.k = +chBtn.dataset.ch; paintSpv(); }
});
const cardsModalEl = document.getElementById('cardsModal');
if (cardsModalEl) {
  cardsModalEl.querySelector('.spv-close')?.addEventListener('click', closeCardsModal);
  cardsModalEl.addEventListener('click', (e) => { if (e.target === cardsModalEl) closeCardsModal(); });
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const cme = document.getElementById('cardsModal');
    if (cme && !cme.hidden) { closeCardsModal(); return; }
    if (spv) { closeSpv(); return; }
  }
  const open = e.target.closest ? e.target.closest('.spv-open') : null;
  if ((e.key === 'Enter' || e.key === ' ') && open) { e.preventDefault(); openSpv(open); }
});
CF.$('spvLevel')?.addEventListener('click', e => {
  const mute = e.target.closest('[data-spv-mute]');
  if (mute && spv) {
    spvMuted = !spvMuted;
    const vid = CF.$('spvLevel').querySelector('video');
    if (vid) vid.muted = spvMuted;
    mute.textContent = spvMuted ? '🔇' : '🔊';
    mute.setAttribute('aria-pressed', String(spvMuted));
    mute.setAttribute('aria-label', spvMuted ? 'Unmute preview' : 'Mute preview');
    return;
  }
});

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
/* CF-15 (option A): null = fit to viewport; a number = pinned manual zoom */
let zoomMode = null;
const fit = CF.makeFitter({ card, sizer: CF.$('sizer'), topbar: CF.$('vchrome'), stage: CF.$('stage'),
  getZoom: () => zoomMode != null ? zoomMode
    : (card.classList.contains('is-live') ? Math.min((CF.$('stage').clientWidth - 2) / 1920, 1) : null) });
fit();
card.classList.add('is-live'); /* live surface: categories scroll instead of clipping */
CF.initDisclaimerCollapse();
CF.initStatusDismiss();

/* ── CF-11/CF-12: listing hero — structured price, seller, status ── */
const CUR_SYMBOL = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
function moneyText(price, currency) {
  if (price == null || isNaN(Number(price))) return null;
  const n = Number(price);
  const sym = CUR_SYMBOL[currency] || (currency ? currency + ' ' : '$');
  return { sym, amt: n % 1 ? n.toFixed(2) : n.toLocaleString(), code: currency || '' };
}
function applyHero(listing) {
  const t = listing.payload?.texts || {};
  const hero = CF.$('vhero');
  const title = (t.cname && t.cname !== 'CHANGE NAME' && t.cname.trim()) || t.vlogin || 'Listing ' + (listing.slug || '');
  CF.$('vhTitle').textContent = title;
  document.title = title + (listing.price != null ? ' · ' + (moneyText(listing.price, listing.currency)?.sym || '') + listing.price : '') + ' — CardForge';
  const bits = [];
  if (t.code) bits.push(t.code);
  if (t.crank) bits.push(t.crank);
  const skins = (listing.payload?.picks ? Object.values(listing.payload.picks).reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0) : null);
  if (skins != null) bits.push(skins + ' skins');
  CF.$('vhSub').textContent = bits.join(' · ') || '—';

  const m = moneyText(listing.price, listing.currency);
  const st = listing.status || 'available';
  const stCfg = st === 'sold' ? { txt: 'SOLD', cls: 'bad' }
    : st === 'pending' ? { txt: 'PENDING', cls: 'warn' }
    : { txt: 'AVAILABLE', cls: 'ok' };
  const vs = CF.$('vhStatus');
  vs.hidden = false;
  vs.textContent = stCfg.txt;
  vs.className = 'vh-status ' + stCfg.cls;
  hero.classList.toggle('sold', st === 'sold');

  /* price lives only in the pinned mobile bar now — the hero shows
     status + contact and nothing else */
  let priceHTML = '', curText = '';
  const strike = st === 'sold' && m;
  if (m) {
    priceHTML = (strike ? '<s>' : '') + m.sym + m.amt + (strike ? '</s>' : '');
    curText = [m.code, listing.negotiable ? 'open to offers' : '', st === 'sold' ? 'sold' : '']
      .filter(Boolean).join(' · ');
  } else {
    priceHTML = 'CONTACT FOR PRICE';
    curText = listing.negotiable ? 'open to offers' : '';
  }
  CF.$('maPrice').innerHTML = priceHTML;
  CF.$('maCur').textContent = curText;
  CF.$('mactbar').hidden = false;
  return st;
}
/* CF-13: Contact always renders. A valid URL opens; anything else is
   copyable text; only a truly empty field disables the button. */
function wireContact(link) {
  const btn = CF.$('contactBtn');
  const mob = CF.$('maContact');
  const v = (link || '').trim();
  const valid = /^https?:\/\//.test(v);
  const nonEmpty = v.length > 0;
  [btn, mob].forEach(b => {
    if (!b) return;
    b.hidden = false;
    b.disabled = !valid && !nonEmpty;
    b.textContent = valid ? 'Contact seller' : (nonEmpty ? 'Copy seller contact' : 'Seller set no contact');
    b.title = valid ? 'Opens the seller\u2019s contact page in a new tab'
      : nonEmpty ? 'The seller\u2019s contact is not a link — copy it and reach out yourself'
      : 'This listing has no contact set';
  });
  const act = () => {
    if (valid) { window.open(v, '_blank', 'noopener'); return; }
    if (nonEmpty) { CF.copyText(v); CF.status('Seller contact copied — ' + v, 'ok'); return; }
    CF.status('This listing has no contact information.', 'err');
  };
  btn?.addEventListener('click', act);
  mob?.addEventListener('click', act);
}

/* CF-15 successor: a slim dock in the footer band — dedicated space,
   never over the canvas; collapses to a tab like the disclaimer does */
const zoomDock = CF.$('zoomDock'), zoomDockBar = CF.$('zoomDockBar'), zoomDockToggle = CF.$('zoomDockToggle');
function setDockCollapsed(collapsed) {
  zoomDock.classList.toggle('collapsed', collapsed);
  zoomDockToggle.setAttribute('aria-expanded', String(!collapsed));
  const active = zoomDockBar.querySelector('button[aria-pressed="true"]');
  zoomDockToggle.textContent = collapsed ? (active ? active.textContent + ' »' : '»') : '«';
  zoomDockToggle.title = collapsed ? 'Expand zoom controls' : 'Collapse zoom controls';
  document.body.classList.toggle('zdock-collapsed', collapsed);
  try { localStorage.setItem('vc-zoomdock-collapsed', collapsed ? '1' : '0'); } catch { /* private mode */ }
}
zoomDockToggle.addEventListener('click', () => setDockCollapsed(!zoomDock.classList.contains('collapsed')));
zoomDockBar.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  const z = b.dataset.zoom;
  zoomMode = z === 'fit' ? null : Number(z);
  zoomDockBar.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  CF.$('zoomNote').textContent = zoomMode == null
    ? (CF.$('stage').scrollHeight > CF.$('stage').clientHeight ? 'fit width — scroll to explore' : 'fit width')
    : ('viewing at ' + Math.round(zoomMode * 100) + '% — drag to pan');
  if (zoomDock.classList.contains('collapsed')) setDockCollapsed(true); /* refresh tab label */
  fit();
}));
setDockCollapsed(localStorage.getItem('vc-zoomdock-collapsed') === '1');

/* CF-33: fill the native layout the moment it actually becomes visible —
   a desktop visit no longer downloads the second set of icons */
addEventListener('resize', () => {
  if (!currentListing || !mcard) return;
  if (mcard.dataset.filled) return;
  if (window.getComputedStyle(mcard).display !== 'none') renderMobile(currentListing, true);
});

/* CF-14: the SIMPLE chip is shown/hidden by the viewSwitch handler above */

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

  if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
    try {
      listing = await restFetchListing(slug);
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
    /* the card markup ships with placeholder values (K486, ranks, price).
       Clear them so a dead link never shows a fake card. */
    document.querySelectorAll('[data-key]').forEach(el => { el.textContent = '—'; });
    document.querySelectorAll('[data-m]').forEach(el => { el.textContent = '—'; });
    document.querySelectorAll('#card img').forEach(img => { img.remove(); });
    CF.$('viewBadge').hidden = true;
    CF.$('contactBtn').hidden = true;
  } else {
    renderListing(listing);
    renderMobile(listing);
    currentListing = listing;
    viewMode = new URLSearchParams(location.search).get('view');
    if (viewMode && !['m1', 'm2', 'm3', 'native'].includes(viewMode)) viewMode = null;
    viewRefresh(listing);
    totalViews = Number(listing.views) || 0;
    /* CF-11/CF-12: structured price, seller, status — from columns the
       fetch already returned and used to discard */
    applyHero(listing);
    wireContact(listing.payload?.texts?.link);
    CF.status('Listing loaded.', 'ok');

    /* contact wiring is in wireContact() — the button always renders now */

    if (localStorage.getItem('vc-edit-' + slug)) {
      const editBtn = CF.$('editBtn');
      editBtn.hidden = false;
      editBtn.addEventListener('click', () => {
        location.href = 'index.html?edit=' + encodeURIComponent(slug);
      });
    }

    CF.$('copyLinkBtn').addEventListener('click', () => CF.copyText(location.href));

    fit();
    /* CF-25: the SDK loads now — after first render — because only presence
       needs it. Listing read and view bump are plain REST above. */
    if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
      const sb = await loadSupabase();
      if (sb) {
        startSupabasePresence(slug);
        /* CF-22: the seller's own loads are not "views" — skip the bump when
           this browser holds the edit token for the listing */
        const isOwner = !!localStorage.getItem('vc-edit-' + slug);
        if (!isOwner) {
          try {
            const v = await restBumpViews(slug);
            if (v != null) totalViews = Number(v);
          } catch { /* view count is best-effort */ }
        }
        updateBadge(1);
      } else {
        CF.startLocalPresence(slug, updateBadge);
        updateBadge(1);
      }
    } else {
      CF.startLocalPresence(slug, updateBadge);
      updateBadge(1);
    }
  }
}
