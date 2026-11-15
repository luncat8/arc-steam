const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Lab = require('../prototypes/solubility-lab.js');

function stepFor(state, seconds, dt = 1 / 60) {
	const steps = Math.round(seconds / dt);
	for (let i = 0; i < steps; i++) Lab.stepSimulation(state, dt, 0);
}

test('full dissolution of Halite (+G) and Blue Vitriol (+GB) pumps to hopper with exact conservation', () => {
	const state = Lab.createSimulation({ scene: 'columns', model: 'table', seed: 37 });
	// Position rig beneath the left columns so green & blue pools drain right under the pump
	state.rigX = 3.2;
	state.rigY = 1.45;
	state.pumpOn = true;

	// Column 0 = Halite (~x = 1.42 m)
	state.aimX = 1.42;
	state.aimY = 10.0;
	state.firing = true;
	stepFor(state, 3.0);

	const mHal = Lab.measureMetrics(state);
	assert.ok(mHal.cellsDissolved >= 12, `expected Halite to dissolve rapidly, got ${mHal.cellsDissolved}`);
	assert.ok(mHal.waterHaliteMass + mHal.pumpedHaliteMass >= 10, `expected Halite solute >= 10, got ${mHal.waterHaliteMass + mHal.pumpedHaliteMass}`);
	assert.equal(mHal.waterVitriolMass, 0, 'Halite should produce zero Blue Vitriol');
	assert.equal(mHal.lostGasMass, 0, 'Halite should lose zero gas');
	assert.ok(mHal.massDrift < 1e-6, `massDrift ${mHal.massDrift}`);
	assert.ok(mHal.valueDrift < 1e-6, `valueDrift ${mHal.valueDrift}`);
	assert.ok(mHal.waterDrift < 1e-5, `waterDrift ${mHal.waterDrift}`);

	// Column 1 = Blue Vitriol (~x = 3.33 m)
	state.aimX = 3.33;
	state.aimY = 10.0;
	stepFor(state, 3.0);
	state.firing = false;
	// Drive rig directly into the pooling basin to pump both dissolved solutes
	state.rigX = 4.0;
	stepFor(state, 4.0);

	const mBoth = Lab.measureMetrics(state);
	assert.ok(mBoth.waterVitriolMass + mBoth.pumpedVitriolMass >= 8, `expected Blue Vitriol solute >= 8, got ${mBoth.waterVitriolMass + mBoth.pumpedVitriolMass}`);
	assert.ok(mBoth.pumpedHaliteMass > 0.5, `expected pumped Halite > 0.5, got ${mBoth.pumpedHaliteMass}`);
	assert.ok(mBoth.pumpedVitriolMass > 0.5, `expected pumped Blue Vitriol > 0.5, got ${mBoth.pumpedVitriolMass}`);
	assert.ok(mBoth.massDrift < 1e-6, `massDrift ${mBoth.massDrift}`);
	assert.ok(mBoth.valueDrift < 1e-6, `valueDrift ${mBoth.valueDrift}`);
	assert.ok(mBoth.waterDrift < 1e-5, `waterDrift ${mBoth.waterDrift}`);
});

test('water gun has weak mechanical force on insoluble Corundum and Quartz', () => {
	const state = Lab.createSimulation({ scene: 'columns', model: 'table', seed: 37 });
	state.rigX = 14.5;
	state.rigY = 1.35;
	state.firing = true;

	// Column 6 = Quartz (~x = 12.92 m), Column 8 = Corundum (~x = 16.75 m)
	state.aimX = 12.92;
	state.aimY = 10.0;
	stepFor(state, 2.5);
	state.aimX = 16.75;
	state.aimY = 10.0;
	stepFor(state, 2.5);

	const m = Lab.measureMetrics(state);
	assert.equal(m.cellsDissolved, 0, 'insoluble Quartz/Corundum must not dissolve chemically');
	assert.equal(m.cellsMechBroken, 0, 'weak water jet must not mechanically shatter hard Quartz/Corundum');
	assert.equal(m.waterSoluteMass, 0, 'no solute should enter water from insoluble rock');
	assert.ok(m.massDrift < 1e-6);
	assert.ok(m.valueDrift < 1e-6);
});

test('incongruent decomposition: Fizzy Halite loses expensive gas while Fluorite drops solid debris', () => {
	// 1. Fizzy Halite (Column 2, ~x = 5.25 m)
	const sFizzy = Lab.createSimulation({ scene: 'columns', model: 'table', seed: 37 });
	sFizzy.rigX = 5.25;
	sFizzy.rigY = 1.45;
	sFizzy.aimX = 5.25;
	sFizzy.aimY = 10.0;
	sFizzy.firing = true;
	stepFor(sFizzy, 3.0);

	const mF = Lab.measureMetrics(sFizzy);
	assert.ok(mF.cellsDissolved >= 10, `expected Fizzy Halite to dissolve, got ${mF.cellsDissolved}`);
	assert.ok(mF.waterHaliteMass + mF.pumpedHaliteMass > 4, 'Fizzy Halite must dissolve its Halite salt share');
	assert.ok(mF.lostGasMass > 2, 'Fizzy Halite must vent its gas share as loss');
	assert.ok(mF.lostGasValue > (mF.pumpedHaliteValue + mF.waterSoluteValue), 'expensive vented gas value must exceed recovered cheap salt value');
	assert.ok(mF.massDrift < 1e-6, `fizzy massDrift ${mF.massDrift}`);
	assert.ok(mF.valueDrift < 1e-6, `fizzy valueDrift ${mF.valueDrift}`);

	// 2. Fluorite-Salt (Column 3, ~x = 7.17 m)
	const sFl = Lab.createSimulation({ scene: 'columns', model: 'table', seed: 37 });
	sFl.rigX = 7.17;
	sFl.rigY = 1.45;
	sFl.aimX = 7.17;
	sFl.aimY = 10.0;
	sFl.firing = true;
	stepFor(sFl, 3.2);

	const mFl = Lab.measureMetrics(sFl);
	assert.ok(mFl.cellsDissolved >= 5, `expected Fluorite-Salt to leach, got ${mFl.cellsDissolved}`);
	assert.ok(mFl.waterHaliteMass + mFl.pumpedHaliteMass > 2, 'Fluorite-Salt must release green brine solute');
	assert.ok(mFl.debrisCount >= 5 && mFl.debrisMass > 1.5, 'Fluorite-Salt must drop solid residue debris');
	assert.equal(mFl.lostGasMass, 0, 'Fluorite-Salt should vent zero gas');
	assert.ok(mFl.massDrift < 1e-6, `fluorite massDrift ${mFl.massDrift}`);
	assert.ok(mFl.valueDrift < 1e-6, `fluorite valueDrift ${mFl.valueDrift}`);
});

test('separate hydro-erosion pans Gold-bearing quartz (Pure Gold stays upstream, Quartz/Sand wash downstream)', () => {
	const state = Lab.createSimulation({ scene: 'placer', model: 'table', seed: 37 });
	state.pumpOn = true;
	state.erosionOn = true;
	state.erosionPower = 1.4;
	// Stream water directly onto the upper sluice bed so flow carries light grains rightwards
	state.rigX = 3.2;
	state.rigY = 6.2;
	state.aimX = 5.4;
	state.aimY = 4.6;
	state.firing = true;
	stepFor(state, 5.5);
	state.firing = false;
	stepFor(state, 2.5);

	const m = Lab.measureMetrics(state);
	assert.ok(m.goldPanEvents >= 5, `expected Gold-quartz placer separation events >= 5, got ${m.goldPanEvents}`);
	assert.ok(m.pureGoldMass > 0.5 && m.pureGoldValue > 30, `expected concentrated Pure Gold, got mass=${m.pureGoldMass}, val=${m.pureGoldValue}`);
	assert.ok(m.erosionHopEvents >= 25, `expected short-hop saltation events >= 25, got ${m.erosionHopEvents}`);
	assert.ok(m.meanGoldX < m.meanQuartzX, `Pure Gold (${m.meanGoldX.toFixed(2)}m) must stay upstream of washed Quartz (${m.meanQuartzX.toFixed(2)}m)`);
	assert.ok(m.meanGoldX < m.meanSandX, `Pure Gold (${m.meanGoldX.toFixed(2)}m) must stay upstream of washed Sand (${m.meanSandX.toFixed(2)}m)`);
	// Crucial invariant: hydro-erosion NEVER dissolves solid debris into chemical solutes!
	assert.equal(m.waterSoluteMass, 0, 'hydro-erosion must stay strictly separate from chemical dissolution');
	assert.equal(m.pumpedHaliteMass, 0);
	assert.equal(m.pumpedVitriolMass, 0);
	assert.ok(m.massDrift < 1e-6, `placer massDrift ${m.massDrift}`);
	assert.ok(m.valueDrift < 1e-6, `placer valueDrift ${m.valueDrift}`);
	assert.ok(m.waterDrift < 1e-5, `placer waterDrift ${m.waterDrift}`);
});

test('real RGB geology seams and continuous Composition Law f(R,G,B) conserve mass & value across octants', () => {
	// Verify continuous law f(R,G,B) across key octant centers
	const out = {};
	Lab.evaluateCompositionLaw(0.78, 0.82, 0.18, out); // HHL Halite
	assert.ok(out.halite > 0.7 && out.gas < 0.05, 'HHL octant must be Halite ionic salt');
	Lab.evaluateCompositionLaw(0.66, 0.18, 0.72, out); // HLH Blue Vitriol
	assert.ok(out.vitriol > 0.5, 'HLH octant must produce Blue Vitriol hydrate');
	Lab.evaluateCompositionLaw(0.80, 0.82, 0.84, out); // HHH Fizzy Halite
	assert.ok(out.halite > 0.3 && out.gas > 0.25, 'HHH octant must produce Fizzy Halite (salt + gas loss)');
	Lab.evaluateCompositionLaw(0.18, 0.80, 0.18, out); // LHL Corundum/Quartz
	assert.equal(out.solubility, 0, 'LHL covalent crystals must be insoluble');
	Lab.evaluateCompositionLaw(0.78, 0.18, 0.18, out); // HLL Iron/Copper/Silver
	assert.equal(out.solubility, 0, 'HLL dense metals must be insoluble');

	for (const model of ['table', 'formula']) {
		const state = Lab.createSimulation({ scene: 'geology', model, seed: 37 });
		state.firing = true;
		for (let seg = 0; seg < 4; seg++) {
			state.aimX = 4.0 + seg * 5.0;
			state.aimY = 8.5;
			stepFor(state, 1.2);
		}
		const m = Lab.measureMetrics(state);
		assert.ok(m.massDrift < 1e-6, `${model} massDrift ${m.massDrift}`);
		assert.ok(m.valueDrift < 1e-6, `${model} valueDrift ${m.valueDrift}`);
		assert.ok(m.waterDrift < 1e-5, `${model} waterDrift ${m.waterDrift}`);
	}
});

test('karst showcase performance and file:// standalone HTML cleanliness', () => {
	const state = Lab.createSimulation({ scene: 'karst', model: 'table', seed: 37 });
	state.demoSweepTimer = 5.0;
	const t0 = performance.now();
	stepFor(state, 5.0);
	const elapsed = performance.now() - t0;
	const msPerStep = elapsed / 300;
	const m = Lab.measureMetrics(state);

	assert.ok(msPerStep < 6.0, `expected fast simulation (< 6 ms/step), got ${msPerStep.toFixed(2)} ms/step`);
	assert.ok(m.cellsDissolved > 15, `expected karst sweep to dissolve seams, got ${m.cellsDissolved}`);
	assert.ok(m.massDrift < 1e-6, `karst massDrift ${m.massDrift}`);
	assert.ok(m.valueDrift < 1e-6, `karst valueDrift ${m.valueDrift}`);
	assert.ok(m.waterDrift < 1e-5, `karst waterDrift ${m.waterDrift}`);

	const html = fs.readFileSync(path.join(__dirname, '..', 'prototypes', 'solubility-lab.html'), 'utf8');
	assert.ok(!/https?:\/\//i.test(html), 'solubility-lab.html must not contain external URLs');
	assert.ok(!/type=["']module["']/i.test(html), 'solubility-lab.html must use classic <script> tags for file:// compatibility');
});
