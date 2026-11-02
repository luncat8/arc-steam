# autopilot.3 — the intercept works the ball it can keep in play

Reported from play with `BALLS · 2 shared`: the rig rushed a landing it could never
reach, arrived after the ball had already grounded, and by then the other ball's
landing had become the sooner one, so it turned back — over and over. A ball lying
on the floor was never collected while the other was in the air, the status line
changed its mark several times per shift, and some shifts had no ball in play at all.

Reproduced headless (`experiments/tmp-two-ball-check.cjs`, deleted): with the ball
the rig may push landing soonest on the far side of the chamber, the intercept
crossed the whole floor for a mark 8 m out of reach (prediction `gap = 6.6 m`,
`reachable = false`) while a second ball lay on the floor 3.4 m away, and the
platform then locked into a ~4 s cycle between the two landings.

## Policy

- **The plan is priced, not inherited from `focusBall`.** Every ball `mayPush`
  allows is solved with the ballistic computer and scored by the outcome it can
  still reach and the seconds until the rig has it under control. The score is a
  pair, not a scalar: `MEET` (a landing the platform can be under in time, or a
  ball already held) beats `RECOVER` (a ball on the floor, a landing out of reach,
  a trajectory with no landing yet) whatever the times are.
  - `held` — control 0.
  - landing the platform can be under in time — control = the contact time.
  - grounded ball — control = the drive to it at the economical controller's
    pace (`pacingTime`: triangle below `approachSpeed 2.5`, else `r/pace + pace/a`).
  - landing out of reach — control = `max(path.time, pacingTime(reach)) + 0.35`,
    because the run keeps its deadline but the pickup it will probably become is
    what it is worth.
  - trajectory with no landing — control = `max(path.time, pacingTime) + 1`.
- **Commitment is part of the policy.** A challenger must offer 0.6 s of control
  over the ball already in the plan (the same `ballCommit` the competitor bot
  uses), and the choice is remade 4 times a second instead of on every step. Two
  flights therefore cannot make the platform dither between landing marks:
  measured plan changes in a 120 s two-ball shift fell from 14.0 / 21.9 / 21.9 /
  30.4 to 5.3 / 11.9 / 10.9 / 10.7 across the four duty combinations.
- **One policy choice, published as a hint.** The intercept writes `world.focus`;
  `physics.focusBall` returns a held ball first, then honours the hint while it is
  still a rig-pushable ball in the chamber, and only then falls back to the
  soonest landing. `world.ball`, prediction, the ballistic overlay, the drive and
  tilt keepers, the ball readout, the plans — all keep reading one ball, so the
  change cannot split the plan across two policies. `setBallMode` clears the hint
  with the balls it named.
- **The reachability bound starts from the speed the platform has.** `physics.coverage`
  (and its inverse `physics.travelTime`) is now the one travel model: full thrust
  from the current speed towards the mark, to the speed limit, then cruise.
  Prediction's `gap`/`reachable` and the intercept's own feasibility both use it,
  so a platform already rolling at a mark is not called short and one rolling away
  is not called reachable — the `gap ≈ 0.2 m` flapping at a mark the platform was
  standing on is gone.

## What did not work

- **Cost-only selection** (a single additive scalar, 180 s sweeps): an out-of-reach
  landing plus 0.35 s still beat a reachable intercept, and chasing it kept the
  rig from catching anything — `any` 98 % → 78 %, timed 99 % → 72 %. Recovery and
  intercept must not be folded into one number, hence the tier.
- **Pacing the recovery** (`commandTravel` skipping the rush when the plan was a
  recovery, `contactIn = 0`): broke three tests. A landing called unreachable can
  still catch the edge of the reflector, so a recovery keeps its deadline and its
  `contactIn`, and only a ball that is already on the floor is driven to at the
  economical pace.
- **Detouring for the spare** (routing the intercept through a grounded ball's x):
  neutral for `chase` and worse for `chase only` (mined 292 → 255 cells, bounces
  36 → 33). The tier rule already gives the spare every window where no landing can
  be met.

## Reading it

`js/main.js`: with more than one rig ball the clause names the one being worked
(`Intercept · ball 2/2 · 13.3 m in 0.49 s`), and the two fallbacks say what they
are — `no landing yet, following the ball at 6.4 m` and `landing out of reach,
collecting at 12.6 m`.

## Measurement

`node experiments/two-ball-trips.cjs` → `experiments/logs/autopilot.3-trips.txt`
(120 s per start, starts 3…21 m, force 60 %, one platform, mean over seven starts;
`sw` = plan changes, `downS` = seconds per shift with both balls on the floor):

| policy | any | bounces | groundings | sw | travel | draw | mined | bothdown | downS |
|---|---|---|---|---|---|---|---|---|---|
| chase, before | 100 % | 34 | 5.3 | 14.0 | 88 m | 15907 J | 303 | 1.4 | 0.4 s |
| chase, now | 100 % | 36 | 4.6 | 5.3 | 76 m | 14182 J | 355 | 0.4 | 0.1 s |
| timed, before | 99 % | 35 | 6.9 | 21.9 | 131 m | 12926 J | 280 | 2.1 | 1.2 s |
| timed, now | 100 % | 38 | 5.0 | 11.9 | 89 m | 6101 J | 399 | 1.1 | 0.5 s |
| chase only, before | 99 % | 35 | 6.9 | 21.9 | 137 m | 22947 J | 257 | 1.6 | 0.6 s |
| chase only, now | 100 % | 36 | 5.7 | 10.9 | 112 m | 19494 J | 292 | 1.3 | 0.5 s |
| timed only, before | 97 % | 35 | 8.3 | 30.4 | 150 m | 13463 J | 276 | 2.1 | 3.4 s |
| timed only, now | 99 % | 36 | 6.4 | 10.7 | 131 m | 8985 J | 352 | 1.9 | 1.3 s |

Reserve draw falls 11 % / 53 %, travel 14 % / 32 %, plan changes 62 % / 46 %, rock
mined rises 17 % / 43 %, and the time both balls lie on the floor drops 71 % / 48 %
(chase / timed). The energy ledger balanced to 5e-9 J in every sweep.

Single ball is untouched: `node experiments/autopilot-trips.cjs` before and after
the change is byte-identical (the selection only ever sees one ball there).

## Cost

Warm `autopilot.update` with two shared balls: **31 µs** per step, the same as with
one (the selection runs 4 times a second and reuses the shared solver; the plan
cadence, the keepers and the allocation-free per-step path are unchanged).

## Tests

`node --test experiments/*.test.js` — **153 / 153**.

- `experiments/autopilot.test.js` (13) — `twoBallWorld(nearX, nearY, farX, farY)` and
  "a landing out of reach never takes the plan from one the rig can meet" (focus is
  the reachable ball, `interceptX ≈ ball.x − pistonCentre`, `recovering` false, the
  bounce happens, the far ball grounds without a chase) and "with two shared balls a
  spare on the floor is worked when no landing can be met" (focus is the spare,
  `interceptX == spare.x` exactly, `contactIn == 0`, `recovering`, held within 10 s).
  The far-mark plan test now also asserts `recovering === true` and `contactIn > 0`.
- `experiments/balls.test.js` (15) — "the autopilot keeps a ball in play across a
  two-ball shift instead of trading both" (60 s: ≥ 10 bounces, ≤ 6 groundings, ≤ 10
  plan changes, both balls never down together for 1 s, `world.focus` equals the
  last `focusBall`, ledger exact) and "the intercept hint is honoured only while it
  is a rig ball in the chamber" (a foreign ball and a removed ball are ignored; a
  re-seat clears the hint).
- `experiments/prediction.test.js` (11) — "reachability starts from the speed the
  platform already carries" (parked: short; rolling at `speedNow()` at the mark:
  reachable with `gap < 0`; rolling away: short again).
- `experiments/physics.test.js` (34) — "the travel model and its inverse describe the
  same run to a mark" (`travelTime(coverage(t, v, …)) ≈ t` for v ∈ {−6, 0, 2.5, 11}
  and t ∈ {0.05, 0.5, 1.7, 4}, cruise is `d/topSpeed`, a reversal costs more, a
  reached mark costs nothing).
- `experiments/interface.test.js` (27) — the shared-two variant toggles `auto-move`
  and asserts `#autopilot-status` matches `/^Intercept · ball [12]\/2 · /`, then
  hidden.

Every new case was checked against the pre-fix source: stashing
`js/physics.js js/prediction.js js/autopilot.js js/main.js` fails three of them
(including "the ball it can meet is the one it works"), and the two-ball shift test
fails on the plan-change count with the old selection.

## Validation

- `node --check js/*.js` — clean, `git diff --check` — clean.
- `node --test experiments/*.test.js` — **153 / 153** (autopilot 13, balls 15,
  ceiling 13, commune 7, economy 3, engine 1, equipment 3, interface 27, physics 34,
  players 15, prediction 11, research 4, shop-services 7).
- `node experiments/autopilot-trips.cjs` before and after the change — byte-identical
  output, which is the one-ball guarantee the selection has to keep.
- `experiments/browser-smoke.cjs` was not run: it needs `playwright`, which this
  sandbox has no browser download for. The `#autopilot-status` clause is covered by
  the interface run instead.

## Next

- `waitmax` is 67–102 s per run: one ball can be abandoned for most of a shift while
  the other is kept in play. That is the intended trade — a MEET always wins — but
  it reads badly, and a variant that collects a spare when the live ball's landing
  is far away (rather than merely unreachable) might cut it without losing saves.
- ~1 both-down event per run remains (`downS` 0.1–1.3 s): two landings on opposite
  sides of the chamber in the same second cannot both be met by one platform.
- One reproducible non-catch is still unexplained: a ball with `contactIn ≈ 0`,
  `gap ≈ 0` and `reachable = false` that the platform was standing under still
  grounds. Diagnose it before tuning selection weights further.
- `heldS` is 0 in every sweep — no ball is ever held for a whole step, because the
  drive keeper launches it on the step it is caught. If a held ball should ever be
  parked (no reserve, duties off), the score treats held as control 0, so the rig
  would stand on the held ball and leave the other flight alone; that case has no
  measurement yet.
