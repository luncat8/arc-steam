# players.4 — the second platform is the first one, dimmed

Status: implemented; see `archive/players.4-worklog.md`.

Source: the report that the second platform renders strangely, that switching
players breaks the panel and the shortcuts, and that the rig's shortcuts reach
the other platform.

## What is wrong

- **The rig's machinery is drawn on every platform.** `SteamPlayers.draw` passes
  `drawRigMachinery` to each body and `renderPlatform` applies it
  unconditionally. The overlay reads the live rig — fuel bar, thermometer, amber
  collector strip and reflector piston — so a competitor is drawn with a second,
  bright copy of it. Measured in Chromium: the competitor carried the collector
  strip (`#e6b66e`) and a green deck band. That copy *is* the "strange second
  platform", and because it answers the rig's state it also looks like the keys
  drive both.
- **The competitor is dimmed to 60% while its machinery copy is not**, so the
  report's "same shape, dim colour" reading fails twice: the shape differs and
  the dim is applied to the wrong part of the drawing.
- **A direction key held across a switch keeps the old platform moving.** `D`
  pressed on the rig leaves `world.direction = 1`; taking a competitor's
  controls clears the rig's direction but the key is still down, so the platform
  keeps being commanded by a key the player pressed for the other one.
- **The panel becomes an empty column on a competitor.** Bounce assist, tilt and
  autopilot all leave, and nothing takes their place, so the column no longer
  says which platform it drives.
- **The telemetry keeps claiming to be the selected platform's.** Cargo, mass
  and funds stay the rig's numbers under a title that names a competitor.
- **Leftovers.** The chamber legend still advertises `BLADE · COMPETITOR
  GRADING` and the help/README still describe a blade and an accent outline,
  neither of which the renderer draws.

## Decisions

- **One drawing, one palette, one difference.** Both platforms are drawn by
  `renderPlatform` with the rig's skin, the same geometry, wheels, deck and
  tails. The only variation is opacity: `1` for the selected platform, `0.6` for
  every other one. The alpha is assigned (never multiplied into the stored
  value), so repeated switching cannot compound the dim.
- **The machinery belongs to the rig's body.** The overlay is applied only when
  `player.kind === 'rig'`, inside the rig's own transform, so a platform riding
  on top covers it and no competitor can wear it. A competitor is a chassis, a
  deck and wheels — nothing else.
- **Keys address the platform in the title.** A held key is the selected
  platform's command: a switch drops the held keys with the command they gave,
  and pressing again drives only the new selection. Neither platform can move on
  a key pressed for the other.
- **The rig's own keys do nothing while a competitor is driven.** `Space`, `Q`,
  `E`, `X`, `⇧X`, `Z` and `C` are the rig's; they are ignored rather than routed.
- **The panel answers for the selected platform.** Rig machinery leaves it and a
  `THIS PLATFORM` summary takes its place: purse, load, policy, and one line
  naming where the rig's controls are.
- **The readouts follow the title.** The motion readout, the cargo card, the
  mass card and the funds card describe the selected platform — its own speed,
  load, dry chassis mass plus its load, and its own purse.
- **The rig's cards say so.** Reserve, ball energy, stored thermal energy,
  machinery temperature and the energy-balance error stay the rig's numbers and
  carry a `RIG` tag, dimmed, while a competitor is selected.

## Mechanics

```
renderPlatform(context, player, machinery, isActive)
  alpha = isActive ? 1 : 0.6
  tails, chassis, deck, wheels
  machinery(context, player)        // only when player.kind === 'rig'

updateDirection()
  key direction = held keys
  rig active        -> world.direction = direction
  competitor active -> its command = direction, world.direction = 0

setActivePlayer(index)
  drop held keys, rig direction/target/brake, competitor command
```

## Files

- `js/players.js` — one skin for both bodies, the machinery overlay gated to the
  rig, `dimAlpha` as the only difference, `clearCommand(index)` and
  `activeMass()`.
- `js/main.js` — held keys as the selected platform's command, the competitor
  summary, the readouts and cards following the selection, the `RIG` scope
  attribute, `bindHelpMark` extracted so the panel's mark reuses the help wiring.
- `index.html`, `styles.css` — `#rival-panel` with its readout, the telemetry
  `data-owner` cards and their `RIG` tag, the blade legend removed.
- `js/help.js`, `README.md` — the drawing, the roster, the switch and the keys.
- `experiments/players.test.js`, `experiments/interface.test.js` — the one-body
  painting test and the switch/summary tests.
- `experiments/browser-smoke.cjs` — the rock-cell assertion reads the live
  columns and rows instead of the hard-coded 192 × 16.

## Acceptance

- Both platforms are the same drawing in the same colours; the unselected one is
  the same drawing at 60% opacity, and switch after switch never darkens it
  further.
- A competitor carries no fuel bar, thermometer, collector strip or piston.
- Holding `A`/`D` and clicking the other player line leaves neither platform
  moving; pressing the key again drives only the selected one.
- The rig's `Space`/`Q`/`E`/`X`/`Z`/`C` do nothing while a competitor is driven.
- The panel names the selected platform, shows its purse, load and policy, and
  the cargo, mass, funds and motion readouts move with it.
- The reserve, heat and ball cards keep reporting the rig and carry a `RIG` tag
  while a competitor is selected.
- The full suite passes and the page boots clean in Chromium.
