'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ceiling = require('../js/ceiling.js');

function near(actual, expected, tolerance = 1e-6) {
	assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

test('ceiling state is a stable property view, separate from command methods', () => {
	ceiling.reset(31);
	const state = ceiling.state;
	assert.equal(ceiling.state, state);
	assert.ok(Object.isFrozen(state));
	assert.equal(typeof state.funds, 'number');
	assert.equal(typeof state.airborneCells, 'number');
	assert.equal(typeof state.cargoMass, 'number');
	assert.equal(typeof state.energy, 'number');
	assert.equal(typeof ceiling.funds, 'undefined');
	assert.equal(typeof ceiling.energy, 'undefined');
	ceiling.reset(32);
	assert.equal(ceiling.state, state);
	assert.equal(state.funds, 0);
});

test('seeded 2D element and mineral fields repeat and normalize', () => {
	ceiling.reset(42);
	const state = ceiling.state;
	assert.equal(state.columns, 192);
	assert.equal(state.rows, 16);
	assert.equal(state.defaultPixelSize, 4);
	assert.equal(state.shape, 'smooth');
	const first = Array.from(state.strength);
	for (let i = 0; i < state.columns * state.rows; i++) {
		const offset = i * 3;
		near(state.elements[offset] + state.elements[offset + 1] + state.elements[offset + 2], 1);
		near(state.minerals[offset] + state.minerals[offset + 1] + state.minerals[offset + 2], 1);
	}
	ceiling.reset(42);
	assert.deepEqual(Array.from(ceiling.state.strength), first);
});

test('radial 2D damage weakens nearby cells and emits each failed cell once', () => {
	ceiling.reset(9);
	const before = Array.from(ceiling.state.strength);
	const removed = ceiling.damage(6.25, 8.06, 3);
	const state = ceiling.state;
	assert.ok(removed > 0);
	assert.ok(state.strength.some((value, index) => value < before[index]));
	const extracted = state.extractedCells;
	assert.ok(extracted > 0);
	assert.equal(state.lostCells, 0);
	assert.equal(state.airborneCells, extracted);
	ceiling.damage(6.25, 8.06, 3);
	assert.ok(state.extractedCells >= extracted);
});

test('swept circle contacts the exposed rock face with its outward normal', () => {
	ceiling.reset(3);
	ceiling.setShape('smooth');
	const hit = ceiling.trace(5, 7, 0, 20, 0.1, 0.18);
	assert.ok(Number.isFinite(hit.time));
	near(hit.y, ceiling.state.bottom - 0.18, 0.003);
	assert.equal(hit.nx, 0);
	assert.equal(hit.ny, -1);
});

test('smooth heightmap and optional square shape reflect at angled slopes', () => {
	ceiling.reset(3);
	ceiling.setShape('smooth');
	// Excavate a symmetric crater around x = 10 m
	ceiling.damage(10.06, 8.06, 5);
	const leftHit = ceiling.trace(9.75, 7.8, 0, 12, 0.05, 0.18);
	assert.ok(Number.isFinite(leftHit.time));
	assert.ok(leftHit.nx > 0.1);
	assert.ok(leftHit.ny < -0.5);
	const rightHit = ceiling.trace(10.35, 7.8, 0, 12, 0.05, 0.18);
	assert.ok(Number.isFinite(rightHit.time));
	assert.ok(rightHit.nx < -0.1);
	assert.ok(rightHit.ny < -0.5);
	// Optional square mode uses rounded cell corners instead of blocking with flat side walls
	ceiling.setShape('square');
	assert.equal(ceiling.state.shape, 'square');
	const cornerHit = ceiling.trace(10.35, 7.8, 0, 12, 0.05, 0.18);
	assert.ok(Number.isFinite(cornerHit.time));
	assert.ok(cornerHit.ny < 0);
	ceiling.setShape('smooth');
});

test('overlapping contacts resolve at the surface instead of being skipped', () => {
	ceiling.reset(3);
	ceiling.setShape('smooth');
	const state = ceiling.state;
	const h = state.heightmap[Math.floor(6 / state.cell)];
	// Ball centre slightly inside the rock face must still get its contact.
	const hit = ceiling.trace(6, h - 0.175, 0, 1, 0.02, 0.18);
	assert.ok(Number.isFinite(hit.time));
	assert.equal(hit.time, 0);
	near(hit.y, h - 0.18, 1e-6);
	assert.ok(hit.ny < -0.9);
	// A centre deep inside the solid (shape-switch residue) is dropped below
	// the surface so the ball keeps its impulse and cannot fly through.
	const deep = ceiling.trace(6, h + 0.4, 0, -2, 0.02, 0.18);
	assert.equal(deep.time, 0);
	near(deep.y, h - 0.18, 1e-6);
	ceiling.setShape('square');
	const inside = ceiling.trace(6, h + 0.4, 0, -2, 0.02, 0.18);
	assert.equal(inside.time, 0);
	assert.ok(inside.y <= state.bottom + state.firstRow[Math.floor(6 / state.cell)] * state.cell - 0.18 + 1e-9);
	ceiling.setShape('smooth');
});

test('storage stops at 100 cells, adds one dry-platform mass, and sells at once', () => {
	ceiling.reset(5);
	for (let x = 1; x < 23; x += 2) ceiling.damage(x, 8.2, 20);
	const state = ceiling.state;
	assert.equal(state.lostCells, 0);
	assert.equal(state.airborneCells, state.extractedCells);
	for (let i = 0; i < state.active.length; i++) if (state.active[i]) {
		state.debrisX[i] = 11;
		state.debrisY[i] = 0.701;
		state.debrisVx[i] = 2;
		state.debrisVy[i] = -1;
	}
	const world = { platform: { x: 12, vx: 0 }, heat: 0 };
	ceiling.step(world, 0.01, 60);
	assert.equal(state.cargoCells, 100);
	near(state.cargoMass, 60);
	assert.ok(world.platform.vx > 0);
	const value = ceiling.sellCargo(world.platform.vx, 1.5);
	assert.ok(value > 0);
	assert.equal(state.cargoCells, 0);
	assert.equal(state.soldCells, 100);
	near(state.funds, value);
	assert.equal(state.ledger.length, 1);
	assert.equal(state.ledger[0].time, 1.5);
});

test('damage applies 2x hit-point strength falling linearly to zero at 4.5-cell radius', () => {
	ceiling.reset(9);
	const state = ceiling.state;
	assert.equal(state.damageRadius, 4.5);
	assert.equal(state.damageMultiplier, 2);
	const before = Array.from(state.strength);
	const impactJ = 1.2;
	const removed = ceiling.damage(6.25, 8.06, impactJ);
	assert.ok(removed > 0);
	assert.ok(removed <= impactJ + 1e-9);
	const centerColumn = Math.floor(6.25 / state.cell);
	const centerRow = Math.floor((8.06 - state.bottom) / state.cell);
	const center = centerRow * state.columns + centerColumn;
	const mid = centerRow * state.columns + centerColumn + 2;
	const edge = centerRow * state.columns + centerColumn + 4;
	const outside = centerRow * state.columns + centerColumn + 5;
	near(before[center] - state.strength[center], impactJ * 2, 1e-5);
	near(before[mid] - state.strength[mid], impactJ * 2 * (1 - 2 / 4.5), 1e-5);
	near(before[edge] - state.strength[edge], impactJ * 2 * (1 - 4 / 4.5), 1e-5);
	near(state.strength[outside], before[outside]);
});

test('multiple broken cells are never lost on fracture and all broken mass falls', () => {
	ceiling.reset(11);
	const state = ceiling.state;
	const initialEnergy = ceiling.state.energy;
	for (let x = 1; x < 23; x += 1.5) ceiling.damage(x, 8.5, 25);
	const extracted = state.extractedCells;
	assert.ok(extracted > 400);
	assert.equal(state.lostCells, 0);
	assert.equal(state.airborneCells, extracted);
	near(ceiling.state.energy, initialEnergy, 1e-5);
	// Even if all pool slots were marked active, newly broken cells aggregate and fall.
	ceiling.reset(11);
	for (let i = 0; i < state.active.length; i++) {
		state.active[i] = 1;
		state.debrisCell[i] = 0;
		state.debrisX[i] = 12;
		state.debrisY[i] = 4;
	}
	const energyBefore = ceiling.state.energy;
	ceiling.damage(12.25, 8.06, 10);
	assert.ok(state.extractedCells > 0);
	assert.equal(state.lostCells, 0);
	assert.equal(state.airborneCells, state.active.length + state.extractedCells);
	near(ceiling.state.energy, energyBefore, 1e-5);
	ceiling.reset(1);
});

test('cargo tracks per-mineral mass and each wall sale appends a frozen ledger entry', () => {
	ceiling.reset(7);
	for (let x = 1; x < 23; x += 2) ceiling.damage(x, 8.2, 20);
	const state = ceiling.state;
	const world = { platform: { x: 12, vx: 0 }, heat: 0 };
	for (let i = 0; i < state.active.length; i++) if (state.active[i]) {
		state.debrisX[i] = 11;
		state.debrisY[i] = 0.701;
		state.debrisVx[i] = 0;
		state.debrisVy[i] = -1;
	}
	ceiling.step(world, 0.01, 60);
	const cargo = state.cargoCells;
	assert.ok(cargo > 0);
	near(state.cargoMinerals[0] + state.cargoMinerals[1] + state.cargoMinerals[2], state.cargoMass);
	near(state.caughtValue, state.cargoValue + state.soldValue);
	const firstValue = ceiling.sellCargo(0, 3.25);
	assert.ok(firstValue > 0);
	assert.equal(state.cargoCells, 0);
	near(state.soldMinerals[0] + state.soldMinerals[1] + state.soldMinerals[2], state.soldCells * state.cellMass);
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
	ceiling.damage(6.25, 8.5, 10);
	ceiling.damage(18.25, 8.5, 10);
	const state = ceiling.state;
	const world = { platform: { x: 12, vx: 0 }, heat: 0 };
	for (let step = 0; step < 2400 && state.airborneCells > 0; step++) {
		ceiling.step(world, 1 / 240, 60);
		near(state.extractedCells, state.airborneCells + state.caughtCells + state.lostCells);
	}
	assert.equal(state.airborneCells, 0);
	assert.equal(state.extractedCells, state.caughtCells + state.lostCells);
	near(state.caughtValue, state.cargoValue + state.soldValue);
});
