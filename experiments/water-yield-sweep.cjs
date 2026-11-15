// What one water gun brings down per shift under different solver constants,
// so a yield change is measured against the bed instead of guessed.
// Run: node experiments/water-yield-sweep.cjs <name> jetWashSeconds=0.12 [k=v ...]
//
// The constants live inside js/water.js's closure, so a variant is the solver
// file with its `const` lines rewritten, loaded from a temp copy: the chamber,
// the physics and the players all resolve `SteamWater` at call time, so the
// copy under test is the one the whole run plays. Nothing in js/ is touched.
//
// The sampling is the yield probe's: the rig parks under a face, holds the jet
// for a settle window with the pump running, and the wet ledger is read rather
// than reconstructed. The control row is dropped - it is zero for every variant
// - and the seeds are cut to keep a sweep inside a shift. Read the `cells`
// median: the mean is dominated by the columns that happen to land on a seam.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const jsDir = path.join(__dirname, '..', 'js');
const source = path.join(jsDir, 'water.js');

const name = process.argv[2] || 'base';
const overrides = new Map();
for (const arg of process.argv.slice(3)) {
	const at = arg.indexOf('=');
	if (at < 0) throw new Error('expected name=value, got ' + arg);
	overrides.set(arg.slice(0, at).trim(), arg.slice(at + 1).trim());
}

// Rewrite one `const k = value;` line per override, and point the copy's own
// relative requires back at js/. An override that matches nothing is a typo,
// and a silent no-op would read as a measurement.
function variantSource() {
	let text = fs.readFileSync(source, 'utf8');
	for (const [key, value] of overrides) {
		const pattern = new RegExp('(\\bconst ' + key + '\\s*=\\s*)[-\\d.]+;');
		if (!pattern.test(text)) throw new Error('no constant ' + key + ' in ' + source);
		text = text.replace(pattern, '$1' + value + ';');
	}
	return text.replace(/require\('\.\//g, "require('" + jsDir + '/');
}

const variantPath = path.join(os.tmpdir(), 'water-yield-' + name.replace(/[^\w.-]/g, '_') + '.js');
fs.writeFileSync(variantPath, variantSource());

const ceiling = require(path.join(jsDir, 'ceiling.js'));
const equipment = require(path.join(jsDir, 'equipment.js'));
require(path.join(jsDir, 'research.js'));
const physics = require(path.join(jsDir, 'physics.js'));
const players = require(path.join(jsDir, 'players.js'));
require(path.join(jsDir, 'water-chemistry.js'));
// Loaded last on purpose: this is the solver the chamber steps.
const water = require(variantPath);
fs.unlinkSync(variantPath);

const step = physics.config.step;
const seeds = (process.env.SWEEP_SEEDS || '1,7,21').split(',').map(Number);
const positions = (process.env.SWEEP_POSITIONS || '2,5,8,12,15,18,21').split(',').map(Number);
const settle = Number(process.env.SWEEP_SECONDS || 30);
const samples = [];

function percentile(sorted, share) {
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
}

function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }

function countCells() {
	const rock = ceiling.state;
	let cells = 0;
	for (let i = 0; i < rock.rows * rock.columns; i++) if (rock.strength[i] > 0) cells++;
	return cells;
}

function sample(seed, p) {
	const world = physics.createWorld();
	players.init(world, 0);
	ceiling.reset(seed);
	water.reset(seed * 100 + p);
	water.setAutoFire(false, 'rig');
	world.drive = false;
	world.platform.x = p;
	world.platform.previousX = p;
	world.platform.vx = 0;
	if (!equipment.grant('watergun', world, 'rig')) throw new Error('the water yield sweep could not fit the cannon');
	const rock = ceiling.state;
	const startCargoValue = rock.cargoValue;
	const startCells = countCells();
	water.setPump(true);
	water.setAim(p, 14.5);
	water.setAutoFire(true, 'rig');
	for (let i = 0; i < Math.round(settle / step); i++) physics.step(world, step);
	water.setAutoFire(false, 'rig');
	const metrics = water.measureMetrics();
	const energyJ = metrics.shotJoules + metrics.pumpJoules;
	const caughtValue = rock.cargoValue - startCargoValue;
	return {
		seed, position: p,
		cells: startCells - countCells(),
		dissolvedCells: metrics.dissolvedCells,
		dissolvedMass: metrics.dissolvedMass,
		lostGasMass: metrics.lostGasMass,
		caughtValue,
		residue: metrics.settledMass,
		droplets: metrics.droplets,
		energyJ,
		energy: energyJ / 1000 * rock.fuelPrice,
		profit: caughtValue - metrics.lostGasValue - energyJ / 1000 * rock.fuelPrice
	};
}

for (const seed of seeds) for (const p of positions) samples.push(sample(seed, p));

function row(label) {
	const cells = samples.map(s => s.cells).sort((a, b) => a - b);
	const caught = samples.map(s => s.caughtValue).sort((a, b) => a - b);
	const profit = samples.map(s => s.profit).sort((a, b) => a - b);
	const worked = samples.filter(s => s.cells > 0).length / samples.length;
	console.log(label.padEnd(14)
		+ ' n ' + String(samples.length).padStart(3)
		+ ' | cells p25 ' + percentile(cells, 0.25) + ' med ' + percentile(cells, 0.5)
		+ ' p75 ' + percentile(cells, 0.75) + ' mean ' + mean(cells).toFixed(1)
		+ ' | worked ' + (worked * 100).toFixed(0) + '%'
		+ ' | caught med ' + percentile(caught, 0.5).toFixed(1) + ' cr'
		+ ' | profit med ' + percentile(profit, 0.5).toFixed(1) + ' cr'
		+ ' | dissolved ' + mean(samples.map(s => s.dissolvedMass)).toFixed(2) + ' g'
		+ ' vented ' + mean(samples.map(s => s.lostGasMass)).toFixed(2) + ' g'
		+ ' | cells/droplet ' + (mean(samples.map(s => s.cells)) / mean(samples.map(s => s.droplets)) * 1000).toFixed(2) + ' /k'
		+ ' | droplets ' + mean(samples.map(s => s.droplets)).toFixed(0)
		+ ' | energy ' + mean(samples.map(s => s.energy)).toFixed(0) + ' cr');
}

// Per position, because the charge pad at x = 12 is the only berth that
// replenishes the reserve: everywhere else the jet is reserve-starved.
function byPosition() {
	let line = '  by position ';
	for (const p of positions) {
		const list = samples.filter(s => s.position === p);
		line += p + ':' + mean(list.map(s => s.cells)).toFixed(1) + '/' + mean(list.map(s => s.droplets)).toFixed(0) + '  ';
	}
	console.log(line);
}

console.log('water yield sweep "' + name + '" ' + (overrides.size ? [...overrides].map(([k, v]) => k + '=' + v).join(' ') : 'no overrides')
	+ ' - ' + settle + ' s, ' + water.state.shotEnergy + ' J/droplet, import ' + ceiling.state.fuelPrice + ' cr/kJ');
row(name);
byPosition();
console.log('  (by position: mean cells / mean droplets)');
