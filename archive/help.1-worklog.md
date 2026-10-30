# help.1 — Context help drawer: compact panels, explanations on demand

## Review of the previous step

- `0.2.4` (ball upgrades) added two more equipment rows and left the shop panels long: the
  research and equipment panels carried a paragraph of introduction, and the controls panel
  carried four more paragraphs between its controls. On a 1440 px screen the side columns
  scroll, so the play row was no longer compact, which is the layout the `gui.1` step aimed for.
- The page already had one seam for exactly this kind of change: a single writer per concern
  (`setViewMode`, `setCommune`, `setChannel`) and content built once at startup. The help
  drawer follows it — one drawer, one renderer, one open state, and the panel copy moved into
  data instead of being duplicated between panels.
- The old copy was also load-bearing: `experiments/commune.test.js` asserted on the panel
  introductions ("Research debits funds once…"), so moving the text had to move those
  assertions to the short lines that state the mode, not silently drop the coverage.

## Decisions

- **Content lives in `js/help.js`.** Thirteen topics as flat data (`id`, `label`, `title`,
  `text`, optional `keys`). A topic is a data entry, not markup, and the Node tests load the
  same file the page does.
- **One drawer, three ways in, one per device.**
  - hover a `?` mark with a precise pointer → preview without taking focus;
  - a click on a hovered mark pins the preview (closing what the pointer just opened would be a
    trap), while on touch the same mark toggles open and closed;
  - **press and hold any panel for half a second** → that panel's topic. This is the gesture for
    a device without a mouse: a finger already presses the panel it is reading, and the mark is
    a small target on a phone. A press that moves more than 12 px, or that lands on a button, a
    field, a slider label or the chamber canvas, cancels or never starts the gesture, so a hold
    never steals a click, a drag or a press-and-hold control.
- **`H` / `F1` toggles, `Escape` closes, and the foot index switches topics** inside the open
  drawer. All of them go through the same `openHelp` / `closeHelp` pair; the last topic read is
  remembered, so `H` reopens what the player was reading.
- **Non-modal.** The drawer has no scrim and no focus trap, so `A`/`D` and the rest keep working
  while it is open. Below 760 px it becomes a bottom sheet that a downward drag on its head
  dismisses, because a phone-width side drawer would cover the chamber.
- **Panels keep a status line, not a manual.** The one-line hints are dynamic where the mode
  matters: the research and equipment introductions now read `Pay once, effect applies at
  once.` / `All nodes granted · effects already applied` and so on, driven from the same
  `refreshUpgrades` that already knew the mode.

## Implementation

- `js/help.js`: the topic table and `find(id)`; classic script with a `module.exports` guard.
- `index.html`: twelve `button.help-mark` marks (one per topic) and the `HELP H` system-bar
  button, each with `aria-haspopup="dialog"`, `aria-controls="help-drawer"` and
  `aria-expanded`; `data-topic` on the eight panels; the drawer markup (head, title, body,
  index, foot); long hints replaced by single lines; the obsolete ad-hoc `title=` tooltips on
  the two mode switches dropped because the drawer now explains them.
- `js/main.js`: `openHelp(id, takeFocus)`, `closeHelp(restoreFocus)`, `toggleHelp`,
  `renderHelp`, `setHelpState`, `helpKey`, the hold gesture (`heldTopic` walking up to
  `data-topic`, `endHelpPress`, the 12 px cancel radius), swipe-to-dismiss on the drawer head,
  and binding for every mark and index entry. The body is rebuilt only when the topic changes.
- `styles.css`: the drawer (fixed, right edge, `transform` slide, instant `visibility` on open
  and delayed on close so its controls are focusable immediately), the bottom-sheet variant
  below 760 px, `prefers-reduced-motion`, `18 px` marks that fill with the accent colour on
  hover/focus/active, `.eyebrow-row` so each control section has its own mark, and
  `.upgrade-row select { min-width: 0; width: 100% }` because the radiator and ball tier
  selectors were widening the page below 390 px.
- `experiments/dom.cjs`: markup attributes are now read from the tag into `element.attributes`,
  so tests can assert the `aria-controls` / `aria-expanded` wiring as authored; the tag scan is
  anchored on `id`, so an attribute before `id` no longer hides an element.
- `experiments/interface.test.js`: two new tests (drawer behaviour with mouse and touch
  pointers; the hold gesture, including the cancelling cases) plus assertions that the compact
  panel lines stay short. `experiments/commune.test.js`: the introduction assertions moved to
  the new short mode lines, and `help.js` is loaded like the other page modules.
- `experiments/browser-smoke.cjs`: hover preview, click pin, `Escape`/`H`, the held panel, and
  the touch page (tap to open and close, the bottom sheet, focus inside the sheet).

## Validation

- `node --test experiments/*.test.js`: 113 tests pass (was 111; the help drawer adds two). The
  new interface tests cover hover preview without focus, the click that pins instead of
  closing, the touch tap toggling both ways, the hint-switching marks inside an open drawer,
  `H`/`F1`/`Escape` with focus restoration, the half-second hold, and the four cases that must
  not open help (a button, the canvas, a drag, a released press).
- `node experiments/browser-smoke.cjs` under the headless Chromium from
  `findings-pitfalls-skills.md`: PASS with no page errors. It now checks the hover preview, the
  slot index, focus inside and outside the drawer, `H`, a real mouse hold on the cargo panel
  title, and on a touch page a tap that opens and the close button that dismisses it.
- Full-page screenshots at 1440 and 390 px reviewed. Two defects were found this way: the
  inspector title wrapped because the `?` mark sat next to the number, now a `panel-meta`
  group with `white-space: nowrap`; and the radiator/ball tier `select` elements pushed the
  page to 550 px wide at a 390 px viewport, now shrinking to their column.

## Next step

The drawer is the only place the copy lives now, so the next natural step is to let the
ballistic-computer and autopilot status lines announce themselves in the same drawer instead
of a paragraph (`autopilot` topic) — a small extension of `autopilotText`. Beyond the
interface, the open measurement from `debris.1` still stands: whether the 300 cr road grader
earns its keep against the value of the rubble it recovers.
