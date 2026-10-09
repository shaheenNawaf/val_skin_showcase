# Supabase setup

Required only for cross-device share links, live presence and view counts. The app works without it (localStorage-only mode).

## 1. Create the schema

In the Supabase SQL editor, run:

1. `supabase/schema.sql` — tables, views, RPCs, RLS.
2. `supabase/migrations/2_listings_hardening.sql` — validated `create_listing`, token-checked `update_listing`.
9. `supabase/migrations/9_archive_delete.sql` — archived column, owner-only `set_listing_archived` / `delete_listing` RPCs, marketplace RPCs skip archived rows.
10. `supabase/migrations/10_lifecycle.sql` — `sold_at` / `featured_at` / `fb_post_url` columns on `public.listings`, `owner_set_listing` (edit-token-hash checked; single-featured; stamps `sold_at` on sold, clears on relist) + `browse_listings_v3` RPCs, rebuilt `listing_public` view (additive, idempotent).
11. `supabase/migrations/11_seller_auth.sql` — single-seller gate (private `seller_emails` allow-list + `am_i_seller` probe + `create_listing` requires an allow-listed magic-link session).

Apply migrations to a linked project with:

```bash
supabase db query --linked --file supabase/migrations/10_lifecycle.sql
supabase db query --linked --file supabase/migrations/11_seller_auth.sql
```

## 2. Point the app at your project

Edit `js/config.js`:

```js
window.CARDFORGE_CONFIG = {
  SUPABASE_URL: 'https://<project-ref>.supabase.co',
  SUPABASE_ANON_KEY: '<anon public key>'
};
```

The anon key is a public identifier protected by RLS — safe to commit. Never put the service-role key in this file.

- **Auth URL configuration** (seller sign-in; magic link is hidden behind `?magic=1` since v1.5): Supabase dashboard → Authentication → URL Configuration — Site URL `https://cardforge.shaheen.works`, redirect URLs `https://cardforge.shaheen.works/index.html`, `https://cardforge.shaheen.works/build.html`, `https://cardforge.shaheen.works/dashboard.html`, and the same three paths for `https://staging--cardforge-showcase.netlify.app` and `http://localhost:3000`.

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

The skins cache also stores `max_level` (highest upgrade level, 1–5), `chromas` (color variants, same shape the editor uses) and `levels` (per-level UUIDs for owned-level detection). The sync verifies every icon against media.valorant-api.com's placeholder "X" image (a real HTTP 200 the CDN serves at URLs the API populates when Riot never published the asset — Prime Guardian, the Sovereign line, and all `Standard *` defaults are affected) and falls back to the chroma/level/weapon art; standard skins resolve to the weapon's own render. The generic `catalog_cache` table caches `competitivetiers`, `buddies` and `playercards` under their keys, and the editor loads the catalog cache-first from Supabase, falling back to valorant-api.com when the cache is unavailable or incomplete. Before deploying a skin-sync that writes these columns, apply the migration:

```bash
supabase db push        # applies supabase/migrations/4_skin_levels.sql + 5_catalog_cache.sql (idempotent)
```

## 4. Riot token import (optional)

The editor's **Import account** button pulls level, rank, wallet, equipped player card/buddies, the owned-skin list and owned skin variants straight from a seller's Riot access token (Explorant-style). Riot's private API blocks browser CORS, so the call is proxied by an edge function:

```bash
supabase functions deploy riot-import --project-ref <project-ref> --no-verify-jwt
```

How it works / safety notes:

- The seller pastes an access token (plus an optional entitlements token for wallet + owned items) into the import modal; the region defaults to Auto-detect — pasting the full opt_in redirect URL (which carries an `id_token`) resolves the region via Riot's affinity service, with an all-shard progression scan as the fallback. Tokens expire in ~1h.
- The token is sent once over HTTPS to `riot-import`, used in memory against `auth.riotgames.com` / `pd.<shard>.a.pvp.net`, and **never logged, stored or published**. Only the derived snapshot (level, rank tier numbers, balances, owned UUIDs) returns to the browser.
- Without Supabase configured the button explains that the feature is unavailable; everything else keeps working in localStorage mode.
- Getting tokens: any Riot auth helper that outputs a Bearer token + entitlements JWT works (see the community docs linked from the modal). Treat tokens like passwords — anyone holding one can read the account.
- The function also returns `variantsOwned` (owned skin-variant UUIDs) used to mark owned color variants in the editor. If you deployed `riot-import` before this field existed, redeploy with the command above — the editor degrades gracefully when the field is absent.

## 5. Verify

- `build.html` → Publish listing → status shows "Published!" and the link is copied.
- Open the copied `view.html?slug=…` link in a different browser/incognito — the card should render and the viewer counter should tick.
