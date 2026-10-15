import { esc, $, status, initStatusDismiss, initDisclaimerCollapse, IMGERR, THEME_LABELS, moneyParts } from './shared.js?v=2.0.6';

const CONFIG = window.CARDFORGE_CONFIG || {};
let supabase = null;
if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && window.supabase) {
  supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}

/* v1.6: this gallery is the owner's record of completed sales, so it is gated
   to a signed-in seller. browse_listings_v3 is executable by anon, so hiding
   the dashboard link was never a gate - typing sold.html listed every sale.
   The probe also fixes two older gaps: the RPC error is now checked (a
   PostgREST failure rejects nothing, it arrives in the payload), and the
   transport call is wrapped, so an offline load reports an error instead of
   sitting on "Loading past sales" forever. */
async function probeSeller() {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.rpc('am_i_seller');
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}

function showLocked() {
  $('slocked').hidden = false;
  $('sempty').hidden = true;
  $('serror').hidden = true;
  $('sgrid').innerHTML = '';
  $('scount').textContent = '';
}

async function load() {
  if (!supabase) {
    showLocked();
    status('Past sales need the live listings service — see SETUP.md.', 'err');
    return;
  }
  status('Loading past sales…');
  if (!(await probeSeller())) {
    showLocked();
    status('Past sales are visible to the signed-in seller only.', 'err');
    return;
  }
  $('slocked').hidden = true;
  let res;
  try {
    res = await supabase.rpc('browse_listings_v3', { p_limit: 200, p_offset: 0, p_status: 'sold' });
  } catch (e) {
    $('serror').hidden = false;
    $('serrorMsg').textContent = (e && e.message) || String(e);
    $('sgrid').innerHTML = '';
    return;
  }
  const { data, error } = res;
  if (error) {
    $('serror').hidden = false;
    $('serrorMsg').textContent = error.message || String(error);
    $('sgrid').innerHTML = '';
    return;
  }
  const rows = data || [];
  if (!rows.length) {
    showEmpty();
    status('No sold listings yet.');
    return;
  }
  $('scount').textContent = rows.length + (rows.length === 1 ? ' account sold' : ' accounts sold');
  $('sgrid').innerHTML = rows.map(cardHTML).join('');
  $('sempty').hidden = true;
  $('serror').hidden = true;
  status(rows.length + ' past sales loaded.', 'ok');
}

function showEmpty() {
  $('sempty').hidden = false;
  $('sgrid').innerHTML = '';
  $('scount').textContent = '';
}

function cardHTML(r) {
  const picks = Object.values(r.picks_top || {}).flatMap(a => Array.isArray(a) ? a : []);
  const thumbs = picks.filter(p => p.icon || p.img).slice(0, 3)
    .map(p => '<img loading="lazy" src="' + esc(p.icon || p.img) + '" alt="' + esc(p.name || '') + '" ' + IMGERR + '>')
    .join('');
  const cover = (typeof r.thumb_src === 'string' && r.thumb_src.startsWith('https://'))
    ? '<img loading="lazy" src="' + esc(r.thumb_src) + '" alt="' + esc(r.thumb_label || '') + '" ' + IMGERR + '>'
    : thumbs;
  const rank = (r.crank_icon ? '<img loading="lazy" src="' + esc(r.crank_icon) + '" alt="" ' + IMGERR + '>' : '')
    + '<span>' + esc(r.crank_name || 'UNRANKED') + '</span>';
  let price;
  if (r.price == null) {
    price = '<div class="sc-price nostrike">CONTACT FOR PRICE</div>';
  } else {
    const m = moneyParts(r.price, r.currency);
    price = '<div class="sc-price">' + (m ? esc(m.sym) + m.amt : '—') + '</div>';
  }
  const sold = r.sold_at ? 'Sold ' + fmtDate(r.sold_at) : 'Sold recently';
  const meta = sold + ' · ' + (Number(r.views) || 0) + ' views' + (r.skins ? ' · ' + r.skins + ' skins' : '');
  return '<a class="scard" href="view.html?slug=' + encodeURIComponent(r.slug) + '">'
    + '<span class="sold-badge">SOLD</span>'
    + '<div class="sc-thumbs">' + cover + '</div>'
    + '<div class="sc-title">' + esc(r.title || r.slug) + '</div>'
    + '<div class="sc-code">' + esc(r.code) + (THEME_LABELS[r.theme] ? ' · ' + THEME_LABELS[r.theme] : '') + '</div>'
    + '<div class="sc-rank">' + rank + '</div>'
    + price
    + '<div class="sc-meta">' + esc(meta) + '</div>'
    + '</a>';
}

function fmtDate(x) {
  return x ? new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
}

initStatusDismiss();
initDisclaimerCollapse();
$('sretryBtn').addEventListener('click', () => { $('serror').hidden = true; load(); });
load();