'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ceiling, equipment, research, physics, c, near, balanced, sync, run, earnFunds, afford, unlockResearch } = require('./harness.cjs');

test('technology states move locked to available to researched with prerequisites enforced', () => {
	const w = physics.createWorld();
	const { LOCKED, AVAILABLE, RESEARCHED } = research.constants;
	assert.equal(research.status('materials'), AVAILABLE);
	assert.equal(research.status('alloys'), AVAILABLE);
	assert.equal(research.status('electromagnetics'), LOCKED, 'needs rebound materials');
	assert.equal(research.status('thermodynamics'), LOCKED, 'needs light alloys');
	assert.equal(research.status('storage'), LOCKED);
	assert.equal(research.status('ballistics'), LOCKED);
	assert.equal(research.status('traction'), LOCKED, 'needs pulse electromagnetics');
	assert.equal(research.status('power'), LOCKED, 'needs traction motors and heat transfer');
	assert.equal(research.state.completed, 0);
	assert.equal(research.research('electromagnetics', w), false, 'a locked node cannot be bought');
	assert.equal(research.research('materials', w), false, 'an available node still needs funds');
	near(ceiling.state.funds, 0);
	near(ceiling.state.ledger.length, 0);
	afford(w, 180);
	const funds = ceiling.state.funds;
	assert.equal(research.research('materials', w), true);
	near(ceiling.state.funds, funds - 180);
	assert.equal(research.status('materials'), RESEARCHED);
	assert.equal(research.isResearched('materials'), true);
	assert.equal(research.status('electromagnetics'), AVAILABLE, 'the prerequisite opened the next node');
	assert.equal(research.research('materials', w), false, 'no duplicate charge');
	near(ceiling.state.funds, funds - 180);
	const entry = ceiling.state.ledger[ceiling.state.ledger.length - 1];
	assert.equal(entry.type, 'research');
	assert.equal(entry.label, 'Rebound materials');
	assert.equal(entry.credits, 180);
	assert.ok(Object.isFrozen(entry));
	assert.equal(research.state.completed, 1);
	assert.equal(research.status('storage'), LOCKED, 'the deep branch waits for its own chain');
	unlockResearch(w, 'thermodynamics');
	assert.equal(research.status('storage'), AVAILABLE);
	assert.equal(research.status('ballistics'), LOCKED, 'the ballistic computer needs pulse electromagnetics');
	unlockResearch(w, 'electromagnetics');
	assert.equal(research.status('ballistics'), AVAILABLE);
	assert.equal(research.state.prediction, false, 'the capability arrives with its own node');
	unlockResearch(w, 'ballistics');
	assert.equal(research.state.prediction, true);
	unlockResearch(w, 'storage');
	unlockResearch(w, 'traction');
	assert.equal(research.status('power'), AVAILABLE, 'both engine prerequisites are in');
	unlockResearch(w, 'power');
	unlockResearch(w, 'impact');
	unlockResearch(w, 'ballistics2');
	assert.equal(research.state.predictionBounces, true);
	assert.equal(research.state.completed, research.nodes.length);
	physics.createWorld();
	assert.equal(research.state.completed, 0, 'a world reset clears research');
	assert.equal(research.state.prediction, false);
	assert.equal(research.status('electromagnetics'), LOCKED);
});

test('research deltas reach the simulation instead of acting as labels', () => {
	const w = physics.createWorld();
	near(physics.retentionNow(), c.retention);
	near(physics.pulseNow(), c.pulse);
	near(physics.dryMass(), c.platformMass);
	near(physics.conductanceNow(), c.convectiveConductance);
	// Rebound materials: the deck bounce measures the higher retention.
	unlockResearch(w, 'materials');
	near(physics.retentionNow(), c.retention + 0.01);
	w.ball.state = 'flying';
	w.drive = false;
	w.ball.x = 12.8; w.ball.vx = 0; w.ball.y = c.deck + c.radius; w.ball.vy = -5;
	sync(w);
	physics.step(w, c.step);
	near(w.ball.vy + c.ballGravity * c.step, 5 * Math.sqrt(c.retention + 0.01));
	balanced(w);
	// Pulse electromagnetics: the release pays the larger pulse from the reserve.
	unlockResearch(w, 'electromagnetics');
	near(physics.pulseNow(), c.pulse + 4);
	w.ball.state = 'held';
	w.drive = true;
	sync(w);
	assert.ok(physics.launch(w));
	near(w.lastPush, c.pulse + 4);
	balanced(w);
	// Light alloys: dry mass drops and the same engine force accelerates harder.
	unlockResearch(w, 'alloys');
	near(physics.dryMass(), c.platformMass - 4 * 1.018);
	w.drive = false;
	w.ball.state = 'held';
	w.ball.vx = 0;
	w.ball.vy = 0;
	w.platform.vx = 0;
	w.direction = 1;
	sync(w);
	run(w, 0.25);
	near(w.platform.vx, c.force * w.forceSetting / (physics.dryMass() + c.ballMass) * 0.25);
	balanced(w);
	// Heat transfer: the same stored heat now cools faster.
	w.direction = 0;
	afford(w, research.find('thermodynamics').cost);
	w.heat = c.heatCapacity * 60;
	sync(w);
	const before = physics.coolingPower(w);
	assert.equal(research.research('thermodynamics', w), true);
	near(physics.conductanceNow(), c.convectiveConductance + 0.5);
	assert.ok(physics.coolingPower(w) > before);
	run(w, 1);
	assert.ok(w.cooledEnergy > 0);
	balanced(w);
	physics.createWorld();
	near(physics.retentionNow(), c.retention);
	near(physics.pulseNow(), c.pulse);
	near(physics.dryMass(), c.platformMass);
	near(physics.conductanceNow(), c.convectiveConductance);
});

test('every node and item stays fundable inside a measured working shift', () => {
	const w = physics.createWorld();
	let total = 0;
	for (const node of research.nodes) total += node.cost;
	for (const item of equipment.items) total += item.cost;
	for (const ball of equipment.balls) if (ball.cost) total += ball.cost;
	for (const rad of equipment.radiators) total += rad.cost;
	// Enough 100-cell loads have to cover the whole tree and shop, otherwise
	// the prerequisites would push the first upgrades out of ordinary play.
	let loads = 0;
	while (ceiling.state.funds < total && loads < 30) { earnFunds(w, 100); loads++; }
	assert.ok(ceiling.state.funds >= total, `${ceiling.state.funds.toFixed(0)} cr earned in ${loads} loads against ${total} cr of upgrades`);
	physics.createWorld();
});

test('test-mode research grants every technology without funds or prerequisite checks', () => {
	const w = physics.createWorld();
	ceiling.setCommune(false);
	const funds = ceiling.state.funds;
	assert.equal(research.researchAll(w), research.nodes.length);
	assert.equal(research.state.completed, research.nodes.length);
	assert.equal(research.state.prediction, true);
	assert.equal(research.status('ballistics'), research.constants.RESEARCHED);
	assert.equal(research.grant('materials', w), false, 'granted nodes cannot be duplicated');
	assert.equal(ceiling.state.funds, funds, 'grants do not spend credits');
	assert.equal(ceiling.state.ledger.length, research.nodes.length);
	for (const entry of ceiling.state.ledger) {
		assert.equal(entry.source, 'test');
		assert.equal(entry.type, 'research');
		assert.equal(entry.credits, 0);
		assert.ok(Object.isFrozen(entry));
	}
	balanced(w);
	physics.createWorld();
});
