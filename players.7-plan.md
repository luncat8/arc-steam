# players.7 — the selected computer's flights, a ground bounce, a short horizon and a steady ride

Source: four reports after the per-platform machine landed. In some cases only
one platform appears to have a ballistic computer; with two balls only one
flight is drawn, and in the owned-ball arrangement the overlay can name a ball
the selected platform may not push. Ground impact still takes all of the ball's
energy, with no way to try a half-energy rebound. The tier-II overlay marches
through a long chain of rebounds that nobody can act on. Reflections from the
piston and a full collector do not always match what the chamber does, and two
hulls that meet occasionally stutter and swap which one is on top when a chase
ends mid-crossing.

## What is wrong

- **The page trace is not the page's own.** `predict` picks a trace with
  `id === undefined || id === selectionId() ? page : policy`. The autopilot
  passes `id = 'rig'` 20 times a second, so whenever the rig itself is selected
  the plan overwrites the overlay: the drawn flight is the autopilot's chosen
  ball (often a held one, with no samples at all), and the path the player
  reads flickers or disappears between two 10 Hz readouts. The competitor
  selection was fixed in players.6; the rig selection was not.
- **One ball, one path.** `predict(world)` traces only `workingBall`, and its
  last resort is `world.ball` — the rig's ball — even when the selected platform
  may not push it. So `2 shared` shows one of two flights, and `1 per platform`
  can show another platform's owned ball instead of nothing.
- **Ground has one rule.** `advanceBall` always grounds a ball at the rubble
  surface, dissipating its full energy as heat. There is no setting to try a
  bounce that keeps half of the impact energy, and the ballistic computer has
  no matching rebound to draw.
- **The forecast is longer than the game.** With Trajectory computer II the
  page path marches to `horizon * 3` (~22 s) through every piston, rock and
  ground rebound. Only the next one or two contacts are actionable; the rest
  is a scribble over the chamber. A ball that loses all its speed on the ground
  has exactly one contact to show.
- **The forecast bounce is not the chamber's bounce.** `traceFlight` used
  `deckBounce` — the flat-strip shortcut for a full collector and the hull —
  for every deck reflection, while `resolvePiston` uses `solveFace` with
  friction, platform recoil and the powered pulse. On a tilted face with
  sideways motion the outgoing velocity differed by up to 1.35 m/s, so the
  second contact was drawn about 0.7 m from where the ball really landed. A
  collector already holding a ball was drawn as a terminal catch although the
  chamber returns the arrival, and the piston's angle and surface motion could
  leak into a collector rebound because only the last solved face was kept.
- **The ride-over ranking is re-decided every step.** `above` compares drive
  power on every query. A platform that brakes or reaches its mark while it is
  on top of another loses its power, so the pair instantly trades places: the
  upper hull falls through the lower one and the lower hull starts climbing,
  both stuttering until the crossing ends. The layering is a decision made at
  contact, not a per-frame function of motion.

## Decisions

- **Two traces, chosen by the caller.** `predict(world)` and `predictAll(world)`
  own the page trace; `predict(world, ball, id)` owns the policy trace, whatever
  platform the page has selected. The autopilot can never leave its flight on
  the overlay, with the rig selected as well as with a competitor.
- **One path per ball the selected machine may push.** `predictAll` traces the
  focus ball into the page trace (the readout, marker and ghost stay where they
  are) and every other *flying* ball that machine may push into preallocated
  companion traces. Ownership is the filter: in `1 per platform` a competitor
  draws only its own ball, and a ball held by another platform or parked on the
  floor has no flight to draw. The fallback to the rig's ball is removed, so a
  machine with no ball reports `PARKED` honestly.
- **Ground bounce is a system-bar setting, not world state.** `GROUND` chooses
  the energy kept at a ground impact: lose all (default, the ball grounds),
  lose 50% (the ball rebounds with `sqrt(0.5)` of its normal speed), or lose
  none. The setting survives New game like rock shape and ball arrangement.
  Simulation and prediction share the one rule; the lost normal energy is heat
  for a rig ball, and a rebound too small to see settles the ball instead. A
  floor that rises under an already-rising ball lifts it without a second
  impulse, booked as terrain work.
- **The drawn path stops at the second bounce.** A page path ends at the second
  ground, deck or rock contact, or at the first contact that ends the flight:
  a ground strike that absorbs all speed, a collector catch, or the tier-I
  computer's first contact. Ground rebounds continue the march only while the
  setting keeps energy. The policy trace keeps the long tier-II forecast,
  because the autopilot still prices economical travel through rock rebounds;
  it is never drawn.
- **The chamber's own reflection answers the forecast.** `reflectOnDeck`
  runs `solveFace` against a read-only projected body with the machine id, its
  forecast deck speed and the face motion used to find the contact, so a
  forecast through a tilted piston has the same friction, restitution, recoil
  and pulse as the real bounce. The winning face owns its own angle and surface
  motion. A full collector returns the ball off its flat strip in both the
  simulation and the forecast, and `solveFace` uses the installed ball mass the
  rest of the collision ledgers use.
- **The rider is latched for the crossing.** A pair of bodies that has begun to
  ride remembers which one is on top. Drive power still decides the first climb,
  but once one hull is above the other the layering stays put until the bodies
  part and the tails fold away — a brake, a target reached, or a direction
  change cannot swap them mid-crossing. `surfaceAt` and the draw order both
  read the same latched decision.

## Mechanics

```
predict(world, ball, id)  -> policy trace (explicit machine)
predictAll(world)         -> page trace for the focus ball + companion traces
                             for other flying balls the machine may push
pagePaths[0 .. count-1]   -> drawn dotted flights; marker + ghost on [0]

ground contact (simulation and prediction)
  retention = GROUND setting (0 / 0.5 / 1)
  rebound   = -vy * sqrt(retention), vx unchanged
  heat      = 1/2 m vy^2 (1 - retention)   (rig ball only)
  rebound < groundMinBounce -> ground the ball

drawn page path
  stop at contact 2, or at contact 1 when that contact ends the flight
  policy path: unchanged tier-II horizon

deck contact
  PISTON    -> reflectOnDeck = solveFace (friction, recoil, tilt, pulse)
  COLLECTOR -> empty: catch and stop; full: deckBounce(..., pulse 0)
  winning face supplies its own angle and surface velocity

platform pair
  engage: bodies within a plate's reach and one hull above the other
  rider:  the higher hull (drive power only until a climb begins)
  release: bodies farther apart than the tails' reach
```

## Files

- `js/physics.js` — the ground-bounce setting and accessor, the rebound and
  its heat/terrain-work booking in `advanceBall`, `groundMinBounce` tuning,
  `reflectOnDeck` and the installed ball mass in `solveFace`.
- `js/prediction.js` — caller-chosen traces, `predictAll` with preallocated
  companion paths, the two-bounce page cap, ground rebounds in the march, no
  fallback to a ball the machine may not push, the winning deck face's own
  angle/motion and a forecast through the chamber's reflector/collector.
- `js/main.js` — the readout asks for all flights, the overlay draws every
  path (marker and ghost only for the focus), the new system-bar setting is
  wired and kept across New game.
- `js/players.js` — the latched rider with engage/release hysteresis, shared
  by the ground query and the draw order.
- `index.html`, `js/help.js`, `README.md` — the `GROUND` selector, its help
  topic, and the corrected descriptions of the computer and the ride-over.
- `experiments/*.test.js` — the page/policy split, multiple and owned-ball
  paths, the ground rebound against the energy ledger, the two-bounce cap,
  a ride-over with a mid-crossing power change, and piston/collector
  reflections checked against the chamber's second contact.

## Acceptance

- With the rig selected and the autopilot engaged, the drawn flight is the
  selected machine's ball and the rig's plan cannot replace it; with a
  competitor selected the same holds. The overlay never blinks off.
- `2 shared` draws two distinct flights against the selected machine's deck;
  `1 per platform` draws only that machine's own ball; a held or grounded ball
  draws nothing.
- `GROUND · lose 50%` makes a ball rebound with half its impact energy, the
  predicted path follows the same rebound, and the chamber's energy balance
  stays exact. `lose all` keeps the old grounding.
- A tier-II page path ends at the second contact instead of marching for ~22 s;
  an absorbing ground strike ends it at the first. The autopilot's tier-II
  forecast still looks through a rock rebound.
- Two platforms crossing with a brake and a direction change mid-climb keep the
  hull that was on top, with no sink and no per-step jump.
- A tier-II forecast through a tilted reflector ends at the chamber's real
  second contact (within 0.02 m); a full collector bounces in both the chamber
  and the overlay; the flat-strip shortcut would have missed by over 0.2 m.
- The full suite passes: 13 suites, 183 tests, 0 failures.
