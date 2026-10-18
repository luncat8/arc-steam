'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ceiling = require('../js/ceiling.js');

test('seeded ceiling fields repeat and each cell composition is normalized', () => {
	ceiling.reset(42);
	const first = Array.from(ceiling.state().strength);
	for (let i = 0; i < ceiling.state().columns; i++) {
		const comp = ceiling.state().composition;
		assert.ok(Math.abs(comp[i * 3] + comp[i * 3 + 1] + comp[i * 3 + 2] - 1) < 1e-6);
	}
	ceiling.reset(42);
	assert.deepEqual(Array.from(ceiling.state().strength), first);
});

test('radial damage weakens nearby cells and emits material once per failed cell', () => {
	ceiling.reset(9);
	const before = Array.from(ceiling.state().strength);
	const removed = ceiling.damage(6.25, 300);
	const state = ceiling.state();
	assert.ok(removed > 0);
	assert.ok(state.strength.some((value, index) => value < before[index]));
	assert.ok(state.extractedMass() > 0);
	ceiling.damage(6.25, 300);
	assert.ok(state.extractedMass() >= 1);
});
