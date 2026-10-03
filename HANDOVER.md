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
| Hosting | Netlify (build: `node scripts/copy-static.mjs` → `dist/`) |

It is a **static site + serverless DB**. No framework, no app server, no user accounts.
Pages: `index.html` (card editor) · `view.html?slug=…` (a listing) · `browse.html`
(marketplace) · `dashboard.html` (your control hub) · `sold.html` (unlisted past-sales
gallery) · terms/privacy/404.

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

1. **Create** — `index.html`: fill the card, **Publish**. Copy the recovery key into
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
   `browse.html`. Pinning another automatically unpins the previous. With nothing
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

## 4b. Seller sign-in (magic link)

- **Who can publish**: only emails in the private `seller_emails` table, signed in via
  a magic link on the editor page. Everyone else is a viewer (the editor shows a
  sign-in screen; no public "Build a card" links anymore).
- **One-time Supabase setup** (dashboard only, not possible from the repo):
  Authentication → URL Configuration → Site URL `https://cardforge.shaheen.works`;
  Additional redirect URLs: `https://cardforge.shaheen.works/index.html`,
  `https://staging--cardforge-showcase.netlify.app/index.html`,
  `http://localhost:3000/index.html`. Optionally disable "Allow new users to sign up"
  (the allow-list gates publishing either way).
- **Registering a seller email** (once per seller):
  `supabase db query --linked -q "insert into public.seller_emails (email) values ('seller@example.com') on conflict do nothing"`
  — or run it in the Supabase SQL editor. Rotating/removing a seller = delete/insert
  rows in `seller_emails`; takes effect on their next publish attempt.
- **Stakeholder onboarding**: open `https://cardforge.shaheen.works/index.html` →
  enter the seller email → click the magic link in the inbox → editor unlocks (session
  persists in that browser; sign out via the editor's ⋯ menu). New device/browser:
  repeat the magic link, then import per-listing recovery keys via the dashboard as
  before.
- **SMTP**: magic-link emails use Supabase's built-in SMTP (low hourly limit — fine
  for one seller); configure custom SMTP under Supabase Auth settings if that ever
  changes.
- **Known limitation (pre-existing, unchanged)**: anon can still upload/overwrite
  `<slug>.jpg` in the `listing-images` storage bucket; proper fix = edge-function
  upload path validating the edit token.

## 5. Changing things (dev + deploy)

```bash
npm install
npm run dev      # local server on http://localhost:3000
npm run lint     # eslint (must stay clean)
npm run build    # stages dist/ exactly like Netlify does
```

**Deploy flow** (the house pattern):

```bash
git checkout staging          # develop here
# ...commit...
git push origin staging       # Netlify auto-builds the staging URL — test it
git checkout main && git merge staging && git push origin main   # prod
git checkout staging
```

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
