# players.4 — the second platform is the first one, dimmed

Status: implemented; see `archive/players.4-worklog.md`.

Source: the report that the second platform renders strangely, that switching
players breaks the panel and the shortcuts, and that the rig's shortcuts reach
the other platform. A second report after the first attempt: the second platform
had lost its piston and its other instruments, and the menu changed on a switch.

## What is wrong

- **The rig's machinery overlay was gated to the rig's body.** Behind it was a
  real bug — the overlay is drawn from the *rig's* live state, so on a competitor
  it painted a bright second instrument cluster. `players.3` therefore skipped it
  for competitors, which left a competitor as a bare hull: no collector strip, no
  fuel bar, no thermometer, no reflector piston. The platform was not the same
  machine any more.
- **The menu rearranged itself on a switch.** The panel hid the rig's block for a
  competitor and showed a different summary in its place, so the controls moved
  under the player and the column changed height.
- **A direction key held across a switch kept the old platform moving.** `D`
  pressed on the rig leaves `world.direction = 1`; taking a competitor's controls
  clears the rig's direction but the key is still down.
- **Leftovers.** The chamber legend advertised `BLADE · COMPETITOR GRADING` and
  the help/README described a blade and an accent outline, none of which the
  renderer draws.

## Decisions

- **One drawing, one palette, one difference.** Every platform is drawn by
  `renderPlatform` with the same skin, the same geometry, wheels, deck, tails
  **and the same machinery overlay** — the whole machine. The only variation is
  opacity: `1` for the selected platform, `0.6` for every other one. The alpha is
  assigned (never multiplied into the stored value), so repeated switching cannot
  compound the dim.
- **The instruments are the machine's, not the rig's.** Both hulls show the fuel
  bar, thermometer, collector strip and reflector piston, because every platform
  is that machine. The overlay is a drawing of the machine's instruments, not a
  second control surface: the keys address the selected platform only, which is
  enforced by the command routing, not by hiding the drawing.
- **The menu does not change with the selection.** Only the panel title changes
  (`YOU · MANUAL` → `RIVAL 1 · BOT`). The bounce drive, the release, the piston
  tilt and the autopilot duties stay on screen and act for the selected platform,
  so every visible control belongs to the platform in the title.
- **Keys address the platform in the title.** A held key is the selected
  platform's command: a switch drops the held keys with the command they gave,
  and pressing again drives only the new selection. Neither platform can move on
  a key pressed for the other.
- **The telemetry describes the machine** and does not switch with the
  selection.

## Mechanics

```
renderPlatform(context, player, machinery, isActive)
  alpha = isActive ? 1 : 0.6
  tails, chassis, deck, wheels
  machinery(context, player)        // both platforms: one complete machine

updateDirection()
  key direction = held keys
  rig active        -> world.direction = direction
  competitor active -> its command = direction, world.direction = 0

setActivePlayer(index)
  drop held keys, rig direction/target/brake, competitor command
```

## Files

- `js/players.js` — one skin, one complete body including the instruments,
  `dimAlpha` as the only difference, `setActive` standing the outgoing platform
  down.
- `js/main.js` — held keys as the selected platform's command, the title-only
  panel sync, the machine controls live for whichever platform is selected,
  `bindHelpMark` extracted so the panel's mark reuses the help wiring.
- `index.html`, `styles.css` — the blade legend removed; the rig block is no
  longer hidden for a competitor.
- `js/help.js`, `README.md` — the drawing, the roster, the switch and the keys.
- `experiments/players.test.js`, `experiments/interface.test.js` — the one-body
  painting test, the held-key test and the stable-menu test.
- `experiments/browser-smoke.cjs` — the rock-cell assertion reads the live
  columns and rows instead of the hard-coded 192 × 16.

## Acceptance

- Both platforms are the same complete machine in the same colours: chassis,
  deck, wheels, plates, fuel bar, thermometer, collector strip and piston. The
  unselected one is that drawing at 60% opacity, and switch after switch never
  darkens it further.
- Switching players changes the panel title and nothing else: same controls,
  same height, same telemetry.
- Holding `A`/`D` and clicking the other player line leaves neither platform
  moving; pressing the key again drives only the selected one.
- The full suite passes and the page boots clean in Chromium.
