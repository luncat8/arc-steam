const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ceiling, equipment, research, physics, c, near, balanced, sync, run, earnFunds, unlockResearch, buy } = require('./harness.cjs');

test('purchase needs funds and the unlocking research, debits once, and appends frozen ledger entries', () => {
	const w = physics.createWorld();
	assert.equal(equipment.install('pad', w), false, 'no funds yet');
	assert.equal(equipment.isUnlocked('pad'), false, 'the pad is locked before its research');
	const earned = earnFunds(w, 60);
	assert.ok(earned > 180 + 250);
	assert.equal(equipment.install('pad', w), false, 'funds alone do not unlock it');
	near(ceiling.state.funds, earned);
	assert.equal(research.research('materials', w), true);
	assert.equal(equipment.isUnlocked('pad'), true);
	assert.equal(equipment.install('pad', w), true);
	near(ceiling.state.funds, earned - 180 - 250);
	assert.ok(equipment.isInstalled('pad'));
	assert.equal(equipment.install('pad', w), false, 'no duplicate charge');
	near(ceiling.state.funds, earned - 180 - 250);
	const ledger = ceiling.state.ledger;
	const studied = ledger[ledger.length - 2];
	assert.equal(studied.type, 'research');
	assert.equal(studied.label, 'Rebound materials');
	assert.equal(studied.credits, 180);
	assert.ok(Object.isFrozen(studied));
	const buyEntry = ledger[ledger.length - 1];
	assert.equal(buyEntry.type, 'buy');
	assert.equal(buyEntry.label, 'Rebound pad');
	assert.equal(buyEntry.credits, 250);
	assert.ok(Object.isFrozen(buyEntry));
	assert.equal(equipment.install('coil', w), false, 'the coil is locked behind its own research');
	physics.createWorld();
});

test('installed equipment changes retention, pulse and dry mass in the simulation', () => {
	const w = physics.createWorld();
	earnFunds(w, 100);
	earnFunds(w, 100);
	earnFunds(w, 100);
	assert.ok(ceiling.state.funds >= 1000, 'full loads fund the first tier');
	// Pad: researched rebound materials plus the pad lift retention to 94%.
	unlockResearch(w, 'materials');
	near(physics.retentionNow(), 0.91);
	const beforePad = physics.dryMass();
	near(beforePad, c.platformMass);
	buy(w, 'pad');
	near(physics.retentionNow(), 0.94);
	near(physics.dryMass(), beforePad + 6);
	w.ball.state = 'flying';
	w.drive = false;
	w.ball.x = 12.8; w.ball.vx = 0; w.ball.y = c.deck + c.radius; w.ball.vy = -5;
	sync(w);
	physics.step(w, c.step);
	near(w.ball.vy + c.ballGravity * c.step, 5 * Math.sqrt(physics.retentionNow()));
	balanced(w);
	// Coil: launch delivers the researched and installed pulse from the reserve.
	unlockResearch(w, 'electromagnetics');
	near(physics.pulseNow(), 40);
	const beforeCoil = physics.dryMass();
	buy(w, 'coil');
	near(physics.pulseNow(), 52);
	near(physics.dryMass(), beforeCoil + 12);
	w.ball.state = 'held';
	w.drive = true;
	sync(w);
	assert.ok(physics.launch(w));
	near(w.lastPush, 52);
	balanced(w);
	// Chassis: researched alloys and the chassis both cut dry mass.
	unlockResearch(w, 'alloys');
	const beforeChassis = physics.dryMass();
	near(beforeChassis, c.platformMass + 6 + 12 - 4);
	buy(w, 'chassis');
	near(physics.dryMass(), beforeChassis - 12);
	w.ball.state = 'held';
	w.platform.vx = 0;
	w.direction = 1;
	sync(w);
	run(w, 0.25);
	near(w.platform.vx, c.force * w.forceSetting / (physics.dryMass() + c.ballMass) * 0.25);
	balanced(w);
	physics.createWorld();
	near(physics.dryMass(), c.platformMass, 1e-9);
	assert.equal(equipment.isInstalled('pad'), false, 'world reset clears equipment');
	assert.equal(research.isResearched('materials'), false, 'world reset clears research');
	assert.equal(equipment.isUnlocked('pad'), false, 'and re-locks the equipment');
});

test('radiator installation increases real convective and radiative cooling', () => {
	const w = physics.createWorld();
	earnFunds(w, 100);
	earnFunds(w, 100);
	earnFunds(w, 100);
	unlockResearch(w, 'thermodynamics');
	near(physics.conductanceNow(), c.convectiveConductance + 0.5);
	w.heat = c.heatCapacity * 100;
	sync(w);
	const baseCooling = physics.coolingPower(w);
	const baseMass = physics.dryMass();
	buy(w, 'radiator');
	near(equipment.state.radiatorArea, 0.35);
	near(physics.conductanceNow(), c.convectiveConductance + 0.5 + c.radiatorConvectionCoefficient * 0.35);
	near(physics.dryMass(), baseMass + 8);
	sync(w);
	assert.ok(physics.coolingPower(w) > baseCooling);
	physics.step(w, c.step);
	assert.ok(w.cooledEnergy > 0);
	balanced(w);
	physics.createWorld();
});

test('brake flywheel returns part of the braking energy to the reserve', () => {
	const w = physics.createWorld();
	earnFunds(w, 100);
	earnFunds(w, 100);
	earnFunds(w, 100);
	assert.equal(equipment.isUnlocked('flywheel'), false, 'flywheel storage research is missing');
	unlockResearch(w, 'storage');
	buy(w, 'flywheel');
	near(physics.recoveryNow(), 0.55);
	near(physics.dryMass(), c.platformMass - 4 + 14);
	w.ball.state = 'held';
	w.platform.x = physics.platformMin();
	w.target = NaN;
	w.platform.vx = c.maxSpeed;
	w.direction = -1;
	w.forceSetting = 1;
	sync(w);
	const battery = w.battery;
	const heatBefore = w.heat;
	const cooledBefore = w.cooledEnergy;
	const mass = physics.platformMass(w);
	const before = 0.5 * mass * w.platform.vx * w.platform.vx;
	let steps = 0;
	while (w.platform.vx > 1e-9 && steps < 240 * 10) {
		const stopTime = w.platform.vx * mass / c.force;
		physics.step(w, Math.min(c.step, stopTime));
		steps++;
	}
	const after = 0.5 * mass * w.platform.vx * w.platform.vx;
	assert.ok(steps < 240 * 10, 'the platform braked to a stop');
	near(w.battery - battery, (before - after) * 0.55 * c.recoveryEfficiency);
	assert.ok(w.heat > heatBefore, 'the round-trip loss stays in the machinery');
	near(w.heat - heatBefore + w.cooledEnergy - cooledBefore + (w.battery - battery), before - after, 1e-6);
	balanced(w);
	// A wall stop is a crash rather than braking, so the flywheel recovers nothing.
	w.platform.x = physics.platformMax() - 0.01;
	w.platform.vx = c.maxSpeed;
	w.direction = 0;
	w.target = NaN;
	sync(w);
	const crashBattery = w.battery;
	const crashHeat = w.heat;
	physics.step(w, c.step);
	assert.equal(w.platform.vx, 0);
	near(w.battery, crashBattery);
	assert.ok(w.heat > crashHeat);
	balanced(w);
	physics.createWorld();
	near(physics.recoveryNow(), 0);
});

test('mass changes are booked so the energy ledger stays exact', () => {
	const w = physics.createWorld();
	earnFunds(w, 100);
	earnFunds(w, 100);
	earnFunds(w, 100);
	w.platform.vx = 3;
	sync(w);
	unlockResearch(w, 'alloys');
	balanced(w);
	buy(w, 'chassis');
	balanced(w);
	// Heavy items draw the added kinetic energy from the heat ledger instead of
	// appearing from nowhere.
	buy(w, 'coil');
	balanced(w);
	physics.createWorld();
});
