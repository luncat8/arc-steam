# help.1 — Context help drawer: compact panels, explanations on demand

Source: the request for a help drawer with context help, reachable by mouse-over and by a
gesture that suits a device without a mouse, because long explanatory text inside the panels
made the GUI larger than the compact layout wants.

## Decisions

- **One drawer, many topics, one content source.** All explanatory copy moves out of the panels
  into `js/help.js` as flat data: `id`, `label`, `title`, `text` paragraphs, optional `keys`
  rows. The page renders whichever topic was asked for into a single `#help-drawer`, so a topic
  is content, not markup, and adding one is a data entry. Panels keep a short status line.
- **Three ways in, one for every input device.** A `?` mark sits in each panel title and beside
  each control section:
  - a hovering, precise pointer previews the topic on `pointerenter` without taking focus, and
    a click there pins the preview instead of closing what the pointer just opened;
  - a touch or stylus device has no hover, so a tap opens the drawer and the same tap closes
    it, and a **press and hold on any panel for half a second** opens that panel's topic
    without hunting for a small mark — the gesture a finger already has;
  - `H` / `F1` toggles the drawer from anywhere and reopens the last topic read, `Escape`
    closes it, and a focusable mark inside the open drawer retargets it.
- **Hold means hold.** Only a press that stays put for half a second counts: moving more than
  12 px, releasing early, or pressing something a press already means (a button, a field, a
  slider label, the chamber canvas) cancels it. Holding a control that has its own drag or
  press behaviour must never open help.
- **Panels opt in by topic, not by markup.** A panel carries `data-topic`; the gesture walks up
  from the pressed node to the nearest `data-topic` ancestor, so a `?` mark, a panel title or a
  control section can all name the same topic without extra code.
- **A drawer, not a modal.** It never blocks the chamber: game keys keep working while it is
  open, and it has no scrim. On a narrow screen it becomes a bottom sheet that a downward drag
  on its head dismisses, so it cannot cover the top of the play area on a phone.
- **The content is shortened where it was a manual.** Explanations that the drawer now owns are
  replaced in the panels by one-line status lines, and the mode-dependent panel introductions
  keep their mode information in a single short clause instead of a paragraph.

## Design

- `js/help.js`: `SteamHelp.topics` (13 topics: keys, chamber, drive, movement, tilt, autopilot,
  charge, research, equipment, cargo, market, inspector, modes) and `SteamHelp.find(id)`.
  Classic script with the usual `module.exports` guard, so Node tests load the same data.
- `index.html`: a `?` mark (`button.help-mark`) per topic plus the `HELP H` button in the
  system bar, each carrying `aria-haspopup="dialog"`, `aria-controls="help-drawer"` and
  `aria-expanded`; `data-topic` on the eight panels; the drawer itself with a head, title, body,
  topic index and foot hints. Long panel hints were reduced to status lines.
- `js/main.js`: `openHelp`, `closeHelp`, `toggleHelp`, `renderHelp`, `setHelpState`, `helpKey`,
  the hold gesture (`heldTopic`, `endHelpPress`), the swipe-to-dismiss on the drawer head, and
  the binding of every mark and index entry. The body is rebuilt only when the topic changes,
  so moving along a row of marks costs one comparison per mark.
- `styles.css`: the drawer is fixed to the right edge, slides in on `transform`, and flips
  `visibility` instantly on open (only after the slide on close) so its own controls are
  focusable the moment it opens; below 760 px it becomes a bottom sheet. Reduced motion drops
  the transition. Marks are 18 px circles that fill with the accent colour on hover, on focus
  and while their topic is shown.

## Acceptance

- Every panel shows at most one short hint line; no explanation lives in markup.
- A hovering pointer previews a topic on hover, and that click does not close the preview.
- A tap opens the drawer on touch, the same tap closes it, and holding a panel for half a second
  opens that panel's topic; a drag, a release or a press on a control opens nothing.
- `H`, `F1` and `Escape` work from anywhere; focus returns to the invoking control (or leaves
  the hidden drawer when the preview had no invoking control).
- The topic index reaches all topics, marks report `aria-expanded`, and the drawer reports
  `aria-hidden` when closed.
- No horizontal overflow at 1440, 1100 and 390 px, and the compact panels keep their content
  height when stacked.
