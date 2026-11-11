# gas-caves.1 — Stable geological voids

Priority: **low / deferred research**. Depends on the shared geology migration in
`minerals.3-plan.md`. Not part of the mineral-strength rollout.

## Goal

Explore rare, seeded gas cavities that create useful geological variety without
making every cave roof immediately collapse or making roofs magically invincible.
Gas-bearing rock remains a solid mineral at **0.8 J/cell**. A cavity is empty
space, not a zero-strength mineral and not an extremely high B concentration.

## Core distinction

Track cell occupancy separately from remaining strength and fracture history.
Distinguish generated void, intact solid, damaged solid and removed solid.
A never-solid cave must not count as mined material, fracture energy, debris,
cargo, revenue or a fully damaged neighbor. This distinction must survive row
shifts and all occupancy/collision queries.

Do not create cavities by setting strength to zero after generation: that conflates
geological emptiness with mining damage and can seed collapse on every boundary.
Do not use the gas-bearing mineral fraction alone as a cavity threshold: that
would silently change mineral abundance, price and conservation semantics.

## Roof stability: research before implementation

First probe the existing collapse triggers on a deliberately carved test cave.
Identify which rules respond to exposed faces, accumulated damage, unsupported
regions and damage propagation. Mere exposure must not imply fracture damage.
A newly generated, undamaged roof should not start with collapse credit simply
because it borders air. However, removing geological support by mining must still
have consequences, including for undamaged but newly unsupported rock.

Compare two approaches with identical test geometry:

1. **Bounded stable geometry (preferred first experiment).** Generate small,
   rounded/arched cavities with sufficient solid roof thickness and side pillars;
   reject excessive spans, thin roofs and disconnected floating islands. Treat
   zero-damage generated rock as initially equilibrated. Damage near a roof or
   mining out a supporting pillar can activate local failure checks. This is an
   explicit gameplay approximation, not a physical arch simulation.
2. **Local support/span estimate (only if needed).** Compute a bounded support
   score from side connections, roof thickness, span and material cohesion.
   Update dirty regions after material removal rather than flood-filling every
   frame. Define how load can transfer sideways; a simple vertical support test
   would incorrectly collapse every roof over a void. Distinguish unsupported
   islands from an arch attached to both sides. Evaluate memory/time costs before
   choosing a global connectivity model.

Reject permanent cave-wall immunity, invisible supports and a blanket collapse
probability reduction: these hide instability rather than explaining stability.
If current collapse mechanics cannot express support loss without broad changes,
keep caves deferred instead of shipping an invulnerable roof workaround.

## Generation and integration constraints

- Use a separate seeded cavity field/shape process in absolute geological cell
  coordinates. Parameters include rarity, maximum span, minimum roof thickness
  and separation; determine numbers through probes rather than inventing balance.
- Generation needs a bounded halo or deterministic feature ownership so cave
  shapes and roof checks agree across streamed row boundaries. Avoid clipping a
  feature into an accidental unsupported roof when new rows enter the chamber.
- Constrain initial caves away from unsafe boundary/open-face intersections;
  explicitly decide later whether caves may open into the chamber naturally.
- Solid rock surrounding cavities still comes from the standard mineral model.
  Measure abundance over solid cells; report void fraction separately.
- Collision and reflection must handle cave interiors, ceilings, side walls and
  entrances, not only a single exposed lower heightmap. Audit renderer, selection,
  scan visibility, fragment paths and prediction before claiming playable caves.
- Gas pressure, explosions, ventilation and gas sales are out of scope. These
  cavities contain non-simulated gas unless a separate mechanics plan is approved.

## Research gates and acceptance

1. Static test cave: demonstrate stable undamaged roof over a long simulated idle
   period without suppressing normal collapse elsewhere. Record which trigger
   changes are required and why.
2. Undermine one pillar, damage the crown and sever an entire roof connection in
   separate tests. Failure should respond locally and plausibly, including an
   undamaged island newly isolated by removal. No permanent boundary immunity.
3. Validate no phantom fragments, cargo/value, fracture energy or mined-cell
   counts on generation; all later removal conserves the existing ledgers.
4. Verify deterministic shapes and stability across row streaming, compaction,
   reseeding and different frame steps. Measure bounded update costs.
5. Only after these gates choose geometry-only versus support-aware mechanics,
   document the limits, and write an implementation plan with measured parameters.

Next research artifact: a deterministic cave-stability probe with one arch,
one thin flat roof and one deliberately unsupported island. This plan does not
promise that arbitrary cave shapes can be supported by the current simulation.
