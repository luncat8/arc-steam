'use strict';
// Measure the mineral market of js/ceiling.js: how the field forms its ores, how
// each ore's quote drifts on its own demand cycle, and how a wall sale feeds
// back into the price. Run with `node experiments/market-probe.cjs`.
const ceiling = require('../js/ceiling.js');

const blankWorld = () => ({ platform: { x: -40, vx: 0 }, heat: 0, time: 0, direction: 0 });

function field(seed) {
	ceiling.reset(seed);
	const s = ceiling.state;
	const cells = s.columns * s.rows;
	const mix = [0, 0, 0];
	const dominant = [0, 0, 0];
	let value = 0;
	const ranked = [];
	for (let index = 0; index < cells; index++) {
		const offset = index * 3;
		let best = -1;
		let which = 0;
		for (let m = 0; m < 3; m++) {
			const share = s.minerals[offset + m];
			mix[m] += share;
			value += share * s.referencePrices[m];
			if (share > best) { best = share; which = m; }
		}
		dominant[which]++;
		ranked.push(best);
	}
	ranked.sort((a, b) => a - b);
	return {
		mix: mix.map(total => total / cells),
		dominant: dominant.map(total => total / cells),
		median: ranked[Math.floor(ranked.length / 2)],
		ninetieth: ranked[Math.floor(ranked.length * 0.9)],
		cellValue: value / cells,
		open: Array.from(s.mineralPrices)
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
	return series.map((values, m) => {
		let move = 0;
		for (let second = 1; second < values.length; second++) move = Math.max(move, Math.abs(values[second] / values[second - 1] - 1));
		return { low: Math.min(...values), high: Math.max(...values), step: move, values };
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
	ceiling.sellCargo(0, 1);
	const world = blankWorld();
	const pressures = [Array.from(s.supplyPressure)];
	const quotes = [Array.from(s.mineralPrices)];
	for (let second = 1; second <= 120; second++) {
		ceiling.step(world, 1, 60);
		if (second % 20 === 0) { pressures.push(Array.from(s.supplyPressure)); quotes.push(Array.from(s.mineralPrices)); }
	}
	return { cells, pressures, quotes };
}

console.log('FIELD FORMATION (per seed)');
console.log('seed | mix Fe/Cu/Cr      | dominant %        | median cell | p90 cell | mean cr/cell');
for (const seed of [1, 2, 3, 7, 11, 42]) {
	const f = field(seed);
	console.log('%s | %s | %s | %s | %s | %s', String(seed).padStart(4),
		f.mix.map(v => v.toFixed(2)).join(' / '),
		f.dominant.map(v => (v * 100).toFixed(0).padStart(3)).join('/'),
		f.median.toFixed(2), f.ninetieth.toFixed(2), f.cellValue.toFixed(2));
}

console.log('\nOPENING QUOTES');
for (const seed of [1, 2, 3, 7, 11, 42]) {
	const f = field(seed);
	console.log('seed %s  Fe %s  Cu %s  Cr %s', String(seed).padStart(2),
		f.open[0].toFixed(2).padStart(6), f.open[1].toFixed(2).padStart(6), f.open[2].toFixed(2).padStart(6));
}

console.log('\nDEMAND DRIFT OVER TEN MINUTES (no sale)');
for (const seed of [1, 7, 42]) {
	const drift10 = drift(seed, 600);
	console.log('seed %s', seed);
	for (let m = 0; m < 3; m++) {
		const d = drift10[m];
		const values = d.values;
		const samples = [0, 60, 180, 360, 600].map(second => values[second].toFixed(1));
		console.log('  %s  %s .. %s  (%sx)  largest 1 s move %s%%  at %s', ceiling.state.mineralNames[m].padEnd(8),
			d.low.toFixed(2), d.high.toFixed(2), (d.high / d.low).toFixed(1),
			(d.step * 100).toFixed(1), samples.join(' → '));
	}
}

console.log('\nWALL SALE FEEDBACK (one full hopper)');
const feedback = glut(7);
console.log('sold %s cells', feedback.cells);
console.log('t(s) | pressure Fe/Cu/Cr | quote Fe/Cu/Cr');
for (let k = 0; k < feedback.pressures.length; k++) {
	console.log('%s | %s | %s', String(k * 20).padStart(4),
		feedback.pressures[k].map(v => (v * 100).toFixed(1).padStart(5)).join(' '),
		feedback.quotes[k].map(v => v.toFixed(2).padStart(6)).join(' '));
}
