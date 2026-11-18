'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { ceiling, near } = require('./harness.cjs');
const mine = require('../js/wild-mine.js');
const rubble = require('../js/wild-rubble.js');

function field() {
	mine.setMode('wild');
	return mine.init(null, { seed: 1 });
}

afterEach(() => {
	mine.setMode('classic');
	ceiling.setFloorCompression(4);
});

test('one bin makes a filled five-column crest across a chunk seam; ground and swept contact read the drawn segments', () => {
	const cave = field();
	const cell = cave.state.cell, column = -1;
	const x = cave.worldX(column), y = cave.state.spawnY;
	const face = cave.floorBelow(x, y);
	rubble.deposit(x, y, 1, 10);
	rubble.deposit(x, y, 3, 14);
	const weights = [0, 1, 3, 3, 1, 0];
	for (const compression of [1.5, 1, 8]) {
		ceiling.setFloorCompression(compression);
		const height = 4 * cell / compression;
		let count = 0;
		rubble.eachStrip(column - 4, column + 4, (c, strip) => {
			const i = c - (column - 2);
			assert.equal(i, count++);
			near(strip.base, face);
			near(strip.left, face + weights[i] * height / 8);
			near(strip.right, face + weights[i + 1] * height / 8);
			const px = (c + 0.25) * cell;
			const crest = strip.left + 0.25 * (strip.right - strip.left);
			near(mine.groundAt(px, y), crest);
			const s = rubble.surfaceAt(px, y);
			near(-s.nx / s.ny, (strip.right - strip.left) / cell);
			const radius = 0.18;
			const hit = rubble.traceCrest(px, crest + radius + 0.25, 0, -1, 0.5, radius, 0);
			near(hit.time, 0.25, 2e-5);
			near(hit.crest, crest);
			near(hit.y - radius, crest, 2e-5);
		});
		assert.equal(count, 5, 'the visible taper includes columns with no bin');
		assert.equal(rubble.state().segments, 1, 'two deposits share one material bin');
		near(rubble.state().cells, 4);
		near(rubble.state().value, 24);
	}
	// Cut a slot between the source and its right shoulder. Even before a
	// draw (or a query in the cut column), the far side no longer sees soil.
	cave.dig(column + 1, cave.state.shelfRow - 1);
	cave.dig(column + 1, cave.state.shelfRow - 2);
	near(rubble.heightAt(cave.worldX(column + 2), y), 0);
	near(rubble.heightAt(cave.worldX(column + 1), y), 0);
	cave.stream(400, 420, 99);
	cave.stream(-10, 10, 99);
	assert.ok(rubble.heightAt(x, y) > 0, 'the seam pile survives a streaming round trip');
});

test('soil fills the low side of a rock step and joins at a shared vertex once the step is buried', () => {
	const cave = field(), c = 1, cell = cave.state.cell, y = 32;
	const upper = cave.floorBelow(0, y);
	cave.dig(c, cave.state.shelfRow - 1);
	assert.equal(rubble.crestAt(cave.worldX(c), y), upper - cell, 'no rounding of bare rock');
	rubble.deposit(cave.worldX(c), y, 0.5, 4);
	assert.equal(rubble.heightAt(cave.worldX(c + 1), y), 0, 'a dusting is still below the lip');
	rubble.deposit(cave.worldX(c), y, 6, 48);
	let right = NaN, count = 0;
	rubble.eachStrip(c - 1, c + 1, (column, strip) => {
		assert.equal(column, c - 1 + count++);
		if (column !== c - 1) {
			near(strip.left, right);
			assert.ok(strip.left > upper, 'the crest clears the step on both sides');
		}
		right = strip.right;
	});
	assert.equal(count, 3);
	near(rubble.state().cells, 6.5);
});

test('stacked caves harvest independently and undermining a loaded ledge merges its material onto the next face', () => {
	const cave = field();
	const cell = cave.state.cell, c = -3, x = cave.worldX(c);
	const top = cave.state.shelfRow - 1;
	for (const r of [top - 1, top - 2]) cave.dig(c, r);
	const lowerY = cave.worldY(top - 1), upperY = cave.worldY(top + 1);
	const lowerFace = (top - 2) * cell;
	rubble.deposit(x, lowerY, 2, 20);
	const lowerCrest = rubble.crestAt(x, lowerY);
	rubble.deposit(x, upperY, 3, 60);
	near(rubble.crestAt(x, lowerY), lowerCrest);
	assert.ok(rubble.crestAt(x, upperY) > (top + 1) * cell);
	const cut = rubble.harvest(x, 0, cell, 0.5, {}, lowerY);
	near(cut.value, 5);
	near(cut.cells, 0.5);
	assert.equal(rubble.state().segments, 2);
	cave.dig(c, top);
	const state = rubble.state(); // no draw or physics query needed to settle
	assert.equal(state.collapseCount, 1);
	assert.equal(state.segments, 1);
	near(state.cells, 4.5);
	near(state.value, 75);
	near(state.lostCells, 0);
	const s = rubble.surfaceAt(x, upperY);
	near(s.face, lowerFace);
	near(s.height, state.cells * ceiling.state.floorCellHeight, 1e-10);
	near(rubble.heightAt(cave.worldX(c + 1), upperY), 0, 1e-10);
});

test('an offset floating shelf is not a stair even when the lower pile reaches its elevation', () => {
	const cave = field(), top = cave.state.shelfRow - 1, c = 4;
	cave.dig(c, top - 1); // an intact rock lip with air under it
	cave.dig(c + 1, top); // the exposed rock next door touches it only at a corner
	rubble.deposit(cave.worldX(c + 1), 32, 8, 16);
	assert.equal(rubble.heightAt(cave.worldX(c), 32), 0);
	rubble.deposit(cave.worldX(c), 32, 0.25, 1);
	assert.ok(rubble.heightAt(cave.worldX(c), 32) > 0, 'even a thin layer can stay on the lip');
	near(rubble.heightAt(cave.worldX(c), cave.worldY(top - 1)), 0);
});

test('every exposed shelf can carry a pile, limited by its local overhang on deposit and decompression', () => {
	const cave = field();
	const c = 4, x = cave.worldX(c), top = cave.state.shelfRow - 1, cell = cave.state.cell;
	ceiling.setFloorCompression(8);
	for (let i = 0; i < 6; i++) {
		const pocket = top - 1 - i * 2;
		cave.dig(c, pocket);
		rubble.deposit(x, cave.worldY(pocket), 10, 30);
		near(rubble.crestAt(x, cave.worldY(pocket)), (pocket + 1) * cell);
	}
	assert.equal(rubble.state().segments, 6);
	near(rubble.state().cells, 48);
	near(rubble.state().lostCells, 12);
	ceiling.setFloorCompression(1);
	const s = rubble.state();
	near(s.cells, 6);
	near(s.value, 18);
	near(s.lostCells + s.cells, s.depositedCells);
	near(s.lostValue + s.value, s.depositedValue);
	rubble.eachStrip(c, c, (_, strip) => {
		near(strip.left, strip.base + cell);
		near(strip.right, strip.left);
	});
	mine.init(null, { seed: 2 });
	assert.equal(rubble.state().segments, 0);
	near(rubble.heightAt(x, 32), 0);
});

test('grader transports cells and value together, including onto bare neighbouring bins, and pays only for the cut', () => {
	const cave = field();
	const y = cave.floorBelow(0, 32);
	rubble.deposit(cave.worldX(0), y, 10, 50);
	rubble.deposit(cave.worldX(1), y, 2, 60);
	const world = { platform: { x: 0, y, vx: 1 }, direction: 1, time: 1 };
	rubble.grade(world, 0.5);
	assert.ok(rubble.state().segments > 2, 'material flows into a previously empty column');
	let cells = 0, value = 0;
	rubble.eachColumn(-10, 10, (column, bins) => {
		for (const bin of bins) {
			assert.ok(bin.cells > 0 && bin.value > 0);
			cells += bin.cells;
			value += bin.value;
		}
	});
	const s = rubble.state();
	assert.ok(s.bladeCells > 0 && s.bladeValue > 0);
	near(cells + s.bladeCells, 12);
	near(value + s.bladeValue, 110);
	const cut = rubble.harvest(0, 2, 2, Infinity, {}, y);
	near(cut.cells, cells);
	near(cut.value, value);
	assert.equal(rubble.state().segments, 0);
	near(rubble.heightAt(0, y), 0);
	const entries = ceiling.state.ledger.length;
	world.platform.vx = world.direction = 0;
	rubble.grade(world, 0.3);
	assert.equal(ceiling.state.ledger.length, entries + 1);
	assert.equal(ceiling.state.ledger.at(-1).type, 'blade');
	near(rubble.bladeValue, 0);
});
