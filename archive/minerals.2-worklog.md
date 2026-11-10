# minerals.2 — Elements form the ore; the market opens with its own weather

## Review of the previous step

`minerals.1` delivered real veins and a demand term, but the review found four
things worth improving (and one thing worth keeping exactly):

- **The two rock views had stopped describing one rock.** `generateField` used
  three mineral noise fields and a separate single-octave R/G/B triple, so a
  crystal pocket had no elemental reason to be there. That contradicts both
  `draft.txt` ("simplex noise R, G, B - elements that form minerals. mineral
  types [] = f(r,g,b)") and `0.1.0-plan.md` §0.1.5 ("three smooth-noise fields
  representing elemental proportions; map them through a documented function to
  normalized mineral weights").
- **The Elements view was blank.** The same rewrite dropped the
  `elementColors[index] = ...` assignment from `generateField`, so
  `colorFor(index, 'elements')` returned `undefined` for every real cell; only
  the test-rock bands had colours. No test covered that mode.
- **Selling raised the price it should have discounted.** `quotePrices`
  multiplied by `(1 + supplyPressure[m])` with a positive pressure. The probe's
  own table showed iron at 2.30 cr right after a 5.3% iron sale, above its 2.18
  cr opening quote; the test asserted only that pressure grew and that quotes
  stayed below `before * 1.5`, so the sign error was invisible.
- **`generateTestRock` quoted stale rarity.** It set `fieldShare` to thirds but
  never recomputed `fieldRarity`, so its three pure bands were priced with the
  previous seed's rarity.
- **Demand was a fixed sine table, not noise.** Four discrete seed phases gave
  only three distinct opening levels; crystal's floor (~26 cr) was above copper's
  ceiling (~11.7 cr), so the rare ore was *always* dearest and no common ore could
  ever open high. Periods of 150/240/380 s made crystal's full cycle 6.3 minutes.
- **Kept:** the reference list `[1.5, 7, 44]` is exactly the requested ½ / ×4
  pair, rarity from the run's own supply, four quotes per second on the chamber
  clock, cargo book value, and debris re-pricing in flight.

## Decisions

- One element field, two readings. Three three-octave value-noise channels are
  the rock's R/G/B elements; each ore's weight is a ramp through a concentration
  range of one channel. Iron hosts from R with soft contrast, copper starts at
  the seed's 10th green percentile, crystal at the 45th blue percentile; the
  high ends are the 97th percentiles. Quantile ranges mean every seed grows the
  same share of rare ore whatever level its noise sits at. Gains `[2.2, 1.3, 0.9]`
  hold the measured mix at `0.62 / 0.27 / 0.10` and the strength histogram near
  the old one, so extraction and rubble keep their measured pace. The element
  view is painted from the same potentials.
- A seed-generated demand table replaces the sine phases: a small positive level
  plus a seeded random log offset per ore, and on ~45% of seeds a bounded rush on
  a common ore while crystal cools. The rush decays with a 180 s constant; the
  slow noise fades in over 45 s so the generated table *is* the opening quote.
  `startupLevel` keeps a fresh run's income at the measured pace instead of
  opening in a deep glut.
- Demand becomes real one-dimensional value noise with three octaves. The slow
  lattice's knots alternate high/low with seeded amplitudes (85 / 125 / 180 s per
  knot), which guarantees a boom and a glut within a few minutes without a
  repeating wave; a fast octave and a slower season octave break the regularity.
  `tanh` bounds the log drift at ±0.9 and per-ore reach (`0.62 / 0.85 / 1.1`)
  makes crystal's ongoing drift the widest on most seeds.
- Supply pressure divides the quote. Test rock measures rarity through the same
  `measureRarity()` helper as the real rock.

## Implementation

- `js/ceiling.js`: `elementField`, `elementQuantile`, `measureRarity`,
  two-pass `generateField` with element colours restored; `demandKnot`,
  `demandNoise`, `demandAt` (startup table + noise ramp + `tanh` band);
  `quotePrices` divides by supply; `reset` generates `startupDemand` and
  continuous noise phases; `state.startupDemand` exposes the table.
- `js/main_readouts.js`: the trend arrow reads a 10 s lookahead with a wider
  rest band. `index.html`, `js/help.js`, `README.md`, `minerals.1-plan.md`:
  the chamber, market and plan descriptions.
- `experiments/market-probe.cjs` rewritten to measure element/ore correlation,
  connected ore runs, the generated opening table across 60 seeds, three-minute
  drift windows and the sale discount; `experiments/logs/mineral-market-probe.txt`.
- `experiments/ceiling.test.js`: three new cases (element ranges, element-view
  colours, opening demand table); the drift case now pins a three-minute window
  and a 2.5% one-second bound; the sale case asserts the discount direction.
- Two older test setups were corrected for the live market: a full 100-cell
  hopper is now the load that funds research plus an item, and the research-delta
  case cools the rig (measured sales leave it hot, and a derated engine hides a
  mass delta) before checking acceleration. The interface market-table quote
  order now names the default run's opening table; other seeds' hot common ores
  are measured in `ceiling.test.js`.

## Validation

- `node --test experiments/*.test.js`: **238 tests, 238 pass**.
- `node experiments/market-probe.cjs` → `experiments/logs/mineral-market-probe.txt`:

  | measure | result |
  | --- | --- |
  | mix Fe/Cu/Cr over six seeds | 0.61–0.64 / 0.26–0.29 / 0.09–0.12 |
  | iron-dominant cells / median dominant share | 83–87% / 0.59–0.63 |
  | mean cell value | 7.03–7.90 cr |
  | element↔ore correlation R/G/B | 0.67–0.85 / 0.93–0.96 / 0.72–0.82 |
  | copper seam runs (median, p90) | 3–4, 7–13 cells; crystal pockets 2–4 |
  | opening demand, 60 seeds | crystal dearest 47, common ore dearest 13, a common ore >2× list on 31 |
  | opening quote band | Fe 1.14–7.41, Cu 5.02–36.16, Cr 16.62–70.12 |
  | largest one-second move | 1.2–1.6% |
  | best three-minute move | 1.8–3.7× |
  | ten-minute swing | 1.9–8.9× (crystal widest on 17 of 20 sampled seeds; a generated common-ore rush is wider on the others) |
  | turns in ten minutes | iron 8, copper 5, crystal 4 |
  | generated rush unwind | seed 42 copper 33.91 → 4.2 cr while crystal 20.09 → 65.3 cr over ten minutes |
  | full-hopper sale | 1.76 → 1.68 cr iron (−5.0%), copper −1.5%, crystal −1.2%; pressure 5.3% → 0.7% in 120 s |

- The generated rush also makes a big change over a few minutes by itself:
  seed 42 opens at Cu 33.91 / Cr 20.09 and at t = 180 s reads Cu 16.95 / Cr 40.58.
- Seed 1 (the page's default run) pays 684 cr for a full hopper (6.84 cr/cell),
  so the measured research, equipment, recharge and autopilot economies stay
  funded. `node --check` clean on every changed script.

## Left open / next step

- A rush on a common ore pays well above its list for the first minutes of a
  run. If a future shift shows that windfall is too generous, the lever is
  `startupBoomChance` and the clamp on `startupDemand`, not the reference list.
- Crystal still exists as a thin share across roughly half the face on most
  seeds. A steeper blue ramp would concentrate it into harder, more countable
  pockets, but changes the strength histogram and therefore extraction; that is
  a formation-and-physics step together, not a palette tweak. Suggested next:
  measure a steeper blue ramp against `mine-trips.cjs` before adopting it.
