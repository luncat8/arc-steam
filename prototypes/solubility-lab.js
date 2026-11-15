/* 0.3.6 — Solubility & Hydro-Erosion Lab
 * Standalone browser + Node simulation implementing the 3-element (R, G, B)
 * solubility model, incongruent decomposition, gas loss, and separate
 * bedload hydro-erosion / gold placer panning on top of the Hybrid 2D fluid solver.
 */
(function (root) {
	'use strict';

	const SteamGeology = root.SteamGeology || (typeof require === 'function' ? require('../js/geology.js') : null);
	const SteamMinerals = root.SteamMinerals || (typeof require === 'function' ? require('../js/minerals.js') : null);

	// World & grid dimensions (matches arc-steam cell scale: 0.125 m rock, 0.25 m fluid)
	const WORLD_W = 24.0;
	const WORLD_H = 15.0;
	const ROCK_W = 192;
	const ROCK_H = 120;
	const ROCK_CELL = WORLD_W / ROCK_W; // 0.125 m
	const ROCK_N = ROCK_W * ROCK_H;

	const FLUID_W = 96;
	const FLUID_H = 60;
	const FLUID_CELL = WORLD_W / FLUID_W; // 0.25 m
	const FLUID_N = FLUID_W * FLUID_H;

	const GRAVITY = 12.5;
	const MAX_JETS = 1200;
	const MAX_BUBBLES = 500;
	const MAX_DEBRIS = 1500;
	const MAX_FX = 220;

	const DEBRIS_NONE = 0;
	const DEBRIS_FALLING = 1;
	const DEBRIS_RESTING = 2;
	const DEBRIS_ENTRAINED = 3;

	// 13-mineral geological table (10 baseline with Copper split into dry Chalcopyrite +
	// hydrated Blue Vitriol, plus Halite & Fizzy Halite in empty HHL / HHH octants) +
	// index 13 for liberated Pure Gold concentrate (debris-only phase).
	const MINERALS = [
		{
			id: 'stone', name: 'Stone', symbol: 'St', analog: 'host rock',
			octant: 'Host (any)', r: [0, 1], g: [0, 1], b: [0, 1],
			repRgb: [0.35, 0.35, 0.35],
			color: [114, 124, 132], strength: 4.2, density: 2.8, price: 0.20,
			solHalite: 0, solVitriol: 0, gasLoss: 0, dissolveSpeed: 0,
			residueMineral: 0, erodibility: 0.45, tag: 'solid',
			reactionLabel: 'Insoluble host', tintLabel: '—',
			erosionLabel: 'Moderate bedload'
		},
		{
			id: 'iron', name: 'Iron ore', symbol: 'Fe', analog: 'Fe₂O₃',
			octant: 'HLL (R↑ G↓ B↓)', r: [0.28, 0.99], g: [0.00, 0.54], b: [0.00, 0.63],
			repRgb: [0.76, 0.22, 0.20],
			color: [184, 91, 64], strength: 5.4, density: 5.2, price: 1.20,
			solHalite: 0, solVitriol: 0, gasLoss: 0, dissolveSpeed: 0,
			residueMineral: 1, erodibility: 0.14, tag: 'solid',
			reactionLabel: 'Insoluble dense oxide', tintLabel: '—',
			erosionLabel: 'Heavy — resists current'
		},
		{
			id: 'copper', name: 'Chalcopyrite', symbol: 'Cu', analog: 'CuFeS₂ (dry Cu)',
			octant: 'HLL (R↑ G↓ B↓)', r: [0.31, 0.79], g: [0.02, 0.38], b: [0.18, 0.46],
			repRgb: [0.60, 0.20, 0.30],
			color: [198, 130, 64], strength: 4.8, density: 4.8, price: 2.60,
			solHalite: 0, solVitriol: 0, gasLoss: 0, dissolveSpeed: 0,
			residueMineral: 2, erodibility: 0.16, tag: 'solid',
			reactionLabel: 'Insoluble dry sulfide', tintLabel: '—',
			erosionLabel: 'Heavy — drops as clasts'
		},
		{
			id: 'vitriol', name: 'Blue Vitriol', symbol: 'Cu·H₂O', analog: 'CuSO₄·5H₂O',
			octant: 'HLH (R↑ G↓ B↑)', r: [0.42, 0.78], g: [0.06, 0.36], b: [0.54, 0.78],
			repRgb: [0.62, 0.22, 0.68],
			color: [44, 152, 240], strength: 1.8, density: 2.3, price: 3.40,
			solHalite: 0, solVitriol: 1.0, gasLoss: 0, dissolveSpeed: 1.25,
			residueMineral: 0, erodibility: 0.35, tag: 'blue',
			reactionLabel: '100% Full Dissolution', tintLabel: 'Cobalt Blue (+GB)',
			erosionLabel: 'Dissolves → pumped'
		},
		{
			id: 'quartz', name: 'Quartz', symbol: 'Qz', analog: 'SiO₂',
			octant: 'LHL (R↓ G↑ B↓)', r: [0.00, 0.48], g: [0.23, 0.87], b: [0.00, 0.56],
			repRgb: [0.18, 0.64, 0.24],
			color: [212, 210, 224], strength: 6.0, density: 2.6, price: 0.90,
			solHalite: 0, solVitriol: 0, gasLoss: 0, dissolveSpeed: 0,
			residueMineral: 4, erodibility: 0.68, tag: 'erode',
			reactionLabel: 'Insoluble hard crystal', tintLabel: '—',
			erosionLabel: 'Light — hops downstream'
		},
		{
			id: 'corundum', name: 'Corundum', symbol: 'Al', analog: 'Al₂O₃',
			octant: 'LHL (R↓ G↑↑ B↓)', r: [0.10, 0.40], g: [0.70, 0.95], b: [0.05, 0.30],
			repRgb: [0.24, 0.86, 0.16],
			color: [216, 74, 128], strength: 7.8, density: 4.0, price: 5.20,
			solHalite: 0, solVitriol: 0, gasLoss: 0, dissolveSpeed: 0,
			residueMineral: 5, erodibility: 0.18, tag: 'solid',
			reactionLabel: 'Insoluble ultra-hard', tintLabel: '—',
			erosionLabel: 'Dense — resists wash'
		},
		{
			id: 'fluorite', name: 'Fluorite-Salt', symbol: 'CaF₂', analog: 'CaF₂·NaCl',
			octant: 'LLH/LHH (R↓ G· B↑)', r: [0.07, 0.38], g: [0.11, 0.54], b: [0.62, 0.98],
			repRgb: [0.26, 0.44, 0.78],
			color: [108, 182, 152], strength: 3.0, density: 3.1, price: 2.20,
			solHalite: 0.55, solVitriol: 0, gasLoss: 0, dissolveSpeed: 0.88,
			residueMineral: 4, erodibility: 0.40, tag: 'split',
			reactionLabel: 'Split: 55% Brine + 45% Qz debris', tintLabel: 'Brine Green (+G)',
			erosionLabel: 'Drops solid Qz residue'
		},
		{
			id: 'silver', name: 'Silver', symbol: 'Ag', analog: 'Ag',
			octant: 'HLL (R↑↑ G· B↓)', r: [0.67, 0.96], g: [0.26, 0.55], b: [0.04, 0.33],
			repRgb: [0.84, 0.38, 0.16],
			color: [208, 220, 232], strength: 3.5, density: 10.5, price: 7.50,
			solHalite: 0, solVitriol: 0, gasLoss: 0, dissolveSpeed: 0,
			residueMineral: 7, erodibility: 0.05, tag: 'solid',
			reactionLabel: 'Insoluble native metal', tintLabel: '—',
			erosionLabel: 'Ultra-heavy — stays put'
		},
		{
			id: 'gold', name: 'Gold-quartz', symbol: 'Au', analog: 'Au in SiO₂',
			octant: 'HLH edge (R↑↑ G↓ B·)', r: [0.82, 0.98], g: [0.06, 0.26], b: [0.42, 0.66],
			repRgb: [0.90, 0.16, 0.54],
			color: [232, 198, 92], strength: 3.4, density: 5.6, price: 18.00,
			solHalite: 0, solVitriol: 0, gasLoss: 0, dissolveSpeed: 0,
			residueMineral: 8, erodibility: 0.22, tag: 'gold',
			reactionLabel: 'Insoluble ore (pannable)', tintLabel: '—',
			erosionLabel: 'Pans → Au stays, Qz washes'
		},
		{
			id: 'gas', name: 'Gas rock', symbol: 'Gb', analog: 'CH₄ / H₂',
			octant: 'LLH (R↓ G↓ B↑↑)', r: [0.00, 0.20], g: [0.00, 0.20], b: [0.80, 1.00],
			repRgb: [0.10, 0.12, 0.92],
			color: [172, 218, 94], strength: 0.8, density: 1.2, price: 24.00,
			solHalite: 0, solVitriol: 0, gasLoss: 0.85, dissolveSpeed: 1.45,
			residueMineral: 0, erodibility: 0.50, tag: 'gas',
			reactionLabel: 'Wet Degas: 85% Gas LOST!', tintLabel: 'Rising Bubbles (LOSS)',
			erosionLabel: '15% Stone residue falls'
		},
		{
			id: 'sand', name: 'Sand', symbol: 'Sd', analog: 'SiO₂ loose',
			octant: 'LLL/LHL (R↓ G· B·)', r: [0.02, 0.38], g: [0.28, 0.68], b: [0.25, 0.55],
			repRgb: [0.20, 0.48, 0.40],
			color: [204, 178, 126], strength: 0.5, density: 1.6, price: 0.15,
			solHalite: 0, solVitriol: 0, gasLoss: 0, dissolveSpeed: 0,
			residueMineral: 10, erodibility: 1.00, tag: 'erode',
			reactionLabel: 'Insoluble loose grains', tintLabel: '—',
			erosionLabel: 'Fastest washout & hops'
		},
		{
			id: 'halite', name: 'Halite', symbol: 'NaCl', analog: 'NaCl (R·G salt)',
			octant: 'HHL (R↑ G↑ B↓)', r: [0.62, 0.92], g: [0.68, 0.96], b: [0.04, 0.34],
			repRgb: [0.78, 0.82, 0.18],
			color: [110, 228, 148], strength: 1.6, density: 2.2, price: 1.80,
			solHalite: 1.0, solVitriol: 0, gasLoss: 0, dissolveSpeed: 1.65,
			residueMineral: 0, erodibility: 0.35, tag: 'green',
			reactionLabel: '100% Full Dissolution', tintLabel: 'Emerald Green (+G)',
			erosionLabel: 'Dissolves fastest → pumped'
		},
		{
			id: 'fizzy', name: 'Fizzy Halite', symbol: 'R₂G₃B', analog: 'R₂G₃B gas-salt',
			octant: 'HHH (R↑ G↑ B↑)', r: [0.64, 0.94], g: [0.68, 0.96], b: [0.68, 0.96],
			repRgb: [0.78, 0.82, 0.84],
			color: [174, 242, 184], strength: 1.3, density: 1.9, price: 9.60,
			solHalite: 0.65, solVitriol: 0, gasLoss: 0.35, dissolveSpeed: 1.50,
			residueMineral: 0, erodibility: 0.35, tag: 'gas',
			reactionLabel: 'Split: 65% Brine + 35% Gas LOST!', tintLabel: 'Mint Green + Bubbles',
			erosionLabel: 'Salt pumped, Gas lost!'
		},
		{
			id: 'pure_gold', name: 'Pure Gold', symbol: 'Au*', analog: 'Au placer nugget',
			octant: 'Placer concentrate', r: [0.95, 1.0], g: [0.0, 0.1], b: [0.0, 0.1],
			repRgb: [0.98, 0.05, 0.05],
			color: [255, 215, 36], strength: 3.4, density: 19.3, price: 66.24,
			solHalite: 0, solVitriol: 0, gasLoss: 0, dissolveSpeed: 0,
			residueMineral: 13, erodibility: 0.01, tag: 'gold',
			reactionLabel: 'Liberated from Gold-Qz', tintLabel: '—',
			erosionLabel: 'Stays put (ρ=19.3!)',
			debrisOnly: true
		}
	];

	const GEO_MINERAL_COUNT = 13; // indices 0..12 participate in geology generation
	const MIN_STONE = 0;
	const MIN_IRON = 1;
	const MIN_COPPER = 2;
	const MIN_VITRIOL = 3;
	const MIN_QUARTZ = 4;
	const MIN_CORUNDUM = 5;
	const MIN_FLUORITE = 6;
	const MIN_SILVER = 7;
	const MIN_GOLD = 8;
	const MIN_GAS = 9;
	const MIN_SAND = 10;
	const MIN_HALITE = 11;
	const MIN_FIZZY = 12;
	const MIN_PURE_GOLD = 13;

	const GEO_RANGES = MINERALS.slice(0, GEO_MINERAL_COUNT).map(function (m) {
		return [m.r, m.g, m.b];
	});
	const COMPILED_GEO = SteamGeology ? SteamGeology.compile(GEO_RANGES, 'balanced', 0.6) : null;

	// Column layout for Scene 1 (12 distinct mineral test seams across 24 m)
	const TEST_COLUMNS = [
		MIN_HALITE, MIN_VITRIOL, MIN_FIZZY, MIN_FLUORITE,
		MIN_GAS, MIN_COPPER, MIN_QUARTZ, MIN_IRON,
		MIN_CORUNDUM, MIN_SAND, MIN_GOLD, MIN_STONE
	];

	function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
	function smoothstep(e0, e1, x) {
		const t = clamp((x - e0) / (e1 - e0), 0, 1);
		return t * t * (3 - 2 * t);
	}

	// Deterministic PRNG (Mulberry32) so tests and scenes are 100% reproducible
	function createRng(seed) {
		let a = (seed >>> 0) || 1;
		return function next() {
			a |= 0;
			a = (a + 0x6d2b79f5) | 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	// Continuous composition law f(R, G, B) -> { halite, vitriol, gas, solid, speed, density }
	// Writes into preallocated `out` object to avoid hot-path allocations.
	function evaluateCompositionLaw(r, g, b, out) {
		const ionic = smoothstep(0.22, 0.56, r * g);
		const hydrate = smoothstep(0.18, 0.48, r * b * (1.0 - 0.65 * g));
		const degasRaw = smoothstep(0.56, 0.86, b) * (0.35 + 0.65 * (1.0 - r * (1.0 - g)));

		// Normalize reactive fractions so halite + vitriol + gas <= 1.0
		let fHal = ionic * (1.0 - 0.35 * degasRaw);
		let fVit = hydrate * (1.0 - 0.45 * ionic);
		let fGas = degasRaw * (0.42 + 0.48 * (1.0 - r));
		const reactSum = fHal + fVit + fGas;
		if (reactSum > 1.0) {
			const inv = 1.0 / reactSum;
			fHal *= inv;
			fVit *= inv;
			fGas *= inv;
		}
		const fSolid = Math.max(0, 1.0 - fHal - fVit - fGas);
		const reactTotal = fHal + fVit + fGas;
		const speed = reactTotal >= 0.22 ? (0.45 + 1.25 * reactTotal) : 0;
		const density = clamp(2.0 + 7.5 * r * r - 0.8 * b, 1.2, 11.5);

		out.halite = reactTotal >= 0.22 ? fHal : 0;
		out.vitriol = reactTotal >= 0.22 ? fVit : 0;
		out.gas = reactTotal >= 0.22 ? fGas : 0;
		out.solid = reactTotal >= 0.22 ? fSolid : 1.0;
		out.speed = speed;
		out.solubility = reactTotal >= 0.22 ? reactTotal : 0;
		out.density = density;
		return out;
	}

	// Evaluate one rock cell's dissolution & value split under active model ('table' | 'formula').
	// Guarantees exact mass & value partition: halite + vitriol + gas + solid === 1.0
	function evaluateCellChemistry(state, idx, out) {
		const domMin = state.rockMineral[idx];
		const baseVal = state.rockValue[idx];

		if (state.model === 'formula') {
			evaluateCompositionLaw(state.rockR[idx], state.rockG[idx], state.rockB[idx], out);
			// Partition base value proportionally, pricing gas share at higher volatile weight
			const gasWeight = out.gas * 3.2;
			const vitWeight = out.vitriol * 1.4;
			const halWeight = out.halite * 0.9;
			const solWeight = out.solid * 1.0;
			const wSum = gasWeight + vitWeight + halWeight + solWeight;
			const invW = wSum > 0 ? baseVal / wSum : 0;
			out.valHalite = halWeight * invW;
			out.valVitriol = vitWeight * invW;
			out.valGas = gasWeight * invW;
			out.valSolid = baseVal - out.valHalite - out.valVitriol - out.valGas;
			if (out.valSolid < 0) out.valSolid = 0;
			out.residueMineral = MINERALS[domMin].residueMineral;
			return out;
		}

		// Mode A: Mixture-weighted Mineral Table (13)
		const baseOffset = idx * GEO_MINERAL_COUNT;
		let fHal = 0, fVit = 0, fGas = 0, speedSum = 0;
		let vHal = 0, vVit = 0, vGas = 0;
		let bestResWeight = -1;
		let bestResMin = MIN_STONE;

		for (let m = 0; m < GEO_MINERAL_COUNT; m++) {
			const w = state.rockMix[baseOffset + m];
			if (w <= 0.0001) continue;
			const def = MINERALS[m];
			const mHal = w * def.solHalite;
			const mVit = w * def.solVitriol;
			const mGas = w * def.gasLoss;
			const mSol = w * (1.0 - def.solHalite - def.solVitriol - def.gasLoss);
			fHal += mHal;
			fVit += mVit;
			fGas += mGas;
			speedSum += w * def.dissolveSpeed;

			const mVal = w * def.price;
			if (m === MIN_FIZZY) {
				// Fizzy Halite (9.60 cr): 65% Halite worth 1.17 cr + 35% Gas worth 8.43 cr
				const hShare = w * 0.65 * MINERALS[MIN_HALITE].price;
				vHal += hShare;
				vGas += mVal - hShare;
			} else if (m === MIN_GAS) {
				const sShare = w * 0.15 * MINERALS[MIN_STONE].price;
				vGas += mVal - sShare;
			} else if (m === MIN_FLUORITE) {
				const hShare = w * 0.55 * MINERALS[MIN_HALITE].price;
				vHal += Math.min(mVal, hShare);
			} else {
				vHal += mVal * def.solHalite;
				vVit += mVal * def.solVitriol;
				vGas += mVal * def.gasLoss;
			}

			if (mSol > bestResWeight) {
				bestResWeight = mSol;
				bestResMin = def.residueMineral;
			}
		}

		const react = fHal + fVit + fGas;
		if (react < 0.22) {
			out.halite = 0;
			out.vitriol = 0;
			out.gas = 0;
			out.solid = 1.0;
			out.solubility = 0;
			out.speed = 0;
			out.valHalite = 0;
			out.valVitriol = 0;
			out.valGas = 0;
			out.valSolid = baseVal;
			out.residueMineral = MINERALS[domMin].residueMineral;
			out.density = MINERALS[domMin].density;
			return out;
		}

		const fSolid = Math.max(0, 1.0 - react);
		// Exact value conservation against rockValue[idx]
		const vReact = vHal + vVit + vGas;
		if (vReact > baseVal && vReact > 0) {
			const s = baseVal / vReact;
			vHal *= s;
			vVit *= s;
			vGas *= s;
		}
		out.halite = fHal;
		out.vitriol = fVit;
		out.gas = fGas;
		out.solid = fSolid;
		out.solubility = react;
		out.speed = speedSum;
		out.valHalite = vHal;
		out.valVitriol = vVit;
		out.valGas = vGas;
		out.valSolid = Math.max(0, baseVal - vHal - vVit - vGas);
		out.residueMineral = bestResMin;
		out.density = MINERALS[domMin].density;
		return out;
	}

	function createSimulation(options) {
		const opts = options || {};
		const state = {
			scene: opts.scene || 'columns',
			model: opts.model || 'table', // 'table' | 'formula'
			viewMode: opts.viewMode || 'natural', // 'natural' | 'solubility' | 'elements'
			tool: 'gun',
			seed: opts.seed || 37,
			paused: false,
			time: 0,
			stepCount: 0,
			rng: createRng(opts.seed || 37),

			// Controls
			pumpOn: true,
			autoFire: false,
			erosionOn: true,
			dissolveRate: 1.2,
			mechForce: 0.15,
			erosionPower: 1.2,
			pumpRate: 0.9,
			jetSpeed: 16.5,
			jetFlow: 1.0,
			demoSweepTimer: 0,

			// Platform & aiming
			rigX: 12.0,
			rigY: 1.35,
			rigHalfW: 1.55,
			rigVx: 0,
			aimX: 6.0,
			aimY: 10.5,
			firing: false,
			fireCarry: 0,
			pumpCarry: 0,
			highlightMineral: -1,

			// Rock grid (192 x 120)
			rockSolid: new Uint8Array(ROCK_N),
			rockMineral: new Uint8Array(ROCK_N),
			rockR: new Float32Array(ROCK_N),
			rockG: new Float32Array(ROCK_N),
			rockB: new Float32Array(ROCK_N),
			rockMix: new Float32Array(ROCK_N * GEO_MINERAL_COUNT),
			rockDissolve: new Float32Array(ROCK_N),
			rockMechHp: new Float32Array(ROCK_N),
			rockMechMax: new Float32Array(ROCK_N),
			rockValue: new Float64Array(ROCK_N),
			rockDirty: true,

			// Hybrid fluid grid (96 x 60) — Float64 for exact machine-precision conservation!
			solidMask: new Uint8Array(FLUID_N),
			water: new Float64Array(FLUID_N),
			waterNext: new Float64Array(FLUID_N),
			velU: new Float32Array(FLUID_N),
			velV: new Float32Array(FLUID_N),
			solHalite: new Float64Array(FLUID_N),
			solHaliteNext: new Float64Array(FLUID_N),
			solVitriol: new Float64Array(FLUID_N),
			solVitriolNext: new Float64Array(FLUID_N),
			solValHal: new Float64Array(FLUID_N),
			solValHalNext: new Float64Array(FLUID_N),
			solValVit: new Float64Array(FLUID_N),
			solValVitNext: new Float64Array(FLUID_N),
			fluidAlpha: new Float32Array(FLUID_N),

			// Ballistic jet / cascade droplet pool
			jetCount: 0,
			jx: new Float32Array(MAX_JETS),
			jy: new Float32Array(MAX_JETS),
			jvx: new Float32Array(MAX_JETS),
			jvy: new Float32Array(MAX_JETS),
			jMass: new Float64Array(MAX_JETS),
			jHalite: new Float64Array(MAX_JETS),
			jVitriol: new Float64Array(MAX_JETS),
			jValHal: new Float64Array(MAX_JETS),
			jValVit: new Float64Array(MAX_JETS),
			jKind: new Uint8Array(MAX_JETS), // 0 = fresh gun jet, 1 = cascade drip

			// Rising gas bubble pool
			bubbleCount: 0,
			bx: new Float32Array(MAX_BUBBLES),
			by: new Float32Array(MAX_BUBBLES),
			bvx: new Float32Array(MAX_BUBBLES),
			bvy: new Float32Array(MAX_BUBBLES),
			bRad: new Float32Array(MAX_BUBBLES),
			bLife: new Float32Array(MAX_BUBBLES),
			bMaxLife: new Float32Array(MAX_BUBBLES),
			bPhase: new Float32Array(MAX_BUBBLES),

			// Solid debris & hydro-erosion saltation pool
			debrisCount: 0,
			dx: new Float32Array(MAX_DEBRIS),
			dy: new Float32Array(MAX_DEBRIS),
			dvx: new Float32Array(MAX_DEBRIS),
			dvy: new Float32Array(MAX_DEBRIS),
			dMin: new Uint8Array(MAX_DEBRIS),
			dMass: new Float64Array(MAX_DEBRIS),
			dValue: new Float64Array(MAX_DEBRIS),
			dDensity: new Float32Array(MAX_DEBRIS),
			dState: new Uint8Array(MAX_DEBRIS),
			dHopTimer: new Float32Array(MAX_DEBRIS),
			dPanProg: new Float32Array(MAX_DEBRIS),
			dHops: new Uint16Array(MAX_DEBRIS),

			// Flash effects (dissolution pop / gold liberation glint)
			fxCount: 0,
			fxX: new Float32Array(MAX_FX),
			fxY: new Float32Array(MAX_FX),
			fxLife: new Float32Array(MAX_FX),
			fxKind: new Uint8Array(MAX_FX), // 0 = green, 1 = blue, 2 = gas, 3 = gold glint

			// Exact conservation ledger (double precision)
			waterFlooded: 0,
			waterPumped: 0,
			cellsDissolved: 0,
			cellsMechBroken: 0,
			totalReactedMass: 0,
			totalReactedValue: 0,
			initialDebrisMass: 0,
			initialDebrisValue: 0,
			pumpedHaliteMass: 0,
			pumpedHaliteValue: 0,
			pumpedVitriolMass: 0,
			pumpedVitriolValue: 0,
			lostGasMass: 0,
			lostGasValue: 0,
			archivedDebrisMass: 0,
			archivedDebrisValue: 0,
			goldPanEvents: 0,
			erosionHopEvents: 0,

			// Preallocated scratch objects
			_chem: {
				halite: 0, vitriol: 0, gas: 0, solid: 1,
				solubility: 0, speed: 0, density: 2.8,
				valHalite: 0, valVitriol: 0, valGas: 0, valSolid: 0,
				residueMineral: 0
			},
			_mixScratch: new Float64Array(GEO_MINERAL_COUNT),
			_elemScratch: new Float32Array(3),
			perfStepMs: 0,
			perfDrawMs: 0
		};

		loadScene(state, state.scene);
		return state;
	}

	function setRockPureCell(state, c, r, minIdx) {
		if (c < 0 || c >= ROCK_W || r < 0 || r >= ROCK_H) return;
		const idx = r * ROCK_W + c;
		const def = MINERALS[minIdx];
		state.rockSolid[idx] = 1;
		state.rockMineral[idx] = minIdx;
		state.rockR[idx] = def.repRgb[0];
		state.rockG[idx] = def.repRgb[1];
		state.rockB[idx] = def.repRgb[2];
		const off = idx * GEO_MINERAL_COUNT;
		for (let m = 0; m < GEO_MINERAL_COUNT; m++) state.rockMix[off + m] = m === minIdx ? 1.0 : 0.0;
		state.rockDissolve[idx] = 0;
		state.rockMechHp[idx] = def.strength;
		state.rockMechMax[idx] = def.strength;
		state.rockValue[idx] = def.price;
	}

	function setRockMixCell(state, c, r, mixWeights, rgb) {
		if (c < 0 || c >= ROCK_W || r < 0 || r >= ROCK_H) return;
		const idx = r * ROCK_W + c;
		const off = idx * GEO_MINERAL_COUNT;
		let dom = 0, bestW = -1, str = 0, val = 0;
		for (let m = 0; m < GEO_MINERAL_COUNT; m++) {
			const w = mixWeights[m];
			state.rockMix[off + m] = w;
			if (w > bestW) { bestW = w; dom = m; }
			str += w * MINERALS[m].strength;
			val += w * MINERALS[m].price;
		}
		state.rockSolid[idx] = 1;
		state.rockMineral[idx] = dom;
		state.rockR[idx] = rgb[0];
		state.rockG[idx] = rgb[1];
		state.rockB[idx] = rgb[2];
		state.rockDissolve[idx] = 0;
		state.rockMechHp[idx] = Math.max(0.4, str);
		state.rockMechMax[idx] = Math.max(0.4, str);
		state.rockValue[idx] = val;
	}

	function clearRockCell(state, c, r) {
		if (c < 0 || c >= ROCK_W || r < 0 || r >= ROCK_H) return;
		const idx = r * ROCK_W + c;
		state.rockSolid[idx] = 0;
		state.rockDissolve[idx] = 0;
	}

	function rebuildSolidMask(state) {
		for (let fr = 0; fr < FLUID_H; fr++) {
			const rr0 = fr * 2;
			for (let fc = 0; fc < FLUID_W; fc++) {
				const rc0 = fc * 2;
				const solidCount =
					state.rockSolid[rr0 * ROCK_W + rc0] +
					state.rockSolid[rr0 * ROCK_W + rc0 + 1] +
					state.rockSolid[(rr0 + 1) * ROCK_W + rc0] +
					state.rockSolid[(rr0 + 1) * ROCK_W + rc0 + 1];
				state.solidMask[fr * FLUID_W + fc] = solidCount >= 3 ? 1 : 0;
			}
		}
	}

	function spawnDebris(state, x, y, vx, vy, minIdx, mass, value, initialState, trackInitial) {
		if (mass <= 1e-9) return -1;
		const def = MINERALS[minIdx] || MINERALS[MIN_STONE];
		if (trackInitial) {
			state.initialDebrisMass += mass;
			state.initialDebrisValue += value;
		}
		if (state.debrisCount >= MAX_DEBRIS) {
			// Merge into an existing matching grain or archive cleanly for exact conservation
			for (let i = 0; i < state.debrisCount; i++) {
				if (state.dMin[i] === minIdx && state.dState[i] === DEBRIS_RESTING) {
					state.dMass[i] += mass;
					state.dValue[i] += value;
					return i;
				}
			}
			state.archivedDebrisMass += mass;
			state.archivedDebrisValue += value;
			return -1;
		}
		const i = state.debrisCount++;
		state.dx[i] = clamp(x, 0.2, WORLD_W - 0.2);
		state.dy[i] = clamp(y, 0.2, WORLD_H - 0.2);
		state.dvx[i] = vx;
		state.dvy[i] = vy;
		state.dMin[i] = minIdx;
		state.dMass[i] = mass;
		state.dValue[i] = value;
		state.dDensity[i] = def.density;
		state.dState[i] = initialState || DEBRIS_FALLING;
		state.dHopTimer[i] = initialState === DEBRIS_ENTRAINED ? 0.35 : 0;
		state.dPanProg[i] = 0;
		state.dHops[i] = 0;
		return i;
	}

	function spawnBubble(state, x, y) {
		if (state.bubbleCount >= MAX_BUBBLES) return;
		const i = state.bubbleCount++;
		const rng = state.rng;
		state.bx[i] = x + (rng() - 0.5) * 0.22;
		state.by[i] = y + (rng() - 0.5) * 0.16;
		state.bvx[i] = (rng() - 0.5) * 0.65;
		state.bvy[i] = 1.6 + rng() * 2.1;
		state.bRad[i] = 0.055 + rng() * 0.085;
		const life = 1.1 + rng() * 1.3;
		state.bLife[i] = life;
		state.bMaxLife[i] = life;
		state.bPhase[i] = rng() * 6.283;
	}

	function spawnFx(state, x, y, kind) {
		if (state.fxCount >= MAX_FX) return;
		const i = state.fxCount++;
		state.fxX[i] = x;
		state.fxY[i] = y;
		state.fxLife[i] = 0.35;
		state.fxKind[i] = kind;
	}

	function spawnJetDroplet(state, x, y, vx, vy, mass, hal, vit, vHal, vVit, kind) {
		if (state.jetCount >= MAX_JETS) {
			// Deposit into nearest open fluid cell so solute is never dropped
			depositToNearestFluid(state, x, y, mass, hal, vit, vHal, vVit);
			return;
		}
		const i = state.jetCount++;
		state.jx[i] = x;
		state.jy[i] = y;
		state.jvx[i] = vx;
		state.jvy[i] = vy;
		state.jMass[i] = mass;
		state.jHalite[i] = hal;
		state.jVitriol[i] = vit;
		state.jValHal[i] = vHal;
		state.jValVit[i] = vVit;
		state.jKind[i] = kind;
	}

	function depositToNearestFluid(state, x, y, mass, hal, vit, vHal, vVit) {
		const fc0 = clamp((x / FLUID_CELL) | 0, 0, FLUID_W - 1);
		const fr0 = clamp((y / FLUID_CELL) | 0, 0, FLUID_H - 1);
		let bestIdx = -1;
		if (!state.solidMask[fr0 * FLUID_W + fc0]) {
			bestIdx = fr0 * FLUID_W + fc0;
		} else {
			for (let rad = 1; rad <= 5 && bestIdx < 0; rad++) {
				for (let dr = -rad; dr <= rad && bestIdx < 0; dr++) {
					for (let dc = -rad; dc <= rad && bestIdx < 0; dc++) {
						const fc = fc0 + dc, fr = fr0 + dr;
						if (fc >= 0 && fc < FLUID_W && fr >= 0 && fr < FLUID_H && !state.solidMask[fr * FLUID_W + fc]) {
							bestIdx = fr * FLUID_W + fc;
						}
					}
				}
			}
		}
		if (bestIdx < 0) bestIdx = Math.min(FLUID_N - 1, Math.max(0, fr0 * FLUID_W + fc0));
		state.water[bestIdx] += mass;
		state.solHalite[bestIdx] += hal;
		state.solVitriol[bestIdx] += vit;
		state.solValHal[bestIdx] += vHal;
		state.solValVit[bestIdx] += vVit;
	}

	function resetFluidsAndLedger(state) {
		state.water.fill(0);
		state.waterNext.fill(0);
		state.velU.fill(0);
		state.velV.fill(0);
		state.solHalite.fill(0);
		state.solHaliteNext.fill(0);
		state.solVitriol.fill(0);
		state.solVitriolNext.fill(0);
		state.solValHal.fill(0);
		state.solValHalNext.fill(0);
		state.solValVit.fill(0);
		state.solValVitNext.fill(0);
		state.jetCount = 0;
		state.bubbleCount = 0;
		state.debrisCount = 0;
		state.fxCount = 0;
		state.time = 0;
		state.stepCount = 0;
		state.fireCarry = 0;
		state.pumpCarry = 0;
		state.demoSweepTimer = 0;

		state.waterFlooded = 0;
		state.waterPumped = 0;
		state.cellsDissolved = 0;
		state.cellsMechBroken = 0;
		state.totalReactedMass = 0;
		state.totalReactedValue = 0;
		state.initialDebrisMass = 0;
		state.initialDebrisValue = 0;
		state.pumpedHaliteMass = 0;
		state.pumpedHaliteValue = 0;
		state.pumpedVitriolMass = 0;
		state.pumpedVitriolValue = 0;
		state.lostGasMass = 0;
		state.lostGasValue = 0;
		state.archivedDebrisMass = 0;
		state.archivedDebrisValue = 0;
		state.goldPanEvents = 0;
		state.erosionHopEvents = 0;
	}

	function drainWater(state) {
		// Transfer any in-water solutes out only if explicitly draining lab basin:
		// To preserve exact conservation ledger, draining water accounts for drained solute as pumped/cleared
		let wHal = 0, wVit = 0, wVHal = 0, wVVit = 0;
		for (let i = 0; i < FLUID_N; i++) {
			wHal += state.solHalite[i];
			wVit += state.solVitriol[i];
			wVHal += state.solValHal[i];
			wVVit += state.solValVit[i];
			state.water[i] = 0;
			state.velU[i] = 0;
			state.velV[i] = 0;
			state.solHalite[i] = 0;
			state.solVitriol[i] = 0;
			state.solValHal[i] = 0;
			state.solValVit[i] = 0;
		}
		for (let i = 0; i < state.jetCount; i++) {
			wHal += state.jHalite[i];
			wVit += state.jVitriol[i];
			wVHal += state.jValHal[i];
			wVVit += state.jValVit[i];
		}
		state.jetCount = 0;
		state.totalReactedMass -= (wHal + wVit);
		state.totalReactedValue -= (wVHal + wVVit);
		if (state.totalReactedMass < 0) state.totalReactedMass = 0;
		if (state.totalReactedValue < 0) state.totalReactedValue = 0;
	}

	function rockFloorYAt(state, x) {
		const c = clamp((x / ROCK_CELL) | 0, 0, ROCK_W - 1);
		// Find highest floor solid below mid-height
		for (let r = 48; r >= 0; r--) {
			if (state.rockSolid[r * ROCK_W + c]) return (r + 1) * ROCK_CELL;
		}
		return 0.5;
	}

	function loadScene(state, sceneName) {
		state.scene = sceneName;
		state.rng = createRng(state.seed * 7919 + 13);
		state.rockSolid.fill(0);
		state.rockDissolve.fill(0);
		resetFluidsAndLedger(state);

		if (sceneName === 'columns') {
			// Gentle concave floor sloping toward the center pump basin
			for (let c = 0; c < ROCK_W; c++) {
				const x = (c + 0.5) * ROCK_CELL;
				const edgeSlope = Math.abs(x - 12.0) / 12.0;
				const floorH = 0.72 + 0.55 * edgeSlope * edgeSlope;
				const floorRows = Math.round(floorH / ROCK_CELL);
				for (let r = 0; r < floorRows; r++) setRockPureCell(state, c, r, MIN_STONE);
				// Side retaining walls
				if (c < 4 || c >= ROCK_W - 4) {
					for (let r = 0; r < ROCK_H; r++) setRockPureCell(state, c, r, MIN_STONE);
				}
			}
			// 12 labeled mineral columns hanging from the ceiling (y = 7.8..14.6 m)
			const usableCols = ROCK_W - 8;
			const colW = usableCols / TEST_COLUMNS.length;
			for (let c = 4; c < ROCK_W - 4; c++) {
				const band = Math.min(TEST_COLUMNS.length - 1, Math.floor((c - 4) / colW));
				const minIdx = TEST_COLUMNS[band];
				const wave = Math.sin(c * 0.25) * 2.0;
				const botRow = Math.round(62 + wave);
				for (let r = botRow; r < ROCK_H - 2; r++) {
					setRockPureCell(state, c, r, minIdx);
				}
				// Top stone cap
				for (let r = ROCK_H - 2; r < ROCK_H; r++) {
					setRockPureCell(state, c, r, MIN_STONE);
				}
			}
			state.rigX = 10.5;
			state.rigY = rockFloorYAt(state, state.rigX) + 0.45;
			state.aimX = 4.5;
			state.aimY = 10.0;
		} else if (sceneName === 'geology') {
			// Real 3-channel (R, G, B) geology via SteamGeology
			const field = SteamGeology ? SteamGeology.createField({ seed: state.seed, frequency: 0.075, yCompression: 3 }) : null;
			const mix = state._mixScratch;
			const vals = state._elemScratch;
			for (let c = 0; c < ROCK_W; c++) {
				const x = (c + 0.5) * ROCK_CELL;
				const floorH = 0.75 + 0.45 * Math.pow(Math.abs(x - 12.0) / 12.0, 2);
				const floorRows = Math.round(floorH / ROCK_CELL);
				for (let r = 0; r < floorRows; r++) setRockPureCell(state, c, r, MIN_STONE);
				if (c < 4 || c >= ROCK_W - 4) {
					for (let r = 0; r < ROCK_H; r++) setRockPureCell(state, c, r, MIN_STONE);
				}
				// Arched cave ceiling filled with authentic (R,G,B) mineral mixtures
				const arch = Math.sin((x / WORLD_W) * Math.PI) * 1.4;
				const ceilStart = Math.round((5.6 + arch + Math.sin(x * 0.75) * 0.45) / ROCK_CELL);
				for (let r = ceilStart; r < ROCK_H; r++) {
					if (field && COMPILED_GEO) {
						field.elements(c, ROCK_H - 1 - r, vals);
						COMPILED_GEO.mixInto(vals, 0.08, mix, 0);
						setRockMixCell(state, c, r, mix, vals);
					} else {
						setRockPureCell(state, c, r, MIN_STONE);
					}
				}
			}
			state.rigX = 12.0;
			state.rigY = rockFloorYAt(state, state.rigX) + 0.45;
			state.aimX = 12.0;
			state.aimY = 10.0;
		} else if (sceneName === 'placer') {
			// Gold Placer Sluice: sloped bed with 3 riffle notches + calm right tailing basin!
			for (let c = 0; c < ROCK_W; c++) {
				const x = (c + 0.5) * ROCK_CELL;
				let h;
				if (x < 2.2) {
					h = 6.4;
				} else if (x < 17.5) {
					const t = (x - 2.2) / (17.5 - 2.2);
					h = 5.6 - t * 3.8;
					// 3 shallow riffle catches that trap heavy pure Gold while light Quartz hops over!
					if (Math.abs(x - 7.0) < 0.35 || Math.abs(x - 10.6) < 0.35 || Math.abs(x - 14.2) < 0.35) {
						h -= 0.28;
					}
				} else {
					// Calm tailing pond basin on right
					h = 0.85 + 0.35 * Math.pow(Math.max(0, (x - 21.0) / 3.0), 2);
				}
				const rows = Math.round(h / ROCK_CELL);
				for (let r = 0; r < rows; r++) setRockPureCell(state, c, r, MIN_STONE);
				if (c < 4 || c >= ROCK_W - 4) {
					for (let r = 0; r < ROCK_H; r++) setRockPureCell(state, c, r, MIN_STONE);
				}
				// Small Gold-bearing quartz ceiling vein at top-left for visual context
				const ceilY = 12.8 + Math.sin(x * 0.5) * 0.3;
				for (let r = Math.round(ceilY / ROCK_CELL); r < ROCK_H; r++) {
					setRockPureCell(state, c, r, (x > 4 && x < 11 && r < 112) ? MIN_GOLD : MIN_STONE);
				}
			}
			// Pre-populate the upper-mid sluice bed with rich mixed rubble:
			// Gold-bearing quartz + Quartz + Sand + Stone + Iron!
			const rng = state.rng;
			for (let i = 0; i < 220; i++) {
				const rx = 3.2 + rng() * 9.8;
				const floorY = rockFloorYAt(state, rx);
				const roll = rng();
				let minIdx;
				if (roll < 0.28) minIdx = MIN_GOLD;
				else if (roll < 0.56) minIdx = MIN_SAND;
				else if (roll < 0.80) minIdx = MIN_QUARTZ;
				else if (roll < 0.92) minIdx = MIN_STONE;
				else minIdx = MIN_IRON;
				const mass = 0.55;
				spawnDebris(state, rx, floorY + 0.14 + rng() * 0.35, 0, 0, minIdx, mass, mass * MINERALS[minIdx].price, DEBRIS_RESTING, true);
			}
			state.rigX = 3.2;
			state.rigY = rockFloorYAt(state, state.rigX) + 0.45;
			state.aimX = 5.4;
			state.aimY = 4.8;
		} else {
			// 'karst' — Combined showcase cavern: Blue Vitriol + Fizzy Halite + Fluorite + Mixed Halite/Copper + Gold-quartz floor
			const mix = state._mixScratch;
			for (let c = 0; c < ROCK_W; c++) {
				const x = (c + 0.5) * ROCK_CELL;
				// Sloped floor funneling into central pump sump
				let floorH;
				if (x < 9.5) floorH = 2.6 - (x / 9.5) * 1.75;
				else if (x > 16.0) floorH = 0.85 + ((x - 16.0) / 8.0) * 1.65;
				else floorH = 0.85;
				const floorRows = Math.round(floorH / ROCK_CELL);
				for (let r = 0; r < floorRows; r++) setRockPureCell(state, c, r, MIN_STONE);
				if (c < 4 || c >= ROCK_W - 4) {
					for (let r = 0; r < ROCK_H; r++) setRockPureCell(state, c, r, MIN_STONE);
				}

				// Upper cave ceiling with organic warped mineral veins & pockets
				const arch = Math.sin((x / WORLD_W) * Math.PI) * 2.2;
				const ceilStart = Math.round((7.4 + arch) / ROCK_CELL);
				for (let r = ceilStart; r < ROCK_H; r++) {
					const y = (r + 0.5) * ROCK_CELL;
					const warp = 0.58 * Math.sin(x * 1.15 + y * 0.85) + 0.36 * Math.cos(x * 2.05 - y * 1.55);
					if (Math.hypot((x - 5.2) * 0.82, y - 10.6) < 2.55 + warp) {
						setRockPureCell(state, c, r, MIN_VITRIOL);
					} else if (Math.hypot((x - 11.4) * 0.86, y - 11.4) < 2.25 + warp) {
						setRockPureCell(state, c, r, MIN_FIZZY);
					} else if (Math.hypot((x - 17.6) * 0.82, y - 10.5) < 2.55 + warp) {
						// Mixed Halite (60%) + Chalcopyrite (40%) seam -> green brine + falling Copper clasts!
						mix.fill(0);
						mix[MIN_HALITE] = 0.60;
						mix[MIN_COPPER] = 0.40;
						setRockMixCell(state, c, r, mix, [0.70, 0.58, 0.22]);
					} else if (Math.hypot((x - 14.5) * 0.9, y - 9.8) < 1.65 + warp * 0.8) {
						setRockPureCell(state, c, r, MIN_FLUORITE);
					} else {
						setRockPureCell(state, c, r, MIN_STONE);
					}
				}
			}
			// Mid-left rock shelf with a Halite dam holding a small starter ledge
			for (let c = 16; c < 64; c++) {
				const x = (c + 0.5) * ROCK_CELL;
				const shelfY = 5.4 - (x - 2.0) * 0.14;
				const r0 = Math.round(shelfY / ROCK_CELL);
				for (let r = r0; r < r0 + 5; r++) {
					setRockPureCell(state, c, r, (c > 50 && c < 60) ? MIN_HALITE : MIN_STONE);
				}
			}
			// Starter Gold-bearing quartz + Sand rubble on the left slope for panning
			const rng = state.rng;
			for (let i = 0; i < 65; i++) {
				const rx = 2.4 + rng() * 6.5;
				const fy = rockFloorYAt(state, rx);
				const roll = rng();
				const minIdx = roll < 0.35 ? MIN_GOLD : (roll < 0.72 ? MIN_SAND : MIN_QUARTZ);
				const mass = 0.5;
				spawnDebris(state, rx, fy + 0.16, 0, 0, minIdx, mass, mass * MINERALS[minIdx].price, DEBRIS_RESTING, true);
			}
			state.rigX = 12.8;
			state.rigY = rockFloorYAt(state, state.rigX) + 0.45;
			state.aimX = 5.4;
			state.aimY = 10.2;
		}

		rebuildSolidMask(state);
		state.rockDirty = true;
	}

	function isRockBoundary(state, c, r) {
		if (!state.rockSolid[r * ROCK_W + c]) return false;
		if (c > 0 && !state.rockSolid[r * ROCK_W + c - 1]) return true;
		if (c + 1 < ROCK_W && !state.rockSolid[r * ROCK_W + c + 1]) return true;
		if (r > 0 && !state.rockSolid[(r - 1) * ROCK_W + c]) return true;
		if (r + 1 < ROCK_H && !state.rockSolid[(r + 1) * ROCK_W + c]) return true;
		return false;
	}

	// Execute full-cell chemical dissolution/decomposition with EXACT mass & value conservation
	function detachRockCellChemical(state, c, r, depositFluidIdx) {
		const idx = r * ROCK_W + c;
		if (!state.rockSolid[idx]) return;
		const chem = evaluateCellChemistry(state, idx, state._chem);
		const cellMass = 1.0;
		const cellVal = state.rockValue[idx];

		state.rockSolid[idx] = 0;
		state.rockDissolve[idx] = 0;
		state.rockDirty = true;
		state.cellsDissolved++;
		state.totalReactedMass += cellMass;
		state.totalReactedValue += cellVal;

		const wx = (c + 0.5) * ROCK_CELL;
		const wy = (r + 0.5) * ROCK_CELL;

		// 1. Soluble Halite (+G) & Blue Vitriol (+GB) enter the fluid cell
		const mHal = cellMass * chem.halite;
		const mVit = cellMass * chem.vitriol;
		if (mHal > 1e-6 || mVit > 1e-6) {
			const fIdx = depositFluidIdx >= 0 ? depositFluidIdx : findNearestOpenFluid(state, wx, wy);
			// Ensure a tiny water carrier exists if dissolving via splash on dry boundary
			if (state.water[fIdx] < 0.04) {
				state.water[fIdx] += 0.04;
				state.waterFlooded += 0.04;
			}
			state.solHalite[fIdx] += mHal;
			state.solVitriol[fIdx] += mVit;
			state.solValHal[fIdx] += chem.valHalite;
			state.solValVit[fIdx] += chem.valVitriol;
			if (mVit > mHal) spawnFx(state, wx, wy, 1);
			else spawnFx(state, wx, wy, 0);
		}

		// 2. Escaping Gas (B) -> permanently LOST! Spawn visible rising bubbles
		const mGas = cellMass * chem.gas;
		if (mGas > 1e-6) {
			state.lostGasMass += mGas;
			state.lostGasValue += chem.valGas;
			const nb = mGas > 0.5 ? 4 : 2;
			for (let k = 0; k < nb; k++) spawnBubble(state, wx, wy);
			spawnFx(state, wx, wy, 2);
		}

		// 3. Insoluble Solid Residue -> falls straight down as solid debris!
		const mSol = cellMass - mHal - mVit - mGas;
		if (mSol > 1e-5) {
			const rng = state.rng;
			spawnDebris(
				state,
				wx + (rng() - 0.5) * 0.08,
				wy - 0.06,
				(rng() - 0.5) * 0.9,
				-0.4 - rng() * 0.6,
				chem.residueMineral,
				mSol,
				chem.valSolid,
				DEBRIS_FALLING,
				false
			);
		}

		// Refresh containing 2x2 fluid cell solidMask
		const fc = c >> 1, fr = r >> 1;
		const rc0 = fc << 1, rr0 = fr << 1;
		const solidCount =
			state.rockSolid[rr0 * ROCK_W + rc0] +
			state.rockSolid[rr0 * ROCK_W + rc0 + 1] +
			state.rockSolid[(rr0 + 1) * ROCK_W + rc0] +
			state.rockSolid[(rr0 + 1) * ROCK_W + rc0 + 1];
		state.solidMask[fr * FLUID_W + fc] = solidCount >= 3 ? 1 : 0;
	}

	// Execute mechanical chip break (very weak on hard rock; fast on loose Sand/Gas)
	function detachRockCellMechanical(state, c, r) {
		const idx = r * ROCK_W + c;
		if (!state.rockSolid[idx]) return;
		const dom = state.rockMineral[idx];
		// If it's fragile Gas rock broken by water jet, gas still vents!
		if (dom === MIN_GAS) {
			detachRockCellChemical(state, c, r, -1);
			return;
		}
		const cellMass = 1.0;
		const cellVal = state.rockValue[idx];
		state.rockSolid[idx] = 0;
		state.rockDissolve[idx] = 0;
		state.rockDirty = true;
		state.cellsMechBroken++;
		state.totalReactedMass += cellMass;
		state.totalReactedValue += cellVal;

		const wx = (c + 0.5) * ROCK_CELL;
		const wy = (r + 0.5) * ROCK_CELL;
		const rng = state.rng;
		spawnDebris(state, wx, wy - 0.05, (rng() - 0.5) * 1.4, -0.5, dom, cellMass, cellVal, DEBRIS_FALLING, false);

		const fc = c >> 1, fr = r >> 1;
		const rc0 = fc << 1, rr0 = fr << 1;
		const solidCount =
			state.rockSolid[rr0 * ROCK_W + rc0] +
			state.rockSolid[rr0 * ROCK_W + rc0 + 1] +
			state.rockSolid[(rr0 + 1) * ROCK_W + rc0] +
			state.rockSolid[(rr0 + 1) * ROCK_W + rc0 + 1];
		state.solidMask[fr * FLUID_W + fc] = solidCount >= 3 ? 1 : 0;
	}

	function findNearestOpenFluid(state, x, y) {
		const fc0 = clamp((x / FLUID_CELL) | 0, 0, FLUID_W - 1);
		const fr0 = clamp((y / FLUID_CELL) | 0, 0, FLUID_H - 1);
		// Prefer open air directly below so dissolved ceiling solute drops cleanly downward
		if (fr0 > 0 && !state.solidMask[(fr0 - 1) * FLUID_W + fc0]) return (fr0 - 1) * FLUID_W + fc0;
		if (!state.solidMask[fr0 * FLUID_W + fc0]) return fr0 * FLUID_W + fc0;
		for (let rad = 1; rad <= 4; rad++) {
			for (let dr = -rad; dr <= rad; dr++) {
				for (let dc = -rad; dc <= rad; dc++) {
					const fc = fc0 + dc, fr = fr0 + dr;
					if (fc >= 0 && fc < FLUID_W && fr >= 0 && fr < FLUID_H && !state.solidMask[fr * FLUID_W + fc]) {
						return fr * FLUID_W + fc;
					}
				}
			}
		}
		return fr0 * FLUID_W + fc0;
	}

	// Apply chemical exposure + weak mechanical impulse to one boundary rock cell
	function exposeRockCell(state, c, r, chemIntensity, mechImpulse, depositFluidIdx, dt) {
		if (c <= 2 || c >= ROCK_W - 3 || r <= 2 || r >= ROCK_H - 2) return;
		const idx = r * ROCK_W + c;
		if (!state.rockSolid[idx]) return;

		const chem = evaluateCellChemistry(state, idx, state._chem);

		// 1. Chemical dissolution (fast on soluble salts/hydrates/gas-salt, ZERO on insoluble rock!)
		if (chem.speed > 0 && chemIntensity > 0) {
			state.rockDissolve[idx] += chem.speed * state.dissolveRate * chemIntensity * dt;
			state.rockDirty = true;
			const prog = state.rockDissolve[idx];
			if (prog >= 1.0 || (prog >= 0.52 && state.rng() < (prog - 0.48) * 6.5 * dt)) {
				detachRockCellChemical(state, c, r, depositFluidIdx);
				return;
			}
		}

		// 2. Mechanical fracture (deliberately VERY weak on solid rock; erodes loose Sand!)
		if (mechImpulse > 0) {
			const dom = state.rockMineral[idx];
			const effectiveDamage = dom === MIN_SAND ? mechImpulse * 2.4 : mechImpulse * state.mechForce * 0.22;
			if (effectiveDamage > 0) {
				state.rockMechHp[idx] -= effectiveDamage;
				if (state.rockMechHp[idx] <= 0) {
					detachRockCellMechanical(state, c, r);
				}
			}
		}
	}

	function stepWaterGun(state, dt) {
		if (state.demoSweepTimer > 0) {
			state.demoSweepTimer = Math.max(0, state.demoSweepTimer - dt);
			const p = 1.0 - state.demoSweepTimer / 6.5;
			if (state.scene === 'columns') {
				// Linger across Halite -> Blue Vitriol -> Fizzy -> Fluorite -> Gas -> Chalcopyrite -> Quartz
				state.aimX = 1.3 + p * 12.2;
				state.aimY = 10.2;
			} else if (state.scene === 'placer') {
				// Stream brisk water straight down the upper sluice bed to wash Quartz/Sand & concentrate Pure Gold!
				state.aimX = 4.6 + Math.sin(p * 10.0) * 1.1;
				state.aimY = 4.7;
			} else if (state.scene === 'karst') {
				if (p < 0.34) {
					state.aimX = 5.2 + Math.sin(p * 18) * 0.7;
					state.aimY = 10.4;
				} else if (p < 0.66) {
					state.aimX = 11.4 + Math.sin(p * 18) * 0.6;
					state.aimY = 11.1;
				} else {
					state.aimX = 17.5 + Math.sin(p * 18) * 0.7;
					state.aimY = 10.4;
				}
			} else {
				state.aimX = 3.5 + p * 17.0;
				state.aimY = 9.2;
			}
		}

		const activeFire = state.firing || state.autoFire || state.demoSweepTimer > 0;
		if (!activeFire) return;

		const nozX = state.rigX;
		const nozY = state.rigY + 0.65;
		const dx = state.aimX - nozX;
		const dy = state.aimY - nozY;
		const dist = Math.hypot(dx, dy) || 1;
		const dirX = dx / dist;
		const dirY = dy / dist;

		// Emit steady ballistic fresh-water droplets from unlimited tank
		const emitRate = 85 * state.jetFlow;
		state.fireCarry += emitRate * dt;
		const n = state.fireCarry | 0;
		state.fireCarry -= n;
		const rng = state.rng;

		for (let i = 0; i < n; i++) {
			const spread = (rng() - 0.5) * 0.055;
			const cos = Math.cos(spread), sin = Math.sin(spread);
			const vx = (dirX * cos - dirY * sin) * state.jetSpeed * (0.94 + rng() * 0.12);
			const vy = (dirX * sin + dirY * cos) * state.jetSpeed * (0.94 + rng() * 0.12);
			const mass = 0.085;
			state.waterFlooded += mass;
			spawnJetDroplet(
				state,
				nozX + dirX * 0.45,
				nozY + dirY * 0.45,
				vx, vy, mass,
				0, 0, 0, 0, 0
			);
		}
	}

	function stepJetDroplets(state, dt) {
		let write = 0;
		for (let i = 0; i < state.jetCount; i++) {
			let x = state.jx[i];
			let y = state.jy[i];
			let vx = state.jvx[i];
			let vy = state.jvy[i];
			const mass = state.jMass[i];
			const hal = state.jHalite[i];
			const vit = state.jVitriol[i];
			const vHal = state.jValHal[i];
			const vVit = state.jValVit[i];
			const kind = state.jKind[i];

			vy -= GRAVITY * dt;
			const nx = x + vx * dt;
			const ny = y + vy * dt;

			// Out-of-bounds clamp & deposit
			if (nx < 0.25 || nx >= WORLD_W - 0.25 || ny < 0.25 || ny >= WORLD_H - 0.25) {
				depositToNearestFluid(state, clamp(x, 0.4, WORLD_W - 0.4), clamp(y, 0.4, WORLD_H - 0.4), mass, hal, vit, vHal, vVit);
				continue;
			}

			// Check rock collision at target cell
			const rc = clamp((nx / ROCK_CELL) | 0, 0, ROCK_W - 1);
			const rr = clamp((ny / ROCK_CELL) | 0, 0, ROCK_H - 1);
			if (state.rockSolid[rr * ROCK_W + rc]) {
				const speed = Math.hypot(vx, vy);
				const fIdx = findNearestOpenFluid(state, x, y);

				// Impact splashes across a small 3x3 rock patch for smooth karst carving
				if (kind === 0 && speed > 4.2) {
					for (let dr = -1; dr <= 1; dr++) {
						for (let dc = -1; dc <= 1; dc++) {
							const falloff = (dr === 0 && dc === 0) ? 1.0 : 0.45;
							exposeRockCell(state, rc + dc, rr + dr, 1.85 * falloff, 0.16 * falloff, fIdx, 0.045);
						}
					}
					// Also transfer jet momentum to nearby resting floor debris (hydro-erosion spray!)
					if (state.erosionOn) {
						impartJetWashToDebris(state, x, y, vx, vy);
					}
				}

				// Deposit water & solutes into nearest open fluid cell with splash momentum
				state.water[fIdx] += mass;
				state.solHalite[fIdx] += hal;
				state.solVitriol[fIdx] += vit;
				state.solValHal[fIdx] += vHal;
				state.solValVit[fIdx] += vVit;
				state.velU[fIdx] = clamp(state.velU[fIdx] + vx * 0.22, -9.0, 9.0);
				state.velV[fIdx] = clamp(state.velV[fIdx] + vy * 0.14, -9.0, 9.0);
				continue;
			}

			// Check merging into an already-occupied water pool (when descending or slow)
			const fc = clamp((nx / FLUID_CELL) | 0, 0, FLUID_W - 1);
			const fr = clamp((ny / FLUID_CELL) | 0, 0, FLUID_H - 1);
			const fIdx = fr * FLUID_W + fc;
			if (!state.solidMask[fIdx] && state.water[fIdx] > 0.30 && (vy < 1.5 || kind === 1)) {
				state.water[fIdx] += mass;
				state.solHalite[fIdx] += hal;
				state.solVitriol[fIdx] += vit;
				state.solValHal[fIdx] += vHal;
				state.solValVit[fIdx] += vVit;
				state.velU[fIdx] = clamp(state.velU[fIdx] + vx * 0.18, -9.0, 9.0);
				continue;
			}

			// Keep droplet flying
			state.jx[write] = nx;
			state.jy[write] = ny;
			state.jvx[write] = vx;
			state.jvy[write] = vy;
			state.jMass[write] = mass;
			state.jHalite[write] = hal;
			state.jVitriol[write] = vit;
			state.jValHal[write] = vHal;
			state.jValVit[write] = vVit;
			state.jKind[write] = kind;
			write++;
		}
		state.jetCount = write;
	}

	function impartJetWashToDebris(state, x, y, vx, vy) {
		for (let i = 0; i < state.debrisCount; i++) {
			const dx = state.dx[i] - x;
			const dy = state.dy[i] - y;
			if (dx * dx + dy * dy > 0.85) continue;
			const minIdx = state.dMin[i];
			const rho = state.dDensity[i];
			if (minIdx === MIN_GOLD) {
				// Direct jet agitation liberates Quartz gangue off Gold-quartz IN PLACE without blasting heavy Gold away!
				state.dPanProg[i] += 0.24 * state.erosionPower;
				continue;
			}
			// Only light-to-medium grains (Sand, Quartz, Stone) get kicked up into short hops by splash
			if (rho > 4.2) continue;
			const push = (1.5 / Math.max(0.6, rho - 0.8)) * state.erosionPower;
			if (push > 0.35) {
				state.dState[i] = DEBRIS_ENTRAINED;
				state.dHopTimer[i] = Math.max(state.dHopTimer[i], 0.24);
				state.dvx[i] = clamp(state.dvx[i] + (vx * 0.14 + (dx >= 0 ? 0.9 : -0.9)) * Math.min(2.0, push), -5.5, 5.5);
				state.dvy[i] = Math.max(state.dvy[i], 0.75 * Math.min(1.8, push));
			}
		}
	}

	// Conservative 2D cell-based fluid step (gravity cascade + pressure equalization + overhang drip + exact solute transport)
	function stepFluidGrid(state, dt) {
		const W = FLUID_W, H = FLUID_H, N = FLUID_N;
		const water = state.water;
		const waterNext = state.waterNext;
		const solH = state.solHalite;
		const solHN = state.solHaliteNext;
		const solV = state.solVitriol;
		const solVN = state.solVitriolNext;
		const valH = state.solValHal;
		const valHN = state.solValHalNext;
		const valV = state.solValVit;
		const valVN = state.solValVitNext;
		const solid = state.solidMask;
		const velU = state.velU;
		const velV = state.velV;

		waterNext.set(water);
		solHN.set(solH);
		solVN.set(solV);
		valHN.set(valH);
		valVN.set(valV);

		// Helper to transfer an exact volume `flow` from cell a -> cell b with exact proportional solutes
		function transfer(a, b, flow, vxImpulse, vyImpulse) {
			const wa = waterNext[a];
			if (flow <= 1e-7 || wa <= 1e-7) return;
			const actual = flow > wa ? wa : flow;
			const frac = actual / wa;
			const dH = solHN[a] * frac;
			const dV = solVN[a] * frac;
			const dVH = valHN[a] * frac;
			const dVV = valVN[a] * frac;

			waterNext[a] -= actual;
			solHN[a] -= dH;
			solVN[a] -= dV;
			valHN[a] -= dVH;
			valVN[a] -= dVV;

			waterNext[b] += actual;
			solHN[b] += dH;
			solVN[b] += dV;
			valHN[b] += dVH;
			valVN[b] += dVV;

			if (vxImpulse !== 0) velU[b] = clamp(velU[b] * 0.85 + vxImpulse, -8.5, 8.5);
			if (vyImpulse !== 0) velV[b] = clamp(velV[b] * 0.85 + vyImpulse, -8.5, 8.5);
		}

		// 2 sub-iterations of vertical gravity + lateral equalization per step for lively fast flow!
		for (let iter = 0; iter < 2; iter++) {
			// Pass 1: Vertical fall (bottom-up so lower space fills cleanly)
			for (let r = 1; r < H; r++) {
				for (let c = 0; c < W; c++) {
					const idx = r * W + c;
					if (solid[idx]) continue;
					const w = waterNext[idx];
					if (w <= 0.0005) continue;
					const down = (r - 1) * W + c;
					if (!solid[down]) {
						const maxCap = 1.05;
						const room = maxCap - waterNext[down];
						if (room > 0.001) {
							// Overhang cascade: if 2+ empty cells beneath, turn cleanly into falling cascade droplet!
							if (r >= 2 && !solid[(r - 2) * W + c] && waterNext[down] < 0.08 && w > 0.012 && state.jetCount < MAX_JETS - 20) {
								const drop = Math.min(w, 0.30);
								const frac = drop / w;
								const dH = solHN[idx] * frac;
								const dV = solVN[idx] * frac;
								const dVH = valHN[idx] * frac;
								const dVV = valVN[idx] * frac;
								waterNext[idx] -= drop;
								solHN[idx] -= dH;
								solVN[idx] -= dV;
								valHN[idx] -= dVH;
								valVN[idx] -= dVV;
								spawnJetDroplet(
									state,
									(c + 0.5) * FLUID_CELL,
									(r + 0.15) * FLUID_CELL,
									clamp(velU[idx] * 0.45, -2.5, 2.5),
									-2.0,
									drop, dH, dV, dVH, dVV, 1
								);
								continue;
							}
							const fall = Math.min(w, room, 0.95);
							transfer(idx, down, fall, velU[idx] * 0.15, -2.4);
						}
					}
				}
			}

			// Pass 2: Lateral pressure & slope equalization (bottom-supported only to avoid floating bars!)
			const sweepRight = ((state.stepCount + iter) & 1) === 0;
			for (let r = 0; r < H; r++) {
				for (let k = 0; k < W; k++) {
					const c = sweepRight ? k : (W - 1 - k);
					const idx = r * W + c;
					if (solid[idx]) continue;
					const w = waterNext[idx];
					if (w <= 0.002) continue;

					// Only spread horizontally if supported below by solid or nearly full water
					const supported = (r === 0) || solid[(r - 1) * W + c] || waterNext[(r - 1) * W + c] > 0.55;
					if (!supported) continue;

					const hasL = c > 0 && !solid[idx - 1];
					const hasR = c + 1 < W && !solid[idx + 1];
					const wL = hasL ? waterNext[idx - 1] : 99;
					const wR = hasR ? waterNext[idx + 1] : 99;

					// Bias along existing horizontal momentum for realistic sluice currents!
					const mom = velU[idx] * 0.04;
					let flowL = hasL && w > wL ? (w - wL) * 0.34 - Math.max(0, mom) * 0.08 : 0;
					let flowR = hasR && w > wR ? (w - wR) * 0.34 + Math.max(0, mom) * 0.08 : 0;
					if (flowL < 0) flowL = 0;
					if (flowR < 0) flowR = 0;

					const sumOut = flowL + flowR;
					if (sumOut > w * 0.72) {
						const s = (w * 0.72) / sumOut;
						flowL *= s;
						flowR *= s;
					}
					if (flowL > 0.0005) {
						transfer(idx, idx - 1, flowL, -(1.2 + flowL * 6.5), 0);
						velU[idx] = clamp(velU[idx] * 0.9 - flowL * 2.5, -8.0, 8.0);
					}
					if (flowR > 0.0005) {
						transfer(idx, idx + 1, flowR, (1.2 + flowR * 6.5), 0);
						velU[idx] = clamp(velU[idx] * 0.9 + flowR * 2.5, -8.0, 8.0);
					}
				}
			}

			// Pass 3: Upward pressure relief for overfilled cells (> 1.05)
			for (let r = 0; r < H - 1; r++) {
				for (let c = 0; c < W; c++) {
					const idx = r * W + c;
					if (solid[idx]) continue;
					const excess = waterNext[idx] - 1.02;
					if (excess > 0.005) {
						const up = (r + 1) * W + c;
						if (!solid[up]) transfer(idx, up, excess * 0.65, 0, 1.2);
					}
				}
			}
		}

		// Commit buffers & apply gentle viscous drag to velocity
		for (let i = 0; i < N; i++) {
			if (waterNext[i] < 1e-6) {
				// Prevent stranded micro-droplet solute loss by keeping tiny water if solute remains
				if (solHN[i] + solVN[i] > 1e-7) {
					waterNext[i] = 1e-5;
				} else {
					waterNext[i] = 0;
					solHN[i] = 0;
					solVN[i] = 0;
					valHN[i] = 0;
					valVN[i] = 0;
				}
				velU[i] *= 0.6;
				velV[i] *= 0.6;
			} else {
				velU[i] *= 0.94;
				velV[i] *= 0.90;
			}
			water[i] = waterNext[i];
			solH[i] = solHN[i];
			solV[i] = solVN[i];
			valH[i] = valHN[i];
			valV[i] = valVN[i];
		}

		// Passive standing/flowing water contact dissolution on adjacent rock cells!
		for (let fr = 0; fr < H; fr++) {
			for (let fc = 0; fc < W; fc++) {
				const fIdx = fr * W + fc;
				const w = water[fIdx];
				if (w < 0.06) continue;
				const flowSpeed = Math.hypot(velU[fIdx], velV[fIdx]);
				const intensity = (0.32 + 0.68 * Math.min(1.0, flowSpeed / 2.2)) * Math.min(1.0, w * 2.2);
				// Expose rock cells bordering this fluid cell (2x2 interior + 1-cell ring)
				const rc0 = fc * 2, rr0 = fr * 2;
				for (let dr = -1; dr <= 2; dr++) {
					const rr = rr0 + dr;
					if (rr <= 2 || rr >= ROCK_H - 2) continue;
					for (let dc = -1; dc <= 2; dc++) {
						const rc = rc0 + dc;
						if (rc <= 2 || rc >= ROCK_W - 3) continue;
						if (state.rockSolid[rr * ROCK_W + rc] && isRockBoundary(state, rc, rr)) {
							exposeRockCell(state, rc, rr, intensity, 0, fIdx, dt);
						}
					}
				}
			}
		}
	}

	// Under-platform suction pump: sucks water + dissolved solutes (Halite & Blue Vitriol) straight into cargo!
	function stepUnderPlatformPump(state, dt) {
		if (!state.pumpOn) return;
		const minC = clamp(((state.rigX - state.rigHalfW) / FLUID_CELL) | 0, 0, FLUID_W - 1);
		const maxC = clamp(((state.rigX + state.rigHalfW) / FLUID_CELL) | 0, 0, FLUID_W - 1);
		const rigCellR = clamp((state.rigY / FLUID_CELL) | 0, 0, FLUID_H - 1);
		const minR = Math.max(0, rigCellR - 5);
		const maxR = Math.min(FLUID_H - 1, rigCellR + 2);

		let budget = 2.6 * state.pumpRate * dt;
		for (let r = maxR; r >= minR && budget > 1e-6; r--) {
			for (let c = minC; c <= maxC && budget > 1e-6; c++) {
				const idx = r * FLUID_W + c;
				const w = state.water[idx];
				if (w <= 1e-6) continue;
				const pull = Math.min(w, budget);
				const frac = pull / w;

				const pH = state.solHalite[idx] * frac;
				const pV = state.solVitriol[idx] * frac;
				const pVH = state.solValHal[idx] * frac;
				const pVV = state.solValVit[idx] * frac;

				state.water[idx] -= pull;
				state.solHalite[idx] -= pH;
				state.solVitriol[idx] -= pV;
				state.solValHal[idx] -= pVH;
				state.solValVit[idx] -= pVV;

				state.waterPumped += pull;
				state.pumpedHaliteMass += pH;
				state.pumpedHaliteValue += pVH;
				state.pumpedVitriolMass += pV;
				state.pumpedVitriolValue += pVV;
				budget -= pull;
			}
		}
	}

	// Separate Hydro-Erosion (Short-hop Bedload Saltation) & Gold Placer Panning!
	// NEVER dissolves debris into water solutes — only briefly entrains and drops solid grains!
	function stepDebrisAndErosion(state, dt) {
		const rng = state.rng;
		const countAtStart = state.debrisCount;

		for (let i = 0; i < countAtStart; i++) {
			let x = state.dx[i];
			let y = state.dy[i];
			let vx = state.dvx[i];
			let vy = state.dvy[i];
			let st = state.dState[i];
			const minIdx = state.dMin[i];
			const rho = state.dDensity[i];

			const fc = clamp((x / FLUID_CELL) | 0, 0, FLUID_W - 1);
			const fr = clamp((y / FLUID_CELL) | 0, 0, FLUID_H - 1);
			const fIdx = fr * FLUID_W + fc;
			const wDepth = state.water[fIdx];
			const uFlow = state.velU[fIdx];
			const vFlow = state.velV[fIdx];
			// Also sample one fluid cell above in case grain sits right on floor border
			const fUp = fr + 1 < FLUID_H ? (fr + 1) * FLUID_W + fc : fIdx;
			const wHere = Math.max(wDepth, state.water[fUp] * 0.85);
			const uHere = Math.abs(uFlow) >= Math.abs(state.velU[fUp]) ? uFlow : state.velU[fUp];
			const speedHere = Math.abs(uHere);

			// 1. Placer Separation: Gold-bearing quartz washed by flowing water -> Pure Gold (stays!) + Quartz (washes!)
			if (state.erosionOn && minIdx === MIN_GOLD && wHere > 0.04 && speedHere > 0.55) {
				state.dPanProg[i] += speedHere * state.erosionPower * 0.42 * dt;
				if (state.dPanProg[i] >= 1.0) {
					const origMass = state.dMass[i];
					const origVal = state.dValue[i];
					const goldMass = origMass * 0.25;
					const goldVal = origVal * 0.92;
					const qzMass = origMass - goldMass;
					const qzVal = origVal - goldVal;

					// Transform current grain in-place into heavy Pure Gold nugget (stays put!)
					state.dMin[i] = MIN_PURE_GOLD;
					state.dMass[i] = goldMass;
					state.dValue[i] = goldVal;
					state.dDensity[i] = MINERALS[MIN_PURE_GOLD].density;
					state.dState[i] = DEBRIS_RESTING;
					state.dvx[i] = 0;
					state.dvy[i] = 0;
					state.dHopTimer[i] = 0;
					state.dPanProg[i] = 0;
					state.goldPanEvents++;
					spawnFx(state, x, y + 0.08, 3);

					// Spawn liberated light Quartz gangue already entrained downstream!
					const dir = uHere >= 0 ? 1 : -1;
					spawnDebris(
						state,
						x + dir * 0.10,
						y + 0.14,
						uHere * 0.85 + dir * 1.1,
						0.95 + rng() * 0.5,
						MIN_QUARTZ,
						qzMass,
						qzVal,
						DEBRIS_ENTRAINED,
						false
					);
					continue;
				}
			}

			// 2. Shields-style shear pickup for RESTING grains in flowing water
			if (st === DEBRIS_RESTING) {
				// Check if rock underneath was dissolved/carved away
				const rc = clamp((x / ROCK_CELL) | 0, 0, ROCK_W - 1);
				const rrBelow = clamp(((y - 0.10) / ROCK_CELL) | 0, 0, ROCK_H - 1);
				if (y > 0.35 && !state.rockSolid[rrBelow * ROCK_W + rc]) {
					st = DEBRIS_FALLING;
					state.dState[i] = DEBRIS_FALLING;
				} else if (state.erosionOn && wHere > 0.05) {
					// Critical shear velocity scales with submerged excess density (rho - 1.0):
					// Sand (1.6) ~ 0.47, Quartz (2.6) ~ 1.25, Stone (2.8) ~ 1.40,
					// Iron (5.2) ~ 3.28, Gold-Qz (5.6) ~ 3.59, Silver (10.5) ~ 7.41, Pure Gold (19.3) ~ 14.27!
					const vCrit = (0.78 / state.erosionPower) * Math.max(0.35, rho - 1.0);
					if (speedHere > vCrit) {
						const excess = speedHere / vCrit - 1.0;
						const pickProb = Math.min(0.95, (2.8 + excess * 4.5) * dt);
						if (rng() < pickProb) {
							st = DEBRIS_ENTRAINED;
							state.dState[i] = DEBRIS_ENTRAINED;
							// Short transient saltation hop (0.16..0.48 s — NEVER permanent dissolution!)
							const hopDur = clamp((0.46 - rho * 0.04) * (0.75 + rng() * 0.5), 0.14, 0.48);
							state.dHopTimer[i] = hopDur;
							vx = uHere * 0.72;
							vy = 0.72 + Math.min(1.25, excess * 0.65) + rng() * 0.40;
							state.dHops[i]++;
							state.erosionHopEvents++;
						}
					}
				}
				state.dvx[i] = vx;
				state.dvy[i] = vy;
				continue;
			}

			// 3. Motion for FALLING and transiently ENTRAINED grains
			const submerged = wHere > 0.05;
			if (st === DEBRIS_ENTRAINED) {
				state.dHopTimer[i] -= dt;
				const gEff = GRAVITY * (1.0 - 1.0 / Math.max(1.25, rho)) * 0.42;
				vy -= gEff * dt;
				// Hydrodynamic drag toward local water velocity
				const drag = Math.min(1.0, (7.5 / Math.sqrt(rho)) * dt);
				vx += (uHere * 0.92 - vx) * drag;
				vy += (vFlow * 0.45 - vy) * (drag * 0.45);
				// End transient entrainment when hop timer expires or flow slows
				if (state.dHopTimer[i] <= 0 || !submerged) {
					st = DEBRIS_FALLING;
					state.dState[i] = DEBRIS_FALLING;
				}
			} else {
				// FALLING
				const gEff = submerged ? GRAVITY * (1.0 - 0.85 / Math.max(1.2, rho)) : GRAVITY;
				vy -= gEff * dt;
				if (submerged) {
					vx += (uHere * 0.35 - vx) * Math.min(1.0, 2.8 * dt);
					vy *= 0.97;
				} else {
					vx *= 0.992;
				}
			}

			let nx = x + vx * dt;
			let ny = y + vy * dt;

			// Keep inside world walls
			if (nx < 0.45) { nx = 0.45; vx = Math.abs(vx) * 0.3; }
			if (nx > WORLD_W - 0.45) { nx = WORLD_W - 0.45; vx = -Math.abs(vx) * 0.3; }
			if (ny > WORLD_H - 0.3) { ny = WORLD_H - 0.3; vy = -Math.abs(vy) * 0.2; }

			// Solid rock collision check
			const rc = clamp((nx / ROCK_CELL) | 0, 0, ROCK_W - 1);
			const rr = clamp((ny / ROCK_CELL) | 0, 0, ROCK_H - 1);
			if (ny < 0.25 || state.rockSolid[rr * ROCK_W + rc]) {
				// If moving downward onto rock surface, settle cleanly onto floor
				if (vy <= 0) {
					// Check if moving horizontally hit a wall vs. floor
					const rcOld = clamp((x / ROCK_CELL) | 0, 0, ROCK_W - 1);
					const rrNew = clamp((ny / ROCK_CELL) | 0, 0, ROCK_H - 1);
					if (state.rockSolid[rrNew * ROCK_W + rcOld]) {
						// Landed on floor!
						ny = (rrNew + 1) * ROCK_CELL + 0.03;
						// Brief tumble slide if moving fast downslope, otherwise settle to RESTING
						if (Math.abs(vx) > 1.2 && st === DEBRIS_ENTRAINED) {
							vx *= 0.55;
							vy = 0.35;
						} else {
							vx = 0;
							vy = 0;
							st = DEBRIS_RESTING;
						}
					} else {
						// Side bump off step/riffle -> heavy gold traps right in the riffle!
						nx = x;
						vx *= -0.25;
						if (rho > 6.0) {
							vx = 0;
							vy = 0;
							st = DEBRIS_RESTING;
						}
					}
				} else {
					// Ceiling bump
					ny = y;
					vy = -0.2;
				}
			}

			state.dx[i] = nx;
			state.dy[i] = ny;
			state.dvx[i] = vx;
			state.dvy[i] = vy;
			state.dState[i] = st;
		}
	}

	function stepBubblesAndFx(state, dt) {
		let bw = 0;
		for (let i = 0; i < state.bubbleCount; i++) {
			const life = state.bLife[i] - dt;
			if (life <= 0) continue;
			const ph = state.bPhase[i] + dt * 6.5;
			const x = state.bx[i] + (state.bvx[i] + Math.sin(ph) * 0.45) * dt;
			const y = state.by[i] + state.bvy[i] * dt;
			if (y >= WORLD_H - 0.3) continue;
			state.bx[bw] = x;
			state.by[bw] = y;
			state.bvx[bw] = state.bvx[i] * 0.96;
			state.bvy[bw] = state.bvy[i];
			state.bRad[bw] = state.bRad[i];
			state.bLife[bw] = life;
			state.bMaxLife[bw] = state.bMaxLife[i];
			state.bPhase[bw] = ph;
			bw++;
		}
		state.bubbleCount = bw;

		let fw = 0;
		for (let i = 0; i < state.fxCount; i++) {
			const l = state.fxLife[i] - dt;
			if (l <= 0) continue;
			state.fxX[fw] = state.fxX[i];
			state.fxY[fw] = state.fxY[i];
			state.fxLife[fw] = l;
			state.fxKind[fw] = state.fxKind[i];
			fw++;
		}
		state.fxCount = fw;
	}

	function stepPlatform(state, dt, driveDir) {
		const targetVx = driveDir * 6.5;
		state.rigVx += (targetVx - state.rigVx) * Math.min(1, 10 * dt);
		state.rigX = clamp(state.rigX + state.rigVx * dt, 2.2, WORLD_W - 2.2);
		const floorY = rockFloorYAt(state, state.rigX);
		state.rigY += (floorY + 0.45 - state.rigY) * Math.min(1, 12 * dt);
	}

	function stepSimulation(state, dt, driveDir) {
		const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
		const clampedDt = Math.min(dt, 1 / 30);
		state.time += clampedDt;
		state.stepCount++;

		stepPlatform(state, clampedDt, driveDir || 0);
		stepWaterGun(state, clampedDt);
		stepJetDroplets(state, clampedDt);
		stepFluidGrid(state, clampedDt);
		stepUnderPlatformPump(state, clampedDt);
		stepDebrisAndErosion(state, clampedDt);
		stepBubblesAndFx(state, clampedDt);

		if (typeof performance !== 'undefined') {
			state.perfStepMs = state.perfStepMs * 0.85 + (performance.now() - t0) * 0.15;
		}
	}

	function measureMetrics(state) {
		let waterMass = 0, waterHal = 0, waterVit = 0, waterVHal = 0, waterVVit = 0;
		for (let i = 0; i < FLUID_N; i++) {
			waterMass += state.water[i];
			waterHal += state.solHalite[i];
			waterVit += state.solVitriol[i];
			waterVHal += state.solValHal[i];
			waterVVit += state.solValVit[i];
		}
		for (let i = 0; i < state.jetCount; i++) {
			waterMass += state.jMass[i];
			waterHal += state.jHalite[i];
			waterVit += state.jVitriol[i];
			waterVHal += state.jValHal[i];
			waterVVit += state.jValVit[i];
		}

		let debMass = 0, debVal = 0;
		let pureGoldMass = 0, pureGoldVal = 0, pureGoldXSum = 0;
		let qzMass = 0, qzXSum = 0;
		let sandMass = 0, sandXSum = 0;
		let entrainedCount = 0;
		for (let i = 0; i < state.debrisCount; i++) {
			const m = state.dMass[i];
			const v = state.dValue[i];
			debMass += m;
			debVal += v;
			if (state.dState[i] === DEBRIS_ENTRAINED) entrainedCount++;
			if (state.dMin[i] === MIN_PURE_GOLD) {
				pureGoldMass += m;
				pureGoldVal += v;
				pureGoldXSum += state.dx[i] * m;
			} else if (state.dMin[i] === MIN_QUARTZ) {
				qzMass += m;
				qzXSum += state.dx[i] * m;
			} else if (state.dMin[i] === MIN_SAND) {
				sandMass += m;
				sandXSum += state.dx[i] * m;
			}
		}

		const expectedMass = state.totalReactedMass + state.initialDebrisMass;
		const accountedMass =
			waterHal + waterVit +
			state.pumpedHaliteMass + state.pumpedVitriolMass +
			state.lostGasMass +
			debMass + state.archivedDebrisMass;
		const massDrift = Math.abs(expectedMass - accountedMass);

		const expectedValue = state.totalReactedValue + state.initialDebrisValue;
		const accountedValue =
			waterVHal + waterVVit +
			state.pumpedHaliteValue + state.pumpedVitriolValue +
			state.lostGasValue +
			debVal + state.archivedDebrisValue;
		const valueDrift = Math.abs(expectedValue - accountedValue);

		const waterDrift = Math.abs(state.waterFlooded - (waterMass + state.waterPumped));

		return {
			waterMass,
			waterSoluteMass: waterHal + waterVit,
			waterSoluteValue: waterVHal + waterVVit,
			waterHaliteMass: waterHal,
			waterVitriolMass: waterVit,
			pumpedHaliteMass: state.pumpedHaliteMass,
			pumpedHaliteValue: state.pumpedHaliteValue,
			pumpedVitriolMass: state.pumpedVitriolMass,
			pumpedVitriolValue: state.pumpedVitriolValue,
			lostGasMass: state.lostGasMass,
			lostGasValue: state.lostGasValue,
			debrisCount: state.debrisCount,
			debrisMass: debMass,
			debrisValue: debVal,
			pureGoldMass,
			pureGoldValue: pureGoldVal,
			meanGoldX: pureGoldMass > 0 ? pureGoldXSum / pureGoldMass : 0,
			meanQuartzX: qzMass > 0 ? qzXSum / qzMass : 0,
			meanSandX: sandMass > 0 ? sandXSum / sandMass : 0,
			entrainedCount,
			erosionHopEvents: state.erosionHopEvents,
			goldPanEvents: state.goldPanEvents,
			cellsDissolved: state.cellsDissolved,
			cellsMechBroken: state.cellsMechBroken,
			massDrift,
			valueDrift,
			waterDrift
		};
	}

	// Cursor tools (pour water, drop gold-quartz rubble, drop mixed rubble, carve rock)
	function applyCursorTool(state, wx, wy, tool, dt) {
		const rng = state.rng;
		if (tool === 'pour') {
			const count = Math.max(1, Math.round(40 * dt));
			for (let i = 0; i < count; i++) {
				const m = 0.14;
				state.waterFlooded += m;
				depositToNearestFluid(state, wx + (rng() - 0.5) * 0.6, wy + (rng() - 0.5) * 0.4, m, 0, 0, 0, 0);
			}
		} else if (tool === 'gold-rubble') {
			const count = Math.max(1, Math.round(14 * dt));
			for (let i = 0; i < count; i++) {
				const mass = 0.55;
				spawnDebris(
					state,
					wx + (rng() - 0.5) * 0.6,
					wy + (rng() - 0.5) * 0.3,
					(rng() - 0.5) * 0.8,
					-0.4,
					MIN_GOLD,
					mass,
					mass * MINERALS[MIN_GOLD].price,
					DEBRIS_FALLING,
					true
				);
			}
		} else if (tool === 'mixed-rubble') {
			const count = Math.max(1, Math.round(18 * dt));
			const picks = [MIN_GOLD, MIN_QUARTZ, MIN_SAND, MIN_COPPER, MIN_IRON, MIN_STONE];
			for (let i = 0; i < count; i++) {
				const minIdx = picks[(rng() * picks.length) | 0];
				const mass = 0.55;
				spawnDebris(
					state,
					wx + (rng() - 0.5) * 0.7,
					wy + (rng() - 0.5) * 0.3,
					(rng() - 0.5) * 1.1,
					-0.5,
					minIdx,
					mass,
					mass * MINERALS[minIdx].price,
					DEBRIS_FALLING,
					true
				);
			}
		} else if (tool === 'carve') {
			const cx = (wx / ROCK_CELL) | 0;
			const cy = (wy / ROCK_CELL) | 0;
			const rad = 4;
			for (let dr = -rad; dr <= rad; dr++) {
				for (let dc = -rad; dc <= rad; dc++) {
					if (dc * dc + dr * dr > rad * rad) continue;
					const c = cx + dc, r = cy + dr;
					if (c > 2 && c < ROCK_W - 3 && r > 2 && r < ROCK_H - 2 && state.rockSolid[r * ROCK_W + c]) {
						clearRockCell(state, c, r);
						state.rockDirty = true;
					}
				}
			}
			rebuildSolidMask(state);
		}
	}

	// =========================================================================
	// BROWSER RENDERER & INTERACTIVE UI (guarded for headless Node testing)
	// =========================================================================

	function initBrowser() {
		if (typeof document === 'undefined') return null;
		const canvas = document.getElementById('stage');
		if (!canvas) return null;
		const ctx = canvas.getContext('2d');
		const state = createSimulation({ scene: 'columns', model: 'table', seed: 37 });

		// Offscreen rock buffer (192 x 120) — repainted only when rockDirty === true!
		const rockCanvas = document.createElement('canvas');
		rockCanvas.width = ROCK_W;
		rockCanvas.height = ROCK_H;
		const rockCtx = rockCanvas.getContext('2d');
		const rockImg = rockCtx.createImageData(ROCK_W, ROCK_H);

		// Offscreen solute color tint grid (96 x 60) + half-res masked water layer (480 x 300)
		// Avoids ctx.clip() entirely while delivering silky smooth multi-color green/blue gradients!
		const tintCanvas = document.createElement('canvas');
		tintCanvas.width = FLUID_W;
		tintCanvas.height = FLUID_H;
		const tintCtx = tintCanvas.getContext('2d');
		const tintImg = tintCtx.createImageData(FLUID_W, FLUID_H);

		const waterLayer = document.createElement('canvas');
		waterLayer.width = 480;
		waterLayer.height = 300;
		const wCtx = waterLayer.getContext('2d');

		// Marching Squares tables (preallocated once)
		const MS_EDGES = [
			[], [3, 0], [0, 1], [3, 1],
			[1, 2], [3, 0, 1, 2], [0, 2], [3, 2],
			[2, 3], [2, 0], [0, 1, 2, 3], [2, 1],
			[1, 3], [1, 0], [0, 3], []
		];

		function paintRockBuffer() {
			const data = rockImg.data;
			const mode = state.viewMode;
			const chem = state._chem;
			const hiMin = state.highlightMineral;

			for (let r = 0; r < ROCK_H; r++) {
				const py = ROCK_H - 1 - r; // y=0 bottom -> image bottom
				for (let c = 0; c < ROCK_W; c++) {
					const idx = r * ROCK_W + c;
					const p = (py * ROCK_W + c) * 4;
					if (!state.rockSolid[idx]) {
						data[p] = 0; data[p + 1] = 0; data[p + 2] = 0; data[p + 3] = 0;
						continue;
					}
					const hash = (((c * 374761393 + r * 668265263) ^ (c * 1274126177)) >>> 24) / 255;
					const shade = 0.88 + hash * 0.22;
					let rr, gg, bb;

					if (mode === 'elements') {
						rr = state.rockR[idx] * 245;
						gg = state.rockG[idx] * 245;
						bb = state.rockB[idx] * 245;
					} else if (mode === 'solubility') {
						evaluateCellChemistry(state, idx, chem);
						const dom = state.rockMineral[idx];
						if (chem.gas > 0.20) {
							// Gas loss warning (coral-red / mint fizz)
							rr = 232 * chem.gas + 90 * chem.halite;
							gg = 88 + 145 * chem.halite;
							bb = 94;
						} else if (chem.vitriol > 0.20) {
							rr = 36; gg = 132 + 55 * chem.vitriol; bb = 250;
						} else if (chem.halite > 0.20 && chem.solid > 0.25) {
							// Partial leach / split (bright sea-teal)
							rr = 56; gg = 205; bb = 178;
						} else if (chem.halite > 0.20) {
							// Pure green salt
							rr = 64; gg = 236; bb = 134;
						} else if (dom === MIN_GOLD) {
							rr = 252; gg = 206; bb = 48;
						} else if (dom === MIN_SAND) {
							rr = 198; gg = 162; bb = 98;
						} else {
							// Insoluble dark slate
							rr = 42; gg = 52; bb = 58;
						}
					} else {
						// Natural mineral mixture blend!
						const off = idx * GEO_MINERAL_COUNT;
						rr = 0; gg = 0; bb = 0;
						for (let m = 0; m < GEO_MINERAL_COUNT; m++) {
							const w = state.rockMix[off + m];
							if (w <= 0.001) continue;
							const col = MINERALS[m].color;
							rr += w * col[0];
							gg += w * col[1];
							bb += w * col[2];
						}
					}

					// Highlight selected mineral row
					if (hiMin >= 0 && state.rockMineral[idx] === hiMin) {
						rr = Math.min(255, rr * 1.25 + 32);
						gg = Math.min(255, gg * 1.25 + 32);
						bb = Math.min(255, bb * 1.25 + 32);
					}

					// Wet etching glow on dissolving surface cells!
					const prog = state.rockDissolve[idx];
					if (prog > 0.04) {
						const glow = Math.min(1, prog) * 0.55;
						rr = rr * (1 - glow) + 185 * glow;
						gg = gg * (1 - glow) + 250 * glow;
						bb = bb * (1 - glow) + 255 * glow;
					}

					// Subtle darkening away from air boundary for cave depth
					const edge = isRockBoundary(state, c, r) ? 1.08 : 0.94;
					data[p] = clamp(rr * shade * edge, 0, 255);
					data[p + 1] = clamp(gg * shade * edge, 0, 255);
					data[p + 2] = clamp(bb * shade * edge, 0, 255);
					data[p + 3] = 255;
				}
			}
			rockCtx.putImageData(rockImg, 0, 0);
			state.rockDirty = false;
		}

		function wxToPx(x) { return (x / WORLD_W) * canvas.width; }
		function wyToPy(y) { return canvas.height - (y / WORLD_H) * canvas.height; }

		function renderWater() {
			const W = FLUID_W, H = FLUID_H;
			const water = state.water;
			const solH = state.solHalite;
			const solV = state.solVitriol;
			const tData = tintImg.data;

			// 1. Build smooth per-cell solute color texture (fresh cyan -> emerald Halite -> cobalt Blue Vitriol!)
			let anyWater = false;
			for (let fr = 0; fr < H; fr++) {
				const ty = H - 1 - fr;
				for (let fc = 0; fc < W; fc++) {
					const idx = fr * W + fc;
					const w = water[idx];
					const p = (ty * W + fc) * 4;
					if (w > 0.015) anyWater = true;

					// Neighborhood average for silky seamless solute gradients
					let wSum = w, hSum = solH[idx], vSum = solV[idx];
					if (fc > 0 && water[idx - 1] > 0.01) { wSum += water[idx - 1] * 0.5; hSum += solH[idx - 1] * 0.5; vSum += solV[idx - 1] * 0.5; }
					if (fc + 1 < W && water[idx + 1] > 0.01) { wSum += water[idx + 1] * 0.5; hSum += solH[idx + 1] * 0.5; vSum += solV[idx + 1] * 0.5; }
					if (fr > 0 && water[idx - W] > 0.01) { wSum += water[idx - W] * 0.5; hSum += solH[idx - W] * 0.5; vSum += solV[idx - W] * 0.5; }
					if (fr + 1 < H && water[idx + W] > 0.01) { wSum += water[idx + W] * 0.5; hSum += solH[idx + W] * 0.5; vSum += solV[idx + W] * 0.5; }

					const denom = Math.max(0.18, wSum);
					const cHal = clamp((hSum / denom) * 1.45, 0, 1); // +G emerald green
					const cVit = clamp((vSum / denom) * 1.55, 0, 1); // +GB cobalt blue

					// Fresh water base: (44, 162, 214)
					let r = 44, g = 162, b = 214;
					// Halite shifts strongly toward vivid luminous emerald green (34, 232, 128)
					r += (34 - r) * cHal;
					g += (232 - g) * cHal;
					b += (124 - b) * cHal;
					// Blue Vitriol shifts strongly toward rich royal cobalt blue (30, 88, 250)
					r += (30 - r) * cVit;
					g += (92 - g) * cVit;
					b += (252 - b) * cVit;

					// Slight depth darkening for rich fluid volume
					const depthShade = 1.0 - Math.min(0.24, w * 0.18);
					tData[p] = clamp(r * depthShade, 0, 255);
					tData[p + 1] = clamp(g * depthShade, 0, 255);
					tData[p + 2] = clamp(b * depthShade, 0, 255);
					tData[p + 3] = 216;
				}
			}
			if (!anyWater) return;
			tintCtx.putImageData(tintImg, 0, 0);

			// 2. Build unified smooth Marching Squares water polygon on half-res waterLayer (ZERO ctx.clip()!)
			const lw = waterLayer.width, lh = waterLayer.height;
			const cellPx = lw / W; // 5 px
			wCtx.clearRect(0, 0, lw, lh);
			wCtx.globalCompositeOperation = 'source-over';
			wCtx.fillStyle = '#ffffff';

			const iso = 0.16;
			wCtx.beginPath();
			for (let r = 0; r < H; r++) {
				for (let c = 0; c < W; c++) {
					const w = water[r * W + c];
					if (w < 0.04) continue;
					const x0 = c * cellPx;
					const yBot = lh - r * cellPx;
					const fillH = Math.min(1.0, w / 0.85) * cellPx;
					// Smooth vertical cap + full fill for deep submerged cells
					if (w >= iso && r + 1 < H && water[(r + 1) * W + c] >= iso) {
						wCtx.rect(x0 - 0.3, yBot - cellPx - 0.3, cellPx + 0.6, cellPx + 0.6);
					} else {
						wCtx.rect(x0 - 0.25, yBot - fillH - 0.2, cellPx + 0.5, fillH + 0.5);
					}
				}
			}
			wCtx.fill();

			// Mask the smooth solute gradient directly into the water silhouette via source-in!
			wCtx.globalCompositeOperation = 'source-in';
			wCtx.imageSmoothingEnabled = true;
			wCtx.drawImage(tintCanvas, 0, 0, lw, lh);
			wCtx.globalCompositeOperation = 'source-over';

			// Composite water layer onto main canvas ONCE
			ctx.save();
			ctx.imageSmoothingEnabled = true;
			ctx.drawImage(waterLayer, 0, 0, canvas.width, canvas.height);

			// 3. Crisp bright surface meniscus contour + sparse jittered flow shimmer
			const sx = canvas.width / W;
			const sy = canvas.height / H;
			ctx.lineWidth = 2.0;
			ctx.strokeStyle = 'rgba(195, 245, 255, 0.72)';
			ctx.beginPath();
			for (let r = 0; r < H - 1; r++) {
				for (let c = 0; c < W - 1; c++) {
					const a = water[r * W + c];
					const b = water[r * W + c + 1];
					const d = water[(r + 1) * W + c + 1];
					const e = water[(r + 1) * W + c];
					const mask = (a >= iso ? 1 : 0) | (b >= iso ? 2 : 0) | (d >= iso ? 4 : 0) | (e >= iso ? 8 : 0);
					if (mask === 0 || mask === 15) continue;
					// Skip internal rock-wall interfaces so highlight hugs the free water-air meniscus
					const solidEdge = state.solidMask[r * W + c] || state.solidMask[r * W + c + 1] ||
						state.solidMask[(r + 1) * W + c] || state.solidMask[(r + 1) * W + c + 1];
					if (solidEdge) continue;

					const edges = MS_EDGES[mask];
					const x0 = (c + 0.5) * sx;
					const y0 = canvas.height - (r + 0.5) * sy;
					for (let k = 0; k < edges.length; k += 2) {
						const p1 = edgePt(edges[k], x0, y0, sx, sy, a, b, d, e, iso);
						const p2 = edgePt(edges[k + 1], x0, y0, sx, sy, a, b, d, e, iso);
						ctx.moveTo(p1[0], p1[1]);
						ctx.lineTo(p2[0], p2[1]);
					}
				}
			}
			ctx.stroke();

			// Sparse jittered flow streaks inside moving water
			ctx.lineWidth = 1.25;
			ctx.strokeStyle = 'rgba(220, 252, 255, 0.28)';
			ctx.beginPath();
			for (let r = 0; r < H; r++) {
				for (let c = 0; c < W; c++) {
					if (((c * 7 + r * 13) & 3) !== 0) continue;
					const idx = r * W + c;
					if (water[idx] < 0.22) continue;
					const u = state.velU[idx];
					if (Math.abs(u) < 0.7) continue;
					const jitter = ((c * 17 + r * 29) & 7) * 0.11;
					const px = (c + 0.2 + jitter * 0.6) * sx;
					const py = canvas.height - (r + 0.35 + jitter * 0.4) * sy;
					const len = clamp(u * 2.4, -12, 12);
					ctx.moveTo(px, py);
					ctx.lineTo(px + len, py);
				}
			}
			ctx.stroke();
			ctx.restore();
		}

		const _ptA = [0, 0], _ptB = [0, 0];
		let _ptToggle = 0;
		function edgePt(edge, x0, y0, sx, sy, a, b, d, e, iso) {
			const out = (_ptToggle ^= 1) ? _ptA : _ptB;
			if (edge === 0) {
				const t = clamp((iso - a) / (b - a || 1e-5), 0.1, 0.9);
				out[0] = x0 + t * sx; out[1] = y0;
			} else if (edge === 1) {
				const t = clamp((iso - b) / (d - b || 1e-5), 0.1, 0.9);
				out[0] = x0 + sx; out[1] = y0 - t * sy;
			} else if (edge === 2) {
				const t = clamp((iso - e) / (d - e || 1e-5), 0.1, 0.9);
				out[0] = x0 + t * sx; out[1] = y0 - sy;
			} else {
				const t = clamp((iso - a) / (e - a || 1e-5), 0.1, 0.9);
				out[0] = x0; out[1] = y0 - t * sy;
			}
			return out;
		}

		function renderJets() {
			for (let i = 0; i < state.jetCount; i++) {
				const px = wxToPx(state.jx[i]);
				const py = wyToPy(state.jy[i]);
				const vx = state.jvx[i];
				const vy = state.jvy[i];
				const m = Math.max(0.05, state.jMass[i]);
				const cHal = clamp((state.jHalite[i] / m) * 1.6, 0, 1);
				const cVit = clamp((state.jVitriol[i] / m) * 1.6, 0, 1);

				let r = 110, g = 212, b = 248;
				if (cHal > 0.05) { r = 74; g = 240; b = 152; }
				if (cVit > 0.05) { r = 68; g = 148; b = 255; }
				ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.88)';
				ctx.lineWidth = state.jKind[i] === 0 ? 3.2 : 2.6;
				ctx.lineCap = 'round';
				ctx.beginPath();
				ctx.moveTo(px, py);
				ctx.lineTo(px - vx * 0.72, py + vy * 0.72);
				ctx.stroke();
			}
		}

		function renderDebris() {
			for (let i = 0; i < state.debrisCount; i++) {
				const px = wxToPx(state.dx[i]);
				const py = wyToPy(state.dy[i]);
				const minIdx = state.dMin[i];
				const def = MINERALS[minIdx] || MINERALS[MIN_STONE];
				const col = def.color;
				const st = state.dState[i];

				// Subtle saltation hop arc behind actively ENTRAINED grains!
				if (st === DEBRIS_ENTRAINED) {
					ctx.strokeStyle = 'rgba(230, 248, 255, 0.55)';
					ctx.lineWidth = 1.2;
					ctx.beginPath();
					ctx.moveTo(px, py);
					ctx.lineTo(px - state.dvx[i] * 2.2, py + state.dvy[i] * 1.8);
					ctx.stroke();
				}

				if (minIdx === MIN_PURE_GOLD) {
					// Gleaming liberated Pure Gold nugget!
					ctx.fillStyle = '#ffd724';
					ctx.strokeStyle = '#fff6bf';
					ctx.lineWidth = 1.1;
					ctx.beginPath();
					ctx.moveTo(px, py - 4.2);
					ctx.lineTo(px + 3.8, py);
					ctx.lineTo(px, py + 3.6);
					ctx.lineTo(px - 3.8, py);
					ctx.closePath();
					ctx.fill();
					ctx.stroke();
				} else if (minIdx === MIN_GOLD) {
					// Composite Gold-bearing quartz lump (milky quartz + gold fleck)
					ctx.fillStyle = '#d4d0de';
					ctx.fillRect(px - 3.0, py - 3.0, 6.0, 6.0);
					ctx.fillStyle = '#ffd238';
					ctx.fillRect(px - 1.4, py - 1.4, 3.0, 3.0);
				} else {
					const sz = minIdx === MIN_SAND ? 2.4 : 3.0;
					ctx.fillStyle = 'rgb(' + col[0] + ',' + col[1] + ',' + col[2] + ')';
					ctx.fillRect(px - sz, py - sz, sz * 2, sz * 2);
					if (st === DEBRIS_ENTRAINED) {
						ctx.strokeStyle = 'rgba(255,255,255,0.45)';
						ctx.lineWidth = 0.8;
						ctx.strokeRect(px - sz, py - sz, sz * 2, sz * 2);
					}
				}
			}
		}

		function renderBubblesAndFx() {
			// Rising escaped gas bubbles (unmistakable gas loss feedback!)
			for (let i = 0; i < state.bubbleCount; i++) {
				const px = wxToPx(state.bx[i]);
				const py = wyToPy(state.by[i]);
				const alpha = clamp(state.bLife[i] / state.bMaxLife[i], 0, 1);
				const r = state.bRad[i] * (canvas.width / WORLD_W);
				ctx.beginPath();
				ctx.arc(px, py, r, 0, Math.PI * 2);
				ctx.fillStyle = 'rgba(220, 255, 224,' + (alpha * 0.34).toFixed(2) + ')';
				ctx.fill();
				ctx.lineWidth = 1.2;
				ctx.strokeStyle = 'rgba(235, 255, 232,' + (alpha * 0.85).toFixed(2) + ')';
				ctx.stroke();
			}

			// Reaction flashes & Gold liberation glints
			for (let i = 0; i < state.fxCount; i++) {
				const px = wxToPx(state.fxX[i]);
				const py = wyToPy(state.fxY[i]);
				const a = clamp(state.fxLife[i] / 0.35, 0, 1);
				const k = state.fxKind[i];
				if (k === 3) {
					// Bright golden star glint when Pure Gold separates from Quartz!
					ctx.strokeStyle = 'rgba(255, 228, 86,' + a.toFixed(2) + ')';
					ctx.lineWidth = 1.8;
					const rad = 4 + (1 - a) * 9;
					ctx.beginPath();
					ctx.moveTo(px - rad, py); ctx.lineTo(px + rad, py);
					ctx.moveTo(px, py - rad); ctx.lineTo(px, py + rad);
					ctx.stroke();
				} else {
					const col = k === 1 ? '68,162,255' : (k === 2 ? '255,148,132' : '86,238,148');
					ctx.beginPath();
					ctx.arc(px, py, 3 + (1 - a) * 6, 0, Math.PI * 2);
					ctx.strokeStyle = 'rgba(' + col + ',' + (a * 0.75).toFixed(2) + ')';
					ctx.lineWidth = 1.3;
					ctx.stroke();
				}
			}
		}

		function renderPlatform() {
			const px = wxToPx(state.rigX);
			const py = wyToPy(state.rigY);
			const hw = state.rigHalfW * (canvas.width / WORLD_W);

			// Under-platform suction intake field glow
			if (state.pumpOn) {
				const grad = ctx.createLinearGradient(px, py + 8, px, py + 50);
				grad.addColorStop(0, 'rgba(86, 204, 242, 0.34)');
				grad.addColorStop(1, 'rgba(86, 204, 242, 0.0)');
				ctx.fillStyle = grad;
				ctx.fillRect(px - hw * 0.9, py + 8, hw * 1.8, 42);
			}

			// Chassis body
			ctx.fillStyle = '#253840';
			ctx.strokeStyle = '#6ea0af';
			ctx.lineWidth = 1.6;
			ctx.beginPath();
			ctx.roundRect(px - hw, py - 10, hw * 2, 20, 4);
			ctx.fill();
			ctx.stroke();

			// Live dissolved cargo sight-glasses on rig chassis (Green Halite + Blue Vitriol!)
			const halFill = clamp(state.pumpedHaliteMass / 35, 0, 1);
			const vitFill = clamp(state.pumpedVitriolMass / 35, 0, 1);
			ctx.fillStyle = '#0c161a';
			ctx.fillRect(px - hw + 8, py - 5, hw - 14, 9);
			ctx.fillRect(px + 6, py - 5, hw - 14, 9);
			ctx.fillStyle = '#4be68e';
			ctx.fillRect(px - hw + 8, py - 5, (hw - 14) * halFill, 9);
			ctx.fillStyle = '#439aff';
			ctx.fillRect(px + 6, py - 5, (hw - 14) * vitFill, 9);

			// Rotating water gun nozzle
			const nozX = px;
			const nozY = py - 14;
			const ang = Math.atan2(wyToPy(state.aimY) - nozY, wxToPx(state.aimX) - nozX);
			ctx.save();
			ctx.translate(nozX, nozY);
			ctx.rotate(ang);
			ctx.fillStyle = '#56ccf2';
			ctx.fillRect(0, -3.5, 22, 7);
			ctx.fillStyle = '#d8f7ff';
			ctx.fillRect(18, -2, 6, 4);
			ctx.restore();

			// Aim crosshair reticle
			const ax = wxToPx(state.aimX);
			const ay = wyToPy(state.aimY);
			ctx.strokeStyle = 'rgba(185, 237, 145, 0.55)';
			ctx.lineWidth = 1.2;
			ctx.beginPath();
			ctx.arc(ax, ay, 7, 0, Math.PI * 2);
			ctx.moveTo(ax - 11, ay); ctx.lineTo(ax - 4, ay);
			ctx.moveTo(ax + 4, ay); ctx.lineTo(ax + 11, ay);
			ctx.moveTo(ax, ay - 11); ctx.lineTo(ax, ay - 4);
			ctx.moveTo(ax, ay + 4); ctx.lineTo(ax, ay + 11);
			ctx.stroke();
		}

		function renderSceneAnnotations() {
			ctx.save();
			ctx.font = '600 10px ui-monospace, monospace';
			ctx.textAlign = 'center';

			if (state.scene === 'columns') {
				const usableCols = ROCK_W - 8;
				const colW = usableCols / TEST_COLUMNS.length;
				for (let i = 0; i < TEST_COLUMNS.length; i++) {
					const minIdx = TEST_COLUMNS[i];
					const def = MINERALS[minIdx];
					const cx = wxToPx((4 + (i + 0.5) * colW) * ROCK_CELL);
					ctx.fillStyle = 'rgba(10, 18, 22, 0.78)';
					ctx.fillRect(cx - 30, 10, 60, 26);
					ctx.fillStyle = 'rgb(' + def.color[0] + ',' + def.color[1] + ',' + def.color[2] + ')';
					ctx.fillText(def.symbol, cx, 22);
					ctx.fillStyle = '#9bb0b4';
					ctx.font = '9px ui-monospace, monospace';
					const shortTag = def.solVitriol > 0 ? '+GB' : (def.gasLoss > 0 ? 'GAS!' : (def.solHalite > 0 ? '+G' : (minIdx === MIN_GOLD ? 'PAN' : (minIdx === MIN_SAND ? 'WASH' : 'HARD'))));
					ctx.fillText(shortTag, cx, 33);
					ctx.font = '600 10px ui-monospace, monospace';
				}
			} else if (state.scene === 'placer') {
				ctx.fillStyle = 'rgba(10, 18, 22, 0.78)';
				ctx.fillRect(260, 315, 265, 22);
				ctx.fillStyle = '#ffe075';
				ctx.fillText('RIFFLES: HEAVY PURE GOLD STAYS HERE', 392, 329);

				ctx.fillStyle = 'rgba(10, 18, 22, 0.78)';
				ctx.fillRect(675, 420, 225, 22);
				ctx.fillStyle = '#d6d4e0';
				ctx.fillText('TAILINGS: LIGHT QZ + SAND WASH HERE', 787, 434);
			} else if (state.scene === 'karst') {
				const labels = [
					[5.2, 13.7, 'BLUE VITRIOL (+GB)', '#7bc0ff'],
					[11.4, 13.7, 'FIZZY HALITE (+G / GAS LOST!)', '#ff9d8f'],
					[17.6, 13.7, 'HALITE + COPPER (SPLIT)', '#7ef0a9']
				];
				for (let i = 0; i < labels.length; i++) {
					const px = wxToPx(labels[i][0]);
					const py = wyToPy(labels[i][1]);
					ctx.fillStyle = 'rgba(10, 18, 22, 0.78)';
					ctx.fillRect(px - 88, py - 11, 176, 18);
					ctx.fillStyle = labels[i][3];
					ctx.fillText(labels[i][2], px, py + 1);
				}
			}
			ctx.restore();
		}

		function draw() {
			const t0 = performance.now();
			if (state.rockDirty) paintRockBuffer();

			// Dark subterranean backdrop with subtle metric grid
			ctx.fillStyle = '#081014';
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			ctx.strokeStyle = 'rgba(42, 62, 70, 0.25)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			for (let m = 2; m < WORLD_W; m += 2) {
				const x = wxToPx(m);
				ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height);
			}
			for (let m = 2; m < WORLD_H; m += 2) {
				const y = wyToPy(m);
				ctx.moveTo(0, y); ctx.lineTo(canvas.width, y);
			}
			ctx.stroke();

			// Crisp rock layer
			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(rockCanvas, 0, 0, canvas.width, canvas.height);

			// Fluid, ballistic stream, debris, bubbles, rig, annotations
			renderWater();
			renderJets();
			renderDebris();
			renderBubblesAndFx();
			renderPlatform();
			renderSceneAnnotations();

			state.perfDrawMs = state.perfDrawMs * 0.85 + (performance.now() - t0) * 0.15;
		}

		// --- Build Mineral Chemistry Table ---
		const tbody = document.getElementById('chem-tbody');
		function buildChemTable() {
			if (!tbody) return;
			tbody.innerHTML = '';
			for (let i = 0; i < MINERALS.length; i++) {
				const m = MINERALS[i];
				const tr = document.createElement('tr');
				tr.dataset.mineral = String(i);
				const sw = 'rgb(' + m.color[0] + ',' + m.color[1] + ',' + m.color[2] + ')';
				tr.innerHTML =
					'<td><span class="swatch-pill" style="background:' + sw + '"></span><b>' + m.name + '</b> <span style="color:#7c9196">(' + m.symbol + ')</span></td>' +
					'<td>' + m.octant + '</td>' +
					'<td>' + m.strength.toFixed(1) + ' J</td>' +
					'<td>' + m.density.toFixed(1) + '</td>' +
					'<td><span class="tag tag-' + m.tag + '">' + m.reactionLabel + '</span></td>' +
					'<td>' + m.tintLabel + '</td>' +
					'<td>' + m.erosionLabel + '</td>' +
					'<td>' + m.price.toFixed(2) + ' cr</td>';
				tr.addEventListener('click', function () {
					state.highlightMineral = state.highlightMineral === i ? -1 : i;
					state.rockDirty = true;
					tbody.querySelectorAll('tr').forEach(function (row) {
						row.classList.toggle('is-highlight', Number(row.dataset.mineral) === state.highlightMineral);
					});
					// In Mineral Columns scene, also aim straight at that column!
					const colIdx = TEST_COLUMNS.indexOf(i);
					if (state.scene === 'columns' && colIdx >= 0) {
						const colW = (ROCK_W - 8) / TEST_COLUMNS.length;
						state.aimX = (4 + (colIdx + 0.5) * colW) * ROCK_CELL;
						state.aimY = 10.2;
					}
				});
				tbody.appendChild(tr);
			}
		}
		buildChemTable();

		// --- Cell Chemistry Hover Inspector ---
		const inspEl = document.getElementById('inspector');
		const inspCoordEl = document.getElementById('insp-coord');
		function updateInspector(wx, wy) {
			if (!inspEl) return;
			const rc = clamp((wx / ROCK_CELL) | 0, 0, ROCK_W - 1);
			const rr = clamp((wy / ROCK_CELL) | 0, 0, ROCK_H - 1);
			const rIdx = rr * ROCK_W + rc;
			const fc = clamp((wx / FLUID_CELL) | 0, 0, FLUID_W - 1);
			const fr = clamp((wy / FLUID_CELL) | 0, 0, FLUID_H - 1);
			const fIdx = fr * FLUID_W + fc;
			if (inspCoordEl) inspCoordEl.textContent = wx.toFixed(1) + 'm, ' + wy.toFixed(1) + 'm';

			if (state.rockSolid[rIdx]) {
				const dom = state.rockMineral[rIdx];
				const def = MINERALS[dom];
				const chem = evaluateCellChemistry(state, rIdx, state._chem);
				const rVal = state.rockR[rIdx], gVal = state.rockG[rIdx], bVal = state.rockB[rIdx];
				const sw = 'rgb(' + def.color[0] + ',' + def.color[1] + ',' + def.color[2] + ')';
				inspEl.innerHTML =
					'<div class="insp-head"><span><span class="insp-swatch" style="background:' + sw + '"></span>' + def.name + ' (' + def.analog + ')</span><span class="tag tag-' + def.tag + '">' + (chem.solubility > 0 ? Math.round(chem.solubility * 100) + '% reactive' : 'Insoluble') + '</span></div>' +
					'<div class="rgb-bars">' +
						'<div class="rgb-bar">R Metal ' + rVal.toFixed(2) + '<div class="bar-track"><div class="bar-fill" style="width:' + Math.round(rVal * 100) + '%;background:#e06c58"></div></div></div>' +
						'<div class="rgb-bar">G Crystal ' + gVal.toFixed(2) + '<div class="bar-track"><div class="bar-fill" style="width:' + Math.round(gVal * 100) + '%;background:#5ee293"></div></div></div>' +
						'<div class="rgb-bar">B Gas ' + bVal.toFixed(2) + '<div class="bar-track"><div class="bar-fill" style="width:' + Math.round(bVal * 100) + '%;background:#52a4ff"></div></div></div>' +
					'</div>' +
					'<div class="insp-kv">' +
						'<span>Halite (+G): <b>' + Math.round(chem.halite * 100) + '%</b></span>' +
						'<span>Vitriol (+GB): <b>' + Math.round(chem.vitriol * 100) + '%</b></span>' +
						'<span>Gas Lost: <b style="color:#f07b6e">' + Math.round(chem.gas * 100) + '%</b></span>' +
						'<span>Solid Residue: <b>' + Math.round(chem.solid * 100) + '%</b></span>' +
						'<span>Strength: <b>' + state.rockMechHp[rIdx].toFixed(1) + ' J</b></span>' +
						'<span>Density ρ: <b>' + chem.density.toFixed(1) + '</b> · ' + state.rockValue[rIdx].toFixed(2) + ' cr</span>' +
					'</div>';
				return;
			}

			// Check nearby debris grain first
			for (let i = 0; i < state.debrisCount; i++) {
				if (Math.hypot(state.dx[i] - wx, state.dy[i] - wy) < 0.35) {
					const dMin = MINERALS[state.dMin[i]];
					const stName = state.dState[i] === DEBRIS_ENTRAINED ? 'ENTRAINED (hopping)' : (state.dState[i] === DEBRIS_FALLING ? 'FALLING' : 'RESTING');
					inspEl.innerHTML =
						'<div class="insp-head"><span>Debris: ' + dMin.name + '</span><span class="tag tag-' + dMin.tag + '">' + stName + '</span></div>' +
						'<div class="insp-kv">' +
							'<span>Mass: <b>' + state.dMass[i].toFixed(2) + '</b></span>' +
							'<span>Value: <b>' + state.dValue[i].toFixed(2) + ' cr</b></span>' +
							'<span>Density ρ: <b>' + state.dDensity[i].toFixed(1) + '</b></span>' +
							'<span>Saltation hops: <b>' + state.dHops[i] + '</b></span>' +
						'</div>';
					return;
				}
			}

			const w = state.water[fIdx];
			if (w > 0.02) {
				inspEl.innerHTML =
					'<div class="insp-head"><span>Fluid Pool Cell</span><span class="tag tag-blue">Depth ' + w.toFixed(2) + '</span></div>' +
					'<div class="insp-kv">' +
						'<span>Flow |u|: <b>' + Math.hypot(state.velU[fIdx], state.velV[fIdx]).toFixed(2) + ' m/s</b></span>' +
						'<span>Solute Value: <b>' + (state.solValHal[fIdx] + state.solValVit[fIdx]).toFixed(2) + ' cr</b></span>' +
						'<span>Halite (+G): <b style="color:#5ee293">' + state.solHalite[fIdx].toFixed(2) + '</b></span>' +
						'<span>Vitriol (+GB): <b style="color:#4aa3ff">' + state.solVitriol[fIdx].toFixed(2) + '</b></span>' +
					'</div>';
				return;
			}

			inspEl.textContent = 'Open cavern air — hover over any mineral seam, dissolved pool, or debris grain to inspect its (R, G, B) chemistry.';
		}

		// --- UI Wiring ---
		function updateHeadings() {
			const sceneTitle = {
				columns: 'MINERAL COLUMNS',
				geology: 'REAL (R,G,B) GEOLOGY SEAMS (SEED ' + state.seed + ')',
				placer: 'GOLD PLACER SLUICE (HYDRO-EROSION)',
				karst: 'KARST CAVE PLAYGROUND'
			}[state.scene];
			const modelTitle = state.model === 'table' ? 'MINERAL TABLE (13)' : 'COMPOSITION LAW f(R,G,B)';
			const h = document.getElementById('stage-heading');
			if (h) h.textContent = sceneTitle + ' · 24 × 15 m · ' + modelTitle;

			const notes = document.getElementById('mode-notes');
			if (notes) {
				notes.textContent = state.model === 'table'
					? 'Mineral Table mode: cell mixes from js/geology.js drive exact per-mineral reactions — Halite (+G green), Blue Vitriol (+GB blue), Fizzy Halite (+G + lost gas), Fluorite (+G + Qz debris), and Gold-Qz placer panning.'
					: 'Composition Law f(R,G,B) mode: pure continuous formula from (R Metal, G Crystal, B Gas) — ionic R·G salt, hydrated R·B vitriol, excess B degassing (>0.56), and density ρ(R,B).';
			}
		}

		function bindGroup(id, attr, cb) {
			const group = document.getElementById(id);
			if (!group) return;
			group.addEventListener('click', function (ev) {
				const btn = ev.target.closest('button[data-' + attr + ']');
				if (!btn) return;
				group.querySelectorAll('button').forEach(function (b) { b.classList.remove('is-active'); });
				btn.classList.add('is-active');
				cb(btn.getAttribute('data-' + attr));
			});
		}

		bindGroup('scene-buttons', 'scene', function (sc) {
			loadScene(state, sc);
			updateHeadings();
		});
		bindGroup('model-buttons', 'model', function (md) {
			state.model = md;
			state.rockDirty = true;
			updateHeadings();
		});
		bindGroup('tool-buttons', 'tool', function (tl) {
			state.tool = tl;
		});

		document.getElementById('view-modes').addEventListener('change', function (ev) {
			if (ev.target && ev.target.name === 'view-mode') {
				state.viewMode = ev.target.value;
				state.rockDirty = true;
			}
		});

		function bindCheck(id, key) {
			const el = document.getElementById(id);
			if (!el) return;
			el.addEventListener('change', function () { state[key] = el.checked; });
		}
		bindCheck('pump-on', 'pumpOn');
		bindCheck('auto-fire', 'autoFire');
		bindCheck('erosion-on', 'erosionOn');

		function bindSlider(id, outId, key, fmt, onChange) {
			const el = document.getElementById(id);
			const out = document.getElementById(outId);
			if (!el) return;
			el.addEventListener('input', function () {
				const v = Number(el.value);
				state[key] = v;
				if (out) out.textContent = fmt(v);
				if (onChange) onChange(v);
			});
		}
		bindSlider('dissolve-rate', 'dissolve-rate-out', 'dissolveRate', function (v) { return v.toFixed(1) + '×'; });
		bindSlider('mech-force', 'mech-force-out', 'mechForce', function (v) { return v.toFixed(2) + '×'; });
		bindSlider('erosion-power', 'erosion-power-out', 'erosionPower', function (v) { return v.toFixed(1) + '×'; });
		bindSlider('pump-rate', 'pump-rate-out', 'pumpRate', function (v) { return v.toFixed(1) + '×'; });
		bindSlider('geo-seed', 'geo-seed-out', 'seed', function (v) { return String(v); }, function () {
			if (state.scene === 'geology') loadScene(state, 'geology');
			updateHeadings();
		});

		document.getElementById('rand-seed').addEventListener('click', function () {
			const s = 1 + ((Math.random() * 98) | 0);
			state.seed = s;
			document.getElementById('geo-seed').value = String(s);
			document.getElementById('geo-seed-out').textContent = String(s);
			loadScene(state, state.scene);
			updateHeadings();
		});

		document.getElementById('sweep-demo').addEventListener('click', function () {
			state.demoSweepTimer = 6.5;
		});
		document.getElementById('drain-all').addEventListener('click', function () { drainWater(state); });
		document.getElementById('reset-scene').addEventListener('click', function () { loadScene(state, state.scene); });
		const pauseBtn = document.getElementById('pause-btn');
		pauseBtn.addEventListener('click', function () {
			state.paused = !state.paused;
			pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
		});
		document.getElementById('step-btn').addEventListener('click', function () {
			state.paused = true;
			pauseBtn.textContent = 'Resume';
			stepSimulation(state, 1 / 60, 0);
			draw();
			updateHud();
		});

		// Pointer & keyboard input
		let pointerDown = false;
		let pointerButton = 0;
		let pointerWx = state.aimX;
		let pointerWy = state.aimY;
		const keys = { a: false, d: false, space: false };

		function eventToWorld(ev) {
			const rect = canvas.getBoundingClientRect();
			const u = (ev.clientX - rect.left) / rect.width;
			const v = (ev.clientY - rect.top) / rect.height;
			return [clamp(u * WORLD_W, 0, WORLD_W), clamp((1 - v) * WORLD_H, 0, WORLD_H)];
		}

		canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
		canvas.addEventListener('pointerdown', function (ev) {
			canvas.setPointerCapture(ev.pointerId);
			pointerDown = true;
			pointerButton = ev.button;
			const pos = eventToWorld(ev);
			pointerWx = pos[0]; pointerWy = pos[1];
			if (pointerButton === 0 && state.tool === 'gun') {
				state.aimX = pointerWx;
				state.aimY = pointerWy;
				state.firing = true;
			} else if (pointerButton === 2) {
				applyCursorTool(state, pointerWx, pointerWy, 'carve', 1 / 60);
			} else {
				applyCursorTool(state, pointerWx, pointerWy, state.tool, 1 / 12);
			}
			updateInspector(pointerWx, pointerWy);
		});
		canvas.addEventListener('pointermove', function (ev) {
			const pos = eventToWorld(ev);
			pointerWx = pos[0]; pointerWy = pos[1];
			if (state.tool === 'gun') {
				state.aimX = pointerWx;
				state.aimY = pointerWy;
			}
			updateInspector(pointerWx, pointerWy);
		});
		canvas.addEventListener('pointerup', function () {
			pointerDown = false;
			state.firing = keys.space;
		});

		window.addEventListener('keydown', function (ev) {
			if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT')) return;
			const k = ev.key.toLowerCase();
			if (k === 'a' || k === 'arrowleft') keys.a = true;
			if (k === 'd' || k === 'arrowright') keys.d = true;
			if (k === ' ') { ev.preventDefault(); keys.space = true; state.firing = true; }
			if (k === 'p') {
				state.pumpOn = !state.pumpOn;
				const chk = document.getElementById('pump-on');
				if (chk) chk.checked = state.pumpOn;
			}
		});
		window.addEventListener('keyup', function (ev) {
			const k = ev.key.toLowerCase();
			if (k === 'a' || k === 'arrowleft') keys.a = false;
			if (k === 'd' || k === 'arrowright') keys.d = false;
			if (k === ' ') { keys.space = false; state.firing = pointerDown && pointerButton === 0 && state.tool === 'gun'; }
		});

		const mEls = {
			pumpHal: document.getElementById('m-pump-halite'),
			pumpVit: document.getElementById('m-pump-vitriol'),
			waterSol: document.getElementById('m-water-sol'),
			gasLost: document.getElementById('m-gas-lost'),
			debris: document.getElementById('m-debris'),
			gold: document.getElementById('m-gold'),
			eroded: document.getElementById('m-eroded'),
			drift: document.getElementById('m-drift'),
			perf: document.getElementById('perf-badge')
		};

		function updateHud() {
			const m = measureMetrics(state);
			if (mEls.pumpHal) mEls.pumpHal.textContent = m.pumpedHaliteMass.toFixed(1) + ' (' + m.pumpedHaliteValue.toFixed(0) + ' cr)';
			if (mEls.pumpVit) mEls.pumpVit.textContent = m.pumpedVitriolMass.toFixed(1) + ' (' + m.pumpedVitriolValue.toFixed(0) + ' cr)';
			if (mEls.waterSol) mEls.waterSol.textContent = m.waterSoluteMass.toFixed(1) + ' (' + m.waterSoluteValue.toFixed(0) + ' cr)';
			if (mEls.gasLost) mEls.gasLost.textContent = m.lostGasMass.toFixed(1) + ' (-' + m.lostGasValue.toFixed(0) + ' cr)';
			if (mEls.debris) mEls.debris.textContent = m.debrisCount + ' (' + m.debrisMass.toFixed(1) + ' m)';
			if (mEls.gold) mEls.gold.textContent = m.pureGoldMass.toFixed(2) + ' (' + m.pureGoldValue.toFixed(0) + ' cr)';
			if (mEls.eroded) mEls.eroded.textContent = m.entrainedCount + ' hop / ' + m.erosionHopEvents + ' tot';
			if (mEls.drift) mEls.drift.textContent = m.massDrift.toFixed(4) + ' / ' + m.valueDrift.toFixed(4);
			if (mEls.perf) mEls.perf.textContent = 'step ' + state.perfStepMs.toFixed(2) + ' ms · draw ' + state.perfDrawMs.toFixed(2) + ' ms';
		}

		updateHeadings();
		draw();
		updateHud();

		let frameTick = 0;
		function loop() {
			if (!state.paused) {
				const drive = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
				if (pointerDown) {
					if (pointerButton === 2) applyCursorTool(state, pointerWx, pointerWy, 'carve', 1 / 60);
					else if (state.tool !== 'gun') applyCursorTool(state, pointerWx, pointerWy, state.tool, 1 / 60);
				}
				stepSimulation(state, 1 / 60, drive);
			}
			draw();
			if ((++frameTick & 3) === 0) updateHud();
			requestAnimationFrame(loop);
		}
		requestAnimationFrame(loop);

		return { state, draw, updateHud, loadScene: function (sc) { loadScene(state, sc); updateHeadings(); draw(); updateHud(); } };
	}

	const api = {
		WORLD_W, WORLD_H, ROCK_W, ROCK_H, FLUID_W, FLUID_H,
		MINERALS, TEST_COLUMNS,
		MIN_STONE, MIN_IRON, MIN_COPPER, MIN_VITRIOL, MIN_QUARTZ, MIN_CORUNDUM,
		MIN_FLUORITE, MIN_SILVER, MIN_GOLD, MIN_GAS, MIN_SAND, MIN_HALITE, MIN_FIZZY, MIN_PURE_GOLD,
		evaluateCompositionLaw,
		evaluateCellChemistry,
		createSimulation,
		loadScene,
		stepSimulation,
		measureMetrics,
		drainWater,
		applyCursorTool
	};

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	}
	root.SolubilityLab = api;

	if (typeof document !== 'undefined') {
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', function () {
				root.solubilityLabApp = initBrowser();
			});
		} else {
			root.solubilityLabApp = initBrowser();
		}
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
