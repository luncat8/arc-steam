'use strict';
// The rocket fabricator: cargo minerals plus reserve energy into rack stock,
// at five times base-game damage in Wild Mine.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const players = require('../js/players.js');
const harness = require('./harness.cjs');
const {
	ceiling, equipment, research, physics, run, earnFunds,
	unlockResearch, buy
} = harness;
const minerals = require('../js/minerals.js');
const wildMine = require('../js/wild-mine.js');
const rocketFab = require('../js/rocket-fab.js');
const rockets = require('../js/rockets.js');

const iron = minerals.mineralIds.indexOf('iron');
const cellMass = ceiling.state.cellMass;
const ironPrice = ceiling.state.mineralPrices[iron];
const costPerRocket = rocketFab.energyPerRocket / physics.engineNow('rig').efficiency;

function freshWorld(wild) {
	// Profiles live on the owner, not on the world: reset them so each
	// iteration researches and installs from a clean slate.
	equipment.reset();
	research.reset();
	wildMine.setMode(wild ? 'wild' : 'classic');
	const world = physics.createWorld();
	players.init(world, wild ? 0 : undefined);
	if (wild) wildMine.init(world, { seed: 1 });
	return world;
}

// Mine and sell enough cells to pay for the rack and the fab. In Classic
// mode the harness loop settles debris through ceiling.step, which physics
// only runs there; in Wild Mine the same settle is driven by hand. Both
// modes leave at least `minFunds` in the till.
function earnFundsAny(world, cells, minFunds) {
	if (!wildMine.isWild()) {
		earnFunds(world, cells);
		while (ceiling.state.funds < minFunds) earnFunds(world, 20);
		return;
	}
	const batch = function (n) {
		const target = ceiling.state.extractedCells + n;
		for (let x = 1; x < 24 && ceiling.state.extractedCells < target; x += 2) {
			if (Math.abs(x - world.platform.x) < 3.5) continue;
			for (let h = 0; h < 2; h++) ceiling.damage(x, ceiling.state.bottom + 0.2, 20);
			ceiling.collapse(4);
		}
		ceiling.collapse(30);
		const state = ceiling.state;
		let prepared = 0;
		for (let i = 0; i < state.active.length && prepared < n; i++) {
			if (!state.active[i]) continue;
			state.debrisX[i] = world.platform.x - 1;
			state.debrisY[i] = 0.701;
			state.debrisVx[i] = 0;
			state.debrisVy[i] = -1;
			prepared += state.debrisCells[i] || 1;
		}
		world.initialEnergy = physics.totalEnergy(world);
		physics.step(world, physics.config.step);
		const dt = physics.config.step;
		for (let i = 0; i < 240 * 60 && ceiling.state.airborneCells > 0; i++) ceiling.step(world, dt, 0);
		ceiling.sellCargo(0, world.time);
		assert.equal(ceiling.state.airborneCells, 0, 'debris settled');
		assert.equal(ceiling.state.cargoCells, 0, 'storage empty');
	};
	batch(cells);
	while (ceiling.state.funds < minFunds) batch(20);
}

function installFabAndRack(world) {
	const needed = equipment.find('rocket-rack').cost + equipment.find('rocket-fab').cost;
	earnFundsAny(world, 100, needed);
	if (!research.isResearched('impact', 'rig')) unlockResearch(world, 'impact');
	earnFundsAny(world, 20, needed - ceiling.state.funds);
	buy(world, 'rocket-rack');
	buy(world, 'rocket-fab');
	assert.equal(equipment.isInstalled('rocket-rack', 'rig'), true);
	assert.equal(equipment.isInstalled('rocket-fab', 'rig'), true);
}

function feedCells(world, count) {
	for (let i = 0; i < count; i++) {
		assert.equal(
			ceiling.loadCargo(iron, cellMass, cellMass * ironPrice), true,
			'load cell ' + i);
	}
}

test('rocket fab reason lines: nothing installed, only the fab, only the rack', () => {
	try {
		const world = freshWorld(false);
		assert.equal(rocketFab.reason(world, 'rig'), 'No rocket fab installed · fit one in Science + Shop');
		assert.equal(rocketFab.fab(world, 'rig'), 0);
		assert.equal(rockets.stateFor('rig').stock, 0);

		earnFundsAny(world, 100);
		unlockResearch(world, 'impact');
		earnFundsAny(world, 100);
		buy(world, 'rocket-fab');
		assert.equal(rocketFab.reason(world, 'rig'), 'No rocket rack · the fab loads the rack');
		assert.equal(rocketFab.fab(world, 'rig'), 0);

		earnFundsAny(world, 100);
		buy(world, 'rocket-rack');
		feedCells(world, 1);
		assert.equal(rocketFab.reason(world, 'rig'), '');
	} finally {
		wildMine.setMode('classic');
	}
});

test('one cycle turns one cargo cell and 2 kJ into one rack rocket, classic and wild', () => {
	for (const wild of [false, true]) {
		try {
			const world = freshWorld(wild);
			installFabAndRack(world);
			feedCells(world, 1);
			const initialBattery = world.battery;
			const initialHeat = world.heat;
			assert.equal(rocketFab.reason(world, 'rig'), '');

			// The manual press fires one cycle right away.
			assert.equal(rocketFab.fab(world, 'rig'), 1);
			assert.equal(rockets.stateFor('rig').stock, 1);
			assert.ok(Math.abs(ceiling.state.cargoCells) < 1e-9, 'cargo cells ' + ceiling.state.cargoCells);
			assert.ok(Math.abs(world.battery - (initialBattery - costPerRocket)) < 1e-6,
				'battery spent ' + costPerRocket + ' J, got ' + world.battery);
			assert.ok(Math.abs(world.heat - (initialHeat + costPerRocket - rocketFab.energyPerRocket)) < 1e-6,
				'waste heat booked');

			// Auto-fab repeats the cycle every cycleTime.
			rocketFab.setAuto(true, 'rig');
			feedCells(world, 1);
			run(world, 3);
			assert.equal(rockets.stateFor('rig').stock, 2);
			assert.ok(Math.abs(ceiling.state.cargoCells) < 1e-9, 'cargo cells ' + ceiling.state.cargoCells);

			// No more cargo: idle with the matching reason, nothing else spent.
			assert.equal(rocketFab.reason(world, 'rig'), 'Cargo empty · mine minerals to feed the fab');
			const stockBefore = rockets.stateFor('rig').stock;
			run(world, 3);
			assert.equal(rockets.stateFor('rig').stock, stockBefore);
		} finally {
			wildMine.setMode('classic');
		}
	}
});

test('auto-fab keeps its order across reset and stops on a full rack', () => {
	try {
		const world = freshWorld(false);
		installFabAndRack(world);
		rocketFab.setAuto(true, 'rig');
		assert.equal(rocketFab.isAuto('rig'), true);
		rocketFab.reset(1);
		assert.equal(rocketFab.isAuto('rig'), true);

		feedCells(world, 6);
		run(world, 18);
		assert.equal(rockets.stateFor('rig').stock, rockets.stateFor('rig').rackSize);
		assert.ok(Math.abs(ceiling.state.cargoCells) < 1e-9, 'cargo cells ' + ceiling.state.cargoCells);
		assert.equal(rocketFab.reason(world, 'rig'), 'Rack full');
		run(world, 6);
		assert.equal(rockets.stateFor('rig').stock, rockets.stateFor('rig').rackSize);
	} finally {
		wildMine.setMode('classic');
	}
});

test('flat reserve stops the line with the reserve reason', () => {
	try {
		const world = freshWorld(false);
		installFabAndRack(world);
		feedCells(world, 1);
		world.battery = 0;
		assert.equal(rocketFab.reason(world, 'rig'),
			'Reserve too low · the engine burns ' + (rocketFab.energyPerRocket / 1000).toFixed(1) + ' kJ per rocket');
		assert.equal(rocketFab.fab(world, 'rig'), 0);
		assert.equal(rockets.stateFor('rig').stock, 0);
		assert.equal(ceiling.state.cargoCells, 1);
	} finally {
		wildMine.setMode('classic');
	}
});

test('wild mine rocket shards trace the active cave and spend five times base-game fracture energy', () => {
	try {
		const world = freshWorld(true);
		const cave = wildMine.cave;
		const gain = ceiling.damageMultiplierNow('rig');
		const radius = ceiling.damageRadiusNow('rig');
		const cells = [];
		scan: for (let c = 10; c < 300; c++) {
			for (let r = 60; r < 420; r++) {
				const x = cave.worldX(c), y = cave.worldY(r);
				if (!cave.solidAt(x, y)) continue;
				const before = cave.strengthAt(c, r);
				if (before <= 1) continue;
				cells.push({ x: x, y: y, before: before });
				if (cells.length === 3) break scan;
			}
		}
		assert.equal(cells.length, 3, 'three solid cave cells found');

		// The shard uses the active cave instance and its SDF contact.
		const rack = rockets.stateFor('rig');
		const target = cells[2];
		const normal = cave.normalAt(target.x, target.y);
		const slot = 0;
		rack.shardState[slot] = rack.LIVE;
		rack.shardOwner[slot] = 0;
		rack.shardX[slot] = target.x + normal.nx * 0.22;
		rack.shardY[slot] = target.y + normal.ny * 0.22;
		rack.shardVx[slot] = -normal.nx * 8;
		rack.shardVy[slot] = -normal.ny * 8;
		rack.shardAge[slot] = 0;
		rack.shardRadius[slot] = 2;
		const hitsBefore = rack.shardHits;
		const fractureBefore = rack.fracture;
		rockets.step(world, 0.05);
		assert.equal(rack.shardHits, hitsBefore + 1, 'the cave surface spends the shard');
		assert.ok(rack.fracture > fractureBefore, 'wild impact damages cave rock');

		// 5x energy at the same gain and radius removes 5x the strength.
		const energy = 0.03;
		const removed1 = cave.weaken(cells[0].x, cells[0].y, energy, gain, radius);
		const removed5 = cave.weaken(cells[1].x, cells[1].y, energy * 5, gain, radius);
		assert.ok(removed1 > 0 && removed5 > 0);
		assert.ok(Math.abs(removed5 / 5 - removed1) < 1e-9,
			'5x energy removes 5x strength: ' + removed1 + ' vs ' + removed5);
	} finally {
		wildMine.setMode('classic');
	}
});

test('a moving fab cycle leaves the energy ledger exact, including cargo potential and kinetic', () => {
	try {
		const world = freshWorld(false);
		assert.equal(equipment.grant('rocket-rack', world), true);
		assert.equal(equipment.grant('rocket-fab', world), true);
		feedCells(world, 1);
		world.platform.vx = 4.5;
		world.initialEnergy = physics.totalEnergy(world);
		assert.equal(rocketFab.fab(world, 'rig'), 1);
		assert.equal(rockets.stateFor('rig').stock, 1);
		assert.ok(world.exportedProduct > 0, 'the rocket carries its charge and mass out of the ledger');
		assert.ok(Math.abs(physics.totalEnergy(world) - world.initialEnergy) < 1e-9,
			'ledger drift ' + (physics.totalEnergy(world) - world.initialEnergy));
	} finally {
		wildMine.setMode('classic');
	}
});

test('a Classic rival fabricates from its own hopper without touching the rig reserve', () => {
	const world = freshWorld(false);
	const rival = players.machineOf(players.state.players[1]);
	const owner = rival.id;
	assert.equal(equipment.grant('rocket-rack', world, owner), true);
	assert.equal(equipment.grant('rocket-fab', world, owner), true);
	feedCells(world, 1);
	world.battery = 0;
	world.initialEnergy = physics.totalEnergy(world);
	assert.match(rocketFab.reason(world, owner), /Cargo empty/);
	assert.equal(rocketFab.fab(world, owner), 0);

	assert.equal(players.loadCargo(rival, iron, cellMass, ironPrice), true);
	assert.equal(rocketFab.reason(world, owner), '');
	assert.equal(rocketFab.fab(world, owner), 1);
	assert.equal(rockets.stateFor(owner).stock, 1);
	assert.equal(rockets.stateFor('rig').stock, 0);
	assert.equal(rival.cargoCells, 0);
	assert.equal(ceiling.state.cargoCells, 1);
	assert.equal(world.battery, 0);
	assert.equal(physics.totalEnergy(world), world.initialEnergy);
});

test('a launched Wild Mine round bursts in its own cave and every opened cell becomes cargo or soil', () => {
	try {
		const world = freshWorld(true);
		const cave = wildMine.cave;
		const rack = rockets.stateFor('rig');
		equipment.grant('rocket-rack', world);
		rockets.fill('rig');
		world.initialEnergy = physics.totalEnergy(world);
		assert.equal(rockets.fire(world, 'rig'), true);
		const launchY = rack.rocketY[0];
		const roof = cave.roofAbove(rack.rocketX[0], launchY);
		run(world, 3);
		assert.ok(rack.lastBurstY > launchY && rack.lastBurstY <= roof);
		assert.ok(rack.shardHits > 0 && rack.fracture > 0);
		let dug = 0;
		for (const chunk of cave.eachChunk()) {
			for (let r = 0; r < cave.state.rows; r++) {
				const start = r * cave.state.stride + cave.state.pad;
				for (let c = 0; c < cave.state.chunkColumns; c++) dug += chunk.dug[start + c];
			}
		}
		const soil = require('../js/wild-rubble.js').state();
		assert.ok(dug > 0 && soil.cells > 0 && ceiling.state.cargoCells > 0);
		assert.equal(require('../js/wild-ball.js').debrisCount, 0, 'all grains have settled');
		assert.ok(Math.abs(dug - soil.cells - soil.lostCells - ceiling.state.cargoCells) < 1e-6);
		assert.ok(Math.abs(physics.totalEnergy(world) - world.initialEnergy) < 1e-6);
	} finally {
		wildMine.setMode('classic');
	}
});
