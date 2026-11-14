// What a sandblaster brings down from a fresh bed, and what the stream costs
// to run. Run: node experiments/sandblaster-yield-probe.cjs
// The rig parks under a seam and holds the nozzle for a settle window; the
// magazine is refilled by grant between runs, so the abrasive the stream
// really spends is the grains that never come back. The price in
// js/sandblaster.js is read against the caught value at ordinary-rock prices,
// and the energy draw is priced at the emergency import rate.
const ceiling = require('../js/ceiling.js');
const equipment = require('../js/equipment.js');
require('../js/research.js');
const physics = require('../js/physics.js');
const players = require('../js/players.js');
const sandblaster = require('../js/sandblaster.js');

const step = physics.config.step;
const seeds = [1, 7, 10, 21, 31, 47];
// Rig positions in metres, clear of both wall pockets and off the pad.
const positions = [2, 5, 8, 11, 14, 17, 20];
const settle = 30;
const samples = [];

function percentile(sorted, share) {
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
}

// What a cell of ordinary rock sells for on this bed: the host, the common
// ores and the filler at their opening quotes, weighted by abundance. The
// price target is a stream that pays for itself in this rock.
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

function sample(seed, p, blast) {
	const world = physics.createWorld();
	players.init(world, 0);
	ceiling.reset(seed);
	sandblaster.reset(seed * 100 + p);
	sandblaster.setAutoBuy(false, 'rig');
	// The ball stays out of it: only the nozzle works the rock.
	world.drive = false;
	world.platform.x = p;
	world.platform.previousX = p;
	world.platform.vx = 0;
	if (blast) {
		if (!equipment.grant('sandblaster', world, 'rig') || !sandblaster.fill(world, 'rig')) {
			throw new Error('the sandblaster yield probe could not install and load the rig nozzle');
		}
	}
	const rock = ceiling.state;
	const sand = sandblaster.state;
	const commonCell = commonCellValue(rock);
	for (let i = 0; i < Math.round(settle / step); i++) {
		if (blast && sandblaster.canFire(world, 'rig')) {
			sandblaster.fire(world, 'rig');
			if (sand.charges <= 0) sandblaster.fill(world, 'rig');
		}
		physics.step(world, step);
	}
	const fired = sand.fired;
	const recovered = sand.recovered;
	const lost = sand.lost;
	const energyJ = fired * sand.shotEnergy;
	return {
		seed,
		blast,
		fired,
		recovered,
		lost,
		hits: sand.hits,
		cells: rock.extractedCells,
		caughtValue: rock.caughtValue,
		value: rock.caughtValue + rock.lostValue + rock.airborneValue,
		// The same catch valued at ordinary-rock prices, the base case.
		commonValue: rock.caughtCells * commonCell,
		// The abrasive the stream spent is the grains that never returned;
		// the energy is priced at the emergency import rate, the paid base.
		abrasive: lost * sand.price,
		energy: energyJ / 1000 * ceiling.state.fuelPrice,
		profit: rock.caughtValue - lost * sand.price - energyJ / 1000 * ceiling.state.fuelPrice,
		commonProfit: rock.caughtCells * commonCell - lost * sand.price - energyJ / 1000 * ceiling.state.fuelPrice
	};
}

for (const seed of seeds) {
	for (const p of positions) {
		samples.push(sample(seed, p, true));
		samples.push(sample(seed, p, false));
	}
}

function row(label, list) {
	const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length;
	const cell = list.map(sample => sample.cells).sort((a, b) => a - b);
	const caught = list.map(sample => sample.caughtValue).sort((a, b) => a - b);
	const common = list.map(sample => sample.commonValue).sort((a, b) => a - b);
	const profit = list.map(sample => sample.profit).sort((a, b) => a - b);
	const commonProfit = list.map(sample => sample.commonProfit).sort((a, b) => a - b);
	const fired = list.map(sample => sample.fired);
	const lost = list.map(sample => sample.lost);
	console.log(label.padEnd(10)
		+ ' n ' + String(list.length).padStart(3)
		+ ' | cells p25 ' + percentile(cell, 0.25) + ' median ' + percentile(cell, 0.5) + ' p75 ' + percentile(cell, 0.75) + ' mean ' + mean(cell).toFixed(1)
		+ ' | caught cr p25 ' + percentile(caught, 0.25).toFixed(1) + ' median ' + percentile(caught, 0.5).toFixed(1) + ' p75 ' + percentile(caught, 0.75).toFixed(1) + ' mean ' + mean(caught).toFixed(1)
		+ ' | caught at ordinary prices cr median ' + percentile(common, 0.5).toFixed(1) + ' mean ' + mean(common).toFixed(1)
		+ ' | profit cr p25 ' + percentile(profit, 0.25).toFixed(1) + ' median ' + percentile(profit, 0.5).toFixed(1) + ' p75 ' + percentile(profit, 0.75).toFixed(1) + ' mean ' + mean(profit).toFixed(1)
		+ ' | ordinary profit cr p25 ' + percentile(commonProfit, 0.25).toFixed(1) + ' median ' + percentile(commonProfit, 0.5).toFixed(1) + ' p75 ' + percentile(commonProfit, 0.75).toFixed(1) + ' mean ' + mean(commonProfit).toFixed(1)
		+ ' | grains fired mean ' + mean(fired).toFixed(0) + ' lost mean ' + mean(lost).toFixed(1)
		+ ' | hits mean ' + mean(list.map(sample => sample.hits)).toFixed(0));
}

console.log('a held sandblaster on a fresh bed, platform parked under it, ' + settle + ' s to settle, '
	+ 'price ' + sandblaster.state.price + ' cr/charge, ' + sandblaster.state.shotEnergy + ' J/grain, import ' + ceiling.state.fuelPrice + ' cr/kJ');
for (const seed of seeds) row('seed ' + seed, samples.filter(sample => sample.blast && sample.seed === seed));
row('all', samples.filter(sample => sample.blast));
row('no blast', samples.filter(sample => !sample.blast));
