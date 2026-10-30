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
	near(physics.dryMass(), beforePad + 6 * 1.018);
	w.ball.state = 'flying';
	w.drive = false;
	w.ball.x = 12.8; w.ball.vx = 0; w.ball.y = c.deck + c.radius; w.ball.vy = -5;
	sync(w);
	physics.step(w, c.step);
	near(w.ball.vy + c.ballGravity * c.step, 5 * Math.sqrt(physics.retentionNow()));
	balanced(w);
	// Coil: launch delivers the researched and installed pulse from the reserve.
	unlockResearch(w, 'electromagnetics');
	near(physics.pulseNow(), 46);
	const beforeCoil = physics.dryMass();
	buy(w, 'coil');
	near(physics.pulseNow(), 58);
	near(physics.dryMass(), beforeCoil + 12 * 1.018);
	w.ball.state = 'held';
	w.drive = true;
	sync(w);
	assert.ok(physics.launch(w));
	near(w.lastPush, 58);
	balanced(w);
	// Chassis: researched alloys and the chassis both cut dry mass.
	unlockResearch(w, 'alloys');
	const beforeChassis = physics.dryMass();
	near(beforeChassis, c.platformMass + (6 + 12 - 4) * 1.018);
	buy(w, 'chassis');
	near(physics.dryMass(), beforeChassis - 12 * 1.018);
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

	test('radiator tiers swap one installed unit: mass and cooling area move with it', () => {
		const w = physics.createWorld();
		earnFunds(w, 100);
		earnFunds(w, 100);
		earnFunds(w, 100);
		// Locked without the Heat transfer research node.
		assert.equal(equipment.installRadiator('radiator', w), false, 'the radiator tiers are locked without their research');
		unlockResearch(w, 'alloys');
		unlockResearch(w, 'thermodynamics');
		near(physics.conductanceNow(), c.convectiveConductance + 0.5);
		near(physics.radiatorArea(), 0);
		const baseMass = physics.dryMass();
		assert.equal(equipment.installRadiator('radiator', w), true, 'the radiator array installs');
		assert.equal(equipment.installedRadiator(), 'radiator');
		near(equipment.state.massDelta, 8);
		near(physics.radiatorArea(), 0.35);
		near(physics.conductanceNow(), c.convectiveConductance + 0.5 + c.radiatorConvectionCoefficient * 0.35);
		assert.ok(physics.dryMass() > baseMass, 'the radiator adds mass');
		// Swapping tiers replaces mass and area instead of stacking them.
		assert.equal(equipment.installRadiator('vent', w), true, 'the vent grille installs');
		near(equipment.state.massDelta, 4);
		earnFunds(w, 150);
		near(physics.radiatorArea(), 0.15);
		assert.ok(physics.dryMass() < baseMass + 8, 'the lighter tier removes mass');
		assert.equal(equipment.installRadiator('bank', w), true, 'the heavy bank installs');
		near(equipment.state.massDelta, 16);
		near(physics.radiatorArea(), 0.70);
		assert.ok(physics.dryMass() > baseMass + 8, 'the heavy tier adds the most mass');
		assert.equal(equipment.installRadiator('bank', w), false, 'the installed tier cannot be re-installed');
		// Cooling is real: hot metal loses energy to the air and the books stay exact.
		w.heat = c.heatCapacity * 100;
		sync(w);
		assert.ok(physics.coolingPower(w) > 0);
		physics.step(w, c.step);
		assert.ok(w.cooledEnergy > 0);
		balanced(w);
		physics.createWorld();
	});
