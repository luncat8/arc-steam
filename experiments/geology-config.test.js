'use strict';
// The shared geology contract of js/geology-config.js, js/rock-materials.js and
// js/minerals.js: one defaults table, caller-owned editable snapshots, a
// validated complete export/import, one weighted-strength and colour rule, one
// base-price curve, and lab/game parity at identical absolute coordinates.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ceiling = require('../js/ceiling.js');
const geology = require('../js/geology.js');
const geoConfig = require('../js/geology-config.js');
const minerals = require('../js/minerals.js');
const materials = require('../js/rock-materials.js');

const count = minerals.mineralCount;
const table = minerals.mineralTable;

function near(actual, expected, tolerance, label) {
	assert.ok(Math.abs(actual - expected) < tolerance, `${label || ''} ${actual} !~ ${expected} (±${tolerance})`);
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('the defaults are one frozen table and every snapshot is an independent copy', () => {
	assert.ok(Object.isFrozen(geoConfig.defaults));
	assert.ok(Object.isFrozen(geoConfig.limits));
	assert.equal(geoConfig.defaults.frequency, geology.defaultFrequency, 'geology takes its frequency from the config');
	assert.equal(geoConfig.defaults.yCompression, geology.defaultYCompression, 'geology takes its flattening from the config');

	const lab = geoConfig.create(37);
	const game = geoConfig.capture(lab);
	lab.frequency = 0.2;
	lab.ranges[1][0][0] = 0.5;
	assert.notEqual(geoConfig.defaults.frequency, 0.2, 'the defaults never move');
	assert.equal(game.frequency, geoConfig.defaults.frequency, 'the captured run keeps its own settings');
	assert.equal(game.ranges[1][0][0], table[1].r[0], 'the captured ranges are a copy, not a view');
	geoConfig.resetInto(lab);
	assert.deepEqual(plain(lab), plain(geoConfig.create(37)), 'reset restores the shipped formation');
});

test('the editable bounds are one table the HTML and the import both read', () => {
	for (const key of ['frequency', 'yCompression', 'specificity', 'hostWeight']) {
		const limit = geoConfig.limits[key];
		assert.ok(limit.min < limit.max, key + ' has an ordered range');
		assert.ok(geoConfig.defaults[key] >= limit.min && geoConfig.defaults[key] <= limit.max,
			'the default ' + key + ' sits inside its own bounds');
	}
	assert.ok(geoConfig.modes.indexOf(geoConfig.defaults.mode) >= 0, 'the default mode is a known mode');
});

test('an export carries every setting keyed by stable mineral id and round-trips', () => {
	const config = geoConfig.create(11);
	config.frequency = 0.155;
	config.yCompression = 4.5;
	config.mode = 'product';
	config.specificity = 0.35;
	config.hostWeight = 0.42;
	config.ranges[3][2] = [0.2, 0.5];
	const exported = geoConfig.exportOf(config, minerals.rarityTargets);

	assert.equal(exported.format, geoConfig.format);
	assert.equal(exported.version, geoConfig.version);
	assert.equal(exported.seed, 11);
	assert.deepEqual(exported.settings, { frequency: 0.155, yCompression: 4.5, mode: 'product', specificity: 0.35, hostWeight: 0.42 });
	assert.deepEqual(Object.keys(exported.ranges).sort(), minerals.mineralIds.slice().sort(), 'every mineral is keyed by id');
	assert.deepEqual(exported.ranges.quartz[2], [0.2, 0.5]);
	assert.ok(exported.calibration.desiredShares.iron > 0, 'desired shares travel as calibration metadata');
	assert.deepEqual(geoConfig.validateExport(exported), [], 'a complete snapshot validates');

	const restored = geoConfig.create(1);
	geoConfig.applyInto(restored, exported);
	assert.equal(restored.frequency, 0.155);
	assert.equal(restored.mode, 'product');
	assert.equal(restored.seed, 11);
	assert.deepEqual(restored.ranges[3][2], [0.2, 0.5]);
	assert.deepEqual(geoConfig.exportOf(restored).ranges, exported.ranges, 'export -> apply -> export is stable');
});

test('an invalid snapshot is rejected whole and never half-applied', () => {
	const target = geoConfig.create(5);
	const before = JSON.stringify(geoConfig.exportOf(target));
	const exported = geoConfig.exportOf(target, minerals.rarityTargets);

	exported.settings.frequency = 9;
	exported.settings.mode = 'sorted';
	delete exported.ranges.gold;
	exported.ranges.iron[0] = [0.8, 0.2];
	const problems = geoConfig.validateExport(exported);
	assert.ok(problems.some(text => text.indexOf('frequency') === 0), 'the out-of-bounds setting is reported');
	assert.ok(problems.some(text => text.indexOf('mode') === 0), 'the unknown mode is reported');
	assert.ok(problems.some(text => text.indexOf('ranges for gold') === 0), 'the missing mineral is reported');
	assert.ok(problems.some(text => text.indexOf('iron.r') === 0), 'the inverted range is reported');
	assert.throws(() => geoConfig.applyInto(target, exported), /geology snapshot rejected/, 'every problem arrives in one throw');
	assert.equal(JSON.stringify(geoConfig.exportOf(target)), before, 'the rejected import left the configuration untouched');
	assert.throws(() => geoConfig.applyInto(target, null), /rejected/);
});

test('the shared strength, colour and price rules are the ones the game uses', () => {
	// Pure test bands carry the exact table strength: no additive hardness offset.
	ceiling.reset(3);
	ceiling.generateTestRock();
	const state = ceiling.state;
	for (let m = 0; m < count; m++) {
		const index = Math.floor((state.testMineralOrder.indexOf(m) + 0.5) * state.columns / count);
		// Stored as Float32, so the pure strength is the table value to that precision.
		near(state.initialStrength[index], table[m].strength, 1e-6, table[m].id + ' has its pure table strength');
	}
	assert.equal(materials.maxStrength, Math.max(...table.map(entry => entry.strength)), 'the display ceiling is the strongest pure mineral');
	assert.equal(table[minerals.mineralIds.indexOf('gas')].strength, 0.8, 'gas-bearing rock stays at 0.8 J/cell');

	// A mixture is exactly the mineral-weighted mean, and its colour the weighted tint.
	const mix = new Float64Array(count);
	const rgb = [0, 0, 0];
	mix[0] = 0.25;
	mix[1] = 0.75;
	near(materials.strengthInto(mix, 0), 0.25 * table[0].strength + 0.75 * table[1].strength, 1e-12, 'weighted strength');
	materials.colorInto(mix, 0, rgb);
	for (let c = 0; c < 3; c++) {
		near(rgb[c], 0.25 * table[0].color[c] + 0.75 * table[1].color[c], 1e-12, 'weighted colour channel ' + c);
	}

	// The game's base quotes come from the shared curve on measured abundance.
	const shared = new Float64Array(count);
	materials.basePricesInto(shared, state.mineralAbundance, materials.economy);
	for (let m = 0; m < count; m++) near(shared[m], state.mineralBasePrices[m], 1e-12, 'base quote ' + table[m].id);
	assert.equal(state.basePriceReport.target, materials.economy.targetCellValue);
});

test('the strength view is one warm ramp that desaturates into grey rubble', () => {
	const exhausted = [0, 0, 0];
	const full = [0, 0, 0];
	const clamped = [0, 0, 0];
	const rubble = [0, 0, 0];
	assert.equal(materials.debrisLimit, 0.8);
	assert.ok(table.some(mineral => mineral.strength < materials.debrisLimit), 'a material may form already below the rubble limit');
	materials.strengthColorInto(exhausted, 0);
	materials.strengthColorInto(full, 1);
	assert.deepEqual(exhausted, [75, 45, 38], 'the ramp floor is the shipped dark brown');
	assert.deepEqual(full, [205, 170, 120], 'the ramp ceiling is the shipped sandstone');
	assert.ok(full[0] > exhausted[0] && full[1] > exhausted[1] && full[2] > exhausted[2],
		'a full-strength cell is brighter than an exhausted one');
	assert.ok(exhausted[0] > exhausted[2] && full[0] > full[2], 'the ramp stays warm from end to end');
	let previous = -1;
	for (let i = 0; i <= 100; i++) {
		const step = [0, 0, 0];
		materials.strengthColorInto(step, i / 100);
		assert.ok(step[0] >= previous, 'the ramp rises with strength at step ' + i);
		previous = step[0];
	}
	// HSL lightness is kept exactly, hue is dropped: grey carries no colour of
	// its own, so only warmth tells a holding cell from rubble.
	rubble[0] = 120; rubble[1] = 60; rubble[2] = 30;
	assert.deepEqual(materials.desaturateInto(rubble), [75, 75, 75], 'desaturation keeps the HSL lightness');
	materials.strengthColorInto(clamped, 2);
	assert.deepEqual(clamped, full, 'a ratio past the ceiling clamps instead of wrapping');
	materials.strengthColorInto(clamped, -1);
	assert.deepEqual(clamped, exhausted, 'a negative ratio clamps to the floor colour');
});

test('lab and game agree on the mixture at identical absolute coordinates', () => {
	const seed = 9;
	ceiling.reset(seed);
	const state = ceiling.state;
	// A lab-side run from the very same snapshot, through the lab's own path.
	const labConfig = geoConfig.capture(state.geology);
	labConfig.seed = seed;
	const formation = geology.compile(labConfig.ranges, labConfig.mode, labConfig.specificity);
	const field = geology.createField(labConfig);
	const values = new Float64Array(3);
	const mix = new Float64Array(count);

	const cells = [[0, 0], [17, 4], [state.columns - 1, 0], [61, state.rows - 1], [130, 22]];
	for (const [column, row] of cells) {
		geology.fillElements(field, column, row, values, 0);
		geology.fillMix(formation, values, 0, labConfig.hostWeight, mix, 0);
		const sample = ceiling.sampleCell(column, row);
		for (let m = 0; m < count; m++) {
			near(sample.mix[m], mix[m], 1e-6, 'cell ' + column + ',' + row + ' ' + table[m].id);
			// The live cell array is the same mixture, stored as Float32.
			near(state.minerals[(row * state.columns + column) * count + m], mix[m], 1e-6);
		}
	}
	// Generated rows keep sampling their absolute geological row, so a deeper
	// coordinate reads the same in the lab as in the game.
	const deepRow = state.generatedRows + 3;
	geology.fillElements(field, 7, deepRow, values, 0);
	geology.fillMix(formation, values, 0, labConfig.hostWeight, mix, 0);
	const deep = ceiling.sampleCell(7, deepRow);
	for (let m = 0; m < count; m++) near(deep.mix[m], mix[m], 1e-6, 'deep row ' + table[m].id);
});

test('applying a lab snapshot starts a fresh run from the new formation', () => {
	ceiling.reset(4);
	const cells = ceiling.state.columns * ceiling.state.rows * count;
	const before = Array.from(ceiling.state.minerals.slice(0, cells));
	// The run's geology is module state: put the shipped formation back at the end.
	const shipped = headlessExport(ceiling);
	const exported = headlessExport(ceiling);
	exported.settings.hostWeight = 1.5;
	exported.ranges.corundum = [[0.0, 0.2], [0.7, 0.9], [0.0, 0.2]];
	ceiling.applyGeologyExport(exported);
	const run = headlessExport(ceiling);
	assert.equal(run.settings.hostWeight, 1.5, 'the new host weight reached the run');
	assert.deepEqual(run.ranges.corundum, [[0.0, 0.2], [0.7, 0.9], [0.0, 0.2]], 'the new signature reached the run');
	assert.equal(ceiling.state.extractedCells, 0, 'the run restarted instead of repricing intact rock');
	assert.notDeepEqual(Array.from(ceiling.state.minerals.slice(0, cells)), before, 'the new formation regenerated the rock');
	ceiling.applyGeologyExport(shipped);
	assert.deepEqual(headlessExport(ceiling), shipped, 'the shipped formation is back');
});

// The run's own snapshot, as the page exports it for a source-controlled update.
function headlessExport(api) { return plain(api.exportGeology()); }

test('the run measures its opening bed, so scrolling rock never reprices the market', () => {
	ceiling.reset(17);
	const state = ceiling.state;
	// The calibration population is every initial cell at the run's own depth.
	const initial = new Float64Array(count);
	for (let row = 0; row < state.initialRows; row++) {
		for (let column = 0; column < state.columns; column++) {
			const offset = (row * state.columns + column) * count;
			for (let m = 0; m < count; m++) initial[m] += state.minerals[offset + m];
		}
	}
	const cells = state.columns * state.initialRows;
	for (let m = 0; m < count; m++) {
		near(state.mineralAbundance[m], initial[m] / cells, 1e-6, 'abundance of ' + table[m].id);
	}
	// The host is the bulk of the rock, as the formation's host weight intends.
	assert.ok(state.mineralAbundance[minerals.hostIndex] > 0.25 && state.mineralAbundance[minerals.hostIndex] < 0.55,
		'host rock is the largest single share');
	let total = 0;
	for (let m = 0; m < count; m++) total += state.mineralAbundance[m];
	near(total, 1, 1e-5, 'the measured abundance is a share of the same rock');

	// New strata arrive from above; the quotes they were priced against stay put.
	const booked = Float64Array.from(state.mineralBasePrices);
	const scraped = Float64Array.from(state.mineralAbundance);
	for (let i = 0; i < 24; i++) state.strength[i * state.columns] = 0;
	ceiling.grow(4);
	assert.ok(state.generatedRows > state.initialRows, 'upper rows were generated');
	for (let m = 0; m < count; m++) {
		assert.equal(state.mineralBasePrices[m], booked[m], 'the base quote did not follow the new rows');
		assert.equal(state.mineralAbundance[m], scraped[m], 'the calibration population stayed the opening bed');
	}
});

test('both pages load the shared modules in dependency order, and every control they bind exists', () => {
	const fs = require('node:fs');
	const path = require('node:path');
	const root = path.join(__dirname, '..');
	const pages = [
		{ file: 'index.html', chain: ['js/minerals.js', 'js/element-cdf.js', 'js/geology-config.js', 'js/rock-materials.js', 'js/geology.js', 'js/ceiling.js'] },
		{ file: 'prototypes/mineral-lab.html', chain: ['../js/minerals.js', '../js/element-cdf.js', '../js/geology-config.js', '../js/rock-materials.js', '../js/geology.js', 'mineral-lab.js'] }
	];
	for (const page of pages) {
		const html = fs.readFileSync(path.join(root, page.file), 'utf8');
		const loaded = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
		let last = -1;
		for (const script of page.chain) {
			const at = loaded.indexOf(script);
			assert.ok(at >= 0, page.file + ' loads ' + script);
			assert.ok(at > last, page.file + ' loads ' + script + ' after its dependencies');
			last = at;
		}
	}

	// The lab binds its controls by id; a renamed or missing element is a
	// runtime error in the page, so the markup and the script must agree.
	const labHtml = fs.readFileSync(path.join(root, 'prototypes/mineral-lab.html'), 'utf8');
	const labScript = fs.readFileSync(path.join(root, 'prototypes/mineral-lab.js'), 'utf8');
	const ids = new Set([...labHtml.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
	const bound = [...labScript.matchAll(/document\.getElementById\('([^']+)'\)/g)].map(match => match[1]);
	const listed = labScript.slice(labScript.indexOf('const ui = {}'), labScript.indexOf('// Buffers:'));
	for (const id of [...bound, ...[...listed.matchAll(/'([a-z][a-z0-9-]*)'/g)].map(match => match[1])]) {
		assert.ok(ids.has(id), 'the lab page has #' + id);
	}
	// The shared control ids are the ones the page marks up.
	for (const control of geoConfig.controls) assert.ok(ids.has(control.id), 'the lab page has the shared control #' + control.id);
});
