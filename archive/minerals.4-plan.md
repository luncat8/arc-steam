# minerals.4 — One strength ramp, and a sand filler

## Goal

Both strength views read on one warm ramp, the remaining view marks rubble with
grey instead of a second hue, and the table gains a filler material that is
loose by nature and cheap by demand.

## Palette

- One ramp for the absolute strength scale: `[75, 45, 38]` at zero strength to
  `[205, 170, 120]` at `maxStrength` (the strongest pure mineral). Lightness
  alone carries the amount; the hue never changes.
- `strengthSlot(value)` is `round(clamp01(value / maxStrength) * 1000)`, and
  both views index the same 1001-slot cache, so an undamaged cell paints
  identically in Initial strength and Remaining strength.
- The Remaining strength view paints the same ramp, except that a cell whose
  remaining strength is below the debris limit uses `desaturateInto`: the same
  HSL lightness with the saturation removed, so grey means rubble and warmth
  means the cell still holds. The rubble ramp is cached beside the warm ramp, so
  the render loop still allocates no colour text.
- The debris limit is one absolute constant, `debrisLimit = 0.8 J/cell`, in
  `js/rock-materials.js`; `collapseStrengthLimit` in `js/ceiling.js` reads it.
  It must not be derived from the table, because the table now carries a
  material that forms below it.

## Sand

- `js/minerals.js` gains a `sand` row: strength `0.5 J/cell` (below the debris
  limit, so it is rubble at its own strength and shows grey in Remaining
  strength view from the first frame), growth `10` (the slider floor, the plain
  loose-face clump, so it lets go as separate grains), colour `[206, 178, 132]`,
  and a narrow signature inside the silica corner of the element cube that does
  not reach the corundum box.
- Rarity gains a `filler` weight (`0.3`), which puts the target share at about
  5% of the rock without making it a rare tier. The lab gets the matching
  FILLER weight slider so Auto-adjust still calibrates the whole table.
- Price: the abundance curve alone would make a 5% mineral dear, so the table
  gains `demandMean`, the average the market's seed-derived demand swings
  around (`1` for an ordinary ore). Sand sets `0.03`, which quotes roughly
  0.7–1.1 cr/cell against the 12.5 cr average cell; the 0.4 cr market floor and
  the existing demand period/depth still apply.

## Acceptance

- Initial strength shows the shipped ramp end to end; Remaining strength shows
  the same colours for rock that holds and grey for exactly the cells below the
  debris limit; an undamaged cell paints alike in both views unless its material
  forms below the limit.
- Sand takes a few percent of the rock on several seeds, forms rubble-coloured
  seams, releases as single cells, and stays the cheapest material in the
  market on every seed.
- The whole Node suite passes, and the help drawer, the inspector tag and the
  lab controls describe the same rules the code applies.
