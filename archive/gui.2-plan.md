# gui.2 — Status bar for constant info and current messages

Source: the `draft.txt` notes under `## gui` (status bar, and the two hints that must leave the menu).

## Decisions

- **One fixed strip, two jobs.** A `.status-bar` footer is pinned to the foot of the viewport, so it stays readable while the page scrolls through the chamber, the economy row and the ledger. The left side carries *facts* that stay true all session; the right side carries *messages* that exist only while their condition does. The bar never takes part in the page grid, so the four-row layout is unchanged.
- **Facts: reserve, cargo, temperature.** These are the three states that decide what the player can do next, and they are the three the telemetry row already tags. The bar repeats them as compact `LABEL value` pairs, coloured at the same thresholds (`LOW`/`EMPTY` reserve → amber/red, `FULL` cargo → amber, any thermal derate → amber, cutoff → red). The detailed telemetry cards keep their notes and tags; the bar is the copy that stays on screen while playing.
- **Messages are per-condition, not a queue.** Each message owns a preallocated node, so a grounded ball and a low reserve are shown side by side instead of one replacing the other. An empty text hides its node; nothing is created per readout.
  - `#status-ball` — the ball's own state, moved out of the drive panel: `Ball held · press E to release`, `Ball held · enable drive to release`, `Overheated · wait for cooling` / `Insufficient energy to lift ball`, `Ball grounded · move over it to collect`, `Ball in flight · n powered pushes`. Tone: `info` for the neutral states, `warn` (amber) while the ball waits on the ground or needs a command, so the grounded ball is the orange message the draft asks for.
  - `#status-energy` — `Park on the centre pad to refill · click low ground to travel`, tone `danger` (red). Shown only while *both* apply: the reserve is below 10% (the telemetry `LOW`/`EMPTY` threshold) and the platform is on the ground to act on it. "On the ground" is the platform's base height under its current position (`physics.platformBaseAt`) versus its height, so the message pauses during a short drop off a rise. Standing on the pad clears it, because the first half of the advice is already being followed.
- **The menu keeps no prose for these.** The drive panel's status line and the `RECOVERY · CHARGE` hint are gone; the section keeps only its title, its `?` mark and one line pointing at the bar. The `charge` help topic gained a sentence naming the bar, so the explanation still has a home.
- **Tone is an attribute.** `.status-message[data-tone]` and `.status-facts b[data-tone]` carry amber/red, written only when the severity changes, so a settled page performs no redundant DOM writes (the same rule the rest of the readout follows). The message container is the single `role="status"` live region, so a screen reader announces each new message once.

## Suggested implementation

- `index.html`: `<footer class="status-bar">` after `</main>` with `#fact-reserve`, `#fact-cargo`, `#fact-temp` and the two hidden message paragraphs; `#status` and the recovery hint removed from the drive panel.
- `styles.css`: fixed bar with a top border and a blurred backing, facts left, messages right (`margin-left: auto`), amber/red tones driven by `data-tone`, `body { padding-bottom }` so the flow never ends under the bar, and a narrow-screen block where the bar shrinks to 9 px and the messages wrap under the facts. The help drawer keeps a higher z-index, so its bottom sheet covers the bar on touch screens.
- `js/main.js`: `setMessage(node, text, tone)` and `setTone(node, tone)` guards, `platformGrounded()`, and one `statusReadout(reserveWarning, onPad, cargoFull, thermalFactor, temperature, canLaunch)` called at the end of `readout` with the values the readout already measured.
- `experiments/interface.test.js`: the settled-readout test counts writes on `#status-ball` and `#fact-reserve`; a new test drives a grounded ball and a low reserve and asserts text, tone, hiding and the markup that no longer holds the old hint.

## Acceptance

- The bar is visible without scrolling, at every width, and never covers the last row of the page.
- A grounded ball shows `Ball grounded · move over it to collect` in amber; the message clears when the ball is collected.
- A reserve under 10% on the ground away from the pad shows `Park on the centre pad to refill · click low ground to travel` in red; parking on the pad, refilling, or being off the ground hides it.
- Reserve, cargo and temperature facts track the telemetry values and turn amber/red at the same thresholds.
- No panel repeats the two moved hints; the help drawer explains them.
