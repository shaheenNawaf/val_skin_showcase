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
  theme           text not null default 'protocol',
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

-- ── Helper functions to create/update listings (used by app) ──────
-- Validation: slug format, token hash shape, payload size, theme whitelist.
-- Duplicate slugs surface as SQLSTATE 23505 so the client can retry.
create or replace function public.create_listing(
  p_slug text,
  p_edit_token_hash text,
  p_payload jsonb,
  p_theme text default 'protocol'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_slug !~ '^[a-z0-9]{5,16}$' then
    raise exception 'invalid slug format' using errcode = '22023';
  end if;
  if p_edit_token_hash is null or length(p_edit_token_hash) <> 64
     or p_edit_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid edit token hash' using errcode = '22023';
  end if;
  if pg_column_size(p_payload) > 8 * 1024 * 1024 then
    raise exception 'payload too large (max 8MB)' using errcode = '22023';
  end if;
  if p_theme not in ('protocol','holo','reaver','oni','arctic') then
    p_theme := 'protocol';
  end if;
  insert into public.listings (slug, edit_token_hash, payload, theme)
  values (p_slug, p_edit_token_hash, p_payload, p_theme)
  on conflict (slug) do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'slug already exists' using errcode = '23505';
  end if;
  return v_id;
end;
$$;

-- Only succeeds when the caller proves ownership of the edit token
-- (client sends the SHA-256 hex of the token it kept in localStorage).
create or replace function public.update_listing(
  p_slug text,
  p_edit_token_hash text,
  p_payload jsonb,
  p_theme text default 'protocol'
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if pg_column_size(p_payload) > 8 * 1024 * 1024 then
    raise exception 'payload too large (max 8MB)' using errcode = '22023';
  end if;
  if p_theme not in ('protocol','holo','reaver','oni','arctic') then
    p_theme := 'protocol';
  end if;
  update public.listings
     set payload = p_payload,
         theme = p_theme
   where slug = p_slug
     and edit_token_hash = p_edit_token_hash;
  if not found then
    raise exception 'listing not found or edit token mismatch' using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.create_listing(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.update_listing(text, text, jsonb, text) to anon, authenticated;

-- ── Nightly sync (fill placeholders, run once) ────────────────────
-- select cron.schedule('skin-sync-nightly', '0 3 * * *', $$
--   select net.http_post(
--     url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/skin-sync',
--     headers := jsonb_build_object('x-sync-secret', 'YOUR_SYNC_SECRET')
--   );
-- $$);