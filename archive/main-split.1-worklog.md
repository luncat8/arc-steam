# Worklog: split `js/main.js`

## Changes

- Split the page IIFE into ordered classic scripts: `main.js` (shared setup),
  progression, players, readouts, drawing, input, help, and `main_boot.js`.
- Renamed the `SteamAutopilot` binding to `autopilotApi` to avoid collision with
  the `#autopilot` element id.
- Turned inventory/progression construction and input/tool/help event wiring into
  named initialization functions; `main_boot.js` calls them once in a deliberate
  order and keeps `window.SteamView` intact.
- Added the main-script sequence to `index.html`, and taught `experiments/dom.cjs`
  to evaluate those tags in one shared VM context. The loader rejects duplicate
  top-level declarations and element-id collisions. Updated both interface and
  commune tests to use that loader.
- Added the UI ownership map to `AGENTS.md` and retained the detailed split plan
  in `main-split.1-plan.md`.

## Validation

- `node --check js/main*.js`: passed for all split scripts.
- Top-level declaration audit: no duplicate names and no collisions with HTML
  element ids.
- `node experiments/commune.test.js`: all 7 tests passed.
- `node experiments/interface.test.js`: 34 of 35 tests passed. The market
  energy-balance assertion reports `-20366.005000 J`; I reproduced the same
  failure with the original `js/main.js` from HEAD and its original script tag,
  so it is not introduced by this extraction.
- `node --test --test-concurrency=1 experiments/*.test.js`: 185 passed, 13
  failed. The failures include unrelated simulation/economy assertions in
  domain tests; those modules were not changed. The full suite was not compared
  against a clean baseline.
- `node experiments/browser-smoke.cjs`: could not start because `playwright` is
  not installed in the workspace.

## Next step

Run browser smoke with Playwright available, then investigate the existing
interface energy-balance failure and the remaining full-suite failures against a
clean baseline separately from this structural split.
