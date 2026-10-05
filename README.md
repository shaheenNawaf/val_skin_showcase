# CardForge

Valorant inventory showcase cards for skin sellers: compose a 1920×1080 trade card of your skins, ranks and stats, export it as a 4K PNG, or publish it as a shareable listing link with a live viewer counter.

No framework — plain HTML/CSS/JS, staged into `dist/` by a tiny build script and served statically.

## Features

- **Card editor** (`build.html`): per-category skin picker (data from the community API [valorant-api.com](https://valorant-api.com)) with per-skin level (L1–L5) and color-variant badges — level 2+ marks animated skins, current/peak rank picker, avatar / gun buddies / player card uploads (resized client-side), editable texts, 5 themes, auto-count of premium-tier and animated skins.
- **PNG export** at 3840×2160 via html-to-image (foreignObject render of computed styles).
- **Drafts**: save/load the full structured card to localStorage (old `vcard-builder-v1` drafts migrate automatically).
- **Publishing** (`view.html`): publishes the card as a listing; share links work cross-device when Supabase is configured, per-browser otherwise. Viewers see a live "viewing now" counter (Supabase Realtime, or BroadcastChannel locally), a total-views counter and a contact-seller button. Republish/update works via a locally-stored edit token.
- **Backend** (optional): Supabase Postgres + RLS + edge function that syncs the skin catalog nightly. See [SETUP.md](SETUP.md).

## v1.3 — personal marketplace close-out

- **Owner dashboard** (`dashboard.html`): lists every listing whose recovery key lives in this browser's localStorage, with On sale / Sold / Archived tabs; per-row Open, Edit, Mark sold / Relist, Feature, Bump, Price, Copy FB post, FB link, Copy link, Archive, Delete; header stats On sale / Sold / Total views / Sold value / Avg days to sell; recovery-key import. Reach it from the editor's **More** menu → **My accounts**.
- **Sold gallery** (`sold.html`): an unlisted past-sales gallery (`noindex`, intentionally not linked from the marketplace) the owner shares as proof of completed sales.
- **Owner lifecycle** (viewer page, owner mode): Mark sold / Relist, Feature / Unfeature, Bump, inline Price panel (amount + currency USD/EUR/GBP/JPY + OBO), and FB link attach. Buyers see a "See the Facebook post" button when the listing has an FB link.
- **Facebook tooling**: `fbPostText(row, url)` in `js/shared.js` generates the Facebook group post text, used by Copy FB post.
- **Browse**: the featured tile prefers the owner-pinned listing (falls back to most-viewed); `js/browse.js` prefers `browse_listings_v3` and falls back to v2/legacy.
- **QR exports**: full-height PNG exports carry a QR footer strip linking to the live listing; publish share JPEGs intentionally omit it so the og:image aspect stays 3840×2160.
- **Database** (`supabase/migrations/10_lifecycle.sql`): `sold_at` / `featured_at` / `fb_post_url` columns, `owner_set_listing` + `browse_listings_v3` RPCs, and a rebuilt `listing_public` view. See [SETUP.md](SETUP.md).

## v1.3.1 — single-seller gate

- **Single-seller gate**: publishing (`create_listing`) now requires a Supabase magic-link session whose email is in the private `seller_emails` allow-list; an `am_i_seller()` probe RPC reports eligibility.
- **Sign-in screen**: visitors to the editor (`build.html`, then `index.html`) see a sign-in overlay instead of the editor; sign-out lives in the editor's ⋯ menu. (v1.5 moved sign-in's front door to a **Log in** modal on the marketplace and hid the magic-link button behind `?magic=1`.)
- **Public build links removed**: the "Build a card" links were removed from browse / terms / privacy / 404.
- **Recovery-key editing unchanged**: `?edit=<slug>` editing needs no sign-in, and update/delete/archive/owner actions stay per-listing token-gated.
- **Database** (`supabase/migrations/11_seller_auth.sql`): private `seller_emails` allow-list, `am_i_seller()` probe, and the `create_listing` gate. See [SETUP.md](SETUP.md).

## v1.5 — marketplace-first landing

- **The marketplace is the front door**: `index.html` now serves the public browse page; the card editor moved to `build.html`. The root URL never shows a login wall. `_redirects` 301s legacy `/browse.html` → `/` and old `index.html?edit=…` recovery links → `build.html?edit=…`.
- **Log in button** (marketplace, top-right): a password-only sign-in modal. Sellers land on the dashboard; signed-in non-sellers get an explained state with sign-out. Recognised sellers see New card / My accounts / Sign out in the topbar instead.
- **Magic link out of public view**: the "Email me a sign-in link" button is hidden on all three sign-in surfaces and reappears only when the page URL carries `?magic=1` — a recovery hatch so password-less sellers can never be locked out.

## Project structure

```
index.html              Marketplace (public browse page — the front door)
build.html              Card editor page
view.html               Listing viewer page (?slug=<id>)
terms.html              Terms of Service
privacy.html            Privacy Policy
css/                    shared.css (tokens/themes/card), editor.css, viewer.css, browse.css, legal.css
js/config.js            Supabase URL + anon key (safe to commit; RLS-protected)
js/shared.js            Shared helpers (themes, catalog, scaling, export, presence)
js/editor.js            Editor logic
js/viewer.js            Viewer logic
js/vendor/              Vendored html-to-image + supabase-js (no runtime CDNs)
scripts/copy-static.mjs Netlify build step: stages everything into dist/
supabase/schema.sql     Initial schema (listings, skins, RPCs, RLS)
supabase/migrations/    Incremental changes (run after schema.sql)
supabase/functions/     skin-sync edge function
```

## Develop

```bash
npm install
npm run dev        # http://localhost:3000 (no-cache, picks up edits live)
npm run lint       # eslint
npm run build      # stage into dist/ (what Netlify deploys)
```

## Deploy

Netlify: build command `node scripts/copy-static.mjs`, publish directory `dist/` (see `netlify.toml`).

For public share links, fill in `SUPABASE_URL` / `SUPABASE_ANON_KEY` in `js/config.js` and run the Supabase setup in [SETUP.md](SETUP.md). Without them the app still works fully — listing links just open only in the browser that published them.

### Staging (branch deploys)

Production (`cardforge.shaheen.works`) deploys from the **`main`** branch. Every other branch you push gets its own automatic **staging URL** — no per-branch setup.

One-time enable in the Netlify dashboard:

1. **Project configuration → Developer settings → Continuous deployment → Branches and deploy contexts** → *Configure* → next to **Branch deploys** choose **All** (or *Let me add individual branches* for specific ones — wildcards like `features/*` work) → **Save**.
2. Confirm the production branch is `main` in that same **Branches and deploy contexts** section.

Then pushing a branch `foo` deploys it to `https://foo--cardforge-showcase.netlify.app` (Netlify prints the exact URL in the deploy log and lists it under *Deploys*). Merging `foo` → `main` updates production. Recommended flow: work on a feature branch (auto-staging — test it), then merge to `main` to release.

Live environments:

| Environment | URL | Branch | Footer badge |
|---|---|---|---|
| Production | https://cardforge.shaheen.works | `main` | none |
| Staging | https://staging--cardforge-showcase.netlify.app | `staging` | orange **STAGING** |
| Beta | https://beta--cardforge-showcase.netlify.app | `beta` | purple **BETA** |

### Version stamp

Every built page carries a small stamp — in the footer bar on desktop, floating just above it on mobile — injected at build time by `scripts/copy-static.mjs`:

```
v1.0.0 · e02ca52 · 2026-09-26 · main
```

= `package.json` version · git short SHA · build date (UTC) · branch. On non-production deploys a colored badge precedes it: **STAGING** (orange, branch deploy), **BETA** (purple, the `beta` branch), **PREVIEW** (blue, PR deploy preview), **LOCAL** (grey, `npm run build` on your machine). Production shows no badge. The stamp lives only in `dist/` (source files stay clean, so it never dirties git) and is hidden during PNG export.

To bump the released version, edit `"version"` in `package.json`. To preview the stamp locally: `npm run build && npx http-server dist`.

## Card layouts (density modes)

- **M1 Tiles (default and the only AUTO result):** category panels; panels flip from rows to tile grids with `+N MORE` chips when rows would get unreadable.
- **M2 Showcase (optional):** top-N skins per category as named rows, overflow deferred to a `+N MORE` chip.

**Auto rule:** AUTO always resolves to M1. Sellers override per listing via the editor's layout selector (AUTO / TILES / SHOWCASE); the choice is stored in the listing payload. On published listings and in the marketplace quick view, buyers see **every** skin: each category panel scrolls independently (per-category scroll), so nothing is clipped. The exported PNG remains a single 1920×1080 image with capped top-N panels and inert `+N MORE` chips.

The former **M4 Catalog** spread layout (mosaic overview + justified pages + ZIP export) was removed in v1.2.0. Legacy drafts/listings stored with `layout:'m4'` and `?view=m4` deep links fall back to TILES.

Prototypes and measurement history: `prototypes/density.html` (harness) and `UIUX-AUDIT.md`.

## Notes & limitations

- Listings carry no authentication: anyone with the share link can view (by design); only the browser holding the edit token can update a listing.
- The `create_listing` RPC is anon-executable with validation but no rate limiting — see [AUDIT.md](AUDIT.md) for the known-risk list and roadmap.
- CardForge is not affiliated with Riot Games.
