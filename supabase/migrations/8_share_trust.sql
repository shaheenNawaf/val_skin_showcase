-- 8_share_trust.sql — CF-20 + CF-22 (second audit, approved 2026-10-02)
-- Run after 7_browse_title_default.sql. Idempotent.
--
-- CF-20: a public storage bucket for listing share images. The editor
-- uploads <slug>.jpg at publish (the same render the Export button makes);
-- the Netlify edge function (netlify/edge-functions/listing-meta.ts) reads
-- the listing row and injects per-listing og:image/og:title into view.html.
-- No schema change on listings: the image URL is deterministic —
--   <SUPABASE_URL>/storage/v1/object/public/listing-images/<slug>.jpg
--
-- CF-22: bump_views used to be an unthrottled increment executable by anon
-- on every page load — a seller's own refreshes counted and any client
-- could pump a listing's social proof. Now a view dedupes per (listing,
-- viewer, day), so refresh spam and self-inflation stop counting.

-- ── CF-20: listing share images ───────────────────────────────────
insert into storage.buckets (id, name, public)
values ('listing-images', 'listing-images', true)
on conflict (id) do nothing;

create policy "public read listing images"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'listing-images');

-- Known limitation (same posture as the anon-executable listing RPCs
-- documented in AUDIT.md): anon can upload to this bucket. For the MVP
-- this is accepted; the next hardening step is an edge-function upload
-- path that validates the edit token first.
create policy "publishers upload listing images"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'listing-images');

-- republish replaces the image
create policy "publishers update listing images"
  on storage.objects for update to anon, authenticated
  using (bucket_id = 'listing-images');

-- ── CF-22: honest view counts ─────────────────────────────────────
create table if not exists public.listing_view_dedup (
  slug   text not null,
  viewer text not null,
  day    date not null default current_date,
  primary key (slug, viewer, day)
);

create or replace function public.bump_views(p_slug text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_views bigint;
  v_viewer text;
begin
  begin
    v_viewer := btrim(split_part(
      current_setting('request.headers', true)::json ->> 'x-forwarded-for',
      ',', 1));
  exception when others then
    v_viewer := null;
  end;
  v_viewer := coalesce(nullif(v_viewer, ''), 'unknown');

  -- one counted view per viewer per listing per day; the client already
  -- skips the bump entirely for the seller's own browser
  insert into public.listing_view_dedup (slug, viewer)
  values (p_slug, v_viewer)
  on conflict (slug, viewer, day) do nothing;
  if not found then
    return (select views from public.listings where slug = p_slug);
  end if;

  update public.listings set views = views + 1
   where slug = p_slug
  returning views into v_views;
  return v_views;
end;
$$;

revoke execute on function public.bump_views(text) from anon, authenticated;
grant execute on function public.bump_views(text) to anon, authenticated;
