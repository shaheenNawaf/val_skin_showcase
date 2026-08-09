# Roadmap: Showcase Card Builder → Live-Listing SaaS

**Owner:** Shaern · **Status:** Planning → Phase 1 ready · **Version:** 2.0 · **Updated:** 2026-08-08
**Strategy:** Ship Route A (static site + Supabase) with feature order Auto-import → Verification QR/Watermark → Price/Offers/Status, then cross a defined gate into Route B (Next.js + Stripe, white-label SaaS).

---

## Changelog v1 → v2
- Prototype upgraded: 1920×1080 locked export canvas; Valorant design system (Anton + Chakra Petch, chamfered panels, 5 themes); rank picker; fast-add picker UX; auto-fit horizontal weapon rows (scrollbar-free exports)
- Phase 0 artifacts delivered: `schema.sql`, `skin-sync` edge function, `SETUP.md`, `POSITIONING.md`, `CONTRACT_CLAUSES.md`
- Tier handling hardened (chips built from live data, case-insensitive)

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