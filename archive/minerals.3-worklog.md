# minerals.3 — A steeper blue crest, measured through the mine

## Review of the previous step

The shared element field made crystal follow blue, but the linear blue ramp and
`0.9` gain spread crystal thinly across many cells. Over seeds 1–60, only 0.57%
of cells carried at least half crystal and a face averaged 2.58 four-connected
crystal pockets. Because crystal adds more strength than copper, changing that
ramp also changes the material the impact and collapse systems have to work.

## Decision

- Square the normalized blue ramp (`power = 2`) and raise crystal gain from
  `0.9` to `1.6`. The gain is calibrated to keep the mean crystal share near
  10%, instead of reducing the ore's supply as the ramp steepens.
- Keep the 45th–97th percentile blue range, the strength formula, reference
  prices and market model unchanged. Measure both the field and the existing
  8-seed, 240-second `mine-trips.cjs` suite before accepting the formation.
- Define a countable pocket as a four-connected region where a cell's crystal
  share is at least 50%; report strength percentiles and bins alongside the
  pocket counts so the formation and its extraction material are measured
  together.

## Formation measurements

`node experiments/market-probe.cjs` measures 60 seeds. Linear-ramp figures on
the left were collected by compiling the previous `power = 1, gain = 0.9`
formation in memory; the current probe reports the squared ramp directly.

| measure | linear blue ramp | squared blue ramp |
| --- | ---: | ---: |
| mean Fe / Cu / Cr share | 0.619 / 0.278 / 0.104 | 0.622 / 0.279 / 0.100 |
| cells with at least 50% crystal | 32 / face (0.57%) | 168 / face (3.02%) |
| four-connected crystal pockets / face | 2.58 mean; median 2, p90 5 | 9.7 mean; median 9, p90 14 |
| pocket size, median / p90 | 5 / 23 cells | 6 / 46 cells |
| mean initial strength | 4.778 | 4.773 |
| mean per-seed strength p95 / p99 | 5.192 / 5.336 | 5.238 / 5.418 |

The strength histogram moves material out of the middle and into both tails:
`<4.5 / 4.5–4.75 / 4.75–5 / 5–5.25 / 5.25–5.5 / >=5.5` is
`12.21 / 35.93 / 31.16 / 17.64 / 3.02 / 0.04%` before and
`14.04 / 37.06 / 26.78 / 17.46 / 4.30 / 0.36%` after. The average strength
stays effectively fixed, while the strongest percentile rises and crystal
majorities become several times more frequent and connected.

Across 60 seeds, element-to-ore correlations are R/iron `0.59–0.85`,
G/copper `0.90–0.96`, B/crystal `0.56–0.83`; blue leads in 95.9% of
crystal-rich cells. The opening market remains crystal-dearest on 47/60 seeds,
with a common ore dearest on 13/60 and a common ore above twice list on 31/60.

## Mine-trip check

`experiments/logs/minerals.3-mine-trips-baseline.txt` and
`experiments/logs/minerals.3-mine-trips.txt` are the matched 8-seed baseline and
candidate runs from `node experiments/mine-trips.cjs` (all four existing
policies, smooth and square shapes, 240-second cap).

| stock base-tuning policy | linear | squared | change |
| --- | ---: | ---: | ---: |
| smooth extraction | 160.9 cells/min | 159.1 cells/min | −1.1% |
| smooth catch rate | 4.3% | 6.0% | +1.7 pp |
| smooth gross / shift | 157 cr | 150 cr | −4.5% |
| square extraction | 159.9 cells/min | 143.2 cells/min | −10.4% |
| square catch rate | 7.3% | 7.7% | +0.4 pp |
| square gross / shift | 181 cr | 169 cr | −6.6% |

Across the pad-aware progression policy, smooth extraction moves from 148.4 to
118.7 cells/min while square moves from 115.5 to 120.4; catch rate rises from
5.0% to 6.4% and 7.2% to 10.2%, respectively. The free and grader policies
also move in both directions by shape. There is no uniform extraction collapse:
the stock runs retain their mining cadence, and catching improves in the stock
smooth and square cases. The candidate is kept because it creates readable
crystal-majority pockets and a stronger upper tail without changing mean
strength or ore supply; the square stock trip's ~10% extraction dip is recorded
as a follow-up rather than hidden by a palette adjustment.

## Implementation

- `js/ceiling.js`: named `crystalRampPower = 2`; crystal gain `1.6`; the shared
  field still determines minerals, initial strength, value and the Elements
  view.
- `experiments/market-probe.cjs`: 4-connected crystal-pocket counts and sizes,
  per-seed strength percentiles and a 60-seed strength histogram.
- `experiments/ceiling.test.js`: crystal-majority pocket count, mean ore mix,
  mean strength and high-strength tail acceptance across six fixed seeds.
- `minerals.1-plan.md`, `README.md`, `js/help.js`: formation and measurement
  descriptions.
- `experiments/logs/mineral-market-probe.txt` and the matched mine-trip logs.

## Validation

- `node --test experiments/*.test.js`: **239/239 pass**.
- `node experiments/market-probe.cjs`: regenerated the 60-seed report.
- `node experiments/mine-trips.cjs`: 8 seeds per shape and policy at the
  240-second cap; matched baseline and squared-ramp logs retained.
- `node --check` clean on every changed script; `git diff --check` clean.

## Next step

Extend `mine-trips.cjs` to record mineral quantities in extracted, caught and
sold cells. The current total catch rate cannot tell whether the new crystal
pockets improve the amount of crystal a run actually banks, or merely make the
rock's high-strength tail more legible.
