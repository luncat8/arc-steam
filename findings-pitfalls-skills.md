# Findings, pitfalls, skills

Notes for agents working in this repository. Keep entries short and about *why*.

## Testing a `file://` page without a browser

No Playwright or browser binary is available in these sandboxes, so `experiments/browser-smoke.cjs` never runs here. `experiments/dom.cjs` covers the gap:

- Build fake elements by scanning the real `index.html` for `id="..."`, so a renamed or removed id fails the test instead of silently passing.
- Set `globalThis.window = globalThis` after installing the shim; the page scripts then resolve both `window.SteamCeiling` and bare `SteamCeiling`.
- Capture `requestAnimationFrame` instead of calling it, and drive frames by hand with increasing timestamps. `readout()` is throttled to 100 ms of frame time, so 8 frames per assertion is enough to see DOM updates.
- A recording 2D context (push command names into an array) is enough to assert that an overlay was drawn: `setLineDash` present means the dotted path ran.
- Capture the page's private `world` by wrapping `physics.step` before requiring `js/main.js`; the page looks the method up at call time. That seam lets a test fund the page from real cargo sales instead of poking balances.
- Form controls stringify: a shim `value` setter must do `String(next)` or assertions against `'70'` fail against `70`.

## Simulation pitfalls

- `SteamCeiling.trace` returns a contact point on the *chord* of the swept parabola (linear in the swept fraction), while `advanceBall` integrates the true parabola. Any predictor must snap to `hit.x`/`hit.y` like the simulation does, or contacts drift by about 3e-5 m and predictions stop matching impacts.
- A rock contact flips the ball downward: the ball hits the *underside* of the layer, so the outward normal points down. Assertions that expect an upward rebound after a rock hit are wrong.
- `harness.near(actual, expected, tolerance)` has no message parameter. Passing a string as the third argument makes the comparison `0 < NaN`, which fails with a confusing `0 != 0` message.
- Helpers that prepare cargo teleport fragments (`earnFunds` moves debris onto the collector), which destroys potential energy from the page's point of view. Call `sync(world)` after them before asserting `balanced(world)`, otherwise the balance check reports the teleport, not a bug.
- Braking, wall stops and the speed limiter are three different energy paths. Only controlled braking is recoverable; a wall clamp books its kinetic energy as heat directly, and the limiter needs no separate term because the battery is charged for the clamped kinetic-energy gain only.

## Architecture notes that held up

- Cached bounds over the exposed typed arrays are unsafe: tests and tools legitimately mark `state.active` slots from outside, and a stale bound silently hides fragments from the step loop, the energy term and the renderer. Scanning the full pool costs about 4 µs per step, which is cheap insurance.
- One `installed(channel)` aggregator over equipment and research deltas keeps both systems additive without duplicating getters, and each module only declares the channels it actually changes.
- Purchases, research and recharges all go through `SteamCeiling.purchase`/`recharge`, so the ledger stays the single money trail; only the entry `type` differs.

## Repository conventions that matter

- `git push` may report "Invalid username or token"; that is expected here and the change is applied manually.
- Worklogs live in `archive/`, one per milestone, ending with a next-step suggestion. `0.1.0-plan.md` is the standalone design artifact, not a log: update its calibration and rules so a fork could reimplement from it alone.
- Measurement scripts stay out of `node --test` by using a `.cjs` extension (`mine-trips.cjs`, `dom.cjs`, `harness.cjs`), and useful output is kept under `experiments/logs/`.
