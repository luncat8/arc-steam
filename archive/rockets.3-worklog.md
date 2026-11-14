# rockets.3 worklog — owner-specific racks and rival service trips

## Context

`archive/rockets.2-plan.md` and `archive/rockets.2-worklog.md` describe the
original rig-only rack and rig bot duty. This milestone removes that owner
restriction while preserving the measured rocket behavior and its no-new-energy
ledger rule.

## Progression review

The rack is an optional shop item unlocked by the existing **Impact forging**
node: 480 cr and +8 kg, with six rounds per rack. Each round remains a separate
14 cr wall purchase, up to three per wall visit. Every player researches and
installs their own rack.

This is the working recommendation, not a user-confirmed progression decision.
Impact forging already unlocks strike-ball metallurgy, and rocket shards weaken
rock through the same `SteamCeiling.chip` / collapse path. That makes Impact a
closer fit than Ballistic computer research, which currently predicts the ball
rather than controlling projectiles. A new node would add a research cost and a
card/edge to the fixed three-column tree without granting a distinct simulated
capability. Keep the current gate unless rockets gain a separate researchable
effect (such as selectable fuse behavior or guidance); then a dedicated node
would have a real purpose rather than being an unlock-only toll.

## Implementation

- `js/rockets.js`: each owner has separate stock, firing cooldown, wall-visit
auto-buy count, standing order and counters. Fixed shared rocket/shard pools
carry owner tags; each player fires from their own machine and fragments retain
the firing owner. Purchases debit the rig's market ledger or the rival's own
purse and purchase ledger. The per-owner profiles survive New game only for
the standing order; stock and counters reset.
- `js/equipment.js`, `js/research.js`, `js/main_progress.js`: added the
Impact-gated Rocket rack shop item and exposed it alongside the strike-ball
tiers under Impact forging. Communism waives the research and item/round costs;
test mode installs and fills every roster member's rack.
- `js/physics.js`, `js/main_input.js`, `js/main_readouts.js`,
`js/main_draw.js`: sell-wall checks, R/Fire, Buy, auto-buy, stock/status and
the visible launch tube follow the active or owning player.
- `js/players.js`: rivals with installed, loaded racks can travel to a rich
free-face seam, fire one round and hold for the early fall window while their
ball keepers remain active. A full hopper keeps priority. The rig retains its
sale → charge → rocket priority and its existing hand-override behavior.
- `README.md` and `js/help.js` now describe the optional per-player rack,
Impact gate, separate ammo price, owner-specific controls and bot operation.
`experiments/browser-smoke.cjs` now installs the rack under Communism before
firing its real-page rocket scenario. `experiments/rocket-yield-probe.cjs`
likewise installs the equipment before measuring the unchanged 14 cr round.

## Validation

- `node --test experiments/*.test.js` — 351 tests, all pass.
- `node --check` on changed JavaScript and CommonJS test/smoke files — clean;
  `git diff --check` — clean.
- Real Chromium: `experiments/browser-smoke.cjs` PASS with no page errors.
- Real Chromium: `experiments/browser-layout.cjs` PASS at 11 viewports,
including the existing narrow and wide layouts.
- `node experiments/rocket-yield-probe.cjs` — 126 firing samples; 3-cell
median, 4.2-cell mean, 2.6 cells in the first 5 s, and 14.5 cr mean caught
value at ordinary-rock prices for a 14 cr round (wide per-shot variance).
- New coverage verifies per-player research/install, rack stock, rival wall
purchases and auto-buy purse/ledger isolation, orders surviving New game,
owner-tagged launch positions, a rival bot firing without consuming rig stock,
full-hopper priority, and selected-player controls/test-mode fills.

## Next step

Playtest two or more bots working the same seams and measure each owner's
rocket payback under competition. Revisit a dedicated research node only if a
new, independently testable rocket capability is designed.
