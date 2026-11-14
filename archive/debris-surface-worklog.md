# Debris surface clipping — worklog

## Change

- Fill each column to its higher crest edge, clipping the tiles that cross the
  same `floorHeight` polyline used by `floorAt`. Tiles already below both
  edges are drawn without a clip, and the canvas is restored before stroking
  the crest or drawing the rest of the scene. This avoids protruding corners
  and uncovered wedges without paying for a clip on every deep tile.
- Clamp the bottom partial tile to its real remaining height instead of
  overlapping the next layer. Keep the checker, compression, pile height,
  values and 64-tile-per-column cap. Reuse per-column scratch arrays rather
  than allocate in the render loop. Remaining texture/phase polish stays
  deferred in `debris.2-plan.md`.

## Validation

- `experiments/debris-compression.test.js` checks the clip path against every
  physical crest vertex, coverage and non-overlap on slopes/steps, safely
  unclipped interior tiles, clip-state restoration, and the 64-layer bound at
  compression 1, 4 and 8. A flat pile does not need a clip. Existing
  compression, material, roof-cap and terrain tests remain in place.
- In headless Chromium, a 960 × 600 raster of a ramp and an 8 m step at
  compression 1, 4 and 8 contained zero tile pixels fully above the crest and
  zero uncovered pixels fully inside it (excluding a one-pixel edge margin;
  crest stroke disabled for this measurement). A visual check of a synthetic
  pile in the game at the same three settings showed the crest following the
  tiles; the coarser checker and uneven phases remain as deferred polish.
- An isolated Chromium canvas benchmark at 40 px/m, including a pixel read,
  measured an empty pile at 0.17–0.19 ms/frame before versus 0.14–0.17 after,
  the ramp/step at 1.44–1.50 versus 2.00–2.16, and a flat roof-high pile at
  5.70–6.27 versus 4.90–6.18. The first version clipping every tile took
  roughly 3.1–4.1 ms/frame on that ramp/step; drawing interior tiles without
  clipping reduced that overhead. A native Canvas roof-high run was 17.3
  versus 17.9 ms/frame. A separate Chromium whole-scene `draw()` benchmark
  at 37 px/m, also forcing a pixel read, gave median times of 3.42 → 3.30 ms
  for empty, 3.78 → 3.78 for a shallow mound, 4.33 → 4.82 for the ramp/step,
  and 10.00 → 9.94 for the flat roof-high pile (three samples each). These
  synthetic samples are environment-dependent and exclude simulation; both
  implementations are bounded by 192 × 64 fills, and the new draw adds at
  most one O(columns) clip path.
- `node --test experiments/*.test.js`: 312/312 pass. The real-browser
  `experiments/browser-smoke.cjs` also passed with no page errors.

## Next

Visually check the clip on the user's piles; leave checker and layer-phase
polish deferred unless they remain distracting.
