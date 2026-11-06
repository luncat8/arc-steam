(function (root) {
	'use strict';
	// Machinery is purchased into one player's profile. The item catalogue is
	// shared, but ownership, installed tiers and every measured delta are not.
	const items = Object.freeze([
		Object.freeze({
			id: 'grader', name: 'Road grader', cost: 300, mass: 10,
			effect: '1.5 m under-chassis blade smooths floor rubble while moving; adds rolling resistance.'
		}),
		Object.freeze({
			id: 'pad', name: 'Rebound pad', cost: 250, mass: 6, requires: 'materials',
			retentionBonus: 0.03,
			effect: 'Reflector bounce retention +3% (93% over stock).'
		}),
		Object.freeze({
			id: 'coil', name: 'Drive coil', cost: 400, mass: 12, requires: 'electromagnetics',
			pulseBonus: 12,
			effect: 'Bounce drive pulse +12 J per contact.'
		}),
		Object.freeze({
			id: 'motor', name: 'High-torque motor', cost: 550, mass: 6, requires: 'traction',
			forceBonus: 360, speedBonus: 6,
			effect: 'Engine force +360 N and top speed +6 m/s.'
		}),
		Object.freeze({
			id: 'overdrive', name: 'Overdrive unit', cost: 950, mass: 8, requires: 'power',
			forceBonus: 480, speedBonus: 6,
			effect: 'Engine force +480 N and top speed +6 m/s; burns reserve and brakes hot.'
		}),
		Object.freeze({
			id: 'chassis', name: 'Lightweight chassis', cost: 350, mass: -12, requires: 'alloys',
			effect: 'Cuts dry platform mass by 12 kg for faster acceleration under load.'
		}),
		Object.freeze({
			id: 'flywheel', name: 'Brake flywheel', cost: 480, mass: 14, requires: 'storage',
			recoveryFraction: 0.55,
			effect: 'Returns 55% of braking energy to reserve at 90% efficiency (wall stops unrecovered).'
		})
	]);
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
	const balls = Object.freeze([
		Object.freeze({
			id: 'standard', name: 'Standard ball', cost: 0, mass: 0, damageBonus: 0, rockRetentionBonus: 0, damageRadiusBonus: 0,
			effect: 'Stock 3.2 kg sphere · 10% bounce loss into fracture (×2.0 damage) · balanced rebound.'
		}),
		Object.freeze({
			id: 'hardened', name: 'Hardened steel ball', cost: 380, mass: 3, damageBonus: 0.3, rockRetentionBonus: -0.04, damageRadiusBonus: 0.7,
			effect: 'Hardened tip · +15% fracture per joule (×2.3) and 14% loss per rock hit (vs 10% stock), 8% wider splash. +3 kg. Trade-off: lower rebounds, needs more frequent recharges.'
		}),
		Object.freeze({
			id: 'spike', name: 'Spiked hammer ball', cost: 720, mass: 5, damageBonus: 0.7, rockRetentionBonus: -0.10, damageRadiusBonus: 1.4,
			effect: 'Spiked hammer head · +35% fracture per joule (×2.7) and 20% loss per rock hit, 16% wider splash. +5 kg. Trade-off: rock drains more energy, fewer bounces per charge.'
		})
	]);
	const engineCosts = Object.freeze({ hand: 60, coal: 250, oil: 650, electric: 850, nuclear: 2400 });
	const profiles = new Map();

	function ownerId(owner) {
		return owner && typeof owner === 'object' ? owner.id : owner || 'rig';
	}

	function viewOf(profile) {
		return Object.freeze({
			get massDelta() { return profile.massDelta; },
			get retentionBonus() { return profile.retentionBonus; },
			get pulseBonus() { return profile.pulseBonus; },
			get radiatorArea() {
				if (!profile.radiatorId) return 0;
				return radiatorEntry(profile.radiatorId).radiatorArea;
			},
			get recoveryFraction() { return profile.recovery; },
			get forceBonus() { return profile.forceBonus; },
			get speedBonus() { return profile.speedBonus; },
			get damageBonus() { return profile.damageBonus; },
			get rockRetentionBonus() { return profile.rockRetentionBonus; },
			get damageRadiusBonus() { return profile.damageRadiusBonus; },
			get ballMassBonus() { return profile.ballMassBonus; },
			get ballId() { return profile.ballId; }
		});
	}

	function createProfile() {
		const profile = {
			installed: new Set(), ownedEngines: new Set(['electric']),
			radiatorId: null, ownedRadiators: new Set(),
			ballId: 'standard', ownedBalls: new Set(['standard']),
			massDelta: 0, retentionBonus: 0, pulseBonus: 0, recovery: 0,
			forceBonus: 0, speedBonus: 0, damageBonus: 0,
			rockRetentionBonus: 0, damageRadiusBonus: 0, ballMassBonus: 0
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

	const state = Object.freeze({
		get massDelta() { return profileFor('rig').massDelta; },
		get retentionBonus() { return profileFor('rig').retentionBonus; },
		get pulseBonus() { return profileFor('rig').pulseBonus; },
		get radiatorArea() { return stateFor('rig').radiatorArea; },
		get recoveryFraction() { return profileFor('rig').recovery; },
		get forceBonus() { return profileFor('rig').forceBonus; },
		get speedBonus() { return profileFor('rig').speedBonus; },
		get damageBonus() { return profileFor('rig').damageBonus; },
		get rockRetentionBonus() { return profileFor('rig').rockRetentionBonus; },
		get damageRadiusBonus() { return profileFor('rig').damageRadiusBonus; },
		get ballMassBonus() { return profileFor('rig').ballMassBonus; },
		get ballId() { return profileFor('rig').ballId; }
	});

	function stateFor(owner) { return profileFor(owner).view; }
	function ownsEngine(id, owner) { return profileFor(owner).ownedEngines.has(id); }
	function ownsRadiator(id, owner) { return profileFor(owner).ownedRadiators.has(id); }
	function ownsBall(id, owner) { return profileFor(owner).ownedBalls.has(id); }
	function isInstalled(id, owner) { return profileFor(owner).installed.has(id); }
	function installedRadiator(owner) { return profileFor(owner).radiatorId; }
	function installedBall(owner) { return profileFor(owner).ballId; }

	function find(id) {
		for (const item of items) if (item.id === id) return item;
		return null;
	}

	function radiatorEntry(id) {
		for (const radiator of radiators) if (radiator.id === id) return radiator;
		return null;
	}

	function ballEntry(id) {
		for (const ball of balls) if (ball.id === id) return ball;
		return null;
	}

	function commons() {
		const economy = root.SteamCeiling;
		return Boolean(economy && economy.state.commune);
	}

	function radiatorUnlocked(id, owner) {
		if (!radiatorEntry(id)) return false;
		return commons() || Boolean(root.SteamResearch && root.SteamResearch.isResearched('thermodynamics', owner));
	}

	function ballUnlocked(id, owner) {
		if (!ballEntry(id)) return false;
		return commons() || Boolean(root.SteamResearch && root.SteamResearch.isResearched('impact', owner));
	}

	function isUnlocked(id, owner) {
		const item = find(id);
		if (!item) return false;
		if (commons()) return true;
		return !item.requires || Boolean(root.SteamResearch && root.SteamResearch.isResearched(item.requires, owner));
	}

	function purchase(owner, label, cost, world, testGrant) {
		const id = ownerId(owner);
		const time = world ? world.time : 0;
		if (id === 'rig') {
			const economy = root.SteamCeiling;
			if (!economy) return false;
			return testGrant ? economy.grant(label, time, 'buy') : economy.purchase(label, cost, time);
		}
		const players = root.SteamPlayers;
		return Boolean(players && players.purchase(id, label, cost, time, 'buy', testGrant));
	}

	function machineMass(world, owner) {
		const physics = root.SteamPhysics;
		if (!world || !physics || !physics.machineMass) return 0;
		return physics.machineMass(world, physics.machineById(world, ownerId(owner)));
	}

	function coupleMass(world, owner, oldMass) {
		const physics = root.SteamPhysics;
		if (!world || !physics || !physics.applyMachineMassChange) return;
		const machine = physics.machineById(world, ownerId(owner));
		physics.applyMachineMassChange(world, machine, physics.machineMass(world, machine) - oldMass, oldMass);
	}

	function rigBallEnergy(world, owner) {
		if (!world || ownerId(owner) !== 'rig') return 0;
		const physics = root.SteamPhysics;
		let total = 0;
		const balls = world.balls || [];
		for (let i = 0; i < balls.length; i++) if (physics.isRigBall(balls[i])) total += physics.ballEnergy(balls[i]);
		return total;
	}

	function coupleBallEnergy(world, owner, before) {
		if (!world || ownerId(owner) !== 'rig') return;
		const delta = rigBallEnergy(world, owner) - before;
		if (delta > 0) world.importedEnergy += delta;
		else world.heat -= delta;
	}

	function atShop(world, owner) {
		const physics = root.SteamPhysics;
		if (!world || !physics) return false;
		const body = physics.machineBody(physics.machineById(world, ownerId(owner)));
		return body.x <= physics.platformMin() + 0.2 && Math.abs(body.vx) <= 0.1;
	}

	function buyEngine(id, world, owner) {
		const physics = root.SteamPhysics;
		const profile = profileFor(owner);
		if (!physics || !atShop(world, owner) || !Object.hasOwn(engineCosts, id)) return false;
		if (!profile.ownedEngines.has(id) && !purchase(owner, id + ' engine', engineCosts[id], world, false)) return false;
		if (!physics.selectEngine(id, world, ownerId(owner))) return false;
		profile.ownedEngines.add(id);
		return true;
	}

	function installRadiator(id, world, testGrant, owner) {
		const radiator = radiatorEntry(id);
		const profile = profileFor(owner);
		if (!radiator || !radiatorUnlocked(id, owner) || profile.radiatorId === id) return false;
		const oldMass = machineMass(world, owner);
		const alreadyOwned = profile.ownedRadiators.has(id);
		if (!alreadyOwned && !purchase(owner, radiator.name, radiator.cost, world, testGrant)) return false;
		if (alreadyOwned && testGrant && !purchase(owner, radiator.name, radiator.cost, world, true)) return false;
		const oldEntry = profile.radiatorId ? radiatorEntry(profile.radiatorId) : null;
		profile.radiatorId = id;
		profile.massDelta += radiator.mass - (oldEntry ? oldEntry.mass : 0);
		profile.ownedRadiators.add(id);
		coupleMass(world, owner, oldMass);
		return true;
	}

	function installBall(id, world, testGrant, owner) {
		const ball = ballEntry(id);
		const profile = profileFor(owner);
		if (!ball || !ballUnlocked(id, owner) || profile.ballId === id) return false;
		const oldMass = machineMass(world, owner);
		const oldBallEnergy = rigBallEnergy(world, owner);
		const alreadyOwned = profile.ownedBalls.has(id);
		if (!alreadyOwned && !purchase(owner, ball.name, ball.cost, world, testGrant)) return false;
		if (alreadyOwned && testGrant && !purchase(owner, ball.name, ball.cost, world, true)) return false;
		const oldEntry = ballEntry(profile.ballId);
		profile.ballId = id;
		profile.damageBonus += ball.damageBonus - oldEntry.damageBonus;
		profile.rockRetentionBonus += ball.rockRetentionBonus - oldEntry.rockRetentionBonus;
		profile.damageRadiusBonus += ball.damageRadiusBonus - oldEntry.damageRadiusBonus;
		profile.ballMassBonus += ball.mass - oldEntry.mass;
		profile.ownedBalls.add(id);
		coupleMass(world, owner, oldMass);
		coupleBallEnergy(world, owner, oldBallEnergy);
		return true;
	}

	function apply(item, world, owner, testGrant) {
		const profile = profileFor(owner);
		const oldMass = machineMass(world, owner);
		if (!purchase(owner, item.name, item.cost, world, testGrant)) return false;
		profile.installed.add(item.id);
		profile.massDelta += item.mass || 0;
		profile.retentionBonus += item.retentionBonus || 0;
		profile.pulseBonus += item.pulseBonus || 0;
		profile.recovery += item.recoveryFraction || 0;
		profile.forceBonus += item.forceBonus || 0;
		profile.speedBonus += item.speedBonus || 0;
		coupleMass(world, owner, oldMass);
		return true;
	}

	function install(id, world, owner) {
		const item = find(id);
		if (!item || isInstalled(id, owner) || !isUnlocked(id, owner)) return false;
		return apply(item, world, owner, false);
	}

	function grant(id, world, owner) {
		const item = find(id);
		if (!item || isInstalled(id, owner)) return false;
		return apply(item, world, owner, true);
	}

	function installAll(world, owner) {
		let granted = 0;
		for (const item of items) if (grant(item.id, world, owner)) granted++;
		return granted;
	}

	function reset() {
		profiles.clear();
	}

	const api = {
		engineCosts, ownsEngine, atShop, buyEngine, items, radiators,
		ownsRadiator, radiatorUnlocked, installedRadiator, installRadiator,
		balls, ballEntry, ownsBall, ballUnlocked, installedBall, installBall,
		state, stateFor, find, isInstalled, isUnlocked, install, grant, installAll, reset
	};
	root.SteamEquipment = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
