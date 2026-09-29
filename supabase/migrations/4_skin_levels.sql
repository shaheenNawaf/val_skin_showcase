-- Skin variant data for the catalog cache: max upgrade level + chromas
-- (same shapes the editor uses: chromas = [{uuid, label, icon, swatch, unlock}]).
-- Run after schema.sql. Idempotent.
alter table public.skins
  add column if not exists max_level int  not null default 1,
  add column if not exists chromas   jsonb not null default '[]'::jsonb;