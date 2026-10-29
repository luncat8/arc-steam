# engine.1 — Engine tiers: tier 1 up 1.2×, top end at 4× force / 2.5× speed

Sources: the user's balance request — tier 1 should be 1.2× faster, and top
engines 2–4× faster so that at 100% movement force a ball thrown wide by a
high-angle reflection can still be met. Decisions and acceptance in
`engine.1-plan.md`.

## Review of the previous state

- There were no engine tiers at all: one fixed 400 N / 10 m/s tune, with
  progression improving acceleration only indirectly through −16 kg of mass
  reductions. At the default 60% force setting a far-side landing was often
  unreachable (the findings file records sloped-rock rebounds moving ~3 m in
  under a second with no possible intercept); even at 100% a 19 m crossing
  took ~3.1 s against a ~2.3 s fall.
- The installed-specification readout showed `config.force`/`config.maxSpeed`
  directly, so it could not have displayed an upgraded engine anyway; the
  autopilot and the ballistic computer likewise modelled the base tune.

## Decisions

- Force and top speed become ordinary additive channels (`forceBonus`,
  `speedBonus`) over a retuned base, read everywhere through `forceNow()` /
  `speedNow()` — simulation, spec readout, autopilot acceleration, prediction
  reachability. No new subsystem, no multiplier state.
- Tier 1: 480 N / 12 m/s (1.2× the old tune, 8.0 m/s² at 100% on 60 kg).
- Tier 2: *Traction motors* research (380 cr, +240 N / +3 m/s, needs pulse
  electromagnetics) + *High-torque motor* (550 cr, +360 N / +6 m/s, +6 kg
  net as a swap) → 1080 N / 21 m/s.
- Tier 3: *Power electronics* research (640 cr, +360 N / +3 m/s, needs
  traction motors and heat transfer) + *Overdrive unit* (950 cr, +480 N /
  +6 m/s, +8 kg) → 1920 N / 30 m/s: 4× tier-1 force, 2.5× top speed, 17.8 m/s²
  on a fully laden machine, 27.4 m/s² on an engines-only one.
- Energy pricing is untouched, which is the balance: kinetic energy still
  comes from the 12 kJ reserve at 80% efficiency and returns as braking heat,
  so full-force saves are occasional by construction. The hand crank is not
  an engine tier and did not change.

## Implementation

- `js/physics.js`: base tune 480/12; `forceNow()`/`speedNow()`; `movePlatform`
  reads them (target-following, powered segment, speed clamp).
- `js/research.js`: `traction` and `power` nodes (tree is now 8 nodes,
  3060 cr total) with the four channel wirings.
- `js/equipment.js`: `motor` and `overdrive` items (shop is now 8 items,
  3930 cr total). This also corrected the master plan, which claimed 2800 cr
  for the old six against the code's actual 2430 cr.
- `js/autopilot.js`, `js/prediction.js`, `js/main.js`: installed force/speed
  instead of base config.
- Tests: tier-1 values and 12 m/s cap in the tuning test; the tier chain
  asserting `forceNow`/`speedNow` after every purchase (guards the
  silent-zero channel pitfall, now in `findings-pitfalls-skills.md`); the
  far-side save — ball dropped at x = 21.4 from platform x = 2 at 100%
  force: tier 1 records 0 bounces in the fall time, tier 3 bounces it.
  Browser-smoke progression counts are now read from the game instead of
  hardcoded.
- `experiments/mine-trips.cjs`: engine chain added to the scripted
  progression (15 entries); log rerun as
  `experiments/logs/engine.1-trips.txt`.

## Validation

- `node --test experiments/*.test.js`: 104/104 pass.
- Headless Chromium smoke: PASS, no page errors; the spec table reads
  480 N / 12 m/s on a fresh world and the new rows render with gates and
  effect text (1440 px screenshot reviewed).
- Measured (`engine.1-trips.txt`, 8 seeds × 2 shapes × 4 modes): the 1.2×
  tier 1 alone lifts the dumb base policy from 23 to 154 cr/shift (smooth)
  and 0 to 68 (square) — keeping up with the ball is most of its income.
  Free full-progression shifts now import 48–129 kJ per shift through the
  policy's free recharges, confirming the tier-3 appetite the reserve/pad
  economy has to feed in paid play; pad-aware paid shifts sustain 240 s and
  buy their first 0.9–1.5 of 15 progression entries per shift.
- `node --check` on all scripts; `git diff --check` clean.

## Next step

Playtest tier 3 at 100% against high-angle rock rebounds: if 30 m/s coasting
into walls dominates the heat budget, the next lever is wall buffers/springs
from the draft's research list rather than more force. The autopilot's timed
intercept now plans with real engine force — when wear lands, its cost model
should price these crossings in maintenance as well as joules.
