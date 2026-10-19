# debris.1 — Fallen-debris floor heightmap, road grader, and the 3-bounce drive pulse

## Review of the previous step

- autopilot.2's suggested next step was a debris-aware interception duty. The user explicitly ruled out any automatic catching of falling debris (debris falls at the same 9.81 m/s² as before and catching is not a ball duty), so that step is superseded rather than skipped: debris remains manual cargo — collector catches, platform-over-ball recoveries, wall sales.
- autopilot.2 reported browser validation blocked by the sandbox's missing `libnspr4.so`. That is resolved: `playwright-core` + `@sparticuz/chromium` installed outside the repository plus the `al2023` NSS/NSPR library extract (`LD_LIBRARY_PATH`) now launch headless Chromium reliably. The recipe lives in `findings-pitfalls-skills.md`; the full smoke run passed this step.
- `0.1.0-plan.md` still carried pre-tuning calibration numbers (24 × 10 m chamber, 2.25 kg inertia, 36 J pulse, five equipment items). Corrected in this step and flagged here as a review finding.

## Decisions

- **Pulse size = 42 J.** "3 bounces should reach the top" is read as: from a release on the piston, the third piston contact's flight apex reaches the ceiling while bounces 1–2 stay short. The closed form `Aₙ = 0.88 + 0.9(Aₙ₋₁ − 0.88) + P/9.81` gives release 4.46 m, bounces 8.38 / 11.92 / 15.09 m against the 14.82 m ceiling line (`15 − 0.18`), so P = 42 J is the first whole number to clear it (41.7 J is the exact threshold). Verified in the simulator: three contacts, fourth push is an energy-restoring ceiling knockdown; reserve debit per powered contact 52.5 J at the fixed 80% efficiency.
- **Floor piles are scenery (option B).** The floor heightmap mirrors the rock's 192-column `(1,3,3,1) · 0.125 m³` deposit stencil into `floorPiles` / `floorHeight`, with a 0.7 m per-column pile cap and a non-negative clamp. Balls ground at `floorAt(x)` and keep their potential energy; landings book the fragment's mechanical at its real post-solve position into heat (booking at the pile surface used to create energy whenever a pile grew under a falling fragment — the cause of the earlier 2.6–5.8 J ledger failures).
- **Grader never pits.** The road grader digs piles down at 0.15 m/s, spreads load to neighbouring columns and smooths toward the local mean (ease `min(1, 2·dt)`), always clamping at the base floor y = 0. It is the first equipment item and needs no research (300 cr, +10 kg) — a recovery tool, not an upgrade gate.
- **Drive-keeper test contrast re-scoped.** At 42 J the ceiling caps every apex inside the target + gain band (the old 36 J apex assertion passed only on rock-scatter estimation noise). The robust contrast is pulses spent: with the helper relaunching held balls (standing in for the keeper's release duty), the keeper switches drive off in the apex band and spends 19 pushes where always-on drive spends 28 over 25 contacts.

## Implementation

- `js/physics.js`: piston pulse 36 → 42 J; ground detection is floor-heightmap aware for ball, debris and cargo contacts.
- `js/ceiling.js`: `floorPiles[192]` + `floorHeight` with the rock stencil via `updateFloor`, `floorAt(x)` interpolation, deposit clamped at the 0.7 m pile limit (excess stays in the falling fragment), `grade()` diffusion + cut, hooked when the grader is installed; `drawFloor` renders the rubble band under the platform; reset clears the arrays; state/api exports for the panel and tests. Landing bookkeeping books `fragmentMechanical` at the fragment's actual position — exact through pile growth.
- `js/equipment.js`: `grader` item first (ungated), wired to `ceiling.grade`.
- `js/prediction.js`, `js/autopilot.js`, `js/main.js`: ground/GROUND reads use `floorAt`; the drive back-out energy uses `2g(deck − floorAt(endX))`; `drawFloor` is drawn after the ground rect and before the pad.
- `js/research.js` / `index.html` / `experiments/interface.test.js`: pulse texts 42 J (drive) and 46 J (electromagnetics effect), hint "three powered bounces from a release reach the ceiling".
- `experiments/harness.cjs`: `buy()` only calls `unlockResearch` when the item declares `requires` (ungated grader).
- Tests: `physics.test.js` 3-bounce pulse and floor-grounded debris; `ceiling.test.js` deposit + cap; `equipment.test.js` grader test (spike 0.7 / 0.2 / 0.45 → cut, spread, then all-zero after 10 s, no below-floor values) and the coil launch pulse expectation 58 J; `autopilot.test.js` drive-keeper pulses-spent contrast plus helper relaunch of held balls in `untilBounces`.
- `experiments/browser-smoke.cjs`: equipment row count 5 → 6, research-gating click targets the rebound-pad row (the grader's first row needs no research).
- Docs: README pulse 42 J / three-bounce note, floor-rubble paragraph, six upgrades with the grader; `0.1.0-plan.md` calibration (24 × 15 m, 3.24 kg, 42 J, six items 2800 cr) and the "three powered contacts" rule; the system-bar header dropped its stale "24 × 10 M" for "24 × 15 M".

## Validation

- `node --test experiments/*.test.js`: 84 tests pass (was 81).
- `node experiments/rock-impulse-check.cjs`: 7,239,828 contact traces, 0 amplifications, 351 rock impulses, 0 stacked, worst unexplained gain 0, shape-switch checks pass.
- Floor probe (60 s mining, no grader): floor sum 2.00 column-m in 6 columns, max 0.375 m; a manual 0.7 m spike stays clamped at 0.7; energy ledger error 0.000000 J through the landings.
- Browser smoke in headless Chromium (recipe above): startup, layout, view modes, drive/tilt/drag, inspector, gating (six equipment rows, grader row first), ledger, autopilot shortcuts pass; no page errors. A settled-rubble screenshot confirms the floor heightmap renders as a bumpy band under the platform and the readouts stay consistent (extracted 526 / caught 55 / lost 471, ledger 0.000000 J).
- `git diff --check`: clean.

## Next step

Falling debris is now a persistent floor hazard with a paid recovery tool. Next, measure whether the grader is economically worth running: instrument a seeded shift with and without the grader (300 cr + 10 kg) and compare balls recovered / trips cleared / sales against the slower acceleration and purchase cost, in `experiments/logs/debris.1-trips.txt`. If the piles never impede play at mining rates, the 0.7 m cap or the grader price may need retuning before adding wear.
