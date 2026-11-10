'use strict';
// The element field and the mineral mix of js/geology.js: independent and
// evenly spread element channels, bounded membership with a host fallback, and
// a calibration that reaches the rarity targets of js/minerals.js.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const geology = require('../js/geology.js');
const minerals = require('../js/minerals.js');

const table = minerals.mineralTable;
const count = minerals.mineralCount;
const hostIndex = minerals.hostIndex;
const targets = minerals.rarityTargets;

function near(actual, expected, tolerance, label) {
	assert.ok(Math.abs(actual - expected) < tolerance, `${label || ''} ${actual} !~ ${expected} (±${tolerance})`);
}

function sample() {
	const seeds = [37, 811, 1601, 2417, 3203];
	return geology.buildSample({ seeds, columns: 96, rows: 120 });
}

function statsFor(ranges, mode, specificity, hostWeight, block) {
	const formation = geology.compile(ranges, mode, specificity);
	const cache = geology.buildCache(block || sample(), formation);
	return geology.statsAt(cache, hostWeight, geology.emptyStats());
}

test('the mineral table is well formed', () => {
	const ids = new Set();
	for (let m = 0; m < count; m++) {
		const entry = table[m];
		assert.ok(!ids.has(entry.id), 'mineral ids are unique');
		ids.add(entry.id);
		assert.ok(entry.strength > 0 && entry.growth > 0);
		assert.equal(entry.color.length, 3);
		assert.ok(entry.demandPeriod > 0 && entry.demandDepth > 0);
		for (const range of [entry.r, entry.g, entry.b]) {
			assert.ok(range[0] >= 0 && range[1] <= 1 && range[0] < range[1], entry.id + ' range is ordered and inside 0..1');
		}
	}
	assert.equal(minerals.ANY[0], 0);
	assert.equal(minerals.ANY[1], 1);
	assert.ok(geology.isUnconstrained(minerals.ANY));
	assert.ok(table[hostIndex].host);
	assert.ok(geology.isUnconstrained(table[hostIndex].r), 'the host is unconstrained on every channel');
	let total = 0;
	for (let m = 0; m < count; m++) total += targets[m];
	near(total, 1, 1e-9, 'rarity targets sum to the whole rock');
});

test('element channels are independent concentrations spread evenly over 0..1', () => {
	const block = sample();
	const bins = new Float64Array(10);
	for (let c = 0; c < 3; c++) {
		bins.fill(0);
		let sum = 0;
		for (let i = 0; i < block.cells; i++) {
			const value = block.elements[i * 3 + c];
			assert.ok(value >= 0 && value <= 1, 'a concentration is in 0..1');
			sum += value;
			bins[Math.min(9, Math.floor(value * 10))]++;
		}
		near(sum / block.cells, 0.5, 0.05, 'channel mean');
		for (let b = 0; b < 10; b++) near(bins[b] / block.cells, 0.1, 0.05, 'decile ' + b + ' of channel ' + c);
	}
	let normalised = 0;
	for (let i = 0; i < block.cells; i++) {
		let sum = 0;
		for (let c = 0; c < 3; c++) sum += block.elements[i * 3 + c];
		if (Math.abs(sum - 1) > 0.25) normalised++;
	}
	assert.ok(normalised > block.cells * 0.5, 'the three channels are not normalised against each other');
});

test('the raw noise is bell shaped and the remap evens it out', () => {
	const field = geology.createField({ seed: 5 });
	let rawSum = 0;
	let flatSum = 0;
	let extreme = 0;
	const values = new Float32Array(3);
	let cells = 0;
	for (let row = 0; row < 60; row++) {
		for (let column = 0; column < 96; column++) {
			field.elements(column, row, values);
			rawSum += field.raw(column, row, 0);
			flatSum += values[0];
			if (values[0] > 0.9 || values[0] < 0.1) extreme++;
			cells++;
		}
	}
	near(rawSum / cells, 0.5, 0.05, 'raw noise is centred');
	near(flatSum / cells, 0.5, 0.05, 'remapped field is centred');
	near(extreme / cells, 0.2, 0.06, 'a fifth of all cells sit in the outer fifth of each side');
});

test('deposits are flattened in Y by the geological compression', () => {
	const block = sample();
	const stepX = [0, 0, 0];
	const stepY = [0, 0, 0];
	let pairs = 0;
	for (let row = 1; row < 120; row++) {
		for (let column = 1; column < 96; column++) {
			const at = (row * 96 + column) * 3;
			for (let c = 0; c < 3; c++) {
				stepX[c] += Math.abs(block.elements[at + c] - block.elements[at - 3 + c]);
				stepY[c] += Math.abs(block.elements[at + c] - block.elements[at - 96 * 3 + c]);
			}
			pairs++;
		}
	}
	for (let c = 0; c < 3; c++) near(stepY[c] / stepX[c], geology.defaultYCompression, 0.6, 'channel ' + c + ' seam flattening');
});

test('membership is bounded, feathered and zero ended', () => {
	near(geology.membership(0.5, 0.4, 0.6, 0.08), 1, 1e-9, 'inside the range');
	near(geology.membership(0.5, 0.4, 0.6, 0), 1, 1e-9, 'inside, no feather');
	assert.equal(geology.membership(0.7, 0.4, 0.6, 0.08), 0, 'beyond the feather');
	assert.equal(geology.membership(0.4, 0.4, 0.6, 0.08), 1, 'on the low edge');
	let previous = Infinity;
	for (let value = 0.6; value <= 0.69; value += 0.01) {
		const weight = geology.membership(value, 0.4, 0.6, 0.08);
		assert.ok(weight < previous, 'membership falls monotonically outside the range');
		previous = weight;
	}
	near(geology.featherFor(0.1), 0.035, 1e-9, 'a narrow range keeps a narrow feather');
	near(geology.featherFor(0.5), 0.08, 1e-9, 'a broad range keeps the cap');
});

test('the compiled table reproduces exact membership', () => {
	const ranges = geology.rangesOf(table);
	const formation = geology.compile(ranges, 'balanced', 0.6);
	let worst = 0;
	for (let m = 0; m < count; m++) {
		for (let c = 0; c < 3; c++) {
			const range = ranges[m][c];
			if (geology.isUnconstrained(range)) continue;
			const feather = geology.featherFor(range[1] - range[0]);
			for (let i = 0; i <= 200; i++) {
				const value = i / 200;
				const exact = geology.membership(value, range[0], range[1], feather);
				worst = Math.max(worst, Math.abs(formation.membershipAt(m, c, value) - exact));
			}
		}
	}
	assert.ok(worst < 0.005, 'the lookup table is within ' + worst + ' of the exact curve');
});

test('every mix sums to 1 and unmatched geology falls back to the host', () => {
	const ranges = geology.rangesOf(table);
	const formation = geology.compile(ranges, 'balanced', 0.6);
	const mix = new Float64Array(count);
	const block = sample();
	for (let i = 0; i < block.cells; i += 97) {
		const values = [block.elements[i * 3], block.elements[i * 3 + 1], block.elements[i * 3 + 2]];
		formation.mixInto(values, 0.08, mix, 0);
		let total = 0;
		for (let m = 0; m < count; m++) {
			assert.ok(mix[m] >= 0 && mix[m] <= 1);
			total += mix[m];
		}
		near(total, 1, 1e-6, 'the mix is normalised');
	}
	// A cell outside every signature: the element cube always has one, and it
	// must be pure host rather than the nearest rare box.
	let outside = 0;
	for (let i = 0; i < block.cells; i++) {
		const values = [block.elements[i * 3], block.elements[i * 3 + 1], block.elements[i * 3 + 2]];
		formation.affinityInto(values, mix, 0);
		let total = 0;
		for (let m = 0; m < count; m++) total += mix[m];
		if (total > 0) continue;
		formation.mixInto(values, 0.08, mix, 0);
		near(mix[hostIndex], 1, 1e-9, 'a cell with no affinity is pure host');
		outside++;
	}
	assert.ok(outside > 0, 'the sample contains cells outside every signature');
});

test('every ore can lead a cell somewhere in the element cube', () => {
	const ranges = geology.rangesOf(table);
	const formation = geology.compile(ranges, 'balanced', 0.6);
	const mix = new Float64Array(count);
	const steps = 21;
	const leads = new Float64Array(count);
	let cells = 0;
	const point = [0, 0, 0];
	for (let r = 0; r < steps; r++) {
		point[0] = r / (steps - 1);
		for (let g = 0; g < steps; g++) {
			point[1] = g / (steps - 1);
			for (let b = 0; b < steps; b++) {
				point[2] = b / (steps - 1);
				formation.mixInto(point, 0.08, mix, 0);
				let largest = 0;
				for (let m = 1; m < count; m++) if (mix[m] > mix[largest]) largest = m;
				leads[largest]++;
				cells++;
			}
		}
	}
	for (let m = 0; m < count; m++) {
		assert.ok(leads[m] / cells > 0.005, table[m].id + ' leads ' + (leads[m] / cells * 100).toFixed(2) + '% of the cube');
	}
	// A full match is mostly that mineral, with the host matrix still present.
	const centre = [];
	for (let c = 0; c < 3; c++) centre.push((ranges[4][c][0] + ranges[4][c][1]) * 0.5);
	formation.mixInto(centre, 0.08, mix, 0);
	let largest = 0;
	for (let m = 1; m < count; m++) if (mix[m] > mix[largest]) largest = m;
	assert.equal(largest, 4, 'corundum leads at the centre of its own signature');
	assert.ok(mix[4] > 0.5, 'and takes most of the cell: ' + mix[4].toFixed(3));
	assert.ok(mix[hostIndex] > 0, 'a full match keeps some host matrix');
});

test('the balanced affinity keeps a three-condition ore competitive', () => {
	// One narrow ore inside a broad one: with the plain product the broad box
	// always wins, with the geometric mean the better match wins.
	const ranges = geology.rangesOf(table);
	ranges[1] = [[0.2, 0.9], [0.1, 0.9], [0.1, 0.9]];
	ranges[2] = [[0.45, 0.55], [0.45, 0.55], [0.45, 0.55]];
	const middle = [0.5, 0.5, 0.5];
	// Inside the narrow box both match perfectly, so the plain product can only
	// ever tie it with the broad box: the narrow ore never leads a cell.
	function lead(mode, specificity) {
		const formation = geology.compile(ranges, mode, specificity);
		const mix = new Float64Array(count);
		formation.mixInto(middle, 0.08, mix, 0);
		return mix[2] - mix[1];
	}
	assert.ok(lead('product', 0) <= 1e-9, 'the plain product does not let the narrow box lead');
	assert.ok(lead('balanced', 0.6) > 0.05, 'the geometric mean with a specificity edge does');
});

test('the host weight is the one knob for how much matrix the rock holds', () => {
	const ranges = geology.rangesOf(table);
	const formation = geology.compile(ranges, 'balanced', 0.6);
	const cache = geology.buildCache(sample(), formation);
	let previous = 0;
	for (const weight of [0.02, 0.08, 0.3, 1, 3]) {
		const share = geology.meanHostShare(cache, weight);
		assert.ok(share > previous, 'a heavier host weight means more host rock');
		previous = share;
	}
	const solved = geology.solveHostWeight(cache, targets[hostIndex]);
	const minimumShare = geology.meanHostShare(cache, 1e-4);
	near(geology.meanHostShare(cache, solved), Math.max(targets[hostIndex], minimumShare), 0.005, 'the solver reaches the target or the unmatched-host floor');
});

test('calibration preserves the low-metal, low-crystal gas signature', () => {
	const ranges = geology.rangesOf(table);
	const gas = minerals.mineralIds.indexOf('gas');
	const original = ranges[gas].map(range => range.slice());
	const result = geology.autoAdjust({ sample: sample(), ranges, targets, mode: 'balanced', specificity: 0.6, hostWeight: 0.08 });
	assert.deepEqual(ranges[gas], original);
	assert.ok(result.stats.shares[gas] > 0);
	assert.ok(result.stats.dominant[gas] > 0);
	assert.ok(table[gas].strength < 1);
	assert.ok(result.history.length > 0);
});

test('the shipped table puts some of every mineral on a fresh sample', () => {
	const stats = statsFor(geology.rangesOf(table), 'balanced', 0.6, 0.08, sample());
	for (let m = 0; m < count; m++) {
		assert.ok(stats.visible[m] > 0.01, table[m].id + ' is visible in ' + (stats.visible[m] * 100).toFixed(2) + '% of cells');
		assert.ok(stats.dominant[m] > 0.005, table[m].id + ' dominates ' + (stats.dominant[m] * 100).toFixed(2) + '% of cells');
	}
	assert.ok(stats.shares[hostIndex] > 0.3 && stats.shares[hostIndex] < 0.5, 'host share remains substantial');
	const common = stats.shares[minerals.mineralIds.indexOf('iron')];
	const rare = stats.shares[minerals.mineralIds.indexOf('corundum')];
	const veryRare = stats.shares[minerals.mineralIds.indexOf('gold')];
	assert.ok(common > rare && rare > veryRare, 'measured abundance follows the rarity tiers');
});

test('separate() gives a swallowed signature an edge of its own', () => {
	const ranges = geology.rangesOf(table);
	ranges[1] = [[0.2, 0.9], [0.1, 0.9], [0.1, 0.9]];
	ranges[2] = [[0.4, 0.6], [0.4, 0.6], [0.4, 0.6]];
	assert.ok(geology.contains(ranges[1], ranges[2]), 'the narrow box starts inside the broad one');
	geology.separate(ranges, 0.06);
	assert.ok(!geology.contains(ranges[1], ranges[2]), 'it no longer sits inside');
});
