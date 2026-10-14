// netlify/edge-functions/listing-meta.ts — CF-20
//
// Crawlers do not run JavaScript, so og: tags cannot be written client-side
// from the fetched listing. This edge function rewrites them into the
// served HTML for the share URL shape the publish button copies:
//   /view.html?slug=<s>
// The legacy /l/<slug> shape is a 301 rule in _redirects, not handled here.
//
// Requires two environment variables on Netlify:
//   SUPABASE_URL          e.g. https://xxxx.supabase.co
//   SUPABASE_ANON_KEY     the anon key from js/config.js (read-only views)
//
// The share image is the card render the editor uploads at publish:
//   <SUPABASE_URL>/storage/v1/object/public/listing-images/<slug>.jpg

export default async (request: Request, context: any) => {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');
  if (!slug) return context.next();

  const SB_URL = Deno.env.get('SUPABASE_URL') || '';
  const SB_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!SB_URL || !SB_KEY) return context.next();

  /* 'missing' is set only when Supabase answered successfully with zero rows. A
     network or auth failure stays 'unknown', so a transient outage must never
     report a live listing as gone. */
  let lookup: 'found' | 'missing' | 'unknown' = 'unknown';
  let title = 'CardForge — Listing';
  let description = 'Valorant inventory showcase listing published with CardForge.';
  let image = '';
  let artSrc = '';
  let theme = 'protocol';
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/listing_public?select=slug,theme,status,price,currency,payload&slug=eq.${encodeURIComponent(slug)}`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } },
    );
    if (r.ok) {
      const rows = await r.json();
      const l = Array.isArray(rows) ? rows[0] : null;
      if (Array.isArray(rows) && rows.length === 0) lookup = 'missing';
      if (l) {
        lookup = 'found';
        const sym = l.currency === 'EUR' ? '€' : l.currency === 'GBP' ? '£' : l.currency === 'JPY' ? '¥' : '$';
        const texts = (l as any).payload && (l as any).payload.texts ? (l as any).payload.texts : {};
        const code = String(texts.code || '').trim();
        const cname = String(texts.cname || '').trim();
        const base = code || ((cname && !/^(change name|account description)$/i.test(cname)) ? cname : '') || slug;
        title = `${base}${l.price != null ? ` — ${sym}${l.price}` : ''}`;
        if (l.status === 'sold') title = `[SOLD] ${title}`;
        description = l.status === 'sold'
          ? 'This listing has been sold.'
          : l.price != null
            ? 'Valorant inventory showcase listing — contact the seller through CardForge.'
            : 'Valorant inventory showcase listing — contact the seller for the price.';
        theme = l.theme || 'protocol';
        const t = (l as any).payload ? (l as any).payload.thumb : null;
        if (t && typeof t.src === 'string' && t.src.startsWith('https://')) artSrc = String(t.src);
      }
    }
  } catch (_e) {
    // fall back to the static tags rather than failing the page
  }
  image = artSrc || `${SB_URL}/storage/v1/object/public/listing-images/${encodeURIComponent(slug)}.jpg`;

  // fetch the real page and rewrite its head
  const pageRes = await fetch(new URL('/view.html', request.url));
  let html = await pageRes.text();

  const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const themeColor = theme === 'arctic' ? '#DAD5CB' : '#0B0F14';

  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(description)}">`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(description)}">`)
    .replace(/<meta name="theme-color" content="[^"]*">/, `<meta name="theme-color" content="${themeColor}">`)
    .replace(
      /<\/head>/,
      `<meta property="og:image" content="${esc(image)}">` +
        (artSrc ? '' : `<meta property="og:image:width" content="3840">` +
        `<meta property="og:image:height" content="2160">`) +
        `<meta name="twitter:card" content="summary_large_image">` +
        `<meta name="twitter:title" content="${esc(title)}">` +
        `<meta name="twitter:description" content="${esc(description)}">` +
        `<meta name="twitter:image" content="${esc(image)}">` +
        `</head>`,
    );

  return new Response(html, {
    status: lookup === 'missing' ? 404 : 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=0, must-revalidate',
    },
  });
};

export const config = { path: ['/view.html'] };
