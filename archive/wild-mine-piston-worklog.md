# Wild Mine piston worklog

- Replaced the ball-battery release with the platform's upgradeable, thermally derated piston pulse. The ball battery continues to power its own motor and jump actuator.
- Resolved collector and tilted piston as separate contact segments. Only the collector captures; the piston reflects and, when driven, adds a reserve-funded pulse. Back-face contacts remain passive.
- Checked fracture work, empty reserve, tilted contact, collector capture, energy accounting and the existing Wild Mine controls.
- Validation: `node --test experiments/wild-mine.test.js experiments/wild-mine-interface.test.js` (36 passed). Full `experiments/*.test.js` run before updating the interface expectation: 536 passed, one obsolete battery assertion; the updated interface test passes in the targeted run.

Next: playtest the pulse and fracture balance across cave materials and equipment upgrades.
