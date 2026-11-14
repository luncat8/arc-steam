# players.3 — the competitor plays the ball like the rig

Status: implemented; see `archive/players.3-worklog.md`.

Source: the report that the second platform paces wall to wall instead of
playing the ball, and the request to delete that leftover policy and give the
competitor the same behaviour as the rig's own bot.

## What is wrong

- `stepBallPolicy` only ever considers a ball whose `owner === rival.id`, so in
  `1 shared` and `2 shared` it has nothing to do and falls through to the wall
  sweep. Measured: a shared ball lying on the floor at x = 10 is driven over
  (rival x = 9.96) with `ballTarget` still `NaN`.
- `steerWanted`'s fallback when there is nothing to play is
  `botDirection * speedLimit`: full throttle to the wall, then reverse. That is
  the pacing. It also makes the platform permanently "pushing" for the
  ride-over rule (`powerOf`), so a pacing competitor climbs a parked rig.
- The chase is gated to `landing < 2.4 s || ball.y < 4`: above 4 m it gives up
  and sweeps, which is exactly when a proper intercept should start.
- The deck pulse is gated to `ball.owner === rival.id`, contradicting
  `mayPush`, which already says a competitor may push a shared ball. A
  competitor could bump a shared ball but never keep it up.

## Decisions

- **The competitor's bot is the rig's bot with flat hardware.** It plays the
  ball it may push: stand where the flight comes down, drive over a ball on the
  floor, pulse only when the passive bounce would fall short, and make the same
  selling trip to the nearer wall when its hopper is full. It has no collector
  and no piston, so there is no catch and no tilt duty.
- **One ball rule, `mayPush`.** Any ball the platform may push is playable,
  shared ones included. `playBall` picks the ball to work: a ball on the floor
  first (it can be recovered at once), else the flight that lands soonest, and
  never a ball another platform is already holding.
- **No sweep, no pacing, no "too high" gate.** The policy mark is recomputed
  every step from the live flight, so the competitor tracks a ball through
  walls and rock strikes without a cached prediction; the rig keeps its
  ballistic computer because its piston contact is harder than a flat deck.
- **One arrival rule.** The autopilot's `arrivalSpeed` (slowest run that still
  arrives on time, otherwise a gentle approach) is exported and used by the
  competitor, so both bots brake into their mark instead of rushing it.
- **The drive is the platform's, not the owner's.** A competitor's pulse fires
  on any ball its deck may bounce, shared balls included; a shared ball is in
  the rig's ledger, so the energy it gains is booked as imported exactly like
  the rest of the competitor's deck work.
- **Nothing to play means hold station.** A ball in the rig's collector cannot
  be taken, so the competitor stops instead of wandering; the next release is a
  new flight and a new mark.
- **Manual commands still outrank the policy** for the same two seconds.

## Mechanics

```
playBall(rival)   floor ball if any, else the flying ball it may push
                  whose landing is soonest, never a held ball
mark              = floor ball's x
                  | ball.x + ball.vx * ballLandingTime(ball, deck + radius)
markTime          = that landing time (0 for a floor ball)
mark              = wall beyond the nearer SELL face, when the hopper is full
wanted speed      = arrivalSpeed(|mark - x| - deckSlack, markTime, a)
                  capped at the platform's own top speed
```

`deckSlack = 0.9 m` is the half-width of the flat deck less a margin: a landing
inside it arrives on the deck, and inside the slack the platform leaves the
mark alone instead of chattering on it. The pulse keeps the rig's drive-keeper
rule, `apex < ceiling - radius`.

## Policies

- **Competitor bot.** Play the ball, sell when full, hold station when the only
  ball is held. The blade still grades whatever it drives over, so the rubble
  its ball breaks is still its income; a full hopper (100 cells) is sold at
  whichever wall is nearer, and the ball policy resumes after the settle.
- **Rig bot.** Unchanged: autopilot intercept, drive keeper, tilt keeper and
  the selling trip when `cargoCells` hits the storage limit.
- **Manual.** `A`/`D`, brake and travel clicks on the selected competitor
  outrank its policy for two seconds and do not change its bot switch.

## Interface

No new controls. The README and the `players` help topic stop describing a
wall sweep and describe the ball policy; the PLAYERS `BOT` row keeps its
meaning.

## Files

- `js/players.js` — delete the sweep, `botDirection`, the chase gate and the
  owned-ball lookup; add `playBall`, the policy mark, the selling mark and the
  arrival-driven steering; `powerOf` reads the platform's own command.
- `js/physics.js` — the competitor deck's pulse follows `mayPush`, so a shared
  ball can be kept up by either platform.
- `js/autopilot.js` — export `arrivalSpeed` and use it in `commandTravel`.
- `experiments/players.test.js`, `experiments/balls.test.js` — the sweep tests
  become ball-policy tests, the high-ball gate assertion is reversed.
- `experiments/interface.test.js` — the `parkRival` comment (the helper stays).
- `README.md`, `js/help.js`, `archive/players.3-worklog.md`.

## Result

Shipped as described. The sweep is gone: `botDirection`, the wall turnaround and
the `landing < 2.4 s || y < 4` gate were deleted with the `owner === rival.id`
lookup that made the competitor blind to shared balls. `playBall` picks from
every ball `mayPush` allows, a floor ball first and then the soonest landing,
and keeps the ball it is already playing unless another lands 0.6 s sooner.
`stepBallPolicy` turns that into one mark — the landing point at deck height, a
floor ball's own x, or the nearer wall when the hopper is full — and
`physics.arrivalSpeed` (moved out of the autopilot, which now calls it too)
turns the mark into a wanted speed. The pulse belongs to the deck, not to an
owner, and fires while any ball the deck may bounce would still fall short.

Two ledger holes appeared as soon as a competitor touched a shared ball, and
both are fixed: `scoop` lifted and pulsed a ball with no booking, and
`bounceOnDeck` booked its restitution before applying the pulse. A shared ball
is in the rig's ledger, so both now book the difference as imported energy
(the competitor's contribution comes from outside the rig). Each is pinned by
a test that fails without the change.

Measured: a shared ball left on the floor at x = 10 was driven over at
x = 9.96 with `ballTarget` NaN before the change, and is scooped 2.8 s later
after it. With the rig idle, the competitor kept that ball airborne for a full
minute — 20 deck bounces, 0 s grounded, ball speed ≤ 10.1 m/s. In `1 per
platform` it bounced 20 times a minute; in `2 shared`, where the rig alone
leaves the balls grounded 39% of the time, two platforms bring that to 20%. The
competitor holds station with a held ball instead of pacing, and a full hopper
still makes the selling trip.

Validation: `node --check js/*.js` clean, `git diff --check` clean,
`node --test experiments/*.test.js` **145 / 145** (balls 13, players 14,
interface 26, the rest 92). Every arrangement ran 60 s with both bots at a
balance within 1.3e-9 J, temperatures under 110 °C and no ball over 16 m/s.

## Acceptance

- With one shared ball on the floor, the competitor drives to it and scoops it
  instead of passing over it.
- A competitor with only a held ball stops instead of pacing.
- The competitor returns to the landing point of its own flying ball from any
  height, arrives with it rather than rushing, and keeps it up with pulses.
- A full competitor hopper makes a selling trip to the nearer wall, banks its
  own credits, and resumes the ball afterwards.
- Manual travel, braking and held keys still outrank the policy.
- The rig's ledger stays exact in every arrangement and the full suite passes.
