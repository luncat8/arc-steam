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

test('the gun runs the planned nozzle: unlimited tank, a reserve draw per droplet', () => {
	assert.equal(water.state.dropletWater, 0.075);
	assert.equal(water.state.dropletsPerSecond, 46);
	assert.equal(water.state.shotEnergy, 135, 'a droplet spends what a sandblaster grain spends');
	assert.equal(water.state.pumpJoulesPerUnit, 420);
	assert.equal(water.state.satCap, water.state.satCapDefault, 'the chemistry cap starts at its default');
	const world = fresh();
	const battery = world.battery;
	assert.equal(water.fire(world, 'rig'), true);
	near(world.battery, battery - water.state.shotEnergy, 1e-9, 'the throw leaves the reserve');
	near(world.heat, water.state.shotEnergy, 1e-9, 'and arrives as heat');
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

test('the jet mines real rock, and the hopper holds exactly what the pump lifted', () => {
	const world = fresh();
	assert.ok(faceAbove() >= 0, 'the chamber has a face to work');
	soak(world, 12);
	const metrics = water.measureMetrics();
	assert.ok(metrics.dissolvedMass > 0, 'water mined the rock');
	assert.ok(metrics.dissolvedCells > 0, 'cells came down');
	// Every gram the chemistry took is in a parcel, in the lost-gas counter, on the
	// floor as a grain, or in the hopper. A cell the jet chipped down instead is
	// dry rock and leaves this ledger, which is why the check is the chemistry's
	// own total, not the rock's.
	const taken = metrics.cellDissolvedMass + metrics.residueMass;
	const held = metrics.brineMass + metrics.lostGasMass + metrics.grainMass + metrics.settledMass + metrics.pumpedSolute;
	near(held, taken, 1e-6, 'the wet ledger holds every gram the chemistry took');
	near(metrics.pumpedSolute, rock.cargoCells * rock.cellMass, 1e-9, 'cargo is pumped solute');
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
	assert.ok(world.battery < c.battery, 'the gun and the pump spent reserve');
	near(physics.totalEnergy(world), start, 1e-6, 'the chamber ledger holds');
});

test('the pump books the lift and the hopper entry, and never the same joule twice', () => {
	const world = fresh();
	water.setPump(false);
	water.fill(11.2, 0.02, 12.8, 0.6);
	const brine = water.totals.flooded;
	assert.ok(brine > 0);
	const cost = brine * water.state.pumpJoulesPerUnit;
	world.battery = c.battery;
	world.heat = 0;
	world.importedEnergy = 0;
	harness.sync(world);
	water.setPump(true);
	for (let i = 0; i < 600; i++) physics.step(world, c.step);
	const spent = world.battery;
	assert.ok(world.heat > 0, 'the pump work arrives as heat');
	assert.ok(spent < c.battery, 'the reserve paid for it');
	assert.ok(spent >= Math.min(c.battery, cost * 0.5), 'the lift is charged per water unit');
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
	// A bot order needs an engine whose pad refill power covers the stream, so the
	// stock electric pack cannot carry 46 droplets a second on its own.
	const carried = physics.reserveNow('rig') / physics.engineNow('rig').reload >= water.state.shotEnergy * water.state.dropletsPerSecond;
	assert.equal(water.streamReady(world, 'rig'), carried, 'readiness is the engine rule, not a key');
	// A full hopper has nowhere to put what the pump would lift.
	ceiling.loadCargo(halite, rock.storageLimit * rock.cellMass, 0);
	assert.equal(water.streamReady(world, 'rig'), false, 'a full hopper stands the stream down');
	ceiling.sellCargo(0, world.time);
	harness.sync(world);
	// A rival without the tool has no stream at all.
	assert.equal(water.streamReady(world, 'rival-1'), false, 'no cannon, no jet');
	// Bot fire is a separate order from the player's, and BOT off clears it.
	world.platform.x = physics.platformMin();
	world.platform.previousX = physics.platformMin();
	harness.sync(world);
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
