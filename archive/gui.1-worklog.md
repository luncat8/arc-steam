# gui.1 — Four-row page layout and hover/click rock view switch

Source: `html-layout-draft.md`.

## Review of the previous step

- Upgrade buttons were `disabled` when locked or unaffordable, so in a real browser the click never reached `buyEquipment`/`buyResearch` and the "stays locked until …", "needs the … research first" and "Not enough funds" messages could not appear. The DOM shim dispatched clicks on disabled elements, and the browser smoke test used `force: true` and had never run. Blocked buttons now use `aria-disabled` with the same styling; the refusal reasons appear on click.
- Dead CSS from an earlier header design removed (`header`, `.brand`, `.mark`, `.badge`, `.heading`, `h1`, `footer`, `.canvas-label`): nothing in the markup used it.
- A real Chromium now runs in this sandbox (`playwright-core` + `@sparticuz/chromium` from npm, NSS libraries from the package's own `al2023.tar.br`). Recipe in `findings-pitfalls-skills.md`.

## Decisions

- Rows follow the draft: system bar → telemetry → research | chamber | controls | inspector → equipment | cargo | market. Telemetry became a full-width 8-column row; the previous "telemetry spans exactly the canvas width" rule is superseded by the draft.
- System bar contents: clock, Pause, speed ("time controls"); New game (the former Reset, which already reset world, research and equipment); rock shape ("other system"). Rock shape left the canvas footer because it changes collision physics.
- Hover switching applies to the rock view only, which is display state. Hover-switching rock shape would let a passing mouse change gameplay, so it stays a click-only select.
- View switch follows the draft contract: label-wrapped radios in `#view-modes`; `setViewMode` as single writer with early return; `change` for click and arrow keys; `pointerover` walks parents to a `LABEL`, uses `label.control` (no query, no allocation), checks the group name, sets `checked`, calls the writer; gated by a `MediaQueryList` kept from setup and read via `.matches` per event, so plugging in a mouse later works.
- "Marks the view dirty": the canvas used to redraw every animation frame even when paused. It now redraws after a simulation step or when `sceneDirty` is set. Event paths call `refresh()` (readout + dirty); `resize` (which clears the canvas), target clicks, shape changes, direction changes and tab visibility also mark it. The periodic 10 Hz readout does not, because a paused world does not change.
- Side columns next to the chamber use `contain: size` + `overflow-y: auto`, so the chamber sets the row height and long lists (research, controls) scroll with sticky titles instead of stretching the canvas into letterboxing. Canvas uses `aspect-ratio: 2.25` (the 25.5 × 10 m view plus the renderer's margins), with a 420 px minimum so the drive controls are visible at 1440 px.
- Panels regrouped for the bottom row. Cargo holds the load, the extraction flow (extracted / falling / caught / lost, moved from the inspector) and the material table. Market holds sales, ledger count, reserve recharge, transaction status and the ledger, now open by default because there is room. The platform speed readout moved into the controls panel title.
- Radio and shape controls carry `autocomplete="off"`, so a browser's form-state restore on reload cannot leave the DOM showing a mode the renderer is not using.

## Implementation

- `index.html`: new row structure; `.panel`/`.panel-body` replace per-panel `mining-body`/`mining` names; `#view-modes` radio group; all existing ids kept except `#view` (replaced by the radios).
- `styles.css`: rewritten around the four rows; breakpoints at 1280 px (chamber + controls, then research + inspector under it; telemetry 4 columns; equipment spans the economy row) and 760 px (single column, 2-column telemetry); segmented view switch styled with `:has(:checked)` and `:has(:focus-visible)`; equipment rows and installed specification use two columns when wide.
- `js/main.js`: `viewMode`, `setViewMode`, `viewModeChanged`, `viewModeHovered`, `hoverPointer`; `sceneDirty` + `refresh()`; `setBlocked()` for upgrade buttons.
- `experiments/dom.cjs`: `parentElement`, `control`, `checked`, `name`, and a shared `matchMedia` result (`dom.pointerMedia`) that tests can switch to touch.
- `experiments/interface.test.js`: new view-switch test (paused scene not redrawn; click and hover redraw in the new mode; hovering the active mode or the container gap does nothing; touch ignores hover but accepts click); blocked-button assertions use `aria-disabled`.
- `experiments/browser-smoke.cjs`: four-row order and alignment, side columns equal to chamber height, full-width telemetry, real hover/click/arrow-key switching with paused canvas redraw compared by `toDataURL`, a touch-emulated page where hover does not switch and tap does, and stacked panels keeping their height at 390 px.
- `README.md`, `0.1.0-plan.md`, `findings-pitfalls-skills.md` updated.

## Validation

- `node --test experiments/*.test.js`: 57/57 pass (interface 8, up from 7).
- `node experiments/browser-smoke.cjs` under real headless Chromium: PASS, no page errors. First run of this script in any environment.
- Full-page screenshots at 1920, 1440, 1100 and 390 px reviewed: no horizontal overflow at any width. One bug was found and fixed this way: stacked panels collapsed to zero height because the base `contain: size` selector outranked the override; containment now applies only inside `min-width` queries.

## Next step

Decide the next energy era and its resupply model (carried over from 0.1.8): coal/steam refuelling or electric storage changes what a shift costs. For the interface, add contextual warnings to the system bar (overheat, empty reserve, full cargo) so the player need not scan the telemetry row during interception. Consider number-key shortcuts for the rock view through the same `setViewMode` writer.
