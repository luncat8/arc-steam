# minerals.1 — Ore formed from elements and a market with its own weather

## Goal

The rock should look and pay like ore, and its prices should be a market rather
than a constant table.

- One coherent rock: the three element fields are the raw material and the ores
  form over concentration ranges of those elements, so the R/G/B view and the
  mineral view describe the same stone.
- Cheap ore much cheaper, rare ore much dearer.
- Quotes generated at the start of each run from rarity and a seed-generated
  demand table: the rare ore is usually dearest, but a common ore can open in a
  rush and be dear too.
- Slow price noise that can make a big change inside a few minutes of play,
  never flickering and never sitting still, with each ore moving at its own pace.

## Decisions

### Formation

- **Three element fields.** R, G and B each get their own three-octave
  value-noise function at one feature scale. Their potentials are expanded over
  the seed's own 3rd–97th percentile band and normalised into the element
  proportions shown by the Elements view; the same potentials are the raw
  material for the ores.
- **Formation ranges, not fixed cutoffs.** Each ore's weight is how far its
  element has climbed through that ore's concentration range. R hosts iron
  everywhere with only soft variation, G starts copper at the seed's 10th
  percentile and B starts crystal at the 45th; the high end of each range is the
  seed's 97th percentile. Because the ranges are quantiles of this run's own
  element distribution, a seed whose noise sits high or low still grows the
  same share of rare ore. The gain table (`2.2 / 1.3 / 0.9`) sets the mean mix
  at about `0.62 / 0.27 / 0.10` and the median dominant share at about 0.6.
- **The two views agree.** A cell's mineral mix is a documented function of its
  element potentials, so a copper seam is a green crest and a crystal pocket is
  a blue crest. Measured Pearson correlation is 0.67–0.85 for R/iron,
  0.93–0.96 for G/copper and 0.72–0.82 for B/crystal; blue leads the elements
  in more than 99% of crystal-rich cells. The R/G/B view paints every cell from
  its own proportions.
- **Strength follows the ore mix.** `2.2 + 2.8·Fe + 1.7·Cu + 3.6·Cr`, so the
  formation ranges also decide which parts of the face give way first.
- **Measured, not asserted.** `experiments/market-probe.cjs` reports the mix,
  dominant share, cell value, element/ore correlation, connected ore runs and
  opening quotes for any seed.

### Prices

- **Reference list:** iron `1.5`, copper `7`, crystal `44` — the cheap ore at
  half and the dear ore at four times the old table. They price a reference mix
  of `0.62 / 0.28 / 0.10`, not a pure cell.
- **Rarity is the run's own rock.** Mean supply is compared with the reference
  mix in log space (exponent 0.5, iron damped to 0.2, clamped to 0.6–2.2), so
  a seed short of crystal pays more for it on every sale.
- **The opening demand table is generated per seed.** Every ore starts with a
  small positive level plus a seeded random offset in log space. On about 45%
  of seeds a common ore (iron or copper) opens in a rush while crystal cools:
  the rush is bounded (`−1.1 … 1.6` in log space) and decays with a 180 s time
  constant, so it rewrites the first few minutes instead of the whole run.
  Crystal is dearest on about four seeds in five; on the rest a common ore
  leads, and a common ore opens above twice its list price on about half of all
  seeds. The generated table *is* the opening quote: slow noise fades in over
  the first 45 s.
- **Demand is slow noise, not a sine.** One-dimensional value noise per ore with
  three octaves: a slow lattice whose knots alternate high and low with seeded
  amplitudes (85 / 125 / 180 s per knot), a smaller faster octave at 2.4× the
  pace, and a deeper season octave at 0.42× the pace. The alternating slow knots
  guarantee a boom and a glut every few minutes without a repeating cycle; the
  other octaves break its regularity. All three are summed in log space,
  bounded by a `tanh` band of ±0.9, and scaled per ore (`0.62 / 0.85 / 1.1`),
  so crystal's ongoing drift reaches widest and iron narrowest. A generated
  opening rush can make a common ore's *total* first-ten-minute swing wider on
  that seed.
- **No flicker, no dead market.** Quotes are re-solved four times a second on
  the chamber clock, not per frame. One second moves a quote by at most about
  2%, a three-minute window typically doubles it, ten minutes typically swings
  each ore by about 2× or more, iron reverses about twice as often as crystal, and no two
  ores share a pace. Simulation time drives it, so 2× speed runs the market
  twice as fast.
- **Selling feeds back.** A sale adds supply pressure to the ore shares in the
  load; the quote is divided by `1 + pressure`, the pressure scales the same
  ore's share of the load, and it decays with a 60 s time constant. A full
  hopper of one ore discounts that quote about 8%; repeated dumping leaves it
  visibly cheap until the wall clears it.
- **Cargo keeps its book value.** A caught cell is booked at the quote it was
  worth when it was caught, and a sale pays that book value; the market learns
  about the load after the sale. A drifting quote therefore never re-prices a
  load in the hopper. Grains still in the air are part of the wall and re-price
  with it.
- **One source of truth.** `state.mineralPrices` is the live quote table
  (`state.referencePrices` the list, `state.startupDemand` the generated
  opening table). The market table shows each quote, its move against list and
  an arrow for the drift ten seconds ahead; price view, tooltip and the till
  read the same numbers.

## Implementation

- `js/ceiling.js`
  - `elementField`, `elementQuantile`, `generateField`, `measureRarity`: one
    element field with two readings, adaptive formation ranges, the shared
    rarity measurement used by both the real rock and the test rock.
  - `demandKnot`, `demandNoise`, `demandAt`, `quotePrices`, `priceField`,
    `advanceMarket`, `bookSupply`, `refreshDebrisValues`.
  - Field, reference-price, rarity, demand, startup-demand and supply
    constants; `prices` is a `Float64Array` so a pure cell is worth exactly its
    quote.
  - `reset` generates the opening demand table and the noise phases; `step`
    advances the market; a wall sale books supply and re-quotes.
  - `state` exposes `marketTime`, `referencePrices`, `startupDemand`,
    `fieldShare`, `supplyPressure`, `demandTrend` and a `demand` getter.
- `js/main_readouts.js`: market table shows quote · move · trend arrow; the
  inspector reads the mineral mix beside the element mix.
- `index.html`, `js/help.js`, `README.md`: chamber and market descriptions.
- `experiments/market-probe.cjs` + `experiments/logs/mineral-market-probe.txt`.
- `experiments/ceiling.test.js`: formation and its element correlation, the
  element view's colours, the reference list, the opening demand table, demand
  drift, sale feedback and cargo book value.
- `experiments/interface.test.js`: the market table quotes and their trend.

## Acceptance

- Every seed's field is dominantly iron with copper seams and crystal pockets;
  the median cell carries more than half one mineral, and each ore's share
  correlates with its own element channel above 0.65.
- The Elements view paints a distinct colour for every cell.
- Reference prices are 1.5 / 7 / 44 for iron / copper / crystal.
- Crystal is the dearest opening quote on most seeds; a common ore is dearest
  on some seeds and opens above twice its list on many; the rush decays over a
  few minutes.
- No one-second price move exceeds 2.5%; a three-minute window moves every ore
  by at least 1.8×; ten minutes usually swings every ore by about 2× or more,
  crystal's ongoing drift widest and iron turning over fastest. A common ore's
  opening rush can be the wider first-ten-minute move on that seed.
- A wall sale lowers its own ore's quote and the quote recovers.
- Cargo and its sale keep the book value of the cells that were caught.
- The suite is green: `node --test experiments/*.test.js`.
