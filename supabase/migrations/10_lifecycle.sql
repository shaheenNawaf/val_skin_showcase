-- 10_lifecycle.sql — v1.3 personal-marketplace close-out (approved 2026-10-03)
-- Run after 9_archive_delete.sql. Idempotent. ADDITIVE ONLY:
--   * no existing RPC signature changes (browse_listings_v2 stays as the fallback)
--   * no column drops/renames; listing_public gains columns APPENDED LAST
--     (CREATE OR REPLACE VIEW cannot reorder — same constraint as migration 9)
-- Semantics note: the listings_touch trigger refreshes updated_at on ANY update,
-- so every owner_set_listing call re-sorts the listing to the top of "Newest".
-- The dashboard's explicit Bump action is simply a call with all-default params.

-- ── columns ───────────────────────────────────────────────────────
alter table public.listings add column if not exists sold_at     timestamptz;
alter table public.listings add column if not exists featured_at timestamptz;
alter table public.listings add column if not exists fb_post_url text;

-- ── public read surface: append new columns at the END ────────────
create or replace view public.listing_public as
select id, slug, payload, theme, status, price, currency, negotiable,
       inventory_hash, watermark, views, created_at, updated_at, archived,
       sold_at, featured_at, fb_post_url
from public.listings;

-- ── owner lifecycle RPC ───────────────────────────────────────────
-- Token-checked like update_listing (42501 on mismatch). NULL params KEEP the
-- current value (COALESCE semantics); explicit clears via p_clear_price /
-- fb_post_url = '' (empty string clears, any other value must be https://).
-- Status: 'sold' stamps sold_at=now() on transition; any other status clears it.
-- Featured: true = pin (unpins every other row first — single-featured
-- semantics); false = unpin. Runs in the caller's transaction, so a token
-- mismatch rolls back the unpin too.
create or replace function public.owner_set_listing(
  p_slug            text,
  p_edit_token_hash text,
  p_status          text    default null,
  p_price           numeric default null,
  p_currency        text    default null,
  p_negotiable      boolean default null,
  p_featured        boolean default null,
  p_fb_post_url     text    default null,
  p_clear_price     boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status is not null and p_status not in ('available','pending','sold') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if p_price is not null and p_price < 0 then
    raise exception 'price must be >= 0' using errcode = '22023';
  end if;
  if p_fb_post_url is not null and p_fb_post_url <> ''
     and p_fb_post_url !~ '^https://' then
    raise exception 'fb post url must start with https://' using errcode = '22023';
  end if;

  -- single-featured: unpin everything else first (rolled back if the
  -- token check below fails — same transaction)
  if p_featured = true then
    update public.listings set featured_at = null
     where featured_at is not null and slug <> p_slug;
  end if;

  update public.listings
     set status      = coalesce(p_status, status),
         sold_at     = case
                         when p_status = 'sold' and status <> 'sold' then now()
                         when p_status is not null and p_status <> 'sold' then null
                         else sold_at
                       end,
         price       = case when p_clear_price then null else coalesce(p_price, price) end,
         currency    = case when p_clear_price then null
                            else coalesce(p_currency, currency) end,
         negotiable  = coalesce(p_negotiable, negotiable),
         featured_at = case
                         when p_featured = true then coalesce(featured_at, now())
                         when p_featured = false then null
                         else featured_at
                       end,
         fb_post_url = case
                         when p_fb_post_url = '' then null
                         else coalesce(p_fb_post_url, fb_post_url)
                       end
   where slug = p_slug
     and edit_token_hash = p_edit_token_hash;

  if not found then
    raise exception 'listing not found or edit token mismatch' using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.owner_set_listing(text, text, text, numeric, text, boolean, boolean, text, boolean)
  to anon, authenticated;

-- ── browse v3: v2 + featured flag + sold_at + status filter ───────
-- NEW function (CREATE OR REPLACE cannot change a return type). v2 is left
-- untouched and remains the automatic fallback for old clients. Also serves
-- the unlisted sold gallery via p_status='sold' (ordered by sold_at then).
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
  sold_at timestamptz
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
         l.sold_at
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

grant execute on function public.browse_listings_v3(int, int, text) to anon, authenticated;