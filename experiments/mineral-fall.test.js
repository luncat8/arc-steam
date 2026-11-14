'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ceiling = require('../js/ceiling.js');

const blankContext = {
	fillStyle: '',
	fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {}
};

function runTestBed(growth) {
	ceiling.reset(73);
	const mineralCount = ceiling.state.mineralNames.length;
	for (let mineral = 0; mineral < mineralCount; mineral++) ceiling.setMineralClusterGrowth(mineral, growth);
	ceiling.generateTestRock();
	const state = ceiling.state;
	const energy = state.energy;
	ceiling.collapse(20);
	let grains = 0;
	for (let i = 0; i < state.active.length; i++) {
		if (!state.active[i]) continue;
		grains++;
		// A released group is not redrawn as one block: every cell falls as its
		// own grain, at its own cell size, keeping the shape it left the face in.
		assert.equal(state.debrisCells[i], 1, 'a released cell falls as its own grain');
		const offset = i * mineralCount;
		let mass = 0;
		for (let m = 0; m < mineralCount; m++) mass += state.debrisMinerals[offset + m];
		assert.ok(Math.abs(mass - state.cellMass) < 1e-8, 'each grain carries exactly one cell of mineral mass');
	}
	assert.ok(Math.abs(state.energy - energy) < 1e-5, 'forming falling grains preserves rock energy');
	let cells = 0;
	let groups = 0;
	for (let mineral = 0; mineral < mineralCount; mineral++) {
		cells += state.fallCells[mineral];
		groups += state.fallGroups[mineral];
	}
	return { bursts: state.collapseBursts, grains, cells, groups, perFall: groups ? cells / groups : 0 };
}

test('test rock lays out one mineral band per table entry and a top-to-bottom damage gradient', () => {
	ceiling.reset(1);
	assert.equal(ceiling.state.testRock, false);
	const mineralCount = ceiling.state.mineralNames.length;
	assert.deepEqual(Array.from(ceiling.state.mineralClusterGrowth), ceiling.state.mineralTable.map(entry => entry.growth),
		'the default grouping comes from the material table');
	ceiling.generateTestRock();
	const state = ceiling.state;
	assert.equal(state.testRock, true);
	for (let band = 0; band < mineralCount; band++) {
		const mineral = state.testMineralOrder[band];
		const column = Math.floor((band + 0.5) * state.columns / mineralCount);
		const bottom = column;
		const top = (state.rows - 1) * state.columns + column;
		assert.equal(state.minerals[bottom * mineralCount + mineral], 1);
		assert.equal(state.minerals[top * mineralCount + mineral], 1);
		assert.ok(Math.abs(state.prices[bottom] - state.mineralPrices[mineral]) < 1e-4);
		assert.equal(state.damageField[top], 0);
		assert.ok(state.strength[bottom] / state.initialStrength[bottom] < 0.0001);
		assert.equal(state.strength[top], state.initialStrength[top]);
		if (band) assert.ok(state.initialStrength[bottom] <= state.mineralTable[state.testMineralOrder[band - 1]].strength + 1e-6);
	}
	for (let row = 0; row < state.rows - 1; row++) {
		assert.ok(state.strength[row * state.columns] < state.strength[(row + 1) * state.columns]);
	}
	assert.ok(state.looseCells > 0, 'the exposed bottom edge is ready to fall');
});

test('Damage rock view paints strength removed by the generated impact', () => {
	ceiling.reset(1);
	ceiling.generateTestRock();
	const colors = new Set();
	const context = {
		set fillStyle(value) { colors.add(value); },
		fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {}
	};
	ceiling.draw(context, 'damage');
	assert.ok(colors.has(ceiling.state.damagePalette[0]));
	assert.ok(colors.has(ceiling.state.damagePalette[100]));
	assert.ok(colors.size > 10, 'the damage view exposes many gradient levels');
});

test('growth raises the group size and lowers the release rate from the plain clump', () => {
	const plain = runTestBed(10);
	const grouped = runTestBed(300);
	assert.ok(plain.bursts > 0 && grouped.bursts > 0);
	assert.ok(plain.perFall <= 4, 'the 10% floor keeps the original 1..4-cell clump');
	assert.ok(grouped.perFall > plain.perFall, 'growth forms larger groups');
	assert.ok(grouped.bursts < plain.bursts, 'larger groups use a lower release chance');
});

// One horizontal band of loose free faces whose mineral alternates column by
// column, so a mineral-blind pick must mix the two and a mineral-matched flake
// cannot. Returns the mineral diversity of the cells released on each tick.
function mixedBandTicks(growth, ticks) {
	ceiling.reset(5);
	const state = ceiling.state;
	const columns = state.columns;
	const mineralCount = state.mineralNames.length;
	// Isolate the band: with no rock elsewhere, every release in the tick comes
	// from the alternating columns and the test measures one decision.
	state.strength.fill(0);
	state.damageField.fill(0);
	for (let column = 0; column < 16; column++) {
		for (let row = 3; row < 11; row++) {
			state.strength[row * columns + column] = state.collapseStrengthLimit * 0.1;
			state.damageField[row * columns + column] = 1;
			const offset = (row * columns + column) * mineralCount;
			state.minerals[offset] = column % 2 === 0 ? 1 : 0;
			state.minerals[offset + 1] = column % 2 === 1 ? 1 : 0;
			for (let m = 2; m < mineralCount; m++) state.minerals[offset + m] = 0;
		}
	}
	for (let mineral = 0; mineral < mineralCount; mineral++) ceiling.setMineralClusterGrowth(mineral, growth);
	// Draw once with a blank context to resynchronize the free surface.
	ceiling.draw(blankContext, 'minerals');
	const activeBefore = Array.from(state.active);
	const diversity = [];
	for (let tick = 0; tick < ticks; tick++) {
		ceiling.collapse(0.25);
		const seen = new Set();
		for (let i = 0; i < state.active.length; i++) {
			if (!state.active[i] || activeBefore[i]) continue;
			const offset = state.debrisCell[i] * mineralCount;
			const iron = state.minerals[offset];
			const copper = state.minerals[offset + 1];
			seen.add(copper > iron ? 'copper' : 'iron');
		}
		for (let i = 0; i < state.active.length; i++) activeBefore[i] = state.active[i] ? 1 : 0;
		if (seen.size) diversity.push(seen.size);
	}
	return diversity;
}

test('growth mixes the plain mineral-blind clump with the mineral-matched flake', () => {
	const plain = mixedBandTicks(10, 60);
	const grouped = mixedBandTicks(300, 60);
	assert.ok(plain.length > 0 && grouped.length > 0, 'both settings release rock');
	assert.equal(plain.filter(size => size > 1).length > 0, true,
		'the 10% floor still mixes minerals in one release, as the rock always did');
	assert.equal(grouped.every(size => size === 1), true,
		'300% keeps every release to one connected mineral-matched flake');
});

test('released grains fall, land under their own columns and grow the floor heightmap', () => {
	ceiling.reset(73);
	ceiling.generateTestRock();
	const state = ceiling.state;
	const world = { platform: { x: -10, vx: 0 }, heat: 0, time: 0, direction: 0 };
	const energy = state.energy + world.heat;
	for (let step = 0; step < 240 * 4; step++) ceiling.step(world, 1 / 240, 60);
	assert.ok(state.lostCells > 0, 'test grains reached the floor');
	assert.equal(state.extractedCells, state.airborneCells + state.caughtCells + state.lostCells);
	assert.ok(Math.abs(state.energy + world.heat - energy) < 1e-5);
	let raised = 0;
	for (let column = 0; column < state.columns; column++) if (state.floorPiles[column] > 0) raised++;
	assert.ok(raised >= 3, 'the released cells pile up under the columns they came from');
});

test('mineral growth is bounded to the 10%..500% slider range and survives New game resets', () => {
	// Growth is a game setting keyed by the shared table, so every material -
	// stone and gas-bearing rock included - carries its own slider.
	const entry = id => ceiling.state.mineralIds.indexOf(id);
	assert.equal(ceiling.state.mineralClusterGrowth.length, ceiling.state.mineralCount);
	assert.equal(ceiling.setMineralClusterGrowth(entry('stone'), 0), 10, 'the floor is the plain clump, not zero growth');
	assert.equal(ceiling.setMineralClusterGrowth(entry('quartz'), 25), 25);
	assert.equal(ceiling.setMineralClusterGrowth('Copper ore', 900), 500);
	assert.equal(ceiling.setMineralClusterGrowth(entry('gas'), 20), 20);
	const live = Array.from(ceiling.state.mineralClusterGrowth);
	ceiling.reset(2);
	assert.deepEqual(Array.from(ceiling.state.mineralClusterGrowth), live,
		'the live settings carry into a new run');
	assert.equal(ceiling.collapseChunkMax, 4 * (1 + 500 / 100), 'the group cap covers the 500% setting');
});

test('sand is rubble by nature and the remaining view greys exactly the rubble', () => {
	ceiling.reset(1);
	const state = ceiling.state;
	const sand = state.mineralIds.indexOf('sand');
	assert.ok(sand >= 0, 'the table carries a sand entry');
	assert.ok(state.mineralTable[sand].strength < state.collapseStrengthLimit,
		'sand forms below the debris limit, so it is rubble at its own strength');
	assert.equal(state.mineralTable[sand].growth, 10, 'sand ships at the slider floor, so it lets go as grains');
	assert.equal(state.mineralAbundance[sand] > 0, true, 'sand forms in the field, not only in the test bed');
	for (let slot = 0; slot <= 1000; slot++) {
		const grey = state.rubblePalette[slot].match(/\d+/g).map(Number);
		assert.equal(grey[0], grey[2], 'the rubble palette has no hue at slot ' + slot);
		assert.equal(grey[1], grey[0], 'and no tint in the green channel at slot ' + slot);
	}
	const limitSlot = Math.round(state.collapseStrengthLimit / state.maxStrength * 1000);
	assert.notEqual(state.rubblePalette[limitSlot], state.strengthPalette[limitSlot],
		'the limit itself is where the warm palette starts');
});


test('test bed releases substantially more weak rock during collapse and at rest', () => {
	for (const useDefault of [false, true]) {
		ceiling.reset(73);
		if (!useDefault) for (let m = 0; m < ceiling.state.mineralCount; m++) ceiling.setMineralClusterGrowth(m, 100);
		ceiling.generateTestRock();
		const state = ceiling.state;
		const hard = state.mineralIds.indexOf('corundum');
		const weak = state.mineralIds.indexOf('gas');
		ceiling.collapse(20);
		assert.ok(state.fallCells[weak] > state.fallCells[hard] * 1.5);
		ceiling.collapse(6000);
		assert.equal(state.looseCells, 0);
		assert.ok(state.fallCells[weak] > state.fallCells[hard] * 3);
		const actual = new Array(state.mineralCount).fill(0);
		for (let col = 0; col < state.columns; col++) {
			const mineral = state.testMineralOrder[Math.floor(col * state.mineralCount / state.columns)];
			actual[mineral] += state.firstRow[col];
			if (state.firstRow[col] < state.rows) {
				const index = state.firstRow[col] * state.columns + col;
				assert.ok(state.strength[index] >= state.collapseStrengthLimit || state.damageField[index] < state.collapseLooseFloor);
			}
		}
		assert.deepEqual(Array.from(state.fallCells), actual, 'cell counts use each cell’s mineral, not the group seed');
	}
});

test('remaining strength view matches initial at the top and greys only the rubble', () => {
	ceiling.reset(1);
	ceiling.generateTestRock();
	ceiling.setShape('square');
	const state = ceiling.state;
	function parseRgb(style) {
		return style.match(/\d+/g).map(Number);
	}
	function rockColors(mode) {
		const colors = [];
		const context = {
			fillStyle: '',
			fillRect() { colors.push(this.fillStyle); },
			beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {}
		};
		ceiling.draw(context, mode);
		return colors;
	}
	try {
		const initial = rockColors('initial-strength');
		const remaining = rockColors('strength');
		const top = (state.rows - 1) * state.columns;
		for (let column = 0; column < state.columns; column++) {
			const sound = top + column;
			// A material that forms below the rubble limit is grey from the
			// start, so only rock that holds at its own strength reads alike.
			if (state.initialStrength[sound] >= state.collapseStrengthLimit) {
				assert.equal(initial[sound], remaining[sound], 'sound rock reads the same in both strength views');
			} else {
				assert.notEqual(initial[sound], remaining[sound], 'rock that forms as rubble is already grey in the remaining view');
			}
			assert.equal(remaining[column], remaining[0], 'the fully damaged row is one rubble colour');
		}
		const bottomRgb = parseRgb(remaining[0]);
		assert.equal(bottomRgb[0], bottomRgb[2], '100% damaged bottom has lost its hue');
		assert.ok(bottomRgb[0] < parseRgb(initial[top])[0], '100% damaged bottom is darker than intact rock');
		let rubble = 0;
		let holding = 0;
		for (let row = 0; row < state.rows; row++) {
			const idx = row * state.columns;
			const rgb = parseRgb(remaining[idx]);
			if (state.strength[idx] < state.collapseStrengthLimit) {
				rubble++;
				assert.equal(rgb[0], rgb[2], 'rubble is grey in the remaining strength view');
				continue;
			}
			holding++;
			assert.ok(rgb[0] > rgb[2], 'rock that still holds keeps its warm colour');
		}
		assert.ok(rubble > 0 && holding > 0, 'the graded bed shows both regimes');
	} finally {
		ceiling.setShape('smooth');
	}
});
