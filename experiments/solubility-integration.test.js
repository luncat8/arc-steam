'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const minerals = require('../js/minerals.js');
const materials = require('../js/rock-materials.js');
const config = require('../js/geology-config.js');
const geology = require('../js/geology.js');
const ceiling = require('../js/ceiling.js');
const Lab = require('../prototypes/solubility-lab.js');
const index = id => minerals.mineralIds.indexOf(id);
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

function referencePrices() {
	return materials.basePricesInto(new Float64Array(minerals.mineralCount), minerals.rarityTargets);
}

function washPlacer(prices) {
	const state = Lab.createSimulation({ scene: 'placer', prices, seed: 37 });
	state.erosionPower = 1.4;
	state.rigX = 3.2; state.rigY = 6.2;
	state.aimX = 5.4; state.aimY = 4.6;
	state.firing = true;
	for (let step = 0; step < 480; step++) {
		if (step === 330) state.firing = false;
		Lab.stepSimulation(state, 1 / 60, 0);
	}
	return Lab.measureMetrics(state);
}

test('one canonical table defines 13 forming minerals and one liberated phase', () => {
	assert.equal(minerals.formationCount, 13);
	assert.equal(minerals.mineralCount, 14);
	for (let m = 0; m < minerals.mineralCount; m++) {
		const row = minerals.mineralTable[m];
		assert.equal(Lab.MINERALS[m].id, row.id);
		assert.equal(Lab.MINERALS[m].r, row.r);
		assert.equal(Lab.MINERALS[m].strength, row.strength);
		assert.equal(Lab.MINERALS[m].density, row.rho);
		assert.equal(Lab.MINERALS[m].dye, row.dye);
		near(row.brineF + row.ventF + row.residueF, 1);
		assert.ok(index(row.residueId) >= 0);
		assert.ok(row.rho > 1);
	}
	assert.equal(minerals.mineralTable[index('pure_gold')].gen, false);
	near(minerals.rarityTargets[index('copper')] + minerals.rarityTargets[index('vitriol')], 0.0783);
});

test('rounded shipped boxes meet the eight-seed calibration and never generate Pure Gold', () => {
	const settings = config.create(1);
	const sample = geology.buildSample({ seeds: [1, 2, 3, 4, 5, 6, 7, 8], columns: 192, rows: 120,
		frequency: settings.frequency, yCompression: settings.yCompression });
	const formation = geology.compile(settings.ranges, settings.mode, settings.specificity);
	const cache = geology.buildCache(sample, formation);
	const stats = geology.statsAt(cache, settings.hostWeight, geology.emptyStats());
	for (let m = 0; m < minerals.mineralCount; m++) near(stats.shares[m], minerals.rarityTargets[m], 0.001);
	assert.equal(stats.shares[index('pure_gold')], 0);
	const original = settings.ranges[index('pure_gold')].map(range => range.slice());
	const adjusted = geology.autoAdjust({ sample, ranges: settings.ranges, targets: minerals.rarityTargets,
		mode: settings.mode, specificity: settings.specificity, tolerance: 0.05 });
	assert.ok(Number.isFinite(adjusted.history[0].worst));
	assert.equal(adjusted.stats.shares[index('pure_gold')], 0);
	assert.deepEqual(adjusted.ranges[index('pure_gold')], original);
});

test('liberated gold is excluded from abundance normalisation and follows the live market', () => {
	const shares = Float64Array.from(minerals.rarityTargets);
	const expected = referencePrices();
	shares[index('pure_gold')] = 1;
	const actual = materials.basePricesInto(new Float64Array(minerals.mineralCount), shares);
	assert.deepEqual(actual, expected, 'a non-forming phase cannot dilute every ore quote');
	for (const seed of [1, 31]) {
		ceiling.reset(seed);
		for (let second = 0; second < 120; second++) {
			ceiling.advanceMarket(1);
			const prices = ceiling.state.mineralPrices;
			near(prices[index('pure_gold')], materials.liberatedGoldQuote(prices[index('gold')], prices[index('quartz')]));
		}
	}
});

test('simulation quote snapshots are independent and diagnostics reuse caller-owned buffers', () => {
	const prices = referencePrices();
	prices[index('halite')] = 17;
	const state = Lab.createSimulation({ prices });
	prices[index('halite')] = 99;
	assert.equal(state.prices[index('halite')], 17);
	const other = Lab.createSimulation();
	assert.notEqual(other.prices[index('halite')], 17);
	const haliteCell = state.rockMineral.findIndex((m, i) => state.rockSolid[i] && m === index('halite'));
	assert.equal(state.rockValue[haliteCell], 17);
	const snapshot = Lab.measureMetrics(state);
	const out = Lab.createMetrics();
	const buffer = out.waterByMineral;
	out.waterByMineral.fill(99);
	assert.equal(Lab.measureMetrics(state, out), out);
	assert.equal(out.waterByMineral, buffer);
	assert.deepEqual(out, snapshot);
	Lab.applyCursorTool(state, 12, 1.3, 'pour', 1 / 12);
	assert.ok(Lab.measureMetrics(state, out).waterMass > snapshot.waterMass);
	assert.equal(snapshot.waterMass, 0, 'snapshot calls must remain independent');
	assert.throws(() => Lab.createSimulation({ prices: [1] }), RangeError);
	prices[index('halite')] = NaN;
	assert.throws(() => Lab.createSimulation({ prices }), RangeError);
});

test('placer liberation prices quartz at supplied quotes, not a fixed percentage', () => {
	const prices = referencePrices();
	prices[index('gold')] = 80;
	prices[index('quartz')] = 20;
	const metrics = washPlacer(prices);
	assert.ok(metrics.goldPanEvents >= 5);
	near(metrics.pureGoldValue / metrics.pureGoldMass, 260);
	assert.ok(metrics.massDrift < 1e-9 && metrics.valueDrift < 1e-9);
	prices[index('gold')] = 10;
	prices[index('quartz')] = 100;
	const inverted = washPlacer(prices);
	assert.equal(inverted.goldPanEvents, 0, 'defer liberation rather than mint gangue value or negative gold');
	assert.ok(inverted.massDrift < 1e-9 && inverted.valueDrift < 1e-9);
});

test('the lab loads its local classic-script dependency graph without require', () => {
	const root = path.join(__dirname, '..');
	const html = fs.readFileSync(path.join(root, 'prototypes/solubility-lab.html'), 'utf8');
	const context = vm.createContext({ document: { readyState: 'loading', addEventListener() {} } });
	for (const match of html.matchAll(/<script src="([^"]+)"/g)) {
		const filename = path.resolve(root, 'prototypes', match[1]);
		vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
	}
	assert.equal(context.SolubilityLab.MINERAL_COUNT, 14);
	assert.equal(context.SolubilityLab.MINERALS[index('halite')].price, referencePrices()[index('halite')]);
});

test('custom wall-brine and gas-residue quotes flow through the exact ledger', () => {
	const prices = referencePrices();
	prices[index('halite')] = 17;
	prices[index('gas')] = 50;
	prices[index('stone')] = 4;
	const wall = Lab.createSimulation({ prices, seed: 37 });
	wall.rigX = 3.2; wall.rigY = 1.45;
	wall.aimX = 1.42; wall.aimY = 10;
	wall.firing = true;
	for (let step = 0; step < 180; step++) Lab.stepSimulation(wall, 1 / 60, 0);
	const brine = Lab.measureMetrics(wall);
	assert.ok(brine.waterHaliteMass + brine.pumpedHaliteMass > 1);
	near((brine.waterSoluteValue + brine.pumpedSoluteValue) /
		(brine.waterSoluteMass + brine.pumpedSoluteMass), 17);
	assert.ok(brine.massDrift < 1e-9 && brine.valueDrift < 1e-9);
	const gas = Lab.createSimulation({ prices, seed: 37 });
	gas.pumpOn = false; gas.erosionOn = false;
	for (let pour = 0; pour < 30; pour++) Lab.applyCursorTool(gas, 12, 1.3, 'pour', 1 / 12);
	Lab.spawnDebrisGrain(gas, 12, 1.05, index('gas'), 1);
	for (let step = 0; step < 480; step++) Lab.stepSimulation(gas, 1 / 60, 0);
	const residue = Lab.measureMetrics(gas);
	near(residue.debrisMass, 0.15);
	near(residue.debrisValue, 0.6);
	near(residue.lostGasValue, 49.4);
	assert.ok(residue.massDrift < 1e-9 && residue.valueDrift < 1e-9);
});
