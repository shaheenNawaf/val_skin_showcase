-- Migration 20: the browse RPCs must never hand a listing placeholder back as
-- the listing title.
--
-- History: migration 7 added this guard to browse_listings_v2, but migrations
-- 9, 10, 14 and 15 each redefined the browse functions without it, and the
-- latest definition wins (HANDOVER.md: "reorder - this bit us in migration 9").
-- browse_listings_v3 - the one the frontend calls (js/browse.js:1304,
-- js/sold.js:21) - has therefore run with NO guard since migration 10.
--
-- Two placeholders are in play:
--   'CHANGE NAME'          - the old editor default, still stored on live rows
--   'ACCOUNT DESCRIPTION'  - the new editor default. Sellers write the listing
--                            title/description into this field, so a card left
--                            on the default has no real title.
--
-- Read-time only: no rows are rewritten. A placeholder cname falls through to
-- the listing code, then the slug - exactly what migration 7 intended. This is
-- the SQL half of the rule whose client half is CF.isPlaceholderTitle()
-- (js/shared.js), which normalises case, whitespace and trailing punctuation.
-- Kept deliberately simple here: the exact-match literals cover both defaults,
-- which is what the editor actually ships.
--
-- Bodies below are copied VERBATIM from 15_browse_vlink.sql (v3) and
-- 9_archive_delete.sql (v2, v1). The ONLY change in each is the title
-- expression. Do not "tidy" anything else in these functions here - a
-- create or replace on a returns-table function fails outright if the OUT
-- column list drifts.
--
-- Run after 19_theme_standard.sql. Idempotent.

-- ── browse_listings_v3 ────────────────────────────────────────────
-- Dropped and recreated, not replaced: a function's OUT columns cannot change
-- via CREATE OR REPLACE, so this is how the house pattern handles v3
-- (15_browse_vlink.sql:7-9). browse.js falls back v3 -> v2 on any error, so
-- either side of the swap is safe.
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
  thumb_label text,
  vlink text
)
language sql security definer set search_path = public stable as $$
  select l.slug,
         coalesce(
           nullif(
             nullif(
               nullif(btrim(l.payload->'texts'->>'cname'), ''),
               'CHANGE NAME'
             ),
             'ACCOUNT DESCRIPTION'
           ),
           nullif(l.payload->'texts'->>'code', ''),
           l.slug
         ),
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
         l.payload -> 'thumb' ->> 'label'  as thumb_label,
         coalesce(l.payload->'texts'->>'vlink', '') as vlink
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

-- ── browse_listings_v2 ────────────────────────────────────────────
-- Fallback path when v3 errors (js/browse.js:1305). Body verbatim from
-- 9_archive_delete.sql:102-186.
create or replace function public.browse_listings_v2(
  p_limit int default 60,
  p_offset int default 0
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
  picks_top jsonb
)
language sql security definer set search_path = public stable as $$
  select l.slug,
         coalesce(
           nullif(
             nullif(
               nullif(btrim(l.payload->'texts'->>'cname'), ''),
               'CHANGE NAME'
             ),
             'ACCOUNT DESCRIPTION'
           ),
           nullif(l.payload->'texts'->>'code', ''),
           l.slug
         ),
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
         ), '{}'::jsonb)
  from public.listings l
  where l.status = 'available' and not l.archived
  order by l.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 60), 200))
  offset greatest(0, coalesce(p_offset, 0))
$$;

grant execute on function public.browse_listings_v2(int, int) to anon, authenticated;

-- ── browse_listings (v1) ──────────────────────────────────────────
-- Second fallback (js/browse.js:1347). Body verbatim from
-- 9_archive_delete.sql:64-90.
create or replace function public.browse_listings(
  p_limit int default 60,
  p_offset int default 0
) returns table (
  slug text,
  title text,
  code text,
  theme text,
  views bigint,
  skins int,
  updated_at timestamptz
)
language sql security definer set search_path = public stable as $$
  select l.slug,
         coalesce(
           nullif(
             nullif(
               nullif(btrim(l.payload->'texts'->>'cname'), ''),
               'CHANGE NAME'
             ),
             'ACCOUNT DESCRIPTION'
           ),
           nullif(l.payload->'texts'->>'code', ''),
           l.slug
         ) as title,
         coalesce(l.payload->'texts'->>'code', '') as code,
         l.theme,
         l.views,
         coalesce((select sum(jsonb_array_length(e.value))::int
                   from jsonb_each(coalesce(l.payload->'picks', '{}'::jsonb)) as e), 0) as skins,
         l.updated_at
  from public.listings l
  where l.status = 'available' and not l.archived
  order by l.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 60), 200))
  offset greatest(0, coalesce(p_offset, 0))
$$;

grant execute on function public.browse_listings(int, int) to anon, authenticated;