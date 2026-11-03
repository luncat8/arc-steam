# players.4 — the second platform is the first one, dimmed

## Changes

- **The render bug.** `renderPlatform` applied the `rigMachinery` overlay to
  every body. That overlay draws the rig's live fuel bar, thermometer, amber
  collector strip and reflector piston, so a competitor wore a second, undimmed
  copy of the rig's machinery. Measured in Chromium before the change: the
  competitor's deck row was the collector amber `#e6b66e` and its chassis row
  carried the fuel bar. The overlay is now gated to `player.kind === 'rig'`, so
  it keeps riding inside the rig's own transform (a platform on top still covers
  it) and no competitor can wear it.
- **One drawing, one difference.** Both platforms now use the rig's skin for the
  body, deck and tails — no per-player palette, no per-player details — and
  `renderPlatform` sets `globalAlpha` to `1` for the selected platform and
  `dimAlpha = 0.6` for the others. It is an assignment, not a multiply, so
  drawing the same platform repeatedly cannot compound the dim. A competitor is
  now exactly the rig's chassis, deck and wheels at 60% opacity.
- **Held keys no longer drive two platforms.** `updateDirection` is the single
  writer: while the rig is selected it owns `world.direction`, and while a
  competitor is selected it owns that competitor's command and forces
  `world.direction = 0`. A switch drops the held keys and both platforms'
  commands, so a key pressed for the platform you left cannot keep it moving;
  pressing it again addresses only the new selection.
- **One command per change.** `playerApi.command(direction)` is written only when
  the direction changed, so a pointer release, a window blur or a lost
  key-capture event cannot open the two-second manual window on a competitor
  the keys never addressed.
- **The competitor's panel.** `#rival-panel` replaces the rig's machinery block
  while a competitor is selected: a `THIS PLATFORM` summary with the purse, the
  load against the storage limit and the live policy, plus one line naming where
  the reserve, piston, ball and autopilot went. The help wiring moved into
  `bindHelpMark(trigger, id)` so the panel's mark uses the same hover, click and
  focus behaviour as every mark in the system bar.
- **The readouts follow the title.** The motion readout was already
  `playerApi.activeSpeed()`; the cargo card, the mass card and the funds card
  now follow too, through `playerApi.load(active)`,
  `playerApi.activeMass()` (dry chassis + own load + the rig's held ball) and
  `playerApi.money(active)`. A competitor's cargo note says `its own load, its
  own purse`, and its funds note names its own purse against the rig ledger.
- **The rig's cards say so.** Reserve, ball energy, stored thermal energy,
  machinery temperature and the energy-balance error keep reporting the rig;
  `#telemetry[data-scope="rival"]` dims those four to 55% and stamps a corner
  `RIG` tag, which yields to a live warning that already owns that corner.
- **Leftovers removed.** The chamber legend's `BLADE · COMPETITOR GRADING` chip,
  its `.blade` rule, and the help/README text about a blade and an accent
  outline are gone — neither was drawn any more. The README and the `players`
  help topic now describe the dim rule, the switch and the keys.
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
    position and pitch cancelled — identical — while their alphas are `1` and
    `0.6`; the machinery overlay fires once, for the rig; after
    `setActive(1)` the alphas swap and the geometry is unchanged; redrawing the
    selected platform keeps alpha `1`, so the dim never compounds.
  - interface `a held key stays with the platform it was pressed for and never
    drives both`: `D` on the rig, then a click on the rival line, leaves the rig
    standing down and the competitor unmoved for 60 frames; a fresh `A` drives
    only the competitor; a key held on the competitor is dropped by the switch
    back.
  - interface `the competitor panel names the platform and its own purse, load
    and policy`: the rig panel hides, the summary shows live values, the funds,
    cargo and mass cards follow the selection, the motion readout is the
    platform's own speed, and switching back restores every card.
  - interface `the player strip…`: the machinery overlay is drawn for the rig
    only (was: for both).
- Chromium (Playwright + `@sparticuz/chromium`, per
  `findings-pitfalls-skills.md`), 1440 × 1000, page errors empty:
  - Default view: the rig carries its fuel bar, thermometer, collector strip and
    piston; the competitor is the same chassis, deck and wheels, dimmed, with
    none of them. Pixel samples: body `#35454b` at full alpha vs the same body
    dimmed over the backdrop `#263339`.
  - Clicking `RIVAL 1`: panel title `RIVAL 1 · BOT`, `#rig-drive` hidden,
    `THIS PLATFORM` summary live (`Purse 0.0 cr · Load 0 / 100 · Policy BOT`),
    cargo/mass/funds cards switched to the competitor, the four rig cards dimmed
    and tagged `RIG`. Clicking `YOU` restores all of it.
  - Hold `D` on the rig, then click the rival line: `rig.dir 1 → 0`, rival stays
    put; releasing `D` moves nothing; pressing `D` again drives the rival only
    (`rival.dir 1`, the rig stays at `0`). Before the change the rig kept
    crawling for the whole hold after the switch.
  - `Space` while a competitor is driven leaves the rig's drive alone.
  - 390 × 844: the stacked controls panel shows the competitor summary with no
    horizontal overflow.
  - `experiments/browser-smoke.cjs` still stops at the same touch-page `tap`
    timeout it hits on the pristine commit in this headless shell (a
    single-process-shell flake documented in `findings-pitfalls-skills.md`); its
    first 100 seconds — layout, paused stability, view modes, drawers, help,
    hold gesture and the narrow layout — pass before that point.

## Next step

- The `BOT` switch on a competitor still clears its manual window when the box
  is ticked, so a player who toggles the policy mid-drive loses the keys. If
  that proves annoying, the switch could leave the manual window running and let
  it expire on its own two-second timer, like a policy re-take after a command.
