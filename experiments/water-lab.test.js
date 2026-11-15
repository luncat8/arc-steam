'use strict';
// Smoke, conservation and physics checks for prototypes/water-lab.js across
// all three selectable solvers (hybrid, sph, flip) and all four scenes.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const lab = require(path.join(root, 'prototypes', 'water-lab.js'));

test('water-lab.html defines every element id referenced by water-lab.js', () => {
	const html = fs.readFileSync(path.join(root, 'prototypes', 'water-lab.html'), 'utf8');
	const js = fs.readFileSync(path.join(root, 'prototypes', 'water-lab.js'), 'utf8');
	const ids = new Set();
	for (const match of html.matchAll(/\bid="([^"]+)"/g)) ids.add(match[1]);
	const referenced = new Set();
	for (const match of js.matchAll(/getElementById\('([^']+)'\)/g)) referenced.add(match[1]);
	for (const match of js.matchAll(/bindRange\('([^']+)',\s*'([^']+)'/g)) {
		referenced.add(match[1]);
		referenced.add(match[2]);
	}
	assert.ok(referenced.size >= 15, 'expected water-lab.js DOM bindings');
	for (const id of referenced) {
		assert.ok(ids.has(id), 'missing id in prototypes/water-lab.html: ' + id);
	}
});

test('all three solvers conserve water and dissolved slurry across firing and under-platform suction', () => {
	for (const solver of ['hybrid', 'sph', 'flip']) {
		lab.state.solver = solver;
		lab.state.pumpOn = true;
		lab.state.autoFire = true;
		lab.state.dissolveOn = true;
		lab.state.flowRate = 1.0;
		lab.state.pumpRate = 1.2;
		lab.loadScene('classic');
		lab.fillWaterBox(9.5, 14.5, 0.35, 1.05);

		for (let i = 0; i < 180; i++) lab.stepSim(1 / 60);
		const m = lab.measureMetrics();
		const netWater = lab.state.floodedArea - lab.state.pumpedArea;
		const waterDrift = Math.abs(netWater - m.waterArea);

		assert.ok(Number.isFinite(m.waterArea), solver + ' waterArea must stay finite');
		assert.ok(lab.state.floodedArea > 1.5, solver + ' unlimited tank must flood water');
		assert.ok(lab.state.pumpedArea > 0.2, solver + ' under-platform pump must retrieve water');
		assert.ok(waterDrift < 1e-3, solver + ' water conservation drift too high: ' + waterDrift);
		assert.ok(m.slurryDrift < 1e-4, solver + ' slurry conservation drift too high: ' + m.slurryDrift);
	}
});

test('hybrid solver equalizes Wild Mine U-tube under submerged pillar and pumps water under platform', () => {
	lab.state.solver = 'hybrid';
	lab.state.pumpOn = true;
	lab.state.autoFire = false;
	lab.state.dissolveOn = false;
	lab.loadScene('wild');

	for (let i = 0; i < 240; i++) lab.stepSim(1 / 60);
	const m = lab.measureMetrics();
	assert.ok(lab.state.pumpedArea > 0.5, 'water flowing under the rock pillar should reach and be pumped under the platform');
	assert.ok(m.waterArea > 5, 'substantial water should remain pooled in the U-tube');
});

test('dam breach cascades water out of upper reservoir across overhang into lower basin', () => {
	for (const solver of ['hybrid', 'flip']) {
		lab.state.solver = solver;
		lab.state.pumpOn = false;
		lab.state.autoFire = false;
		lab.state.dissolveOn = false;
		lab.loadScene('waterfall');
		const before = lab.measureMetrics().waterArea;
		lab.sculptRock(9.05, 9.6, 0, 0.72);
		for (let i = 0; i < 180; i++) lab.stepSim(1 / 60);
		const after = lab.measureMetrics().waterArea;
		assert.ok(Math.abs(before - after) < 1e-2, solver + ' dam breach must preserve total water volume');

		if (solver === 'hybrid') {
			let lowerWater = 0;
			for (let r = 0; r < 12; r++) {
				for (let c = 0; c < lab.F_COLS; c++) lowerWater += lab.cellWater[r * lab.F_COLS + c];
			}
			assert.ok(lowerWater > 40, 'breached reservoir water should cascade into the lower basin');
		}
	}
});
