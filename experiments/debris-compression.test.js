'use strict';
// Debris Y compression (0.3.7): one setting decides how tall a pile draws the
// material it holds, and every cells-to-metres conversion reads it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ceiling, physics, near, balanced, sync } = require('./harness.cjs');

// The setting is a chamber rule shared by every test in this file, so each one
// leaves the classic tile behind it.
function restore() { ceiling.setFloorCompression(4); }

test('the debris setting is a clamped half-step factor with 4:1 as its reference', () => {
	const state = ceiling.state;
	assert.equal(state.floorCompression, 4);
	assert.equal(state.floorCellHeight, state.cell / 4);
	assert.equal(ceiling.setFloorCompression(1.5), 1.5);
	near(state.floorCellHeight, state.cell / 1.5);
	assert.equal(ceiling.setFloorCompression(1.2), 1, 'rounds to the nearest half step');
	assert.equal(ceiling.setFloorCompression(99), state.floorCompressionMax, 'clamped at the flat end');
	assert.equal(ceiling.setFloorCompression(0.1), state.floorCompressionMin, 'clamped at the square end');
	assert.equal(ceiling.setFloorCompression('flat'), 4, 'a nonsense value falls back to the 4:1 tile');
	restore();
	assert.equal(state.floorCompression, 4);
});

test('a deposit is the same number of cells at any setting: only its drawn height changes', () => {
	const world = physics.createWorld();
	const state = ceiling.state;
	const column = 90;
	for (const compression of [1, 2, 4, 8]) {
		ceiling.setFloorCompression(compression);
		state.floorPiles.fill(0);
		state.floorValues.fill(0);
		// A settled grain lands in the column and books its own value. One sheet
		// filled flat gives the same number of cells at every setting.
		const cells = 3;
		const value = 9;
		// Kept out of the swath the grade test below uses.
		const tile = state.cell / compression;
		state.floorPiles.fill(cells * tile);
		state.floorValues.fill(value);
		near(state.floorPiles[column], cells * state.cell / compression);
		near(state.floorValues[column] / state.floorPiles[column], value / (cells * tile), 1e-9);
		// The floor profile is rebuilt by the draw pass, like the rock heightmap.
		ceiling.drawFloor({ fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} });
		near(ceiling.floorAt((column + 0.5) * state.cell), cells * tile, 1e-9);
		near(state.floorPiles[column] / state.cell, cells / compression, 1e-12, 'height in cells');
	}
	restore();
	balanced(world);
});

test('the floor tiles are compression:1 and the layer count follows the setting', () => {
	ceiling.reset(21);
	const state = ceiling.state;
	const pile = 0.3175;
	state.floorPiles.fill(pile);
	const tiles = [];
	const context = { fillRect(x, y, width, height) { tiles.push({ x, y, width, height }); }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
	for (const compression of [4, 2, 8]) {
		ceiling.setFloorCompression(compression);
		tiles.length = 0;
		ceiling.drawFloor(context);
		const full = tiles.find(tile => Math.abs(tile.height - state.floorCellHeight) < 1e-12);
		assert.ok(full, 'full-height tiles exist at ' + compression);
		near(full.width / full.height, compression);
		// Ten whole layers of the 4:1 tile plus the part tile that closes the
		// crest: the layer count follows the setting, the pile behind it does not.
		const column0 = tiles.filter(tile => Math.abs(tile.x) < 1e-12);
		assert.equal(column0.length, Math.ceil(pile / state.floorCellHeight));
		const top = column0[column0.length - 1];
		assert.ok(top.height < state.floorCellHeight, 'the last tile closes the pile');
		near(top.y + top.height, pile, 1e-9);
	}
	restore();
});

test('a grade pass cuts one tile and pays the same share at every setting', () => {
	const world = physics.createWorld();
	const state = ceiling.state;
	const report = { value: 0, cells: 0 };
	for (const compression of [4, 1, 8]) {
		ceiling.setFloorCompression(compression);
		const tile = state.cell / compression;
		state.floorPiles.fill(tile * 3);
		state.floorValues.fill(12);
		sync(world);
		// The blade cuts one layer of the pile under its swath.
		// Two layers of the swath, with room for four cells: the hopper, not the
		// layer thickness, is what limits the take.
		const harvested = ceiling.harvest(12, 0.75, tile * 2, 4, report);
		near(harvested.cells, 4, 1e-9, 'four cells, whatever a layer is drawn as');
		// Two cells a column, so the hopper takes the first two columns of the
		// swath, each two layers of a three-layer pile: a third of the twelve
		// credits a column keeps.
		near(harvested.value, 2 * 12 * 2 / 3, 1e-9);
		// Only the swath is cut; the rest of the floor keeps its three layers.
		const first = Math.max(0, Math.floor((12 - 0.75) / state.cell));
		const last = Math.min(state.columns - 1, Math.floor((12 + 0.75) / state.cell));
		for (let i = 0; i < state.columns; i++) {
			const cut = i >= first && i < first + 2;
			near(state.floorPiles[i], cut ? tile : tile * 3, 1e-12);
		}
		assert.ok(last >= first + 2, 'the untouched swath is still behind the take');
	}
	restore();
	balanced(world);
});

test('switching the setting never moves material, and New game keeps the choice', () => {
	const world = physics.createWorld();
	const state = ceiling.state;
	state.floorPiles.fill(0.11);
	state.floorValues.fill(4.5);
	const piles = Array.from(state.floorPiles);
	const values = Array.from(state.floorValues);
	const funds = state.funds;
	ceiling.setFloorCompression(1);
	assert.deepEqual(Array.from(state.floorPiles), piles, 'no bucket is re-cut by a view change');
	assert.deepEqual(Array.from(state.floorValues), values);
	assert.equal(state.funds, funds);
	balanced(world);
	// The setting is a chamber rule: a fresh run keeps it and clears the floor.
	ceiling.reset(22);
	assert.equal(state.floorCompression, 1);
	assert.equal(state.floorPiles.some(height => height > 0), false, 'a fresh run starts with a clear floor');
	ceiling.setFloorCompression(1.5);
	ceiling.generateTestRock();
	assert.equal(state.floorCompression, 1.5, 'the test-rock run keeps the setting');
	assert.equal(state.floorPiles.some(height => height > 0), false, 'and starts from a clear floor too');
	restore();
	assert.equal(physics.config.radius, 0.18, 'a view rule never resizes the ball');
});

test('a deeper pile lifts the hull by its own drawn height at every setting', () => {
	const state = ceiling.state;
	const context = { fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
	for (const compression of [4, 2, 1, 8]) {
		ceiling.setFloorCompression(compression);
		const world = physics.createWorld();
		for (let i = 0; i < 240; i++) physics.step(world, 1 / 240);
		near(world.platform.y, 0, 1e-9, 'the cleared floor is the datum');
		// Half a metre of rubble under the whole chamber: the crest the wheels
		// ride is that height, whatever tile it is drawn as.
		const pile = 0.5;
		state.floorPiles.fill(pile);
		state.floorValues.fill(3);
		ceiling.drawFloor(context);
		sync(world);
		for (let i = 0; i < 240; i++) physics.step(world, 1 / 240);
		near(world.platform.y, pile, 1e-9);
		near(ceiling.floorAt(world.platform.x), pile, 1e-9);
		balanced(world);
	}
	restore();
});
