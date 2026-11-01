'use strict';
// Ball arrangements: one shared ball, two shared balls, one per platform, and
// the ownership rule that decides which platform may push which ball.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const harness = require('./harness.cjs');
const physics = harness.physics;
const ceiling = harness.ceiling;
const players = require('../js/players.js');
const autopilot = require('../js/autopilot.js');
const c = physics.config;

function fresh(mode) {
	const world = physics.createWorld();
	players.init(world, 1);
	players.setBallMode(mode);
	return world;
}

function run(world, seconds, each) {
	for (let i = 0; i < Math.round(seconds / c.step); i++) {
		if (each) each();
		players.update(world, c.step);
		physics.step(world, c.step);
	}
}

function balance(world) {
	return physics.totalEnergy(world) - world.initialEnergy;
}

test('the default is one shared ball that the rig catches and pulses', () => {
	const world = physics.createWorld();
	players.init(world, 1);
	assert.equal(world.ballMode, 'shared1');
	assert.equal(world.balls.length, 1);
	assert.equal(world.balls[0].owner, null);
	assert.equal(physics.mayPush(world.balls[0], 'rig'), true);
	assert.equal(physics.mayPush(world.balls[0], players.state.rivals[0].id), true);
	assert.equal(world.ball, world.balls[0], 'the rig reads the only ball');
	// The rig still catches it.
	const platform = world.platform;
	world.balls[0].x = platform.x;
	world.balls[0].y = c.radius;
	world.balls[0].vx = 0;
	world.balls[0].vy = 0;
	world.balls[0].state = 'grounded';
	world.initialEnergy = physics.totalEnergy(world);
	physics.step(world, c.step);
	assert.equal(world.balls[0].state, 'held');
	assert.ok(Math.abs(physics.totalEnergy(world) - world.initialEnergy) < 1e-6, 'the catch stays exact');
});

test('two shared balls are both pushable and both in the rig ledger', () => {
	const world = fresh('shared2');
	assert.equal(world.ballMode, 'shared2');
	assert.equal(world.balls.length, 2);
	for (const ball of world.balls) assert.equal(ball.owner, null);
	// Both are rig balls, so both carry energy into the ledger.
	const before = physics.totalEnergy(world);
	world.balls[1].vy = 3;
	assert.ok(physics.totalEnergy(world) > before, 'the second ball is part of the balance');
	world.initialEnergy = physics.totalEnergy(world);
	run(world, 20);
	near(balance(world), 0, 1e-6);
});

function near(actual, expected, tolerance) {
	assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

test('one ball per platform: ownership decides who may push what', () => {
	const world = fresh('each');
	const rival = players.state.rivals[0];
	assert.equal(world.balls.length, 2);
	const rigBall = world.balls.find(ball => ball.owner === 'rig');
	const rivalBall = world.balls.find(ball => ball.owner === rival.id);
	assert.ok(rigBall && rivalBall, 'each platform has its own ball');
	assert.equal(physics.mayPush(rigBall, 'rig'), true);
	assert.equal(physics.mayPush(rigBall, rival.id), false);
	assert.equal(physics.mayPush(rivalBall, rival.id), true);
	assert.equal(physics.mayPush(rivalBall, 'rig'), false);
	// The rig reads its own ball, never the competitor's.
	assert.equal(world.ball.owner, 'rig');
	// And the competitor's ball is outside the rig's ledger.
	const before = balance(world);
	rivalBall.vy = -6;
	near(balance(world), before, 1e-9);
});

test('the rig cannot catch or bounce a competitor ball, and vice versa', () => {
	const world = fresh('each');
	const rival = players.state.rivals[0];
	const rivalBall = world.balls.find(ball => ball.owner === rival.id);
	// Park the rival far away, then drop its ball onto the rig's collector.
	rival.x = 22;
	rival.bot = false;
	rival.ballTarget = NaN;
	world.platform.x = 6;
	rivalBall.x = world.platform.x - 1.0;
	rivalBall.y = c.deck + 0.5;
	rivalBall.vx = 0;
	rivalBall.vy = -1;
	rivalBall.state = 'flying';
	for (let i = 0; i < 240; i++) physics.step(world, c.step);
	assert.notEqual(rivalBall.state, 'held', 'the rig never holds a ball it does not own');
	// The rig's own ball dropped on the rival's deck is not returned by it.
	const rigBall = world.balls.find(ball => ball.owner === 'rig');
	world.platform.x = 6;
	rigBall.x = rival.x;
	rigBall.y = rival.y + c.deck + 1.5;
	rigBall.vx = 0;
	rigBall.vy = 0;
	rigBall.state = 'flying';
	const rivalVy = [];
	for (let i = 0; i < 240 * 2; i++) {
		physics.step(world, c.step);
		rivalVy.push(rigBall.vy);
	}
	// Never deflected upwards by a deck it may not touch: gravity only.
	assert.ok(Math.max(...rivalVy) <= 1e-9, 'the competitor deck does not bounce the rig ball');
});

test('a competitor ball bounces off its deck, takes pulses and is scooped when grounded', () => {
	const world = fresh('each');
	const rival = players.state.rivals[0];
	const ball = world.balls.find(b => b.owner === rival.id);
	rival.bot = false;
	rival.manual = 0;
	rival.ballTarget = NaN;
	rival.x = 12;
	rival.vx = 0;
	rival.pulse = true;
	// Drop it onto the deck: it returns upward.
	ball.x = 12;
	ball.y = rival.y + c.deck + 1.2;
	ball.vx = 0;
	ball.vy = 0;
	ball.state = 'flying';
	let peak = 0;
	for (let i = 0; i < 240; i++) {
		players.update(world, c.step);
		rival.pulse = true;
		physics.step(world, c.step);
		if (ball.vy > peak) peak = ball.vy;
	}
	assert.ok(peak > 0.5, 'the deck returns the ball');
	// Grounded under the competitor, the pulse lifts it again.
	ball.state = 'grounded';
	ball.x = rival.x;
	ball.y = c.radius;
	ball.vx = 0;
	ball.vy = 0;
	rival.pulse = true;
	players.update(world, c.step);
	physics.step(world, c.step);
	assert.equal(ball.state, 'flying', 'a grounded ball is scooped');
	assert.ok(ball.vy > 0);
	// With the pulse off, nothing lifts it. The policy is what turns the pulse
	// back on, so this steps the physics alone with the body held still.
	ball.state = 'grounded';
	ball.x = rival.x;
	ball.y = c.radius;
	ball.vx = 0;
	ball.vy = 0;
	rival.pulse = false;
	physics.step(world, c.step);
	assert.equal(ball.state, 'grounded', 'the pulse is what lifts it');
});

test('a competitor ball mines the ceiling and the competitor banks the rubble', () => {
	const world = fresh('each');
	const rival = players.state.rivals[0];
	const ball = world.balls.find(b => b.owner === rival.id);
	const before = ceiling.state.extractedCells;
	run(world, 90);
	assert.ok(ceiling.state.extractedCells > before, 'the competitor ball broke rock');
	assert.ok(rival.money > 0, 'the competitor harvested the rubble and sold it');
	assert.equal(ceiling.state.funds, 0, 'none of it reached the rig');
	assert.ok(ball.state === 'flying' || ball.state === 'grounded');
	near(balance(world), 0, 1e-6);
});

test('the competitor comes back under its own ball but never chases the rig ball', () => {
	const world = fresh('each');
	const rival = players.state.rivals[0];
	const ball = world.balls.find(b => b.owner === rival.id);
	rival.x = 4;
	rival.vx = 0;
	// A ball landing soon to its right pulls it across.
	ball.x = 12;
	ball.y = 2;
	ball.vx = 0;
	ball.vy = -2;
	ball.state = 'flying';
	players.update(world, c.step);
	assert.ok(Math.abs(rival.ballTarget - 12) < 2, 'the landing point is the target');
	const start = rival.x;
	for (let i = 0; i < 240 * 2; i++) players.update(world, c.step);
	assert.ok(rival.x > start + 1, 'the competitor drove toward its ball');
	// A high ball is not a chase: it keeps sweeping the floor meanwhile.
	ball.y = 10;
	ball.vy = 3;
	ball.state = 'flying';
	rival.x = 4;
	players.update(world, c.step);
	assert.ok(!Number.isFinite(rival.ballTarget), 'a ball at the top is not chased');
	// And the rig's ball is never its business.
	const rigBall = world.balls.find(b => b.owner === 'rig');
	rigBall.y = 1.5;
	rigBall.vy = -1;
	rigBall.state = 'flying';
	rigBall.x = 18;
	rival.x = 4;
	players.update(world, c.step);
	assert.ok(!Number.isFinite(rival.ballTarget));
});

test('the autopilot plans for the rig ball that lands sooner', () => {
	const world = fresh('shared2');
	const [first, second] = world.balls;
	// The first ball is high and rising; the second is about to land.
	first.y = 9;
	first.vy = 4;
	first.x = 6;
	second.y = 3;
	second.vy = -2;
	second.x = 15;
	assert.equal(physics.focusBall(world), second, 'the sooner landing is the focused ball');
	assert.equal(world.ball, second);
	// Holding a ball focuses it, because it is the rig's next launch.
	world.platform.x = second.x;
	second.y = c.radius + ceiling.floorAt(second.x);
	second.vy = 0;
	second.state = 'grounded';
	physics.step(world, c.step);
	assert.equal(second.state, 'held');
	assert.equal(physics.focusBall(world), second);
	// The autopilot's status names the focus ball's flight, not the other one.
	players.setBot(0, true);
	run(world, 0.5);
	assert.ok(Number.isFinite(autopilot.state.contactIn) || autopilot.state.contactIn === 0);
	players.setBot(0, false);
	autopilot.reset();
});

test('changing the arrangement re-seats the balls and keeps the ledger exact', () => {
	const world = fresh('each');
	run(world, 5);
	const before = world.balls.length;
	players.setBallMode('shared2');
	assert.equal(world.ballMode, 'shared2');
	assert.equal(world.balls.length, 2);
	assert.notEqual(world.balls.length, before + 1);
	for (const ball of world.balls) assert.equal(ball.owner, null);
	near(balance(world), 0, 1e-6);
	players.setBallMode('shared1');
	assert.equal(world.balls.length, 1);
	players.setBallMode('each');
	assert.equal(world.balls.length, 2);
	assert.equal(world.ball.owner, 'rig');
	near(balance(world), 0, 1e-6);
	players.setBallMode('nonsense');
	assert.equal(world.ballMode, 'shared1', 'an unknown mode falls back to one shared ball');
});

test('a deck lifted by the terrain cannot fling a ball with a pose jump', () => {
	const world = fresh('each');
	const rival = players.state.rivals[0];
	const ball = world.balls.find(b => b.owner === rival.id);
	rival.bot = false;
	rival.x = 12;
	rival.vx = 0;
	rival.ballTarget = NaN;
	players.update(world, c.step);
	// The terrain under a body is prescribed, so a boulder shoulder can lift it
	// by more in one step than any rate limit allows. That jump must not become
	// surface velocity for the ball, or the contact solve injects unbounded
	// energy and the whole chamber overheats.
	rival.stepVx = 300;
	rival.stepVy = 300;
	rival.stepOmega = 50;
	rival.pulse = false;
	ball.state = 'flying';
	ball.x = rival.x;
	ball.y = rival.y + c.deck + c.radius;
	ball.vx = 0;
	ball.vy = 0;
	world.initialEnergy = physics.totalEnergy(world);
	physics.step(world, c.step);
	assert.ok(ball.vy > 0, 'the rising deck still pushes the ball up');
	assert.ok(ball.vy <= (1 + Math.sqrt(c.retention)) * c.platformDropRate + 1e-6, 'never faster than the deck may rise');
	assert.ok(Math.abs(ball.vx) <= 0.35 * (physics.speedNow() + c.platformPitchRate * c.deck) + 1e-6, 'nor carry more than it may move');
	near(balance(world), 0, 1e-6);
});
