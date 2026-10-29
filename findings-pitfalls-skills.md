# Findings, pitfalls, skills

Notes for agents working in this repository. Keep entries short and about *why*.

## Testing a `file://` page without a browser

`experiments/dom.cjs` is the fast, always-available interface test:

- Build fake elements by scanning the real `index.html` for `id="..."`, so a renamed or removed id fails the test instead of silently passing.
- Set `globalThis.window = globalThis` after installing the shim; the page scripts then resolve both `window.SteamCeiling` and bare `SteamCeiling`.
- Capture `requestAnimationFrame` instead of calling it, and drive frames by hand with increasing timestamps. `readout()` is throttled to 100 ms of frame time, so 8 frames per assertion is enough to see DOM updates.
- A recording 2D context (push command names into an array) is enough to assert that an overlay was drawn: `setLineDash` present means the dotted path ran.
- Capture the page's private `world` by wrapping `physics.step` before requiring `js/main.js`; the page looks the method up at call time. That seam lets a test fund the page from real cargo sales instead of poking balances.
- Form controls stringify: a shim `value` setter must do `String(next)` or assertions against `'70'` fail against `70`.

- The shim cannot see real browser behaviour. It let a test "click" disabled buttons for two milestones; in a real browser a disabled `<button>` swallows the click, so refusal messages never showed. Keep `browser-smoke.cjs` running when a browser is available.

## Running a real Chromium in the sandbox

No system browser exists and the Playwright CDN is blocked, but npm is reachable. Install outside the repository:

```sh
mkdir -p /tmp/pw && cd /tmp/pw && npm init -y && npm i playwright-core@1 @sparticuz/chromium
# the binary needs NSS/NSPR; the package ships them in al2023.tar.br
mkdir -p /tmp/al && cd /tmp/al && node -e "const z=require('zlib'),fs=require('fs');fs.writeFileSync('a.tar',z.brotliDecompressSync(fs.readFileSync('/tmp/pw/node_modules/@sparticuz/chromium/bin/al2023.tar.br')))" && tar xf a.tar
cd /home/user/arc-steam && LD_LIBRARY_PATH=/tmp/al/lib PLAYWRIGHT_PATH=/tmp/pw/node_modules/playwright-core \
	CHROMIUM_PACKAGE=/tmp/pw/node_modules/@sparticuz/chromium/build/index.js node experiments/browser-smoke.cjs
```

- Its launch args force `(hover: hover) and (pointer: fine)`; a page opened with `{ hasTouch: true, isMobile: true }` reports touch instead, which is how the smoke test checks hover gating.
- Playwright counts `aria-disabled="true"` as not enabled; `click({ force: true })` still delivers a real click.
- `page.screenshot({ fullPage: true })` at 1920, 1440, 1100 and 390 px widths is the quickest layout review.

## Layout pitfalls

- A side column that must take the chamber's height instead of stretching the row uses `contain: size` plus `overflow-y: auto` in a grid. Turn it on in `min-width` queries, not as a base rule overridden later: a `.workspace > .panel:not(.mine-panel)` base selector outranks a single-class override and collapses the stacked panels to zero height.
- Hover-to-switch is safe only for display state (rock view). The rock shape changes collision physics, so it stays a click-only select: a passing mouse must not change the game.

## Interface pitfalls

- A click on the chamber now has two meanings, so the zones must be visible and must not overlap: rock selects an inspector cell, the low band (the drawn 1.7 m target height) sets travel, and open air does neither. Testing rock by "is any strength left in this column" is not enough — the smooth renderer draws a sloped surface between column vertices, so hit-testing the same linear profile is what makes a crater-edge click land where the player sees rock.
- Before the click-zone change, every chamber click set `world.target`. Any new "click does nothing" assertion must also assert `world.target` is unchanged, not just that the inspector text changed.
- A browser-smoke block that takes a second of wall time gives the running ball time to break rock, so a click on a mined-away cell selects nothing and the "a rock click moves the inspector" assertion fails for the wrong reason. Put new slow checks after the inspector section, not before it.
- The same assertion also fails when earlier below-fold clicks (research/equipment rows) leave the page scrolled so the chamber's top is above the viewport: `chamberClick` computes points from the canvas `boundingBox`, and a rock point up there clicks nothing at all. Symptom: rock state evaluates intact, the inspector text is byte-identical. `scrollIntoViewIfNeeded()` on `#c` before chamber clicks that follow panel clicks.

## Simulation pitfalls

- `SteamCeiling.trace` returns a contact point on the *chord* of the swept parabola (linear in the swept fraction), while `advanceBall` integrates the true parabola. Any predictor must snap to `hit.x`/`hit.y` like the simulation does, or contacts drift by about 3e-5 m and predictions stop matching impacts.
- A rock contact flips the ball downward: the ball hits the *underside* of the layer, so the outward normal points down. Assertions that expect an upward rebound after a rock hit are wrong.
- `harness.near(actual, expected, tolerance)` has no message parameter. Passing a string as the third argument makes the comparison `0 < NaN`, which fails with a confusing `0 != 0` message.
- Helpers that prepare cargo teleport fragments (`earnFunds` moves debris onto the collector), which destroys potential energy from the page's point of view. Call `sync(world)` after them before asserting `balanced(world)`, otherwise the balance check reports the teleport, not a bug.
- The centre charge pad refills the reserve while the platform stands on it, so a test that wants an empty reserve must move the platform off the pad first (`world.platform.x = 3`). Without that, `step()` immediately books imported energy and a zero-reserve assertion fails at the first step. Tests that mutate `world.battery` directly also need `harness.sync(world)` before checking that the balance error is zero, because the mutation itself is not booked.
- A piston contact can resolve at the very start of a step, so the ball then flies the rest of that step: the post-step `ball.vy` is one `ballGravity · step` below the solver's post-impulse value. Compare `vy + ballGravity · step` against `solvePiston`'s output (the existing ceiling test does the same), or the assertion fails by exactly 0.018 m/s with no obvious cause.
- Braking, wall stops and the speed limiter are three different energy paths. Only controlled braking is recoverable; a wall clamp books its kinetic energy as heat directly, and the limiter needs no separate term because the battery is charged for the clamped kinetic-energy gain only.

## Autopilot pitfalls

- Measurement scripts must not hand-launch the ball while the drive channel is engaged: `commandDrive` releases a held ball itself, and a script that launches for it hides a missing call as a mysteriously parked ball (`held=108s` in the trips log).
- Re-arming a flight in a test without `autopilot.reset()` keeps the cached plan (plans live 1/20 s), so `state.contactIn` reads about zero and the intercept assertions fail on stale numbers rather than on the policy.
- Assigning `world.platform.vx` directly in a test breaks the energy ledger unless `harness.sync(world)` follows; the same holds for any direct `world.battery` mutation.
- Braking cost scales with peak speed (`0.5·m·v²` dumped as heat), not with distance travelled. Any policy comparison that measures only metres will rank rush-and-brake as cheap; compare joules.
- The tilt bisection stops at `range / 2^12` (about 0.005°), so a brute-force scan of the range can beat it by about 3e-4 m/s. Assertions that claim optimality need a tolerance around 2e-3, not 1e-9.
- Sloped rock rebounds throw the ball about 3 m in under a second, which the platform cannot reach at the 0.6 force setting: groundings in trip logs are physics, not a controller bug. Check the prediction status shortfall before debugging the intercept.
- Playwright's `check()` can fail actionability on a checkbox inside a `contain: size` scroll column at narrow viewports; `scrollIntoViewIfNeeded()` first makes it deterministic.

## Architecture notes that held up

- Cached bounds over the exposed typed arrays are unsafe: tests and tools legitimately mark `state.active` slots from outside, and a stale bound silently hides fragments from the step loop, the energy term and the renderer. Scanning the full pool costs about 4 µs per step, which is cheap insurance.
- One `installed(channel)` aggregator over equipment and research deltas keeps both systems additive without duplicating getters, and each module only declares the channels it actually changes. A new channel needs all four wirings per module that carries it (accumulator, `state` getter, `apply`, `reset`); a missing getter makes `installed()` silently read 0, so the upgrade buys a label. The engine.1 tier test asserts `forceNow()`/`speedNow()` after each purchase for exactly this reason.
- Purchases, research and recharges all go through `SteamCeiling.purchase`/`recharge`, so the ledger stays the single money trail; only the entry `type` differs.
- A mode that only changes prices belongs in the economy, not in a new module. One flag behind `purchase`/`recharge` makes research, equipment and bought energy free at once, and `research.status` / `equipment.isUnlocked` can ask the economy for the gate instead of knowing how the mode works. One source of truth for "what does this cost now" beats a second pricing path.

## Repository conventions that matter

- `git push` may report "Invalid username or token"; that is expected here and the change is applied manually.
- Worklogs live in `archive/`, one per milestone, ending with a next-step suggestion. `0.1.0-plan.md` is the standalone design artifact, not a log: update its calibration and rules so a fork could reimplement from it alone.
- Measurement scripts stay out of `node --test` by using a `.cjs` extension (`mine-trips.cjs`, `dom.cjs`, `harness.cjs`), and useful output is kept under `experiments/logs/`.
