# CardForge

Valorant inventory showcase cards for skin sellers: compose a 1920×1080 trade card of your skins, ranks and stats, export it as a 4K PNG, or publish it as a shareable listing link with a live viewer counter.

No framework — plain HTML/CSS/JS, staged into `dist/` by a tiny build script and served statically.

## Features

- **Card editor** (`index.html`): per-category skin picker (data from the community API [valorant-api.com](https://valorant-api.com)), current/peak rank picker, avatar / gun buddies / player card uploads (resized client-side), editable texts, 5 themes, auto-count of premium-tier skins.
- **PNG export** at 3840×2160 via html2canvas.
- **Drafts**: save/load the full structured card to localStorage (old `vcard-builder-v1` drafts migrate automatically).
- **Publishing** (`view.html`): publishes the card as a listing; share links work cross-device when Supabase is configured, per-browser otherwise. Viewers see a live "viewing now" counter (Supabase Realtime, or BroadcastChannel locally), a total-views counter and a contact-seller button. Republish/update works via a locally-stored edit token.
- **Backend** (optional): Supabase Postgres + RLS + edge function that syncs the skin catalog nightly. See [SETUP.md](SETUP.md).

## Project structure

```
index.html              Card editor page
view.html               Listing viewer page (?slug=<id>)
browse.html             Public listings index (available listings)
terms.html              Terms of Service
privacy.html            Privacy Policy
css/                    shared.css (tokens/themes/card), editor.css, viewer.css, browse.css, legal.css
js/config.js            Supabase URL + anon key (safe to commit; RLS-protected)
js/shared.js            Shared helpers (themes, catalog, scaling, export, presence)
js/editor.js            Editor logic
js/viewer.js            Viewer logic
js/vendor/              Vendored html2canvas + supabase-js (no runtime CDNs)
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

1. **Site configuration → Build & deploy → Continuous deployment → Branch deployments** → *Enable branch deploys* → choose **All branches** (or add specific branches).
2. Confirm the **Production branch** is `main` (**Site configuration → General → Production branch**).

Then pushing a branch `foo` deploys it to `https://foo--<site-name>.netlify.app` (Netlify prints the exact URL in the deploy log and lists it under *Deploys*). Merging `foo` → `main` updates production. Recommended flow: work on a feature branch (auto-staging — test it), then merge to `main` to release.

### Version stamp

Every built page carries a small stamp — in the footer bar on desktop, floating just above it on mobile — injected at build time by `scripts/copy-static.mjs`:

```
v1.0.0 · e02ca52 · 2026-09-26 · main
```

= `package.json` version · git short SHA · build date (UTC) · branch. On non-production deploys a colored badge precedes it: **STAGING** (orange, branch deploy), **PREVIEW** (blue, PR deploy preview), **LOCAL** (grey, `npm run build` on your machine). Production shows no badge. The stamp lives only in `dist/` (source files stay clean, so it never dirties git) and is hidden during PNG export.

To bump the released version, edit `"version"` in `package.json`. To preview the stamp locally: `npm run build && npx http-server dist`.

## Notes & limitations

- Listings carry no authentication: anyone with the share link can view (by design); only the browser holding the edit token can update a listing.
- The `create_listing` RPC is anon-executable with validation but no rate limiting — see [AUDIT.md](AUDIT.md) for the known-risk list and roadmap.
- CardForge is not affiliated with Riot Games.
