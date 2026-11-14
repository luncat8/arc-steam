# strength.1 — Strength-aware delayed collapse

Plan: `archive/strength.1-plan.md`.

## Investigation

- Initial strength was already the correct mineral-weighted value, with no
  hidden additive offset. The brown Remaining strength view represents
  absolute remaining resistance; a naturally weak cell may be brown but still
  have zero impact-induced looseness.
- Looseness previously grew only with the fraction of a cell's remaining
  strength spent. At five cells from a 0.1 J contact, pure gas rock gained
  0.094 looseness, below the 0.3 eligibility threshold; pure corundum gained
  0.010. The differentiation existed, but the weakest target still needed
  several such hits.
- An eligible face could also be blocked indefinitely: the scheduler refused
  to roll if the *mean of all touched cells* in its band was below 0.3, even
  when several exposed cells were individually loose. It also reduced a
  deeper cell's accumulated looseness by 30% when it became exposed.

## Change

- Retain the material strengths, impact strength removal, hit cap and energy
  accounting. Increase looseness from the same hit according to current
  absolute weakness, with a 0.5 sensitivity factor relative to the strongest
  pure material. Zero impact still adds nothing.
- Give every eligible surface seed a nonzero damage-dependent chance to roll,
  without discarding the existing band-average contribution or mineral growth
  trade-off. Keep the 0.25-second cadence and bounded clump size. Do not erase
  looseness when a previously damaged layer becomes exposed.
- Distinguish sound from slightly weakened cells in the inspector, and explain
  remaining strength versus damage in the chamber help and README.

## Measurements and validation

- `node experiments/strength-collapse-probe.cjs`: at a five-cell offset and
  0.1 J, pure gas looseness is 0.507 instead of 0.094, and nine cells fall
  during the next five seconds; corundum remains at 0.010 and none falls. At
  0.75 J, fluorite reaches 0.339 instead of 0.188, while the corundum target
  remains at 0.072. These are controlled samples, not a promise of a specific
  stochastic fall time.
- In the actual seed-1 weak mixture (0.97 J initial strength), the same 0.1 J
  indirect hit now gives 0.348 looseness instead of 0.077, and three cells
  begin falling in five seconds without another hit. A real 0.098 J ball
  collision reproduces this in both smooth and square rock modes, with mass
  and energy conserved.
- `experiments/strength-collapse.test.js` covers all material strengths,
  mixtures, repeated hits, tiny/zero impacts, the diluted-band and exact
  threshold case, and retained looseness after exposure. Existing tests cover
  bounded falls, free-face-only extraction, grouping and accounting. Two
  settling fixtures now wait for persistent damaged layers to finish falling;
  the pulse test clears heat before isolating the research delta.
- `node experiments/strength-shift-probe.cjs`: 120-second one-ball stock
  shifts over seeds 1, 10, 21 and 47 gave mean extracted cells of 485 → 535 in
  smooth mode and 419 → 730 in square mode compared with `152e329`. Details are
  in `experiments/logs/strength.1-shifts.txt`. Trajectories and individual
  seeds vary widely; this is evidence that collapse pace and heating need
  playtesting, not a balance target. Energy-ledger error stayed below 3e-8 J.
- `node --test experiments/*.test.js`: 312/312 pass. A real Chromium browser
  smoke test and targeted browser raster/weak-rock checks also passed.

## Next

Play-test low-power strikes against the brown weak seams and compare normal
versus square rock for extraction pace and heat; adjust susceptibility or
release timing if the increased collapse rate feels excessive.
