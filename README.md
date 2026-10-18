# Arc Steam

A side-view energy-driven mining simulation. The current milestone is a physics sandbox: a passive ball, a horizontally driven platform, separate collector/reflector regions, limited bounce pulses, and an explicit energy ledger. The ceiling is inert; mining, temperature/cooling, wear, and progression are later milestones.

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
| Pause / speed / reset | Inspect or restart the experiment |

Ground impact loses all ball energy. Move the platform over a grounded ball to recover it. The amber collector catches and holds balls, dissipating their energy; the green reflector bounces them. Release transfers a stored ball onto the reflector and pays for lifting it. A 36 J pulse at 80% efficiency debits up to 45 J from the shared reserve. From rest, approximately three powered pushes reach the ceiling in the initial calibration.

Passive deck/ceiling impacts retain 90% of vertical kinetic energy. Side walls are ideal elastic boundaries. Heat is cumulative dissipated energy, **not temperature**; cooling and thermal limits are not implemented yet. The accounting error compares reserve + ball/platform mechanical energy + dissipated heat with initial total energy. Stored balls have zero mechanical energy; release pays their lifting cost.

## Validate

```sh
node --test experiments/physics.test.js
node --check js/main.js
```

Optional browser smoke test (requires externally installed Playwright and its browser):

```sh
node experiments/browser-smoke.cjs
```

Set `PLAYWRIGHT_PATH` to an installed Playwright package if it is not resolvable normally. Set `TEST_URL` to test an HTTP URL instead of the default `file://` page. `CHROMIUM_PACKAGE` optionally identifies a serverless Chromium module providing `executablePath()` and `args`.

See `0.1.0-plan.md` for the standalone design and delivery plan, and `archive/` for validation/work logs.
