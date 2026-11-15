// Canonical mineral definitions for formation, dry mechanics and wet chemistry.
// Thirteen rows form rock; Pure Gold is a liberated, debris-only phase.
// Quotes are derived by rock-materials.js, never stored in this table.
(function (root) {
	'use strict';
	const ANY = Object.freeze([0, 1]);
	const mineralTable = Object.freeze([
		Object.freeze({
			id: 'stone', name: 'Stone', symbol: 'St', analog: 'host rock', host: true,
			r: ANY, g: ANY, b: ANY,
			rarity: 'host', strength: 4.2, growth: 120, color: Object.freeze([114, 124, 132]),
			demandPeriod: 380, demandDepth: 0.3, demandMean: 1,
			sol: 'none', rho: 2.8, dye: null, dissolveSpeed: 0,
			brineF: 0, ventF: 0, residueF: 1, leachFloor: 0,
			residueId: 'stone', erodibility: 0.45, targetShare: 0.25306968791500667,
		}),
		Object.freeze({
			id: 'iron', name: 'Iron ore', symbol: 'Fe', analog: 'Fe₂O₃',
			r: Object.freeze([0.287, 0.983]), g: Object.freeze([0.006, 0.535]), b: Object.freeze([0.007, 0.624]),
			rarity: 'common', strength: 5.4, growth: 220, color: Object.freeze([184, 91, 64]),
			demandPeriod: 220, demandDepth: 0.35, demandMean: 1,
			sol: 'none', rho: 5.2, dye: null, dissolveSpeed: 0,
			brineF: 0, ventF: 0, residueF: 1, leachFloor: 0,
			residueId: 'iron', erodibility: 0.14, targetShare: 0.16606104471004876,
		}),
		Object.freeze({
			id: 'copper', name: 'Chalcopyrite', symbol: 'Cu', analog: 'CuFeS₂ (dry Cu)',
			r: Object.freeze([0.232, 0.667]), g: Object.freeze([0.037, 0.363]), b: Object.freeze([0.193, 0.447]),
			rarity: 'uncommon', strength: 4.8, growth: 140, color: Object.freeze([198, 130, 64]),
			demandPeriod: 130, demandDepth: 0.55, demandMean: 1,
			sol: 'none', rho: 4.8, dye: null, dissolveSpeed: 0,
			brineF: 0, ventF: 0, residueF: 1, leachFloor: 0,
			residueId: 'copper', erodibility: 0.16, targetShare: 0.03915,
		}),
		Object.freeze({
			id: 'vitriol', name: 'Blue Vitriol', symbol: 'Cu·H₂O', analog: 'CuSO₄·5H₂O',
			r: Object.freeze([0.46, 0.76]), g: Object.freeze([0.06, 0.36]), b: Object.freeze([0.54, 0.74]),
			rarity: 'uncommon', strength: 1.8, growth: 140, color: Object.freeze([44, 152, 240]),
			demandPeriod: 130, demandDepth: 0.55, demandMean: 1,
			sol: 'instant', rho: 2.3, dye: Object.freeze([38, 102, 248]), dissolveSpeed: 1.25,
			brineF: 1, ventF: 0, residueF: 0, leachFloor: 0,
			residueId: 'vitriol', erodibility: 0.35, targetShare: 0.03915,
		}),
		Object.freeze({
			id: 'quartz', name: 'Quartz', symbol: 'Qz', analog: 'SiO₂',
			r: Object.freeze([0.001, 0.482]), g: Object.freeze([0.23, 0.87]), b: Object.freeze([0.002, 0.562]),
			rarity: 'common', strength: 6, growth: 70, color: Object.freeze([212, 210, 224]),
			demandPeriod: 340, demandDepth: 0.32, demandMean: 1,
			sol: 'none', rho: 2.6, dye: null, dissolveSpeed: 0,
			brineF: 0, ventF: 0, residueF: 1, leachFloor: 0,
			residueId: 'quartz', erodibility: 0.68, targetShare: 0.16136890216910144,
		}),
		Object.freeze({
			id: 'corundum', name: 'Corundum', symbol: 'Al', analog: 'Al₂O₃',
			r: Object.freeze([0.099, 0.401]), g: Object.freeze([0.699, 0.951]), b: Object.freeze([0.049, 0.301]),
			rarity: 'rare', strength: 7.8, growth: 40, color: Object.freeze([216, 74, 128]),
			demandPeriod: 200, demandDepth: 0.4, demandMean: 1,
			sol: 'none', rho: 4, dye: null, dissolveSpeed: 0,
			brineF: 0, ventF: 0, residueF: 1, leachFloor: 0,
			residueId: 'corundum', erodibility: 0.18, targetShare: 0.034375044267374956,
		}),
		Object.freeze({
			id: 'fluorite', name: 'Fluorite-Salt', symbol: 'CaF₂', analog: 'CaF₂·NaCl',
			r: Object.freeze([0.066, 0.384]), g: Object.freeze([0.104, 0.546]), b: Object.freeze([0.615, 0.985]),
			rarity: 'uncommon', strength: 3, growth: 45, color: Object.freeze([108, 182, 152]),
			demandPeriod: 150, demandDepth: 0.6, demandMean: 1,
			sol: 'slow', rho: 3.1, dye: Object.freeze([56, 220, 140]), dissolveSpeed: 0.88,
			brineF: 0.55, ventF: 0, residueF: 0.45, leachFloor: 0.45,
			residueId: 'fluorite', erodibility: 0.4, targetShare: 0.08364254094732183,
		}),
		Object.freeze({
			id: 'silver', name: 'Silver', symbol: 'Ag', analog: 'Ag',
			r: Object.freeze([0.673, 0.957]), g: Object.freeze([0.263, 0.547]), b: Object.freeze([0.043, 0.327]),
			rarity: 'rare', strength: 3.5, growth: 180, color: Object.freeze([208, 220, 232]),
			demandPeriod: 180, demandDepth: 0.5, demandMean: 1,
			sol: 'none', rho: 10.5, dye: null, dissolveSpeed: 0,
			brineF: 0, ventF: 0, residueF: 1, leachFloor: 0,
			residueId: 'silver', erodibility: 0.05, targetShare: 0.030906938911022582,
		}),
		Object.freeze({
			id: 'gold', name: 'Gold-quartz', symbol: 'Au', analog: 'Au in SiO₂',
			r: Object.freeze([0.823, 0.977]), g: Object.freeze([0.063, 0.257]), b: Object.freeze([0.424, 0.656]),
			rarity: 'very rare', strength: 3.4, growth: 60, color: Object.freeze([232, 198, 92]),
			demandPeriod: 420, demandDepth: 0.35, demandMean: 1,
			sol: 'none', rho: 5.6, dye: null, dissolveSpeed: 0,
			brineF: 0, ventF: 0, residueF: 1, leachFloor: 0,
			residueId: 'gold', erodibility: 0.22, targetShare: 0.012342374944665785,
		}),
		Object.freeze({
			id: 'gas', name: 'Gas rock', symbol: 'Gb', analog: 'CH₄ / H₂',
			r: Object.freeze([0, 0.2]), g: Object.freeze([0, 0.2]), b: Object.freeze([0.8, 1]),
			rarity: 'uncommon', strength: 0.8, growth: 20, color: Object.freeze([172, 218, 94]),
			demandPeriod: 120, demandDepth: 0.6, demandMean: 1,
			sol: 'fast', rho: 1.2, dye: null, dissolveSpeed: 1.45,
			brineF: 0, ventF: 0.85, residueF: 0.15, leachFloor: 0,
			residueId: 'stone', erodibility: 0.5, targetShare: 0.009588291279327138,
		}),
		Object.freeze({
			id: 'sand', name: 'Sand', symbol: 'Sd', analog: 'SiO₂ loose',
			r: Object.freeze([0.022, 0.378]), g: Object.freeze([0.283, 0.677]), b: Object.freeze([0.324, 0.619]),
			rarity: 'filler', strength: 0.5, growth: 10, color: Object.freeze([204, 178, 126]),
			demandPeriod: 300, demandDepth: 0.3, demandMean: 0.03,
			sol: 'none', rho: 1.6, dye: null, dissolveSpeed: 0,
			brineF: 0, ventF: 0, residueF: 1, leachFloor: 0,
			residueId: 'sand', erodibility: 1, targetShare: 0.04324931385568838,
		}),
		Object.freeze({
			id: 'halite', name: 'Halite', symbol: 'NaCl', analog: 'NaCl (R·G salt)',
			r: Object.freeze([0.616, 0.924]), g: Object.freeze([0.676, 0.964]), b: Object.freeze([0.036, 0.344]),
			rarity: 'uncommon', strength: 1.6, growth: 24, color: Object.freeze([110, 228, 148]),
			demandPeriod: 260, demandDepth: 0.35, demandMean: 0.15,
			sol: 'instant', rho: 2.2, dye: Object.freeze([38, 228, 128]), dissolveSpeed: 1.65,
			brineF: 1, ventF: 0, residueF: 0, leachFloor: 0,
			residueId: 'halite', erodibility: 0.35, targetShare: 0.06558799247454628,
		}),
		Object.freeze({
			id: 'fizzy', name: 'Fizzy Halite', symbol: 'R₂G₂B₂', analog: 'R₂G₂B₂ gas-salt',
			r: Object.freeze([0.636, 0.944]), g: Object.freeze([0.677, 0.963]), b: Object.freeze([0.677, 0.963]),
			rarity: 'uncommon', strength: 1.3, growth: 20, color: Object.freeze([174, 242, 184]),
			demandPeriod: 200, demandDepth: 0.4, demandMean: 0.2,
			sol: 'fast', rho: 1.9, dye: Object.freeze([86, 226, 142]), dissolveSpeed: 1.5,
			brineF: 0.6666666666666666, ventF: 0.3333333333333333, residueF: 0, leachFloor: 0,
			residueId: 'fizzy', erodibility: 0.35, targetShare: 0.06150786852589643,
		}),
		Object.freeze({
			id: 'pure_gold', name: 'Pure Gold', symbol: 'Au*', analog: 'Au placer nugget', gen: false,
			r: Object.freeze([0.95, 1]), g: Object.freeze([0, 0.1]), b: Object.freeze([0, 0.1]),
			rarity: 'liberated', strength: 3.4, growth: 60, color: Object.freeze([255, 215, 36]),
			demandPeriod: 420, demandDepth: 0.35, demandMean: 1,
			sol: 'none', rho: 19.3, dye: null, dissolveSpeed: 0,
			brineF: 0, ventF: 0, residueF: 1, leachFloor: 0,
			residueId: 'pure_gold', erodibility: 0.01, targetShare: 0,
		}),
	]);

	const mineralCount = mineralTable.length;
	const mineralNames = mineralTable.map(mineral => mineral.name);
	const mineralSymbols = mineralTable.map(mineral => mineral.symbol);
	const mineralIds = mineralTable.map(mineral => mineral.id);
	const hostIndex = mineralTable.findIndex(mineral => mineral.host);
	const formationCount = mineralTable.filter(mineral => mineral.gen !== false).length;
	const rarityWeights = Object.freeze({ host: 0, liberated: 0, filler: 0.3, common: 1, uncommon: 0.45, rare: 0.19, 'very rare': 0.07 });
	// Calibrated shares, not formation inputs: the copper family totals 7.83%.
	const rarityTargets = Float64Array.from(mineralTable, mineral => mineral.targetShare);
	const targetHostShare = rarityTargets[hostIndex];
	const api = {
		ANY, mineralTable, mineralCount, formationCount, mineralNames, mineralSymbols, mineralIds, hostIndex,
		rarityWeights, rarityTargets, targetHostShare
	};
	root.SteamMinerals = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
