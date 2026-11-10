# minerals.1 — Real ore veins and a market with its own weather

## Goal

The rock should look and pay like ore, and its prices should be a market rather
than a constant table.

- A mineral field where each ore forms its own veins and pockets, instead of the
  whole face carrying a nearly identical mix everywhere.
- Cheap ore much cheaper, rare ore much dearer.
- Quotes driven by rarity and by a slow demand cycle: rare ore usually pays
  most, a common ore can still spike, every ore moves at its own pace, and a
  price can cover a large part of its range inside a few minutes of play without
  ever flickering.

## Decisions

### Formation

- **One field per ore.** Iron, copper and crystal each get their own
  three-octave value-noise function at one feature scale. Overlaying the three
  and normalising gives a cell that is mostly one ore with the neighbours'
  tints at the seams, and the seed decides where the seams sit.
- **Weight is a crest, not a share.** A mineral's weight at a cell is how far
  its own field stands above its threshold: `max(0, field − threshold)`. Every
  cell therefore carries the bulk ore, copper appears only where its field
  crests and crystal only where its rarer crest is reached. That is what makes a
  crystal pocket something to hunt, and it is why a field's mean mix lands near
  iron 0.6 / copper 0.27 / crystal 0.11 on every seed.
- **Iron is flattened.** The bulk ore's field is pulled towards its mean, so the
  wall reads as one dull body with soft variation while the rare ores keep their
  full contrast.
- **The elemental view stays separate.** The R/G/B channels remain their own
  correlated triple, so the elemental view and the mineral view describe
  different structures of the same rock instead of one being a recolour.
- **Measured, not asserted.** `experiments/market-probe.cjs` reports the mix,
  the dominant-mineral share per cell, the connected run lengths of each ore and
  the mean cell value for any seed.

### Prices

- **Reference prices are the briefing:** iron `3 → 1.5` (½), copper `7 → 7`,
  crystal `11 → 44` (×4). They price a reference mix
  (0.64 / 0.27 / 0.10), not a pure cell.
- **Rarity is the run's own rock.** A field's mean supply is compared with the
  reference mix, so a seed short of crystal pays more for it on every sale and a
  rich seed pays less. Iron's term is damped so the bulk ore never drifts out of
  its cheap band.
- **Demand is slow noise per ore.** One slow octave per ore — about two and a
  half minutes for iron, four for copper, six for crystal — plus a faster second
  octave at 42% of the period. Both are summed in log space, so a move is the
  same percentage up or down, and the reach sets how far a peak travels from
  list. Iron's swing is damped again so it can never outprice copper.
- **No flicker, no dead market.** Quotes are re-solved four times a second on
  the chamber clock (not per frame): the finest step is a few tenths of a
  percent, one second moves at most 2.5%, and ten minutes swings each ore by
  more than 2×. Simulation time drives it, so 2× speed runs the market twice as
  fast.
- **Selling feeds back.** A sale adds supply pressure to the ore shares in the
  load; the pressure scales that ore's quote down and decays with a 60 s time
  constant. A full hopper of one ore moves its quote about 8%, and dumping the
  same ore repeatedly leaves it visibly cheap until the wall clears it.
- **Cargo keeps its book value.** A caught cell is booked at the price it was
  worth when it was caught, and a sale pays that book value; the market learns
  about the load after the sale. A drifting quote can therefore never re-price a
  load already in the hopper.
- **The UI reads the same numbers.** `state.mineralPrices` *is* the live quote
  table (`referencePrices` exposes the list). The market table shows each quote,
  its move against list and an arrow for the demand trend; the price view and
  the tooltip scale with the quote.

## Implementation

- `js/ceiling.js`
  - `vein`, `generateField`, `demandAt`, `quotePrices`, `priceField`,
    `advanceMarket`, `bookSupply`, `refreshDebrisValues`.
  - Constants for field shape, thresholds, reference prices and mix, rarity,
    demand periods and depth, supply impact and the quote clock.
  - `prices` becomes a `Float64Array` so a pure cell is worth exactly its quote.
  - `reset` and `generateTestRock` re-quote; `step` advances the market; a wall
    sale books supply and re-quotes.
  - `state` exposes `marketTime`, `referencePrices`, `fieldShare`,
    `supplyPressure`, `demandTrend` and a `demand` getter.
- `js/main_readouts.js`: market table shows quote · move · trend arrow; the
  inspector reads the mineral mix beside the element mix.
- `index.html`: market table caption describes live quotes.
- `js/help.js`, `README.md`: the market section and the chamber section.
- `experiments/market-probe.cjs` + `experiments/logs/mineral-market-probe.txt`.
- `experiments/ceiling.test.js`: formation, reference prices, demand drift,
  sale feedback and cargo book value.
- `experiments/interface.test.js`: the market table quotes and their trend.

## Acceptance

- Every seed's field is dominantly iron with copper seams and crystal pockets;
  the median cell carries more than half one mineral.
- Reference prices are 1.5 / 7 / 44 for iron / copper / crystal.
- No one-second price move exceeds a few percent; ten minutes swings every ore
  by more than 2×, crystal widest and iron narrowest, and each ore turns over at
  its own rate.
- A wall sale lowers its own ore's quote and the quote recovers.
- Cargo and its sale keep the book value of the cells that were caught.
- The suite is green: `node --test experiments/*.test.js`.
