# players.8 — independent progression and the competitor's level bounce

## Goal

Make every platform an independent competitor rather than a purse attached to
the rig's globally researched machinery. A player researches and buys with its
own credits, its installed upgrades change its own machine, and a bot invests
its sale income without drawing on another player. Complete the machine policy
with the same tilt keeper the rig uses.

## Decisions

- **One progression profile per platform.** Research completions, owned and
  installed equipment, engine tiers, radiators and strike balls are keyed by
  player id. The existing no-owner API addresses the rig; passing a player id
  addresses that competitor. New game clears every profile.
- **The purse pays for the purchase.** Rig purchases keep the existing shared
  sales/purchase ledger. A competitor purchase debits only its purse and adds a
  frozen entry to its own ledger. Communism makes every player's purchase free;
  test grants cover every player. A sale's gross proceeds and lifetime spending
  remain separately visible.
- **Bots invest at settlement.** A bot competitor follows a deterministic build
  order after a wall sale, buying what it can afford and saving the rest. Its
  first chain earns its own ballistic computer; later purchases improve pulse,
  travel and retention. During a safe flight it makes short rubble sweeps around
  the landing, yielding back to the real intercept before contact, so a level
  bounce does not starve its income. A manual competitor uses the same
  SCIENCE + SHOP drawer through the selected-player controls.
- **Upgrades belong to the machine.** Force, speed, dry/carried mass, deck
  retention and bounce pulse read the selected machine's profile. Engine swaps
  use that machine's shop position. A strike ball belongs to its owner in the
  one-per-platform arrangement; shared balls retain the rig's physical ball
  specification. Mass changes preserve momentum without touching another
  player's purse or the rig's energy ledger.
- **The computer is purchased per platform.** `predictAll` returns no page
  paths until the selected machine owns Ballistic computer. Policy forecasts
  remain separate and are not an overlay unlock. Tier II and all forecast
  machine statistics likewise read that machine's own profile.
- **Every bot levels its own reflector.** A competitor prices its next piston
  contact on its own machine, bisects the tilt range with `solveFace`, and slews
  at the physical actuator rate. Its drive keeper prices the reflected apex,
  including the chosen tilt, rather than pulsing every contact. Manual tilt and
  drive commands get the same temporary override as manual travel.
- **The drawer follows the selection.** Research states, prerequisite edges,
  prices, equipment ownership, engine/radiator/ball tiers, available funds and
  the live platform specification all describe the active player. Switching
  players never transfers a completion or a purchase.

## Files

- `js/research.js`, `js/equipment.js` — per-player profiles, purchases and
  grants, optional player id on the existing rig API.
- `js/players.js` — competitor purse ledger, bot build order, per-machine
  engine tuning and the tilt/drive keeper.
- `js/physics.js`, `js/ceiling.js` — per-machine equipment channels and mass,
  per-owner strike-ball properties, competitor engine selection.
- `js/prediction.js` — selected-machine computer gate and per-machine forecast.
- `js/main.js` — selected-player shop, grants, specification and computer gate.
- `js/help.js`, `README.md` — independent progression and policy rules.
- `experiments/*.test.js` — profile/purse isolation, real competitor upgrade
  effects, bot investment, computer ownership and the competitor tilt keeper.

## Acceptance

- Two players can research the same node independently; either purchase leaves
  the other player's completion, equipment and purse unchanged.
- A competitor's coil, motor and engine choices change its own pulse, force,
  speed and mass, not the rig's. Owned balls use their owner's strike-ball spec.
- A bot buys its own computer and machinery from sale proceeds, never from the
  rig, and an unaffordable purchase leaves a balance saved for the next sale.
- A selected machine with no computer has no page overlay even when another
  player owns one; buying it for that machine restores only its overlay.
- A competitor bot bisects its own contact with `solveFace`, keeps the tilt
  inside range and slew rate, and yields to manual tilt and drive commands.
- The full test suite passes with the new per-player interface coverage.
