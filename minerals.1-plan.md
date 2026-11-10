# minerals.1 — Element ranges, mineral table and a live market

## Goal

Separate the three element fields from the mineral mix, define minerals by
explicit ranges in element space (narrow ranges are rare), and replace the
fixed price list with a market whose prices drift on slow per-mineral noise.
Preserve the measured economy: the mean value of a rock cell stays about
6 cr, and the existing equipment prices keep their meaning.

## Decisions

### Elements are three independent concentrations, minerals are probabilities

- The rock keeps three element channels. Each is its own seeded smooth noise
  field in `0..1`, at its own spatial frequency. They are **not** normalised
  against each other: an element concentration is an absolute quantity, so a
  narrow band on one channel stays narrow instead of being stretched by the
  other two.
- A mineral is a **soft box** in the element cube: a `[low, high]` range per
  element plus a feather. A cell's membership is the product of the three
  per-channel window weights; the memberships are then normalised into the
  cell's mineral mix. Overlapping boxes blend, and a cell outside every box is
  still pulled to the nearest one by the window tails, so the field has no
  holes.
- Rarity is therefore geometric: a wide box is common, a narrow box is rare.
  The table uses three common, one uncommon and two rare minerals:
  Iron, Copper, Crystal, Fluorite, Silver, Gold.
- Element ranges, colour, hardness, default cluster growth and demand
  behaviour all live in one flat `mineralTable`. Formation, strength, render
  colour, fall sliders and prices read that table; no module repeats a
  mineral list.

### Prices are generated from abundance, then move with demand

- After a run's rock is generated, the mean mineral fraction of the whole
  field is measured. The base price is `targetCellValue / (mineralCount ×
  meanFraction)`, clamped. The target is what one cell is worth on average, so
  the economy stays calibrated whatever the ranges are. Rare minerals get a
  high base price automatically; a pure rare cell is a jackpot, a trace of one
  is a normal cell.
- Startup demand is random per run: each mineral gets a persistent bias and a
  noise phase derived from the seed. A common mineral can therefore start
  expensive.
- Demand is one-dimensional value noise per mineral, sampled in chamber time.
  Each mineral has its own period (130–300 s at 1×) and depth. Prices move
  enough to matter over a few minutes and never jump.
- The market revalues every 0.5 s of simulation. Rock cell prices, the price
  view and the market table follow it. A fragment books the price of the
  moment it breaks, so cargo, rubble and ledger values stay internally exact;
  the market only changes what the next blow is worth.

### UI follows the table

- The inventory table is already built from `mineralNames`; its price column
  is made live.
- The fall-test sliders are built from the mineral table instead of three
  hardcoded inputs, with the same `cluster-<id>` ids and 10%..500% range.
- Test rock lays out one pure band per mineral, left to right.

## Suggested implementation

- `js/ceiling.js`: mineral table; raw element field; soft-box formation;
  abundance measurement; base/live price arrays; per-mineral demand noise;
  `advanceMarket(seconds)` for measurements; revalue cells; generalise every
  mineral stride and loop from 3 to the table length; test rock and strength
  from the table.
- `js/main_readouts.js`: build inventory price cells, live update, build the
  fall sliders and their notes, dynamic composition text.
- `js/main_input.js`: dynamic slider binding, dynamic test-rock status.
- `index.html` / `js/main.js`: one slider container instead of three inputs.
- `experiments/dom.cjs`: register dynamically created elements by id.
- Tests and probes: generalise the existing mineral tests and add
  `experiments/mineral-market.test.js` for formation rarity, price order,
  demand drift/smoothness and booking at break time. Update
  `experiments/mineral-mix-probe.cjs` and add a market probe.

## Acceptance

- Every cell's mineral mix sums to 1; element concentrations are independent
  and in `0..1`.
- Rare minerals occupy fewer cells than common ones and have higher base
  prices; seed changes change both the field and the startup market.
- Over a few simulated minutes prices move materially, per-second movement is
  small, and the per-mineral periods differ.
- One cell is worth about `targetCellValue` on average before demand.
- The full test suite and the interface run pass.
