(function (root) {
	'use strict';
	// Technology is owned by a platform, not by the page. Every profile has its
	// own completed set and measured deltas; omitting an owner addresses the rig,
	// which keeps the physics and test API compact without sharing competitor state.
	const nodes = Object.freeze([
		Object.freeze({
			id: 'materials', name: 'Rebound materials', cost: 180, requires: Object.freeze([]),
			retentionBonus: 0.01,
			effect: 'Passive surfaces keep 91% of normal bounce energy (up from 90% on deck and rock).'
		}),
		Object.freeze({
			id: 'alloys', name: 'Light alloys', cost: 240, requires: Object.freeze([]),
			massDelta: -4,
			effect: 'Lighter framing cuts dry platform mass by 4 kg for stronger acceleration.'
		}),
		Object.freeze({
			id: 'electromagnetics', name: 'Pulse electromagnetics', cost: 300, requires: Object.freeze(['materials']),
			pulseBonus: 4,
			effect: 'Bounce drive pulse rises +4 J to 46 J per contact (80% reserve efficiency).'
		}),
		Object.freeze({
			id: 'traction', name: 'Traction motors', cost: 380, requires: Object.freeze(['electromagnetics']),
			forceBonus: 240, speedBonus: 3,
			effect: 'Engine force +240 N and top speed +3 m/s.'
		}),
		Object.freeze({
			id: 'thermodynamics', name: 'Heat transfer', cost: 340, requires: Object.freeze(['alloys']),
			coolingBonus: 0.5,
			effect: 'Ducting and surface treatment add +0.5 W/K of chassis convective cooling.'
		}),
		Object.freeze({
			id: 'storage', name: 'Flywheel storage', cost: 460, requires: Object.freeze(['thermodynamics']),
			effect: 'Kinetic recovery coupling to route braking energy back into the reserve.'
		}),
		Object.freeze({
			id: 'power', name: 'Power electronics', cost: 640, requires: Object.freeze(['traction', 'thermodynamics']),
			forceBonus: 360, speedBonus: 3,
			effect: 'Engine force +360 N and top speed +3 m/s.'
		}),
		Object.freeze({
			id: 'impact', name: 'Impact forging', cost: 320, requires: Object.freeze(['materials']),
			effect: 'Fracture metallurgy unlocks hardened strike balls and the optional rocket rack.'
		}),
		Object.freeze({
			id: 'ballistics', name: 'Ballistic computer', cost: 520, requires: Object.freeze(['electromagnetics']),
			capability: 'prediction',
			effect: 'Draws predicted flight path, landing mark, coasting ghost and reachability.'
		}),
		Object.freeze({
			id: 'ballistics2', name: 'Trajectory computer II', cost: 700, requires: Object.freeze(['ballistics', 'power']),
			effect: '3-bounce forecast through rock and piston contacts; early economy intercepts.'
		})
	]);
	const LOCKED = 'locked';
	const AVAILABLE = 'available';
	const RESEARCHED = 'researched';
	const profiles = new Map();

	function ownerId(owner) {
		return owner && typeof owner === 'object' ? owner.id : owner || 'rig';
	}

	function viewOf(profile) {
		return Object.freeze({
			get massDelta() { return profile.massDelta; },
			get retentionBonus() { return profile.retentionBonus; },
			get pulseBonus() { return profile.pulseBonus; },
			get coolingBonus() { return profile.coolingBonus; },
			get forceBonus() { return profile.forceBonus; },
			get speedBonus() { return profile.speedBonus; },
			get damageBonus() { return profile.damageBonus; },
			get rockRetentionBonus() { return profile.rockRetentionBonus; },
			get damageRadiusBonus() { return profile.damageRadiusBonus; },
			get ballMassBonus() { return profile.ballMassBonus; },
			get prediction() { return profile.prediction; },
			get predictionBounces() { return profile.done.has('ballistics2'); },
			get completed() { return profile.done.size; }
		});
	}

	function createProfile() {
		const profile = {
			done: new Set(), massDelta: 0, retentionBonus: 0, pulseBonus: 0,
			coolingBonus: 0, forceBonus: 0, speedBonus: 0, damageBonus: 0,
			rockRetentionBonus: 0, damageRadiusBonus: 0, ballMassBonus: 0,
			prediction: false
		};
		profile.view = viewOf(profile);
		return profile;
	}

	function profileFor(owner) {
		const id = ownerId(owner);
		let profile = profiles.get(id);
		if (!profile) {
			profile = createProfile();
			profiles.set(id, profile);
		}
		return profile;
	}

	// A stable facade for the rig. Reset replaces the underlying profile, not
	// this object, so live readouts never retain a previous game's technology.
	const state = Object.freeze({
		get massDelta() { return profileFor('rig').massDelta; },
		get retentionBonus() { return profileFor('rig').retentionBonus; },
		get pulseBonus() { return profileFor('rig').pulseBonus; },
		get coolingBonus() { return profileFor('rig').coolingBonus; },
		get forceBonus() { return profileFor('rig').forceBonus; },
		get speedBonus() { return profileFor('rig').speedBonus; },
		get damageBonus() { return profileFor('rig').damageBonus; },
		get rockRetentionBonus() { return profileFor('rig').rockRetentionBonus; },
		get damageRadiusBonus() { return profileFor('rig').damageRadiusBonus; },
		get ballMassBonus() { return profileFor('rig').ballMassBonus; },
		get prediction() { return profileFor('rig').prediction; },
		get predictionBounces() { return profileFor('rig').done.has('ballistics2'); },
		get completed() { return profileFor('rig').done.size; }
	});

	function stateFor(owner) { return profileFor(owner).view; }

	function find(id) {
		for (const node of nodes) if (node.id === id) return node;
		return null;
	}

	function isResearched(id, owner) {
		return profileFor(owner).done.has(id);
	}

	// Communism waives prices and prerequisite gates independently for every
	// player; it does not copy one player's completed nodes into another's tree.
	function commons() {
		const economy = root.SteamCeiling;
		return Boolean(economy && economy.state.commune);
	}

	function status(id, owner) {
		const profile = profileFor(owner);
		if (profile.done.has(id)) return RESEARCHED;
		const node = find(id);
		if (!node) return LOCKED;
		if (commons()) return AVAILABLE;
		for (const prerequisite of node.requires) if (!profile.done.has(prerequisite)) return LOCKED;
		return AVAILABLE;
	}

	function purchase(owner, node, world, testGrant) {
		const id = ownerId(owner);
		const time = world ? world.time : 0;
		if (id === 'rig') {
			const economy = root.SteamCeiling;
			if (!economy) return false;
			return testGrant ? economy.grant(node.name, time, 'research') : economy.purchase(node.name, node.cost, time, 'research');
		}
		const players = root.SteamPlayers;
		return Boolean(players && players.purchase(id, node.name, node.cost, time, 'research', testGrant));
	}

	function apply(node, world, owner, testGrant) {
		const id = ownerId(owner);
		const profile = profileFor(id);
		if (!purchase(id, node, world, testGrant)) return false;
		const physics = root.SteamPhysics;
		const machine = world && physics ? physics.machineById(world, id) : null;
		const oldMass = machine && physics.machineMass ? physics.machineMass(world, machine) : 0;
		profile.done.add(node.id);
		profile.massDelta += node.massDelta || 0;
		profile.retentionBonus += node.retentionBonus || 0;
		profile.pulseBonus += node.pulseBonus || 0;
		profile.coolingBonus += node.coolingBonus || 0;
		profile.forceBonus += node.forceBonus || 0;
		profile.speedBonus += node.speedBonus || 0;
		profile.damageBonus += node.damageBonus || 0;
		profile.rockRetentionBonus += node.rockRetentionBonus || 0;
		profile.damageRadiusBonus += node.damageRadiusBonus || 0;
		profile.ballMassBonus += node.ballMassBonus || 0;
		if (node.capability === 'prediction') profile.prediction = true;
		if (machine && physics.applyMachineMassChange) {
			physics.applyMachineMassChange(world, machine, physics.machineMass(world, machine) - oldMass, oldMass);
		}
		return true;
	}

	function research(id, world, owner) {
		const node = find(id);
		if (!node || status(id, owner) !== AVAILABLE) return false;
		return apply(node, world, owner, false);
	}

	// Test grants retain normal measured effects and mass coupling while skipping
	// only funds and prerequisites, separately for the requested player.
	function grant(id, world, owner) {
		const node = find(id);
		if (!node || isResearched(id, owner)) return false;
		return apply(node, world, owner, true);
	}

	function researchAll(world, owner) {
		let granted = 0;
		for (const node of nodes) if (grant(node.id, world, owner)) granted++;
		return granted;
	}

	function reset() {
		profiles.clear();
	}

	const api = {
		nodes, state, stateFor, status, constants: Object.freeze({ LOCKED, AVAILABLE, RESEARCHED }),
		find, isResearched, research, grant, researchAll, reset
	};
	root.SteamResearch = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
