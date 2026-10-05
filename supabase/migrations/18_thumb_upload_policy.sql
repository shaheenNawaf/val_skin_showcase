-- 18_thumb_upload_policy.sql — allow artwork/thumb objects in listing-images
--
-- WHY: the v1.4 re-arm (12_single_admin.sql) narrowed the seller insert/update
-- policies to name ~ '^[a-z0-9]{5,16}\.jpg$' — share images only. Every artwork
-- upload since then (editor Listing face…, dashboard THUMB) died with
-- "403 new row violates row-level security policy", silently: the editor's
-- publish toast overwrote the attach error. Artwork mode therefore never
-- attached a thumb (2026-10-05, stakeholder testing).
--
-- FIX: accept the thumb variants the client actually uploads:
--   <slug>.jpg            share image (CF-20 capture)
--   <slug>-thumb.jpg|png|webp   artwork face (editor + dashboard THUMB)
-- Seller-only (am_i_seller()) and bucket-scoped as before. Idempotent.

drop policy if exists "listing images seller insert" on storage.objects;
drop policy if exists "listing images seller update" on storage.objects;

create policy "listing images seller insert" on storage.objects
  for insert
  with check (
    bucket_id = 'listing-images'
    and name ~ '^[a-z0-9]{5,16}(-thumb)?\.(jpg|png|webp)$'
    and am_i_seller()
  );

create policy "listing images seller update" on storage.objects
  for update
  using (bucket_id = 'listing-images')
  with check (
    bucket_id = 'listing-images'
    and name ~ '^[a-z0-9]{5,16}(-thumb)?\.(jpg|png|webp)$'
    and am_i_seller()
  );
