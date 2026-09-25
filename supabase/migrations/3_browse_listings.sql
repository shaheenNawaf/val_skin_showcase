-- Public browse: list available listings (summary fields only, no payloads).
-- Run after schema.sql. Idempotent.
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
  where l.status = 'available'
  order by l.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 60), 200))
  offset greatest(0, coalesce(p_offset, 0))
$$;

grant execute on function public.browse_listings(int, int) to anon, authenticated;
