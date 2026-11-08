# mineral-fall.mix — growth as a gradient, and cells that fall as themselves

## Review of the previous step

The fall-surface work left a rock whose free face is the only part that can be
missing, and the mineral-groups work left a per-mineral growth slider (50…200%)
whose 0% end was meant to be "the behaviour before groups". Two things in that
setup did not hold up:

- **The two releases were a hard switch at one slider value.** `growth > 0 ?
  flake : legacy clump` reads as a threshold, and the rock's element field is
  smooth: a cell on a mineral boundary has no meaningful dominant mineral, so no
  exact percentage can be the boundary between "clump" and "group". The slider
  must describe a gradient, not a mode.
- **A released group was redrawn as one rectangle.** `spawnCluster` collapsed the
  cells into one fragment sized by the group's bounding box, so a group visibly
  changed shape the moment it let go, landed as one block in a single column and
  raised the pile under that column alone. The piece should fall in the shape it
  broke out in.

## Decisions

- **Growth is a mixing weight.** `clusterShare(growth)` ramps 0 → 1 between the
  slider floor (10%) and 200%. Every cell of a release is drawn either by the
  original rule (a loose free face of the band, taken as it comes: mineral-blind,
  not necessarily touching) or by the group rule (the cheapest connected,
  mineral-matched cell that widens the flake before it deepens, still opening
  from `firstRow` inward). At 10% the release is the clump the rock always gave;
  by 200% every cell of a piece follows the group rule. The live readout shows
  cells per fall, so the gradient is visible while playing.
- **The slider floor is 10%, not 0%.** A zero-growth setting is a degenerate
  value under a smooth field; 10% is the plain clump and can be reached, so the
  scale runs 10…500% with a 10% step. Defaults are Iron 300%, Copper 100%,
  Crystal 10% — one setting per band of the test rock, so the three behaviours
  can be watched side by side.
- **A group is a spawn event, not a drawing unit.** The selection still returns
  a group of cells; each of them enters the debris pool as its own grain at its
  own cell position, with its own mass, value, mineral and colour. Same gravity
  and no initial velocity means the formation stays rigid while it falls, so the
  piece falls in the shape it left the face in, lands in the columns it came
  from and raises the fallen-debris heightmap under each of them. One release is
  still booked as one fall with its cell count (`recordFall`), so the readout
  compares the settings on the same terms.
- The group cap follows the widest slider setting: `collapseChunkMax × (1 + 500%)`
  = 24 cells, which bounds one peel and its share of the debris pool.

## Implementation

- `js/ceiling.js`:
  - `minClusterGrowth` / `maxClusterGrowth` / `clusterGrowthFull` and
    `clusterShare()`; `setMineralClusterGrowth` clamps 10…500; defaults become
    `[300, 100, 10]`.
  - `peelSurfaceCluster` takes the share and mixes the two cell rules per cell;
    the legacy `legacyCluster` / `relieve` pair from the intermediate attempt is
    gone — one routine now spans both ends.
  - `spawnCluster`, `debrisWidth`, `debrisHeight` and the size-scaling in
    `catchFragment` are removed: `spawnFragment` places one cell-sized grain,
    `spawn` books a lone cell, and `recordFall` books a group.
  - the debris draw uses one cell-sized square per grain, still clamped under the
    drawn ceiling by the footprint rule.
- `index.html`, `js/main_input.js`, `js/main_readouts.js`, `js/help.js`,
  `README.md`: sliders 10…500 with the new defaults and labels, and help text
  that describes the mix instead of an on/off rule.
- `experiments/mineral-mix-probe.cjs`: prints the cells-per-fall gradient for the
  test rock and for mixed natural rock.
- `experiments/mineral-fall.test.js`, `experiments/ceiling.test.js`,
  `experiments/interface.test.js`: the tests now assert the gradient (larger,
  rarer groups; 10% ≤ the original 4-cell clump), mineral-blind mixing at 10%
  against mineral-pure flakes at 300%, one grain per released cell, distributed
  heightmap growth, and the 10…500 range with its defaults.

## Validation

- `node experiments/mineral-mix-probe.cjs` — test rock, 20 s of collapse:

  | growth | bursts | cells | falls | cells/fall |
  | --- | --- | --- | --- | --- |
  | 10 | 314 | 1110 | 314 | 3.54 |
  | 50 | 239 | 1146 | 239 | 4.79 |
  | 100 | 175 | 1126 | 175 | 6.43 |
  | 200 | 113 | 1107 | 113 | 9.80 |
  | 300 | 86 | 1118 | 86 | 13.00 |
  | 500 | 60 | 1153 | 60 | 19.22 |

  Mixed natural rock (300 hit + collapse rounds) gives 3.67 / 6.68 / 13.19 /
  19.42 cells per fall at 10 / 100 / 300 / 500 with
  `extracted = airborne + caught + lost` and no energy drift over the run.
- `node --test experiments/*.test.js`: 207 tests, 197 pass, 10 fail — the same
  ten pre-existing failures as the untouched baseline (12 there; two of those
  now pass because the released volumes feed the physics paths differently). No
  new failure. `node --test experiments/mineral-fall.test.js` is 6/6.
- Headless Chromium on the real page: no page errors; the sliders report
  `min=10 max=500` with values 300 / 100 / 10, and the live notes read 15.0, 7.0
  and 4.0 cells per fall for Iron, Copper and Crystal after a few seconds of the
  test rock. A zoomed render of the face shows single-cell grains falling in
  their old formation under the fresh notches, and the floor rising beneath
  them. `git diff --check` clean.
- `experiments/browser-smoke.cjs` still stops on the rock-view radio arrow-key
  assertion; it fails identically at the untouched baseline, so it is unrelated.

## Next step

The landed grains merge into the 4:1 soil heightmap as soon as they touch, so the
last grain of a group is never seen to settle. Next: pool the most recent landed
fragments as drawn grains that sink into the pile over a fraction of a second
(capped like the dust pool), and measure the per-frame cost before deciding
whether the cap is enough.
