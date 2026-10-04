-- 12_single_admin.sql — single-admin server enforcement.
-- Run after 11_seller_auth.sql. Idempotent: every function is CREATE OR
-- REPLACE, every policy is dropped by name first, and the allow-list insert
-- is ON CONFLICT DO NOTHING.
--
-- Server-side enforcement of the one-admin posture: update_listing,
-- owner_set_listing, set_listing_archived, delete_listing, and create_listing
-- all require a signed-in, allow-listed seller session; the anon-writable
-- listing-images bucket closes; and create_listing regains its auth gate
-- (removed in the live DB for a testing window). The p_edit_token_hash
-- parameter stays on every signature for client stability, but a signed-in
-- seller is never rejected on a token mismatch — the session is the gate.
-- Buyers stay anonymous: listing_public, the browse_* RPCs, bump_views, and
-- am_i_seller() are untouched.

insert into public.seller_emails (email)
values ('contact.shaheenaladwani@gmail.com')
on conflict do nothing;

create or replace function public.update_listing(
  p_slug text,
  p_edit_token_hash text,
  p_payload jsonb,
  p_theme text default 'protocol'
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.am_i_seller() then
    raise exception 'sign-in required to manage listings' using errcode = '42501';
  end if;
  if pg_column_size(p_payload) > 8 * 1024 * 1024 then
    raise exception 'payload too large (max 8MB)' using errcode = '22023';
  end if;
  if p_theme not in ('protocol','holo','reaver','oni','arctic') then
    p_theme := 'protocol';
  end if;
  update public.listings
     set payload = p_payload,
         theme = p_theme
   where slug = p_slug;
end;
$$;

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
  if not public.am_i_seller() then
    raise exception 'sign-in required to manage listings' using errcode = '42501';
  end if;
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
   where slug = p_slug;
end;
$$;

create or replace function public.set_listing_archived(
  p_slug text,
  p_edit_token_hash text,
  p_archived boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.am_i_seller() then
    raise exception 'sign-in required to manage listings' using errcode = '42501';
  end if;
  update public.listings
     set archived = coalesce(p_archived, false)
   where slug = p_slug;
end;
$$;

create or replace function public.delete_listing(
  p_slug text,
  p_edit_token_hash text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.am_i_seller() then
    raise exception 'sign-in required to manage listings' using errcode = '42501';
  end if;
  delete from public.listings
   where slug = p_slug;
end;
$$;

drop policy if exists "publishers upload listing images" on storage.objects;
drop policy if exists "publishers update listing images" on storage.objects;
drop policy if exists "listing images seller insert" on storage.objects;
drop policy if exists "listing images seller update" on storage.objects;
drop policy if exists "listing images seller delete" on storage.objects;

create policy "listing images seller insert" on storage.objects for insert with check (bucket_id = 'listing-images' and name ~ '^[a-z0-9]{5,16}\.jpg$' and public.am_i_seller());
create policy "listing images seller update" on storage.objects for update using (bucket_id = 'listing-images') with check (bucket_id = 'listing-images' and name ~ '^[a-z0-9]{5,16}\.jpg$' and public.am_i_seller());
create policy "listing images seller delete" on storage.objects for delete using (bucket_id = 'listing-images' and public.am_i_seller());

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
  if coalesce((select auth.role()), '') <> 'authenticated' then
    raise exception 'sign-in required to publish' using errcode = '42501';
  end if;
  if not exists (
       select 1 from public.seller_emails s
        where lower(s.email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
     ) then
    raise exception 'this account is not a registered seller' using errcode = '42501';
  end if;
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

grant execute on function public.update_listing(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.owner_set_listing(text, text, text, numeric, text, boolean, boolean, text, boolean)
  to anon, authenticated;
grant execute on function public.set_listing_archived(text, text, boolean) to anon, authenticated;
grant execute on function public.delete_listing(text, text) to anon, authenticated;
grant execute on function public.create_listing(text, text, jsonb, text) to anon, authenticated;