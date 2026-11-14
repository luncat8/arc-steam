# autopilot.3 — the intercept works the ball it can keep in play

Source: play with `BALLS · 2 shared`, where the rig followed the ball landing
soonest and that ball was often one the platform could not reach: it crossed the
chamber for a mark that was already lost, arrived after the ball had grounded, and
found the other ball's landing had become the sooner one meanwhile. Two flights kept
trading the plan, a ball lying on the floor was never collected while another was in
the air, and the status clause changed its mark several times per shift.

## Decisions

- **A ball is chosen by the outcome the rig can still reach, not by when it lands.**
  Every ball `mayPush` allows is solved with the ballistic computer and scored as a
  pair: the outcome tier, then the seconds until the rig has that ball under control.
  `MEET` — a ball already held, or a landing the platform can be under in time — is
  the only outcome that keeps a ball in play. `RECOVER` — a ball on the floor, a
  landing out of reach, a trajectory with no landing yet — puts a ball back in play
  only after it has been lost. Tier before time, so giving up a landing to chase a
  pickup is not something the policy can do, whatever the distances are.
- **Control time is the tie-break inside a tier.** Held is 0. A landing that can be
  met costs its contact time. A ball on the floor costs the drive to it at the
  economical controller's own pace. A landing out of reach costs `max(path time,
  drive)` plus a small penalty for the grounding it could not prevent; a trajectory
  with no landing costs the same with a larger penalty, because it promises nothing.
  A recovery costs nothing by waiting, so a spare on the floor is worked as soon as
  no landing can be met — and never at the price of one that can.
- **Commitment is part of the policy.** A challenger must offer 0.6 s of control
  sooner than the ball already in the plan — the same commitment the competitor bot
  uses (`ballCommit`) — and the choice is remade four times a second instead of on
  every step. Two flights therefore cannot make the platform dither between landing
  marks, which is what the reported flapping was.
- **One policy choice, published as a hint.** The intercept writes `world.focus`;
  `physics.focusBall` returns a held ball first, honours the hint while it is still
  a rig-pushable ball in the chamber, and otherwise falls back to the soonest
  landing. `world.ball`, prediction, the ballistic overlay, the drive and tilt
  keepers, the ball readout and the plans keep reading that one ball, so the policy
  never splits into two answers about which ball the rig is working. Re-seating the
  arrangement clears the hint with the balls it named.
- **Reachability starts from the speed the platform already has.** One travel model
  serves both directions: `physics.coverage` gives the distance a platform can push
  towards a mark in a time from its current speed at its current force setting
  (thrust to the speed limit, then cruise, braking unbudgeted), and
  `physics.travelTime` inverts it to the earliest arrival at a mark. The ballistic
  computer's `gap`/`reachable` and the intercept's feasibility both use it, so a
  platform already rolling at a mark is not called short and one rolling away is not
  called reachable.
- **A recovery keeps its deadline; a pickup has none.** A landing called out of
  reach is still run for, because a reflector edge can catch it, so the plan keeps
  the contact time and the timed controller's deadline. Only a ball already on the
  floor is driven to at the approach pace, because there is no flight left to meet.
  Both are stated in the status line instead of promising an intercept.

## Design

```
outcome of a ball                          control time
held                                       MEET     0
landing the platform can be under in time  MEET     contact time
grounded                                   RECOVER  drive to the ball, approach pace
landing out of reach                       RECOVER  max(path time, drive) + 0.35
no landing predicted (rock, horizon)       RECOVER  max(path time, drive) + 1.0
```

`drive` is the economical profile for a mark with no deadline: accelerate to
`approachSpeed`, cruise, brake at the mark (below that speed, the accelerate/brake
triangle). Feasibility is measured on the reflector-face mark, not the raw landing:
`coverage(contact, sign·vx, a, vmax) >= |mark − platform.x| − 0.4`.

Selection: lowest `(tier, control time)`, the ball already in the plan getting
`ballCommit` of credit, remade at 4 Hz, and it writes `world.focus`. The plan for
that ball is rebuilt at 20 Hz or when its situation changes, and the commands are
recomputed every step. Two preallocated plan records carry the candidate and the
live plan, so nothing allocates per step and both sides of the comparison are priced
by the same function.

## Files

- `js/physics.js` — `coverage`/`travelTime` as the shared platform travel model;
  `world.focus` as the intercept's hint, cleared by `setBallMode`;
  `focusBall` validates the hint after a held ball and before the soonest landing.
- `js/prediction.js` — `predict(world, target)` prices any ball of the chamber (the
  page's overlay and readouts omit the target and get the focused ball), and the
  reachability bound starts from the platform's own speed.
- `js/autopilot.js` — `planBall` (mark, deadline, contact, tier, control time for one
  ball) shared by the 4 Hz selection and the 20 Hz plan; ownership of `world.focus`;
  `focus`, `recovering` and `uncertain` on `state`.
- `js/main.js` — the status clause names the working ball (`ball 2/2`) and says when
  the landing is out of reach or not predicted yet, instead of promising a mark.
- `js/help.js`, `README.md` — the arrangement and autopilot topics say what the
  intercept chooses and what the clauses mean.
- `experiments/two-ball-trips.cjs` — the seeded two-ball measurement; its output is
  `experiments/logs/autopilot.3-trips.txt`.

## Acceptance

- With two shared balls, a landing the platform cannot reach never takes the
  intercept from one it can meet, however much sooner it lands.
- A ball on the floor becomes the plan whenever no landing can be met, so the rig
  collects a ball it could not keep in the air instead of standing under another.
- Two flights no longer trade the plan: the choice changes when an outcome changes,
  not whenever a landing time crosses, and a ball is worked for at least as long as
  its recovery lasts.
- A one-ball chamber is unchanged: same ball, same marks, same deadlines, same
  commands, same ledger, byte-identical trips.
- The panel names the ball being worked and never promises an intercept it cannot
  make; the full suite passes and the energy ledger stays exact in every
  arrangement.
- The two-ball measurement shows fewer groundings, more bounces and rock mined, less
  travel and reserve draw, and roughly half the plan changes per shift.
