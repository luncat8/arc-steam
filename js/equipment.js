(function (root) {
	'use strict';
	// Purchasable machinery upgrades. Base tuning stays in SteamPhysics config;
	// installed items contribute explicit deltas so tuning data, installed
	// equipment and transient world state stay separate.
	const items = Object.freeze([
		Object.freeze({
			id: 'pad', name: 'Rebound pad', cost: 250, mass: 6,
			retentionBonus: 0.03, pulseBonus: 0,
			effect: 'Reflector keeps 93% of normal kinetic energy per bounce (up from 90%). Denser pad adds 6 kg.'
		}),
		Object.freeze({
			id: 'coil', name: 'Drive coil', cost: 400, mass: 12,
			retentionBonus: 0, pulseBonus: 12,
			effect: 'Bounce drive pulse rises to 48 J per contact (up from 36 J). Coil adds 12 kg.'
		}),
		Object.freeze({
			id: 'chassis', name: 'Lightweight chassis', cost: 350, mass: -12,
			retentionBonus: 0, pulseBonus: 0,
			effect: 'Cuts dry platform mass by 12 kg (60 → 48 kg before other upgrades) for stronger acceleration under load.'
		})
	]);
	const installed = new Set();

	function find(id) {
		for (const item of items) if (item.id === id) return item;
		return null;
	}

	function isInstalled(id) {
		return installed.has(id);
	}

	function list() {
		return items;
	}

	function massDelta() {
		let total = 0;
		for (const item of items) if (installed.has(item.id)) total += item.mass;
		return total;
	}

	function retentionBonus() {
		let total = 0;
		for (const item of items) if (installed.has(item.id)) total += item.retentionBonus;
		return total;
	}

	function pulseBonus() {
		let total = 0;
		for (const item of items) if (installed.has(item.id)) total += item.pulseBonus;
		return total;
	}

	// Purchases debit the shared funds ledger; returns false when the item is
	// already installed or the funds are insufficient. Mass changes shift
	// platform kinetic energy, so the difference is booked to heat to keep the
	// energy ledger exact.
	function install(id, world) {
		const item = find(id);
		if (!item || installed.has(id)) return false;
		const economy = root.SteamCeiling;
		if (!economy || !economy.purchase(item.name, item.cost, world ? world.time : 0)) return false;
		installed.add(id);
		if (world && item.mass !== 0) {
			world.heat += 0.5 * -item.mass * world.platform.vx * world.platform.vx;
		}
		return true;
	}

	function reset() {
		installed.clear();
	}

	const api = { items, list, find, isInstalled, install, reset, massDelta, retentionBonus, pulseBonus };
	root.SteamEquipment = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
