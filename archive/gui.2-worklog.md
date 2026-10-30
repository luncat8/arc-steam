# gui.2 — Status bar for constant info and current messages

Source: `draft.txt`, `## gui` (status bar, and the two hints that must leave the menu). Plan: `gui.2-plan.md`.

## Review of the previous step

- The drive panel was the last place that held live prose: the ball's state line and the `RECOVERY · CHARGE` hint both sat at the bottom of a column that uses `contain: size` + `overflow-y: auto` next to the chamber. On a short viewport the tail of that column scrolls, so the one line that says what to do with a grounded ball — or where to refuel — could be out of sight while playing. That is the concrete reason the messages moved to a fixed bar instead of only being renamed.
- The two hints also repeated each other: the drive panel said "park on the centre pad" while the reserve telemetry note said "Low reserve · park on the centre pad" and the empty state said "hand-crank crawl to the centre pad". The bar now states the reserve advice once, from one place, and only while it applies.
- Nothing else in the previous step needed changing: the readout guards, the `data-warning` telemetry tags and the `refresh()`/`sceneDirty` split all carried over unchanged.

## Implementation

- `index.html`: `<footer class="status-bar">` after `</main>`, outside the page grid. Facts `#fact-reserve`, `#fact-cargo`, `#fact-temp` as `LABEL value` pairs; `#status-ball` and `#status-energy` as preallocated hidden messages inside one `role="status" aria-live="polite"` container. Removed `#status` from the drive panel and replaced its recovery hint with a one-line pointer at the bar.
- `styles.css`: fixed bottom strip (`inset: auto 0 0 0`, `z-index: 20`, blurred backing, top border), facts left, messages right with `margin-left: auto`, tones driven by `data-tone` (amber `warn`, red `danger`) for both facts and messages, `body { padding-bottom }` so the last row never ends under the bar, and a `max-width: 760px` block that shrinks the bar to 9 px and lets the messages wrap under the facts. The help drawer keeps `z-index: 30`, so its bottom sheet still covers the bar. Removed the dead `#status` rule.
- `js/main.js`: `setMessage(node, text, tone)` (empty text hides, text and tone written only on change) and `setTone(node, tone)`; `platformGrounded()` compares the platform height with `physics.platformBaseAt` for its current x and angle; `statusReadout(...)` takes the values `readout` already measured (`reserveWarning`, `onPad`, `cargoFull`, `thermalFactor`, `temperature`, `canLaunch`) and writes the three facts plus both messages. `readout` now computes `canLaunch` once and passes it to both `setDisabled` and `statusReadout` instead of calling `physics.canLaunch` twice.
- `js/help.js`: the `charge` topic names the bar and says when the grounded-ball and low-reserve messages appear.
- `README.md`: the layout section documents the bar, its facts, its messages and the thresholds.
- `experiments/interface.test.js`: the settled-readout test counts writes on `#status-ball` and `#fact-reserve`; a new test asserts the facts' formats, the amber grounded message, the red reserve message appearing away from the pad and disappearing on it, the reserve fact's amber tone, and that the markup no longer carries `#status` or the moved hint.
- `js/main.js` / `experiments/dom.cjs`: `fitStatusBar()` writes `body.padding-bottom = bar height + 12 px`, and a second `ResizeObserver` on the bar re-runs it. The CSS value is only the pre-script fallback. The bar changes height when the messages wrap, so a fixed CSS offset was wrong at both ends: 36 px left the phone's second message under the page, and a phone-sized 56 px would have left a gap on wide screens. With the fit in place the flow ends exactly above the bar at every width (laptop 24 px bar / 36 px padding, phone 55 px bar / 67 px padding). The DOM shim gained `style`, `offsetHeight` and one callback per observer for this — it previously kept a single resize callback, which would have silently disabled the canvas resize.

## Validation

- `node --test experiments/*.test.js` — **114/114 tests pass** (interface 22, up from 21).
- `node --check js/main.js`, `node --check js/help.js`, `git diff --check` pass; `styles.css` braces balanced.
- The new interface test drives the real page wiring: with the ball grounded away from the platform, `#status-ball` reads `Ball grounded · move over it to collect` with `data-tone="warn"`; with the reserve at 5% and the platform at 3 m, `#status-energy` reads `Park on the centre pad to refill · click low ground to travel` with `data-tone="danger"` and the reserve fact turns amber; moving to the pad hides it again, and a full reserve with a held ball leaves only the info message.
- `node experiments/browser-smoke.cjs` under real headless Chromium (recipe in `findings-pitfalls-skills.md`): PASS, no page errors, including the four-row layout and the narrow/touch passes.
- Screenshots at 1440 × 900, 1100 × 900, 390 × 844 and 320 × 700, scrolled to the foot of the page, with a forced state (reserve 80 J, platform at 4 m, ball grounded at 20 m): the bar shows `RESERVE 0.08 kJ` in amber, `CARGO 0/100`, `TEMP 20 °C`, then `Ball grounded · move over it to collect` in amber and `Park on the centre pad to refill · click low ground to travel` in red, and the last panel clears the bar by 12 px at every width, with no horizontal overflow. On a phone the facts take the first line and the two messages wrap under them; play was paused before each shot, because screenshotting a page that keeps repainting the canvas times out.

## Next

Two follow-ups worth taking:

1. Sweep the rest of the workspace prose into the bar or the drawer: `#prediction-status` and `#autopilot-status` are still full sentences inside the scrolling controls column, and they are the same class of "current message" as the ball line. A third message slot (or a per-source tone pair) would finish the job the draft started.
2. Let the bar carry the sell/ledger outcome, so a sale at a wall is visible without scrolling to the market: `#transaction-status` is the last message that lives far from the chamber.
