'use strict';
// Measure the mineral-growth mixing of js/ceiling.js: how the slider turns the
// plain loose-face clump into a connected group. Run with `node experiments/mineral-mix-probe.cjs`.
const ceiling = require('../js/ceiling.js');

function bed(growth, seconds) {
	ceiling.reset(73);
	for (let mineral = 0; mineral < 3; mineral++) ceiling.setMineralClusterGrowth(mineral, growth);
	ceiling.generateTestRock();
	ceiling.collapse(seconds);
	const s = ceiling.state;
	let cells = 0;
	let groups = 0;
	for (let mineral = 0; mineral < 3; mineral++) {
		cells += s.fallCells[mineral];
		groups += s.fallGroups[mineral];
	}
	let grains = 0;
	for (let i = 0; i < s.active.length; i++) if (s.active[i]) grains++;
	return { bursts: s.collapseBursts, cells, groups, grains, perFall: groups ? cells / groups : 0 };
}

function natural(growth) {
	ceiling.reset(31);
	for (let mineral = 0; mineral < 3; mineral++) ceiling.setMineralClusterGrowth(mineral, growth);
	const s = ceiling.state;
	const world = { platform: { x: -50, vx: 0 }, heat: 0, time: 0, direction: 0 };
	for (let k = 0; k < 300; k++) {
		ceiling.damage(0.5 + (k * 0.61) % 23, s.bottom + 0.2, 45);
		ceiling.collapse(0.5);
		ceiling.step(world, 0.05, 0);
	}
	let cells = 0;
	let groups = 0;
	for (let mineral = 0; mineral < 3; mineral++) {
		cells += s.fallCells[mineral];
		groups += s.fallGroups[mineral];
	}
	return { bursts: s.collapseBursts, cells, groups, perFall: groups ? cells / groups : 0, conserved: s.extractedCells === s.airborneCells + s.caughtCells + s.lostCells };
}

console.log('test rock, 20 s of collapse');
console.log('growth  bursts  cells  falls  cells/fall');
for (const growth of [10, 50, 100, 200, 300, 400, 500]) {
	const r = bed(growth, 20);
	console.log(String(growth).padStart(6), String(r.bursts).padStart(7), String(r.cells).padStart(6), String(r.groups).padStart(6), r.perFall.toFixed(2).padStart(11));
}

console.log('\nnatural rock, 300 hit + collapse rounds');
console.log('growth  bursts  cells  falls  cells/fall  conserved');
for (const growth of [10, 100, 300, 500]) {
	const r = natural(growth);
	console.log(String(growth).padStart(6), String(r.bursts).padStart(7), String(r.cells).padStart(6), String(r.groups).padStart(6), r.perFall.toFixed(2).padStart(11), String(r.conserved).padStart(10));
}
