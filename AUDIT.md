# CardForge codebase audit — 2026-09

Full audit of design and functionality, followed by the remediation pass that landed in the same change. Line references point at the pre-refactor files (see git history for those versions).

## Architecture at audit time

Zero-framework static site: `index.html` (card editor + a hash-based viewer mode, all CSS/JS inline) and `view.html` (Supabase-backed listing viewer), deployed to Netlify via a copy script. A Supabase backend existed (`schema.sql`, `skin-sync` edge function) but was never reachable from the shipped pages. A third generation of the app (`src/app.js`, 729 lines) sat in the repo unreferenced.

## Findings

### Critical (broken functionality)

| # | Finding | Evidence (pre-refactor) |
|---|---------|------------------------|
| C1 | **The viewer never worked at all.** `startPresence()` used `await` inside a non-async function — a module-level SyntaxError that prevented the entire script from parsing, killing both the Supabase path *and* the localStorage fallback. | `view.html:315-338` (await at line 332) |
| C2 | **Three generations of the app coexisted.** `src/app.js` was referenced by no page and was itself broken (`supajs` undefined at line 45; `import.meta.env` with no bundler; links to `/edit.html` which never existed). Seven `Qwen_*` scratch files duplicated the HTML, schema, edge function and docs at the repo root. | `src/app.js:5,45,546`; repo root |
| C3 | **Share links only worked on the same browser.** "Publish listing" wrote to localStorage and produced `index.html#l=<id>`; other people got "Listing not found on this device". | `index.html:409-416,420-424` |
| C4 | **Edit flow dead-ended.** `view.html` linked to `/index.html?edit=<slug>` — a URL the editor never handled; no edit-token verification existed anywhere. | `view.html:404-412`; `index.html:453` (only `#l=` handled) |
| C5 | **Draft save/load persisted `card.innerHTML`** — multi-MB payloads (skin icons were stored as data URLs), fragile restore, and `JSON.parse` without try/catch on load (corrupt storage = dead page). | `index.html:405-407`, `src/app.js:469`, `view.html:217` |
| C6 | **Supabase credentials were hardcoded empty in page source** — configuring the backend meant editing HTML; the docs described a Vite/`.env` setup that doesn't exist in this repo. | `view.html:164-167`; MVP_README |

### Robustness / correctness

- valorant-api.com responses were never checked with `response.ok` — HTTP failures surfaced as confusing `.json()` parse errors (`index.html:283-288`, `src/app.js:151-157`).
- Viewer interpolated listing data into HTML attributes unescaped (`view.html:250`) — a stored-XSS vector on public listings once Supabase went live; the editor also restored raw stored HTML via `innerHTML` (`index.html:424`).
- The "auto" stat-count button targeted `.stats .stat b` (first stat) — correct today only because PREMS happens to be first (`index.html:375-376`).
- `create_listing` RPC accepted any slug/theme/payload from anon with no validation; its default theme `'slate'` wasn't a real theme; `bump_views` was unbounded (`schema.sql:25,50-54,66-83`).
- Runtime dependence on CDNs without SRI: html2canvas from cdnjs, supabase-js from esm.sh (`index.html:8`, `view.html:162`).
- `scripts/copy-static.mjs` copied only the two HTML files; `.gitignore` was wrapped in literal code fences, ignored `*.mjs` (the build script's own extension) and `package-lock.json`.

### Design / UX

- ~95 lines of CSS duplicated across the two pages with drift, causing two visible viewer bugs: empty category slots rendered solid instead of dashed (missing `.slotbox.empty` rule) and unset rank badges rendered as broken-image glyphs (missing `.rankbadge:not([src])` rule).
- Seven different chamfer notch sizes for the same visual motif (4, 6, 7, 8, 9, 10, 30px) across near-identical components.
- Zero responsive design: `body{overflow:hidden}`, fixed 1920×1080 card, JS scale with no floor (unreadable on phones), topbar overflowed below ~900px, modal header didn't wrap.
- Missing hover/affordance cues on theme swatches, avatar, player card and buddy uploads; two competing primary CTAs (Export PNG and Publish listing both styled primary).
- The empty footer grid cell rendered as a hole (`index.html:211`); empty category slots had no affordance hint.
- No motion design at all; instant modal, instant theme swap.
- Arctic (light) theme's dark-tuned white-alpha overlays washed out; `--mut` text failed WCAG AA at its 9–13px sizes on every dark theme.
- Branding drift: page title "Showcase Card Builder" vs logo "CARD FORGE" vs viewer "CardForge"; no favicon, no meta description, no OG tags (bad for a tool whose output gets shared as links).

### Accessibility

- Modal was not an accessible dialog: no `role`, `aria-modal`, focus trap, or focus restore.
- `#status` was a de-facto live region with no `aria-live`.
- Unnamed icon buttons (✕, ×), no `aria-pressed` on theme swatches, dynamic images with no `alt`, rank picker emitted `src=""` (broken glyph), unhidden 👁 emoji read aloud, no `:focus-visible` styles (and `clip-path` clips default outlines).

### Repo hygiene

- No lint, tests, or CI; README claimed "built with Astro"; MVP_README described a nonexistent Vite/env setup.

## What this pass changed

- **Deleted** `src/app.js` and all `Qwen_*` scratch files (C2); rewrote README/SETUP to match reality; removed MVP_README (described a stack that doesn't exist).
- **Restructured** into `css/{shared,editor,viewer}.css` + `js/{shared,editor,viewer,config}.js` — the shared CSS is now a single source of truth, ending the drift class of bugs. Vendored html2canvas and supabase-js into `js/vendor/` (C6, CDN finding).
- **Unified viewing** on `view.html?slug=<id>` rendering a structured payload `{texts, ranks, picks, assets, theme}`; `index.html#l=…` redirects there (C3). Everything is escaped / set via DOM APIs (XSS finding).
- **Rewrote the viewer** (C1) with Supabase Realtime presence and `bump_views`, or BroadcastChannel locally.
- **Publishing**: Supabase `create_listing` with collision-retry and a locally-stored edit token; `update_listing` RPC enables republish-over-same-slug; `?edit=<slug>` loads a listing back into the editor (C4). Without Supabase keys, the same flow works per-browser via localStorage.
- **Drafts** now store the structured payload (slim: skin icons persist as remote URLs, converted to data URLs only transiently during PNG export) with guarded JSON and one-time migration from the old format (C5).
- **Schema**: `supabase/migrations/2_listings_hardening.sql` (also applied to `schema.sql` for fresh installs) adds slug/hash/size/theme validation, explicit duplicate-slug SQLSTATE, `update_listing`, real theme default.
- **Design**: chamfer tokens (`--notch`/`--notch-lg`), hover cues on swatches/uploads, single primary CTA, tier legend fills the empty footer cell, "+" hint on empty slots, modal/dialog a11y with focus trap, `aria-live` status, focus-visible rings that survive `clip-path`, motion with `prefers-reduced-motion` guard, topbar wrap + scale floor with scroll fallback, `--mut` contrast bumps, ink-adaptive overlays (fixes Arctic), favicon + OG/meta, consistent "CardForge" branding.
- **Guardrails**: ESLint flat config + `npm run lint`, GitHub Actions lint workflow.

## Known risks / recommended next steps

1. **No rate limiting on anon RPCs** — `create_listing`/`bump_views` are validated but anon-executable; spam and view inflation are possible. Next step: IP-bucket table checked inside the RPCs, or proxy writes through a Netlify Function.
2. **Edit tokens live in localStorage only** — clear browser storage and you lose update rights to a listing (the listing itself remains). Next step: let the user export/import an "edit link".
3. **Assets still travel as data URLs** inside the payload. Fine at current sizes (<8MB enforced); move to Supabase Storage if cards get media-heavy.
4. **No OG image** — shared links get title/description only. Next step: generate an OG image per listing (edge function + screenshot service).
5. **Legacy localStorage listings** render skins only (texts defaulted) — acceptable for a prototype-era data format.
6. **No automated tests** beyond lint; the export/publish flows are verified manually (see README/SETUP checklists).
