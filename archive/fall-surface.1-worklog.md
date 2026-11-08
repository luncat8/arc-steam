# fall-surface.1 — Debris only ever lets go at the free surface

## Review of the remote branches

Three commits were offered for salvage. All three predate `debris` (`ccd010f`, 17:48) and neither is
an ancestor of it, so each was read as an alternative take on the same subject — falling mineral
groups:

- `5dbdfde` (`old-2`, 06:21) — the collapse rewritten as a face peel: `growClump` walks a reach
  lattice, `joins()` accepts a cell only when it is the next cell of a column the clump already took
  or sits beside a cell it holds, `relieve()` unloads the neighbours of a fall, and the clump size
  and the fall cadence became sandbox settings.
- `6874870` (`old-3`, 11:09) — mineral grain: per-mineral clump sizes and a pool four times the cell
  count, with `lumpOfCell` / `absorbed` / `growLump` merging broken cells into a travelling lump.
- `a8f7f17` (`arena/554dc3a4`, 11:47) — per-mineral cluster appetite, a live cluster slider and a
  three-band test scene, plus "switching the scene starts a new game".

**Picked: `joins()` from `old-2`.** `debris` already carries the grouping, the per-mineral growth
sliders, the test bed and the bounded debris pool, so everything else there is superseded — and
`old-3`'s four-times-larger pool works against the bounded-work rule the default pool follows. What
`debris` did *not* have is a real adjacency rule: its cost search skipped a fresh column only when
neither neighbour column had been peeled *at any row*, which accepts a cell that is nowhere near the
flake (`peeled[col - 1]` says nothing about the rows). The same idea as `joins()` closes that.

## Decisions

- **The free face is the only rock allowed to be missing.** A blow that would finish a cell with rock
  still under it leaves it standing at `heldCellShare` (12%) of its original strength instead of
  detaching it, so nothing behind the face can break loose, and the cell is released later by the
  collapse scheduler when the face above it is worked away. This replaces the old "anything left
  hanging over a fresh gap lets go at once" pass, which cleared whole columns under an interior break
  — the exact shape of "rubble out of the middle of the rock".
- **A clump is one connected flake off the face.** `touchesLump` requires each new cell to be the next
  cell of a column the lump already took, or to sit beside (row ±1, so a one-row face step still
  counts) a cell it holds. The lump's centre of mass then lies in the notch it opens: the cost search
  still prefers wide, loose, mineral-matched cells, but it can no longer pick a scattered second piece.
- **The drawn lump is clamped by its whole footprint.** The rock is *collided* through `firstRow` but
  *drawn* through the smoothed `heightmap`, and a lump's body is up to three cells wide; the old clamp
  used the centre column only, so a fresh lump hung half inside the rock beside it. `ceilingUnder`
  takes the lowest underside across the columns the footprint spans and holds the lump below it.
  Measured over a 500-hit shift: 4 705 of 68 688 drawn fragments poked into the drawn rock before,
  0 after.
- The centroid stays the fragment's position: it is the exact energy centre of the removed cells, so
  the rock/debris energy ledger needs no correction term. Only the drawing moves.

## Implementation

- `js/ceiling.js`:
  - `heldCellShare`; the release branch of `damage()` holds an interior cell instead of detaching it,
    zeroes the damage of a released cell, and the hanging-relief pass is gone (16 lines).
  - `lumpHolds` / `touchesLump` replace the column-level adjacency proxy in `peelSurfaceCluster`.
  - `ceilingUnder` plus a one-line clamp in the debris draw replaces the centre-column clamp.
- `experiments/ceiling.test.js`: `the rock is only ever missing at its free face` (per-column
  intact ⟺ row ≥ face, checked through a mixed 240-hit shift) and `a lump that has just let go is
  drawn under the ceiling it broke from` (a worked shaft, a wide lump, a captured draw call).
- `README.md`, `js/help.js`: the surface rule, the footprint clamp, and the two new checks.

## Validation

- `node --test experiments/ceiling.test.js`: 19 pass. The drawn-lump test fails on the pre-change
  `ceiling.js` and passes on the new one, so it pins the new behaviour rather than the old.
- `node --test experiments/*.test.js`: 206 tests, 194 pass — the same 12 pre-existing failures as the
  untouched baseline, no new ones.
- Mining probe (500 hits of 45 J): 5 561 cells extracted, 0 interior removals, 0 cells broken behind an
  intact face, 0 anchored-clump violations; mean 6.2 cells per fall against 5.4 before, so the flake
  rule makes the groups larger rather than smaller.
- Browser run in headless Chromium (the `findings-pitfalls-skills.md` recipe): a zoomed render of a
  mined face at 110 px/m shows the fresh lumps under the surface, and the page reports no errors.
  `git diff --check` clean.

## Next step

The lumps now leave the surface, but a lump that lands on the pile still vanishes into the 4:1 rubble
heightmap without ever being drawn again. Next: pool the landed fragments of the last few seconds as
drawn rubble grains that settle into the pile (`js/ceiling.js` `deposit`), capped like the dust pool,
and measure the per-frame cost of ~40 settling grains before deciding whether the cap is enough.
