// The mineral table: one row per material, one absolute [low, high] range per
// element channel. Formation, strength, collapse growth, rendering, the fall
// sliders and the market all read this file, so no module keeps a second list.
// `host` marks the host matrix: its mix weight is the constant host weight, it
// is never computed from a range.
//
// The non-gas ranges were calibrated against earlier targets. The gas signature
// is intentionally constrained; re-measure and retune the whole table before
// treating those targets as achievable.
// Loaded before js/ceiling.js; guarded for node so probes can require it.
(function (root) {
	'use strict';

	// Shared by every unconstrained channel: a frozen constant means `any`
	// cannot accidentally become a range that drifts.
	const ANY = Object.freeze([0, 1]);

	const mineralTable = Object.freeze([
		Object.freeze({
			id: 'stone', name: 'Stone', symbol: 'St', analog: 'mixed silicate host', host: true,
			r: ANY, g: ANY, b: ANY,
			rarity: 'host', strength: 4.2, growth: 120, color: Object.freeze([138, 130, 122]),
			demandPeriod: 380, demandDepth: 0.30
		}),
		Object.freeze({
			id: 'iron', name: 'Iron ore', symbol: 'Fe', analog: 'Fe₂O₃',
			r: Object.freeze([0.28, 0.99]), g: Object.freeze([0.00, 0.54]), b: Object.freeze([0.00, 0.63]),
			rarity: 'common', strength: 5.4, growth: 220, color: Object.freeze([184, 91, 64]),
			demandPeriod: 220, demandDepth: 0.35
		}),
		Object.freeze({
			id: 'copper', name: 'Copper ore', symbol: 'Cu', analog: 'CuFeS₂',
			r: Object.freeze([0.31, 0.79]), g: Object.freeze([0.02, 0.38]), b: Object.freeze([0.21, 0.69]),
			rarity: 'uncommon', strength: 4.8, growth: 140, color: Object.freeze([65, 174, 133]),
			demandPeriod: 130, demandDepth: 0.55
		}),
		Object.freeze({
			id: 'quartz', name: 'Quartz stone', symbol: 'Si', analog: 'SiO₂',
			r: Object.freeze([0.00, 0.48]), g: Object.freeze([0.23, 0.87]), b: Object.freeze([0.00, 0.56]),
			rarity: 'common', strength: 6.0, growth: 70, color: Object.freeze([222, 216, 198]),
			demandPeriod: 340, demandDepth: 0.32
		}),
		Object.freeze({
			id: 'corundum', name: 'Corundum', symbol: 'Al', analog: 'Al₂O₃',
			r: Object.freeze([0.10, 0.40]), g: Object.freeze([0.70, 0.95]), b: Object.freeze([0.05, 0.30]),
			rarity: 'rare', strength: 7.8, growth: 40, color: Object.freeze([74, 96, 196]),
			demandPeriod: 200, demandDepth: 0.40
		}),
		Object.freeze({
			id: 'fluorite', name: 'Fluorite', symbol: 'Fl', analog: 'CaF₂',
			r: Object.freeze([0.07, 0.38]), g: Object.freeze([0.11, 0.54]), b: Object.freeze([0.62, 0.98]),
			rarity: 'uncommon', strength: 3.0, growth: 45, color: Object.freeze([163, 106, 196]),
			demandPeriod: 150, demandDepth: 0.60
		}),
		Object.freeze({
			id: 'silver', name: 'Native silver', symbol: 'Ag', analog: 'native Ag',
			r: Object.freeze([0.67, 0.96]), g: Object.freeze([0.26, 0.55]), b: Object.freeze([0.04, 0.33]),
			rarity: 'rare', strength: 3.5, growth: 180, color: Object.freeze([196, 206, 216]),
			demandPeriod: 180, demandDepth: 0.50
		}),
		Object.freeze({
			id: 'gold', name: 'Gold-bearing quartz', symbol: 'Au', analog: 'Au in SiO₂ gangue',
			r: Object.freeze([0.82, 0.98]), g: Object.freeze([0.06, 0.26]), b: Object.freeze([0.42, 0.66]),
			rarity: 'very rare', strength: 3.4, growth: 60, color: Object.freeze([224, 180, 62]),
			demandPeriod: 420, demandDepth: 0.35
		}),
		Object.freeze({
			id: 'gas', name: 'Gas-bearing rock', symbol: 'Gb', analog: 'volatile inclusions',
			r: Object.freeze([0.00, 0.20]), g: Object.freeze([0.00, 0.20]), b: Object.freeze([0.80, 1.00]),
			rarity: 'uncommon', strength: 0.8, growth: 20, color: Object.freeze([188, 200, 130]),
			demandPeriod: 120, demandDepth: 0.60
		})
	]);

	const mineralCount = mineralTable.length;
	const mineralNames = mineralTable.map(mineral => mineral.name);
	const mineralSymbols = mineralTable.map(mineral => mineral.symbol);
	const mineralIds = mineralTable.map(mineral => mineral.id);
	const hostIndex = mineralTable.findIndex(mineral => mineral.host);

	// Rarity is a target share of the rock, not a price multiplier: the lab
	// and the probe tune ranges until the measured shares sit near these
	// weights. The host keeps its own share first, the rest is split by weight.
	const rarityWeights = Object.freeze({ host: 0, common: 1, uncommon: 0.45, rare: 0.19, 'very rare': 0.07 });
	const targetHostShare = 0.32;

	// Share of the rock each rarity tier should occupy, summing to 1.
	const rarityTargets = (function () {
		let weight = 0;
		for (let m = 0; m < mineralCount; m++) weight += rarityWeights[mineralTable[m].rarity] || 0;
		const unit = (1 - targetHostShare) / weight;
		const targets = new Float64Array(mineralCount);
		for (let m = 0; m < mineralCount; m++) {
			const rarity = mineralTable[m].rarity;
			targets[m] = rarity === 'host' ? targetHostShare : unit * (rarityWeights[rarity] || 0);
		}
		return targets;
	})();

	const api = {
		ANY, mineralTable, mineralCount, mineralNames, mineralSymbols, mineralIds, hostIndex,
		rarityWeights, rarityTargets, targetHostShare
	};
	root.SteamMinerals = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
