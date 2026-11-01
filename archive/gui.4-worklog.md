# gui.4 — one platform's controls, one platform's body

## Changes

- Controls panel is the selected platform's drive. `#rig-drive` wraps bounce
  assist, release, piston tilt, autopilot and their `?` marks; `syncActiveControls`
  hides it while a competitor has the controls, so no `SPACE / Q`, `E`, `X`,
  `⇧X`, `Z` or `C` label sits on screen next to a platform those keys do not
  drive. The rig-only `setDisabled` calls went with it.
- Panel title is the one status line: `YOU · MANUAL`, `RIVAL 1 · BOT`
  (`· MANUAL` when the policy is off). It is written only when the platform or
  its policy changes.
- Deleted the prose that repeated live state: `#player-focus`
  (`DRIVING YOU · FORCE 60% · LOAD 0 CELLS · MANUAL`), `#competitor-note`,
  the players hint (*click a player to take its controls · BOT hands it to its
  policy*) and the recovery hint (*Live recovery advice shows in the status bar
  below*). The cargo panel's `100 cells maximum · cargo adds mass · sell at a
  SELL wall` and the market's `Touch a SELL wall…` went too — the cargo
  telemetry note and the ledger status already carry both, live. The charge
  topic kept its home: a `?` mark in the status bar replaces the deleted
  sentence.
- Commands stay with the platform they were given to. `players.setActive`
  clears the outgoing competitor's `direction`, `braking`, `target` and `manual`;
  `setActivePlayer` clears the rig's `world.direction`, `world.target`,
  `world.brake`, the held keys and the piston drag. Taking a competitor's
  controls no longer silences its policy — only a key, a brake, a travel click
  or its `BOT` switch does.
- `updateDirection` writes a competitor command only when the direction really
  changed (`commandedDirection`), so a `keyup` for a key pressed on the other
  platform cannot open the two-second manual window on the platform that has the
  controls now. `players.clearCommand` stands a platform down only when it
  actually holds a direction, a brake or a target, so a pointer release, a window
  blur or a reset never silences a policy that was doing the driving.
- **Render fix.** `playerApi.draw(context, rigMachinery)` passed the rig's
  machinery overlay to *every* body, so the competitor was drawn with a copy of
  the rig's fuel bar, thermometer, amber collector strip and reflector piston.
  `drawBody` now applies it only when `player.kind === 'rig'`.
- The competitor has the blade the design always described: `drawBlade` draws a
  wedge between the wheels across the 1.6 m grading swath, with its cutting edge
  lit while `rival.pulse` arms the deck drive. Rival palettes reworked so the
  body, the blade and the load heap separate: warm brass `#3f3a31` with deck
  `#7d6a4f`, cool slate `#38343d` with deck `#6a6276`.
- No fading: the `globalAlpha = 0.55` for the inactive platform is gone, and the
  accent outline on the selected chassis is what marks the selection.
- Chamber fit rewritten. The scene is roof strip + 15 m chamber + floor strip;
  `scale` reserves only 2 px above the roof strip and one 14 px label line under
  the floor strip for the charge-pad label. A canvas taller than the fitted
  scene keeps the chamber near the top: at most a quarter of the leftover room —
  18 px — may open above the roof strip, and the rest stays under the floor,
  where it is only backdrop.
- The canvas ratio now matches the scene. `.canvas-wrap` was 1.5 while the scene
  is 27.3 × 15.7 m, so at 1440 × 1000 the box was 888 × 591 with 58 px of empty
  canvas above the roof strip (the old fit reserved a flat 80 px of the box and
  centred the scene). At 1.71 the width-limited box is 888 × 519 and the empty
  band above the roof strip is **58 px → 2 px**, with no change to the chamber
  itself (scale 31.4 px/m either way, the scene now 95% of the box instead of
  83%).
- Measured with the real renderer through `window.SteamView`:
  1370 × 740 and 1920 × 1080 → **2 px** above the roof strip, scene **98–99%**
  of the box; 888 × 519 → 5 px (the canvas ratio now matches the scene, so this
  is the normal desktop case); 674 × 420 → 11 px; a 344 × 320 phone → 20 px. The
  pad label line stays inside the canvas in every case.
- The fit publishes `window.SteamView` (`scale`, `offsetX`, `floorY`);
  `experiments/interface.test.js` and `experiments/browser-smoke.cjs` map world
  points through it instead of copying the arithmetic (both copies had to be
  edited by hand for this change, which is exactly the drift this removes).
- Layout cleanup: the market drawer had three titles for one drawer (head,
  panel title, `CARGO & SALES`) — it now carries one head with a `CREDITS`
  meta pill like the science drawer; the status bar lost the prose above; the
  controls panel's help topic is `movement` (it opened autopilot, which is now
  one block among several); dead `.panel-meta`, `.drawer-trigger` and
  `.scoreboard-hint` rules deleted; the chamber legend gained
  `BLADE · COMPETITOR GRADING`.
- `README.md` and `js/help.js`: the drawing paragraph, the PLAYERS paragraph,
  the click-a-line row, the keys topic and the players topic describe the
  selected-platform rule, the blade and the absence of fading.

## Validation

- `node --check js/*.js` — clean; `node --check experiments/browser-smoke.cjs`
  — clean; `git diff --check` — clean.
- `node --test experiments/*.test.js` — **147 / 147** (interface 27, players 15,
  the rest 105). New assertions:
  - interface: `players.draw` calls the machinery overlay for the rig only; the
    rig's `world.direction`/`target` are dropped when a competitor takes the
    keys; the competitor's policy is untouched by the switch; the panel shows
    `rig-drive` hidden/visible and titles `RIVAL 1 · BOT` → `RIVAL 1 · MANUAL`
    → `YOU · MANUAL`; a whole shortcut sweep while a competitor is selected
    leaves the rig's drive, duties, direction and target untouched while `W`
    edits the competitor's own force.
  - players: `a command stays with the platform it was given to`.
- Render check outside the browser: the page booted against `experiments/dom.cjs`
  with `@napi-rs/canvas` behind the canvas element and PNGs were read back at
  1386 × 666. Before: the competitor carried a second collector strip, fuel bar
  and reflector piston and was drawn at 55% alpha. After: chassis, deck, blade,
  wheels, load heap. Roof strip flush at 2 px, `CHARGE PAD · 3 kW` inside the
  canvas, `SELL` marks upright at both walls.
- Simulation is untouched: 60 s with both bots per arrangement gives balance
  `8.2e-10 / -2.3e-10 / 1.3e-9` J, competitor purses `758 / 0 / 688` cr,
  temperature ≤ 110 °C, no ball above 15 m/s — the players.3 figures.
- Headless browser smoke was not run: Playwright and Chromium are not available
  in this checkout (the registry is reachable, the browser download is not).

## Next step

- A held key that is still down when a row is clicked is dropped by the switch
  (correct: the command was given to the platform just left), but a player
  expects the new platform to pick the key up on the next press. If that proves
  annoying, re-issue the current direction to the newly selected platform on the
  first simulation step after the switch, gated to keys that are still held.
