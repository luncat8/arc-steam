# players.10 — worklog

Plan: `players.10-plan.md`. Finished the hull work the previous stage started
and left unapplied, then measured the two things a player actually sees during a
crossing — a wheel hanging in the air, and a ramp still swinging while a wheel
arrives — and fixed both at their mechanism rather than at their symptom.

## What was wrong

- **The arch that was supposed to keep the hull off a deck corner was never
  applied.** `platformKeelArch` sat at 0.25, and at that depth the corner of a
  deck being ridden over pokes through the belly 0.14 m: the crossing is
  supported on the underside 14.9 % of its frames with **both** wheels 0.12 m
  off the ground, at `localX` −0.62 on the climb and +0.90 on the run-off. The
  previous stage measured that 0.40 fixes it (99.6 % wheel-supported) and left
  the constant at 0.25.
- **The arch cannot fix it, at any value worth drawing.** Clearing a 0.6 m deck
  corner everywhere along a 3.2 m wheelbase needs about 0.50 m of depth at
  |x| ≈ 1.0, and the drawn hull's thickness there is
  `bodyTop − depth`. An arch deep enough to never beach is an arch with no hull
  left: 0.40 already leaves zero thickness at the centre. The sweep says so —
  0.25/0.30/0.35/0.40/0.45 give 14.9/10.2/5.5/0.4/0.0 % beached, and every value
  from 0.40 up is a degenerate drawing.
- **Two cheap explanations for the hanging wheel were measured and ruled out.**
  The pose's descent rate is not it: an unlimited descent changed every number
  by nothing. The pitch slew is not it either: 90°/s → 720°/s moved the worst
  stair float from 0.21 m to 0.19 m. What leaves a wheel in the air is that the
  wheels are rigid on the hull — whenever anything else carries the hull (the
  belly at a crest, the pose still coming down a 0.5 m step) the wheel goes with
  it.
- **The ramp unfolded over a fixed 2.6 m whatever was coming.** A plate needs
  0.5 s to swing down, so that reach only covers an approach slower than 4 m/s.
  At 8 m/s a leading wheel met a **28°** plate — a 0.3 m face rather than a ramp
  — and the hull came up the far side at 0.70 m, higher than the 0.6 m deck it
  was climbing onto (0.76 m at 12 m/s).
- **The fold distance measured the plate's tip against the other hull's centre.**
  `raw >= plateFoot` starts folding while the departing hull's wheel is still
  1.8 m short of that tip, which is the "go out from it may be not unfold" case:
  the ramp shuts under the wheel that is standing on it.
- **The far plate only started swinging once the rider was already on the deck.**
  A rider at 12 m/s crosses a 3.6 m deck in 0.32 s, less than the 0.5 s swing,
  so its leading wheel went over the far edge onto a 33° plate. Traced: the far
  plate reads 30° while the rider is at the deck centre and only reaches 45°
  0.17 s later.
- **The hull and the plate work had no plan, no worklog and no measurement log.**
  `README.md` and `js/help.js` described them, `archive/` did not.

## What was done

- `js/physics.js`
  - `platformWheelTravel` (0.24 m) and `wheelDrops(body, exceptId)`: after the
    pose is settled, each wheel's strut extends by however much its rigid
    contact stands above the ground under it, clamped to the travel. The pose
    solve is untouched — a strut never lifts the hull — so the deck the ball
    rides, its height, its tilt and the surface velocity reported to the contact
    solver are exactly what they were.
  - `wheelDrop: [0, 0]` on the world's platform body, mutated in place.
- `js/players.js`
  - `wheelDrop: [0, 0]` on every competitor body, and `drawWheels` puts the hub
    its drop below the hull with a strut drawn only once the wheel has dropped
    clear of the hull line (`radius * 2 − bodyBottom`), so a level machine draws
    the same two circles it always did.
  - `stepTails`: the unfold reach is the closing speed's own
    (`tailFullGap + approach · 2 · tailSwing`, floored at the standing 2.6 m);
    the fold distance is the plate's tip against the other hull's near edge
    (`plateFoot + half`); and a hull closing fast enough to cross the deck
    inside one swing (`half * 2 < approach · tailSwing`) brings both ends down
    with the near one instead of waiting to be above the deck.
- `experiments/probe-ramp.cjs` — new. Reads the plate angle at the two moments
  that matter per wheel crossing (floor → plate, deck → plate) across 1/4/8/12
  m/s, both directions, a stop on the deck, a reverse off it, and a bot rival
  crossing the rig under its own policy.
- `experiments/probe-plate.cjs` — float is now the gap a player would see, after
  the strut has reached down, and the report carries the worst strut extension.
- `experiments/two-ball-trips.cjs` — a `wallmax` column (see the old-2 note
  below).
- `experiments/players.test.js` — five tests: a wheel drops onto its strut over
  a 0.5 m stair instead of hanging over the tread behind it; the struts are
  slack while the hull sits level on the floor under drive; the drawn wheel, its
  spokes and its hub cap sit where the strut put them, with the strut itself
  drawn only once the wheel hangs clear of the hull line; a plate is down before
  a fast hull reaches it at **both** ends of the crossing; a plate holds until
  the hull beside it has passed the ramp and then folds.
- `experiments/logs/players.10-plate.txt`, `players.10-ramp.txt`,
  `players.10-twoball-wall.txt` — the recorded measurements.
- `README.md`, `js/help.js` — the hull and its struts, the reach that follows
  the closing speed, the fold that waits for the hull's near edge, and the both
  ends rule for a rider and for a fast crosser.

## Validation

- `node --check` passed for every touched file, and `node --test
  experiments/*.test.js`: **223 pass, 0 fail** (218 before this stage; +5).
  `experiments/interface.test.js` still passes against the edited help copy.
- Revert-test: with `js/physics.js` and `js/players.js` stashed, 6 tests fail —
  the new strut and ramp ones and the two existing wheel-float tests that now
  read the strut. So the new cover pins this stage and not itself.
- `experiments/probe-plate.cjs`, before → after:

  | scenario | beached | one wheel in air | both in air | worst float | worst strut |
  | --- | --- | --- | --- | --- | --- |
  | 0.2 m stairs | 0.0 % → 0.0 % | 2.6 % → 0.0 % | 0.0 % → 0.0 % | 0.03 → 0.00 m | 0.03 m |
  | 0.5 m stairs | 0.6 % → 0.1 % | 9.3 % → 0.0 % | 0.6 % → 0.0 % | 0.21 → 0.00 m | 0.21 m |
  | ride over at 2 m/s | 14.9 % → 3.3 % | 7.9 % → 0.0 % | 12.4 % → 0.0 % | 0.12 → 0.00 m | 0.12 m |
  | ride over at 5 m/s | 15.0 % → 2.8 % | 10.0 % → 0.0 % | 12.5 % → 0.0 % | 0.12 → 0.00 m | 0.12 m |

  The deepest strut in any scenario is 0.21 m of the 0.24 m travel; the resting
  case is unchanged (plate 45°, floats 0.00/−0.00).
- `experiments/probe-ramp.cjs`, worst plate angle a wheel meets, before → after:
  approach 28° → **45°** at 8 and 12 m/s and 39° → **45°** under the bot; run-off
  34° → **45°** at 12 m/s. Every row of the after-run reads 45° on both ends —
  1/4/8/12 m/s, leftwards, stopped on the deck then driven off, reversed off, and
  the bot crossing the rig. Peak ride is 0.60 m up to 4 m/s and 0.70/0.76 m at
  8/12 m/s, which is a hull cresting the deck edge at speed; with the struts its
  wheels follow it down instead of hanging.
- Ruled-out measurements worth keeping: the arch sweep
  (0.25 → 0.50 = 14.9 → 0.0 % beached, degenerate drawing from 0.40), the pitch
  slew sweep (90 → 720°/s = 0.21 → 0.19 m worst stair float), and an unlimited
  pose descent rate (no change at all).

## old-2 / 06713b577288ebaec6acdd7f29a9d79ae1fe98ea

`06713b5` is the tip of the remote branch `old-2`, the pre-squash history `main`
no longer shares an ancestor with. The commit itself adds five unmessaged
scratch probes: `probe-autopilot.cjs`, `probe-twoball.cjs`,
`probe-twoball-trace.cjs`, `probe-wall.cjs`, `probe-wall2.cjs`.

- Nothing is worth picking as a file. `probe-autopilot.cjs`'s name is already
  taken in `main` by a different, newer script, so a cherry-pick would clobber
  it; `probe-twoball*.cjs` are the ancestors of `two-ball-trips.cjs`, which
  measures strictly more (rock mined, intercept churn, joules, energy balance)
  and calls `players.update`; `probe-wall*.cjs` are one-off trace dumps.
- One *metric* was worth picking: time pinned against a wall. Nothing in `main`
  measured it. `two-ball-trips.cjs` now reports `wallmax`, and it immediately
  paid for itself — see the next step.
- Deleting the branch drops those five files and, with them, the 64-commit
  pre-squash history (commit subjects like `players.6: one deck model for every
  platform`). No code is lost, since `main` is a squash of the same tree, but
  that history is the only place those subjects exist. `refs/pull/1/head` still
  points inside it.

## Next step suggestion

- **A held ball can park the machine at a wall for over a minute.** With
  `wallmax` in place: `chase` from x0=15 holds the right wall for **36.6 s** at
  146 °C, and a 150 s run of the same start holds it for **67.5 s** with a ball
  in the collector and the second ball flying free the whole time. The mechanism
  is two rules that are each correct: `canLaunch` needs
  `launchCapacity > m·g·h`, and `launchCapacity` is derated by `thermalFactor`,
  so above the cutoff the release is refused — and `autopilot`'s intercept
  returns nothing while `world.ball` is held ("a held ball is already under
  control and has no flight to meet"), so the machine does not go and work the
  other ball either. It never recovers on its own because the ball it is holding
  is not the one keeping the chamber hot. Two candidate fixes, both needing
  their own measurement: let a held ball go without a pulse (tip it off the face
  and book the fall, which touches the energy ledger), or let the intercept work
  a second ball while one is held and unlaunchable. Measure `wallmax`, `any` and
  the energy balance for both.
- The struts are sized from two scenarios (a 0.5 m stair at speed, a deck
  corner). Re-measure the worst extension over a full mining shift on graded
  rubble — `experiments/mine-trips.cjs` or `autopilot-trips.cjs` with a strut
  histogram — before treating 0.24 m as settled.
- `probe-ramp.cjs` covers one rider and one base. With three rivals the both-ends
  rule can be claimed by two hulls at once; add a three-platform crossing and
  check the plates do not fight over which end is the far one.
