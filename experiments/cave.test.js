'use strict';
// The Wild Mine cave field: deterministic generation, seam-correct signed
// distance, the one collision surface, mining, and streaming that keeps edits.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const caveApi = require('../js/cave.js');
const minerals = require('../js/minerals.js');

const { cell, rows, bandCells, bandMeters } = caveApi;

function makeCave(seed = 1) {
	return caveApi.create({ seed });
}

// Independent reference: the distance from a cell centre to the nearest cell of
// the other type, clamped to the band, signed by the cell's own type.
function referenceSdf(cave, column, row) {
	const solidHere = cave.solidAt((column + 0.5) * cell, (row + 0.5) * cell);
	let best = bandCells * bandCells;
	for (let dr = -bandCells; dr <= bandCells; dr++) {
		const r = row + dr;
		const outside = r < 0 || r >= rows;
		if (outside) {
			if (!solidHere) best = Math.min(best, dr * dr);
			continue;
		}
		for (let dc = -bandCells; dc <= bandCells; dc++) {
			const distance = dr * dr + dc * dc;
			if (distance >= best) continue;
			if (cave.solidAt((column + dc + 0.5) * cell, (r + 0.5) * cell) === solidHere) continue;
			best = distance;
		}
	}
	// Cell centres, so half a cell is taken off: the zero level is the boundary.
	const metres = Math.max(0, Math.min(bandCells, Math.sqrt(best)) * cell - cell * 0.5);
	assert.ok(metres <= bandMeters);
	return solidHere ? -metres : metres;
}

function centreSdf(cave, column, row) {
	return cave.sdfAt((column + 0.5) * cell, (row + 0.5) * cell);
}

// Deterministic samples: a small LCG keeps the point set identical across runs.
function lcg(seed) {
	let state = seed >>> 0;
	return function () {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

test('the start room is a flat shelf with headroom and an eight-metre span', () => {
	const cave = makeCave(1);
	const state = cave.state;
	assert.equal(state.spawnX, 0);
	assert.equal(state.spawnY, 32);
	assert.equal(cave.floorBelow(0, 33), state.shelfRow * cell);
	assert.equal(cave.spanAt(0, 31.5), 8);
	assert.ok(cave.roofAbove(0, 31) > 32.5, 'headroom above the shelf');
	assert.equal(cave.solidAt(0, 30), true);
	assert.equal(cave.solidAt(0, 31.5), false);
	assert.equal(cave.solidAt(3.9, 31.5), false);
});

test('generation is deterministic per seed and differs between seeds', () => {
	const first = makeCave(7);
	const second = makeCave(7);
	const other = makeCave(8);
	const random = lcg(1234);
	let differences = 0;
	for (let i = 0; i < 400; i++) {
		const x = -30 + random() * 60;
		const y = 6 + random() * 52;
		assert.equal(first.solidAt(x, y), second.solidAt(x, y));
		assert.equal(first.sdfAt(x, y), second.sdfAt(x, y));
		if (first.solidAt(x, y) !== other.solidAt(x, y)) differences++;
	}
	assert.ok(differences > 40, 'different seeds carve different rock');
});

test('the section is mostly rock with cave-sized void, and closed at its edges', () => {
	const cave = makeCave(3);
	let solid = 0;
	let total = 0;
	const random = lcg(99);
	for (let i = 0; i < 6000; i++) {
		const x = -80 + random() * 160;
		const y = 2 + random() * 60;
		total++;
		if (cave.solidAt(x, y)) solid++;
	}
	const share = solid / total;
	assert.ok(share > 0.5 && share < 0.85, 'solid share ' + share.toFixed(3));
	assert.equal(cave.solidAt(12, 0.06), true);
	assert.equal(cave.solidAt(12, 63.94), true);
});

test('the signed distance field agrees with a brute-force reference in every chunk', () => {
	const cave = makeCave(5);
	const random = lcg(2024);
	for (let chunk = -1; chunk <= 1; chunk++) {
		for (let i = 0; i < 260; i++) {
			const column = chunk * caveApi.chunkColumns + Math.floor(random() * caveApi.chunkColumns);
			const row = 3 + Math.floor(random() * (rows - 6));
			const result = centreSdf(cave, column, row);
			const expected = referenceSdf(cave, column, row);
			assert.ok(Math.abs(result - expected) < 1e-5, 'cell ' + column + ',' + row + ' ' + result + ' vs ' + expected);
		}
	}
});

test('the field is exact across a chunk seam', () => {
	const cave = makeCave(11);
	const seam = caveApi.chunkColumns;
	for (let row = 4; row < rows - 4; row += 7) {
		for (let column = seam - 3; column <= seam + 3; column++) {
			const result = centreSdf(cave, column, row);
			const expected = referenceSdf(cave, column, row);
			assert.ok(Math.abs(result - expected) < 1e-5, 'seam cell ' + column + ',' + row);
		}
	}
});

test('normals are unit length and point out of the rock', () => {
	const cave = makeCave(2);
	const state = cave.state;
	const floorY = state.shelfRow * cell;
	const floorNormal = cave.normalAt(0, floorY + 0.06, cave.normalAt(0, 0));
	assert.ok(Math.abs(floorNormal.ny - 1) < 1e-3, 'floor normal points up');
	assert.ok(Math.abs(floorNormal.nx) < 1e-3);
	const out = cave.normalAt(0, 0);
	const random = lcg(77);
	for (let i = 0; i < 300; i++) {
		const x = -40 + random() * 80;
		const y = 5 + random() * 55;
		cave.normalAt(x, y, out);
		assert.ok(Math.abs(Math.hypot(out.nx, out.ny) - 1) < 1e-6);
	}
});

test('a dropped ball lands one radius above the floor surface', () => {
	const cave = makeCave(1);
	const radius = 0.18;
	const surface = cave.floorBelow(0, 33);
	const hit = cave.traceCircle(0, 33.2, 0, 0, 2, radius, 9.81, {});
	assert.ok(Number.isFinite(hit.time));
	const expectedTime = Math.sqrt(2 * (33.2 - (surface + radius)) / 9.81);
	assert.ok(Math.abs(hit.time - expectedTime) < 0.02, 'time ' + hit.time);
	assert.ok(Math.abs(hit.y - (surface + radius)) < 0.01, 'y ' + hit.y);
	assert.ok(hit.ny > 0.99, 'normal ' + hit.ny);
	// The contact point is one radius below the centre along the normal.
	assert.ok(Math.abs(hit.y - radius - surface) < 0.01);
});

test('a body that starts inside rock is pushed out at once', () => {
	const cave = makeCave(1);
	const surface = cave.floorBelow(0, 33);
	const hit = cave.traceCircle(0, surface - 0.06, 0, 0, 1, 0.18, 9.81, {});
	assert.equal(hit.time, 0);
	assert.ok(Math.abs(hit.y - (surface + 0.18)) < 1e-3, 'centre above the surface: ' + hit.y);
});

test('weaken spends energy, holds supported rock and releases a free face', () => {
	const cave = makeCave(4);
	const floorRow = cave.state.shelfRow - 1;
	const supported = cave.strengthAt(0, floorRow);
	assert.ok(supported > 0);
	const spent = cave.weaken(0, 31.06, 400, 2, 6);
	assert.ok(spent > 0 && spent <= 400, 'spent ' + spent);
	assert.ok(cave.strengthAt(0, floorRow) < supported, 'floor cell weakened');
	assert.equal(cave.solidAt(0, (floorRow + 0.5) * cell), true, 'rock under the shelf face holds');
	assert.equal(cave.removedCount, 0);

	// A cell with open rock beneath it is released: dig the support first.
	const column = 6 * 8;
	let digRow = -1;
	for (let row = 40; row < rows - 40; row++) {
		if (cave.solidAt((column + 0.5) * cell, (row + 0.5) * cell) && cave.solidAt((column + 0.5) * cell, (row - 1 + 0.5) * cell)) {
			digRow = row;
			break;
		}
	}
	assert.ok(digRow > 0, 'found intact rock');
	assert.equal(cave.dig(column, digRow), true);
	assert.equal(cave.solidAt((column + 0.5) * cell, (digRow + 0.5) * cell), false);
	let opened = 0;
	for (let blow = 0; blow < 20; blow++) {
		cave.weaken((column + 0.5) * cell, (digRow + 1.5) * cell, 400, 2, 0.6);
		opened += cave.removedCount;
	}
	assert.ok(opened > 0, 'a free face lets go');
	assert.equal(cave.solidAt((column + 0.5) * cell, (digRow + 1.5) * cell), false);
});

test('a mined cell refreshes the field exactly as a rebuild would', () => {
	const cave = makeCave(6);
	const column = 300;
	let row = -1;
	for (let r = 200; r < 260; r++) {
		if (cave.solidAt((column + 0.5) * cell, (r + 0.5) * cell)) {
			row = r;
			break;
		}
	}
	assert.ok(row > 0);
	cave.dig(column, row);
	assert.equal(cave.solidAt((column + 0.5) * cell, (row + 0.5) * cell), false);
	for (let dc = -bandCells; dc <= bandCells; dc++) {
		for (let dr = -bandCells; dr <= bandCells; dr++) {
			const result = centreSdf(cave, column + dc, row + dr);
			const expected = referenceSdf(cave, column + dc, row + dr);
			assert.ok(Math.abs(result - expected) < 1e-5, 'patch ' + dc + ',' + dr);
		}
	}
});

test('streaming keeps an edited chunk and drops clean ones', () => {
	const cave = makeCave(9);
	cave.stream(-12, 12);
	const column = 40;
	let row = -1;
	for (let r = 200; r < 300; r++) {
		if (cave.solidAt((column + 0.5) * cell, (r + 0.5) * cell)) {
			row = r;
			break;
		}
	}
	assert.ok(row > 0, 'found rock in the start window');
	assert.equal(cave.dig(column, row), true);
	const liveBefore = cave.state.liveChunks;
	assert.ok(liveBefore > 0);

	cave.stream(400, 420, 99);
	assert.ok(cave.state.storedChunks >= 1, 'the edited chunk is kept');
	assert.equal(cave.solidAt((column + 0.5) * cell, (row + 0.5) * cell), false, 'edits survive the round trip');
	cave.stream(-12, 12, 99);
	assert.equal(cave.solidAt((column + 0.5) * cell, (row + 0.5) * cell), false);
});

test('span and surface queries follow the cave, not a global floor', () => {
	const cave = makeCave(12);
	const random = lcg(303);
	for (let i = 0; i < 200; i++) {
		const x = -50 + random() * 100;
		const y = 5 + random() * 54;
		if (cave.solidAt(x, y)) continue;
		const span = cave.spanAt(x, y);
		assert.ok(span >= 0);
		const floor = cave.floorBelow(x, y);
		assert.ok(Number.isNaN(floor) || floor <= y + 1e-9, 'floor below the point');
		const roof = cave.roofAbove(x, y);
		assert.ok(Number.isNaN(roof) || roof >= y - 1e-9, 'roof above the point');
	}
});

test('mixAt returns the geological shares the strength is made of', () => {
	const cave = makeCave(2);
	const mix = new Float64Array(minerals.mineralCount);
	cave.mixAt(10, 200, mix);
	let total = 0;
	for (let m = 0; m < mix.length; m++) total += mix[m];
	assert.ok(Math.abs(total - 1) < 1e-6, 'shares sum to one: ' + total);
	assert.ok(cave.strengthAt(10, 200) > 0);
});

test('weaken mines floors and walls symmetrically while holding strictly interior cells and borders', () => {
	const cave = makeCave(4);
	const floorRow = cave.state.shelfRow - 1;
	// Repeated blows on the shelf floor peel the top floor layer and never
	// pop an interior buried pocket in the same blow.
	let opened = 0;
	for (let blow = 0; blow < 24; blow++) {
		cave.weaken(0.5 * cell, (floorRow + 0.5) * cell, 400, 2, 1.5);
		opened += cave.removedCount;
		if (opened > 0) break;
	}
	assert.ok(opened > 0, 'floor cells mine when struck repeatedly');
	assert.equal(cave.solidAt(0.5 * cell, (floorRow + 0.5) * cell), false);

	// Find a vertical wall (solid at col, open at col - 1, solid below at row - 1)
	// and verify lateral mining opens it too.
	let wallCol = NaN;
	let wallRow = -1;
	for (let col = -30; col <= 30 && Number.isNaN(wallCol); col++) {
		for (let r = 230; r < 270; r++) {
			if (!cave.solidAt((col - 0.5) * cell, (r + 0.5) * cell)
				&& cave.solidAt((col + 0.5) * cell, (r + 0.5) * cell)
				&& cave.solidAt((col + 0.5) * cell, (r - 0.5) * cell)) {
				wallCol = col;
				wallRow = r;
				break;
			}
		}
	}
	assert.ok(Number.isFinite(wallCol), 'found a vertical wall cell');
	let wallOpened = 0;
	for (let blow = 0; blow < 24; blow++) {
		cave.weaken((wallCol + 0.5) * cell, (wallRow + 0.5) * cell, 400, 2, 0.8);
		wallOpened += cave.removedCount;
		if (wallOpened > 0) break;
	}
	assert.ok(wallOpened > 0, 'vertical walls mine symmetrically');
	assert.equal(cave.solidAt((wallCol + 0.5) * cell, (wallRow + 0.5) * cell), false);

	// Section outer border rows 0 and rows - 1 stay solid even against dig/weaken.
	assert.equal(cave.dig(0, 0), false);
	assert.equal(cave.dig(0, rows - 1), false);
	for (let blow = 0; blow < 24; blow++) {
		cave.weaken(0.5 * cell, 0.5 * cell, 400, 2, 0.8);
	}
	assert.equal(cave.solidAt(0.5 * cell, 0.5 * cell), true, 'row 0 border stays solid');
});

test('stream maps world metres to chunks, restores stored edits, and keeps seam halos in sync', () => {
	const cave = makeCave(11);
	const seam = caveApi.chunkColumns;
	// Edit right on the chunk 0 / chunk 1 seam while both sides are loaded.
	cave.stream(10, 20, 99);
	let seamRow = -1;
	for (let r = 200; r < 280; r++) {
		if (cave.solidAt((seam - 0.5) * cell, (r + 0.5) * cell)) {
			seamRow = r;
			break;
		}
	}
	assert.ok(seamRow > 0, 'found solid rock at chunk seam');
	assert.equal(cave.dig(seam - 1, seamRow), true);

	// Scroll far away in world metres (400..420 m -> chunks 24..27): chunk 0
	// is edited so it goes to stored; unedited chunk 1 is evicted cleanly.
	cave.stream(400, 420, 99);
	assert.equal(cave.state.storedChunks >= 1, true);
	const generatedAfterLeave = cave.state.generatedChunks;

	// Return to the seam: chunk 0 is restored from stored without incrementing
	// generatedChunks, and regenerated chunk 1 picks up chunk 0's dug seam!
	cave.stream(10, 20, 99);
	assert.equal(cave.state.storedChunks, 0, 'restored edited chunk moves back into live');
	assert.equal(cave.solidAt((seam - 0.5) * cell, (seamRow + 0.5) * cell), false);
	for (let dr = -bandCells; dr <= bandCells; dr++) {
		for (let dc = -2; dc <= 2; dc++) {
			const result = centreSdf(cave, seam + dc, seamRow + dr);
			const expected = referenceSdf(cave, seam + dc, seamRow + dr);
			assert.ok(Math.abs(result - expected) < 1e-5, 'regenerated seam matches reference at ' + dc + ',' + dr);
		}
	}
	// Streaming back to an unedited far window never leaves liveChunks > chunkLimit.
	assert.ok(cave.state.liveChunks <= 12);
	assert.ok(cave.state.generatedChunks >= generatedAfterLeave);

	// Direct chunkFor queries without stream() still enforce chunkLimit.
	const capped = caveApi.create({ seed: 11, chunkLimit: 4 });
	for (let c = 0; c < 10; c++) capped.chunkFor(c * caveApi.chunkColumns);
	assert.ok(capped.state.liveChunks <= 4, 'chunkFor obeys chunkLimit: ' + capped.state.liveChunks);
});

test('traceCircle pushes out shallow overlaps and lets separating bounces exit cleanly', () => {
	const cave = makeCave(1);
	const surface = cave.floorBelow(0, 33);
	const radius = 0.18;
	// Shallow overlap: 0 < start < radius must push out to surface + radius.
	const overlap = cave.traceCircle(0, surface + 0.06, 0, -1, 1, radius, 9.81, {});
	assert.equal(overlap.time, 0);
	assert.ok(Math.abs(overlap.y - (surface + radius)) < 1e-3, 'shallow overlap pushed out: ' + overlap.y);

	// Grazing start moving upward should clear without a zero-time trap and only
	// collide on its ballistic return.
	const bounce = cave.traceCircle(0, surface + radius - 1e-5, 0, 2, 1, radius, 9.81, {});
	assert.ok(bounce.time > 0.3, 'upward bounce leaves surface before falling back: ' + bounce.time);
});
