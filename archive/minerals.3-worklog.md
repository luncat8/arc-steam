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

## Mine-trip mineral accounting (minerals.3 follow-up)

`mine-trips.cjs` now records per-ore mineral mass for extracted, caught and
sold cells. Extracted mass is new state on `ceiling.state`:
`extractedMinerals` (Float64Array, Fe/Cu/Cr kg) is accumulated in
`spawnFragment()` alongside the extracted cell count, zeroed in `reset()`
and exposed on the frozen state view. Caught mass is cargo + sold mass
(`cargoMinerals` + `soldMinerals`), sold mass is `soldMinerals`; each run
prints Fe/Cu/Cr kg for all three stages and each mode block ends with
per-shift averages. Experiments only — the page does not load `experiments/`.

`ceiling.js`: added `extractedMinerals` and its reset/accumulation/state
wiring; no formation or physics constants changed.

Logs: `experiments/logs/minerals.3-mine-trips-minerals.txt` is the matched
8-seed run of the shipped squared ramp (gain 1.6);
`experiments/logs/minerals.3-mine-trips-baseline-minerals.txt` is the same
suite with the previous linear ramp (gain 0.9), compiled by temporarily
restoring the old constants and reverting them afterwards (the diff shows
only the additive tracking).

Crystal sold per shift (Fe/Cu/Cr kg shown as crystal only), 8-seed averages:

| policy | shape | linear crystal banked | squared crystal banked | extracted crystal | share of extracted crystal banked |
| base tuning | smooth | 1.27 kg ≈ 2.1 cells | 1.26 kg ≈ 2.1 cells | 25.07 → 18.04 kg | 5.1% → 7.0% |
| base tuning | square | 1.15 kg ≈ 1.9 cells | 1.06 kg ≈ 1.8 cells | 14.84 → 14.88 kg | 7.7% → 7.1% |
| progression | smooth | 1.42 kg ≈ 2.4 cells | 1.78 kg ≈ 3.0 cells | 34.00 → 25.03 kg | 4.2% → 7.1% |
| progression | square | 1.56 kg ≈ 2.6 cells | 2.00 kg ≈ 3.3 cells | 22.80 → 23.08 kg | 6.9% → 8.7% |
| communism | smooth | 2.42 kg ≈ 4.0 cells | 1.99 kg ≈ 3.3 cells | 22.26 → 24.97 kg | 10.9% → 8.0% |
| communism | square | 3.10 kg ≈ 5.2 cells | 2.35 kg ≈ 3.9 cells | 36.49 → 29.07 kg | 8.5% → 8.1% |
| communism + grader | smooth | 2.40 kg ≈ 4.0 cells | 2.33 kg ≈ 3.9 cells | 24.42 → 23.08 kg | 9.8% → 10.1% |
| communism + grader | square | 2.01 kg ≈ 3.3 cells | 1.95 kg ≈ 3.3 cells | 30.21 → 24.31 kg | 6.6% → 8.9% |

Read: crystal stays about 7–8% of extracted rock either way, and nearly all
caught crystal is sold, so the shift's crystal banked is set by extraction
cadence and catch rate — not by pocket count alone. The squared ramp's more
numerous crystal-majority pockets (market probe: 0.57% → 3.02% of cells at
crystal majority, 2.58 → 9.7 four-connected pockets per face, mean strength
unchanged at 4.78) do not automatically bank more crystal: square stock trips
extract ~10% less rock and bank about the same or less crystal, while the
pad-aware progression converts the pockets into ~12% more crystal sold
(1.56 → 2.00 kg per shift) on a higher catch rate (7.2% → 10.2%). No uniform
direction across policies, so the square stock-trip dip stays a documented
follow-up rather than a formation change.

## Validation

- `node --test experiments/*.test.js`: **239/239 pass** (with the shipped
  squared-ramp constants).
- `node experiments/mine-trips.cjs`: regenerated both matched logs, 8 seeds
  per shape and policy at the 240-second cap.
- `node --check` clean on `js/ceiling.js` and `experiments/mine-trips.cjs`;
  `git diff --check` clean; baseline constants reverted, diff shows only the
  additive `extractedMinerals` tracking.

## Decision

Keep the current formation and stock policy. The square stock-trip extraction
dip is not important enough to justify a policy change; it remains documented
as an observed trade-off. No pad-aware stock-policy variant will be pursued
for this result, and no formation or physics changes are needed.
