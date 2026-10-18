# Arc Steam

A side-view energy-driven mining simulation. The current prototype combines a passive ball, a horizontally driven platform, collector/reflector regions, limited bounce pulses, explicit energy accounting, a two-dimensional mineral rock field with a smooth heightmap surface (or optional square cells), falling debris, mass-bearing cargo, and wall markets. Temperature/cooling, wear, equipment purchasing, and progression remain later milestones.

## Run

Open `index.html` directly in a modern browser. No build, server, dependencies, or internet connection is required.

Optional local HTTP preview:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

## Controls

| Input | Action |
| --- | --- |
| A / D, or hold arrow buttons | Apply engine/brake force left/right; releasing coasts |
| W / S, or force slider | Adjust movement force |
| Space / Q, or drive button | Toggle bounce drive without activating focused GUI controls |
| Click chamber | Set horizontal travel target; manual movement overrides |
| E, or release button | Release a held ball when drive is enabled |
| Rock shape selector | Choose smooth heightmap (default) or square cells |
| Rock view selector | Show minerals, elemental R/G/B, price, or remaining strength |
| Inspector sliders, or click rock | Select a rock cell by column and layer; read strength, minerals, price |
| Pause / speed / reset | Inspect or restart the experiment |

Ground impact loses all ball energy. Move the platform over a grounded ball to recover it. The amber collector catches and holds balls and mineral debris; the green reflector bounces balls. Release transfers a stored ball onto the reflector and pays for lifting it. A 36 J pulse at 80% efficiency debits up to 45 J from the shared reserve.

The rock layer is a seeded 192 × 16 two-dimensional field. Its 0.125 m cells project to approximately 4 × 4 px at the reference scale. By default, the exposed rock boundary is rendered and collided as a smooth heightmap polyline so the ball reflects at continuous slope angles; an optional square-cell mode collides against exposed faces and rounded corners. Rock reflection keeps the ball's impulse: each contact applies at most one reflection impulse per step (never amplifying speed), and a ball that overlaps solid rock — for example right after switching rock shape — is separated back to contact distance instead of flying through at full speed. Impact loss applies 2× hit-point strength removal falling linearly to zero over a 4.5-cell (1.5×) radius. All failed and detached cells become falling 0.6 kg fragments with no pool-exhaustion losses.

Storage holds 100 cells. A full 60 kg load equals the dry platform mass, reducing acceleration and participating in capture momentum, braking, and kinetic-energy accounting. Touch either wall marked **SELL** to sell the entire load automatically. The market panel breaks cargo and lifetime sales down by mineral (Fe/Cu/Cr) and records each wall sale in a ledger with time, mass, mix, and credits. Purchases from the equipment panel debit the same funds ledger. The telemetry reports cargo, total moving platform mass, funds, and an energy balance that includes attached rock, debris, cargo, and exported material.

The equipment panel sells the first upgrades against measured trip income: a rebound pad (93% normal-energy retention), a drive coil (48 J bounce pulse), and a lightweight chassis (−12 kg dry mass). Installed items add explicit deltas on top of base tuning, purchases are refused without funds or when already installed, and mass changes are booked so the energy ledger stays exact.

The platform is asymmetric: only the right-hand reflector bounces, so the left wall has a pocket that the collector docks into so the reflector can cover the wall all the way to `x = 0`. Docking trades catching (the hidden collector cannot catch) for full wall coverage when bouncing. To catch debris near the wall, undock so the collector is exposed.

Passive deck/rock impacts retain 90% of normal kinetic energy. Platform/ball horizontal contact friction exchanges momentum and energy, and capture/release carries platform velocity. Side walls are ideal elastic boundaries for the ball. Heat is cumulative dissipated energy, **not temperature**; cooling and thermal limits are not implemented yet.

## Validate

```sh
node --test experiments/*.test.js
node --check js/main.js
```

Optional browser smoke test (requires externally installed Playwright and its browser):

```sh
node experiments/browser-smoke.cjs
```

Set `PLAYWRIGHT_PATH` to an installed Playwright package if it is not resolvable normally. Set `TEST_URL` to test an HTTP URL instead of the default `file://` page. `CHROMIUM_PACKAGE` optionally identifies a serverless Chromium module providing `executablePath()` and `args`.

See `0.1.0-plan.md` for the standalone design and delivery plan, and `archive/` for validation/work logs.
