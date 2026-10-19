# autopilot.1 — Inverted tilt drag, faster wheel, and the four-duty autopilot

Source: the user's three requests (drag inversion, 2× wheel, autopilot checkboxes `x`/`X`/`z`/`c`) and `draft.txt`'s autopilot note; design rationale lives in `autopilot.1-plan.md`.

## Review of the previous step

- The open-air piston drag was inverted relative to the reflection it produces: a positive angle sends a falling ball left, but dragging left *lowered* the angle, so the ball went the other way from the pointer. Fixed to `angle − (Δx + Δy) · 0.05`, so left or up raises the angle and the bounce follows the drag.
- The chamber wheel stepped about 2° per notch; the request was 2×, so the wheel now uses 0.04 °·s/notch (about 4° per standard notch, still clamped to ±100 of `deltaY`).
- `SteamPrediction` reported *where* a flight ends but not *how fast* it arrives or *which face* meets it, so nothing outside the renderer could price a contact. Added `endVx`/`endVy`/`surface` to the frozen state, with the surface reset when a rock hit overrides an earlier deck contact in the same march step.
- The piston contact solve was inlined in `physics.step`, so the simulation was the only consumer that knew what a tilted contact does to the ball. Extracted it as `physics.solvePiston(world, vx, vy, angle, push, out)` with a reusable `contactResult()` scratch; `step` now resolves its type-6 contacts through the same call, and a new physics test steps the real simulation against the exported solver to prove the two agree to 1e-12.
- The two-pass energy booking of the powered piston contact (solve, book the contact heat, price the pulse at the post-impact temperature, re-solve) is what keeps the ledger exact; it survived the extraction unchanged and still balances at ~1e-9.

## Decisions

- Four duties, four checkboxes, four shortcuts, one writer each: `X` chase, `shift`+`X` timed intercept, `Z` drive keeper, `C` level bounce. The checkboxes sit under a new AUTOPILOT eyebrow in the controls panel; `#autopilot-status` reports one clause per engaged duty and hides when nothing is engaged.
- Each duty yields to the manual command that does the same job (`A`/`D` and travel clicks take the intercept, `Space`/`Q` and the drive button take the pulse, slider/wheel/drag take the tilt), which is the whole override model: the autopilot never fights the hand.
- The timed intercept is a stop-run law over the predicted flight time, not a chase: rolling through the mark is allowed below 0.5 m/s, and the speed deadband is 0.08 m/s with recuperation installed versus 0.3 m/s without, so a flywheel shifts the policy from coasting to prompt recuperative braking.
- The drive keeper prices the next contact with the exported solver and holds the apex within one pulse of the ceiling line; the level bounce bisects ±10° for a vertical rebound and walks there at `pistonSlewRate` (45°/s), a new config constant, through the single angle writer.
- No allocation per autopilot step: one lazily created solver scratch, no closures or strings in the loop; the panel text is built only in the 10 Hz readout through the existing change-only writers.

## Implementation

- `js/autopilot.js` (new): the policy module and `SteamAutopilot` global with `module.exports` guard; `state`, `enabled`, `set`, `toggle`, `disengage`, `reset`, `update`, `channels`; replan at 20 Hz, travel/drive/tilt commands as described in the plan.
- `js/physics.js`: `solvePiston` + `contactResult` exports, `pistonSlewRate` in config, `step`'s piston branch rewritten onto the shared solver.
- `js/prediction.js`: `endVx`, `endVy`, `surface` on the frozen state and a `surfaces` export; the rock branch resets the surface.
- `js/main.js`: `autopilotRows`, `syncAutopilot`, `setChannel`, `toggleChannel`, `disengage`, `channelForKey`, `autopilotChanged`, `autopilotText`/`autopilotReadout`; disengage hooks in `updateDirection`, the low-band click, `toggleDrive` and `setPistonAngle`; `autopilot.update` before `physics.step` in the frame loop; `autopilot.reset()` on New game; wheel rate and inverted drag.
- `index.html` / `styles.css`: the script tag before `main.js`, the AUTOPILOT checkbox block and status line, and the `.autopilot` row styling with `:has(:checked)` state colour.
- `experiments/`: `autopilot.test.js` (7 tests: intercept accuracy, timed-versus-chase cost, rolling arrival, keeper band, level-bounce verticality and slew, unreachable-mark fallback, disengaged silence); `autopilot-trips.cjs` measurement script and `experiments/logs/autopilot.1-trips.txt`; new surface/velocity assertions in `prediction.test.js`; the exported-solver-versus-step test in `physics.test.js`; autopilot switch/shortcut/override assertions in `interface.test.js`; `browser-smoke.cjs` gained the inverted-drag drag test, the 4° wheel expectation and a real-browser autopilot section.

## Validation

- `node --test experiments/*.test.js`: 77/77 pass (physics 26, prediction 8, interface 14, autopilot 7, plus the unchanged equipment/economy/ceiling/research suites).
- `node experiments/browser-smoke.cjs` under real headless Chromium (recipe in `findings-pitfalls-skills.md`; the NSS libraries come from the package's own `al2023.tar.br`): PASS with no page errors, including the new drag inversion, wheel rate and autopilot sections.
- Screenshots of the controls panel and the full page at 1440 and 390 px with three duties engaged: rows align, the status line reads e.g. `Timed intercept · 13.3 m in 0.34 s · Drive keeper · pulse armed · Level bounce · tilt to 5.7°`, and no horizontal overflow.
- `node experiments/autopilot-trips.cjs`: the measured table behind the plan's claims — timed intercept about half the chase's draw (6182 J vs 13057 J), flywheel 5277 J (150.8 J/bounce), keeper apex 13.1–13.7 m against the 9.82 m ceiling line, level bounce mean horizontal 0.00–0.14 m/s, energy balance ≤ 2e-9 in every run.
- Known and accepted: 2–7 groundings per shift on this seed come from sloped rock rebounds the platform cannot reach at the current force setting; the prediction status reports the shortfall instead of hiding it.

## Next step

Make the interception debris-aware and pay for it in wear: aim the *collector* under predicted fragment falls when their value beats keeping the bounce, and add the wear model (load, impacts, braking, temperature) so the autopilot's economy includes maintenance instead of only joules. The timed intercept's rolling arrival is the natural place to pick up a fragment on the way through the mark.
