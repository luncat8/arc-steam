# gui.4 — one platform's controls, one platform's body

Status: implemented; see `archive/gui.4-worklog.md`.

Source: the report that the competitor implementation has bugs — shortcuts drive
both platforms, the second platform renders strangely — and the request to drop
bloat from the layout and the empty band above the chamber.

## What is wrong

- **The shortcut labels are the rig's, the keys are the platform's.** `Space`,
  `E`, `X`, `⇧X`, `Z` and `C` are wired to the rig and refuse to act while a
  competitor has the controls, but their controls stay on screen — disabled —
  under a title that reads `RIVAL 1 / PLATFORM DRIVE`. The panel therefore
  promises six keys that do nothing, and the `A`/`D` hint row beside them moves
  the other platform.
- **The command left behind keeps running.** `setActive` did not clear the
  platform it left, so a travel click or a held key on a competitor kept
  steering it after the rig took the keys, while the keys drove the rig.
- **The panel repeats what the scoreboard already says.** `#player-focus`
  restates name, force, load and policy each readout, `#competitor-note`
  explains which controls moved, and the strip carries the sentence *click a
  player to take its controls · BOT hands it to its policy*.
- **The competitor is drawn with the rig's machinery.** `playerApi.draw` passes
  `drawRigMachinery` to every body, so the second platform drew a second fuel
  bar, thermometer, amber collector strip and reflector piston — on a chassis
  with a blade. The blade the README describes did not exist in the renderer.
- **The idle platform is faded to 55%**, which on the dim palette leaves the
  competitor translucent next to the rock.
- **The chamber wastes the top of its canvas.** The fit reserved a fixed 80 px
  inside the box and centred the scene, so a wide window left ~49 px of empty
  canvas above the roof strip.
- **The status bar has no visible help mark** for the recovery advice that used
  to sit in the controls panel as a sentence.

## Decisions

- **The panel shows only the selected platform's controls.** Bounce assist,
  piston tilt and autopilot — marks included — live in one `#rig-drive` block
  that is hidden while a competitor is driven. Every shortcut still on screen
  belongs to the platform in the title, so nothing can promise a key that
  addresses another body.
- **The title names the platform and its policy**: `YOU · MANUAL`,
  `RIVAL 1 · BOT`. It is the one line that has to change when a row is clicked,
  and it is written only when the platform or its policy really changes.
- **A command belongs to the platform it was given to.** `setActive` clears the
  outgoing competitor's direction, brake, target and manual window, and the page
  drops the rig's direction, target and brake. Taking a competitor's controls no
  longer silences its policy either: only a key, a brake, a travel click or its
  own `BOT` switch does, which is what the `BOT` column claims.
- **A release of a key pressed on the other platform is not a command.** The
  page writes a competitor command only when the direction actually changed, so
  the two-second manual window cannot be opened by a `keyup`.
- **The rig's machinery is drawn inside the rig's own body.** `draw(context,
  rigMachinery)` applies the overlay when `player.kind === 'rig'`, so one
  platform carries the fuel bar, thermometer, collector and piston and the other
  carries its blade.
- **The blade is drawn as what it does**: a wedge between the wheels at the
  1.6 m grading swath, its cutting edge lit while the deck pulse is armed, in
  the platform's own palette. The load heap is unchanged and reads against it.
- **No fading.** The selected platform is marked by the accent outline, the
  rivals keep their own warm brass and cool slate palettes, and both bodies stay
  equally solid.
- **The fit spends its room on the scene, not on margins.** The scene is the
  roof strip, the 15 m chamber and the floor strip; the fit keeps 2 px above the
  roof strip and one label line below the floor for the charge-pad label. A box
  taller than the scene keeps the chamber near the top: at most a quarter of the
  leftover room (18 px) above the roof strip, the rest under the floor.
- **The canvas ratio matches the scene** (27.3 × 15.7 m plus the renderer's
  margins, 1.71), so a width-limited page does not leave an empty band inside a
  too-tall canvas.
- **One geometry owner.** The fit publishes `window.SteamView`
  (`scale`, `offsetX`, `floorY`), and the harnesses map world points with it
  instead of copying the arithmetic.
- **Prose that repeated a live readout is gone.** The players hint, the
  focus/competitor lines, and the two static hints that restated the cargo
  limit and the SELL-wall rule (both already live in the cargo telemetry note
  and the ledger status) are deleted. Static legends that explain what is drawn
  — the chamber legend — stay, and gain the blade.

## Mechanics

```
draw(context, rigMachinery)
  for each body: tails, blade (rival), chassis, deck, load (rival), wheels,
                 rigMachinery (rig only), active outline

resize()
  sceneHeight = ceiling + 2 * 0.35
  scale       = min((width - 32) / viewWidth,
                    (height - 2 - 26) / sceneHeight)
  slack       = height - 2 - 26 - sceneHeight * scale
  topPad      = 2 + min(slack / 2, 24)      // only when width-limited
  floorY      = topPad + 0.35 * scale + ceiling * scale
```

`setActive(index)` clears the outgoing competitor (`direction`, `braking`,
`target`, `manual`); `setActivePlayer(index)` clears the rig's half
(`direction`, `target`, `brake`, held keys, drag) and keeps the incoming
platform's policy live.

## Files

- `index.html` — the controls panel is movement first and carries `#rig-drive`
  around the rig-only blocks; `#player-focus`, `#competitor-note`, the players
  hint and the two restating hints are deleted; the status bar gains the charge
  help mark; the market drawer keeps one title instead of three; the chamber
  legend gains the blade and the panel names its own topic.
- `js/main.js` — `syncActiveControls` writes the title and hides `#rig-drive`;
  `setActivePlayer` clears the outgoing command; `updateDirection` writes a
  competitor command only on change; the fit and `window.SteamView`.
- `js/players.js` — `setActive` clears the outgoing competitor; `drawBlade`;
  the machinery overlay is the rig's alone; no `globalAlpha`.
- `styles.css` — `#rig-drive[hidden]`, the blade legend chip, the panel/
  drawer-trigger rules that no markup used, and the canvas sizing note.
- `js/help.js` — the players and keys topics describe the selected-platform
  rule and the blade.
- `README.md` — the drawing, roster and key-table rows.
- `experiments/interface.test.js`, `experiments/players.test.js`,
  `experiments/browser-smoke.cjs` — the panel, machinery, command and geometry
  assertions.

## Acceptance

- While a competitor is selected the panel shows only force and movement; no
  `Space`/`E`/`X`/`Z`/`C` label is on screen and those keys leave the chamber
  untouched.
- A/D, W/S and the brake address the selected platform only, and switching
  lines drops the command left behind: neither platform moves on its own after
  a switch.
- The competitor's body is a chassis, a blade, wheels and its load — no second
  fuel bar, thermometer, collector or piston — and no platform is faded.
- The roof strip sits a couple of pixels below the top of the canvas at every
  window size that is height-limited, and the pad label stays inside the canvas
  everywhere.
