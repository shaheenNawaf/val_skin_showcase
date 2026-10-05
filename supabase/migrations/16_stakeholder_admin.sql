-- 16_stakeholder_admin.sql — dummy stakeholder admin account (2026-10-05, rev 2)
-- Allow-lists a demo seller so stakeholders can exercise owner surfaces once
-- 12_single_admin.sql re-arms the gate. No inbox needed: the account uses the
-- password path, which works on BOTH the editor (#authGate) and the dashboard
-- (#dgate) as they ship today — deliberately side-stepping the dashboard's
-- missing OTP fallback. Magic link will NOT work for it (address gets no mail).
--
-- ── WHY THIS FILE NO LONGER INSERTS INTO auth.users ────────────────────────
-- Rev 1 hand-crafted the auth.users row (instance_id/crypt/gen_salt recipe).
-- On GoTrue v2.197 that row POISONED the auth schema: password login returned
-- 500 "Database error querying schema" and /auth/v1/admin/users returned 500
-- "Database error finding users" — GoTrue cannot scan a row it didn't create
-- (columns it populates on signup stay NULL). Verified 2026-10-05: a user
-- created through the admin API logs in fine; the hand-inserted row does not.
-- Lesson: NEVER hand-insert into auth.users. Use the GoTrue admin API.
--
-- ── RECIPE (run once; ~1 min) ───────────────────────────────────────────────
-- STEP 1 — SQL editor: run this file (allow-list only; idempotent).
-- STEP 2 — if rev 1 was ever run, remove the poisoned row first (SQL editor):
--            delete from auth.users where email = 'stakeholder@cardforge.test';
-- STEP 3 — create the user via admin API (PowerShell, from repo root):
--            $sk = ((supabase projects api-keys --project-ref psxpxcqrepkcrymwveok
--                   | Out-String | ConvertFrom-Json).keys |
--                   ? { $_.type -eq 'legacy' -and $_.name -eq 'service_role' }).api_key
--            Invoke-RestMethod -Method Post -Uri `
--              'https://psxpxcqrepkcrymwveok.supabase.co/auth/v1/admin/users' `
--              -Headers @{apikey=$sk; Authorization="Bearer $sk"} `
--              -ContentType 'application/json' -Body (@{
--                email='stakeholder@cardforge.test';
--                password='CardForge-Demo-2026!';   -- dummy creds by design; rotate/revoke before launch
--                email_confirm=$true;
--                user_metadata=@{full_name='Stakeholder (demo admin)'}
--              } | ConvertTo-Json -Depth 4)
-- STEP 4 — verify: POST /auth/v1/token?grant_type=password with the creds → 200;
--          then rpc/am_i_seller with that JWT → true.
--
-- RUN ORDER for V1 closeout (unchanged): this file → 12_single_admin.sql →
-- remove the 4 client GATE_DISABLED guards (grep 'TEMP 2026-10-04').
-- 2+3 belong together: re-arming the server while the staging client still has
-- the guards produces the publish dead-end (42501 with no gate to sign in
-- through).

-- ── Allow-list (the only part that belongs in SQL) ─────────────────────────
insert into public.seller_emails (email)
values ('stakeholder@cardforge.test')
on conflict (email) do nothing;

-- VERIFY ────────────────────────────────────────────────────────────────────
-- select * from public.seller_emails;   -- expect owner + stakeholder rows
-- Then in an incognito window: open the marketplace (site root) → Log in
-- (top-right) → email + password → dashboard; or build.html → gate → editor
-- unlocks; dashboard.html → owner view. (Only once the client guards are gone —
-- with GATE_DISABLED the gates never render.)

-- REVOKE (end of stakeholder testing, or before public launch) ─────────────
-- delete from public.seller_emails where email = 'stakeholder@cardforge.test';
--   -- instant: am_i_seller() flips false on their next RPC (42501)
-- DELETE FROM auth.users via admin API (DELETE /auth/v1/admin/users/{id}) —
--   or SQL editor: delete from auth.users where email = 'stakeholder@cardforge.test';
--   -- (plain DELETE is safe; only GoTrue *reads* of hand-made rows break)
