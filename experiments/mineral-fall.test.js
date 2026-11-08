'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ceiling = require('../js/ceiling.js');

function runTestBed(growth) {
	ceiling.reset(73);
	for (let mineral = 0; mineral < 3; mineral++) ceiling.setMineralClusterGrowth(mineral, growth);
	ceiling.generateTestRock();
	const state = ceiling.state;
	const energy = state.energy;
	ceiling.collapse(12);
	let maxGroup = 0;
	let groups = 0;
	for (let i = 0; i < state.active.length; i++) {
		if (!state.active[i]) continue;
		groups++;
		maxGroup = Math.max(maxGroup, state.debrisCells[i]);
		const minerals = state.debrisMinerals;
		const offset = i * 3;
		assert.ok(Math.abs(minerals[offset] + minerals[offset + 1] + minerals[offset + 2] - state.debrisCells[i] * state.cellMass) < 1e-8);
		if (state.debrisCells[i] > 1) assert.ok(state.debrisWidth[i] > state.cell * 0.76 || state.debrisHeight[i] > state.cell * 0.76,
			'group fragments render larger than a single grain');
	}
	assert.ok(Math.abs(state.energy - energy) < 1e-5, 'forming grouped fragments preserves rock energy');
	return { bursts: state.collapseBursts, groups, maxGroup };
}

test('test rock lays out three mineral bands and a top-to-bottom damage gradient', () => {
	ceiling.reset(1);
	assert.equal(ceiling.state.testRock, false);
	ceiling.generateTestRock();
	const state = ceiling.state;
	assert.equal(state.testRock, true);
	for (let mineral = 0; mineral < 3; mineral++) {
		const column = Math.floor((mineral + 0.5) * state.columns / 3);
		const bottom = column;
		const top = (state.rows - 1) * state.columns + column;
		assert.equal(state.minerals[bottom * 3 + mineral], 1);
		assert.equal(state.minerals[top * 3 + mineral], 1);
		assert.equal(state.prices[bottom], state.mineralPrices[mineral]);
		assert.equal(state.damageField[bottom], 1);
		assert.equal(state.damageField[top], 0);
	}
	for (let row = 0; row < state.rows - 1; row++) {
		assert.ok(state.damageField[row * state.columns] > state.damageField[(row + 1) * state.columns]);
	}
	assert.ok(state.looseCells > 0, 'the exposed bottom edge is ready to fall');
});

test('Damage rock view paints the generated looseness gradient', () => {
	ceiling.reset(1);
	ceiling.generateTestRock();
	const colors = new Set();
	const context = {
		set fillStyle(value) { colors.add(value); },
		fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {}
	};
	ceiling.draw(context, 'damage');
	assert.ok(colors.has(ceiling.state.damagePalette[0]));
	assert.ok(colors.has(ceiling.state.damagePalette[100]));
	assert.ok(colors.size > 20, 'the damage view exposes many gradient levels');
});

test('per-mineral growth makes larger, rarer, mass-bearing fragments', () => {
	const smaller = runTestBed(50);
	const larger = runTestBed(200);
	assert.ok(smaller.bursts > 0 && larger.bursts > 0);
	assert.ok(larger.maxGroup > smaller.maxGroup, 'the 200% setting forms larger connected groups');
	assert.ok(larger.bursts < smaller.bursts, 'larger groups use a lower release chance');
	assert.ok(larger.groups > 0);
});

test('group fragments fall and settle with cell counts and energy conserved', () => {
	ceiling.reset(73);
	ceiling.generateTestRock();
	const state = ceiling.state;
	const world = { platform: { x: -10, vx: 0 }, heat: 0, time: 0, direction: 0 };
	const energy = state.energy + world.heat;
	for (let step = 0; step < 240 * 4; step++) ceiling.step(world, 1 / 240, 60);
	assert.ok(state.lostCells > 0, 'test clusters reached the floor');
	assert.equal(state.extractedCells, state.airborneCells + state.caughtCells + state.lostCells);
	assert.ok(Math.abs(state.energy + world.heat - energy) < 1e-5);
});

test('mineral cluster growth is bounded to the slider range and survives New game resets', () => {
	assert.equal(ceiling.setMineralClusterGrowth(0, 25), 50);
	assert.equal(ceiling.setMineralClusterGrowth('Copper', 250), 200);
	ceiling.reset(2);
	assert.deepEqual(Array.from(ceiling.state.mineralClusterGrowth), [50, 200, 200]);
	assert.equal(ceiling.collapseChunkMax, 12);
});
