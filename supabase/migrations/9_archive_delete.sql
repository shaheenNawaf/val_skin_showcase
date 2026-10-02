-- 9_archive_delete.sql — listing lifecycle: archive (soft hide) + hard delete.
-- Run after 8_share_trust.sql. Idempotent.
--
-- Sellers need lifecycle control. Archive = soft hide: the row disappears from
-- the marketplace browse RPCs but stays readable via listing_public, so direct
-- share links and the og flow keep working (with an ARCHIVED notice in the UI).
-- Reversible. Delete = owner-only hard delete, token-checked exactly like
-- update_listing, so a seller can remove junk without touching the DB by hand.
-- Neither RPC exposes the row without proof of the edit-token hash; a wrong
-- token raises SQLSTATE 42501.

-- Soft-hide flag. Existing rows default to false (visible).
alter table public.listings add column if not exists archived boolean not null default false;

-- Public read surface now carries the flag so direct-link pages can show the
-- ARCHIVED notice. Archived rows are still selected here by design.
create or replace view public.listing_public as
select id, slug, payload, theme, status, price, currency, negotiable,
       inventory_hash, watermark, views, archived, created_at, updated_at
from public.listings;

-- Owner-only archive/unarchive. Only succeeds when the caller proves ownership
-- of the edit token (client sends the SHA-256 hex of the token it kept in
-- localStorage).
create or replace function public.set_listing_archived(
  p_slug text,
  p_edit_token_hash text,
  p_archived boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.listings
     set archived = coalesce(p_archived, false)
   where slug = p_slug
     and edit_token_hash = p_edit_token_hash;
  if not found then
    raise exception 'listing not found or edit token mismatch' using errcode = '42501';
  end if;
end;
$$;

-- Owner-only hard delete. Same edit-token proof as update_listing.
create or replace function public.delete_listing(
  p_slug text,
  p_edit_token_hash text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.listings
   where slug = p_slug
     and edit_token_hash = p_edit_token_hash;
  if not found then
    raise exception 'listing not found or edit token mismatch' using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.set_listing_archived(text, text, boolean) to anon, authenticated;
grant execute on function public.delete_listing(text, text) to anon, authenticated;

-- Marketplace browse skips archived rows. Body copied verbatim from
-- 3_browse_listings.sql with the archive filter added.
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
         coalesce(nullif(l.payload->'texts'->>'cname', ''), nullif(l.payload->'texts'->>'code', ''), l.slug) as title,
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

-- Marketplace browse v2 skips archived rows. Body copied verbatim from
-- 6_browse_listings_v2.sql (including cf_num usage and returns table) with the
-- archive filter added.
create or replace function public.cf_num(t text) returns int
language sql immutable as $$
  select nullif(regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g'), '')::int
$$;

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
         ), '{}'::jsonb)
  from public.listings l
  where l.status = 'available' and not l.archived
  order by l.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 60), 200))
  offset greatest(0, coalesce(p_offset, 0))
$$;

grant execute on function public.cf_num(text) to anon, authenticated;
grant execute on function public.browse_listings_v2(int, int) to anon, authenticated;