'use strict';
// Mineral formation and the live market: rarity follows geometry, base prices
// follow abundance, and demand drifts on slow per-mineral noise.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ceiling = require('../js/ceiling.js');

function near(actual, expected, tolerance = 1e-6) {
	assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

function reset(seed) {
	ceiling.reset(seed);
	return ceiling.state;
}

function dominantCounts(state) {
	const count = state.mineralNames.length;
	const totals = new Array(count).fill(0);
	for (let index = 0; index < state.columns * state.rows; index++) {
		let best = 0;
		for (let m = 1; m < count; m++) if (state.minerals[index * count + m] > state.minerals[index * count + best]) best = m;
		totals[best]++;
	}
	return totals;
}

test('elements are independent concentrations and the mineral mix is a normalised probability', () => {
	const state = reset(1);
	const count = state.mineralNames.length;
	const cells = state.columns * state.rows;
	let independent = false;
	for (let index = 0; index < cells; index++) {
		const elementOffset = index * 3;
		let elementSum = 0;
		for (let channel = 0; channel < 3; channel++) {
			const value = state.elements[elementOffset + channel];
			assert.ok(value >= 0 && value <= 1, 'an element concentration is in 0..1');
			elementSum += value;
		}
		if (Math.abs(elementSum - 1) > 0.2) independent = true;
		let mix = 0;
		for (let m = 0; m < count; m++) {
			const fraction = state.minerals[index * count + m];
			assert.ok(fraction >= 0 && fraction <= 1);
			mix += fraction;
		}
		near(mix, 1);
	}
	assert.ok(independent, 'the element channels do not add up to a colour mix');
});

test('element noise is compressed in Y, so deposits are flatter than they are round', () => {
	const state = reset(1);
	let horizontal = 0;
	let vertical = 0;
	let horizontalPairs = 0;
	let verticalPairs = 0;
	for (let channel = 0; channel < 3; channel++) {
		for (let row = 0; row < state.rows; row++) for (let column = 0; column < state.columns - 1; column++) {
			horizontal += Math.abs(state.elements[(row * state.columns + column) * 3 + channel] - state.elements[(row * state.columns + column + 1) * 3 + channel]);
			horizontalPairs++;
		}
		for (let row = 0; row < state.rows - 1; row++) for (let column = 0; column < state.columns; column++) {
			vertical += Math.abs(state.elements[(row * state.columns + column) * 3 + channel] - state.elements[((row + 1) * state.columns + column) * 3 + channel]);
			verticalPairs++;
		}
	}
	assert.ok(vertical / verticalPairs > 2 * horizontal / horizontalPairs,
		'a row-to-row step changes the field about three times as fast as a column-to-column step');
});

test('narrow ranges are rarer: one broad mineral covers more rock than a rare one', () => {
	const state = reset(1);
	const counts = dominantCounts(state);
	const iron = state.mineralNames.indexOf('Iron');
	const gold = state.mineralNames.indexOf('Gold');
	assert.ok(counts[iron] > counts[gold] * 3, 'Iron dominates far more cells than Gold');
	assert.ok(state.mineralAbundance[gold] < state.mineralAbundance[iron] / 3);
	for (let m = 0; m < counts.length; m++) assert.ok(state.mineralAbundance[m] > 0, 'every table entry forms somewhere');
});

test('base prices follow measured abundance on a rarity curve and keep the cell economy calibrated', () => {
	for (const seed of [1, 31]) {
		const state = reset(seed);
		const count = state.mineralNames.length;
		for (let a = 0; a < count; a++) for (let b = 0; b < count; b++) {
			if (state.mineralAbundance[a] >= state.mineralAbundance[b]) continue;
			assert.ok(state.mineralBasePrices[a] >= state.mineralBasePrices[b],
				state.mineralNames[a] + ' is rarer than ' + state.mineralNames[b] + ', so it must not be cheaper');
		}
		let mean = 0;
		for (let index = 0; index < state.columns * state.rows; index++) {
			let value = 0;
			for (let m = 0; m < count; m++) value += state.minerals[index * count + m] * state.mineralBasePrices[m];
			mean += value;
		}
		mean /= state.columns * state.rows;
		assert.ok(Math.abs(mean - state.targetCellValue) < state.targetCellValue * 0.05,
			'the base table puts about one target cell value on the average cell');
	}
});

test('the startup market is seeded per run, and demand can make a common ore open dear', () => {
	ceiling.reset(1);
	const first = Array.from(ceiling.state.mineralPrices);
	ceiling.reset(1);
	assert.deepEqual(Array.from(ceiling.state.mineralPrices), first, 'the same seed opens the same market');
	const base = Array.from(ceiling.state.mineralBasePrices);
	const live = Array.from(ceiling.state.mineralPrices);
	let moved = 0;
	for (let m = 0; m < live.length; m++) if (Math.abs(live[m] / base[m] - 1) > 0.05) moved++;
	assert.ok(moved >= 2, 'seed-derived demand shifts several opening quotes from their base');
	ceiling.reset(2);
	assert.notDeepEqual(Array.from(ceiling.state.mineralPrices), first, 'another run opens another market');
});

test('demand moves prices materially over minutes, never in one-second jumps', () => {
	const state = reset(31);
	const count = state.mineralNames.length;
	const start = Array.from(state.mineralPrices);
	const low = Array.from(state.mineralPrices);
	const high = Array.from(state.mineralPrices);
	let worstStep = 0;
	const previous = Array.from(state.mineralPrices);
	for (let second = 0; second < 240; second++) {
		ceiling.advanceMarket(1);
		for (let m = 0; m < count; m++) {
			const step = Math.abs(state.mineralPrices[m] - previous[m]) / Math.max(1e-9, previous[m]);
			if (step > worstStep) worstStep = step;
			previous[m] = state.mineralPrices[m];
			if (state.mineralPrices[m] < low[m]) low[m] = state.mineralPrices[m];
			if (state.mineralPrices[m] > high[m]) high[m] = state.mineralPrices[m];
		}
	}
	assert.ok(worstStep < 0.02, 'a one-second step stays under 2%');
	let moved = 0;
	for (let m = 0; m < count; m++) if (high[m] / low[m] > 1.1) moved++;
	assert.ok(moved >= 3, 'over four minutes several quotes move by more than 10%');
	assert.ok(start.length === count);
	const periods = state.mineralTable.map(entry => entry.demandPeriod);
	assert.ok(Math.max(...periods) >= Math.min(...periods) * 2, 'some minerals trade on a slower cycle than others');
});

test('rock cells follow the market while a broken fragment keeps the price it broke at', () => {
	const state = reset(73);
	ceiling.generateTestRock();
	ceiling.collapse(5);
	let fragment = -1;
	for (let i = 0; i < state.active.length; i++) if (state.active[i]) { fragment = i; break; }
	assert.ok(fragment >= 0, 'the test bed released a fragment');
	const booked = state.debrisValue[fragment];
	const cellIndex = state.debrisCell[fragment];
	const before = state.prices[cellIndex];
	ceiling.advanceMarket(180);
	assert.ok(Math.abs(state.prices[cellIndex] - before) > 1e-6, 'the live cell was repriced');
	assert.equal(state.debrisValue[fragment], booked, 'the fragment kept its break-time quote');
	const count = state.mineralNames.length;
	let expected = 0;
	for (let m = 0; m < count; m++) expected += state.minerals[cellIndex * count + m] * state.mineralPrices[m];
	near(state.prices[cellIndex], expected, 1e-3);
});
