'use strict';
// 13-mineral geology calibration probe for 0.3.6 Solubility-plan §4.2.
// Mirrors js/geology.js autoAdjust (solveHostWeight + statsAt + scaleRange +
// separate) for the proposed 13-mineral table, which js/geology.js itself
// cannot host yet (its cache is sized by the live 10-mineral table).
// Copper-family gate: Blue Vitriol starts narrowed (r 0.46-0.76, b 0.54-0.74)
// and copper + vitriol targets sum to the 7.83% baseline copper share.
const Geo = require('../js/geology.js');

const NAMES = ['stone', 'iron', 'copper', 'vitriol', 'quartz', 'corundum', 'fluorite', 'silver', 'gold', 'gas', 'sand', 'halite', 'fizzy'];
const INITIAL = [
	[[0, 1], [0, 1], [0, 1]],
	[[0.28, 0.99], [0.00, 0.54], [0.00, 0.63]],
	[[0.31, 0.79], [0.02, 0.38], [0.18, 0.46]],
	[[0.46, 0.76], [0.06, 0.36], [0.54, 0.74]],
	[[0.00, 0.48], [0.23, 0.87], [0.00, 0.56]],
	[[0.10, 0.40], [0.70, 0.95], [0.05, 0.30]],
	[[0.07, 0.38], [0.11, 0.54], [0.62, 0.98]],
	[[0.67, 0.96], [0.26, 0.55], [0.04, 0.33]],
	[[0.82, 0.98], [0.06, 0.26], [0.42, 0.66]],
	[[0.00, 0.20], [0.00, 0.20], [0.80, 1.00]],
	[[0.02, 0.38], [0.28, 0.68], [0.25, 0.55]],
	[[0.62, 0.92], [0.68, 0.96], [0.04, 0.34]],
	[[0.64, 0.94], [0.68, 0.96], [0.68, 0.96]]
];
const M = NAMES.length;
const HOST = 0;

// Plan §4.1 shares with the copper family rebalanced to its 7.83% baseline:
// copper and vitriol each target half of it, the rest scales to fill 100%.
const PLAN_SHARES = [24.81, 16.28, 0, 0, 15.82, 3.37, 8.20, 3.03, 1.21, 0.94, 4.24, 6.43, 6.03];
const COPPER_FAMILY = 7.83;
const othersSum = PLAN_SHARES.reduce((a, b) => a + b, 0);
const fillScale = (100 - COPPER_FAMILY) / othersSum;
const targets = PLAN_SHARES.map(v => v * fillScale / 100);
targets[2] = COPPER_FAMILY / 200;
targets[3] = COPPER_FAMILY / 200;

function buildCache(sample, formation) {
	const affinities = new Float64Array(sample.cells * M);
	const totals = new Float64Array(sample.cells);
	const values = new Float64Array(3);
	const row = new Float64Array(M);
	for (let i = 0; i < sample.cells; i++) {
		values[0] = sample.elements[i * 3];
		values[1] = sample.elements[i * 3 + 1];
		values[2] = sample.elements[i * 3 + 2];
		formation.affinityInto(values, row, 0);
		let total = 0;
		for (let m = 0; m < M; m++) {
			affinities[i * M + m] = row[m];
			if (m !== HOST) total += row[m];
		}
		totals[i] = total;
	}
	return { affinities, totals, cells: sample.cells };
}

function statsAt(cache, hostWeight, out) {
	out.fill(0);
	for (let i = 0; i < cache.cells; i++) {
		const total = cache.totals[i] + hostWeight;
		const scale = total > 0 ? 1 / total : 0;
		out[HOST] += hostWeight * scale;
		const base = i * M;
		for (let m = 1; m < M; m++) out[m] += cache.affinities[base + m] * scale;
	}
	for (let m = 0; m < M; m++) out[m] /= cache.cells;
	return out;
}

function meanHostShare(cache, hostWeight) {
	let sum = 0;
	for (let i = 0; i < cache.cells; i++) sum += hostWeight / (cache.totals[i] + hostWeight);
	return sum / cache.cells;
}

function solveHostWeight(cache, target) {
	let low = 1e-4, high = 64;
	for (let k = 0; k < 40; k++) {
		const mid = Math.sqrt(low * high);
		if (meanHostShare(cache, mid) > target) high = mid; else low = mid;
	}
	return Math.sqrt(low * high);
}

function scaleRange(range, factor) {
	const width = Math.min(1, Math.max(0.01, (range[1] - range[0]) * factor));
	const centre = (range[0] + range[1]) * 0.5;
	let low = centre - width * 0.5;
	let high = low + width;
	if (low < 0) { low = 0; high = width; }
	if (high > 1) { high = 1; low = 1 - width; }
	range[0] = low;
	range[1] = high;
}

function isUnconstrained(range) { return range[0] <= 0 && range[1] >= 1; }

function contains(outer, inner) {
	for (let c = 0; c < 3; c++) if (inner[c][0] < outer[c][0] - 1e-9 || inner[c][1] > outer[c][1] + 1e-9) return false;
	return true;
}

function escapeShift(range, outer, escape, toHigh) {
	const width = range[1] - range[0];
	const edge = toHigh ? outer[1] + escape : outer[0] - escape;
	let low = toHigh ? edge - width : edge;
	let high = low + width;
	if (low < 0) { low = 0; high = width; }
	if (high > 1) { high = 1; low = 1 - width; }
	const gain = toHigh ? high - outer[1] : outer[0] - low;
	return gain < escape * 0.5 ? 0 : Math.abs(low - range[0]);
}

// Same geometry-only spread pass as js/geology.js separate(), extended to 13.
function separate(ranges, escape) {
	for (let inner = 0; inner < M; inner++) {
		if (inner === HOST || NAMES[inner] === 'gas') continue;
		for (let outer = 0; outer < M; outer++) {
			if (outer === HOST || outer === inner) continue;
			if (!contains(ranges[outer], ranges[inner])) continue;
			let best = Infinity, bestChannel = -1, bestLow = 0, bestHigh = 0;
			for (let c = 0; c < 3; c++) {
				const o = ranges[outer][c], i = ranges[inner][c];
				const width = i[1] - i[0];
				const high = escapeShift(i, o, escape, true);
				const low = escapeShift(i, o, escape, false);
				if (high > 0 && high < best) { best = high; bestChannel = c; bestLow = o[1] + escape - width; bestHigh = o[1] + escape; }
				if (low > 0 && low < best) { best = low; bestChannel = c; bestLow = o[0] - escape; bestHigh = o[0] - escape + width; }
			}
			if (bestChannel < 0) continue;
			ranges[inner][bestChannel][0] = Math.max(0, Math.min(1, bestLow));
			ranges[inner][bestChannel][1] = Math.max(0, Math.min(1, bestHigh));
		}
	}
}

function main() {
	const ranges = INITIAL.map(box => box.map(range => range.slice()));
	const sample = Geo.buildSample({ seeds: [1, 2, 3, 4, 5, 6, 7, 8], columns: 192, rows: 120, frequency: 0.075, yCompression: 3 });
	const shares = new Float64Array(M);
	let formation = Geo.compile(ranges, 'balanced', 0.6);
	let cache = buildCache(sample, formation);
	let hostWeight = 0.08;
	let passes = 0;
	for (let pass = 0; pass < 30; pass++) {
		passes = pass + 1;
		hostWeight = Math.max(0.06, solveHostWeight(cache, targets[HOST]));
		statsAt(cache, hostWeight, shares);
		let worst = 0;
		for (let m = 1; m < M; m++) worst = Math.max(worst, Math.abs(shares[m] - targets[m]) / targets[m]);
		if (worst <= 0.03) { passes = pass; break; }
		for (let m = 1; m < M; m++) {
			if (NAMES[m] === 'gas') continue;
			const ratio = targets[m] / Math.max(shares[m], 1e-6);
			const factor = Math.min(1.25, Math.max(0.8, Math.pow(ratio, 0.3)));
			for (let c = 0; c < 3; c++) {
				const range = ranges[m][c];
				if (isUnconstrained(range)) continue;
				if (range[1] - range[0] >= 1 && factor > 1) continue;
				scaleRange(range, factor);
			}
		}
		separate(ranges, 0.06);
		formation = Geo.compile(ranges, 'balanced', 0.6);
		cache = buildCache(sample, formation);
	}
	hostWeight = Math.max(0.06, solveHostWeight(cache, targets[HOST]));
	statsAt(cache, hostWeight, shares);

	const fmt = v => v.toFixed(3);
	console.log('0.3.6 solubility geology calibration (8 seeds x 192x120, balanced, specificity 0.6, hostWeight solved)');
	console.log('passes=' + passes + ' hostWeight=' + hostWeight.toFixed(4));
	console.log('copper+vitriol=' + (100 * (shares[2] + shares[3])).toFixed(2) + '% (baseline copper 7.83%)');
	for (let m = 0; m < M; m++) {
		const box = ranges[m];
		console.log(NAMES[m] + ' share=' + (100 * shares[m]).toFixed(2) + '% target=' + (100 * targets[m]).toFixed(2) +
			'% r:[' + fmt(box[0][0]) + ', ' + fmt(box[0][1]) + '] g:[' + fmt(box[1][0]) + ', ' + fmt(box[1][1]) + '] b:[' + fmt(box[2][0]) + ', ' + fmt(box[2][1]) + ']');
	}
}

main();
