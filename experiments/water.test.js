'use strict';
// The live water solver against the live chamber: the gun's orders, the jet wash
// on real rock, the split of a cell into brine, gas and residue, the pump into
// the hopper, and the two ledgers that must never drift - water and energy.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const harness = require('./harness.cjs');
const players = require('../js/players.js');
const autopilot = require('../js/autopilot.js');
const minerals = require('../js/minerals.js');
const chemistry = require('../js/water-chemistry.js');
const water = require('../js/water.js');

const { ceiling, equipment, physics, c, near } = harness;
const rock = ceiling.state;
const view = ceiling.rockView();
const halite = minerals.mineralIds.indexOf('halite');

function fresh(seed = 1) {
	const world = physics.createWorld();
	players.init(world, 0);
	for (const channel of ['move', 'smart', 'drive', 'angle']) autopilot.set(channel, false);
	autopilot.reset();
	if (seed !== 1) ceiling.reset(seed);
	water.reset(seed);
	equipment.grant('watergun', world, 'rig');
	world.drive = false;
	water.setAutoFire(false, 'rig');
	water.setPump(true);
	harness.sync(world);
	return world;
}

// Aim at the one seam above the rig and let the stream run for a while. The rock
// is a ceiling over open ground, so this is the real geometry the wash works in.
function soak(world, seconds, aimY = 14.5) {
	water.setAim(12, aimY);
	water.setAutoFire(true, 'rig');
	const steps = Math.round(seconds / c.step);
	for (let i = 0; i < steps; i++) physics.step(world, c.step);
	water.setAutoFire(false, 'rig');
}

// Step the chamber without touching the gun's standing orders.
function advanceSteps(world, seconds) {
	const steps = Math.round(seconds / c.step);
	for (let i = 0; i < steps; i++) physics.step(world, c.step);
}

// Every standing cell's remaining mass and value, from the rock's own ledger.
function rockTotals() {
	let mass = 0;
	let value = 0;
	for (let i = 0; i < rock.rows * rock.columns; i++) {
		if (rock.strength[i] <= 0) continue;
		mass += view.massLeft[i];
		value += view.valueLeft[i];
	}
	return { mass, value };
}

// The lowest free-face row above the rig, whatever the seed grew there: the wash
// always has something to bite.
function faceAbove() {
	const column = Math.floor(12 / rock.cell);
	for (let r = 0; r < rock.rows; r++) if (rock.strength[r * rock.columns + column] > 0) return r;
	return -1;
}

test('the gun runs the planned nozzle: unlimited tank, an engine-efficiency draw per droplet', () => {
	assert.equal(water.state.dropletWater, 0.075);
	assert.equal(water.state.dropletsPerSecond, 46);
	assert.equal(water.state.shotEnergy, 36, 'a droplet spends 36 J of useful work');
	assert.equal(water.state.pumpJoulesPerUnit, 120);
	assert.equal(water.state.satCap, water.state.satCapDefault, 'the chemistry cap starts at its default');
	const world = fresh();
	const battery = world.battery;
	const cost = physics.reserveCost(water.state.shotEnergy, 'rig');
	assert.equal(water.fire(world, 'rig'), true);
	near(world.battery, battery - cost, 1e-9, 'the throw leaves the reserve at engine efficiency');
	near(world.heat, cost, 1e-9, 'and motor waste plus droplet work arrive as heat');
	assert.equal(water.totals.flooded, water.state.dropletWater, 'the tank is unlimited');
	harness.balanced(world);
});

test('no tool, no stream, and a full hopper never eats what it cannot hold', () => {
	const world = physics.createWorld();
	players.init(world, 0);
	water.reset(1);
	assert.equal(water.canFire(world, 'rig'), false, 'no water gun is fitted');
	assert.equal(water.fire(world, 'rig'), false);
	const fitted = fresh();
	ceiling.loadCargo(halite, rock.storageLimit * rock.cellMass, 0);
	assert.equal(ceiling.cargoSpace(fitted, fitted), 0, 'the hopper is full');
	const before = water.measureMetrics().pumpedSolute;
	soak(fitted, 2);
	near(water.measureMetrics().pumpedSolute, before, 1e-12, 'a full hopper stalls the pump');
	ceiling.sellCargo(0, fitted.time);
	harness.sync(fitted);
});

test('the jet mines real rock, and the hopper holds what the pump and the grains gave it', () => {
	const world = fresh();
	assert.ok(faceAbove() >= 0, 'the chamber has a face to work');
	soak(world, 12);
	const metrics = water.measureMetrics();
	assert.ok(metrics.dissolvedMass > 0, 'water mined the rock');
	assert.ok(metrics.dissolvedCells > 0, 'cells came down');
	// Every gram the chemistry took is in a parcel, in the lost-gas counter, on
	// the floor as a grain, or in a hopper. A cell the jet chipped down instead
	// is dry rock and leaves this ledger, which is why the check is the
	// chemistry's own total, not the rock's.
	//
	// Two roads into the hopper, and both must be counted or the ledger leaks:
	// the pump lifts brine, and a residue grain that falls on the deck is caught
	// dry. The second road was invisible while one wash in twelve seconds never
	// finished a grain above the rig - it shows the moment the jet mines harder.
	const taken = metrics.cellDissolvedMass + metrics.residueMass;
	const held = metrics.brineMass + metrics.lostGasMass + metrics.grainMass
		+ metrics.settledMass + metrics.pumpedSolute + metrics.caughtMass;
	near(held, taken, 1e-6, 'the wet ledger holds every gram the chemistry took');
	near(metrics.pumpedSolute + metrics.caughtMass, rock.cargoCells * rock.cellMass, 1e-9, 'cargo is pumped brine plus caught grains');
	// The dry road into the hopper must be walked in this very soak, or the two
	// lines above stop covering it and the leak comes back unnoticed.
	assert.ok(metrics.caughtMass > 0, 'a leached residue grain fell on the deck and was caught dry');
	// A cell that fell dry is no longer water's to give: no stale entry survives it.
	for (let i = 0; i < rock.rows * rock.columns; i++) {
		if (rock.strength[i] > 0) continue;
		near(view.massLeft[i], 0, 1e-9, 'no wet mass on a fallen cell ' + i);
		near(view.valueLeft[i], 0, 1e-9, 'no wet value on a fallen cell ' + i);
	}
	harness.balanced(world);
});

test('the water ledger closes: flooded = in parcels + airborne + pumped', () => {
	const world = fresh();
	soak(world, 8);
	const metrics = water.measureMetrics();
	assert.ok(metrics.flooded > 0);
	assert.ok(metrics.waterDrift < 1e-4, 'water drift ' + metrics.waterDrift);
	assert.ok(metrics.airborneWater >= 0 && metrics.waterMass >= metrics.airborneWater);
	harness.balanced(world);
});

test('the energy ledger closes with the gun, the pump and the chemistry running', () => {
	const world = fresh();
	const start = world.initialEnergy;
	soak(world, 20);
	const metrics = water.measureMetrics();
	assert.ok(metrics.dissolvedCells > 0, 'the wash did some mining');
	assert.ok(water.totals.shotJoules > 0 && water.totals.pumpJoules > 0, 'the gun and the pump spent reserve');
	near(physics.totalEnergy(world), start, 1e-6, 'the chamber ledger holds');
});

test('the pump books the lift and the hopper entry, and never the same joule twice', () => {
	const world = fresh();
	water.setPump(false);
	water.fill(11.2, 0.02, 12.8, 0.6);
	const brine = water.totals.flooded;
	assert.ok(brine > 0);
	const cost = physics.reserveCost(brine * water.state.pumpJoulesPerUnit, 'rig');
	world.battery = c.battery;
	world.heat = 0;
	world.importedEnergy = 0;
	harness.sync(world);
	water.setPump(true);
	for (let i = 0; i < 600; i++) physics.step(world, c.step);
	const spent = c.battery - world.battery + world.chargedEnergy;
	assert.ok(world.heat > 0, 'the pump work arrives as heat');
	assert.ok(spent > 0, 'the reserve paid for it');
	near(spent, water.totals.pumpJoules, 1e-9, 'booked pump joules match the reserve draw');
	near(water.totals.pumpJoules, physics.reserveCost(water.totals.pumped * water.state.pumpJoulesPerUnit, 'rig'), 1e-9, 'the lift is charged per water unit at engine efficiency');
	assert.ok(spent <= cost + 1e-9, 'never more than the flooded volume');
	harness.balanced(world);
});

test('saturation is the gate: a saturated parcel stops dissolving', () => {
	assert.equal(chemistry.saturationFactor(0, 1, 60), 1, 'fresh water is open for business');
	near(chemistry.saturationFactor(60, 1, 60), 0, 1e-12, 'a saturated parcel stops');
	near(chemistry.saturationFactor(30, 1, 60), 0.5, 1e-12);
	assert.equal(chemistry.saturationFactor(10, 0, 60), 0, 'no water, no dissolution');
});

test('a new chamber keeps the pump order and resets the chemistry', () => {
	water.setSaturationCap(12);
	water.setDissolveRate(0.3);
	water.setModel('formula');
	water.setPump(false);
	water.setErosion(false);
	assert.equal(water.settings.satCap, 12);
	water.reset(2);
	assert.equal(water.settings.satCap, water.state.satCapDefault);
	assert.equal(water.settings.dissolveRate, water.state.dissolveRateDefault);
	assert.equal(water.settings.model, 'table');
	assert.equal(water.settings.pumpOn, false, 'the pump order is a chamber setting and survives');
	assert.equal(water.settings.erosion, true);
});

// A rival body is not the world: it has no `platform` field, so every geometry
// helper the jet uses must resolve the owner's own machine rather than assume the
// rig. This is the shape of a crash that reached the browser once.
test('a rival fires from its own collector, not the rig\'s', () => {
	const world = physics.createWorld();
	players.init(world, 1);
	water.reset(1);
	const rival = players.state.rivals[0];
	equipment.grant('watergun', world, rival.id);
	// The nozzle is the rival's own collector, a metre and a bit left of its centre.
	const nozzle = water.nozzleOf(world, rival.id);
	near(nozzle.x, physics.waterNozzleX(world, rival.id), 1e-9, 'the rival nozzle is its own collector');
	assert.ok(Math.abs(nozzle.x - physics.collectorX(world, 'rig')) > 1, 'and not the rig collector');
	// Firing a rival shot must not throw and must cost the rival, not the rig.
	water.setAim(rival.x, 14.5);
	const reserve = world.battery;
	const imported = world.importedEnergy;
	assert.equal(water.fire(world, rival.id), true, 'a rival jet fires from its own body');
	advanceSteps(world, 0.2);
	assert.equal(world.battery, reserve, 'the rig reserve is untouched');
	assert.ok(world.importedEnergy > imported, 'a rival throw is imported work, not rig reserve');
	// The standing bot order is the path the crash reached the browser through.
	water.clearBotFire(rival.id);
	water.setBotFire(true, rival.id);
	const before = water.totals.droplets;
	advanceSteps(world, 1);
	assert.ok(water.totals.droplets > before, 'the rival bot stream runs');
	water.clearBotFire(rival.id);
});


test('determinism: the same seed plays the same wash', () => {
	function run() {
		const world = fresh();
		soak(world, 6);
		const m = water.measureMetrics();
		return [m.dissolvedMass, m.waterMass, m.pumpedSolute, physics.totalEnergy(world)];
	}
	const a = run();
	const b = run();
	for (let i = 0; i < a.length; i++) near(a[i], b[i], 1e-9, 'sample ' + i);
});

test('a bot sprays only with a cannon, a hopper with room and an engine that can carry it', () => {
	const world = fresh();
	water.setAutoFire(false, 'rig');
	const carried = physics.reserveNow('rig') / physics.engineNow('rig').reload >= water.streamPower('rig');
	assert.equal(water.streamReady(world, 'rig'), carried, 'readiness matches the engine pad-power rule');
	// A full hopper has nowhere to put what the pump would lift.
	ceiling.loadCargo(halite, rock.storageLimit * rock.cellMass, 0);
	assert.equal(water.streamReady(world, 'rig'), false, 'a full hopper stands the stream down');
	ceiling.sellCargo(0, world.time);
	harness.sync(world);
	// A rival without the tool has no stream at all.
	assert.equal(water.streamReady(world, 'rival-1'), false, 'no cannon, no jet');
	// Weak engines (hand, un-upgraded coal) cannot carry the jet+pump stream.
	world.platform.x = physics.platformMin();
	world.platform.previousX = physics.platformMin();
	harness.sync(world);
	assert.equal(physics.selectEngine('coal', world), true, 'the pack swaps to coal at the wall');
	assert.equal(water.streamReady(world, 'rig'), false, 'a starter coal pack cannot carry the stream');
	assert.equal(physics.selectEngine('hand', world), true, 'the pack swaps to hand at the wall');
	assert.equal(water.streamReady(world, 'rig'), false, 'a hand crank cannot carry the stream');
	// Bot fire is a separate order from the player's, and BOT off clears it.
	assert.equal(physics.selectEngine('nuclear', world), true, 'the pack swaps at the wall, at rest');
	world.battery = c.battery;
	harness.sync(world);
	assert.equal(water.streamReady(world, 'rig'), true, 'the nuclear pack carries the stream');
	world.battery = c.battery;
	harness.sync(world);
	const before = water.totals.droplets;
	soak(world, 1);
	assert.ok(water.totals.droplets > before, 'the bot jet fires without a key');
	water.clearBotFire('rig');
	water.setAutoFire(false, 'rig');
	assert.equal(water.stateFor('rig').autoFire, false, 'the order is off');
	advanceSteps(world, 2);
	const held = water.totals.droplets;
	advanceSteps(world, 3);
	assert.equal(water.totals.droplets, held, 'clearing the bot order stops the jet');
});

test('the pump requires an installed water gun, stops at an empty reserve and thermal cutoff, and closes while moving', () => {
	// Without a fitted water gun, floor water is never pumped or billed.
	const bare = physics.createWorld();
	players.init(bare, 0);
	water.reset(1);
	water.setPump(true);
	bare.platform.x = bare.platform.previousX = 8;
	water.fill(6.5, 0.02, 9.5, 0.6);
	bare.initialEnergy = physics.totalEnergy(bare);
	advanceSteps(bare, 1);
	assert.equal(water.totals.pumped, 0, 'a hull without a water gun cannot pump');
	assert.equal(water.totals.pumpJoules, 0);
	harness.balanced(bare);

	// Off the pad, a small reserve lifts only what it can pay for, with zero free import.
	const short = fresh();
	short.platform.x = short.platform.previousX = 8;
	water.fill(6.5, 0.02, 9.5, 0.7);
	short.battery = 150;
	const importedBefore = short.importedEnergy;
	harness.sync(short);
	advanceSteps(short, 4);
	near(short.battery, 0, 1e-6, 'the pump drains only down to an empty reserve');
	near(water.totals.pumped, 150 * physics.engineNow('rig').efficiency / water.state.pumpJoulesPerUnit, 1e-5, 'lifted units match the available energy');
	near(short.importedEnergy, importedBefore, 1e-9, 'no unbacked imported energy is fabricated');
	harness.balanced(short);

	// Thermal cutoff pauses both jet and pump until the machine cools below 135 C.
	const hot = fresh();
	hot.platform.x = hot.platform.previousX = 8;
	water.fill(6.5, 0.02, 9.5, 0.5);
	hot.heat = (c.thermalCutoff + 5 - c.ambientTemperature) * c.heatCapacity;
	harness.sync(hot);
	assert.equal(water.canFire(hot, 'rig'), false, 'thermal cutoff stops the jet');
	advanceSteps(hot, 0.2);
	assert.equal(water.totals.pumped, 0, 'thermal cutoff stalls the pump');
	harness.balanced(hot);

	// Engine efficiency scales the reserve draw, and pumping solute while moving keeps totalEnergy exact.
	const moving = fresh();
	moving.platform.x = moving.platform.previousX = physics.platformMin();
	assert.equal(physics.selectEngine('coal', moving), true);
	moving.battery = c.battery;
	harness.sync(moving);
	const coalStart = moving.battery;
	assert.equal(water.fire(moving, 'rig'), true);
	near(coalStart - moving.battery, water.state.shotEnergy / 0.2, 1e-9, 'coal pays 5x useful droplet energy');
	moving.platform.x = moving.platform.previousX = 8;
	moving.direction = 1;
	water.setAim(8, 14.5);
	water.setAutoFire(true, 'rig');
	harness.sync(moving);
	advanceSteps(moving, 2.5);
	water.setAutoFire(false, 'rig');
	assert.ok(water.totals.pumpedSolute > 0 || water.totals.pumped > 0, 'moving hull pumped water');
	harness.balanced(moving);
});

test('rig BOT manages water as a temporary thermal- and reserve-aware duty without overriding Pump', () => {
	const world = fresh();
	world.platform.x = world.platform.previousX = 8;
	water.setAutoFire(false, 'rig');
	water.setPump(false);
	harness.sync(world);

	players.setBot(0, true);
	players.update(world, c.step);
	assert.equal(water.stateFor('rig').botFire, true, 'BOT starts a temporary water stream');
	assert.equal(water.settings.pumpOn, false, 'BOT leaves the player Pump choice untouched');

	// Manual uncheck pauses BOT until BOT cycles; thermal threshold also holds it.
	water.setAutoFire(false, 'rig');
	players.update(world, c.step);
	assert.equal(water.stateFor('rig').botPaused, true);
	assert.equal(water.stateFor('rig').autoFire, false, 'manual uncheck pauses the bot jet');
	players.setBot(0, false);
	players.setBot(0, true);
	world.heat = (c.thermalDerateStart - 4 - c.ambientTemperature) * c.heatCapacity;
	players.update(world, c.step);
	assert.equal(water.stateFor('rig').botFire, false, 'BOT pauses the jet before thermal derating');
	world.heat = 0;

	// Charge-trip lead includes water+pump stream power when Pump is on.
	water.setPump(true);
	world.battery = c.battery * water.state.autoFireReserve + water.streamPower('rig') * 0.5;
	harness.sync(world);
	players.update(world, c.step);
	assert.equal(players.state.recharging, true, 'active water+pump draw triggers an early pad trip');
	assert.equal(water.stateFor('rig').botFire, false, 'BOT pauses the jet during the pad trip');

	// Turning BOT off clears botFire while keeping an explicit player autoFire order.
	water.setAutoFire(true, 'rig');
	players.setBot(0, false);
	assert.equal(water.stateFor('rig').botFire, false);
	assert.equal(water.stateFor('rig').autoFire, true, 'player standing order survives BOT off');
	water.setAutoFire(false, 'rig');
	harness.balanced(world);
});

test('solute-aware pump mode idles on shallow fresh puddles while lifting brine and deep floods', () => {
	const world = fresh(1);
	world.platform.x = world.platform.previousX = 12;
	water.setPump(true);
	water.setPumpMode('solute');
	harness.sync(world);

	// Shallow fresh puddle under the hull spreads thin and stays unpumped (zero energy/heat spent).
	water.setPump(false);
	const shallow = water.fill(11.6, 0.02, 12.4, 0.24);
	assert.ok(shallow > 0.5);
	for (let i = 0; i < 120; i++) physics.step(world, c.step);
	water.setPump(true);
	const pumpJBefore = water.measureMetrics().pumpJoules;
	for (let i = 0; i < 60; i++) physics.step(world, c.step);
	assert.equal(water.measureMetrics().pumped, 0, 'shallow fresh water stays unpumped');
	assert.equal(water.measureMetrics().pumpJoules, pumpJBefore, 'idling pump spends no battery');

	// Adding dissolved brine wakes the pump even in shallow water.
	const parcel = water.cellIndexAt(12, 0.1);
	const beforeWater = water.water[parcel];
	assert.ok(beforeWater > 0.05);
	const offset = parcel * minerals.mineralIds.length + halite;
	water.load[offset] += 0.2;
	water.loadValue[offset] += 2.0;
	water.loadTotal[parcel] += 0.2;
	for (let i = 0; i < 120; i++) physics.step(world, c.step);
	const afterBrine = water.measureMetrics();
	assert.ok(afterBrine.pumped > 0.05, 'solute-bearing parcel triggers pump');
	assert.ok(afterBrine.pumpedValue > 0.1, 'brine value enters hopper');

	// Deep fresh flood still pumps excess depth above the shallow floor layer.
	const w2 = fresh(2);
	w2.platform.x = w2.platform.previousX = 12;
	water.setPump(true);
	water.setPumpMode('solute');
	harness.sync(w2);
	water.fill(10.8, 0.02, 13.2, 0.72);
	for (let i = 0; i < 120; i++) physics.step(w2, c.step);
	assert.ok(water.measureMetrics().pumped > 1.0, 'deep fresh flood pumps excess depth');

	water.setPumpMode('always');
	harness.balanced(w2);
});


