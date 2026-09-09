-- Run this in the Supabase SQL editor after the initial schema.sql.
-- Idempotent: safe to re-run.

-- Listings default to a theme that actually exists in the app.
alter table public.listings alter column theme set default 'protocol';

-- create_listing: validates slug format, token hash shape, payload size and
-- theme; explicit duplicate-slug error (SQLSTATE 23505) so the client can retry
-- with a fresh slug.
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

-- update_listing: only succeeds when the caller proves ownership of the edit
-- token (client sends the SHA-256 hex of the token it kept in localStorage).
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

-- Known limitation (documented in AUDIT.md): both RPCs are executable by anon
-- without auth or rate limiting. Acceptable for the MVP; next hardening step is
-- an IP-based rate-limit table or a Netlify Function proxy.
