# players.1 — Competitor platform, 45° paddles and the player scoreboard

> Superseded by `players.2-plan.md`: the competitor is now the same platform in a dim colour, the tails retract by distance, and the switch moves every control. This file records what players.1 shipped.

Source: the request to add a competitor platform that shares the rock and the
floor, uses the commercial grader's low-profile collision, and appears on a
scoreboard with one line per player — money, a bot-controlled switch and a
click-to-control action. Both platform bodies gain 45° triangular tails so one
platform can ride over another instead of being stopped by a wall.

## Decisions

- **A player is a platform, not a second mine.** The chamber, its rock, its
  debris and its floor rubble are shared. The rig (player 0) keeps the whole
  mining loop — ball, reserve, heat, cargo, market, research and shop. A
  competitor (player 1 by default) is a low, dim platform that works the same
  floor with a blade: it shaves the rubble the rig leaves behind into its own
  load, sells it at a wall for its own credits and immediately turns around.
  Rubble is the contested resource: the competitor earns from what the rig lets
  fall, and the rig can drive over it to take the ground back.
- **The competitor is not a second ballistics simulation.** It owns a body,
  a purse, a load and a bot switch, not a reserve, a ball, a piston or a
  research tree. Money is per player; machinery remains the rig's, because the
  ledger, wear and equipment model describe one machine. That keeps every
  energy term exact and gives the scoreboard something honest to rank.
- **Competitor collision is the commercial grader's rule, generalised.** The
  chamber already asks `platformGroundAt` for the highest surface under the
  rig, and the commercial grader answers with a low profile the rig rides over.
  Competitor platforms join that same query through one `SteamPlayers.surfaceAt`
  hook. No new collision subsystem, no rigid-body pair solver, and the rig's
  existing terrain-following, pitch and ball-contact code sees the competitor
  exactly like a pile.
- **Platforms carry 45° tails.** The body profile is a trapezoid: a flat top
  `0.34 m` above the floor and a 45° tail of the same run at each end. The tail
  is what makes the profile rideable: the rig's front wheel meets a rising ramp
  instead of a vertical face. Both the rig and every competitor draw the tails,
  so the silhouette states the collision rule. The rig is not an obstacle for
  competitors in this milestone: a competitor sweeps under a parked rig, the
  same way the commercial grader already does, while the rig rides over a
  competitor. Profiles are anchored to the terrain under the owning platform,
  never to another platform's current height, so two overlapping bodies cannot
  bootstrap each other upward.
- **Money is the score, and the score is gross.** The rig's line reads the
  existing funds balance; a competitor's line reads its own purse, credited at
  each wall sale. Nothing is shared or split: the competitor keeps 100% of its
  load, unlike the commercial grader service which pays the rig a 50% share.
- **Bot is a per-player flag, off for the human.** Ticking `BOT` hands the
  platform to its policy; clearing it or touching a movement control at any
  time hands it back. For a competitor the policy is the sweep-and-sell loop.
  For the rig the policy is the existing autopilot (intercept, drive keeper,
  level bounce) plus one new rule: with a full load the bot runs a selling
  trip to the nearer wall while the drive keeper keeps the ball in play, then
  resumes intercepting where it stopped. The rig therefore keeps earning while
  the player drives the competitor.
- **Clicking a line switches the controls.** The active platform takes
  `A`/`D`, the travel click, the brake and the force setting; it is drawn
  bright and outlined, and the others dim. The rig-only controls (drive,
  release, tilt, autopilot, charge/market/science) stay with the rig and are
  disabled while a competitor is active, because they have no meaning on a
  platform that carries no ball or machinery. Telemetry keeps reporting the
  rig's machinery; the scoreboard is where the other players live.
- **One competitor by default, N supported.** `SteamPlayers` is a list with
  one rig entry and a configurable number of competitor entries. The default
  is a single rival so the chamber stays readable and the commercial grader,
  the rig and one competitor do not all compete for the same 24 m at once.

## Mechanics

### Body profile

For a platform centred at `cx` with half width `h` and body top `t`:

```
|dx| <= h          -> t
h < |dx| <= h + t  -> t - (|dx| - h)      // 45° tail
otherwise          -> 0
```

and the queried height is `floorAt(cx) + profile(x - cx)`. The rig's
`platformGroundAt`, `platformPitchAt` and `platformBaseAt` take an optional
`exceptId` so a competitor does not stand on its own profile. The rig passes
`'rig'`, which no competitor uses, so it is lifted by every competitor;
competitors pass their own id and are lifted only by other competitors.

### Competitor work

- Patrol at up to `2.4 m/s` (force setting scales it), accelerating at
  `4.5 m/s²`; the bot targets the far wall, sells on arrival and reverses.
- A `1.6 m` blade under the body removes floor rubble while the body moves.
  `SteamCeiling.harvest` shaves up to `0.05 m/s` of pile height across the
  swath, books the removed value at the pile's own price and decreases
  `floorValues` by the same amount. The competitor's load is capped at the
  same 100 cells the rig uses.
- A wall contact with a load settles it into that player's purse and clears
  the load. Only the competitor with the load is paid.
- A manually driven competitor grades, loads and sells by the same rules; only
  the steering source differs.

### Rig bot selling trip

While the rig's `BOT` is ticked:

1. The autopilot's intercept, drive-keeper and level-bounce duties are on.
2. As soon as the load is full the bot starts a selling trip, whatever the
   ball is doing: the intercept duty is suspended through its existing
   override while the drive keeper stays on, so a flying ball still gets its
   bounce pulses, and the platform targets the nearer wall through it.
   (Gating the start on a grounded ball deadlocked the trip whenever the ball
   stayed in flight; the override is enough to keep the two duties apart.)
3. The wall sale empties the load; the trip ends and the intercept duty
   resumes. The drive was never switched off, so there is no state to restore.

## Interface

- A **PLAYERS** strip under the telemetry row, one line per player:
  - colour dot and name,
  - money in credits,
  - a `BOT` checkbox,
  - the whole line is the switch: click or keyboard-activate it to take that
    platform's controls. The active line is outlined and its dot is bright.
- The chamber dims every inactive competitor (`globalAlpha` ≈ 0.55), outlines
  the active one and draws its 45° tails and blade. The rig draws its own
  tails at the chassis base; its fuel and temperature bars stay.
- A competitor line shows its load in the row title, so the scoreboard explains
  where its next credits are coming from without adding a second number.
- `A`/`D`, the arrow buttons, `B`, the force slider and the low-ground travel
  click address the active player. Ball and machinery controls are disabled
  with a short note while a competitor is active.

## Data

`SteamPlayers` owns:

```
players: [ { id, name, colour, kind: 'rig' | 'rival', bot, ... } ]
active: number
rivals: [ { id, name, colour, x, y, angle, vx, direction, target, spin,
            cargoCells, cargoValue, money, soldValue, bot } ]
```

Rig money is read through `SteamCeiling.state.funds`; competitor money lives on
the competitor record. `SteamPlayers.state` is a stable live view over the
list and the active index.

## Files

- `js/players.js` — player list, competitor profile and movement, `harvest`
  consumers, rig selling trip, scoreboard data.
- `js/ceiling.js` — `harvest(x, halfWidth, cut, out)` with preallocated result.
- `js/physics.js` — `SteamPlayers.surfaceAt` in `platformGroundAt`, optional
  `exceptId` through the platform query stack.
- `js/main.js` — init/reset wiring, input routing, rival drawing and dimming,
  rig tails, player strip build/refresh and switch handlers.
- `index.html`, `styles.css` — the PLAYERS strip and its row states.
- `js/help.js`, `README.md` — the competitor, the scoreboard and the tails.
- `experiments/players.test.js` — profile shape, riding over, harvest
  conservation, bot sweep/sale, manual steering, purses and switches.
- `experiments/interface.test.js` — real page wiring of the strip.

## Acceptance

- A competitor body is drawn dim in the same chamber; the rig rides up its
  45° tail onto its flat top and back down without a step or a snag.
- A competitor sweeping rubble creates a load with a value equal to the value
  removed from the floor, sells it at a wall for that value in its own purse,
  and the rig's funds do not change.
- The scoreboard shows one row per player; each row reports that player's
  money and toggles that player's bot policy.
- Clicking a competitor row makes it active: `A`/`D` and the travel click move
  it, the rig-only buttons are disabled, and clicking the rig row restores
  them.
- With the rig's `BOT` ticked and a full load, the rig makes a wall trip,
  sells, and resumes intercepting without manual input.
- The energy ledger, the existing 115 tests and the new player tests pass.

## Out of scope

- A competitor ball, reserve, heat, equipment tree or shop. A competitor that
  mines the ceiling would be a second full simulation and needs the cargo,
  funds and machinery model split per player; the plan keeps that door open by
  making money and control already per player.
- Contact forces between platform bodies. The profiles lift the rider; bodies
  may overlap horizontally during the transition, as the commercial grader
  already does.
