'use strict';
// Measure the element field and the mineral mix of js/minerals.js +
// js/geology.js: element distribution, seam flattening, per-mineral shares
// (mean fraction, dominant and visible share), the host share, and the ranges
// calibration settles on. Run with `node experiments/mineral-field-probe.cjs`.
// Options: --seeds=6 --columns=120 --depth=160 --mode=balanced --adjust
const geology = require('../js/geology.js');
const minerals = require('../js/minerals.js');

const args = process.argv.slice(2);
function option(name, fallback) {
	const hit = args.find(arg => arg.startsWith('--' + name + '='));
	return hit ? Number(hit.split('=')[1]) || hit.split('=')[1] : fallback;
}
const seedCount = Number(option('seeds', 6));
const columns = Number(option('columns', 120));
const depth = Number(option('depth', 160));
const mode = option('mode', 'balanced');
const withAdjust = args.includes('--adjust') || option('adjust', 0) === 1;
const seeds = [];
for (let s = 0; s < seedCount; s++) seeds.push(37 + s * 811);
const sample = geology.buildSample({ seeds, columns, rows: depth });
const table = minerals.mineralTable;
const count = minerals.mineralCount;
const targets = minerals.rarityTargets;

function pad(text, width) { return String(text).padStart(width); }

console.log('element field: ' + seedCount + ' seeds, ' + columns + ' columns, ' + depth + ' rows deep, ' + sample.cells + ' cells');
{
	const mean = [0, 0, 0];
	const sd = [0, 0, 0];
	
	const bins = new Float64Array(10);
	const gradientX = [0, 0, 0];
	const gradientY = [0, 0, 0];
	let pairs = 0;
	for (let c = 0; c < 3; c++) {
		bins.fill(0);
		for (let i = 0; i < sample.cells; i++) {
			const v = sample.elements[i * 3 + c];
			mean[c] += v;
			sd[c] += v * v;
			bins[Math.min(9, Math.floor(v * 10))]++;
		}
		mean[c] /= sample.cells;
		sd[c] = Math.sqrt(sd[c] / sample.cells - mean[c] * mean[c]);
	}
	for (let row = 1; row < depth; row++) {
		for (let column = 1; column < columns; column++) {
			const at = (row * columns + column) * 3;
			const left = at - 3;
			const up = at - columns * 3;
			for (let c = 0; c < 3; c++) {
				gradientX[c] += Math.abs(sample.elements[at + c] - sample.elements[left + c]);
				gradientY[c] += Math.abs(sample.elements[at + c] - sample.elements[up + c]);
			}
			pairs++;
		}
	}
	console.log('channel   mean      sd   evenness (share per 0..1 decile, uniform = 10.00%)');
	for (let c = 0; c < 3; c++) {
		bins.fill(0);
		for (let i = 0; i < sample.cells; i++) bins[Math.min(9, Math.floor(sample.elements[i * 3 + c] * 10))]++;
		const row = [];
		for (let b = 0; b < 10; b++) row.push((bins[b] / sample.cells * 100).toFixed(2));
		console.log('  ' + 'RGB'[c] + '     ' + mean[c].toFixed(4) + '  ' + sd[c].toFixed(4) + '  ' + row.join(' '));
	}
	console.log('seam flattening (row gradient / column gradient, target ' + geology.defaultYCompression + '):');
	for (let c = 0; c < 3; c++) console.log('  ' + 'RGB'[c] + '  ' + (gradientY[c] / gradientX[c]).toFixed(2));
}

function report(label, ranges, hostWeight, stats) {
	console.log('\n' + label + ', host weight ' + hostWeight.toFixed(4));
	console.log('mineral              target    share  dominant  visible   ranges R / G / B');
	for (let m = 0; m < count; m++) {
		const entry = table[m];
		const rangesText = [ranges[m][0], ranges[m][1], ranges[m][2]].map(r =>
			geology.isUnconstrained(r) ? 'any' : r[0].toFixed(2) + '-' + r[1].toFixed(2)).join('  ');
		console.log(entry.name.padEnd(20) + pad((targets[m] * 100).toFixed(1) + '%', 7) +
			pad((stats.shares[m] * 100).toFixed(2) + '%', 9) + pad((stats.dominant[m] * 100).toFixed(2) + '%', 9) +
			pad((stats.visible[m] * 100).toFixed(2) + '%', 9) + '   ' + rangesText);
	}
	console.log('host rock share ' + (stats.shares[minerals.hostIndex] * 100).toFixed(2) + '% (target ' +
		(targets[minerals.hostIndex] * 100).toFixed(1) + '%), cells over 90% host ' + (stats.hostPure * 100).toFixed(2) + '%');
}

// The two affinity settings worth comparing: the calibrated one the table was
// tuned with, and the plain product of memberships without a specificity edge.
const settings = [
	{ mode: 'balanced', specificity: 0.6, label: 'balanced + specificity 0.60 (calibrated)' },
	{ mode: 'product', specificity: 0, label: 'product, no specificity' }
];
const shipped = geology.rangesOf(table);
for (const setting of settings) {
	const formation = geology.compile(shipped, setting.mode, setting.specificity);
	const cache = geology.buildCache(sample, formation);
	const stats = geology.emptyStats();
	report(setting.label + ' · host weight 0.08', shipped, 0.08, geology.statsAt(cache, 0.08, stats));
	const solved = geology.solveHostWeight(cache, targets[minerals.hostIndex]);
	report(setting.label + ' · host weight solved for the target', shipped, solved, geology.statsAt(cache, solved, stats));
}

if (withAdjust) {
	for (const modeName of ['product', 'balanced']) {
		const ranges = geology.rangesOf(table);
		const started = Date.now();
		const result = geology.autoAdjust({ sample, ranges, targets, mode: modeName, hostWeight: 0.08 });
		report('auto-adjusted ranges (' + (Date.now() - started) + ' ms, ' + result.history.length + ' passes)',
			ranges, result.hostWeight, result.stats);
		console.log('paste into js/minerals.js:');
		for (let m = 1; m < count; m++) {
			const parts = ['r', 'g', 'b'].map((key, c) => {
				const r = ranges[m][c];
				return geology.isUnconstrained(r) ? key + ': ANY' :
					key + ': Object.freeze([' + r[0].toFixed(2) + ', ' + r[1].toFixed(2) + '])';
			});
			console.log('  ' + table[m].id + ': ' + parts.join(', ') + ',');
		}
	}
}
