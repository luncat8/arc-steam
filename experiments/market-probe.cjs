'use strict';
// Measure the mineral market and formation of js/ceiling.js: how element ranges
// form the ores, where connected crystal pockets sit in the strength histogram,
// how each seed opens its demand, and how quotes drift and respond to a sale.
// Run with `node experiments/market-probe.cjs`.
const ceiling = require('../js/ceiling.js');

const blankWorld = () => ({ platform: { x: -40, vx: 0 }, heat: 0, time: 0, direction: 0 });

function crystalPockets(state) {
	const columns = state.columns;
	const rows = state.rows;
	const cells = columns * rows;
	const seen = new Uint8Array(cells);
	const queue = new Int32Array(cells);
	const sizes = [];
	let crystalCells = 0;
	for (let start = 0; start < cells; start++) {
		if (seen[start] || state.minerals[start * 3 + 2] < 0.5) continue;
		let head = 0;
		let tail = 0;
		queue[tail++] = start;
		seen[start] = 1;
		while (head < tail) {
			const index = queue[head++];
			const column = index % columns;
			let next = index - 1;
			if (column > 0 && !seen[next] && state.minerals[next * 3 + 2] >= 0.5) {
				seen[next] = 1;
				queue[tail++] = next;
			}
			next = index + 1;
			if (column + 1 < columns && !seen[next] && state.minerals[next * 3 + 2] >= 0.5) {
				seen[next] = 1;
				queue[tail++] = next;
			}
			next = index - columns;
			if (index >= columns && !seen[next] && state.minerals[next * 3 + 2] >= 0.5) {
				seen[next] = 1;
				queue[tail++] = next;
			}
			next = index + columns;
			if (index + columns < cells && !seen[next] && state.minerals[next * 3 + 2] >= 0.5) {
				seen[next] = 1;
				queue[tail++] = next;
			}
		}
		crystalCells += tail;
		sizes.push(tail);
	}
	sizes.sort((a, b) => a - b);
	return {
		cells: crystalCells,
		count: sizes.length,
		sizes,
		median: sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0,
		p90: sizes.length ? sizes[Math.floor(sizes.length * 0.9)] : 0,
		max: sizes.length ? sizes[sizes.length - 1] : 0
	};
}

function quantile(sorted, p) {
	return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] || 0;
}

function field(seed) {
	ceiling.reset(seed);
	const s = ceiling.state;
	const cells = s.columns * s.rows;
	const mix = [0, 0, 0];
	const elementMean = [0, 0, 0];
	const dominant = [0, 0, 0];
	const sums = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
	const copperRuns = [];
	const strengthValues = Array.from(s.initialStrength);
	const strengthBands = [0, 0, 0, 0, 0, 0];
	let strengthTotal = 0;
	let value = 0;
	const ranked = [];
	for (let index = 0; index < cells; index++) {
		const offset = index * 3;
		let best = -1;
		let which = 0;
		for (let m = 0; m < 3; m++) {
			const share = s.minerals[offset + m];
			const element = s.elements[offset + m];
			mix[m] += share;
			elementMean[m] += element;
			value += share * s.referencePrices[m];
			sums[m][0] += element;
			sums[m][1] += share;
			sums[m][2] += element * element;
			sums[m][3] += share * share;
			sums[m][4] += element * share;
			if (share > best) { best = share; which = m; }
		}
		dominant[which]++;
		ranked.push(best);
		const strength = s.initialStrength[index];
		strengthTotal += strength;
		if (strength < 4.5) strengthBands[0]++;
		else if (strength < 4.75) strengthBands[1]++;
		else if (strength < 5) strengthBands[2]++;
		else if (strength < 5.25) strengthBands[3]++;
		else if (strength < 5.5) strengthBands[4]++;
		else strengthBands[5]++;
	}
	let run = 0;
	for (let index = 0; index < cells; index++) {
		if (s.minerals[index * 3 + 1] > 0.5) run++;
		else { if (run) copperRuns.push(run); run = 0; }
		if (index % s.columns === s.columns - 1) { if (run) copperRuns.push(run); run = 0; }
	}
	copperRuns.sort((a, b) => a - b);
	const correlation = sums.map(t => (cells * t[4] - t[0] * t[1]) / Math.sqrt((cells * t[2] - t[0] * t[0]) * (cells * t[3] - t[1] * t[1])));
	const pockets = crystalPockets(s);
	ranked.sort((a, b) => a - b);
	strengthValues.sort((a, b) => a - b);
	return {
		mix: mix.map(total => total / cells),
		elementMean: elementMean.map(total => total / cells),
		dominant: dominant.map(total => total / cells),
		median: ranked[Math.floor(ranked.length / 2)],
		ninetieth: ranked[Math.floor(ranked.length * 0.9)],
		cellValue: value / cells,
		correlation,
		copperRuns: {
			median: copperRuns.length ? copperRuns[Math.floor(copperRuns.length / 2)] : 0,
			p90: copperRuns.length ? copperRuns[Math.floor(copperRuns.length * 0.9)] : 0
		},
		pockets,
		strength: {
			mean: strengthTotal / cells,
			p95: quantile(strengthValues, 0.95),
			p99: quantile(strengthValues, 0.99),
			bands: strengthBands.map(value => value / cells)
		},
		open: Array.from(s.mineralPrices),
		startup: Array.from(s.startupDemand)
	};
}

function drift(seed, seconds) {
	ceiling.reset(seed);
	const s = ceiling.state;
	const world = blankWorld();
	const series = [[], [], []];
	for (let second = 0; second <= seconds; second++) {
		if (second) ceiling.step(world, 1, 60);
		for (let m = 0; m < 3; m++) series[m].push(s.mineralPrices[m]);
	}
	return series.map(values => {
		let move = 0;
		let turns = 0;
		let window = 1;
		for (let second = 1; second < values.length; second++) {
			move = Math.max(move, Math.abs(values[second] / values[second - 1] - 1));
			if (second > 1 && Math.sign(values[second] - values[second - 1]) !== Math.sign(values[second - 1] - values[second - 2])) turns++;
		}
		for (let start = 0; start + 180 < values.length; start++) {
			let low = Infinity;
			let high = 0;
			for (let second = start; second <= start + 180; second++) {
				low = Math.min(low, values[second]);
				high = Math.max(high, values[second]);
			}
			window = Math.max(window, high / low);
		}
		return { low: Math.min(...values), high: Math.max(...values), step: move, turns, window, values };
	});
}

function glut(seed) {
	ceiling.reset(seed);
	const s = ceiling.state;
	for (let x = 1; x < 23; x += 2) { ceiling.damage(x, s.bottom + 0.2, 20); ceiling.collapse(2); }
	for (let i = 0; i < s.active.length; i++) if (s.active[i]) {
		s.debrisX[i] = 11;
		s.debrisY[i] = 0.701;
		s.debrisVx[i] = 0;
		s.debrisVy[i] = -1;
	}
	ceiling.step({ platform: { x: 12, vx: 0 }, heat: 0, time: 0 }, 0.01, 60);
	const cells = s.cargoCells;
	const before = Array.from(s.mineralPrices);
	ceiling.sellCargo(0, 1);
	const world = blankWorld();
	const after = Array.from(s.mineralPrices);
	const pressures = [Array.from(s.supplyPressure)];
	const quotes = [after];
	for (let second = 1; second <= 120; second++) {
		ceiling.step(world, 1, 60);
		if (second % 20 === 0) { pressures.push(Array.from(s.supplyPressure)); quotes.push(Array.from(s.mineralPrices)); }
	}
	return { cells, before, after, pressures, quotes };
}

console.log('FIELD FORMATION (per seed)');
console.log('seed | mix Fe/Cu/Cr      | dominant %        | median | p90  | mean cr | corr R/G/B | Cu runs m/p90 | Cr>=50 cells/pockets/p90/max | strength mean/p95/p99');
const seeds = [1, 2, 3, 7, 11, 42];
const fields = [];
for (const seed of seeds) {
	const f = field(seed);
	fields.push(f);
	console.log('%s | %s | %s | %s | %s | %s | %s | %s', String(seed).padStart(4),
		f.mix.map(v => v.toFixed(2)).join(' / '),
		f.dominant.map(v => (v * 100).toFixed(0).padStart(3)).join('/'),
		f.median.toFixed(2), f.ninetieth.toFixed(2), f.cellValue.toFixed(2),
		f.correlation.map(v => v.toFixed(2)).join('/'),
		f.copperRuns.median + '/' + f.copperRuns.p90,
		f.pockets.cells + '/' + f.pockets.count + '/' + f.pockets.p90 + '/' + f.pockets.max,
		[f.strength.mean, f.strength.p95, f.strength.p99].map(v => v.toFixed(2)).join('/'));
}

console.log('\nOPENING QUOTES AND GENERATED DEMAND');
for (let i = 0; i < seeds.length; i++) {
	const f = fields[i];
	console.log('seed %s  Fe %s  Cu %s  Cr %s   demand %s', String(seeds[i]).padStart(2),
		f.open[0].toFixed(2).padStart(6), f.open[1].toFixed(2).padStart(6), f.open[2].toFixed(2).padStart(6),
		f.startup.map(v => v.toFixed(2).padStart(5)).join(' '));
}

console.log('\nSTARTUP GENERATION ACROSS 60 SEEDS');
let rare = 0;
let common = 0;
let hotCommon = 0;
const ranges = [[Infinity, 0], [Infinity, 0], [Infinity, 0]];
const formationMix = [0, 0, 0];
const crystalCells = [];
const pocketCounts = [];
const pocketSizes = [];
const strengthMeans = [];
const strengthP95 = [];
const strengthP99 = [];
const strengthBands = [0, 0, 0, 0, 0, 0];
for (let seed = 1; seed <= 60; seed++) {
	const f = field(seed);
	if (f.open[2] > f.open[1] && f.open[2] > f.open[0]) rare++;
	else common++;
	if (f.open[1] > 14 || f.open[0] > 3) hotCommon++;
	for (let m = 0; m < 3; m++) {
		ranges[m][0] = Math.min(ranges[m][0], f.open[m]);
		ranges[m][1] = Math.max(ranges[m][1], f.open[m]);
		formationMix[m] += f.mix[m] / 60;
	}
	crystalCells.push(f.pockets.cells);
	pocketCounts.push(f.pockets.count);
	pocketSizes.push(...f.pockets.sizes);
	strengthMeans.push(f.strength.mean);
	strengthP95.push(f.strength.p95);
	strengthP99.push(f.strength.p99);
	for (let band = 0; band < 6; band++) strengthBands[band] += f.strength.bands[band] / 60;
}
console.log('crystal dearest %s / 60, common ore dearest %s / 60, a common ore above twice list %s / 60', rare, common, hotCommon);
console.log('opening quote band  Fe %s .. %s  Cu %s .. %s  Cr %s .. %s',
	ranges[0][0].toFixed(2), ranges[0][1].toFixed(2), ranges[1][0].toFixed(2), ranges[1][1].toFixed(2), ranges[2][0].toFixed(2), ranges[2][1].toFixed(2));
crystalCells.sort((a, b) => a - b);
pocketCounts.sort((a, b) => a - b);
pocketSizes.sort((a, b) => a - b);
const average = values => values.reduce((total, value) => total + value, 0) / values.length;
console.log('formation mix Fe/Cu/Cr %s', formationMix.map(value => value.toFixed(3)).join(' / '));
console.log('crystal >=50% cells %s / field average (%s%%); 4-connected pockets mean/median/p90 per field %s / %s / %s',
	average(crystalCells).toFixed(1), (average(crystalCells) / (ceiling.state.columns * ceiling.state.rows) * 100).toFixed(2),
	average(pocketCounts).toFixed(1), quantile(pocketCounts, 0.5), quantile(pocketCounts, 0.9));
console.log('pocket size cells median/p90/p99/max %s / %s / %s / %s', quantile(pocketSizes, 0.5), quantile(pocketSizes, 0.9), quantile(pocketSizes, 0.99), pocketSizes[pocketSizes.length - 1]);
console.log('strength mean %s; mean per-seed p95/p99 %s / %s; bands <4.5 / 4.5–4.75 / 4.75–5 / 5–5.25 / 5.25–5.5 / >=5.5: %s',
	average(strengthMeans).toFixed(3), average(strengthP95).toFixed(3), average(strengthP99).toFixed(3),
	strengthBands.map(value => (value * 100).toFixed(2) + '%').join(' / '));

console.log('\nDEMAND DRIFT OVER TEN MINUTES (no sale)');
for (const seed of [1, 7, 42]) {
	const drift10 = drift(seed, 600);
	console.log('seed %s', seed);
	for (let m = 0; m < 3; m++) {
		const d = drift10[m];
		const samples = [0, 60, 180, 360, 600].map(second => d.values[second].toFixed(1));
		console.log('  %s  %s .. %s  (%sx)  1 s max %s%%  best 180 s %sx  turns %s  at %s', ceiling.state.mineralNames[m].padEnd(8),
			d.low.toFixed(2), d.high.toFixed(2), (d.high / d.low).toFixed(1),
			(d.step * 100).toFixed(1), d.window.toFixed(1), d.turns, samples.join(' → '));
	}
}

console.log('\nWALL SALE FEEDBACK (one full hopper)');
const feedback = glut(7);
console.log('sold %s cells', feedback.cells);
console.log('before  %s', feedback.before.map(v => v.toFixed(2)).join(' / '));
console.log('after   %s  (discount %s)', feedback.after.map(v => v.toFixed(2)).join(' / '),
	feedback.after.map((v, m) => ((1 - v / feedback.before[m]) * 100).toFixed(1) + '%').join(' / '));
console.log('t(s) | pressure Fe/Cu/Cr | quote Fe/Cu/Cr');
for (let k = 0; k < feedback.pressures.length; k++) {
	console.log('%s | %s | %s', String(k * 20).padStart(4),
		feedback.pressures[k].map(v => (v * 100).toFixed(1).padStart(5)).join(' '),
		feedback.quotes[k].map(v => v.toFixed(2).padStart(6)).join(' '));
}
