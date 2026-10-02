# Plan 001 — Mobile viewer hybrid layout (tabbed frame + dense mosaic)

Written against: commit `a48a3ad` · Covers: `MOBILE-AUDIT.md` Finding 1 + caption de-dup · Status: **PROPOSED — awaiting prototype approval (D4)**
Visual reference: `design-plans/prototype-mobile-v2.html` (match its spacing/type/color exactly; it renders real listing data and is QA-verified at 390×844).

## Evidence chain

- Surface: `view.html` at 390×844, listing `t63ii96` (75 skins), default native layout (`#mcard`).
- Problem: 8.78 screens of vertical scroll (`scrollHeight 7409 / 844`); `.mskins` alone 6162 px; 2-col mosaic with 88 px art + 2-line captions; no orientation cues; first skin art below the fold. Canvas alternative illegible (0.35 floor → 3.5–4.9 px text). Desktop shows the same inventory in one screen with per-panel internal scroll.
- Design evidence: README contract "buyers see **every** skin: each category panel scrolls independently… nothing is clipped"; `#card.is-live .slots` internal-scroll pattern (`css/shared.css:264-270`); density-lab conclusion that no single mode wins all inventory sizes (`prototypes/density.html`, `UIUX-AUDIT.md` history); user decision D1 (hybrid, threshold ≈24).
- Owner: `js/viewer.js` `renderMobile()` + `MOBILE_SKELETON` (lines 220-356), `css/viewer.css` `@media (max-width:700px)` block (lines 50-98, 161-165).
- Scope and affected surfaces: `view.html` phone rendering only (`#mcard` subtree). Editor, browse, desktop viewer, PNG export, publish flow: untouched.
- Uncertainty: exact condensed-head height on the smallest phones (360×640) — validate in QA, shrink rank/stats rows before shrinking tiles. (Prototype measured 175–177 px at 390×844 with ranks+LVL on row 2 and V/R/K currencies moved into the meta row — keep that split; the rank row clipped when currencies shared it.)
- Prototype-verified numbers (listing `t63ii96`, 390×844): tabbed frame → page scrollHeight 844 = innerHeight (**zero page scroll** vs 8.78 screens today); worst category (Sidearms 29) internal scroll **2.19 screens**; forced mosaic on the same 75 skins = 3562 px vs today's 7409 px (−52 %); 1-skin listing → auto mosaic, 1.00 screen; 0-skin listing → `.mempty`, Info-only chips. Tier borders verified: 43 select / 20 deluxe / 9 exclusive / 3 premium all colored.

## Design decision

Replace the single 2-col scroll column with desktop's **frame model**, in two density tiers off one renderer:

- **Tabbed frame** (total skins > `TAB_THRESHOLD = 24`): page never scrolls; `#mcard` becomes a fixed flex column — condensed head (≤180 px, prototype-verified 177), category chip strip (~40 px), one 3-col art-first grid filling the remaining viewport with **internal** scroll, plus a final **INFO** chip (buddies, player card, seller, watermark strip). Category navigation replaces page scrolling; any inventory size stays ≈1 screen + per-category internal scroll (Sidearms 29 ≈ 2.2 internal screens).
- **Dense mosaic** (≤ threshold): single page flow, same head, same 3-col tiles, `position:sticky` category headings, buddies/seller/strip at the end — today's structure at ~⅓ the height.

Tiles are art-first (64 px contain art, 1-line de-duplicated name, LV badge, tier-colored left border) because desktop proves art-only recognition works; names/levels/variants stay one tap away via the **existing** inspect overlay (`.spv-open` → `openSpv`, `viewer.js:479-515`). Pinned `#mactbar` price/contact bar (CF-11/12) is preserved in both modes.

## Reuse

- Tokens: card theme vars (`--panel --box --box-hi --line --sheen --ink --mut --accent --gold --red --warn --notch --notch-lg --tint`), chrome vars (`--c-*`), tier colors (`--tier-select/deluxe/premium/ultra/exclusive`, `css/shared.css:10-11`), fonts (`--font-display`, `'Chakra Petch'`).
- Patterns: notch `clip-path` polygon (used by `.mbox/.mskin`), `--tbh` measured-chrome variable (`shared.js:140`), lazy `loading="lazy"` images, `.mempty` empty state, `.mstrip` watermark row, per-panel internal scroll (`#card.is-live .slots`), status-chip colors (`viewer.css:16-18` `.vh-status.ok/.warn/.bad` → head status chip reuses the same triple).
- Exemplars: existing `.mskin` tile (`css/viewer.css:81-84`) → new `.mtile`; `.spread-mosaic` 2-col grid → `.mgrid3` (3-col); chip language: `#viewSwitch button` (`viewer.css:189-193`) for the category chips' shape/type, `--c-accent-btn` fill for active.
- No new shared primitive: everything lives in the viewer's existing mobile block. `TAB_THRESHOLD` is a module const in `js/viewer.js` (single consumer; do not move to shared.js).

## Changes

1. `js/viewer.js` — `MOBILE_SKELETON` + `renderMobile()` (lines 220-356)
   - Change: rewrite the skeleton to: `div.mhead2` (identity row: `[data-m=cname]` title + code + status chip `span.mstatus` bound from `listing.status` via the same mapping as `applyHero` (`viewer.js:610-612`); row 2: rank badges inline (26 px) + CURRENT/PEAK names + LEVEL chip (currencies V/R/K do NOT live here — row 2 clips at 390 px with them, verified); row 3: 4 stat counts; row 4: V/R/K chips + meta spans WTR/RECEIPTS/OWNER · CHANGE NAME/status/date · PREMIER/vlink — reuse existing `data-m` keys so `texts` binding is unchanged) → `nav.mcats` (chip strip; hidden in mosaic mode) → `div.mpanels` (one `section.mpanel[data-cat]` per non-empty category: sticky `h3` + count + `div.mgrid3`; plus `section.mpanel[data-cat="Info"]` containing buddies grid, `div.mpcardwrap` around `img.mpcard`, seller row, `.mstrip`) → nothing else (mactbar/disclaimer stay page-level).
   - Mode selection: `const total = Object.values(picks).reduce((n,a)=>n+a.length,0)`; `total > TAB_THRESHOLD` → `mcard.classList.add('mode-tabs')`, else `mode-flow`. Render ALL category panels in both modes (lazy images keep cost down); in `mode-tabs` show only the active panel.
   - Chips: for each non-empty category + `Info`: `<button type="button" class="mcat-chip" data-goto="CAT">SIDEARMS<b>29</b></button>`; `aria-current="true"` on active. Click → activate panel: toggle `.active` on chip/panel, reset `mpanels.scrollTop = 0`, `chip.scrollIntoView({inline:'nearest', block:'nearest'})`. Default active = first non-empty category. Long label shortening: "Sniper Rifles" chip may render as "Snipers" (prototype convention) while the panel `h3` keeps the full name.
   - Tiles: `figure.mtile.spv-open[data-spi]` → `img` (icon, `loading=lazy`, alt = "weapon — name"), `i.mlv` when `level>=2` (`LV{n}`), `figcaption` = **`s.name || s.weapon`** + (variant name appended only if not already contained in name), one line, ellipsis. `data-tier` = **normalized tier key**: payload carries display names ("Premium Edition" — verified against listing `t63ii96` during prototype QA), so map via `(String(s.tier||'').toLowerCase().match(/exclusive|ultra|premium|deluxe|select/)||[''])[0]` (unknown/absent → `--mut` border). `title`/`aria-label` keep the full "Inspect weapon — name" string (CF-26 behavior preserved).
   - **SPV index correctness (required):** stop pushing into `SPV_LIST` from `renderMobile`. Compute each tile's `data-spi` deterministically: index of the skin within the flat concatenation of `picks[cat]` over `CF.ALL_CATS` filtered to `s.id` truthy — the exact fill order `markInspectCells()` (`viewer.js:363-383`) produces, so mobile indices stay valid after the desktop pass resets the list. Re-renders (resize listener, mode switch) must be idempotent: same DOM, same indices, no duplicate listeners (keep the document-level `.spv-open` delegation — it already covers new tiles with zero wiring).
   - Preserve: CF-33 lazy first render (`getComputedStyle(mcard).display==='none'` guard + `dataset.filled`), empty state (`.mempty` when no skins anywhere; chip strip then shows only `Info`), `linkEl.href` http guard, watermark slug/stamp fill.
   - `#cardsHint` mobile placement (`viewer.js:176-187`): change the mobile branch to append the hint **inside** `.mpcardwrap` in the Info panel instead of after `#mcard`, because `mode-tabs` makes `#mcard` fixed (an after-sibling would sit under the frame). Keep `dataset.where='mobile'` idempotency and the desktop `in-box` branch unchanged.
2. `css/viewer.css` — inside the existing `@media (max-width:700px)` block (lines 50-98, 161-165)
   - Change: replace `.spread-mosaic`/`.mskin` rules with: `.mhead2` (rows as specified, `gap:6px`, `padding:8px 10px`, `background:linear-gradient(180deg,var(--card1),var(--card2))`, notch-lg clip-path like today's `.mhead`); `.mcats{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:9px 12px 7px;-webkit-overflow-scrolling:touch}` + `.mcat-chip` (32 px tall, `font:700 9.5px 'Chakra Petch'`, `letter-spacing:.12em`, border `--c-line`, notch clip-path, `b` count pill in `--c-veil`; `.mcat-chip[aria-current=true]{background:var(--c-accent-btn);border-color:var(--c-accent-btn);color:#fff}`); `.mgrid3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding-bottom:6px}`; `.mtile` (`.mskin` visual language: sheen+box gradient, `--line` border, `border-left:3px solid var(--tier-color,var(--mut))`, notch clip-path; `img{height:64px;object-fit:contain;width:100%;padding:5px 6px 2px}`; `figcaption{font:500 10.5px/1.25 'Chakra Petch';color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:1px 6px 5px}`; `.mlv` = today's `.lv` badge styling); tier mapping `.mtile[data-tier=premium]{--tier-color:var(--tier-premium)}` etc. for all five tiers.
   - `mode-tabs` frame: `#mcard.mode-tabs{position:fixed;top:var(--tbh);left:0;right:0;bottom:0;margin:0;padding:0;display:flex;flex-direction:column;overflow:hidden;background:var(--c-bg)}` with an inner content column that reserves the bottom bar via `padding-bottom:calc(var(--mobar,91px))` (or flex spacer) so the last grid row is never hidden behind `#mactbar`/`#disclaimer`; `.mpanels{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}`; `.mpanel{display:none;padding:0 12px 14px}` `.mpanel.active{display:block}`; head/chips `flex:none`. In `mode-flow`: `#mcard` keeps today's static flow (margins per CF-14 block, line 162), all `.mpanel` visible, `.mpanel h3{position:sticky;top:0;z-index:6;background:var(--c-bg);padding:7px 2px}` (page-level fixed chrome sits above the flow, so sticky top:0 within the document flow is correct; validate no overlap with `#vchrome` at the 700 px boundary).
   - `--mobar`: measured bottom reserve (mactbar + disclaimer heights + 16 px) set by JS next to `--tbh` (change 3) with CSS fallback `91px`.
   - Preserve: `.mempty`, `.mbuddygrid`, `.mpcard`, `.msellerrow/.mtag/.mlink`, `.mstrip` styling (reused inside Info panel); `body.canvas-mode` rules stay in the file (dead on phones once plan 002 lands; desktop never ≤700 px).
3. `js/viewer.js` — bottom-reserve measurement
   - Change: where `makeFitter` keeps `--tbh` fresh, add a phone-only (≤700 px) `ResizeObserver` on `#mactbar` + `#disclaimer` writing `--mobar` = sum of heights + 16 px. Guard with `matchMedia('(max-width:700px)')`; never runs on desktop.
4. `view.html`
   - Change: none required by this plan (all DOM is generated into `#mcard`). Do not touch `#stage`/`#card` markup.

## Scope

- Inherit: every published listing opened at ≤700 px, including `?view=` deep links (they fall back to native per plan 002) and the edit-token "← Editor" flow.
- Verify: `browse.html` quick view does NOT use `renderMobile` (it carries the real `#card`, `browse.js:3`) — confirm no import of the changed skeleton; PNG export untouched (`#card` unchanged); desktop `view.html` byte-identical render (media-scoped CSS + `innerWidth` guards).
- Exclude: canvas modes' phone behavior (plan 002), quick-view preview, editor, themes other than via existing tokens, `payload` schema, Supabase, presence, view counters, i18n.

## Validation

- Product: buyer opens `view.html?slug=t63ii96` on a 390×844 phone → sees identity/ranks/stats AND first skin tiles without scrolling; reaches any of the 75 skins via ≤2 taps (chip → in-panel scroll); taps a tile → inspect overlay with correct skin (verify against payload order for first/last skin of Sidearms and Rifles); price + Contact seller pinned and un-truncated ("CONTACT FOR PRICE" fully visible at 17–20 px display font); total page scroll ≈ 0 (`scrollHeight ≤ innerHeight + 40`).
- Interface: `?slug=rfamxkq` (1 skin) → mosaic mode, Info panel present, no awkward void; `?slug=zvu3vr3` (0 skins) → `.mempty`, Info-only chips; 360×640 → head ≤180 px, grid still ≥3 rows visible; 700→701 px resize boundary → frame releases to desktop canvas without stuck `position:fixed`; re-render idempotency: rotate/resize twice → inspect indices still correct (open last Sidearms tile).
- System: tiles reuse `.mskin` visual language and tier tokens — no parallel design vocabulary; SPV_LIST has exactly one fill site (`markInspectCells`).
- Repository: `npm run lint` → 0 errors. Desktop regression: Playwright screenshot diff of `view.html?slug=t63ii96` at 1920×1080 vs commit `a48a3ad` capture (`.orchestrator/qa/06-view-desktop-r1.png`) → no layout delta.

## Stop conditions

- Stop if the condensed head cannot fit ≤180 px at 360×640 without dropping rank or stat info (renegotiate head content with the user before shrinking tiles).
- Stop if inspect-overlay indices cannot be made deterministic without touching `markInspectCells` (desktop-path change would violate D3).
- Stop if `#cardsHint` placement requires layout math instead of living inside the Info panel (coordinate math was explicitly removed in `a762e17`).

## Design documentation

- After acceptance and validation: update `README.md` "Card layouts (density modes)" — one sentence: on phones the native listing view is a viewport-bounded hybrid (category tabs above 24 skins, dense mosaic below); canvas modes are desktop/tablet (>700 px) only. Record decision in `MOBILE-AUDIT.md` → status column of Finding 1.
