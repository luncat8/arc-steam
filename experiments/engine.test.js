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
