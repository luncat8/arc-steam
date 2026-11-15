# solubility.2 — Evaporative Salt Crusts, Settling Basins & Extended Lab Probes

Priority: **low / deferred**. Follow-up enhancements to `0.3.6-Solubility-plan.md` after core water physics, 13-mineral solubility, brine saturation, and hydro-erosion panning are integrated into the live game.

---

## Goal

Extend wet-mining chemistry with reversible precipitation when thin brine puddles dry out, optional evaporation/settling basins, and richer lab diagnostic probes without complicating the core 0.3.6 water implementation.

---

## Deferred Features

### 1. Evaporative Salt Crust Precipitation
- **Behavior:** When slow ambient evaporation reduces a thin fluid cell's volume below its dryout threshold (`water < 0.01`), any remaining dissolved per-mineral brine precipitates onto the underlying solid floor or ledge cell as a thin **salt crust** (`crustMass[idx]`, per-mineral `crustLoads`).
- **Re-dissolution:** Fresh water touching a crusted cell re-dissolves the crust rapidly (`instant` class, respecting local water saturation), returning mass back into solution with zero ledger drift.
- **Visual cue:** Subtle pale emerald/cobalt crystalline frost speckles along dry pool rims.
- **Accounting invariant:** `expectedMass === inWaterBrine + pumpedBrine + lostGasMass + activeDebris + crustMass` (zero mass or value ever silently discarded on evaporation).

### 2. Settling & Re-Crystallization Basins
- **Behavior:** Deep calm pools held near saturation (`sat <= 0.05`) over long periods slowly precipitate excess solute into mineable evaporite floor beds (turning brine runoff trapped in distant cave sumps into harvestable Halite/Vitriol crystals if left unpumped).
- **Constraint:** Must stay strictly optional/toggleable and never disrupt active under-platform suction pumping.

### 3. Extended Lab Diagnostic Tooling (`prototypes/solubility-lab.html`)
- **Beaker Immersion Mode (`Fill` / `Drain`):** Bulk-immersion chamber toggle that floods the rock sample to a target water level and drains it back down, isolating pure bulk dissolution curves, saturation stall ceilings (`volume × satCap`), and leach-floor verification (`Fluorite` stopping cleanly at `45%`) without jet aim variance.
- **Live Stacked Dissolution-Rate Strip Chart:** Compact canvas strip chart below the stage plotting real-time dissolved mass rate (`g/s`) stacked by solubility class (`instant`, `fast`, `slow`) overlaid with active entrained/saltating grain count.
- **Simulation Time-Warp Controls (`0.5× / 1× / 2× / 4×`):** Speed multiplier buttons alongside `Pause` / `Step` for fast multi-minute sluice and karst testing.

---

## Constraints

- Keep zero per-frame allocations (preallocated typed arrays for `crustMass` and strip-chart ring buffers).
- Preserve `file://` classic `<script>` compatibility and exact double-precision mass/value conservation.
- Keep evaporative crusting off or bounded so normal mining shifts do not accumulate unbounded tiny crust records across Wild Mine row streaming.

---

## Acceptance

- Evaporating a loaded puddle leaves visible re-dissolvable crust with `0.0000` mass/value drift; pouring fresh water re-dissolves the crust cleanly into brine.
- Beaker Fill/Drain saturates cleanly to `volume × satCap`, stops dissolution at `sat = 0`, and leaves insoluble grains untouched on drain.
- Strip chart and time-warp controls add `< 0.5 ms` per frame with zero GC pressure.
