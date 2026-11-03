# players.4 — the second platform is the first one, dimmed

## Changes

- **The second platform is the whole machine again.** `renderPlatform` now draws
  the machinery overlay for every platform instead of only for the rig, so both
  hulls carry the collector strip, the fuel bar, the thermometer, the reflector
  piston and the deck: one complete machine in one palette. The overlay is a
  drawing of the machine's instruments, not a second set of controls — the keys
  address the selected platform through the command routing, so a dimmed hull
  never answers them. This restores what `players.3` had removed while fixing the
  real bug underneath it (the overlay is painted from the rig's live state).
- **One difference: the dim.** `renderPlatform` assigns `globalAlpha` to `1` for
  the selected platform and `dimAlpha = 0.6` for the others. It is an assignment,
  not a multiply, so drawing the same platform repeatedly cannot compound the
  dim. Per-rival palette copies (`body`, `tail`, `deck`) were dead once the skin
  was shared and are deleted.
- **The menu no longer rearranges itself.** The panel's competitor block and the
  `RIG`-tagged telemetry are gone: `syncActiveControls` writes the title and the
  force control and nothing else, so the panel keeps the same controls and the
  same height across a switch. Measured in Chromium: the only field that changes
  between `YOU` and `RIVAL 1` is `#control-title`, with the control block at
  380 px before and after.
- **One machine means one set of controls.** The bounce drive, the release, the
  piston tilt (slider, wheel and chamber drag) and the autopilot duties no longer
  refuse to act on a competitor; they act for the platform in the title, so no
  visible control is dead and none belongs to another platform.
- **Held keys no longer drive two platforms.** `updateDirection` is the single
  writer: while the rig is selected it owns `world.direction`, and while a
  competitor is selected it owns that competitor's command and forces
  `world.direction = 0`. A switch drops the held keys and both platforms'
  commands, so a key pressed for the platform you left cannot keep it moving;
  pressing it again addresses only the new selection.
- **One command per change.** `playerApi.command(direction)` is written only when
  the direction changed, so a pointer release, a window blur or a lost
  key-capture event cannot open the two-second manual window on a competitor the
  keys never addressed.
- **The help wiring** moved into `bindHelpMark(trigger, id)` in `js/main.js` so
  any mark, including one outside the system bar, uses the same hover, click and
  focus behaviour.
- **Leftovers removed.** The chamber legend's `BLADE · COMPETITOR GRADING` chip,
  its `.blade` rule, and the help/README text about a blade and an accent outline
  are gone — neither was drawn any more. The README and the `players` help topic
  describe the one drawing, the dim and the switch.
- `experiments/browser-smoke.cjs` asserted a hard-coded `192 × 16` rock grid and
  failed against the live 192 × 29 field on the pristine commit as well; it now
  reads `SteamCeiling.state.columns` and `.rows` and builds the pattern from
  them.

## Validation

- `node --check js/*.js` — clean; `git diff --check` — clean.
- `node --test experiments/*.test.js` — **159 / 159** (interface 29, players 16,
  the rest 114). New assertions:
  - players `both platforms are one drawing and the dim is the only difference`:
    a recording context compares the two platforms' canvas call sequences with
    position and pitch cancelled — identical, machinery included — while their
    alphas are `1` and `0.6`; the overlay fires for both hulls; after
    `setActive(1)` the alphas swap and the geometry is unchanged; redrawing the
    selected platform keeps alpha `1`, so the dim never compounds.
  - interface `switching platforms changes the title and nothing else in the
    menu`: the rig block stays visible, drive, tilt and autopilot controls stay
    enabled, the force, cargo, funds and mass readouts are unchanged, and the
    title is the only thing that moves.
  - interface `the machine keys stay live on the selected platform`: with a
    competitor selected, `Space` toggles the drive, `X`/`Z`/`C` engage and
    release their duties, `W` edits that competitor's force, and no command
    reaches the rig.
  - interface `a held key stays with the platform it was pressed for and never
    drives both`: `D` on the rig, then a click on the rival line, leaves the rig
    standing down and the competitor unmoved for 60 frames; a fresh `A` drives
    only the competitor; a key held on the competitor is dropped by the switch
    back.
- Chromium (Playwright + `@sparticuz/chromium`, per
  `findings-pitfalls-skills.md`), 1440 × 1000, page errors empty:
  - Both hulls render the complete machine. Rendered and read back at 2× device
    scale: the selected platform shows collector amber, fuel bar and
    thermometer at full strength, and the dimmed one shows the same shapes at
    60% over the backdrop — previously the dimmed hull had no instruments at all.
  - Clicking `RIVAL 1` changes `#control-title` from `YOU · MANUAL` to
    `RIVAL 1 · BOT` and nothing else in the panel: `force` 60 → 60, `drive`
    pressed → pressed, `piston-angle` 0 → 0, all four autopilot boxes unchanged,
    `#rig-drive` 380 px tall and visible before and after, cargo, funds and mass
    identical.
  - 390 × 844: the stacked controls panel keeps the same contents with a
    competitor selected, no horizontal overflow.
  - `experiments/browser-smoke.cjs` still stops at the same touch-page `tap`
    timeout it hits on the pristine commit in this headless shell (a
    single-process-shell flake documented in `findings-pitfalls-skills.md`); its
    first 100 seconds — layout, paused stability, view modes, drawers, help,
    hold gesture and the narrow layout — pass before that point.

## Next step

- A competitor's instruments show the rig's reserve and temperature, because the
  overlay is painted from the rig's state. If competitors are later given their
  own reserve or heat, the overlay should read the drawn platform's record
  instead of the rig's — one lookup to change in `drawRigMachinery`.
