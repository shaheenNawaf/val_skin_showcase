# CardForge — Mobile UI/UX Audit (buyer scroll-parity focus)

**Date:** 2026-10-02 · **Scope:** `view.html` (buyer path — priority), `index.html` (editor), `browse.html` (marketplace) at **390×844**, vs the **1920×1080 desktop baseline**.
**Requested goal (verbatim):** "have a similar experience as to desktop viewing without the need of too much vertical scrolling" — user open to better handling.
**Method:** live rendering via Playwright against the real Supabase listing `t63ii96` ("k4ze#JTT", 75 skins, 38 views); objective DOM/scroll/scale metrics + 9 screenshots analyzed by a vision model. Read-only audit — no product code changed. Evidence: `.orchestrator/qa/qa-log.md`, `.orchestrator/qa/01…09-*.png`.
**Companion:** prior visibility/contrast audit in `UIUX-AUDIT.md` (2026-09-26); this audit supersedes its P0-1 status section (native layout now exists; the residual problems are different).

---

## Executive summary

The buyer's mobile path works — it is readable, price/contact are pinned, nothing is clipped — but it is **8.78 screens of vertical scroll** for a 75-skin listing, while desktop shows the same inventory in **one screen with zero scrolls**. The alternative on phones (the TILES/SHOWCASE/CLASSIC canvas modes) compresses to one screen but at the 0.35 scale floor renders **3.5–4.9 px text — unidentifiable**. The marketplace quick view is worse at **0.19×**. So the phone buyer chooses between *readable but endless* and *whole but illegible*; neither is the desktop experience. Layered on top: the view switcher misstates which mode is active, the first screen shows **zero skin art** (235 px of chrome + account metadata), and the editor's phone tap targets measure 14–25 px.

**The parity gap, measured (75-skin listing):**

| Experience | Screens of scroll | Skin identifiability |
|---|---|---|
| Desktop 1920×1080 | **1 screen, 0 scrolls** — all 7 categories + stats at once, scale ≈1.0 | art-only tiles, 10–14 px effective text ✓ |
| Mobile SIMPLE (default native) | **8.78 screens** (7409 px page; effective content band ≈518 px ⇒ ~12 content-screens) | names readable ✓ but first skin art below the fold; no orientation cues |
| Mobile TILES/SHOWCASE/CLASSIC canvas | 1 screen | **illegible** — 0.35 floor ⇒ headings 4.9 px, LV badges 3.5 px; 672 px card overflows 390 px viewport while the dock reads "fit width"; 100 % zoom = 5× pan maze |
| Mobile quick view (browse) | — | preview card at **0.19 scale**, 15–20 px skins — vision verdict: "triage tool, not examination tool" |

Physics check: 1920 px of canvas cannot be legible inside 390 px. The faithful mobile translation of the desktop experience is not *fit the card* — it is desktop's **frame model**: a fixed viewport, condensed identity/stats chrome, and category-as-navigation with per-panel internal scroll (exactly what `#card.is-live` already does on desktop, `css/shared.css:264-270`).

---

## Design language
- Audited surface: the three deployed app surfaces at phone width, vs the desktop viewer baseline.
- Design sources: `README.md` (layout contract: AUTO→M1; "buyers see **every** skin… each category panel scrolls independently… nothing is clipped"), `UIUX-AUDIT.md`, in-code decisions CF-05/11/12/13/14/15/25/26/33, `prototypes/density.html` (M0–M6 density lab).
- Documented decisions: pinned mobile action bar with price+contact (CF-11/12); layout switch survives on phones (CF-14); zoom dock FIT/100/200 (CF-15); lazy native render (CF-33); fixed 1920×1080 canvas scaled by `makeFitter` (floor 0.35, `js/shared.js:137`).
- Governing owners and consumers: `css/shared.css` (tokens, card, `.is-live` per-panel scroll, ≤760 px chrome) → all pages; `css/viewer.css` (≤700 px `#mcard`, `#mactbar`, canvas-mode swap, zoom dock) → viewer; `js/viewer.js` (`renderMobile`, `MOBILE_SKELETON`, viewSwitch, zoom dock) → viewer; `js/browse.js` (`fitCard` quick-view scaling, `browse.js:728`) → marketplace.
- Explicit exceptions: None documented.

## Findings

| # | Problem | Evidence | Proposed change | Scope | Confidence |
|---|---------|----------|-----------------|-------|------------|
| 1 | Mobile buyer must choose between **8.78 screens of scroll** (SIMPLE) and an **illegible 1-screen canvas** (0.35×; 4.9 px headings, 3.5 px LV badges). Neither delivers the desktop "whole inventory, one frame" experience. Quick view renders at 0.19×. | `scrollHeight 7409/844=8.78`; `#mcard` 7024 px, `.mskins` 6162 px; canvas `scale(0.35)`, sizer 672×378 > 390 vw; eff-text = computed × scale; vision on `04`: "buyer cannot identify specific skins without pinch-zooming"; vision on `06`: desktop "0 scroll gestures, all 7 categories visible"; user states the pain directly. | Re-flow the native layout to desktop's fixed-frame model: condensed header + **category chip strip + 3-col art-first grid bounded to the viewport** (internal scroll — the `is-live` per-panel pattern), tap → existing inspect overlay; **hybrid**: dense single-flow mosaic below a size threshold. | `js/viewer.js` (`renderMobile`), `css/viewer.css` (≤700 px) | High |
| 2 | **View switcher misstates the active layout on phones:** default mobile state renders SIMPLE native while `TILES` shows `aria-pressed=true` and SIMPLE is `hidden` — the controls contradict the rendered surface. | DOM at 390 px: `viewSwitch=[m1:true, m2:false, m3:false, native:false:hidden]`, `visMode:"native"`; `viewer.js` `viewRefresh()` presses `viewMode||auto` regardless; `nativeBtn` un-hidden only in the click handler (`viewer.js:406-430`). | With canvas modes hidden ≤700 px (decision D2), the switcher no longer renders on phones; state truth restored by construction; `?view=` deep links on phones fall back to native. | `js/viewer.js`, `css/viewer.css` | High |
| 3 | **First screen shows zero product:** 235 px pinned chrome (topbar 129 px wrapping 6 controls to 3 rows + hero 105 px) = 28 % of viewport; code/ranks/stats/meta boxes follow; first skin art at y≈680 of 844. | `#vchrome h=235` (`#topbar h=129`, `#vhero h=105`); vision on `01`: "NO skin artwork visible… SIDEARMS heading barely clipped at bottom edge". | Viewer topbar → one ≤56 px row on phones (logo + compact view badge + ⋯ overflow — the editor's CF-05 More-menu pattern), merge hero identity/status into the native head block, condense ranks/stats so skin art reaches the first screen. | `view.html`, `css/viewer.css`, `css/shared.css` (≤760 px), `js/viewer.js` | High |

**Also observed (supported, lower leverage):**
- Canvas "FIT" on phones: 0.35 floor overflows the viewport (672 px in 390 px) yet `#zoomNote` reads "fit width" (`viewer.js:394` only checks vertical overflow); 100 % = 1920 px in 384 px viewport (5× pan maze); `touch-action:auto`, no pinch guidance. (Moot on phones under decision D2; desktop label honesty remains in the secondary batch.)
- Editor on phones: topbar buttons 24–25 px tall, theme swatches 31×14 px (< 44 px touch minimum); card under edit renders at 0.35 → a seller cannot read what they type. Phone editing is effectively preview-only today.
- Quick-view modal: 0.19× card preview occupies ~207 px of the modal while adding no identifiable detail (`browse.js:728` `fitCard` has no floor and no phone branch); listing-level info + CTAs around it are good.
- Native tile captions duplicate the weapon ("Judge — Bumble Brigade Judge"); weapon is already the category context (`viewer.js:310`).
- Browse grid itself is healthy: 4.23 screens for 6 listings, cards + CTAs readable.
- Tablet note (>700–1024 px): tablet gets the desktop canvas path at 0.39–0.53× — small but out of scope per decision D3 (desktop/tablet unchanged).

## Improve first
**Finding 1** — the user's stated goal and the revenue path (buyer opens share link on a phone → assesses → contacts). Findings 2–3 ride along in the same mobile-viewer pass; only Finding 1 moves the 8.78-screens number.

---

## Decisions (user, 2026-10-02)

- **D1 — Direction: Hybrid (Option C).** Category-tabbed viewport-bounded frame for large listings (threshold ≈ 24 total skins, tunable); dense art-first mosaic single flow for small ones. Keeps pinned price/contact bar and tap-to-inspect overlay.
- **D2 — Canvas modes hidden below 700 px.** TILES/SHOWCASE/CLASSIC + zoom dock are the desktop experience only; phones get the native layout (no switcher, no canvas-mode on phones).
- **D3 — Hard constraint: MUST NOT affect desktop/tablet layout.** All changes strictly inside existing mobile branches (`@media (max-width:700px)` viewer / `(max-width:760px)` shared chrome / `innerWidth<=700` JS guards). Desktop 1920×1080 and tablet >700 px render exactly as today.
- **D4 — Review before implementation.** Interactive prototype + design plans delivered first (`design-plans/`); implementation only after approval.
- **D5 — Secondary batch included** in the plan set: quick-view phone preview, editor tap targets ≥44 px (phone only), caption de-duplication, honest zoom labels (desktop side).

Plans: `design-plans/000-overview.md`, `001-mobile-viewer-hybrid.md`, `002-chrome-and-state.md`, `003-secondary-batch.md`.
Prototype: `design-plans/prototype-mobile-v2.html` → serve with `npm run dev`, open `http://localhost:3000/design-plans/prototype-mobile-v2.html` (renders the real listing `t63ii96` by default; `?slug=` supported).

## Status (2026-10-03): IMPLEMENTED + QA-VERIFIED (uncommitted)

All plans executed by worker agents on top of HEAD `5c66235`; changes confined to
`js/viewer.js`, `css/viewer.css`, `view.html`, `js/browse.js`, `css/browse.css`, `css/shared.css`, `css/editor.css`, `js/editor.js`.
Phone 390×844 (`t63ii96`, 75 skins): page scrollHeight 844 = innerHeight (**zero page scroll**, was 8.78 screens); head 176px;
first skin tile visible on arrival; tabbed frame + Info tab (incl. "View all 236 player cards" hint); production inspect overlay
opens with correct skin; `?view=m2` deep link renders native and preserves the URL; 390↔1024 boundary restores canvas with
truthful pressed states. Desktop 1920×1080 + tablet 768×1024: canvas path unchanged (scale 0.996, one screen, inline controls,
hero + zoom dock intact). Browse QV: phone = 6 tier-ordered hero thumbs (exclusives first) linking to the listing; desktop =
scaled card as before. Editor phone: topbar 94px (was 178px mid-pass, 95px pre-project with 24px targets), controls ≥40px,
swatches 44×32 in the More menu with a CARD THEME caption; 360×640 fits (More reachable). `npm run lint` → 0 errors.
Findings 1-3: CLOSED. Secondary batch: CLOSED (zoom label now names the binding constraint).
Note: implemented concurrently with the owner's own commits (`377ae30` SIMPLE-chip removal already matched D2, `eb85c64` rebrand,
`9b55e4a`/`d6b83ed` collapsible hero, `9390d29`/`a76ae17`/`5c66235` export engine) — the diff layers cleanly on top.

## Status update (2026-10-03, round 3): form mode + limitation fixes SHIPPED + QA-VERIFIED (uncommitted)

Owner approved the follow-ups ("Fix this please / Go for it" → limitations 2-3; "I'm thinking and currently agree with the
'Phone form mode'" + prototype approval "Everything looks good to me" → limitation 1 via plan `design-plans/004-phone-form-mode.md`,
reference `design-plans/prototype-editor-form.html`). Files: `index.html` (+83), `css/editor.css` (+~106), `js/editor.js` (+~237),
`js/browse.js` (QV-F, +5), `js/viewer.js` + `css/viewer.css` (mcards-btn — since committed by the owner).
Phone form mode (≤700px): 7 sections (Identity/Ranks/Meta/Stats/Skins/Art/Look) + sticky chip nav + EDITING·code/DRAFT hero;
44px inputs dual-write `state.texts` AND card `[data-key]` DOM (binding rule); skin thumbs (tier borders, LV badges, 2-line
names) open the real variant UI; + Add opens the real picker; rank Pick / buddy / card pickers reused; theme swatches,
`#layoutSel`, `#layoutBadge`, `.pubswitch` RELOCATED (never cloned) into form slots; Preview toggle (`body.stage-peek`) shows
the off-screen-translated real canvas (`translateX(-200vw)` keeps it laid out for export). QA 390×844: form boot ✓, draft
restore→refill ✓, typed code lands on card + hero ✓, picker add → recount 00→01 ✓, variant modal ✓, save "Draft saved." ✓,
**Export from form mode → real "PNG exported — 3840×2156" in 3.0s, zero errors** ✓, 360×640 fits (topbar 94px, inputs 44px,
no h-scroll) ✓, desktop 1920 restored (`logo→themes→layoutSel→badge`, pubswitch back in menu, no form/Preview leak) ✓,
boundary crossings relocate + sync both ways ✓. Vision: phone form 8/10, peek "no defects", desktop "healthy — no regressions".
Self-review of full diff (reviewer provider still down): PASS with one bug (buddy file-upload missed `renderFormBuddies()`) — fixed + re-linted 0/0.
QV-F fix: `openQV` hides stage + clears thumbs before reveal (no stale-card frame; failure paths ride the z90 status toast) — verified A→B open.

### Limitations & follow-ups (detail, 2026-10-03; round-3 updates inline)
1. **CLOSED (round 3) — Phone card EDITING was preview-only; now a native form mode ships.** ≤700px the editor defaults to
   `#formMode` (7 sections, 44px inputs, sticky chip nav, EDITING·code/DRAFT hero); the 1920×1080 canvas lives off-screen
   (`translateX(-200vw)`, never `display:none` — html-to-image export + `slots.clientWidth` layout math keep working) and
   the Preview toggle shows it. Export from form mode verified: real 3840×2156 PNG, zero errors. Plan `design-plans/004-phone-form-mode.md`.
2. **CLOSED (round 3) — Quick-view stale-card flash.** `openQV` now hides `.qv-stage` and clears `.qv-thumbs` BEFORE revealing
   the modal (`/* QV-F */` in `js/browse.js`); fill repopulates per width. Load failures ride the existing z90 status toast over
   the blank modal (documented trade-off). Verified: opening listing B right after A shows no stale frame.
3. **CLOSED (round 3) — `#cardsHint` stranding.** The mobile DOM-teleport branch was deleted; the phone Info panel renders a
   native `.mcards-btn` ("View all N player cards") from payload data inside `.mpcardwrap`, wired via the delegated `#mcard`
   listener; desktop keeps the in-box hint (verified fresh loads both surfaces, artifacts 25/27). Residual cosmetic note: after a
   no-reload phone→desktop crossing the desktop hint sits inline (visible + functional, not in-box) until refresh.
4. **CLOSED (round 4, 2026-10-03) — Laptop legibility (prior audit P0-2).** User explicitly commissioned the desktop-side
   pass (overriding D3 for this scoped change): 18 single-token font-size bumps raised the card's design-time floor from
   10–12px to 12–15px (`css/shared.css` 17 rules + `.pickrank` in `css/editor.css`; plan `design-plans/005-laptop-legibility.md`,
   commit `0452f92`). Measured: viewer 1366×768 effective text 8.5–10.6px (was 7.1–9.9), editor 1366 8.2–9.5px, 1536×864
   9.5–11.9px, 1920 regression clean (all overflow probes ok both axes, viewSwitch/zoom dock intact). Vision: 1366 card 7/10
   "headings, stat labels, watermark readable without zooming"; 1536 page 9/10 healthy; QV modal intact; design-scale card —
   every bumped zone ok ("BUDDIES & FLEX" 2-line wrap + bottom stage scroll are pre-existing by-design behaviors).
   Export gate: real `PNG exported — 3840×2156` unchanged. Lint 0/0. Pushed to staging (buildstamp `0452f92`).
5. **Fixed dials (single-const tunables, not data-validated):** `TAB_THRESHOLD = 24` in `js/viewer.js` (set 0 = every
   listing gets the zero-page-scroll tabbed frame); QV thumbs = 6, tier-ranked exclusive→select, stable payload order,
   no personalization; chip label "Snipers" (panel heading keeps "Sniper Rifles"); mosaic mode (≤24 skins) still scrolls
   the page ~1–2 screens (1-skin listing measured 1.00).
6. **Minor:** phone ⋯ menu closes on any item click (Copy-link confirmation rides the visible `#status` toast); long
   riot-ids ellipsize in the head subtitle; tile names one-line by design (full name in inspect overlay); form-mode section
   strip scrolls horizontally (rightmost chip clipped at rest = scroll affordance, by design); contact-link input clips
   mid-URL visually (value intact, scrolls with caret); Preview pane still shows the canvas at the 0.35 floor — intentional
   (it is a proof sheet; editing happens in the form).
