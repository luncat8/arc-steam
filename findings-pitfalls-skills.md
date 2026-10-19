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
