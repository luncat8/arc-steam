'use strict';
// The Wild Mine service cart (D10, owner-simplified): a storyline arrival that
// sells the hopper minus the fuel reservation, books one ledger sale, and
// leaves. There is no driving, no route, no collision — the cart is a cut-in,
// and these tests pin the economy, the schedule and the click contract.
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ceiling = require('../js/ceiling.js');
const physics = require('../js/physics.js');
const players = require('../js/players.js');
const equipment = require('../js/equipment.js');
const wildMine = require('../js/wild-mine.js');
const cart = require('../js/wild-cart.js');

function freshWorld() {
	ceiling.reset(42);
	cart.reset();
	const world = physics.createWorld();
	world.platform.vx = 0;
	return world;
}

function ids() {
	return Object.fromEntries(ceiling.state.mineralIds.map((id, i) => [id, i]));
}

function load(id, cells, pricePerCell) {
	const index = ids()[id];
	return ceiling.loadCargo(index, cells * ceiling.state.cellMass, cells * pricePerCell);
}

test('sellCargoKeeping sells everything except an absolute per-mineral reserve, pro rata, one frozen sell entry', () => {
	const world = physics.createWorld();
	const state = ceiling.state;
	const keep = new Float64Array(state.mineralIds.length);
	const stone = ids().stone;
	const iron = ids().iron;
	load('stone', 10, 4); // 6 kg stone @ 40 cr
	load('iron', 10, 12); // 6 kg iron @ 120 cr
	const stoneMass = state.cargoMinerals[stone];
	const cargoBefore = state.cargoCells;
	const valueBefore = state.cargoValue;
	keep[stone] = stoneMass * 0.2;
	const credits = ceiling.sellCargoKeeping(keep, world.platform.vx, 123);
	// Iron sells out completely; 20% of stone stays.
	assert.ok(Math.abs(state.cargoMinerals[stone] - stoneMass * 0.2) < 1e-9, 'stone reserve kept');
	assert.equal(state.cargoMinerals[iron], 0, 'ore sells outright');
	assert.ok(Math.abs(state.cargoCells - 2) < 1e-9, 'only the 20% stone reserve stays aboard (2 of 20 cells)');
	// Sold share by mass: 6 kg iron + 4.8 kg stone = 10.8 of 12 kg = 90% of value.
	const soldShare = (10 + 8) / 20;
	assert.ok(Math.abs(credits - valueBefore * soldShare) < 1e-6, 'credits pro rata by mass');
	assert.ok(Math.abs(state.cargoValue - valueBefore * (1 - soldShare)) < 1e-6, 'kept cargo keeps its share of the locked value');
	const ledger = state.ledger;
	const last = ledger[ledger.length - 1];
	assert.equal(last.type, 'sell');
	assert.ok(Math.abs(last.credits - credits) < 1e-9);
	assert.equal(last.time, 123);
	assert.ok(Object.isFrozen(last) && Object.isFrozen(last.quantities));
	assert.ok(Math.abs(last.quantities[stone] - stoneMass * 0.8) < 1e-9);
	assert.equal(last.quantities[iron], state.cellMass * 10);
	// Keeping everything returns 0 and books nothing.
	const fullKeep = new Float64Array(keep.length);
	for (let m = 0; m < keep.length; m++) fullKeep[m] = state.cargoMinerals[m];
	const before = ledger.length;
	assert.equal(ceiling.sellCargoKeeping(fullKeep, world.platform.vx, 124), 0);
	assert.equal(ledger.length, before, 'no-op sale books no entry');
});

test('the cart arrives when the hopper fills, waits for the click, then departs', () => {
	const world = freshWorld();
	const state = ceiling.state;
	// Fill to the brim: 100 cells of mixed ore.
	load('iron', 100, 12);
	assert.equal(state.cargoCells, state.storageLimit);
	cart.step(world, 1 / 60);
	assert.equal(cart.state().state, 'arriving', 'a full hopper calls the cart');
	// Arrive: slide in for ARRIVE_TIME, ending docked and unsold (no click yet).
	for (let i = 0; i < 60 * 4; i++) cart.step(world, 1 / 60);
	assert.equal(cart.state().state, 'docked');
	assert.equal(state.cargoCells, state.storageLimit, 'arriving alone never sells');
	const sold = cart.sell(world);
	assert.ok(sold > 0);
	assert.equal(state.cargoCells, 0);
	assert.ok(cart.state().lastSale && cart.state().lastSale.credits > 0);
	// LINGER, then DEPARTs, then hidden again.
	for (let i = 0; i < 60 * 4 && cart.state().state !== 'departing'; i++) cart.step(world, 1 / 60);
	assert.equal(cart.state().state, 'departing');
	for (let i = 0; i < 60 * 3 && cart.state().state !== 'hidden'; i++) cart.step(world, 1 / 60);
	assert.equal(cart.state().state, 'hidden');
});

test('an unfilled hopper is serviced once a minute, not before', () => {
	const world = freshWorld();
	load('iron', 3, 12);
	world.time = 30;
	cart.step(world, 1 / 60);
	assert.equal(cart.state().state, 'hidden', 'half a minute in, the cart stays home');
	world.time = 61;
	cart.step(world, 1 / 60);
	assert.equal(cart.state().state, 'arriving', 'once a minute with cargo aboard');
});

test('an empty hopper never calls the cart, however long the run', () => {
	const world = freshWorld();
	world.time = 600;
	cart.step(world, 1 / 60);
	assert.equal(cart.state().state, 'hidden');
});

test('the sale keeps 20% of every fuel-grade mineral and sells the rest, including ore', () => {
	const world = freshWorld();
	const state = ceiling.state;
	const m = ids();
	load('stone', 10, 3);
	load('sand', 10, 2);
	load('fizzy', 10, 9);
	load('gas', 10, 15);
	load('iron', 10, 12); // ore, never fuel
	const before = {};
	for (const id of ['stone', 'sand', 'fizzy', 'gas', 'iron']) before[id] = state.cargoMinerals[m[id]];
	// A due call with autosell on: dock, sell without any click.
	world.time = 61;
	cart.setAutosell(true);
	try {
		cart.step(world, 1 / 60);
		for (let i = 0; i < 60 * 4; i++) cart.step(world, 1 / 60);
	} finally {
		cart.setAutosell(false);
	}
	for (const id of ['stone', 'sand', 'fizzy', 'gas']) {
		assert.ok(Math.abs(state.cargoMinerals[m[id]] - before[id] * 0.2) < 1e-9, id + ' keeps 20%');
	}
	assert.equal(state.cargoMinerals[m.iron], 0, 'ore sells in full');
	// Exactly one frozen sell entry booked for the call.
	const sales = state.ledger.filter((entry) => entry.type === 'sell');
	assert.equal(sales.length, 1);
	assert.ok(sales[0].credits > 0);
});

test('every call keeps 20% of the fuel aboard at that moment — the reservation shrinks with the load, never vanishes in one call', () => {
	const world = freshWorld();
	const state = ceiling.state;
	const m = ids();
	load('stone', 2, 3);
	const stoneBefore = state.cargoMinerals[m.stone];
	const credits = cart.sell(world);
	assert.ok(credits > 0, 'the 80% share is sellable');
	assert.ok(Math.abs(state.cargoMinerals[m.stone] - stoneBefore * 0.2) < 1e-9);
	// The kept fifth still has a sellable remainder on the next call, and the
	// cart books it rather than pretending the reservation is untouchable.
	const ledgerBefore = state.ledger.length;
	const second = cart.sell(world);
	assert.ok(second > 0, 'the reserve is the last 20%, not an absolute floor');
	assert.equal(state.ledger.length, ledgerBefore + 1);
	// With an empty hopper the cart books nothing at all.
	ceiling.reset(42);
	cart.reset();
	const quiet = cart.sell(physics.createWorld());
	assert.equal(quiet, 0);
});

test('the wild rig ships with the grader installed', () => {
	try {
		equipment.reset();
		wildMine.setMode('wild');
		const world = physics.createWorld();
		players.init(world, 0);
		wildMine.init(world, { seed: 1 });
		assert.equal(equipment.isInstalled('grader', 'rig'), true, 'the blade is preinstalled in wild runs');
	} finally {
		wildMine.setMode('classic');
		const world = physics.createWorld();
		players.init(world);
		equipment.reset();
	}
});
