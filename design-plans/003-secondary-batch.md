# Plan 003 — Secondary batch: quick-view phone preview, editor tap targets, honest zoom label

Written against: commit `a48a3ad` · Covers: `MOBILE-AUDIT.md` "Also observed" items (user-selected D5) · Status: **PROPOSED** · Independent of plans 001/002 — parallel-safe (different files, except the zoom-label item which touches `js/viewer.js`: sequence after 002 if both run).
Caption de-duplication ships inside Plan 001's tile spec (not repeated here).

## Evidence chain

- Surface A: `browse.html` quick-view modal at 390×844 — preview `#card` scaled by `fitCard()` (`browse.js:728-740`, `s = stage.clientWidth/1920`, no floor) → measured `scale(0.1917)`, 368×207 px preview, skins 15-20 px; vision verdict: "too small to serve as a meaningful examination tool… useful as triage".
- Surface B: `index.html` editor at 390×844 — topbar buttons measured 24-25 px tall, theme swatches 31×14 px (`< 44 px` touch minimum); `a48a3ad` hard-locked 28 px control height (inline-flex centered) — the phone override must beat that lock **inside the mobile media query only**.
- Surface C: desktop zoom dock note — `viewer.js:394-396` + `678-680` report "fit width" whenever vertical overflow exists, even when the binding constraint is height (e.g. 1366×768: `natural = min(0.70w, 0.57h) = 0.57` → height-bound, label wrong) or when the 0.35 floor engaged (phones pre-D2; label lied there too).
- Design evidence: D3/D5; touch-target minimum 44 px (platform guideline; prior audit P2-5 applied the same bar to disclaimer links); QV modal already has phone blocks (`browse.css` `@media(max-width:767px)` lines 229, 294) — new rules use **≤700 px** to match the viewer's phone definition; existing 767 blocks untouched.
- Owner: A `js/browse.js` (QV fill + `fitCard`) + `css/browse.css`; B `css/shared.css` ≤760 px block + `css/editor.css` phone rules; C `js/viewer.js` zoom-note strings.
- Uncertainty: A — exact thumb count that fits the modal at 360 px (validate 6 vs 4); B — whether 40 px topbar controls force the editor topbar past 95 px on phones (acceptable up to ~110 px; verify card stage still ≥55 % of viewport height).

## Design decision

A. **Quick view ≤700 px swaps the unreadable 0.19× card for a hero-skin thumb strip** (up to 6 skins, tier-prioritized exclusive→ultra→premium→deluxe→select, payload order as tiebreak) rendered from the same payload the QV already loads; each thumb opens the full listing (same target as the existing CTA). Above 700 px the real-card preview is untouched. The modal keeps its listing-level identity/meta/price/CTA block, which the vision model confirmed works.
B. **Editor phone controls grow to ≥40 px height (44 px where standalone)** strictly inside `@media (max-width:760px)`; desktop control heights (28 px lock) untouched.
C. **Zoom label tells the truth on all surfaces:** "fit width" only when width is the binding constraint; "fit to screen" when height-bound; "min zoom — scroll to explore" when the floor overrides fit. Desktop-visible change (label text only), no layout impact.

## Reuse

- A: tier color/order tokens (`--tier-*`, `shared.css:10-11`); QV modal structure (`.qv-stage/.qv-sizer/.qv-bar`, `browse.js:640-760`); notch clip-path; `loading="lazy"`; existing `view.html?slug=` CTA target. Thumb tile visual = Plan 001 `.mtile` language (art-first, 1-line name) so marketplace and viewer speak with one voice.
- B: existing ≤760 px blocks (`shared.css:209-217`, `editor.css:44,77`) — extend, don't duplicate; `#topbar button` selectors already scoped there.
- C: `makeFitter` internals already compute `natural` vs floor (`shared.js:143-149`) — expose the binding constraint via the returned fit or recompute locally in `viewer.js` (do NOT change `makeFitter`'s signature: editor + browse consume it).

## Changes

1. `js/browse.js` — QV phone branch
   - Change: in the QV fill path (the function that calls `fillCardFromPayload`-equivalent + `fitCard()`, ~lines 640-760): when `innerWidth <= 700`, hide `.qv-stage` (`hidden = true`) and populate a new `div.qv-thumbs` (created once in the modal markup or injected before `.qv-bar`): up to 6 `a.qv-thumb[href="view.html?slug=…"]` each = `img` (skin `icon`) + `span` (skin `name`, 1 line) + tier-colored left border via `data-tier`. Selection: flatten `payload.picks` in `CF.ALL_CATS` order, sort by tier rank map `{exclusive:5,ultra:4,premium:3,deluxe:2,select:1}` (stable — preserve payload order within tier), take 6. If zero skins: hide `.qv-thumbs` entirely (modal shows identity/meta/CTAs only). `fitCard()` early-returns when `.qv-stage` is hidden (guard on `stage.clientWidth === 0` already exists at line 735 — verify it covers `hidden`).
   - Preserve: >700 px behavior byte-identical (no class/mode changes leak upward); QV open/close/focus-restore logic (`qvLastFocus`, Escape, backdrop click); `fillBar` untouched.
2. `css/browse.css`
   - Change: new `@media (max-width:700px)` block: `.qv-thumbs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:0 0 10px}` (2 cols at ≤380 px via nested media or `auto-fill,minmax(104px,1fr)`); `.qv-thumb` = notch clip-path, `--panel/--box` gradient background like `.mtile`, `img{height:56px;object-fit:contain;width:100%}`, `span{font:500 10.5px/1.2 'Chakra Petch';ellipsis}`, `border-left:3px solid var(--tier-color,--c-line)`, `:active{border-color:var(--c-accent)}`. `.qv-stage[hidden]{display:none}`.
   - Preserve: existing 767/479 blocks unchanged.
3. `css/shared.css` — ≤760 px block only (lines 209-217)
   - Change: `#topbar button,#topbar a.tb-link{min-height:40px;padding:8px 12px;font-size:11px;display:inline-flex;align-items:center}` (overrides the 28 px lock via the media query's later position + equal specificity — verify computed height on phone); `.swatch{min-width:44px;min-height:32px}` if swatches live in shared (else editor.css). Keep `logo` size, `#status` position, `#disclaimer` rules as-is.
4. `css/editor.css` — phone rules
   - Change: where theme swatches are styled (`.swatch`), inside `@media (max-width:760px)` (create if absent): `min-height:32px; min-width:44px; gap` bump so rows don't exceed topbar height budget; `#moreBtn`/`#moreMenu` rows `min-height:44px` (menu items are standalone targets). AUTO/layout selector control: `min-height:40px` in the same block.
   - Preserve: desktop hard-lock from `a48a3ad` (28 px, letter-spacing) untouched outside the media query; editor topbar may grow to ≤110 px on phones (budget verified in Validation).
5. `js/viewer.js` — zoom note strings (desktop-visible text only)
   - Change: compute the binding constraint where the note is set (lines 393-396 and 678-680): `const natural = Math.min((stage.clientWidth-2)/1920, (innerHeight - vchrome.offsetHeight - 34)/1080)`; if pinned zoom → keep "viewing at N% — drag to pan"; else if scale ≤ floor+ε → "min zoom — scroll to explore"; else if width-bound (`w/1920 ≤ h/1080`) → "fit width" + (vertical overflow ? " — scroll to explore" : ""); else → "fit to screen". Strings uppercase-styled by existing CSS; keep tone.
   - Preserve: `zoomMode` semantics (CF-15), dock collapse persistence, all layout math.

## Scope

- Inherit: every phone QV open (browse), every phone editor session, every zoom-note render (desktop + tablet).
- Verify: desktop QV (>700 px) unchanged; editor at 1920×1080 and 768×1024 unchanged (media-scoped); zoom dock at 1920×1080 says "fit width" (width-bound there: 0.996 vs height ~0.88 → actually height-bound at 1080? measure: availH = 1080−114−34 = 932 → 932/1080 = 0.863 < 1904/1920 = 0.99 → height-bound → label becomes "fit to screen" on desktop FHD — intended honesty, flag in QA so the user sees the new string); 1366×768 → "min zoom"/"fit to screen" as measured.
- Exclude: QV card rendering internals, editor card scaling (0.35 phone edit remains preview-only — separate product decision), toast system, PNG export.

## Validation

- Product: phone QV shows ≤6 identifiable hero skins with names; tapping a thumb opens the full listing; editor phone controls measure ≥40 px (≥44 for menu rows/swatches); zoom label matches the actual constraint at 1920×1080, 1366×768, 768×1024.
- Interface: QV with 0-skin listing → no thumb strip, no empty box; QV with 75 skins → exactly 6 thumbs, tier order (verify first thumb is an exclusive/ultra if present in payload); 360×640 QV → thumbs ≥104 px or 2-col fallback, no overflow; editor topbar ≤110 px on phones, card stage ≥55 % of viewport height.
- System: one thumb visual language with Plan 001 `.mtile`; tier rank map defined once (if browse.js already has a tier order for facets, reuse it — grep before adding).
- Repository: `npm run lint` → 0 errors; desktop/tablet screenshot diffs vs `a48a3ad` captures → no layout delta (zoom-note text delta at FHD is expected and intended).

## Stop conditions

- Stop if QV thumbs require payload fields absent from the browse RPC/`listing_public` row (check `payload.picks[].icon/name/tier` availability in the QV data path before building — QV already renders the full card from payload, so fields should exist; if the QV uses a trimmed payload, stop and re-scope).
- Stop if the editor topbar exceeds ~110 px on phones after target enlargement (renegotiate: move swatches into the More menu instead).
- Stop if making the zoom note honest requires touching `makeFitter`'s signature (editor/browse consume it) — recompute locally instead.

## Design documentation

- After acceptance and validation: none beyond plan-file status updates (no README-level contract changes in this batch).
