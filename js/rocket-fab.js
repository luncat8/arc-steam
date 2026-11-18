// The rocket fabricator: turns cargo minerals into rockets and loads them
// into the installed rocket rack. Wild Mine has no sell wall to buy rockets
// at, so this is how a section keeps its tubes filled. One cycle makes one
// rocket from one cargo cell of minerals plus 2 kJ of useful energy burned
// by the installed engine at its efficiency; physics.spend books the waste
// share into machine heat, so the one energy ledger stays exact.
// Depends on (at call time): js/ceiling.js, js/physics.js, js/equipment.js, js/rockets.js
(function (root) {
	'use strict';
	const node = typeof module !== 'undefined' && module.exports;
	const physicsRef = node ? require('./physics.js') : root.SteamPhysics;
	const ceilingRef = node ? require('./ceiling.js') : root.SteamCeiling;
	const equipmentRef = node ? require('./equipment.js') : root.SteamEquipment;
	const mineralsRef = node ? require('./minerals.js') : root.SteamMinerals;
	const rocketsRef = node ? require('./rockets.js') : root.SteamRockets;

	function phys() { return physicsRef || root.SteamPhysics; }
	function ceiling() { return ceilingRef || root.SteamCeiling; }
	function equipment() { return equipmentRef || root.SteamEquipment; }
	function minerals() { return mineralsRef || root.SteamMinerals; }
	function rockets() { return rocketsRef || root.SteamRockets; }

	// One cycle = one rocket = one cargo cell of ore plus 2 kJ of useful
	// energy, at one cycle per cycleTime while the auto order is held.
	const cellMass = ceiling().state.cellMass;
	const mineralsPerRocket = cellMass; // 0.6 kg, exactly one cargo cell
	const energyPerRocket = 2000;       // useful J, burned at engine efficiency
	const cycleTime = 3;                // seconds per rocket
	const rackSize = rockets().stateFor('rig').rackSize;

	const profiles = new Map();

	function ownerId(owner) {
		return owner && typeof owner === 'object' ? owner.id : owner || 'rig';
	}

	function profileFor(owner) {
		const id = ownerId(owner);
		let profile = profiles.get(id);
		if (!profile) {
			profile = {
				id: id, autoFab: false, cycle: 0,
				produced: 0, consumedMass: 0, energySpent: 0,
				lastMineral: 0, lastMass: 0
			};
			profiles.set(id, profile);
		}
		return profile;
	}

	function hasFab(owner) { return Boolean(equipment() && equipment().isInstalled('rocket-fab', owner)); }
	function hasRack(owner) { return Boolean(equipment() && equipment().isInstalled('rocket-rack', owner)); }

	function setAuto(on, owner) {
		const profile = profileFor(owner);
		profile.autoFab = Boolean(on);
		return profile.autoFab;
	}
	function isAuto(owner) { return profileFor(owner).autoFab; }

	// One atomic cycle: nothing happens unless the rack has a free tube, the
	// cargo holds a full cell of minerals and the reserve can pay the energy.
	function fabCycle(world, owner) {
		const id = ownerId(owner);
		const profile = profileFor(id);
		const rack = rockets();
		if (!rack || !hasRack(owner) || !hasFab(owner)) return 0;
		const stock = rack.stateFor(id).stock;
		if (!(stock < rackSize)) return 0;
		const eco = ceiling();
		const state = eco.state;
		if (!(state.cargoCells >= 1)) return 0;
		const cost = energyPerRocket / phys().engineNow(id).efficiency;
		if (!(world.battery >= cost)) return 0;

	// Take one cell of minerals from the cargo, in table order.
	let remaining = mineralsPerRocket;
	for (let m = 0; m < minerals().mineralCount && remaining > 1e-9; m++) {
		const take = Math.min(remaining, state.cargoMinerals[m]);
		if (!(take > 0)) continue;
		eco.unloadCargo(m, take);
		profile.consumedMass += take;
		profile.lastMineral = m;
		profile.lastMass = take;
		remaining -= take;
	}

		// The engine burns the energy at its efficiency; the unspent share
		// becomes machine heat through the same spend rule every tool uses.
		phys().spend(world, energyPerRocket);

		const loaded = rack.load(1, id);
		profile.produced += loaded;
		profile.energySpent += energyPerRocket;
		return loaded;
	}

	function reset(seed) {
		for (const profile of profiles.values()) {
			profile.cycle = 0;
			profile.produced = 0;
			profile.consumedMass = 0;
			profile.energySpent = 0;
			profile.lastMineral = 0;
			profile.lastMass = 0;
			// The standing auto order survives a new run, like auto-buy.
		}
	}

	// Draws one rocket per cycleTime from the cargo of every player that has
	// the fab and the rack installed with auto-fab on. No per-step
	// allocations: the roster is read by index.
	function step(world, dt) {
		if (!(dt > 0)) return;
		const roster = root.SteamPlayers && root.SteamPlayers.state.players;
		const ownerCount = roster ? roster.length : 1;
		for (let i = 0; i < ownerCount; i++) {
			const owner = roster ? roster[i].id : 'rig';
			if (!hasFab(owner) || !hasRack(owner)) continue;
			const profile = profileFor(owner);
			if (!profile.autoFab) continue;
			profile.cycle += dt;
			while (profile.cycle >= cycleTime) {
				profile.cycle -= cycleTime;
				fabCycle(world, owner);
			}
		}
	}

	// One line only while the press or the auto duty waits: the rack, the
	// cargo cell or the reserve is what stops the line.
	function reason(world, owner) {
		if (!equipment() || !equipment().isInstalled('rocket-fab', owner))
			return 'No rocket fab installed · fit one in Science + Shop';
		if (!equipment().isInstalled('rocket-rack', owner))
			return 'No rocket rack · the fab loads the rack';
		const stock = rockets().stateFor(owner).stock;
		if (stock >= rackSize) return 'Rack full';
		const state = ceiling().state;
		if (!(state.cargoCells >= 1)) return 'Cargo empty · mine minerals to feed the fab';
		const cost = energyPerRocket / phys().engineNow(owner).efficiency;
		if (!(world.battery >= cost))
			return 'Reserve too low · the engine burns ' + (energyPerRocket / 1000).toFixed(1) + ' kJ per rocket';
		return '';
	}

	const api = {
		cellMass: cellMass, mineralsPerRocket: mineralsPerRocket, energyPerRocket: energyPerRocket,
		cycleTime: cycleTime, rackSize: rackSize,
		setAuto: setAuto, isAuto: isAuto, fab: fabCycle, step: step, reset: reset, reason: reason
	};
	root.SteamRocketFab = api;
	if (node) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
