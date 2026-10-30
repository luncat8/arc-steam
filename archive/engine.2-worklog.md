# Engine/source balance

## Previous-task review
The force/speed channels correctly reach physics, prediction and autopilot.
The fixed 12 kJ reserve did not scale with their kinetic-energy demand, making
high-tier maximum-speed movement disproportionately short-lived.

## Implementation
- Source selector, available stopped on the centre pad. Electric remains default;
  source swaps preserve charge, dissipate excess rather than granting energy,
  and book actual mass changes. This is a balance-test selector, not a new
  research/purchase progression.
- Hand / coal / oil / electric / nuclear profiles supply different engine mass,
  stored J/kg, useful-energy fraction, refill time, force and speed multipliers.
- Capacity targets four full-throttle wall-to-wall starts with a held ball,
  capped by achievable kinetic energy on this map. Research/machinery scale
  capacity without automatically filling it. Cargo and braking recovery can
  change the measured number of crossings. No cruising drag was added.
- Pack mass uses full-pack ballast (does not disappear as fuel is consumed).
  Stock electric pack mass is included in the original 60 kg machine.
- Shared reserve still powers bounce pulses. Source losses become heat;
  braking heat remains separate. Flywheel overflow becomes heat, not overfill.
- Existing independent crank rescue remains movement-only at zero reserve.
  No automatic return-to-pad behavior was added: manual driving/travel targets
  can always crawl back.
- UI reports engine/pack mass, density, efficiency, refill time and capacity.
  Pad and emergency imports use the live capacity and source refill rate.
- Upgrade mass bookkeeping now uses the actual before/after mass, including
  changes to storage size, rather than only the item's nominal mass delta.

## Validation
105/105 Node tests passed, including the flywheel-cap correction; source test
checks 2–6 estimated crossings for all five unupgraded profiles and exact
energy accounting during empty-reserve rescue. Existing interface tests exercise
source-dependent pad telemetry. `git diff --check` clean.

## Next step
Playtest loaded high-tier source profiles, then gate the source selector through
research and purchases once the relative heat/refill tradeoffs feel right.
