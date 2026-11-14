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
		ceiling.drawFloor({ fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, save() {}, restore() {}, stroke() {} });
		near(ceiling.floorAt((column + 0.5) * state.cell), cells * tile, 1e-9);
		near(state.floorPiles[column] / state.cell, cells / compression, 1e-12, 'height in cells');
	}
	restore();
	balanced(world);
});

test('the floor tiles are compression:1 and the layer count follows the setting', () => {
	ceiling.reset(21);
	const state = ceiling.state;
	// Under the 64 layers a column is charted in at every tested factor, so the
	// tile stays exactly the one the setting asks for.
	const pile = 0.9;
	state.floorPiles.fill(pile);
	const tiles = [];
	let clips = 0;
	const context = { fillRect(x, y, width, height) { tiles.push({ x, y, width, height }); }, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() { clips++; }, save() {}, restore() {}, stroke() {} };
	for (const compression of [4, 2, 8]) {
		ceiling.setFloorCompression(compression);
		// The factor re-lays the column, so the pile is set again at this tile.
		state.floorPiles.fill(pile);
		tiles.length = 0;
		ceiling.drawFloor(context);
		const full = tiles.find(tile => Math.abs(tile.height - state.floorCellHeight) < 1e-12);
		assert.ok(full, 'full-height tiles exist at ' + compression);
		near(full.width / full.height, compression);
		// Whole layers of the tile plus the part tile that closes the crest: the
		// layer count follows the setting and the column still ends at the pile.
		const column0 = tiles.filter(tile => Math.abs(tile.x) < 1e-9);
		assert.equal(column0.length, Math.ceil(pile / state.floorCellHeight - 1e-9));
		near(column0[column0.length - 1].y + column0[column0.length - 1].height, pile, 1e-9);
		assert.ok(column0[0].y <= 1e-9, 'the column is drawn from the ground up');
	}
	// A pile that would be charted in more than 64 rows is drawn in taller
	// blocks of the same material instead of thousands of hairlines.
	ceiling.setFloorCompression(1);
	state.floorPiles.fill(9);
	tiles.length = 0;
	ceiling.drawFloor(context);
	const column0 = tiles.filter(tile => Math.abs(tile.x) < 1e-9);
	assert.ok(column0.length <= 64, 'a deep pile is budgeted by area: ' + column0.length);
	near(column0[column0.length - 1].y + column0[column0.length - 1].height, 9, 1e-9, 'and still fills its column');
	assert.equal(clips, 0, 'flat piles do not need a clip');
	restore();
});

test('slopes and steps keep every rubble tile below the physical crest without gaps', () => {
	ceiling.reset(24);
	const state = ceiling.state;
	for (const compression of [1, 4, 8]) {
		ceiling.setFloorCompression(compression);
		for (let c = 0; c < state.columns; c++) {
			state.floorPiles[c] = c < 30 ? 0 : c < 90 ? (c - 30) * 0.025 : c < 120 ? 1.5 : c < 140 ? 8 : 0;
		}
		const tiles = Array.from({ length: state.columns }, () => []);
		let path = [];
		let clippedPath;
		let strokePath;
		let clipped = false;
		let saved = 0;
		let clippedTiles = 0;
		let interiorTiles = 0;
		const context = {
			save() { saved++; },
			restore() { assert.equal(saved, 1); saved--; clipped = false; },
			beginPath() { path = []; },
			moveTo(x, y) { path.push([x, y]); },
			lineTo(x, y) { path.push([x, y]); },
			closePath() {},
			clip() { assert.equal(saved, 1); clipped = true; clippedPath = path.slice(); },
			fillRect(x, y, width, height) {
				const column = Math.round(x / state.cell);
				if (clipped) clippedTiles++;
				else {
					interiorTiles++;
					assert.ok(y + height <= Math.min(state.floorHeight[column], state.floorHeight[column + 1]) + 1e-12,
						'an unclipped tile is fully below the lower crest edge');
				}
				near(width, state.cell, 1e-12);
				tiles[column].push({ y, height });
			},
			stroke() { assert.equal(saved, 0, 'the floor clip does not leak to later drawing'); strokePath = path.slice(); }
		};
		ceiling.drawFloor(context);
		assert.ok(clippedTiles > 0 && interiorTiles > clippedTiles, 'only boundary tiles pay for clipping');
		assert.equal(clippedPath.length, state.columns + 3);
		assert.deepEqual(clippedPath[0], [0, 0]);
		assert.deepEqual(clippedPath[1], [state.columns * state.cell, 0]);
		assert.equal(strokePath.length, state.columns + 1);
		for (let vertex = 0; vertex <= state.columns; vertex++) {
			const point = [vertex * state.cell, state.floorHeight[vertex]];
			assert.deepEqual(clippedPath[state.columns + 2 - vertex], point, 'clip follows the physical crest');
			assert.deepEqual(strokePath[vertex], point, 'stroke follows that same crest');
			near(ceiling.floorAt(vertex * state.cell), point[1], 1e-12);
		}
		for (let c = 0; c < state.columns; c++) {
			const height = Math.max(state.floorHeight[c], state.floorHeight[c + 1]);
			assert.ok(tiles[c].length <= 64, 'the 64-layer budget also holds on slopes');
			let top = 0;
			for (const tile of tiles[c]) {
				near(tile.y, top, 1e-9, 'layers cover from the ground with no overlap or gap');
				top = tile.y + tile.height;
			}
			near(top, height, 1e-9, 'the tiles cover the high edge before clipping');
		}
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

test('switching the setting re-lays the same material and New game keeps the choice', () => {
	const world = physics.createWorld();
	const state = ceiling.state;
	ceiling.setFloorCompression(4);
	state.floorPiles.fill(0.11);
	state.floorValues.fill(4.5);
	const funds = state.funds;
	const material = state.floorPiles.reduce((total, height) => total + height / state.floorCellHeight, 0);
	// Four times the layers in the same column: the height follows the setting,
	// so the surface the ball and the platform ride moves with the picture.
	ceiling.setFloorCompression(1);
	assert.ok(state.floorPiles.every(height => Math.abs(height - 0.44) < 1e-12), 'one square tile where there were four');
	near(state.floorPiles.reduce((total, height) => total + height / state.floorCellHeight, 0), material, 1e-9, 'the same cells');
	assert.ok(state.floorValues.every(value => Math.abs(value - 4.5) < 1e-12), 'the same value');
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
	assert.equal(physics.config.radius, 0.18, 'the base radius is never rewritten');
});

test('a pile may fill the chamber up to its roof, and a flat factor that would' +
	' push it through the roof books the excess as lost', () => {
	const state = ceiling.state;
	ceiling.setFloorCompression(1);
	ceiling.reset(23);
	state.floorPiles.fill(0);
	state.floorValues.fill(0);
	assert.equal(state.pileLimit, state.top, 'the cap is the roof, not the deck');
	// The roof is the only level a column cannot pass, so a pile standing at it
	// survives the same factor that once capped it at the deck.
	ceiling.setFloorCompression(8);
	state.floorPiles.fill(state.pileLimit);
	state.floorValues.fill(6);
	ceiling.setFloorCompression(4);
	near(state.floorPiles[0], state.pileLimit, 1e-12, 'the roof holds the pile at the finer tile too');
	balanced(physics.createWorld());
	// A flatter tile stands the same material twice as high: what no longer fits
	// under the roof is booked as lost, exactly like a capped deposit, and the
	// purse keeps only the material the floor still holds.
	const world = physics.createWorld();
	ceiling.setFloorCompression(8);
	state.floorPiles.fill(6);
	state.floorValues.fill(36);
	const beforeLost = state.lostCells;
	const beforeValue = state.floorValues.reduce((total, value) => total + value, 0);
	ceiling.setFloorCompression(1);
	const afterValue = state.floorValues.reduce((total, value) => total + value, 0);
	near(state.floorPiles[0], state.pileLimit, 1e-12, 'capped by the roof');
	assert.ok(state.lostCells > beforeLost, 'what the roof cannot hold is lost, not invented');
	assert.ok(afterValue < beforeValue, 'and its value goes with it');
	balanced(world);
	restore();
	assert.equal(state.pileLimit, state.top);
});

test('a deeper pile lifts the hull by its own drawn height at every setting', () => {
	const state = ceiling.state;
	const context = { fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, save() {}, restore() {}, stroke() {} };
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
