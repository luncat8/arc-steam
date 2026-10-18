'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ceiling = require('../js/ceiling.js');
const physics = require('../js/physics.js');
const c = physics.config;

function near(actual, expected, tolerance = 1e-7) {
	assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}
function balanced(world) { near(physics.totalEnergy(world), world.initialEnergy, 1e-6); }
function sync(world) { world.initialEnergy = physics.totalEnergy(world); }
function run(world, seconds) {
	for (let i = 0; i < Math.round(seconds / c.step); i++) physics.step(world, c.step);
}
function prepareCargo(world, count, fragmentVx = 0) {
	for (let x = 1; x < 23 && ceiling.state().extractedCells() < count; x += 2) ceiling.damage(x, 8.2, 10000);
	const state = ceiling.state();
	let prepared = 0;
	for (let i = 0; i < state.active.length && prepared < count; i++) {
		if (!state.active[i]) continue;
		state.debrisX[i] = world.platform.x - 1;
		state.debrisY[i] = 0.701;
		state.debrisVx[i] = fragmentVx;
		state.debrisVy[i] = -1;
		prepared++;
	}
	return prepared;
}

test('analytic free fall is exact across fixed steps', () => {
	const w = physics.createWorld();
	run(w, 0.25);
	near(w.ball.y, 5 - 0.5 * c.gravity * 0.25 ** 2);
	near(w.ball.vy, -c.gravity * 0.25);
	balanced(w);
});

test('passive deck bounce retains 90% normal energy', () => {
	const w = physics.createWorld();
	w.ball.x = 12.8; w.ball.vx = 0; w.ball.y = c.deck + c.radius; w.ball.vy = -5;
	sync(w);
	physics.step(w, c.step);
	near(w.ball.vy + c.gravity * c.step, 5 * Math.sqrt(0.9));
	assert.equal(w.bounces, 1);
	balanced(w);
});

test('collector dissipates all mechanical energy and holds until explicit release', () => {
	const w = physics.createWorld();
	w.ball.x = 10.7; w.ball.y = c.deck + c.radius; w.ball.vy = -5;
	w.drive = true; sync(w);
	physics.step(w, c.step);
	assert.equal(w.ball.state, 'held');
	near(physics.ballEnergy(w.ball), 0);
	run(w, 1);
	assert.equal(w.ball.state, 'held');
	balanced(w);
});

test('ground stops the ball; moving over it recovers it', () => {
	const w = physics.createWorld();
	w.ball.x = 3; w.ball.y = 1; w.ball.vx = 0;
	sync(w); run(w, 1);
	assert.equal(w.ball.state, 'grounded');
	w.target = 3; run(w, 10);
	assert.equal(w.ball.state, 'held');
	balanced(w);
});

test('limited drive takes repeated pushes to reach ceiling height', () => {
	const w = physics.createWorld();
	w.ball.state = 'held'; w.ball.vx = 0; w.ball.vy = 0; w.drive = true;
	sync(w);
	assert.ok(physics.launch(w));
	assert.ok(w.ball.y + w.ball.vy ** 2 / (2 * c.gravity) < c.ceiling - c.radius);
	let maxBeforeThird = 0;
	for (let i = 0; i < 240 * 10 && w.pushes < 3; i++) {
		physics.step(w, c.step);
		maxBeforeThird = Math.max(maxBeforeThird, w.ball.y);
	}
	assert.equal(w.pushes, 3);
	assert.ok(maxBeforeThird < c.ceiling - c.radius);
	assert.ok(w.ball.y + w.ball.vy ** 2 / (2 * c.gravity) > c.ceiling - c.radius);
	run(w, 20);
	balanced(w);
});

test('drive cannot create energy with an empty reserve', () => {
	const w = physics.createWorld();
	w.battery = 0; w.drive = true;
	w.ball.y = c.deck + c.radius; w.ball.vy = -5;
	sync(w); physics.step(w, c.step);
	near(w.lastPush, 0); balanced(w);
	w.ball.state = 'held';
	assert.equal(physics.launch(w), false);
});

test('force limits, braking, and wall stops preserve total accounting', () => {
	const w = physics.createWorld();
	w.ball.state = 'held'; w.direction = 1;
	sync(w); run(w, 0.25);
	near(w.platform.vx, c.force * w.forceSetting / (c.platformMass + c.mass) * 0.25);
	w.direction = -1; run(w, 0.25);
	near(w.platform.vx, 0); balanced(w);
	w.direction = 1; run(w, 60);
	near(w.platform.x, c.width - c.platformWidth / 2);
	assert.ok(w.battery >= 0); balanced(w);
});

test('swept collisions prevent ceiling, wall and deck tunneling', () => {
	const w = physics.createWorld();
	w.ball.x = 23; w.ball.y = 8; w.ball.vx = 400; w.ball.vy = 500;
	sync(w); run(w, 0.25);
	assert.ok(w.ball.x >= c.radius && w.ball.x <= c.width - c.radius);
	assert.ok(w.ball.y >= c.radius - 1e-9 && w.ball.y <= c.ceiling - c.radius + 1e-9);
	balanced(w);
	const deck = physics.createWorld();
	deck.ball.x = 12.8; deck.ball.vx = 0; deck.ball.y = 1; deck.ball.vy = -1000;
	sync(deck); physics.step(deck, c.step);
	assert.equal(deck.bounces, 1); balanced(deck);
});

test('release inherits platform momentum and preserves horizontal kinetic energy', () => {
	const w = physics.createWorld();
	w.ball.state = 'held'; w.platform.vx = 3; w.drive = true; sync(w);
	const beforeHorizontal = 0.5 * (c.platformMass + c.mass) * w.platform.vx ** 2;
	assert.ok(physics.launch(w));
	near(w.ball.vx, 3);
	near(0.5 * c.platformMass * w.platform.vx ** 2 + 0.5 * c.mass * w.ball.vx ** 2, beforeHorizontal);
	balanced(w);
});

test('moving platform exchanges horizontal momentum with a bouncing ball', () => {
	const w = physics.createWorld();
	w.ball.x = 12.8; w.ball.y = c.deck + c.radius; w.ball.vx = 3; w.ball.vy = -5;
	w.platform.vx = -2; sync(w);
	physics.step(w, c.step);
	assert.notEqual(w.ball.vx, 3);
	assert.notEqual(w.platform.vx, -2);
	balanced(w);
});

test('caught cargo transfers momentum, doubles full-load mass, and remains energy-accounted', () => {
	const w = physics.createWorld();
	assert.equal(prepareCargo(w, 100, 2), 100);
	sync(w);
	physics.step(w, c.step);
	assert.equal(ceiling.state().cargoCells(), 100);
	near(ceiling.state().cargoMass(), c.platformMass);
	assert.ok(w.platform.vx > 0);
	balanced(w);
	w.platform.vx = 0;
	w.direction = 1;
	sync(w);
	run(w, 0.25);
	near(w.platform.vx, c.force * w.forceSetting / (c.platformMass * 2) * 0.25);
	balanced(w);
});

test('touching either sell wall empties cargo without losing mass-energy accounting', () => {
	const w = physics.createWorld();
	assert.equal(prepareCargo(w, 12), 12);
	physics.step(w, c.step);
	assert.equal(ceiling.state().cargoCells(), 12);
	w.platform.x = physics.platformMin();
	sync(w);
	physics.step(w, c.step);
	assert.equal(ceiling.state().cargoCells(), 0);
	assert.equal(w.sales, 1);
	assert.ok(ceiling.state().funds() > 0);
	assert.equal(ceiling.state().ledger.length, 1);
	balanced(w);
	const v = physics.createWorld();
	const state = ceiling.state();
	for (let x = 1; x < 23 && state.extractedCells() < 8; x += 2) ceiling.damage(x, 8.2, 10000);
	let prepared = 0;
	for (let i = 0; i < state.active.length && prepared < 8; i++) {
		if (!state.active[i]) continue;
		state.debrisX[i] = v.platform.x - 1;
		state.debrisY[i] = 0.701;
		state.debrisVx[i] = 0;
		state.debrisVy[i] = -1;
		prepared++;
	}
	physics.step(v, c.step);
	assert.equal(ceiling.state().cargoCells(), 8);
	v.platform.x = physics.platformMax();
	sync(v);
	physics.step(v, c.step);
	assert.equal(ceiling.state().cargoCells(), 0);
	assert.equal(v.sales, 1);
	balanced(v);
});

test('left pocket lets the reflector cover the wall and the wedge defends it', () => {
	const w = physics.createWorld();
	near(physics.platformMin(), c.platformWidth * 0.5 - c.pocketDepth);
	w.platform.x = physics.platformMin();
	const collectorEdge = w.platform.x - c.platformWidth * 0.5 + c.platformWidth * c.collectorFraction;
	near(collectorEdge, 0, 1e-9);
	// A ball above the docked reflector bounces instead of being captured.
	w.ball.x = 1.5; w.ball.vx = 0; w.ball.y = c.deck + c.radius; w.ball.vy = -5;
	w.ball.state = 'flying';
	sync(w);
	physics.step(w, c.step);
	assert.equal(w.bounces, 1);
	assert.equal(w.ball.state, 'flying');
	balanced(w);
	// Driving left docks into the pocket rather than stopping at the old limit.
	const docked = physics.createWorld();
	docked.ball.state = 'held';
	docked.direction = -1;
	sync(docked);
	run(docked, 30);
	near(docked.platform.x, physics.platformMin());
	balanced(docked);
});

test('wedge slope deflects a wall-side fall toward the reflector', () => {
	const w = physics.createWorld();
	w.platform.x = 12;
	w.ball.x = 0.3; w.ball.vx = 0; w.ball.y = 3; w.ball.vy = 0;
	w.ball.state = 'flying';
	sync(w);
	let deflected = false;
	for (let i = 0; i < Math.round(3 / c.step); i++) {
		physics.step(w, c.step);
		if (w.ball.vx > 1 && w.ball.x > 0.5) { deflected = true; break; }
		if (w.ball.state !== 'flying') break;
	}
	assert.ok(deflected);
	balanced(w);
});

test('wedge base blocks entry from below without trapping deck bounces', () => {
	const w = physics.createWorld();
	w.platform.x = 12;
	w.ball.x = 0.3; w.ball.vx = 0; w.ball.y = 0.4; w.ball.vy = 5;
	w.ball.state = 'flying';
	sync(w);
	physics.step(w, c.step);
	for (let i = 0; i < Math.round(0.5 / c.step) && w.ball.vy > 0; i++) physics.step(w, c.step);
	assert.ok(w.ball.vy < 0);
	assert.ok(w.ball.y < c.wedgeY1);
	balanced(w);
	// A powered bounce right of the wedge clears it instead of sticking.
	const v = physics.createWorld();
	v.platform.x = physics.platformMin();
	v.ball.x = 1.5; v.ball.vx = 0; v.ball.y = c.deck + c.radius; v.ball.vy = -5;
	v.ball.state = 'flying';
	v.drive = true;
	sync(v);
	physics.step(v, c.step);
	assert.ok(v.ball.vy > 5);
	run(v, 1);
	assert.equal(v.ball.state, 'flying');
	balanced(v);
});

test('replay is deterministic with identical fixed-step commands', () => {
	const a = physics.createWorld(); const b = physics.createWorld();
	a.drive = b.drive = true;
	for (let i = 0; i < 5000; i++) {
		a.direction = b.direction = i % 1000 < 500 ? 1 : -1;
		physics.step(a, c.step); physics.step(b, c.step);
	}
	assert.deepEqual(a, b); balanced(a);
});
