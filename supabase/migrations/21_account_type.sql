-- 21_account_type.sql - project the seller-declared account type into the
-- marketplace browse RPC.
--
-- WHY: v1.6.3 splits account health from WTR. The editor writes
-- payload.texts.atype ('ACCOUNT: WITH ISSUE' / 'ACCOUNT: NO ISSUE'), and the
-- marketplace "No Issue / With Issues" facet filters on it. browse_listings_v3
-- returns a fixed column list, so a new seller fact is invisible to the
-- marketplace until it is projected here.
--
-- The column is APPENDED LAST, matching the convention set in
-- 10_lifecycle.sql ("append new columns at the END"). Every consumer reads
-- PostgREST rows by name, so adding a trailing column breaks nothing.
--
-- REPLAY SAFETY: this file only redefines a function that migration 20
-- creates, and restates the grant. CREATE OR REPLACE preserves existing
-- privileges; the grant line is kept for idempotence, as in migration 20.
-- Applying 2..21 in numeric order yields the same live state as applying 21
-- on top of today's database.
--
-- CLIENT BEHAVIOUR BEFORE THIS MIGRATION IS APPLIED: rows carry no atype, so
-- every listing reads as No Issue and the "With Issues" facet counts zero.
-- That is the documented unset policy, not a crash.

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
  vlink text,
  atype text
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
         coalesce(l.payload->'texts'->>'vlink', '') as vlink,
         coalesce(l.payload->'texts'->>'atype', '') as atype
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
