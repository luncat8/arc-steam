# players.9 — worklog

Plan: `players.9-plan.md`. Answered the opening question with a measurement,
then fixed the three things the measurement exposed: the blade destroyed the
value it shaved, the garage grader's dome lifted the platform, and the rivals
spent their purses on research their own policy cannot read.

## What was wrong

- **The blade deleted what it shaved.** `grade()` scaled a column's value down
  with the height it removed, so every cubic metre the road grader planed off
  the floor left the chamber unpaid. The 300 cr tool was not a weak earner; it
  was a value sink that also cost 10 kg and 45 N of rolling resistance.
- **The garage grader's dome was ground.** `platformGroundAt` took
  `ceiling.botSurfaceAt(x)` into the platform's terrain, so the 0.12 m dome
  under a wheel lifted the chassis and the deck by 0.12 m — moving the deck
  contact line out from under the falling ball. The design draft is the
  opposite ("platform easy run above it once it pass behind wheels"), and the
  dome is below the 0.2 m belly.
- **The bot build order bought things a rival cannot use.** It spent 520 cr on
  the page ballistic computer and 320 cr on impact metallurgy. A rival's policy
  reads pulse, force, mass and tier II only (`traceFlight` gates the horizon on
  `predictionBounces`); it has no page overlay, no heat model and no ball-tier
  choice, so those credits bought nothing, and the pad, coil-gated items and
  flywheel queued behind them.
- **The opening probe was measuring nothing for its headline variant.**
  `grader-worth.cjs` tested `strategy.includes('road')`, and `'both'.includes(
  'road')` is false, so the "proposed opening" row was a byte-for-byte copy of
  the baseline row. The previous session's numbers for it were an artefact.
- **A refusal path would have crashed on a no-prerequisite item.** The row text
  for a locked item called `SteamResearch.find(item.requires).name`, which the
  grader — the one item with no `requires` — cannot satisfy.

## What was done

- `js/ceiling.js`
  - Every graded column now keeps its value density: the shaved material moves
    from `floorValues` into a `blade` claim instead of evaporating, so the
    floor and the ledger can never disagree.
  - The claim settles as one frozen `blade` ledger entry at the garage grader's
    50 % share after a quarter second without finding rubble, or on reset. Under
    Communism `price()` makes the credit zero and nothing is booked.
  - Grading now requires real translation (`|vx| > 0.02` or a held direction).
    A platform parked on its mark used to keep grinding a fixed swath; with a
    settlement rule that would also have never ended a stint.
- `js/physics.js` — `platformGroundAt` no longer reads the dome. `botSurfaceAt`
  keeps reporting the grader's silhouette for drawing, `shop-services` and the
  shop card; it is simply no longer terrain.
- `js/equipment.js` — `rigOnly(id, owner)` marks the road grader as the rig's
  own tool. It is false for `isUnlocked`, refused inside `install`, and not
  waived by Communism, which waives prices rather than ownership rules.
- `js/main.js` — `buyEquipment` names the rig-only reason before the
  prerequisite path, so no lookup can dereference a missing `requires`; the
  market drawer renders the new `blade` entry type.
- `js/players.js` — the build order is now pulse → force → mass → forecast:
  materials, electromagnetics, coil, traction, motor, alloys, chassis,
  thermodynamics, power, overdrive, ballistics, ballistics2, pad. The cooling
  chain, strike metallurgy and flywheel are off the list entirely.
- `experiments/grader-worth.cjs` — rewritten: per-variant flags instead of
  substring matching, 8 seeds, 480 s, a 240 s midpoint, liquid wealth only
  (purse + hopper + the garage grader's unsettled 50 % claim), income and
  spending separated, and a `blade free` row that grants the machine instead of
  selling it to separate price from physics.
- `experiments/*.test.js` — four tests added, two rewritten to the new
  contracts.
- `README.md`, `js/help.js` — the blade's share, the rig-only rule, the domed
  garage and the "buy what the policy reads" build rule.

## Validation

- `node --check` passed for every `js/*.js`.
- `node --test experiments/*.test.js`: **194 pass, 0 fail** (189 at the end of
  players.8; +5 from this stage: dome, blade settlement, rival-grader refusal,
  rival build order, and the rival's locked shop row).
- Opening probe, `experiments/logs/players.9-grader-worth.txt`, 480 s, 8 seeds,
  pad-aware mining policy, net = purse + hopper + unsettled garage share:

  | opening | 240 s | 480 s | delta |
  | --- | --- | --- | --- |
  | none | 396 | 546 | — |
  | commercial at 0 s | 1165 | 1492 | +946 |
  | road grader when affordable | 472 | 811 | +265 |
  | commercial, then road | 963 | 1273 | +728 |
  | commercial + materials + pad | 641 | 1073 | +527 |
  | commercial, blade granted | 1078 | 1704 | +1158 |

  Catches rose from 16 % to 21 % of extracted cells in the commercial row after
  the dome fix (22 % with no grader at all), confirming the deck stopped riding
  the dome. The blade's own share reached 395 cr in the paid row, so the machine
  pays for itself in income — what it costs is the timing.
- Blade accounting probe: a 0.01 m floor shaved to zero over two passes booked
  exactly one blade entry per pause, credited exactly half the floor's value
  loss (ratio 2.000000000), never produced a negative pile or value, and left
  the energy balance untouched (`sync`-relative error 0.000000 J).
- Three-rival, 120 s economy soak with the new build order: every rival's
  `soldValue === money + spent`, each stopped on the first step it could not
  afford, and the chamber's energy error stayed at 2.3e-9 J.
- Note on a harness artefact found while testing: `harness.earnFunds` stages
  fragments into the moving rig's collector before selling, and a caught
  fragment is surfaced rubble the ceiling ledger never counted as chamber
  energy, so `balanced()` shows −6446.9544 J after any `earnFunds` call. It is
  identical on the previous commit and unrelated to this stage; the new blade
  test re-bases with `sync()` after staging and documents why.

## Next step suggestion

- Give the blade a policy, not just a price. The probe says the machine is the
  strongest opening available (+1158 cr granted) and the 300 cr at t ≈ 60 s is
  what makes it the weakest sold one. Measure a `save to 900 cr first` row and a
  "buy after the force chain" row in `grader-worth.cjs`; if the second wins, the
  shop should say when, and the blade's price should key off floor depth.
- The commercial grader's share is the largest single income source in the game
  (963–1199 cr per shift, ~3× the rig's own sales). If that is too dominant, the
  50 % share and the garage's wall-to-wall route are the two dials; measure both
  against the `none` row before retuning.
- Run `experiments/browser-smoke.cjs` in a real Chromium when a binary is
  available: the blade settlement adds a ninth ledger wording, and the rival
  grader row is now a locked `Buy` button whose click must explain itself.
