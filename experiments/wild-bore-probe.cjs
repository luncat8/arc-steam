'use strict';
// Measures Wild Mine hammer-buffer excavation on a 1.5x rig-height (1.125 m,
// 9-cell) passage across soft halite, host stone and hard corundum, compares
// reserve per cell and per 81-cell passage against driven piston bounces on
// the exact same strata, and profiles spawn-room breakouts across cave seeds.

const minerals = require('../js/minerals.js');
const materials = require('../js/rock-materials.js');
const ceiling = require('../js/ceiling.js');
const physics = require('../js/physics.js');
const equipment = require('../js/equipment.js');
const research = require('../js/research.js');
const players = require('../js/players.js');
require('../js/fuel.js');
const wildMine = require('../js/wild-mine.js');
const wildBall = require('../js/wild-ball.js');
const bore = require('../js/wild-bore.js');

const dt = physics.config.step;
const stoneId = minerals.mineralIds.indexOf('stone');
let maxDrift = 0;

function trackDrift(world) {
	const drift = Math.abs(physics.totalEnergy(world) - world.initialEnergy);
	if (drift > maxDrift) maxDrift = drift;
}

function makeWorld(seed) {
	wildMine.setMode('wild');
	const world = physics.createWorld();
	players.init(world, 0);
	const cave = wildMine.init(world, { seed });
	return { world, cave };
}

// Same three natural strata used by wild-piston-probe.cjs.
const strata = [
	{ seed: 20, label: 'Halite seam', col: 5, row: 271 },
	{ seed: 5, label: 'Host stone', col: 5, row: 271 },
	{ seed: 24, label: 'Corundum ridge', col: 5, row: 271 }
];

function study(world, id) {
	if (research.isResearched(id)) return;
	for (const req of research.find(id).requires) study(world, req);
	research.grant(id, world);
}

function measurePiston(seed, gear, head) {
	const { world, cave } = makeWorld(seed);
	world.wildWater.intakeOn = false;
	for (const id of gear) {
		study(world, equipment.find(id).requires);
		equipment.grant(id, world);
	}
	if (head !== 'standard') {
		study(world, 'impact');
		equipment.installBall(head, world, true);
	}
	const ball = world.balls[0];
	const startBattery = world.battery;
	physics.launch(world, ball);
	const col = cave.columnAt(ball.x);
	const x = cave.worldX(col);
	const row = cave.rowAt(cave.roofAbove(x, ball.y));
	const y = cave.worldY(row);
	const strength = cave.strengthAt(col, row);
	while (world.time < 10 && ball.state !== 'held' && cave.solidAt(x, y)) {
		physics.step(world, dt);
		trackDrift(world);
	}
	const freed = wildBall.state.extractedCells;
	const reserveSpent = startBattery - world.battery;
	return { col, row, strength, freed, elapsed: world.time, reserveSpent, perCell: reserveSpent / Math.max(1, freed) };
}

// Measure boring a uniform 9x9 (1.125 m x 1.125 m = 81-cell) passage composed
// of a single stratum's natural strength.
function measureBorePassage(seed, sampleCol, sampleRow, engineId) {
	const { world, cave } = makeWorld(seed);
	equipment.grant('bore', world);
	if (engineId !== 'electric') {
		world.platform.vx = 0;
		physics.selectEngine(engineId, world, 'rig');
	}
	const unitStrength = cave.strengthAt(sampleCol, sampleRow);
	const shelf = cave.state.shelfRow;
	const wallCol = 32; // x = 4.0 m
	// Clear collar behind wheel and stamp a clean 9-col uniform face at x = 4.0 m.
	for (let c = 18; c < wallCol; c++) {
		for (let r = shelf; r < shelf + 12; r++) cave.dig(c, r);
	}
	for (let c = wallCol; c < wallCol + 12; c++) {
		const chunk = cave.chunkFor(c);
		for (let r = shelf; r < shelf + 12; r++) {
			const idx = r * cave.state.stride + c - chunk.column0 + cave.state.pad;
			chunk.solid[idx] = 1;
			chunk.dug[idx] = 0;
			chunk.sampled[idx] = 1;
			chunk.strength[idx] = unitStrength;
			chunk.damage[idx] = 0;
		}
	}
	// Park with the right nose flush against x = 4.0 m (wheel at 3.8 m).
	world.platform.x = 4 - physics.config.platformWidth * 0.5;
	world.platform.y = shelf * cave.state.cell;
	world.platform.previousX = world.platform.x;
	world.platform.previousY = world.platform.y;
	world.wildWater.intakeOn = false;
	const fullCap = physics.reserveNow('rig');
	const eff = physics.engineNow('rig').efficiency;
	world.battery = Math.max(fullCap, unitStrength * 81 * bore.workPerStrength / eff + 500);
	const startBattery = world.battery;
	world.initialEnergy = physics.totalEnergy(world);
	bore.setSide(1);
	bore.setGradeDegrees(0);
	bore.setHeld(true);
	let elapsed = 0;
	let peakTemp = physics.temperature(world);
	for (let i = 0; i < 240 * 20; i++) {
		physics.step(world, dt);
		trackDrift(world);
		const temp = physics.temperature(world);
		if (temp > peakTemp) peakTemp = temp;
		if (bore.readout(world, cave).status === 'clear') { elapsed = (i + 1) * dt; break; }
	}
	bore.setHeld(false);
	const spent = startBattery - world.battery;
	return {
		unitStrength,
		cells: bore.cellsCut,
		elapsed,
		reserveSpent: spent,
		perCell: spent / Math.max(1, bore.cellsCut),
		batteryShare: (spent / fullCap) * 100,
		peakTemp
	};
}

function measureBreakout(seed, gradeDeg, direction) {
	const { world } = makeWorld(seed);
	equipment.grant('bore', world);
	if (Math.abs(gradeDeg) >= 20) equipment.grant('motor', world);
	equipment.installRadiator('radiator', world);
	const mass = 30 * ceiling.state.cellMass;
	ceiling.loadCargo(stoneId, mass, mass * ceiling.state.mineralPrices[stoneId]);
	world.initialEnergy = physics.totalEnergy(world);
	const startX = world.platform.x;
	const startY = world.platform.y;
	bore.setAuto(true);
	bore.setGradeDegrees(gradeDeg);
	world.direction = direction;
	for (let i = 0; i < 240 * 14; i++) {
		physics.step(world, dt);
		trackDrift(world);
	}
	bore.setAuto(false);
	return {
		seed,
		heading: (direction > 0 ? 'right ' : 'left ') + (gradeDeg > 0 ? '+' + gradeDeg : gradeDeg) + '°',
		dxM: (world.platform.x - startX).toFixed(2),
		dyM: (world.platform.y - startY).toFixed(2),
		cellsCut: bore.cellsCut,
		reserveKJ: (bore.reserveSpent / 1000).toFixed(2),
		stoneLeft: (ceiling.state.cargoMinerals[stoneId] / ceiling.state.cellMass).toFixed(1),
		liquidKg: world.wildWater.collectedWater > 0 ? (world.wildWater.collectedWater + world.wildWater.collectedCondensate).toFixed(2) : '0.00',
		endTempC: physics.temperature(world).toFixed(0)
	};
}

function startRoomEconomy(seed) {
	const { cave } = makeWorld(seed);
	const mix = new Float32Array(minerals.mineralCount);
	const prices = ceiling.state.mineralPrices;
	let cells = 0, value = 0;
	for (let col = -28; col <= 28; col++) {
		const x = cave.worldX(col);
		const roof = cave.roofAbove(x, cave.worldY(cave.state.shelfRow + 2));
		if (!Number.isFinite(roof)) continue;
		const r0 = cave.rowAt(roof);
		for (let r = r0; r < r0 + 8 && r < cave.state.rows - 2; r++) {
			if (!cave.solidCell(col, r)) continue;
			cells++;
			cave.mixAt(col, r, mix);
			value += materials.valueInto(mix, 0, prices);
		}
	}
	return { cells, value, load100: (value / Math.max(1, cells)) * 100 };
}

const boreItem = equipment.find('bore');
const unlockCost = research.find('materials').cost + research.find('impact').cost;
console.log(`WILD BORE · tunnel ${bore.tunnelHeight.toFixed(3)} m (${Math.round(bore.tunnelHeight / 0.125)} cells, ${bore.heightRatio}x rig clearance) · reach ${bore.reach.toFixed(3)} m · ${bore.borePower} W useful · ${bore.workPerStrength} J/J strength`);
console.log(`PRICE · ${boreItem.cost} cr (+${boreItem.mass} kg) behind Impact forging (${unlockCost} cr research · ${unlockCost + boreItem.cost} cr total from start)\n`);

console.log('1) 81-CELL (1.125 m x 1.125 m, 1.5x RIG HEIGHT) PASSAGE — BORE VS PISTON ON STOCK ELECTRIC');
const comparison = [];
for (const s of strata) {
	const stockP = measurePiston(s.seed, [], 'standard');
	const spikeP = measurePiston(s.seed, ['coil', 'ram'], 'spike');
	const cut = measureBorePassage(s.seed, stockP.col, stockP.row, 'electric');
	comparison.push({
		stratum: s.label,
		'strength J': cut.unitStrength.toFixed(2),
		'bore cells': cut.cells,
		'bore time s': cut.elapsed.toFixed(2),
		'bore J/cell': cut.perCell.toFixed(1),
		'bore 81c kJ': (cut.reserveSpent / 1000).toFixed(2),
		'stock bat %': cut.batteryShare.toFixed(1) + '%',
		'peak °C': cut.peakTemp.toFixed(0),
		'piston stock J/c': stockP.perCell.toFixed(1),
		'piston 81c eq kJ': (stockP.perCell * 81 / 1000).toFixed(2),
		'piston spike J/c': spikeP.perCell.toFixed(1),
		'bore/stock ratio': (cut.perCell / stockP.perCell).toFixed(2) + 'x'
	});
}
console.table(comparison);

console.log('2) ENGINE COMPARISON — 81-CELL HOST STONE PASSAGE (SEED 5)');
const engineRows = [];
for (const id of ['electric', 'oil', 'nuclear', 'coal', 'hand']) {
	const cut = measureBorePassage(5, 5, 271, id);
	const eng = physics.engines.find(e => e.id === id);
	engineRows.push({
		engine: eng.name,
		eff: Math.round(eng.efficiency * 100) + '%',
		'time s': cut.elapsed.toFixed(2),
		'reserve kJ': (cut.reserveSpent / 1000).toFixed(2),
		'J/cell': cut.perCell.toFixed(1),
		'tank share': cut.batteryShare.toFixed(1) + '%',
		'peak °C': cut.peakTemp.toFixed(0)
	});
}
console.table(engineRows);

console.log('3) 14 s AUTO-BORE BREAKOUTS (ELECTRIC + RADIATOR ARRAY + 30 STONE FUEL CELLS)');
const breakouts = [
	measureBreakout(1, 0, 1),
	measureBreakout(1, 20, 1),
	measureBreakout(1, -20, 1),
	measureBreakout(1, -20, -1),
	measureBreakout(2, 0, 1),
	measureBreakout(5, 0, 1),
	measureBreakout(20, 0, 1),
	measureBreakout(20, 25, -1),
	measureBreakout(20, -15, 1)
];
console.table(breakouts);

console.log('4) OPENING-ROOM ROOF VALUE VS BORE UNLOCK + PURCHASE (' + (unlockCost + boreItem.cost) + ' cr)');
const econRows = [1, 2, 3, 5, 10, 20, 24].map(seed => {
	const e = startRoomEconomy(seed);
	return {
		seed,
		'roof 1m cells': e.cells,
		'roof total cr': e.value.toFixed(0),
		'100-cell cart cr': e.load100.toFixed(0),
		'cart loads to bore': ((unlockCost + boreItem.cost) / e.load100).toFixed(2)
	};
});
console.table(econRows);

wildMine.setMode('classic');
console.log(`Maximum absolute ledger drift: ${maxDrift.toExponential(2)} J`);
