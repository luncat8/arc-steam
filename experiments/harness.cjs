'use strict';
// Shared harness for the Node tests. Purchases and research are funded by real
// cargo sales through the simulation, so economy gating is measured rather than
// asserted against a hand-set balance.
const assert = require('node:assert/strict');
const ceiling = require('../js/ceiling.js');
const equipment = require('../js/equipment.js');
const research = require('../js/research.js');
const physics = require('../js/physics.js');
const prediction = require('../js/prediction.js');
const c = physics.config;

function near(actual, expected, tolerance = 1e-6) {
	assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}
function balanced(world) { near(physics.totalEnergy(world), world.initialEnergy, 1e-6); }
function sync(world) { world.initialEnergy = physics.totalEnergy(world); }
function run(world, seconds) {
	for (let i = 0; i < Math.round(seconds / c.step); i++) physics.step(world, c.step);
}

// Break rock, drop the fragments into the collector, sell at a wall, and let the
// chamber settle so later measurements start with empty storage.
function earnFunds(world, cells) {
	const target = ceiling.state.extractedCells + cells;
	for (let x = 1; x < 23 && ceiling.state.extractedCells < target; x += 2) ceiling.damage(x, ceiling.state.bottom + 0.2, 20);
	const state = ceiling.state;
	let prepared = 0;
	for (let i = 0; i < state.active.length && prepared < cells; i++) {
		if (!state.active[i]) continue;
		state.debrisX[i] = world.platform.x - 1;
		state.debrisY[i] = 0.701;
		state.debrisVx[i] = 0;
		state.debrisVy[i] = -1;
		prepared++;
	}
	physics.step(world, c.step);
	ceiling.sellCargo(0, world.time);
	for (let i = 0; i < 240 * 3; i++) physics.step(world, c.step);
	ceiling.sellCargo(0, world.time);
	assert.equal(ceiling.state.airborneCells, 0, 'debris settled');
	assert.equal(ceiling.state.cargoCells, 0, 'storage empty');
	return ceiling.state.funds;
}

function afford(world, cost) {
	let loads = 0;
	while (ceiling.state.funds < cost) {
		earnFunds(world, 100);
		assert.ok(++loads < 40, 'the economy cannot fund ' + cost + ' cr');
	}
	return ceiling.state.funds;
}

function unlockResearch(world, id) {
	const node = research.find(id);
	for (const prerequisite of node.requires) if (!research.isResearched(prerequisite)) unlockResearch(world, prerequisite);
	if (research.isResearched(id)) return;
	afford(world, node.cost);
	assert.equal(research.research(id, world), true, id + ' researched');
}

function buy(world, id) {
	const item = equipment.find(id);
	unlockResearch(world, item.requires);
	afford(world, item.cost);
	assert.equal(equipment.install(id, world), true, id + ' installed');
}

module.exports = { ceiling, equipment, research, physics, prediction, c, near, balanced, sync, run, earnFunds, afford, unlockResearch, buy };
