# minerals.1 — Real ore veins and a market with its own weather

## Review of the previous step

The mineral-fall work left a rock whose grouping was tunable per ore, and the
stone under it had never been questioned. Measured with
`experiments/market-probe.cjs`, it did not hold up:

- **There were no veins.** The mix came from one smooth noise triple, each
  channel squared and renormalised. Every cell carried all three ores: mean mix
  0.32 / 0.38 / 0.30, median dominant share 0.45, and **not one cell in the
  whole face** carried more than 75% of a single ore. The three rock views were
  reading one blurred field in three palettes, and the mineral-matched fall
  flake had no mineral structure to follow.
- **The prices were flat.** `[3, 7, 11]` is a 3.7× spread from the cheapest ore
  to the dearest, and every cell sat within 4.4–9.8 cr, so the rare ore paid
  less than three times the common one and the choice of what to mine never
  mattered. There was no demand term at all: `demand` appeared nowhere in the
  code, and the ledger priced every sale with the same three numbers.
- **The earlier "demand change" left no trace.** Whatever was intended as a
  demand implementation is absent from this checkout, so this step builds the
  market seam rather than patching one.

## Decisions

### Formation: one field per ore

- Iron, copper and crystal each get their own value-noise function: three
  octaves at one feature scale, each half the amplitude and about twice the
  frequency of the last, so a vein has a body and a broken outline.
- A mineral's weight at a cell is its own field **above a threshold**, not a
  normalised share of a common mix. Every cell therefore carries the bulk ore,
  copper appears only where its field crests and crystal only where its rarer
  crest is reached. This is the mechanism that makes a pocket a place to aim at
  rather than a tint.
- Iron's field is flattened towards its mean, so the wall reads as one dull body
  with soft variation and the rare ores keep their full contrast against it.
- The elemental R/G/B triple stays a separate, correlated field, so the
  elemental view and the mineral view are different structures of the same rock.
- Measured over six seeds: mix 0.56–0.64 / 0.25–0.33 / 0.10–0.14, median
  dominant share 0.54–0.62 (was 0.45), 5–14% of cells more than 75% one ore,
  copper runs of median 5 and p90 10 cells, crystal pockets of 2–4 cells. The
  face now reads as iron with copper seams and countable crystal pockets.

### Prices: reference list, rarity, demand, supply

- Reference prices are the requested change and nothing else: iron 3 → **1.5**,
  copper **7** unchanged, crystal 11 → **44**. They price a reference mix
  (0.64 / 0.27 / 0.10), so the realized value of a cell stays in the old band
  while the spread between the cheapest and dearest ore widens from 3.7× to
  29×.
- Rarity is the run's own field: mean supply against the reference mix, so a
  seed short of crystal pays more for it on every sale. Iron's exponent is 0.4×
  of the others so the bulk ore never leaves its cheap band (several candidate
  schemes were rejected in the probe: scaling on value rather than abundance
  clamped crystal at the ceiling every seed, and an unclamped term put iron at
  5.4 cr).
- Demand is per-ore slow noise: one slow octave (period 150 s iron, 240 s
  copper, 380 s crystal, opening phase chosen by the seed) plus a smaller, faster
  octave at 55% of the period, summed **in log space** so the same move is the
  same percentage either way. Iron's reach is damped to 0.55 of the others' and
  the crystals' is 0.8, so iron can never outprice copper and crystal swings
  widest. The first cut ran the fast octave at 42% and 0.25 depth; the probe
  showed it added extra mid-range crossings that blurred the three ores' paces
  (iron 7–8 reversals in ten minutes against crystal's 3–4), so it was slowed and
  shallowed until each ore's pace reads as its own cycle with a notch on it.
- Quotes are re-solved four times a second on the chamber clock, so 2× speed
  runs the market twice as fast and a paused page does not move it at all.
- A wall sale feeds back: each ore's share of the load adds supply pressure,
  which scales that ore's quote down and decays with a 60 s time constant. A
  full hopper of one ore moves its quote about 8%; repeated dumping of the same
  ore leaves it cheap until the wall clears it.
- Cargo keeps its **book value**: a cell is booked at the quote when it was
  caught, and the sale pays that book; the market learns about the load after
  the sale, so a drifting quote can never re-price a load in the hopper.
- `state.mineralPrices` *is* the live quote table and `state.referencePrices`
  the list, so the readouts, the price view, the tooltip and the till share one
  source of truth. The market table shows quote · move against list · trend
  arrow, and the inspector now reads the mineral mix beside the element mix.

## Implementation

- `js/ceiling.js`: `vein`, `generateField`, `demandAt`, `quotePrices`,
  `priceField`, `advanceMarket`, `bookSupply`, `refreshDebrisValues`; the field,
  rarity, demand and supply constants; `prices` becomes a `Float64Array`;
  `reset` seeds the demand phases and re-quotes; `step` advances the market;
  `sellCargo` books supply and re-quotes; `generateTestRock` quotes its bands
  through the same path; `state` gained `marketTime`, `referencePrices`,
  `fieldShare`, `supplyPressure`, `demandTrend` and a `demand` getter.
- `js/main_readouts.js`: the market table's price column is `quote · move ▲/▼`,
  updated from the readout cadence; the tooltip reads Fe/Cu/Cr beside R/G/B.
- `index.html`: the market table caption describes the live quotes.
- `js/help.js`: the market topic explains the quotes, the drift, the glut and
  the book value.
- `README.md`: the chamber section describes the veins, the market section the
  quotes.
- `experiments/market-probe.cjs` and `experiments/logs/mineral-market-probe.txt`.
- Tests: `experiments/ceiling.test.js` gained formation, reference-price, demand
  drift, sale-feedback and book-value cases; `experiments/interface.test.js`
  gained the market table's quote and trend. The crater-slope case now checks
  the slope the face actually has (the new field makes a notch asymmetric)
  instead of assuming a symmetric one.

## Validation

- `node --test experiments/*.test.js`: **235 tests, 235 pass** (was 229; the six
  new cases are formation, reference prices, drift, sale feedback, book value
  and the interface table).
- `node experiments/market-probe.cjs` → `experiments/logs/mineral-market-probe.txt`:

  | seed | mix Fe/Cu/Cr | dominant % | median cell | mean cr/cell |
  | --- | --- | --- | --- | --- |
  | 1 | 0.64 / 0.25 / 0.11 | 90 / 10 / 0 | 0.62 | 7.43 |
  | 7 | 0.61 / 0.27 / 0.12 | 86 / 14 / 1 | 0.57 | 7.98 |
  | 42 | 0.56 / 0.33 / 0.11 | 77 / 22 / 1 | 0.54 | 8.11 |

  Demand over ten minutes with no sale: iron 1.00…2.32 (2.3×), copper
  4.06…11.72 (2.5×), crystal 25.7…77.2 (2.7–2.9×); the largest one-second move
  is 2.0% / 1.5% / 1.1%, so the change is a drift over minutes and never a
  flicker. Iron reverses 8 times in ten minutes, copper 5 and crystal 3–4, each
  cycle about 2.5 / 4 / 6 minutes long. A full hopper sold at t = 0 marks its own
  ore down 5.3% at once (iron 2.30 → 1.26 cr), the pressure at 60 s is a third of
  where it started and under 1% inside two minutes, and the quote recovers on its
  own demand to 44.9 cr for crystal by t = 120 s.
- Realized book value of a full hopper across six seeds: 5.5–10.4 cr/cell
  (median ≈ 6.9), against the old constant 4.4–9.8 and the old measured ~6 cr
  realized per cell, so the shift income keeps its measured pace while its
  spread widens.
- `node experiments/mine-trips.cjs`, 8 seeds each at the 240 s cap, against the
  same script measured before the change:

  | | before | after |
  | --- | --- | --- |
  | square, gross per shift | 317 cr | 464 cr |
  | square, extraction | 132.1 cells/min | 130.7 cells/min |
  | square, catch rate | 9.3% | 11.4% |
  | smooth, gross per shift | (not recorded) | 333 cr |
  | smooth, extraction | (not recorded) | 138.7 cells/min |

  Extraction is unchanged within noise, so the higher gross comes from what a
  cell is worth, not from mining more of them: the median cell is dearer because
  a seed's own rarity and demand lift its ores, and the catch rate rose because
  a fall group now follows a coherent mineral seam rather than a blurred mix.
  Energy draw, ball speed and the 14/15 upgrade ladder are unchanged, and one
  recharge per shift is still the norm — the ladder is not priced against the
  new income.
- The DOM shim boots the real page: the market table reads three live quotes
  with their moves and trend arrows (`Iron 1.36 · -10% ▼`), the tooltip reads
  `Fe 76% Cu 24% Cr 0%` beside the element mix, and no page errors are raised.
- `node --check` clean on every changed script.

## Left open

- The transport for a mix whose crystal share is now ~0.1 but whose price is
  29× iron: the mean cell value is right, but the variance across seeds has
  grown (5.5–10.4 cr/cell). If a future shift shows the spread is too punishing,
  the honest lever is `supplyImpact` and `demandReachByOre`, not the reference
  prices, which are the requested change.
- The market is a price model with no competitors in it: every platform's sales
  feed the same wall, which was the stated intent. A per-buyer demand term would
  be a different design and is not started.
