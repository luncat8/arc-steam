'use strict';
// Stock one-ball shifts for checking collapse pace and heat after strength tuning.
const assert = require('node:assert/strict');
const ceiling = require('../js/ceiling.js');
require('../js/equipment.js');
require('../js/research.js');
const physics = require('../js/physics.js');
const config = physics.config;
const damage = ceiling.damage;
let hits = [];
ceiling.damage = function (x, y, energy, owner) {
	hits.push(energy);
	return damage(x, y, energy, owner);
};

for (const shape of ['smooth', 'square']) {
	for (const seed of [1, 10, 21, 47]) {
		const world = physics.createWorld();
		ceiling.reset(seed);
		ceiling.setShape(shape);
		world.drive = true;
		world.initialEnergy = physics.totalEnergy(world);
		hits = [];
		for (let step = 0; step < 120 * 240; step++) {
			world.target = ceiling.state.cargoCells >= 100
				? (world.platform.x < config.width * 0.5 ? physics.platformMin() : physics.platformMax())
				: world.ball.x;
			physics.step(world, config.step);
			if (world.ball.state === 'held' && physics.canLaunch(world)) physics.launch(world);
		}
		const state = ceiling.state;
		const sorted = hits.slice().sort((a, b) => a - b);
		const medianHit = sorted[Math.floor(sorted.length / 2)] || 0;
		const error = physics.totalEnergy(world) - world.initialEnergy;
		assert.ok(Math.abs(error) < 1e-6, 'energy ledger drift for ' + shape + ' seed ' + seed);
		assert.equal(state.extractedCells, state.airborneCells + state.caughtCells + state.lostCells);
		console.log(shape, 'seed', seed, 'extracted', state.extractedCells,
			'caught', state.caughtCells, 'lost', state.lostCells, 'sold', state.soldCells,
			'earned', state.soldValue.toFixed(1), 'cr', 'temperature', physics.temperature(world).toFixed(1), 'C',
			'hits', hits.length, 'median', medianHit.toFixed(3), 'J', 'energy error', error.toExponential(2), 'J');
	}
}
