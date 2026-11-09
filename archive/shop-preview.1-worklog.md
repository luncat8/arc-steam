# shop-preview.1 — worklog

## Step 1 — read the current tree

`js/main_progress.js` builds one `#progression-tree` grid: `#spec-card` in row
5, column 3, `#tree-root` in row 1, and ten `.tree-node` cards in rows 2–5. The
specification is a `<dl>` of ten `<dt>`/`<dd>` pairs and `specReadout()` writes
each `<dd>` from the live physics every readout tick (100 ms). Rows are
`<b>`, `<button>`, `<small>` triples; tier families add a `<select>`.

## Step 2 — hypothetical channels instead of a second profile

`physics.installed()` and `ceiling.installed()` are the only places an
equipment profile and a research profile are summed. Both gained an optional
`extra` map, and every `*Now()` reader that consumes them forwards it:

- `dryMass`, `forceNow`, `speedNow`, `pulseNow`, `retentionNow`,
  `rockRetentionNow`, `ballMassNow`, `conductanceNow`, `radiatorArea`,
  `recoveryNow` in `js/physics.js`; `damageMultiplierNow` and `damageRadiusNow`
  in `js/ceiling.js`.
- `reserveNow()` reads the installed mass and force, so it takes the owner and
  the map too; `dryMass()` gets the engine from `engineNow(owner, extra)`, which
  is how an engine swap previews. `packMass()` follows `reserveNow()`.

Existing callers are untouched — `installed(channel)` with no map is the live
path — and the whole suite still passes, which is what makes the preview safe:
it is the same arithmetic the machine already runs, fed one extra row.

## Step 3 — one preview state in the progression module

`previewDeltas` is a single preallocated map (no per-hover object), plus
`previewResearch`, `previewEquipment`, `previewRadiator` and `previewBall` to
fill it. `previewHover` is the `(hover: hover) and (pointer: fine)` query, so
touch devices get the `✱` mark and desk pointers get the hover, from the same
record. `applyPreview(record)` reads the record's kind: a tier record previews
its selected entry, a research record its node, a buy record its item.

## Step 4 — the strip writes once per render

`writeSpec(owner, extra)` walks the ten measures once, formats the value with
the shared `specFormats` table, and signs the difference against the same
measure written without the map. `specReadout()` keeps the 100 ms cadence but
returns early while a hover preview holds the strip; a pinned preview is
re-rendered when the owner changes or the previewed row's state changes.

## Step 5 — layout that cannot move

`#spec-card` moved to grid row 1 spanning three columns, `#tree-root` to row 2,
`treeLayout` rows shifted by one. Each measure became `<div><dt/><dd/></div>` so
the `<dl>` can lay out one line per measure in two columns (one on a phone).
`.spec-delta` reserves `3.4em` and hides with `visibility`, so the live value
never shifts and the strip's height never grows. The `✱` mark joined the
purchase button in a `.row-actions` cell inside the button's own track; rows
with nothing to preview (installed, researched) keep the cell and fold the mark
away, so no row changes height, wrapping or button position.

## Step 6 — validation

- `node --test experiments/*.test.js` — 229 / 229. Three new interface tests:
  hover preview (mark, strip flag, `+1%` with `data-tone="gain"`, no spend, no
  research, live value restored on leave), pin/release with `aria-pressed` and
  the purchase-driven drop, and the tier family swap (`vent` +7.50 W/K,
  changing the list under the preview to `bank` re-reads it at +35.00 W/K, the
  live value returns after leaving).
- Existing assertions updated for the new DOM: `buttonOf`/`previewMarkOf`/
  `specValue`/`specDelta` helpers in `experiments/interface.test.js`, the
  action-cell index in `experiments/commune.test.js`, and the strip's
  ten-cell count in `experiments/browser-smoke.cjs`, which also gained the
  position, height-stability and pin checks.

Next: if a future tree grows past one screen at 1440×1000, the strip can stay
sticky at the top of `.tool-drawer-content` while the cards scroll under it —
the grid cell is already the first child, so only a `position: sticky` and a
background are needed.

## Step 7 — three fixed columns per measure

The strip laid a measure out as label on the left and `dd { display: flex;
flex: none }` on the right, justified apart. The value was the first flex item
of that `dd`, so every time the number changed width — `1135 N` to `980 N`, or a
difference wider than `3.4em` such as `−1.0 cells` — the whole value box
re-measured and the text slid sideways on the 100 ms readout tick.

- `.spec > div` is now a two-track grid (name `minmax(0, 1fr)`, the readout
  block `auto`) and `.spec dd` is a two-track grid of its own:
  `--spec-value: 76px` and `--spec-delta: 70px`. The value is a `.spec-value`
  span right-aligned in its track; the difference is still a `.spec-delta` in
  the next, left-aligned so `91% +1%` reads as one phrase, and still hidden with
  `visibility` so an empty change column holds its width.
- 76 px holds the widest live value (`14.0 cells`, `48.30 W/K` at 11 px
  monospace); 70 px holds the widest signed difference (`+35.00 W/K`). Both fit
  a 380 px phone with the label still 168 px wide and no ellipsis.
- `main_progress.js` only names the span (`shown.className = 'spec-value'`); the
  DOM order is untouched, so the `specValue`/`specDelta` helpers and every
  interface test still address the same nodes.

Measured in a headless Chromium (built for this sandbox: `@sparticuz/chromium`
plus NSPR and NSS compiled from the mozilla mirrors, `LD_LIBRARY_PATH` on the
dist, `PLAYWRIGHT_PATH=playwright-core`):

- a value's `getBoundingClientRect()` left/right/top over 1.2 s of live readout
  ticks: 0.00 px on all ten measures;
- the same boxes under a hover preview and under a pinned preview: 0.00 px, and
  the strip height did not change;
- `.spec-value` width is 76 px on all ten rows at 1440×1000; the science
  drawer keeps `scrollWidth == clientWidth` and `scrollHeight == clientHeight`;
  at 380 px the measure list folds to one column, labels are not truncated and
  the sheet still scrolls only vertically.

The smoke test needed three fixes to run at all: `.row-actions > button` now
matches the `✱` mark as well, so the row buttons are addressed with
`:not(.preview-mark)`; `ArrowRight` from *Remaining strength* selects the next
radio in DOM order (*Damage*), not *Minerals*; and the low click's travel check
waits for the `#motion` readout instead of a fixed 400 ms. It also gained the
column checks above (one width, one x before and during a preview).

Next: the strip still spends the slack of a 1100 px drawer between the name and
the value. If the tree grows, the same three tracks can be reused in three
measure columns (350 px per row at desk width) without touching the layout
rules — only `.spec`'s `grid-template-columns` changes.
