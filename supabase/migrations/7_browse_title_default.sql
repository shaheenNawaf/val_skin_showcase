-- Browse v2.1: title falls back past the editor's default 'CHANGE NAME' placeholder.
-- Run after 6_browse_listings_v2.sql. Idempotent.
create or replace function public.browse_listings_v2(
  p_limit int default 60,
  p_offset int default 0
) returns table (
  slug text, title text, code text, theme text,
  price numeric, currency text, negotiable boolean,
  views bigint, created_at timestamptz, updated_at timestamptz,
  skins int, prems int, limited int, anims int, bpass int,
  level int, vp int, rp int, kc int,
  crank_name text, prank_name text, crank_icon text, prank_icon text,
  vlogin text, tag text, link text, wtr text, receipts text, owner text,
  picks_top jsonb
)
language sql security definer set search_path = public stable as $$
  select l.slug,
         coalesce(nullif(nullif(l.payload->'texts'->>'cname', ''), 'CHANGE NAME'),
                  nullif(l.payload->'texts'->>'code', ''), l.slug),
         coalesce(l.payload->'texts'->>'code', ''),
         l.theme, l.price, l.currency, l.negotiable, l.views, l.created_at, l.updated_at,
         coalesce((select sum(jsonb_array_length(e.value))::int
                   from jsonb_each(coalesce(l.payload->'picks', '{}'::jsonb)) e
                   where jsonb_typeof(e.value) = 'array'), 0),
         public.cf_num(l.payload->'texts'->>'prems'),
         public.cf_num(l.payload->'texts'->>'limited'),
         public.cf_num(l.payload->'texts'->>'anims'),
         public.cf_num(l.payload->'texts'->>'bpass'),
         public.cf_num(l.payload->'texts'->>'level'),
         public.cf_num(l.payload->'texts'->>'vp'),
         public.cf_num(l.payload->'texts'->>'rp'),
         public.cf_num(l.payload->'texts'->>'kc'),
         coalesce(l.payload->'texts'->>'crank', ''),
         coalesce(l.payload->'texts'->>'prank', ''),
         coalesce(l.payload->'ranks'->>'crank', ''),
         coalesce(l.payload->'ranks'->>'prank', ''),
         coalesce(l.payload->'texts'->>'vlogin', ''),
         coalesce(l.payload->'texts'->>'tag', ''),
         coalesce(l.payload->'texts'->>'link', ''),
         coalesce(l.payload->'texts'->>'wtr', ''),
         coalesce(l.payload->'texts'->>'receipts', ''),
         coalesce(l.payload->'texts'->>'owner', ''),
         coalesce((
           select jsonb_object_agg(k.key, k.top4)
           from (
             select e.key,
                    (select coalesce(jsonb_agg(x.elem order by x.ord), '[]'::jsonb)
                     from (select t.elem, t.ord
                           from jsonb_array_elements(e.value) with ordinality as t(elem, ord)
                           limit 4) x) as top4
             from jsonb_each(coalesce(l.payload->'picks', '{}'::jsonb)) e
             where jsonb_typeof(e.value) = 'array'
           ) k
         ), '{}'::jsonb)
  from public.listings l
  where l.status = 'available'
  order by l.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 60), 200))
  offset greatest(0, coalesce(p_offset, 0))
$$;
grant execute on function public.browse_listings_v2(int, int) to anon, authenticated;