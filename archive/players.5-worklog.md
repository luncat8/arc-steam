# players.5 — worklog

Plan: `players.5-plan.md`. Implemented the per-platform machine controls.

## What was done

- `js/players.js` — new accessors `machineOf(player)` (the rig's machine is the
  world, every competitor's is its own object), `pistonAngleOf`, and the single
  clamped writer `setPistonAngleOf` (rig goes through `physics.setPistonAngle`,
  rivals store their own). `createRival` gains `pistonAngle: 0, drive: false`.
- `js/main.js` — `pistonDegrees`/`setPistonAngle` route through the *active*
  player, so the wheel, slider and air drag tilt only the selected platform;
  the autopilot tilt override applies on the rig only (it is the rig's duty).
  `syncActiveControls` now also syncs the piston slider on a switch. The
  machinery overlay (`drawRigMachinery`) reads `machineOf(player)` for fuel,
  heat, piston and drive light, so no platform paints another's state.
  `toggleDrive` and the drive button read/write the selected machine's drive.
- `js/help.js` — the keys paragraph now names the drive and piston tilt as
  selected-platform controls.
- Tests: `players.test.js` proves tilt isolation across a three-player roster;
  `interface.test.js` proves the wheel/slider steer only the selected platform
  and the slider follows the switch.

## Validation

- Every `experiments/*.test.js` run per file: 157 pass, 0 fail.
- Before the fix, one wheel notch changed the piston drawn on every hull;
  after it, `world.pistonAngle` and other players' angles stay put while the
  selected competitor's `pistonAngle` moves.

## Next step suggestion

The remaining rig-only controls (ball release `E`, autopilot duties) are
deliberately rig-bound; if a competitor ever gets its own ball-launch physics,
route it through `machineOf` the same way the tilt was routed here.
