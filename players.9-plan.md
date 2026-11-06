# players.9 — the grader opening, measured

## Goal

Answer which early opening pays, and make the road grader an honest tool rather
than a purchase that quietly destroys what it shaves. Review the previous stage
for anything the opening exposes: the commercial grader's dome lifting the
platform, the bot build order buying what its own policy cannot use, and the
shop's treatment of the rig-only blade.

## Decisions

- **The free call is the opening; the blade is not.** A measured 480 s shift
  (`experiments/grader-worth.cjs`, 8 seeds, pad-aware mining policy, liquid
  wealth = purse + hopper + the garage grader's unsettled 50% share) leaves

  | opening | net at 240 s | net at 480 s | delta at 480 s |
  | --- | --- | --- | --- |
  | mine and sell only | 396 cr | 546 cr | — |
  | garage grader called at 0 s | 1165 cr | 1492 cr | **+946 cr** |
  | road grader as soon as affordable | 472 cr | 811 cr | +265 cr |
  | garage grader, then road grader when affordable | 963 cr | 1273 cr | +728 cr |
  | garage grader + materials + rebound pad | 641 cr | 1073 cr | +527 cr |
  | garage grader, blade granted free | 1078 cr | 1704 cr | +1158 cr |

  The commercial grader is the opening: calling it at 0 s nearly triples a
  shift and is still worth +769 cr by the halfway mark, because it harvests
  floor value the rig's own trips never reach. The road grader is **not** the
  second purchase: bought at the first 300 cr it ends 219 cr behind simply
  calling the grader, and +265 cr is the weakest of every upgrade measured.
  The blade granted free is the strongest opening of all (+1158 cr), which
  separates the two causes: the machine is good — its blade earns 369–395 cr
  of its own shavings and deepens the floor the garage grader works — and the
  *timing* is the problem. A 300 cr blade at t ≈ 60 s spends the purse that the
  pulse and force chain compounds from, and the machine's +10 kg with 45 N of
  rolling resistance costs trips for the rest of the shift. The opening is
  therefore **call the grader, put the next credits into the machine's contact
  (pulse, force, mass), and buy the blade once the floor is deep and the drive
  can carry its drag**.
- **The blade keeps its shavings.** `grade()` used to scale a column's value
  down with the height it removed, so the shaved material left the chamber
  unpaid. The blade now accrues the shaved value and settles it when the
  platform comes to rest, exactly like the garage grader's 50 % share: one
  frozen ledger entry per working stint, `price(share·value)` into funds, with
  the same zero under Communism. Smoothing still moves a column's value with
  its material, so nothing is created.
- **The dome is under the hull, not under the wheels.** `platformGroundAt` no
  longer takes `botSurfaceAt` into the platform's ground. The garage grader is
  0.12 m tall against a 0.2 m belly, and the design draft has the platform run
  *above* it once it passes behind the wheels; treating it as terrain lifted the
  wheels 0.12 m and moved the deck contact under the ball, costing catches
  (22 % → 16 % of extracted cells) in exactly the shifts the strategy uses.
  `botSurfaceAt` remains the grader's own silhouette for drawing and tests.
- **A rival neither buys nor needs the blade.** Its chassis harvests rubble by
  policy (`players.grade`), so the road grader is the rig's own tool: `Locked`
  for every competitor row and a refusal message that names the reason instead
  of dereferencing a prerequisite the item does not have.
- **Bots buy what their policy reads.** A competitor's policy reads force,
  speed, pulse and (for the keeper's horizon) tier II; it never reads page
  prediction, never buys radiators, ball tiers or a flywheel, and has no heat
  model. The build order now spends in that order — pulse, then force, then
  mass, then the computer chain that ends in tier II — instead of 520 cr on a
  page overlay the bot cannot open and 320 cr on ball metallurgy it never buys.

## Files

- `js/ceiling.js` — blade salvage accrual and settlement, dome out of the
  platform ground query, ledger type for the blade.
- `js/physics.js` — `platformGroundAt` without the grader dome.
- `js/equipment.js`, `js/main.js` — the grader is rig-only; refusal message for
  an item with no prerequisite.
- `js/players.js` — the reordered bot build order.
- `experiments/grader-worth.cjs` — fixed and extended opening probe.
- `experiments/logs/players.9-grader-worth.txt` — recorded measurements.
- `experiments/*.test.js` — dome, salvage, rival-grader and build-order cover.
- `README.md`, `js/help.js` — the blade's share and the opening it belongs to.

## Acceptance

- The platform's wheels no longer climb the garage grader's dome; the dome is
  still drawn and still reported by `botSurfaceAt`.
- A working blade credits its owner a share of the shaved value once per stint,
  books one frozen ledger entry, and never changes the energy balance.
- No competitor can buy the road grader, and the row's refusal explains why
  without touching a prerequisite that does not exist.
- A staged rival settlement buys pulse and force before any page-only research,
  and its accounting still satisfies `soldValue === money + spent`.
- The shop row for the blade reads `Buy` for the rig, `Locked` for a rival, and
  the rival's click explains the rule.
- The full suite passes.
