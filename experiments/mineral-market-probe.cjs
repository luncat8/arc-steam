'use strict';
// Measure the mineral table and the live market: rarity, base price, opening
// quote and the four-minute range each mineral trades over.
// Run with `node experiments/mineral-market-probe.cjs`.
const ceiling = require('../js/ceiling.js');

function meanCellValue(state, prices) {
	const count = state.mineralNames.length;
	let total = 0;
	for (let index = 0; index < state.columns * state.rows; index++) {
		let value = 0;
		for (let m = 0; m < count; m++) value += state.minerals[index * count + m] * prices[m];
		total += value;
	}
	return total / (state.columns * state.rows);
}

console.log('seed  mineral    share   base   open   four-minute low/high');
for (const seed of [1, 31, 73, 1234]) {
	ceiling.reset(seed);
	const state = ceiling.state;
	const count = state.mineralNames.length;
	const low = Array.from(state.mineralPrices);
	const high = Array.from(state.mineralPrices);
	for (let second = 0; second < 240; second++) {
		ceiling.advanceMarket(1);
		for (let m = 0; m < count; m++) {
			if (state.mineralPrices[m] < low[m]) low[m] = state.mineralPrices[m];
			if (state.mineralPrices[m] > high[m]) high[m] = state.mineralPrices[m];
		}
	}
	for (let m = 0; m < count; m++) {
		console.log(
			String(seed).padStart(4),
			state.mineralNames[m].padEnd(9),
			state.mineralAbundance[m].toFixed(3).padStart(6),
			state.mineralBasePrices[m].toFixed(1).padStart(6),
			state.mineralPrices[m].toFixed(1).padStart(6),
			(low[m].toFixed(1) + '..' + high[m].toFixed(1)).padStart(18)
		);
	}
	console.log('     mean cell at base', meanCellValue(state, state.mineralBasePrices).toFixed(2),
		'· target', state.targetCellValue);
}
