# Plan 002 — Phone chrome: one-row topbar, hero merge, canvas modes desktop-only, state truth

Written against: commit `a48a3ad` · Covers: `MOBILE-AUDIT.md` Findings 2 + 3 · Status: **PROPOSED — awaiting prototype approval (D4)** · Depends on: Plan 001 (same files — execute 001 first, never in parallel).
Visual reference: `design-plans/prototype-mobile-v2.html` topbar + head block.

## Evidence chain

- Surface: `view.html` at 390×844 (default load and after switcher interaction); desktop/tablet >700 px must not change (D3).
- Problem: (a) `#topbar` wraps to 129 px / 3 rows carrying 6 controls, `#vhero` adds 105 px → 235 px pinned chrome (28 % of viewport), zero product on first screen; (b) switcher state contradicts the rendered surface: native layout visible while `TILES` has `aria-pressed=true` and SIMPLE is `hidden` (`viewer.js` `viewRefresh()` presses `viewMode||auto` unconditionally; `nativeBtn` un-hidden only inside the click handler at `viewer.js:423-426`).
- Design evidence: decisions D2 (canvas modes are the desktop experience; hide ≤700 px) and D3; CF-05 editor More-menu precedent (`editor.js:1068-1080`, `index.html` `#moreBtn/#moreMenu`) — an in-repo, shipped overflow pattern; CF-11 measured-chrome `--tbh` mechanism (`shared.js:139-140`) already keeps insets fresh when the topbar shrinks; prior audit P0-3 established the same collapse direction for the editor topbar (185→95 px, commit `77853bc`).
- Owner: `view.html` `#vchrome` markup, `css/viewer.css` + `css/shared.css` (≤760 px block, lines 209-217), `js/viewer.js` (boot lines 696-745, switcher 406-430, `viewRefresh` 385-397, zoom dock 664-684).
- Scope and affected surfaces: phone viewer chrome only. `#mactbar` (CF-11/12) untouched; desktop viewer, editor, browse untouched.
- Uncertainty: view-badge text length at 360 px ("2 viewing now • 38 total views") — specify compact form and validate.

## Design decision

On phones the viewer chrome collapses to **one ≤56 px row**: logo · compact view badge · ⋯ overflow (Browse listings / Copy link / ← Editor when present). `#vhero` no longer renders ≤700 px — its identity line (title, sub, status chip) is already merged into `#mcard`'s condensed head by Plan 001, and price/contact already live in the pinned `#mactbar` (CF-11/12 preserved). `#viewSwitch`, `#nativeBtn` and the zoom dock never render ≤700 px (D2), which makes Finding 2's false-pressed state structurally impossible on phones; the desktop switcher keeps its current behavior and honest pressed states because there `viewMode||auto` always matches the rendered canvas. `?view=m1|m2|m3` deep links on phones render the native layout while preserving the URL param (so a desktop open of the same link still lands in the chosen canvas mode).

## Reuse

- CF-05 More-menu pattern (outside-click + Escape close, `aria-expanded` toggle): replicate locally in `viewer.js` (~15 lines) + minimal menu CSS inside the ≤700 px block. Do NOT import `editor.css` into `view.html`, and do NOT extract a shared primitive (two consumers, different chrome contexts; improve-ui bar for new primitives not met).
- Control language: existing notched 28 px control rule (`css/viewer.css:189-193`) for the ⋯ button; compact badge = existing `#viewBadge` shapes with reduced padding (the ≤760 px rule at `viewer.css:100-102` already starts this).
- `--tbh` mechanism (`shared.js:139-140` + ResizeObserver): unchanged — it automatically picks up the shorter topbar; Plan 001's `--mobar` handles the bottom reserve.

## Changes

1. `view.html` — `#vchrome` markup (lines 39-67)
   - Change: wrap `#viewSwitch`, `a.tb-link` (Browse listings), `#copyLinkBtn`, `#editBtn` in a new `div#tbMore` (the ⋯ menu, `hidden` by default) preceded by `button#tbMoreBtn` (`aria-expanded=false`, `aria-controls=tbMore`, label "More actions", text "⋯"); keep original elements in DOM order inside the menu. Keep `#viewBadge` and `#status` as direct children of `.tb-right`. `#vhero` markup stays in the file (desktop needs it) — it is hidden by CSS ≤700 px (change 3).
   - Preserve: `#status` role/aria-live; `editBtn` hidden-until-token logic (`viewer.js:746-752`); viewSwitch button `data-view` values and `#nativeBtn` id (desktop consumers).
2. `js/viewer.js`
   - Change (phone boot branch, guarded `innerWidth <= 700` — the codebase's existing phone guard, line 423): at boot force `viewMode = null` and never add `body.canvas-mode`; ignore `?view=` for rendering but leave the URL untouched. Strip the CF-14 phone branch inside the switcher click handler (lines 421-426): with the switcher hidden ≤700 px it is unreachable there; keep the desktop path exactly as-is. In `viewRefresh()` (line 391), only press buttons when `!document.body.classList.contains('phone-native')` — add that body class in the phone boot branch so pressed-state logic is inert on phones and unchanged on desktop.
   - Change (resize boundary): one `matchMedia('(max-width:700px)')` listener: entering phone range → remove `canvas-mode`, add `phone-native`, trigger the CF-33 on-demand `renderMobile(currentListing, true)` if `#mcard` unfilled; leaving phone range → remove `phone-native`, re-apply `viewRefresh(currentListing)` honoring `?view=`/`viewMode` (desktop restores canvas + pressed states + zoom dock visibility). Zoom-dock code (664-684) untouched — existing CSS already hides the dock ≤700 px unless `canvas-mode`, which phones now never set.
   - Change (⋯ menu): CF-05-style wiring for `#tbMoreBtn`/`#tbMore` — toggle `hidden` + `aria-expanded`, close on outside click and Escape; when `editBtn` un-hides (line 747), it lives inside the menu (no extra work).
   - Change (badge compaction): `updateBadge()` (lines 66-70) writes compact text when `innerWidth <= 700`: `${n} • ${total}` (keep full sentence in `title` attribute + keep `aria-live` politeness via existing role). Desktop string unchanged.
3. `css/viewer.css` — inside/next to the ≤700 px blocks
   - Change: `@media (max-width:700px){ #vhero{display:none} #viewSwitch,#zoomDock{display:none!important} body.canvas-mode #zoomDock{display:none!important} #vchrome #topbar{flex-wrap:nowrap;min-height:0;height:52px;padding:6px 10px} .tb-left{flex:none} .tb-right{flex:1;min-width:0;flex-wrap:nowrap;justify-content:flex-end;gap:6px} #topbar .tb-link,#topbar #copyLinkBtn,#topbar #editBtn{display:none} #tbMoreBtn{ /* notched 28px control language of viewer.css:189-193 */ } #tbMore{position:absolute;top:calc(100% + 6px);right:10px;display:flex;flex-direction:column;gap:6px;background:var(--c-surface2);border:1px solid var(--c-line);padding:8px;z-index:30;min-width:190px} #tbMore[hidden]{display:none} #tbMore .tb-link,#tbMore #copyLinkBtn,#tbMore #editBtn{display:inline-flex;width:100%;height:40px} #status{display:none} }` — phone feedback rides the existing toast path (`CF.status` toasts are already mobile-visible per prior audit P1-5 fix; verify during QA — if `#status` is still the only feedback surface on view.html, keep it but move it into the ⋯-less flow: fallback = show as one-line under topbar, 12 px).
   - `#tbMore` action rows use ≥40 px height (touch target, consistent with plan 003).
   - Preserve: everything ≥701 px — all new rules live strictly inside `@media (max-width:700px)`; the ≤760 px `#viewBadge` compaction (line 100) may stay (harmless) or fold into the 700 block; do not delete shared ≤760 px rules used by editor/browse.
4. `css/shared.css` — ≤760 px block (lines 209-217)
   - Change: none if viewer-specific rules suffice (prefer viewer.css). Only if `#topbar` height fight occurs: scope an override under `#vchrome` in viewer.css — never edit the shared block's desktop-affecting properties (D3).

## Scope

- Inherit: all phone visits to `view.html`, including deep links `?view=m1|m2|m3` (native render, param preserved) and `?slug=` + edit-token sessions (Editor entry inside ⋯ menu).
- Verify: desktop 1920×1080 and tablet 768×1024 — switcher visible/functional, pressed states truthful, zoom dock works, hero renders, `#status` visible, zero visual delta vs `a48a3ad`; 700↔701 px resize crossing in both directions with a listing loaded; `browse.html`/`index.html` chrome unaffected (shared.css untouched or viewer-scoped only).
- Exclude: editor topbar (plan 003 handles tap targets), browse page chrome, toast system redesign, presence logic, buildstamp positioning (already phone-aware, `shared.css:240`).

## Validation

- Product: phone 390×844 → chrome row ≤56 px measured (`#vchrome.getBoundingClientRect().height` with hero hidden = topbar only); first screen shows identity + ranks/stats + skin tiles; ⋯ opens Browse/Copy link; copy link still writes clipboard (`CF.copyText`); badge shows compact "2 • 38".
- Interface: `?view=m2` on phone → native layout renders, URL keeps `view=m2`; resize 390→1024 → showcase canvas + SHOWCASE pressed + dock visible; resize back → native, no stuck classes (`document.body.className` clean of `canvas-mode`); edit-token present → "← Editor" inside ⋯ menu navigates to `index.html?edit=`.
- System: no new shared primitive; ⋯ menu mirrors CF-05 semantics (`aria-expanded`, outside-click, Escape); pressed-state logic has a single phone inertness switch (`body.phone-native`).
- Repository: `npm run lint` → 0 errors; desktop screenshot diff vs `.orchestrator/qa/06-view-desktop-r1.png` → no delta.

## Stop conditions

- Stop if hiding `#vhero` on phones orphans any buyer-critical datum not present in Plan 001's head or `#mactbar` (audit the exact field list: title, sub, status, price, contact, negotiable — all must have a phone home before hiding).
- Stop if `#status` turns out to be the only feedback channel on view.html phones (then keep a visible compact status line instead of `display:none` and note it in the report — do not silently drop publish/copy feedback).
- Stop if any rule needed to win against `a48a3ad`'s hard-locked 28 px control heights requires raising specificity outside the ≤700 px scope.

## Design documentation

- After acceptance and validation: note in `README.md` (Card layouts section, one clause): phone viewer chrome is a single row with an overflow menu; canvas modes + zoom dock are >700 px only. Update `MOBILE-AUDIT.md` Findings 2-3 status.
