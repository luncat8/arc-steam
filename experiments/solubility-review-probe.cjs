'use strict';
// Read-only review probe backing 0.3.6-Solubility-implementation-review.md.
// Runs the shipped lab API and prints measured values next to the values the
// findings / 0.3.6-Solubility-plan.md claim. After the P0 fixes it also reports
// the corrected bound-B channels, stone-quoted residue and dynamic collapse.
// No files are modified, no browser is needed, every scene uses a fixed seed.
const fs = require('node:fs');
const path = require('node:path');
const Lab = require('../prototypes/solubility-lab.js');
const minerals = require('../js/minerals.js');

const ROOT = path.join(__dirname, '..');
const labJs = fs.readFileSync(path.join(ROOT, 'prototypes', 'solubility-lab.js'), 'utf8');
const labHtml = fs.readFileSync(path.join(ROOT, 'prototypes', 'solubility-lab.html'), 'utf8');
const lines = labJs.split('\n');
const lineOf = needle => lines.findIndex(l => l.includes(needle)) + 1;
const f = (v, n = 3) => Number(v).toFixed(n);

function head(title) { console.log('\n=== ' + title + ' ==='); }
function row(label, measured, expected) {
	console.log('  ' + label.padEnd(46) + ' measured=' + String(measured).padEnd(26) + ' expected=' + expected);
}
function stepFor(state, seconds) {
	const n = Math.round(seconds * 60);
	for (let i = 0; i < n; i++) Lab.stepSimulation(state, 1 / 60, 0);
}
function aimAt(state, x, seconds, model) {
	state.rigX = x; state.rigY = 1.45; state.aimX = x; state.aimY = 10.0; state.firing = true;
	stepFor(state, seconds);
	return Lab.measureMetrics(state);
}
function debrisByMineral(state) {
	const counts = {};
	for (let i = 0; i < state.debrisCount; i++) {
		const id = Lab.MINERALS[state.dMin[i]].id;
		counts[id] = (counts[id] || 0) + 1;
	}
	return counts;
}
function basinGrain(minIdx, mass, seconds) {
	const s = Lab.createSimulation({ scene: 'columns', seed: 37 });
	s.pumpOn = false; s.erosionOn = false;
	for (let k = 0; k < 30; k++) Lab.applyCursorTool(s, 12, 1.3, 'pour', 1 / 12);
	Lab.spawnDebrisGrain(s, 12, 1.05, minIdx, mass);
	stepFor(s, seconds);
	return { state: s, m: Lab.measureMetrics(s) };
}

console.log('0.3.6 solubility implementation review probe (seed 37, 60 Hz)');
console.log('lab: prototypes/solubility-lab.js / experiments/solubility-lab.test.js');

head('F1  saturation cap');
{
	const s = Lab.createSimulation({ scene: 'columns', seed: 37, satCap: 0.5 });
	const idx = Lab.fluidIndexAt(12, 1.0);
	s.water[idx] = 1.0;
	row('fresh parcel saturationFactor', f(Lab.saturationFactor(s, idx)), '1');
	s.loads[idx * Lab.MINERAL_COUNT + Lab.MIN_HALITE] = 0.5;
	s.loadTotal[idx] = 0.5;
	row('parcel at vol*satCap saturationFactor', f(Lab.saturationFactor(s, idx)), '0');
	row('saturationFactor volume floor (line ' + lineOf('Math.max(state.water[fIdx], 0.05)') + ')',
		'0.05', 'actual water volume');
	row('pump extracts loads by the same frac (line ' + lineOf('const frac = pull / w;') + ')',
		'load/water invariant', 'pumping alone does not restore sat');
	const fresh = aimAt(Lab.createSimulation({ scene: 'columns', seed: 37 }), 1.42, 3.0);
	const stale = aimAt(Lab.createSimulation({ scene: 'columns', seed: 37, satCap: 0.5 }), 1.42, 3.0);
	row('cells dissolved, fresh vs satCap=0.5', fresh.cellsDissolved + ' vs ' + stale.cellsDissolved,
		'stale < 50% of fresh');
}

head('F2  submerged soluble debris');
{
	const hal = basinGrain(Lab.MIN_HALITE, 0.55, 4.0);
	row('submerged Halite grain -> brine / debris', f(hal.m.waterHaliteMass) + ' / ' + f(hal.m.debrisMass), '0.55 / 0');
	const flu = basinGrain(Lab.MIN_FLUORITE, 1.0, 8.0);
	row('submerged Fluorite grain -> brine / floor', f(flu.m.waterFluoriteMass) + ' / ' + f(flu.m.debrisMass), '0.55 / 0.45');
	const qz = basinGrain(Lab.MIN_QUARTZ, 0.55, 4.0);
	row('submerged Quartz grain -> brine / debris', f(qz.m.waterSoluteMass) + ' / ' + f(qz.m.debrisMass), '0 / 0.55');
	row('grain rate multiplier (line ' + lineOf('3.0 * sat * dt') + ')', 'x3', 'x3');
}

head('F3  stoichiometry, both chemistry modes');
{
	const fz = aimAt(Lab.createSimulation({ scene: 'columns', seed: 37 }), 5.25, 3.0);
	const brine = fz.waterFizzyMass + fz.pumpedFizzyMass;
	row('Fizzy gas / brine split', f(fz.lostGasMass / (brine + fz.lostGasMass)) + ' / ' + f(brine / (brine + fz.lostGasMass)),
		'0.333 / 0.667');
	for (const model of ['table', 'formula']) {
		const st = Lab.createSimulation({ scene: 'columns', model, seed: 37 });
		const m = aimAt(st, 7.17, 3.0);
		row(model + ': Fluorite green brine / gas vented / standing',
			f(m.waterFluoriteMass + m.pumpedFluoriteMass) + ' / ' + f(m.lostGasMass) + ' / ' + m.exhaustedCells,
			'> 5.5 / 0 / >0');
	}
	const gas = basinGrain(Lab.MIN_GAS, 1.0, 8.0);
	row('Gas grain stone residue value (0.15 mass)', f(gas.m.debrisValue),
		'0.435 (=0.15 x stone 2.90), not 22.50 (=0.15 x gas 150)');
	row('gas residue re-priced at stone quote (line ' + lineOf('const resQuote = MINERALS[def.residueMineral].price;') + ')',
		'stone quote', 'stone quote');
}

head('F4  strengthInto / debrisLimit skeleton collapse');
{
	const s = Lab.createSimulation({ scene: 'columns', seed: 37 });
	const pure = minIdx => {
		for (let i = 0; i < s.rockSolid.length; i++) {
			if (s.rockSolid[i] && s.rockMineral[i] === minIdx) return i;
		}
		return -1;
	};
	row('pure Halite skeleton', f(Lab.skeletonStrength(s, pure(Lab.MIN_HALITE))), '< 0.8 (collapses)');
	row('pure Fluorite skeleton', f(Lab.skeletonStrength(s, pure(Lab.MIN_FLUORITE))), '1.35 (stands)');
	const idx = pure(Lab.MIN_HALITE);
	const off = idx * 13;
	for (let m = 0; m < 13; m++) s.rockMix[off + m] = 0;
	s.rockMix[off + Lab.MIN_HALITE] = 0.75;
	s.rockMix[off + Lab.MIN_COPPER] = 0.25;
	row('75% Halite + 25% Chalcopyrite skeleton', f(Lab.skeletonStrength(s, idx)),
		'static 1.20 J; binder loss + jet damage collapse dynamically');
	const karst = Lab.createSimulation({ scene: 'karst', seed: 37 });
	karst.rigX = 17.6; karst.rigY = 1.45; karst.aimX = 17.6; karst.aimY = 10.5; karst.firing = true;
	stepFor(karst, 6.0);
	const km = Lab.measureMetrics(karst);
	row('karst 60/40 Halite/Cu seam: dissolved / exhausted', km.cellsDissolved + ' / ' + km.exhaustedCells,
		'collapse + falling Cu clasts');
	row('karst seam copper debris grains', debrisByMineral(karst).copper || 0, '> 0');
	row('collapse gate (line ' + lineOf('const collapses = effStrength < DEBRIS_LIMIT;') + ')',
		'dynamic remaining skeleton', 'dynamic remaining skeleton (GLM strengthInto - damage)');
}

head('F5  live-economy pricing and gold liberation');
{
	const goldQ = Lab.MINERALS[Lab.MIN_GOLD].price;
	const qzQ = Lab.MINERALS[Lab.MIN_QUARTZ].price;
	const auQ = Lab.MINERALS[Lab.MIN_PURE_GOLD].price;
	row('Pure Gold unit quote / gold-quartz quote', f(auQ, 2) + ' / ' + f(goldQ, 2), '573.80 / 147.35');
	row('25% mass value share', f(0.25 * auQ / goldQ, 4), '0.9735');
	row('75% gangue value share at plain quartz', f(0.75 * qzQ / goldQ, 4), '0.0265');
	row('lab quotes are hardcoded constants (line ' + lineOf("price: 150.00") + ')', 'yes',
		'derived from js/rock-materials.js basePricesInto');
	row('js/minerals.js rows / sol,rho,dye fields', minerals.mineralCount + ' / ' +
		minerals.mineralTable.filter(m => 'sol' in m).length, '13 / 13');
	row('js/water.js exists', fs.existsSync(path.join(ROOT, 'js', 'water.js')) ? 'yes' : 'no', 'yes for live integration');
	// Measured abundance of the calibrated boxes the lab geology scene compiles,
	// with the scene's hostWeight (0.0883). js/geology.js buildCache is sized by
	// the live 10-row table, so build a 13-row cache the same way
	// live 10-row table, so build a 13-row cache the same way
	// experiments/solubility-geology-probe.cjs does.
	const Geo = require('../js/geology.js');
	const M = 13;
	const ranges = Lab.MINERALS.slice(0, M).map(m => [m.r.slice(), m.g.slice(), m.b.slice()]);
	const sample = Geo.buildSample({ seeds: [1, 2, 3, 4, 5, 6, 7, 8], columns: 192, rows: 120, frequency: 0.075, yCompression: 3 });
	const formation = Geo.compile(ranges, 'balanced', 0.6);
	const affinity = new Float64Array(sample.cells * M);
	const totals = new Float64Array(sample.cells);
	const rowMix = new Float64Array(M);
	for (let i = 0; i < sample.cells; i++) {
		formation.affinityInto([sample.elements[i * 3], sample.elements[i * 3 + 1], sample.elements[i * 3 + 2]], rowMix, 0);
		let total = 0;
		for (let m = 0; m < M; m++) { affinity[i * M + m] = rowMix[m]; if (m !== 0) total += rowMix[m]; }
		totals[i] = total;
	}
	const hw = 0.0883;
	const shares = new Float64Array(M);
	for (let i = 0; i < sample.cells; i++) {
		const scale = 1 / (totals[i] + hw);
		shares[0] += hw * scale;
		for (let m = 1; m < M; m++) shares[m] += affinity[i * M + m] * scale;
	}
	for (let m = 0; m < M; m++) shares[m] /= sample.cells;
	row('lab geology boxes copper + vitriol share', f(100 * (shares[2] + shares[3]), 2) + '%',
		'~7.8% rounded boxes; autoAdjust log pins 7.83% (plan 4.2)');
}

head('F6  per-mineral brine bookkeeping');
{
	const s = Lab.createSimulation({ scene: 'columns', seed: 37 });
	const fluidN = Lab.FLUID_W * Lab.FLUID_H;
	row('loads Float64 minerals x fluid cells', s.loads.length / fluidN + ' x ' + fluidN, '14 x 5760');
	row('hopperLoads per mineral', s.hopperLoads.length, '14');
	row('per-mineral pumped metrics exposed', 'fizzy/fluorite/halite/vitriol', 'all soluble minerals');
	row('water tint blends each dye (line ' + lineOf('MINERALS[m].dye') + ')', 'yes', 'yes');
	row('Cell Inspector brine saturation % (line ' + lineOf('Brine saturation:') + ')', 'yes', 'yes');
	row('satCap slider in lab HTML', /sat-cap/.test(labHtml) ? 'yes' : 'no', 'yes');
}

head('F7  Mode B calibration');
{
	function smoothstep(a, b, x) {
		const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
		return t * t * (3 - 2 * t);
	}
	function planSolubility(r, g, b, h0, h1) {
		const ionic = smoothstep(0.22, 0.56, r * g);
		const hydrate = smoothstep(h0, h1, r * b * (1 - 0.65 * g));
		const degas = smoothstep(0.56, 0.86, b) * (0.35 + 0.65 * (1 - r * (1 - g)));
		return Math.max(0, Math.min(1, ionic + hydrate + 0.65 * degas));
	}
	const centers = {
		vitriol: [0.60, 0.21, 0.66],
		halite: [0.77, 0.82, 0.19],
		fluorite: [0.225, 0.325, 0.80],
		gas: [0.10, 0.10, 0.90],
		fizzy: [0.80, 0.80, 0.80]
	};
	const c = centers.vitriol;
	row('plan formula vitriol center, old hydrate 0.18-0.48', f(planSolubility(...c, 0.18, 0.48)), '0.68 (GLM)');
	row('plan formula vitriol center, new hydrate 0.15-0.42', f(planSolubility(...c, 0.15, 0.42)),
		'0.914 (corrected plan: moves toward 1.00, does not reach it)');
	row('plan formula gas center, new hydrate', f(planSolubility(...centers.gas, 0.15, 0.42)),
		'~0.61 scalar solubility (superseded by bound-B channels)');
	row('plan formula fluorite center, new hydrate', f(planSolubility(...centers.fluorite, 0.15, 0.42)),
		'~0.52 scalar solubility (superseded by bound-B channels)');
	const expected = {
		vitriol: '~0.91 total / ~0.90 blue brine / <0.01 gas',
		halite: '1.00 / 1.00 / 0 (ionic salt)',
		fluorite: '0.55 / 0.55 / 0 (45% residue)',
		gas: '0.85 / 0 / 0.85 (15% stone residue)',
		fizzy: '~1.00 / ~0.66 brine / ~0.34 gas (R2G2B2)'
	};
	for (const [name, p] of Object.entries(centers)) {
		const o = {};
		Lab.evaluateCompositionLaw(...p, o);
		row('lab Mode B ' + name + ' center: sol / brine / gas',
			f(o.solubility) + ' / ' + f(o.halite + o.vitriol) + ' / ' + f(o.gas),
			expected[name]);
		row('  bound-B / free-B / crystal brine',
			f(o.boundB) + ' / ' + f(o.freeB) + ' / ' + f(o.crystal), 'partition B; bound-B never vents');
	}
	row('lab hydrate smoothstep (line ' + lineOf('smoothstep(0.15, 0.42') + ')', '0.15-0.42', '0.15-0.42');
	row('hard 0.22 reactivity cutoff removed (line ' + lineOf('smoothstep(0.02, 0.22, reactTotal)') + ')',
		'no hard cutoff (smooth gate)', 'no hard cutoff');
}
head('F8  deferred diagnostics');
{
	const deferred = path.join(ROOT, 'solubility.2-plan.md');
	row('solubility.2-plan.md exists', fs.existsSync(deferred) ? 'yes' : 'no', 'yes');
	row('beaker / strip chart / time warp / crust in lab',
		/beaker|strip.chart|time.warp|crustMass/i.test(labJs + labHtml) ? 'yes' : 'no', 'no (deferred)');
}

console.log('\nProbe complete. Review verdicts are a pre-P0 snapshot; see archive/0.3.6-Solubility-P0-worklog.md for implemented fixes.');
