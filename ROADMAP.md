# Roadmap: Showcase Card Builder → Live-Listing SaaS

**Owner:** Shaern · **Status:** Planning → Phase 1 ready · **Version:** 2.0 · **Updated:** 2026-08-08
**Strategy:** Ship Route A (static site + Supabase) with feature order Auto-import → Verification QR/Watermark → Price/Offers/Status, then cross a defined gate into Route B (Next.js + Stripe, white-label SaaS).

---

## Changelog v1 → v2
- Prototype upgraded: 1920×1080 locked export canvas; Valorant design system (Anton + Chakra Petch, chamfered panels, 5 themes); rank picker; fast-add picker UX; auto-fit horizontal weapon rows (scrollbar-free exports)
- Phase 0 artifacts delivered: `schema.sql`, `skin-sync` edge function, `SETUP.md`, `POSITIONING.md`, `CONTRACT_CLAUSES.md`
- Tier handling hardened (chips built from live data, case-insensitive)

## v1.3 — Personal marketplace close-out ✅ shipped
- Owner dashboard `dashboard.html` (listings whose recovery key is in this browser's localStorage; On sale / Sold / Archived tabs; Open / Edit / Mark sold–Relist / Feature / Bump / Price / Copy FB post / FB link / Copy link / Archive / Delete; header stats On sale / Sold / Total views / Sold value / Avg days to sell; recovery-key import). Entry point: editor **More** → **My accounts**
- Unlisted sold gallery `sold.html` (`noindex`, intentionally not linked from the marketplace; shared by the owner as proof)
- Sold/pending lifecycle, feature pinning, bump-to-top; viewer owner-mode actions + inline price (amount + currency USD/EUR/GBP/JPY + OBO)
- Facebook post tooling (`fbPostText` in `js/shared.js`, Copy FB post, FB link attach, buyer "See the Facebook post")
- QR footer strip on full-height PNG exports (publish share JPEGs excluded; og:image stays 3840×2160)
- `browse_listings_v3` (+ `browse.js` prefers v3, falls back to v2/legacy); featured tile prefers the owner-pinned listing
- `supabase/migrations/10_lifecycle.sql` — additive `sold_at` / `featured_at` / `fb_post_url`, `owner_set_listing`, `browse_listings_v3`

## v1.3.1 — Single-seller gate ✅ shipped
- `create_listing` gated to allow-listed magic-link sessions (private `seller_emails` allow-list)
- `am_i_seller` probe RPC so the editor can show eligibility
- Editor sign-in overlay for visitors; sign-out in the editor's ⋯ menu
- Public "Build a card" links removed from browse / terms / privacy / 404; recovery-key editing unchanged

## v1.3.2 — Export PNG fidelity ✅ shipped
- Card fonts (Anton, Chakra Petch) vendored same-origin (`fonts/` + `css/fonts.css`, regenerate via `scripts/fetch-fonts.mjs`): html-to-image inlines `@font-face` by reading `cssRules`, which cross-origin Google sheets block — exports (and the og:image built from the same capture) rendered in fallback metrics: truncated rank names, wrapped labels
- Capture pins the skin grid to its live 1080 geometry; the `exporting-full` unfold that re-sized every grid row is gone; QR band now sits below the crop → `showcase-card-3840x2440.png`
- Download name derived from the real raster (`blobDims`/`pngName`), not `scrollHeight`
- Icon fetches settle via `decode()` + one retry; failures surface a warning toast instead of a silently blank slot
- Regression harness `npm run check:export`: 5 theme×layout combos assert font drift <2%, grid geometry identity during capture, and blob dims = filename
- Evidence + decisions: `design-plans/006-export-png-fidelity.md`

## v1.4 — Auth V1 closeout ✅ shipped
- Testing window closed: `12_single_admin.sql` re-applied (all owner RPCs gated, `listing-images` seller-only; anon → 42501/403 verified) and all 4 client `GATE_DISABLED` guards removed
- Dashboard gate at parity with the editor: magic-link OTP fallback, email validation, explanatory non-seller state + sign-out, header Sign out, pending states, dev-speak-free error copy
- Editor gate hardened: re-entrancy guard, 42501-on-publish reopens the gate over the intact editor state (incl. `?edit=` recovery-key mode), "Signing you in…" state on magic-link return (both gates)
- Gate a11y minimum: `role=dialog` + `aria-modal` + focus-on-show + Tab trap on the editor overlay
- `privacy.html` updated for the seller-account reality (was "no accounts, no logins"); HANDOVER §4b refreshed (dashboard OTP, redirect allow-list, stakeholder account, storage hole resolved)
- Stakeholder demo admin (`16_stakeholder_admin.sql` rev 2): created via GoTrue admin API — hand-inserting `auth.users` rows bricks GoTrue ≥2.197 (documented incident)
- Marketplace wiped to empty-showroom state before release (7 listings + 11 bucket objects)

## v1.5 — Marketplace-first landing ✅ shipped
- The marketplace is the front door: `index.html` now serves the public browse page, the editor moved to `build.html`; the root URL never shows a login wall. `_redirects` 301s legacy `/browse.html` → `/` and `index.html?edit=…` → `build.html?edit=…` (client-side guard twin in `index.html` for non-Netlify hosts)
- Top-right **Log in** on the marketplace: password-only sign-in modal (`role=dialog`, Tab trap, Esc/backdrop close); sellers land on the dashboard, signed-in non-sellers get an explained state + sign-out; seller topbar swaps to New card / My accounts / Sign out
- Magic link out of public view: the "Email me a sign-in link" button is `hidden` on all three sign-in surfaces (marketplace modal, editor gate, dashboard gate) and reappears only with `?magic=1` — a recovery hatch so OTP-only sellers can never be locked out
- Marketplace handles magic-link returns: holds the seller probe until the session lands (≤4s), then forwards sellers to the dashboard
- All editor links repointed (`view.html` EDIT, dashboard rows/New card/Build a card, seller CTAs); `copy-static.mjs` stages `build.html` + `_redirects`; `check-export`/`screenshot` scripts target the editor's new URL; docs (HANDOVER §1/§3/§4b, README, SETUP) updated — incl. the Supabase redirect allow-list now needing `build.html` entries
- Hotfix (same release): the dashboard gate rendered while signed in — `.dgate` + child flex rules beat the `hidden` attribute (browse.css carried the `[hidden]{display:none!important}` guard, dashboard.css didn't, so every gate sub-state stacked over the live dashboard); guard added, the gate now owns the page when anon (header hidden), and Sign out / Sold gallery / New card moved into the top navbar (seller-only) with the empty-state CTA restyled to match the chrome
- v1.5.1 handover closeouts: (18) storage policy regex `^[a-z0-9]{5,16}\.jpg$` had blocked every artwork/thumb upload since the v1.4 re-arm (silent 403 — the publish toast overwrote the attach error); widened to `(-thumb)?\.(jpg|png|webp)$`; (17) `listing_audit` trigger records every listings write with actor metadata (API user vs dashboard vs cron) for disappearance forensics; delete flows now remove orphaned storage objects
- v1.5.2 artwork mode rebuilt as a **dedicated surface** (no card editor behind it, no modal-over-editor state): own panel with upload+preview, fields, publish disabled until an image exists; `?edit=` re-hydrates into it; artwork doubles as share image; publish also detects silent 0-row updates (stale local edit key after a server-side delete) and recreates the listing instead of toasting "Published!" at nothing

---

## 1. Current State (prototype, single-file)

- Fixed 1920×1080 canvas, viewport-scaled; PNG export @2× (3840×2160)
- Themes: Protocol / Holo / Reaver / Oni / Arctic
- Click-to-edit text; skin picker per category (live valorant-api.com data)
- Fast-add UX: autofocus search, `/` focus, Enter = add top result, Esc closes, weapon chips + tier chips with live counts, ×N duplicate badges
- Rank picker (official competitive badges) + UNRANKED clear; auto-PREMS count
- Uploads: avatar, gun buddies, player card
- Publish → read-only live listing; live viewer counter (BroadcastChannel, same-machine); total views; contact-seller CTA

**Limitations (solved in Phase 1+):** listings localStorage-bound; presence same-machine only; persistence via innerHTML; export shows panel tops only; no auto-import / price / offers / status / QR / watermark.

---

## 2. Phase 0 — Foundations ✅ delivered, manual setup remaining

Delivered: `supabase/schema.sql` (skins, listings, `listing_public` view, `bump_views` RPC, RLS, pg_trgm, cron block) · `supabase/functions/skin-sync/index.ts` · `SETUP.md` · `POSITIONING.md` (CardForge + disclaimer) · `CONTRACT_CLAUSES.md`

Remaining (owner actions):
- [ ] Repo + push; Supabase project; run schema
- [ ] Deploy `skin-sync`, set `SYNC_SECRET`, curl test, enable cron
- [ ] Static host + custom domain; lock product name + disclaimer footer

---

## 3. Phase 1 — Route A core: listings go live (NEXT STEP, 1–1.5 wks)

- [ ] Structured persistence: `data-key` on editable fields; save `{texts, picks, assets, theme}` JSON (replaces innerHTML)
- [ ] Publish → Supabase (edit token hashed; writes via service role); public link + secret edit link
- [ ] Uploads → Storage bucket; URLs in payload
- [ ] Presence: BroadcastChannel → Supabase Realtime Presence (cross-device counter)
- [ ] Views via `bump_views`, deduped per session; viewer fetch by slug
- [ ] Extend `skin-sync` to also cache `competitivetiers` (rank picker stops calling community API)

**Exit criteria:** link works on any device; counter live cross-device; secret-link editing.

## 4. Phase 2 — Auto-import (1 wk)
- [ ] Tier 1: paste inventory text → `pg_trgm` fuzzy match vs `skins` → populate picks; review unmatched
- [ ] Tier 2 (beta flag): tracker URL scraper via edge fn, 24h cache, graceful fallback
- [ ] Parse level/ranks from text where detectable
**Exit criteria:** full card in <60s with tracker page open.

## 5. Phase 3 — Trust layer: QR + Watermark (3–4 days)
- [ ] `inventory_hash` + verification code on publish; `/verify?code=` page (live status, hash match ✓/✗)
- [ ] Watermark on export canvas (handle + listing ID); QR → live listing on exports + viewer badge
- [ ] Pricing lever planted: watermark forced ON for free tier
**Exit criteria:** any exported image traceable & verifiable in one scan.

## 6. Phase 4 — Commerce: Price / Offers / Status (4–5 days)
- [ ] Price, currency, negotiable toggle; price-history "↓ x%" badge
- [ ] Status enum → frame/ribbon recolor, broadcast live
- [ ] `offers` table + viewer form (honeypot + rate limit); seller review on edit page; optional webhook
- [ ] Posture: no on-platform payments/escrow
**Exit criteria:** live → offers → sold, end-to-end.

## 7. Phase 5 — Harden + first revenue (light, ongoing)
- [ ] `events` table + mini dashboard; report tooling; captcha on offers
- [ ] Optional OG stopgap (edge-served shell)
- [ ] Onboard first paying client (setup fee + small monthly)

---

## 🚪 Gate: Route A → Route B
Proceed when **any two** hit: 2+ paying clients · 500+ live listings · white-label/own-domain request · need subscription billing.

## 8. Phase 6 — Route B: productize (3–6 wks)
- [ ] Next.js + Supabase; React port (themes/CSS vars + structured payload port as-is)
- [ ] Magic-link auth + seller dashboard; Stripe Free/Pro plans (watermark = plan lever)
- [ ] Per-listing OG images via `@vercel/og`; server-side export endpoint
- [ ] White-label brand kits (logo/colors/domain); Discord/Telegram listing bots

---

## 9. Potential Upgrade Paths (catalog)

**Storefront & conversion**
- OG link previews (card image in FB/Discord pastes) · QR/share sheet · watchlist count · receipts gallery tab · similar-listings strip · seller profile w/ ratings & verified socials

**Seller speed & wow**
- Auto price suggestion from inventory composition · multi-page export for whale inventories · animated MP4/GIF export for TikTok/Reels/IG · layout templates + per-client brand kits · multi-editor collaboration

**Trust & safety**
- Signed exports (timestamped proof) · inventory fingerprinting (duplicate-listing detection) · report/block tooling

**SaaS / analytics / monetization**
- Per-listing funnel dashboard (views → contact clicks → offers) · spike notifications (Telegram/Discord webhook) · featured/bump paid placement · white-label subdomains · plan gating (free = watermark)

**Production necessities**
- Supabase auth/storage/presence/OG · skin asset proxy/cache (already started via skin-sync) · i18n

---

## 10. Timeline (part-time)

| Phase | Scope | Estimate |
|---|---|---|
| 0 | Foundations (manual setup left) | ~1 day |
| 1 | Live listings | 1–1.5 wks |
| 2 | Auto-import | 1 wk |
| 3 | QR + Watermark | 3–4 days |
| 4 | Price / Offers / Status | 4–5 days |
| 5 | Harden + first client | light, ongoing |
| 6 | Route B | 3–6 wks |

## 11. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Scraping fragile / ToS-gray | Tiered importer; Tier 1 needs no scraping |
| Riot IP exposure | Game-agnostic positioning; no bundled assets; server-side cache |
| Community API drift | Chips built from live data; skin-sync cache |
| Facilitation exposure | No on-platform payments; contract clauses |
| Abuse / scams | Rate limits, captcha, reports, verification layer |

## 12. Immediate Next Step
Generate **Phase 1**: structured persistence (`data-key` capture) + Supabase wiring (publish/storage/presence) as a drop-in replacement for localStorage/BroadcastChannel, plus `competitivetiers` caching in `skin-sync`.