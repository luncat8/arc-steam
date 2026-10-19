# Arc Steam

A side-view energy-driven mining simulation. The current prototype combines a passive ball, a force-limited platform, collector/reflector regions, limited bounce pulses, explicit energy accounting, a two-dimensional mineral rock field with a smooth heightmap surface (or optional square cells), falling debris, mass-bearing cargo, wall markets, thermal management, a prerequisite technology tree, purchasable equipment gated by research, a researched ballistic computer overlay, and a credit-funded reserve recharge that closes the mine–collect–sell–upgrade loop. Wear, crew experience, and later energy eras remain open milestones.

## Run

Open `index.html` directly in a modern browser. No build, server, dependencies, or internet connection is required.

Optional local HTTP preview:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

## Layout

On wide screens the page is four rows: a system bar (clock, pause, speed, New game, rock shape), the telemetry strip, the play row (technology research | chamber | platform controls | mineral inspector), and the economy row (equipment | cargo | market). The chamber sets the play row's height and the side columns scroll inside it. Below 1280 px research and the inspector move under the chamber; below 760 px every panel stacks.

## Controls

| Input | Action |
| --- | --- |
| A / D, or hold arrow buttons | Apply engine/brake force left/right; releasing coasts |
| W / S, or force slider | Adjust movement force |
| Space / Q, or drive button | Toggle bounce drive without activating focused GUI controls |
| Click chamber | Set horizontal travel target; manual movement overrides |
| E, or release button | Release a held ball when drive is enabled |
| Rock shape selector (system bar) | Choose smooth heightmap (default) or square cells |
| Rock view switch (under the chamber) | Show minerals, elemental R/G/B, price, or remaining strength; click, arrow keys, or hover with a mouse |
| Inspector sliders, or click rock | Select a rock cell by column and layer; read strength, minerals, price |
| Technology panel | Research a node once its prerequisites are complete and funds cover it |
| Recharge button | Buy reserve energy back at 25 cr/kJ up to the full 12 kJ |
| Pause / speed / New game | Inspect or restart the experiment from a fresh world, research and equipment |

Ground impact loses all ball energy. Move the platform over a grounded ball to recover it. The amber collector catches and holds balls and mineral debris; the green reflector bounces balls. Release transfers a stored ball onto the reflector and pays for lifting it. A 36 J pulse at 80% efficiency debits up to 45 J from the shared reserve.

The ball now follows a 1.5× slower flight cycle while preserving the same energy budget and bounce heights: its effective inertia is 2.25 kg and its ball-specific gravity is 9.81 / 2.25 m/s², so free-flight speed at a given height is two-thirds of the earlier tuning and flight time is 1.5× longer. Debris still falls at 9.81 m/s². Platform drive response has taken a second 1.5× step: force is 400 N (270 N before, 180 N originally) and the top speed is 10 m/s (7 m/s before), each rounded to a whole number. The stronger drive roughly tripled the scripted policy's average draw to about 219 W, so a 12 kJ reserve now lasts about a minute of aggressive travel and recharging it is part of normal play.

The rock layer is a seeded 192 × 16 two-dimensional field. Its 0.125 m cells project to approximately 4 × 4 px at the reference scale. By default, the exposed rock boundary is rendered and collided as a smooth heightmap polyline so the ball reflects at continuous slope angles; an optional square-cell mode collides against exposed faces and rounded corners. Rock reflection keeps the ball's impulse: each contact applies at most one reflection impulse per step (never amplifying speed), and a ball that overlaps solid rock — for example right after switching rock shape — is separated back to contact distance instead of flying through at full speed. Impact loss applies 2× hit-point strength removal falling linearly to zero over a 4.5-cell (1.5×) radius. All failed and detached cells become falling 0.6 kg fragments with no pool-exhaustion losses.

Storage holds 100 cells. A full 60 kg load equals the dry platform mass, reducing acceleration and participating in capture momentum, braking, and kinetic-energy accounting. Touch either wall marked **SELL** to sell the entire load automatically. The market panel breaks cargo and lifetime sales down by mineral (Fe/Cu/Cr) and records each wall sale in a ledger with time, mass, mix, and credits. Purchases, research and recharges debit the same funds ledger. The market panel also sells energy back into the reserve at 25 cr/kJ up to the 12 kJ capacity, buying only what the current funds cover; imported energy is tracked as `importedEnergy` and subtracted from the balance, mirroring the exported terms, so trading in either direction keeps the ledger exact. The telemetry strip is a full-width row under the system bar, reporting the reserve, cargo, total moving platform mass, funds, ball energy, stored thermal energy and temperature, and an energy balance that includes attached rock, debris, cargo, exported material, and imported fuel.

The equipment panel sells five upgrades against measured trip income: a rebound pad (+3% normal-energy retention), a drive coil (+12 J bounce pulse), a lightweight chassis (−12 kg dry mass), a radiator array (+0.35 m² exposed cooling area, +8 kg), and a brake flywheel (returns 55% of braking energy to the reserve at 90% round-trip efficiency, +14 kg). Every item names the research node that unlocks it, so purchases are refused without funds, without the prerequisite research, or when already installed. Installed items add explicit deltas on top of base tuning, and installation mass changes preserve the energy ledger. An installed-specification table shows the live dry mass, engine force, top speed, bounce pulse, retention, convective cooling, and brake recovery that all research and equipment deltas currently produce, which is what each row's stated effect compares against.

The technology panel is a six-node tree with explicit prerequisites and locked / available / researched states: rebound materials (+1% retention, 180 cr), light alloys (−4 kg dry mass, 240 cr), pulse electromagnetics (+4 J pulse, 300 cr, needs rebound materials), heat transfer (+0.5 W/K convective cooling, 340 cr, needs light alloys), flywheel storage (460 cr, needs heat transfer, unlocks the brake flywheel), and ballistic computer (520 cr, needs pulse electromagnetics, unlocks the trajectory overlay). Each node changes a measured simulation quantity rather than acting as a label, and research mass changes couple to the moving platform exactly like equipment installations. One scripted shift grosses roughly 330–620 cr, so the tree is a multi-shift investment; the measured calibration lives in `experiments/logs/0.1.8-mine-trips.txt`.

Researching the ballistic computer draws the predicted flight path over the chamber: a dotted passive trajectory that follows wall and ceiling reflections with the simulation's own gravity and retention, a landing mark, and a platform ghost coasting to the predicted landing time. The path stops at the first rock contact or at the three-second horizon and is flagged uncertain rather than promising a rebound through damaged rock, and the status line reports whether the intercept is reachable at full thrust or how many metres short it falls. Prediction reads the world without mutating it and allocates nothing per call, so it runs from the readout cadence into preallocated buffers.

The platform is asymmetric: only the right-hand reflector bounces, so the left wall has a pocket that the collector docks into so the reflector can cover the wall all the way to `x = 0`. Docking trades catching (the hidden collector cannot catch) for full wall coverage when bouncing. To catch debris near the wall, undock so the collector is exposed.

Passive deck/rock impacts retain 90% of normal kinetic energy. Platform/ball horizontal contact friction exchanges momentum and energy, and capture/release carries platform velocity. Side walls are ideal elastic boundaries for the ball. Stored thermal energy maps to temperature using a 300 J/K machinery heat capacity above 20 °C. The model removes heat through convection and Stefan–Boltzmann radiation and tracks cooling as exported energy in the balance. Powered movement and bounce output derate linearly from 85 °C to a 135 °C cutoff; braking remains available. The radiator array adds real exposed area to both cooling paths.

`SteamCeiling.state` is a stable live view: inspect scalar values as properties (`SteamCeiling.state.funds`, `.cargoMass`, `.airborneCells`) without creating snapshot objects or calling query-like methods. Commands such as `damage`, `sellCargo`, `purchase`, `recharge`, `setShape`, and `reset` remain methods; simulation buffers are exposed as typed arrays for inspection and deterministic tests.

## Validate

```sh
node --test experiments/*.test.js
node --check js/main.js
```

The suite covers the rock field, physics accounting, equipment, research, prediction, the recharge economy, and an interface run that boots the real `index.html` wiring against the small DOM shim in `experiments/dom.cjs`, so panels, gating, shortcuts, and the overlay are exercised without a browser.

Optional browser smoke test (requires an externally installed Playwright and a Chromium; nothing is added to the repository):

```sh
node experiments/browser-smoke.cjs
```

Without a system browser, `playwright-core` plus `@sparticuz/chromium` from npm work; see `findings-pitfalls-skills.md` for the exact recipe.

Set `PLAYWRIGHT_PATH` to an installed Playwright package if it is not resolvable normally. Set `TEST_URL` to test an HTTP URL instead of the default `file://` page. `CHROMIUM_PACKAGE` optionally identifies a serverless Chromium module providing `executablePath()` and `args`.

See `0.1.0-plan.md` for the standalone design and delivery plan, and `archive/` for validation/work logs.
