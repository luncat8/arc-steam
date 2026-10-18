(function (root) {
	'use strict';
	// Purchasable machinery upgrades. Base tuning stays in SteamPhysics config;
	// installed items contribute explicit deltas and effects. Each item names the
	// research node that unlocks it, so purchases need funds and prerequisites.
	const items = Object.freeze([
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
			id: 'chassis', name: 'Lightweight chassis', cost: 350, mass: -12, requires: 'alloys',
			effect: 'Cuts dry platform mass by 12 kg for stronger acceleration under load.'
		}),
		Object.freeze({
			id: 'radiator', name: 'Radiator array', cost: 650, mass: 8, requires: 'thermodynamics',
			radiatorArea: 0.35,
			effect: 'Adds 0.35 m² of exposed fins, improving convective and radiative cooling. Adds 8 kg.'
		}),
		Object.freeze({
			id: 'flywheel', name: 'Brake flywheel', cost: 480, mass: 14, requires: 'storage',
			recoveryFraction: 0.55,
			effect: 'Stores 55% of braking energy and returns it to the reserve at 90% round-trip efficiency; the rest still becomes heat. Wall stops stay unrecovered. Adds 14 kg.'
		})
	]);
	const installed = new Set();
	let installedMass = 0;
	let installedRetention = 0;
	let installedPulse = 0;
	let installedRadiatorArea = 0;
	let installedRecovery = 0;

	const state = Object.freeze({
		get massDelta() { return installedMass; },
		get retentionBonus() { return installedRetention; },
		get pulseBonus() { return installedPulse; },
		get radiatorArea() { return installedRadiatorArea; },
		get recoveryFraction() { return installedRecovery; }
	});

	function find(id) {
		for (const item of items) if (item.id === id) return item;
		return null;
	}

	function isInstalled(id) {
		return installed.has(id);
	}

	// An item is purchasable once its research node is complete; funds are checked
	// by the economy when the purchase is booked.
	function isUnlocked(id) {
		const item = find(id);
		if (!item) return false;
		const technology = root.SteamResearch;
		return !item.requires || Boolean(technology && technology.isResearched(item.requires));
	}

	function install(id, world) {
		const item = find(id);
		if (!item || installed.has(id) || !isUnlocked(id)) return false;
		const economy = root.SteamCeiling;
		if (!economy) return false;
		const physics = root.SteamPhysics;
		const oldMass = world && physics ? physics.platformMass(world) : 0;
		if (!economy.purchase(item.name, item.cost, world ? world.time : 0)) return false;
		installed.add(id);
		installedMass += item.mass || 0;
		installedRetention += item.retentionBonus || 0;
		installedPulse += item.pulseBonus || 0;
		installedRadiatorArea += item.radiatorArea || 0;
		installedRecovery += item.recoveryFraction || 0;
		if (physics) physics.applyMassChange(world, item.mass || 0, oldMass);
		return true;
	}

	function reset() {
		installed.clear();
		installedMass = 0;
		installedRetention = 0;
		installedPulse = 0;
		installedRadiatorArea = 0;
		installedRecovery = 0;
	}

	const api = { items, state, find, isInstalled, isUnlocked, install, reset };
	root.SteamEquipment = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
