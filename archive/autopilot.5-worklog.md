# autopilot.5 — bot handoff and stalled shifts

## Fixes

- A rival's BOT release no longer depends on whether that rival is selected. Selection only addresses hand input; the manual grace window still suspends the automatic release.
- A full rival sells even when the other collector holds every ball. The no-playable-ball return no longer precedes the selling trip.
- The full rig bot visits the centre pad below 20% reserve and resumes at 95%. Selling takes priority if the hopper fills during the trip. Service trips return the travel duty immediately when finished; the status line names selling/recharging instead of reporting a generic manual override.
- The panel labels the four duties RIG AUTOPILOT. A rival's BOT switch remains its own policy. Active-player changes invalidate the readout immediately, including changes made through the domain API.
- Floor grading transports value with smoothed height through a second preallocated buffer. The blade cut then prices the transported density; delayed fallout is isolated in the accounting regression.
- Removed the diagnostic duplicate `debug.test.js`; `interface.test.js` is the canonical page suite. Removed inherited-state logging and made the affected pulse, shop, status and pad scenes explicit. The rock-shape fixture works through the damaged face before asserting overlap protection. The fundability check measures the current catalogue instead of using the obsolete 30-load budget.

## Validation

- `node --test experiments/interface.test.js experiments/players.test.js experiments/autopilot.test.js experiments/equipment.test.js`: 88 passed.
- Named regressions in balls, physics and research: 3 passed. Unrelated legacy suites were not run.
- `node experiments/probe-autopilot.cjs`: selected-bot release on the first step; blocked sale settled in 4.75 s; pad recovery reached 21.65 kJ in 8.07 s. Three 60 s two-ball shifts recorded 18/21/21 bounces and no interval with both balls grounded.
- Syntax checks passed for every page script and the probe; `git diff --check` passed.
- Logs: `experiments/logs/autopilot.5-{probe.txt,tests.txt,regressions.txt}`.

## Next step

Playtest the checked-rival handoff and the rig's selling/pad trips in a real browser at normal and accelerated speed. Browser smoke was not run because no browser tooling is installed in this workspace.
