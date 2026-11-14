'use strict';
// Perspective depth scale: one law for the chamber, and the ball obeys it as a
// body — the radius that is drawn is the radius that collides.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ceiling, physics, near, balanced, sync, c } = require('./harness.cjs');
const prediction = require('../js/prediction.js');
const state = ceiling.state;

function restore() { physics.setBallPerspective(true); }

// The rock is cleared after the world is built, so a sample meets only the
// chamber's own walls, floor and roof. (Clearing before createWorld would be
// undone by the reset the world is made with.)
function openChamber() {
	state.strength.fill(0);
}

// A ball rolled at the right wall from high in the rock band, slowly enough
// that it meets the wall before gravity has pulled it out of the band: the gap
// it keeps is its own radius at that height.
function wallContact(flat) {
	physics.setBallPerspective(!flat);
	const world = physics.createWorld();
	openChamber();
	const ball = world.ball;
	ball.state = 'flying';
	ball.x = 23.6;
	ball.y = 14.6;
	ball.vx = 0.5;
	ball.vy = 0;
	for (let i = 0; i < 240; i++) {
		const before = ball.vx;
		physics.step(world, c.step);
		if (before > 0 && ball.vx < 0) return { x: ball.x, y: ball.y, radius: physics.ballRadiusAt(ball.y) };
	}
	throw new Error('the ball never reached the wall');
}

test('the scale is the rock cells own, 1x below the warp and a quarter at the roof', () => {
	physics.setBallPerspective(true);
	for (const y of [0, 3, 8, state.initialBottom]) assert.equal(state.perspectiveScale(y), 1, 'true size at ' + y);
	// The ball follows the cells at every height: a little larger just inside
	// the near edge, a quarter at the roof, and no exception of its own.
	for (const y of [12.6, 13.4, 14.4]) near(state.perspectiveScale(y), state.rockScale(y), 1e-12, 'the same size as the cells at ' + y);
	assert.ok(state.perspectiveScale(12.6) > 1.2, 'the warp stretches just inside its near edge');
	near(state.perspectiveScale(state.top), 0.25, 1e-12, 'the roof keeps a quarter');
	for (let y = 0; y <= state.top; y += 0.05) {
		const scale = state.perspectiveScale(y);
		assert.ok(scale >= state.depthFloorScale - 1e-12 && scale <= 1.25 + 1e-12, 'between the roof quarter and the warp peak at ' + y);
	}
	// Constant size is 1x everywhere, below the warp and above it.
	physics.setBallPerspective(false);
	for (const y of [0, 8, state.initialBottom, 13, state.top]) assert.equal(state.perspectiveScale(y), 1, 'flat at ' + y);
	restore();
	assert.equal(state.depthScale, true);
});

test('depth scale resizes the ball it flies, constant size keeps the classic sphere', () => {
	physics.setBallPerspective(true);
	near(physics.ballRadiusAt(0), c.radius, 1e-12, 'the floor ball is the classic sphere');
	near(physics.ballRadiusAt(state.top), c.radius * 0.25, 1e-12);
	assert.ok(physics.ballRadiusAt(14.5) < c.radius * 0.7, 'a ball high in the band is a smaller body: ' + physics.ballRadiusAt(14.5));
	assert.ok(physics.ballRadiusAt(12.6) > c.radius, 'and a little larger just inside the near edge, like the cells there');
	physics.setBallPerspective(false);
	for (const y of [0, 8, 14.5, state.top]) assert.equal(physics.ballRadiusAt(y), c.radius, 'flat at ' + y);
	assert.equal(physics.config.radius, 0.18, 'the base radius is never rewritten');
	restore();
});

test('the ball collides at the radius the picture gives it, so the setting is real', () => {
	const scaled = wallContact(false);
	const flat = wallContact(true);
	// The wall is solved with the body the ball has where it meets it, so the
	// step ends on its own wall.
	assert.ok(Math.abs(scaled.x - (c.width - scaled.radius)) < 1e-2, 'the small body reaches its own wall');
	assert.ok(Math.abs(flat.x - (c.width - c.radius)) < 1e-2, 'the classic body stops a classic radius short');
	assert.ok(scaled.x > flat.x + 0.02, 'the two settings are two different bodies: ' + scaled.x + ' vs ' + flat.x);
	restore();
});

test('a deck contact is solved at the ball radius at that height', () => {
	const contactAt = flat => {
		physics.setBallPerspective(!flat);
		// A deck face high in the band, met by a ball dropped from above it: the
		// contact is one of the ball's own radii above the face at that height.
		const time = physics.planeContactTime(12, 14.6, 0, -1, 12, 14.3, 0, 0, 0, 0.5, 2);
		assert.ok(Number.isFinite(time), 'the face is met');
		const height = 14.6 - time - 0.5 * c.ballGravity * time * time;
		return { height, radius: physics.ballRadiusAt(height) };
	};
	const scaled = contactAt(false);
	const flat = contactAt(true);
	// A smaller ball gets closer to the face it falls on, so it meets it lower.
	assert.ok(Math.abs(scaled.height - (14.3 + scaled.radius)) < 1e-2, 'the small body rests its own radius off the face: ' + scaled.height);
	near(flat.height, 14.3 + c.radius, 1e-9, 'the classic body keeps a classic gap');
	assert.ok(scaled.height < flat.height - 0.05, 'the two settings are two different bodies');
	restore();
});

test('below the warp both settings fly the same ball: the floor game is untouched', () => {
	// A ball dumped onto the rubble and left to settle, flown twice from the
	// same start: below the warp the law is 1 in either setting.
	const settle = flat => {
		physics.setBallPerspective(!flat);
		const world = physics.createWorld();
		state.floorPiles.fill(0.2);
		ceiling.drawFloor({ fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, save() {}, restore() {}, stroke() {} });
		const ball = world.ball;
		ball.state = 'flying';
		ball.x = 4;
		ball.y = 3;
		ball.vx = 1;
		ball.vy = -1;
		sync(world);
		for (let i = 0; i < 240 * 3; i++) physics.step(world, c.step);
		balanced(world);
		return { x: ball.x, y: ball.y, state: ball.state };
	};
	const scaled = settle(false);
	const flat = settle(true);
	assert.equal(scaled.state, flat.state);
	near(scaled.y, flat.y, 1e-12, 'the same resting height');
	near(scaled.x, flat.x, 1e-12, 'the same resting place');
	assert.equal(physics.ballRadiusAt(0.2), c.radius, 'a ball in the rubble is the classic sphere');
	state.floorPiles.fill(0);
	ceiling.drawFloor({ fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, save() {}, restore() {}, stroke() {} });
	restore();
});

test('the ballistic computer flies the same body the chamber does', () => {
	const forecast = flat => {
		physics.setBallPerspective(!flat);
		const world = physics.createWorld();
		const ball = world.ball;
		ball.state = 'flying';
		ball.x = 20;
		ball.y = 14.5;
		ball.vx = 400;
		ball.vy = 0;
		openChamber();
		sync(world);
		const path = prediction.predict(world, ball, 'rig');
		assert.ok(path.samples > 1, 'the flight is drawn');
		// The deepest point of the drawn flight is the wall it met.
		let reached = path.pathX[0];
		for (let i = 1; i < path.samples; i++) if (path.pathX[i] > reached) reached = path.pathX[i];
		return reached;
	};
	const scaled = forecast(false);
	const flat = forecast(true);
	// The drawn flight ends on the wall its own body meets: past the classic
	// wall, never through the small body's.
	assert.ok(scaled > c.width - c.radius, 'the forecast reaches closer than a classic ball');
	assert.ok(scaled <= c.width - c.radius * 0.5, 'and no further than a small one: ' + scaled);
	near(flat, c.width - c.radius, 1e-2, 'at Constant size the classic wall');
	restore();
});
