# Progression tree

- Replaced the split `#research-rows` and `#equipment-rows` sections in `#science-drawer` with a single 5-row × 3-column `#progression-tree` node graph and `#tree-links` SVG connector overlay.
- Built a 3-bay Base Chassis root bar (`BUY` Road grader, `BAY` Engine powertrain `<select>` bay, `BOT` Garage grader) branching into 10 combined `.tree-node` cards, each pairing its `SCI` research header directly above the `↳ BUY` equipment item or tier `<select>` family (`radiators`, `balls`) it unlocks, with `.node-cap` badges on pure-software nodes (`ballistics`, `ballistics2`) and `#spec-card` (`#platform-spec`) anchored in Row 5, Col 3.
- Routed all 12 prerequisite edges (`trunk`, `spine`, `branch`, `gutter`, and `side` cross-branch joins) without crossings or card clipping, with inline directional arrowheads, live state styling (`locked`, `ready`, `done`), hover path/neighbor highlighting, live header `FUNDS` + `RESEARCH` pills, unified `#progression-status`, and single `progression` (`Sci+Shop`) context-help topic.
- Positioned `.tool-drawer` below `.system-bar` on desktop so `Pause`, `New game`, `Communism mode`, `Test mode`, and `HELP` remain visible and clickable while the entire tree fits inside `1440×1000` without vertical or horizontal scrolling; stacked into a single-column bottom sheet with `↖ Needs:` labels at `<= 760px`.
- Validation:
	- `node --check js/main.js` — clean.
	- `node --test experiments/*.test.js` — 115 / 115 passing.
	- `node experiments/browser-smoke.cjs` (Chromium desktop `1440×1000`, `1920×1080`, narrow `390×844`, and touch mobile) — `PASS`, zero page errors.

Next: keep node card copy concise if future milestones add wear or era branches so desktop viewports continue to show the full graph without scrolling.
