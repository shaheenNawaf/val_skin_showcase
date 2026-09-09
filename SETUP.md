# Supabase setup

Required only for cross-device share links, live presence and view counts. The app works without it (localStorage-only mode).

## 1. Create the schema

In the Supabase SQL editor, run:

1. `supabase/schema.sql` — tables, views, RPCs, RLS.
2. `supabase/migrations/2_listings_hardening.sql` — validated `create_listing`, token-checked `update_listing`.

## 2. Point the app at your project

Edit `js/config.js`:

```js
window.CARDFORGE_CONFIG = {
  SUPABASE_URL: 'https://<project-ref>.supabase.co',
  SUPABASE_ANON_KEY: '<anon public key>'
};
```

The anon key is a public identifier protected by RLS — safe to commit. Never put the service-role key in this file.

## 3. Skin catalog sync (optional)

The editor loads its catalog directly from valorant-api.com. The `skins` table is only needed for future server-side search.

```bash
supabase functions deploy skin-sync --project-ref <project-ref> --no-verify-jwt
supabase secrets set SYNC_SECRET=<random-32-char>
curl -X POST https://<project-ref>.supabase.co/functions/v1/skin-sync \
  -H "x-sync-secret: <random-32-char>"
# → {"ok":true,"synced":~1500}
```

Nightly cron (optional, run once in the SQL editor — fill in the placeholders):

```sql
select cron.schedule('skin-sync-nightly', '0 3 * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/skin-sync',
    headers := jsonb_build_object('x-sync-secret', '<random-32-char>')
  );
$$);
```

## 4. Verify

- `index.html` → Publish listing → status shows "Published!" and the link is copied.
- Open the copied `view.html?slug=…` link in a different browser/incognito — the card should render and the viewer counter should tick.
