(function (root) {
	'use strict';
	// Purchasable machinery upgrades. Base tuning stays in SteamPhysics config;
	// installed items contribute explicit deltas and effects. Each item names the
	// research node that unlocks it, so purchases need funds and prerequisites.
	const items = Object.freeze([
		Object.freeze({
			id: 'grader', name: 'Road grader', cost: 300, mass: 10,
			effect: 'Grades a 1.5 m swath under the centre while moving at 0.03 m/s, shaving and smoothing the top without digging beneath the platform or below the original ground. Adds 10 kg and rolling resistance when working.'
		}),
		Object.freeze({
			id: 'pad', name: 'Rebound pad', cost: 250, mass: 6, requires: 'materials',
			retentionBonus: 0.03,
			effect: 'Reflector keeps 93% of normal kinetic energy per bounce (up from the 90% base). Denser pad adds 6 kg.'
		}),
		Object.freeze({
			id: 'coil', name: 'Drive coil', cost: 400, mass: 12, requires: 'electromagnetics',
			pulseBonus: 12,
			effect: 'Bounce drive pulse rises by 12 J per contact. Coil adds 12 kg.'
		}),
		Object.freeze({
			id: 'motor', name: 'High-torque motor', cost: 550, mass: 6, requires: 'traction',
			forceBonus: 360, speedBonus: 6,
			effect: 'Replaces the stock motor: engine force rises by 360 N and top speed by 6 m/s, for 6 kg net.'
		}),
		Object.freeze({
			id: 'overdrive', name: 'Overdrive unit', cost: 950, mass: 8, requires: 'power',
			forceBonus: 480, speedBonus: 6,
			effect: 'Engine force rises by a further 480 N and top speed by 6 m/s. Adds 8 kg. Full-speed runs spend the reserve fast and brake hot.'
		}),
	Object.freeze({
		id: 'chassis', name: 'Lightweight chassis', cost: 350, mass: -12, requires: 'alloys',
		effect: 'Cuts dry platform mass by 12 kg for stronger acceleration under load.'
	}),
	Object.freeze({
		id: 'flywheel', name: 'Brake flywheel', cost: 480, mass: 14, requires: 'storage',
			recoveryFraction: 0.55,
			effect: 'Stores 55% of braking energy and returns it to the reserve at 90% round-trip efficiency; the rest still becomes heat. Wall stops stay unrecovered. Adds 14 kg.'
	})
]);
	// Radiator tiers share one installed unit: fitting a tier swaps the previous
	// one, so mass and exposed cooling area move with it instead of stacking.
	// Heat transfer research unlocks the family; every tier is purchasable once,
	// and swapping between owned tiers is free.
	const radiators = Object.freeze([
		Object.freeze({
			id: 'vent', name: 'Vent grille', cost: 300, mass: 4, radiatorArea: 0.15,
			effect: 'Adds 0.15 m² of cooling fins for 4 kg — cheap and light, modest cooling.'
		}),
		Object.freeze({
			id: 'radiator', name: 'Radiator array', cost: 650, mass: 8, radiatorArea: 0.35,
			effect: 'Adds 0.35 m² of exposed fins, improving convective and radiative cooling. Adds 8 kg.'
		}),
		Object.freeze({
			id: 'bank', name: 'Heavy radiator bank', cost: 1400, mass: 16, radiatorArea: 0.70,
			effect: 'Adds 0.70 m² of cooling surface for 16 kg — the most cooling, at a real mass penalty.'
		})
		]);
	const engineCosts = Object.freeze({ hand: 60, coal: 250, oil: 650, electric: 850, nuclear: 2400 });
	const ownedEngines = new Set(['electric']);
	function ownsEngine(id) { return ownedEngines.has(id); }
	function atShop(world) {
		return world && world.platform.x <= root.SteamPhysics.platformMin() + 0.2 && Math.abs(world.platform.vx) <= 0.1;
	}
	function buyEngine(id, world) {
		const physics = root.SteamPhysics;
		if (!atShop(world) || !Object.hasOwn(engineCosts, id)) return false;
		if (!ownsEngine(id) && !root.SteamCeiling.purchase(id + ' engine', engineCosts[id], world.time)) return false;
		if (!physics.selectEngine(id, world)) return false;
		ownedEngines.add(id);
		return true;
	}
	const installed = new Set();
	let installedMass = 0;
	let installedRetention = 0;
	let installedPulse = 0;
	let installedRadiatorId = null;
	let installedRecovery = 0;
	let installedForce = 0;
	let installedSpeed = 0;
	const ownedRadiators = new Set();

	const state = Object.freeze({
		get massDelta() { return installedMass; },
		get retentionBonus() { return installedRetention; },
		get pulseBonus() { return installedPulse; },
		get radiatorArea() { return installedRadiatorId ? radiatorEntry(installedRadiatorId).radiatorArea : 0; },
		get recoveryFraction() { return installedRecovery; },
		get forceBonus() { return installedForce; },
		get speedBonus() { return installedSpeed; }
	});

	function find(id) {
		for (const item of items) if (item.id === id) return item;
		return null;
	}

	function isInstalled(id) {
		return installed.has(id);
	}

	function radiatorEntry(id) {
		for (const radiator of radiators) if (radiator.id === id) return radiator;
	return null;
}
	function radiatorUnlocked(id) {
		const radiator = radiatorEntry(id);
		if (!radiator) return false;
		const economy = root.SteamCeiling;
		if (economy && economy.state.commune) return true;
		return Boolean(root.SteamResearch && root.SteamResearch.isResearched('thermodynamics'));
	}
	function installedRadiator() { return installedRadiatorId; }

// An item is purchasable once its research node is complete; funds are checked
	// by the economy when the purchase is booked. Communism mode waives the
	// research gate as well, because the commons hands out the machinery.
	function isUnlocked(id) {
		const item = find(id);
		if (!item) return false;
		const economy = root.SteamCeiling;
		if (economy && economy.state.commune) return true;
		const technology = root.SteamResearch;
		return !item.requires || Boolean(technology && technology.isResearched(item.requires));
	}

	function installRadiator(id, world, testGrant) {
		const radiator = radiatorEntry(id);
		const economy = root.SteamCeiling;
		const physics = root.SteamPhysics;
		if (!radiator || !economy) return false;
		if (!economy.state.commune && !root.SteamResearch.isResearched('thermodynamics')) return false;
		if (installedRadiatorId === id) return false;
		const time = world ? world.time : 0;
		const oldMass = world && physics ? physics.platformMass(world) : 0;
		const alreadyOwned = ownedRadiators.has(id);
		const booked = testGrant ? economy.grant(radiator.name, time, 'buy') : (alreadyOwned || economy.purchase(radiator.name, radiator.cost, time));
		if (!booked) return false;
		const oldEntry = installedRadiatorId ? radiatorEntry(installedRadiatorId) : null;
		installedRadiatorId = id;
		installedMass += radiator.mass - (oldEntry ? oldEntry.mass : 0);
		ownedRadiators.add(id);
		if (physics) physics.applyMassChange(world, world ? physics.platformMass(world) - oldMass : 0, oldMass);
		return true;
	}
	function apply(item, world, testGrant) {
		const economy = root.SteamCeiling;
		if (!economy) return false;
		const physics = root.SteamPhysics;
		const oldMass = world && physics ? physics.platformMass(world) : 0;
		const time = world ? world.time : 0;
		const booked = testGrant ? economy.grant(item.name, time, 'buy') : economy.purchase(item.name, item.cost, time);
		if (!booked) return false;
		installed.add(item.id);
		installedMass += item.mass || 0;
		installedRetention += item.retentionBonus || 0;
		installedPulse += item.pulseBonus || 0;
		installedRecovery += item.recoveryFraction || 0;
		installedForce += item.forceBonus || 0;
		installedSpeed += item.speedBonus || 0;
		if (physics) physics.applyMassChange(world, world ? physics.platformMass(world) - oldMass : 0, oldMass);
		return true;
	}

	function install(id, world) {
		const item = find(id);
		if (!item || installed.has(id) || !isUnlocked(id)) return false;
		return apply(item, world, false);
	}

	// Test mode installs every item immediately, independently of progression
	// and funds, while preserving normal installation effects.
	function grant(id, world) {
		const item = find(id);
		if (!item || installed.has(id)) return false;
		return apply(item, world, true);
	}

	function installAll(world) {
		let granted = 0;
		for (const item of items) if (grant(item.id, world)) granted++;
		return granted;
	}

	function reset() {
		installed.clear();
		ownedEngines.clear();
		ownedEngines.add('electric');
		installedRadiatorId = null;
		ownedRadiators.clear();
		installedMass = 0;
		installedRetention = 0;
		installedPulse = 0;
		installedRecovery = 0;
		installedForce = 0;
		installedSpeed = 0;
	}

	const api = { engineCosts, ownsEngine, atShop, buyEngine, items, radiators, radiatorUnlocked, installedRadiator, installRadiator, state, find, isInstalled, isUnlocked, install, grant, installAll, reset };
	root.SteamEquipment = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
