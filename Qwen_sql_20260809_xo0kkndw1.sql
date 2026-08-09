-- Phase 0 foundations
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;   -- fuzzy matching for Phase 2 auto-import
create extension if not exists pg_net;    -- cron -> edge function calls

-- ── Skin catalog (synced nightly from community API) ─────────────
create table if not exists public.skins (
  uuid      text primary key,
  weapon    text not null,
  category  text not null,
  name      text not null,
  tier      text,
  icon_url  text,
  synced_at timestamptz not null default now()
);
create index if not exists skins_category_idx on public.skins (category);
create index if not exists skins_name_trgm on public.skins using gin (name gin_trgm_ops);

-- ── Listings ────────────────────────────────────────────────────
create table if not exists public.listings (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  edit_token_hash text not null,          -- never exposed; writes via edge fns (service role)
  payload         jsonb not null default '{}'::jsonb,
  theme           text not null default 'slate',
  status          text not null default 'available'
                  check (status in ('available','pending','sold')),
  price           numeric,
  currency        text,
  negotiable      boolean not null default true,
  inventory_hash  text,
  watermark       boolean not null default true,
  views           bigint not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger listings_touch before update on public.listings
for each row execute function public.touch_updated_at();

-- Public read surface (hides edit_token_hash). View runs as owner → bypasses RLS by design.
create or replace view public.listing_public as
select id, slug, payload, theme, status, price, currency, negotiable,
       inventory_hash, watermark, views, created_at, updated_at
from public.listings;

-- Views counter (security definer; client dedupes per session)
create or replace function public.bump_views(p_slug text) returns bigint
language sql security definer set search_path = public as $$
  update public.listings set views = views + 1
  where slug = p_slug returning views;
$$;

-- ── RLS: reads open, writes service-role-only (edge functions) ────
alter table public.skins    enable row level security;
alter table public.listings enable row level security;
create policy skins_read on public.skins for select to anon, authenticated using (true);

grant select on public.skins to anon, authenticated;
grant select on public.listing_public to anon, authenticated;
grant execute on function public.bump_views(text) to anon, authenticated;

-- ── Nightly sync (fill placeholders, run once) ────────────────────
-- select cron.schedule('skin-sync-nightly', '0 3 * * *', $$
--   select net.http_post(
--     url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/skin-sync',
--     headers := jsonb_build_object('x-sync-secret', 'YOUR_SYNC_SECRET')
--   );
-- $$);