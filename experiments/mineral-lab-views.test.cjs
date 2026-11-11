'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('prototypes/mineral-lab.js', 'utf8');
const minerals = require('../js/minerals.js');
const context = vm.createContext({ minerals, count: minerals.mineralCount, table: minerals.mineralTable,
	window: { matchMedia: () => ({ matches: true }) }, mapMix: new Float32Array(minerals.mineralCount),
	state: { view: 'minerals' }, dirty: { draw: false }, schedules: 0 });
vm.runInContext('function schedule() { schedules++; }\n' +
	source.slice(source.indexOf('const referencePrices'), source.indexOf('const columns')) +
	source.slice(source.indexOf('function setViewMode'), source.indexOf('function draw()')), context);
for (let m = 0; m < minerals.mineralCount; m++) {
	context.mapMix.fill(0);
	context.mapMix[m] = 1;
	assert.equal(vm.runInContext('mixedValue(0, false)', context), minerals.mineralTable[m].strength);
	const price = vm.runInContext('mixedValue(0, true)', context);
	assert.ok(price >= 0.4 && price <= 150);
}
context.mapMix.fill(0);
context.mapMix[0] = context.mapMix[1] = 0.5;
assert.ok(Math.abs(vm.runInContext('mixedValue(0, false)', context) - 4.8) < 1e-12);
vm.runInContext("setViewMode('strength'); setViewMode('strength');", context);
assert.equal(context.state.view, 'strength');
assert.equal(context.dirty.draw, true);
assert.equal(context.schedules, 1);
console.log('mineral lab view calculations and selection: passed');
