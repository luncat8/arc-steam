'use strict';
// Autopilot behaviour, measured against the simulation it commands: the two
// intercepts, the drive keeper's energy band and the tilt keeper's vertical
// bounce, each with the energy ledger checked at the end.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { physics, prediction, ceiling, c, balanced, sync } = require('./harness.cjs');
const autopilot = require('../js/autopilot.js');
const research = require('../js/research.js');
const players = require('../js/players.js');
const all = ['move', 'smart', 'drive', 'angle'];

function engage(...channels) {
	for (const channel of all) autopilot.set(channel, false);
	autopilot.reset();
	for (const channel of channels) autopilot.set(channel, true);
}

// A clean descent onto the reflector, away from the charge pad so every joule the
// run draws is one the autopilot asked for.
function flight(world, ballX, ballY, platformX) {
	world.platform.x = platformX;
	world.platform.vx = 0;
	world.direction = 0;
	world.target = NaN;
	world.pistonAngle = 0;
	world.drive = false;
	world.bounces = 0;
	world.pushes = 0;
	world.groundings = 0;
	world.heat = 0;
	world.cooledEnergy = 0;
	world.battery = c.battery;
	world.importedEnergy = 0;
	world.chargedEnergy = 0;
	world.ball.x = ballX;
	world.ball.y = ballY;
	world.ball.vx = 0;
	world.ball.vy = 0;
	world.ball.state = 'flying';
	sync(world);
	return world;
}

// Steps until the ball has bounced `count` times, running the autopilot the way
// the page does: once per fixed step, before the step.
function untilBounces(world, count, limitSeconds) {
	const measure = { peakSpeed: 0, maxApex: 0, maxAngle: 0, maxSlew: 0, contacts: [], steps: 0, driveOn: 0, downtime: 0 };
	let angle = world.pistonAngle;
	const guard = Math.round((limitSeconds || 20) / c.step);
	while (world.bounces < count && measure.steps < guard) {
		autopilot.update(world, c.step);
		const before = world.bounces;
		physics.step(world, c.step);
		// Keep the ball in play the way the drive keeper releases it, so a run
		// that studies only the pulse policy measures the same span of bounces.
		if (world.ball.state === 'held' && world.drive && physics.canLaunch(world)) physics.launch(world);
		measure.steps++;
		measure.peakSpeed = Math.max(measure.peakSpeed, Math.abs(world.platform.vx));
		measure.maxAngle = Math.max(measure.maxAngle, Math.abs(world.pistonAngle));
		measure.maxSlew = Math.max(measure.maxSlew, Math.abs(world.pistonAngle - angle) / c.step);
		angle = world.pistonAngle;
		if (world.drive) measure.driveOn++;
		if (world.ball.state !== 'flying') measure.downtime++;
		const rise = Math.max(0, world.ball.vy);
		if (world.ball.state === 'flying') measure.maxApex = Math.max(measure.maxApex, world.ball.y + rise * rise / (2 * c.ballGravity));
		if (world.bounces > before && world.ball.state === 'flying') {
			measure.contacts.push({ vx: world.ball.vx, vy: world.ball.vy, angle: world.pistonAngle, platformVx: world.platform.vx, x: world.ball.x });
		}
	}
	return measure;
}

function drawn(world) {
	return c.battery - world.battery + world.importedEnergy;
}

test('both intercepts meet the same mark, and the timed one gets there slower and cheaper', () => {
	const runs = {};
	for (const channel of ['move', 'smart']) {
		const world = flight(physics.createWorld(), 11, 8, 8);
		engage(channel);
		const measure = untilBounces(world, 1, 10);
		runs[channel] = { measure, draw: drawn(world), heat: world.heat, x: world.platform.x, bounces: world.bounces };
		assert.equal(world.bounces, 1, channel + ' reaches the ball instead of letting it ground');
		assert.equal(measure.contacts.length, 1, channel + ' bounced once');
		assert.ok(Math.abs(world.platform.x + c.pistonCentre - measure.contacts[0].x) < c.pistonHalf,
			channel + ' puts the landing on the reflector face');
		balanced(world);
	}
	// The chase rushes and brakes to a standstill; the timed run spends the whole
	// flight time, so its peak speed — and with it the energy and the heat — is a
	// fraction of the chase's for the same intercept.
	assert.ok(runs.smart.measure.peakSpeed < runs.move.measure.peakSpeed * 0.6,
		`timed peak ${runs.smart.measure.peakSpeed.toFixed(2)} m/s against the chase's ${runs.move.measure.peakSpeed.toFixed(2)} m/s`);
	assert.ok(runs.smart.draw < runs.move.draw * 0.6,
		`timed draw ${runs.smart.draw.toFixed(1)} J against the chase's ${runs.move.draw.toFixed(1)} J`);
	assert.ok(runs.smart.heat < runs.move.heat, `timed heat ${runs.smart.heat.toFixed(1)} J against the chase's ${runs.move.heat.toFixed(1)} J`);
});

test('tier II starts a low-speed intercept before rock contact and keeps replanning after a bounce', () => {
	const world = flight(physics.createWorld(), 13, 11.0, 8);
	world.ball.vx = 1;
	world.ball.vy = 5;
	research.grant('ballistics2', world);
	sync(world);
	engage('move');
	autopilot.update(world, c.step);
	const firstPlan = autopilot.state;
	assert.ok(firstPlan.contactIn > 0, 'the landing beyond the rock contact is predicted while the ball is still in flight');
	assert.ok(Number.isFinite(firstPlan.interceptX), 'the contact mark is available before impact');
	// The plan is priced in the policy trace: the page's own overlay is no
	// longer written by the rig's autopilot, even with the rig selected.
	assert.notEqual(prediction.policy.kind, prediction.kinds.ROCK, 'a rock strike is not mistaken for a landing');
	assert.ok(Math.abs(firstPlan.interceptX + c.pistonCentre - prediction.policy.endX) < 1e-9,
		'the automatic face target is the landing marker of the policy forecast');
	assert.ok(Number.isNaN(world.target), 'tier II uses timed movement rather than the full-throttle chase');
	assert.notEqual(world.direction, 0, 'the platform starts moving before the predicted contact');
	const startX = world.platform.x;
	physics.step(world, c.step);
	assert.ok(world.ball.vy > 0, 'movement starts during the ascent, without waiting for the ball to fall');
	assert.ok(world.platform.x > startX);
	let bounced = false;
	for (let i = 0; i < 240 * 4; i++) {
		autopilot.update(world, c.step);
		physics.step(world, c.step);
		if (world.bounces > 0) { bounced = true; break; }
	}
	assert.ok(bounced, 'the real ball reaches a piston bounce after the rock trajectory');
	autopilot.update(world, c.step);
	assert.ok(autopilot.state.contactIn > 0, 'the new trajectory is planned immediately after the bounce');
	const wantedCentre = Math.max(physics.platformMin(), Math.min(physics.platformMax(), prediction.policy.endX - c.pistonCentre));
	assert.ok(Math.abs(autopilot.state.interceptX - wantedCentre) < 1e-9,
		'the post-bounce target follows the plan\'s landing marker up to the travel limit');
	assert.ok(Number.isNaN(world.target), 'the post-bounce intercept remains in low-speed travel mode');
	balanced(world);
});

function tierTwoTrip(rush) {
	const world = flight(physics.createWorld(), 13, 11.0, 8);
	world.ball.vx = 1;
	world.ball.vy = 5;
	research.grant('ballistics2', world);
	sync(world);
	engage('move');
	let peakSpeed = 0;
	let steps = 0;
	while (world.bounces < 2 && steps++ < 240 * 15) {
		autopilot.update(world, c.step);
		if (rush) {
			// Same tier-II marks and deadlines, but replace economical tracking with
			// the platform's full-throttle target follower for the comparison.
			world.target = autopilot.state.interceptX;
			world.direction = 0;
		}
		physics.step(world, c.step);
		peakSpeed = Math.max(peakSpeed, Math.abs(world.platform.vx));
	}
	assert.equal(world.bounces, 2);
	assert.equal(world.groundings, 0);
	balanced(world);
	return { draw: drawn(world), peakSpeed };
}

test('tier II keeps economy travel after bounces instead of buying a rush-and-brake run', () => {
	const economy = tierTwoTrip(false);
	const rush = tierTwoTrip(true);
	assert.ok(economy.peakSpeed < rush.peakSpeed * 0.8,
		`economy peak ${economy.peakSpeed.toFixed(2)} m/s against rush ${rush.peakSpeed.toFixed(2)} m/s`);
	assert.ok(economy.draw < rush.draw * 0.5,
		`economy draw ${economy.draw.toFixed(1)} J against rush ${rush.draw.toFixed(1)} J`);
});

test('the timed intercept rolls through a mark it is already passing instead of stopping on it', () => {
	const world = flight(physics.createWorld(), 11, 8, 8);
	engage('smart');
	// Get the run going, then hold the platform rolling towards the mark at the
	// speed the plan asks for: the controller must leave it alone rather than brake.
	untilBounces(world, 1, 10);
	flight(world, 11, 8, 8);
	autopilot.reset();
	autopilot.update(world, c.step);
	const plan = autopilot.state;
	assert.ok(Number.isFinite(plan.interceptX), 'the descent is predicted');
	assert.ok(plan.contactIn > 1, 'there is a flight to meet');
	world.platform.vx = (plan.interceptX - world.platform.x) / plan.contactIn;
	sync(world);
	const before = world.platform.vx;
	for (let i = 0; i < 12; i++) { autopilot.update(world, c.step); physics.step(world, c.step); }
	assert.equal(world.direction, 0, 'a platform already rolling on time is not commanded again');
	assert.ok(Math.abs(world.platform.vx - before) < 0.05, `rolling is kept, not braked: ${before.toFixed(2)} → ${world.platform.vx.toFixed(2)}`);
	balanced(world);
});

test('the drive keeper holds the ball inside one pulse of the ceiling and switches to do it', () => {
	const world = flight(physics.createWorld(), 8.63, 6, 8);
	world.drive = true;
	engage('move', 'drive', 'angle');
	const measure = untilBounces(world, 25, 120);
	const gain = physics.pulseNow() / (c.ballMass * c.ballGravity);
	const target = c.ceiling - c.radius;
	assert.ok(measure.contacts.length >= 20, 'the ball stays in play');
	assert.ok(measure.driveOn > 0 && measure.driveOn < measure.steps, 'the keeper switches the drive instead of leaving it on');
	assert.ok(measure.maxApex <= target + gain + 0.05,
		`apex ${measure.maxApex.toFixed(2)} m stays within one pulse (${(target + gain).toFixed(2)} m) of the ceiling`);
	assert.ok(measure.maxApex > ceiling.state.bottom - c.radius, 'and it still reaches the rock');
	assert.ok(world.pushes < measure.contacts.length, 'the keeper leaves bounces that already reach the ceiling passive');
	balanced(world);
	// The same ball with the drive simply left on pays for every contact and
	// every release; the pulse band is the ceiling's, but the reserve cost is not.
	const loose = flight(physics.createWorld(), 8.63, 6, 8);
	loose.drive = true;
	engage('move', 'angle');
	const unchecked = untilBounces(loose, 25, 120);
	assert.ok(unchecked.contacts.length >= 20, 'the always-on run stays in play as well');
	assert.ok(loose.pushes > world.pushes,
		`an always-on drive spends ${loose.pushes} pulses against the keeper's ${world.pushes}`);
	balanced(loose);
});

test('the tilt keeper leaves the bounce travelling vertically, inside its range and rate', () => {
	const world = flight(physics.createWorld(), 8.63, 6, 8);
	world.drive = true;
	engage('move', 'drive', 'angle');
	const measure = untilBounces(world, 20, 120);
	assert.ok(measure.contacts.length >= 15, 'the ball stays in play');
	let worst = 0;
	let sum = 0;
	for (const contact of measure.contacts) {
		worst = Math.max(worst, Math.abs(contact.vx));
		sum += Math.abs(contact.vx);
	}
	// The 3.625 m rock layer shifts the ball's descent angle slightly, so one
	// piston bounce can leave a touch more sideways speed than the 2 m layer did.
	assert.ok(worst < 1.5, `the worst bounce leaves at ${worst.toFixed(2)} m/s sideways`);
	assert.ok(sum / measure.contacts.length < 0.35, `bounces leave at ${(sum / measure.contacts.length).toFixed(2)} m/s sideways on average`);
	assert.ok(measure.maxAngle <= c.pistonMaxAngle + 1e-12, 'the tilt never leaves its range');
	assert.ok(measure.maxSlew <= c.pistonSlewRate + 1e-9, `the actuator slews at ${(measure.maxSlew * 180 / Math.PI).toFixed(1)}°/s of ${c.pistonSlewRate * 180 / Math.PI}°/s`);
	balanced(world);
	// Without the keeper the same shift leaves the ball drifting sideways.
	const loose = flight(physics.createWorld(), 8.63, 6, 8);
	loose.drive = true;
	engage('move', 'drive');
	const unchecked = untilBounces(loose, 20, 120);
	let looseWorst = 0;
	for (const contact of unchecked.contacts) looseWorst = Math.max(looseWorst, Math.abs(contact.vx));
	assert.ok(looseWorst > worst, 'a hand-flown tilt is not as square as the keeper');
	balanced(loose);
});

test('the wanted tilt is the zero of the simulation\'s own contact solver', () => {
	// A short descent onto a rolling reflector: the face has to be tilted to stop
	// the platform dragging the ball sideways, and the keeper's answer must be the
	// solver's own zero, not an approximation of it.
	const world = flight(physics.createWorld(), 8.63, 2.5, 8);
	world.drive = true;
	world.platform.vx = 1;
	world.ball.vy = -4;
	sync(world);
	engage('drive', 'angle');
	// One plan refresh, then read the angle the keeper settled on.
	for (let i = 0; i < 6; i++) autopilot.update(world, c.step);
	const path = prediction.predict(world);
	assert.equal(path.surface, prediction.surfaces.PISTON, 'the descent is met by the reflector');
	const wanted = autopilot.state.wantedAngle;
	assert.ok(Math.abs(wanted) <= c.pistonMaxAngle + 1e-12, 'the answer is inside the actuator range');
	const out = physics.contactResult();
	const push = autopilot.state.wantedDrive ? physics.launchCapacity(world) : 0;
	physics.solvePiston(world, path.endVx, path.endVy, wanted, push, out);
	assert.ok(Math.abs(out.vx) < 2e-3, `the solver reflects ${out.vx.toExponential(2)} m/s sideways at ${(wanted * 180 / Math.PI).toFixed(2)}°`);
	// Either side of the answer is worse, which is what makes it the crossing.
	physics.solvePiston(world, path.endVx, path.endVy, wanted - 0.002, push, out);
	const below = out.vx;
	physics.solvePiston(world, path.endVx, path.endVy, wanted + 0.002, push, out);
	assert.ok(below * out.vx < 0, 'the reflection crosses vertical at the wanted tilt');
	balanced(world);

	// Whatever the flight, the answer is the best tilt the actuator has: a fine scan
	// of the same range with the same solver finds nothing better, whether the zero
	// sits inside the range or the keeper had to hold a limit.
	for (const speed of [0, 1, 2, 4, -3]) {
		const rolled = flight(physics.createWorld(), 8.63, 2.5, 8);
		rolled.drive = true;
		rolled.platform.vx = speed;
		rolled.ball.vy = -4;
		sync(rolled);
		engage('drive', 'angle');
		for (let i = 0; i < 6; i++) autopilot.update(rolled, c.step);
		const rolledPath = prediction.predict(rolled);
		if (rolledPath.surface !== prediction.surfaces.PISTON) continue;
		const rollPush = autopilot.state.wantedDrive ? physics.launchCapacity(rolled) : 0;
		physics.solvePiston(rolled, rolledPath.endVx, rolledPath.endVy, autopilot.state.wantedAngle, rollPush, out);
		const chosen = Math.abs(out.vx);
		// The bisection stops at its own last interval (0.005°, some forty times
		// finer than one step of the actuator), so the scan may beat it by that much.
		for (let i = 0; i <= 200; i++) {
			const angle = -c.pistonMaxAngle + 2 * c.pistonMaxAngle * i / 200;
			physics.solvePiston(rolled, rolledPath.endVx, rolledPath.endVy, angle, rollPush, out);
			assert.ok(Math.abs(out.vx) >= chosen - 2e-3,
				`rolling at ${speed} m/s, ${(angle * 180 / Math.PI).toFixed(1)}° reflects ${Math.abs(out.vx).toFixed(4)} m/s sideways against the keeper's ${chosen.toFixed(4)}`);
		}
		balanced(rolled);
	}
});

test('a mark no run can reach is still chased when it is the ball chosen, and a grounded ball is collected', () => {
	const world = flight(physics.createWorld(), 20, 3, 3);
	world.drive = true;
	engage('smart', 'drive', 'angle');
	autopilot.update(world, c.step);
	assert.ok(Number.isFinite(autopilot.state.interceptX), 'a far landing still gives a mark');
	assert.equal(autopilot.state.recovering, true, 'the plan is priced as the pickup it will probably become');
	assert.equal(autopilot.state.reachable, false, 'even the reflector edge cannot be under it in time');
	assert.ok(autopilot.state.contactIn > 0, 'and the run keeps its deadline: the deck can still catch it');
	assert.equal(world.direction, 1, 'the run goes for it at full demand');
	untilBounces(world, 1, 30);
	// Whatever the outcome, a ball that reaches the ground is collected: the mark
	// becomes the ball and the platform stands over it.
	world.ball.state = 'grounded';
	world.ball.vx = 0;
	world.ball.vy = 0;
	world.ball.y = c.radius;
	world.ball.x = 17;
	sync(world);
	for (let i = 0; i < 4; i++) autopilot.update(world, c.step);
	assert.ok(Math.abs(autopilot.state.interceptX - 17) < 1e-9, 'the mark is the grounded ball');
	assert.equal(autopilot.state.contactIn, 0, 'there is no flight left to meet');
	let steps = 0;
	while (world.ball.state !== 'held' && steps++ < 240 * 20) { autopilot.update(world, c.step); physics.step(world, c.step); }
	assert.equal(world.ball.state, 'held', 'the platform collects the ball it could not keep up');
	// The drive keeper sends it back up rather than stalling on a held ball.
	let released = 0;
	while (world.ball.state === 'held' && released++ < 240 * 5) { autopilot.update(world, c.step); physics.step(world, c.step); }
	assert.equal(world.ball.state, 'flying', 'the keeper releases the collected ball');
	balanced(world);
});

// Two shared balls and no competitor policy: the chamber is the rig's own.
function twoBallWorld(nearX, nearY, farX, farY) {
	const world = physics.createWorld();
	physics.setBallMode(world, 'shared2');
	const near = world.balls[0];
	const far = world.balls[1];
	world.platform.x = 12;
	world.platform.vx = 0;
	world.direction = 0;
	world.target = NaN;
	world.pistonAngle = 0;
	world.drive = false;
	world.bounces = 0;
	world.pushes = 0;
	world.groundings = 0;
	near.x = nearX; near.y = nearY; near.vx = 0; near.vy = 0; near.state = 'flying';
	far.x = farX; far.y = farY; far.vx = 0; far.vy = 0; far.state = 'flying';
	sync(world);
	return world;
}

test('a landing out of reach never takes the plan from one the rig can meet', () => {
	// The first ball comes down onto the reflector; the second would land on the
	// floor across the chamber before the platform could cross it. The soonest
	// landing is the one it cannot reach, which is exactly the trap.
	const world = twoBallWorld(12.6, 4, 2.5, 3);
	const [near, far] = world.balls;
	assert.ok(physics.ballLandingTime(far, c.deck) < physics.ballLandingTime(near, c.deck),
		'the unreachable ball is the one landing sooner');
	engage('move');
	autopilot.update(world, c.step);
	assert.equal(physics.focusBall(world), near, 'the ball it can meet is the one it works');
	assert.equal(autopilot.state.focus, near, 'and the plan belongs to it');
	assert.equal(autopilot.state.recovering, false);
	assert.ok(Math.abs(autopilot.state.interceptX + c.pistonCentre - near.x) < 1,
		'the face is put under the landing it can reach');
	let steps = 0;
	while (world.bounces === 0 && steps++ < 240 * 3) {
		autopilot.update(world, c.step);
		physics.step(world, c.step);
	}
	assert.equal(world.bounces, 1, 'the reachable landing is met');
	assert.equal(far.state, 'grounded', 'the unreachable one grounds, as predicted, without a chase');
	balanced(world);
	engage();
});

test('with two shared balls a spare on the floor is worked when no landing can be met', () => {
	// The flight lands far beyond the platform's reach; the spare is on the floor
	// a few metres away. The rig collects the certain ball instead of chasing the
	// one that is already lost.
	const world = twoBallWorld(10, c.radius, 20, 8);
	const [spare, flight] = world.balls;
	world.platform.x = 3;
	spare.state = 'grounded';
	spare.y = c.radius;
	sync(world);
	engage('move');
	autopilot.update(world, c.step);
	assert.equal(physics.focusBall(world), spare, 'the ball on the floor is the one it can still get');
	assert.ok(Math.abs(autopilot.state.interceptX - spare.x) < 1e-9, 'the mark is the ball itself');
	assert.equal(autopilot.state.contactIn, 0, 'there is no flight left to meet');
	assert.equal(autopilot.state.recovering, true);
	let steps = 0;
	while (spare.state !== 'held' && steps++ < 240 * 10) {
		autopilot.update(world, c.step);
		physics.step(world, c.step);
	}
	assert.equal(spare.state, 'held', 'and the rig drives over it');
	balanced(world);
	engage();
});

// Height from which a ball dropped at rest lands on the deck in `seconds`.
function dropHeight(seconds) {
	return c.deck + c.radius + 0.5 * c.ballGravity * seconds * seconds;
}

test('with two shared balls a desperate landing never takes the plan from a keep the rig can stop on', () => {
	// The far ball lands sooner across the chamber: the platform can only
	// cross its mark at full speed, stopped arrival is 2.45 s into a 2.0 s
	// flight. The near ball lands a little later almost where the platform
	// stands, and the rig can stop on it. Either landing can be kept, but
	// rushing the far one spends the near one's flight travelling back —
	// the trap that grounded both.
	const world = twoBallWorld(5, dropHeight(2), 13.5, dropHeight(2.5));
	const [far, near] = world.balls;
	engage('move');
	autopilot.update(world, c.step);
	assert.equal(physics.focusBall(world), near, 'the keep the rig can stop on is the one it works');
	assert.equal(autopilot.state.focus, near);
	assert.equal(autopilot.state.recovering, false);
	assert.ok(Math.abs(autopilot.state.interceptX + c.pistonCentre - near.x) < 1, 'the face is put under the near landing');
	let furthest = world.platform.x;
	let steps = 0;
	while (world.bounces === 0 && steps++ < 240 * 5) {
		autopilot.update(world, c.step);
		physics.step(world, c.step);
		furthest = Math.min(furthest, world.platform.x);
	}
	assert.equal(world.bounces, 1, 'the near landing is met');
	assert.equal(far.state, 'grounded', 'the far ball grounds where it fell, to be collected');
	assert.ok(furthest > 9, `the rig never crossed the chamber for the far ball (got to ${furthest.toFixed(1)} m)`);
	balanced(world);
	engage();
});

test('a long trip to a shared ball a rival is parked on never takes the plan from a near keep', () => {
	// The far ball lands sooner across the chamber and the rig could stop on
	// it, but a rival is already standing on its mark: the run there is a
	// long, contested trip for a fight the rival is set to win. The near
	// ball lands a little later beside the rig, so the plan keeps its energy
	// for that keep and fights for the far ball afterwards.
	const world = twoBallWorld(5, dropHeight(2.2), 13.5, dropHeight(2.5));
	players.init(world, 1);
	players.setBallMode('shared2');
	// setBallMode re-seats the balls, so stage the flights again on the new set.
	const contested = world.balls[0];
	const kept = world.balls[1];
	world.platform.x = 12;
	world.platform.vx = 0;
	const rival = players.state.rivals[0];
	rival.x = 4.4;
	rival.vx = 0;
	rival.bot = false;
	contested.x = 5; contested.y = dropHeight(2.2); contested.vx = 0; contested.vy = 0; contested.state = 'flying';
	kept.x = 13.5; kept.y = dropHeight(2.5); kept.vx = 0; kept.vy = 0; kept.state = 'flying';
	sync(world);
	engage('move');
	autopilot.update(world, c.step);
	assert.equal(physics.focusBall(world), kept, 'the uncontested near keep is the one it works');
	assert.equal(autopilot.state.focus, kept);
	assert.equal(autopilot.state.contested, false, 'the worked ball carries no contest penalty');
	assert.equal(autopilot.state.recovering, false);
	assert.ok(Math.abs(autopilot.state.interceptX + c.pistonCentre - kept.x) < 1, 'the face is put under the near landing');
	balanced(world);
	engage();
	players.init(physics.createWorld(), 0);
});

test('a contested far ball is still worked when there is no near keep to save the energy for', () => {
	// One shared ball, far away, with a rival parked on its mark: contested
	// only ever demotes a ball below an uncontested alternative, so with
	// nothing else to work the rig still goes and fights for it.
	const world = physics.createWorld();
	players.init(world, 1);
	players.setBallMode('shared1');
	world.platform.x = 12;
	world.platform.vx = 0;
	const rival = players.state.rivals[0];
	rival.x = 4.4;
	rival.vx = 0;
	rival.bot = false;
	const ball = world.balls[0];
	ball.x = 5; ball.y = dropHeight(2.6); ball.vx = 0; ball.vy = 0; ball.state = 'flying';
	sync(world);
	engage('move');
	autopilot.update(world, c.step);
	assert.equal(autopilot.state.focus, ball, 'the only ball is still the one it works');
	assert.equal(autopilot.state.contested, true, 'and the plan knows the trip is contested');
	assert.ok(autopilot.state.contest > 1, `the rival head start is priced in (${autopilot.state.contest.toFixed(2)} s)`);
	balanced(world);
	engage();
	players.init(physics.createWorld(), 0);
});

test('with two shared balls a schedule that keeps both landings beats the cheaper single keep', () => {
	// The first landing is the dearer travel, but keeping it still leaves the
	// second reachable from its mark; skipping it for the cheaper second
	// landing would keep one ball where keeping it in order keeps both.
	const world = twoBallWorld(9, dropHeight(2.2), 14, 8);
	const [first, second] = world.balls;
	second.vy = 4;
	sync(world);
	world.drive = true;
	engage('move', 'drive', 'angle');
	autopilot.update(world, c.step);
	assert.equal(physics.focusBall(world), first, 'the earlier landing is worked because the second survives it');
	let steps = 0;
	while (world.bounces < 2 && steps++ < 240 * 6) {
		autopilot.update(world, c.step);
		physics.step(world, c.step);
		if (world.ball.state === 'held' && world.drive) physics.launch(world);
	}
	assert.equal(world.bounces, 2, 'both landings are kept in order');
	assert.equal(world.groundings, 0, 'neither ball touches the floor');
	balanced(world);
	engage();
});

test('the keepers do nothing at all until a channel is engaged', () => {
	const world = flight(physics.createWorld(), 11, 8, 8);
	world.drive = false;
	engage();
	for (let i = 0; i < 240 * 3; i++) { autopilot.update(world, c.step); physics.step(world, c.step); }
	assert.equal(world.direction, 0);
	assert.ok(Number.isNaN(world.target));
	assert.equal(world.pistonAngle, 0);
	assert.equal(world.drive, false, 'the drive stays as the player left it');
	assert.equal(world.ball.state, 'grounded', 'with nothing engaged the ball is nobody\'s business');
	balanced(world);
});

test('manual overrides preserve switches, isolate duties, and resume after idle simulation time', () => {
	const world = flight(physics.createWorld(), 11, 8, 8);
	engage('smart', 'drive', 'angle');
	autopilot.hold('move', true);
	world.direction = -1;
	for (let i = 0; i < 240 * 3; i++) autopilot.update(world, c.step);
	assert.equal(world.direction, -1, 'held travel is never overwritten');
	assert.equal(autopilot.state.smart, true);
	assert.equal(autopilot.suspended('smart'), true, 'both intercept names share the override');
	assert.equal(autopilot.suspended('drive'), false);
	assert.equal(autopilot.suspended('angle'), false);
	autopilot.hold('move', false);
	autopilot.override('drive');
	autopilot.override('angle');
	world.drive = false;
	world.pistonAngle = 0.1;
	world.target = 4;
	for (let i = 0; i < 240; i++) autopilot.update(world, c.step);
	assert.equal(world.drive, false);
	assert.equal(world.pistonAngle, 0.1);
	assert.equal(world.target, 4);
	autopilot.override('angle');
	for (let i = 0; i < 241; i++) autopilot.update(world, c.step);
	assert.equal(autopilot.suspended('move'), false);
	assert.equal(autopilot.suspended('drive'), false);
	assert.equal(autopilot.suspended('angle'), true, 'new input renews only its own grace period');
	assert.ok(Number.isNaN(world.target), 'smart control resumes');
	assert.equal(world.pistonAngle, 0.1);
	for (let i = 0; i < 241; i++) autopilot.update(world, c.step);
	assert.equal(autopilot.suspended('angle'), false);
	assert.notEqual(world.pistonAngle, 0.1, 'automatic tilt resumes');
});

	test('the drive keeper tips a held ball it cannot launch instead of pinning on it', () => {
		const world = physics.createWorld();
		world.ball.state = 'held';
		world.ball.holder = 'rig';
		world.ball.vx = 0;
		world.ball.vy = 0;
		world.platform.vx = 0;
		world.platform.x = 22;
		// Above the thermal cutoff the pulse cannot lift the ball.
		world.heat = (c.thermalCutoff - c.ambientTemperature + 20) * c.heatCapacity;
		world.drive = true;
		sync(world);
		engage('drive');
		// The keeper retries the release every step: above the cutoff it is
		// refused every time, so the ball is tipped off the face without a
		// pulse instead of leaving the machine pinned on it.
		let tipped = false;
		for (let i = 0; i < 240 * 10 && !tipped; i++) {
			autopilot.update(world, c.step);
			physics.step(world, c.step);
			if (world.ball.tipReleased) tipped = true;
		}
		assert.ok(tipped, 'the held ball is tipped off the face');
		assert.equal(world.ball.state, 'grounded');
		assert.equal(world.ball.holder, null);
		balanced(world);
	});

	test('switching off during an override stays off and reset clears held overrides', () => {
	const world = flight(physics.createWorld(), 11, 8, 8);
	engage('move', 'drive', 'angle');
	autopilot.override('drive');
	autopilot.set('drive', false);
	world.drive = false;
	for (let i = 0; i < 240 * 3; i++) autopilot.update(world, c.step);
	assert.equal(autopilot.state.drive, false);
	assert.equal(world.drive, false);
	autopilot.hold('angle', true);
	autopilot.reset();
	assert.equal(autopilot.suspended('angle'), false);
	assert.equal(autopilot.state.angle, true, 'reset preserves the enabled preference');
	autopilot.update(world, c.step);
	assert.equal(autopilot.suspended('angle'), false, 'reset also clears held state');
	engage();
	autopilot.override('move');
	assert.equal(autopilot.suspended('move'), false, 'manual play alone never engages assistance');
});
