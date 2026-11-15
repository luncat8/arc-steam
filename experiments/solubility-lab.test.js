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
	assert.ok(mHal.massDrift < 1e-9, `massDrift ${mHal.massDrift}`);
	assert.ok(mHal.valueDrift < 1e-9, `valueDrift ${mHal.valueDrift}`);
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

test('incongruent decomposition: Fizzy Halite 33.3% gas stoichiometry, Fluorite skeleton stands', () => {
	// 1. Fizzy Halite R2G2B2 (Column 2, ~x = 5.25 m): 66.7% brine + 33.3% gas lost
	const sFizzy = Lab.createSimulation({ scene: 'columns', model: 'table', seed: 37 });
	sFizzy.rigX = 5.25;
	sFizzy.rigY = 1.45;
	sFizzy.aimX = 5.25;
	sFizzy.aimY = 10.0;
	sFizzy.firing = true;
	stepFor(sFizzy, 3.0);

	const mF = Lab.measureMetrics(sFizzy);
	const fizzyBrine = mF.waterFizzyMass + mF.pumpedFizzyMass;
	assert.ok(mF.cellsDissolved >= 10, `expected Fizzy Halite to dissolve, got ${mF.cellsDissolved}`);
	assert.ok(fizzyBrine > 4, 'Fizzy Halite must dissolve its green brine share');
	const reacted = fizzyBrine + mF.lostGasMass;
	assert.ok(reacted > 0, 'Fizzy must react');
	const gasFrac = mF.lostGasMass / reacted;
	assert.ok(Math.abs(gasFrac - 1 / 3) < 0.03, `Fizzy gas fraction must be 33.3%, got ${gasFrac}`);
	assert.ok(Math.abs(fizzyBrine / reacted - 2 / 3) < 0.03, `Fizzy brine fraction must be 66.7%, got ${fizzyBrine / reacted}`);
	assert.ok(mF.massDrift < 1e-9, `fizzy massDrift ${mF.massDrift}`);
	assert.ok(mF.valueDrift < 1e-9, `fizzy valueDrift ${mF.valueDrift}`);

	// 2. Fluorite-Salt (Column 3, ~x = 7.17 m): 55% brine, 45% skeleton stands (1.35 J > 0.8 J)
	const sFl = Lab.createSimulation({ scene: 'columns', model: 'table', seed: 37 });
	assert.ok(Lab.skeletonStrength(sFl, findCell(sFl, Lab.MIN_FLUORITE)) > Lab.DEBRIS_LIMIT, 'pure Fluorite skeleton must exceed debrisLimit');
	assert.ok(Lab.skeletonStrength(sFl, findCell(sFl, Lab.MIN_HALITE)) < Lab.DEBRIS_LIMIT, 'pure Halite skeleton must be below debrisLimit');
	sFl.rigX = 7.17;
	sFl.rigY = 1.45;
	sFl.aimX = 7.17;
	sFl.aimY = 10.0;
	sFl.firing = true;
	stepFor(sFl, 3.2);

	const mFl = Lab.measureMetrics(sFl);
	assert.ok(mFl.waterFluoriteMass + mFl.pumpedFluoriteMass > 2, 'Fluorite-Salt must release green brine solute');
	assert.ok(mFl.exhaustedCells >= 3, `Fluorite skeleton cells must stand exhausted, got ${mFl.exhaustedCells}`);
	assert.equal(mFl.lostGasMass, 0, 'Fluorite-Salt should vent zero gas');
	assert.ok(mFl.massDrift < 1e-9, `fluorite massDrift ${mFl.massDrift}`);
	assert.ok(mFl.valueDrift < 1e-9, `fluorite valueDrift ${mFl.valueDrift}`);
});

function findCell(state, minIdx) {
	for (let r = 0; r < Lab.ROCK_H; r++) {
		for (let c = 0; c < Lab.ROCK_W; c++) {
			const idx = r * Lab.ROCK_W + c;
			if (state.rockSolid[idx] && state.rockMineral[idx] === minIdx) return idx;
		}
	}
	return -1;
}

function basinWithGrain(minIdx, mass) {
	const state = Lab.createSimulation({ scene: 'columns', model: 'table', seed: 37 });
	state.pumpOn = false;
	state.erosionOn = false;
	for (let k = 0; k < 30; k++) Lab.applyCursorTool(state, 12, 1.3, 'pour', 1 / 12);
	Lab.spawnDebrisGrain(state, 12, 1.05, minIdx, mass);
	return state;
}

function countDebris(state, minIdx) {
	let count = 0;
	for (let i = 0; i < state.debrisCount; i++) if (state.dMin[i] === minIdx) count++;
	return count;
}

test('saturation cap stalls dissolution until fresh water arrives', () => {
	const fresh = Lab.createSimulation({ scene: 'columns', model: 'table', seed: 37 });
	fresh.rigX = 3.2; fresh.rigY = 1.45; fresh.aimX = 1.42; fresh.aimY = 10.0; fresh.firing = true;
	stepFor(fresh, 3.0);
	const mFresh = Lab.measureMetrics(fresh);

	const stale = Lab.createSimulation({ scene: 'columns', model: 'table', seed: 37, satCap: 0.5 });
	stale.rigX = 3.2; stale.rigY = 1.45; stale.aimX = 1.42; stale.aimY = 10.0; stale.firing = true;
	stepFor(stale, 3.0);
	const mStale = Lab.measureMetrics(stale);

	assert.ok(mFresh.cellsDissolved >= 30, `fresh flow must cut, got ${mFresh.cellsDissolved}`);
	assert.ok(mStale.cellsDissolved < mFresh.cellsDissolved * 0.5, `stagnant brine must stall: stale ${mStale.cellsDissolved} vs fresh ${mFresh.cellsDissolved}`);
	assert.ok(mStale.waterHaliteMass + mStale.pumpedHaliteMass < (mFresh.waterHaliteMass + mFresh.pumpedHaliteMass) * 0.5, 'saturated brine must carry far less solute');
	// Unit check: a parcel loaded to capacity has zero saturation factor, fresh has one.
	const idx = Lab.fluidIndexAt(12, 1.0);
	stale.water[idx] = 1.0;
	stale.loads[idx * Lab.MINERAL_COUNT + Lab.MIN_HALITE] = stale.satCap;
	stale.loadTotal[idx] = stale.satCap;
	assert.ok(Lab.saturationFactor(stale, idx) < 1e-9, 'saturated parcel factor must be 0');
	const freshIdx = Lab.fluidIndexAt(20, 12.0);
	assert.equal(Lab.saturationFactor(stale, freshIdx), 1, 'fresh parcel factor must be 1');
	assert.ok(mStale.massDrift < 1e-9 && mStale.valueDrift < 1e-9);
});

test('submerged soluble grains dissolve at surface-area rate; Fluorite stops at its 45% floor', () => {
	const halite = basinWithGrain(Lab.MIN_HALITE, 0.55);
	stepFor(halite, 4.0);
	const mHal = Lab.measureMetrics(halite);
	assert.equal(mHal.debrisMass, 0, 'submerged Halite grain must fully dissolve');
	assert.ok(Math.abs(mHal.waterHaliteMass - 0.55) < 1e-9, `Halite brine must be 0.55, got ${mHal.waterHaliteMass}`);
	assert.ok(mHal.massDrift < 1e-11 && mHal.valueDrift < 1e-11, `grain drift ${mHal.massDrift}/${mHal.valueDrift}`);

	const fluorite = basinWithGrain(Lab.MIN_FLUORITE, 1.0);
	stepFor(fluorite, 8.0);
	const mFlu = Lab.measureMetrics(fluorite);
	assert.ok(Math.abs(mFlu.debrisMass - 0.45) < 1e-9, `Fluorite grain must stop at 45% floor, got ${mFlu.debrisMass}`);
	assert.ok(Math.abs(mFlu.waterFluoriteMass - 0.55) < 1e-9, `Fluorite brine must be 55%, got ${mFlu.waterFluoriteMass}`);
	assert.equal(mFlu.lostGasMass, 0, 'Fluorite grain must vent zero gas');
	assert.ok(mFlu.massDrift < 1e-11 && mFlu.valueDrift < 1e-11, `fluorite grain drift ${mFlu.massDrift}/${mFlu.valueDrift}`);

	const quartz = basinWithGrain(Lab.MIN_QUARTZ, 0.55);
	stepFor(quartz, 4.0);
	const mQz = Lab.measureMetrics(quartz);
	assert.ok(Math.abs(mQz.debrisMass - 0.55) < 1e-12, 'insoluble Quartz grain must never dissolve');
	assert.equal(mQz.waterSoluteMass, 0, 'insoluble grain must produce no brine');
});

test('debrisLimit collapse: weak skeletons detach, strong skeletons only leach', () => {
	const state = Lab.createSimulation({ scene: 'columns', model: 'table', seed: 37 });
	assert.equal(Lab.DEBRIS_LIMIT, 0.8);
	assert.ok(Lab.skeletonStrength(state, findCell(state, Lab.MIN_HALITE)) < 0.8, 'Halite skeleton collapses');
	assert.ok(Math.abs(Lab.skeletonStrength(state, findCell(state, Lab.MIN_FLUORITE)) - 1.35) < 1e-6, 'Fluorite skeleton is 45% x 3.0 J = 1.35 J');
	assert.ok(Lab.skeletonStrength(state, findCell(state, Lab.MIN_QUARTZ)) >= 0.8, 'Quartz skeleton stands');
	// Reference quotes from js/rock-materials.js calibration in the plan table.
	const priceOf = id => Lab.MINERALS.find(m => m.id === id).price;
	assert.equal(priceOf('vitriol'), 22.04);
	assert.equal(priceOf('halite'), 2.52);
	assert.equal(priceOf('fizzy'), 3.65);
	assert.equal(priceOf('fluorite'), 12.23);
	assert.equal(priceOf('gas'), 150.00);
	assert.equal(priceOf('gold'), 147.35);
	assert.equal(priceOf('quartz'), 5.21);
	assert.equal(priceOf('pure_gold'), 573.80);
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
	// Exact liberation split: 25% mass carrying 97.35% value (573.80/g), 75% Quartz carrying 2.65%.
	assert.ok(Math.abs(m.pureGoldValue / m.pureGoldMass - 573.80) < 1.0, `Pure Gold unit value must be ~573.80, got ${m.pureGoldValue / m.pureGoldMass}`);
	assert.ok(Math.abs(m.pureGoldMass - m.goldPanEvents * 0.55 * 0.25) < 1e-6, 'Pure Gold must be 25% of each liberated lump mass');
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

test('Mode B bound-B channels agree with Mode A stoichiometry at every octant center', () => {
	const out = {};
	const cubeCenters = [
		['LLL', 0.25, 0.25, 0.25], ['LLH', 0.25, 0.25, 0.75],
		['LHL', 0.25, 0.75, 0.25], ['LHH', 0.25, 0.75, 0.75],
		['HLL', 0.75, 0.25, 0.25], ['HLH', 0.75, 0.25, 0.75],
		['HHL', 0.75, 0.75, 0.25], ['HHH', 0.75, 0.75, 0.75]
	];
	for (const [name, r, g, b] of cubeCenters) {
		Lab.evaluateCompositionLaw(r, g, b, out);
		const total = out.halite + out.vitriol + out.gas + out.solid;
		assert.ok(Math.abs(total - 1) < 1e-9, `${name} channel mass ${total}`);
		assert.ok(out.halite >= 0 && out.vitriol >= 0 && out.gas >= 0 && out.solid >= 0, `${name} negative channel`);
		assert.ok(out.crystal >= 0 && out.crystal <= out.halite + 1e-9, `${name} crystal-bound B must stay green brine`);
		assert.ok(out.boundB + out.freeB >= 1 - 1e-9, `${name} bound-B and free-B must partition B`);
		assert.ok(out.gas <= out.freeB + 1e-9, `${name} bound-B must never vent`);
		assert.ok(out.speed >= 0, `${name} smooth reactivity gate must not create negative speed`);
	}

	const expected = [
		{ name: 'Blue Vitriol', rgb: [0.60, 0.21, 0.66], halite: 0, vitriol: 0.903, gas: 0.004, solid: 0.093 },
		{ name: 'Halite', rgb: [0.77, 0.82, 0.19], halite: 1, vitriol: 0, gas: 0, solid: 0 },
		{ name: 'Fluorite', rgb: [0.225, 0.325, 0.80], halite: 0.55, vitriol: 0, gas: 0, solid: 0.45 },
		{ name: 'Gas rock', rgb: [0.10, 0.10, 0.90], halite: 0, vitriol: 0, gas: 0.85, solid: 0.15 },
		{ name: 'Fizzy R2G2B2', rgb: [0.80, 0.80, 0.80], halite: 0.586, vitriol: 0.076, gas: 0.338, solid: 0 }
	];
	for (const e of expected) {
		Lab.evaluateCompositionLaw(...e.rgb, out);
		assert.ok(Math.abs(out.halite - e.halite) < 0.02, `${e.name} green brine ${out.halite}`);
		assert.ok(Math.abs(out.vitriol - e.vitriol) < 0.02, `${e.name} blue brine ${out.vitriol}`);
		assert.ok(Math.abs(out.gas - e.gas) < 0.02, `${e.name} gas ${out.gas}`);
		assert.ok(Math.abs(out.solid - e.solid) < 0.02, `${e.name} residue ${out.solid}`);
	}
	Lab.evaluateCompositionLaw(0.225, 0.325, 0.80, out);
	assert.ok(Math.abs(out.crystal - 0.55) < 1e-6, `Fluorite bound-B brine must be 55%, got ${out.crystal}`);
	const gasFrac = out.gas;
	assert.equal(gasFrac, 0, 'Fluorite bound-B must vent zero gas');

	for (const model of ['table', 'formula']) {
		const state = Lab.createSimulation({ scene: 'columns', model, seed: 37 });
		state.rigX = 7.17; state.rigY = 1.45;
		state.aimX = 7.17; state.aimY = 10.0; state.firing = true;
		stepFor(state, 3.0);
		const m = Lab.measureMetrics(state);
		assert.ok(m.waterFluoriteMass + m.pumpedFluoriteMass > 5.5, `${model} Fluorite green brine ${m.waterFluoriteMass + m.pumpedFluoriteMass}`);
		assert.equal(m.lostGasMass, 0, `${model} Fluorite must vent zero gas`);
		assert.ok(m.exhaustedCells > 0, `${model} Fluorite skeleton must stand exhausted`);
		assert.ok(m.massDrift < 1e-6 && m.valueDrift < 1e-6, `${model} Fluorite drift ${m.massDrift}/${m.valueDrift}`);
	}
});

test('Gas rock re-materialises as stone-quoted residue and books destroyed value into gas loss', () => {
	const state = basinWithGrain(Lab.MIN_GAS, 1.0);
	stepFor(state, 8.0);
	const m = Lab.measureMetrics(state);
	const stoneQuote = Lab.MINERALS[Lab.MIN_STONE].price;
	const gasQuote = Lab.MINERALS[Lab.MIN_GAS].price;
	assert.ok(Math.abs(m.debrisMass - 0.15) < 1e-9, `stone residue mass ${m.debrisMass}`);
	assert.ok(Math.abs(m.debrisValue - 0.15 * stoneQuote) < 1e-9, `stone residue value ${m.debrisValue}`);
	assert.ok(Math.abs(m.lostGasMass - 0.85) < 1e-9, `vented gas mass ${m.lostGasMass}`);
	assert.ok(Math.abs(m.lostGasValue - (gasQuote - 0.15 * stoneQuote)) < 1e-9, `destroyed gas value ${m.lostGasValue}`);
	assert.ok(countDebris(state, Lab.MIN_STONE) > 0, 'Gas residue must carry stone mineral identity');
	assert.ok(m.massDrift < 1e-9 && m.valueDrift < 1e-9, `gas ledger drift ${m.massDrift}/${m.valueDrift}`);
});

test('dynamic skeleton collapse releases Copper clasts from a Halite-cemented karst seam', () => {
	const state = Lab.createSimulation({ scene: 'karst', model: 'table', seed: 37 });
	state.rigX = 17.6; state.rigY = 1.45;
	state.aimX = 17.6; state.aimY = 10.5; state.firing = true;
	stepFor(state, 6.0);
	const m = Lab.measureMetrics(state);
	assert.ok(m.cellsDissolved > 0, `mixed seam must dissolve, got ${m.cellsDissolved}`);
	assert.ok(countDebris(state, Lab.MIN_COPPER) > 0, 'Halite-cemented Chalcopyrite must drop Copper clasts');
	assert.ok(m.massDrift < 1e-6 && m.valueDrift < 1e-6, `karst seam drift ${m.massDrift}/${m.valueDrift}`);

	// Static residue strength is above debrisLimit; only binder loss + jet damage
	// makes an inclusion seam collapse. A coherent Fluorite concentrate does not.
	const mixed = Lab.createSimulation({ scene: 'columns', model: 'table', seed: 37 });
	const idx = findCell(mixed, Lab.MIN_HALITE);
	const off = idx * 13;
	for (let m = 0; m < 13; m++) mixed.rockMix[off + m] = 0;
	mixed.rockMix[off + Lab.MIN_HALITE] = 0.75;
	mixed.rockMix[off + Lab.MIN_COPPER] = 0.25;
	const chem = {};
	Lab.evaluateCellChemistry(mixed, idx, chem);
	assert.equal(chem.undermined, true, 'different-mineral clasts in a soluble cement must be undermined');
	assert.ok(chem.remStrength > Lab.DEBRIS_LIMIT, `static 75/25 skeleton ${chem.remStrength} is not a static collapse`);
	const fluIdx = findCell(mixed, Lab.MIN_FLUORITE);
	Lab.evaluateCellChemistry(mixed, fluIdx, chem);
	assert.equal(chem.undermined, false, 'pure Fluorite concentrate must stay a coherent skeleton');
});

test('pump removes brine proportionally; fresh water is required to restore saturation', () => {
	const state = Lab.createSimulation({ scene: 'columns', model: 'table', seed: 37 });
	state.pumpOn = true; state.pumpRate = 0.1; state.firing = false;
	state.rigX = 12; state.rigY = 1.45;
	const idx = Lab.fluidIndexAt(12, 1.0);
	const off = idx * Lab.MINERAL_COUNT + Lab.MIN_HALITE;
	const quote = Lab.MINERALS[Lab.MIN_HALITE].price;
	const load = state.satCap * 1.5;
	state.water[idx] = 1;
	state.waterFlooded += 1;
	state.loads[off] = load;
	state.loadValues[off] = load * quote;
	state.loadTotal[idx] = load;
	state.totalReactedMass += load;
	state.totalReactedValue += load * quote;
	assert.equal(Lab.saturationFactor(state, idx), 0, 'saturated / overshot parcel must stall');
	assert.ok(Lab.measureMetrics(state).maxSaturation > 1.49, 'overshoot must be visible in maxSaturation');

	stepFor(state, 1 / 60);
	const pumped = Lab.measureMetrics(state);
	assert.ok(pumped.pumpedSoluteMass > 0, 'pump must extract dissolved brine');
	let water = 0, solute = 0;
	for (let i = 0; i < state.water.length; i++) { water += state.water[i]; solute += state.loadTotal[i]; }
	assert.ok(Math.abs(solute / water - load) < 1e-6, `pump must remove water and load together, ratio ${solute / water}`);
	assert.ok(pumped.maxSaturation > 1.0, 'pumping alone must not dilute the remaining brine');

	let loaded = -1, best = 0;
	for (let i = 0; i < state.loadTotal.length; i++) {
		if (state.loadTotal[i] > best) { best = state.loadTotal[i]; loaded = i; }
	}
	assert.ok(loaded >= 0, 'a loaded parcel must remain after one pump step');
	assert.ok(Lab.saturationFactor(state, loaded) < 1e-9, 'remaining brine must still be saturated');
	const fc = loaded % Lab.FLUID_W;
	const fr = Math.floor(loaded / Lab.FLUID_W);
	const x = (fc + 0.5) * (Lab.WORLD_W / Lab.FLUID_W);
	const y = (fr + 0.5) * (Lab.WORLD_H / Lab.FLUID_H);
	for (let k = 0; k < 3; k++) Lab.applyCursorTool(state, x, y, 'pour', 1.0);
	const recovered = Lab.measureMetrics(state);
	assert.ok(Lab.saturationFactor(state, loaded) > 0.85, `fresh water must restore saturation, got ${Lab.saturationFactor(state, loaded)}`);
	assert.ok(recovered.waterMass > pumped.waterMass + 10, 'fresh water must dilute the parcel');
	assert.ok(recovered.waterSoluteMass / recovered.waterMass < state.satCap * 0.5, 'global brine concentration must fall');
	assert.ok(recovered.massDrift < 1e-9 && recovered.valueDrift < 1e-9 && recovered.waterDrift < 1e-9,
		`pump/dilution drift ${recovered.massDrift}/${recovered.valueDrift}/${recovered.waterDrift}`);
});
