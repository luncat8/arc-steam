'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const p = require('../js/physics.js');
test('source packs fund 2–6 full-force map crossings, with independent empty rescue', () => {
	for (const source of p.engines) {
		const w = p.createWorld();
		w.platform.x = p.platformMin();
		assert.ok(p.selectEngine(source.id, w));
		const mass = p.platformMass(w);
		const energy = Math.min(0.5 * mass * p.speedNow() ** 2, p.forceNow() * (p.platformMax() - p.platformMin())) / source.efficiency;
		assert.ok(p.config.battery / energy >= 2 && p.config.battery / energy <= 6, source.id);
		w.battery = 0;
		w.platform.x = 3;
		w.ball.state = 'held';
		w.direction = 1;
		w.initialEnergy = p.totalEnergy(w);
		for (let i = 0; i < 240; i++) p.step(w, p.config.step);
		assert.ok(w.platform.vx > 0 && w.platform.vx <= p.config.crankMaxSpeed);
		assert.equal(w.battery, 0);
		assert.ok(Math.abs(p.totalEnergy(w) - w.initialEnergy) < 1e-6);
	}
});

test('progression holds: bare starter sustains smart play, weak packs choke nozzles, upgraded T3+bank runs all tools', () => {
	const ceiling = require('../js/ceiling.js');
	const equipment = require('../js/equipment.js');
	const research = require('../js/research.js');
	const players = require('../js/players.js');
	require('../js/prediction.js');
	const autopilot = require('../js/autopilot.js');
	const sand = require('../js/sandblaster.js');
	require('../js/water-chemistry.js');
	const water = require('../js/water.js');
	const minerals = require('../js/minerals.js');
	const sandIndex = minerals.mineralIds.indexOf('sand');
	const c = p.config;

	// Stage 1: bare electric smart intercept + piston runs 45 s without thermal derating.
	const s1 = p.createWorld();
	players.init(s1, 0);
	ceiling.reset(1);
	water.reset(1);
	sand.reset(1);
	sand.setAutoFire(false, 'rig');
	water.setAutoFire(false, 'rig');
	for (const ch of ['smart', 'drive', 'angle']) autopilot.set(ch, true);
	s1.initialEnergy = p.totalEnergy(s1);
	for (let i = 0; i < 240 * 45; i++) {
		autopilot.update(s1, c.step);
		p.step(s1, c.step);
		assert.equal(p.thermalFactor(s1), 1, 'bare starter smart play stays below 85 C derate');
	}
	assert.ok(Math.abs(p.totalEnergy(s1) - s1.initialEnergy) < 1e-5);
	for (const ch of ['move', 'smart', 'drive', 'angle']) autopilot.set(ch, false);
	autopilot.reset();

	// Stage 1 nozzle check: an off-pad stock electric pack drains below the 20% auto-fire floor inside 9 s.
	const weak = p.createWorld();
	players.init(weak, 0);
	ceiling.reset(1);
	water.reset(1);
	equipment.grant('watergun', weak, 'rig');
	weak.platform.x = weak.platform.previousX = 8;
	weak.drive = false;
	weak.battery = c.battery;
	weak.initialEnergy = p.totalEnergy(weak);
	water.setPump(true);
	water.setAim(8, 14.5);
	water.setAutoFire(true, 'rig');
	for (let i = 0; i < 240 * 9; i++) p.step(weak, c.step);
	water.setAutoFire(false, 'rig');
	assert.ok(weak.battery < c.battery * water.state.autoFireReserve, 'a starter pack cannot run the water gun for long');
	assert.ok(Math.abs(p.totalEnergy(weak) - weak.initialEnergy) < 1e-5);

	// Stage 3: fully upgraded electric rig with heavy radiator bank runs movement, piston, grader, sandblaster and water+pump together with zero cutoff.
	const s3 = p.createWorld();
	players.init(s3, 0);
	ceiling.reset(1);
	water.reset(1);
	sand.reset(1);
	for (const node of research.nodes) research.grant(node.id, s3, 'rig');
	for (const id of ['pad', 'coil', 'ram', 'motor', 'overdrive', 'chassis', 'flywheel', 'grader', 'sandblaster', 'watergun']) {
		equipment.grant(id, s3, 'rig');
	}
	assert.equal(equipment.installRadiator('bank', s3, true, 'rig'), true);
	assert.equal(equipment.installBall('spike', s3, true, 'rig'), true);
	ceiling.loadCargo(sandIndex, 20 * ceiling.state.cellMass, 0);
	s3.battery = c.battery;
	s3.initialEnergy = p.totalEnergy(s3);
	sand.setAutoFire(true, 'rig');
	water.setAutoFire(true, 'rig');
	players.setBot(0, true);
	for (let i = 0; i < 240 * 25; i++) {
		water.setAim(s3.platform.x, 14.5);
		players.update(s3, c.step);
		autopilot.update(s3, c.step);
		p.step(s3, c.step);
		assert.ok(p.thermalFactor(s3) > 0.9, 'upgraded T3+bank stays cool under continuous multi-tool load');
	}
	players.setBot(0, false);
	sand.setAutoFire(false, 'rig');
	water.setAutoFire(false, 'rig');
	assert.ok(sand.state.fired > 350, 'sandblaster ran continuously');
	assert.ok(water.totals.droplets > 900, 'water gun ran continuously');
	for (let i = 0; i < 240 * 6 && (sand.state.chamberAloft > 0 || ceiling.state.airborneCells > 0); i++) {
		p.step(s3, c.step);
	}
	assert.ok(Math.abs(p.totalEnergy(s3) - s3.initialEnergy) < 1e-5, 'multi-tool ledger closes');
});

