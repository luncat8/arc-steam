# autopilot.6 — a refused release is waited out, not tipped out

## What was wrong

The tipped ball could never be collected again. `tipHeldBall` put the ball on the
machine's face and set `tipReleased`; the flag cleared only once the machine was
further than half a face width from the ball. A tipped ball therefore rests
*inside* the machine's column, and the travel duty's answer to the flag was "drive
to the centre". Whenever the centre is inside that column the machine parks on the
ball it may not scoop, the flag never clears and the collector is shut out for
good. `probe-wall-v2.cjs 18` ended exactly there: machine at x=12.04, ball at 13.1,
`tip=T`, both balls grounded, 24 s of nothing in play.

The chase also read the flag as an invitation to drive back and forth: each pass
through the column cleared the flag, the machine caught the ball, the release was
refused, the ball was tipped again and the ball walked across the chamber with the
machine (15.7 → 14.8 → 14.0 → 13.1) while the platform burned heat it needed for
cooling.

## What changed

- **No more tipping.** A release the pulse cannot pay for is simply not attempted:
  the ball stays in the collector, and the first step the tank allows it, it leaves.
  Holding costs nothing, the collector's freedom is worth nothing while nothing can
  be launched, and the ball is already aboard when the chamber has cooled — the
  alternative was a dump, a stand-off, a return trip and a fresh release, all of it
  extra heat. `tipHeldBall`, the `tipReleased` flag and its bookkeeping in
  `advanceBall` are gone; a grounded ball under the face is caught again, as before
  the tip existed.
- **`physics.releaseReady(world, machine, margin)`.** The release's own test asked
  without a ball in the collector, so a keeper can tell a refused release from an
  empty one. `margin` asks for headroom over the bare lift (the autopilot uses 1.2,
  because the drive back to a ball costs heat of its own).
- **Travel waits out the heat.** While the release is refused, a held ball rides to
  the charge pad (`standOffTarget`) and a grounded ball is left where it lies; only
  a ball still in flight is followed, because catching it is free and its landing is
  the last chance to keep working it. This is also what keeps the rig off a wall:
  a held ball used to park it there for the whole cooling period.
- `standOffTarget` never stands over a grounded ball's column, so the rig cannot
  scoop a ball it may not fire, and the ground under it stays collectable.

## Validation

- `node --test experiments/autopilot.test.js` 19 passed, `experiments/physics.test.js`
  41 passed, `experiments/interface.test.js experiments/balls.test.js` 56 passed.
  New: the release test in physics, and two autopilot scenes (a held ball riding to
  the pad and leaving when the tank allows it; a refused release keeping the rig
  clear of a grounded ball until it cools).
- `node experiments/probe-wall-v2.cjs` over 120 s, two shared balls, ledger against
  `initialEnergy` (the probe's `tip=` column is now `rel=`):

  | x0 | any | fly | grd | worstWall | waitmax | bnc | travel | T | bal |
  |----|-----|-----|-----|-----------|---------|-----|--------|---|-----|
  | 4  | 99  | 57/55 | 43/45 | 7.0 | 36.7 | 32 | 67 | 115.7 | 2.2e-9 |
  | 8  | 100 | 88/16 | 12/84 | 7.5 | 100.0 | 31 | 58 | 117.9 | 3.6e-9 |
  | 12 | 100 | 78/42 | 22/58 | 0.0 | 54.1 | 32 | 75 | 119.3 | 2.5e-9 |
  | 15 | 100 | 32/56 | 22/44 | 0.0 | 37.4 | 25 | 62 | 145.8 | 9.1e-9 |
  | 18 | 99  | 19/85 | 81/15 | 0.2 | 97.7 | 41 | 61 | 129.2 | 6.2e-9 |
  | 21 | 100 | 51/70 | 49/30 | 4.5 | 53.7 | 31 | 80 | 109.7 | 9.3e-10 |
  | 23 | 100 | 64/51 | 36/49 | 0.1 | 32.8 | 35 | 79 | 122.2 | 2.7e-9 |

  x0=18 recovers the pre-tip 99% (fly 19/85, wall 0.2 s) without the wall stint the
  tip was introduced for; x0=15 stays at 100%/0.0 s with the travel it had.

## Measured cost of the heat, for the record

Heat attribution over the 120 s x0=18 shift (heat added per source): rock fracture
34.4 kJ, braking and driving 8.3 kJ, engine and pulse waste 2.3 kJ, ball impacts
0.5 kJ. Cooling at 120–130 °C removes only ~0.1–0.2 K/s, so a chamber that has mined
itself to 130 °C needs ~55 s under the release threshold (~124.5 °C at the stock
pulse, mass and launch height) before anything can leave the face. That wait is the
floor under `any` in every hot run; the autopilot now spends it holding the ball at
the pad rather than tipping it and driving around.

## Next step suggestion

- **Wall stints remain at x0=4 (7.0 s), 8 (7.5 s) and 21 (4.5 s).** They are not
  the held-ball pin any more (the ball rides to the pad), so the cause is likely
  travel: a plan whose mark sits at a wall clamps there and waits for the landing
  to come to it. Measure `worstWall` against the plan's `interceptX` and the ball's
  last landing to see whether the machine is early (waiting at the wall on purpose)
  or late. A stand-off of the mark from the wall, the way `standOffTarget` stands
  off a grounded ball, is the obvious lever.
- **`waitmax` is still 97–100 s at x0=8 and 18.** A second ball grounds and is never
  recovered while the near one is worked; a recovery is priced by travel time alone,
  so the far ball never wins. Price a long-abandoned ball with the grounding it has
  already paid, and the shift may keep both balls alive.
- Cooling is the bottleneck in every hot run; a radiator's conductance shows up
  directly in `any`. Worth measuring the equipment tree's cooling upgrades with this
  probe rather than a separate one.
