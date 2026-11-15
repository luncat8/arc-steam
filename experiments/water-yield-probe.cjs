// What one water gun brings down from a fresh bed, and what the jet and the
// pump cost to run. Run: node experiments/water-yield-probe.cjs
//
// The rig parks under a face and holds the jet for a settle window, with the
// pump running. The probe reads the wet ledger rather than guessing: dissolved
// cells, brine and gas split, the solute the pump lifted, the residue that fell
// as loose grains, and the reserve drawn. Value is priced both at what the
// caught material is really worth and at ordinary-rock prices, and the energy
// is priced at the paid emergency import rate, so the answer is "does wet
// mining pay on this bed" and not just "does it move rock".
const ceiling = require('../js/ceiling.js');
const equipment = require('../js/equipment.js');
require('../js/research.js');
const physics = require('../js/physics.js');
const players = require('../js/players.js');
require('../js/water-chemistry.js');
const water = require('../js/water.js');

const step = physics.config.step;
const seeds = [1, 7, 10, 21, 31, 47];
// Rig positions in metres, clear of wall pockets; 12 is on the charge pad.
const positions = [2, 5, 8, 12, 15, 18, 21];
const settle = 30;
const samples = [];

function percentile(sorted, share) {
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
}

function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }

// What a cell of ordinary rock sells for on this bed: the host, the common ores
// and the filler at their opening quotes, weighted by abundance.
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

// The seam the jet is aimed at: straight up from the nozzle, whatever the bed
// grew there. The gun is aimed high, so the stream always finds the face.
function sample(seed, p, spray) {
	const world = physics.createWorld();
	players.init(world, 0);
	ceiling.reset(seed);
	water.reset(seed * 100 + p);
	water.setAutoFire(false, 'rig');
	world.drive = false;
	world.platform.x = p;
	world.platform.previousX = p;
	world.platform.vx = 0;
	const rock = ceiling.state;
	if (spray && !equipment.grant('watergun', world, 'rig')) throw new Error('the water yield probe could not fit the cannon');
	const startBattery = world.battery;
	const startCargoValue = rock.cargoValue;
	const startCells = countCells();
	water.setPump(true);
	water.setAim(p, 14.5);
	water.setAutoFire(spray, 'rig');
	for (let i = 0; i < Math.round(settle / step); i++) physics.step(world, step);
	water.setAutoFire(false, 'rig');
	const metrics = water.measureMetrics();
	// Only the rig's own draws are in its ledger; a rival's throw is imported work.
	const energyJ = metrics.shotJoules + metrics.pumpJoules;
	// Cargo sold at a wall is the pump's own yield; a parked rig never sells, so
	// the hopper still holds it.
	const caughtCells = rock.cargoCells;
	const caughtValue = rock.cargoValue - startCargoValue;
	const spentValue = metrics.lostGasValue;
	return {
		seed,
		spray,
		cells: startCells - countCells(),
		dissolvedCells: metrics.dissolvedCells,
		dissolvedMass: metrics.dissolvedMass,
		lostGasMass: metrics.lostGasMass,
		caughtCells,
		caughtValue,
		residue: metrics.settledMass,
		energyJ,
		energy: energyJ / 1000 * rock.fuelPrice,
		profit: caughtValue - spentValue - energyJ / 1000 * rock.fuelPrice,
		saturated: metrics.maxSaturation
	};
}

function countCells() {
	const rock = ceiling.state;
	let cells = 0;
	for (let i = 0; i < rock.rows * rock.columns; i++) if (rock.strength[i] > 0) cells++;
	return cells;
}

for (const seed of seeds) {
	for (const p of positions) {
		samples.push(sample(seed, p, true));
		samples.push(sample(seed, p, false));
	}
}

function row(label, list) {
	const cells = list.map(s => s.cells).sort((a, b) => a - b);
	const caught = list.map(s => s.caughtValue).sort((a, b) => a - b);
	const profit = list.map(s => s.profit).sort((a, b) => a - b);
	console.log(label.padEnd(10)
		+ ' n ' + String(list.length).padStart(3)
		+ ' | cells p25 ' + percentile(cells, 0.25) + ' median ' + percentile(cells, 0.5) + ' p75 ' + percentile(cells, 0.75) + ' mean ' + mean(cells).toFixed(1)
		+ ' | caught cr p25 ' + percentile(caught, 0.25).toFixed(1) + ' median ' + percentile(caught, 0.5).toFixed(1) + ' p75 ' + percentile(caught, 0.75).toFixed(1)
		+ ' | profit cr p25 ' + percentile(profit, 0.25).toFixed(1) + ' median ' + percentile(profit, 0.5).toFixed(1) + ' p75 ' + percentile(profit, 0.75).toFixed(1) + ' mean ' + mean(profit).toFixed(1)
		+ ' | dissolved mean ' + mean(list.map(s => s.dissolvedMass)).toFixed(2) + ' g'
		+ ' vented mean ' + mean(list.map(s => s.lostGasMass)).toFixed(2) + ' g'
		+ ' | residue mean ' + mean(list.map(s => s.residue)).toFixed(2) + ' g'
		+ ' | energy mean ' + mean(list.map(s => s.energy)).toFixed(1) + ' cr'
		+ ' | saturation max ' + mean(list.map(s => s.saturated)).toFixed(3));
}

console.log('a held water jet on a fresh bed, pump running, platform parked, ' + settle + ' s, '
	+ water.state.shotEnergy + ' J/droplet at ' + water.state.dropletsPerSecond + '/s, pump '
	+ water.state.pumpJoulesPerUnit + ' J/unit, satCap ' + water.state.satCapDefault + ' g/unit, import '
	+ ceiling.state.fuelPrice + ' cr/kJ');
for (const seed of seeds) row('seed ' + seed, samples.filter(s => s.spray && s.seed === seed));
row('all', samples.filter(s => s.spray));
row('no spray', samples.filter(s => !s.spray));
console.log('cells are whole cells that left the rock; caughtValue is hopper value the pump lifted.');
console.log('profit = caught value - gas lost - energy at the paid import rate (free pad energy is the cheap case).');
