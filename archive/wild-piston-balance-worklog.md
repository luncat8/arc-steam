# Wild Mine — piston and strike-head balance

## Review and fixes

- The shop’s pulse, ball mass, damage multiplier and radius reached the cave, but the ball solver used stock restitution on both rock and deck regardless of fit. A first strike with the coil, ram and spiked head spent only 10% of incoming normal energy (3.56 J) on the seed 5 roof; the fitted head and prerequisite research specified 19%. Both the fracture budget and the rebound now use the head’s rock retention. The deck uses the rig’s retention instead, so fitting a head doesn't also change the piston surface.
- Releasing while driving at 1.379 m/s dropped 3.081 J from the ledger. That was exactly the held ball's horizontal share of platform kinetic energy. Release now transfers that share rather than importing it again as new work. The onboard battery still pays only for the ball's own actuators.
- Releases and front-face returns use the same reserve- and heat-limited pulse. An empty reserve still allows a release, but neither that drop nor a passive return increments the powered-push counter.
- Wild **Bounce Assist** reports the next available pulse and, after a rock hit, the fracture joules actually spent. Neither is a claim about sale value. Switching to Classic restores its normal credits/kJ estimate.

## Balance decision

`node experiments/wild-piston-probe.cjs` runs 15 trials on natural, flat roofs at the same height. Start each build on the spawn shelf, rig stationary, intake and ball actuators off, electric engine, full reserve. Release once with the piston level and leave drive on. Measure until the cell over the piston opens, not just until an easier neighbour falls. See [the full measurements](../experiments/logs/wild-piston-balance.txt).

| Stock target (dominant mineral) | Initial strength (J/cell) | Hits to open | Time (s) | Reserve spent (J) |
| --- | ---: | ---: | ---: | ---: |
| Seed 20 · 94% halite | 1.76 | 2 | 1.20 | 105.0 |
| Seed 5 · 100% stone | 4.20 | 3 | 1.77 | 157.5 |
| Seed 24 · 68% corundum | 7.16 | 4 | 2.25 | 210.0 |

Keep the 42 J stock pulse and the per-cell weakening cap. Stock opens all three faces. On the stone target the coil + ram with the standard head opens the cell faster (1.18 s), freeing 7 cells for 315 J. At the same 84 J pulse and 315 J total draw the spiked head spends 6.76 J on the first hit rather than 5.85 J, frees 10 cells, and takes 2.10 s. More fracture and a wider splash do not guarantee faster excavation: the heavier head climbs more slowly and the cap still rewards repeated hits. These are cells freed, not cargo caught or profit, and not a benchmark for sloping roofs or soil-covered faces.

## Validation

- `node --test --test-concurrency=2 experiments/*.test.js experiments/*.test.cjs` — 544 passed. Coverage includes moving releases, partial reserve, derating and cutoff, head-specific fracture and rebound, padded deck returns, passive faces, UI limits and Classic isolation.
- After extending the funded back-face case, the three piston, Wild Mine and interface test files passed again (40/40).
- Balance probe: maximum absolute ledger drift across the 15 runs was `5.82e-11 J`; a repeat produced identical output.
- Focused Chromium check from `file://index.html`: a real release displayed **Next pulse 42.0 J · Last fracture 2.18 J** and **0.000000 J** balance error. Checked drive-off text and horizontal fit at 390 px, restoration of Classic telemetry, and no page errors.

Next: prototype the Wild Mine bore/hammer from the tools plan. Measure the reserve cost of clearing a passage 1.5× the rig's height and compare it with piston excavation before setting the tool's price.
