# minerals.1 — Element ranges, mineral table and a live market

## Review of what was there

- Three element fields were normalised to sum to 1 and then fed through a
  hardcoded quadratic mix (`Fe/Cu/Cr`). That conflated an absolute element
  concentration with a colour mixture: a narrow band on one element could not
  stay narrow because the other two were rescaled against it.
- There was no demand system in the repository. Searches for demand, price
  history and price noise found only unrelated physics uses of the word. The
  three prices were the constants `[3, 7, 11]`.
- Rarity had no representation: all three minerals were wide quadratic terms
  of a channel, so no mineral was structurally rare.

## Shipped

- `js/ceiling.js`
  - One frozen `mineralTable` of six minerals (Iron, Copper, Crystal,
    Fluorite, Silver, Gold) with id, name, symbol, render colour, hardness,
    default growth, per-element `[low, high, feather]` ranges, and demand
    period/depth. Formation, strength, mineral colour, fall sliders and market
    all read it.
  - Three independent raw element fields in `0..1`, each at its own spatial
    frequency and compressed 3× in Y, so deposits are flat seams.
  - Mineral membership is the normalised softmax of the summed normalised
    distance outside each mineral's ranges. Summing before the kernel avoids
    one broad box swamping a nearby narrow box; subtracting the nearest
    distance keeps the kernel stable outside every box.
  - `mineralAbundance` is the measured mean fraction per mineral. Base prices
    follow `price ∝ share^-1.3`, normalised to `targetCellValue` (12.5). The
    target is calibrated on a 60–100-cell sale from the free face, not the
    field average, because the mineable surface is biased toward common ore.
    Prices are floored at 0.4 and capped at 150 cr/cell.
  - Each run gets a seed-derived demand bias, phase and period jitter. Demand
    is two octaves of value noise in chamber time (130–300 s cycles, per
    mineral depth); the market revalues every 0.5 s of simulation.
  - Live cell prices and the price view follow the market. A fragment books
    the price of the moment it breaks, so cargo, rubble and the ledger remain
    internally exact.
  - Test rock lays one pure band per mineral; strength is `2.2 + hardness`.
  - All mineral strides and loops use the table length; `debrisValue` and the
    market getters joined the frozen state view.
- `js/main_readouts.js`, `js/main_input.js`, `js/main_boot.js`, `index.html`,
  `js/main.js`
  - Inventory rows and their live cr/cell cells are built from the table.
  - Fall-test sliders are built from the table with the same `cluster-<id>`
    ids and 10–500% range; the notes and test-rock status use table names.
  - The composition readout uses table symbols and the mineral stride.
- `experiments/dom.cjs`: a created element that is given an id is registered
  for `getElementById`, so data-built panels are testable.
- Tests/probes
  - `experiments/mineral-market.test.js`: independence of elements, the
    Y-flattened gradient, rarity by range, abundance-to-price order and
    calibration, seeded opening quotes, four-minute drift with no one-second
    jump, and break-time booking against live repricing.
  - Existing mineral, ceiling and physics tests generalised to the table.
    The two crater-reflection tests now carve a deterministic notch instead of
    depending on a random collapse shape.
  - `experiments/mineral-market-probe.cjs` and the updated
    `experiments/mineral-mix-probe.cjs`; output in
    `experiments/logs/minerals.1-*.txt`.

## Validation

- `node --test experiments/*.test.js`: 236 tests, 236 pass after the final
  crater-test fix (the only failure in the preceding full run was that test's
  field-dependent setup).
- `node experiments/mineral-mix-probe.cjs` and
  `node experiments/mineral-market-probe.cjs`: grouping still spans 3.5–19
  cells/fall from 10% to 500%, base cell value holds at 12.5, and quotes move
  over minutes without one-second jumps.
- The page was visually checked by the user after the first pass; the Y
  compression was added on that feedback and the targeted interface,
  economy/equipment/research/commune, ceiling and mineral tests were rerun
  green (86 tests) before the final full run.

## Next step

Surface the live quote and its trend in the market drawer (and optionally a
small demand marker beside each mineral row), then calibrate the tier-III
equipment costs against the new realised income spread. A radar/scanner
upgrade that highlights cells where the current demand meets a mineral range
would give the demand cycle a gameplay use beyond sale timing.
