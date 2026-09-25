# CardForge — UI/UX Audit (Visibility & Eye Comfort)

**Date:** 2026-09-26 · **Scope:** `index.html` (editor), `browse.html`, `view.html` (viewer), `terms.html`, `privacy.html`, all 5 card themes, chrome, and modals.
**Method:** WCAG 2.1 contrast computed for every shipped text/background pair (`.orchestrator/contrast.mjs`, `contrast2.mjs`); effective on-screen text size derived from the live `makeFitter` scale; every page rendered in a real browser at 1920×1080, 1366×768 and 390×844; 11 screenshots analyzed by a vision model. Read-only audit — no product code changed.

---

## Executive summary

The desktop editor looks sharp and the dark themes are well-tuned. But the app has **one structural visibility defect that dominates everything else**: the card is a fixed 1920×1080 canvas that JavaScript scales down to fit the viewport, so on any real screen the text shrinks below comfortable reading size — and on a phone it shrinks to **3–5 px, i.e. illegible**. The buyer's mobile path (opening a shared listing link) is effectively broken. Layered on top are a handful of measured contrast failures (the primary CTA, the Arctic light theme's borders, modal secondary text) and reading-comfort problems on the legal pages.

**Top 5 by impact on "visibility & ease on the eyes":**

| # | Finding | Severity | Who it hurts |
|---|---------|----------|--------------|
| 1 | Mobile viewer/editor: card scaled to 0.35 → text 3–5 px, illegible | **P0** | Buyers on phones (revenue path) |
| 2 | Laptop downscale: at 1366×768 (0.63×) and 125 % DPI (0.72×) the card's small text drops below readable | **P0** | Everyone on a laptop |
| 3 | Primary CTA `#fff on #FF4655` = **3.36:1**, fails WCAG AA | **P1** | All users (most prominent action) |
| 4 | Arctic light theme: structural borders **1.26–1.68:1** → empty slots/panels lose definition | **P1** | Light-theme users |
| 5 | Legal pages: **~103 chars/line** + 14 px grey body → eye strain on long-form reading | **P1** | Anyone reading Terms/Privacy |

---

## P0 — Visibility blockers

### P0-1 · The scaled card is illegible on phones (buyer path broken)

`makeFitter()` (`js/shared.js:99`) keeps the card at its 1920×1080 design size and scales it to fit, with a floor of `0.35`. On a 390 px phone the floor engages:

- Card renders at **0.35×** → a 9 px watermark becomes **3.1 px**, 13 px panel headings **4.5 px**, 14 px info rows **4.9 px**, even the 52 px code is only **18 px**.
- The stage then scrolls horizontally (`scrollWidth 672 > clientWidth 390`), so the user pans around a tiny unreadable card.

**Vision-model verdict on the 390 px viewer** (what a buyer sees from a shared link): *"Bluntly: no, this page is not usable on a phone for a buyer. A buyer … cannot read the seller's price … cannot read rank details … cannot read skin names … can barely read the stat numbers. The only clearly legible elements are 'K486', the view counter, and the three action buttons."*

This is the single most important screen for the product's purpose (a seller shares a link → a buyer reads it → contacts the seller), and it fails on the most common device.

**Fix (structural, recommended):** the viewer needs a **mobile-native layout** below ~700 px — instead of scaling the 1920 canvas, re-flow the same structured payload (`{texts, ranks, picks, assets, theme}`) into a single-column, full-width, readable HTML card (stacked stat grid, rank badges inline, skin images in a 2-col grid with names). The data is already structured; this is a render-path change, not a data change.
**Fix (stop-gap, cheap):** raise the floor to ~0.6 and enable pinch-zoom (`touch-action:pinch-zoom` on `#stage`) + a visible "pinch to zoom" hint. This makes the card scrollable-and-zoomable rather than fixed-tiny, but a native layout is the real answer.

### P0-2 · Card text drops below readable on laptops (all users)

Even on a "big" screen the card never renders 1:1, because `availH = innerHeight − topbar − 34` forces a downscale to fit vertically:

| Viewport | Scale | 9 px → | 11 px → | 13 px → | 14 px → | 26 px stat → |
|----------|-------|--------|---------|---------|---------|--------------|
| 1920×1080 (FHD) | 0.92 | 8.3 | 10.1 | 12.0 | 12.9 | 23.9 |
| 1536×864 (FHD @125 % DPI — very common) | 0.72 | **6.5** | **7.9** | **9.4** | 10.1 | 18.7 |
| 1440×900 | 0.74 | 6.7 | 8.2 | 9.6 | 10.4 | 19.3 |
| 1366×768 (HD laptop) | 0.63 | **5.7** | **6.9** | **8.2** | **8.8** | 16.4 |
| 1280×720 | 0.59 | 5.3 | 6.5 | 7.6 | 8.2 | 15.3 |

The card's smallest text is designed at 9–13 px (`.wstrip` 9 px, `.auto` 9 px, `.pickrank` 9 px, `.hint` 10 px, `.pclabel` 10 px, stat/rank labels 11 px, `.link` 11 px, panel `h3` 13 px). After downscale these land at **5.7–9.4 px** on the most common laptop resolutions — below the ~10–11 px floor for comfortable reading.

**Vision-model verdict at 1366:** *"the 'auto' label is now essentially illegible without zooming. The footer disclaimer is strained … Overall legibility 7/10 … a 1366×768 laptop user … will squint at the fine print."*

**Fix:** raise the card's *design-time* minimum font sizes so they survive the downscale — bump the 9 px class (`.wstrip`, `.auto`, `.pickrank`) to ≥12 px and the 10–11 px labels to ≥13–14 px in `css/shared.css`. At 0.63× that yields ~7.5–8.8 px on screen (still small but legible); at 0.92× it's comfortable. Pair with P0-1's mobile layout. Alternatively let the card scroll at a higher floor on short viewports rather than shrinking to fit.

### P0-3 · Mobile editor topbar eats a quarter of the screen

At 390 px the topbar wraps to **146 px tall** (~25–30 % of an 844 px screen) because all 7 action buttons (`Browse / Import / Export / Save / Load / Copy post text / Publish`) wrap into 2–3 rows. The vision model: *"The nav bar takes ~25–30 % of screen height with 7 buttons across 2 rows — this is excessive for a mobile editor where the card content should be the focus."*

**Fix:** below ~700 px collapse secondary actions (`Save`, `Load`, `Copy post text`, `Import`) into a single overflow "⋯" menu, keeping only `Export`/`Publish` visible. Target topbar height ≤ 60 px on mobile.

---

## P1 — Measured contrast & eye-strain failures

### P1-1 · Primary CTA fails WCAG AA — `#fff` on `#FF4655` = **3.36:1**

The most prominent action in the app (`Export PNG`, the import `Import` button, and the `.cnt` "×N" badge) is white 11 px text on the brand red. AA needs 4.5:1 for normal-size text; 3.36:1 fails, and at 11 px there is no large-text exemption.

**Fix (pick one):**
- **Darken the button fill** behind white text to ~`#D62839`/`#C81E2B` (verify ≥4.5:1), keeping white labels; or
- **Keep `#FF4655` and switch the label to near-black** (`#1A0308`) — dark-on-red measures ~5.2:1 and preserves the exact brand red.
- Reserve `#FF4655` as a *border/accent* (it passes the 3:1 UI-component threshold at 5.42:1 on the topbar) rather than a text background.

### P1-2 · Arctic (light) theme: structural lines vanish — borders **1.26–1.68:1**

The Arctic body *text* is fine (`--mut #525D6B` on cream = **6.1:1**, `--ink` = 16:1). The problem is **non-text structure**: `--line #C4BEB2` on `--card1 #F7F4EE` = **1.68:1**, on `--panel` = **1.6:1**, and `--box` on card = **1.26:1** — all far below the 3:1 WCAG UI-component threshold. Empty slot boxes, dashed slot borders, panel dividers and the "click to upload" affordances lose their edges.

**Vision-model verdict (Arctic):** *"+ ADD placeholder text … dashed slot borders … very light grey on cream … nearly invisible at a glance."* (The wash it perceived is the borders/affordances, not the text.)

**Fix:** for `[data-theme=arctic]` only, darken `--line` to ~`#9A9282` and `--box` to ~`#D6CFC0` (target ≥3:1 against `--card1`), and strengthen the empty-slot dashed border (e.g. `--mut`-tinted). This is a token-only change scoped to Arctic; the dark themes' borders (1.3:1) read fine because the sheen/gradient separates slots.

### P1-3 · Legal pages strain the eyes — ~103 chars/line + 14 px grey body

`.legal` is `max-width:760px` with 20 px padding → ~720 px measure. At 14 px that's **~103 characters per line** (comfortable max is 60–75). Body text is `--mut #8A99A9` (6.6:1 — passes) but at 14 px on near-black, long-form.

**Vision-model verdict:** *"The single biggest readability problem … is excessive line length (~95–110 characters per line) … forces the eye to travel too far horizontally … especially combined with the low-contrast grey text."*

**Fix:** in `css/legal.css`, narrow the measure to ~`62ch` (≈ `max-width:680px` or add horizontal padding), bump body to **15–16 px**, and consider `--ink` (or a lighter `--mut`) for body copy so long-form reading is high-contrast. Keep `line-height:1.65`.

### P1-4 · Modal secondary text fails AA — `--c-mut` on `--c-surface2` = **4.39:1**

The import-modal explanatory paragraph, `.ilabel`, `.ihelp`, `.mcount` and `.inote` are `--c-mut #77828E` on the modal panel `--c-surface2 #151C24` = **4.39:1** (just under 4.5). The vision model independently flagged the import paragraph as *"~3.5–4:1, under WCAG AA for small text … one solid block of ~5 lines with no visual chunking."*

**Fix:** lighten modal secondary text to ~`#8A95A1` (≥4.5:1 on `#151C24`), and break the import paragraph into 2–3 short paragraphs or a bullet list (it currently explains token expiry, HTTPS-only, never-stored, and the Owned-filter unlock in one run-on block).

### P1-5 · All feedback is one 12 px muted status line — invisible on mobile, no error/success distinction

Every action (save, load, export, publish, import) reports through a single `#status` span: 12 px, `--c-mut`, `max-width:360px`, `white-space:nowrap` + ellipsis, and **`display:none` below 760 px** (`css/shared.css:184`). Consequences:

- **On mobile, publish/export success *and* failure are completely invisible** — the user gets nothing.
- Long messages truncate silently (e.g. `Imported name#tag — level 376 · partial: …`).
- Errors (`Publish failed: …`, `Export failed: …`) render in the *same* quiet grey as `Draft saved.` — no color/icon difference, so failures don't read as failures.

**Fix:** replace/augment `#status` with a small **toast** that (a) is visible on mobile, (b) colors success vs error (e.g. green/red left-border + icon), (c) wraps instead of truncating, and (d) auto-dismisses successes but persists errors until acknowledged. Keep `aria-live="polite"`.

### P1-6 · `.warn` and Arctic accent text fail AA

- `.warn` (`NOT READY`, `UNLINKED`) `--red` on `--panel`: protocol **4.49:1** (fails by a hair), Arctic **3.66:1** (clear fail).
- Arctic `.stat.limited label` `--gold #8A6D1C` on panel = **4.24:1** (fails).
- Browse `.bfoot b` "View listing →" `--accent` on `--panel` = **4.49:1** (borderline fail) — the vision model still found it prominent, so this is low-urgency, but it's technically under AA.

**Fix:** nudge `--red`/`--gold` darker in Arctic (`--red`→~`#C22E3C`, `--gold`→~`#6E5614`) and lighten `--red` slightly in protocol dark themes, or bold the `.warn` text (bold ≥18.66 px is exempt, but these are 14 px, so a color fix is required). Re-check `.bfoot b` against the panel.

---

## P2 — UX polish & secondary visibility

### P2-1 · Remove-skin button is hover-only → unusable on touch & keyboard
`.rm` is `display:none` until `.skin:hover` (`css/shared.css:114-115`). On touch devices there is no hover, so a skin cannot be removed; it's also `display:none` so it's not keyboard-focusable. **Fix:** on coarse-pointer devices (`@media (hover:none)`) show `.rm` persistently; on desktop keep hover but also reveal on `:focus-within` of the slot.

### P2-2 · Browse page feels empty/abandoned with few listings
With one listing, ~85 % of the viewport is dead dark space (vision model: *"feels abandoned/incomplete … no empty-state guidance"*). The `.bempty` component only renders at **zero** listings. **Fix:** add a persistent secondary CTA ("Want to sell an account? Build a card →") and/or a subtle placeholder grid so 1–3 listings don't look broken; center or cap the grid width.

### P2-3 · Skin-picker sub-labels borderline; 6-col density
`.item span` (weapon • tier) is `--c-mut` on `--c-surface` = 4.65:1 (passes) but at 11 px the vision model called it *"borderline … could be improved by lightening the grey or increasing font size by 1 px."* The 6-column grid is dense. **Fix:** bump sub-label to 12 px / lighten to `#8A95A1`; consider 5 columns on <1200 px.

### P2-4 · Arctic focus ring is weak — `#FF4655` on cream = **3.06:1**
The `:focus-visible` inset ring barely clears the 3:1 UI threshold on the light card. **Fix:** use a darker focus color in Arctic (e.g. `#C22E3C`) or a double ring (dark + light) so keyboard focus is unmistakable on light backgrounds.

### P2-5 · Disclaimer & its Terms/Privacy links are tiny and low-contrast
`#disclaimer` is 10 px `--c-mut` (5.07:1 — passes) but the new `Terms · Privacy` links are `color:inherit` (same muted grey), 10 px, with no underline-weight or tap-target padding. On mobile they're a ~10 px target. **Fix:** give the links `--c-ink` color + `text-decoration:underline` + a little padding (≥24 px tap target), and consider 11 px.

### P2-6 · No visible affordance that card text is editable (editor)
Editable fields only reveal a dashed underline on hover (`[contenteditable]:hover`). A first-time user can't tell what's editable. **Fix:** add a subtle persistent cue (faint underline or a one-time "click any text to edit" hint in the status/toast on first load).

---

## Contrast measurement tables (WCAG 2.1)

**Failing text pairs (need 4.5:1 for <18.66 px bold / <24 px):**

| Pair | Ratio | Where |
|------|-------|-------|
| `#fff` on `--c-accent #FF4655` | **3.36** | Primary buttons (Export/Import), `.cnt` badge |
| `--c-mut #77828E` on `--c-surface2 #151C24` | **4.39** | Modal secondary text (import note, labels, help) |
| `--accent #FF4655` on `--panel #1F2731` | **4.49** | Browse "View listing →" CTA |
| protocol `--red #FF4655` on `--panel` | **4.49** | `.warn` (NOT READY / UNLINKED) |
| Arctic `--red #E03E4C` on `--panel` | **3.66** | `.warn` in light theme |
| Arctic `--gold #8A6D1C` on `--panel` | **4.24** | LIMITED stat label in light theme |

**Structural (non-text) lines — need 3:1 for UI components:**

| Theme | `--line` on card | `--box` on card | Verdict |
|-------|------------------|-----------------|---------|
| protocol (dark) | 1.30 | 1.21 | OK in practice (sheen/gradient separates slots) |
| Arctic (light) | **1.68** | **1.26** | Slots/panels lose definition — fix needed |

**Passing (no action):** all `--ink` body text (12–16:1), chrome `--c-mut` on topbar (4.65:1), legal body (6.6:1), browse meta (5.18:1), dark-theme `--mut`/`--gold`/`--red` labels (5–11:1), status text (4.65:1).

---

## Recommended sequencing

1. **P0-1 mobile viewer layout** — biggest product impact (buyer path). Structural; do first.
2. **P0-2 bump card design font sizes** + **P0-3 mobile topbar overflow** — cheap, large legibility win for everyone.
3. **P1-1 primary CTA color**, **P1-2 Arctic borders**, **P1-5 toast feedback** — token/component-level, high visibility.
4. **P1-3 legal measure**, **P1-4 modal text**, **P1-6 warn/gold colors** — reading-comfort.
5. **P2 polish** — touch remove button, browse empty state, focus ring, disclaimer links, editable cue.

Most P1 fixes are **single-token changes** in `css/shared.css` / `css/legal.css` and can be batched into one pass. P0-1 (mobile viewer) is the only genuinely structural item and warrants its own spec.

---

*Evidence: `.orchestrator/qa/30–40-*.png` (11 screenshots), `.orchestrator/contrast.mjs` + `contrast2.mjs` (computed ratios), live `makeFitter` scale measurements. Vision-model verdicts quoted inline.*
