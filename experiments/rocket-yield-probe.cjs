// What one rocket brings down from a fresh bed, and what of it lands on the
// platform that fired it. Run: node experiments/rocket-yield-probe.cjs
// The price in js/rockets.js is read against the `all` row: what the bin
// catches, valued at ordinary-rock prices.
const ceiling = require('../js/ceiling.js');
require('../js/equipment.js');
require('../js/research.js');
const physics = require('../js/physics.js');
const players = require('../js/players.js');
const rockets = require('../js/rockets.js');

const step = physics.config.step;
const seeds = [1, 7, 10, 21, 31, 47];
// Rig positions in metres, clear of both wall pockets.
const first = 2;
const last = 22;
const settle = 30;
const earlyWindow = 5;
const samples = [];

function percentile(sorted, share) {
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
}

// What a cell of ordinary rock sells for on this bed: the host, the common
// ores and the filler at their opening quotes, weighted by abundance. The
// price target is a rocket that pays for itself in this rock.
const ordinary = ['host', 'common', 'filler'];
function commonCellValue(rock) {
	let value = 0;
	let share = 0;
	for (let m = 0; m < rock.mineralCount; m++) {
		if (!ordinary.includes(rock.mineralTable[m].rarity)) continue;
		value += rock.mineralPrices[m] * rock.mineralAbundance[m];
		share += rock.mineralAbundance[m];
	}
	return value / share;
}

function sample(seed, p, fired) {
	const world = physics.createWorld();
	players.init(world, 0);
	ceiling.reset(seed);
	rockets.reset(seed * 100 + p);
	// The ball stays out of it: only the rocket works the rock.
	world.drive = false;
	world.platform.x = p;
	world.platform.previousX = p;
	if (fired) {
		rockets.fill(world);
		rockets.fire(world);
	}
	const rock = ceiling.state;
	const commonCell = commonCellValue(rock);
	let early = 0;
	for (let i = 0; i < Math.round(settle / step); i++) {
		physics.step(world, step);
		if (i === Math.round(earlyWindow / step)) early = rock.extractedCells;
	}
	return {
		seed,
		fired,
		dud: rockets.state.duds > 0,
		hits: rockets.state.shardHits,
		cells: rock.extractedCells,
		early,
		value: rock.lostValue + rock.caughtValue + rock.airborneValue,
		caughtValue: rock.caughtValue,
		commonValue: rock.caughtCells * commonCell
	};
}

for (const seed of seeds) {
	for (let p = first; p <= last; p++) {
		samples.push(sample(seed, p, true));
		samples.push(sample(seed, p, false));
	}
}

function row(label, list) {
	const cells = list.map(sample => sample.cells).sort((a, b) => a - b);
	const value = list.map(sample => sample.value).sort((a, b) => a - b);
	const caught = list.map(sample => sample.caughtValue).sort((a, b) => a - b);
	const common = list.map(sample => sample.commonValue).sort((a, b) => a - b);
	const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length;
	console.log(label.padEnd(10)
		+ ' n ' + String(list.length).padStart(3)
		+ ' | cells p25 ' + percentile(cells, 0.25) + ' median ' + percentile(cells, 0.5) + ' p75 ' + percentile(cells, 0.75) + ' mean ' + mean(cells).toFixed(1)
		+ ' | value cr p25 ' + percentile(value, 0.25).toFixed(1) + ' median ' + percentile(value, 0.5).toFixed(1) + ' p75 ' + percentile(value, 0.75).toFixed(1) + ' mean ' + mean(value).toFixed(1)
		+ ' | caught cr median ' + percentile(caught, 0.5).toFixed(1) + ' mean ' + mean(caught).toFixed(1)
		+ ' | caught at ordinary-rock prices cr median ' + percentile(common, 0.5).toFixed(1) + ' mean ' + mean(common).toFixed(1)
		+ ' | cells in first ' + earlyWindow + ' s ' + mean(list.map(sample => sample.early)).toFixed(1)
		+ ' | shard hits ' + mean(list.map(sample => sample.hits)).toFixed(1));
}

console.log('one rocket on a fresh bed, platform parked under it, ' + settle + ' s to settle, price ' + rockets.state.price + ' cr');
for (const seed of seeds) row('seed ' + seed, samples.filter(sample => sample.fired && sample.seed === seed));
row('all', samples.filter(sample => sample.fired));
row('duds', samples.filter(sample => sample.fired && sample.dud));
row('no rocket', samples.filter(sample => !sample.fired));
