# Arc Steam

A side-view energy-driven mining simulation. The current prototype combines a passive ball, a horizontally driven platform, collector/reflector regions, limited bounce pulses, explicit energy accounting, a two-dimensional mineral rock field, falling debris, mass-bearing cargo, and wall markets. Temperature/cooling, wear, equipment purchasing, and progression remain later milestones.

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
| Space, or drive button | Toggle bounce drive |
| Click chamber | Set horizontal travel target; manual movement overrides |
| E, or release button | Release a held ball when drive is enabled |
| Rock view selector | Show minerals, elemental R/G/B, price, or remaining strength |
| Pause / speed / reset | Inspect or restart the experiment |

Ground impact loses all ball energy. Move the platform over a grounded ball to recover it. The amber collector catches and holds balls and mineral debris; the green reflector bounces balls. Release transfers a stored ball onto the reflector and pays for lifting it. A 36 J pulse at 80% efficiency debits up to 45 J from the shared reserve.

The rock layer is a seeded 192 × 16 two-dimensional field. Its 0.125 m cells project to approximately 4 × 4 px at the reference scale. Ball contacts are swept against intact cells and reflect from the contacted exposed face. Impact loss funds radial damage; failed cells become falling 0.6 kg fragments.

Storage holds 100 cells. A full 60 kg load equals the dry platform mass, reducing acceleration and participating in capture momentum, braking, and kinetic-energy accounting. Touch either wall marked **SELL** to sell the entire load automatically. The telemetry reports cargo, total moving platform mass, funds, and an energy balance that includes attached rock, debris, cargo, and exported material.

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
