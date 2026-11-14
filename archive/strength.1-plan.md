# strength.1 — Strength-aware delayed collapse

## Goal

A light indirect impact should make weak rock eligible to fall sooner than
strong rock, including in a mixed geological seam. Keep collapse delayed and
restricted to the exposed rock face; untouched rock does not fall.

## Model

- Keep initial cell strength as the mineral-weighted resistance from the
  shared material table. Remaining strength and impact-induced looseness are
  separate quantities: the strength view shows absolute remaining resistance,
  while the Damage view shows looseness.
- Keep the impact radius, falloff, strength-removal budget, 50% per-hit cap
  and energy accounting. For remaining strength `S` before a hit and strength
  spent `dS`, add `4 * (dS / S) * (1 + 0.5 * (maxStrength / S - 1))` to the
  cell's looseness, capped at 1. The strongest pure mineral defines
  `maxStrength`. This makes low absolute remaining strength more susceptible
  without giving a sound cell free damage.
- Only an exposed face with looseness at least 0.3 and satisfying the surface
  step rule is a collapse candidate. A buried loose cell remains held until
  exposed, without erasing its accumulated looseness.
- Check each horizontal band at most once per 0.25 seconds. Choose a candidate
  weighted by weakness. A candidate's roll has a nonzero chance even if the
  average of all touched rock in the band is below the eligibility threshold.
  With `excess = clamp((bandMean - 0.3) / 0.7, 0, 1)`, use
  `0.5 * max(excess, seedLooseness * 0.5) * 100 / (100 + growth)` for the roll.
  Continue to use band damage and growth for the bounded clump size and the
  existing grouping rules.
- The inspector distinguishes sound, weakened, loose and held cells. Mineral
  growth sliders still trade release frequency for larger clumps. Do not add
  allocations to the impact, collapse or render loops.

## Acceptance

- On the same five-cell-offset impact, gas-bearing rock becomes eligible at
  0.1 J while corundum remains held; fluorite becomes eligible at 0.75 J while
  stronger rock at the same offset does not. The comparison also holds for a
  weak seam in the seeded geology, and real ball impacts work in both shapes.
- Weak exposed rock begins to fall on later ticks without another hit; tiny or
  zero hits do not automatically detach sound rock. A lone eligible face is not
  blocked by lightly touched neighbours, and an already-loose deeper cell stays
  loose when exposed.
- Impacts do not immediately clear sound rock; released cells are always on
  the free face, clumps remain bounded, and energy, mass, value and mineral
  accounting remain balanced.
- The full Node suite and a real-browser smoke test pass. Record the balance
  probe and any observed effect on mining pace for subsequent playtesting.
