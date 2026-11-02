# autopilot.4 — a desperate rush no longer takes the plan from a keep the rig can stop on

Reported again from play with two shared balls: the rig still ran for the next
landing without asking whether it could actually be there in time, or whether
less travel would get the other ball — it crossed the chamber for a landing it
could only reach at full speed, spent the other ball's flight coming back, and
got neither.

## Review of autopilot.3

The tier rule was real, but two prices underneath it were not:

- **A keep was priced by its landing time alone.** Once the thrust-only
  passing bound (`travelTime`: full thrust, no braking) fit inside the flight,
  the ball was a `MEET` with `cost = contactIn`, so the sooner landing always
  won. A mark 7.6 m away in a 2.0 s flight passes that bound (1.74 s) and
  counted exactly like a mark the platform was already standing on — yet
  stopping on it needs 2.45 s, so the run arrived crossing at ~8 m/s and was
  left spent and out of position for the other ball's landing.
- **Nothing asked what working a ball first does to the other one.** Each
  candidate was priced from the platform's current position and speed, never
  from where the first keep leaves it at the first contact.

Reproduced headless: platform at 12 m, one ball landing at 5 m in 2.0 s, the
other at 13.5 m in 2.5 s. The old selection focused the far ball, crossed the
chamber and rolled through it while the near ball grounded beside the start
position. The new selection works the near ball; the far ball grounds where it
fell for collection, and the platform never leaves the near half.

## Policy

- **`physics.stopTime(distance, speed, acceleration, topSpeed)`** — the
  earliest arrival at a mark *stopped*: accelerate–brake triangle capped by a
  cruise, speed already carried towards the mark spent, speed away braked out
  with its drift paid for, and too-fast-for-the-mark priced as braking past it
  and coming back. It sits beside `travelTime`/`coverage`, which keep their
  passing meaning for prediction's "reachable at full thrust" readout.
- **A plan now carries both arrivals.** `arrival` (passing) still decides
  whether a landing can be met at all — a rolling contact is a real bounce and
  the tilt keeper squares it. `effort` (stopped) prices what the travel costs.
  If the centre cannot be under the ball in time but the reflector's edge can,
  the landing is still a keep, flagged `edge` and priced 0.35 dearer; only
  when even the edge cannot be there is the flight a recovery, as before.
- **Selection compares schedules, not landings.** All rig balls are priced
  into a reused candidate pool (pricing overwrites the shared ballistic
  computer, so a pair can only be compared from records kept side by side).
  For each keep, `chainAfter` counts the later landings still reachable in
  landing order from its mark. Keeps are ordered by: landings kept, then
  *desperate* — edge, or stopped arrival longer than the flight — below any
  keep the rig can stop on, then landing order with the incumbent's 0.6 s
  switch margin, then effort. With no keep available the old tier/cost
  recovery order is unchanged, held ball first.

## What did not work

- **Stopped arrival as the feasibility gate**: broke the tier II rolling
  intercepts — a mark 6.0 m out in a 1.54 s flight (stopped 2.16 s) is met
  rolling at ~3 m/s and bounces. Stopped arrival is a price, not a gate.
- **Effort-first among all keeps** (nearer always beats sooner): let the
  early ball ground whenever a later one was nearer; shift sweeps did not
  improve. Only the desperate/comfortable distinction is kept.
- **Pacing a hopeless recovery at approach speed**: the landing mark is where
  the ball will lie, so rushing a *chosen* recovery is still the quickest
  collection and timed sweeps got worse without it. What changed is that the
  run is only chosen when it sacrifices no keep.
- **Collecting a floor spare on the way to a landing** (guarded by the
  landing surviving the detour): measured again, dropped again — in chase
  sweeps it added groundings and plan changes for its extra bounce; the
  landing-first order already collects the spare afterwards.

## Measurement

`node experiments/two-ball-trips.cjs` → `experiments/logs/autopilot.4-trips.txt`
(120 s per start, starts 3…21 m, force 60%, one platform, mean over seven
starts; `sw` = plan changes):

| policy | any | bounces | groundings | sw | travel | draw | mined |
|---|---|---|---|---|---|---|---|
| chase, before | 100 % | 36 | 4.6 | 5.3 | 76 m | 14182 J | 355 |
| chase, now | 100 % | 36 | 5.6 | 5.1 | 85 m | 15371 J | 333 |
| timed, before | 100 % | 38 | 5.0 | 11.9 | 89 m | 6101 J | 399 |
| timed, now | 99 % | 39 | 6.0 | 15.3 | 97 m | 7364 J | 344 |
| chase only, now | 99 % | 35 | 6.3 | 11.1 | 106 m | 18879 J | 275 |
| timed only, now | 99 % | 40 | 6.1 | 19.4 | 120 m | 8599 J | 402 |

Shift-long mining is chaotic — one grounding re-rolls the rest of the shift —
and ablating the desperate demotion left groundings unchanged (5.7 / 5.7)
while bounces fell (34 / 37), so these means are a no-collapse check (a ball
is in play 99–100 % of every shift, bounces do not drop), not the evidence for
the fix. The evidence is the targeted trap tests below, which fail on the
pre-fix source.

Single ball is untouched: `node experiments/autopilot-trips.cjs` before and
after the change is byte-identical, because with one ball the selection has
nothing to compare.

## Tests

`node --test experiments/*.test.js` — **156 / 156**.

- `experiments/physics.test.js` — "the stopped arrival prices the manoeuvre
  the intercept controllers fly" (rest triangle and cruise, speed towards and
  away, braking past a mark it is too fast for, and stopped > passing on the
  same mark).
- `experiments/autopilot.test.js` — "a desperate landing never takes the plan
  from a keep the rig can stop on" (focus is the near ball, it bounces, the
  far ball grounds for collection, the platform never crosses the chamber)
  and "a schedule that keeps both landings beats the cheaper single keep"
  (both landings kept in order, no groundings). The hopeless-mark test now
  also asserts `reachable === false` while the chosen run is still chased.
- Checked against the pre-fix source (`js/autopilot.js js/physics.js`
  stashed): three of the new cases fail, including the desperate-landing trap.
- `node --check js/*.js` and `git diff --check`: clean. Browser smoke was not
  run; no browser is available in this sandbox.

## Next

- Playtest with the rig BOT (chase + drive + angle) in `BALLS · 2 shared`:
  the panel already says "landing out of reach, collecting at …" for a
  recovery; an edge keep still reads as a plain intercept, so consider
  naming it ("edge of the reflector") if the desperate/comfortable choice
  ever needs explaining in play.
- `waitmax` is unchanged (up to ~118 s in the worst start): while one ball
  is being kept, the other can lie on the floor for most of a shift. That is
  still the intended trade — a keep always wins — but a variant that swaps
  to the spare between flights when the kept ball's next landing is far in
  the future remains open.
