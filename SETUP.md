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

## 4. Riot token import (optional)

The editor's **Import account** button pulls level, rank, wallet, equipped player card/buddies and the owned-skin list straight from a seller's Riot access token (Explorant-style). Riot's private API blocks browser CORS, so the call is proxied by an edge function:

```bash
supabase functions deploy riot-import --project-ref <project-ref> --no-verify-jwt
```

How it works / safety notes:

- The seller pastes an access token (plus an optional entitlements token for wallet + owned items) into the import modal. Tokens expire in ~1h.
- The token is sent once over HTTPS to `riot-import`, used in memory against `auth.riotgames.com` / `pd.<shard>.a.pvp.net`, and **never logged, stored or published**. Only the derived snapshot (level, rank tier numbers, balances, owned UUIDs) returns to the browser.
- Without Supabase configured the button explains that the feature is unavailable; everything else keeps working in localStorage mode.
- Getting tokens: any Riot auth helper that outputs a Bearer token + entitlements JWT works (see the community docs linked from the modal). Treat tokens like passwords — anyone holding one can read the account.

## 5. Verify

- `index.html` → Publish listing → status shows "Published!" and the link is copied.
- Open the copied `view.html?slug=…` link in a different browser/incognito — the card should render and the viewer counter should tick.
