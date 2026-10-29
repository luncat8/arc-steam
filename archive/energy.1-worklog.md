# energy.1 — Hand-crank rescue, grounded-ball re-seat, pad-aware shift measurement

Sources: the `draft.txt` energy section (re-audited against the code), and the
next steps left by `terrain.1`, `0.2.0` and `commune.1`/`debris.1`. Decisions
and acceptance in `energy.1-plan.md`.

## Review of the previous step

- The draft's energy rules were already implemented (platform-funded bounce
  and the three-push recovery in 0.1.1; the centre charge pad in 0.2.0;
  collector catch-and-hold), which a fresh audit against `js/physics.js`
  confirmed line by line. The gaps were interactions with later milestones:
- Since `terrain.1` the floor is a live rubble heightmap, but a grounded ball
  never re-seated on it: a probe that raises the piles under a resting ball
  leaves it buried 0.5 m below the rendered surface (and a grader cut would
  leave it floating). Grounding booked the resting potential once and the
  grounded branch then returned early forever.
- An empty reserve off the pad with no funds was a soft-lock, encoded as
  intended behaviour by an economy test ("stops the platform until credits
  buy energy back") — but with zero credits there is nothing to buy with, and
  the EMPTY telemetry note ("reach the centre pad") named an action the
  platform could not take.
- `terrain.1` never got its browser pass, and the queued measurements (a
  pad-seeking policy from `0.2.0`; grader worth from `debris.1`/`commune.1`)
  were still open.

## Decisions

Recorded in `energy.1-plan.md`. In short: empty reserve falls back to the
draft's original manual drive (hand crank, 60 N, 0.8 m/s cap, booked as
imported crew work in `world.crankEnergy`; braking unchanged; no launch or
pulse on crank power); a grounded ball re-seats on the rubble surface every
step (down = heat, up = terrain work); the pad keeps charging through
settled rubble (measured pad-column dusting is ~0.015 m average after a busy
120 s shift, so a clear-pad gate would punish the early game for nothing);
the calibration policy became pad-aware instead of buying energy.

## Implementation

- `js/physics.js`: `crankForce`/`crankMaxSpeed` config, `world.crankEnergy`,
  crank path in `movePlatform` (active only at `battery <= 0`, never adds
  speed above the faster of the crawl and the current coast), grounded
  re-seat in `advanceBall`.
- `js/main.js` / `index.html`: EMPTY reserve note now gives the crank
  instruction; recovery panel explains the crawl and its movement-only limit.
- `experiments/mine-trips.cjs`: pad-aware progression (parks under 20%
  reserve until 95%, buys no energy, shift runs to the 240 s cap), a
  communism-plus-grader variant, per-shift crank energy and floor-pile
  metrics. Final numbers in `experiments/logs/engine.1-trips.txt` (rerun
  after the engine.1 retune in the same session).
- Tests: crank crawl to the pad with exact booking; crank never supplements
  a charged reserve or a faster coast; grounded re-seat up and down with the
  ledger exact; the economy soft-lock test rewritten around the crawl; the
  interface EMPTY-note expectation.
- `experiments/browser-smoke.cjs`: scroll the chamber back into view before
  the inspector clicks (below-fold panel clicks had pushed its top out of
  the viewport; pitfall recorded in `findings-pitfalls-skills.md`).

## Validation

- `node --test experiments/*.test.js`: 101/101 at this milestone's checkpoint
  (104/104 after engine.1).
- Probe before/after: grounded ball buried 0.500 m → riding the surface at
  `floorAt + radius`, balance error 0; stranded platform at x = 4 immobile →
  crawling at exactly 0.8 m/s with `crankEnergy` equal to its kinetic energy.
- Headless Chromium smoke: PASS, no page errors — the first full run since
  `terrain.1`. Screenshots at 1440 and 390 px: soil tiles and the pad plate
  read clearly, the chassis rides a synthetic rubble ramp, no horizontal
  overflow (0 px at 390).
- `experiments/logs/engine.1-trips.txt` (final tuning): every pad-aware
  progression shift runs the full 240 s on pad imports alone (29.5 kJ smooth
  / 33.9 kJ square per shift, 0 bought recharges), where the same policy
  without pad use collected 0.2–1.2 kJ incidentally and died with the
  reserve. Crank energy is 0.00 kJ in all 64 measured shifts — a rescue,
  never a strategy, as designed.
- Grader worth (the `commune.1` question): in free shifts the grader cuts
  settled piles from 11.97 to 1.09 column-m (smooth) and 9.34 to 1.31
  (square), tallest pile 0.44–0.50 m down to 0.15–0.25 m. Its income effect
  under the scripted policy is seed-sensitive (smooth 528→343 cr, square
  158→271 cr), so it reliably does its physical job but is not a guaranteed
  earner; price and mass unchanged on this evidence.

## Next step

The energy loop is closed and survivable at every state; what remains open
from the plan is the era decision (coal/steam consumable vs electric storage)
behind "charge/refuel according to engine". Engine *tiers* now exist
(engine.1), so an era would change what the pad dispenses and what a reserve
is, not how fast the platform goes. Decide the era before further economy
tuning; after that, wear accounting is the last unbuilt operational trade-off.
