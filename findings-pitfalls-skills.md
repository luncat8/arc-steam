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
- A page-level `world` lives in `main.js`'s scope. A test that captured the world from `physics.step` before clicking New game holds the *old* one, so read balls and bodies only after the run that owns them has stepped once. Symptom: a ball the test placed at 14.75 m is drawn at the deck.
- The pause button's text names the *next* action, so a test must pin the state it needs (`setPaused`) instead of toggling whatever the previous test left. A paused page still draws a freshly marked scene, but it can also still step a ball that was already flying when the pause was pressed: use a held ball, or clear the rock above the sample, before asserting a drawn height.

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

- This headless shell delays page timers by seconds (a `setTimeout(550)` fired about 7 s late)
  and a second, background page can have its animation frames throttled entirely. A gesture with
  a hold threshold must therefore be driven by pointer-down + `waitForFunction` on the resulting
  state, not by `tap({ delay })`, and the second page needs `bringToFront()`.
- `locator.hover()` waits for two identical animation frames before acting, which the second page
  in this single-process shell does not deliver: move a raw `mouse` to the element's
  `boundingBox()` centre instead. Raw mouse coordinates are viewport-relative, so
  `scrollIntoViewIfNeeded()` first — a below-fold box off screen clicks nothing.
- Closing the last page closes the browser. Open a second page before closing the first, and
  give the second page its own `waitForFunction` only after `bringToFront()`.
- `assert.deepEqual`/`assert.equal` on two shim elements in `experiments/dom.cjs` dumps a
  cyclic structure and kills the process with SIGKILL (no error text at all). Compare focus with
  `assert.ok(a === b)`.
- A drawer that slides in on `transform` must switch `visibility` instantly on open and only
  after the slide on close (`transition: transform …, visibility 0s linear 0.22s` for the closed
  state). A symmetric `visibility` transition keeps its buttons unfocusable for the whole slide,
  so `focus()` silently lands nowhere and a tap on the drawer's own close button is rejected as
  "intercepted by the drawer".

## Layout pitfalls

- A side column that must take the chamber's height instead of stretching the row uses `contain: size` plus `overflow-y: auto` in a grid. Turn it on in `min-width` queries, not as a base rule overridden later: a `.workspace > .panel:not(.mine-panel)` base selector outranks a single-class override and collapses the stacked panels to zero height.
- Hover-to-switch is safe only for display state (rock view). The rock shape changes collision physics, so it stays a click-only select: a passing mouse must not change the game.

## Interface pitfalls

- Context help is data in `js/help.js`, rendered into one drawer. A new panel gets `data-topic`
  and a `?` mark with the same topic id; the hold gesture walks up to the nearest `data-topic`,
  so both routes work without extra wiring. The hold must skip anything a press already means
  (buttons, fields, labels, the canvas) and cancel on a 12 px move, otherwise a drag or a
  press-and-hold control opens help instead of doing its job.
- With a hover preview the click on the mark that just opened the drawer must pin the preview,
  not toggle it closed; on touch the same tap must toggle. Gate that on the same
  `matchMedia('(hover: hover) and (pointer: fine)')` result that gates the preview.

- A click on the chamber now has two meanings, so the zones must be visible and must not overlap: rock selects an inspector cell, the low band (the drawn 1.7 m target height) sets travel, and open air does neither. Testing rock by "is any strength left in this column" is not enough — the smooth renderer draws a sloped surface between column vertices, so hit-testing the same linear profile is what makes a crater-edge click land where the player sees rock.
- Before the click-zone change, every chamber click set `world.target`. Any new "click does nothing" assertion must also assert `world.target` is unchanged, not just that the inspector text changed.
- A browser-smoke block that takes a second of wall time gives the running ball time to break rock, so a click on a mined-away cell selects nothing and the "a rock click moves the inspector" assertion fails for the wrong reason. Put new slow checks after the inspector section, not before it.
- The same assertion also fails when earlier below-fold clicks (research/equipment rows) leave the page scrolled so the chamber's top is above the viewport: `chamberClick` computes points from the canvas `boundingBox`, and a rock point up there clicks nothing at all. Symptom: rock state evaluates intact, the inspector text is byte-identical. `scrollIntoViewIfNeeded()` on `#c` before chamber clicks that follow panel clicks.

## Simulation pitfalls

- `SteamCeiling.trace` returns a contact point on the *chord* of the swept parabola (linear in the swept fraction), while `advanceBall` integrates the true parabola. Any predictor must snap to `hit.x`/`hit.y` like the simulation does, or contacts drift by about 3e-5 m and predictions stop matching impacts.
- A rock contact flips the ball downward: the ball hits the *underside* of the layer, so the outward normal points down. Assertions that expect an upward rebound after a rock hit are wrong.
- When changing a simulation rule, keep the pre-change file (`git show HEAD:js/ceiling.js > /tmp/old-ceiling.js`) and run the same probe and the same new test against both. A test that passes on the old code pins nothing; a probe number that is identical before and after means the new branch never fires. This is how "the free face may hold a shattered cell" turned out to be a guard rather than a behaviour change, while the drawn-footprint clamp turned out to be the visible fix.
- `harness.near(actual, expected, tolerance)` has no message parameter. Passing a string as the third argument makes the comparison `0 < NaN`, which fails with a confusing `0 != 0` message.
- Helpers that prepare cargo teleport fragments (`earnFunds` moves debris onto the collector), which destroys potential energy from the page's point of view. Call `sync(world)` after them before asserting `balanced(world)`, otherwise the balance check reports the teleport, not a bug.
- The centre charge pad refills the reserve while the platform stands on it, so a test that wants an empty reserve must move the platform off the pad first (`world.platform.x = 3`). Without that, `step()` immediately books imported energy and a zero-reserve assertion fails at the first step. Tests that mutate `world.battery` directly also need `harness.sync(world)` before checking that the balance error is zero, because the mutation itself is not booked.
- A piston contact can resolve at the very start of a step, so the ball then flies the rest of that step: the post-step `ball.vy` is one `ballGravity · step` below the solver's post-impulse value. Compare `vy + ballGravity · step` against `solvePiston`'s output (the existing ceiling test does the same), or the assertion fails by exactly 0.018 m/s with no obvious cause.
- Braking, wall stops and the speed limiter are three different energy paths. Only controlled braking is recoverable; a wall clamp books its kinetic energy as heat directly, and the limiter needs no separate term because the battery is charged for the clamped kinetic-energy gain only.
- A rig-pushable ball may be caught by a competitor, so the rig's focused ball can legitimately be `null` even though `world.balls` is not empty. Every policy that reads `world.ball.state` needs the null branch, or a chamber where a competitor holds the only shared ball crashes the autopilot.
- Any module that owns one mutable read-out buffer and is called from two loops (the page's readout and the autopilot's plan) must keep one buffer per reader. A shared prediction cache means whichever loop ran last owns the overlay, so a keeper that prices its plan 20 times a second silently rewrites what the player is looking at.

- Sampling a rigid hull against a piecewise-linear ground (another body's plate) must cover the hull's own edges with an exact sample: stepping `for (x = -half; x <= half; x += step)` can leave the last step short, so the leading corner — the part that meets a 45° plate first — is never tested and the hull sinks a few centimetres. Use a whole number of samples over the span and walk it by index.
- The rock layer is collided through `firstRow` (the lowest intact cell per column) but drawn through the smoothed `heightmap` (a `(1,3,3,1)/8` stencil over `firstRow`). Anything placed "at the surface" — a fresh debris lump, a dust puff, a marker — must be clamped against the *drawn* surface, and against the whole footprint it spans, or half of it appears inside the wall beside a shaft.
- A rule about "where rock may let go" is only half the model: a cell can be released legally and still be drawn inside the rock, because the release happens in cell space while the picture is a smoothed curve. Decide both — the cell rule in `damage`/`collapseTick`, the picture rule in `draw`.

- A climb onto a body is not a fall: capping the base rise at the terrain drop rate makes a platform crossing a plate drag its hull through it. Rate-limit the descent (and a rise onto a body that is still above), but let the climb follow the ground under the hull at the platform's own speed; the ball solve's surface-velocity clamp is what keeps that from injecting energy.
- A wheel rigidly bolted to a hull hangs in the air whenever anything else carries that hull — the belly over a deck corner, or a pose still coming down a step. Neither pose rate explains it: an unlimited descent rate changed every measurement by nothing, and 90°/s → 720°/s of pitch slew moved the worst float 0.21 m → 0.19 m. Give the wheel a strut that reaches *down* to the ground within a travel and the float goes to zero without touching the pose the ball rides. Do not try to solve it by deepening the belly arch: the depth a 0.6 m corner needs along a 3.2 m wheelbase is more than the hull has left to draw.
- A rate-limited mechanism has to be triggered on the closing speed, not on a fixed distance. A plate that needs 0.5 s to swing is late for anything arriving faster than the reach divided by 0.5 s, and the hull then climbs a half-folded face and pops up higher than the deck it was riding onto. Size the reach from the approach speed, and add the swing again because a hull under drive is still accelerating over that distance.
- Compare the same edges on both bodies. A fold threshold written as "the other hull's centre has passed my plate's tip" is one half-width early, so the plate shuts under the wheel still standing on it.

## Autopilot pitfalls

- A measurement script that steps `physics` and the autopilot but not `players.update` has no competitors in it: a rival's policy never runs, so a rival holding a ball never releases it and the script reports a stall that does not exist. Anything that reads a shared chamber needs every keeper in the loop. If the run is *meant* to be one platform (the trips and wall-stint probes), init zero rivals (`players.init(world, 0)`) instead: an unstepped parked rival still catches a shared ball on its deck, and its release is driven by a policy that never runs.
- A keeper that bounds the passive apex at the ceiling line leaves feather-touch strikes once the working face recedes towards it: the ball arrives with vn ≈ √(2·g·(line − face)) → 0 and the rock damage quadratic gets nothing. Bound the passive apex one pulse above the line instead (`line + pulse/(m·g)`), machine-relative, and the strike stays real exactly where the face is highest.
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

- A selected bot is still a bot. Selection changes which machine receives hand input; it must not silently suppress that machine's automatic release. Gate the release on the manual window, not on the active-player index.
- Interface tests share one live world. A thermal-cutoff or motion setup must be cleared before a later pulse/shop assertion, and a failed duty test must not leave its switches enabled for the reset test. Prefer explicit scene setup over advancing a few frames and hoping the 100 ms readout cadence lands inside the window.
- Floor smoothing must transport value with height. Rebuilding only the height profile changes ore density even when the blade's own cut is priced correctly; use a second preallocated value buffer and move each edge's height/value share together.
- A pile's *height* and its *material* are different quantities: `floorPiles` is metres and `floorValues` is credits, while the layer thickness (`floorCellHeight`) is only how a metre is drawn. A debris-compression setting must move the thickness and nothing else, or a view change silently creates or destroys ore. Piles are also not re-cut when the setting changes — a half-cut column stays half-cut, it just draws taller.
- `floorAt` reads the smoothed `floorHeight` profile, which only `updateFloor` (called from `drawFloor` and the floor mutations) rewrites. A test that fills `floorPiles` by hand gets 0 from `floorAt` until the draw pass runs.
- `harvest` limits by whole cells of capacity per column, so a 4-cell hopper over 2-cell columns takes two columns completely, not four partially.
- Mineral membership from a product of per-channel tails does not blend wide and narrow ranges: one broad box with a single channel just outside beats a nearby narrow box by orders of magnitude, so whole regions become one mineral. Sum the normalised channel distances before the exponential kernel; that keeps the geometry descriptive and makes a narrow range genuinely rare.
- Calibrating ore prices on the mean value of the whole field overpays the plan and underfunds the player: the free face the platform can actually mine is a biased sample of the field. Measure a normal sold load (60–100 cells) and set the target cell value from that, not from the field average.
