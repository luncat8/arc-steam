# Shared geology and gas cave planning

- Fetched origin/main at 7878edd; its lab view changes match the working tree.
  Left existing lab files untouched and did not change branch history or merge.
- Reviewed mineral plans, shared sampler/table, lab reference calculations and
  game script wiring. The game still uses a separate table and hardness offset.
- Added minerals.3-plan.md for shared defaults, configuration snapshots, complete
  lab exports, reusable material/price calculations and staged runtime migration.
- Confirmed gas-bearing rock stays at 0.8 J/cell. Added gas-caves.1-plan.md as
  deferred research: distinguish voids from broken rock and test stable roof
  geometry/support-loss behavior before choosing a collapse model.
- Validation: documentation reviewed against current file/API boundaries;
  git diff --check. No runtime changes or repeated runtime tests in this task.
- Next: extract shared defaults and material helpers, establish lab parity, then
  migrate game generation with absolute-coordinate parity tests.
