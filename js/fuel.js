// Wild Mine fuel: the cave has no charge pad, so the installed engine burns
// cargo minerals to keep the reserve full. Every engine family owns one fuel
// grade; a burn takes the cheapest cell per joule inside that family first,
// adds the chemical energy to the reserve, and books the cargo's already
// counted gravitational potential against the imported share, so the one
// energy ledger stays exact. Classic mode never burns: its charge pad is
// unchanged.
//
// Depends on: js/ceiling.js, js/physics.js, js/minerals.js
(function (root) {
	'use strict';
	const node = typeof module !== 'undefined' && module.exports;
	const physicsRef = node ? require('./physics.js') : root.SteamPhysics;
	const ceilingRef = node ? require('./ceiling.js') : root.SteamCeiling;
	const mineralsRef = node ? require('./minerals.js') : root.SteamMinerals;

	function phys() { return physicsRef || root.SteamPhysics; }
	function ceiling() { return ceilingRef || root.SteamCeiling; }
	function minerals() { return mineralsRef || root.SteamMinerals; }

	// One grade per engine family. `hand` has none: the crew crank is the
	// fallback with no fuel cycle at all.
	const gradeIds = Object.freeze(['solid', 'liquid', 'fissile']);
	const gradeNames = Object.freeze(['Solid', 'Liquid', 'Fissile']);
	const gradeLists = Object.freeze([
		'stone, sand or quartz',
		'gas rock, fizzy halite, fluorite, vitriol or halite',
		'iron, copper, corundum, silver or gold'
	]);
	const engineGrades = Object.freeze({ hand: -1, coal: 0, electric: 0, oil: 1, nuclear: 2 });
	// Chemical energy per kg of each fuel mineral. A cargo cell is cellMass kg,
	// so a stone cell is 1.8 kJ of solid fuel and a gold cell 48 kJ of fissile
	// fuel before engine efficiency. Fuels are families rather than single
	// ores: the host bed feeds the solid engines, volatiles feed the oil
	// engine, and reactive metals feed the reactor.
	const yieldsById = Object.freeze([
		Object.freeze({ stone: 3000, sand: 2000, quartz: 2500 }),
		Object.freeze({ gas: 40000, fizzy: 20000, fluorite: 14000, vitriol: 10000, halite: 5000 }),
		Object.freeze({ iron: 20000, copper: 25000, corundum: 30000, silver: 60000, gold: 80000, pure_gold: 100000 })
	]);
	const count = minerals().mineralCount;
	const ids = minerals().mineralIds;
	const gradeYields = gradeIds.map((_, grade) => {
		const out = new Float64Array(count);
		const table = yieldsById[grade];
		for (let m = 0; m < count; m++) out[m] = table[ids[m]] || 0;
		return out;
	});

	// Burn counters are run history; reset clears them. The installed engine is
	// physics state, not fuel state.
	const profiles = new Map();
	function ownerId(owner) {
		return owner && typeof owner === 'object' ? owner.id : owner || 'rig';
	}
	function profileFor(owner) {
		const id = ownerId(owner);
		let profile = profiles.get(id);
		if (!profile) {
			profile = { id: id, burnedMass: 0, burnedChemical: 0, burnedValue: 0, burnedPotential: 0, burnedKinetic: 0, burns: 0 };
			profiles.set(id, profile);
		}
		return profile;
	}
	function reset() { profiles.clear(); }

	function gradeForEngine(engineId) {
		const grade = engineGrades[engineId];
		return grade === undefined ? -1 : grade;
	}

	// One live readout object, reused: the page calls this every readout tick
	// and the tests read the same numbers from the same rule.
	const readout = {
		engineId: '', engineName: '', grade: '', gradeIndex: -1, gradeName: '', fuelList: '',
		mass: 0, chemical: 0, cells: 0, refillPower: 0, usefulPower: 0,
		burnedMass: 0, burnedChemical: 0, burnedValue: 0
	};
	function read(owner) {
		const physics = phys();
		const engine = physics ? physics.engineNow(owner) : null;
		const state = ceiling() ? ceiling().state : null;
		const grade = engine ? gradeForEngine(engine.id) : -1;
		readout.engineId = engine ? engine.id : '';
		readout.engineName = engine ? engine.name : '';
		readout.gradeIndex = grade;
		readout.grade = grade >= 0 ? gradeIds[grade] : '';
		readout.gradeName = grade >= 0 ? gradeNames[grade] : '';
		readout.fuelList = grade >= 0 ? gradeLists[grade] : '';
		let mass = 0;
		let chemical = 0;
		if (state && grade >= 0) {
			const yields = gradeYields[grade];
			for (let m = 0; m < count; m++) {
				const amount = state.cargoMinerals[m];
				if (!(amount > 0) || !(yields[m] > 0)) continue;
				mass += amount;
				chemical += amount * yields[m];
			}
		}
		const capacity = physics ? physics.config.battery : 0;
		const profile = profileFor(owner);
		readout.mass = mass;
		readout.chemical = chemical;
		readout.cells = state ? mass / state.cellMass : 0;
		readout.refillPower = grade >= 0 && engine.reload > 0 ? capacity / engine.reload : 0;
		readout.usefulPower = engine ? readout.refillPower * engine.efficiency : 0;
		readout.burnedMass = profile.burnedMass;
		readout.burnedChemical = profile.burnedChemical;
		readout.burnedValue = profile.burnedValue;
		return readout;
	}

	function reason(owner) {
		const info = read(owner);
		if (info.gradeIndex < 0) return 'Hand engine · no fuel burn · hand-crank only';
		if (!(info.chemical > 0)) return 'No ' + info.grade + ' fuel in cargo · mine ' + info.fuelList;
		return '';
	}

	function yieldOf(grade, mineral) {
		return gradeYields[grade] ? gradeYields[grade][mineral] || 0 : 0;
	}

	// Burn up to `chemical` joules of the owner's grade. Every loop step takes
	// the loaded fuel mineral with the lowest market value per joule, so a
	// hopper holding cheap host rock never burns the ore beside it. The total
	// removed mass is charged against the cargo's potential energy: that share
	// was already in the ledger, so only the chemical remainder is imported.
	function burn(world, chemical, owner) {
		const physics = phys();
		if (!world || !physics || !(chemical > 0) || !physics.wildMode()) return 0;
		const engine = physics.engineNow(owner);
		const grade = gradeForEngine(engine.id);
		if (grade < 0) return 0;
		const eco = ceiling();
		if (!eco) return 0;
		const state = eco.state;
		const yields = gradeYields[grade];
		const cellMass = state.cellMass;
		const beforeCells = state.cargoCells;
		let remaining = chemical;
		let burnedMass = 0;
		let burnedChemical = 0;
		let burnedValue = 0;
		while (remaining > 1e-12) {
			let best = -1;
			let bestCost = Infinity;
			for (let m = 0; m < count; m++) {
				const amount = state.cargoMinerals[m];
				if (!(amount > 1e-12) || !(yields[m] > 0)) continue;
				// Credits per joule in this cell, from the live quote.
				const cost = state.mineralPrices[m] / (yields[m] * cellMass);
				if (cost < bestCost) { bestCost = cost; best = m; }
			}
			if (best < 0) break;
			const yieldKg = yields[best];
			const available = state.cargoMinerals[best] * yieldKg;
			const take = Math.min(remaining, available);
			const mass = take / yieldKg;
			burnedValue += eco.unloadCargo(best, mass);
			burnedMass += mass;
			burnedChemical += take;
			remaining -= take;
		}
		if (!(burnedChemical > 0)) return 0;

		const capacity = physics.config.battery;
		const room = Math.max(0, capacity - world.battery);
		const stored = Math.min(burnedChemical, room);
		world.battery += stored;
		// A direct test burn past the reserve cap vents the excess as heat; the
		// step path never asks for more than the free room.
		world.heat += burnedChemical - stored;

		const removedMass = Math.max(0, beforeCells - state.cargoCells) * cellMass;
		const potential = removedMass * physics.config.gravity * state.cargoHeight;
		world.importedEnergy += burnedChemical - potential;
		// A moving platform carries the burning cargo's kinetic share too. The
		// mass leaves at the platform's velocity, so that share settles as heat
		// exactly as it does when machinery is removed on the move.
		const platform = world.platform;
		const carriedKinetic = platform ? 0.5 * removedMass * platform.vx * platform.vx : 0;
		world.heat += carriedKinetic;

		const profile = profileFor(owner);
		profile.burnedMass += burnedMass;
		profile.burnedChemical += burnedChemical;
		profile.burnedValue += burnedValue;
		profile.burnedPotential += potential;
		profile.burnedKinetic += carriedKinetic;
		profile.burns++;
		return burnedChemical;
	}

	// Top the reserve up at the engine's own reload rate: the same seconds to
	// full the Classic pad uses, scaled by this engine's reserve. A tool that
	// draws more power than that runs its buffer down instead.
	function step(world, dt) {
		if (!world || !(dt > 0)) return 0;
		const physics = phys();
		if (!physics || !physics.wildMode()) return 0;
		const engine = physics.engineNow('rig');
		if (gradeForEngine(engine.id) < 0) return 0;
		const capacity = physics.config.battery;
		const deficit = capacity - world.battery;
		if (!(deficit > 1e-9)) return 0;
		const budget = (capacity / engine.reload) * dt;
		return burn(world, Math.min(deficit, budget), 'rig');
	}

	const api = {
		gradeIds, gradeNames, gradeLists, engineGrades, yieldsById,
		reset, read, reason, yieldOf, burn, step,
		// Exported for probes and tests; the page uses read().
		profileFor
	};
	root.SteamFuel = api;
	if (node) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
