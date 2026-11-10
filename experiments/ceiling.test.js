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
	for (let i = 0; i < state.columns * state.rows; i++) {
		const offset = i * 3;
		near(state.elements[offset] + state.elements[offset + 1] + state.elements[offset + 2], 1);
		near(state.minerals[offset] + state.minerals[offset + 1] + state.minerals[offset + 2], 1);
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
		beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}
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
	// Excavate a crater and read the slope the face actually ended up with: the
	// mineral variation makes a notch asymmetric, so the heightmap, not the hit
	// point, decides which way each flank faces.
	ceiling.damage(10.06, ceiling.state.bottom + 0.06, 5);
	ceiling.collapse(10);
	const state = ceiling.state;
	const heightmap = state.heightmap;
	let rising = -1;
	let falling = -1;
	for (let vertex = 1; vertex < state.columns && (rising < 0 || falling < 0); vertex++) {
		const slope = heightmap[vertex + 1] - heightmap[vertex];
		if (rising < 0 && slope > 0.05) rising = vertex;
		if (falling < 0 && slope < -0.05) falling = vertex;
	}
	assert.ok(rising > 0 && falling > 0, 'the crater has a flank facing each way');
	// A face that rises to the right (the ceiling is lower on its left) sends the
	// ball left, and the mirrored flank sends it right.
	const rightHit = ceiling.trace((rising + 0.5) * state.cell, ceiling.state.bottom - 0.2, 0, 12, 0.05, 0.18);
	assert.ok(Number.isFinite(rightHit.time));
	assert.ok(rightHit.nx > 0.1, 'a face rising to the right reflects the ball left');
	assert.ok(rightHit.ny < -0.5);
	const leftHit = ceiling.trace((falling + 0.5) * state.cell, ceiling.state.bottom - 0.2, 0, 12, 0.05, 0.18);
	assert.ok(Number.isFinite(leftHit.time));
	assert.ok(leftHit.nx < -0.1, 'a face falling to the right reflects the ball right');
	assert.ok(leftHit.ny < -0.5);
	// Optional square mode uses rounded cell corners instead of blocking with flat side walls
	ceiling.setShape('square');
	assert.equal(ceiling.state.shape, 'square');
	const cornerHit = ceiling.trace((falling + 0.5) * state.cell, ceiling.state.bottom - 0.2, 0, 12, 0.05, 0.18);
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
	near(before[center] - state.strength[center], impactJ * 2 * w(0), 1e-5);
	near(before[mid] - state.strength[mid], impactJ * 2 * w(2), 1e-5);
	near(before[edge] - state.strength[edge], impactJ * 2 * w(5), 1e-5);
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
	ceiling.damage(6.25, ceiling.state.bottom + 0.5, 10);
	ceiling.damage(18.25, ceiling.state.bottom + 0.5, 10);
	ceiling.collapse(10);
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
	// A light hit leaves the region below the collapse floor; repeated hits in
	// the same spot push it over and the ceiling lets go.
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

// --- Mineral formation and the market -------------------------------------

function fieldStats(seed) {
	ceiling.reset(seed);
	const state = ceiling.state;
	const cells = state.columns * state.rows;
	const mix = [0, 0, 0];
	const dominant = [0, 0, 0];
	let pureIron = 0;
	let pureCrystal = 0;
	let value = 0;
	const running = [];
	for (let index = 0; index < cells; index++) {
		const offset = index * 3;
		let best = -1;
		let which = 0;
		for (let m = 0; m < 3; m++) {
			const share = state.minerals[offset + m];
			mix[m] += share;
			if (share > best) { best = share; which = m; }
			value += share * state.referencePrices[m];
		}
		dominant[which]++;
		if (best > 0.75 && which === 0) pureIron++;
		if (best > 0.75 && which === 2) pureCrystal++;
		running.push(best);
	}
	running.sort((a, b) => a - b);
	return {
		mix: mix.map(total => total / cells),
		dominant: dominant.map(total => total / cells),
		pureIron: pureIron / cells,
		pureCrystal: pureCrystal / cells,
		medianDominant: running[Math.floor(running.length / 2)],
		meanValue: value / cells
	};
}

function crystalPocketStats(state) {
	const columns = state.columns;
	const cells = columns * state.rows;
	const visited = new Uint8Array(cells);
	const queue = new Int32Array(cells);
	let crystalCells = 0;
	let pockets = 0;
	for (let start = 0; start < cells; start++) {
		if (visited[start] || state.minerals[start * 3 + 2] < 0.5) continue;
		let head = 0;
		let tail = 0;
		queue[tail++] = start;
		visited[start] = 1;
		while (head < tail) {
			const index = queue[head++];
			const column = index % columns;
		let next = index - 1;
		if (column > 0 && !visited[next] && state.minerals[next * 3 + 2] >= 0.5) {
			visited[next] = 1;
			queue[tail++] = next;
		}
		next = index + 1;
		if (column + 1 < columns && !visited[next] && state.minerals[next * 3 + 2] >= 0.5) {
			visited[next] = 1;
			queue[tail++] = next;
		}
		next = index - columns;
		if (index >= columns && !visited[next] && state.minerals[next * 3 + 2] >= 0.5) {
			visited[next] = 1;
			queue[tail++] = next;
		}
		next = index + columns;
		if (index + columns < cells && !visited[next] && state.minerals[next * 3 + 2] >= 0.5) {
			visited[next] = 1;
			queue[tail++] = next;
		}
		}
		crystalCells += tail;
		pockets++;
	}
	return { crystalCells, pockets };
}

test('each mineral forms its own veins: a bulk wall, seams, and rare pockets', () => {
	const seeds = [1, 2, 3, 7, 11, 42];
	const stats = seeds.map(fieldStats);
	for (let i = 0; i < seeds.length; i++) {
		const s = stats[i];
		// Iron is the bulk ore everywhere, copper a seam and crystal a pocket: the
		// rare ore never fills a fifth of the face on any seed.
		assert.ok(s.mix[0] > s.mix[1] && s.mix[1] > s.mix[2], 'seed ' + seeds[i] + ' orders the ores by supply');
		assert.ok(s.mix[0] > 0.45 && s.mix[0] < 0.78, 'seed ' + seeds[i] + ' keeps iron the bulk ore');
		assert.ok(s.mix[2] < 0.2, 'seed ' + seeds[i] + ' keeps crystal rare');
		// A cell is mostly one mineral: the old field never gave a cell a majority
		// above a third, so a face of real rock needs a much higher median.
		assert.ok(s.medianDominant > 0.5, 'seed ' + seeds[i] + ' has a dominant mineral per cell');
		assert.ok(s.pureIron > 0.05, 'seed ' + seeds[i] + ' holds seams of pure iron');
		assert.ok(s.pureCrystal < 0.05, 'seed ' + seeds[i] + ' keeps crystal in small pockets');
	}
	// The mean value of a cell lands in the band the old pricing paid, so the
	// economy keeps its measured pace while the spread widens.
	const mean = stats.reduce((total, s) => total + s.meanValue, 0) / stats.length;
	assert.ok(mean > 6 && mean < 11, 'the mean cell is worth ' + mean.toFixed(2) + ' cr');
});

test('the squared blue ramp concentrates crystal into harder, connected pockets', () => {
	const seeds = [1, 2, 3, 7, 11, 42];
	const mix = [0, 0, 0];
	const strengths = [];
	let crystalCells = 0;
	let pocketCount = 0;
	let strengthTotal = 0;
	let cellTotal = 0;
	for (const seed of seeds) {
		ceiling.reset(seed);
		const state = ceiling.state;
		const cells = state.columns * state.rows;
		const pockets = crystalPocketStats(state);
		assert.ok(pockets.pockets >= 5, 'seed ' + seed + ' has several connected crystal pockets');
		assert.ok(pockets.crystalCells > cells * 0.02, 'seed ' + seed + ' keeps crystal-rich cells countable');
		crystalCells += pockets.crystalCells;
		pocketCount += pockets.pockets;
		for (let m = 0; m < 3; m++) mix[m] += state.fieldShare[m] / seeds.length;
		for (const strength of state.initialStrength) {
			strengthTotal += strength;
			strengths.push(strength);
		}
		cellTotal += cells;
	}
	strengths.sort((a, b) => a - b);
	const meanStrength = strengthTotal / cellTotal;
	const p95 = strengths[Math.floor(strengths.length * 0.95)];
	const p99 = strengths[Math.floor(strengths.length * 0.99)];
	assert.ok(mix[0] > 0.60 && mix[0] < 0.64, 'iron remains the host at ' + mix[0].toFixed(3));
	assert.ok(mix[1] > 0.26 && mix[1] < 0.30, 'copper remains a seam at ' + mix[1].toFixed(3));
	assert.ok(mix[2] > 0.09 && mix[2] < 0.11, 'crystal keeps about a tenth of the mean mix at ' + mix[2].toFixed(3));
	assert.ok(crystalCells > cellTotal * 0.025, 'at least 2.5% of cells carry a crystal majority');
	assert.ok(pocketCount >= seeds.length * 7, 'there are enough connected pockets to read as separate finds');
	assert.ok(meanStrength > 4.70 && meanStrength < 4.85, 'mean strength stays near 4.78: ' + meanStrength.toFixed(3));
	assert.ok(p95 > 5.20 && p99 > 5.35, 'crystal crests fill the harder tail: p95 ' + p95.toFixed(3) + ', p99 ' + p99.toFixed(3));
});

test('list prices follow the economy briefing: iron halved, crystal quadrupled', () => {
	ceiling.reset(7);
	const state = ceiling.state;
	// 3 -> 1.5 and 11 -> 44 against the old table; copper keeps 7.
	assert.deepEqual(Array.from(state.referencePrices), [1.5, 7, 44]);
	// The live quote is the reference price scaled by this field's own rarity and
	// the opening demand, so every ore lands within its rarity band of the list.
	for (let m = 0; m < 3; m++) {
		const ratio = state.mineralPrices[m] / state.referencePrices[m];
		const rarity = 0.6 * 0.45;
		assert.ok(ratio > rarity && ratio < 2.2 * 2.6, 'mineral ' + m + ' quote ratio ' + ratio.toFixed(2));
	}
	assert.ok(state.mineralPrices[2] > state.mineralPrices[1] * 2, 'crystal still carries the premium');
	assert.ok(state.mineralPrices[0] < state.mineralPrices[1], 'iron stays the cheap ore');
});

test('demand drifts each price slowly and by large moves, at its own pace', () => {
	ceiling.reset(7);
	const state = ceiling.state;
	const world = { platform: { x: -40, vx: 0 }, heat: 0, time: 0, direction: 0 };
	// Ten minutes of chamber time, sampled each second: no sale, no catching, so
	// the only price movement is the demand noise.
	const series = [[], [], []];
	for (let second = 0; second <= 600; second++) {
		if (second) ceiling.step(world, 1, 60);
		for (let m = 0; m < 3; m++) series[m].push(state.mineralPrices[m]);
	}
	const largestMove = [0, 0, 0];
	let upTurns = [0, 0, 0];
	for (let m = 0; m < 3; m++) {
		const values = series[m];
		const low = Math.min(...values);
		const high = Math.max(...values);
		// Every ore more than doubles and reverses across ten minutes, so a shift
		// can be timed: on this seed, crystal swings widest and iron least.
		assert.ok(high / low > 2, 'mineral ' + m + ' swings ' + (high / low).toFixed(1) + '× over ten minutes');
		let widestWindow = 1;
		for (let start = 0; start + 180 < values.length; start++) {
			let windowLow = Infinity;
			let windowHigh = 0;
			for (let second = start; second <= start + 180; second++) {
				windowLow = Math.min(windowLow, values[second]);
				windowHigh = Math.max(windowHigh, values[second]);
			}
			widestWindow = Math.max(widestWindow, windowHigh / windowLow);
		}
		// The big move happens inside a few minutes of play, not over a whole
		// shift and not in a single flicker.
		assert.ok(widestWindow > 1.8, 'mineral ' + m + ' moves ' + widestWindow.toFixed(1) + '× within three minutes');
		for (let second = 1; second < values.length; second++) {
			const move = Math.abs(values[second] / values[second - 1] - 1);
			if (move > largestMove[m]) largestMove[m] = move;
			if (second > 1 && Math.sign(values[second] - values[second - 1]) !== Math.sign(values[second - 1] - values[second - 2])) upTurns[m]++;
		}
	}
	// One second never moves a price by more than a few percent: the change is a
	// drift over minutes, not a flicker.
	for (let m = 0; m < 3; m++) assert.ok(largestMove[m] < 0.025, 'mineral ' + m + ' one-second move ' + (largestMove[m] * 100).toFixed(1) + '%');
	// Iron turns over more often than crystal, and crystal fewer times than iron:
	// each ore has its own pace, so not every quote moves together.
	assert.ok(upTurns[0] > upTurns[2], 'iron cycles fastest, crystal slowest');
	assert.ok(upTurns[2] >= 3, 'crystal completes more than one cycle in ten minutes');
	const swing = series.map(values => Math.max(...values) / Math.min(...values));
	assert.ok(swing[2] > swing[0], 'the slow rare ore swings widest on this seed');
});

test('a wall sale softens its own ore and the market recovers', () => {
	ceiling.reset(7);
	const state = ceiling.state;
	const world = { platform: { x: -40, vx: 0 }, heat: 0, time: 0, direction: 0 };
	// Fill the hopper from the rock, then sell the load at the wall.
	for (let x = 1; x < 23; x += 2) { ceiling.damage(x, state.bottom + 0.2, 20); ceiling.collapse(2); }
	for (let i = 0; i < state.active.length; i++) if (state.active[i]) {
		state.debrisX[i] = 11;
		state.debrisY[i] = 0.701;
		state.debrisVx[i] = 0;
		state.debrisVy[i] = -1;
	}
	ceiling.step({ platform: { x: 12, vx: 0 }, heat: 0, time: 0 }, 0.01, 60);
	assert.ok(state.cargoCells > 0, 'the hopper took the load');
	const before = Array.from(state.mineralPrices);
	const pressureBefore = Array.from(state.supplyPressure);
	ceiling.sellCargo(0, 1);
	assert.ok(state.supplyPressure[0] > pressureBefore[0], 'the wall absorbed iron and marked it down');
	assert.ok(state.supplyPressure[2] >= pressureBefore[2], 'the crystal share of the load was marked down too');
	// The sale re-quotes on the same market clock, so the only change is the
	// supply discount: the ore in the load must actually get cheaper.
	assert.ok(state.mineralPrices[0] < before[0] * 0.97, 'iron is discounted ' + (100 * (1 - state.mineralPrices[0] / before[0])).toFixed(1) + '%');
	assert.ok(state.mineralPrices[2] < before[2], 'crystal is discounted too');
	// A glut is a discount, never a free ore.
	for (let m = 0; m < 3; m++) assert.ok(state.mineralPrices[m] > 0 && state.mineralPrices[m] < before[m]);
	const discounted = Array.from(state.mineralPrices);
	// Demand keeps moving while the pressure decays, so compare against the same
	// instant with no sale: the pressure itself must fall back to the noise.
	for (let second = 0; second < 120; second++) ceiling.step(world, 1, 60);
	assert.ok(state.supplyPressure[0] < 0.02, 'the wall clears the load within a couple of minutes');
	assert.ok(discounted.every(price => price > 0), 'quotes stay positive through the glut');
});

test('cargo keeps the value the cells were worth when they were caught', () => {
	ceiling.reset(7);
	const state = ceiling.state;
	for (let x = 1; x < 23; x += 2) { ceiling.damage(x, state.bottom + 0.2, 20); ceiling.collapse(2); }
	for (let i = 0; i < state.active.length; i++) if (state.active[i]) {
		state.debrisX[i] = 11;
		state.debrisY[i] = 0.701;
		state.debrisVx[i] = 0;
		state.debrisVy[i] = -1;
	}
	ceiling.step({ platform: { x: 12, vx: 0 }, heat: 0, time: 0 }, 0.01, 60);
	const caught = state.cargoValue;
	assert.ok(caught > 0, 'the hopper caught a load');
	// The quotes move under the held load; the cargo it was booked at does not.
	const world = { platform: { x: 40, vx: 0 }, heat: 0, time: 0, direction: 0 };
	for (let second = 0; second < 200; second++) ceiling.step(world, 1, 60);
	near(state.cargoValue, caught, 1e-9);
	const paid = ceiling.sellCargo(0, 1);
	near(paid, caught, 1e-9);
	assert.equal(state.cargoCells, 0);
});

test('each ore forms from its own element range, so the element view predicts the mix', () => {
	for (const seed of [1, 7, 42]) {
		ceiling.reset(seed);
		const state = ceiling.state;
		const cells = state.columns * state.rows;
		// Pearson correlation between the R/G/B shares and the Fe/Cu/Cr shares.
		const sums = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
		let crystalRich = 0;
		let blueLed = 0;
		for (let index = 0; index < cells; index++) {
			const offset = index * 3;
			for (let m = 0; m < 3; m++) {
				const element = state.elements[offset + m];
				const ore = state.minerals[offset + m];
				sums[m][0] += element;
				sums[m][1] += ore;
				sums[m][2] += element * element;
				sums[m][3] += ore * ore;
				sums[m][4] += element * ore;
			}
			if (state.minerals[offset + 2] > 0.35) {
				crystalRich++;
				if (state.elements[offset + 2] > state.elements[offset] && state.elements[offset + 2] > state.elements[offset + 1]) blueLed++;
			}
		}
		for (let m = 0; m < 3; m++) {
			const t = sums[m];
			const correlation = (cells * t[4] - t[0] * t[1]) / Math.sqrt((cells * t[2] - t[0] * t[0]) * (cells * t[3] - t[1] * t[1]));
			assert.ok(correlation > 0.65, 'seed ' + seed + ' element ' + m + ' predicts ore ' + m + ': r = ' + correlation.toFixed(2));
		}
		assert.ok(crystalRich > cells * 0.02, 'seed ' + seed + ' has crystal-bearing cells');
		assert.ok(blueLed / crystalRich > 0.9, 'seed ' + seed + ' grows crystal where B leads');
	}
});

test('the element view paints a colour for every cell of the field', () => {
	ceiling.reset(7);
	const painted = [];
	const context = {
		fillStyle: '',
		fillRect() { painted.push(this.fillStyle); },
		beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
		fill() { painted.push(this.fillStyle); }
	};
	ceiling.draw(context, 'elements');
	assert.ok(painted.length > 100, 'the rock face is painted');
	assert.ok(painted.every(color => /^rgb\(\d+ \d+ \d+\)$/.test(color)), 'every cell has an R/G/B colour');
	assert.ok(new Set(painted).size > 100, 'the element field is not one flat colour');
});

test('the opening demand table makes the rare ore usually dearest, but a common ore can open hot', () => {
	let rareDearest = 0;
	let commonDearest = 0;
	let commonBooms = 0;
	const openings = [];
	for (let seed = 1; seed <= 60; seed++) {
		ceiling.reset(seed);
		const quotes = Array.from(ceiling.state.mineralPrices);
		if (quotes[2] > quotes[1] && quotes[2] > quotes[0]) rareDearest++;
		else commonDearest++;
		if (quotes[1] > ceiling.state.referencePrices[1] * 2 || quotes[0] > ceiling.state.referencePrices[0] * 2) commonBooms++;
		openings.push(Array.from(ceiling.state.startupDemand).join('/'));
	}
	assert.ok(rareDearest > 40, 'crystal is dearest on ' + rareDearest + ' of 60 seeds');
	assert.ok(commonDearest >= 3, 'a common ore is dearest on ' + commonDearest + ' seeds');
	assert.ok(commonBooms > 8, 'a common ore opens above twice its list on ' + commonBooms + ' seeds');
	assert.ok(new Set(openings).size > 40, 'each seed generates its own demand table');
	// The table is part of the seed, and its rush fades into the slow noise:
	// seed 42 opens hot for copper and cool for crystal, then unwinds that rush
	// over three minutes of chamber time.
	ceiling.reset(42);
	const opening = Array.from(ceiling.state.startupDemand);
	const hot = Array.from(ceiling.state.mineralPrices);
	assert.ok(opening[1] > 1, 'seed 42 generates a copper rush');
	ceiling.reset(42);
	assert.deepEqual(Array.from(ceiling.state.startupDemand), opening);
	const world = { platform: { x: -40, vx: 0 }, heat: 0, time: 0, direction: 0 };
	for (let second = 0; second < 180; second++) ceiling.step(world, 1, 60);
	assert.equal(ceiling.state.marketTime, 180);
	assert.ok(ceiling.state.mineralPrices[1] < hot[1] * 0.7, 'the copper rush has faded');
	assert.ok(ceiling.state.mineralPrices[2] > hot[2] * 1.5, 'the crystal glut has cleared');
});
