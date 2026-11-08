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
const prediction = harness.prediction;
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

test('a deck pulse lifts a shared ball, not only one it owns', () => {
	const world = fresh('shared1');
	const rival = players.state.rivals[0];
	const ball = world.balls[0];
	// A shared ball is pushable by either platform, so the competitor's drive is
	// part of the game for it too: only the ledger booking differs. The rig is
	// parked away, because it may push this ball as well.
	world.platform.x = 2;
	rival.bot = false;
	rival.x = 12;
	rival.vx = 0;
	players.update(world, c.step);
	function drop(armed) {
		ball.state = 'flying';
		ball.holder = null;
		ball.x = rival.x;
		ball.y = rival.y + c.deck + c.radius + 0.4;
		ball.vx = 0;
		ball.vy = -2;
		world.initialEnergy = physics.totalEnergy(world);
		rival.drive = armed;
		let peak = -Infinity;
		for (let i = 0; i < 240; i++) {
			physics.step(world, c.step);
			if (ball.vy > peak) peak = ball.vy;
		}
		return peak;
	}
	const passive = drop(false);
	const boosted = drop(true);
	assert.ok(passive > 0, 'the deck returns the ball on retention alone');
	assert.ok(boosted > passive + 1, 'the drive adds its pulse to a shared ball');
	// The gain is real energy from outside the rig, and it is booked as such.
	near(balance(world), 0, 1e-6);
});

test('a competitor catches, reflects and releases with its own machinery', () => {
	const world = fresh('each');
	const rival = players.state.rivals[0];
	const ball = world.balls.find(b => b.owner === rival.id);
	rival.bot = false;
	rival.manual = 0;
	rival.x = 12;
	rival.drive = true;
	// The reflector span bounces the ball off its own tilt.
	players.setPistonAngleOf(rival, c.pistonMaxAngle);
	ball.x = rival.x + c.pistonCentre;
	ball.y = rival.y + c.deck + 1.2;
	ball.vx = 0;
	ball.vy = 0;
	ball.state = 'flying';
	ball.holder = null;
	let peak = 0;
	for (let i = 0; i < 240; i++) {
		players.update(world, c.step);
		physics.step(world, c.step);
		if (ball.vy > peak) peak = ball.vy;
	}
	assert.ok(peak > 0.5, 'the reflector returns the ball');
	// The collector span catches into the competitor's own hopper.
	ball.state = 'flying';
	ball.holder = null;
	ball.x = rival.x - c.platformWidth * 0.5 + c.platformWidth * c.collectorFraction * 0.5;
	ball.y = rival.y + c.deck + c.radius + 0.3;
	ball.vx = 0;
	ball.vy = -2;
	players.setPistonAngleOf(rival, 0);
	for (let i = 0; i < 240 && ball.state !== 'held'; i++) {
		players.update(world, c.step);
		physics.step(world, c.step);
	}
	assert.equal(ball.state, 'held', 'the competitor collector catches the ball');
	assert.equal(ball.holder, rival.id, 'the catch belongs to the competitor');
	// Its own release sends the ball off its tilted face.
	assert.equal(physics.canLaunch(world, ball), true, 'a driven competitor can release what it holds');
	assert.equal(physics.launch(world, ball, rival), true);
	assert.equal(ball.state, 'flying');
	assert.ok(ball.vy > 0);
	// Grounded under the competitor, its drive scoops the ball back up.
	ball.state = 'grounded';
	ball.holder = null;
	ball.x = rival.x;
	ball.y = c.radius;
	ball.vx = 0;
	ball.vy = 0;
	rival.drive = true;
	players.update(world, c.step);
	physics.step(world, c.step);
	assert.equal(ball.state, 'flying', 'a grounded ball is scooped');
	assert.ok(ball.vy > 0);
	// With the drive off nothing lifts it; the policy is what arms the drive.
	ball.state = 'grounded';
	ball.holder = null;
	ball.x = rival.x;
	ball.y = c.radius;
	ball.vx = 0;
	ball.vy = 0;
	rival.drive = false;
	physics.step(world, c.step);
	assert.equal(ball.state, 'grounded', 'the drive is what lifts it');
});

test('a competitor ball mines the ceiling and the competitor banks the rubble', () => {
	const world = fresh('each');
	const rival = players.state.rivals[0];
	const ball = world.balls.find(b => b.owner === rival.id);
	const before = ceiling.state.extractedCells;
	// The current tree is a multi-shift investment; wait for the first affordable
	// upgrade instead of assuming one 90-second rally funds the old first node.
	for (let i = 0; i < 240 * 360 && rival.spent === 0; i++) {
		players.update(world, c.step); physics.step(world, c.step);
	}
	assert.ok(ceiling.state.extractedCells > before, 'the competitor ball broke rock');
	assert.ok(rival.soldValue > 0, 'the competitor harvested the rubble and sold it');
	assert.ok(rival.spent > 0, 'the working bot reinvested its own sale proceeds');
	near(rival.soldValue, rival.money + rival.spent, 1e-9, 'sale proceeds are either saved or invested by the competitor');
	assert.equal(ceiling.state.funds, 0, 'none of it reached the rig');
	assert.ok(ball.state === 'flying' || ball.state === 'grounded');
	near(balance(world), 0, 1e-6);
});

test('a competitor plays a shared ball on the floor instead of walking past it', () => {
	const world = fresh('shared1');
	const rival = players.state.rivals[0];
	const ball = world.balls[0];
	// The ball lies on the floor in front of the competitor, which used to sweep
	// straight over it: it could only see a ball it owned.
	ball.state = 'grounded';
	ball.x = 10;
	ball.y = c.radius + ceiling.floorAt(10);
	ball.vx = 0;
	ball.vy = 0;
	rival.x = 19;
	rival.vx = 0;
	players.setBot(1, true);
	world.initialEnergy = physics.totalEnergy(world);
	players.update(world, c.step);
	assert.ok(Math.abs(rival.mark - 10) < 1e-9, 'the floor ball is its mark');
	let scooped = false;
	let closest = Infinity;
	for (let i = 0; i < 240 * 6 && !scooped; i++) {
		players.update(world, c.step);
		physics.step(world, c.step);
		closest = Math.min(closest, Math.abs(ball.x - rival.x));
		scooped = ball.state === 'flying' && ball.vy > 0 && Math.abs(ball.x - rival.x) < c.platformWidth * 0.5;
	}
	assert.ok(scooped, 'the competitor drove onto the ball and scooped it');
	assert.ok(closest < c.platformWidth * 0.5, 'it went to the ball, not past it');
	// The scoop lifts and pulses the ball with the competitor's own energy, and a
	// shared ball is in the rig's ledger, so the gift is booked rather than lost.
	near(balance(world), 0, 1e-6);
});

test('a competitor keeps a shared ball in play on its own', () => {
	const world = fresh('shared1');
	const rival = players.state.rivals[0];
	const ball = world.balls[0];
	// The rig is parked out of the rally, so this measures the competitor alone.
	world.platform.x = 1;
	rival.x = 19;
	players.setBot(1, true);
	world.initialEnergy = physics.totalEnergy(world);
	let grounded = 0;
	let bounces = 0;
	let previous = ball.vy;
	for (let i = 0; i < 240 * 20; i++) {
		players.update(world, c.step);
		physics.step(world, c.step);
		if (ball.state === 'grounded') grounded++;
		if (previous <= 0 && ball.vy > 0) bounces++;
		previous = ball.vy;
	}
	assert.ok(bounces >= 5, 'the deck returns the ball again and again');
	assert.ok(grounded < 240, 'the ball spends under a second on the floor');
	near(balance(world), 0, 1e-6);
});

test('a competitor plans for the flight it may push, from any height, and for nothing else', () => {
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
	assert.ok(Math.abs(rival.mark - 12) < 2, 'the landing point is the mark');
	const start = rival.x;
	for (let i = 0; i < 240 * 2; i++) players.update(world, c.step);
	assert.ok(rival.x > start + 1, 'the competitor drove toward its ball');
	// A high ball is still its ball: the mark follows the landing, not the
	// height, so there is no altitude at which it stops playing.
	ball.y = 10;
	ball.vy = 3;
	ball.vx = 0;
	ball.state = 'flying';
	rival.x = 4;
	players.update(world, c.step);
	assert.ok(Number.isFinite(rival.mark), 'a ball at the top is still planned for');
	assert.ok(rival.markTime > 1, 'the plan is pinned to the landing time');
	// The rig's ball is never its business, even while that ball is in play.
	const rigBall = world.balls.find(b => b.owner === 'rig');
	rigBall.y = 1.5;
	rigBall.vy = -1;
	rigBall.state = 'flying';
	rigBall.x = 18;
	ball.state = 'held';
	rival.x = 4;
	players.update(world, c.step);
	assert.ok(!Number.isFinite(rival.mark), 'a ball it may not push is not a mark');
	assert.equal(rival.commanded, false, 'and it does not drive after one');
	for (let i = 0; i < 240 * 2; i++) players.update(world, c.step);
	assert.ok(Math.abs(rival.vx) < 0.05, 'it coasts to a stop instead of pacing');
	assert.ok(Math.abs(rival.x - 4) < 1, 'and stays where it was');
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

test('the autopilot keeps a ball in play across a two-ball shift instead of trading both', () => {
	const world = fresh('shared2');
	for (const channel of ['move', 'smart', 'drive', 'angle']) autopilot.set(channel, false);
	autopilot.reset();
	for (const channel of ['move', 'drive', 'angle']) autopilot.set(channel, true);
	let bothDown = 0;
	let worstDown = 0;
	let switches = 0;
	let lastFocus = physics.focusBall(world);
	for (let step = 0; step < Math.round(60 / c.step); step++) {
		autopilot.update(world, c.step);
		const focus = physics.focusBall(world);
		if (focus !== lastFocus) { switches++; lastFocus = focus; }
		physics.step(world, c.step);
		if (world.ball.state === 'held' && world.drive) physics.launch(world);
		let inPlay = false;
		for (const ball of world.balls) if (ball.state !== 'grounded') inPlay = true;
		bothDown = inPlay ? 0 : bothDown + c.step;
		if (bothDown > worstDown) worstDown = bothDown;
	}
	assert.ok(world.bounces >= 10, `the shift keeps bouncing: ${world.bounces} bounces`);
	assert.ok(world.groundings <= 6, `groundings stay bounded: ${world.groundings}`);
	assert.ok(switches <= 10, `the plan is not traded every bounce: ${switches} changes in 60 s`);
	assert.ok(worstDown < 1, `both balls never lie on the floor together for long: ${worstDown.toFixed(2)} s`);
	assert.equal(world.focus, lastFocus, 'the intercept publishes the ball it works as the world hint');
	near(balance(world), 0, 1e-6);
	// Disengaging hands the plain focus rule back instead of keeping a stale ball.
	for (const channel of ['move', 'drive', 'angle']) autopilot.set(channel, false);
	autopilot.update(world, c.step);
	assert.equal(world.focus, null);
	autopilot.reset();
});

test('the intercept hint is honoured only while it is a rig ball in the chamber', () => {
	const world = fresh('each');
	const rigBall = world.balls.find(ball => ball.owner === 'rig');
	const rivalBall = world.balls.find(ball => ball.owner === 'rival-1');
	world.focus = rivalBall;
	assert.equal(physics.focusBall(world), rigBall, 'a ball the rig may not push is not a hint');
	world.focus = { owner: null, x: 1, y: 1, vx: 0, vy: 0, state: 'flying' };
	assert.equal(physics.focusBall(world), rigBall, 'nor is a ball that is not in the chamber');
	// A held ball outranks the hint, because it is the rig's next launch.
	world.focus = world.balls[0] === rigBall ? rivalBall : world.balls[0];
	rigBall.state = 'held';
	assert.equal(physics.focusBall(world), rigBall);
	rigBall.state = 'flying';
	// Re-seating the arrangement drops the hint with the balls it named.
	players.setBallMode('shared2');
	assert.equal(world.focus, null);
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
	rival.drive = false;
	ball.state = 'flying';
	ball.x = rival.x;
	ball.y = rival.y + c.deck + c.radius;
	ball.vx = 0;
	ball.vy = 0;
	world.initialEnergy = physics.totalEnergy(world);
	physics.step(world, c.step);
	assert.ok(ball.vy > 0, 'the rising deck still pushes the ball up');
	// The face under the ball is the reflector, out at pistonCentre, so the pose
	// jump is clamped to the drop rate plus the pitch rate's lever arm there.
	const rise = c.platformDropRate + c.platformPitchRate * c.pistonCentre;
	assert.ok(ball.vy <= (1 + Math.sqrt(c.retention)) * rise + 1e-6, 'never faster than the deck may rise');
	assert.ok(Math.abs(ball.vx) <= 0.35 * (physics.speedNow() + c.platformPitchRate * c.deck) + 1e-6, 'nor carry more than it may move');
	near(balance(world), 0, 1e-6);
});

// One shot at a deck, from the same geometry relative to the machine's own body,
// so the rig and a competitor can be compared impulse for impulse.
function deckShot(machine, tilt, speed) {
	const world = fresh('each');
	const rival = players.state.rivals[0];
	world.drive = false;
	world.platform.x = machine === 'rig' ? 12 : 2;
	world.platform.previousX = world.platform.x;
	world.platform.vx = 0;
	rival.x = machine === 'rig' ? 2 : 12;
	rival.bot = false;
	rival.drive = false;
	rival.vx = 0;
	rival.previousX = rival.x;
	rival.previousY = rival.y;
	rival.previousAngle = rival.angle;
	rival.stepVx = 0;
	rival.stepVy = 0;
	rival.stepOmega = 0;
	if (machine === 'rig') physics.setPistonAngle(world, tilt);
	else rival.pistonAngle = tilt;
	const body = machine === 'rig' ? world.platform : rival;
	const ball = world.balls.find(item => item.owner === (machine === 'rig' ? 'rig' : rival.id));
	ball.owner = null;
	ball.holder = null;
	ball.state = 'flying';
	ball.x = body.x + c.pistonCentre + 0.3;
	ball.y = c.deck + 0.8;
	ball.vx = 0.6;
	ball.vy = -speed;
	let guard = 0;
	while (guard++ < 400 && ball.state === 'flying' && (machine === 'rig' ? world.bounces : rival.bounces) === 0) physics.step(world, c.step);
	return { ball, world, rival, bounces: machine === 'rig' ? world.bounces : rival.bounces };
}

test('either platform reflects a ball off its own reflector face, tilt for tilt', () => {
	for (const tilt of [0, c.pistonMaxAngle, -c.pistonMaxAngle]) {
		const rig = deckShot('rig', tilt, 3);
		const rival = deckShot('rival', tilt, 3);
		assert.equal(rig.bounces, 1, 'the rig reflector answers');
		assert.equal(rival.bounces, 1, 'the competitor reflector answers');
		near(rival.ball.vx, rig.ball.vx, 1e-9);
		near(rival.ball.vy, rig.ball.vy, 1e-9);
	}
	// A raised left edge sends the ball left on either machine, and the other way
	// for a raised right edge: the tilt is the machine's own.
	const left = deckShot('rival', c.pistonMaxAngle, 3);
	const right = deckShot('rival', -c.pistonMaxAngle, 3);
	assert.ok(left.ball.vx < right.ball.vx - 0.5, 'the competitor tilt steers the reflection');
});

test('a ball never passes through either deck, and either collector catches it', () => {
	for (const machine of ['rig', 'rival']) {
		const fast = deckShot(machine, 0.12, 400);
		assert.equal(fast.bounces, 1, machine + ' deck stops a ball at any speed');
		// The collector strip catches on either platform.
		const world = fresh('each');
		const rival = players.state.rivals[0];
		world.drive = false;
		world.platform.x = machine === 'rig' ? 12 : 2;
		world.platform.vx = 0;
		rival.x = machine === 'rig' ? 2 : 12;
		rival.bot = false;
		rival.drive = false;
		rival.vx = 0;
		rival.previousX = rival.x;
		rival.previousY = rival.y;
		rival.previousAngle = rival.angle;
		rival.stepVx = 0;
		rival.stepVy = 0;
		rival.stepOmega = 0;
		const body = machine === 'rig' ? world.platform : rival;
		const ball = world.balls.find(item => item.owner === (machine === 'rig' ? 'rig' : rival.id));
		ball.owner = null;
		ball.holder = null;
		ball.state = 'flying';
		ball.x = body.x - c.platformWidth * 0.5 + c.platformWidth * c.collectorFraction * 0.5;
		ball.y = c.deck + 0.8;
		ball.vx = 0;
		ball.vy = -3;
		for (let guard = 0; guard < 400 && ball.state === 'flying'; guard++) physics.step(world, c.step);
		assert.equal(ball.state, 'held', machine + ' collector catches the ball');
		assert.equal(ball.holder, machine === 'rig' ? 'rig' : rival.id, 'the catch belongs to the machine that made it');
	}
});

test('a caught ball is the platform\'s own, and its release is that machine\'s', () => {
	const world = fresh('shared1');
	const rival = players.state.rivals[0];
	const ball = world.balls[0];
	world.platform.x = 2;
	world.platform.vx = 0;
	world.drive = false;
	rival.x = 12;
	rival.bot = false;
	rival.manual = 0;
	rival.drive = true;
	rival.vx = 0;
	players.update(world, c.step);
	ball.state = 'flying';
	ball.holder = null;
	ball.x = rival.x - c.platformWidth * 0.5 + c.platformWidth * c.collectorFraction * 0.5;
	ball.y = rival.y + c.deck + 0.6;
	ball.vx = 0;
	ball.vy = -2;
	const battery = world.battery;
	for (let guard = 0; guard < 400 && ball.state !== 'held'; guard++) physics.step(world, c.step);
	assert.equal(ball.holder, rival.id, 'the competitor caught a shared ball');
	assert.equal(ball.state, 'held');
	// The competitor may release it; the rig, holding nothing, may not.
	assert.equal(physics.canLaunch(world, ball), true);
	assert.equal(physics.launch(world, ball), true, 'the release finds the platform that holds the ball');
	assert.equal(ball.state, 'flying');
	assert.ok(ball.vy > 0);
	assert.equal(world.battery, battery, 'a competitor release does not spend the rig reserve');
	assert.equal(world.pushes, 0, 'nor count as a rig push');
	assert.equal(rival.pushes, 1);
	// Its collector holds at most one: a second ball is returned, not caught.
	ball.state = 'flying';
	ball.holder = null;
	ball.x = rival.x - 1.2;
	ball.y = rival.y + c.deck + 0.6;
	ball.vx = 0;
	ball.vy = -2;
	for (let guard = 0; guard < 400 && ball.state !== 'held'; guard++) physics.step(world, c.step);
	assert.equal(ball.state, 'held', 'the collector catches again');
	assert.equal(physics.heldBallOf(world, physics.machineById(world, rival.id)), ball);
	assert.equal(physics.heldBallOf(world, physics.machineById(world, 'rig')), null, 'the rig holds nothing');
});

test('the ballistic computer follows the selected platform, and the rig plan cannot replace it', () => {
	const world = fresh('each');
	const rival = players.state.rivals[0];
	const rigBall = world.balls.find(ball => ball.owner === 'rig');
	const rivalBall = world.balls.find(ball => ball.owner === rival.id);
	rival.bot = false;
	rival.manual = 0;
	rival.x = 19;
	rival.vx = 0;
	world.platform.x = 3;
	world.platform.vx = 0;
	world.direction = 0;
	world.target = NaN;
	rigBall.state = 'flying';
	rigBall.x = 8;
	rigBall.y = 5;
	rigBall.vx = 2;
	rigBall.vy = 0;
	rivalBall.state = 'flying';
	rivalBall.x = 12;
	rivalBall.y = 4;
	rivalBall.vx = 1;
	rivalBall.vy = 0;
	// The page is on the rig: the computer describes the rig's ball.
	players.setActive(0);
	prediction.predict(world);
	assert.equal(prediction.platformId, 'rig');
	assert.equal(prediction.ball, rigBall);
	assert.equal(prediction.state.kind, prediction.kinds.GROUND);
	// On the competitor: the same computer describes the competitor's ball and
	// the competitor's machine, which is a different flight.
	players.setActive(1);
	prediction.predict(world);
	const kind = prediction.state.kind;
	const endX = prediction.state.endX;
	assert.equal(prediction.platformId, rival.id);
	assert.equal(prediction.ball, rivalBall, 'the ball this platform may push');
	assert.equal(prediction.state.ghostX, 19, 'the ghost is the selected platform');
	// The rig's own plan runs at the same time and prices the rig's machine; it
	// must not leave its flight on the page's overlay.
	autopilot.set('move', true);
	autopilot.update(world, c.step);
	autopilot.update(world, c.step);
	assert.equal(prediction.platformId, rival.id, 'the rig policy never takes the page computer over');
	assert.equal(prediction.ball, rivalBall);
	assert.equal(prediction.state.kind, kind);
	assert.equal(prediction.state.endX, endX);
	autopilot.reset();
	autopilot.set('move', false);
	players.setActive(0);
});
