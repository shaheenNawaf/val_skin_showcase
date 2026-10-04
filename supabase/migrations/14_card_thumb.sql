-- Migration 14: optional owner-set card thumbnail (payload.thumb) on browse_listings_v3.
--
-- The dashboard "Thumb" picker writes payload.thumb = { src, label } through
-- update_listing (no schema change — it rides inside the existing jsonb payload).
-- browse_listings_v3 projects columns, so the cover must be projected too.
-- The two thumb columns are APPENDED LAST to the select list (house rule).
-- A function's OUT columns cannot change via CREATE OR REPLACE, so v3 is
-- dropped and recreated in this one idempotent file. browse.js falls back
-- v3 -> v2 on any error, so either side of the rollout is safe.

drop function if exists public.browse_listings_v3(integer, integer, text);

create or replace function public.browse_listings_v3(
  p_limit  int  default 60,
  p_offset int  default 0,
  p_status text default 'available'
) returns table (
  slug text,
  title text,
  code text,
  theme text,
  price numeric,
  currency text,
  negotiable boolean,
  views bigint,
  created_at timestamptz,
  updated_at timestamptz,
  skins int,
  prems int,
  limited int,
  anims int,
  bpass int,
  level int,
  vp int,
  rp int,
  kc int,
  crank_name text,
  prank_name text,
  crank_icon text,
  prank_icon text,
  vlogin text,
  tag text,
  link text,
  wtr text,
  receipts text,
  owner text,
  picks_top jsonb,
  featured boolean,
  sold_at timestamptz,
  thumb_src text,
  thumb_label text
)
language sql security definer set search_path = public stable as $$
  select l.slug,
         coalesce(nullif(l.payload->'texts'->>'cname', ''), nullif(l.payload->'texts'->>'code', ''), l.slug),
         coalesce(l.payload->'texts'->>'code', ''),
         l.theme,
         l.price,
         l.currency,
         l.negotiable,
         l.views,
         l.created_at,
         l.updated_at,
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
         ), '{}'::jsonb),
         (l.featured_at is not null),
         l.sold_at,
         l.payload -> 'thumb' ->> 'src'    as thumb_src,
         l.payload -> 'thumb' ->> 'label'  as thumb_label
  from public.listings l
  where l.status = case
                     when coalesce(p_status, 'available') in ('available','pending','sold')
                     then coalesce(p_status, 'available') else 'available' end
    and not l.archived
  order by (case when coalesce(p_status,'available') = 'sold' then l.sold_at else l.updated_at end) desc nulls last,
           l.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 60), 200))
  offset greatest(0, coalesce(p_offset, 0))
$$;

grant execute on function public.browse_listings_v3(integer, integer, text) to anon, authenticated;