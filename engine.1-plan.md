# engine.1 — Engine tiers: a faster tier 1 and a 4× top end

## Problem

Movement had one fixed tune (400 N, 10 m/s) for the whole game. Upgrades could
only cut mass, so acceleration barely improved across progression, and a ball
thrown wide by a high-angle rock reflection could not be met at any force
setting: the platform simply could not cross the chamber inside one flight.

## Decisions

- Engines are measured in force and top speed, contributed through the same
  additive research/equipment channels as pulse, retention and cooling
  (`forceBonus`, `speedBonus` over the base tune). No new subsystem: the
  installed-specification readout, the autopilot's acceleration model and the
  ballistic computer's reachability bound all read `forceNow()` /
  `speedNow()`, so every consumer sees the installed engine at once.
- **Tier 1 is 1.2× faster**: base tune 480 N / 12 m/s (was 400 N / 10 m/s),
  i.e. 8.0 m/s² at 100% force on the 60 kg dry platform.
- **Tier 2** (research *Traction motors* +240 N / +3 m/s; equipment
  *High-torque motor* +360 N / +6 m/s, +6 kg net as a motor swap) reaches
  1080 N / 21 m/s — 2.25× tier-1 force.
- **Tier 3** (research *Power electronics* +360 N / +3 m/s, needing traction
  motors and heat transfer; equipment *Overdrive unit* +480 N / +6 m/s,
  +8 kg) reaches 1920 N / 30 m/s — 4× tier-1 force and 2.5× its top speed.
  On a fully laden 108 kg machine that is 17.8 m/s² at 100% force, 2.2× the
  tier-1 acceleration; on an engines-only 70 kg machine, 3.4×.
- The speed comes at the game's usual price, unchanged: kinetic energy is
  still bought from the reserve at 80% efficiency, so a maximum-effort
  crossing can spend most of 12 kJ and dump it as braking heat. The force
  slider remains the throttle — 100% is for saves, not cruising — and the
  hand crank (60 N / 0.8 m/s on an empty reserve) is untouched by engine tiers.
- Research/equipment totals become 3060 cr (8 nodes) and 4300 cr (8 items).

## Acceptance

- Base world: `forceNow()` 480 N, `speedNow()` 12 m/s; held direction at 100%
  caps at 12 m/s.
- Full engine chain installed: 1920 N / 30 m/s in the live spec.
- Far-side save at 100% force: a ball falling 19 m from the platform is met
  and bounced by the tier-3 machine, where the tier-1 machine arrives after
  the grounding.
- Energy balance stays exact at every tier; autopilot and prediction use the
  installed force/speed, not the base tune.
