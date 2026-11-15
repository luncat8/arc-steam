# Water & cave fluid architecture planning + standalone water lab

## Review of previous task and existing plans

- Reviewed `97b6233` (`js/sandblaster.js`, `0.3.6-Sandblaster-plan.md`):
  the sandblaster now feeds on hopper sand and stone with `autoFire` and no
  wall-bought magazine. `0.3.6-Water-draft.md` still referenced the superseded
  sandblaster magazine and SELL-wall water auto-buy.
- Reviewed `0.3.6-Water-draft.md` alongside `gas-caves.1-plan.md` and
  `0.4.0-wild-mine-draft.md`: classic chamber uses 1D ceiling/floor heightmaps,
  whereas gas caves and Wild Mine require arbitrary 2D voids, overhangs,
  multi-surface debris, and 512-row vertical streaming. A 1D water heightfield
  cannot survive caves.

## Prototype built (`prototypes/water-lab.html`, `water-lab.css`, `water-lab.js`)

- Standalone `file://`-friendly interactive water lab at exact game scale
  (`24 × 15 m`, `192 × 120` rock at `0.125 m/cell`, `96 × 60` fluid grid at
  `0.25 m/cell`, `3.6 m` wheeled platform following cave floors).
- Compares three selectable 2D fluid solvers under identical controls, scenes
  (Classic Chamber, Caves & Ledges, Wild Mine U-Tube, Dam Breach), aimed
  unlimited-tank water gun, under-platform suction pump, and rock dissolution
  with exact slurry conservation:
  1. **Hybrid (Ballistic Jet/Cascade + 2D Pressure/Wave Cells):** aimed
     ballistic jet + overhang-to-droplet re-emission for parabolic waterfalls +
     multi-pass hydrostatic/compression cells with staggered horizontal wave
     momentum (`edgeU`). Unlimited flooded volume at fixed memory.
  2. **Particles (2D SPH / Clavet Double-Density Relaxation):** unified jet,
     splash and pool on a spatial hash against exact 2D rock SDF; capped at
     1,800 particles (~30 m²).
  3. **Grid+Particle (2D FLIP / PIC on a staggered MAC grid):** incompressible
     waves, waterfalls and platform bow wake (airborne jet particles bypass MAC
     projection); capped at 2,400 particles (~37.5 m²).
- Shared visible-surface renderer: `C⁰`-continuous sub-cell signed height /
  density Marching Squares in a single unified fill path (no semi-transparent
  overlap striping and no expensive `ctx.clip()`), solid-wall flush
  extrapolation with rock drawn on top, golden slurry overlay, and bright
  air-water meniscus highlight.

## Plan updates

- Rewrote `0.3.6-Water-draft.md` as a standalone design artifact:
  - Corrected sandblaster baseline references.
  - Added **unlimited tank (v1)** (gun floods freely using reserve energy) and
    **under-platform suction pump** (retrieves water + carried mineral slurry
    directly beneath the chassis).
  - Documented the particle vs. cell vs. FLIP comparison with measured
    prototype costs and recommended the **Hybrid (Ballistic Jet/Cascade + 2D
    Smooth-Surface Cells)** model, shared 2D occupancy/SDF interface, exact
    slurry conservation, and exact energy ledger closure under unlimited water.
- Added concise fluid-compatibility notes to `0.4.0-wild-mine-draft.md`
  (`## Cave representation`) and `gas-caves.1-plan.md` (`## Generation and
  integration constraints`) so caves and water share one 2D occupancy + SDF
  contract.

## Validation

- `node --check prototypes/water-lab.js` — clean.
- `node --test experiments/water-lab.test.js` — 4/4 pass (HTML id parity,
  water & slurry conservation across all 3 solvers, Wild Mine U-tube flow +
  under-platform suction, dam breach waterfall conservation & basin arrival).
- Warmed Node benchmark (`300` steps × 4 scenes):
  - `hybrid`: `0.40–1.12 ms/step`, water drift `≤ 5e-5`, slurry drift `≤ 1.2e-5`.
  - `sph`: `0.62–1.82 ms/step`, water & slurry drift `0`.
  - `flip`: `0.53–1.61 ms/step`, water & slurry drift `0`.
- Headless Chromium visual review (`file://` open, 0 console/page errors) across
  all four scenes and smooth vs. raw surface modes confirmed seamless pools,
  flush cave-wall contact, parabolic overhang cascades, U-tube equalization,
  and visible under-platform suction drawdown.
- `git diff --check` verified clean whitespace/LF.

## Next step

Open `prototypes/water-lab.html` to compare Hybrid vs. FLIP vs. SPH live
(especially Caves & Ledges and Dam Breach) and confirm whether to proceed with
the Hybrid (Ballistic Jet/Cascade + 2D Smooth-Surface Cells) architecture for
the `js/water.js` implementation milestone — starting with the dissolution &
pump yield probe (`experiments/water-yield-probe.cjs`) and classic-chamber
2D occupancy adapter.
