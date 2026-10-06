-- 19_theme_standard.sql — v1.5.5 "Normal" theme.
-- create_listing / update_listing whitelisted themes in SQL and silently
-- coerced anything else to 'protocol', so a Normal-theme publish stored
-- protocol (live-reproduced 2026-10-06). Both functions redefined verbatim
-- from their live definitions with only the whitelist extended.
-- Idempotent: safe to re-run.

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
  if p_theme not in ('protocol','holo','reaver','oni','arctic','standard') then
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
  if p_theme not in ('protocol','holo','reaver','oni','arctic','standard') then
    p_theme := 'protocol';
  end if;
  update public.listings
     set payload = p_payload,
         theme = p_theme
   where slug = p_slug;
end;
$$;