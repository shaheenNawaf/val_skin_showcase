// CardForge owner dashboard — Every listing on the marketplace — owner view, on one
// page. Edit keys live in localStorage as `vc-edit-<slug>`; every mutation is
// checked server-side against the key's hash.
import { esc, $, status, initStatusDismiss, initDisclaimerCollapse, readJSON, writeJSON, hashToken, copyText, fbPostText, resizeToDataUrl } from './shared.js';

const CONFIG = window.CARDFORGE_CONFIG || {};
let supabase = null;
if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && window.supabase) {
  supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}

const AVATAR_PLACEHOLDER = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='100%25' height='100%25' fill='%232A3540'/><circle cx='32' cy='25' r='11' fill='%23768390'/><rect x='14' y='40' width='36' height='19' rx='6' fill='%23768390'/></svg>";

const IMGERR = "onerror=\"this.setAttribute('data-imgfail','1');this.closest('[data-imgwrap]')?.setAttribute('data-imgfail','1')\"";

const SYM = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', PHP: '₱' };

const state = { tab: 'active', rows: [], tokens: {}, local: false };

// ── helpers ───────────────────────────────────────────────────────
function viewUrl(slug) {
  return new URL('view.html?slug=' + encodeURIComponent(slug), location.href).href;
}

function editUrl(slug) {
  return new URL('build.html?edit=' + encodeURIComponent(slug), location.href).href;
}

function classify(row) {
  return row.archived ? 'archived' : (row.status === 'sold' ? 'sold' : 'active');
}

function byUpdated(a, b) {
  return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
}

function fmtDate(x) {
  return new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function agoText(iso) {
  const h = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (h < 1) return 'just now';
  if (h < 24) return Math.floor(h) + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

const deny = e => /42501|token mismatch/i.test(String((e && e.message) || e))
  ? 'This browser’s edit key was rejected for that action.'
  : null;

// ── load ──────────────────────────────────────────────────────────
async function load(silent) {
  if (!supabase) {
    $('dgate').hidden = false;
    $('dgMsg').textContent = 'Supabase failed to load — refresh to retry.';
    $('stats').hidden = true;
    $('tabs').hidden = true;
    $('rows').hidden = true;
    return;
  }

  const { data, error } = await supabase.from('listing_public').select('id,slug,payload,theme,status,price,currency,negotiable,views,created_at,updated_at,archived,sold_at,featured_at,fb_post_url').order('updated_at', { ascending: false });
  if (error) {
    $('derror').hidden = false;
    $('derrorMsg').textContent = error.message || String(error);
    $('dempty').hidden = true;
    $('rows').hidden = true;
    $('stats').hidden = true;
    return;
  }

  state.rows = data || [];
  $('dsub').textContent = state.rows.length + (state.rows.length === 1 ? ' listing' : ' listings') + ' signed-in owner view';
  if (!silent) status('Loaded ' + state.rows.length + ' listings.', 'ok');
  render();
}

// ── stats ─────────────────────────────────────────────────────────
function renderStats(rows) {
  const active = rows.filter(r => classify(r) === 'active').length;
  const soldRows = rows.filter(r => classify(r) === 'sold');
  const views = rows.reduce((n, r) => n + (Number(r.views) || 0), 0);
  $('stActive').textContent = String(active);
  $('stSold').textContent = String(soldRows.length);
  $('stViews').textContent = views.toLocaleString('en-US');

  const priced = soldRows.filter(r => r.price != null);
  let value = '—';
  let mixed = false;
  if (priced.length) {
    const curs = [...new Set(priced.map(r => r.currency || ''))];
    if (curs.length === 1) {
      const cur = curs[0];
      const total = priced.reduce((n, r) => n + (Number(r.price) || 0), 0);
      value = (SYM[cur] || (cur + ' ')) + total.toLocaleString('en-US');
    } else {
      mixed = true;
    }
  }
  $('stValue').textContent = value;
  $('stValue').title = mixed ? 'Mixed currencies' : '';

  const dated = soldRows.filter(r => r.sold_at && r.created_at);
  let days = '—';
  if (dated.length) {
    const mean = dated.reduce((n, r) => n + (new Date(r.sold_at).getTime() - new Date(r.created_at).getTime()) / 86400000, 0) / dated.length;
    days = Math.round(mean) + 'd';
  }
  $('stDays').textContent = days;
}

// ── rows ──────────────────────────────────────────────────────────
function statusLabel(s) {
  return ({ available: 'ON SALE', pending: 'PENDING', sold: 'SOLD' })[s] || String(s || '').toUpperCase();
}

function firstPick(row) {
  const picks = (row.payload && row.payload.picks) || {};
  const all = Object.values(picks).filter(Array.isArray).flat();
  for (const p of all) {
    const icon = p && (p.icon || p.img);
    if (icon) return icon;
  }
  return null;
}

function rowThumb(row) {
  const th = row.payload && row.payload.thumb;
  return (th && typeof th.src === 'string' && th.src.startsWith('https://')) ? th : null;
}

function priceText(row) {
  if (row.price == null) return 'No price set';
  const sym = SYM[row.currency] || (row.currency ? row.currency + ' ' : '$');
  return esc(sym + Number(row.price).toLocaleString('en-US')) + (row.negotiable ? ' · OBO' : '');
}

function actBtn(act, label, cls, hidden) {
  return '<button type="button" data-act="' + act + '"'
    + (cls ? ' class="' + cls + '"' : '')
    + (hidden ? ' hidden' : '')
    + '>' + esc(label) + '</button>';
}

function rowHTML(row) {
  const t = (row.payload && row.payload.texts) || {};
  const cname = String(t.cname || '').trim();
  const code = String(t.code || '').trim();
  const title = (cname && cname !== 'CHANGE NAME') ? cname : (code && code !== 'K486') ? code : row.slug;
  const statusKey = classify(row);

  const chips = ['<span class="chip st-' + esc(row.status || 'available') + '">' + esc(statusLabel(row.status)) + '</span>'];
  if (row.archived) chips.push('<span class="chip st-archived">ARCHIVED</span>');
  if (row.featured_at) chips.push('<span class="chip st-featured">FEATURED</span>');

  const spans = [
    priceText(row),
    'CODE ' + esc(t.code || ''),
    esc(String(Number(row.views) || 0)) + ' views',
    'upd ' + esc(agoText(row.updated_at))
  ];
  const meta = chips.concat(spans).join('<span class="sep">·</span>');

  let dsub2;
  if (row._local) {
    dsub2 = 'Local draft — never published';
  } else {
    const parts = [];
    if (row.status === 'sold' && row.sold_at) parts.push('Sold ' + fmtDate(row.sold_at));
    parts.push('Listed ' + fmtDate(row.created_at));
    if (row.fb_post_url) parts.push('FB post linked');
    dsub2 = parts.join(' · ');
  }

  const manage = [], share = [], danger = [];
  if (row._local) {
    share.push(actBtn('copylink', 'Copy link', 'dm-item'));
    danger.push(actBtn('delete', 'Delete', 'dm-item danger'));
  } else {
    manage.push(actBtn('sold', row.status === 'sold' ? 'Relist' : 'Mark sold', 'dm-item'));
    manage.push(actBtn('feature', row.featured_at ? 'Unfeature' : 'Feature', 'dm-item' + (row.featured_at ? ' on' : ''), statusKey !== 'active'));
    manage.push(actBtn('bump', 'Bump', 'dm-item'));
    manage.push(actBtn('price', 'Price', 'dm-item'));
    share.push(actBtn('fbpost', 'Copy FB post', 'dm-item'));
    share.push(actBtn('fblink', row.fb_post_url ? 'FB link ✓' : 'FB link', 'dm-item'));
    manage.push(actBtn('thumb', rowThumb(row) ? 'Thumb ✓' : 'Thumb', 'dm-item'));
    share.push(actBtn('copylink', 'Copy link', 'dm-item'));
    danger.push(actBtn('archive', row.archived ? 'Unarchive' : 'Archive', 'dm-item'));
    danger.push(actBtn('delete', 'Delete', 'dm-item danger'));
  }
  const groups = [];
  if (manage.length) groups.push('<div class="dm-group"><b class="dm-label">Manage</b>' + manage.join('') + '</div>');
  if (share.length) groups.push('<div class="dm-group"><b class="dm-label">Share</b>' + share.join('') + '</div>');
  if (danger.length) groups.push('<div class="dm-group"><b class="dm-label">Danger zone</b>' + danger.join('') + '</div>');

  const pick = firstPick(row);
  const ct = rowThumb(row);
  const thumb = ct ? esc(ct.src) : (pick ? esc(pick) : AVATAR_PLACEHOLDER);

  return '<article class="drow" data-slug="' + esc(row.slug) + '">'
    + '<img class="dthumb" src="' + thumb + '" alt="" loading="lazy" ' + IMGERR + '>'
    + '<div class="dinfo">'
    + '<h3 class="dtitle">' + esc(title) + '</h3>'
    + '<div class="dmeta">' + meta + '</div>'
    + '<div class="dsub2">' + esc(dsub2) + '</div>'
    + '</div>'
    + '<div class="dacts">'
    + actBtn('open', 'Open')
    + actBtn('edit', 'Edit')
    + '<span class="dmore-wrap"><button type="button" class="dmore-btn" aria-expanded="false" aria-label="More actions for this listing">⋯</button>'
    + '<div class="dmore" hidden>' + groups.join('') + '</div></span>'
    + '</div>'
    + '</article>';
}

function render() {
  const counts = { active: 0, sold: 0, archived: 0 };
  state.rows.forEach(r => { counts[classify(r)]++; });
  ['active', 'sold', 'archived'].forEach(t => {
    const el = document.querySelector('#tabs .tc[data-count="' + t + '"]');
    if (el) el.textContent = '(' + counts[t] + ')';
  });

  const filtered = state.rows.filter(r => classify(r) === state.tab);
  if (state.tab === 'sold') {
    filtered.sort((a, b) => {
      const av = a.sold_at ? new Date(a.sold_at).getTime() : null;
      const bv = b.sold_at ? new Date(b.sold_at).getTime() : null;
      if (av == null && bv == null) return byUpdated(a, b);
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    });
  } else {
    filtered.sort(byUpdated);
  }

  $('rows').innerHTML = filtered.map(rowHTML).join('');
  $('rows').hidden = false;
  $('derror').hidden = true;
  $('stats').hidden = false;
  $('dempty').hidden = state.rows.length > 0;
  renderStats(state.rows);
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
}

// ── owner RPCs ────────────────────────────────────────────────────
async function own(row, params) {
  const h = await hashToken(localStorage.getItem('vc-edit-' + row.slug) || '');
  const { error } = await supabase.rpc('owner_set_listing', Object.assign({ p_slug: row.slug, p_edit_token_hash: h }, params));
  if (error) throw error;
}

async function withBusy(rowEl, fn) {
  const btns = [...rowEl.querySelectorAll('button')];
  btns.forEach(b => { b.disabled = true; });
  try {
    await fn();
  } finally {
    btns.forEach(b => { b.disabled = false; });
  }
  await load(true);
}

function runAction(rowEl, label, fn) {
  withBusy(rowEl, fn).catch(e => status(deny(e) || (label + ' failed: ' + ((e && e.message) || e)), 'err'));
}

// ── price form ────────────────────────────────────────────────────
function priceFormHTML(row) {
  const sel = row.currency || 'PHP';
  const opts = ['PHP', 'USD', 'EUR', 'GBP', 'JPY'].map(c => '<option' + (c === sel ? ' selected' : '') + '>' + c + '</option>').join('');
  const val = row.price != null ? esc(String(row.price)) : '';
  return '<form class="priceForm">'
    + '<input type="number" min="0" step="1" placeholder="250" value="' + val + '">'
    + '<select>' + opts + '</select>'
    + '<label><input type="checkbox"' + (row.negotiable ? ' checked' : '') + '> OBO</label>'
    + '<button type="submit">Save</button>'
    + '<button type="button" data-p="clear">Clear price</button>'
    + '<button type="button" data-p="cancel">Cancel</button>'
    + '</form>';
}

function togglePriceForm(rowEl, row) {
  const info = rowEl.querySelector('.dinfo');
  const existing = info.querySelector('.priceForm');
  if (existing) { existing.remove(); return; }
  const meta = info.querySelector('.dmeta');
  if (!meta) return;
  meta.insertAdjacentHTML('afterend', priceFormHTML(row));
  const form = info.querySelector('.priceForm');

  form.addEventListener('submit', ev => {
    ev.preventDefault();
    const v = form.querySelector('input[type=number]').value.trim();
    if (v === '') { status('Enter a price, or use Clear price.', 'err'); return; }
    const cur = form.querySelector('select').value;
    const chk = form.querySelector('input[type=checkbox]').checked;
    runAction(rowEl, 'Save', async () => {
      await own(row, { p_price: Number(v), p_currency: cur, p_negotiable: chk });
      status('Price saved — the marketplace now shows it.', 'ok');
    });
  });

  form.addEventListener('click', ev => {
    const p = ev.target.closest('button[data-p]');
    if (!p) return;
    if (p.dataset.p === 'cancel') { form.remove(); return; }
    if (p.dataset.p === 'clear') {
      runAction(rowEl, 'Clear price', async () => {
        await own(row, { p_clear_price: true });
        status('Price cleared — buyers see CONTACT FOR PRICE.', 'ok');
      });
    }
  });
}

// ── thumbnail picker ──────────────────────────────────────────────
async function saveThumb(row, thumb) {
  const payload = Object.assign({}, row.payload || {});
  if (thumb) payload.thumb = thumb; else delete payload.thumb;
  const h = await hashToken(localStorage.getItem('vc-edit-' + row.slug) || '');
  const { error } = await supabase.rpc('update_listing', {
    p_slug: row.slug, p_edit_token_hash: h, p_payload: payload, p_theme: row.theme || 'protocol'
  });
  if (error) throw error;
}

function thumbFormHTML(row) {
  const cur = rowThumb(row);
  const picks = Object.values((row.payload && row.payload.picks) || {}).filter(Array.isArray).flat()
    .filter(p => p && (p.icon || p.img)).slice(0, 12);
  const btns = picks.map(p =>
    '<button type="button" class="tf-pick" data-src="' + esc(p.icon || p.img) + '" data-label="' + esc(p.name || '') + '" title="' + esc(p.name || '') + '">'
    + '<img src="' + esc(p.icon || p.img) + '" alt="" loading="lazy"></button>').join('');
  const urlVal = (cur && cur.label === '') ? esc(cur.src) : '';
  return '<form class="thumbForm">'
    + '<div class="tf-head"><span class="tf-label">Card thumbnail</span><button type="button" data-t="cancel">Cancel</button></div>'
    + (btns ? '<div class="tf-sec"><span class="tf-cap">From your skins</span><div class="tf-picks">' + btns + '</div></div>' : '')
    + '<div class="tf-sec"><span class="tf-cap">Upload or paste a link</span>'
    + '<div class="tf-row"><button type="button" data-t="file">Upload image…</button><input type="file" class="tf-input" accept="image/png,image/jpeg,image/webp" hidden></div>'
    + '<div class="tf-row"><input type="url" class="tf-url" placeholder="https://example.com/cover.jpg" value="' + urlVal + '"><button type="button" data-t="set">Set URL</button></div></div>'
    + (cur ? '<div class="tf-sec"><span class="tf-cap">Where it shows</span><div class="tf-mode"><button type="button" data-m="cover"' + ((row.payload && row.payload.thumbMode) === 'card' ? '' : ' class="on"') + '>Marketplace cover only</button><button type="button" data-m="card"' + ((row.payload && row.payload.thumbMode) === 'card' ? ' class="on"' : '') + '>Cover + listing page</button></div></div>' : '')
    + '<div class="tf-foot"><button type="button" data-t="auto">Auto (default)</button><span class="tf-hint">Auto shows the first skin icon, as before.</span></div>'
    + '</form>';
}

function toggleThumbForm(rowEl, row) {
  const info = rowEl.querySelector('.dinfo');
  const existing = info.querySelector('.thumbForm');
  if (existing) { existing.remove(); return; }
  const meta = info.querySelector('.dmeta');
  if (!meta) return;
  meta.insertAdjacentHTML('afterend', thumbFormHTML(row));
  const form = info.querySelector('.thumbForm');

  form.addEventListener('submit', ev => ev.preventDefault());

  const fileBtn = form.querySelector('[data-t="file"]');
  const fileInput = form.querySelector('.tf-input');
  fileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { status('Only PNG, JPEG or WebP images.', 'err'); return; }
    if (f.size > 10 * 1024 * 1024) { status('Image too large — pick one under 10 MB.', 'err'); return; }
    runAction(rowEl, 'Upload', async () => {
      fileBtn.textContent = 'Uploading…';
      try {
        const dataUrl = await resizeToDataUrl(f, 1280);
        const blob = await (await fetch(dataUrl)).blob();
        const path = row.slug + '-thumb.' + (blob.type === 'image/png' ? 'png' : 'jpg');
        const { error: upErr } = await supabase.storage.from('listing-images')
          .upload(path, blob, { upsert: true, contentType: blob.type });
        if (upErr) throw upErr;
        const pub = supabase.storage.from('listing-images').getPublicUrl(path).data.publicUrl;
        await saveThumb(row, { src: pub + '?v=' + Date.now(), label: '' });
        status('Thumbnail uploaded — the marketplace now shows it.', 'ok');
      } finally {
        fileBtn.textContent = 'Upload image…';
      }
    });
  });

  form.addEventListener('click', ev => {
    const pick = ev.target.closest('.tf-pick');
    if (pick) {
      runAction(rowEl, 'Thumb', async () => {
        await saveThumb(row, { src: pick.dataset.src, label: pick.dataset.label });
        status('Card thumbnail updated — the marketplace now shows it.', 'ok');
      });
      return;
    }
    const mb = ev.target.closest('button[data-m]');
    if (mb) {
      const mode = mb.dataset.m;
      runAction(rowEl, 'Mode', async () => {
        const payload = Object.assign({}, row.payload || {});
        if (mode === 'card') payload.thumbMode = 'card'; else delete payload.thumbMode;
        const h = await hashToken(localStorage.getItem('vc-edit-' + row.slug) || '');
        const { error } = await supabase.rpc('update_listing', { p_slug: row.slug, p_edit_token_hash: h, p_payload: payload, p_theme: row.theme || 'protocol' });
        if (error) throw error;
        status(mode === 'card' ? 'Listing page now shows the artwork.' : 'Artwork is the marketplace cover only.', 'ok');
      });
      return;
    }
    const b = ev.target.closest('button[data-t]');
    if (!b) return;
    if (b.dataset.t === 'file') return;
    if (b.dataset.t === 'cancel') { form.remove(); return; }
    if (b.dataset.t === 'set') {
      const v = form.querySelector('.tf-url').value.trim();
      if (!/^https:\/\//i.test(v)) { status('Enter a full https:// image URL.', 'err'); return; }
      runAction(rowEl, 'Set URL', async () => {
        await saveThumb(row, { src: v, label: '' });
        status('Card thumbnail updated — the marketplace now shows it.', 'ok');
      });
      return;
    }
    if (b.dataset.t === 'auto') {
      runAction(rowEl, 'Auto', async () => {
        const cur = rowThumb(row);
        await saveThumb(row, null);
        if (cur && cur.src.indexOf('-thumb.') !== -1) {
          const m = cur.src.split('?')[0].match(/listing-images\/(.+)$/);
          if (m) { try { await supabase.storage.from('listing-images').remove([m[1]]); } catch { /* best-effort cleanup */ } }
        }
        status('Thumbnail reset to automatic.', 'ok');
      });
    }
  });
}

// ── action dispatch ───────────────────────────────────────────────
function wireActions() {
  $('rows').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const rowEl = btn.closest('.drow');
    if (!rowEl) return;
    const slug = rowEl.dataset.slug;
    const row = state.rows.find(r => r.slug === slug);
    if (!row) return;
    const act = btn.dataset.act;

    if (act === 'open') { location.href = viewUrl(slug); return; }
    if (act === 'edit') { location.href = editUrl(slug); return; }
    if (act === 'copylink') { copyText(viewUrl(slug)); return; }

    if (act === 'fbpost') {
      copyText(fbPostText(row, viewUrl(row.slug)));
      status('FB post text copied — paste it into your Facebook group.', 'ok');
      return;
    }

    if (act === 'price') { togglePriceForm(rowEl, row); return; }

    if (act === 'thumb') { toggleThumbForm(rowEl, row); return; }

    if (act === 'sold') {
      const marking = row.status !== 'sold';
      if (marking && !window.confirm('Mark this listing SOLD? It leaves the marketplace immediately. You can relist anytime.')) return;
      runAction(rowEl, btn.textContent, async () => {
        await own(row, { p_status: marking ? 'sold' : 'available' });
        status(marking ? 'Marked sold — removed from the marketplace.' : 'Relisted — back on the marketplace.', 'ok');
      });
      return;
    }

    if (act === 'feature') {
      runAction(rowEl, btn.textContent, async () => {
        const next = !row.featured_at;
        await own(row, { p_featured: next });
        status(next ? 'Pinned as the featured listing on the marketplace.' : 'Featured pin removed.', 'ok');
      });
      return;
    }

    if (act === 'bump') {
      runAction(rowEl, btn.textContent, async () => {
        await own(row, {});
        status('Bumped to the top of Newest.');
      });
      return;
    }

    if (act === 'fblink') {
      const url = prompt('Paste the Facebook post URL (https://…):', row.fb_post_url || '');
      if (url === null) return;
      if (url === '') {
        runAction(rowEl, btn.textContent, async () => {
          await own(row, { p_fb_post_url: '' });
          status('FB post link removed.', 'ok');
        });
        return;
      }
      if (!/^https:\/\//i.test(url)) { status('URL must start with https://', 'err'); return; }
      runAction(rowEl, btn.textContent, async () => {
        await own(row, { p_fb_post_url: url });
        status('FB post link saved — buyers now see a "See the Facebook post" button.', 'ok');
      });
      return;
    }

    if (act === 'archive') {
      const next = !row.archived;
      if (!window.confirm(next
        ? 'Archive this listing? It disappears from the marketplace until you unarchive it.'
        : 'Unarchive this listing? It returns to the marketplace.')) return;
      runAction(rowEl, btn.textContent, async () => {
        const h = await hashToken(localStorage.getItem('vc-edit-' + slug) || '');
        const { error } = await supabase.rpc('set_listing_archived', { p_slug: slug, p_edit_token_hash: h, p_archived: next });
        if (error) throw error;
        status(next ? 'Listing archived — hidden from the marketplace.' : 'Listing unarchived — back in the marketplace.', 'ok');
      });
      return;
    }

    if (act === 'delete') {
      if (prompt('Permanently delete this listing? This cannot be undone. Type DELETE to confirm.') !== 'DELETE') return;
      if (row._local) {
        const all = readJSON('vlistings', {});
        delete all[slug];
        writeJSON('vlistings', all);
        localStorage.removeItem('vc-edit-' + slug);
        status('Listing deleted.', 'ok');
        load(true);
        return;
      }
      runAction(rowEl, btn.textContent, async () => {
        const h = await hashToken(localStorage.getItem('vc-edit-' + slug) || '');
        const { error } = await supabase.rpc('delete_listing', { p_slug: slug, p_edit_token_hash: h });
        if (error) throw error;
        /* v1.5.1: delete_listing cannot touch storage — clean the share image
           and artwork thumb best-effort so deletes stop leaving orphans */
        try {
          await supabase.storage.from('listing-images').remove(
            [slug + '.jpg', slug + '-thumb.jpg', slug + '-thumb.png', slug + '-thumb.webp']);
        } catch { /* best-effort cleanup */ }
        localStorage.removeItem('vc-edit-' + slug);
        status('Listing deleted.', 'ok');
      });
    }
  });
}

/* per-row ⋯ overflow menus — one open at a time, outside click + Esc close */
function wireRowMenus() {
  const rowsEl = $('rows');
  function setWrap(w, open) {
    w.querySelector('.dmore').hidden = !open;
    w.querySelector('.dmore-btn').setAttribute('aria-expanded', String(open));
    /* the row's chamfer clip-path would clip the dropdown, and later sibling
       rows would paint over it — unclip + raise while its menu is open */
    const row = w.closest('.drow');
    if (row) row.classList.toggle('menu-open', open);
  }
  function closeAll(except) {
    rowsEl.querySelectorAll('.dmore-wrap').forEach(w => { if (w !== except) setWrap(w, false); });
  }
  rowsEl.addEventListener('click', e => {
    const mb = e.target.closest('.dmore-btn');
    if (mb) {
      const wrap = mb.closest('.dmore-wrap');
      const open = wrap.querySelector('.dmore').hidden;
      closeAll(wrap);
      setWrap(wrap, open);
      return;
    }
    const item = e.target.closest('.dmore button[data-act]');
    if (item) setWrap(item.closest('.dmore-wrap'), false);
  });
  document.addEventListener('click', e => { if (!e.target.closest('.dmore-wrap')) closeAll(null); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(null); });
}

// ── boot ──────────────────────────────────────────────────────────
initStatusDismiss();
initDisclaimerCollapse();

document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => {
  state.tab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach(x => x.setAttribute('aria-selected', String(x.dataset.tab === state.tab)));
  render();
}));

$('retryBtn').addEventListener('click', () => { $('derror').hidden = true; load(); });

wireActions();
wireRowMenus();

function showGate() {
  $('dgate').hidden = false;
  $('dhead').hidden = true;
  $('stats').hidden = true;
  $('tabs').hidden = true;
  $('rows').hidden = true;
  $('dempty').hidden = true;
  $('derror').hidden = true;
  $('dNewCard').hidden = true;
  $('soldPageLink').hidden = true;
  $('dSignOut').hidden = true;
}

async function probeSeller() {
  try {
    const { data } = await supabase.rpc('am_i_seller');
    return data === true;
  } catch {
    return false;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setDgMsg(text, isErr) {
  const m = $('dgMsg');
  m.textContent = text || '';
  m.className = isErr ? 'dgate-msg err' : 'dgate-msg';
}

/* v1.4: the dashboard gate reaches parity with the editor gate — magic-link
   fallback (magic-link-only sellers could never pass a password-only gate),
   an explained non-seller state with sign-out, pending labels, email
   validation, and a "Signing you in…" state for the magic-link return. */
async function initGate() {
  if (!supabase) {
    showGate();
    setDgMsg('Supabase failed to load — refresh to retry.', true);
    return;
  }

  /* v1.5: magic-link fallback is out of public view — reveal with ?magic=1
     so OTP-only sellers can never be locked out. */
  if (new URLSearchParams(location.search).has('magic')) $('dgOtp').hidden = false;

  async function applyGate() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session && await probeSeller()) {
      $('dgate').hidden = true;
      $('dhead').hidden = false;
      $('dNewCard').hidden = false;
      $('soldPageLink').hidden = false;
      $('dSignOut').hidden = false;
      load(true);
      return;
    }
    showGate();
    if (session) {
      // signed in, but not on the seller allow-list
      $('dgForm').hidden = true;
      $('dgSent').hidden = true;
      $('dgWait').hidden = true;
      $('dgSigned').hidden = false;
      $('dgWho').textContent = (session.user && session.user.email) || 'your account';
      try { $('dgOut').focus({ preventScroll: true }); } catch { /* older browsers */ }
    } else {
      $('dgForm').hidden = false;
      $('dgSent').hidden = true;
      $('dgSigned').hidden = true;
      $('dgWait').hidden = true;
      if (!window.matchMedia('(pointer: coarse)').matches) {
        try { $('dgEmail').focus({ preventScroll: true }); } catch { /* older browsers */ }
      }
    }
  }

  supabase.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_IN') applyGate();
    else if (event === 'SIGNED_OUT') location.reload();
  });

  const sendLabel = $('dgSend').textContent;
  const otpLabel = $('dgOtp').textContent;

  $('dgSend').addEventListener('click', async () => {
    const email = $('dgEmail').value.trim();
    if (!EMAIL_RE.test(email)) { setDgMsg('Enter a valid email address.', true); return; }
    const password = $('dgPass').value;
    if (!password) { setDgMsg('Enter your password.', true); return; }
    setDgMsg('');
    $('dgSend').disabled = true;
    $('dgSend').textContent = 'Signing in…';
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    $('dgSend').disabled = false;
    $('dgSend').textContent = sendLabel;
    $('dgPass').value = '';
    if (error) {
      setDgMsg(/invalid login credentials/i.test(error.message || '')
        ? 'Wrong email or password.'
        : /email not confirmed/i.test(error.message || '')
          ? 'That account still needs to be confirmed by the marketplace owner.'
          : 'Sign-in failed: ' + (error.message || 'unknown error'), true);
    }
  });

  $('dgOtp').addEventListener('click', async () => {
    const email = $('dgEmail').value.trim();
    if (!EMAIL_RE.test(email)) { setDgMsg('Enter a valid email address.', true); return; }
    setDgMsg('');
    $('dgOtp').disabled = true;
    $('dgOtp').textContent = 'Sending link…';
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    $('dgOtp').disabled = false;
    $('dgOtp').textContent = otpLabel;
    if (error) {
      setDgMsg(/security purposes|rate limit/i.test(error.message || '')
        ? 'Too many requests — wait a minute and try again.'
        : 'Sign-in link failed: ' + (error.message || 'unknown error'), true);
      return;
    }
    $('dgForm').hidden = true;
    $('dgSent').hidden = false;
    $('dgSigned').hidden = true;
  });

  $('dgBack').addEventListener('click', () => {
    $('dgForm').hidden = false;
    $('dgSent').hidden = true;
    setDgMsg('');
  });

  const signOut = async () => {
    await supabase.auth.signOut();
    location.reload();
  };
  $('dgOut').addEventListener('click', signOut);
  $('dSignOut').addEventListener('click', signOut);

  if (location.search.includes('code=') || location.hash.includes('access_token')) {
    // magic-link return: hold the calm state while the SDK exchanges the code
    $('dgate').hidden = false;
    $('dgForm').hidden = true;
    $('dgSent').hidden = true;
    $('dgSigned').hidden = true;
    $('dgWait').hidden = false;
    await Promise.race([
      new Promise(resolve => { supabase.auth.onAuthStateChange(() => resolve()); }),
      new Promise(resolve => setTimeout(resolve, 4000))
    ]);
  }

  await applyGate();
}

initGate();