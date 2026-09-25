// CardForge browse — public list of available listings.
const CONFIG = window.CARDFORGE_CONFIG || {};
let supabase = null;
if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && window.supabase) {
  supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}
const $ = id => document.getElementById(id);
const status = m => { const el = $('status'); if (el) el.textContent = m; };

function cardEl(r) {
  const a = document.createElement('a');
  a.className = 'bcard';
  a.href = 'view.html?slug=' + encodeURIComponent(r.slug);
  const h = document.createElement('h2');
  h.textContent = r.title || r.slug;
  const meta = document.createElement('div');
  meta.className = 'bmeta';
  meta.textContent = [r.code, (r.skins || 0) + ' skins', (r.views || 0) + ' views'].filter(Boolean).join(' · ');
  const foot = document.createElement('div');
  foot.className = 'bfoot';
  const d = document.createElement('span');
  d.textContent = r.updated_at ? new Date(r.updated_at).toISOString().slice(0, 10) : '';
  const v = document.createElement('b');
  v.textContent = 'View listing →';
  foot.append(d, v);
  a.append(h, meta, foot);
  return a;
}

(async () => {
  const grid = $('bgrid');
  if (!supabase) {
    status('Browse needs Supabase configured — see SETUP.md.');
    return;
  }
  try {
    const { data, error } = await supabase.rpc('browse_listings');
    if (error) throw error;
    if (!data || !data.length) {
      status('No listings yet.');
      const empty = document.createElement('div');
      empty.className = 'bempty';
      empty.textContent = 'No listings yet — ';
      const link = document.createElement('a');
      link.href = 'index.html';
      link.textContent = 'build the first card';
      empty.append(link, '.');
      grid.append(empty);
      return;
    }
    status(data.length + (data.length === 1 ? ' listing' : ' listings') + ' available.');
    data.forEach(r => grid.append(cardEl(r)));
  } catch (e) {
    status('Could not load listings: ' + (e.message || e));
  }
})();