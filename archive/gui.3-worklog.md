# gui.3 — Cargo workspace, rock tooltip, and progression drawers

## Changes

- Removed the dedicated mineral-inspector panel and its help topic. Cell readouts now appear over the canvas only while the pointer is over visible rock, then disappear on canvas exit.
- Moved cargo/storage to the workspace's left column in place of research. At the tablet breakpoint cargo moves below the chamber; phone layout stacks chamber, controls, then cargo.
- Kept rock display modes visible beneath the chamber. FUNDS / SOLD opens the SCIENCE + SHOP drawer; CARGO STORAGE opens MARKET / LEDGER. Research rows are indented by prerequisite depth and retain explicit effects, prerequisites, unlocks, and locked/available/researched states.
- Updated README layout and interaction descriptions; expanded the DOM shim to honor initially hidden drawers and added interface tests for telemetry-card drawer actions and tooltip visibility.

## Validation

- `node experiments/interface.test.js` — 23 tests pass.
- Every `experiments/*.test.js` suite — pass.
- `node --check experiments/browser-smoke.cjs` — pass. Headless browser smoke was not run because Playwright is not installed in this checkout.

## Next step

- Consider replacing depth-indented research rows with an explicit dependency graph if the technology roster grows; keep equipment unlock links visible from each research node.
