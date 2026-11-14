# minerals.4 worklog

## Review of the two-zone palette

The previous step split the strength ramp at `minStrength / maxStrength` into a
dark-brown falling range and a slate-to-gold holding range, and snapped slots so
the two zones could not bleed into each other. It separated the regimes but it
broke the strength scale: the same remaining strength could not be compared
across the boundary, and the shipped (0.3.x) warm ramp read better than either
half.

Replaced it with the single warm ramp from before the split, kept the fixed
absolute ceiling, dropped the boundary snapping, and moved the "may fall"
signal to saturation: the remaining view paints rubble with the same HSL
lightness and no hue. `strengthPalette` and `rubblePalette` are both built once
at load; `colorFor` picks the array, then the slot.

The debris limit became an explicit `materials.debrisLimit = 0.8` instead of
`minStrength`, so a material may form below it. The inspector now calls a sound
cell below the limit `rubble` instead of `sound`, because grey and "sound" would
otherwise contradict each other.

## Sand and demand

The model is in `archive/minerals.4-plan.md`. Measured on the field
probe (`node experiments/mineral-field-probe.cjs`, 6 seeds, 120×160 cells,
balanced/specificity 0.6): sand takes 4.66% of the rock against a 5.0% target,
leads 7.21% of cells, and is visible in 10.17%. Seeded abundance in the game is
2–5%, and the live quote was 0.71 / 1.07 / 0.79 cr/cell on seeds 1, 31 and 7
against a 12.5 cr average cell, while its abundance-curve base is 26–30 cr.

`demandMean` was added to every table row (1 for the existing materials) so the
market's seed bias multiplies a material's average demand rather than replacing
it. The mineral lab gained the matching FILLER weight slider, since its
Auto-adjust computes every target from the tier weights and would otherwise
drive sand to zero.

## Validation

- `node --test experiments/*.test.js` — 320 tests, all pass.
- Tests added or rewritten: the ramp endpoints and the desaturation rule
  (`geology-config`), the two views agreeing on sound rock and greying only
  rubble (`mineral-fall`), sand being rubble by nature with a hue-free rubble
  palette, the filler staying the cheapest material on two seeds
  (`mineral-market`).
- The autopilot drive-keeper test needed 5 cm more apex tolerance: sand sheds
  from the face during the run, so the same drive carries the ball slightly
  higher. The keeper's own aim is unchanged.
- Palette check without a browser: rasterized the comparison bed at 48 px/m
  (initial / remaining / damage) — the top row of every band matches the
  initial view, sand is grey from the top, and the fully damaged row is neutral
  grey. Not committed; the numbers from that run are the per-mineral table in
  the plan.

## Next step

Playtest the remaining view in the browser: the sand seams should crumble on
the first blow and read as grey crumbs, and the grey/warm boundary should be
readable at the default cell size. If the darkest end of the ramp reads too
close to the rubble grey at a glance, widen the gap by lowering the bottom of
the warm ramp rather than by brightening the grey.
