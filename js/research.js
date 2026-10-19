(function (root) {
	'use strict';
	// Technology tree. A node is researched once, debits shared funds, needs its
	// prerequisites, and contributes the same explicit delta channels as installed
	// machinery, so no node is a label-only unlock.
	const nodes = Object.freeze([
		Object.freeze({
			id: 'materials', name: 'Rebound materials', cost: 180, requires: Object.freeze([]),
			retentionBonus: 0.01,
			effect: 'Impact surfaces keep 91% of normal kinetic energy instead of 90%, on the deck and on passive rock contacts.'
		}),
		Object.freeze({
			id: 'alloys', name: 'Light alloys', cost: 240, requires: Object.freeze([]),
			massDelta: -4,
			effect: 'Lighter framing cuts dry platform mass by 4 kg, raising acceleration under the same engine force.'
		}),
		Object.freeze({
			id: 'electromagnetics', name: 'Pulse electromagnetics', cost: 300, requires: Object.freeze(['materials']),
			pulseBonus: 4,
			effect: 'Bounce drive pulse rises to 46 J per contact, still paid from the shared reserve at 80% efficiency.'
		}),
		Object.freeze({
			id: 'thermodynamics', name: 'Heat transfer', cost: 340, requires: Object.freeze(['alloys']),
			coolingBonus: 0.5,
			effect: 'Ducting and surface treatment add 0.5 W/K of convective cooling on top of the bare chassis.'
		}),
		Object.freeze({
			id: 'storage', name: 'Flywheel storage', cost: 460, requires: Object.freeze(['thermodynamics']),
			effect: 'Unlocks the brake flywheel, which returns part of every braking manoeuvre to the reserve instead of heat.'
		}),
		Object.freeze({
			id: 'ballistics', name: 'Ballistic computer', cost: 520, requires: Object.freeze(['electromagnetics']),
			capability: 'prediction',
			effect: 'Unlocks the predicted flight path, landing mark, intercept ghost and reachability warning on the chamber view.'
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
	let predictionEnabled = false;

	const state = Object.freeze({
		get massDelta() { return installedMass; },
		get retentionBonus() { return installedRetention; },
		get pulseBonus() { return installedPulse; },
		get coolingBonus() { return installedCooling; },
		get prediction() { return predictionEnabled; },
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

	// Research couples added or removed mass to the moving platform exactly like
	// an equipment installation, so the physics helper is shared.
	function research(id, world) {
		const node = find(id);
		if (!node || status(id) !== AVAILABLE) return false;
		const economy = root.SteamCeiling;
		if (!economy) return false;
		const physics = root.SteamPhysics;
		const oldMass = world && physics ? physics.platformMass(world) : 0;
		if (!economy.purchase(node.name, node.cost, world ? world.time : 0, 'research')) return false;
		done.add(id);
		installedMass += node.massDelta || 0;
		installedRetention += node.retentionBonus || 0;
		installedPulse += node.pulseBonus || 0;
		installedCooling += node.coolingBonus || 0;
		if (node.capability === 'prediction') predictionEnabled = true;
		if (physics) physics.applyMassChange(world, node.massDelta || 0, oldMass);
		return true;
	}

	function reset() {
		done.clear();
		installedMass = 0;
		installedRetention = 0;
		installedPulse = 0;
		installedCooling = 0;
		predictionEnabled = false;
	}

	const api = { nodes, state, status, constants: Object.freeze({ LOCKED, AVAILABLE, RESEARCHED }), find, isResearched, research, reset };
	root.SteamResearch = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
