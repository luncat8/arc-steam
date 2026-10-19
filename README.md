# Arc Steam

A side-view energy-driven mining simulation. The current prototype combines a passive ball, a force-limited platform that rides a smoothed rubble heightmap, collector/reflector regions, a tilting sprung reflector piston, limited bounce pulses (the bounce drive is on by default), explicit energy accounting, a two-dimensional mineral rock field with a smooth heightmap surface (or optional square cells), falling debris, 4:1 floor tiles, a local road grader, mass-bearing cargo, wall markets, thermal management, a prerequisite technology tree, purchasable equipment gated by research, a researched ballistic computer overlay, a centre ground charge pad with an emergency credit resupply, test mode that grants all research and equipment, a four-duty autopilot that intercepts, keeps the drive and levels the bounce, and telemetry warnings that highlight an empty reserve, a full cargo or overheating. Together they close the mine–collect–sell–upgrade loop. Wear, crew experience, and later energy eras remain open milestones.

## Run

Open `index.html` directly in a modern browser. No build, server, dependencies, or internet connection is required.

Optional local HTTP preview:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

## Layout

On wide screens the page is four rows: a system bar (clock, pause, speed, New game, rock shape, Communism and test-mode switches), the telemetry strip, the play row (technology research | chamber | platform controls | mineral inspector), and the economy row (equipment | cargo | market). The chamber sets the play row's height and the side columns scroll inside it. Below 1280 px research and the inspector move under the chamber; below 760 px every panel stacks.

## Controls

| Input | Action |
| --- | --- |
| A / D, or hold arrow buttons | Apply engine/brake force left/right; releasing coasts |
| W / S, or force slider | Adjust movement force |
| Space / Q, or drive button | Toggle bounce drive (on by default) without activating focused GUI controls |
| Mouse wheel over the chamber (about 4° a notch), drag in open air, or piston slider | Tilt the reflector piston from −10° to +10° to steer the bounce: positive raises the right edge and sends a falling ball left, negative sends it right. Drag towards where the ball should go — left or up raises the angle |
| X / shift+X checkboxes or keys | Autopilot intercept: chase the predicted landing and stop there, or spend the whole flight time arriving (rolling through the mark when that is the slower run); one at a time |
| Z checkbox or key | Autopilot drive keeper: pulse only when the passive bounce would no longer reach the ceiling, and release a caught ball |
| C checkbox or key | Autopilot level bounce: slew the tilt at 45°/s inside ±10° so the next reflection leaves straight up |
| Click rock | Inspect the clicked cell by column and layer |
| Click low near the ground | Set horizontal travel target; manual movement overrides |
| E, or release button | Release a held ball when drive is enabled |
| Rock shape selector (system bar) | Choose smooth heightmap (default) or square cells |
| Communism mode switch (system bar) or M | Make everything free: research, equipment and the emergency resupply cost nothing, and the research tree stops gating anything |
| Test mode switch (system bar) | Immediately research every technology and install every equipment item without cost or progression checks |
| Rock view switch (under the chamber) | Show minerals, elemental R/G/B, price, or remaining strength; click, arrow keys, or hover with a mouse |
| Mineral inspector | Reads the clicked cell: location, strength, minerals, price |
| Technology panel | Research a node once its prerequisites are complete and funds cover it |
| Centre charge pad | Park on the centre strip of ground: 3 kW refills the 12 kJ reserve in 4 s |
| Recharge button | Emergency import at 25 cr/kJ up to the full 12 kJ |
| Pause / speed / New game | Inspect or restart the experiment from a fresh world, research and equipment |

Ground impact loses all ball energy. Move the platform over a grounded ball to recover it. The amber collector catches and holds balls and mineral debris; the green reflector bounces balls. Release transfers a stored ball onto the reflector and pays for lifting it. A 42 J pulse at 80% efficiency debits up to 52.5 J from the shared reserve, and the tuning is sized so the third powered bounce from a release reaches the ceiling.

Communism mode is a switch in the system bar, or the `M` key. The commons owns the machinery, so every price in the game drops to zero: research and equipment are free, the emergency resupply is free, and the technology tree stops gating anything — every node and every machine is available on the first click. The prices are the only thing that changes; the measured effects still apply, so a free drive coil still adds 12 J of pulse and a free chassis still cuts 12 kg of dry mass, and the energy ledger stays exact. The panels follow the mode: row titles read `FREE` instead of a price, the funds card reads `commons` (sales are still measured and still recorded), the market shows a free import, and the ledger books each handout as `free` rather than as a credit line. It is a mode rather than world state, so a new game keeps it, and switching it off puts every price and every gate back.

Test mode sits beside Communism mode in the system bar. Enabling it grants every research node and installs every equipment item immediately, bypassing both funds and prerequisites while applying the normal measured effects and mass changes. It is separate from Communism mode: test grants do not spend credits. Switching test mode off does not revoke grants; they remain active until **New game**, and the mode stays selected across that reset.

The reflector is a sprung piston. Its face tilts ±10° around its centre, so reflections and powered pushes leave along the tilted face normal instead of always going straight up; the ballistic computer predicts deck contacts against the same tilted plane. Each contact compresses the piston along its normal in proportion to the normal impact speed (0.024 m per m/s, capped at 0.16 m), and a damped spring (650 N/m, damping 18) extends it again as the visible push, overshooting slightly before it settles in about half a second. Compression is a rendered state only — the collision plane stays at the rest position, so animation never feeds back into the physics.

The autopilot is four checkboxes in the controls panel, each also on a key: `X` chases the predicted landing, `shift`+`X` takes the timed intercept that arrives with the ball instead of rushing and braking, `Z` keeps the drive armed only while the passive bounce would fall short of the ceiling and releases a caught ball, and `C` slews the tilt at 45°/s so the next reflection leaves straight up. A green status line reports one clause per engaged duty, naming the intercept mark and time, the pulse state and the wanted tilt. Every duty yields to the manual command that does the same thing — `A`/`D` or a travel click takes the intercept back, `Space` takes the drive back, and the slider, wheel or drag takes the tilt back — without unticking its checkbox. Held movement and tilt controls keep that duty suspended; it resumes after two seconds of idle simulation time. Travel clicks, wheel/slider adjustments and drive toggles use the same two-second grace period. The status line says “manual override” while suspended. Only the checkbox or autopilot shortcut permanently switches a duty off. The chase centres the reflector face on the landing, the timed intercept brakes recuperatively when the flywheel is installed, and the level bounce respects the piston's slew rate and range. Historical measurements for the previous chamber tuning are in `experiments/logs/autopilot.1-trips.txt`; current-tuning measurements are in `experiments/logs/autopilot.2-trips.txt`.

The chamber is 24 × 15 m (1.5× its previous height), with the existing 2 m rock layer raised to 13–15 m so the extra space is open flight room. The ball is another 1.2× slower: its total flight scale is now 1 / 1.8, effective inertia 3.24 kg and ball-specific gravity 9.81 / 3.24 m/s². Inertia and gravity are scaled together to preserve the energy budget and bounce heights; debris still falls at 9.81 m/s². Platform drive tuning remains 400 N and 10 m/s. A 12 kJ reserve and the centre charge pad make recharging part of normal play.

The rock layer is a seeded 192 × 16 two-dimensional field. Its 0.125 m cells project to approximately 4 × 4 px at the reference scale. By default, the exposed rock boundary is rendered and collided as a smooth heightmap polyline so the ball reflects at continuous slope angles; an optional square-cell mode collides against exposed faces and rounded corners. Rock reflection keeps the ball's impulse: each contact applies at most one reflection impulse per step (never amplifying speed), and a ball that overlaps solid rock — for example right after switching rock shape — is separated back to contact distance instead of flying through at full speed. Impact loss applies 2× hit-point strength removal falling linearly to zero over a 4.5-cell (1.5×) radius. All failed and detached cells become falling 0.6 kg fragments with no pool-exhaustion losses. Fragments that reach the floor build a fallen-debris heightmap with 192 columns and a 0.7 m per-column cap. Each rendered soil tile is 0.125 m wide by 0.03125 m tall (`w:h = 4:1`); the interpolated top profile stays smooth for ball contact and platform travel. The platform follows the ground under its wheels and chassis, pitching gradually to the terrain instead of hovering on a fixed deck. The road grader works a 1.5 m swath ahead of the platform, shaving and smoothing the top while leaving the ground directly under its wheels alone; cuts clamp at the original y = 0 floor, so it never creates pits and the terrain slope remains gentle.

Storage holds 100 cells. A full 60 kg load equals the dry platform mass, reducing acceleration and participating in capture momentum, braking, and kinetic-energy accounting. Touch either wall marked **SELL** to sell the entire load automatically. The market panel breaks cargo and lifetime sales down by mineral (Fe/Cu/Cr) and records each wall sale in a ledger with time, mass, mix, and credits. Purchases, research and recharges debit the same funds ledger. The market panel also sells energy back into the reserve at 25 cr/kJ up to the 12 kJ capacity, buying only what the current funds cover; imported energy is tracked as `importedEnergy` and subtracted from the balance, mirroring the exported terms, so trading in either direction keeps the ledger exact. The telemetry strip is a full-width row under the system bar, reporting the reserve, cargo, total moving platform mass, funds, ball energy, stored thermal energy and temperature, and an energy balance that includes attached rock, debris, cargo, exported material, and imported fuel. Warnings highlight the card that needs attention instead of adding readouts: the reserve card tags `LOW` below 10% and `EMPTY` under 0.5 J, the cargo card tags `FULL` at the 100-cell limit, and the temperature card tags `HOT` while the drive is derated and `CUTOFF` when powered output stops. Each warning note says what to do — park on the pad, sell at a wall, or wait for cooling.

The equipment panel sells six upgrades against measured trip income: a road grader (needs no research, 300 cr, +10 kg, smooths and shaves a swath ahead of the platform), a rebound pad (+3% normal-energy retention), a drive coil (+12 J bounce pulse), a lightweight chassis (−12 kg dry mass), a radiator array (+0.35 m² exposed cooling area, +8 kg), and a brake flywheel (returns 55% of braking energy to the reserve at 90% round-trip efficiency, +14 kg). Every item names the research node that unlocks it — the grader is the one that needs none — so purchases are refused without funds, without the prerequisite research, or when already installed. Installed items add explicit deltas on top of base tuning, and installation mass changes preserve the energy ledger. An installed-specification table shows the live dry mass, engine force, top speed, bounce pulse, retention, convective cooling, and brake recovery that all research and equipment deltas currently produce, which is what each row's stated effect compares against.

The technology panel is a six-node tree with explicit prerequisites and locked / available / researched states: rebound materials (+1% retention, 180 cr), light alloys (−4 kg dry mass, 240 cr), pulse electromagnetics (+4 J pulse, 300 cr, needs rebound materials), heat transfer (+0.5 W/K convective cooling, 340 cr, needs light alloys), flywheel storage (460 cr, needs heat transfer, unlocks the brake flywheel), and ballistic computer (520 cr, needs pulse electromagnetics, unlocks the trajectory overlay). Each node changes a measured simulation quantity rather than acting as a label, and research mass changes couple to the moving platform exactly like equipment installations. One scripted shift grosses roughly 330–620 cr, so the tree is a multi-shift investment; the measured calibration lives in `experiments/logs/0.1.8-mine-trips.txt`.

Researching the ballistic computer draws the predicted flight path over the chamber: a dotted passive trajectory that follows wall and ceiling reflections with the simulation's own gravity and retention, a landing mark, and a platform ghost coasting to the predicted landing time. The path stops at the first rock contact or at a horizon derived from chamber height and ball gravity (about 7.3 seconds at the current tuning, enough for a full up-and-down flight) and is flagged uncertain rather than promising a rebound through damaged rock, and the status line reports whether the intercept is reachable at full thrust or how many metres short it falls. Prediction reads the world without mutating it and allocates nothing per call, so it runs from the readout cadence into preallocated buffers.

The readout cadence only rewrites what changed. Telemetry values (clock, reserve, energies, temperature, motion) update freely, but buttons, status lines, panel notes, specifications, inventory and control state go through change-only writers: an unchanged string, `aria-pressed`/`aria-disabled` value, row state, slider position or disabled flag is never assigned again, so a settled or paused page performs no redundant DOM writes outside telemetry.

Energy no longer has to be bought to be used. A 4 m strip of ground at the chamber centre is a charge pad: while the platform stands still on it (`|vx| < 0.1 m/s`), the installed engine draws 3 kW, filling the 12 kJ reserve in exactly 4 s. The pad is a ground type rather than a consumable or a purchase, so the cost of energy is the trip to the middle and the time spent stopped; the import is booked like a bought recharge so the energy ledger stays exact. The market recharge remains as an emergency resupply at 25 cr/kJ when the platform cannot reach the pad.

Clicking the chamber is split by height, with both zones drawn: clicking visible rock selects the cell under the pointer for the inspector, and clicking the low band (up to the marked 1.7 m target height) commands travel. Open air issues neither command, so inspecting rock never moves the platform. The mineral inspector has no coordinate sliders — the clicked cell's column and layer are reported alongside its strength, mineral mix, price and elemental composition.

The platform is asymmetric: only the right-hand reflector bounces, so the left wall has a pocket that the collector docks into so the reflector can cover the wall all the way to `x = 0`. Docking trades catching (the hidden collector cannot catch) for full wall coverage when bouncing. To catch debris near the wall, undock so the collector is exposed.

Passive deck/rock impacts retain 90% of normal kinetic energy. Platform/ball horizontal contact friction exchanges momentum and energy, and capture/release carries platform velocity. Side walls are ideal elastic boundaries for the ball. Stored thermal energy maps to temperature using a 300 J/K machinery heat capacity above 20 °C. The model removes heat through convection and Stefan–Boltzmann radiation and tracks cooling as exported energy in the balance. Powered movement and bounce output derate linearly from 85 °C to a 135 °C cutoff; braking remains available. The radiator array adds real exposed area to both cooling paths.

`SteamCeiling.state` is a stable live view: inspect scalar values as properties (`SteamCeiling.state.funds`, `.cargoMass`, `.airborneCells`) without creating snapshot objects or calling query-like methods. Commands such as `damage`, `sellCargo`, `purchase`, `recharge`, `setShape`, and `reset` remain methods; simulation buffers are exposed as typed arrays for inspection and deterministic tests.

## Validate

```sh
node --test experiments/*.test.js
node --check js/main.js
```

The suite covers the rock and 4:1 floor cells, rubble grading and terrain-following platform contacts, physics accounting, equipment and research (including cost-free all-grants), prediction, the recharge economy, the autopilot policy (intercept accuracy, timed-versus-chase cost, drive-keeper band, level-bounce verticality and slew limits), Communism mode (free research, free equipment, free energy, the waived gates and the switch itself), and an interface run that boots the real `index.html` wiring against the small DOM shim in `experiments/dom.cjs`, so panels, test-mode grants, gating, shortcuts, and the overlay are exercised without a browser.

Optional browser smoke test (requires an externally installed Playwright and a Chromium; nothing is added to the repository):

```sh
node experiments/browser-smoke.cjs
```

Without a system browser, `playwright-core` plus `@sparticuz/chromium` from npm work; see `findings-pitfalls-skills.md` for the exact recipe.

Set `PLAYWRIGHT_PATH` to an installed Playwright package if it is not resolvable normally. Set `TEST_URL` to test an HTTP URL instead of the default `file://` page. `CHROMIUM_PACKAGE` optionally identifies a serverless Chromium module providing `executablePath()` and `args`.

See `0.1.0-plan.md` for the standalone design and delivery plan, and `archive/` for validation/work logs.
