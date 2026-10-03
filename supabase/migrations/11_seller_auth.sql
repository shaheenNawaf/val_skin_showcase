-- 11_seller_auth.sql — v1.3.1 single-seller gate
-- create_listing now requires an authenticated JWT whose email is in the
-- private seller_emails allow-list. Signature unchanged (auth rides the JWT),
-- so this is a pure CREATE OR REPLACE. Idempotent; safe to re-run.

-- ── Seller allow-list (private: RLS on, no policies, all grants revoked →
--    readable only inside security-definer functions) ──────────────────
create table if not exists public.seller_emails (
  email      text primary key,
  created_at timestamptz not null default now()
);
alter table public.seller_emails enable row level security;
revoke all on public.seller_emails from anon, authenticated;

-- ── Client UX probe: is the current caller a registered seller? ────────
create or replace function public.am_i_seller() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select auth.role()), '') = 'authenticated'
     and exists (
           select 1 from public.seller_emails s
            where lower(s.email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
         );
$$;
grant execute on function public.am_i_seller() to anon, authenticated;

-- ── Gated create_listing (same signature; gate checks prepended,
--    existing validation + insert verbatim) ─────────────────────────────
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
grant execute on function public.create_listing(text, text, jsonb, text) to anon, authenticated;