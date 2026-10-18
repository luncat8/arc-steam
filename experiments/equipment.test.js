'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ceiling = require('../js/ceiling.js');
const equipment = require('../js/equipment.js');
const physics = require('../js/physics.js');
const c = physics.config;

function near(actual, expected, tolerance = 1e-6) {
	assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}
function balanced(world) { near(physics.totalEnergy(world), world.initialEnergy, 1e-6); }
function sync(world) { world.initialEnergy = physics.totalEnergy(world); }

function earnFunds(world, cells) {
	const target = ceiling.state().extractedCells() + cells;
	for (let x = 1; x < 23 && ceiling.state().extractedCells() < target; x += 2) ceiling.damage(x, 8.2, 20);
	const state = ceiling.state();
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
	// Settle the remaining fragments and drain incidental catches so later
	// measurements run with empty storage and no falling debris.
	for (let i = 0; i < 240 * 3; i++) physics.step(world, c.step);
	ceiling.sellCargo(0, world.time);
	assert.equal(ceiling.state().airborneCells(), 0, 'debris settled');
	assert.equal(ceiling.state().cargoCells(), 0, 'storage empty');
	return ceiling.state().funds();
}

test('purchase requires funds, debits once, and appends a frozen ledger entry', () => {
	const w = physics.createWorld();
	assert.equal(equipment.install('pad', w), false, 'no funds yet');
	const earned = earnFunds(w, 60);
	assert.ok(earned > 250);
	assert.equal(equipment.install('pad', w), true);
	near(ceiling.state().funds(), earned - 250);
	assert.ok(equipment.isInstalled('pad'));
	assert.equal(equipment.install('pad', w), false, 'no duplicate charge');
	near(ceiling.state().funds(), earned - 250);
	const ledger = ceiling.state().ledger;
	const buy = ledger[ledger.length - 1];
	assert.equal(buy.type, 'buy');
	assert.equal(buy.label, 'Rebound pad');
	assert.equal(buy.credits, 250);
	assert.ok(Object.isFrozen(buy));
	assert.equal(equipment.install('coil', w), false, 'coil costs more than remains');
	physics.createWorld();
});

test('installed equipment changes retention, pulse and dry mass in the simulation', () => {
	const w = physics.createWorld();
	earnFunds(w, 100);
	earnFunds(w, 100);
	assert.ok(ceiling.state().funds() >= 1000, 'two full loads fund the first tier');
	// Pad: passive bounce keeps 93% instead of 90% of normal kinetic energy.
	const beforePad = physics.dryMass();
	assert.equal(equipment.install('pad', w), true);
	near(physics.dryMass(), beforePad + 6);
	w.ball.state = 'flying';
	w.ball.x = 12.8; w.ball.vx = 0; w.ball.y = c.deck + c.radius; w.ball.vy = -5;
	sync(w);
	physics.step(w, c.step);
	near(w.ball.vy + c.gravity * c.step, 5 * Math.sqrt(0.93), 1e-6);
	balanced(w);
	// Coil: launch delivers the larger pulse from the reserve.
	const beforeCoil = physics.dryMass();
	assert.equal(equipment.install('coil', w), true);
	near(physics.dryMass(), beforeCoil + 12);
	w.ball.state = 'held';
	w.drive = true;
	sync(w);
	assert.ok(physics.launch(w));
	near(w.lastPush, 48);
	balanced(w);
	// Chassis: dry platform mass drops by 12 kg and acceleration rises.
	const beforeChassis = physics.dryMass();
	assert.equal(equipment.install('chassis', w), true);
	near(physics.dryMass(), beforeChassis - 12);
	w.ball.state = 'held';
	w.platform.vx = 0;
	w.direction = 1;
	sync(w);
	for (let i = 0; i < Math.round(0.25 / c.step); i++) physics.step(w, c.step);
	near(w.platform.vx, c.force * w.forceSetting / (physics.dryMass() + c.mass) * 0.25, 1e-6);
	balanced(w);
	physics.createWorld();
	near(physics.dryMass(), c.platformMass, 1e-9);
	assert.equal(equipment.isInstalled('pad'), false, 'world reset clears equipment');
});

test('mass changes are booked so the energy ledger stays exact', () => {
	const w = physics.createWorld();
	earnFunds(w, 100);
	earnFunds(w, 100);
	w.platform.vx = 3;
	sync(w);
	assert.equal(equipment.install('chassis', w), true);
	balanced(w);
	// Heavy items draw the added kinetic energy from the heat ledger instead
	// of appearing from nowhere.
	assert.equal(equipment.install('coil', w), true);
	balanced(w);
	physics.createWorld();
});
