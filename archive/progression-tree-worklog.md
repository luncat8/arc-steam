# Progression tree

- Combined research and equipment into one drawer tree. Each technology appears once beneath its first prerequisite, with all prerequisites named on the node; its equipment and tier selectors live on the same branch. Ungated purchases remain together below the tree.
- Kept the live platform specification and both contextual help topics available. Corrected tier selection refresh and free swaps of owned tiers.
- Validation: `node --test experiments/*.test.js` (114 passed before correcting a new hierarchy assertion); `node --test experiments/interface.test.js experiments/commune.test.js` (30 passed after correction).

Next: consider a visual graph for cross-branch prerequisites if the technology tree grows substantially.
