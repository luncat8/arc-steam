'use strict';
// Competitor platforms: one body for every player, the retractable 45° tails,
// the power ranking that decides who rides over whom, the floor harvest and
// both policies (the competitor's ball play and the rig's selling trip).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const harness = require('./harness.cjs');
const physics = harness.physics;
const ceiling = harness.ceiling;
const autopilot = require('../js/autopilot.js');
const players = require('../js/players.js');
const c = physics.config;

function fresh(count = 1) {
	const world = physics.createWorld();
	players.init(world, count);
	return world;
}

function near(actual, expected, tolerance = 1e-6) {
	assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

function fillFloor(height, value) {
	const state = ceiling.state;
	state.floorPiles.fill(height);
	state.floorValues.fill(value);
	ceiling.drawFloor({ fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} });
}

// Stage debris over the collector so a test can fill the rig's hopper without a
// scripted mining shift.
function fillCargo(world, cells) {
	const state = ceiling.state;
	let guard = 0;
	while (state.cargoCells < cells && guard++ < 100) {
		ceiling.damage(12, state.bottom + 0.2, 20);
		for (let i = 0; i < state.active.length; i++) {
			if (!state.active[i]) continue;
			state.debrisX[i] = world.platform.x - 1;
			state.debrisY[i] = 0.701;
			state.debrisVx[i] = 0;
			state.debrisVy[i] = -1;
		}
		physics.step(world, c.step);
	}
	assert.ok(state.cargoCells >= cells, 'the hopper filled');
}

// Hold the rig still at a set gap from a parked competitor and let the plates
// settle, so the deployment can be read as a function of the distance.
function deploymentAt(world, rival, gap) {
	players.setActive(0);
	world.platform.x = rival.x - players.halfWidth * 2 - gap;
	world.platform.vx = 0.5;
	rival.vx = 0;
	rival.bot = false;
	rival.manual = 0;
	rival.target = NaN;
	for (let i = 0; i < 240 * 3; i++) players.update(world, c.step);
	return rival.tailLeft / players.tailAngle;
}

test('every player drives the same platform body, told apart by colour', () => {
	fresh();
	const state = players.state;
	assert.equal(state.players.length, 2);
	const rig = state.players[0];
	const rival = state.players[1];
	assert.equal(rig.kind, 'rig');
	assert.equal(rival.kind, 'rival');
	// Same shape: one half-width, one deck height, one plate length.
	assert.equal(players.halfWidth, c.platformWidth * 0.5);
	near(players.profileAt(rig, 0), players.bodyTop);
	near(players.profileAt(rival, 0), players.bodyTop);
	near(players.profileAt(rig, players.halfWidth), players.bodyTop);
	assert.notEqual(rig.body, rival.body, 'the competitor is drawn dim, not smaller');
	assert.equal(rig.tailLeft, 0);
	assert.equal(rival.tailLeft, 0);
});

test('tails stay folded far apart and open to a 45° plate as they close', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	rival.x = 12;
	// Far apart: no plate at all, so the body is a plain box with a vertical face.
	near(deploymentAt(world, rival, 4), 0);
	near(players.profileAt(rival, -(players.halfWidth + 0.05)), 0, 1e-9);
	// Halfway in, the plate is part-way down: deployment is a function of distance.
	const halfway = deploymentAt(world, rival, (players.tailReach + players.tailFullGap) * 0.5);
	near(halfway, 0.5, 0.02);
	// Touching: fully deployed on the facing side, and the plate is a straight
	// 45° ramp from the deck edge to the floor a body height out.
	near(deploymentAt(world, rival, 0.3), 1, 1e-3);
	assert.equal(rival.tailRight, 0, 'only the facing end opens');
	near(players.profileAt(rival, -(players.halfWidth + 0.3)), players.bodyTop * 0.5, 1e-5);
	near(players.profileAt(rival, -(players.halfWidth + players.tailPlate * Math.sin(players.tailAngle))), 0, 1e-5);
});

test('the plate swings at a limited rate instead of snapping open', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	rival.x = 12;
	rival.bot = false;
	world.platform.x = rival.x - players.halfWidth * 2 - 0.3;
	world.platform.vx = 1;
	players.update(world, c.step);
	const afterOneStep = rival.tailLeft;
	assert.ok(afterOneStep > 0, 'the plate starts moving on the first step');
	assert.ok(afterOneStep <= players.tailAngle * 0 + Math.PI / 2 * c.step + 1e-9, 'one step cannot jump the whole angle');
	for (let i = 0; i < 240; i++) players.update(world, c.step);
	near(rival.tailLeft, players.tailAngle, 1e-3);
	// Reversing the approach folds it back, again at the limited rate.
	world.platform.x = rival.x - players.halfWidth * 2 - 4;
	players.update(world, c.step);
	assert.ok(rival.tailLeft > players.tailAngle - Math.PI / 2 * c.step - 1e-9, 'the fold is rate limited too');
	for (let i = 0; i < 240 * 2; i++) players.update(world, c.step);
	near(rival.tailLeft, 0, 1e-9);
});

test('the platform applying more drive power is the one that rides on top', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	rival.x = 12;
	rival.bot = false;
	rival.tailLeft = 0;
	rival.tailRight = 0;
	world.platform.x = 12;
	world.platform.vx = 0;
	// The rig drives at 60%, the competitor coasts: the rig stands on the competitor.
	world.forceSetting = 0.6;
	world.direction = 1;
	world.target = NaN;
	rival.direction = 0;
	rival.target = NaN;
	rival.force = 0.6;
	near(physics.platformBaseAt(12, 0, 'rig'), players.bodyTop, 1e-6);
	near(physics.platformBaseAt(12, 0, rival.id), 0, 1e-6);
	// The competitor raises 80% and drives while the rig coasts: the roles swap.
	world.direction = 0;
	world.target = NaN;
	rival.force = 0.8;
	rival.direction = 1;
	near(physics.platformBaseAt(12, 0, rival.id), players.bodyTop, 1e-6);
	near(physics.platformBaseAt(12, 0, 'rig'), 0, 1e-6);
});

test('a driving competitor with a stronger setting rides over a parked rig', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	rival.x = 16;
	rival.bot = false;
	rival.force = 0.9;
	rival.direction = -1;
	rival.vx = 0;
	world.platform.x = 12;
	world.platform.vx = 0;
	world.direction = 0;
	world.target = NaN;
	let peak = 0;
	for (let i = 0; i < 240 * 4; i++) {
		players.update(world, c.step);
		physics.step(world, c.step);
		if (rival.y > peak) peak = rival.y;
		if (rival.x < 9) break;
	}
	assert.ok(rival.x < 9, 'the competitor drove across the rig');
	assert.ok(peak >= players.bodyTop - 0.02, 'the competitor climbed onto the rig');
	assert.ok(world.platform.y < 0.1, 'the parked rig was not lifted by the body above it');
});

test('the rig rides over a competitor tail instead of stopping at its side', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	rival.x = 12;
	rival.bot = false;
	rival.target = NaN;
	world.platform.x = 7;
	world.platform.y = 0;
	world.platform.vx = 0;
	world.direction = 1;
	world.target = NaN;
	let peak = 0;
	for (let i = 0; i < 240 * 4; i++) {
		players.update(world, c.step);
		physics.step(world, c.step);
		if (world.platform.y > peak) peak = world.platform.y;
		if (world.platform.x > 16) break;
	}
	assert.ok(world.platform.x > 16, 'the rig crossed the competitor');
	assert.ok(peak >= players.bodyTop - 0.02, 'the rig climbed onto the competitor');
	assert.ok(peak < players.bodyTop + 0.1, 'the ride stays a body height, not a wall');
	// The competitor was not lifted: it stays on the floor while the rig passes.
	near(rival.y, 0, 0.02);
});

test('a competitor blade takes floor value into its own load and honours capacity', () => {
	fresh();
	const state = ceiling.state;
	fillFloor(0.2, 12);
	const out = { value: 0, cells: 0 };
	const before = state.floorValues.reduce((total, value) => total + value, 0);
	ceiling.harvest(10, 0.8, 0.05, 100, out);
	const after = state.floorValues.reduce((total, value) => total + value, 0);
	assert.ok(out.cells > 0);
	assert.ok(out.value > 0);
	near(before - after, out.value, 1e-9);
	const column = Math.floor(10 / state.cell);
	near(state.floorPiles[column], 0.15, 1e-9);
	ceiling.harvest(10, 0.8, 0.05, 0.001, out);
	assert.ok(out.cells <= 0.001 + 1e-12, 'the hopper capacity caps the cut');
});

test('the competitor bot holds station when there is nothing it may play', () => {
	const world = fresh();
	// The rig's collector holds the only ball, so the competitor cannot act on
	// anything: it used to pace wall to wall in this state.
	const ball = world.balls[0];
	ball.state = 'held';
	ball.x = world.platform.x - 1.15;
	const rival = players.state.rivals[0];
	rival.x = 4;
	rival.vx = 0;
	players.setActive(1);
	for (let i = 0; i < 240 * 6; i++) players.update(world, c.step);
	assert.ok(!Number.isFinite(rival.mark), 'no mark without a ball in play');
	assert.equal(rival.commanded, false);
	assert.ok(Math.abs(rival.vx) < 0.05, 'the platform is stopped');
	assert.ok(Math.abs(rival.x - 4) < 0.5, 'and it stayed put instead of sweeping');
});

test('the competitor bot banks rubble it drives over at a wall, for its own credits', () => {
	const world = fresh();
	fillFloor(0.18, 10);
	const rival = players.state.rivals[0];
	players.setActive(1);
	for (let i = 0; i < 240 * 16 && rival.money === 0; i++) players.update(world, c.step);
	assert.ok(rival.money > 0, 'the bot reached a wall with a load');
	assert.equal(rival.cargoCells, 0, 'the load was settled');
	near(rival.soldValue, rival.money);
	assert.ok(rival.x <= physics.platformMin() + 0.001 || rival.x >= physics.platformMax() - 0.001, 'the sale happened at a wall');
	assert.equal(ceiling.state.funds, 0, 'the rig was not paid for the competitor sale');
});

test('a full competitor hopper makes its own selling trip and then resumes the ball', () => {
	const world = fresh();
	const state = ceiling.state;
	fillFloor(0.18, 10);
	const rival = players.state.rivals[0];
	rival.bot = true;
	// A load at the limit is what sends the platform to the wall on purpose,
	// exactly like the rig's own selling trip.
	rival.cargoCells = state.storageLimit;
	rival.cargoValue = 40;
	const ball = world.balls[0];
	ball.state = 'grounded';
	ball.x = 20;
	ball.y = c.radius + ceiling.floorAt(20);
	ball.vx = 0;
	ball.vy = 0;
	players.update(world, c.step);
	assert.ok(rival.mark > physics.platformMax(), 'a full hopper aims through the nearer wall');
	for (let i = 0; i < 240 * 12 && rival.money === 0; i++) players.update(world, c.step);
	assert.ok(rival.money > 0, 'the trip sold the load');
	near(rival.soldValue, rival.money);
	// With the hopper empty the ball is the mark again, so the trip is not a
	// one-way exit from the policy.
	for (let i = 0; i < 240 * 2; i++) players.update(world, c.step);
	assert.ok(Number.isFinite(rival.mark) && rival.mark < physics.platformMax(), 'the ball is played again after the sale');
});

test('a manual travel click silences the competitor bot, then its ball policy resumes', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	const ball = world.balls[0];
	ball.state = 'grounded';
	ball.x = 6;
	ball.y = c.radius + ceiling.floorAt(6);
	ball.vx = 0;
	ball.vy = 0;
	players.setActive(1);
	const start = rival.x;
	players.commandTarget(rival.x - 2);
	for (let i = 0; i < 180; i++) players.update(world, c.step);
	assert.ok(rival.x < start - 0.5, 'the manual target steers against the ball mark');
	assert.ok(rival.manual > 0);
	for (let i = 0; i < 240 * 3; i++) players.update(world, c.step);
	assert.ok(Number.isFinite(rival.mark), 'the ball is its mark again after the manual pause');
	assert.ok(rival.x < start - 1, 'and it drove toward it');
});

test('a held direction key outranks the competitor bot until it is released', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	const ball = world.balls[0];
	ball.state = 'grounded';
	ball.x = 6;
	ball.y = c.radius + ceiling.floorAt(6);
	ball.vx = 0;
	ball.vy = 0;
	rival.x = 12;
	rival.vx = 0;
	players.setActive(1);
	players.command(1);
	for (let i = 0; i < 240 * 1.5; i++) players.update(world, c.step);
	assert.ok(rival.vx > 0, 'the held key still steers after the manual window');
	assert.ok(rival.x > 13, 'the platform moved right against the ball mark');
	players.command(0);
	for (let i = 0; i < 240 * 3; i++) players.update(world, c.step);
	assert.ok(Number.isFinite(rival.mark) && rival.mark < rival.x, 'the ball policy takes over once the key is released');
	assert.ok(rival.vx < 0, 'and it drives back toward the ball');
});

test('the rig bot engages the autopilot and sells a full hopper at the wall', () => {
	const world = fresh();
	fillCargo(world, 100);
	world.initialEnergy = physics.totalEnergy(world);
	players.setBot(0, true);
	assert.equal(autopilot.state.move, true);
	assert.equal(autopilot.state.drive, true);
	assert.equal(autopilot.state.angle, true);
	assert.equal(players.state.rig.bot, true);
	let sold = 0;
	for (let i = 0; i < 240 * 12 && !sold; i++) {
		autopilot.update(world, c.step);
		players.update(world, c.step);
		physics.step(world, c.step);
		sold = ceiling.state.funds;
	}
	assert.ok(sold > 0, 'the rig sold the load at a wall');
	assert.equal(ceiling.state.cargoCells, 0);
	assert.ok(Math.abs(world.platform.x - physics.platformMax()) < 0.01 || Math.abs(world.platform.x - physics.platformMin()) < 0.01, 'the trip ended at a SELL wall');
	for (let i = 0; i < 10; i++) {
		players.update(world, c.step);
		physics.step(world, c.step);
	}
	assert.equal(players.state.selling, false, 'the trip ends once the hopper is empty');
	near(physics.totalEnergy(world), world.initialEnergy, 1e-6);
	players.setBot(0, false);
	assert.equal(autopilot.state.move, false);
});

test('a command stays with the platform it was given to', () => {
	fresh();
	const rival = players.state.rivals[0];
	assert.equal(players.setActive(1), true);
	players.command(1);
	assert.equal(rival.direction, 1);
	assert.ok(rival.manual > 0);
	// The rig takes the keys: the competitor left behind stands down at once and
	// its own policy is live again, instead of coasting on the old command.
	assert.equal(players.setActive(0), true);
	assert.equal(rival.direction, 0);
	assert.ok(Number.isNaN(rival.target));
	assert.equal(rival.manual, 0);
	// Taking a running competitor's controls does not silence its policy either.
	assert.equal(players.setActive(1), true);
	assert.equal(rival.manual, 0);
});

test('switching players moves the controls and the force setting with them', () => {
	const world = fresh();
	assert.equal(players.setForce(0.6), 0.6);
	near(world.forceSetting, 0.6);
	assert.equal(players.setActive(1), true);
	assert.equal(players.state.active, 1);
	assert.equal(players.rigActive(), false);
	// The force writer addresses the selected player, not the rig behind it.
	assert.equal(players.setForce(0.3), 0.3);
	near(players.force(1), 0.3);
	near(world.forceSetting, 0.6);
	assert.equal(ceiling.state.funds >= 0, true);
	players.command(1);
	assert.ok(players.state.rivals[0].manual > 0);
	assert.equal(players.state.force, 0.3);
	assert.equal(players.setActive(0), true);
	assert.equal(players.rigActive(), true);
	near(players.force(0), 0.6);
	assert.equal(players.setActive(0), false);
});
