# minerals.2 — Meaningful minerals, strength and a calibrated market

## Goal

Make the three element fields easy to understand, give each generated mineral a
recognisable identity and mechanical role, and make its price rarity credible.
Keep geology, impact strength, collapse behaviour and demand as separate
systems. Treat numeric ranges below as provisional and measure them over
many seeds and depths, not as a final balance truth: re-measure after any change
with `node experiments/mineral-field-probe.cjs` and re-tune in
`prototypes/mineral-lab.html`.

## Decisions

### 1. Elements are Metal, Crystal and Gas

| Channel | Meaning | Stored value | Display |
| --- | --- | ---: | --- |
| R | Metal concentration | independent `0..1` absolute concentration | `R metal` |
| G | Crystal / silicate concentration | independent `0..1` absolute concentration | `G crystal` |
| B | Gas / volatile concentration | independent `0..1` absolute concentration | `B gas` |

- Use **absolute ranges**, not fractions of `R + G + B`. The three values do
  not sum to 1. A cell can be low in all three or high in all three. Dividing
  by their total would couple the fields, destroy absolute concentration and
  make a narrow range's rarity dependent on the other channels.
- The RGB visualisation remains only a view of those three numbers. Element
  names, mineral names and chemical analogues must not be used interchangeably.
- Use three independent seeded smooth-noise fields, one hash channel each. The
  existing value noise is suitable; simplex noise is an option, not a
  requirement. Sample at `(x * frequency, y * frequency * 3, channel)` so
  geological variation in Y is about 3× faster than in X and deposits form
  flattened seams. Measured: the row gradient is 2.9–3.1× the column gradient.
- Give the channels different offsets and modestly different frequencies, but
  apply the same 3× geological Y compression to all of them. Do not confuse
  this with the renderer's vertical perspective warp.
- **Flatten each channel's distribution.** Raw value noise piles up around 0.5
  (mean 0.500, sd 0.215): a band of width 0.10 near 0.5 covers 8% of cells, the
  same band at 0.90 covers 1.2%. Without a correction the width of a range says
  nothing about how rare it is, and every band near an extreme — native silver
  and gold in particular — is effectively unreachable. Apply the channel's
  measured cumulative distribution (`js/element-cdf.js`, 257 nodes, regenerated
  by `node experiments/element-cdf.cjs`) to the raw noise: the remap is
  monotone, so the field stays smooth and the seams keep their shape, but each
  channel is then spread evenly over `0..1` (measured deciles 8.1–10.9%).
  Rarity becomes a function of range width again, and a concentration of 0.95
  means "the top 5% of the field" rather than "one cell in a thousand".
- Element values are sampled deterministically. Mineral membership is a
  composition probability/fraction, not an extra random draw per cell.

### 2. Use one explicit geological table

Notation: all ranges are absolute `0..1`; **any** means `[0, 1]` and imposes no
condition. `Gold-bearing quartz` uses **Au**, not Ag; common iron ore is
represented by hematite rather than the less representative FeO.

The non-gas ranges were calibrated against earlier targets. The gas signature
has since been constrained for its identity; all ranges and targets need to be
re-measured together before calling the table calibrated.

| Mineral | R metal | G crystal | B gas | Real-world analogue | Intended rarity |
| --- | --- | --- | --- | --- | --- |
| Stone (host rock) | any | any | any | mixed silicate host | host / fallback |
| Iron ore | 0.28…0.99 | 0.00…0.54 | 0.00…0.63 | hematite, Fe₂O₃ | common |
| Copper ore | 0.31…0.79 | 0.02…0.38 | 0.21…0.69 | chalcopyrite, CuFeS₂ | uncommon |
| Quartz stone | 0.00…0.48 | 0.23…0.87 | 0.00…0.56 | quartz, SiO₂ | common |
| Corundum | 0.10…0.40 | 0.70…0.95 | 0.05…0.30 | corundum, Al₂O₃ | rare |
| Fluorite | 0.07…0.38 | 0.11…0.54 | 0.62…0.98 | fluorite, CaF₂ | uncommon |
| Native silver | 0.67…0.96 | 0.26…0.55 | 0.04…0.33 | native Ag | rare |
| Gold-bearing quartz | 0.82…0.98 | 0.06…0.26 | 0.42…0.66 | Au in SiO₂ gangue | very rare |
| Gas-bearing rock | 0.00…0.20 | 0.00…0.20 | 0.80…1.00 | volatile/gas inclusions in rock | uncommon (target provisional) |

- The analogues explain the gameplay identity; they are not a claim that three
  abstract concentrations reproduce real chemistry.
- **Gas-bearing rock is not the Gas element and is not a cell of pure gas.** It
  is stone with enough trapped volatile material to have different strength
  and value, so cell mass, cargo and debris remain meaningful.
- Stone is the host matrix and explicit fallback. Everything outside every ore
  signature becomes Stone rather than being assigned to the geographically or
  mathematically nearest rare ore.
- Rarity labels target a share of the rock. They are not price multipliers and
  must not override measured abundance.

### 3. Turn range membership into a mineral mix without a nearest-box bias

Replace nearest-soft-box selection with bounded membership functions:

1. For one constrained channel, membership is 1 inside `[low, high]`, then
   falls smoothly to 0 across a feather outside the range. Use smoothstep or
   another zero-ended smooth curve.
2. Set feather automatically to `min(0.08, rangeWidth * 0.35)` for that
   channel. Thus a narrow band stays narrow, while a broad band has a modest
   transition. An `any` channel always has membership 1.
3. A mineral's affinity is the **geometric mean** of its constrained channels'
   memberships, not their product. Product looks like the natural "every
   condition is necessary" rule, but it quietly punishes a three-condition ore
   by roughly the cube of its partial matches: two ores that are equally well
   matched, one with three conditions and one with one, differ by a factor of
   eight. The geometric mean keeps every condition necessary — a zero
   membership is still zero — and compares ores on the same scale.
4. Multiply the affinity by a **specificity gain**,
   `1 + specificity * (1 - meanConstrainedWidth)`, with one global
   `specificity` (initially `0.6`). Two signatures often both match a cell
   perfectly, and then the broad one takes half of it: a broad ore whose box
   contains a narrow one leaves the narrow ore unable to lead a single cell,
   however well it matches. The gain is computed from the range itself, so it
   is not a per-mineral occurrence multiplier (see rule 6) and it cannot be
   used to make one mineral rarer by hand; the narrow box still covers few
   cells.
5. Add a constant Stone host weight, initially `0.08`. Normalize Stone plus all
   ore affinities to sum to 1. With no ore affinity the result is 100% Stone;
   overlapping signatures produce a real mixture; one full match is mostly that
   mineral with some host matrix.
6. Do not add per-mineral occurrence multipliers. Range geometry, the
   distribution and overlap create rarity. If a target cannot be reached,
   adjust its ranges or the shared feather rule and document why.
7. Keep the host weight **solved, not guessed**. Mean host share rises
   monotonically with the weight, so `solveHostWeight()` bisects the weight that
   reaches the target host share of §4; the plan's `0.08` is what that solver
   returns for the calibrated ranges. The weight alone cannot rescue a table
   whose signatures cover too little of the element cube: cells outside every
   signature are host whatever the weight is, which is why ranges have to be
   calibrated first.

This avoids the failure mode of a nearest-distance softmax: far outside every
range, the nearest rare box can still win even though the cell matches none of
that mineral's signature. It also makes `any` genuinely unconstrained.

### 4. Every mineral has to be findable

The failure this replaces is "mostly stone and quartz, nothing else": with the
design ranges and a host weight of 0.08, Stone took 62% of the field, 55% of
cells were over 90% host, and native silver and gold appeared in 0.13% and
0.37% of cells. Abundance has to be an explicit target, measured and tuned:

- Target shares come from rarity weights, not from hand-set numbers. The host
  takes its share first (initially **32%**), the rest is split by weight:
  common 1.00, uncommon 0.45, rare 0.19, very rare 0.07. The nine-row table of
  §2 works out at 17.9 / 17.9 / 8.1 / 8.1 / 8.1 / 3.4 / 3.4 / 1.3 percent.
- Three numbers describe a mineral, and all three are reported:
  - **share** — its mean fraction over the sample, which is what pricing uses;
  - **dominant** — the share of cells it leads, which is what the player
    recognises as "a vein of X";
  - **visible** — the share of cells holding at least a quarter of it.
- **Patch size**: the mean number of cells in one connected run of the same
  dominant material on a 192 × 120 map. A mineral in 1-cell specks is
  invisible; 10–40-cell patches read as seams.
- Acceptance for a typical map: every mineral visible in at least 1% of cells,
  dominant in at least 0.5%, and patches of at least 5 cells.

Calibrating to those targets (`geology.autoAdjust`) alternates two cheap steps
over a fixed multi-seed sample:

1. **Widths.** Scale constrained ranges except the fixed gas signature around their centres by
   `(target / measured)^0.3`, clamped to 0.8…1.25 per pass. Scaling around the
   centre keeps the chemical identity; the exponent is damped because a
   three-condition ore loses abundance roughly with the cube of its width.
2. **Spread.** If one signature's box lies completely inside another's, move it
   out by the smallest shift that leaves it sticking out by 6% on some channel,
   preferring the move that disturbs it least; do not move the gas signature. Without this the width pass just
   inflates the broad boxes and the narrow ores end up dominating nothing.

Then re-solve the host weight. The fixed gas box and unmatched host cells can
make targets impossible; report actual residuals rather than claiming convergence.
Revisit the rarity targets and signatures with multi-seed measurements.

### 5. Store the table as readable local JavaScript data

Use a small `js/minerals.js` classic-script data module, loaded before
`js/ceiling.js` and guarded for Node exports. Do not fetch CSV or JSON: runtime
loading must remain `file://` friendly. Do not maintain a second handwritten
runtime table in the ceiling or UI.

Keep one object per mineral and one range per named channel. For example:

```js
{
	id: 'iron', name: 'Iron ore', symbol: 'Fe', analog: 'Fe₂O₃',
	r: [0.28, 0.99], g: [0.00, 0.54], b: [0.00, 0.63],
	rarity: 'common', strength: 5.4, growth: 220,
	color: [184, 91, 64], demandPeriod: 220, demandDepth: 0.35
}
```

- Share one frozen `ANY = [0, 1]` constant for unconstrained channels.
- `strength` is the complete pure-cell value in joules, not a hidden bonus to
  which another constant is later added.
- Keep `rarity` as a calibration tier: the module also exports the rarity
  weights, the target host share and the computed `rarityTargets` array, so the
  lab, the probe and the tests all tune against the same numbers.
- `strength`, `growth`, `color` and the demand fields are not calibrated by the
  lab; they are design values.

The element field and the mineral mix live in **`js/geology.js`** — one
implementation shared by the page, the lab and the probes, so the numbers
measured outside the game are the numbers the game produces. It compiles the
ranges into a membership lookup table (1024 nodes per mineral and channel,
linear interpolation, within 0.005 of the exact curve) so a cell's mix is a few
dozen multiplies. `js/element-cdf.js` holds the measured noise distribution of
§1.

### 6. The mineral lab

`prototypes/mineral-lab.html` is a `file://` page that shows the same fields the
game generates and lets the ranges be dragged while the rock updates:

- the rock as one pixel per cell, in four views: blended mineral colour,
  dominant mineral, the raw element cube, and host share;
- the three element channels as separate previews, so the 3× Y flattening is
  visible as stratified seams;
- a measurement table over a multi-seed, deep sample: target, share, dominant,
  visible and patch size per mineral, with the target marked on the bar;
- one row of three **two-handle range sliders** for every non-host mineral, visible at once, each with
  the channel's histogram and the mineral's yield curve drawn behind the track,
  so a band can be dragged onto the part of the field that actually produces
  it. Handles are pointer, touch and keyboard driven; a click on the track moves
  the nearer handle, and the live drag only re-mixes the visible rock so the
  numbers follow on release;
- controls for seed, field frequency, Y flattening, map depth (rock deeper in
  the same geology), sample size and depth, host weight (with a solve button),
  affinity mode and specificity, and the rarity weights;
- **Auto-adjust** runs §4's calibration and reports the passes and the worst
  remaining error; **Spread** runs the de-overlap step alone; **Copy JS ranges**
  and **Copy report** export the result for `js/minerals.js` and the worklog.

### 7. Strength means impact resistance, not Mohs hardness

Give every mineral a complete direct-impact strength and a separate collapse
growth default:

| Mineral | Strength, J/cell | Default collapse growth | Intended mechanical identity |
| --- | ---: | ---: | --- |
| Stone | 4.2 | 120% | ordinary medium host rock |
| Iron ore | 5.4 | 220% | tough, cohesive seams |
| Copper ore | 4.8 | 140% | moderately tough ore |
| Quartz stone | 6.0 | 70% | hard but comparatively brittle |
| Corundum | 7.8 | 40% | strongest, small brittle falls |
| Fluorite | 3.0 | 45% | weak cleavage, small falls |
| Native silver | 3.5 | 180% | soft but ductile/cohesive |
| Gold-bearing quartz | 3.4 | 60% | valuable, weak matrix |
| Gas-bearing rock | 0.8 | 20% | weakest, crumbly inclusion-rich rock |

- Set `initialStrength[cell]` to the mineral-fraction-weighted arithmetic mean
  of these explicit J/cell values. Remove the undocumented `2.2 + hardness`
  transformation and rename the data field from `hardness` to `strength`.
- Strength controls only resistance to impact energy. Collapse growth models
  cohesion/cleavage and controls group size versus release frequency. A soft
  ductile metal can therefore be weak yet cohesive; corundum can be strong yet
  produce small flakes.
- Price is independent of both. Cheap rock may be strong and valuable ore may
  be weak, creating a meaningful targeting decision.
- Keep the damage radius, 2× impact multiplier, falloff, 50% hit cap, held-cell
  rule and energy accounting unchanged in the first pass. Change the material
  values, measure, then tune those global rules only if the measurements show
  a separate problem.
- Test rock continues to use pure mineral bands, making exact strength and
  collapse differences directly comparable. Natural mixed cells use the
  weighted rules above.

### 8. Keep abundance pricing and improve demand only where measurement helps

The required market model already has a sound separation:

- Measure each mineral's abundance in a representative geological sample.
  Base price follows `share^-1.3`, then is normalised to the target mean cell
  value (initially 12.5 cr before demand). Rarer measured minerals therefore
  usually cost more without a handwritten rarity price.
- Apply floor/cap constraints without silently losing the economy target:
  iteratively renormalise still-unclamped prices and report the final measured
  mean. Keep a cap for extreme seeds, but do not let it become the normal way
  rarity is expressed.
- Sample abundance across a fixed, sufficiently deep geological volume, not
  only the initially visible rows. New rows then belong to the same geology
  whose abundance established the opening base prices. Host rock is a real row
  in that measurement now: at a 32% share it is the cheap material everything
  else is priced against.
- Give every run an independent seeded startup demand bias for every mineral,
  initially around `0.70…1.45`. It is deliberately independent of rarity, so a
  common mineral can open dear and a rare one can open cheap.
- Continue two-octave one-dimensional smooth noise in chamber time, revaluing
  live rock at 0.5 s intervals. A fragment keeps the quote booked when it
  breaks; cargo, rubble and ledger values do not retroactively change.

Use distinct demand regimes instead of making all quotes feel alike:

| Regime | Initial slow period at 1× | Candidate minerals | Character |
| --- | --- | --- | --- |
| Fast | 100…160 s | Gas-bearing rock, Copper, Fluorite | noticeable opportunities within a short trip |
| Medium | 180…280 s | Iron, Native silver, Corundum | material change over several minutes |
| Slow | 320…450 s | Stone, Quartz, Gold | long market cycles |

- The second octave remains a smaller, shorter perturbation; it must not turn
  the quote into jitter. Use multiplicative, bounded demand so prices stay
  positive and percentage movement is symmetric.
- Tune for small per-second movement but useful 2–4 minute changes: initially
  aim for at most 1% in one second and roughly 15–40% peak-to-trough over four
  minutes for actively moving minerals. Slow minerals may move less.
- Do not add sale-reactive supply/demand in this step. First verify that the
  seeded cycles are understandable and useful; sales pressure would make
  balance and multiplayer attribution substantially more complicated.

## Implementation order

1. **Data and the lab:** add `js/minerals.js`, `js/element-cdf.js` and
   `js/geology.js`; add `prototypes/mineral-lab.html` (+ its css, its range
   slider and its script); add `experiments/mineral-field-probe.cjs`,
   `experiments/element-cdf.cjs` and `experiments/geology.test.js`. Calibrate
   the ranges in the lab and bake them (done: see §2 and the worklog).
2. **Formation in the game:** `js/ceiling.js` samples elements and mixes
   minerals through `js/geology.js` and reads the table from `js/minerals.js`;
   rename R/G/B in the view and inspector to Metal/Crystal/Gas; generate all
   mineral rows, sliders and test bands from the enlarged table.
3. **Strength and cohesion:** install explicit J/cell values and meaningful
   growth defaults while leaving global impact and collapse rules fixed.
4. **Calibration:** re-run the multi-seed, multi-depth abundance, strength and
   economy probes against the real chamber; adjust ranges first, then strength
   values, then the mean-value normalisation. Record the numbers.
5. **Market:** sample representative abundance, preserve break-time booking,
   apply the demand regimes and measure one-second and four-minute movement.
6. **UI and documentation:** update the element legend, inspector composition,
   mineral help, market and README. Keep composition text compact as the table
   grows; do not hardcode nine names or nine array strides anywhere.

## Measurements and tests

- `node experiments/mineral-field-probe.cjs [--seeds=5 --columns=120 --depth=240
  --adjust]` prints element evenness per decile, the seam-flattening ratio, and
  per mineral the target, mean share, dominant share, visible share and the
  ranges, for the calibrated affinity and for the plain product. Logs in
  `experiments/logs/minerals.2-field.txt`.
- Extend `experiments/mineral-mix-probe.cjs` to print, per seed and in
  aggregate: mineral fraction, dominant-cell share, Stone fallback share, mean
  initial strength and base price. Include enough seeds and geological depth to
  expose an absent or accidentally common rare mineral.
- Extend `experiments/mineral-market-probe.cjs` with opening/base ratios,
  four-minute low/high, worst one-second step and realised mean cell value.
- Verify all ranges are ordered and inside `0..1`, ids are unique, `any` is
  unconstrained, every mineral mix sums to 1, and no-signature cells are pure
  Stone. A full signature match must lead without a nearest-box contest
  (`experiments/geology.test.js`).
- Verify the flattened element field is uniform per decile, the row gradient is
  about 3× the column gradient, and the compiled membership table matches the
  exact curve.
- Verify every ore leads some part of the element cube, is visible in at least
  1% of sampled cells and dominates at least 0.5%, and that measured abundance
  follows the rarity tiers (common > uncommon > rare > very rare) with
  individual seeds allowed to vary.
- Verify the calibration converges to its targets and that a narrower
  equivalent of the same centred range is less abundant.
- Verify pure test bands have exactly their table strength and growth; mixed
  cells have the weighted strength. Damage/collapse tests must still conserve
  cells, mass, value and booked energy.
- Verify seeded startup demand, different demand periods, positive bounded
  prices, sub-1% one-second steps, material multi-minute drift, and the ability
  of a common mineral's live quote to exceed a rarer mineral's quote.
- Generalise interface tests to table length and the new element labels. Run
  the complete test suite and a real-page interface check after implementation.

## Acceptance

- R/G/B are presented as independent Metal/Crystal/Gas concentrations; element
  noise forms approximately 3× Y-flattened deposits, is never normalised to an
  RGB total, and is spread evenly enough that a range's width predicts its
  abundance.
- The nine material entries come from one readable table. Unmatched geology is
  Stone, overlapping ores blend, and no rare mineral becomes common merely by
  being nearest to an unmatched point.
- Measured multi-seed abundance supports the intended rarity tiers: Stone about
  a third of the rock, every ore visible in at least 1% of cells and dominant
  in at least 0.5%, in patches big enough to recognise.
- Pure and mixed strengths follow the table in joules; strength and collapse
  growth produce visibly different mechanical behaviours without changing the
  established damage/energy rules unintentionally.
- Base value follows measured abundance and remains near the economy target;
  seeded demand can invert price order temporarily. Quotes move materially
  over a few minutes at 1×, never jump, and use distinct fast/medium/slow
  regimes.
- Existing break-time valuation and conservation invariants, dynamic UI,
  interface run and full automated suite remain green.

Further prototype comparisons and validation priorities: `prototypes/mineral-gen-experiments-plan.md`.
