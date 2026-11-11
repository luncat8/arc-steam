# mineral lab — editable desired share (worklog)

## What changed

`prototypes/mineral-lab.html`, `prototypes/mineral-lab.css`, `prototypes/mineral-lab.js`:

- Removed the scroll-to-anchor on share-row click (`scrollIntoView` in `select()`).
  Clicking a row still selects/highlights the mineral, without moving the page.
- The share table's Target column is now an editable **Desired** number input
  (percent, 0–100, 0.1 step). The rarity-weight sliders in Calibration still
  set all desired values at once; dragging or typing overrides one mineral.
- Each achieved bar now carries a **red line + handle** marking the desired
  share on the same 0–35% scale as the fill. Press and drag anywhere on the
  bar to move it (pointer capture, touch-friendly); the bar is also a
  focusable slider with arrow keys (Shift for 1pp steps, Home/End).
- New **Error** column: achieved − desired in percentage points, green when
  within 0.1pp, amber beyond 2pp. The copied report includes the error too.
- Desired edits update the line, input and error immediately; achieved only
  moves when ranges change (auto-adjust / drag), as before.

## Validation

- `experiments/mineral-lab.test.js` (new): loads the lab against a minimal DOM
  stub, runs one frame, and checks the desired input, red-line position,
  error arithmetic, pointer drag, typing and arrow keys, plus that row click
  selects without scrolling.
- Full suite: `node --test experiments/*.test.js` — 257 pass, 0 fail.

## Next step suggestion

Consider normalising or warning when the desired shares no longer sum to
100% (auto-adjust assumes independent targets), and a "reset desired to
weights" button for when per-mineral overrides drift from the rarity preset.
