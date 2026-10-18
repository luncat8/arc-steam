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
	const value = ceiling.sellCargo(world.platform.vx, 1.5);
	assert.ok(value > 0);
	assert.equal(state.cargoCells(), 0);
	assert.equal(state.soldCells(), 100);
	near(state.funds(), value);
	assert.equal(state.ledger.length, 1);
	assert.equal(state.ledger[0].time, 1.5);
});

test('damage removes double strength over a 4.5-cell radius falling to zero', () => {
	ceiling.reset(9);
	const state = ceiling.state();
	assert.equal(state.damageRadius, 4.5);
	assert.equal(state.damageMultiplier, 2);
	const before = Array.from(state.strength);
	const removed = ceiling.damage(6.25, 8.5, 10);
	assert.ok(removed > 0);
	assert.ok(removed <= 10 + 1e-9);
	let strengthLost = 0;
	for (let i = 0; i < before.length; i++) strengthLost += before[i] - state.strength[i];
	near(strengthLost, removed * 2, 1e-3);
	const centerColumn = Math.floor(6.25 / state.cell);
	const centerRow = Math.floor((8.5 - state.bottom) / state.cell);
	const center = centerRow * state.columns + centerColumn;
	const edge = centerRow * state.columns + centerColumn + 4;
	const outside = centerRow * state.columns + centerColumn + 6;
	assert.ok(before[center] - state.strength[center] > before[edge] - state.strength[edge]);
	assert.ok(before[edge] - state.strength[edge] > 0);
	near(state.strength[outside], before[outside]);
});

test('pool exhaustion still records extraction before the loss', () => {
	ceiling.reset(11);
	const state = ceiling.state();
	state.active.fill(1);
	ceiling.damage(12.25, 8.5, 1000);
	assert.ok(state.extractedCells() > 0);
	assert.equal(state.extractedCells(), state.lostCells());
	near(state.cargoMass(), 0);
	ceiling.reset(1);
});

test('cargo tracks per-mineral mass and each wall sale appends a frozen ledger entry', () => {
	ceiling.reset(7);
	for (let x = 1; x < 23; x += 2) ceiling.damage(x, 8.2, 10000);
	const state = ceiling.state();
	const world = { platform: { x: 12, vx: 0 }, heat: 0 };
	for (let i = 0; i < state.active.length; i++) if (state.active[i]) {
		state.debrisX[i] = 11;
		state.debrisY[i] = 0.701;
		state.debrisVx[i] = 0;
		state.debrisVy[i] = -1;
	}
	ceiling.step(world, 0.01, 60);
	const cargo = state.cargoCells();
	assert.ok(cargo > 0);
	near(state.cargoMinerals[0] + state.cargoMinerals[1] + state.cargoMinerals[2], state.cargoMass());
	near(state.caughtValue(), state.cargoValue() + state.soldValue());
	const firstValue = ceiling.sellCargo(0, 3.25);
	assert.ok(firstValue > 0);
	assert.equal(state.cargoCells(), 0);
	near(state.soldMinerals[0] + state.soldMinerals[1] + state.soldMinerals[2], state.soldCells() * state.cellMass);
	assert.equal(state.ledger.length, 1);
	assert.deepEqual(state.ledger[0].id, 1);
	assert.equal(state.ledger[0].time, 3.25);
	assert.ok(Object.isFrozen(state.ledger[0]));
	assert.ok(Object.isFrozen(state.ledger[0].quantities));
	near(state.ledger[0].credits, firstValue);
	assert.equal(ceiling.sellCargo(0, 4), 0);
	assert.equal(state.ledger.length, 1);
});

test('extracted, airborne, caught and lost cells stay conserved', () => {
	ceiling.reset(13);
	ceiling.damage(6.25, 8.5, 100);
	ceiling.damage(18.25, 8.5, 100);
	const state = ceiling.state();
	const world = { platform: { x: 12, vx: 0 }, heat: 0 };
	for (let step = 0; step < 2400 && state.airborneCells() > 0; step++) {
		ceiling.step(world, 1 / 240, 60);
		near(state.extractedCells(), state.airborneCells() + state.caughtCells() + state.lostCells());
	}
	assert.equal(state.airborneCells(), 0);
	assert.equal(state.extractedCells(), state.caughtCells() + state.lostCells());
	near(state.caughtValue(), state.cargoValue() + state.soldValue());
});

test('fragments bounce off the unbreakable wedge instead of passing through', () => {
	ceiling.reset(17);
	const state = ceiling.state();
	state.active[0] = 1;
	state.debrisCell[0] = 0;
	state.debrisX[0] = 0.3;
	state.debrisY[0] = 2.2;
	state.debrisVx[0] = 0;
	state.debrisVy[0] = 0;
	const world = { platform: { x: 12, vx: 0 }, heat: 0 };
	for (let i = 0; i < 240; i++) ceiling.step(world, 1 / 240, 60);
	assert.ok(state.debrisVx[0] > 0.5);
	assert.ok(state.debrisX[0] > 0.45);
	assert.ok(world.heat > 0);
});
