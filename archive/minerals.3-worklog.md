# minerals.3 — Shared lab and game geology

Plan: `archive/minerals.3-plan.md`. Closes the planning step in
`archive/minerals-planning-worklog.md`: one material table, one sampler and
one price curve serve the lab, the game and the probes, with no copied
formula left behind.

## What shipped

- `js/geology-config.js` — one frozen defaults table (frequency, Y
  compression, affinity mode, specificity, host weight) with editor bounds,
  the shared control list and value formatting, and the caller-owned
  snapshot API (`create`, `capture`, `resetInto`, `settingsInto`,
  `rangesInto`, `exportOf`, `validateExport`, `applyInto`). The lab edits
  its snapshot; the game captures its configuration when a run starts;
  neither mutates the defaults or another consumer.
- `js/rock-materials.js` — allocation-free mixture helpers with
  caller-provided storage: mineral-weighted strength in J/cell, mineral
  colour, the strongest pure-mineral strength as the fixed display ceiling,
  the one base-price curve (target mean 12.5, elasticity 1.3, floor 0.4,
  cap 150) from an explicit abundance vector, and the price/strength
  colour ramps.
- `js/element-cdf.js` and `js/geology.js` — field sampling, flattening,
  formation and calibration reading their defaults from the config. The
  calibration-only cache and optimizers stay out of the run path.
- `js/ceiling.js` — the run captures one snapshot, compiles one formation
  and samples one field whose seed, frequency and flattening follow that
  snapshot. Row shifts change the array slot, never the geological row, so
  a regenerated cell at the same absolute coordinate reads the same
  mixture as the lab. Initial strength is the weighted sum over the table;
  pure test bands use exact table strengths. The impact radius, multiplier,
  falloff, hit cap, held-cell rule and energy ledger are unchanged.
- The calibration population is the opening bed — every column at rows
  `0..initialRows-1` of the run's own seed, formation and depth, sampled
  once when the run starts. Generated upper rows are excluded on purpose:
  a deeper column is a different geological population, and folding it in
  would reprice the market while the player scrolls. The base-price report
  carries the nominal cell value next to the mean the floor and cap
  actually achieve.
- `prototypes/mineral-lab.js` — editable snapshot, calibration UI and map
  presentation on the same shared table, helpers and price curve as the
  game. Lab export carries the complete formation snapshot keyed by stable
  mineral IDs; applying it to the game starts a fresh run rather than
  silently regenerating or repricing an active run.

## Validation

- `experiments/geology-config.test.js` pins the shared contract: one frozen
  defaults table, caller-owned snapshots, a complete snapshot export keyed
  by mineral id that imports whole or not at all, the one
  weighted-strength/colour/base-price rule, lab/game parity at identical
  absolute coordinates, and a market calibrated on the opening bed instead
  of every generated row.
- `experiments/geology.test.js`, `experiments/mineral-market.test.js`,
  `experiments/mineral-fall.test.js`, `experiments/ceiling.test.js` and
  `experiments/interface.test.js` cover the migrated sampler, live market
  drift, grouped-fragment accounting, the free-face surface rule and the
  page wiring. Gas-bearing rock stays at 0.8 J/cell with no hidden
  additive strength offset.

## Next step

Actual gas caves remain deferred research in `gas-caves.1-plan.md`: the
void-versus-broken-rock distinction and the stable-roof probe come first,
before any cave generation. No cave generation or speculative support
simulation was part of this migration.
