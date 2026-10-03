# Plan 006 — Export PNG fidelity (embedded fonts + true 1080 crop)

Written against: commit `b5d9f8b` · Covers: `HANDOVER.md` §6 items 2 + 3 (the "12 benign console errors" and export filename rounding — item 2 was misfiled, it is a real defect) · Status: **IMPLEMENTED (phases 0-5, uncommitted) — phase 6 (`+N MORE`) ON HOLD pending owner decision**

## Problem

The PNG from **Export PNG** does not match the card the user is looking at. `DIAMOND 2` exports as `DIAMON…`, the stat labels wrap, the category panels are a different height, a ~200 px band of empty card opens above the QR footer, and a rank badge can vanish. The `og:image` uploaded on publish (`js/editor.js:1468`) is the same render, so the Facebook link preview is affected identically.

## Evidence chain

Reproduced locally: seeded a payload matching the reported screenshots (4 sidearms / 0 SMGs / 2 shotguns / 6 rifles / 2 snipers / 1 MG / 8 melees, `K486`, `DIAMOND 2`, `IMMORTAL 3`) into the real editor card, ran the real `captureCardBlob` path at `pixelRatio: 2`, dumped the PNG. The output reproduces the reported artifact symptom-for-symptom. Baseline kept at `%TEMP%\opencode\cf-before-export.png`.

| Check | Live card | Exported PNG |
| --- | --- | --- |
| `@font-face` rules reaching the SVG | — | **0** (`getFontEmbedCSS()` returns `""`) |
| Chakra Petch probe text width | 75 px | 85 px (**+13.3 %** → Arial fallback) |
| Anton probe text width | 102 px | 145 px (**+42.2 %**) |
| Grid rows (px) | `161.2 161.3 161.3 177.4 96.7 217.7` | `94.0 94.0 0 183.9 183.9 192.2` |
| Sidearms panel height | 798 px | 596 px |
| Melees panel height | 284 px | 378 px |
| Filename label vs. real file | — | says `3840×2436`, file is **3841×2441** |

Three independent defects, all inside the one capture choke point:

- **A — fonts are never embedded.** `js/shared.js:434` captures via `html-to-image` → SVG `<foreignObject>` → rasterized as an isolated `<img>`. No external resource can load in that context, so fonts must be inlined as data URIs. `getFontEmbedCSS` reads `document.styleSheets[].cssRules` to find `@font-face` rules; the two Google Fonts stylesheets (`index.html:15-16`) are cross-origin, so it throws `SecurityError` — logged 12× per export, logged in `HANDOVER.md:166` as benign. It is the whole bug. Every glyph falls back to the generic sans at +13 %/+42 % width, which overflows `.rankrow b{max-width:100%;text-overflow:ellipsis}` (`css/shared.css:182`) → `DIAMON…`, and wraps `SEMI PREM`, `K 6422`, `CHANGE NAME`, `0TH OWNER`, `K486`, and the QR caption.
- **B — the export discards the designed grid.** `css/shared.css:105` sets `body.exporting-full #card.is-live .grid{height:auto;grid-template-rows:none}` under the banner *"WYSIWYG capture: unfold the live scroll containers into a tall document"*. Dropping the `1fr 1fr 1fr 1.1fr .6fr 1.35fr` rows (`css/shared.css:119-120`) makes every row content-sized: the Shotguns row collapses to **0 px**, panels shrink to their `min-height:64px` floor (`css/shared.css:136`), the footer row grows, and the leftover space becomes dead card background above the QR band (`.wstrip` is pushed up 140 px by `js/shared.js:456`). Nothing about this is WYSIWYG; it is a second, different layout.
- **C — images fail silently.** `js/shared.js:465-471` swaps every `<img>` through `toDataUrl` (`js/shared.js:367`); any single failed fetch returns `null` and the element is replaced with a 1×1 transparent gif (`BLANK`, `js/shared.js:463`) with no retry and no warning. That is why the CURRENT rank badge rendered as an empty 52 px box while PEAK's survived — one fetch failed.
- **D — the filename lies.** `js/shared.js:490` derives the height from `card.scrollHeight`, not from the produced raster, so the label reads `3840×2436` for a 3841×2441 file.

## Design decision

Four owner decisions, recorded:

- **D1 — keep the fonts.** Anton + Chakra Petch stay exactly as they are; no typography change. The fix is to make the capture able to embed them, by **vendoring those same two families locally** so the `@font-face` rules are same-origin and readable. Reversible: the alternative is assembling `fontEmbedCSS` at runtime from the Google CSS (same result, but every export then depends on network + CORS).
- **D2 — strict 1080 crop.** The export is exactly the 1920×1080 card. Drop the unfold/scale machinery entirely; clipping, row heights and panel sizes in the PNG are then literally the preview's, because the capture no longer resizes anything. The QR band moves **below** the crop instead of inside it. PNG becomes **3840×2440** (2160 card + 280 band); `og:image` stays 1920×1080 JPEG.
- **D3 — editor chrome stays hidden.** `.add`, `.pickrank`, `.auto`, `.hint` (`css/shared.css:97-99`) are untouched.
- **D4 — `+N MORE` becomes load-bearing.** A strict crop silently hides overflow (the reported payload loses its 4th melee row with zero signal), so the already-written overflow chip gets enabled — as a **separate, opt-in** phase, because it changes the preview and the published card too.

Net effect: the export stops being a re-layout and becomes a straight capture of the thing on screen.

## Reuse

- `html-to-image`'s existing `FONT_FACE_RULE` → data-URI inlining (verified present in `js/vendor/html-to-image.js`): once the fonts are same-origin it embeds them with **no change to `captureCardBlob`**.
- The existing QR band builder `makeQrFoot` (`js/shared.js:400-430`) — only its position and caption font change.
- The `body.exporting …` block (`css/shared.css:88-92`) that already un-chromes the card and neutralises the stage transform.
- The already-implemented overflow chip `moreChip` (`js/layouts.js:88-95`) + `.jchip` styling (`css/shared.css:260-265`), including `body.exporting .more-note{display:none}` (`css/shared.css:99`) which already strips the chip's long note from exports.
- The measured live `gridTemplateRows` already available at capture time — no new measurement framework needed.
- `playwright-core` is already a devDependency, so the verification harness needs no new dependency.

## Changes

1. **`scripts/check-export.mjs`** (new, implemented) + `npm run check:export` — measurement harness, built **first** so every later phase is verifiable and regressions are caught mechanically.
   - Boots a same-origin static server on :3100, launches playwright-core (chrome → msedge → bundled), seeds `localStorage['vcard-draft-v2']` (the editor auto-restores drafts at boot, `js/editor.js:1658`) with a fixed 23-skin payload using **same-origin data-URI icons**, so the real `applyLayout`/`renderSlotsM1` renderers build the card — hand-injected `.skin` divs would bypass the renderers and mask layout regressions.
   - Asserts three properties through the real `captureCardBlob`:
     1. **font drift** — Chakra Petch and Anton probes rasterized through the capture vs. `measureText` in the live DOM. Pre-fix **+13.3 % / +42.2 %**; post-fix **0.6 % / 0.6 %**; threshold 2 %.
     2. **geometry identity** — grid rows + `grid.offsetHeight` sampled every frame during a real capture vs. live. Pre-fix `161 161 161 177 97 218` → `94 94 0 184 184 192`; post-fix identical on every sample.
     3. **dimension truth** — `blobDims(blob)` vs. `pngName()`. Pre-fix `3841×2441` labelled `3840×2436`; post-fix `3840×2440` = `showcase-card-3840x2440.png`.
   - Writes the produced PNG to `%TEMP%\opencode\cf-after-export.png` for visual diff against `cf-before-export.png`.
   - **Two measurement traps found while writing it (keep in mind when editing the probes):** SVG text layout counts one trailing letter-spacing advance that `canvas.measureText` does not, so probes must carry `letter-spacing:0` or every reading shows ~9 %/~27 % phantom drift; and the editor fitter's transform makes `getBoundingClientRect` zoom-dependent, so geometry baselines must use `offsetHeight`.
2. **Vendor the card fonts** (fixes A, and the `og:image` with it)
   - `scripts/fetch-fonts.mjs` (new, one-time; **output committed**): fetch the Google CSS with a Chrome UA, extract the `latin` woff2 for **Anton 400** and **Chakra Petch 400/500/600/700**, write `fonts/*.woff2`, emit `css/fonts.css` with same-origin `@font-face`.
   - `index.html`, `view.html`: add `<link href="css/fonts.css" rel="stylesheet">` **before** `shared.css`; drop Anton/Chakra Petch from the Google Fonts links (Inter/Manrope stay — chrome only, never exported).
   - `js/shared.js:423-424`: QR caption `font: … Inter` → `'Chakra Petch'`, otherwise that band keeps falling back.
   - `scripts/copy-static.mjs:5`: add `fonts` to `DIRS` (Netlify's build command is this script, so it deploys).
   - Optional: long cache header for `/fonts/*` in `netlify.toml`.
   - Preserve: `body.exporting …` (all of it) — no change to the capture call.
3. **Pin the export to the live 1080 geometry** (fixes B)
   - Implemented smaller than originally drafted: today's code already grows the card to `offsetHeight+140` (=1220), absolutely positions the band at the bottom and pushes `.wstrip` up — that machinery was correct and stayed verbatim. The real edits were three: (a) stop adding `exporting-full`, (b) pin `grid.style.height` to the live-measured px inside `captureCardBlob`, (c) delete the four `body.exporting-full …` rules. `opts.full` and `card.dataset.exportHeight` removed; `js/editor.js` export handler now passes `{ qrUrl }` only.
   - Note for future readers: `#card`'s chamfer `clip-path` (`css/shared.css:84`) and the `#card::after` corner accent (`:86`) frame the **grown 1220 box**, i.e. the outer corners of the whole PNG including the band. That is the intended look (visible in the pre-fix screenshot too) — do not "fix" it back onto the 1080 crop.
   - Measurement gotcha found while implementing: the editor fitter scales `#card` with a transform, so `getBoundingClientRect()` on the grid returns zoomed px in the live state. The pin measures **after** `body.exporting` is applied (transform is `none` there), so it reads true layout px; any future baseline comparison must use `offsetHeight` or divide by the fitter scale.
   - `css/shared.css:102-105`: the four `body.exporting-full …` rules are deleted (replaced by a comment recording why).
   - `js/editor.js:992`: `exportCard(card, { qrUrl })`.
   - Preserve: `css/shared.css:88-92` (`body.exporting …`), `.wstrip` geometry (`:211-212`), the `body.exporting` chrome hiding (`:97-99`), the `publish`/`og:image` path (`js/editor.js:1468`, no `qrUrl` → 1920×1080 JPEG, unchanged).
4. **Stop losing icons silently** (fixes C) — `js/shared.js:462-471`
   - Before swapping, `await img.decode()` on every card image (with a timeout); retry once on failure.
   - Swap only images that actually decoded; count the rest and surface them (`CF.status(…,'err')`: `3 icons couldn't be loaded — they're missing from this PNG`) so a degraded export is never shipped unnoticed.
   - Preserve: `toDataUrl` as the swap mechanism and the `swaps[]` restore loop.
5. **Honest output** (fixes D) — `js/shared.js:486 exportCard`
   - Decode the produced blob and name the file from its real pixel size (`showcase-card-3840x2440.png`).
   - `js/editor.js:986` — progress text from the measured size, not an assumption.
   - `js/editor.js:993` — replace *"exactly what your preview shows"* with the real dimensions + the band explanation.
   - `js/editor.js:1108-1110` — the tooltip claims *"a single 1920×1080 PNG"*; correct it.
6. **`+N MORE` for overflow** (D4, ON HOLD — changes the preview and the published card, not just the PNG)
   - `js/editor.js:60,1101` and `js/viewer.js:429`: flip `showAll: true` → `false`. This is the only change needed to activate `moreChip` — it is currently dead code because **both** call sites opt out of capping.
   - **Review correction — the cap math is NOT broken.** The original draft claimed `floor((H+6)/80)` under-counts melee rows ("2 rows where 3 physically fit"). The arithmetic says otherwise: n melee rows need `74n + 6(n−1) = 80n − 6` px, and with the reported payload's slots (≈226 px) three rows need 234 px — they do **not** fit; the live card shows row 3 *clipped*. The column-layout constant is exact for the same reason (`70n − 6 ≤ H` ⇔ `(H+6)/70`). The constants are conservative-by-design (whole rows only). The real product question when enabling capping is therefore: **a clipped partial row (status quo, shows ~2.9 rows) vs. a clean `+N MORE` chip (shows 2 whole rows + chip, i.e. fewer visible skins)**. Decide that before flipping the flag. The one constant still worth re-deriving from DOM geometry is M2's `floor((H−46)/50)` (`js/layouts.js:220`), which hardcodes the named-row height.
   - **Fix the copy.** With the published card capped too, `— scrolls on your listing` (`js/layouts.js:91`) becomes false. Drop the note or reword it; the export already hides `.more-note`.
   - Verify `+N MORE` in all three layout modes (TILES / SHOWCASE / CLASSIC) at 1 and 2 columns.

## Scope

- **Inherit:** editor Export PNG, the draft/publish `og:image` render, every published listing's PNG (they were all produced by the same path), all five card themes.
- **Verify unchanged:** `view.html` live card rendering in Phases 1-4 (Phase 6 changes it deliberately); browse quick view (`browse.js` carries the real `#card` — confirm no import of the changed capture); mobile viewer mosaic (`#mcard` is a separate subtree); the `payload` schema; Supabase; presence; view counters.
- **Exclude:** layout modes themselves (TILES/SHOWCASE/CLASSIC logic in `js/layouts.js` is untouched except the Phase 6 cap math), design tokens, `view.html` chrome, FB post text (`fbPostText`), sold gallery, dashboard.

## Validation

- **Product:** the reported payload exports a PNG whose card region is pixel-comparable to the preview — `DIAMOND 2` and `IMMORTAL 3` render in full with both rank badges present; `SEMI PREM`, `K 6422`, `CHANGE NAME`, `0TH OWNER`, `K486`, `PREMIER` each stay on one line; the QR caption is set in Chakra Petch; the band sits below the 1080 crop with the watermark strip above it; no dead background band inside the card.
- **Interface:** five themes (`protocol holo reaver oni arctic`) × three layout modes (`m1 m2 m3`) export without clipped text or overlapping chrome; empty categories still show their dashed slots; `+ ADD`/`SET`/`auto` absent from every PNG; a listing with 0 skins still exports.
- **System:** no new parallel capture path — `captureCardBlob` stays the single choke point for export and publish; `npm run check:export` green on all three assertions; the 12 `SecurityError` console messages are gone from the export log.
- **Repository:** `npm run lint` → 0 errors; manual before/after diff against `%TEMP%\opencode\cf-before-export.png`; `dist/` contains `fonts/` + `css/fonts.css` after `npm run build`, and a Netlify deploy serves the font files (no 404 → the capture silently falls back again).
- **Regression:** re-run the editor → publish → viewer e2e (as in the v1.1 QA log) to confirm `og:image` still uploads and renders with the embedded fonts.

## Stop conditions

- Stop if self-hosting the two families cannot be done without also vendoring Inter/Manrope (chrome fonts would bloat every capture) — renegotiate rather than inlining four families.
- Stop if pinning `grid.style.height` proves insufficient to keep captured row heights identical to live (means something other than the grid is reflowing during capture) — diagnose before shipping a "close enough" export.
- Stop if the `+N MORE` decision (phase 6) cannot be made without A/B-ing clipped rows vs. chip on a real listing — that is a product call, not an engineering one; leave the phase off until then.
- Stop if `img.decode()` on 30+ remote icons pushes a large listing's export past ~15 s — fall back to the current swap with a visible warning rather than a silent blank.

## Design documentation

- `HANDOVER.md:166` — the "12 benign console errors" were the font bug, not benign. Replace with the real history and point at this plan.
- `HANDOVER.md:169` — export filename rounding: fixed by change 5, delete the known issue.
- `HANDOVER.md` §5 conventions — add: card-export fonts must be same-origin or the capture cannot embed them.
- `ROADMAP.md` — no entry needed if Phase 6 ships here; otherwise log "`+N MORE` overflow affordance" as roadmap fodder.
- After acceptance: one line in `README.md` on what Export PNG produces (1920×1080 card at 2× + QR band below = 3840×2440).

## Open questions for review

1. **Phase 6 in this plan or a follow-up?** — RESOLVED: follow-up. Phases 0-5 implemented and verified; phase 6 left off so the export fix ships independently.
2. **Phase 6 copy:** drop the `— scrolls on your listing` note entirely, or reword it now that the published card caps too? — moot until phase 6 is picked up.

## Implementation record (phases 0-5)

- Files added: `scripts/fetch-fonts.mjs`, `scripts/check-export.mjs`, `fonts/*.woff2` (5 files, ~57 KB), `css/fonts.css`.
- Files changed: `index.html`, `view.html` (fonts.css link replaces the Anton/Chakra Google link), `js/shared.js` (QR caption font; capture rework; `blobDims`/`pngName`; exportCard returns dims), `css/shared.css` (exporting-full rules deleted), `js/editor.js` (export handler + tooltip copy), `scripts/copy-static.mjs` (`fonts` in DIRS), `package.json` (`check:export`).
- Verification: `npm run lint` clean; `npm run check:export` passes all assertions across **5 theme/layout combos** (protocol/auto, holo/m1, reaver/m2, oni/m3, arctic/auto — covers all five themes and all three layout modes; drift 0.6 %/0.6 %, geometry identical every sampled frame, 3840×2440 = label); `npm run build` stages `fonts/` + `css/fonts.css`; visual diff `cf-before-export.png` → `cf-after-export.png` shows every reported symptom gone (single-line `K486`, full `DIAMOND 2`/`IMMORTAL 3` with badges, no wrapped labels, melee crop identical to preview, watermark on the 1080 boundary, QR band below).
- Not exercised by the harness (same code paths, low residual risk): publish/og:image end-to-end (needs live Supabase) and `view.html` on a real device — smoke-test both on staging after deploy.
- Not committed — release stays with the owner; staging/production still carry the old bug until then.
