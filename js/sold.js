import { esc, $, status, initStatusDismiss, initDisclaimerCollapse } from './shared.js';

const CONFIG = window.CARDFORGE_CONFIG || {};
let supabase = null;
if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && window.supabase) {
  supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}

const IMGERR = "onerror=\"this.setAttribute('data-imgfail','1');this.closest('[data-imgwrap]')?.setAttribute('data-imgfail','1')\"";

const CUR_SYMBOL = { USD: '$', EUR: '\u20ac', GBP: '\u00a3', JPY: '\u00a5' };
const THEME_LABELS = { protocol: 'PROTOCOL', holo: 'HOLO', reaver: 'REAVER', oni: 'ONI', arctic: 'ARCTIC' };

async function load() {
  if (!supabase) {
    showEmpty();
    status('Past sales need the live listings service — see SETUP.md.', 'err');
    return;
  }
  status('Loading past sales…');
  const { data, error } = await supabase.rpc('browse_listings_v3', { p_limit: 200, p_offset: 0, p_status: 'sold' });
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
    price = '<div class="sc-price nostrike">Price on request</div>';
  } else {
    const sym = CUR_SYMBOL[r.currency] || (r.currency ? esc(r.currency) + ' ' : '$');
    const n = Number(r.price);
    const amt = n % 1 ? n.toFixed(2) : n.toLocaleString('en-US');
    price = '<div class="sc-price">' + sym + esc(amt) + '</div>';
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