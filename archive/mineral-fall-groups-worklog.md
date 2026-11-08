# Mineral-matched falling groups — worklog

## Review of the request

- Reduce frequent single-pixel sand falls by allowing selected minerals to release less often in larger clusters.
- Add per-mineral visual controls over +50% to +200% growth.
- Add a controlled test rock with Iron, Copper and Crystal laid left to right and a 0%-to-100% looseness gradient from roof to exposed bottom.

## Decisions

- Growth is a multiplier on the damage-sized base cluster: +50%, +100% and +200% make target groups 1.5×, 2× and 3× their base size. Release probability is inversely scaled by the same setting, so larger groups occur less often.
- A falling cluster grows only through connected exposed cells with the same dominant mineral. It is represented as one mass-bearing fragment, preserving the cells' total mass, center-of-mass height, value and mineral quantities.
- Generate test rock starts a fresh simulation while carrying the live slider settings into it. New game resets the test bed but preserves those settings.

## Implementation

- `js/ceiling.js`: added per-mineral growth and release settings, connected cluster selection, aggregate fragment rendering and accounting, test-bed generation, and a Damage rock palette.
- `index.html`, `styles.css`, `js/main.js`, `js/main_input.js`, `js/help.js`: added the sliders, live readouts, generator button, damage view and help text; made the fall-test controls responsive.
- `experiments/mineral-fall.test.js`: covers mineral bands, damage gradient, larger/rarer clusters, fragment accounting and falling-energy conservation.
- `experiments/interface.test.js` and `experiments/harness.cjs`: cover slider/button wiring and resynchronize energy after test-only fragment teleports or battery edits.
- `README.md`: documents the controls and expected behavior.

## Validation

- `node --check` passed for the changed runtime and test scripts.
- `node --test experiments/mineral-fall.test.js`: **5/5 pass**.
- `node --test experiments/interface.test.js`: **36/36 pass**.
- A four-second natural-fall energy check drifted by approximately `4.1e-10 J`.
- `git diff --check`: clean.

## Next step

Use Generate test rock to compare each mineral at several slider settings, then tune the default growth and release-frequency trade-off based on cluster size and cadence in mixed natural rock.
