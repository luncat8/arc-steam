# Green baseline, progression-tree Hydrology wiring, and radiator preview fix

## Previous-task review

Reviewed `archive/nozzle-pose-worklog.md` and its changes in `js/physics.js`,
`js/main_draw.js`, `js/water.js`, `js/sandblaster.js`, `js/rockets.js`, and
`experiments/nozzle-geometry.test.js`:

- `SteamPhysics.collectorPointAt` reuses a scratch object, rotates through
  `platformPointAt`, and clamps launch X to `[0, config.width]` when the
  collector enters the left wall pocket.
- `drawRigMachinery` correctly un-rotates the world-space water barrel aim by
  the chassis angle, and `sandblaster.js` balances vertical terrain work
  algebraically across raised and pitched poses.
- `nozzle-pose-worklog.md` left three pre-existing full-suite failures and a
  stale browser-smoke assertion as the immediate next step.

## Changes

- **`js/main_progress.js` (progression tree layout & SVG edges):**
  - `hydrology` requires both `thermodynamics` and `impact` in `js/research.js`,
    but `treeEdges` omitted `impact -> hydrology`, and `thermodynamics ->
    hydrology` reused the col-3-to-col-2 `gutterPath`, which drew backwards
    corners and passed straight behind the `storage` card down to an orphan
    row 7 while leaving `{ row: 6, col: 3 }` empty.
  - Moved `hydrology` into `{ row: 6, col: 3 }` for a compact 3 × 4 grid, added
    the missing `impact -> hydrology` edge (14 edges total, matching every
    research prerequisite plus the two root trunks), and replaced the left-only
    gutter path with direction-safe `orthoPath`: `thermodynamics -> power` and
    `thermodynamics -> hydrology` run on parallel rails in the col 2–3 gutter
    clear of `storage`, while `impact -> hydrology` routes down the col 1–2
    gutter and across the row 5–6 gap into `hydrology`.
- **`js/equipment.js` (live radiator swap-preview crash):**
  - Exported `radiatorEntry` alongside `radiators` (matching `balls, ballEntry`).
    `previewRadiator` in `js/main_progress.js` called
    `SteamEquipment.radiatorEntry(installedId)` whenever a radiator was already
    installed, which threw `TypeError` in the live browser; the existing test
    had only hovered from an empty bay.
- **`experiments/dom.cjs` (`commune.test.js` harness):**
  - Taught `loadMainScripts()` to `require()` every non-main `<script src="...">`
    declared by `index.html` in HTML order before evaluating `js/main*.js`.
    Node's module cache preserves already-required or wrapped modules (such as
    `physics.step`) while ensuring UI tests like `commune.test.js` cannot drift
    behind newly added domain scripts (`js/water-chemistry.js`, `js/water.js`).
- **`experiments/research.test.js`:**
  - Verified `hydrology`'s dual-prerequisite lock/unlock (`thermodynamics` and
    `impact`), its unlock of `watergun`, and full 11/11 completion.
- **`experiments/interface.test.js`:**
  - Derived the `#tree-links` edge assertion from `research.nodes` (14 edges)
    and verified hovering `hydrology` highlights both `thermodynamics` and
    `impact`.
  - Updated the stale `bank` radiator preview expectation from `+35.00 W/K`
    (from the old coefficient 50) to `+50.40 W/K` (`0.70 × 72`), and added an
    installed-tier swap check (`vent` fitted → preview `bank` shows `+39.60 W/K`
    and `+12.2 kg`), pinning the `radiatorEntry` fix.
  - Replaced a phase-sensitive `advance(4)` (67 ms < 100 ms readout throttle)
    with `advance(8)` in the water-gun test, and asserted `G` appears in the
    Keys help topic.
- **`experiments/browser-smoke.cjs`:**
  - Derived the SVG prerequisite-edge assertion from `SteamResearch.nodes` and
    checked every path's `d` attribute is non-empty and free of `NaN`.
- **`index.html`, `js/help.js`, `README.md`, `findings-pitfalls-skills.md`:**
  - Updated initial `#research-progress` markup (`0 / 10` → `0 / 11`), added the
    missing `G` water-gun shortcut to the Keys help topic and `README.md`
    controls table, updated `README.md`'s node count/list to include Hydrology,
    and recorded the harness/swap-preview/graph-edge lessons in
    `findings-pitfalls-skills.md`.

## Validation

- `node --check js/*.js`: all 25 scripts pass.
- `node experiments/mineral-lab-views.test.cjs`: passed.
- `node --test experiments/*.test.js`: **430 pass, 0 fail** (up from 422 pass /
  3 fail).
- Real headless Chromium (`playwright-core` + `@sparticuz/chromium` in `/tmp/pw`,
  nothing added to the repo):
  - `node experiments/browser-smoke.cjs`: **PASS**, zero page errors.
  - `node experiments/browser-layout.cjs`: **PASS**, zero page errors.
  - Direct Chromium verification of the progression tree: visually inspected
    screenshots of `#science-drawer` (default and hovering `hydrology`),
    confirming clean parallel col 2–3 gutter rails, zero card overlap,
    dual-prerequisite highlighting (`thermodynamics` + `impact`), and live
    installed-radiator swap preview (`vent` → `bank`: `+39.60 W/K`, `52.00 W/K`,
    zero page errors).
- `git diff --check`: clean.

## Next step

With the full Node and Chromium baseline green, continue with the water-gun
yield tuning left open in `archive/0.3.10-Water-worklog.md`: measure and raise
the dissolution yield (`jetDissolvePower` / `jetWashSeconds` or wetted face
footprint) against `experiments/water-yield-probe.cjs` reading the `cells`
median before touching `shotEnergy` (135 J) separately.
