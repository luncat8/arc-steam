'use strict';
// Strength, impact damage and delayed collapse must agree for weak and hard rock.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ceiling = require('../js/ceiling.js');
const { physics, c, sync, balanced } = require('./harness.cjs');

function pureIndirect(mineral, impact) {
	ceiling.reset(73);
	ceiling.generateTestRock();
	const state = ceiling.state;
	state.damageField.fill(0);
	const m = state.mineralIds.indexOf(mineral);
	const hitColumn = Math.floor((m + 0.5) * state.columns / state.mineralCount);
	const target = hitColumn + 5;
	assert.equal(state.minerals[target * state.mineralCount + m], 1, 'target is still in the pure mineral band');
	const before = state.strength[target];
	ceiling.damage((hitColumn + 0.5) * state.cell, state.bottom + state.cell * 0.5, impact);
	return { before, remaining: state.strength[target], looseness: state.damageField[target], target };
}

test('a low-power indirect hit loosens weak rock much sooner than hard rock', () => {
	const weak = pureIndirect('gas', 0.1);
	const state = ceiling.state;
	assert.ok(weak.looseness >= state.collapseLooseFloor, 'one indirect hit makes gas-bearing rock eligible');
	assert.equal(state.extractedCells, 0, 'the impact itself still does not detach rock');
	ceiling.collapse(5);
	assert.ok(state.fallCells[state.mineralIds.indexOf('gas')] > 0, 'weak rock starts falling without another hit');
	ceiling.collapse(55);
	assert.equal(state.strength[weak.target], 0, 'the weak indirect target can fall without another hit');
	const hard = pureIndirect('corundum', 0.1);
	assert.ok(hard.looseness < state.collapseLooseFloor, 'the same hit leaves hard corundum standing');
	assert.ok(weak.looseness > hard.looseness * 5, 'looseness responds to material strength');
	assert.ok(Math.abs((weak.before - weak.remaining) - (hard.before - hard.remaining)) < 1e-6,
		'the same indirect hit applies the same energy before either cap');
	ceiling.collapse(20);
	assert.equal(state.extractedCells, 0, 'hard rock does not fall from this hit');
	const source = hard.target - 5;
	for (let hit = 1; hit < 30; hit++) ceiling.damage((source + 0.5) * state.cell, state.bottom + state.cell * 0.5, 0.1);
	assert.ok(state.damageField[hard.target] >= state.collapseLooseFloor, 'hard rock can loosen with sufficiently more damage');
});

test('weaker non-gas minerals also loosen from an indirect low-energy strike', () => {
	const fluorite = pureIndirect('fluorite', 0.75);
	const stone = pureIndirect('stone', 0.75);
	const hard = pureIndirect('corundum', 0.75);
	assert.ok(fluorite.looseness >= ceiling.state.collapseLooseFloor, 'fluorite is ready to fall');
	assert.ok(stone.looseness < ceiling.state.collapseLooseFloor, 'stone is not yet ready at the same offset');
	assert.ok(hard.looseness < ceiling.state.collapseLooseFloor, 'corundum is not yet ready at the same offset');
});

test('the same indirect energy produces steadily more looseness as strength decreases', () => {
	const samples = ceiling.state.mineralIds.map(id => pureIndirect(id, 0.1));
	samples.sort((a, b) => a.before - b.before);
	for (let i = 1; i < samples.length; i++) {
		assert.ok(samples[i - 1].looseness > samples[i].looseness,
			'weaker pure minerals must gain more looseness from the same impact');
	}
});

test('the response also works for seeded mineral mixtures, not just pure test bands', () => {
	const state = ceiling.state;
	ceiling.reset(1);
	const surface = Array.from(state.strength.slice(0, state.columns));
	const weak = surface.indexOf(Math.min(...surface));
	const hard = surface.indexOf(Math.max(...surface));
	const strengthOfWeak = surface[weak];
	const strengthOfHard = surface[hard];
	assert.ok(strengthOfWeak < 1.1 && strengthOfHard > 6, 'the seed contains a weak seam and hard rock');
	function hitFiveCellsAway(target) {
		const source = target >= 5 ? target - 5 : target + 5;
		ceiling.damage((source + 0.5) * state.cell, state.bottom + state.cell * 0.5, 0.1);
		return state.damageField[target];
	}
	const weakDamage = hitFiveCellsAway(weak);
	assert.ok(weakDamage >= state.collapseLooseFloor, 'the mixed weak seam is loose after one indirect hit');
	ceiling.collapse(5);
	assert.ok(state.fallCells[state.mineralIds.indexOf('gas')] > 0, 'the weak seam starts falling without another hit');
	ceiling.reset(1);
	const hardDamage = hitFiveCellsAway(hard);
	assert.ok(hardDamage < state.collapseLooseFloor, 'the same hit does not loosen the hard mixture');
	ceiling.collapse(20);
	assert.ok(state.strength[hard] > 0, 'the hard target stays standing');
});

test('a real low-energy ball impact starts a weak seam falling in both rock shapes', () => {
	try {
		for (const shape of ['smooth', 'square']) {
			const world = physics.createWorld();
			ceiling.reset(1);
			ceiling.setShape(shape);
			const state = ceiling.state;
			const surface = Array.from(state.strength.slice(0, state.columns));
			const weak = surface.indexOf(Math.min(...surface));
			const source = weak - 5;
			world.drive = false;
			world.ball.state = 'flying';
			world.ball.holder = null;
			world.ball.x = (source + 0.5) * state.cell;
			world.ball.y = state.bottom - c.radius - 0.002;
			world.ball.vx = 0;
			world.ball.vy = Math.sqrt(2 * 0.1 / (c.ballMass * (1 - physics.rockRetentionNow())));
			sync(world);
			for (let step = 0; step < 8; step++) physics.step(world, c.step);
			assert.ok(world.fractureEnergy > 0.09 && world.fractureEnergy < 0.11, shape + ' receives about 0.1 J');
			assert.ok(state.damageField[weak] >= state.collapseLooseFloor, shape + ' loosens the indirect target');
			assert.equal(state.extractedCells, 0, 'the hit does not detach rock immediately');
			for (let step = 0; step < 5 * 240; step++) physics.step(world, c.step);
			assert.ok(state.fallCells[state.mineralIds.indexOf('gas')] > 0, shape + ' starts releasing the seam');
			assert.equal(state.extractedCells, state.airborneCells + state.caughtCells + state.lostCells);
			balanced(world);
		}
	} finally {
		ceiling.setShape('smooth');
	}
});

test('response follows absolute remaining strength, not the original mineral alone', () => {
	function response(mineral) {
		ceiling.reset(73);
		ceiling.generateTestRock();
		const state = ceiling.state;
		state.damageField.fill(0);
		const m = state.mineralIds.indexOf(mineral);
		const source = Math.floor((m + 0.5) * state.columns / state.mineralCount);
		const target = source + 5;
		// Isolate the response of two cells at the same brown remaining strength.
		state.strength[target] = 0.8;
		ceiling.damage((source + 0.5) * state.cell, state.bottom + state.cell * 0.5, 0.03);
		return state.damageField[target];
	}
	assert.equal(response('gas'), response('corundum'));
});

test('an arbitrarily small hit does not make weak rock instantly fall', () => {
	const weak = pureIndirect('gas', 0.00001);
	assert.ok(weak.looseness < ceiling.state.collapseLooseFloor);
	assert.equal(ceiling.state.looseCells, 0);
	ceiling.collapse(60);
	assert.equal(ceiling.state.extractedCells, 0);
});

test('untouched or zero-impact rock never becomes loose on its own', () => {
	ceiling.reset(1);
	const state = ceiling.state;
	const before = Array.from(state.strength.slice(0, state.columns));
	ceiling.damage(12, state.bottom + state.cell * 0.5, 0);
	ceiling.collapse(60);
	assert.equal(state.extractedCells, 0);
	assert.equal(state.looseCells, 0);
	assert.deepEqual(Array.from(state.strength.slice(0, state.columns)), before);
	assert.equal(state.damageField.some(value => value !== 0), false);
});

test('one loose face can collapse despite nearby slightly touched rock', () => {
	ceiling.reset(42);
	const state = ceiling.state;
	state.damageField.fill(0);
	const column = 96;
	const band = Math.floor(column / 16);
	for (let row = 0; row < 5; row++) {
		for (let c = band * 16; c < band * 16 + 16; c++) state.damageField[row * state.columns + c] = 0.001;
	}
	state.damageField[column] = state.collapseLooseFloor;
	// A zero-energy hit refreshes the diagnostic after this controlled setup.
	ceiling.damage((column + 0.5) * state.cell, state.bottom + state.cell * 0.5, 0);
	assert.ok(state.regionDamage[band] < state.collapseLooseFloor, 'the touched-rock average is diluted');
	assert.equal(state.regionEligible[band], 1, 'the free face is already eligible');
	ceiling.collapse(60);
	assert.equal(state.extractedCells, 1, 'an eligible face receives a nonzero roll even at the threshold');
	assert.equal(state.firstRow[column], 1);
});

test('exposing the next already-loose layer does not erase its damage', () => {
	ceiling.reset(9);
	const state = ceiling.state;
	const growth = Array.from(state.mineralClusterGrowth);
	state.mineralClusterGrowth.fill(10);
	state.damageField.fill(0);
	const column = 96;
	const next = state.columns + column;
	state.damageField[column] = 0.31;
	state.damageField[next] = 0.31;
	try {
		for (let tick = 0; tick < 240 && state.extractedCells === 0; tick++) ceiling.collapse(0.25);
		assert.equal(state.extractedCells, 1, 'the first clump contains just the exposed face');
		assert.equal(state.firstRow[column], 1);
		assert.ok(state.damageField[next] >= state.collapseLooseFloor, 'the newly exposed loose cell stays loose');
		ceiling.collapse(60);
		assert.equal(state.extractedCells, 2, 'it can fall later without another impact');
	} finally {
		state.mineralClusterGrowth.set(growth);
	}
});
