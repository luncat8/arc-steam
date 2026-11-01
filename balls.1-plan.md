# balls.1 — shared, two-shared and one-per-platform balls

Status: implemented; see `archive/balls.1-worklog.md`.

Source: the request for a setting with three ball arrangements — one shared ball,
two shared balls, and one ball per platform where a platform may only push its
own — plus bots and the autopilot that handle whichever arrangement is chosen.

## Decisions

- **A ball is a first-class entity with an owner.** `world.balls` is a list.
  `owner: null` is a shared ball that any platform may push; `owner: 'rig'` or
  `'rival-1'` is a ball only that platform may push. The rig keeps its
  machinery (collector capture, piston pulse) on every ball it may push;
  competitors get a body bounce and their own pulse on the balls they may push.
- **`world.ball` stays the rig's focused ball.** It becomes a live view over
  the list (held first, else the ball whose landing is soonest). Prediction,
  autocontrol, readouts and every existing test keep reading one ball and stay
  correct in all three modes.
- **One rule decides contact: `mayPush(ball, platform)`.** A platform that may
  not push a ball does not see it at all, so "can push only own ball" is a
  property of the collision query, not a special case in the policy.
- **Competitors are outside the rig's ledger, like the commercial grader.**
  Their ball and their pulses are not in `totalEnergy`, so the rig's balance
  stays exact. A competitor ball that bounces off the rig's ball is not a
  thing: balls do not interact with each other.
- **A competitor's ball is kept alive by its bounce drive.** The deck bounce is
  passive (`retention`), and a pulse the size of the rig's base pulse is added
  when the ball is descending. A grounded competitor ball is scooped up by
  driving over it, which is the competitor's version of the rig's catch.
- **The competitor's ball pays through the rock, not a collector.** Its ball
  breaks ceiling rock; the debris lands on the floor as rubble and its blade
  harvests it into its load. The rig still catches debris in its own collector.

## Mechanics

```
mode 'shared1'   balls: [ shared ]                       // today's game
mode 'shared2'   balls: [ shared, shared ]
mode 'each'      balls: [ rig, rival-1, ... ]            // one per platform
```

For every ball and every step, the earliest event among wall, ceiling, floor,
rock, the rig's collector and piston (when the ball is rig-pushable), and each
competitor's deck (when the ball is pushable by that competitor) is resolved.

Competitor deck contact:

```
impact = -(v_ball - v_deck) . n            // n is the deck normal
v_ball += (1 + sqrt(retention)) * impact * n
v_ball gets 35% of the deck's tangential velocity
if the ball is owned by that competitor and its pulse is on:
    v_n = sqrt(v_n^2 + 2 * pulse / m)
```

The rig's balls book bounce losses into `world.heat`; a competitor's own ball
is external and books nothing. A grounded competitor ball within the body span
is scooped to the deck with one pulse.

## Policies

- **Rig autopilot.** It works the focused ball: the held one, else the one
  landing soonest. The intercept, the drive keeper, the tilt keeper and the
  launch all read that ball, so two shared balls never split the plan. On mode
  change the plan is dropped instead of being carried across balls.
- **Competitor bot.** With a ball it owns it returns under the ball when the
  ball is low or landing soon and sweeps the floor while the ball is high;
  a grounded ball is chased and scooped, then the sweep resumes. It never
  reacts to a ball it may not push.
- **Competitor pulse.** The pulse stays on while the ball's apex would fall
  short of the rock and stops once the ball is already reaching the top, which
  is the rig's drive-keeper rule at the competitor's fixed pulse size.

## Interface

- A `BALLS` select in the system bar beside `ROCK SHAPE`: `1 shared`,
  `2 shared`, `1 per platform`, with its own `?` help mark and topic.
- Every ball is drawn: shared and rig balls in the existing cream, a
  competitor's ball in its owner's colour and dimmer, so ownership is visible
  without a label.
- The ball-energy readout reports the focused ball and says `· n balls` when
  more than one is rig-pushable.

## Files

- `js/physics.js` — `world.balls`, `setBallMode`, `mayPush`, per-ball
  `advanceBall`, competitor deck contact and scoop, focused-ball view.
- `js/players.js` — `setBallMode` wiring, rival ball ownership, chase policy
  and pulse decision, rival pose for deck contact.
- `js/main.js`, `index.html`, `styles.css`, `js/help.js` — the setting, the
  drawing and the readouts.
- `experiments/balls.test.js` — the three arrangements, ownership, the
  competitor bounce and scoop, both policies, the exact ledger.
- `experiments/interface.test.js` — the select drives the chamber.
- `README.md`, `archive/balls.1-worklog.md`.

## Result

Shipped as described, with one physics correction the smoke runs demanded.
`world.balls` is the list, `owner` is `null` for a shared ball and an id for an
owned one, and `mayPush` gates every collision query, so a foreign ball is
simply not there. `world.ball` is a live getter returning the focused ball, so
the existing prediction, autopilot, launch and readout code kept one ball to
read in all three modes.

The opponent deck contact is `bounceOnDeck` (passive retention, a third of the
deck's tangent, the owner's pulse), a grounded owned ball under a competitor is
`scooped` with one pulse, and only rig-pushable gains reach the ledger.
Competitors pick the chase target from the landing time and the ball height,
clamp their approach speed by the brake distance and never react to a ball they
may not push; the rig autopilot replans when `focusBall` hands it another ball.

The correction: a platform's pose is prescribed by the terrain, so climbing a
boulder shoulder moves it further in one step than any rate limit allows.
`bodySurfaceAt` handed that jump to the contact solve as surface velocity, and a
competitor deck rising 1.33 m in one step launched the ball at 619 m/s, dumped
60 kJ into `world.heat` and left the rig at the thermal cutoff for the rest of
the run — the "autopilot stall" the smoke test showed. `bodySurfaceAt` now
clamps the step to `speedNow()`, `config.platformDropRate` and
`config.platformPitchRate`, so the deck still shoves the ball but never faster
than it may move; `experiments/balls.test.js` pins that.

`styles.css` needed nothing: the select lives in the existing system-bar row.

Validation: `node --check` clean, `git diff --check` clean, `node --test
experiments/*.test.js` **140 / 140**. A headless boot of the real `index.html`
ran 30 s per arrangement (90 s total) with the ledger at `0.000000`, and
60 s harness runs with both bots stayed at or below 16 m/s ball speed and 114 °C
with the balance within 1.2e-9 J.

## Acceptance

- The default is the current one shared ball: same behaviour, same ledger.
- `2 shared` gives two balls that both platforms may push; the rig can catch
  either and the autopilot plans for the one arriving sooner.
- `1 per platform` gives every platform its own ball; the rig cannot catch or
  pulse the competitor's ball and the competitor cannot touch the rig's.
- A competitor keeps its own ball in play, mines the ceiling with it, and
  harvests the rubble it leaves; the rig's funds never move for it.
- The rig's energy balance stays exact in every mode over a long run.
- The full test suite passes.
