# commune.1 — Communism mode: everything is free

## Review of the previous step

- `debris.1` shipped the fallen-debris floor heightmap, the road grader and the 42 J drive pulse, and left a measurement open: whether the grader is economically worth running against a 300 cr price and 10 kg of mass. This step does not answer that question — the request was a game mode, and the measurement stays open.
- The economy already funnels every price through two calls (`SteamCeiling.purchase` and `SteamCeiling.recharge`), and `findings-pitfalls-skills.md` records that as the reason the ledger stays a single money trail. The mode was built on that seam instead of adding a second pricing path.
- The page has no difficulty or mode layer yet: the rock shape is the only setting, and it is a `select`. A mode that changes every price needs a switch that shows its own state, so it is a checkbox in the system bar with a key.

## Decisions

- **The economy owns the mode.** One boolean in `js/ceiling.js` with `price(cost)`, `setCommune(value)` and `state.commune`. Research and equipment ask the economy whether an item is unlocked, so there is one source of truth for "what does this cost now" and no module knows how the mode is implemented.
- **Free means the gates go too.** Research free, equipment free, emergency energy free, and the technology tree stops gating anything: every node and item is available on the first click. A mode that still forced the tree order would keep the pacing the mode is meant to remove.
- **The effects still apply.** A free drive coil still adds 12 J of pulse, a free chassis still cuts 12 kg of dry mass, and the energy ledger stays exact. The mode changes prices and gates only, never the simulation constants, so a free run measures the same machine as a paid one.
- **Sales are still measured.** Cargo keeps its price and every wall sale is still booked, because extraction is what the game measures. The funds card reads `commons` in the mode, and the note says that nothing costs.
- **It is a setting, not world state.** `reset` does not clear the flag, so a new game keeps the mode the way it keeps the rock shape. Switching the mode off restores every price and every gate, and takes back nothing that was already researched or installed.
- **One writer.** The system-bar switch and the `M` shortcut both call `setCommune` in `js/main.js`, which sets the economy flag, syncs the checkbox and refreshes the panels.

## Implementation

- `js/ceiling.js`: `commune` flag, `price(cost)`, `setCommune(value)`, `state.commune`. `purchase` books the effective price, so a free purchase debits nothing and records `credits: 0`; `recharge` imports the whole gap for nothing and `rechargeCost` reports zero. `reset` leaves the flag alone.
- `js/research.js`: `status(id)` returns `AVAILABLE` for every node in the mode, so a node with an unmet prerequisite researches on the first click.
- `js/equipment.js`: `isUnlocked(id)` returns true in the mode, so an item without its research installs on the first click.
- `js/main.js`: the `#commune` switch, the `M` shortcut, `priceLabel` (prints `FREE`), row titles rebuilt from the mode on every refresh, the blocked flag that stops testing the balance in the mode, the row notes and the two panel introductions that stop asking for funds and prerequisites in the mode, the market panel reading `free` and `commons`, the ledger printing `free` for a zero-credit entry, and a mode-aware refusal message on the recharge button.
- `index.html` / `styles.css`: the switch in the system bar next to the rock shape, checked state in the accent colour, and an id on the funds card note so it can say what the mode means.
- `commune.1-plan.md`: the standalone design artifact for this mode.

## Validation

- `node --test experiments/*.test.js`: 91 tests pass (was 84). The new `experiments/commune.test.js` covers the free research, the waived prerequisite, the free equipment, the free reserve refill with an exact energy balance, the prices and gates coming back when the mode is off, the mode surviving a new game, and an interface run over the real page wiring: the switch, the `FREE` titles, the unblocked buttons, the `commons` and `free` readouts, the free ledger entry and the `M` shortcut.
- Browser smoke in headless Chromium: the extended `experiments/browser-smoke.cjs` clicks the switch in a real browser, checks the `FREE` title, the unblocked research button, a free brake-flywheel purchase with a `Bought Brake flywheel · free` ledger entry, a funds balance of zero, and the `M` shortcut restoring the 300 cr list price. Full smoke run passes, no page errors.
- Screenshots at 1440 px and 700 px: the switch sits in the system bar and wraps cleanly with the rock shape at the narrow width; the funds card reads `commons` and the research row reads `REBOUND MATERIALS · FREE`.
- `node experiments/mine-trips.cjs` → `experiments/logs/commune.1-trips.txt`: the script gained a third variant that runs the same seeded 240 s shift with every price zeroed. The free shift owns the whole 11-node progression on the first tick for 0 cr and runs the full 240 s, while the paid variants end after 43–82 s when the reserve runs out (their 85 cr average never funds the 180 cr first node). The free machine is not simply better: it is 34 kg heavier and the ball reaches 14.6 m/s, so the extraction rate falls from 152 to 74 cells/min even though the shift runs five times longer, while the catch rate rises from 5% to 36% and the drive never derates (minimum output 100% against 70–80% in the paid runs, because the radiator and flywheel are free).
- `git diff --check`: clean.

## Next step

The free shift is measured, and it shows the mode is not only about price: the whole progression applied at once makes the platform heavier and the ball faster, so the shift mines less per minute even though it never runs out of energy or credits. That makes the mode a good instrument for the question `debris.1` left open — whether the road grader is worth 300 cr and 10 kg. Run the same free shift with and without the grader and compare cells recovered per minute and the floor piles it leaves behind; the machine is otherwise free, so the grader's price and mass stand alone. If it does not earn its mass even in a free shift, its price or its +10 kg needs retuning before the next progression node is added.
