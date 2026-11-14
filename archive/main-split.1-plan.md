# Plan: split `js/main.js` by UI responsibility

## Goal

Split the 1,910-line `js/main.js` IIFE into small, responsibility-based classic
scripts. A typical task should be locatable from a short file map and handled by
one feature file (occasionally one feature file plus its direct neighbor), not by
following a chain of shared helpers.

Keep the change behavior-preserving: no changes to physics, economy, controls,
layout, or public `window.SteamView`. Keep `file://` support, classic `<script>`
tags, and the no-build workflow.

## Architecture choice

Use ordered classic scripts with shared top-level lexical bindings. Remove the
outer IIFE and keep each split file in strict mode. This is the smallest
behavior-preserving seam for this code: most of the UI is presently one closure,
so converting each area into an isolated factory would require broad
parameter-passing or API rewrites and make small edits harder to localize.

This choice deliberately shares bindings across the `main*.js` scripts. It is
not a claim that those bindings are private modules: the file map and each
file's short `provides` / `depends` header are the navigation contract. Keep
state and its owner functions together; do not add a generic shared `state.js`,
`dom.js`, or `utils.js` layer.

Top-level `let` and `const` do not become `window` properties, but they do share
the page's global lexical environment. A duplicate lexical declaration in a
later script is a load-time `SyntaxError`; the integrated test loader must run
all `main*.js` in one context to catch this. Keep declarations unique and use
area-specific names where a collision is plausible.

## Global-name preflight

Removing the IIFE makes an element id's implicit `window` name a possible bare
identifier collision. An audit of the 183 declarations in `main.js` against the
111 ids in `index.html` found one meaningful collision:

| Existing name | Replacement | Why |
|---|---|---|
| `autopilot` | `autopilotApi` | The binding is `SteamAutopilot`; `#autopilot` is a DOM control. |

Rename the binding and all its references before splitting. Preserve the id
string and UI behavior. Keep a repeatable collision check in the migration
steps. Also check split-file declarations against one another and the globals
exported by the other scripts.

## File ownership and load order

`main.js` becomes the small **bootstrap/core** script and loads first. It owns
only shared DOM setup, aliases, the world/test flags, and truly shared DOM-write
helpers. It must not own the final startup sequence. A final `main_boot.js`
loads after feature scripts and starts them only after their declarations and
helpers are available.

| Script | Owns | Typical edit |
|---|---|---|
| `main.js` | Shared aliases (`physics`, `autopilotApi`, `playerApi`, `config`), canvas/context, id-to-node `ui`, world initialization, `testMode` / `showPrediction`, and common guarded DOM-write helpers. | Shared bootstrap or DOM-write primitive |
| `main_progress.js` | Upgrade/research tree data and DOM construction, SVG tree layout, purchase/research/commune/test-mode actions, tier slots, progression refresh and specification readout. Keep this cohesive even if it is the largest feature file. | Research tree, upgrade rows, purchase gates |
| `main_players.js` | Player-row construction, player readout, control ownership and active-player switching. | Player strip / handoff behavior |
| `main_readouts.js` | Inventory construction/state, ledger and mineral/mining/prediction/autopilot readouts, status bar messages, warning state. | Telemetry, inventory, ledger |
| `main_draw.js` | Canvas view state and geometry, resize/render helpers, scene drawing, flight and prediction drawing, labels, and draw-only player lookup. | Canvas rendering / scene geometry |
| `main_input.js` | Input and simulation state, controls, keyboard/pointer actions, piston/autopilot/view-mode interactions, and the frame loop. Put listener registration in an explicit `bindInput()` called by boot. | Controls, keys, stepping / frame scheduling |
| `main_help.js` | Help state, topic rendering, help marks, drawer behavior and gestures. Put listener registration in `bindHelp()` / `bindHelpGestures()` called by boot. | Help copy or help interactions |
| `main_boot.js` | Startup orchestration, cross-area listener wiring, tool drawers, status-bar fit, observers, public `SteamView` publication, and the one-time initial refresh/frame start. | Startup / cross-area wiring |

Load in this order in `index.html`:

```text
existing domain scripts
main.js
main_progress.js
main_players.js
main_readouts.js
main_draw.js
main_input.js
main_help.js
main_boot.js
```

The domain scripts (`help.js`, `ceiling.js`, `equipment.js`, `research.js`,
`physics.js`, `prediction.js`, `autopilot.js`, `players.js`) stay unchanged and
load before `main.js`, as they do now. Keep the split main scripts in source
order where practical; the ordering above also guarantees shared setup exists
before feature scripts execute and that startup is last.

## Safe move rules

1. Add concise file headers stating `owns`, `provides`, and direct `depends`
   symbols. The header should let an agent decide whether the file is relevant
   without opening every neighboring file. Keep dependency lists short: name
   the direct cross-file calls and state read, not the transitive dependency
   closure.
2. Move each state declaration with the functions that own and mutate it. Do
   not split one feature just to hit a line count. A cohesive larger
   `main_progress.js` is preferable to a tree-builder / tree-controller pair
   that agents must routinely load together.
3. Do not leave top-level work in a feature script that assumes later scripts
   have executed. Convert the existing `buildInventory` and `buildUpgrades`
   IIFEs into named builders and call them from `main_boot.js`. Convert direct
   event-listener setup into named bind functions owned by their feature. Keep
   initialization order explicit in boot and preserve the current order of
   effects.
4. Keep the simulation loop and its timing state together in `main_input.js`;
   keep canvas drawing in `main_draw.js`. The frame loop may call the readout
   and drawing entry points but must not duplicate their internals.
5. `main_draw.js` owns draw-only lookups and geometry. Input may use the
   published view geometry to convert pointer coordinates, but drawing code
   must not mutate game state.
6. Keep the core bootstrap small. Put `fitStatusBar`, tool-drawer behavior,
   resize observers and one-time startup in `main_boot.js`; keep actual canvas
   geometry/rendering in `main_draw.js` and control-specific event binding in
   `main_input.js`.
7. Define a single anchor-based ownership map. No source range may be assigned
   to two files, and every original top-level declaration must appear in
   exactly one owner. Use symbols and function names rather than committed line
   numbers so later edits do not stale the map.
8. Do not refactor unrelated logic or change public APIs during extraction.
   Keep `window.SteamView`'s name and shape unchanged for browser tools/tests.

## Migration stages

### 0. Establish the map

Add short section banners at extraction boundaries in `js/main.js`, without
moving code. Record a compact intent-to-file map under `AGENTS.md` → `## files`
(or link this plan there). Ensure the map lists each declaration exactly once;
resolve overlapping or omitted ownership before cutting anything.

### 1. Preflight and bootstrap

Rename `autopilot` to `autopilotApi`; add and run the id/global collision gate.
Extract the shared bootstrap into the new first `main.js`. Keep only shared
aliases, DOM references, shared write helpers, and shared world/test setup.
Check that remaining top-level initialization has not accidentally been moved
before its dependencies.

### 2. Extract cohesive feature files

Extract in the load order: progression, players, readouts, drawing, input, help.
For each area, move its owned state and complete functions together. Turn its
construction/listener side effects into named setup functions, then call those
from the final boot script. Avoid intermediate states where the page runs with
part of the old IIFE missing.

### 3. Add final boot and test loader

Move cross-area startup and one-time wiring to `main_boot.js`, loaded last.
Preserve the existing startup sequence: build inventory and progression UI;
bind controls, drawers and help; install global listeners/observers; build
player rows; set ground bounce; fit/resize; refresh; schedule the first frame.
Keep any ordering differences only when demonstrated equivalent by tests.

`experiments/interface.test.js` and `experiments/commune.test.js` currently
`require('../js/main.js')`. CommonJS gives each required file its own module
scope, so these tests cannot validate shared top-level script bindings by
requiring files individually. Add a loader to `experiments/dom.cjs` (or a small
helper used by it) that evaluates the `js/main*.js` script tags, in HTML order,
in one shared Node VM/global context. The domain modules should continue to be
required as they are today; do not evaluate them a second time. Update both
interface and commune tests to use the loader.

## Validation

After each extraction stage:

- Run `node --check` on every `js/main*.js` file.
- Run the interface and commune tests. The shared-context loader must catch
  duplicate top-level declarations and missing cross-file bindings.
- Run the id collision audit against `index.html`; verify the only intended
  identifier exception remains resolved (`autopilotApi`, not `autopilot`).
- Confirm every original declaration has one owner and no source ownership
  ranges overlap.

At completion:

- Run `node experiments/interface.test.js` and
  `node experiments/commune.test.js`.
- Run `node experiments/browser-smoke.cjs` when browser tooling is available.
- Manually smoke-test aim/launch/landing/relaunch, player switching, drawers and
  help, view modes, test mode, and reset.
- Confirm `index.html` works from `file://` with no build step and
  `window.SteamView` is unchanged.

## Acceptance

- The monolithic IIFE is replaced by a short bootstrap and cohesive area files.
- A change to a typical UI feature maps directly to one owner file; genuinely
  cross-cutting edits require only that owner plus `main_boot.js` or the direct
  dependency, not a chain of utility modules.
- No feature file is split merely to satisfy a line-count target.
- All script tags, tests, and browser smoke checks use the same explicit order.
- No behavior, public API, or file:// capability changes.

## Scope boundary

This is an organizational extraction, plus the necessary binding rename and
explicit initialization functions. Do not alter physics, economics, aim
mapping, player policy, layout, or visuals. Record newly discovered cleanup as
separate follow-up work rather than folding it into the split.
