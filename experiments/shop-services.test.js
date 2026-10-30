'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { physics: p, ceiling: c, equipment: e, research: r, prediction, near, balanced, sync, run, afford } = require('./harness.cjs');

test('engine purchases install at left shop, own once, swap free, and reset ownership', () => {
	const w = p.createWorld();
	assert.equal(e.buyEngine('hand', w), false);
	w.platform.x = p.platformMin();
	assert.equal(e.buyEngine('hand', w), false, 'needs funds');
	afford(w, e.engineCosts.hand);
	w.platform.x = p.platformMin(); w.platform.vx = 0;
	const funds = c.state.funds;
	const battery = w.battery;
	sync(w);
	assert.ok(e.buyEngine('hand', w));
	near(c.state.funds, funds - e.engineCosts.hand);
	assert.ok(w.battery <= battery, 'installing does not fill a pack');
	assert.ok(e.ownsEngine('hand'));
	balanced(w);
	const ledgerLength = c.state.ledger.length;
	assert.ok(e.buyEngine('electric', w));
	assert.ok(e.buyEngine('hand', w));
	near(c.state.funds, funds - e.engineCosts.hand);
	assert.equal(c.state.ledger.length, ledgerLength);
	balanced(w);
	w.platform.vx = 1;
	assert.equal(e.buyEngine('electric', w), false);
	p.createWorld();
	assert.equal(e.ownsEngine('hand'), false);
	assert.ok(e.ownsEngine('electric'));
});

test('held brake stops without reversal or fuel and recuperates with flywheel', () => {
	const w = p.createWorld();
	e.grant('flywheel', w);
	w.platform.x = 3; w.platform.vx = 4; w.ball.state = 'held';
	w.brake = true; w.direction = 1; w.battery = 0;
	sync(w);
	run(w, 2);
	near(w.platform.vx, 0);
	assert.ok(w.battery > 0, 'braking charges reserve');
	const x = w.platform.x;
	run(w, 1);
	near(w.platform.x, x);
	balanced(w);
});

test('commercial grader can be dispatched from anywhere, shuttles and settles 50% per sweep', () => {
	const w = p.createWorld();
	w.platform.x = p.platformMax() - 1; w.platform.vx = 2;
	const s = c.state;
	s.floorPiles.fill(s.floorCellHeight * 3);
	s.floorValues.fill(12);
	assert.ok(c.hireGrader(w), 'hiring does not require parking at the left shop');
	assert.equal(c.hireGrader(w), false);
	const funds = s.funds;
	// One full crossing takes 16 s at 1.5 m/s; one settlement at the far wall,
	// then the bot keeps running (shuttles back and forth instead of respawning).
	for (let i = 0; i < 240 * 16; i++) c.step(w, p.config.step, p.platformMass(w));
	assert.equal(s.graderBot.active, true);
	assert.equal(s.graderBot.direction, 1);
	near(s.funds - funds, s.columns * 2);
	for (let i = 0; i < s.columns; i++) near(s.floorPiles[i], s.floorCellHeight * 2);
	const entries = s.ledger.length;
	assert.equal(s.ledger.at(-1).type, 'grader');
	// The return sweep reaches the garage wall after another 16 s and settles again.
	for (let i = 0; i < 240 * 16; i++) c.step(w, p.config.step, p.platformMass(w));
	near(s.funds - funds, s.columns * 4);
	for (let i = 0; i < s.columns; i++) near(s.floorPiles[i], s.floorCellHeight);
	assert.equal(s.ledger.length, entries + 1);
	assert.equal(s.ledger.at(-1).type, 'grader');
	p.createWorld();
	assert.equal(c.state.graderBot.active, false);
});

test('the inactive grader remains drawn in its low garage and the active bot lifts a wheel', () => {
	const w = p.createWorld();
	const arcs = [];
	const context = { beginPath() {}, arc(x, y, radius) { arcs.push({ x, y, radius }); }, closePath() {}, fill() {} };
	c.drawGraderBot(context);
	near(arcs[0].x, p.config.width);
	near(arcs[0].radius, 0.7);
	w.platform.x = p.platformMin();
	assert.ok(c.hireGrader(w));
	c.state.graderBot.x = 12;
	near(c.botSurfaceAt(12), 0.12);
	near(c.botSurfaceAt(11), 0);
	assert.ok(p.platformBaseAt(12 - p.config.platformWheelHalfSpan, 0) > 0.1);
	near(p.platformBaseAt(12, 0), 0);
	p.createWorld();
	assert.equal(c.state.graderBot.active, false);
});

test('tier II extends piston bounces without changing first-contact intercept or live world', () => {
	const w = p.createWorld();
	w.platform.x = 12;
	w.ball.x = 13; w.ball.y = 4; w.ball.vx = 0; w.ball.vy = -1;
	const first = prediction.predict(w);
	const endX = first.endX, time = first.time, kind = first.kind, count = first.samples;
	r.grant('ballistics', w); r.grant('ballistics2', w);
	const worldBefore = JSON.stringify(w);
	const floorBefore = Array.from(c.state.floorPiles);
	const extended = prediction.predict(w);
	assert.ok(extended.samples > count * 2);
	near(extended.endX, endX);
	near(extended.time, time);
	assert.equal(extended.kind, kind);
	assert.equal(JSON.stringify(w), worldBefore);
	assert.deepEqual(Array.from(c.state.floorPiles), floorBefore);
	for (let i = 0; i < extended.samples; i++) assert.ok(Number.isFinite(extended.pathX[i]) && Number.isFinite(extended.pathY[i]));
});

test('tier II follows a rock rebound to ground without mining the live rock', () => {
	const w = p.createWorld();
	w.ball.x = 13; w.ball.y = 12; w.ball.vx = 1; w.ball.vy = 5;
	const first = prediction.predict(w);
	assert.equal(first.kind, prediction.kinds.ROCK);
	const samples = first.samples;
	r.grant('ballistics2', w);
	const extracted = c.state.extractedCells;
	const before = JSON.stringify(w);
	const path = prediction.predict(w);
	assert.ok(path.samples > samples * 2);
	assert.ok(path.pathY[path.samples - 1] < 1, 'forecast descends after the rock bounce');
	assert.equal(c.state.extractedCells, extracted);
	assert.equal(JSON.stringify(w), before);
});
