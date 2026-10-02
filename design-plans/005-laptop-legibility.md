# Laptop legibility pass — card design-time font floor (prior audit P0-2)

Written against: commit `04d8503` (staging) · Status: APPROVED by user ("do the laptop legibility pass right afterwards") · Explicitly overrides D3 for this scoped pass: the card's appearance changes at ALL viewports (that is the point — the card is one 1920×1080 canvas scaled down; laptops at 0.57–0.72× are illegible today).

## Evidence chain
- Surface: every render of `#card` — editor (`index.html`), viewer canvas (`view.html` >700px), browse quick view, PNG export.
- Problem: at 1366×768 the card scales to ≈0.57–0.63; design-time 10–12px text lands at 5.7–7.6px on screen (UIUX-AUDIT.md P0-2 table; sizes re-verified against `04d8503`).
- Design evidence: UIUX-AUDIT.md P0-2 prescribed fix — "bump the 9px class to ≥12px and the 10–11px labels to ≥13–14px in css/shared.css".
- Owner: `css/shared.css` (card rules), `css/editor.css` (`.pickrank` only).
- Scope: font-size values ONLY. No letter-spacing, padding, box sizes, layout, structure, breakpoints, chrome (`#topbar`/`#status`/`#disclaimer`/`#buildstamp`), mobile native layout (`#mcard`), or viewer.css changes.
- Uncertainty: wrap/overflow behavior of bumped labels in narrow boxes → measured QA at 1366×768, 1536×864, 1920×1080 required after implementation.

## Bump table (18 changes; locate by selector, not line number)

`css/shared.css`:
| Selector | Current | New |
|---|---|---|
| `.ico` (V/R/K glyph, ~L113) | `font:700 11px` | `font:700 13px` |
| `.panel h3` (~L128) | `font-size:14px` | `font-size:15px` |
| `.skin .lv` (~L142) | `font:700 10px/1` | `font:700 12px/1` |
| `.add` (~L149) | `font:700 13px` | `font:700 14px` |
| `.hint` (~L154) | `font-size:12px` | `font-size:13px` |
| `.flexcol h3` (~L157) | `font-size:11px` | `font-size:12px` |
| `.flexcol .add` (~L160) | `font-size:10px` | `font-size:12px` |
| `.stat label` (~L169) | `font-size:12px` | `font-size:14px` |
| `.auto` (~L172) | `font:600 12px` | `font:600 13px` |
| `.rankrow label` (~L180) | `font-size:12px` | `font-size:14px` |
| `.pclabel` (~L187) | `font-size:11px` | `font-size:13px` |
| `.link` (~L191) | `font-size:12px` | `font-size:13px` |
| `.wstrip` (~L211) | `font-size:11px` | `font-size:13px` |
| `.skin.tile .tname` (~L255) | `font:500 11px/1.2` | `font:500 13px/1.2` |
| `.jchip` (~L259) | `font:700 12px` | `font:700 13px` |
| `.slots.tiles .jchip,.panel[data-cat="Melees"] .slots .jchip` (~L264) | `font-size:10px` | `font-size:12px` |
| `.skin.named .tname` (~L267) | `font:500 12px` | `font:500 13px` |

`css/editor.css`:
| `.pickrank` (~L18) | `font:700 11px` | `font:700 13px` |

## Do NOT touch (deliberately unchanged)
`.code` 52 · `.vlogin` 16 · `.cur` 16 · `.lvl` 14 · `.inforow` 15 · `.rankrow` 14 · `.stat b` 26 · `.tag` 17 · `.rm` 11 (button glyph in fixed 18px box) · everything outside the two files · any `@media` block.

## Expected outcome
Worst laptop (viewer 1366×768, ≈0.574×): smallest card text 12px→6.9 (was 5.7), labels 13–14px→7.5–8.0, headings 15px→8.6, ranks 14px→8.0. At 1536×864/125% (≈0.66–0.72×): 7.9–10.1px. At 1920×1080 (≈0.92–1.0×): everything ≥11px — slightly larger than today, no overflow (all bumped strings were measured against their boxes; ellipsis/wrap behavior already exists where tight).

## Validation (orchestrator-run, post-implementation)
- `npm run lint` → 0 errors.
- Playwright 1366×768 editor + viewer: computed scale, effective px per bumped class, screenshots; vision check for clipped/wrapped/overflowing labels (panel h3, stat labels, wstrip, pclabel, flexcol).
- 1536×864 viewer screenshot. 1920×1080 editor + viewer regression screenshots (vision: no layout deltas beyond slightly larger text).
- PNG export from editor (full mode) → succeeds, height unchanged class of result (~3840×2156), no capture errors.
- Browse QV at 1366×768 → card preview legible improvement, modal intact.
- Then: commit + push origin staging; verify staging buildstamp sha.

## Stop conditions
- Any bumped label overflows/clips its box at 1920×1080 design scale and cannot be accommodated → revert that single token to its old value and note it; do not adjust spacing/sizing to compensate.
