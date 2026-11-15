// The one wet-chemistry rule set: how a rock cell's mixture splits into brine,
// vented gas and solid residue, and how far a water parcel is from saturation.
// The page, the solubility lab and the probes all call these functions, so a
// probe cannot measure a law the game does not run.
//
// Two models share every channel convention:
//   'table'   - per-mineral stoichiometry from js/minerals.js (brineF / ventF /
//               residueF / residueId), weighted by the cell mixture.
//   'formula' - the continuous composition law f(R, G, B) of the solubility
//               plan, which splits high B into bound (hydrate / crystal) and
//               free fractions before any channel is assigned.
//
// Every function writes into caller-owned storage and allocates nothing: the
// same code runs in the per-cell generation loop, in a wet step and in the HUD.
// Depends on: js/minerals.js, js/rock-materials.js.
// Provides: models, createSplit, clearSplit, evaluateLaw, evaluateTableSplit,
// evaluateFormulaSplit, gasResidueValue, saturationFactor, underminedSkeleton
(function (root) {
	'use strict';
	const node = typeof module !== 'undefined' && module.exports;
	const minerals = node ? require('./minerals.js') : root.SteamMinerals;

	const table = minerals.mineralTable;
	const count = minerals.mineralCount;
	const ids = minerals.mineralIds;
	const models = Object.freeze(['table', 'formula']);

	// The minerals a channel can load, by table index. Table mode loads the
	// mineral that dissolved; the composition law loads the mineral its octant
	// names, because a formula cell has no mixture to attribute.
	const stoneIndex = ids.indexOf('stone');
	const vitriolIndex = ids.indexOf('vitriol');
	const fluoriteIndex = ids.indexOf('fluorite');
	const gasIndex = ids.indexOf('gas');
	const haliteIndex = ids.indexOf('halite');
	function indexOf(m) { return table[m].residueId === table[m].id ? m : ids.indexOf(table[m].residueId); }

	function clamp(value, low, high) { return value < low ? low : value > high ? high : value; }
	function smoothstep(edge0, edge1, x) {
		const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
		return t * t * (3 - 2 * t);
	}

	// One cell's split: mass and value fractions of the original cell per
	// channel, indexed by mineral, plus the totals a caller books.
	function createSplit() {
		return {
			brine: new Float64Array(count), brineValue: new Float64Array(count),
			vent: new Float64Array(count), ventValue: new Float64Array(count),
			residue: new Float64Array(count), residueValue: new Float64Array(count),
			brineMass: 0, brineValueTotal: 0,
			ventMass: 0, ventValueTotal: 0,
			residueMass: 0, residueValueTotal: 0,
			solubility: 0, speed: 0, density: 0, skeleton: 0,
			residueMineral: stoneIndex, undermined: false
		};
	}

	function clearSplit(out) {
		out.brine.fill(0); out.brineValue.fill(0);
		out.vent.fill(0); out.ventValue.fill(0);
		out.residue.fill(0); out.residueValue.fill(0);
		out.brineMass = out.brineValueTotal = 0;
		out.ventMass = out.ventValueTotal = 0;
		out.residueMass = out.residueValueTotal = 0;
		out.solubility = out.speed = out.density = out.skeleton = 0;
		out.residueMineral = stoneIndex;
		out.undermined = false;
		return out;
	}

	// f(R, G, B): the continuous composition law. Bound B leaves the free-B pool
	// before any channel is assigned, so bound gas can never be vented.
	function evaluateLaw(r, g, b, out) {
		const ionic = smoothstep(0.22, 0.56, r * g);
		const hydrate = smoothstep(0.15, 0.42, r * b * (1 - 0.65 * g));
		const degasRaw = smoothstep(0.56, 0.86, b) * (0.35 + 0.65 * (1 - r * (1 - g)));
		const degas = clamp(degasRaw * (0.42 + 0.48 * (1 - r)), 0, 1);

		const crystalB = smoothstep(0.10, 0.30, g) * (1 - smoothstep(0.35, 0.50, r)) * smoothstep(0.55, 0.70, b);
		const hydrateB = smoothstep(0.45, 0.62, r) * (1 - smoothstep(0.35, 0.55, g)) * smoothstep(0.50, 0.65, b);
		const boundB = Math.min(1, crystalB + hydrateB);
		const freeB = Math.max(0, 1 - boundB);
		const gasRock = smoothstep(0.20, 0.40, b) * (1 - smoothstep(0.15, 0.30, g)) * (1 - smoothstep(0.25, 0.40, r)) * freeB;

		let halite = ionic * (1 - 0.35 * degasRaw);
		let vitriol = hydrate * (1 - 0.85 * ionic) + degas * hydrateB;
		let gas = degas * freeB;

		// Crystal-bound B keeps 55% of its matrix in solution as green brine and
		// 45% standing: Fluorite never vents.
		let crystal = 0.55 * crystalB;
		const keepCrystal = 1 - crystalB;
		halite = halite * keepCrystal + crystal;
		vitriol *= keepCrystal;
		gas *= keepCrystal;
		// Free gas rock vents 85% and leaves 15% stone behind.
		const keepGas = 1 - gasRock;
		halite *= keepGas;
		vitriol *= keepGas;
		crystal *= keepGas;
		gas = gas * keepGas + 0.85 * gasRock;

		let total = halite + vitriol + gas;
		if (total > 1) {
			const inverse = 1 / total;
			halite *= inverse; vitriol *= inverse; gas *= inverse; crystal *= inverse;
			total = 1;
		}
		if (crystal > halite) crystal = halite;
		// Smooth low-reactivity gate: a faint match reacts faintly instead of
		// being cut off by an arbitrary threshold.
		const gate = smoothstep(0.02, 0.22, total);
		out.halite = halite;
		out.vitriol = vitriol;
		out.gas = gas;
		out.crystal = crystal;
		out.solid = Math.max(0, 1 - total);
		out.boundB = boundB;
		out.freeB = freeB;
		out.solubility = total;
		out.speed = total > 0 ? (0.45 + 1.25 * total) * gate : 0;
		out.density = clamp(2 + 7.5 * r * r - 0.8 * b, 1.2, 11.5);
		return out;
	}

	// Mixture-weighted split: the model the game ships. `mix` is an offset into a
	// mineralCount-strided mixture array, `mass` the cell's remaining mass,
	// `value` its remaining value, `prices` a live quote vector. Each channel is
	// priced at its own mineral; a residue is priced at the cheaper of its parent
	// and what it becomes, and the destroyed difference is booked with the vent
	// channel so the value ledger closes.
	function evaluateTableSplit(mix, offset, mass, value, prices, out) {
		clearSplit(out);
		let bestResidue = -1;
		for (let m = 0; m < count; m++) {
			const weight = mix[offset + m];
			if (weight <= 1e-4) continue;
			const def = table[m];
			const residueMineral = indexOf(m);
			const brineMass = weight * def.brineF;
			const ventMass = weight * def.ventF;
			const residueMass = weight * def.residueF;
			const residueQuote = Math.min(prices[m], prices[residueMineral]);
			const destroyed = residueMass * (prices[m] - residueQuote);
			out.brine[m] += brineMass;
			out.brineValue[m] += brineMass * prices[m];
			out.vent[m] += ventMass;
			out.ventValue[m] += ventMass * prices[m] + destroyed;
			out.residue[residueMineral] += residueMass;
			out.residueValue[residueMineral] += residueMass * residueQuote;
			out.brineMass += brineMass;
			out.brineValueTotal += brineMass * prices[m];
			out.ventMass += ventMass;
			out.ventValueTotal += ventMass * prices[m] + destroyed;
			out.residueMass += residueMass;
			out.residueValueTotal += residueMass * residueQuote;
			out.speed += weight * def.dissolveSpeed;
			out.skeleton += residueMass * def.strength;
			out.density += weight * def.rho;
			if (residueMass > bestResidue) { bestResidue = residueMass; out.residueMineral = residueMineral; }
		}
		out.undermined = underminedSkeleton(mix, offset);
		finishSplit(out, mass, value);
		return out;
	}

	const lawScratch = {
		halite: 0, vitriol: 0, gas: 0, crystal: 0, solid: 0,
		speed: 0, solubility: 0, density: 0, boundB: 0, freeB: 0
	};

	// Composition-law split of a cell whose elements are r, g, b and whose
	// dominant mineral (for the standing residue's identity) is `dominant`.
	function evaluateFormulaSplit(r, g, b, dominant, mass, value, prices, out) {
		clearSplit(out);
		const law = evaluateLaw(r, g, b, lawScratch);
		const unit = mass > 1e-12 ? value / mass : prices[dominant];
		// The ionic part of the salt channel becomes Halite brine; the crystal
		// part is Fluorite's leachable matrix.
		const ionic = Math.max(0, law.halite - law.crystal);
		const residueMineral = law.crystal > 0.25 ? fluoriteIndex : indexOf(dominant);
		const brineTotal = (ionic + law.crystal + law.vitriol) * unit;
		const residueTotal = law.solid * Math.min(unit, prices[residueMineral]);
		out.brine[haliteIndex] = ionic;
		out.brineValue[haliteIndex] = ionic * unit;
		out.brine[fluoriteIndex] = law.crystal;
		out.brineValue[fluoriteIndex] = law.crystal * unit;
		out.brine[vitriolIndex] = law.vitriol;
		out.brineValue[vitriolIndex] = law.vitriol * unit;
		out.vent[gasIndex] = law.gas;
		// The value a gas cell destroys when it re-materialises as cheap stone.
		out.ventValue[gasIndex] = Math.max(0, unit - brineTotal - residueTotal);
		out.residue[residueMineral] = law.solid;
		out.residueValue[residueMineral] = residueTotal;
		out.brineMass = ionic + law.crystal + law.vitriol;
		out.brineValueTotal = brineTotal;
		out.ventMass = law.gas;
		out.ventValueTotal = out.ventValue[gasIndex];
		out.residueMass = law.solid;
		out.residueValueTotal = residueTotal;
		out.residueMineral = residueMineral;
		out.speed = law.speed;
		out.density = law.density;
		out.skeleton = law.solid * table[residueMineral].strength;
		out.undermined = underminedSkeleton(mixOf(r, g, b, law), 0);
		finishSplit(out, mass, value);
		return out;
	}

	// A formula cell has no mixture, so the inclusion-seam test runs on the two
	// channels the law actually produced: a residue with no brine around it is
	// coherent, a residue with brine beside it is underminable.
	function mixOf(r, g, b, law) {
		lawMix.fill(0);
		if (law.halite > 0) lawMix[haliteIndex] = law.halite;
		if (law.vitriol > 0) lawMix[vitriolIndex] = law.vitriol;
		if (law.gas > 0) lawMix[gasIndex] = law.gas;
		return lawMix;
	}
	const lawMix = new Float64Array(count);

	// Clamp a split to what the cell still carries: cumulative slices are
	// fractions of the original cell, so a leached cell can never hand out more
	// mass or value than it has left.
	function finishSplit(out, mass, value) {
		out.solubility = out.brineMass + out.ventMass + out.residueMass;
		let scale = 1;
		if (mass > 0 && out.solubility > mass) scale = mass / out.solubility;
		const totalValue = out.brineValueTotal + out.ventValueTotal + out.residueValueTotal;
		if (value > 0 && totalValue > value) {
			const valueScale = value / totalValue;
			if (valueScale < scale) scale = valueScale;
		}
		if (scale >= 1) return;
		out.brineMass *= scale; out.brineValueTotal *= scale;
		out.ventMass *= scale; out.ventValueTotal *= scale;
		out.residueMass *= scale; out.residueValueTotal *= scale;
		for (let m = 0; m < count; m++) {
			out.brine[m] *= scale; out.brineValue[m] *= scale;
			out.vent[m] *= scale; out.ventValue[m] *= scale;
			out.residue[m] *= scale; out.residueValue[m] *= scale;
		}
		out.solubility *= scale;
	}

	// The value a re-materialised gas share destroys: a grain that becomes residue
	// must not keep the quote it was booked at. Callers holding only a gas mass
	// use this to book the loss.
	function gasResidueValue(mass, parentQuote, residueQuote) {
		return Math.max(0, mass * (parentQuote - residueQuote));
	}

	// Saturation of one water parcel: 1 fresh, 0 at `cap * water`.
	function saturationFactor(load, water, cap) {
		const capacity = (water > 0 ? water : 0) * cap;
		if (capacity <= 1e-12) return load <= 1e-12 ? 1 : 0;
		const free = 1 - load / capacity;
		return free < 0 ? 0 : free > 1 ? 1 : free;
	}

	// Whether a soluble binder holds *different* insoluble clasts: the seam is
	// undermined as the binder leaches. A residue of the same mineral (pure
	// Fluorite concentrate) stays a coherent skeleton.
	function underminedSkeleton(mix, offset) {
		let solubleMask = 0;
		let residueMask = 0;
		let solubleMass = 0;
		for (let m = 0; m < count; m++) {
			const weight = mix[offset + m];
			if (weight <= 1e-4) continue;
			const def = table[m];
			const residueMineral = indexOf(m);
			const soluble = def.brineF + def.ventF;
			if (soluble > 0) { solubleMask |= 1 << m; solubleMass += weight * soluble; }
			if (def.residueF > 0) residueMask |= 1 << residueMineral;
		}
		return residueMask !== 0 && (solubleMask & residueMask) === 0 && solubleMass >= 0.5;
	}

	const api = {
		models, mineralCount: count,
		stoneIndex, vitriolIndex, fluoriteIndex, gasIndex, haliteIndex,
		createSplit, clearSplit, evaluateLaw, evaluateTableSplit, evaluateFormulaSplit,
		finishSplit, gasResidueValue, saturationFactor, underminedSkeleton
	};
	root.SteamWaterChemistry = api;
	if (node) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
