// CardForge viewer — renders a published listing from Supabase (public share
// links) or, as a fallback, from this browser's localStorage.
import * as CF from './shared.js?v=1.6.0';
import { applyLayout, resolveLayout } from './layouts.js';

const CONFIG = window.CARDFORGE_CONFIG || {};
let supabase = null;
let sbLoading = null;
let isSeller = false;

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
  const full = `${nowViewing} viewing now • ${totalViews} total views`;
  /* M-C2: phones get a compact badge; the full sentence stays on hover */
  CF.$('viewText').textContent = innerWidth <= 700 ? `${nowViewing} • ${totalViews}` : full;
  badge.title = full;
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
  const showHint = !!(p.showAllCards && owned.length);
  if (hint) {
    hint.hidden = !showHint;
    if (showHint) {
      hint.textContent = `View all ${owned.length} player card${owned.length === 1 ? '' : 's'}`;
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
<section class="mhead2">
  <div class="mhrow mhrow1">
    <span class="mhcode" data-m="code">K486</span>
    <span class="mhid"><b data-m="cname">CHANGE NAME</b><span data-m="vlogin">RIOT ID</span></span>
    <span class="mstatus"></span>
  </div>
  <div class="mhrow mhrow2">
    <span class="mhrank"><img class="mrankbadge" data-mrank="crank" alt=""><span class="mrl"><label>CURRENT</label><b data-m="crank">DIAMOND 2</b></span></span>
    <span class="mhrank"><img class="mrankbadge" data-mrank="prank" alt=""><span class="mrl"><label>PEAK</label><b data-m="prank">IMMORTAL 3</b></span></span>
    <span class="mhlvl">LVL<b data-m="level">376</b></span>
  </div>
  <div class="mhrow mhrow3">
    <span class="mhstat"><label>PREMIUM</label><b data-m="prems">42</b></span>
    <span class="mhstat mlimited"><label>LIMITED</label><b data-m="limited">02</b></span>
    <span class="mhstat"><label>SEMI PREM</label><b data-m="semis">00</b></span>
    <span class="mhstat"><label>BATTLEPASS</label><b data-m="bpass">00</b></span>
  </div>
  <div class="mhrow mhrow4">
    <span class="mhcur2"><i>V</i><b data-m="vp">420</b></span>
    <span class="mhcur2"><i>R</i><b data-m="rp">140</b></span>
    <span class="mhcur2"><i>K</i><b data-m="kc">6422</b></span>
    <span data-m="wtr">WTR: YES</span>
    <span data-m="receipts">RECEIPTS: YES</span>
    <span data-m="owner">0TH OWNER</span>
    <span data-m="cname">CHANGE NAME</span>
    <span class="mwarn" data-m="cstatus">NOT READY</span>
    <span data-m="date">2/6/2026</span>
    <span data-m="premier">PREMIER</span>
    <span class="mwarn" data-m="vlink">UNLINKED</span>
  </div>
</section>
<nav class="mcats" aria-label="Categories"></nav>
<div class="mpanels"></div>`;

/* Plan 001: hybrid mobile layout — tabbed frame above the threshold,
   dense mosaic below (single consumer, stays a module const). */
const TAB_THRESHOLD = 24;

function mobileCaption(s) {
  /* one-line de-duplicated name — the weapon is the category context */
  let n = s.name || s.weapon || 'Skin';
  if (s.variant && s.variant.name && !n.includes(s.variant.name)) n += ' · ' + s.variant.name;
  return n;
}
function mobileTierKey(t) {
  /* payload carries display names ("Premium Edition") — normalize to the
     token key used by --tier-* */
  return (String(t || '').toLowerCase().match(/exclusive|ultra|premium|deluxe|select/) || [''])[0];
}
/* Plan 001: chip → panel activation. Resets the frame's internal scroll. */
function activateCat(cat) {
  const panels = mcard.querySelector('.mpanels');
  if (!panels) return;
  panels.querySelectorAll('.mpanel').forEach(pn => pn.classList.toggle('active', pn.dataset.cat === cat));
  mcard.querySelectorAll('.mcat-chip').forEach(ch => {
    const on = ch.dataset.goto === cat;
    ch.setAttribute('aria-current', String(on));
    if (on) ch.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  });
  panels.scrollTop = 0;
}
/* Plan 001: one delegated chip listener — panels are rebuilt on re-render */
mcard?.addEventListener('click', e => {
  const chip = e.target.closest ? e.target.closest('.mcat-chip') : null;
  if (chip) activateCat(chip.dataset.goto);
  /* M-H: native Info-panel cards button */
  const cb = e.target.closest('.mcards-btn');
  if (cb) { openCardsModal(); return; }
});

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

  const picks = payload.picks || {};
  const cats = CF.ALL_CATS.filter(c => (picks[c] || []).length);
  const total = Object.values(picks).reduce((n, a) => n + a.length, 0);
  const tabs = total > TAB_THRESHOLD;
  mcard.classList.toggle('mode-tabs', tabs);
  mcard.classList.toggle('mode-flow', !tabs);

  /* Plan 001: mobile inspect indices must match markInspectCells' fill
     order — flat picks[cat] over ALL_CATS, id-only. Never push SPV_LIST. */
  let spvI = 0;
  let panelHTML = '';
  if (!cats.length) {
    panelHTML += '<section class="mpanel" data-cat=""><div class="mempty">No skins in this listing.</div></section>';
  }
  cats.forEach(cat => {
    const skins = picks[cat] || [];
    const tiles = skins.map(s => {
      const tier = mobileTierKey(s.tier);
      const lv = s.level >= 2 ? `<i class="mlv">LV${s.level}</i>` : '';
      const img = `<img loading="lazy" src="${CF.esc(s.icon || s.img || '')}" alt="${CF.esc(`${s.weapon || ''} — ${s.name || ''}`)}">`;
      const cap = `<figcaption>${CF.esc(mobileCaption(s))}</figcaption>`;
      if (!s.id) return `<figure class="mtile" data-tier="${CF.esc(tier)}">${lv}${img}${cap}</figure>`;
      const label = 'Inspect ' + (s.weapon ? s.weapon + ' — ' : '') + (s.name || '');
      return `<figure class="mtile spv-open" data-tier="${CF.esc(tier)}" data-spi="${spvI++}" role="button" tabindex="0" title="${CF.esc(label)}" aria-label="${CF.esc(label)}">${lv}${img}${cap}</figure>`;
    }).join('');
    panelHTML += `<section class="mpanel" data-cat="${CF.esc(cat)}"><h3>${CF.esc(cat)}<span class="hn">${skins.length}</span></h3><div class="mgrid3">${tiles}</div></section>`;
  });

  const assets = payload.assets || {};
  const buddies = (assets.buddies || []).filter(Boolean);
  const owned = payload.ownedCards || [];
  const buddyHTML = buddies.length
    ? `<div class="mbuddygrid">${buddies.map(u => `<img loading="lazy" src="${CF.esc(u)}" alt="Gun buddy">`).join('')}</div>`
    : '';
  const infoSub = [buddies.length ? buddies.length + ' buddies' : '', owned.length ? owned.length + ' cards' : ''].filter(Boolean).join(' · ') || 'seller';
  /* M-H: native cards button — replaces the mobile DOM-teleport of #cardsHint */
  const cardsBtnHTML = (payload.showAllCards && owned.length)
    ? `<button type="button" class="mcards-btn">View all ${owned.length} player card${owned.length === 1 ? '' : 's'}</button>`
    : '';
  panelHTML += `<section class="mpanel" data-cat="Info">
    <h3>Info<span class="hn">${CF.esc(infoSub)}</span></h3>
    ${buddyHTML}
    <div class="mpcardwrap"><img class="mpcard" alt="Player card" hidden>${cardsBtnHTML}</div>
    <div class="mseller"><div class="msellerrow">
      <img class="mavatar" alt="Seller avatar">
      <div class="msellertext"><span class="mtag" data-m="tag">FS/FT+ADD</span><a class="mlink" data-m="link" rel="noopener">https://www.facebook.com/Your.Page.Here</a></div>
    </div></div>
    <div class="mstrip"><span>Card Forge</span><span data-mwm="slug">Listing</span><span data-mwm="stamp"></span></div>
  </section>`;
  mcard.querySelector('.mpanels').innerHTML = panelHTML;

  mcard.querySelectorAll('[data-m]').forEach(el => {
    const v = texts[el.dataset.m];
    if (v != null && v !== '') el.textContent = v;
  });

  /* M-T: head title fallback (mirrors applyHero) */
  const mtitle = mcard.querySelector('.mhead2 .mhid b[data-m="cname"]');
  if (mtitle) mtitle.textContent = (texts.code && texts.code.trim()) || (texts.cname && !CF.isPlaceholderTitle(texts.cname) && texts.cname.trim()) || ('Listing ' + (listing.slug || slug));
  const msub = mcard.querySelector('.mhead2 .mhid span[data-m="vlogin"]');
  const mvl = (texts.vlogin && texts.vlogin !== 'RIOT ID') ? texts.vlogin : '';
  const mriot = mvl ? (mvl.includes('#') || !texts.tag ? mvl : mvl + '#' + texts.tag) : (texts.tag || '');
  const mident = mriot || ((texts.cname && !CF.isPlaceholderTitle(texts.cname) && texts.cname.trim()) || '');
  if (msub) msub.textContent = [mident, total + ' skin' + (total === 1 ? '' : 's')].filter(Boolean).join(' · ');

  const ranks = payload.ranks || {};
  ['crank', 'prank'].forEach(key => {
    const badge = mcard.querySelector(`.mrankbadge[data-mrank="${key}"]`);
    if (ranks[key]) badge.src = ranks[key];
    else badge.removeAttribute('src');
  });

  const st = listing.status || 'available';
  const stCfg = listing.archived ? { txt: 'ARCHIVED', cls: 'bad' }
    : st === 'sold' ? { txt: 'SOLD', cls: 'bad' }
    : st === 'pending' ? { txt: 'PENDING', cls: 'warn' }
    : { txt: 'AVAILABLE', cls: 'ok' };
  const stEl = mcard.querySelector('.mstatus');
  stEl.textContent = stCfg.txt;
  stEl.className = 'mstatus ' + stCfg.cls;

  mcard.querySelector('.mavatar').src = assets.avatar || AVATAR_PLACEHOLDER;
  if (assets.pcard) {
    const pc = mcard.querySelector('.mpcard');
    pc.src = assets.pcard;
    pc.hidden = false;
  }

  const linkEl = mcard.querySelector('.mlink');
  const link = (texts.link || '').trim();
  if (/^https?:\/\//.test(link)) linkEl.href = link;

  const wmSlug = mcard.querySelector('[data-mwm="slug"]');
  if (wmSlug && slug) wmSlug.textContent = 'Listing ' + slug;
  const wmStamp = mcard.querySelector('[data-mwm="stamp"]');
  if (wmStamp) wmStamp.textContent = new Date().toISOString().slice(0, 10);

  const chipCats = cats.length ? cats.concat(['Info']) : ['Info'];
  mcard.querySelector('.mcats').innerHTML = chipCats.map(c => {
    const n = c === 'Info' ? '' : `<b>${(picks[c] || []).length}</b>`;
    const label = c === 'Sniper Rifles' ? 'Snipers' : c;
    return `<button type="button" class="mcat-chip" data-goto="${CF.esc(c)}" aria-current="false">${CF.esc(label)}${n}</button>`;
  }).join('');
  activateCat(cats[0] || 'Info');
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
  /* M-C2: the switcher is unreachable on phones — never paint stale pressed states */
  if (!document.body.classList.contains('phone-native')) {
    document.querySelectorAll('#viewSwitch button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === mode)));
  }
  fit();
  if (zoomMode == null) {
    CF.$('zoomNote').textContent = zoomNoteText();
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
  viewMode = btn.dataset.view;
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
    CF.$('spvLevels').innerHTML = '<span class="spv-chip" aria-disabled="true">Level —</span>';
    CF.$('spvChromas').innerHTML = '<span class="spv-swatch" aria-disabled="true">Variant —</span>';
  } else {
    /* viewer is read-only: show only what the listing actually contains */
    CF.$('spvLevels').innerHTML = levels.length
      ? `<span class="spv-chip active" aria-current="true">L${spv.lv}</span>`
      : '<span class="spv-cap">Base skin</span>';
    const c0 = chromas[spv.k];
    CF.$('spvChromas').innerHTML = c0
      ? `<span class="spv-swatch active" aria-current="true" title="${CF.esc(c0.label)}"><img loading="lazy" src="${CF.esc(c0.sw || c0.icon)}" alt=""><b>${CF.esc(c0.label)}</b></span>`
      : '<span class="spv-swatch active" aria-current="true"><b>Standard</b></span>';
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
/* Plan 001: the phone tabbed frame reserves room for the pinned action bar +
   disclaimer via --mobar (CSS falls back to 91px). Phone-only measurement. */
const mobarEls = [CF.$('mactbar'), CF.$('disclaimer')].filter(Boolean);
if (mobarEls.length && 'ResizeObserver' in window) {
  const phoneMq = window.matchMedia('(max-width:700px)');
  const measureMobar = () => {
    if (!phoneMq.matches) return;
    const h = mobarEls.reduce((n, el) => n + el.offsetHeight, 0);
    document.documentElement.style.setProperty('--mobar', h + 16 + 'px');
  };
  const mobarRo = new ResizeObserver(measureMobar);
  mobarEls.forEach(el => mobarRo.observe(el));
  measureMobar();
}
CF.initDisclaimerCollapse();
CF.initStatusDismiss();

/* ── CF-11/CF-12: listing hero — structured price, seller, status ── */
const CUR_SYMBOL = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', PHP: '₱' };
function moneyText(price, currency) {
  if (price == null || isNaN(Number(price))) return null;
  const n = Number(price);
  const sym = CUR_SYMBOL[currency] || (currency ? currency + ' ' : '$');
  return { sym, amt: n % 1 ? n.toFixed(2) : n.toLocaleString(), code: currency || '' };
}
function applyHero(listing) {
  const t = listing.payload?.texts || {};
  const hero = CF.$('vhero');
  const title = (t.code && t.code.trim()) || (t.cname && !CF.isPlaceholderTitle(t.cname) && t.cname.trim()) || 'Listing ' + (listing.slug || '');
  CF.$('vhTitle').textContent = title;
  document.title = title + (listing.price != null ? ' · ' + (moneyText(listing.price, listing.currency)?.sym || '') + listing.price : '');
  const bits = [];
  const vl = (t.vlogin && t.vlogin !== 'RIOT ID') ? t.vlogin : '';
  const riot = vl ? (vl.includes('#') || !t.tag ? vl : vl + '#' + t.tag) : (t.tag || '');
  const ident = riot || ((t.cname && !CF.isPlaceholderTitle(t.cname) && t.cname.trim()) || '');
  if (ident) bits.push(ident);
  if (t.crank) bits.push(t.crank);
  const skins = (listing.payload?.picks ? Object.values(listing.payload.picks).reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0) : null);
  if (skins != null) bits.push(skins + ' skins');
  CF.$('vhSub').textContent = bits.join(' · ') || '—';

  const m = moneyText(listing.price, listing.currency);
  const st = listing.status || 'available';
  const stCfg = listing.archived ? { txt: 'ARCHIVED', cls: 'bad' }
    : st === 'sold' ? { txt: 'SOLD', cls: 'bad' }
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

/* v1.3: buyer-facing link to the owner's Facebook group post. Renders when
   fb_post_url is a clean https URL — no owner session needed. */
function syncFbBtns(listing) {
  const u = String((listing && listing.fb_post_url) || '').trim();
  const ok = /^https?:\/\//i.test(u);
  [CF.$('fbPostBtn'), CF.$('maFb')].forEach(b => {
    if (!b) return;
    if (ok) {
      b.href = u;
      b.hidden = false;
      b.textContent = 'View Facebook post';
      b.classList.add('primary');
      b.classList.remove('accent');
    } else {
      b.hidden = true;
      b.removeAttribute('href');
      b.classList.remove('primary');
      b.classList.add('accent');
    }
  });
  [CF.$('contactBtn'), CF.$('maContact')].forEach(b => {
    if (!b) return;
    if (ok) {
      b.classList.remove('primary');
      b.classList.add('accent');
    } else {
      b.classList.add('primary');
      b.classList.remove('accent');
    }
  });
}

/* Owner-only lifecycle: archive (soft hide) + hard delete. Buttons exist in
   the DOM hidden; only this browser's edit token can un-hide and use them. */
function wireOwnerControls(sb, listing, slug) {
  const aBtn = CF.$('archiveBtn');
  const dBtn = CF.$('deleteBtn');
  const sBtn = CF.$('soldBtn'), fBtn = CF.$('featureBtn'), bmBtn = CF.$('bumpBtn'), pBtn = CF.$('priceBtn'), flBtn = CF.$('fbLinkBtn'), fcBtn = CF.$('fbCopyBtn');
  const pBox = CF.$('priceBox');
  const note = CF.$('archNote');
  const token = localStorage.getItem('vc-edit-' + slug) || '';
  const sync = () => {
    aBtn.hidden = false;
    dBtn.hidden = false;
    aBtn.textContent = listing.archived ? 'Unarchive' : 'Archive';
    note.hidden = !listing.archived;
    if (listing.archived) note.textContent = 'This listing is archived — hidden from the marketplace, still reachable by this link.';
    [sBtn, fBtn, bmBtn, pBtn, flBtn, fcBtn].forEach(b => { if (b) b.hidden = false; });
    if (sBtn) sBtn.textContent = listing.status === 'sold' ? 'Relist' : 'Mark sold';
    if (fBtn) { fBtn.textContent = listing.featured_at ? 'Unfeature' : 'Feature'; fBtn.classList.toggle('on', !!listing.featured_at); }
    if (flBtn) flBtn.textContent = listing.fb_post_url ? 'FB link \u2713' : 'FB link';
    syncMoreGroups();
  };
  const deny = e => /42501|token mismatch/i.test(String((e && e.message) || e))
    ? 'This browser’s edit key was rejected for that action.'
    : null;
  const own = async params => {
    const h = await CF.hashToken(token);
    const { error } = await sb.rpc('owner_set_listing', Object.assign({ p_slug: slug, p_edit_token_hash: h }, params));
    if (error) throw error;
  };
  const busy = async (btn, fn) => {
    btn.disabled = true;
    try { await fn(); } finally { btn.disabled = false; }
  };
  aBtn.addEventListener('click', async () => {
    const next = !listing.archived;
    if (!window.confirm(next
      ? 'Archive this listing? It disappears from the marketplace until you unarchive it.'
      : 'Unarchive this listing? It returns to the marketplace.')) return;
    aBtn.disabled = true;
    try {
      const h = await CF.hashToken(token);
      const { error } = await sb.rpc('set_listing_archived', { p_slug: slug, p_edit_token_hash: h, p_archived: next });
      if (error) throw error;
      listing.archived = next;
      applyHero(listing);
      sync();
      CF.status(next ? 'Listing archived — hidden from the marketplace.' : 'Listing unarchived — back in the marketplace.', 'ok');
    } catch (e) {
      CF.status(deny(e) || ('Archive failed: ' + ((e && e.message) || e)), 'err');
    } finally { aBtn.disabled = false; }
  });
  dBtn.addEventListener('click', async () => {
    if (prompt('Permanently delete this listing? This cannot be undone. Type DELETE to confirm.') !== 'DELETE') return;
    dBtn.disabled = true;
    try {
      const h = await CF.hashToken(token);
      const { error } = await sb.rpc('delete_listing', { p_slug: slug, p_edit_token_hash: h });
      if (error) throw error;
      /* v1.5.1: best-effort storage cleanup — delete_listing cannot touch it */
      try {
        await sb.storage.from('listing-images').remove(
          [slug + '.jpg', slug + '-thumb.jpg', slug + '-thumb.png', slug + '-thumb.webp']);
      } catch { /* best-effort cleanup */ }
      aBtn.hidden = true;
      dBtn.hidden = true;
      const eb = CF.$('editBtn'); if (eb) eb.hidden = true;
      const card = CF.$('card'); if (card) card.style.display = 'none';
      const hero = CF.$('vhero'); if (hero) hero.hidden = true;
      note.hidden = false;
      note.textContent = 'This listing has been deleted by its owner.';
      CF.status('Listing deleted.', 'ok');
    } catch (e) {
      CF.status(deny(e) || ('Delete failed: ' + ((e && e.message) || e)), 'err');
    } finally { dBtn.disabled = false; }
  });
  sBtn.addEventListener('click', async () => {
    const next = listing.status === 'sold' ? 'available' : 'sold';
    if (next === 'sold' && !window.confirm('Mark this listing SOLD? It leaves the marketplace immediately. You can relist anytime.')) return;
    try {
      await busy(sBtn, async () => {
        await own({ p_status: next });
        listing.status = next;
        listing.sold_at = next === 'sold' ? new Date().toISOString() : null;
        applyHero(listing);
        sync();
        CF.status(next === 'sold' ? 'Marked sold — removed from the marketplace.' : 'Relisted — back on the marketplace.', 'ok');
      });
    } catch (e) {
      CF.status(deny(e) || ('Status change failed: ' + ((e && e.message) || e)), 'err');
    }
  });
  fBtn.addEventListener('click', async () => {
    const on = !!listing.featured_at;
    try {
      await busy(fBtn, async () => {
        await own({ p_featured: !on });
        listing.featured_at = on ? null : new Date().toISOString();
        sync();
        CF.status(on ? 'Featured pin removed.' : 'Pinned as the featured listing on the marketplace.', 'ok');
      });
    } catch (e) {
      CF.status(deny(e) || ('Feature failed: ' + ((e && e.message) || e)), 'err');
    }
  });
  bmBtn.addEventListener('click', async () => {
    try {
      await busy(bmBtn, async () => {
        await own({});
        CF.status('Bumped to the top of Newest.', 'ok');
      });
    } catch (e) {
      CF.status(deny(e) || ('Bump failed: ' + ((e && e.message) || e)), 'err');
    }
  });
  if (pBox) {
    pBtn.addEventListener('click', () => {
      pBox.hidden = !pBox.hidden;
      if (!pBox.hidden) {
        CF.$('pbPrice').value = listing.price == null ? '' : String(Number(listing.price));
        CF.$('pbCurrency').value = listing.currency || 'PHP';
        CF.$('pbNego').checked = !!listing.negotiable;
      }
    });
    CF.$('pbCancel').addEventListener('click', () => { pBox.hidden = true; });
    CF.$('pbSave').addEventListener('click', async () => {
      const v = CF.$('pbPrice').value.trim();
      if (!v) { CF.status('Enter a price, or use Clear price.', 'err'); return; }
      const pbSaveEl = CF.$('pbSave');
      try {
        await busy(pbSaveEl, async () => {
          await own({ p_price: Number(v), p_currency: CF.$('pbCurrency').value, p_negotiable: CF.$('pbNego').checked });
          listing.price = Number(v);
          listing.currency = CF.$('pbCurrency').value;
          listing.negotiable = CF.$('pbNego').checked;
          applyHero(listing);
          pBox.hidden = true;
          CF.status('Price saved — the marketplace now shows it.', 'ok');
        });
      } catch (e) {
        CF.status(deny(e) || ('Price save failed: ' + ((e && e.message) || e)), 'err');
      }
    });
    CF.$('pbClear').addEventListener('click', async () => {
      const pbClearEl = CF.$('pbClear');
      try {
        await busy(pbClearEl, async () => {
          await own({ p_clear_price: true });
          listing.price = null;
          listing.currency = null;
          listing.negotiable = false;
          applyHero(listing);
          pBox.hidden = true;
          CF.status('Price cleared — buyers see CONTACT FOR PRICE.', 'ok');
        });
      } catch (e) {
        CF.status(deny(e) || ('Price clear failed: ' + ((e && e.message) || e)), 'err');
      }
    });
  }
  flBtn.addEventListener('click', async () => {
    const u = prompt('Paste the Facebook post URL (https://\u2026):', listing.fb_post_url || '');
    if (u === null) return;
    const t = u.trim();
    try {
      if (t === '') {
        await busy(flBtn, async () => {
          await own({ p_fb_post_url: '' });
          listing.fb_post_url = null;
          syncFbBtns(listing);
          sync();
          CF.status('FB post link removed.', 'ok');
        });
      } else if (!/^https:\/\//i.test(t)) {
        CF.status('URL must start with https://', 'err');
      } else {
        await busy(flBtn, async () => {
          await own({ p_fb_post_url: t });
          listing.fb_post_url = t;
          syncFbBtns(listing);
          sync();
          CF.status('FB post link saved — buyers now see a "See the Facebook post" button.', 'ok');
        });
      }
    } catch (e) {
      CF.status(deny(e) || ('FB link save failed: ' + ((e && e.message) || e)), 'err');
    }
  });
  fcBtn.addEventListener('click', () => {
    CF.copyText(CF.fbPostText(listing, location.href.split('#')[0]));
    CF.status('FB post text copied — paste it into your Facebook group.', 'ok');
  });
  sync();
}

/* CF-15 successor: a slim dock in the footer band — dedicated space,
   never over the canvas; collapses to a tab like the disclaimer does */
const zoomDock = CF.$('zoomDock'), zoomDockBar = CF.$('zoomDockBar'), zoomDockToggle = CF.$('zoomDockToggle');
/* ZL: label names the binding constraint, not a fixed string */
function zoomNoteText() {
  if (zoomMode != null) return `viewing at ${Math.round(zoomMode * 100)}% — drag to pan`;
  const st = CF.$('stage');
  if (st.clientWidth === 0 || st.clientHeight === 0) return 'fit width';
  const chrome = CF.$('vchrome');
  const tbh = chrome ? chrome.offsetHeight : 52;
  const wFit = (st.clientWidth - 2) / 1920;
  const hFit = (innerHeight - tbh - 34) / 1080;
  const natural = Math.min(wFit, hFit);
  if (natural < 0.35 + 1e-6) return 'min zoom — scroll to explore';
  if (st.scrollHeight > st.clientHeight + 1) return 'fit width — scroll to explore';
  if (wFit <= hFit) return 'fit width';
  return 'fit to screen';
}
function setDockCollapsed(collapsed) {
  zoomDock.classList.toggle('collapsed', collapsed);
  zoomDockToggle.setAttribute('aria-expanded', String(!collapsed));
  const active = zoomDockBar.querySelector('button[aria-pressed="true"]');
  zoomDockToggle.textContent = collapsed ? (active ? active.textContent : '»') : '«';
  zoomDockToggle.title = collapsed ? 'Expand zoom controls' : 'Collapse zoom controls';
  try { localStorage.setItem('vc-zoomdock-collapsed', collapsed ? '1' : '0'); } catch { /* private mode */ }
}
zoomDockToggle.addEventListener('click', () => setDockCollapsed(!zoomDock.classList.contains('collapsed')));
zoomDockBar.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  const z = b.dataset.zoom;
  zoomMode = z === 'fit' ? null : Number(z);
  zoomDockBar.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  CF.$('zoomNote').textContent = zoomNoteText();
  if (zoomDock.classList.contains('collapsed')) setDockCollapsed(true); /* refresh tab label */
  fit();
}));
setDockCollapsed(localStorage.getItem('vc-zoomdock-collapsed') === '1');

/* collapsible hero: collapsed keeps title + status + contact only */
const vhero = CF.$('vhero'), vheroToggle = CF.$('vheroToggle');
function setHeroCollapsed(collapsed) {
  vhero.classList.toggle('collapsed', collapsed);
  vheroToggle.setAttribute('aria-expanded', String(!collapsed));
  vheroToggle.textContent = collapsed ? '«' : '»';
  vheroToggle.title = collapsed ? 'Expand header' : 'Collapse header';
  try { localStorage.setItem('vc-hero-collapsed', collapsed ? '1' : '0'); } catch { /* private mode */ }
}
vheroToggle.addEventListener('click', () => setHeroCollapsed(!vhero.classList.contains('collapsed')));
setHeroCollapsed(localStorage.getItem('vc-hero-collapsed') === '1');

/* CF-33: fill the native layout the moment it actually becomes visible —
   a desktop visit no longer downloads the second set of icons */
addEventListener('resize', () => {
  if (!currentListing || !mcard) return;
  if (mcard.dataset.filled) return;
  if (window.getComputedStyle(mcard).display !== 'none') renderMobile(currentListing, true);
});

/* M-C2: one boundary listener — phone chrome and canvas modes are mutually
   exclusive. Leaving the phone range restores the URL's chosen canvas. */
const phoneNativeMq = window.matchMedia('(max-width:700px)');
phoneNativeMq.addEventListener('change', e => {
  if (!currentListing) return;
  if (e.matches) {
    document.body.classList.remove('canvas-mode');
    document.body.classList.add('phone-native');
    if (mcard && !mcard.dataset.filled) renderMobile(currentListing, true);
  } else {
    document.body.classList.remove('phone-native');
    let v = new URLSearchParams(location.search).get('view');
    if (v && !['m1', 'm2', 'm3', 'native'].includes(v)) v = null;
    viewMode = (!v || v === 'native') ? null : v;
    viewRefresh(currentListing);
    fit();
  }
});

/* Collapse menu groups whose items are all hidden, so a buyer never sees
   owner-only labels. viewSwitch is CSS-hidden on phones, so it only counts
   as group content above 700px. */
const phoneMoreMQ = window.matchMedia('(max-width:700px)');
function syncMoreGroups() {
  document.querySelectorAll('#tbMore .mm-group').forEach(g => {
    const any = [...g.children].some(el => {
      if (el.classList.contains('mm-label')) return false;
      if (el.id === 'viewSwitch') return !phoneMoreMQ.matches;
      return !el.hidden;
    });
    g.hidden = !any;
  });
}
phoneMoreMQ.addEventListener('change', syncMoreGroups);

/* M-C2: ⋯ overflow menu — CF-05 pattern (toggle, outside click, Escape) */
(function () {
  const btn = CF.$('tbMoreBtn'), menu = CF.$('tbMore');
  if (!btn || !menu) return;
  function setOpen(open) {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }
  btn.addEventListener('click', e => {
    e.stopPropagation();
    setOpen(menu.hidden);
  });
  document.addEventListener('click', e => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) setOpen(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !menu.hidden) setOpen(false);
  });
  menu.querySelectorAll('button, a').forEach(i => i.addEventListener('click', () => setOpen(false)));
  syncMoreGroups();
})();

/* Artwork mode: the owner's edited image replaces the interactive card.
   Session-only peek toggle; nothing is persisted from the viewer. */
function initArtMode(src) {
  const sizer = CF.$('sizer');
  if (!sizer || !sizer.parentNode) return;
  const mcard = CF.$('mcard');
  const vs = CF.$('viewSwitch');
  const img = document.createElement('img');
  img.id = 'artImg';
  img.className = 'art-img';
  img.alt = '';
  img.src = src;
  /* Inside #stage as before (desktop composition stays exactly as verified);
     phones force-show the stage in art mode via body.art-mode below, so the
     image renders in both layouts without moving nodes. */
  sizer.parentNode.insertBefore(img, sizer);
  const peek = document.createElement('button');
  peek.type = 'button';
  peek.id = 'artPeek';
  peek.className = 'mm-item';
  /* lives in the View group of the overflow menu, not loose in the topbar */
  const peekHost = (vs && vs.closest('.mm-group')) || document.querySelector('.tb-right');
  if (peekHost) peekHost.appendChild(peek);
  syncMoreGroups();
  function setArt(on) {
    img.hidden = !on;
    sizer.hidden = on;
    document.body.classList.toggle('art-mode', on);
    if (mcard) mcard.style.display = on ? 'none' : '';
    if (vs) vs.style.display = on ? 'none' : '';
    peek.textContent = on ? 'Interactive card' : 'Artwork';
    peek.setAttribute('aria-pressed', String(!on));
    window.dispatchEvent(new window.Event('resize'));
  }
  function exitArt() {
    setArt(false);
    img.hidden = true;
    peek.remove();
  }
  img.addEventListener('error', exitArt);
  peek.addEventListener('click', () => setArt(img.hidden));
  setArt(true);
}

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
    /* M-C2: phones always render the native layout; the ?view= deep link is
       left in the URL so a desktop open of the same link still lands there. */
    if (innerWidth <= 700) {
      viewMode = null;
      document.body.classList.add('phone-native');
    } else {
      viewMode = new URLSearchParams(location.search).get('view');
      if (viewMode && !['m1', 'm2', 'm3'].includes(viewMode)) viewMode = null;
    }
    viewRefresh(listing);
    totalViews = Number(listing.views) || 0;
    /* CF-11/CF-12: structured price, seller, status — from columns the
       fetch already returned and used to discard */
    applyHero(listing);
    syncFbBtns(listing);
    const artThumb = listing.payload && listing.payload.thumb
      && typeof listing.payload.thumb.src === 'string'
      && listing.payload.thumb.src.startsWith('https://')
      && listing.payload.thumbMode === 'card' ? listing.payload.thumb : null;
    if (artThumb) initArtMode(artThumb.src);
    const archNote = CF.$('archNote');
    archNote.hidden = !listing.archived;
    if (listing.archived) archNote.textContent = 'This listing is archived — hidden from the marketplace, still reachable by this link.';
    wireContact(listing.payload?.texts?.link);
    CF.status('Listing loaded.', 'ok');

    /* contact wiring is in wireContact() — the button always renders now */

    CF.$('copyLinkBtn').addEventListener('click', () => CF.copyText(location.href));

    fit();
    /* CF-25: the SDK loads now — after first render — because only presence
       needs it. Listing read and view bump are plain REST above. */
    if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
      const sb = await loadSupabase();
      if (sb) {
        try { const { data } = await sb.rpc('am_i_seller'); isSeller = data === true; } catch { isSeller = false; }
        startSupabasePresence(slug);
        /* CF-22: the seller's own loads are not "views" — only a signed-in
           seller session (am_i_seller) is treated as the owner */
        if (isSeller) wireOwnerControls(sb, listing, slug);
        if (isSeller) {
          const editBtn = CF.$('editBtn');
          editBtn.hidden = false;
          editBtn.addEventListener('click', () => {
            location.href = 'build.html?edit=' + encodeURIComponent(slug);
          });
        }
        if (!isSeller) {
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
