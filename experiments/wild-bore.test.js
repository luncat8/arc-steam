'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const minerals = require('../js/minerals.js');
const ceiling = require('../js/ceiling.js');
const physics = require('../js/physics.js');
const equipment = require('../js/equipment.js');
const research = require('../js/research.js');
const players = require('../js/players.js');
require('../js/fuel.js');
const rubble = require('../js/wild-rubble.js');
const wildBall = require('../js/wild-ball.js');
const cart = require('../js/wild-cart.js');
const mine = require('../js/wild-mine.js');
const bore = require('../js/wild-bore.js');
const { near } = require('./harness.cjs');

const dt = physics.config.step;
const stoneId = minerals.mineralIds.indexOf('stone');
const goldId = minerals.mineralIds.indexOf('gold');

function freshWild(seed = 1) {
	mine.setMode('wild');
	const world = physics.createWorld();
	players.init(world, 0);
	const cave = mine.init(world, { seed });
	bore.setAuto(false);
	return { world, cave };
}

function assertBalanced(world, label, tolerance = 1e-8) {
	const drift = Math.abs(physics.totalEnergy(world) - world.initialEnergy);
	assert.ok(drift < tolerance, `${label || 'ledger'} drift ${drift}`);
}

function fillSolidFace(cave, colStart, colEnd, rowStart, rowEnd, strength) {
	const { stride, pad } = cave.state;
	for (let col = colStart; col <= colEnd; col++) {
		const chunk = cave.chunkFor(col);
		for (let row = rowStart; row <= rowEnd; row++) {
			const idx = row * stride + col - chunk.column0 + pad;
			chunk.solid[idx] = 1;
			chunk.dug[idx] = 0;
			if (strength !== undefined) {
				chunk.sampled[idx] = 1;
				chunk.strength[idx] = strength;
				chunk.damage[idx] = 0;
			}
		}
	}
}

function loadStone(world, cells) {
	const mass = cells * ceiling.state.cellMass;
	ceiling.loadCargo(stoneId, mass, mass * ceiling.state.mineralPrices[stoneId]);
	world.initialEnergy = physics.totalEnergy(world);
}

test('hammer buffers unlock through impact forging, stay inert in Classic, and Wild allows stopped engine swaps anywhere', t => {
	t.after(() => { bore.setAuto(false); mine.setMode('classic'); });
	const item = equipment.find('bore');
	assert.ok(item);
	assert.equal(item.requires, 'impact');
	assert.equal(item.cost, 620);
	assert.equal(item.mass, 14);

	// Classic mode: bore stays completely inert and engine swaps still require the left shop.
	mine.setMode('classic');
	const classic = physics.createWorld();
	players.init(classic);
	const { cave: dummyCave } = (() => {
		const c = require('../js/cave.js').create({ seed: 1 });
		c.stream(-10, 10, Infinity);
		return { cave: c };
	})();
	equipment.grant('bore', classic);
	bore.setHeld(true);
	const batteryBefore = classic.battery;
	assert.equal(bore.step(classic, dummyCave, dt), 0);
	assert.equal(classic.battery, batteryBefore);
	assert.equal(bore.readout(classic, dummyCave).status, 'off');
	classic.platform.x = 12;
	classic.platform.vx = 0;
	assert.equal(equipment.atShop(classic, 'rig'), false, 'Classic still requires left shop');

	// Wild mode: purchase through research, verify +14 kg mass, and swap engines far from spawn when stopped.
	const { world } = freshWild(1);
	assert.equal(equipment.install('bore', world), false, 'locked before impact');
	const goldMass = 40 * ceiling.state.cellMass;
	ceiling.loadCargo(goldId, goldMass, goldMass * ceiling.state.mineralPrices[goldId]);
	assert.ok(cart.sell(world) >= 3500, 'service cart funds research, bore and engine');
	world.initialEnergy = physics.totalEnergy(world);
	assert.ok(research.research('materials', world));
	assert.ok(research.research('impact', world));
	const preBoreMass = physics.dryMass('rig');
	const expectedMass = physics.dryMass('rig', { massDelta: item.mass });
	assert.ok(equipment.install('bore', world));
	near(physics.dryMass('rig'), expectedMass, 1e-9);
	assert.ok(physics.dryMass('rig') > preBoreMass + item.mass - 1e-9);
	assertBalanced(world, 'after bore purchase');

	world.platform.x = 9.5;
	world.platform.vx = 1.2;
	assert.equal(equipment.buyEngine('oil', world), false, 'moving rig cannot swap engines');
	world.platform.vx = 0;
	world.initialEnergy = physics.totalEnergy(world);
	assert.ok(equipment.buyEngine('oil', world), 'stopped Wild rig buys engine away from x = 0');
	assert.equal(physics.engineNow('rig').id, 'oil');
	assert.ok(equipment.buyEngine('electric', world), 'owned engine swaps back free while stopped');
	assertBalanced(world, 'after Wild engine swaps');
});

test('gating covers unfitted, open heading, empty reserve and thermal cutoff without leaking energy', t => {
	t.after(() => { bore.setAuto(false); mine.setMode('classic'); });
	const { world, cave } = freshWild(1);
	world.wildWater.intakeOn = false;
	assert.equal(bore.readout(world, cave).status, 'unfitted');
	assert.match(bore.readout(world, cave).reason, /No hammer buffers installed/);

	equipment.grant('bore', world);
	// At spawn x = 0 the 1.125 m heading on both sides sits inside the 8 m opening room.
	bore.setHeld(true);
	const startBattery = world.battery;
	physics.step(world, dt);
	assert.equal(world.battery, startBattery, 'open air spends zero reserve');
	const clearRead = bore.readout(world, cave);
	assert.equal(clearRead.status, 'clear');
	assert.equal(clearRead.headingCells, 0);
	assert.match(clearRead.reason, /Heading clear/);
	assertBalanced(world, 'open heading');

	// Park against the right wall with empty reserve, then at thermal cutoff.
	world.platform.x = 4 - physics.config.platformWidth * 0.5;
	world.platform.previousX = world.platform.x;
	world.battery = 0;
	world.initialEnergy = physics.totalEnergy(world);
	physics.step(world, dt);
	assert.equal(bore.cellsCut, 0);
	assert.equal(bore.readout(world, cave).status, 'empty');
	assert.match(bore.readout(world, cave).reason, /Reserve empty/);
	assertBalanced(world, 'empty reserve');

	world.battery = 5000;
	world.heat = (physics.config.thermalCutoff - physics.config.ambientTemperature + 5) * physics.config.heatCapacity;
	world.initialEnergy = physics.totalEnergy(world);
	bore.step(world, cave, dt);
	assert.equal(bore.cellsCut, 0);
	assert.equal(bore.readout(world, cave).status, 'hot');
	assert.match(bore.readout(world, cave).reason, /Thermal cutoff/);
	assertBalanced(world, 'thermal cutoff');
});

test('both ends bore an exact 1.5x clearance passage, preserve floor and borders, and spawn no ore or new seeps', t => {
	t.after(() => { bore.setAuto(false); mine.setMode('classic'); });
	for (const side of [1, -1]) {
		const { world, cave } = freshWild(5);
		world.wildWater.intakeOn = false;
		equipment.grant('bore', world);
		const shelf = cave.state.shelfRow;
		const cell = cave.state.cell;
		// Clear approach room and place a uniform 12-col solid face at |x| = 4.0 m.
		for (let c = -31; c <= 31; c++) {
			for (let r = shelf; r < shelf + 12; r++) cave.dig(c, r);
		}
		const wallCols = side > 0 ? [32, 43] : [-44, -33];
		fillSolidFace(cave, wallCols[0], wallCols[1], shelf - 2, shelf + 12, 4.0);
		world.platform.x = side * (4 - physics.config.platformWidth * 0.5);
		world.platform.y = shelf * cell;
		world.platform.previousX = world.platform.x;
		world.platform.previousY = world.platform.y;
		world.initialEnergy = physics.totalEnergy(world);

		bore.setSide(side);
		bore.setGradeDegrees(0);
		const before = bore.readout(world, cave);
		assert.equal(before.headingCells, 81, '9 cols x 9 rows (1.125 m x 1.125 m)');

		bore.setHeld(true);
		for (let i = 0; i < 240 * 5 && bore.readout(world, cave).status !== 'clear'; i++) {
			physics.step(world, dt);
			assertBalanced(world, `side ${side} step ${i}`);
		}
		bore.setHeld(false);
		assert.equal(bore.cellsCut, 81);
		assert.equal(wildBall.state.extractedCells, 0, 'bored rock yields no ore fragments');
		assert.equal(ceiling.state.cargoCells, 0, 'bored rock loads no cargo');

		// Verify exact 9-cell (1.125 m) vertical opening, intact floor (shelf - 1) and roof (shelf + 9), and zero seeps.
		const cutCols = side > 0 ? [32, 40] : [-41, -33];
		for (let c = cutCols[0]; c <= cutCols[1]; c++) {
			assert.equal(cave.solidCell(c, shelf - 1), true, 'floor preserved');
			for (let r = shelf; r < shelf + 9; r++) assert.equal(cave.solidCell(c, r), false, `corridor open (${c},${r})`);
			assert.equal(cave.solidCell(c, shelf + 9), true, 'roof above 1.5x stays intact');
			const chunk = cave.chunkFor(c);
			const seeps = world.wildWater.field.cellsFor(chunk);
			assert.equal(seeps.has(shelf * cave.state.chunkColumns + (c - chunk.column0)), false, 'dug floor seeds no seep');
		}
		near(cave.roofAbove(cave.worldX(cutCols[0]), shelf * cell + 0.1) - shelf * cell, bore.tunnelHeight, 1e-9);
	}

	// Verify 2-cell world borders survive even when cutting straight down at the floor.
	const { world, cave } = freshWild(1);
	world.wildWater.intakeOn = false;
	equipment.grant('bore', world);
	world.platform.x = 0;
	world.platform.y = 3 * cave.state.cell;
	world.platform.previousY = world.platform.y;
	fillSolidFace(cave, 12, 24, 0, 12, 2.0);
	world.initialEnergy = physics.totalEnergy(world);
	bore.setSide(1);
	bore.setGradeDegrees(-30);
	bore.setHeld(true);
	for (let i = 0; i < 240 * 4; i++) physics.step(world, dt);
	for (let c = 12; c <= 24; c++) {
		assert.equal(cave.solidCell(c, 0), true, 'bottom border row 0 intact');
		assert.equal(cave.solidCell(c, 1), true, 'bottom border row 1 intact');
	}
	assertBalanced(world, 'bottom border cut');
});

test('reserve cost scales strictly with remaining rock strength and partial weakening survives chunk eviction', t => {
	t.after(() => { bore.setAuto(false); mine.setMode('classic'); });
	function spendFor(strength, preDamage = 0) {
		const { world, cave } = freshWild(5);
		world.wildWater.intakeOn = false;
		equipment.grant('bore', world);
		const shelf = cave.state.shelfRow;
		for (let c = 18; c < 32; c++) for (let r = shelf; r < shelf + 12; r++) cave.dig(c, r);
		fillSolidFace(cave, 32, 42, shelf, shelf + 12, strength);
		if (preDamage > 0) cave.weaken(cave.worldX(32), cave.worldY(shelf + 2), preDamage, 2, 0.5, false);
		world.platform.x = 4 - physics.config.platformWidth * 0.5;
		world.platform.y = shelf * cave.state.cell;
		world.platform.previousX = world.platform.x;
		world.platform.previousY = world.platform.y;
		const before = world.battery;
		world.initialEnergy = physics.totalEnergy(world);
		bore.setSide(1);
		bore.setGradeDegrees(0);
		bore.setHeld(true);
		for (let i = 0; i < 240 * 8 && bore.readout(world, cave).status !== 'clear'; i++) physics.step(world, dt);
		assertBalanced(world, `strength ${strength}`);
		return before - world.battery;
	}

	const soft = spendFor(1.76);
	const stone = spendFor(4.2);
	const hard = spendFor(7.16);
	const softened = spendFor(7.16, 15);
	const eff = physics.engineNow('rig').efficiency;
	near(soft, 81 * 1.76 * bore.workPerStrength / eff, 1e-3);
	near(stone, 81 * 4.2 * bore.workPerStrength / eff, 1e-3);
	near(hard, 81 * 7.16 * bore.workPerStrength / eff, 1e-3);
	assert.ok(soft < stone && stone < hard, 'harder strata cost strictly more reserve');
	assert.ok(softened < hard - 20, 'pre-fractured rock cuts for less reserve');

	// Partial weakening of a tough cell persists across chunk eviction and finishes for only the remainder.
	const { world, cave } = freshWild(5);
	world.wildWater.intakeOn = false;
	equipment.grant('bore', world);
	const shelf = cave.state.shelfRow;
	for (let c = 18; c < 32; c++) for (let r = shelf; r < shelf + 12; r++) cave.dig(c, r);
	fillSolidFace(cave, 32, 32, shelf, shelf, 8.0);
	for (let r = shelf + 1; r < shelf + 12; r++) cave.dig(32, r);
	for (let c = 33; c <= 43; c++) for (let r = shelf; r < shelf + 12; r++) cave.dig(c, r);
	world.platform.x = 4 - physics.config.platformWidth * 0.5;
	world.platform.y = shelf * cave.state.cell;
	world.platform.previousX = world.platform.x;
	world.platform.previousY = world.platform.y;
	const fullCost = 8.0 * bore.workPerStrength / eff;
	world.battery = fullCost * 0.4;
	world.initialEnergy = physics.totalEnergy(world);
	bore.setHeld(true);
	physics.step(world, dt);
	physics.step(world, dt);
	assert.equal(cave.solidCell(32, shelf), true, 'partially hammered cell still stands');
	const midStrength = cave.strengthAt(32, shelf);
	assert.ok(midStrength > 0 && midStrength < 8.0);
	assert.ok(cave.damageAt(32, shelf) > 0);

	// Stream far away to evict chunk 0, then return and finish the cell.
	cave.stream(400, 420, Infinity);
	cave.stream(-10, 20, Infinity);
	near(cave.strengthAt(32, shelf), midStrength, 1e-5);
	world.battery = fullCost;
	world.initialEnergy = physics.totalEnergy(world);
	for (let i = 0; i < 20 && cave.solidCell(32, shelf); i++) physics.step(world, dt);
	assert.equal(cave.solidCell(32, shelf), false);
	near(fullCost - world.battery, midStrength * bore.workPerStrength / eff, 1e-3);
	assertBalanced(world, 'after eviction resume');
});

test('soil resting on rock opened by the bore settles cleanly onto the new corridor floor', t => {
	t.after(() => { bore.setAuto(false); mine.setMode('classic'); });
	const { world, cave } = freshWild(5);
	world.wildWater.intakeOn = false;
	equipment.grant('bore', world);
	const shelf = cave.state.shelfRow;
	const cell = cave.state.cell;
	for (let c = 18; c <= 40; c++) for (let r = shelf; r < shelf + 14; r++) cave.dig(c, r);
	// Build a 1-row rock bench at `shelf` in col 34 with loose soil perched on top at `shelf + 1`.
	fillSolidFace(cave, 34, 34, shelf, shelf, 3.0);
	const ledgeY = (shelf + 1) * cell;
	assert.equal(rubble.deposit(cave.worldX(34), ledgeY + 0.02, 2, 10), 2);
	const before = rubble.state();

	world.platform.x = 4 - physics.config.platformWidth * 0.5;
	world.platform.y = shelf * cell;
	world.platform.previousX = world.platform.x;
	world.platform.previousY = world.platform.y;
	world.initialEnergy = physics.totalEnergy(world);
	bore.setSide(1);
	bore.setGradeDegrees(0);
	bore.setHeld(true);
	for (let i = 0; i < 60 && cave.solidCell(34, shelf); i++) physics.step(world, dt);
	assert.equal(cave.solidCell(34, shelf), false);
	const after = rubble.state();
	near(after.cells, before.cells, 1e-6);
	near(after.value, before.value, 1e-6);
	assert.ok(rubble.crestAt(cave.worldX(34), shelf * cell + 0.3) > shelf * cell, 'soil dropped onto the corridor floor');
	assertBalanced(world, 'undercut soil drop');
});

test('rig drives through level, climbing and descending solid-rock corridors in both directions and reaches new seeps', t => {
	t.after(() => { bore.setAuto(false); mine.setMode('classic'); });
	const headings = [
		{ dir: 1, deg: 0, minTravel: 4.5, minRise: -0.05, maxRise: 0.05 },
		{ dir: -1, deg: 0, minTravel: 4.5, minRise: -0.05, maxRise: 0.05 },
		{ dir: 1, deg: 25, minTravel: 4.0, minRise: 1.3, maxRise: 4.0 },
		{ dir: -1, deg: 25, minTravel: 4.0, minRise: 1.3, maxRise: 4.0 },
		{ dir: 1, deg: -25, minTravel: 3.5, minRise: -4.0, maxRise: -1.3 },
		{ dir: -1, deg: -25, minTravel: 3.0, minRise: -4.0, maxRise: -1.3 }
	];
	for (const h of headings) {
		const { world, cave } = freshWild(20);
		for (const chunk of cave.eachChunk()) {
			const { solid, column0 } = chunk;
			const { chunkColumns, rows, stride, pad } = cave.state;
			for (let local = 0; local < chunkColumns; local++) {
				if (Math.abs(cave.worldX(column0 + local)) < 4) continue;
				for (let r = 2; r < rows - 2; r++) solid[r * stride + local + pad] = 1;
			}
		}
		equipment.grant('bore', world);
		equipment.grant('motor', world);
		equipment.installRadiator('bank', world);
		loadStone(world, 45);
		const startY = world.platform.y;
		bore.setAuto(true);
		bore.setGradeDegrees(h.deg);
		world.direction = h.dir;
		for (let i = 0; i < 240 * 16; i++) {
			physics.step(world, dt);
			if ((i & 63) === 0) assertBalanced(world, `dir ${h.dir} grade ${h.deg}`);
		}
		assertBalanced(world, `dir ${h.dir} grade ${h.deg} end`);
		const travel = h.dir * world.platform.x;
		const rise = world.platform.y - startY;
		assert.ok(travel >= h.minTravel, `dir ${h.dir} grade ${h.deg} travelled ${travel.toFixed(2)} m`);
		assert.ok(rise >= h.minRise && rise <= h.maxRise, `dir ${h.dir} grade ${h.deg} rise ${rise.toFixed(2)} m`);
		if (h.dir === 1 && h.deg === -25) {
			bore.setAuto(false);
			world.direction = -1;
			for (let i = 0; i < 240 * 8 && world.platform.x > 0.1; i++) physics.step(world, dt);
			assert.ok(world.platform.x <= 0.2, `rig backs out up the -25° shaft (x=${world.platform.x.toFixed(2)})`);
			near(world.platform.y, startY, 0.15);
			assertBalanced(world, 'reverse exit up -25° bore');
		}
	}

	// Boring left and down on seed 1 reaches a natural cavern seep beyond spawn (spawn seep sits to the right).
	const { world } = freshWild(1);
	equipment.grant('bore', world);
	equipment.grant('motor', world);
	equipment.installRadiator('radiator', world);
	loadStone(world, 30);
	bore.setAuto(true);
	bore.setGradeDegrees(-20);
	world.direction = -1;
	for (let i = 0; i < 240 * 14; i++) physics.step(world, dt);
	assert.ok(world.platform.x < -6, 'entered left cavern');
	assert.ok(world.wildWater.collectedCondensate > 0.5, 'collected condensate from a newly opened cavern seep');
	assertBalanced(world, 'seep breakout');
});

test('cursor aim tracks pointer side and slope, yields to manual grade, and auto order persists across reset', t => {
	t.after(() => { bore.setAuto(false); mine.setMode('classic'); });
	const { world } = freshWild(1);
	equipment.grant('bore', world);
	bore.setAuto(true);
	bore.setCursorAim(true, world);
	bore.updatePointer(world, 8, world.platform.y + 3);
	assert.equal(bore.side, 1);
	assert.ok(bore.grade > 0.25 && bore.grade <= bore.maxGrade);

	bore.updatePointer(world, -8, world.platform.y - 10);
	assert.equal(bore.side, -1);
	near(bore.grade, -bore.maxGrade, 1e-9);

	bore.setGradeDegrees(12);
	assert.equal(bore.cursorAim, false, 'manual grade edit leaves cursor aim');
	near(bore.grade, 12 * Math.PI / 180, 1e-9);
	bore.setGradeDegrees(90);
	near(bore.grade, bore.maxGrade, 1e-9, 'clamps to maxGrade');

	bore.reset();
	assert.equal(bore.auto, true, 'standing auto-bore order survives reset');
	assert.equal(bore.grade, 0);
	assert.equal(bore.cellsCut, 0);
});
