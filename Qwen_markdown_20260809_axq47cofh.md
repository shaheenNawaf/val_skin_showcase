# Setup (Phase 0)

## 1. Repo
- git init; push to GitHub. Structure:
  /index.html (current prototype — site works immediately on deploy)
  /supabase/schema.sql
  /supabase/functions/skin-sync/index.ts
  /ROADMAP.md /SETUP.md /POSITIONING.md /CONTRACT_CLAUSES.md

## 2. Supabase
- Create project (free tier). Copy: URL, anon key, service role key.
- SQL Editor → run schema.sql.
- Deploy function: `supabase init` → `supabase link --project-ref <ref>`
  → `supabase functions deploy skin-sync --no-verify-jwt`
  → `supabase secrets set SYNC_SECRET=<random-32-char>`
  (Or paste index.ts into Dashboard → Edge Functions, add SYNC_SECRET secret.)
- Uncomment + fill the cron.schedule block in schema.sql, run it.

## 3. Verify
- curl -H "x-sync-secret: <secret>" https://<ref>.supabase.co/functions/v1/skin-sync
  → {"ok":true,"synced":~1500}
- Table editor → skins row count > 0.

## 4. Hosting
- Vercel or Netlify → import repo (static, no build cmd). Deploy.
- Custom domain: add in dashboard, point DNS (A/CNAME), HTTPS auto.
- Env placeholders for Phase 1: SUPABASE_URL, SUPABASE_ANON_KEY (exposed to client by design).