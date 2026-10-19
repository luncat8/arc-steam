# commune.1 — Communism mode: everything is free

Source: the request for a "communism mode: all free" — a sandbox switch that takes the credit economy out of the game without touching the simulation.

## Decisions

- **The mode is a pricing rule, and the economy owns it.** Every price in the game already funnels through two economy calls: `SteamCeiling.purchase` (equipment, research) and `SteamCeiling.recharge` (bought energy). The mode therefore lives in `js/ceiling.js` beside the funds it rules, as a single boolean with `setCommune(value)`, a `price(cost)` helper and a `state.commune` getter. Every other module asks the economy, so there is one source of truth for "what does this cost now" and no module has to know how the mode is implemented.
- **Free means free, and the gates go too.** "All free" is read as the commons handing out the machinery: research is free, equipment is free, the emergency resupply is free, and the research tree stops gating anything — every node and every item is available on the first click. A mode that still made the player click through the tree in order would keep the pacing the mode is meant to remove.
- **The measured effects still apply.** A free drive coil still adds 12 J of pulse, a free chassis still cuts 12 kg of dry mass, a free flywheel still returns 55% of braking energy, and the energy ledger stays exact. The mode changes prices and gates only; it never changes the simulation's constants, so a free run and a paid run measure the same machine.
- **The ledger keeps the money trail.** A free purchase is still a ledger entry, with `credits: 0`, so the transaction list stays a complete record of what was taken and when. The panel renders a zero-credit entry as `free` rather than `−0 cr`.
- **Sales are still measured.** The market still prices cargo and still records sales, because the extraction economy is the thing being measured. In the mode the funds card reads `commons` instead of a credit total, and the note says that nothing costs.
- **It is a setting, not world state.** A new game resets the world, research, equipment and the ledger, but it keeps the mode, the same way the rock shape is a setting rather than a world feature. Switching the mode off restores every price and every gate at once; nothing already researched or installed is taken back.
- **One writer.** The system-bar switch and the `M` shortcut both go through a single `setCommune` in `js/main.js`, which sets the economy flag, syncs the checkbox and refreshes the panels, so the switch and the economy can never disagree.

## Design

- `js/ceiling.js`: `commune` flag, `price(cost)` (zero in the mode), `setCommune(value)`, `state.commune`. `purchase` books the effective price, so a free purchase debits nothing and records `credits: 0`; `recharge` imports the whole gap for nothing and `rechargeCost` reports zero. `reset` does not touch the flag.
- `js/research.js`: `status(id)` returns `AVAILABLE` for every node in the mode, so a node with an unmet prerequisite is researchable on the first click. The node's measured deltas are applied exactly as before.
- `js/equipment.js`: `isUnlocked(id)` returns true in the mode, so an item whose research node is missing is installable on the first click.
- `js/main.js`: the `#commune` switch in the system bar, the `M` shortcut, a `priceLabel` helper that prints `FREE` instead of a price, the row titles rebuilt from the mode on every refresh, the blocked flag that stops testing the balance in the mode, the row notes and the two panel introductions that stop asking for funds and prerequisites in the mode, the market panel reading `free`/`commons`, and the ledger wording that prints `free` for a zero-credit entry.
- `index.html` / `styles.css`: the switch in the system bar next to the rock shape, styled like the other system-bar controls, with the checked state in the accent colour; the funds card's note gains an id so it can say what the mode means.

## Acceptance

- With the mode on and an empty purse: every research node and every equipment item is available and installs on the first click, and the funds never leave zero.
- The emergency resupply fills the reserve from empty for nothing, and the energy balance error stays at zero.
- With the mode off: a node with an unmet prerequisite is locked, an item without its research is locked, a purchase without funds is refused, and the reserve cannot be refilled without credits.
- The panels follow the mode: row titles read `FREE`, no upgrade button is blocked for money, the market shows a free import, the funds card reads `commons`, and a free entry is booked in the ledger as `free`.
- The switch and the `M` shortcut drive the same state in both directions, and a new game keeps the mode.
