# mineral lab — editable desired share (worklog)

## What changed

`prototypes/mineral-lab.html`, `prototypes/mineral-lab.css`, `prototypes/mineral-lab.js`:

- Removed the scroll-to-anchor on share-row click (`scrollIntoView` in `select()`).
  Clicking a row still selects/highlights the mineral, without moving the page.
- The share table's Target column is now an editable **Desired** number input
  (percent, 0–100, 0.1 step). The rarity-weight sliders in Calibration still
  set all desired values at once; dragging or typing overrides one mineral.
- Each achieved bar carries a **red line** marking the desired share on the
  same 0–35% scale as the fill. Press and drag anywhere on the bar to move it
  (pointer capture, touch-friendly); the bar is also a focusable slider with
  arrow keys (Shift for 1pp steps, Home/End). There is no rect handle — the
  thin line is the whole affordance.
- New **Error** column: achieved − desired in percentage points, with the
  relative error in the tooltip and a worst-error summary under the table.
- Desired edits update the line, input and error immediately; achieved only
  moves when ranges change (auto-adjust / drag), as before.

## Math: the two designs compared

Two versions of this feature were built and compared before merging:

- **abfae92** (residual design): stone is `100% − Σ ore`, so the desired
  column always totals 100%; editing one ore moves stone the other way. An
  ore total over 100% pins stone at 0% and is flagged. The stone floor is
  measured (`meanHostShare` at the calibrator's minimum host weight), so a
  desired stone share below the unmatched-cell floor is named unreachable
  instead of silently reported as a miss. Error is reported in percentage
  points (what a designer reads) and relative to the desired share (what
  `autoAdjust` minimises), with tones at 0.25pp / 1pp. Desired was
  type-only; the bar was display-only with a white mark; row click scrolled
  the editor into view.
- **main** (drag design): every target is independent, so the column can
  total anything other than 100% while the achieved shares must sum to 100%
  — an inconsistent target vector guarantees residual error no range tuning
  can remove. Error was pp-only with tones at 0.1pp / 2pp, no summary, no
  floor. The bar had a red line plus a 10px rect handle, full drag/keyboard
  support, and no scroll on click.

The merge keeps abfae92's math (residual stone, measured floor, dual pp +
relative error, summaries, `minHostWeight` passed to the solver) and adds
main's drag/keyboard interaction minus the rect handle and minus the scroll.
The bar scale stays 0.35 (a 35% share fills the bar) in both; a desired share
above 35% still clamps the line at the bar's right edge, so very large
targets are only readable in the Desired input.

## Validation

- `experiments/mineral-lab.test.js`: loads the lab against a minimal DOM
  stub, runs frames, and checks the desired input, red-line position, error
  arithmetic, pointer drag, typing, arrow keys, stone-as-residual (disabled
  input, no slider role, column totals 100%), and that row click selects
  without scrolling.
- Full suite: `node --test experiments/*.test.js` — 257 pass, 0 fail.

## Next step suggestion

The residual already exposes the real limit: on the six-seed sample 38.9% of
cells match no ore, so the default 32% stone target is unreachable and the ore
shares are fitted against a stone share the preset cannot ask for. Lower the
preset's target host weight to the measured floor (or report the preset as
capped) before retuning any signature width, then add the held-out per-map
findability summary from §2 of the experiments plan.
