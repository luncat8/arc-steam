'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ceiling, physics, prediction, c, near, balanced, sync } = require('./harness.cjs');

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
