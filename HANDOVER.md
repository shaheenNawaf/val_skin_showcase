# CardForge v1.3 — Owner's Handover Guide

Everything you need to run, sell with, and modify your personal Valorant marketplace.
Written at v1.3 (`a8e33b5`, personal-marketplace close-out).

---

## 1. What you own

| Piece | Where |
| --- | --- |
| Production site | https://cardforge.shaheen.works (deploys from `main`) |
| Staging site | https://staging--cardforge-showcase.netlify.app (deploys from `staging`) |
| Repo | https://github.com/shaheenNawaf/val_skin_showcase |
| Database + storage | Supabase project `psxpxcqrepkcrymwveok` (CLI is linked on your machine) |
| Hosting | Netlify (build: `node scripts/copy-static.mjs` → `dist/`) — production branch `main` only; the `staging`/`beta` branch deploys were retired 2026-10-05 |

It is a **static site + serverless DB**. No framework, no app server, no buyer accounts.
Pages: `index.html` (marketplace — the front door) · `build.html` (card editor) ·
`view.html?slug=…` (a listing) · `dashboard.html` (your control hub) · `sold.html`
(unlisted past-sales gallery) · terms/privacy/404.
Since v1.5 the marketplace owns the root URL and the editor lives at `build.html`;
`_redirects` 301s legacy `/browse.html` → `/` and `index.html?edit=…` → `build.html?edit=…`.

## 2. How it works (two minutes)

- **Data**: one `public.listings` table. The whole card is a `payload` jsonb column.
  The public read surface is the `listing_public` view. Published card renders live in
  the `listing-images` storage bucket as `<slug>.jpg` (that is the Facebook preview image).
- **Ownership**: no passwords. When you publish, the editor generates an **edit token**;
  only its SHA-256 hash is stored server-side. Your browser keeps the raw token in
  `localStorage` under `vc-edit-<slug>`. Every owner action calls a token-checked RPC
  (`owner_set_listing`, `set_listing_archived`, `delete_listing`, `update_listing`) —
  wrong token → rejected (error 42501).
- **The recovery key** shown once at first publish *is* that token. Slug + key = full
  control of the listing from any browser.
- **Lifecycle**: every listing has a status — `available` (on the marketplace),
  `sold` (removed from marketplace, appears on `sold.html`, keeps its full card),
  `pending` (exists in the DB/RPC but no button sets it yet). `archived` hides a
  listing everywhere without deleting it.

## 3. Daily selling workflow

1. **Create** — `build.html`: fill the card, **Publish**. Copy the recovery key into
   your password manager *immediately*; it is shown only once.
2. **Post to the Facebook group** — `dashboard.html` → **COPY FB POST** on the row →
   paste into your group post. It writes itself: title, price (or "DM me"), rank,
   premium/animated/limited counts, top 5 skins, listing link, WTR/receipts line.
3. **Link the post back** — dashboard → **FB LINK** → paste the Facebook post URL.
   Buyers now see a **"See the Facebook post"** button on the listing (social proof:
   they can read the group reactions). Clear it by saving an empty value.
4. **Price** — dashboard **PRICE** (or viewer ⋯ menu): amount, currency
   (USD/EUR/GBP/JPY), OBO checkbox (= negotiable). The price flows to the listing hero,
   marketplace cards, price filters, tab title, and FB preview.
5. **Feature** — dashboard **FEATURE** pins *one* listing as the big tile on
   `index.html`. Pinning another automatically unpins the previous. With nothing
   pinned, the most-viewed listing gets the tile (old behavior).
6. **Bump** — **BUMP** refreshes `updated_at`, pushing the listing to the top of
   "Newest" on the marketplace.
7. **Export the PNG** — the editor's export button now adds a **QR-code footer strip**
   (links to the live listing). Post that image in the group; people can scan straight
   from the picture. The uploaded FB *preview* image deliberately has no QR (its
   dimensions are baked into the og: tags).
8. **Sold** — dashboard or listing page → **MARK SOLD** → confirm. It vanishes from
   the marketplace instantly and appears on the sold gallery with a red badge,
   struck-through price, and sold date. Mistake? **RELIST**.
9. **Proof for skeptics** — `https://cardforge.shaheen.works/sold.html` is **unlisted**
   (no link from the marketplace, `noindex`). Paste it to buyers who ask for
   references/receipts.
10. **Tracking** — dashboard header stats: on sale, sold, total views, sold value
    (single-currency sums only; mixed currencies show `—`), avg days to sell.
    Tabs split On sale / Sold / Archived.

## 4. Devices, browsers, and recovery keys

- The dashboard only controls listings whose token is in **that browser's**
  localStorage. Selling from a second device? Dashboard → **IMPORT RECOVERY KEY** →
  enter slug + token.
- Deleting a listing from the dashboard also removes its local token (clean slate).
- **Lost key + lost browser = lost control** of that listing. There is no server-side
  reset (that is the privacy trade-off of zero accounts). Keep every slug + key backed up.
- Drafts live under `vc-draft-id` / draft storage in the editor; the recovery key only
  matters once published.

## 4b. Seller sign-in (password; magic link is hidden)

- **Who can publish**: only emails in the private `seller_emails` table, signed in —
  the marketplace **Log in** modal (top-right of `index.html`), the editor gate
  (`build.html`), and the dashboard gate all take email + password. The **magic link
  is out of public view since v1.5**: the "Email me a sign-in link" button is hidden
  on all three surfaces and reappears only when the page URL carries **`?magic=1`**
  (recovery hatch so OTP-only sellers can never be locked out). Everyone else is a
  viewer — the marketplace is fully browsable with no account, and anonymous visitors
  see no "New card"/"Build a card" links.
- **`?edit=` nuance**: `build.html?edit=<slug>` intentionally skips the boot gate
  (recovery-key model). If the session is missing/expired at publish time the server
  returns 42501 and the gate reopens over the intact editor state — sign in and
  publish again; nothing is lost. Legacy `index.html?edit=<slug>` URLs 301 via
  `_redirects` (plus a client-side guard in `index.html` for non-Netlify hosts).
- **One-time Supabase setup** (dashboard only, not possible from the repo):
  Authentication → URL Configuration → Site URL `https://cardforge.shaheen.works`;
  Additional redirect URLs: `https://cardforge.shaheen.works/index.html`,
  `https://cardforge.shaheen.works/build.html`,
  `https://cardforge.shaheen.works/dashboard.html`,
  `http://localhost:3000/index.html`, `http://localhost:3000/build.html`,
  `http://localhost:3000/dashboard.html`.
  (The `staging--cardforge-showcase.netlify.app` entries are gone with the retired
  branch deploys — re-add them only if branch deploys are ever re-enabled.)
  (Magic-link requests ask for `emailRedirectTo=<the page you are on>`; without the
  allow-list entry for that page Supabase falls back to the Site URL — the session
  still works, the seller just lands on the marketplace instead of where they
  started. The marketplace detects a magic-link return and forwards sellers to the
  dashboard.) Optionally disable "Allow new users to sign up" (the allow-list gates
  publishing either way).
- **Registering a seller email** (once per seller):
  `supabase db query --linked -q "insert into public.seller_emails (email) values ('seller@example.com') on conflict do nothing"`
  — or run it in the Supabase SQL editor. Rotating/removing a seller = delete/insert
  rows in `seller_emails`; takes effect on their next publish attempt.
- **Stakeholder onboarding**: open `https://cardforge.shaheen.works/` → **Log in**
  (top-right) → seller email + password → you land on the dashboard; **New card**
  opens the editor (session persists in that browser; sign out via the marketplace
  topbar, the dashboard header, or the editor's ⋯ menu). New device/browser: repeat
  sign-in, then import per-listing recovery keys via the dashboard as before.
- **Demo stakeholder account**: `stakeholder@cardforge.test` — password login only
  (no inbox, so the magic link won't work for it). Credentials + revoke one-liners:
  `supabase/migrations/16_stakeholder_admin.sql` (rev 2 — allow-list SQL + GoTrue
  admin-API recipe). **Never hand-insert into `auth.users`**: GoTrue ≥2.197 cannot
  scan hand-made rows and 500s login/user-list until they're deleted.
- **Seller #3 (klyndonsuico@gmail.com)**: their invite-link password setup dead-ended twice
  (the pre-fix Site URL era), so on 2026-10-06 a password was set directly via the GoTrue admin
  API and verified with a real sign-in (the credential lives with the owner, not in this repo).
  If they ever forget it: Supabase dashboard → Auth → that user → set a new one (or the
  `?magic=1` magic-link hatch).
- **SMTP**: magic-link emails use Supabase's built-in SMTP (low hourly limit — fine
  for one seller); configure custom SMTP under Supabase Auth settings if that ever
  changes.
- **Resolved 2026-10-05**: the old anon upload/overwrite hole in `listing-images` is
  closed — re-applying `12_single_admin.sql` made bucket insert/update/delete
  seller-only (`am_i_seller()`); anon attempts get 403. No edge-function upload path
  needed for V1.

## 4c. Artwork listings, deletes, and disappearance forensics

- **Artwork mode** (a listing whose face is an uploaded image instead of the skin
  card): chosen once at creation via the route gate (**Artwork** vs **Normal card**).
  Since v1.5.2 artwork is a **dedicated surface** — the card editor chrome steps
  aside (`body.art-mode`) and a self-contained panel takes the stage: upload +
  preview, listing fields, and a Publish button that stays disabled until an image
  is present. Re-opening an artwork listing (`?edit=` or dashboard Edit) returns to
  that same panel, hydrated. The artwork doubles as the share/FB embed image
  (`slug.jpg`) and the thumb (`slug-thumb.*`); the dashboard row's **THUMB** panel
  can still swap it later. Normal card mode is unchanged.
- **Deletes**: `delete_listing` (dashboard row ⋯ → Delete, or viewer owner menu)
  requires typing `DELETE` and the per-listing edit token. Since v1.5.1 both flows
  also remove the listing's storage objects best-effort (`slug.jpg`,
  `slug-thumb.{jpg,png,webp}`) — before that, every delete left orphans behind,
  which made "vanished" and "deleted" indistinguishable in the bucket.
- **If a listing ever vanishes unexpectedly**: migration 17 keeps a forensic trail.
  `select id, at, op, slug, actor_uid, jwt_role, db_user, app_name from
  public.listing_audit where slug = '<slug>' order by id;` (postgres role only —
  `supabase db query --linked` or the dashboard SQL editor; the app has no grants).
  `db_user = 'authenticator'` + `jwt_role = 'authenticated'` + `actor_uid` = an API
  call by that auth user; `db_user = 'postgres'` with `app_name` like `pg-meta` =
  the Supabase table/SQL editor; `pg_cron`-style `app_name` = a scheduled job.
  Nothing else can delete a row: no triggers beyond `listings_touch` (updated_at),
  no webhooks, one cron job (`skin-sync-nightly`, 03:00, catalog only).

## 5. Changing things (dev + deploy)

```bash
npm install
npm run dev      # local server on http://localhost:3000
npm run lint     # eslint (must stay clean)
npm run build    # stages dist/ exactly like Netlify does
```

**Deploy flow** (since the staging/beta branch deploys were retired 2026-10-05):

```bash
git checkout staging          # develop here (or a feature branch)
# ...commit...
# verify locally: npm run dev + test against http://localhost:3000
# (playwright; the shared Supabase backend makes local tests fully representative)
git checkout main && git merge --ff-only staging && git push origin main   # prod
git checkout staging
```

Pushes to `staging`/`beta` no longer produce preview URLs. If a preview environment
is ever wanted again: Netlify → Site configuration → Build & deploy → Deploy
contexts → Branch deploys → re-add the branch (the `_redirects` file and build
script already handle any branch).

**Database migrations**: numbered files in `supabase/migrations/` (10 =
`10_lifecycle.sql`, the v1.3 lifecycle schema). They are idempotent and applied
manually:

```bash
supabase db query --linked --file supabase/migrations/NN_name.sql
```

Migration rules the codebase depends on:
- `listing_public` columns must be **appended last** (`CREATE OR REPLACE VIEW` cannot
  reorder — this bit us in migration 9).
- Owner RPCs are `security definer`, token-hash checked, raise 42501 on mismatch.
- Only one listing can be featured (`owner_set_listing` unpins others in the same
  transaction).

**Edge function** `netlify/edge-functions/listing-meta.ts` rewrites og:/twitter: tags
per listing for Facebook/crawler previews (both `/l/<slug>` and `/view.html?slug=`
shapes). It needs two Netlify env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
(values in `js/config.js`).

**Conventions worth keeping**: design tokens live at the top of `css/shared.css`
(no border-radius anywhere, chamfered `clip-path` controls, `#status` toasts);
`captureCardBlob()` in `js/shared.js` is the single choke point for *all* image
captures (export + publish) — never fork it; vendor libs go in `js/vendor/` with
their license file (no CDNs at runtime). Card fonts (Anton, Chakra Petch) must
stay **same-origin** (`css/fonts.css`): the export inlines `@font-face` by reading
`cssRules`, which cross-origin sheets block — a CDN font link silently degrades
every PNG to fallback metrics. Export fidelity is regression-guarded by
`npm run check:export`.

## 6. Current state + known follow-ups

Shipped and verified (staging + production regression, 26-step QA log, visual QA):
dashboard, sold/relist, feature pin, bump, prices, FB post tools, sold gallery,
QR exports, viewer owner controls. Lint clean, build clean, migration 10 applied.

1. **`og:title` on production falls back to generic text.** The per-listing
   `og:image` (your card render) injects correctly — FB previews *do* show the card —
   but the edge function's Supabase lookup returns nothing. Suspected cause: the
   `SUPABASE_ANON_KEY` env var on Netlify is stale. Fix: Netlify → Site settings →
   Environment variables → compare with `js/config.js` → update → redeploy.
2. **PNG export fidelity (was: "12 benign console errors")** — the console errors were
   never benign: html-to-image could not read the cross-origin Google Fonts
   `cssRules`, so no `@font-face` reached the export and every glyph fell back to
   the generic sans (+13 %/+42 % width drift → truncated ranks, wrapped labels).
   Fixed by plan 006: Anton + Chakra Petch are vendored same-origin
   (`fonts/`, `css/fonts.css`, regenerate via `scripts/fetch-fonts.mjs`), the
   capture pins the grid to its live 1080 geometry instead of unfolding it, and
   failed icon fetches retry once then surface a warning instead of a silent
   blank. Guarded by `npm run check:export` (5 assertions: font drift < 2 %,
   geometry identity during capture, blob dims = download name).
3. **Export filename rounding** — fixed by plan 006: the name now comes from the
   real raster (`blobDims`), e.g. `showcase-card-3840x2440.png` (1920×1080 card at
   2× plus the QR band below the crop).
4. **Not built (roadmap fodder)**: `pending` status button, price-history badge,
   offers/negotiation inbox, an `events` table for real analytics, magic-link auth
   for multi-device ownership. See `ROADMAP.md`.
5. **v1.5.5 mechanics worth knowing**: the marketplace and dashboard re-fetch when you switch
   back to a long-hidden tab (the "my new listing isn't there" fix) and the featured listing also
   appears in the grid; the card's 4th stat is BATTLEPASS — its count comes from a vendored skin
   UUID set (`js/vendor/bp-skins.js`, regenerate per act with `node scripts/gen-bp-skins.mjs`),
   and listings published before v1.5.5 show 00 until re-published; the sixth theme swatch
   "Normal" (`standard`) is the tier for regular accounts.
6. **Versioning**: the footer stamp shows only the semver (`v1.5.6` at the time of writing) —
   the commit/branch/date live in its hover title. Since the number is now the only visible
   identifier, **bump `package.json`'s `version` with every release** (it had been pinned at
   1.5.0 since the v1.5.0 release).

## 7. Where things live

| You want… | Go to |
| --- | --- |
| Feature history / what shipped when | `ROADMAP.md` |
| Env setup, Supabase/Netlify wiring | `SETUP.md` |
| Project overview | `README.md` |
| Design decisions + prototypes | `design-plans/`, `prototypes/` |
| DB schema truth | `supabase/migrations/` (latest wins) |
| FB preview logic | `netlify/edge-functions/listing-meta.ts` |
| Capture/export + FB post text | `js/shared.js` (`captureCardBlob`, `fbPostText`) |
| Export fidelity regression harness | `scripts/check-export.mjs` (`npm run check:export`) |
| Vendored card fonts | `fonts/` + `css/fonts.css` (`scripts/fetch-fonts.mjs`) |
| Buyer page + owner controls | `js/viewer.js` |
| Your hub | `js/dashboard.js` |
| Marketplace (featured tile, filters) | `js/browse.js` |
| v1.3 QA evidence | `.orchestrator/` (local only, gitignored) |
