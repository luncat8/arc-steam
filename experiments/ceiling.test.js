'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ceiling = require('../js/ceiling.js');

function near(actual, expected, tolerance = 1e-6) {
	assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

test('seeded 2D element and mineral fields repeat and normalize', () => {
	ceiling.reset(42);
	const state = ceiling.state();
	assert.equal(state.columns, 192);
	assert.equal(state.rows, 16);
	assert.equal(state.defaultPixelSize, 4);
	const first = Array.from(state.strength);
	for (let i = 0; i < state.columns * state.rows; i++) {
		const offset = i * 3;
		near(state.elements[offset] + state.elements[offset + 1] + state.elements[offset + 2], 1);
		near(state.minerals[offset] + state.minerals[offset + 1] + state.minerals[offset + 2], 1);
	}
	ceiling.reset(42);
	assert.deepEqual(Array.from(ceiling.state().strength), first);
});

test('radial 2D damage weakens nearby cells and emits each failed cell once', () => {
	ceiling.reset(9);
	const before = Array.from(ceiling.state().strength);
	const removed = ceiling.damage(6.25, 8.06, 300);
	const state = ceiling.state();
	assert.ok(removed > 0);
	assert.ok(state.strength.some((value, index) => value < before[index]));
	const extracted = state.extractedCells();
	assert.ok(extracted > 0);
	ceiling.damage(6.25, 8.06, 300);
	assert.ok(state.extractedCells() >= extracted);
});

test('swept circle contacts the exposed rock face with its outward normal', () => {
	ceiling.reset(3);
	const hit = ceiling.trace(5, 7, 0, 20, 0.1, 0.18);
	assert.ok(Number.isFinite(hit.time));
	near(hit.y, ceiling.state().bottom - 0.18, 0.003);
	assert.equal(hit.nx, 0);
	assert.equal(hit.ny, -1);
});

test('storage stops at 100 cells, adds one dry-platform mass, and sells at once', () => {
	ceiling.reset(5);
	for (let x = 1; x < 23; x += 2) ceiling.damage(x, 8.2, 10000);
	const state = ceiling.state();
	for (let i = 0; i < state.active.length; i++) if (state.active[i]) {
		state.debrisX[i] = 11;
		state.debrisY[i] = 0.701;
		state.debrisVx[i] = 2;
		state.debrisVy[i] = -1;
	}
	const world = { platform: { x: 12, vx: 0 }, heat: 0 };
	ceiling.step(world, 0.01, 60);
	assert.equal(state.cargoCells(), 100);
	near(state.cargoMass(), 60);
	assert.ok(world.platform.vx > 0);
	const value = ceiling.sellCargo(world.platform.vx);
	assert.ok(value > 0);
	assert.equal(state.cargoCells(), 0);
	assert.equal(state.soldCells(), 100);
	near(state.funds(), value);
});
