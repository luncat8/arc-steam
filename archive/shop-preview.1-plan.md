# shop-preview.1 — the specification leads the tree, and a row can be previewed

Status: implemented; see `archive/shop-preview.1-worklog.md`.

Source: the request to move the live preview to the top of the panel, to show
what a research or buy row would change before it is bought, as signed and
green/red differences beside the readouts, with a small `✱` control for touch,
and without any change of height or position while a preview is on.

## What is wrong

- **The specification is a footnote in the corner.** `#spec-card` sits in row 5,
  column 3, under the last tree card. It is the panel a purchase is judged
  against, and it is the one thing on screen that a row's effect is compared
  with — yet it is the last thing the eye reaches and it is cut down to a
  single narrow column.
- **A row states its effect in prose and nothing else.** *"Reflector bounce
  retention +3%"* has to be added to the live retention in the head to know what
  the machine would do. A locked row is worse: it states an effect that cannot
  be measured until the prerequisite is bought.
- **Every action row is one button.** There is no way to ask what a row would
  do to the machine without doing it, and no touch-friendly way to hold an
  answer on screen while a finger is lifted.

## Decisions

- **The specification is the tree's first cell.** `#spec-card` spans all three
  columns in grid row 1, the Base Chassis root moves to row 2 and every node
  row follows. It is built by `buildUpgrades` like every other cell, so the DOM
  order matches the visual order and nothing needs an inline grid position.
- **Ten measures, one line each, three columns per measure.** Name, value and
  change: the name takes the slack while the value and its difference each keep
  a track of their own, so the strip is five rows rather than ten stacked pairs
  and every number reads in a column. Two measure columns fit the drawer's
  1100 px at desk width and fold to one below 760 px, where the tree is already
  a single column.
- **A preview is a hypothetical channel map, not a second profile.** The
  physics and the ceiling take an optional `extra` argument on
  `dryMass/forceNow/speedNow/pulseNow/retentionNow/rockRetentionNow/
  conductanceNow/recoveryNow/damageMultiplierNow/damageRadiusNow` and add it to
  the installed deltas. `installed()` in both modules is the only place the two
  profiles are summed, so a preview is one extra map and nothing is written to
  a player. A hover can never buy, research or apply anything.
- **A swapped tier previews the difference, not the sum.** Engines, radiators
  and balls fit one unit at a time: their preview replaces the installed
  channels (`previewRadiator`, `previewBall`, and an `engine` override read by
  `engineNow`), which is also how the mass and the reserve pack stay honest.
- **Green is better, red is worse, and the mass is the one measure where less
  is better.** `specLowerIsBetter` flips the tone for the dry mass only, so the
  lighter chassis reads as a gain while the sign still says `−`.
- **A difference is only shown where it is a difference.** The compare step is
  the value's own displayed precision (`specDigits`), which is why retention
  and rock retention — shown as whole percents — report a +1% research and not
  a rounding artefact.
- **Nothing moves.** The value is right-aligned in a `--spec-value` track and
  the difference sits in a `--spec-delta` track beside it, both fixed, so a live
  readout that runs from 980 to 1040 N and a preview that adds a signed
  difference land in the same columns and the number keeps its x. The
  difference is a `.spec-delta` span that hides itself with `visibility`, so an
  empty column still holds its width and the strip's height never grows. The
  `✱` mark lives in a `.row-actions` cell inside the button's own grid track; a
  row with nothing left to preview folds the mark away with transparent colours
  instead of removing it, so its box and the button's position survive.
- **Pointer hover and touch pin are the same preview.** Fine pointers preview
  on `pointerenter`/`focus` and withdraw on `pointerleave`/`blur`; a tap on `✱`
  pins the preview (`aria-pressed`) so the strip can be read with the finger
  off the screen. One pinned preview at a time, owned by the player it was
  opened for; a purchase, a research, a player switch or a tier list change
  releases it, and a row whose effect is already installed drops it at once.
- **The readout tick does not withdraw a hover.** `specReadout` skips its live
  write while a hover preview holds the strip, otherwise the 100 ms readout
  cadence would flicker the difference away under a resting pointer.

## Validation

- `node --test experiments/*.test.js` — 229 / 229 passing, including three new
  tests: the strip leads the tree and previews a hover without buying, the `✱`
  mark pins and releases the same preview, and a tier family previews a swap.
- `experiments/browser-smoke.cjs` checks the strip's position above the cards,
  that every value keeps one width and one x across a hover (the three fixed
  columns), a hover's marked row and signed difference, that the strip height is
  unchanged by a preview, and the pin/release round trip. Its row buttons are
  addressed as `.row-actions > button:not(.preview-mark)` because the `✱` mark
  is a second button in the same cell.
- Both suites were run against a headless Chromium: 229 / 229 unit tests and the
  browser smoke test pass, with 0 px drift of a value's box over readout ticks
  and 0 px shift or height change while a preview is on, at desk width and at
  380 px.
