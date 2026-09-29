-- Per-level UUIDs (owned-level detection) + generic catalog cache
-- (competitivetiers / buddies / playercards) for cache-first catalog loads.
-- Run after schema.sql. Idempotent.
alter table public.skins
  add column if not exists levels jsonb not null default '[]'::jsonb;

create table if not exists public.catalog_cache (
  key       text primary key,
  data      jsonb not null,
  synced_at timestamptz not null default now()
);
alter table public.catalog_cache enable row level security;
drop policy if exists catalog_cache_read on public.catalog_cache;
create policy catalog_cache_read on public.catalog_cache
  for select to anon, authenticated using (true);
grant select on public.catalog_cache to anon, authenticated;