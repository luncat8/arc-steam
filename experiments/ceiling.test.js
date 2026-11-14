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
	assert.equal(state.rows, 29);
	assert.equal(state.defaultPixelSize, 4);
	assert.equal(state.shape, 'smooth');
	const first = Array.from(state.strength);
	const mineralStride = state.mineralNames.length;
	for (let i = 0; i < state.columns * state.rows; i++) {
		const offset = i * 3;
		for (let channel = 0; channel < 3; channel++) assert.ok(state.elements[offset + channel] >= 0 && state.elements[offset + channel] <= 1,
			'each element is an independent concentration in 0..1');
		let mix = 0;
		for (let m = 0; m < mineralStride; m++) mix += state.minerals[i * mineralStride + m];
		near(mix, 1);
	}
	ceiling.reset(42);
	assert.deepEqual(Array.from(ceiling.state.strength), first);
});

test('fallen-soil tiles keep a 4:1 width-to-height ratio and a smooth interpolated crest', () => {
	ceiling.reset(31);
	const state = ceiling.state;
	assert.equal(state.floorCellHeight, state.cell / 4);
	state.floorPiles.fill(0.2);
	const tiles = [];
	const context = {
		fillRect(x, y, width, height) { tiles.push({ x, y, width, height }); },
		beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, save() {}, restore() {}, stroke() {}
	};
	ceiling.drawFloor(context);
	assert.ok(tiles.length > 0, 'the rubble is rendered as individual tiles');
	const fullTile = tiles.find(tile => Math.abs(tile.height - state.floorCellHeight) < 1e-12);
	assert.ok(fullTile, 'full-height soil rows are present');
	near(fullTile.width, state.cell);
	near(fullTile.height, state.cell / 4);
	near(fullTile.width / fullTile.height, 4);
	for (const height of state.floorHeight) near(height, 0.2, 1e-12);
});

test('radial 2D damage weakens nearby cells and the loosened ring falls later', () => {
	ceiling.reset(9);
	const before = Array.from(ceiling.state.strength);
	const removed = ceiling.damage(6.25, ceiling.state.bottom + 0.06, 3);
	const state = ceiling.state;
	assert.ok(removed > 0);
	assert.ok(state.strength.some((value, index) => value < before[index]));
	assert.equal(state.extractedCells, 0);
	assert.equal(state.lostCells, 0);
	assert.equal(state.airborneCells, 0);
	// The weakened ring around the crater lets go in a later collapse burst.
	ceiling.collapse(10);
	const extracted = state.extractedCells;
	assert.ok(extracted > 0);
	assert.equal(state.airborneCells, extracted);
	ceiling.damage(6.25, ceiling.state.bottom + 0.06, 3);
	ceiling.collapse(10);
	assert.ok(state.extractedCells >= extracted);
});

test('swept circle contacts the exposed rock face with its outward normal', () => {
	ceiling.reset(3);
	ceiling.setShape('smooth');
	const hit = ceiling.trace(5, ceiling.state.bottom - 1, 0, 20, 0.1, 0.18);
	assert.ok(Number.isFinite(hit.time));
	near(hit.y, ceiling.state.bottom - 0.18, 0.003);
	assert.equal(hit.nx, 0);
	assert.equal(hit.ny, -1);
});

test('smooth heightmap and optional square shape reflect at angled slopes', () => {
	ceiling.reset(3);
	ceiling.setShape('smooth');
	// Carve a symmetric notch directly: contact geometry must not depend on the
	// mineral field or on a collapse giving the intended shape.
	const state = ceiling.state;
	const blank = {
		fillStyle: '', fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {}
	};
	for (let column = 76; column <= 84; column++) {
		for (let row = 0; row < 3; row++) state.strength[row * state.columns + column] = 0;
	}
	ceiling.draw(blank, 'minerals');
	const leftHit = ceiling.trace(9.75, state.bottom - 0.2, 0, 12, 0.05, 0.18);
	assert.ok(Number.isFinite(leftHit.time));
	assert.ok(leftHit.nx > 0.1);
	assert.ok(leftHit.ny < -0.5);
	const rightHit = ceiling.trace(10.35, state.bottom - 0.2, 0, 12, 0.05, 0.18);
	assert.ok(Number.isFinite(rightHit.time));
	assert.ok(rightHit.nx < -0.1);
	assert.ok(rightHit.ny < -0.5);
	// Optional square mode uses rounded cell corners instead of blocking with flat side walls
	ceiling.setShape('square');
	assert.equal(ceiling.state.shape, 'square');
	const cornerHit = ceiling.trace(10.35, ceiling.state.bottom - 0.2, 0, 12, 0.05, 0.18);
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
	for (let x = 1; x < 23; x += 2) { ceiling.damage(x, ceiling.state.bottom + 0.2, 20); ceiling.collapse(2); }
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

test('damage applies 2x hit-point strength falling to zero at 8.78-cell radius with fast power falloff', () => {
	ceiling.reset(9);
	const state = ceiling.state;
	assert.equal(state.damageRadius, 8.775);
	assert.equal(state.damageMultiplier, 2);
	const before = Array.from(state.strength);
	const impactJ = 1.2;
	const removed = ceiling.damage(6.25, ceiling.state.bottom + 0.06, impactJ);
	assert.ok(removed > 0);
	assert.ok(removed <= impactJ + 1e-9);
	const centerColumn = Math.floor(6.25 / state.cell);
	const centerRow = Math.floor((ceiling.state.bottom + 0.06 - state.bottom) / state.cell);
	const center = centerRow * state.columns + centerColumn;
	const mid = centerRow * state.columns + centerColumn + 2;
	const edge = centerRow * state.columns + centerColumn + 5;
	const outside = centerRow * state.columns + centerColumn + 10;
	function w(d) { return Math.pow(Math.max(0, 1 - d / state.damageRadius), 2.8); }
	// A blow never takes more than half of a cell's remaining strength.
	function expected(cell, d) { return Math.min(impactJ * 2 * w(d), before[cell] * state.hitLooseCap); }
	near(before[center] - state.strength[center], expected(center, 0), 1e-5);
	near(before[mid] - state.strength[mid], expected(mid, 2), 1e-5);
	near(before[edge] - state.strength[edge], expected(edge, 5), 1e-5);
	near(state.strength[outside], before[outside]);
});

test('multiple broken cells are never lost on fracture and all broken mass falls', () => {
	ceiling.reset(11);
	const state = ceiling.state;
	const initialEnergy = ceiling.state.energy;
	for (let x = 1; x < 23; x += 1.5) { ceiling.damage(x, ceiling.state.bottom + 0.5, 25); ceiling.collapse(2); }
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
	ceiling.damage(12.25, ceiling.state.bottom + 0.06, 10);
	ceiling.collapse(10);
	assert.ok(state.extractedCells > 0);
	assert.equal(state.lostCells, 0);
	assert.equal(state.airborneCells, state.active.length + state.extractedCells);
	near(ceiling.state.energy, energyBefore, 1e-5);
	ceiling.reset(1);
});

test('cargo tracks per-mineral mass and each wall sale appends a frozen ledger entry', () => {
	ceiling.reset(7);
	for (let x = 1; x < 23; x += 2) { ceiling.damage(x, ceiling.state.bottom + 0.2, 20); ceiling.collapse(2); }
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
	const mineralStride = state.mineralNames.length;
	let cargoMix = 0;
	for (let m = 0; m < mineralStride; m++) cargoMix += state.cargoMinerals[m];
	near(cargoMix, state.cargoMass);
	near(state.caughtValue, state.cargoValue + state.soldValue);
	const firstValue = ceiling.sellCargo(0, 3.25);
	assert.ok(firstValue > 0);
	assert.equal(state.cargoCells, 0);
	let soldMix = 0;
	for (let m = 0; m < mineralStride; m++) soldMix += state.soldMinerals[m];
	near(soldMix, state.soldCells * state.cellMass);
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
	ceiling.damage(6.25, ceiling.state.bottom + 0.5, 10);
	ceiling.damage(18.25, ceiling.state.bottom + 0.5, 10);
	ceiling.collapse(10);
	const state = ceiling.state;
	const world = { platform: { x: 12, vx: 0 }, heat: 0 };
	// Previously damaged layers can keep releasing without another hit, so
	// wait for the loose rock as well as the airborne fragments to settle.
	for (let step = 0; step < 240 * 120 && (state.airborneCells > 0 || state.looseCells > 0); step++) {
		ceiling.step(world, 1 / 240, 60);
		near(state.extractedCells, state.airborneCells + state.caughtCells + state.lostCells);
	}
	assert.equal(state.looseCells, 0, 'no further exposed rock is waiting to fall');
	assert.equal(state.airborneCells, 0);
	assert.equal(state.extractedCells, state.caughtCells + state.lostCells);
	near(state.caughtValue, state.cargoValue + state.soldValue);
});

test('lost fragments pile up on the floor heightmap under their landing point', () => {
	ceiling.reset(17);
	const state = ceiling.state;
	const world = { platform: { x: -5, vx: 0 }, heat: 0 };
	ceiling.damage(6.25, state.bottom + 0.5, 12);
	ceiling.collapse(30);
	const extracted = state.extractedCells;
	assert.ok(extracted > 0);
	for (let i = 0; i < state.active.length; i++) if (state.active[i]) {
		state.debrisX[i] = 6.25;
		state.debrisY[i] = 3;
		state.debrisVx[i] = 0;
		state.debrisVy[i] = -1;
	}
	for (let step = 0; step < 240 * 8 && state.airborneCells > 0; step++) ceiling.step(world, 1 / 240, 60);
	assert.equal(state.airborneCells, 0);
	assert.ok(state.lostCells >= extracted);
	assert.equal(state.lostCells, state.extractedCells);
	assert.equal(state.extractedCells, state.airborneCells + state.caughtCells + state.lostCells);
	assert.ok(world.heat > 0, 'landing energy is booked as heat');
	const column = Math.floor(6.25 / state.cell);
	assert.ok(state.floorPiles[column] > 0);
	assert.ok(ceiling.floorAt(6.25) > 0);
	// The pile is capped at the deck line and smoothed into its neighbours with
	// the same binomial stencil as the rock heightmap above.
	assert.ok(state.floorPiles[column] <= state.pileLimit);
	assert.ok(state.floorHeight[column - 1] > 0);
	assert.ok(state.floorHeight[column] > 0);
	assert.ok(state.floorHeight[column + 1] > 0);
});

// 0.3.1 acceptance: delayed ceiling collapse.
test('a single impact does not detach pixels immediately', () => {
	ceiling.reset(11);
	const state = ceiling.state;
	const before = state.extractedCells;
	const beforeLoose = state.looseCells;
	const removed = ceiling.damage(8, state.bottom + 0.2, 40);
	assert.ok(removed > 0);
	// The blow spends at most half of a cell's remaining strength, so the ring
	// around the contact stays standing and nothing is extracted in the same call.
	assert.equal(state.extractedCells, before);
	assert.ok(state.looseCells > beforeLoose, 'the hit must leave loose cells');
	assert.ok(state.airborneCells === 0, 'nothing falls yet');
	assert.ok(state.strength.some((value, index) => value < state.initialStrength[index]),
		'weakened but standing cells remain');
});

test('collapse probability rises with damage', () => {
	// Repeated hits loosen more of the same area, raising its later release.
	ceiling.reset(33);
	let extracted = 0;
	for (let i = 0; i < 8; i++) { ceiling.damage(8, ceiling.state.bottom + 0.2, 3); ceiling.collapse(0.25); }
	extracted = ceiling.state.extractedCells;
	for (let i = 0; i < 40; i++) { ceiling.damage(8, ceiling.state.bottom + 0.2, 3); ceiling.collapse(0.25); }
	assert.ok(ceiling.state.extractedCells > extracted, 'more damage must detach more later');
});

test('only exposed, damaged pixels detach, and a clump is bounded', () => {
	ceiling.reset(47);
	const state = ceiling.state;
	ceiling.damage(8, state.bottom + 0.2, 200);
	ceiling.collapse(60);
	assert.ok(state.extractedCells > 0);
	// Every detached cell was on the surface of its own column when it fell: the
	// surface is now above it, so no interior cell paid out as invisible rubble.
	const columns = state.columns;
	for (let i = 0; i < state.active.length; i++) {
		if (!state.active[i]) continue;
		const row = Math.floor(state.debrisCell[i] / columns);
		const column = state.debrisCell[i] % columns;
		assert.ok(state.firstRow[column] > row, 'a detached cell was not on the surface');
	}
	// The scheduler never detaches more than collapseChunkMax cells in one roll.
	assert.ok(ceiling.collapseChunkMax >= 1);
});

test('the collapse scheduler is bounded work per tick', () => {
	ceiling.reset(21);
	const state = ceiling.state;
	// Batter the whole ceiling: every horizontal band must still roll at most
	// once per tick and release no more than one group cap of cells.
	for (let x = 0; x < 24; x += 2) ceiling.damage(x, state.bottom + 0.2, 40);
	const before = state.extractedCells;
	ceiling.collapse(0.25);
	const cap = ceiling.collapseChunkMax;
	const maxBands = Math.ceil(state.columns / 16);
	let grains = 0;
	for (let i = 0; i < state.active.length; i++) {
		if (!state.active[i]) continue;
		grains++;
		assert.equal(state.debrisCells[i], 1, 'every released cell falls as its own grain');
	}
	assert.ok(grains <= cap * maxBands, 'one tick never releases more than one group cap per band');
	assert.ok(state.extractedCells - before <= cap * maxBands,
		'one tick never detaches more than one group cap per band');
});

test('the rock is only ever missing at its free face', () => {
	// Rock can crumble away at the face the ball works on; nothing behind that
	// face may vanish, so a fall always starts on the visible surface instead of
	// inside the rock.
	ceiling.reset(53);
	const state = ceiling.state;
	const columns = state.columns;
	const rows = state.rows;
	const world = { platform: { x: -100, vx: 0 }, heat: 0 };
	const check = () => {
		for (let column = 0; column < columns; column++) {
			const face = state.firstRow[column];
			for (let row = 0; row < rows; row++) {
				const intact = state.strength[row * columns + column] > 0;
				assert.equal(intact, row >= face, `column ${column} row ${row} is not a face removal`);
			}
		}
	};
	for (let k = 0; k < 240; k++) {
		ceiling.damage(0.5 + (k * 0.61) % 23, state.bottom + 0.2, 45);
		ceiling.collapse(0.5);
		ceiling.step(world, 0.05, 0);
		if (k % 60 === 0) check();
	}
	check();
	assert.ok(state.extractedCells > 0);
	ceiling.reset(1);
});

test('a grain that has just let go is drawn under the ceiling it broke from', () => {
	ceiling.reset(31);
	const state = ceiling.state;
	const columns = state.columns;
	// A worked shaft: the floor of the chamber is gone along a stretch, and one
	// column is a few rows deeper. A grain at that column's face sits at the
	// drawn face, and it must hang below the rock rather than be painted into it.
	const shaft = 70;
	for (let column = 60; column <= 80; column++) for (let row = 0; row < 4; row++) state.strength[row * columns + column] = 0;
	for (let row = 0; row < 8; row++) state.strength[row * columns + shaft] = 0;
	state.active[0] = 1;
	state.debrisCell[0] = 8 * columns + shaft;
	state.debrisCells[0] = 1;
	state.debrisX[0] = (shaft + 0.5) * state.cell;
	state.debrisY[0] = state.bottom + 8.5 * state.cell;
	state.debrisVx[0] = 0;
	state.debrisVy[0] = 0;
	state.debrisDamage[0] = 0.5;
	const grain = state.cell * 0.76;
	const tops = [];
	const context = {
		fillStyle: '',
		fillRect(x, y, width, height) {
			if (Math.abs(width - grain) > 1e-9 || Math.abs(height - grain) > 1e-9) return;
			tops.push(y + height);
		},
		beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}
	};
	ceiling.draw(context, 'minerals');
	assert.equal(tops.length, 1, 'the released cell is drawn once, at its own cell size');
	let underside = Infinity;
	const first = Math.floor((state.debrisX[0] - grain * 0.5) / state.cell);
	const last = Math.floor((state.debrisX[0] + grain * 0.5) / state.cell);
	for (let vertex = first; vertex <= last + 1; vertex++) underside = Math.min(underside, state.rockDrawnY(state.heightmap[vertex]));
	assert.ok(tops[0] <= underside + 1e-9, 'the drawn grain must hang below the rock it left');
	ceiling.reset(1);
});

test('queued top-row growth slides in smoothly at 5 rows/s and continues seeded veins', () => {
	ceiling.reset(17);
	const state = ceiling.state;
	const startBottom = state.bottom;
	const startRows = state.rows;
	const startHeight0 = state.heightmap[0];
	const rowZeroStrength = state.strength[0];
	assert.equal(ceiling.queueGrowth(1), 1);
	assert.equal(state.bottom, startBottom, 'queueing never jumps bottom on the bounce frame');
	assert.equal(state.rows, startRows, 'row count waits until space opens at the top');
	near(state.heightmap[0], startHeight0, 1e-12);

	// 0.05 s at 5 rows/s shifts 0.25 row (0.03125 m) and opens row 29 at the top.
	assert.equal(ceiling.grow(0.05), true);
	near(state.pendingRows, 0.75, 1e-9);
	near(state.bottom, startBottom - 0.25 * state.cell, 1e-9);
	near(state.heightmap[0], startHeight0 - 0.25 * state.cell, 1e-9);
	assert.equal(state.rows, startRows + 1, 'the incoming top row begins emerging across y = 15 m');
	assert.equal(state.generatedRows, startRows + 1);
	near(state.strength[0], rowZeroStrength, 1e-6, 'existing lower cells move down intact');
	near(state.drawnRowY[state.rows], state.top, 1e-9, 'emerging top row clips cleanly at top');
	assert.ok(state.drawnRowY[state.rows - 1] < state.top && state.drawnRowY[state.rows - 1] > state.top - 0.02);

	// Remaining 0.15 s completes the 1-row shift; extra grow time with empty queue is a no-op.
	assert.equal(ceiling.grow(0.15), true);
	near(state.pendingRows, 0, 1e-12);
	near(state.bottom, startBottom - state.cell, 1e-9);
	assert.equal(state.rows, startRows + 1);
	assert.equal(ceiling.grow(0.5), false);

	// Repeat with the same seed and market advance: geological row 29 is deterministic and repriced.
	const count = state.mineralNames.length;
	const rowOffset = (state.rows - 1) * state.columns;
	const snapshotElements = Array.from(state.elements.subarray(rowOffset * 3, (rowOffset + 8) * 3));
	ceiling.advanceMarket(40);
	for (let col = 0; col < 8; col++) {
		const idx = rowOffset + col;
		let expectedPrice = 0;
		for (let m = 0; m < count; m++) expectedPrice += state.minerals[idx * count + m] * state.mineralPrices[m];
		near(state.prices[idx], expectedPrice, 1e-3);
	}
	ceiling.reset(17);
	ceiling.queueGrowth(1);
	ceiling.grow(0.2);
	const repeatElements = Array.from(state.elements.subarray(rowOffset * 3, (rowOffset + 8) * 3));
	assert.deepEqual(repeatElements, snapshotElements, 'new top rows repeat deterministically for the seed');
	ceiling.reset(1);
});

test('mined bottom rows compact seamlessly, preserve perspective round-trip, and stop at minBottom', () => {
	ceiling.reset(23);
	const state = ceiling.state;
	const columns = state.columns;
	// Clear the bottom 3 rows and leave one falling fragment referencing row 3.
	for (let row = 0; row < 3; row++) for (let col = 0; col < columns; col++) state.strength[row * columns + col] = 0;
	const trackedCol = 40;
	const trackedStrength = state.strength[3 * columns + trackedCol];
	state.active[0] = 1;
	state.debrisCell[0] = 3 * columns + trackedCol;
	state.debrisCells[0] = 1;
	state.debrisX[0] = (trackedCol + 0.5) * state.cell;
	state.debrisY[0] = 9;
	ceiling.queueGrowth(1);
	ceiling.grow(0.2);
	assert.equal(state.baseRow, 3, 'the three empty bottom rows compacted');
	assert.equal(state.rows, state.initialRows - 3 + 1);
	near(state.bottom, state.initialBottom + 2 * state.cell, 1e-9, 'surviving cell world heights shifted by exactly 1 cell');
	near(state.strength[trackedCol], trackedStrength, 1e-6, 'former row 3 is now row 0 without losing strength');
	assert.equal(state.debrisCell[0], trackedCol, 'active debrisCell index shifts with compacted rows');

	// Chamber-anchored perspective stays 1x below initialBottom and round-trips everywhere.
	for (const y of [4.0, 9.5, 11.375, 12.1, 13.6, 14.95]) {
		near(state.rockWorldY(state.rockDrawnY(y)), y, 1e-11);
	}
	near(state.rockScale(8.0), 1, 1e-12);
	near(state.rockScale(state.initialBottom), 1, 1e-12);
	near(state.rockScale(state.top), 0.25, 1e-12);

	// 70% chamber height cap (minBottom = 30% * 15 = 4.5 m): lower intact rock is
	// never destroyed, and no new lines are added once <= 30% h remains below.
	state.active[0] = 0;
	ceiling.reset(23);
	near(state.minBottom, state.top * 0.3, 1e-12);
	const originalRow0Col0 = state.strength[0];
	const maxAllowedRows = Math.round((state.top - state.minBottom) / state.cell);
	ceiling.queueGrowth(120);
	ceiling.grow(30);
	near(state.bottom, state.minBottom, 1e-9, 'descending rock stops right at 30% remaining chamber height');
	assert.equal(state.baseRow, 0, 'no intact bottom row was retired or destroyed');
	assert.equal(state.rows, maxAllowedRows, 'rock spans exactly 70% of chamber height (84 rows)');
	assert.equal(state.generatedRows, maxAllowedRows, 'no extra lines were generated past the 70% limit');
	near(state.strength[0], originalRow0Col0, 1e-6, 'lowest intact cell kept its full strength');
	assert.equal(ceiling.queueGrowth(1), 0, 'new bounces add 0 lines while 30% h remains');
	assert.equal(ceiling.grow(1), false);

	// Once the bottom row is mined clear (> 30% h remains), one new line is accepted again.
	for (let col = 0; col < columns; col++) state.strength[col] = 0;
	near(ceiling.queueGrowth(1), 1, 1e-9, 'clearing 1 bottom row re-opens room for 1 new top row');
	assert.equal(ceiling.grow(0.25), true);
	assert.equal(state.baseRow, 1);
	assert.equal(state.generatedRows, maxAllowedRows + 1);
	near(state.bottom, state.minBottom, 1e-9);
	ceiling.reset(1);
});

test('upper boundary watcher keeps full damage-radius headroom at <= 5 rows/s without conflicting with bounces', () => {
	const equipment = require('../js/equipment.js');
	const research = require('../js/research.js');
	ceiling.reset(29);
	equipment.reset();
	research.reset();
	const state = ceiling.state;
	const columns = state.columns;

	// Carve a shaft up to row 24 (14.375 m), leaving only 5 rows (0.625 m) below y = 15 m,
	// less than stock damageRadius (8.775 rows = 1.096875 m).
	const shaft = 96;
	for (let row = 0; row < 24; row++) state.strength[row * columns + shaft] = 0;
	near(state.upperBoundaryY, state.bottom + 24 * state.cell, 1e-9);
	const expectedDeficitRows = (state.upperBoundaryY + state.damageRadius * state.cell - state.top) / state.cell;
	assert.ok(expectedDeficitRows > 3.7 && expectedDeficitRows < 3.8);

	// Pre-queue 2 bounce rows: watchBoundary tops up only the difference instead of adding 2 + 3.775.
	ceiling.queueGrowth(2);
	near(ceiling.watchBoundary(), expectedDeficitRows, 1e-9, 'bounce and boundary growth share one non-conflicting queue');

	// Rate cap: 0.2 s advances at most 1.0 row (5 rows/s) with smooth geometry.
	const beforeBottom = state.bottom;
	ceiling.grow(0.2);
	near(beforeBottom - state.bottom, 5 * 0.2 * state.cell, 1e-9, 'boundary replenishment never exceeds 5 rows/s');

	// Letting the remainder finish restores exact damageRadius headroom below top = 15 m.
	ceiling.grow(1.5);
	near(state.pendingRows, 0, 1e-9);
	near(state.top - state.upperBoundaryY, state.damageRadius * state.cell, 1e-9, 'full stock damage radius fits inside chamber');

	// Upgrading to the spiked hammer ball widens damageRadius (+1.4 cells) and smoothly adds the extra headroom.
	ceiling.setCommune(true);
	research.grant('materials');
	research.grant('impact');
	assert.equal(equipment.installBall('spike'), true);
	ceiling.setCommune(false);
	assert.ok(state.damageRadius > 10);
	assert.ok(ceiling.watchBoundary() > 1.3, 'wider ball damage radius requests matching extra headroom');
	ceiling.grow(0.5);
	near(state.top - state.upperBoundaryY, state.damageRadius * state.cell, 1e-9, 'spiked ball damage radius fits inside chamber');

	equipment.reset();
	research.reset();
	ceiling.reset(1);
});


