'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { physics, ceiling, equipment, near, sync, balanced } = require('./harness.cjs');
const caveApi = require('../js/cave.js');
const wildMine = require('../js/wild-mine.js');
const tankApi = require('../js/wild-water.js');
const water = require('../js/water.js');
const fuel = require('../js/fuel.js');
const { mineralIds } = require('../js/minerals.js');
const dt = physics.config.step;
const shot = water.state.dropletWater;

function newRun(t, engine = 'electric') {
	wildMine.setMode('wild');
	t.after(() => {
		water.setAutoFire(false, 'rig');
		wildMine.setMode('classic');
	});
	const world = physics.createWorld();
	const cave = wildMine.init(world, { seed: 1 });
	assert.equal(physics.selectEngine(engine, world, 'rig'), true);
	return { world, cave, tank: world.wildWater };
}

function liquidAt(cave, tank, column, row) {
	const chunk = cave.chunkFor(column);
	return tank.field.cellsFor(chunk).get(row * cave.state.chunkColumns + column - chunk.column0);
}

function checkLiquidLedger(tank) {
	near(tank.collectedWater, tank.water + tank.sprayedWater + tank.discardedWater, 1e-9);
	near(tank.collectedCondensate, tank.condensate + tank.burnedCondensate, 1e-9);
	near(tank.sprayedWater, tank.airborneDrops * shot + tank.returnedWater + tank.drainedWater, 1e-9);
}

function snapshot(cave, tank, index) {
	const chunk = cave.chunkFor(index * cave.state.chunkColumns);
	return Array.from(tank.field.cellsFor(chunk).values(), cell => [cell.key, cell.water, cell.condensate]);
}

test('cave seeps are seeded, lie in open cells over rock, and include a reachable starter pool', () => {
	const first = caveApi.create({ seed: 11 });
	const second = caveApi.create({ seed: 11 });
	const other = caveApi.create({ seed: 12 });
	const a = tankApi.create(first, 11);
	const b = tankApi.create(second, 11);
	const c = tankApi.create(other, 12);
	snapshot(second, b, -2);
	const chunk = first.chunkFor(first.state.chunkColumns);
	const cols = first.state.chunkColumns;
	assert.deepEqual(snapshot(first, a, 1), snapshot(second, b, 1));
	assert.notDeepEqual(snapshot(first, a, 1), snapshot(other, c, 1));
	assert.ok(a.field.cellsFor(chunk).size > 0);
	for (const liquid of a.field.cellsFor(chunk).values()) {
		const column = chunk.column0 + liquid.key % cols;
		const row = Math.floor(liquid.key / cols);
		const x = first.worldX(column);
		assert.equal(first.solidAt(x, first.worldY(row)), false);
		assert.equal(first.solidAt(x, first.worldY(row - 1)), true);
		near(liquid.water + liquid.condensate, tankApi.cellCapacity);
	}
	const row = first.state.shelfRow;
	const column = first.columnAt(1.1);
	assert.ok(liquidAt(first, a, column, row), 'some of the starter pool is under the parked rig');
	first.dig(column, row - 1);
	assert.equal(liquidAt(first, a, column, row - 1), undefined, 'digging dry rock creates no new seep');
});

test('draining seeps and depositing fresh runoff persist across eviction without retaining rock chunks', t => {
	const { world, cave, tank } = newRun(t);
	const row = cave.state.shelfRow;
	const first = cave.columnAt(1.1);
	const next = first + 1;
	const old = cave.chunkFor(first);
	const x = 0.5;
	const y = cave.worldY(row);
	assert.equal(tank.field.returnWater(x, y, 0.25), 0.25);
	assert.equal(tank.field.returnWater(x, y, 2), tankApi.cellCapacity - 0.25);
	assert.equal(tank.field.returnWater(x, y - cave.state.cell, 1), 0, 'solid rock cannot hold runoff');
	// Drain the pure runoff first, then a full native cell and part of the next.
	near(tankApi.stepIntake(world, 2.25 / tankApi.intakeRate), 2.25);
	assert.equal(liquidAt(cave, tank, first, row), undefined);
	near(liquidAt(cave, tank, next, row).water, 0.75 * (1 - tankApi.condensateFraction));
	assert.equal(tank.field.returnWater(x, y, 0.25), 0.25);
	cave.stream(300, 330, Infinity);
	assert.equal(cave.state.storedChunks, 0, 'liquid edits never pin terrain to the rock edit cache');
	assert.notEqual(cave.chunkFor(first), old, 'the clean rock chunk regenerated');
	assert.equal(liquidAt(cave, tank, first, row), undefined, 'the emptied seep does not refill');
	near(liquidAt(cave, tank, next, row).condensate, 0.75 * tankApi.condensateFraction);
	const runoff = liquidAt(cave, tank, cave.columnAt(x), row);
	near(runoff.water, 0.25);
	assert.equal(runoff.condensate, 0);
	checkLiquidLedger(tank);
});

test('the intake fills at its own rate, adds moving mass, and caps independently of a full hopper', t => {
	const { world, tank } = newRun(t);
	const stock = ceiling.state.storageLimit * ceiling.state.cellMass;
	assert.equal(ceiling.loadCargo(mineralIds.indexOf('stone'), stock, 30), true);
	world.platform.x = 2.25;
	world.platform.vx = 3;
	const before = physics.platformMass(world);
	const reserve = world.battery;
	sync(world);
	const lifted = tankApi.stepIntake(world, 1);
	near(lifted, tankApi.intakeRate);
	near(tank.mass, lifted);
	near(physics.platformMass(world), before + lifted);
	near(world.platform.vx, 3 * before / (before + lifted));
	near(reserve - world.battery, physics.reserveCost(lifted * tankApi.intakeWork));
	near(tankApi.stepIntake(world, 10), tankApi.capacity - lifted);
	near(tank.mass, tankApi.capacity);
	const fullReserve = world.battery;
	assert.equal(tankApi.stepIntake(world, 1), 0);
	assert.equal(tank.intakeStatus, 'full');
	assert.equal(world.battery, fullReserve);
	assert.equal(ceiling.state.cargoMass, stock, 'liquid is not dry cargo');
	checkLiquidLedger(tank);
	balanced(world);
});

test('intake stalls when switched off, out of reach, behind rock or overheated', t => {
	const { world, cave, tank } = newRun(t);
	tank.intakeOn = false;
	assert.equal(tankApi.stepIntake(world, 1), 0);
	assert.equal(tank.intakeStatus, 'off');
	tank.intakeOn = true;
	const floor = world.platform.y;
	world.platform.y += 1;
	assert.equal(tankApi.stepIntake(world, 1), 0);
	assert.equal(tank.intakeStatus, 'dry');
	// A water cell directly below a solid voxel in a lower gallery, close in
	// height but shielded by that voxel and not reachable from this side.
	const column = 110;
	const row = 149;
	assert.ok(liquidAt(cave, tank, column, row));
	world.platform.x = cave.worldX(column);
	world.platform.y = (row + 1.25) * cave.state.cell;
	assert.equal(cave.solidAt(world.platform.x, cave.worldY(row + 1)), true);
	assert.equal(tankApi.stepIntake(world, 1), 0);
	world.platform.x = 0;
	world.platform.y = floor;
	world.heat = (physics.config.thermalCutoff - physics.config.ambientTemperature) * physics.config.heatCapacity;
	const reserve = world.battery;
	assert.equal(tankApi.stepIntake(world, 1), 0);
	assert.equal(tank.intakeStatus, 'hot');
	assert.equal(world.battery, reserve);
	assert.equal(tank.mass, 0);
});

test('an empty oil rig can hand-prime, then the regular Wild Mine step takes over', t => {
	const { world, tank } = newRun(t, 'oil');
	world.battery = 0;
	sync(world);
	physics.step(world, dt);
	near(tank.mass, tankApi.handRate * dt, 1e-9);
	near(world.crankEnergy, tank.mass * tankApi.intakeWork, 1e-9);
	assert.equal(tank.intakeStatus, 'hand');
	physics.step(world, dt);
	assert.ok(tank.burnedCondensate > 0);
	assert.ok(world.battery > 0, 'condensate restarts the reserve');
	assert.equal(tank.intakeStatus, 'pumping');
	checkLiquidLedger(tank);
	balanced(world);
});

test('oil burns tank condensate before cargo volatiles and does not burn the spray water', t => {
	const { world, tank } = newRun(t, 'oil');
	const fizzy = mineralIds.indexOf('fizzy'); // oil's legal cargo fuel (minimal fuel tables)
	const load = ceiling.state.cellMass;
	assert.equal(ceiling.loadCargo(fizzy, load, 20), true);
	tankApi.stepIntake(world, 1);
	const reserveWater = tank.water;
	const available = tank.condensate * tankApi.condensateYield;
	let info = fuel.read(world, 'rig');
	near(info.tankFuel, tank.condensate);
	near(info.chemical, available + load * fuel.yieldOf(1, fizzy));
	world.platform.vx = 4;
	world.battery = 0;
	sync(world);
	const spent = fuel.burn(world, 500, 'rig');
	assert.equal(spent, 500);
	near(tank.burnedCondensate, spent / tankApi.condensateYield);
	assert.equal(ceiling.state.cargoMinerals[fizzy], load);
	assert.equal(tank.water, reserveWater);
	near(world.importedEnergy, spent, 1e-9);
	balanced(world);
	near(fuel.burn(world, available - spent + 1200, 'rig'), available - spent + 1200, 1e-9);
	assert.equal(tank.condensate, 0);
	assert.equal(tank.water, reserveWater);
	near(ceiling.state.cargoMinerals[fizzy], load - 1200 / fuel.yieldOf(1, fizzy));
	info = fuel.read(world, 'rig');
	assert.equal(info.tankFuel, 0);
	near(info.burnedChemical, available + 1200);
	checkLiquidLedger(tank);
	balanced(world);
});

test('the waste valve frees tank room at an empty reserve without losing condensate or energy', t => {
	const { world, tank } = newRun(t, 'oil');
	tankApi.stepIntake(world, 1);
	const waterBefore = tank.water;
	const fuelBefore = tank.condensate;
	world.battery = 0;
	world.platform.vx = 3;
	const massBefore = physics.platformMass(world);
	sync(world);
	assert.equal(tankApi.drain(world), waterBefore);
	assert.equal(tank.condensate, fuelBefore);
	assert.equal(tank.water, 0);
	assert.equal(world.battery, 0);
	near(physics.platformMass(world), massBefore - waterBefore);
	checkLiquidLedger(tank);
	balanced(world);
});

test('solid fuel ignores condensate in the tank; Classic keeps its unlimited gun and no tank', t => {
	const { world, tank } = newRun(t);
	tankApi.stepIntake(world, 1);
	assert.ok(tank.condensate > 0);
	assert.equal(fuel.burn(world, 500, 'rig'), 0);
	assert.equal(fuel.read(world, 'rig').tankFuel, 0);
	wildMine.setMode('classic');
	const classic = physics.createWorld();
	assert.equal(classic.wildWater, null);
	assert.equal(tankApi.stepIntake(classic, 1), 0);
	equipment.grant('watergun', classic, 'rig');
	assert.equal(water.fire(classic, 'rig'), true);
	assert.equal(water.totals.flooded, shot);
	assert.equal(fuel.burn(classic, 500, 'rig'), 0);
});

test('a cave shot pays for its water and reserve; runoff can be collected but cannot create fuel', t => {
	const { world, cave, tank } = newRun(t);
	assert.equal(water.fire(world, 'rig'), false, 'no installed gun');
	equipment.grant('watergun', world, 'rig');
	assert.equal(water.fire(world, 'rig'), false, 'empty tank');
	tankApi.stepIntake(world, 1);
	tank.intakeOn = false;
	world.platform.x = -1;
	world.platform.vx = 1;
	const muzzle = water.nozzleOf(world, 'rig');
	assert.ok(muzzle.x < 0, 'Wild Mine nozzle is at the actual mount, beyond chamber bounds');
	water.setAim(muzzle.x, muzzle.y + 2);
	assert.ok(water.state.aimX < 0 && water.state.aimY > 15, 'the jet can aim anywhere in the cave');
	const reserve = world.battery;
	const initialWater = tank.water;
	const condensate = tank.condensate;
	sync(world);
	assert.equal(water.fire(world, 'rig'), true);
	assert.equal(water.fire(world, 'rig'), false, 'same cooldown as Classic');
	near(tank.water, initialWater - shot);
	near(tank.condensate, condensate);
	near(reserve - world.battery, physics.reserveCost(water.state.shotEnergy));
	assert.equal(tank.airborneDrops, 1);
	checkLiquidLedger(tank);
	balanced(world);
	for (let i = 0; i < 240 && tank.airborneDrops; i++) water.stepWild(world, cave, dt);
	assert.equal(tank.airborneDrops, 0);
	near(tank.returnedWater, shot);
	assert.equal(water.totals.flooded, 0, 'the Classic water ledger is untouched');
	tank.intakeOn = true;
	near(tankApi.stepIntake(world, 1), shot);
	near(tank.water, initialWater);
	assert.equal(tank.condensate, condensate);
	checkLiquidLedger(tank);
	balanced(world);
});

test('Wild auto-fire runs the same nozzle clock and stops when only condensate remains', t => {
	const { world, tank } = newRun(t);
	equipment.grant('watergun', world, 'rig');
	// Slightly more than three full droplets; the fourth cannot reach pressure.
	tankApi.stepIntake(world, 3.5 * shot / ((1 - tankApi.condensateFraction) * tankApi.intakeRate));
	tank.intakeOn = false;
	water.setAutoFire(true, 'rig');
	for (let i = 0; i < 240; i++) physics.step(world, dt);
	assert.equal(water.stateFor('rig').shots, 3);
	near(tank.sprayedWater, 3 * shot);
	assert.ok(tank.condensate > 0);
	assert.equal(water.canFire(world, 'rig'), false);
	checkLiquidLedger(tank);
	balanced(world);
});
