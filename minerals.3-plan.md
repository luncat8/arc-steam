# minerals.3 — Shared lab and game geology

## Goal and scope

Use the mineral lab's field and formation model in the game. A parameter change
must affect lab, game and measurement probes through one shared implementation,
not through copied formulas. This is the implementation companion to
`minerals.2-plan.md`; its mineral identities and separation of impact resistance,
collapse cohesion and demand remain authoritative. Gas-bearing rock stays at
**0.8 J/cell**. Actual gas caves are a separate, low-priority feature.

Port the model, not the calibration UI into the game. Preserve classic scripts,
`file://` operation, guarded CommonJS exports and no build step.

## Boundaries

- `js/minerals.js`: the one nine-material table (stone host, iron, copper, quartz,
  corundum, fluorite, silver, gold, gas-bearing rock) with ranges, target shares,
  strengths, growth defaults and demand metadata.
- `js/geology-config.js`: frozen defaults and editor bounds, the shared control
  list and value formatting, and the caller-owned snapshot API (`create`,
  `capture`, `resetInto`, `settingsInto`, `rangesInto`, `exportOf`,
  `validateExport`, `applyInto`).
- `js/element-cdf.js` and `js/geology.js`: field sampling, flattening, formation
  and calibration. Geology reads its defaults from the config and keeps the
  calibration-only cache and optimizers out of the run path.
- `js/rock-materials.js`: mixture strength, colour, allocation-free base prices
  and the two display ramps, all writing into caller storage.
- `js/ceiling.js`: the run's captured snapshot, field, compiled formation, cell
  arrays, market, collapse mechanics and drawing. It owns no material table and
  no copied formula.
- `prototypes/mineral-lab.js`: editable snapshot, calibration UI and map
  presentation; the same shared table, helpers and price curve as the game.

## Shared ownership

### 1. Defaults and editable snapshots

Add `js/geology-config.js`, loaded after minerals and before geology. Expose a
small frozen defaults object: frequency, Y compression, affinity mode,
specificity and host weight. Keep mineral ranges and strengths in the mineral
table; do not create a second mineral registry. Keep rarity targets as calibration
goals, not runtime formation inputs.

Provide a snapshot factory that copies editable ranges and settings into a
caller-owned configuration. The lab edits its snapshot; the game captures its
configuration when starting a run. Neither mutates defaults or another consumer.
Compile formation once per configuration change, not once per cell. Centralize
reset values and control initial values so HTML, lab reset and game do not drift.

Lab export must include the complete formation snapshot, keyed by stable mineral
IDs, not only ranges: field settings, mode, specificity and host weight. Export
desired shares as separate calibration metadata. Provide an explicit import/apply
path and validate finite values, channel bounds, required IDs and parameter
ranges. Applying to the game starts a fresh run; do not silently regenerate or
reprice intact rock, fragments or cargo in an active run. Initially this can be a
source-controlled configuration update; no in-game parameter editor is required.
No local-storage override or automatic lab-to-game communication is required.

### 2. Shared material and price helpers

Add `js/rock-materials.js` for allocation-free mixture operations and display
scales, with caller-provided arrays/offsets:

- Mineral-weighted strength in J/cell and mineral color.
- Strongest pure-mineral strength as the fixed absolute display ceiling.
- Base-price calculation from an explicit abundance vector and explicit economy
  settings: target mean 12.5, elasticity 1.3, floor 0.4, cap 150.
- Price and strength color ramps, writing RGB into caller-owned scratch storage.

Use one base-price function, but preserve different inputs: the lab's reference
quotes use default target shares; the game's base quotes use measured abundance
and then live demand. Label the distinction. Clamping can move the achieved mean
away from the nominal price target; report it rather than claiming exact equality.
Do not move live demand clocks, fragment booking or cargo accounting into geology.
Do not mix material strength with collapse growth or price.

Keep calibration-only cache building and optimizers out of runtime work. Existing
geology can retain its API until a measured size/startup need justifies splitting
calibration into another file; do not rewrite the working sampler unnecessarily.

## Runtime migration

1. Wire script dependencies into `index.html`, the lab and Node test harnesses.
   Adapt ceiling to the shared table and mineral count. Remove the old table and
   soft-box formation implementation rather than retaining a fallback model.
2. Create a shared field and compiled formation for the run. Fill the existing
   element/mineral typed arrays directly using reusable channel scratch storage.
   Use absolute geological cell coordinates, including newly generated rows after
   scrolling/compaction. Rendering warp and screen coordinates must not influence
   geology. Equal seed/config/coordinates must produce equal lab/game mixtures.

   Implemented: the run captures one snapshot, compiles one formation and samples
   one field whose seed, frequency and flattening follow that snapshot. Row shifts
   change the array slot, never the geological row, so a regenerated cell at the
   same absolute coordinate reads the same mixture as the lab.
3. Set initial strength to `sum(fraction * table.strength)` and remaining strength
   to that value on generation. Pure test bands use exact table strengths. Keep
   the impact radius, multiplier, falloff, hit cap, held-cell rule and energy ledger
   unchanged. Damage fraction remains remaining/initial for collapse mechanics.
4. Initialize growth sliders and pure test bands from stable material IDs. Audit
   inventory, cargo, rubble, debris composition, help, inspector, tests and probes
   for six-entry assumptions and positional IDs. Every material, including stone
   and gas-bearing rock, participates consistently in accounting.
   Screens and readouts iterate the table by index or by `id` (`cluster-<id>`),
   never by a positional six-entry name, so adding a row needs no markup.
5. Draw remaining strength against the fixed strongest-pure-material maximum,
   not each cell's own initial strength. Clamp only the display ratio. Continue
   showing remaining/initial J in the inspector; the separate damage view retains
   fractional damage semantics. The lab has no damage, so it shows initial J/cell.
6. Use shared base-price calculations with the game's measured abundance. Keep
   live demand, quote updates and booking-at-break semantics unchanged. Avoid
   recalibrating abundance on every visible-row shift; preserve the run's chosen
   calibration population and document its geological depth/seed coverage.

   Implemented: the calibration population is the opening bed — every column at
   rows 0..initialRows-1 of the run's own seed, formation and depth, sampled once
   when the run starts. Generated upper rows are excluded on purpose: a deeper
   column is a different geological population, and folding it in would reprice
   the market while the player scrolls. The base-price report carries the nominal
   cell value next to the mean the floor and cap actually achieve.

## Validation

- The shared helpers landed without changing lab output before the game was
  migrated onto them; ranges and economy were tuned only after parity.
- Compare seeded lab and game samples at identical absolute coordinates, including
  deep rows, row shifts and reseeding. Compare with Float32 storage tolerance.
- Verify nonnegative normalized mixes, pure strengths, weighted mixtures,
  gas-bearing rock at 0.8 J/cell and no hidden additive strength offset.
- Confirm undamaged different materials have different strength colors; a damaged
  cell darkens on the same fixed scale. Damage/collapse mechanics still use their
  own initial-strength denominator.
- Test default/reset/export/import round trips and isolation of editable snapshots.
- Compare shared base-price outputs for the same input; separately verify live
  market drift, booked fragment prices, cargo and rubble conservation.
- Run geology, ceiling, economy, mineral market/fall, interface and browser smoke
  checks; audit script order and lexical-name collisions under classic scripts.
- Measure multiple seeds/depths for abundance, achieved targets, strength
  distribution, mining yield and sold-load income. Include generated upper rows,
  not just the initial free face. Calibrate before declaring targets achievable.

## Acceptance

One configuration and shared sampler produce the same geology in lab and game.
There is one material table, one weighted-strength rule and one base-price curve.
Lab edits can be exported completely and applied deliberately without hand-copying
formulas. Physics, market accounting and UI all support the full material table.
No cave generation or speculative support simulation is part of this migration.
