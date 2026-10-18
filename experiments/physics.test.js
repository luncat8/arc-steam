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
	for (let x = 1; x < 23 && ceiling.state.extractedCells < count; x += 2) ceiling.damage(x, 8.2, 20);
	const state = ceiling.state;
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

test('ball response is 1.5x slower while platform force and top speed step up', () => {
	const w = physics.createWorld();
	near(c.ballSpeedScale, 1 / 1.5);
	near(c.ballMass * c.ballGravity, c.gravity);
	near(w.ball.vx, 1.2 / 1.5);
	const oldInitialEnergy = 0.5 * 1.2 ** 2 + c.gravity * (w.ball.y - c.radius);
	near(physics.ballEnergy(w.ball), oldInitialEnergy);
	const oldLaunchSpeed = Math.sqrt(2 * (c.pulse - c.gravity * c.deck));
	const newLaunchSpeed = Math.sqrt(2 * (c.pulse - c.ballMass * c.ballGravity * c.deck) / c.ballMass);
	near(newLaunchSpeed, oldLaunchSpeed / 1.5);
	const oldFallTime = Math.sqrt(2 / c.gravity);
	const newFallTime = Math.sqrt(2 / c.ballGravity);
	near(newFallTime, oldFallTime * 1.5);
	// Second 1.5x drive-response step: 270 N -> 400 N and 7 m/s -> 10 m/s,
	// each rounded to a whole number instead of keeping 405 N / 10.5 m/s.
	near(c.force, 400);
	assert.equal(c.maxSpeed, 10);
	assert.ok(Math.abs(c.force / 270 - 1.5) < 0.02, 'force is the rounded 1.5x step');
	assert.ok(Math.abs(c.maxSpeed / 7 - 1.5) < 0.08, 'top speed is the rounded 1.5x step');
	const sprint = physics.createWorld();
	sprint.ball.state = 'held';
	sprint.direction = 1;
	sprint.forceSetting = 1;
	sync(sprint);
	run(sprint, 60);
	near(Math.abs(sprint.platform.vx), 0, 1e-9);
	near(sprint.platform.x, c.width - c.platformWidth / 2);
	balanced(sprint);
	const brake = physics.createWorld();
	brake.ball.state = 'held';
	brake.platform.vx = c.maxSpeed;
	brake.direction = -1;
	brake.forceSetting = 1;
	sync(brake);
	run(brake, 60);
	near(brake.platform.vx, 0, 1e-9);
	balanced(brake);
	physics.createWorld();
});

test('analytic free fall is exact across fixed steps', () => {
	const w = physics.createWorld();
	run(w, 0.25);
	near(w.ball.y, 5 - 0.5 * c.ballGravity * 0.25 ** 2);
	near(w.ball.vy, -c.ballGravity * 0.25);
	balanced(w);
});

test('passive deck bounce retains 90% normal energy', () => {
	const w = physics.createWorld();
	w.ball.x = 12.8; w.ball.vx = 0; w.ball.y = c.deck + c.radius; w.ball.vy = -5;
	sync(w);
	physics.step(w, c.step);
	near(w.ball.vy + c.ballGravity * c.step, 5 * Math.sqrt(0.9));
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
	assert.ok(w.ball.y + w.ball.vy ** 2 / (2 * c.ballGravity) < c.ceiling - c.radius);
	let maxBeforeThird = 0;
	for (let i = 0; i < 240 * 10 && w.pushes < 3; i++) {
		physics.step(w, c.step);
		maxBeforeThird = Math.max(maxBeforeThird, w.ball.y);
	}
	assert.equal(w.pushes, 3);
	assert.ok(maxBeforeThird < c.ceiling - c.radius);
	assert.ok(w.ball.y + w.ball.vy ** 2 / (2 * c.ballGravity) > c.ceiling - c.radius);
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

test('convection and radiation cool the machinery without hiding exported energy', () => {
	const w = physics.createWorld();
	w.heat = c.heatCapacity * 100;
	sync(w);
	const initialHeat = w.heat;
	assert.ok(physics.coolingPower(w) > 0);
	run(w, 1);
	assert.ok(w.heat < initialHeat);
	assert.ok(w.cooledEnergy > 0);
	near(w.heat + w.cooledEnergy, initialHeat, 1e-7);
	near(physics.temperature(w), c.ambientTemperature + w.heat / c.heatCapacity);
	balanced(w);
});

test('overheating linearly derates engine and bounce power, then cuts off', () => {
	const warm = physics.createWorld();
	warm.ball.state = 'held'; warm.ball.vx = 0; warm.ball.vy = 0;
	warm.drive = true; warm.direction = 1;
	warm.heat = c.heatCapacity * ((c.thermalDerateStart + c.thermalCutoff) * 0.5 - c.ambientTemperature);
	sync(warm);
	near(physics.temperature(warm), (c.thermalDerateStart + c.thermalCutoff) * 0.5);
	near(physics.thermalFactor(warm), 0.5);
	physics.step(warm, c.step);
	near(warm.platform.vx, c.force * warm.forceSetting * 0.5 / (c.platformMass + c.ballMass) * c.step, 1e-9);
	balanced(warm);

	const launch = physics.createWorld();
	launch.ball.state = 'held'; launch.ball.vx = 0; launch.ball.vy = 0;
	launch.drive = true;
	launch.heat = c.heatCapacity * ((c.thermalDerateStart + c.thermalCutoff) * 0.5 - c.ambientTemperature);
	sync(launch);
	assert.ok(physics.canLaunch(launch));
	assert.ok(physics.launch(launch));
	near(launch.lastPush, c.pulse * 0.5);
	balanced(launch);

	const cutoff = physics.createWorld();
	cutoff.ball.state = 'held'; cutoff.ball.vx = 0; cutoff.ball.vy = 0;
	cutoff.drive = true;
	cutoff.heat = c.heatCapacity * (c.thermalCutoff - c.ambientTemperature);
	sync(cutoff);
	assert.equal(physics.thermalFactor(cutoff), 0);
	assert.equal(physics.canLaunch(cutoff), false);
	assert.equal(physics.launch(cutoff), false);
	balanced(cutoff);
});

test('force limits, braking, and wall stops preserve total accounting', () => {
	const w = physics.createWorld();
	w.ball.state = 'held'; w.direction = 1;
	sync(w); run(w, 0.25);
	near(w.platform.vx, c.force * w.forceSetting / (c.platformMass + c.ballMass) * 0.25);
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
	const beforeHorizontal = 0.5 * (c.platformMass + c.ballMass) * w.platform.vx ** 2;
	assert.ok(physics.launch(w));
	near(w.ball.vx, 3);
	near(0.5 * c.platformMass * w.platform.vx ** 2 + 0.5 * c.ballMass * w.ball.vx ** 2, beforeHorizontal);
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
	assert.equal(ceiling.state.cargoCells, 100);
	near(ceiling.state.cargoMass, c.platformMass);
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
	assert.equal(ceiling.state.cargoCells, 12);
	w.platform.x = physics.platformMin();
	sync(w);
	physics.step(w, c.step);
	assert.equal(ceiling.state.cargoCells, 0);
	assert.equal(w.sales, 1);
	assert.ok(ceiling.state.funds > 0);
	assert.equal(ceiling.state.ledger.length, 1);
	balanced(w);
	const v = physics.createWorld();
	const state = ceiling.state;
	for (let x = 1; x < 23 && state.extractedCells < 8; x += 2) ceiling.damage(x, 8.2, 20);
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
	assert.equal(ceiling.state.cargoCells, 8);
	v.platform.x = physics.platformMax();
	sync(v);
	physics.step(v, c.step);
	assert.equal(ceiling.state.cargoCells, 0);
	assert.equal(v.sales, 1);
	balanced(v);
});

test('left pocket lets the reflector cover the wall without a wedge obstruction', () => {
	const w = physics.createWorld();
	assert.equal(c.wedgeX0, undefined);
	near(physics.platformMin(), c.platformWidth * 0.5 - c.pocketDepth);
	w.platform.x = physics.platformMin();
	const collectorEdge = w.platform.x - c.platformWidth * 0.5 + c.platformWidth * c.collectorFraction;
	near(collectorEdge, 0, 1e-9);
	// A ball falling straight near the left wall reaches the docked reflector unimpeded.
	w.ball.x = 0.3; w.ball.vx = 0; w.ball.y = 2.0; w.ball.vy = 0;
	w.ball.state = 'flying';
	sync(w);
	run(w, 0.8);
	assert.equal(w.bounces, 1);
	assert.equal(w.ball.state, 'flying');
	near(w.ball.x, 0.3);
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

test('ball reflects at an angle off a smooth heightmap crater and conserves energy', () => {
	const w = physics.createWorld();
	ceiling.setShape('smooth');
	ceiling.damage(10.06, 8.06, 6);
	w.ball.x = 9.75; w.ball.y = 7.75; w.ball.vx = 0; w.ball.vy = 8;
	w.ball.state = 'flying';
	sync(w);
	run(w, 0.05);
	assert.ok(w.ball.vx > 0.5);
	assert.ok(w.ball.vy < 0);
	balanced(w);
	// Optional square mode also reflects and conserves energy
	const sq = physics.createWorld();
	ceiling.setShape('square');
	ceiling.damage(10.06, 8.06, 6);
	sq.ball.x = 9.75; sq.ball.y = 7.75; sq.ball.vx = 0; sq.ball.vy = 8;
	sq.ball.state = 'flying';
	sync(sq);
	run(sq, 0.05);
	assert.ok(sq.ball.vy < 0);
	balanced(sq);
	ceiling.setShape('smooth');
});

test('rock reflection keeps the ball impulse: speed never grows beyond gravity', () => {
	for (const shape of ['smooth', 'square']) {
		ceiling.reset(11);
		ceiling.setShape(shape);
		// Jagged surface: strong hits leave spikes and steep slopes.
		for (let x = 2; x < 22; x += 2.5) ceiling.damage(x + 0.06, 8.06, 35);
		const w = physics.createWorld();
		ceiling.reset(11);
		ceiling.setShape(shape);
		for (let x = 2; x < 22; x += 2.5) ceiling.damage(x + 0.06, 8.06, 35);
		w.ball.x = 10.2; w.ball.y = 7.2; w.ball.vx = 5; w.ball.vy = 9;
		w.ball.state = 'flying';
		w.drive = false;
		sync(w);
		let travelled = 0;
		for (let i = 0; i < 240 * 4 && w.ball.state === 'flying'; i++) {
			const before = Math.hypot(w.ball.vx, w.ball.vy);
			const px = w.ball.x;
			const py = w.ball.y;
			physics.step(w, c.step);
			travelled += Math.hypot(w.ball.x - px, w.ball.y - py);
			const after = Math.hypot(w.ball.vx, w.ball.vy);
			assert.ok(after <= before + c.ballGravity * c.step + 1e-9, `${shape}: ${before} -> ${after}`);
		}
		assert.ok(travelled > 2, `${shape}: ball frozen, travelled ${travelled}`);
		balanced(w);
	}
	ceiling.setShape('smooth');
});

test('rock shape switch cannot tunnel the ball through the rock', () => {
	function smoothSurface(state, x) {
		const v = Math.max(0, Math.min(state.columns - 1, Math.floor(x / state.cell)));
		const t = Math.max(0, Math.min(1, (x - v * state.cell) / state.cell));
		return state.heightmap[v] + (state.heightmap[v + 1] - state.heightmap[v]) * t;
	}
	function carve() {
		for (let x = 10; x < 12; x += 0.25) ceiling.damage(x + 0.06, 8.06, 60);
	}
	// smooth -> square: the smooth surface cuts into square cells at crater
	// edges, so a ball resting on it is inside the square solid after a switch.
	ceiling.reset(1);
	ceiling.setShape('smooth');
	carve();
	const state = ceiling.state;
	let bestCol = 0;
	let bestMis = 0;
	for (let col = 0; col < state.columns; col++) {
		const mis = state.heightmap[col] - (state.bottom + state.firstRow[col] * state.cell);
		if (mis > bestMis) { bestMis = mis; bestCol = col; }
	}
	assert.ok(bestMis > c.radius);
	const w = physics.createWorld();
	ceiling.reset(1);
	ceiling.setShape('smooth');
	carve();
	w.ball.x = (bestCol + 0.5) * state.cell;
	w.ball.y = smoothSurface(state, w.ball.x) - c.radius;
	w.ball.vx = 0;
	w.ball.vy = 2;
	w.ball.state = 'flying';
	ceiling.setShape('square');
	const v0 = Math.hypot(w.ball.vx, w.ball.vy);
	const startY = w.ball.y;
	sync(w);
	for (let i = 0; i < 240; i++) {
		physics.step(w, c.step);
		assert.ok(Math.hypot(w.ball.vx, w.ball.vy) <= v0 + c.ballGravity + 1e-6);
		const col = Math.floor(w.ball.x / state.cell);
		assert.ok(w.ball.y <= state.bottom + state.firstRow[col] * state.cell + 1e-9, 'ball inside square rock');
	}
	assert.ok(w.ball.y < startY - 0.2, 'ball frozen after switch');
	balanced(w);
	// square -> smooth: at crater edges the smooth surface dips below the
	// square cells, so a ball resting on a square face is inside the smooth solid.
	const sq = physics.createWorld();
	ceiling.reset(1);
	ceiling.setShape('square');
	carve();
	let craterCol = 0;
	let reverseMis = 0;
	for (let col = 0; col < state.columns; col++) {
		const mis = state.bottom + state.firstRow[col] * state.cell - smoothSurface(state, (col + 0.5) * state.cell);
		if (mis > reverseMis) { reverseMis = mis; craterCol = col; }
	}
	assert.ok(reverseMis > 0.05);
	sq.ball.x = (craterCol + 0.5) * state.cell;
	sq.ball.y = smoothSurface(state, sq.ball.x) + 0.02;
	sq.ball.vx = 0;
	sq.ball.vy = 2;
	sq.ball.state = 'flying';
	ceiling.setShape('smooth');
	assert.ok(sq.ball.y < state.bottom + state.firstRow[craterCol] * state.cell, 'mismatch setup');
	const sqV0 = Math.hypot(sq.ball.vx, sq.ball.vy);
	const sqStartY = sq.ball.y;
	sync(sq);
	for (let i = 0; i < 240; i++) {
		physics.step(sq, c.step);
		assert.ok(Math.hypot(sq.ball.vx, sq.ball.vy) <= sqV0 + c.ballGravity + 1e-6);
		assert.ok(sq.ball.y <= smoothSurface(state, sq.ball.x) + 1e-9, 'ball inside smooth rock');
	}
	assert.ok(sq.ball.y < sqStartY - 0.2, 'ball frozen after switch');
	balanced(sq);
	ceiling.setShape('smooth');
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
