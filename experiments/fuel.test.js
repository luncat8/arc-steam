'use strict';
// Wild Mine fuel: engines burn cargo minerals instead of the classic charge
// pad. One grade per engine family, cheapest cell per joule first, exact
// energy and mass ledger.
const assert = require('node:assert/strict');
const { test } = require('node:test');

const minerals = require('../js/minerals.js');
const ceiling = require('../js/ceiling.js');
const equipment = require('../js/equipment.js');
const physics = require('../js/physics.js');
const players = require('../js/players.js');
const wildMine = require('../js/wild-mine.js');
const fuel = require('../js/fuel.js');

const cellMass = ceiling.state.cellMass;
const stone = minerals.mineralIds.indexOf('stone');
const sand = minerals.mineralIds.indexOf('sand');
const iron = minerals.mineralIds.indexOf('iron');
const gold = minerals.mineralIds.indexOf('gold');
const gas = minerals.mineralIds.indexOf('gas');
const fizzy = minerals.mineralIds.indexOf('fizzy');

function freshWorld(engineId) {
	wildMine.setMode('wild');
	equipment.reset();
	const world = physics.createWorld();
	players.init(world, 0);
	wildMine.init(world, { seed: 1 });
	if (engineId) assert.equal(physics.selectEngine(engineId, world, 'rig'), true, 'select ' + engineId);
	return world;
}

function load(id, cells) {
	const index = minerals.mineralIds.indexOf(id);
	const price = ceiling.state.mineralPrices[index];
	assert.equal(ceiling.loadCargo(index, cells * cellMass, cells * cellMass * price), true, 'load ' + id);
}

function sync(world) { world.initialEnergy = physics.totalEnergy(world); }
function drift(world) { return physics.totalEnergy(world) - world.initialEnergy; }

test('engine families map to solid, liquid and fissile fuel, and hand has none', () => {
	try {
		const expected = [['coal', 'solid'], ['electric', 'solid'], ['oil', 'liquid'], ['nuclear', 'fissile'], ['hand', '']];
		for (const [engineId, grade] of expected) {
			const world = freshWorld(engineId);
			const info = fuel.read(world, 'rig');
			assert.equal(info.engineId, engineId);
			assert.equal(info.grade, grade, engineId + ' grade');
			assert.equal(info.gradeIndex >= 0, grade !== '', engineId + ' grade index');
			const expectedPower = grade ? physics.config.battery / physics.engineNow('rig').reload : 0;
			assert.ok(Math.abs(info.refillPower - expectedPower) < 1e-9);
			assert.ok(Math.abs(info.usefulPower - info.refillPower * physics.engineNow('rig').efficiency) < 1e-9);
		}
	} finally {
		wildMine.setMode('classic');
	}
});

test('a burn draws only its own fuel family, and leaves ore alone', () => {
	try {
		const world = freshWorld('electric');
		load('stone', 2);
		load('gold', 1);
		world.battery = 0;
		sync(world);

		const stoneBefore = ceiling.state.cargoMinerals[stone];
		const goldBefore = ceiling.state.cargoMinerals[gold];
		const cellsBefore = ceiling.state.cargoCells;
		const chemical = 1000;
		const burned = fuel.burn(world, chemical, 'rig');
		const stoneAfter = ceiling.state.cargoMinerals[stone];
		const cellsAfter = ceiling.state.cargoCells;

		assert.ok(Math.abs(burned - chemical) < 1e-12, 'burned the asked chemical energy');
		assert.ok(Math.abs((stoneBefore - stoneAfter) - chemical / fuel.yieldOf(0, stone)) < 1e-12, 'stone mass removed');
		assert.equal(ceiling.state.cargoMinerals[gold], goldBefore, 'gold is not a solid fuel and stays');
		assert.ok(Math.abs(world.battery - chemical) < 1e-9, 'chemical energy enters the reserve');
		const potential = (cellsBefore - cellsAfter) * cellMass * physics.config.gravity * ceiling.state.cargoHeight;
		assert.ok(Math.abs(world.importedEnergy - (chemical - potential)) < 1e-9, 'imported share excludes the cargo potential already counted');
		assert.ok(Math.abs(drift(world)) < 1e-9, 'ledger drift ' + drift(world));

		fuel.reset();
	} finally {
		wildMine.setMode('classic');
	}
});

test('a burn takes the cheapest loaded cell per joule first', () => {
	try {
		const world = freshWorld('electric');
		load('stone', 1);
		load('sand', 1);
		world.battery = 0;
		sync(world);
		const prices = ceiling.state.mineralPrices;
		const stoneCost = prices[stone] / (fuel.yieldOf(0, stone) * cellMass);
		const sandCost = prices[sand] / (fuel.yieldOf(0, sand) * cellMass);
		const cheaper = stoneCost <= sandCost ? stone : sand;
		const dearer = cheaper === stone ? sand : stone;
		const cheapBefore = ceiling.state.cargoMinerals[cheaper];
		const dearBefore = ceiling.state.cargoMinerals[dearer];

		assert.ok(fuel.burn(world, 100, 'rig') > 0);
		assert.ok(ceiling.state.cargoMinerals[cheaper] < cheapBefore, 'the cheaper fuel cell is eaten first');
		assert.equal(ceiling.state.cargoMinerals[dearer], dearBefore, 'the dearer cell is untouched by a small burn');
	} finally {
		wildMine.setMode('classic');
	}
});

test('the step refills the reserve at the engine reload rate and stops when full', () => {
	try {
		const world = freshWorld('electric');
		load('stone', 20);
		world.battery = 0;
		sync(world);
		const capacity = physics.config.battery;
		const rate = capacity / physics.engineNow('rig').reload;
		const first = fuel.step(world, 1);
		assert.ok(Math.abs(first - Math.min(capacity, rate)) < 1e-9, 'one second of refill');
		assert.ok(Math.abs(world.battery - first) < 1e-9);
		assert.ok(Math.abs(drift(world)) < 1e-9);

		// Fill the rest and prove a full reserve burns nothing.
		const filled = fuel.step(world, physics.engineNow('rig').reload);
		assert.ok(Math.abs(world.battery - capacity) < 1e-6, 'reserve reaches capacity');
		assert.ok(filled > 0);
		const stoneBefore = ceiling.state.cargoMinerals[stone];
		assert.equal(fuel.step(world, 1), 0, 'full reserve is idle');
		assert.equal(ceiling.state.cargoMinerals[stone], stoneBefore, 'no fuel burned at full');
		assert.ok(Math.abs(drift(world)) < 1e-9);
	} finally {
		wildMine.setMode('classic');
	}
});

test('no matching fuel in cargo leaves the engine idle with a reason', () => {
	try {
		const world = freshWorld('electric');
		load('gold', 1);
		world.battery = 0;
		sync(world);
		const goldBefore = ceiling.state.cargoMinerals[gold];
		assert.equal(fuel.step(world, 1), 0);
		assert.equal(ceiling.state.cargoMinerals[gold], goldBefore, 'gold is not solid fuel');
		assert.equal(fuel.read(world, 'rig').reason, 'No solid fuel in cargo · mine stone or sand');
		assert.ok(Math.abs(drift(world)) < 1e-9);
	} finally {
		wildMine.setMode('classic');
	}
});

test('the hand engine never burns, even with fuel in the hopper', () => {
	try {
		const world = freshWorld('hand');
		load('stone', 1);
		world.battery = 0;
		sync(world);
		assert.equal(fuel.step(world, 1), 0);
		assert.equal(fuel.burn(world, 1000, 'rig'), 0);
		assert.equal(fuel.read(world, 'rig').reason, 'Hand engine · no fuel burn · hand-crank only');
		assert.equal(ceiling.state.cargoMinerals[stone], cellMass, 'stone untouched');
		assert.ok(Math.abs(drift(world)) < 1e-9);
	} finally {
		wildMine.setMode('classic');
	}
});

test('Classic mode never burns cargo', () => {
	try {
		wildMine.setMode('classic');
		equipment.reset();
		const world = physics.createWorld();
		players.init(world);
		load('stone', 1);
		world.battery = 0;
		sync(world);
		assert.equal(fuel.step(world, 1), 0);
		assert.equal(fuel.burn(world, 1000, 'rig'), 0);
		assert.equal(ceiling.state.cargoMinerals[stone], cellMass);
		assert.ok(Math.abs(drift(world)) < 1e-9);
	} finally {
		wildMine.setMode('classic');
	}
});

test('all three families burn their own minerals and keep the ledger exact', () => {
	try {
		const cases = [['oil', 'fizzy', 1], ['nuclear', 'gas', 2], ['electric', 'sand', 0]];
		for (const [engineId, mineralId, grade] of cases) {
			const world = freshWorld(engineId);
			load(mineralId, 1);
			world.battery = 0;
			sync(world);
			const index = minerals.mineralIds.indexOf(mineralId);
			const before = ceiling.state.cargoMinerals[index];
			const burned = fuel.burn(world, 500, 'rig');
			assert.ok(burned > 0, engineId + ' burns ' + mineralId);
			assert.ok(ceiling.state.cargoMinerals[index] < before, engineId + ' removed ' + mineralId);
			assert.ok(Math.abs(drift(world)) < 1e-9, engineId + ' drift ' + drift(world));
			assert.equal(fuel.read(world, 'rig').gradeIndex, grade);
		}
	} finally {
		wildMine.setMode('classic');
	}
});

test('driving in Wild Mine draws from the right cargo family with no energy drift', () => {
	try {
		const world = freshWorld('electric');
		load('stone', 20);
		load('gold', 1);
		world.battery = 0;
		sync(world);
		const stoneBefore = ceiling.state.cargoMinerals[stone];
		const goldBefore = ceiling.state.cargoMinerals[gold];
		world.drive = true;
		world.direction = 1;
		world.forceSetting = 1;
		for (let i = 0; i < 240; i++) physics.step(world, physics.config.step);
		assert.ok(world.battery > 0, 'the engine refilled the reserve');
		assert.ok(ceiling.state.cargoMinerals[stone] < stoneBefore, 'solid fuel was burned while driving');
		assert.equal(ceiling.state.cargoMinerals[gold], goldBefore, 'gold stays for sale');
		assert.ok(Math.abs(drift(world)) < 1e-7, 'moving mass ledger drift ' + drift(world));
	} finally {
		wildMine.setMode('classic');
	}
});

test('readout reports family mass, chemical energy and the per-run burn totals', () => {
	try {
		const world = freshWorld('oil');
		load('fizzy', 1);
		load('stone', 1);
		fuel.reset();
		world.battery = 0;
		sync(world);
		let info = fuel.read(world, 'rig');
		assert.equal(info.grade, 'liquid');
		assert.ok(Math.abs(info.mass - cellMass) < 1e-12, 'only the volatile liquid fuel counts');
		assert.ok(Math.abs(info.chemical - cellMass * fuel.yieldOf(1, fizzy)) < 1e-9);
		assert.ok(Math.abs(info.cells - 1) < 1e-9);
		fuel.burn(world, 500, 'rig');
		info = fuel.read(world, 'rig');
		assert.ok(info.burnedMass > 0);
		assert.ok(info.burnedChemical > 0);
		assert.ok(info.burnedValue > 0, 'the lost sale value is recorded');
	} finally {
		wildMine.setMode('classic');
	}
});
