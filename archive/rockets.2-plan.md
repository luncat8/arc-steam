# rockets.2 — The rig bot fires its own rack

## Goal

Hand the rocket rack to the rig's policy. A bot rig mines with its rockets the
way it already mines with its ball: it picks the richest rock it can reach,
puts the collector (and so the launch tube) under it, fires, and holds station
while the loosened rock falls into the bin. A manual rig keeps the rack exactly
as before — the `R` key and the Fire button.

## Decisions

- The rack stays the rig's own tool. A competitor never carries or fires one,
  and selecting a rival never fires the rig's rack.
- The bot fires only while it is a bot: the rig's `BOT` switch (the autopilot's
  intercept + drive + angle duties) is on. Turning the bot off mid-trip stands
  the rocket trip down like a selling trip.
- A rocket trip is a third service trip beside selling and recharging, and the
  lowest priority of the three: a full hopper sells first, a short reserve
  charges next, and only then does the bot work its rack.
- The bot targets the richest reachable seam. Value is read from the free face
  of the rock (the cells a burst actually loosens), summed over the collector's
  own width, so the mark is a place the bin can catch from, not a single rich
  cell the burst would miss.
- The launch tube stands in the collector, so the travel mark offsets the
  platform centre by the tube's own offset: the tube, not the chassis centre,
  ends up under the seam.
- After a burst the bot holds the collector under it for the early-fall window
  (the first ~5 s, when most of the yield falls), then resumes the intercept.
  The hold is a travel override, so the drive and tilt keepers stay live and
  the ball is still played while the bin catches.
- A trip fires at most one rocket, then ends. The next trip re-reads the rock,
  so the bot always works the current richest seam rather than a stale one.
- Auto-buy is the player's standing order and is unchanged: the bot loads at a
  wall only if auto-buy is on. A bot with an empty rack and no order simply
  plays the ball.
- No new energy terms: a rocket carries its own charge, so the trip draws
  nothing from the reserve and the energy ledger stays exact.

## Implementation

- `js/players.js`: a `rocketing` service trip in `stepRigBot`, beside `selling`
  and `recharging`. `richestSeam(world)` scans the free face for the highest
  collector-width value and returns the platform-centre mark under it.
  `stepRocketTrip` travels to the mark, fires when the tube is under it and the
  rack can fire, holds for the fall window, then resumes the intercept.
- `js/autopilot.js`: no change — the trip borrows the existing `override('move')`
  / `resume('move')` channel, so the keepers and the manual-override rules are
  the ones already tested.
- Page: the autopilot status line names the rocket trip ("Rig · rocket seam ·
  firing / catching"), and the rockets help topic says the bot uses the rack.

## Acceptance

- A bot rig with a loaded rack fires at a rich seam without being told to, and
  the fired rocket comes from the rig's own rack (stock drops by one).
- The tube ends up under the chosen seam; the burst's early yield lands in the
  rig's collector (caught cells rise during the hold).
- A full hopper still sells first and a short reserve still charges first.
- Turning the bot off, or taking the controls by hand, stands the trip down.
- The energy ledger stays balanced across a trip (rockets carry their own
  charge).
- A manual rig never fires on its own; `R` / Fire still work as before.
