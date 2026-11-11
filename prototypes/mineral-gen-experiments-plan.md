# Mineral generation — prototype experiments

## Goal and baseline

Use `mineral-lab.html` to compare generation and calibration ideas before changing the game. Keep the current absolute Metal / Crystal / Gas channels, feathered mixed affinities, and fixed low-metal / low-crystal gas signature as the baseline. The geology lab is a prototype: `index.html` does not currently load `js/geology.js` or `js/minerals.js`.

Treat the alternative HTML files and `mineral-gen-chat-log.md` as ideas, not as a specification: they mix color RGB with element concentrations and propose a different, exclusive classification model. Do not copy their mineral ranges as composition data.

## 1. Per-mineral targets and honest calibration — first priority

- Add a desired **mean composition share** control beside each mineral's measured share. Start with the existing rarity targets; allow per-mineral overrides. Make the target sum and residual obvious. Stone is the residual target (`1 - sum of enabled ore targets`), not an independent slider; reject or clearly flag totals above 100%. Preserve overrides when changing rarity weights or explicitly offer a reset.
  Implemented in `prototypes/mineral-lab.html`: one percent cell per ore row, stone derived as `100% - sum of ore` and shown but not edited, the desired total on its own line, and a signed achieved-minus-desired residual in percentage points on every row plus the worst case and tolerance count. An ore total over 100% pins stone at 0% and is flagged; blank or out-of-range input is refused or clamped. The rarity weights rewrite the whole vector and the line marks itself hand-edited, which is the explicit reset branch.
- Auto-adjust uses the same `compile` / `statsAt` mixture rules as the map and measured-share table, on a deterministic, cached multi-seed sample. Preserve editable identity constraints: in particular gas stays low in R and G and high in B. Expose what is locked, allow manual edits, and do not silently turn an `any` channel into a constraint. Do not force every requested percentage to be attainable.
- Try bounded coordinate-wise search for range width around the existing centre, with hard identity limits and an optional user lock per channel. Compare it with the existing damped optimizer using the same sample and objective. Binary search is valid only if the *actual measured share* is monotonic in the searched interval with other parameters fixed; specificity, normalization, overlap, feathering, clipping and host-weight changes can invalidate that assumption. Check monotonicity or use bounded candidate search; retain the best measured configuration rather than blindly accepting the last iteration. Report per-mineral residuals, host residual, stop reason, locked constraints and actual results after rounding/export.
- Diagnose unreachable targets: show unmatched-host floor, the contribution/coverage of the fixed gas box and sample size. Do not imply that the requested target was achieved.
  The lab now prints the measured stone floor — `meanHostShare` at the calibrator's minimum host weight, where unmatched cells are pure host — and labels a desired stone share under it as unreachable. Auto-adjust receives that same minimum, so the floor shown is the floor the solver uses. The gas contribution and sample-size warnings remain open. A narrow gas signature and independent channels can make 8% gas impossible without relaxing identity, changing the field distribution, or adopting different semantics.

## 2. Map-level findability and stone — first priority

- Keep the existing views of mean share, dominant share, visible share and connected patches. Add a per-seed summary (minimum, median, maximum and fraction of maps with zero visible/dominant cells) and distinguish the displayed map from the aggregate calibration sample. Evaluate the same 192 × 120 map size across separate seeds and depth windows; do not infer typical-map coverage from an aggregate alone.
- Show both **unmatched cells** (no ore affinity, pure fallback stone) and **host matrix inside matched cells**. Current stone is both: a constant host weight in matches plus 100% fallback when unmatched. Compare this with a prototype-only pure-leftover stone mode, clearly marked as a different composition model. Do not silently change game semantics or compare its exclusive-cell counts to mixture shares as if equivalent.
- Calibration and validation must use disjoint, recorded seeds. Include a case where all ore boxes miss: it must stay stone. Inspect visible maps and patch sizes, not just a fitted global percentage.

## 3. Optional mineral candidates — second priority

- Keep Stone always enabled. Give non-host rows an enable checkbox, and add separate, disabled-by-default candidate rows such as magnetite, bauxite, native gold and native copper. These are experimental signatures, not asserted chemical RGB measurements. Disabled rows must contribute no affinity and consume no target; re-normalize targets only through an explicit user action. Keep stable IDs, colors, analogue, strength and ranges separate. Do not mutate the shipped runtime table while experimenting.
- Test enable/disable, overlapping boxes, reset and exports. Compare diversity and per-map findability as mineral count grows; additional overlapping minerals can reduce existing shares and fragment patches.

## 4. Noise alternatives — controlled comparison

- The existing lab already caches sampled fields, shows histograms, uses channel offsets and supports Y flattening. Do not rebuild those features. Test configurable fBm octaves and persistence as an opt-in alternative, with one octave reproducing its own base noise. Keep the seed, scale and Y compression explicit; use independent channel streams and deterministic samples. Display actual marginal histograms, cross-channel correlation and per-map gas coverage.
- The current CDF was measured for the current value-noise algorithm. Never reuse it as a supposedly uniform remap for fBm or another noise type: measure a suitable CDF for each fixed configuration or display the raw distribution and calibrate against actual samples. Compare matched spatial scales, correlation, share residuals, dominant patch sizes, generation time and visual seam shape. Only expose an offset knob if measurements show it improves channel independence or useful variety beyond existing separate hash channels and offsets.

## 5. Alternatives worth comparing, not adopting by default

- **First-match-wins:** prototype a separate exclusive classification view with explicit stable order and pure leftover stone. Its shares mean cell counts, unlike the baseline's fractions. Display overlap/shadowing and count using the same order as rendering; test order changes and zero matches. It cannot directly replace mixtures without changing strength, cargo and price semantics.
- **Sphere / ellipsoid signatures:** compare a bounded centre-and-distance affinity against boxes using the same seed, targets and host model. Give radii per channel, preserve gas identity, and make clear that membership is not physical impact strength. Test whether smoother purity improves seams enough to justify less intuitive range editing.
- **Normalized RGB ratios:** do not adopt for the current composition fields. Dividing by R+G+B couples channels, loses absolute concentration, and changes gas and rarity behavior. If tested, isolate it as a separate model with separate ranges; never interpret visual color ranges as chemistry.
- ID-keyed JSON copy/import is useful for repeatable experiments, with schema/version, deterministic parameters and validated ranges; implement only in the lab and keep classic scripts / `file://` support. YAML and a terminology rename are not needed to test generation.

## Test protocol and acceptance

1. Freeze a baseline: fixed seed list, dimensions, depth windows, noise parameters, ranges, mode and target vector. Record runtime and multi-seed and per-map metrics, including unmatched host, share, visible/dominant fraction, largest and mean connected patch, and missing minerals. Record train and held-out lists separately.
2. Change one feature at a time. Compare baseline and candidate on identical train and held-out maps, with no target tuning on the held-out maps. Inspect dominant and mix views at the same scale. Report variation, not only the pooled mean.
3. Automated tests: deterministic generation and repeated calibration; sum of mix fractions; fallback; gas bounds after auto-adjust and spread; disabled entries; target sum and infeasible targets; optimizer residuals and rounding; overlap/order semantics for any exclusive mode; histogram/CDF validity for each noise configuration; import/export by ID. Test a missing-mineral map, narrow and overlapping signatures, extreme targets and constant/no-coverage fields.
4. Prefer an alternative only if it improves held-out findability and readable patches without breaking identity or making other minerals disappear, and if cost is acceptable. Report worst per-map outcomes and tradeoffs rather than guaranteeing all minerals on every finite map. Keep the existing prototype as a reproducible comparison.

Suggested implementation order: per-mineral target and infeasibility reporting, per-map diagnostics, optional candidates, then noise and alternate matching experiments. Tune gas rarity and coverage only after those measurements are available.

## Source review: Haiku and Qwen prototypes

Decision: keep `mineral-lab.html` as the mixture baseline. Preserve both source HTMLs as reference snapshots; if exploring exclusive resources, build **one separate exclusive lab**, not two competing copies. Haiku and Qwen share the same normalized-ratio / box / first-match model; their meaningful differences are noise and calibration strategies, which can be selectable experiments within that lab.

| Source | Worth taking | Do not copy unchanged |
| --- | --- | --- |
| Haiku | Per-resource desired shares; explicit seed, octave and persistence controls; pointer-event handles; versioned, ID-keyed settings | Auto-adjust randomly relocates signature centres, uses unseeded samples, and fits in target-sorted order while rendering in table order. Rounded boxes and overlap can miss targets. Its noise is Perlin-style gradient noise, not simplex. |
| Qwen | Cached typed-array fields; actual channel histograms; simplex and Y flattening as a spatial alternative; centre-preserving width adjustment | The solver uses coarse 20% growth / 10% shrink steps, a 50–150% target band and 15 passes. It cannot reliably solve shadowed or unreachable resources. Manual slider edits change ranges but do not immediately redraw the map. |
| Chat log | Separate generation from classification and display color; leftover stone; optional resources; explicit overlap policy; readable repeatable settings | Historical bug claims are not a reliable description of the current files: Qwen now defines noise, uses mutable optimizer state and imports by ID. Ratio normalization is an alternative model, not a correctness fix for independent concentrations. |

### Why the exclusive experiment needs separation

- Baseline: independent absolute channels → overlapping affinities → fractional mineral mix plus host matrix. A 10% share is a mean composition fraction.
- Both alternatives: noise → divide by R+G+B → one first-matching resource, otherwise stone. A 10% share is 10% of classified cells. Normalized points lie on R+G+B=1, not throughout the RGB cube; box volume is therefore not their probability.
- In both supplied tables, the quartz box is contained within the earlier silver box. Quartz is completely shadowed at the defaults regardless of noise. Show raw box coverage and awarded coverage separately so this is visible before calibration.
- Moving a box to any convenient cluster can satisfy a numeric target while destroying its intended identity (especially gas). Separate “fit widths with locked identity” from an explicitly destructive “reseed signatures” experiment.

### Smallest useful next builds

1. **Baseline lab:** implement per-resource target controls and achieved-minus-desired residuals first; add held-out per-map findability next. Keep the baseline field and mixture rules unchanged for this step.
2. **Separate exclusive lab, if pursued:** reuse the existing range editor where practical, with deterministic samples, stable visible classification order, pure residual stone, raw/awarded/overlap counts, targets and error. Start with one noise implementation; compare simplex versus gradient fBm only after classification diagnostics work. Keep ratio ranges and settings distinct from baseline composition ranges.
3. In the exclusive solver, fit and validate with the renderer's actual priority order; retain the best measured result and report infeasibility. Test identical/reversed overlapping boxes, fully shadowed quartz, no matches, zero targets and target totals above 100%. Use a separate held-out seed set and remeasure exported precision.

This review is based on source inspection, not a browser visual or performance benchmark. No generator behavior is changed by this plan update.
