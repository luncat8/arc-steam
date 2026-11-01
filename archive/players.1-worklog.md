# players.1 — competitors, 45° tails and the PLAYERS strip

- Added `js/players.js` (`SteamPlayers`): a roster of one rig (`kind: 'rig'`, purse read from `SteamCeiling.state.funds`) and one dim competitor (`RIVAL 1`, own `money`, 1.6 m blade, ≤100-cell load), each with a trapezoid body — flat top 0.34 m above the terrain under its owner, 45° tail run 0.18 — and a frozen `state` view (`players`, `active`).
- Competitor collision is the commercial grader's rule, generalised: `physics.platformGroundAt / platformPitchAt / platformBaseAt` take an `exceptId`, and `SteamPlayers.surfaceAt(x, exceptId)` joins the max. The rig passes `'rig'`, competitors pass their own id, so no body stands on its own tail and no pair lifts itself.
- The rig chassis now draws the same 45° tails (`#2c3a3f`) at both ends, so the silhouette states the collision rule it uses.
- Added `SteamCeiling.harvest(x, halfWidth, cut, maxCells, out)`: a blade shaves floor rubble by value density and returns `{cells, value}` in a caller-owned record, so the floor and a competitor's purse can never disagree. Competitors sell 100% of their load at either wall and reverse; the rig bot, when its hopper is full, makes a selling trip aimed 1 m past the wall so it presses into the SELL zone, then resumes the intercept.
- `index.html`: `#player-list` strip under telemetry, `#help-players` topic mark, `#competitor-note` in the platform panel, `players.js` script tag before `main.js`.
- `styles.css`: `.scoreboard`, `.player-row` (active outline, `data-active`), `.player-select` button, `.player-money`, `.player-bot` checkbox.
- `js/main.js`: `buildPlayers` (one row = colour dot, name, `<funds>.0 cr`, `BOT` checkbox; the row itself is the control switch), `refreshPlayers` (change-only money/`aria-pressed`/active flag, calls `syncRigBot` and `syncAutopilot`), `syncActiveControls` (`PLATFORM / LOW-TIER DRIVE` versus `RIVAL 1 / COMPETITOR DRIVE`, rig-only controls and `#competitor-note` toggled), `setActivePlayer`. A/D, brake, force, travel click and `world.target` route to the active platform; the rig is drawn after competitors so it reads on top; reset re-inits the roster.
- `js/help.js`: `players` topic — roster, click-to-control, per-player BOT, the 45° tail as the ramp. `README.md`: intro, PLAYERS strip paragraph, competitor section, two control rows and a validation-line entry.
- `experiments/players.test.js` (9 tests): profile shape and self-exclusion, rig rides over a competitor, competitor body blocks at its face, blade harvest lowers the floor and pays only the rival, wall sale, rig selling trip, manual 2 s override (a held key outranks the bot until released), bot switch. `commune.test.js` and `interface.test.js` require `players.js` before `main.js`; `interface.test.js` gained the strip test (row count, money format, click to switch, checkbox to policy).
- Fixed: the new strip test originally advanced frames, which leaked autopilot/force state into later tests (5, 7, 11, 12, 20 failed). It now asserts synchronously.
- Validation:
	- `node --check js/*.js` — clean.
	- `node --test experiments/*.test.js` — 125 / 125 passing.
	- `git diff --check` — clean.
	- `node experiments/browser-smoke.cjs` — unavailable in this sandbox (`playwright` not installed, no system Chromium); the DOM shim in `experiments/dom.cjs` covers the strip wiring.

Next: if a second competitor is added, rival/rival overlap needs an ordering rule; the current milestone assumes one.
