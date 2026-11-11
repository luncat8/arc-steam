# Mineral lab views

- Reviewed the existing desired-share lab and main-game view input. Main-game hover selects persistently, only on a fine hover pointer; it is not a temporary preview.
- Added matching hover selection with click/keyboard change retained and redundant redraws skipped.
- Added mineral-weighted strength on an absolute 0–strongest-pure-mineral scale, and price using the game's base-price curve over fixed default target shares. These are reference quotes, not the main game's live market; the lab states that distinction.
- Cell tooltips include J/cell and reference credits/cell.
- Validation: `node --check prototypes/mineral-lab.js`, `node experiments/mineral-lab-views.test.cjs`, `git diff --check`. Browser interaction was not tested in this environment.
- Next: review minerals.2 strength migration and the draft's absolute-strength display requirement before changing runtime mechanics.
