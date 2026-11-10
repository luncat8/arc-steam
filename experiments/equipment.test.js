const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ceiling, equipment, research, physics, c, near, balanced, sync, run, earnFunds, unlockResearch, buy } = require('./harness.cjs');
const players = require('../js/players.js');

test('purchase needs funds and the unlocking research, debits once, and appends frozen ledger entries', () => {
	const w = physics.createWorld();
	assert.equal(equipment.install('pad', w), false, 'no funds yet');
	assert.equal(equipment.isUnlocked('pad'), false, 'the pad is locked before its research');
	// A live quote pays about 5–8 cr per cell, so a full hopper is the load that
	// funds a research node and its item together.
	const earned = earnFunds(w, 100);
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
	// Funding is staged settlement, not a thermal endurance run. Keep passive
	// pulses off so the launch below measures equipment, not inherited cutoff.
	w.drive = false;
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
	// The staged sales dissipate their own impact heat; this assertion measures
	// the coil's pulse, so start it below thermal derating.
	w.heat = 0;
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
		// Wider damage splashes can slightly shift ore mix per batch; ensure the
		// heavy tier is fundable regardless of the exact mineral draw.
		while (ceiling.state.funds < 1400) earnFunds(w, 20);
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

test('the piston ram lifts the pulse so a released ball reaches the ceiling on its second powered bounce', () => {
	const w = physics.createWorld();
	assert.equal(equipment.isUnlocked('ram'), false, 'the ram is locked before its research');
	assert.equal(equipment.install('ram', w), false, 'and it cannot be bought before that research');
	assert.equal(equipment.grant('ram', w), true, 'a test grant fits it for measurement');
	assert.ok(equipment.isInstalled('ram'));
	// Stock 42 J plus the ram's 26 J, before any research pulse bonus.
	near(physics.pulseNow(), 68);
	near(equipment.state.pulseBonus, 26);
	// Feed the solver the flight the release starts: each powered bounce
	// comes back to the face at the speed the previous one left at.
	const out = physics.contactResult();
	const target = c.ceiling - c.radius - (c.deck + c.radius);
	let incoming = Math.sqrt(2 * physics.pulseNow() / c.ballMass);
	const apexes = [];
	for (let bounce = 0; bounce < 2; bounce++) {
		assert.ok(physics.deckBounce(0, -incoming, 0, 0, 0, physics.pulseNow(), out), 'the face returns the ball');
		apexes.push(out.vy * out.vy / (2 * c.ballGravity));
		incoming = out.vy;
	}
	assert.ok(apexes[0] < target, `the first powered bounce still falls short (${apexes[0].toFixed(2)} m of ${target.toFixed(2)} m)`);
	assert.ok(apexes[1] >= target, `the second powered bounce reaches the ceiling (${apexes[1].toFixed(2)} m of ${target.toFixed(2)} m)`);
	balanced(w);
	physics.createWorld();
});

test('owned balls and radiators use their player profile without touching the rig', () => {
	const w = physics.createWorld();
	players.init(w, 1);
	players.setBallMode('each');
	const rival = players.state.rivals[0];
	const rigBall = w.balls.find(ball => physics.isRigBall(ball));
	const rivalBall = w.balls.find(ball => ball.owner === rival.id);
	assert.ok(rigBall && rivalBall);
	research.grant('impact', w, rival.id);
	research.grant('thermodynamics', w, rival.id);
	assert.equal(equipment.installBall('spike', w, true, rival.id), true);
	assert.equal(equipment.installRadiator('bank', w, true, rival.id), true);
	assert.equal(equipment.installedBall(rival.id), 'spike');
	assert.equal(equipment.installedBall(), 'standard');
	assert.equal(equipment.installedRadiator(rival.id), 'bank');
	assert.equal(equipment.installedRadiator(), null);
	near(physics.ballMassFor(rivalBall), c.ballMass + 5);
	near(physics.ballMassFor(rigBall), c.ballMass);
	near(physics.rockRetentionNow(rival.id), physics.rockRetentionNow() - 0.10);
	near(ceiling.damageMultiplierNow(rival.id), ceiling.state.baseDamageMultiplier + 0.7);
	near(ceiling.damageMultiplierNow(), ceiling.state.baseDamageMultiplier);
	near(ceiling.damageRadiusNow(rival.id), ceiling.state.baseDamageRadius + 1.4);
	near(physics.radiatorArea(rival.id), 0.70);
	near(physics.radiatorArea(), 0);
	balanced(w);

	// A live rig ball changes mass with its purchased strike head. The energy
	// difference is explicitly booked rather than appearing as a ledger error.
	rigBall.state = 'flying';
	rigBall.holder = null;
	rigBall.y = 3;
	rigBall.vx = 1;
	rigBall.vy = 2;
	research.grant('impact', w, 'rig');
	sync(w);
	assert.equal(equipment.installBall('spike', w, true, 'rig'), true);
	near(physics.ballMassFor(rigBall), c.ballMass + 5);
	balanced(w);
});

test('the road grader is the rig\'s tool: no competitor can buy it, and its refusal is not a prerequisite', () => {
	const w = physics.createWorld();
	players.init(w, 1);
	const rival = players.state.rivals[0];
	research.grant('materials', w, rival.id);
	rival.money = 500;
	assert.equal(equipment.isUnlocked('grader', rival.id), false, 'a rival never sees the blade as available');
	assert.equal(equipment.isUnlocked('grader', 'rig'), true, 'the rig needs no research for it');
	assert.equal(equipment.install('grader', w, rival.id), false, 'the API refuses the purchase');
	assert.equal(equipment.isInstalled('grader', rival.id), false);
	assert.equal(rival.money, 500, 'a refused purchase leaves the rival purse alone');
	// Communism waives prices, not the rig-only rule.
	ceiling.setCommune(true);
	assert.equal(equipment.isUnlocked('grader', rival.id), false);
	assert.equal(equipment.install('grader', w, rival.id), false);
	ceiling.setCommune(false);
	// The rig still buys it normally, for 300 cr, with no research at all.
	ceiling.grant('Rig credit', 0);
	w.platform.x = physics.platformMin();
	const earned = earnFunds(w, 100);
	assert.ok(earned >= 300, 'the rig earned the blade');
	const before = ceiling.state.funds;
	assert.equal(equipment.install('grader', w), true);
	near(ceiling.state.funds, before - 300);
	physics.createWorld();
});

test('a working blade keeps the value of what it shaved and settles it once per stint', () => {
	const w = physics.createWorld();
	const state = ceiling.state;
	// Stage the sale away from the platform: a fragment parked in the moving
	// rig's own hopper is surface rubble, whose capture the ceiling ledger never
	// counted, so it would mask the blade's own balance.
	w.platform.x = 3;
	earnFunds(w, 100);
	w.platform.x = 12;
	w.platform.vx = 0;
	w.platform.y = 0;
	w.platform.previousY = 0;
	assert.ok(equipment.install('grader', w), 'the ungated blade installs from sale income');
	// The grader settles the platform, so pan the floor only after the install.
	state.floorPiles.fill(0.3);
	state.floorValues.fill(30);
	// No delayed fall may deposit a different ore density during the measured pass.
	state.active.fill(0); state.debrisCells.fill(0);
	state.damageField.fill(0); state.regionDamage.fill(0); state.regionEligible.fill(0);
	ceiling.collapse(0);
	// earnFunds' staged fragments are caught into the hopper before the sale, and
	// the ceiling ledger never counted surfaced rubble as chamber energy; re-base
	// so the balance below is the blade pass alone, which touches no energy term.
	sync(w);
	const before = state.funds;
	const floorValue = () => Array.from(state.floorValues).reduce((total, value) => total + value, 0);
	const pileHeight = () => Array.from(state.floorPiles).reduce((total, height) => total + height, 0);
	const valueBefore = floorValue();
	const heightBefore = pileHeight();
	const entries = state.ledger.length;
	w.target = physics.platformMax();
	for (let i = 0; i < 240 * 8; i++) physics.step(w, c.step);
	// The target is held to the end, so the stint is settled by the pause rule.
	const valueAfter = floorValue();
	const heightAfter = pileHeight();
	assert.ok(heightAfter < heightBefore, 'the blade shaved material');
	assert.ok(valueAfter < valueBefore, 'and the floor lost the matching value');
	near(valueAfter / heightAfter, 100, 1e-9);
	const blade = state.ledger.slice(entries).filter(entry => entry.type === 'blade');
	assert.ok(blade.length >= 1, 'a stint is booked as one blade settlement');
	for (const entry of blade) assert.ok(Object.isFrozen(entry));
	const credited = blade.reduce((total, entry) => total + entry.credits, 0);
	near(state.funds - before, credited, 1e-6, 'the whole credit arrives through the ledger');
	near(credited, 0.5 * (valueBefore - valueAfter), 1e-6, 'the owner is paid half of the shaved value');
	balanced(w);
	physics.createWorld();
});
