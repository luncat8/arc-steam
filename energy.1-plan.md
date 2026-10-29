# energy.1 — Closing the energy loop: hand-crank rescue, grounded-ball re-seat, pad-aware measurement

## Energy rules in force

- The platform drive supplies the ball's bounce energy. The ball is passive and
  unbreakable: ground contact dissipates its energy but never destroys it.
- A grounded ball is recovered by moving the platform over it, then released
  with a powered pulse. The low-tier 42 J pulse adds only part of the height:
  from a release, the third powered bounce is the first to reach the ceiling.
- The collector catches and holds the ball, dissipating its mechanical energy.
- The centre charge pad is a ground type, not a consumable: standing still on
  the 4 m centre strip imports 3 kW, filling the 12 kJ reserve in 4 s. The
  credit import in the market remains only as an emergency resupply.

## Decisions

- **An empty reserve must not dead-end a run.** The platform began as a manual
  drive, so its lowest tier is a hand crank: with the reserve at zero the crew
  cranks the platform at 60 N up to 0.8 m/s. That is a crawl next to the
  powered 400 N / 10 m/s, but the centre pad — or a wall, to sell cargo for an
  import — is always reachable. The crank moves the platform only: it cannot
  launch or push the ball, so recovery still costs a charge. Braking stays
  full-strength, as before, and the crank never adds speed to a platform
  already coasting faster than its crawl.
- Crank work is booked as imported energy (counted separately in
  `world.crankEnergy`), exactly like pad charging and bought joules, so the
  energy ledger stays exact. The metabolic cost to the crew is outside the
  machine ledger, as the pad's supply cost is.
- **A grounded ball rests on the rubble surface, wherever that surface goes.**
  Fallen debris can deposit in a grounded ball's column and a grader can cut
  the pile under it, so the resting height is re-seated every step: settling
  down dissipates the potential difference as heat; being lifted by a growing
  pile is terrain work, the same prescribed-terrain term that lifts the
  platform. The ball is therefore never buried and never left floating.
- **The pad charges through settled rubble.** Measured over a busy 120 s
  shift, the pad columns collect only ~0.015 m of rubble on average (0.125 m
  maximum), because deposits spread over 192 columns. Gating charging on a
  clear pad would deny the free refill over a dusting of soil long before the
  grader is affordable, so the plate is treated as ground that works under
  the thin soil tiles. Revisit only if deposits later concentrate.
- The scripted shift in `experiments/mine-trips.cjs` is the calibration for
  the loop, so its progression policy must use the pad the way a player is
  told to: below 20% reserve it parks on the centre strip until 95%, instead
  of buying energy it has not earned. A free-shift variant with the road
  grader installed measures what the grader alone is worth.

## Acceptance

- From rest off the pad with an empty reserve, a movement command accelerates
  the platform but never past 0.8 m/s; the reserve stays at zero, the kinetic
  gain equals `crankEnergy` and the imported-energy term, and the balance
  error stays at zero.
- With any charge in the reserve the crank contributes nothing; a coasting
  platform faster than the crawl gains no crank energy; launch and bounce
  pulses still deliver nothing on an empty reserve.
- Crank-crawling to the centre strip and stopping there refills the reserve
  through the normal pad path.
- A grounded ball follows its rubble column up (deposit) and down (cut),
  ending each step at `floorAt(x) + radius` with the balance exact.
- `experiments/mine-trips.cjs` reports per-shift pad energy and floor piles
  for base, pad-aware progression, free, and free-with-grader shifts.
