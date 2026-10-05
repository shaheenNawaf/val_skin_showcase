-- 17_listing_audit.sql — forensic audit trail for public.listings (v1.5.1)
--
-- WHY: published listings vanished twice without any in-app delete being
-- exercised by the tester (2026-10-04 ye8ad5f; 2026-10-05 two rows during
-- stakeholder testing). Every possible deleter — the delete_listing RPC, the
-- Supabase table editor, the SQL editor, psql — leaves an identical footprint
-- (row gone, storage objects orphaned), so nothing in the schema could
-- attribute a delete. This trigger records EVERY write to listings together
-- with actor metadata. When a listing goes missing, query:
--
--   select id, at, op, slug, actor_uid, jwt_role, db_user, app_name
--   from public.listing_audit where slug = '<slug>' order by id;
--
-- Reading the trail:
--   db_user = 'authenticator' + jwt_role = 'authenticated' + actor_uid set
--       → came through the REST/RPC API as a signed-in user (actor_uid = auth user)
--   db_user = 'authenticator' + jwt_role = 'anon'
--       → anonymous API call (should never delete; delete_listing would 42501)
--   db_user = 'postgres' / app_name like 'pg-meta' or 'supabase'
--       → Supabase dashboard table editor / SQL editor / CLI
--   app_name 'pg_cron' or similar → scheduled job
--
-- Idempotent: safe to re-run. The trigger function is SECURITY DEFINER so the
-- audit insert succeeds even though anon/authenticated/service_role have no
-- grants on the audit table (reads happen via `supabase db query`, postgres
-- role, or the dashboard SQL editor).

create table if not exists public.listing_audit (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  op        text not null,
  slug      text,
  actor_uid uuid,
  jwt_role  text,
  db_user   text not null default current_user,
  app_name  text not null default current_setting('application_name', true)
);

create or replace function public.listings_audit() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid;
begin
  begin
    uid := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  exception when others then
    uid := null;
  end;
  insert into public.listing_audit (op, slug, actor_uid, jwt_role)
  values (tg_op, coalesce(new.slug, old.slug), uid,
          nullif(current_setting('request.jwt.claim.role', true), ''));
  return coalesce(new, old);
end $$;

drop trigger if exists listings_audit on public.listings;
create trigger listings_audit
  after insert or update or delete on public.listings
  for each row execute function public.listings_audit();

-- no app access: the client must never read or write the trail
revoke all on public.listing_audit from anon, authenticated, service_role;
