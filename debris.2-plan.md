# debris.2 — Fallen-rubble texture polish

Priority: **low / deferred**. Visual polish only. The debris compression
setting, material accounting and floor physics are not part of this work.

## Goal

Make fallen rubble read as one pile rather than a checker of separate blocks,
while keeping the top edge on the surface the ball and platform ride.

## Current drawing

`drawFloor` in `js/ceiling.js` stacks alternating-colour tiles in each column.
Tiles crossing the piecewise-linear `floorHeight` crest used by `floorAt` are
clipped to it; tiles already below both edges do not need clipping. Each column
is covered to its higher crest vertex before clipping, so no tiles protrude
above the surface. The bottom partial tile stops where the next tile starts.

Layer boundaries are aligned to each column's crest, so neighbouring columns
can have different phases. Together with the checker colours, that can still
look blocky, especially at `DEBRIS 1`. Deep piles use proportionally taller
blocks to stay within the 64-layer budget per column.

## Constraints

- Keep the same `floorPiles`, `floorValues`, material/value accounting and
  `floorAt` physics. Changing `DEBRIS` from 1 to 8 continues to re-lay the
  same material at the new height, with the roof cap unchanged.
- Never draw tile fill above the physical crest or leave a gap underneath it.
  Preserve the sloped surface and the current clip/coverage tests.
- Allocate nothing in the per-frame draw. Keep the work bounded by at most
  192 × 64 tile fills plus one O(columns) surface path, or demonstrate an
  equivalent or cheaper alternative. Test a roof-high pile as well as shallow
  slopes and steps.
- Keep classic `<script>` / `file://` support; do not introduce a build or
  imply per-tile mineral distributions that the simulation does not store.

## Options

Compare the same seeded piles at `DEBRIS` 1, 4 and 8 before choosing:

1. **Ground-aligned layers.** Align boundaries to the ground, with partial
   tiles at the clipped crest, so adjacent columns share a visual phase.
2. **Drop or soften the checker.** Use one pile colour or a subtle shading
   pattern instead of alternating blocks.
3. **Silhouette with optional texture.** Fill the pile as one surface path and
   add inexpensive shading only if it remains necessary to read as rubble.

## Acceptance

- The block/phase artifacts are reduced at all three settings without tile
  corners extending above the crest. `floorAt` and the drawn edge agree.
- Material, value, floor contact and compression behaviour remain unchanged.
- The roof-high draw stays within the existing budget, and a timed before/after
  measurement is recorded in the worklog.
- `experiments/debris-compression.test.js` pins both the retained compression
  contract and the revised drawing, and the full Node suite stays green.
- Visually compare shallow, sloped and roof-high piles at 1, 4 and 8 before
  closing the plan.
