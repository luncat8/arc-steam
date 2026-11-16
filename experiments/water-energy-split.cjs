'use strict';
// Separate the water gun's two reserve draws - jet droplets and under-hull
// suction pump - across off-pad berths, the centre charge pad, dry/flooded
// floors, and upgraded cooling/drive tiers, checking exact energy closure.
const ceiling = require('../js/ceiling.js');
const equipment = require('../js/equipment.js');
const research = require('../js/research.js');
const physics = require('../js/physics.js');
const players = require('../js/players.js');
require('../js/water-chemistry.js');
const water = require('../js/water.js');

const c = physics.config;
const dt = c.step;
const seeds = [1, 7, 10, 21, 31, 47];
const positions = [2, 5, 8, 12, 15, 18, 21];
const settleSeconds = 30;
const steps = Math.round(settleSeconds / dt);

function percentile(list, q) {
	const sorted = list.slice().sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

function mean(list) {
	return list.reduce((sum, value) => sum + value, 0) / list.length;
}

function upgradeRig(world, tier) {
	if (tier !== 't3') return;
	for (const node of research.nodes) research.grant(node.id, world, 'rig');
	for (const id of ['pad', 'coil', 'ram', 'motor', 'overdrive', 'chassis', 'flywheel']) {
		equipment.grant(id, world, 'rig');
	}
	equipment.installRadiator('bank', world, true, 'rig');
}

function sample(seed, x, mode, engineId, tier) {
	const world = physics.createWorld();
	players.init(world, 0);
	ceiling.reset(seed);
	water.reset(seed * 100 + x);
	water.setAutoFire(false, 'rig');
	world.drive = false;
	world.platform.x = world.platform.previousX = physics.platformMin();
	world.platform.vx = 0;
	physics.selectEngine(engineId || 'electric', world, 'rig');
	upgradeRig(world, tier);
	if (mode !== 'pump-no-tool') equipment.grant('watergun', world, 'rig');
	world.platform.x = world.platform.previousX = x;
	world.platform.vx = 0;
	world.battery = c.battery;
	if (mode === 'pump-flood' || mode === 'pump-no-tool') water.fill(0.5, 0.02, 23.5, 0.8);
	world.initialEnergy = physics.totalEnergy(world);
	const startImported = world.importedEnergy;
	const pumpOn = mode === 'both' || mode === 'pump-dry' || mode === 'pump-flood' || mode === 'pump-no-tool';
	const sprayOn = mode === 'both' || mode === 'jet-only';
	water.setPump(pumpOn);
	water.setAim(x, 14.5);
	water.setAutoFire(sprayOn, 'rig');
	let maxTemp = c.ambientTemperature;
	let cutoffSteps = 0;
	for (let i = 0; i < steps; i++) {
		physics.step(world, dt);
		const temp = physics.temperature(world);
		if (temp > maxTemp) maxTemp = temp;
		if (physics.thermalFactor(world) <= 0) cutoffSteps++;
	}
	water.setAutoFire(false, 'rig');
	const metrics = water.measureMetrics();
	const rock = ceiling.state;
	const cargoImported = (metrics.pumpedSolute + metrics.caughtMass) * c.gravity * rock.cargoHeight;
	const unbackedJ = Math.max(0, (world.importedEnergy - startImported) - world.chargedEnergy - cargoImported);
	const totalJ = metrics.shotJoules + metrics.pumpJoules;
	const fuelCr = totalJ / 1000 * rock.fuelPrice;
	return {
		onPad: physics.onChargePad(world),
		droplets: metrics.droplets,
		pumped: metrics.pumped,
		shotJ: metrics.shotJoules,
		pumpJ: metrics.pumpJoules,
		unbackedJ,
		cells: metrics.dissolvedCells,
		cargoCr: rock.cargoValue,
		brineCr: metrics.brineValue,
		fuelCr,
		netCr: rock.cargoValue - metrics.lostGasValue - fuelCr,
		maxTemp,
		cutoffShare: cutoffSteps / steps,
		driftJ: Math.abs(physics.totalEnergy(world) - world.initialEnergy)
	};
}

function report(label, rows) {
	const shot = mean(rows.map(r => r.shotJ));
	const pump = mean(rows.map(r => r.pumpJ));
	const total = shot + pump;
	const split = total > 0 ? (shot / total * 100).toFixed(1) + '/' + (pump / total * 100).toFixed(1) : '0.0/0.0';
	const maxDrift = Math.max(...rows.map(r => r.driftJ));
	console.log([
		label.padEnd(24),
		'n ' + String(rows.length).padStart(2),
		'drops ' + mean(rows.map(r => r.droplets)).toFixed(0).padStart(4),
		'shot ' + (shot / 1000).toFixed(2).padStart(5) + ' kJ',
		'pump ' + (pump / 1000).toFixed(2).padStart(5) + ' kJ (' + mean(rows.map(r => r.pumped)).toFixed(1).padStart(4) + ' u)',
		'split ' + split.padStart(9),
		'free ' + (mean(rows.map(r => r.unbackedJ)) / 1000).toFixed(2) + ' kJ',
		'cells ' + String(percentile(rows.map(r => r.cells), 0.5)).padStart(2) + '/' + mean(rows.map(r => r.cells)).toFixed(1).padStart(4),
		'cargo ' + percentile(rows.map(r => r.cargoCr), 0.5).toFixed(1).padStart(4) + '/' + mean(rows.map(r => r.cargoCr)).toFixed(1).padStart(4) + ' cr',
		'brine ' + mean(rows.map(r => r.brineCr)).toFixed(1).padStart(4) + ' cr',
		'fuel ' + mean(rows.map(r => r.fuelCr)).toFixed(0).padStart(4) + ' cr',
		'Tmax ' + mean(rows.map(r => r.maxTemp)).toFixed(0).padStart(3) + ' C',
		'cut ' + (mean(rows.map(r => r.cutoffShare)) * 100).toFixed(0).padStart(2) + '%',
		'err ' + maxDrift.toExponential(1)
	].join(' | '));
}

const s = water.state;
console.log(
	'water energy split, ' + settleSeconds + ' s parked, useful ' + s.shotEnergy + ' J/drop @ ' + s.dropletsPerSecond
	+ '/s (' + (s.shotEnergy * s.dropletsPerSecond / 1000).toFixed(2) + ' kW) + pump ' + s.pumpJoulesPerUnit
	+ ' J/u @ ' + s.pumpUnitsPerSecond + ' u/s (' + (s.pumpJoulesPerUnit * s.pumpUnitsPerSecond / 1000).toFixed(2)
	+ ' kW); stock electric draw ' + physics.reserveCost(s.shotEnergy, 'rig').toFixed(1) + ' J/drop + '
	+ physics.reserveCost(s.pumpJoulesPerUnit, 'rig').toFixed(1) + ' J/u (' + (water.streamPower('rig') / 1000).toFixed(2) + ' kW)'
);

for (const mode of ['both', 'jet-only']) {
	const rows = [];
	for (const seed of seeds) for (const x of positions) rows.push(sample(seed, x, mode, 'electric', 't1'));
	report('T1 ' + mode + ' all', rows);
	report('T1 ' + mode + ' off-pad', rows.filter(r => !r.onPad));
	report('T1 ' + mode + ' on-pad', rows.filter(r => r.onPad));
}

for (const mode of ['pump-dry', 'pump-flood', 'pump-no-tool']) {
	const rows = positions.map(x => sample(1, x, mode, 'electric', 't1'));
	report('T1 ' + mode + ' off-pad', rows.filter(r => !r.onPad));
	report('T1 ' + mode + ' on-pad', rows.filter(r => r.onPad));
}

const t3Rows = [];
for (const seed of [1, 10]) for (const x of positions) t3Rows.push(sample(seed, x, 'both', 'electric', 't3'));
report('T3+bank both off-pad', t3Rows.filter(r => !r.onPad));
report('T3+bank both on-pad', t3Rows.filter(r => r.onPad));
