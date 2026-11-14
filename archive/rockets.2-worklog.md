# rockets.2 worklog — the rig bot fires its own rack

## Layout task first

The PLAYERS roster moved out of the full-width strip under the telemetry into
the left column, directly above CARGO / STORAGE:

- `index.html`: a `div.side-column` wrapper holds `section.scoreboard` and
  `article.cargo-panel` as one grid area (`side`). Every id and list-item
  structure is unchanged, so no JavaScript needed touching.
- `styles.css`: workspace areas `"side mine controls"`; the side column is a
  flex column with a 12 px gap; the roster and its player list run vertically;
  at ≥761 px the column is capped at 74 vh and cargo takes the remaining height
  with its own scroll. ≤1279 px keeps the side column beside the chamber with
  controls full-width below; ≤760 px stacks mine, controls, then the side
  column.
- `experiments/browser-layout.cjs` gained `playersAboveCargo` (roster bottom ≤
  cargo top, left edges aligned) and `playersLeft` (≥761 px the roster's right
  edge is left of the canvas) assertions.
- `experiments/browser-smoke.cjs` still asserted the old geometry (cargo top
  aligned with the chamber, cargo max-height). It now checks the side column's
  top against the chamber, the roster above cargo, and the column's scroll cap
  with cargo's own overflow.

## Review of 0.3.5

The rack, the wall-only purchase rule and the shared `chip` weakening rule
were read end to end and hold together. The yield probe's numbers (median 3
cells, mean 4.2; 2.6 of them in the first 5 s) are what set the catch-hold
window below. Nothing needed fixing before the bot could use the rack.

## Plan

The final rule set is `archive/rockets.2-plan.md`. Decisions it states:

- The rocket trip is a third service trip beside selling and recharging, and
  the lowest priority of the three: a full hopper sells first, a short reserve
  charges next, only then does the bot work its rack.
- The target is the richest reachable free-face seam, valued over the
  collector's own width so the mark is a place the bin catches from. The
  travel mark offsets the platform centre by the tube's offset, so the tube —
  not the chassis centre — ends up under the seam.
- One rocket per trip, then a ~5 s hold under the burst (the early-fall
  window), then the intercept resumes. The hold borrows only travel; the drive
  and tilt keepers stay live and the ball is still played.
- Turning the bot off, or a hand on the travel controls, stands the trip down.
- Auto-buy is unchanged (the player's standing order); a bot with an empty
  rack and no order simply plays the ball.
- No new energy terms: a rocket carries its own charge, so the ledger stays
  exact.

## Implementation

- `js/players.js`: `rocketing`/`rocketCatching` trip state beside
  `selling`/`recharging`; `richestSeam()` scans the free face (`firstRow` +
  live `prices`) over the collector width and returns the platform-centre mark
  (seam + 1.17 m tube offset); `stepRocketTrip` travels, fires when the tube is
  under the mark, holds 5 s, then resumes with an 8 s cooldown. The trip is
  cleared on bot-off, on a missing duty, on a full hopper, on a short reserve,
  on init and on `syncRigBot`. A hand fire that empties the rack mid-travel
  ends the trip instead of parking forever.
- `js/autopilot.js`: one read-only addition, `handHeld(channel)`, so the trip
  can stand down while a travel key is held without touching the override
  rules. `resume` already refuses to clear a hand hold.
- Page: the autopilot status line names the trip (`Rig · rocket trip · richest
  seam` / `Rig · rocket fired · holding under the seam`); the rockets help
  topic says the bot uses the rack; the players help paragraph and the README
  layout paragraph describe the left-column roster.

Found while building:

- A first cut refused to start a trip while the focused ball lands within the
  catch window. Measured over 30 s of bot play, every flying sample lands
  within 4.6 s (mean 1.0 s), so the guard would have blocked the duty forever.
  Removed: the plan's keepers-stay-live rule is what keeps the ball played.
- The seam scan reads `prices[cellIndex]` (the live per-cell value), not
  `strength` (hit points) — the same array the debris bookkeeping reads.

## Validation

- `node --test experiments/*.test.js` — 346 tests, all pass (339 before).
- `node --check` on every changed file in `js/`.
- New `experiments/players.test.js` (+6): the bot fires unprompted from its own
  rack (stock −1), holds the seam mark and catches the early yield, energy
  ledger closed; a full hopper sells first; a short reserve charges first;
  bot-off mid-trip stands down and a manual rig never starts a trip; a hand
  hold stands the trip down without overwriting the hand's command and release
  returns the intercept; an empty rack leaves the bot on the ball.
- `experiments/interface.test.js` (+1): test mode fills the rack, the BOT
  checkbox starts the duty, the status line names both phases, the shot comes
  from the rack, and the BOT switch stands the trip down.
- Real Chromium: `experiments/browser-layout.cjs` PASS at 11 viewports
  (1920×1080 through 320×640) with the two new roster assertions;
  `experiments/browser-smoke.cjs` PASS end to end with no page errors.

## Next step

Take `0.3.6-Sandblaster-plan.md`: energy plus a conserved abrasive storage,
an upward stone stream that chips through the same `weaken`/`chip` rule,
cumulative ~1 px damage, and particles that fall back as recoverable debris.
The open design point is abrasive conservation — rocket shards deliberately
are not material, the sandblaster's stream must be. The high energy cost
should keep early use unprofitable; the rocket yield probe
(`experiments/rocket-yield-probe.cjs`) is the template for measuring it.
