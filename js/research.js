(function (root) {
	'use strict';
	// Technology tree. A node is researched once, debits shared funds, needs its
	// prerequisites, and contributes the same explicit delta channels as installed
	// machinery, so no node is a label-only unlock.
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
			effect: 'Strike-head metallurgy: trade rock bounce retention for deeper fracture.'
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
	const done = new Set();
	let installedMass = 0;
	let installedRetention = 0;
	let installedPulse = 0;
	let installedCooling = 0;
	let installedForce = 0;
	let installedSpeed = 0;
	let installedDamageBonus = 0;
	let installedRockRetentionBonus = 0;
	let installedDamageRadiusBonus = 0;
	let installedBallMassBonus = 0;
	let predictionEnabled = false;

	const state = Object.freeze({
		get massDelta() { return installedMass; },
		get retentionBonus() { return installedRetention; },
		get pulseBonus() { return installedPulse; },
		get coolingBonus() { return installedCooling; },
		get forceBonus() { return installedForce; },
		get speedBonus() { return installedSpeed; },
		get damageBonus() { return installedDamageBonus; },
		get rockRetentionBonus() { return installedRockRetentionBonus; },
		get damageRadiusBonus() { return installedDamageRadiusBonus; },
		get ballMassBonus() { return installedBallMassBonus; },
		get prediction() { return predictionEnabled; },
		get predictionBounces() { return done.has('ballistics2'); },
		get completed() { return done.size; }
	});

	function find(id) {
		for (const node of nodes) if (node.id === id) return node;
		return null;
	}

	function isResearched(id) {
		return done.has(id);
	}

	// Communism mode waives the tree: the commons hands out every node, so the
	// prerequisites stop gating anything.
	function commons() {
		const economy = root.SteamCeiling;
		return Boolean(economy && economy.state.commune);
	}

	function status(id) {
		if (done.has(id)) return RESEARCHED;
		const node = find(id);
		if (!node) return LOCKED;
		if (commons()) return AVAILABLE;
		for (const prerequisite of node.requires) if (!done.has(prerequisite)) return LOCKED;
		return AVAILABLE;
	}

	function apply(node, world, testGrant) {
		const economy = root.SteamCeiling;
		if (!economy) return false;
		const physics = root.SteamPhysics;
		const oldMass = world && physics ? physics.platformMass(world) : 0;
		const time = world ? world.time : 0;
		const booked = testGrant ? economy.grant(node.name, time, 'research') : economy.purchase(node.name, node.cost, time, 'research');
		if (!booked) return false;
		done.add(node.id);
		installedMass += node.massDelta || 0;
		installedRetention += node.retentionBonus || 0;
		installedPulse += node.pulseBonus || 0;
		installedCooling += node.coolingBonus || 0;
		installedForce += node.forceBonus || 0;
		installedSpeed += node.speedBonus || 0;
		installedDamageBonus += node.damageBonus || 0;
		installedRockRetentionBonus += node.rockRetentionBonus || 0;
		installedDamageRadiusBonus += node.damageRadiusBonus || 0;
		installedBallMassBonus += node.ballMassBonus || 0;
		if (node.capability === 'prediction') predictionEnabled = true;
		if (physics) physics.applyMassChange(world, world ? physics.platformMass(world) - oldMass : 0, oldMass);
		return true;
	}

	// Research couples added or removed mass to the moving platform exactly like
	// an equipment installation, so the physics helper is shared.
	function research(id, world) {
		const node = find(id);
		if (!node || status(id) !== AVAILABLE) return false;
		return apply(node, world, false);
	}

	// Test mode grants every node without funds or prerequisite checks, while
	// retaining the same measured effects and mass/energy bookkeeping.
	function grant(id, world) {
		const node = find(id);
		if (!node || done.has(id)) return false;
		return apply(node, world, true);
	}

	function researchAll(world) {
		let granted = 0;
		for (const node of nodes) if (grant(node.id, world)) granted++;
		return granted;
	}

	function reset() {
		done.clear();
		installedMass = 0;
		installedRetention = 0;
		installedPulse = 0;
		installedCooling = 0;
		installedForce = 0;
		installedSpeed = 0;
		installedDamageBonus = 0;
		installedRockRetentionBonus = 0;
		installedDamageRadiusBonus = 0;
		installedBallMassBonus = 0;
		predictionEnabled = false;
	}

	const api = { nodes, state, status, constants: Object.freeze({ LOCKED, AVAILABLE, RESEARCHED }), find, isResearched, research, grant, researchAll, reset };
	root.SteamResearch = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
