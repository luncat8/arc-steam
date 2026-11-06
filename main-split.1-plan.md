# Plan: split js/main.js into plain global scripts

## Goal
Split the 1910-line `js/main.js` (one IIFE) into ~9 classic scripts of roughly
200–450 lines, one per panel/subsystem, so a typical edit loads at most 2 files
and no declaration has to be searched for across a chain of files.

The split is a pure move: no behaviour, layout, physics, economics or API
change. It stays `file://` friendly with classic `<script>` tags, no modules,
no build.

## Why plain global scripts (not per-file IIFEs)
Adopt the mechanism validated in the other project:

- drop the outer IIFE and let declarations become top-level `const`/`let`/
  `function` in ordered scripts;
- top-level declarations of one classic script are visible to the next in the
  same global scope, and the *same* binding is shared, so all call sites stay
  byte-identical and the ~60 state variables need no prefix, getter or
  dependency-injection plumbing;
- `let`/`const` at top level do not become enumerable `window` properties, so
  the global namespace is not polluted;
- a duplicated top-level `const` across two files is a `SyntaxError` at load,
  so a wrong boundary fails loudly on the first smoke run;
- each file starts with `'use strict'`, turning a declaration dropped during a
  move into a `ReferenceError` instead of a silent global leak.

The rejected alternative — keep an IIFE per file and pass a `create(deps)`
object — rewrites every cross-area reference and state access, a larger diff
and worse locality. Encapsulation that matters (physics, equipment, research,
players, ceiling, autopilot, prediction, help) keeps its own exported objects
unchanged.

## Required pre-flight: id-shadowing rename
Element `id`s are implicit `window` globals, so a top-level declaration whose
name equals an id silently changes meaning outside the file. Audit of the 183
declarations in `main.js` against the 111 ids in `index.html` found one
collision that means something different:

| line | name | to | collides with |
|---|---|---|---|
| 4 | `autopilot` | `autopilotApi` | `#autopilot` control block |

`autopilot` here is `SteamAutopilot`, not the element, so a bare
`autopilot.hold(...)` in a split file would resolve to the element and break.
All 22 call sites (`autopilot.hold`, `autopilot.state`, `autopilot.suspended`,
`autopilot.reset`, `autopilot.enabled`, `autopilot.channel...`) move to
`autopilotApi`. The id string `'autopilot'` and comments stay unchanged.

Audit gate, run after the IIFE is gone (declarations then sit at column 0):

```sh
grep -ohE '^(const|let|var|function) [A-Za-z0-9_$]+' js/main*.js \
  | awk '{print $2}' | sort -u > /tmp/n
grep -ohE 'id="[A-Za-z0-9_-]+"' index.html | sed 's/id="//;s/"//' \
  | sort -u > /tmp/i
comm -12 /tmp/n /tmp/i   # survivors must be `x = $(x)` element consts only
```

No collisions with the globals other scripts export (`SteamPhysics`,
`SteamPlayers`, ...), with `Window` built-ins, or with inline handlers (none
exist). Confirmed clear.

## Ownership rules
These are what make an edit local; file boundaries are only their result.

1. One contiguous range per file where the area is contiguous. Three ranges are
   allowed only when code genuinely interleaves and the alternative is misfiling
   a whole block (measured precedent: `gui_aim.js` / `gui_predict.js`).
2. A file declares the state and DOM refs it owns at its top. No shared
   `state.js`, `selectors.js`, `dom.js` or `utils.js` — those recreate the
   chain this split exists to remove.
3. The composer owns only the shared objects (`physics` alias is per-file;
   `world`, `ui`, `canvas`, `context`) plus cross-panel nodes and the boot
   tail. Everything else moves out.
4. Never split a function away from the state/helper it uses directly just to
   hit a line target. A 450-line file beats a correct-looking pair that each
   needs the other.
5. Keep each per-frame loop body inside one file (`frame`, `syncField`-style
   loops are already in `main_input.js`).
6. Data flow one-directional: `draw*` reads state and paints, never mutates
   game state; handlers translate an event into one call on the owning area;
   only the owning area writes its own state.
7. File header, every file: 3–6 lines naming what it owns and must not touch,
   then a `provides:` / `depends:` symbol line. That header lets an agent
   decide relevance from `head -12`.
8. No definition-time cross-file reads: a new file may touch another file's
   bindings only inside a function body or in the composer's boot tail.

## Files
Partition is defined by anchor symbol, not line number. Anchors survive edits;
the assertion that matters is that anchors cover every top-level declaration
exactly once, in order. Line numbers below are orientation only, measured once
against the untouched file. Boundaries snap outward to the enclosing top-level
declaration (`node --check` per file catches a sliced function).

| file | ~lines | src range | owns |
|---|---|---|---|
| `main_core.js` | ~120 | 1–62, 83–96 | `physics`/`playerApi`/`config` aliases, `canvas`/`context`, `ids`/`ui`, helpers `setText`…`rampColor`, `rockWarpY`, `selectedColumn`/`selectedLayer`, `world`, `testMode`, `showPrediction`, `activePlayer`/`activePlayerId`, `setWarning` |
| `main_progress.js` | ~360 | 97–223, 224–397, 673–753 | `SVG_NS`, `treeOrder`/`treeLayout`/`treeEdges`, `svgNode`, `priceLabel`, `massSuffix`, `rowTitle`, `prerequisiteNames`, `buildSlot`, `buildTierSlot`, `focusNodeLinks`, `buildUpgrades`, `layoutTreeLinks`, `buyEquipment`, `buyResearch`, `setCommune`, `grantTestState`, `setTestMode`, `setModeStatus`, `setBlocked`, `setRowState`, `refreshGrader`, `refreshTierSlot`, `refreshTreeLinks`, `refreshUpgrades`, `specReadout` |
| `main_players.js` | ~120 | 571–672 | `buildPlayers`, `refreshPlayers`, `syncActiveControls`, `setActivePlayer` |
| `main_readouts.js` | ~260 | 63–82, 772–830, 1135–1321 | `buildInventory`, `inventoryCells`, `renderedSales`, `ledgerText`, `ledgerStatus`, `spent`, `mineralReadout`, `miningReadout`, `predictionReadout`, `travelClause`, `workingBall`, `autopilotText`, `autopilotReadout`, `readout`, `platformGrounded`, `statusReadout` |
| `main_draw.js` | ~260 | 916–1134 | `drawRigMachinery`, `draw`, `drawFlight`, `drawPrediction`, `drawSellLabel`, `drawPadLabel`, `playerById` |
| `main_input.js` | ~360 | 830? no — 1322–1683 | `refresh`, `syncPistonControl`, `pistonDegrees`, `setPistonAngle`, `syncAutopilot`, `setChannel`, `toggleChannel`, `channelForKey`, `autopilotChanged`, `setViewMode`, `viewModeChanged`, `viewModeHovered`, `rockCellIndex`, `inspectRockAtPointer`, `updateDirection`, `clearInput`, `toggleDrive`, `releaseBall`, `togglePause`, `setForce`, `syncForceControl`, `isGameKey`, `keydown`, `keyup`, `bindDirection`, `frame`, `endPistonDrag`, plus frame state (`accumulator`, `previous`, `sceneDirty`, `paused`, `leftHeld`, `rightHeld`, `pistonDragActive`) |
| `main_help.js` | ~170 | 1713–1859 | `setHelpState`, `renderHelp`, `openHelp`, `closeHelp`, `toggleHelp`, `helpKey`, `bindHelpMark`, `bindHelp`, `heldTopic`, `endHelpPress`, `bindHelpGestures` |
| `main_events.js` | ~120 | 1451–1472, 1860–1910 | `setToolDrawer`, `toggleToolDrawer`, `closeToolDrawers`, `fitStatusBar`, `resize`, and the boot tail: listeners, ResizeObservers, `buildPlayers`, `physics.setGroundBounce`, `resize`, `refresh`, `requestAnimationFrame(frame)` |

`main.js` keeps its filename and tag as the **composer**: the six shared objects
(`world`, `ui`, `canvas`, `context`, `testMode`, `showPrediction`) stay declared
there, and the boot tail calls into the area files. It shrinks to under ~150
lines.

Load order (also `index.html` order):

```
main_core.js → main_progress.js → main_players.js → main_readouts.js
→ main_draw.js → main_input.js → main_help.js → main_events.js
```

Leaves first, `draw*`/`frame` last: a block a file needs at definition time must
move before the file that reads it; everything else resolves at call time.

## Node test compatibility
`experiments/interface.test.js` currently does `require('../js/main.js')`. With
plain global scripts, each `require` runs in its own module scope and the
top-level bindings would not be shared, so update the test harness to load the
split files in one context:

- add `experiments/dom_stub.cjs` (or extend `dom.cjs`) that reads the
  `<script src="js/...">` list from `index.html` and evaluates each file with
  `vm.runInContext` in one shared context, so top-level `let`/`const`/`function`
  are shared exactly as in a browser;
- `interface.test.js` then calls `dom.loadScripts()` instead of
  `require('../js/main.js')`. Physics/equipment/etc. modules still use
  `require` and their exported objects unchanged.

`browser-smoke.cjs` needs no change: it loads `index.html` and follows the
script tags.

## Migration stages
One file per commit, so any stage is independently revertable and `git bisect`
stays usable.

0. Add `/* ── area · file.js ── contents */` banners at every block boundary
   (no line numbers committed) plus the edit map in `AGENTS.md` under `## files`.
   Already most of the saving; reversible in one commit.
1. The `autopilot` → `autopilotApi` rename + id gate. Then the low-coupling
   leaves: `main_core.js`, `main_help.js`, `main_players.js`.
2. `main_readouts.js`, `main_progress.js` (where the shared `let` state
   concentrates; ownership rules do the work).
3. `main_draw.js`, `main_input.js`.
4. `main_events.js`, shrink composer, add `dom_stub.cjs`, update
   `interface.test.js`.

Per file, in order: cut the range into the new file with the IIFE removed and
`'use strict';` added → move that area's `$(id)`/DOM consts with it → collapse
loose `let`s into a state block at the top → id gate → `node --check file` →
`node experiments/interface.test.js` (via dom_stub) → grep moved names across
`*.js` to confirm no other file referenced them → commit.

## Validation
- `node --check` on every `js/main*.js` after each cut.
- id-shadowing gate prints nothing but the header.
- `node experiments/interface.test.js` after every file move.
- `node experiments/browser-smoke.cjs` at the end.
- Manual pass: aim a shot, land, re-launch, switch planets/ports, open rule help,
  switch views, test mode, help gestures.
- `window.SteamView` and `root.SteamMain`-equivalent globals keep their exact
  names/values (tests read them).

## Acceptance
- ~1910 lines become ~9 files; none over ~450 lines; composer under ~150.
- Every edit scenario resolves in ≤2 files.
- Interface test and browser smoke pass; no behaviour change.
- `index.html` still runs from `file://` with no build step.

## Scope boundary
This plan moves code and renames the one id-shadowing binding. It does not change
physics, economics, aim mapping, replay encoding, bot decisions, visual result,
`style.css`, or other modules' internals; no ESM, bundler, `src/` tree or
subdirectories. Refactoring or deduplication revealed by the split are separate
plans, recorded as findings, not folded into a move.
