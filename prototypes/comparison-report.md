prototypes/mineral-gen-claude-haiku-5.5.html

prototypes/mineral-gen-qwen-3.8.html

prototypes/mineral-gen-chat-log.md

think what ideas is worth to pick to prototype plan.

 it is too different - we can develop both separate from prototypes/mineral-lab.html
 
 Read all three files, plus the current mineral lab and experiment plan.

**recommendation: borrow their useful controls for `mineral-lab.html`, but keep their classification model as one separate experiment—not two separate projects.**

### Worth picking

| Source | Useful ideas |
|---|---|
| Haiku | Per-resource desired shares; octave/persistence controls; pointer-event sliders; versioned, ID-keyed JSON settings |
| Qwen | Cached noise arrays; channel histograms; simplex noise comparison; centre-preserving range adjustment |
| Chat log | Explicit overlap policy; leftover stone; optional resources; separation of signatures from display colors |

The current mineral lab already has caching, histograms, channel offsets, and Y flattening. We should extend those rather than rebuild them.

### Why keep the models separate?

- **Current lab:** independent concentration channels → overlapping affinities → mineral mixtures plus host stone.
- **Both alternatives:** normalize channels so `R+G+B=1` → first matching resource wins → unmatched cells become stone.

So “10% iron” means different things: **mean iron content** versus **10% of cells classified as iron**. Combining these silently would make calibration confusing.

Haiku and Qwen are otherwise similar enough to share **one exclusive-resource lab**, with noise and solver alternatives selectable later.

### Problems not worth copying

- **Both default tables completely shadow quartz:** its box sits inside the earlier silver box, so quartz never wins.
- **Haiku auto-adjust** moves signature centres randomly and fits resources in a different order from rendering. It can lose resource identity without achieving the displayed targets.
- **Qwen auto-adjust** uses coarse steps and accepts a very broad target tolerance. Its manual range edits also do not immediately redraw the map.
- The chat log’s earlier bug descriptions are partly outdated relative to the current files.

### Suggested next step

1. Add **editable desired share + achieved/desired error** to the existing lab.
2. Add **per-map findability diagnostics**, not just pooled percentages.
3. If exclusive cells still interest us, build one separate lab with **visible priority order, overlap/shadowing diagnostics, and pure leftover stone**.
4. Compare noise types afterward, keeping classification fixed.

I added this review and the proposed split to `prototypes/mineral-gen-experiments-plan.md`. **No generator behavior changed.**
