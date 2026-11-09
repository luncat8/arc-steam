# autopilot.7 — the keepers drive the ball into the rock, not onto it

Source: the `draft.txt` autopilot note — “make auto and bot more aggressive use
piston push force. and/or increase it. currently it is barely reaches the edge
of rock. it is safe when engine is weak but when speed is enough it is more
profit bounce with more power”.

## What was wrong

Both drive keepers — the rig’s (`js/autopilot.js`, `driveDecision`) and the
competitor’s (`js/players.js`, `keeperDrive`) — pulsed only while the passive
bounce would fall short of `ceiling − radius`. Rock damage budget is
`½·m·vn²·(1−rockRetention)`, so every contact that arrived with vn ≈ 0 mined
nothing, and the bare-touch line let exactly that happen: once the face of a
working column receded towards the ceiling line, the ball bled its energy to
the face and arrived at the rock ever slower. Measured on the seeded rig shift
(`smart + drive + angle`, shared1, rival disabled), the mean rock strike was
5.2 m/s with one strike at 0.36 m/s late in the shift, and damage per hit
never exceeded ~8 J.

## What changed

- **Strike line instead of touch line.** Both keepers now want the passive
  bounce to clear the ceiling by one pulse of apex height, machine-relative:

  ```
  target = ceiling − radius + pulse / (ballMass · ballGravity)   (≈ 19.10 m stock)
  pulse while passiveApex < target − apexMargin; hold above target
  ```

  One pulse of headroom above the line is the most a single contact can add,
  so the ball is bounded exactly as before — one pulse higher. The overshoot
  scales with the machine’s own pulse chain (`pulseNow()` for the rig,
  `pulseNow(rival.id)` for a competitor), so a drive coil or a piston ram
  aims the keeper proportionally higher — “increase it” through the existing
  equipment path, for the bot as well as the rig.
- **Feather touches are eliminated by construction.** Against a face at
  14.7 m the strike speed is now ≥ √(2·g·(19.1 − 14.5)) ≈ 5 m/s instead of
  ≈ 0.9 m/s, and the damage quadratic does the rest.
- The release (E) path, the three-bounce rule, the retainer of `apexMargin`
  hysteresis and the tilt keeper are untouched.
- The rig’s hand-crank release wait, the refused-release pad behaviour and
  every ownership rule are untouched.

## Measurement

`node .scratch/impact-probe.cjs rig 60` and `.scratch/impact-timeline.cjs 240`
(seeded chamber 1, impact instrumented through `SteamCeiling.damage`), A/B
against the pre-change build via `git stash`:

| metric | before | after |
| --- | --- | --- |
| rock hits, mean vn | 5.2 m/s | 6.7 m/s |
| fastest strike | 6.8 m/s | 12.9 m/s |
| hits below vn 4 in late shift | 1.59–4.28 m/s band, one at 0.36 | mostly ≥ 3.5 m/s, none a bare touch |
| 60 s extracted cells | 271 | 309 |
| pushes per 60 s | 14 | 19 |
| both bots, 180 s, mean mined over 5 starts | 551 | 593 |
| both bots, 180 s, rival sales | 1638 cr | 1796 cr |
| both bots, 180 s, groundings | 6 | 12 |

Two caveats, both structural to this tuning rather than to the implementation:
in the fresh-chamber regime the rock truncates every flight, so the keeper is
near always-on and the strike line is rarely the binding constraint — the gain
is real but modest until a column is worked deep. And the groundings doubled
on the far-right starts (a faster ball is flung further by a sloped rebound);
the lever, if play shows it is needed, is the overshoot factor, not the
attack. The 12.9 m/s strike was the single biggest hit recorded on the seed.

## Tests

- `experiments/autopilot.test.js` — the drive-keeper scenario test is
  rewritten for the strike line: it asserts the ball is driven past the bare
  ceiling line, stays within one pulse of the strike line, and is still in
  play; and it now reads the keeper’s verdict directly on a live piston
  contact — a descent at 1 m/s is pulsed, a descent at 12 m/s is left passive.
  The pressure test’s apex band and the always-on comparison were dropped:
  in the fresh-rock regime the keeper is by design nearly always-on, so
  “leaves some bounces passive” is not a property of this tuning any more.
- `experiments/physics.test.js` — “rock reflection keeps the ball impulse”
  damaged the jagged face and then flew through it relying on the in-step
  collapse clock to release loose cells; a fragment freeing mid-flight could
  impulse the ball and flip the invariant. It now drives the scheduler with
  `ceiling.collapse(30)` and steps until `airborneCells` settles before the
  measured flight. A suite-wide scan found no other occurrence of
  damage-then-flight without an explicit `collapse()`.
- Full suite: **226 / 226 pass** (run before and after every edit).
- `node --check js/*.js` and `git diff --check`: clean.

## Rival-hold regression (the suggested fix)

The one-platform measurement scripts — `two-ball-trips.cjs`, `probe-wall-v2`,
`probe-wall-stint`, `probe-wall-stint2`, `probe-wall-detail`,
`probe-wall-full` — all did `players.init(world, 1)` and then never stepped
`players.update`: the competitor stood at its start slot with its catch
policy never running, and since a ball landing on its deck is held by that
deck (the rival’s release is driven by its own policy), one unlucky landing
silently stole a shared ball for the rest of the shift and reported a stall
that does not exist. The scripts now create no competitor at all
(`players.init(world, 0)`), which is what their headers always claimed to
measure; the fix and its reason are recorded in `findings-pitfalls-skills.md`.

## Docs

README.md (autopilot table row, the four-checkbox paragraph, the competitor
paragraph, the ball-arrangement paragraph), `js/help.js` (autopilot, players
and competitor topics; the Z key row) and the `index.html` checkbox label —
“Drive keeper · hit the rock hard” — now all describe the strike line. The
checkbox reads the same as it always has; only the promise changed.

## Acceptance

- Auto and bot both strike the rock with real speed: the feather touch at a
  receded face is gone by construction, the mean strike on the seed rose
  ~30 %, and the largest strike recorded rose from 6.8 to 12.9 m/s.
- The ball is still bounded (one pulse above the strike line) and the energy
  ledger balances exactly in every run above (`bal` ≤ 1e-8 throughout).
- The affected long-run test drives the delayed-collapse scheduler with
  `ceiling.collapse` instead of relying on the in-step clock; the one-platform
  probes no longer trap a shared ball in an inert competitor.
- Full suite passes; docs describe the new rule in every place that described
  the old one.

## Next

- Playtest the strike line against a slow machine: if groundings on weak
  engines bother a real run, the lever is the overshoot factor (down from
  1× to 0.5× pulse of apex height), not the line itself.
- A face-aware strike rule — pulse only while the *predicted rock strike* is
  below a chosen vn, reading the face from `ceiling.state.firstRow` — would
  keep the fresh-chamber regime identical to the old tuning and engage only
  as the face recedes. It is more machinery than this change needed and can
  land as autopilot.8 if play asks for it.
