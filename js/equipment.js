(function (root) {
	'use strict';
	// Purchasable machinery upgrades. Base tuning stays in SteamPhysics config;
	// installed items contribute explicit deltas and effects.
	const items = Object.freeze([
		Object.freeze({
			id: 'pad', name: 'Rebound pad', cost: 250, mass: 6,
			retentionBonus: 0.03, pulseBonus: 0, radiatorArea: 0,
			effect: 'Reflector keeps 93% of normal kinetic energy per bounce (up from 90%). Denser pad adds 6 kg.'
		}),
		Object.freeze({
			id: 'coil', name: 'Drive coil', cost: 400, mass: 12,
			retentionBonus: 0, pulseBonus: 12, radiatorArea: 0,
			effect: 'Bounce drive pulse rises to 48 J per contact (up from 36 J). Coil adds 12 kg.'
		}),
		Object.freeze({
			id: 'chassis', name: 'Lightweight chassis', cost: 350, mass: -12,
			retentionBonus: 0, pulseBonus: 0, radiatorArea: 0,
			effect: 'Cuts dry platform mass by 12 kg (60 → 48 kg before other upgrades) for stronger acceleration under load.'
		}),
		Object.freeze({
			id: 'radiator', name: 'Radiator array', cost: 650, mass: 8,
			retentionBonus: 0, pulseBonus: 0, radiatorArea: 0.35,
			effect: 'Adds 0.35 m² of exposed fins, improving convective and radiative cooling. Adds 8 kg.'
		})
	]);
	const installed = new Set();
	let installedMass = 0;
	let installedRetention = 0;
	let installedPulse = 0;
	let installedRadiatorArea = 0;

	const state = Object.freeze({
		get massDelta() { return installedMass; },
		get retentionBonus() { return installedRetention; },
		get pulseBonus() { return installedPulse; },
		get radiatorArea() { return installedRadiatorArea; }
	});

	function find(id) {
		for (const item of items) if (item.id === id) return item;
		return null;
	}

	function isInstalled(id) {
		return installed.has(id);
	}

	// Purchases debit shared funds. Added equipment couples to the moving
	// platform at rest, converting the lost kinetic energy into heat.
	function install(id, world) {
		const item = find(id);
		if (!item || installed.has(id)) return false;
		const economy = root.SteamCeiling;
		if (!economy) return false;
		const oldMass = world && root.SteamPhysics ? root.SteamPhysics.platformMass(world) : 0;
		if (!economy.purchase(item.name, item.cost, world ? world.time : 0)) return false;
		installed.add(id);
		installedMass += item.mass;
		installedRetention += item.retentionBonus;
		installedPulse += item.pulseBonus;
		installedRadiatorArea += item.radiatorArea;
		if (!world || !item.mass) return true;
		const velocity = world.platform.vx;
		if (item.mass > 0 && oldMass > 0) {
			const before = 0.5 * oldMass * velocity * velocity;
			const nextMass = oldMass + item.mass;
			world.platform.vx = oldMass * velocity / nextMass;
			world.heat += before - 0.5 * nextMass * world.platform.vx * world.platform.vx;
			return true;
		}
		world.heat += 0.5 * -item.mass * velocity * velocity;
		return true;
	}

	function reset() {
		installed.clear();
		installedMass = 0;
		installedRetention = 0;
		installedPulse = 0;
		installedRadiatorArea = 0;
	}

	const api = { items, state, find, isInstalled, install, reset };
	root.SteamEquipment = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
