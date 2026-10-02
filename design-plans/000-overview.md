# Mobile viewer rework — Overview & shared constraints

Written against: commit `a48a3ad` (2026-10-02) · Audit: `MOBILE-AUDIT.md` · Status: **PROPOSED — awaiting user approval of `prototype-mobile-v2.html`**

## Decisions carried by every plan in this set

- **D1 Hybrid layout:** total skins > `TAB_THRESHOLD` (default **24**, one exported constant) → *tabbed frame* (category chips + one 3-col grid, internal scroll, page does not scroll); ≤ threshold → *dense mosaic* (single page flow, sticky category headings, same tiles).
- **D2 Canvas modes hidden ≤700 px:** `#viewSwitch`, `#zoomDock`, `body.canvas-mode` never render/apply on phones. `?view=m1|m2|m3` deep links on phones fall back to the native layout (param preserved in URL for desktop opens). >700 px unchanged.
- **D3 HARD CONSTRAINT — desktop/tablet untouched:** every CSS change lives inside the existing `@media (max-width:700px)` (viewer) / `@media (max-width:760px)` (shared/editor/browse phone rules) blocks or new blocks at those same breakpoints; every JS change is guarded by `innerWidth <= 700` (the codebase's existing phone guard, `viewer.js:423`) or only executes in the `#mcard` render path. No breakpoint values change. Acceptance: at 1920×1080 and at 768×1024, `view.html`, `index.html`, `browse.html` render pixel-identical to commit `a48a3ad` (verified by before/after screenshots + `documentElement.outerHTML` structural diff of the desktop render path).
- **D4 Prototype-first:** `prototype-mobile-v2.html` in this folder is the approved-visual reference; executors match it.
- **D5 Secondary batch** (plan 003) is independent of 001/002 and can ship separately.

## Plans

| File | Covers | Depends on |
|---|---|---|
| `001-mobile-viewer-hybrid.md` | Finding 1 — `renderMobile` v2: condensed head, tabbed frame, dense mosaic, tiles, inspect wiring | prototype approval |
| `002-chrome-and-state.md` | Findings 2+3 — phone topbar one row + overflow, hero merge, switcher/canvas/zoom hidden ≤700 px, deep-link + resize-boundary behavior | 001 (same files) |
| `003-secondary-batch.md` | QV phone preview thumbs, editor phone tap targets ≥44 px, caption de-dup, honest desktop zoom label | none |

001 and 002 touch the same files (`js/viewer.js`, `css/viewer.css`, `view.html`) — execute 001 then 002 sequentially, never in parallel. 003 is parallel-safe.

## Global verification (all plans)

- `npm run lint` → 0 errors.
- Phone 390×844 (`view.html?slug=t63ii96`): `documentElement.scrollHeight <= innerHeight + 40` in tabbed mode; first skin art visible without scrolling; category chips switch grid content; tap tile opens inspect overlay; pinned price/contact bar present at all scroll states.
- Small-listing phone check (`?slug=rfamxkq`, 1 skin): mosaic mode, no chip strip, empty categories absent, page ≤ ~2 screens.
- Desktop 1920×1080 + tablet 768×1024: `view.html?slug=t63ii96` — canvas card at ≈1× / ≈0.4×, `#viewSwitch` + zoom dock visible and functional, zero layout deltas vs `a48a3ad` screenshots.
- No new dependencies; no changes to `payload` shape, publish flow, PNG export, or Supabase queries.
