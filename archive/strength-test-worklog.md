# Strength comparison bed

Reviewed the previous test bed: it assigned identical looseness to every mineral without reducing strength, and arranged bands in table order. Consequently the experiment did not exercise strength-dependent impact response or distinguish the strength views.

The bed now orders pure minerals by strength and applies a common graded impact through the same per-hit cap and looseness calculation as normal impacts. Initial strength, remaining strength, and strength removed are rendered separately; falling fragments retain their strength values at release.

Validation: the mineral-fall, strength-collapse, geology-config and interface tests pass. A full suite run initially had two interface failures caused by an outdated order assertion and its interrupted cleanup; the focused rerun passed after updating the assertion. The comparison test checks weak versus strong falls at 20 seconds and after the exposed loose faces settle.

Next: tune the test impact magnitude and grouping defaults with visual playtesting if a different contrast is desired.

## Full damage gradient

The previous 0.936 J test impact and single-hit cap left the entire bottom visibly too strong. The bed now starts with a full absolute damage gradient, capped just short of each material's strength so even fully damaged cells remain visible until they fall. Weak minerals also get a higher release chance, preserving the intended intermediate contrast despite saturation of looseness. The prepared bed is not a single normal strike.

Validation: check the top and bottom strength-view colors and compare weak and strong falls during collapse and after settling.

The full test run found the faster weak-rock release increased the proceeds in the partial-recharge fixture; reducing its prepared load restored the intended short-budget setup. All other tests passed in that run, and the revised economy tests pass separately.

## Remaining-strength collapse

The earlier implementation used looseness alone for eligibility. Every loose face had a permanent nonzero chance to fall, so given enough time even strong damaged rock detached. It also constrained exposed faces by neighbouring heights, creating a wall/edge bias, and attributed every cell in a mixed clump to its seed mineral.

Collapse now requires both sufficient impact looseness and remaining strength below 20% of the strongest material; lower remaining strength increases the release probability. Only exposed faces may fall, without a neighbouring-column barrier. Cell counts use each released cell's own dominant mineral; group counts still identify the seed mineral. The inspector and help use the same eligibility rule. Floor rubble remains a generic soil rendering, not a mineral-color view.

Validation: all 318 tests passed, including low- versus high-remaining-strength timing, strong damaged rock staying in place, equal weak faces at both walls, the final test-bed surface and per-mineral accounting. Existing cargo/fracture fixtures were adjusted for the additional hits needed to reach low remaining strength. The interface and mineral-fall tests passed again after clarifying the fall statistics.

Next: visually playtest the 20% absolute threshold and release rate with the intended mineral growth settings.

## Weakest-mineral threshold, two-zone strength palette, test gradient, and wall containment

Reviewed `06aa63025015434433f9da3b4747ee9ae9800329` and resolved four issues:

- **Remaining-strength threshold & palette (`js/rock-materials.js`, `js/ceiling.js`, `js/help.js`)**: `collapseStrengthLimit` previously sat at `maxStrength * 0.2` (`1.56 J`), which placed intact gas-bearing rock (`0.8 J`) and weak seeded seams (`0.97 J`) inside the collapsible regime, while the linear `[75,45,38]..[205,170,120]` palette rendered `0.8 J` almost indistinguishable from `0 J`. Exported `minStrength` (`0.8 J`) from `js/rock-materials.js`, set `collapseStrengthLimit = materials.minStrength`, and split `strengthColorInto` at `minStrength / maxStrength` between a dark-to-russet brown falling range (`< minStrength`) and a cool-slate-to-golden-sandstone non-falling range (`>= minStrength`). Expanded `strengthPalette` to 1001 slots with `strengthSlot()` boundary clamping so `0%`-damaged top cells match `Initial strength` identically while `100%`-damaged bottom cells stay darker and browner than the weakest intact mineral, with zero boundary crossover.
- **Collapse speed & test-rock gradient (`js/ceiling.js`)**: Updated `populateTestRow` to apply `entry.strength * rowDamage * 0.99999` (`0%` damage at the top down to `100%` at the bottom across every mineral band) instead of scaling by `maxStrength` and clamping wide swaths of weaker bands flat to zero. Raised `collapseChanceMax` to `0.7` with nonlinear `weakness = Math.pow(Math.max(0, 1 - strength[seed] / collapseStrengthLimit), 1.5)` so lower remaining strength collapses markedly faster, and weak right-hand test bands outpace strong left-hand bands both mid-collapse (`t = 20 s`) and at rest (`t = 6000 s`, leaving strong minerals intact on the ceiling).
- **Wall-notch ball containment (`js/physics.js`, `js/prediction.js`)**: Near a carved wall notch (`1–3` columns deep at either wall), `traceSmooth` and `traceSquare` could separate a ball past `radius` (`x < radius` or `x > width - radius`) with outward velocity; `wallTime >= 0` then evaluated false and let the ball escape the chamber. Added zero-time outward wall checks and post-rock-contact `[radius, width - radius]` clamping with outward horizontal reflection in both `advanceBall` and `prediction.trace`, preserving exact energy accounting.

Validation: `node --test experiments/*.test.js` passed all 318/318 tests (including new assertions for `minStrength`, two-zone strength palette separation, default- and uniform-growth test-bed contrast, and left/right wall-notch containment + prediction parity in smooth and square rock modes). `experiments/browser-smoke.cjs` was not run because Playwright/Chromium are not installed in this sandbox.

Next: visually verify the `Remaining strength` view, `Generate test rock` progression, and near-wall bounces in a real browser (`node experiments/browser-smoke.cjs` with Playwright configured).
