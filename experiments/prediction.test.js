'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ceiling, physics, prediction, c, near, balanced, sync } = require('./harness.cjs');
const players = require('../js/players.js');
const autopilot = require('../js/autopilot.js');
const research = require('../js/research.js');

function frozen(world) {
	return JSON.stringify(world);
}

test('the ballistic computer predicts the ground landing the simulation then produces', () => {
	const w = physics.createWorld();
	w.platform.x = 3;
	w.ball.x = 12; w.ball.y = 5; w.ball.vx = 2; w.ball.vy = 0; w.ball.state = 'flying';
	sync(w);
	const before = frozen(w);
	const extracted = ceiling.state.extractedCells;
	const path = prediction.predict(w);
	assert.equal(path.kind, prediction.kinds.GROUND);
	assert.equal(path.uncertain, false);
	const flight = Math.sqrt(2 * (5 - c.radius) / c.ballGravity);
	near(path.time, flight, 1e-9);
	near(path.endX, 12 + 2 * flight, 1e-6);
	near(path.endY, c.radius, 1e-9);
	// Prediction is a read: neither the world nor the rock moves.
	assert.equal(frozen(w), before);
	assert.equal(ceiling.state.extractedCells, extracted);
	let steps = 0;
	while (w.ball.state === 'flying' && steps < 240 * 5) { physics.step(w, c.step); steps++; }
	assert.equal(w.ball.state, 'grounded');
	near(w.ball.x, path.endX, 1e-6);
	assert.ok(w.time >= path.time && w.time < path.time + c.step, 'the fixed step lands within one step of the prediction');
	balanced(w);
	physics.createWorld();
});

test('the prediction follows wall and ceiling reflections with the simulation', () => {
	const w = physics.createWorld();
	w.platform.x = 12;
	w.ball.x = 20; w.ball.y = 3; w.ball.vx = 8; w.ball.vy = 4; w.ball.state = 'flying';
	sync(w);
	const path = prediction.predict(w);
	assert.equal(path.kind, prediction.kinds.GROUND);
	// The wall flips vx without touching vy, so the ground contact keeps the plain
	// ballistic root while the landing x folds the reflection in.
	const wallTime = (c.width - c.radius - 20) / 8;
	const flight = (4 + Math.sqrt(16 + 2 * c.ballGravity * (3 - c.radius))) / c.ballGravity;
	assert.ok(wallTime < flight, 'the wall comes before the ground');
	near(path.time, flight, 1e-9);
	near(path.endX, 20 + 8 * wallTime - 8 * (flight - wallTime), 1e-6);
	let steps = 0;
	while (w.ball.state === 'flying' && steps < 240 * 5) { physics.step(w, c.step); steps++; }
	assert.equal(w.ball.state, 'grounded');
	near(w.ball.x, path.endX, 1e-6);
	assert.ok(w.time >= path.time && w.time < path.time + c.step, `sim ${w.time} vs predicted ${path.time}`);
	balanced(w);
	physics.createWorld();
});

test('a landing on the deck is reported as a reachable intercept with the ghost under it', () => {
	const w = physics.createWorld();
	w.platform.x = 12.4; w.platform.vx = 0;
	w.ball.x = 12.4; w.ball.y = 4; w.ball.vx = 0; w.ball.vy = 0; w.ball.state = 'flying';
	const path = prediction.predict(w);
	assert.equal(path.kind, prediction.kinds.DECK);
	assert.equal(path.uncertain, false);
	assert.equal(path.reachable, true);
	near(path.endY, c.deck + c.radius, 1e-9);
	near(path.time, Math.sqrt(2 * (4 - c.deck - c.radius) / c.ballGravity), 1e-9);
	assert.ok(Math.abs(path.endX - path.ghostX) <= c.platformWidth * 0.5);
	sync(w);
	let steps = 0;
	while (w.bounces === 0 && steps < 240 * 3) { physics.step(w, c.step); steps++; }
	assert.equal(w.bounces, 1, 'the simulation bounces the ball off the reflector');
	near(w.ball.x, path.endX, 1e-6);
	balanced(w);
	physics.createWorld();
});

test('predicted deck contacts and the coasting ghost follow the terrain height', () => {
	const w = physics.createWorld();
	ceiling.state.floorPiles.fill(0.35);
	ceiling.drawFloor({ fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} });
	w.platform.y = 0.35;
	w.platform.previousY = 0.35;
	w.platform.vx = 0;
	w.ball.x = w.platform.x + c.pistonCentre;
	w.ball.y = 4;
	w.ball.vx = 0;
	w.ball.vy = 0;
	w.ball.state = 'flying';
	const path = prediction.predict(w);
	assert.equal(path.kind, prediction.kinds.DECK);
	assert.equal(path.surface, prediction.surfaces.PISTON);
	near(path.endY, 0.35 + c.deck + c.radius, 1e-9);
	near(path.ghostY, 0.35, 1e-9);
	near(path.ghostAngle, 0, 1e-9);
	sync(w);
	let steps = 0;
	while (w.bounces === 0 && steps++ < 240 * 3) physics.step(w, c.step);
	assert.equal(w.bounces, 1, 'live physics uses the same raised deck surface');
	near(w.ball.x, path.endX, 1e-6);
	balanced(w);
	physics.createWorld();
});

test('the path stops at rock and is flagged uncertain instead of promising a rebound', () => {
	const w = physics.createWorld();
	w.platform.x = 3;
	w.ball.x = 12; w.ball.y = ceiling.state.bottom - 0.6; w.ball.vx = 0; w.ball.vy = 3; w.ball.state = 'flying';
	const path = prediction.predict(w);
	assert.equal(path.kind, prediction.kinds.ROCK);
	assert.equal(path.uncertain, true);
	assert.equal(path.reachable, false);
	assert.ok(path.time < 0.5, 'contact comes quickly from just below the layer');
	near(path.endY, ceiling.state.bottom - c.radius, 1e-6);
	sync(w);
	let steps = 0;
	while (w.fractureEnergy === 0 && steps < 240) { physics.step(w, c.step); steps++; }
	assert.ok(w.fractureEnergy > 0, 'the simulation damages the rock at the predicted contact');
	assert.ok(w.time >= path.time && w.time < path.time + c.step, `sim ${w.time} vs predicted ${path.time}`);
	near(w.ball.x, path.endX, 1e-6);
	// The step that damages the rock also carries the rebound away from the
	// underside of the layer, so the simulation finishes just below the contact.
	assert.ok(w.ball.vy < 0, 'the ball rebounds downward from the rock underside');
	assert.ok(Math.abs(w.ball.y - path.endY) < 3 * c.step * Math.abs(w.ball.vy) + 1e-9, 'within one step of rebound travel');
	balanced(w);
	physics.createWorld();
});

test('an unreachable landing is reported with the missing distance', () => {
	const w = physics.createWorld();
	w.platform.x = 2; w.platform.vx = 0;
	w.forceSetting = 0.1;
	w.ball.x = 20; w.ball.y = 3; w.ball.vx = 0; w.ball.vy = 0; w.ball.state = 'flying';
	const path = prediction.predict(w);
	assert.equal(path.kind, prediction.kinds.GROUND);
	assert.equal(path.reachable, false);
	const time = Math.sqrt(2 * (3 - c.radius) / c.ballGravity);
	const acceleration = c.force * 0.1 / physics.platformMass(w);
	const ramp = Math.min(time, c.maxSpeed / acceleration);
	const cover = 0.5 * acceleration * ramp * ramp + c.maxSpeed * (time - ramp);
	near(path.gap, 18 - cover, 1e-9);
	near(path.ghostX, 2, 1e-9);
	w.ball.x = 2.3;
	assert.equal(prediction.predict(w).reachable, true, 'the same platform meets a landing above it');
	physics.createWorld();
});

test('reachability starts from the speed the platform already carries', () => {
	const w = physics.createWorld();
	w.forceSetting = 0.1;
	w.platform.x = 6; w.platform.vx = 0;
	w.ball.x = 20; w.ball.y = 3; w.ball.vx = 0; w.ball.vy = 0; w.ball.state = 'flying';
	assert.equal(prediction.predict(w).reachable, false, 'a parked platform cannot cross the chamber in time');
	// Already rolling towards the mark at its top speed, it covers the same
	// flight without accelerating, which is what the thrust bound has to see.
	w.platform.vx = physics.speedNow();
	const rolling = prediction.predict(w);
	assert.equal(rolling.reachable, true, 'a platform already rolling at the mark meets the landing');
	assert.ok(rolling.gap < 0);
	// Rolling the other way must not be counted as reach.
	w.platform.vx = -physics.speedNow();
	assert.equal(prediction.predict(w).reachable, false, 'speed away from the mark is not speed towards it');
	physics.createWorld();
});

test('a held or grounded ball has no flight to predict', () => {
	const w = physics.createWorld();
	w.ball.state = 'held';
	const path = prediction.predict(w);
	assert.equal(path.kind, prediction.kinds.PARKED);
	assert.equal(path.samples, 0);
	assert.equal(path.reachable, false);
	w.ball.state = 'grounded';
	assert.equal(prediction.predict(w).kind, prediction.kinds.PARKED);
	physics.createWorld();
});

test('prediction is deterministic and stays inside its preallocated buffers', () => {
	const w = physics.createWorld();
	w.platform.x = 3;
	w.ball.x = 12; w.ball.y = 5; w.ball.vx = 2; w.ball.vy = 0; w.ball.state = 'flying';
	const path = prediction.predict(w);
	const count = path.samples;
	const xs = Array.from(path.pathX.subarray(0, count));
	const ys = Array.from(path.pathY.subarray(0, count));
	assert.ok(count > 20, 'the path is sampled finely enough to draw');
	assert.ok(count <= path.pathX.length, 'samples stay inside the buffer');
	const again = prediction.predict(w);
	assert.equal(again.samples, count);
	assert.deepEqual(Array.from(again.pathX.subarray(0, count)), xs);
	assert.deepEqual(Array.from(again.pathY.subarray(0, count)), ys);
	physics.createWorld();
});

test('a deck landing names the surface that meets it and the speed it arrives at', () => {
	const w = physics.createWorld();
	w.platform.x = 12; w.platform.vx = 0;
	// The collector is the left 35% of the platform, so its zone runs from −1.8 m
	// to −0.54 m of the platform centre; the reflector face covers the rest.
	w.ball.x = 12 - c.platformWidth * 0.5 + 0.3; w.ball.y = 3; w.ball.vx = 0; w.ball.vy = 0; w.ball.state = 'flying';
	let path = prediction.predict(w);
	assert.equal(path.kind, prediction.kinds.DECK);
	assert.equal(path.surface, prediction.surfaces.COLLECTOR, 'a landing on the collector is a catch, not a bounce');
	w.ball.x = 12 + c.pistonCentre;
	path = prediction.predict(w);
	assert.equal(path.kind, prediction.kinds.DECK);
	assert.equal(path.surface, prediction.surfaces.PISTON, 'a landing on the reflector is a bounce the keepers can shape');
	// The reported contact speed is the arrival, before any impulse is resolved.
	near(path.endVx, 0, 1e-12);
	near(path.endVy, -Math.sqrt(2 * c.ballGravity * (3 - c.deck - c.radius)), 1e-9);
	near(path.endY, c.deck + c.radius, 1e-9);
	// A landing nobody meets is no platform surface at all.
	w.platform.x = 3;
	path = prediction.predict(w);
	assert.equal(path.kind, prediction.kinds.GROUND);
	assert.equal(path.surface, prediction.surfaces.NONE);
	near(path.endVy, -Math.sqrt(2 * c.ballGravity * (3 - c.radius)), 1e-9);
	physics.createWorld();
});

test('the prediction horizon covers the taller chamber at the slower ball speed', () => {
	const w = physics.createWorld();
	w.platform.x = 12;
	w.ball.x = 3; w.ball.y = c.deck + c.radius;
	w.ball.vx = 0;
	w.ball.vy = Math.sqrt(2 * c.ballGravity * (ceiling.state.bottom - 0.5 - w.ball.y));
	w.ball.state = 'flying';
	sync(w);
	const path = prediction.predict(w);
	assert.equal(path.kind, prediction.kinds.GROUND);
	assert.ok(path.time > 3, 'this round trip exceeded the old horizon');
	assert.ok(path.time < prediction.horizon);
	let steps = 0;
	while (w.ball.state === 'flying' && steps++ < Math.ceil(prediction.horizon / c.step)) physics.step(w, c.step);
	assert.equal(w.ball.state, 'grounded');
	near(w.ball.x, path.endX, 1e-6);
	assert.ok(w.time >= path.time && w.time < path.time + c.step);
	balanced(w);
});

test('the computer describes the selected platform, so both can use it', () => {
	const players = require('../js/players.js');
	const w = physics.createWorld();
	players.init(w, 1);
	players.setBallMode('each');
	const rival = players.state.rivals[0];
	rival.bot = false;
	rival.x = 12;
	rival.vx = 0;
	rival.ballTarget = NaN;
	w.platform.x = 3;
	w.platform.previousX = 3;
	players.update(w, c.step);
	const rivalBall = w.balls.find(ball => ball.owner === rival.id);
	players.setActive(1);
	// The ball is above the competitor's deck, so its own collector strip is the
	// surface the computer has to find — not the rig's, three metres away.
	rivalBall.state = 'flying';
	rivalBall.x = 12 - c.platformWidth * 0.5 + 0.3;
	rivalBall.y = 3;
	rivalBall.vx = 0;
	rivalBall.vy = 0;
	let path = prediction.predict(w);
	assert.equal(prediction.platformId, rival.id);
	assert.equal(prediction.platformRig, false);
	assert.equal(prediction.ball, rivalBall, 'the selected platform owns the drawn flight');
	assert.equal(path.kind, prediction.kinds.DECK);
	assert.equal(path.surface, prediction.surfaces.COLLECTOR);
	near(path.ghostX, 12, 1e-9);
	// Selecting the rig again hands the computer back to the rig's own ball.
	players.setActive(0);
	path = prediction.predict(w);
	assert.equal(prediction.platformId, 'rig');
	assert.equal(prediction.ball, w.ball, 'the rig is described by the rig ball');
	assert.notEqual(path.kind, prediction.kinds.DECK);
	physics.createWorld();
});

test('the predicted reflector bounce is the bounce the simulation gives', () => {
	const players = require('../js/players.js');
	const w = physics.createWorld();
	players.init(w, 1);
	players.setBallMode('each');
	const rival = players.state.rivals[0];
	rival.bot = false;
	rival.x = 12;
	rival.vx = 0;
	rival.ballTarget = NaN;
	rival.pistonAngle = 0.2;
	rival.drive = false;
	w.platform.x = 3;
	w.platform.previousX = 3;
	players.update(w, c.step);
	const ball = w.balls.find(item => item.owner === rival.id);
	players.setActive(1);
	ball.state = 'flying';
	ball.x = rival.x + 0.4;
	ball.y = 4;
	ball.vx = 0;
	ball.vy = 0;
	sync(w);
	const path = prediction.predict(w);
	assert.equal(path.kind, prediction.kinds.DECK);
	assert.equal(path.surface, prediction.surfaces.PISTON);
	// The bounce counter is the rig's machinery, so the competitor's deck is read
	// off the ball itself: it arrives downward and leaves upward.
	let steps = 0;
	let previous = ball.vy;
	while (steps < 240 * 3) {
		physics.step(w, c.step);
		steps++;
		if (ball.vy > 0.1 && previous <= 0.1) break;
		previous = ball.vy;
	}
	assert.ok(ball.vy > 0, 'the competitor deck bounces the ball');
	const contact = steps * c.step;
	assert.ok(contact >= path.time && contact < path.time + 2 * c.step, `sim ${contact} vs predicted ${path.time}`);
	near(ball.x, path.endX, 1e-3);
	// The tilt is the machine's: an angled face sends the ball sideways. The
	// reflector leans with a positive angle, so the normal points left.
	assert.ok(ball.vx < -0.2, 'the competitor tilt steers the bounce');
	balanced(w);
	physics.createWorld();
});

test('the rig plan never replaces the page overlay with the rig selected', () => {
	const w = physics.createWorld();
	players.init(w, 1);
	players.setActive(0);
	w.platform.x = 3; w.platform.vx = 0; w.direction = 0; w.target = NaN;
	w.ball.x = 12; w.ball.y = 5; w.ball.vx = 1; w.ball.vy = 0;
	const page = prediction.predictAll(w);
	const kind = page.kind, endX = page.endX, samples = page.samples, ball = prediction.ball;
	autopilot.set('move', true);
	for (let i = 0; i < 4; i++) autopilot.update(w, c.step);
	assert.equal(prediction.state.kind, kind, 'the drawn flight survives the plan');
	near(prediction.state.endX, endX, 1e-9);
	assert.equal(prediction.state.samples, samples);
	assert.equal(prediction.ball, ball);
	assert.ok(prediction.policy.samples > 1, 'the plan still has a flight of its own');
	assert.equal(prediction.policy.ball, ball, 'it prices the same rig ball, on another trace');
	autopilot.reset();
	autopilot.set('move', false);
	physics.createWorld();
});

test('the computer draws every ball the selected machine may push', () => {
	const w = physics.createWorld();
	players.init(w, 1);
	players.setBallMode('shared2');
	players.setActive(0);
	w.balls[0].x = 8; w.balls[0].y = 5; w.balls[0].vx = 1; w.balls[0].vy = 0;
	w.balls[1].x = 18; w.balls[1].y = 6; w.balls[1].vx = -1; w.balls[1].vy = 0;
	const focus = prediction.predictAll(w);
	assert.equal(prediction.pathCount, 2, 'two shared balls draw two flights');
	assert.equal(prediction.paths[0].ball, focus.ball);
	assert.notEqual(prediction.paths[1].ball, focus.ball);
	assert.ok(prediction.paths[0].samples > 2);
	assert.ok(prediction.paths[1].samples > 2);
	near(prediction.paths[1].pathX[0], prediction.paths[1].ball.x, 1e-9);
	// Owned balls: a competitor draws only its own ball, even when the rig's
	// ball is the only one still flying.
	players.setBallMode('each');
	players.setActive(1);
	const rival = players.state.rivals[0];
	const rivalBall = w.balls.find(ball => ball.owner === rival.id);
	rivalBall.state = 'grounded';
	const owned = prediction.predictAll(w);
	assert.equal(owned.kind, prediction.kinds.PARKED, 'no fallback to the rig\'s flight');
	assert.equal(owned.samples, 0);
	assert.equal(prediction.pathCount, 1, 'the other owner\'s ball is not drawn');
	assert.equal(prediction.platformId, rival.id);
	players.setActive(0);
	players.setBallMode('shared1');
	physics.createWorld();
});

test('a half-energy ground rebound is drawn through the second bounce', () => {
	function scene(mode) {
		const w = physics.createWorld();
		players.init(w, 0);
		players.setBallMode('shared1');
		players.setActive(0);
		physics.setGroundBounce(mode);
		w.platform.x = 3; w.platform.vx = 0; w.direction = 0; w.target = NaN; w.drive = false;
		w.ball.x = 20; w.ball.y = 3; w.ball.vx = 0; w.ball.vy = 0;
		return w;
	}
	function groundContacts(path) {
		let contacts = 0;
		for (let i = 1; i < path.samples; i++) {
			if (path.pathY[i] < c.radius + 0.002 && path.pathY[i - 1] >= c.radius + 0.002) contacts++;
		}
		return contacts;
	}
	const half = scene('half');
	const flight = prediction.predictAll(half);
	assert.equal(flight.kind, prediction.kinds.GROUND);
	assert.equal(groundContacts(flight), 2, 'the drawn flight ends at the second ground contact');
	assert.ok(flight.samples < 400, 'the overlay is not a long speculative chain');
	// The simulation's rebound is the one the forecast continues from.
	sync(half);
	let arriving = 0, leaving = 0;
	for (let i = 0; i < 240 * 4; i++) {
		const before = half.ball.vy;
		physics.step(half, c.step);
		if (before < 0 && half.ball.vy > 0 && half.ball.y < 1) { arriving = before; leaving = half.ball.vy; break; }
	}
	near(leaving / -arriving, Math.sqrt(0.5), 0.01);
	balanced(half);
	// An absorbing ground has only one contact to show, even with tier II.
	const absorb = scene('absorb');
	research.grant('ballistics2', absorb);
	assert.equal(groundContacts(prediction.predictAll(absorb)), 1);
	physics.setGroundBounce('absorb');
	research.reset();
	physics.createWorld();
});

test('a tier-II page path stops at two bounces while the policy forecast runs on', () => {
	const w = physics.createWorld();
	players.init(w, 0);
	players.setBallMode('shared1');
	players.setActive(0);
	research.grant('ballistics2', w);
	w.platform.x = 12; w.platform.vx = 0;
	w.ball.x = 13; w.ball.y = 4; w.ball.vx = 0; w.ball.vy = -1;
	const drawn = prediction.predictAll(w);
	const priced = prediction.predict(w, w.ball, 'rig');
	assert.ok(priced.samples > drawn.samples, 'the autopilot still forecasts past the drawn path');
	assert.equal(drawn.kind, priced.kind, 'both name the same next landing');
	near(drawn.endX, priced.endX, 1e-9);
	assert.ok(drawn.time < prediction.horizon * 2, 'the drawn horizon is short');
	research.reset();
	physics.createWorld();
});

test('a forecast through the tilted reflector lands where the chamber bounces', () => {
	// With tier II the drawn path continues one bounce past the first landing.
	// A tilted face with sideways motion is where the old flat-strip shortcut
	// disagreed with the chamber's impulse solve by most of a metre.
	const w = physics.createWorld();
	physics.setGroundBounce('absorb');
	players.init(w, 0);
	players.setBallMode('shared1');
	players.setActive(0);
	research.grant('ballistics2', w);
	w.platform.x = 3;
	w.platform.vx = 0;
	w.platform.previousX = 3;
	w.platform.previousY = 0;
	w.platform.previousAngle = 0;
	w.pistonAngle = 0.15;
	w.drive = false;
	w.direction = 0;
	w.target = NaN;
	const ball = w.balls[0];
	ball.state = 'flying';
	ball.x = 3.2;
	ball.y = 1.5;
	ball.vx = 1.2;
	ball.vy = 0;
	ball.holder = null;
	sync(w);
	const drawn = prediction.predictAll(w);
	assert.equal(drawn.kind, prediction.kinds.DECK);
	assert.equal(drawn.surface, prediction.surfaces.PISTON);
	const last = drawn.samples - 1;
	let contacts = 0;
	let second = null;
	for (let i = 0; i < 240 * 8 && !second; i++) {
		physics.step(w, c.step);
		const count = w.bounces + w.groundings;
		if (count > contacts) {
			contacts = count;
			if (count === 2) second = { x: ball.x, y: ball.y, time: w.time, vy: ball.vy };
		}
	}
	assert.ok(second, 'the chamber bounces the ball a second time');
	near(drawn.pathX[last], second.x, 0.02);
	near(drawn.pathY[last], second.y, 0.02);
	assert.ok(second.time > drawn.time, 'the drawn path reaches past the first landing');
	// The shortcut the forecast used to take would have sent the ball right.
	const shortcut = { vx: 0, vy: 0 };
	physics.deckBounce(drawn.endVx, drawn.endVy, w.pistonAngle, 0, 0, 0, shortcut);
	const shortcutX = drawn.endX + shortcut.vx * 2 * shortcut.vy / c.ballGravity;
	assert.ok(shortcutX - second.x > 0.2, 'the flat-strip shortcut misses the real second contact');
	balanced(w);
	research.reset();
	physics.createWorld();
});

test('a full collector returns a ball instead of ending the overlay forecast', () => {
	const w = physics.createWorld();
	physics.setGroundBounce('absorb');
	players.init(w, 0);
	players.setBallMode('shared2');
	players.setActive(0);
	research.grant('ballistics2', w);
	w.platform.x = 3;
	w.platform.vx = 0;
	w.platform.previousX = 3;
	w.platform.previousY = 0;
	w.platform.previousAngle = 0;
	w.pistonAngle = 0;
	w.drive = false;
	w.direction = 0;
	w.target = NaN;
	const held = w.balls[0];
	const arriving = w.balls[1];
	held.state = 'held';
	held.holder = 'rig';
	held.x = w.platform.x;
	held.y = c.deck + c.radius;
	held.vx = 0;
	held.vy = 0;
	arriving.state = 'flying';
	arriving.holder = null;
	arriving.x = w.platform.x - c.platformWidth * 0.5 + c.platformWidth * c.collectorFraction * 0.5;
	arriving.y = 2;
	arriving.vx = 0;
	arriving.vy = 0;
	sync(w);
	const primary = prediction.predictAll(w);
	assert.equal(primary.kind, prediction.kinds.PARKED, 'the held ball has no flight');
	assert.equal(prediction.pathCount, 2, 'the arriving ball has its own drawn flight');
	const companion = prediction.paths[1];
	assert.equal(companion.kind, prediction.kinds.DECK);
	assert.ok(companion.samples > 200, 'the flight continues through the returned bounce');
	const last = companion.samples - 1;
	near(companion.pathX[last], arriving.x, 0.02);
	near(companion.pathY[last], c.deck + c.radius, 0.02);
	let bounces = 0;
	for (let i = 0; i < 240 * 8 && bounces < 2; i++) {
		const before = arriving.vy;
		physics.step(w, c.step);
		if (before < 0 && arriving.vy > 0) bounces++;
	}
	assert.equal(bounces, 2, 'the chamber also bounces the ball off the full strip');
	assert.equal(arriving.state, 'flying');
	assert.equal(held.state, 'held');
	balanced(w);
	research.reset();
	physics.createWorld();
});
