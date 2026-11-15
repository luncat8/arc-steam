(function (root) {
	'use strict';
	// The sandblaster: a nozzle in the collector that throws a stream of
	// abrasive grains at the ceiling. The abrasive is the hopper's own debris:
	// each grain is a little sand, or stone once the sand is gone, taken out of
	// the owner's cargo together with a share of the reserve. A grain chips the
	// rock through the shared weakening rule and falls back as the debris it
	// is, into whichever hopper catches it or onto the floor.
	// Depends on (at call time): js/ceiling.js, js/physics.js, js/equipment.js, js/players.js
	const node = typeof module !== 'undefined' && module.exports;
	const mineralIds = (node ? require('./minerals.js') : root.SteamMinerals).mineralIds;
	// The feed order: sand is nearly worthless, so it goes first.
	const abrasives = [mineralIds.indexOf('sand'), mineralIds.indexOf('stone')];
	const gravity = 9.81;
	// A grain now spends ten times the old 13.5 J draw. Its entire draw goes
	// into the throw, not an unbooked motor loss: the hit and the ledger see it.
	const shotEnergy = 135;
	const grainMass = 0.02;
	const nozzleHeight = 0.14;
	// Repeated 20 g draws leave rounding dust; it must not hide the last grain.
	const grainDust = 1e-9;
	const autoFireReserve = 0.2;
	const rate = 20;
	const rateStep = 1 / rate;
	const spread = 0.12;
	const maxPlayers = 5;
	const maxGrainsPerOwner = 40;
	const maxGrains = maxPlayers * maxGrainsPerOwner;

	const FREE = 0;
	const FLYING = 1;
	const FALLING = 2;

	const grainState = new Uint8Array(maxGrains);
	const grainOwner = new Uint8Array(maxGrains);
	const grainX = new Float64Array(maxGrains);
	const grainY = new Float64Array(maxGrains);
	const grainVx = new Float64Array(maxGrains);
	const grainVy = new Float64Array(maxGrains);
	const grainAge = new Float64Array(maxGrains);
	const grainTint = new Uint8Array(maxGrains);
	const grainMineral = new Uint8Array(maxGrains);
	const grainValue = new Float64Array(maxGrains);
	const ownerIds = ['rig', 'rival-1', 'rival-2', 'rival-3', 'rival-4'];
	const tints = ['#e8d9a8', '#d8c089', '#cbb474', '#f0e6cc', '#b8a888'];
	const profiles = new Map();
	let randomState = 1;

	function ownerId(owner) {
		return owner && typeof owner === 'object' ? owner.id : owner || 'rig';
	}

	function ownerIndex(owner) {
		const id = ownerId(owner);
		const roster = root.SteamPlayers && root.SteamPlayers.state.players;
		if (roster) for (let i = 0; i < roster.length; i++) if (roster[i].id === id) return i;
		for (let i = 0; i < ownerIds.length; i++) if (ownerIds[i] === id) return i;
		return -1;
	}

	function profileForIndex(index) {
		return profileFor(ownerIds[index] || 'rig');
	}

	function viewOf(profile) {
		return Object.freeze({
			shotEnergy, grainMass, nozzleHeight, rate, autoFireReserve,
			maxGrains, maxGrainsPerOwner, FREE, FLYING, FALLING,
			grainState, grainOwner, grainX, grainY, grainVx, grainVy, grainAge, grainTint, grainMineral, grainValue,
			get autoFire() { return profile.autoFire || profile.botFire; },
			get botFire() { return profile.botFire; },
			get botPaused() { return profile.botPaused; },
			get fired() { return profile.fired; },
			get hits() { return profile.hits; },
			get recovered() { return profile.recovered; },
			get lost() { return profile.lost; },
			get lastImpactX() { return profile.lastImpactX; },
			get lastImpactY() { return profile.lastImpactY; },
			get aloft() { return aloftBy(ownerIndex(profile.id)); },
			get grainsAloft() { return aloftBy(ownerIndex(profile.id)); },
			get chamberAloft() { return aloft(); }
		});
	}

	function profileFor(owner) {
		const id = ownerId(owner);
		let profile = profiles.get(id);
		if (profile) return profile;
		profile = {
			id, autoFire: false, botFire: false, botManaged: false, botPaused: false, rate: 0,
			fired: 0, hits: 0, recovered: 0, lost: 0,
			lastImpactX: 0, lastImpactY: 0
		};
		profile.view = viewOf(profile);
		profiles.set(id, profile);
		return profile;
	}

	function hasTool(owner) {
		return Boolean(root.SteamEquipment && root.SteamEquipment.isInstalled('sandblaster', owner));
	}

	function random() {
		randomState = (randomState + 0x6D2B79F5) | 0;
		let value = Math.imul(randomState ^ randomState >>> 15, 1 | randomState);
		value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
		return ((value ^ value >>> 14) >>> 0) / 4294967296;
	}

	// A new run clears the grain pool and bot duties, but keeps each player's
	// explicit auto-fire order, just as the racks keep their standing orders.
	function reset(seed) {
		randomState = Math.imul(Number.isFinite(seed) ? seed : 1, 0x9E3779B1);
		grainState.fill(FREE);
		grainOwner.fill(0);
		for (const profile of profiles.values()) {
			profile.botFire = profile.botManaged = profile.botPaused = false;
			profile.rate = 0;
			profile.fired = 0;
			profile.hits = 0;
			profile.recovered = 0;
			profile.lost = 0;
			profile.lastImpactX = 0;
			profile.lastImpactY = 0;
		}
	}

	// A player's standing order survives New game. The bot's own order is a
	// separate, temporary duty: turning BOT off must not leave an unwanted
	// stream running, nor may it erase an order the player explicitly gave.
	// Unchecking Auto-fire while BOT is working pauses its duty until BOT is
	// toggled off/on or the player explicitly turns Auto-fire back on.
	function setAutoFire(on, owner) {
		const profile = profileFor(owner);
		profile.autoFire = Boolean(on);
		if (on) profile.botPaused = false;
		else if (profile.botManaged) {
			profile.botPaused = true;
			profile.botFire = false;
		}
		return profile.autoFire || profile.botFire;
	}

	function setBotFire(on, owner) {
		const profile = profileFor(owner);
		profile.botManaged = true;
		profile.botFire = Boolean(on) && !profile.botPaused;
		return profile.botFire;
	}

	function clearBotFire(owner) {
		const profile = profileFor(owner);
		profile.botFire = profile.botManaged = profile.botPaused = false;
	}

	// The rig keeps its hopper in the chamber's books and inside the mine's
	// energy ledger; a competitor keeps its own on its body, outside it.
	function hopperMinerals(world, machine) {
		return machine === world ? root.SteamCeiling.state.cargoMinerals : machine.cargoMinerals;
	}

	function hopperCells(world, machine) {
		return machine === world ? root.SteamCeiling.state.cargoCells : machine.cargoCells;
	}

	function hopperFull(world, owner) {
		return hopperCells(world, root.SteamPhysics.machineById(world, ownerId(owner))) >= root.SteamCeiling.state.storageLimit;
	}

	// The mineral the next grain is made of, or -1 with no abrasive aboard.
	function feed(world, owner) {
		const minerals = hopperMinerals(world, root.SteamPhysics.machineById(world, ownerId(owner)));
		for (let i = 0; i < abrasives.length; i++) if (minerals[abrasives[i]] >= grainMass - grainDust) return abrasives[i];
		return -1;
	}

	function grainsAboard(world, owner) {
		const minerals = hopperMinerals(world, root.SteamPhysics.machineById(world, ownerId(owner)));
		let grains = 0;
		for (let i = 0; i < abrasives.length; i++) grains += Math.floor((minerals[abrasives[i]] + grainDust) / grainMass);
		return grains;
	}

	function aloftBy(index) {
		if (index < 0) return 0;
		let count = 0;
		for (let i = 0; i < maxGrains; i++) if (grainState[i] !== FREE && grainOwner[i] === index) count++;
		return count;
	}

	function aloft() {
		let count = 0;
		for (let i = 0; i < maxGrains; i++) if (grainState[i] !== FREE) count++;
		return count;
	}

	// A grain is thrown only while the hopper holds sand or stone and is not
	// packed full, the reserve covers the draw, the stream's rate has recovered
	// and the pool has room. A full hopper stops the nozzle: nothing it brought
	// down could be caught, and the grains could not come home.
	function canFire(world, owner) {
		const id = ownerId(owner);
		const index = ownerIndex(id);
		if (!world || !hasTool(id) || profileFor(id).rate > 0 || index < 0) return false;
		if (id === world.platform.id && world.battery < shotEnergy) return false;
		if (hopperFull(world, id) || feed(world, id) < 0) return false;
		return aloftBy(index) < maxGrainsPerOwner;
	}

	// The per-grain draw becomes vertical launch energy. The grain starts with
	// the platform's velocity *at fire time*, plus its upward speed relative
	// to the nozzle; after that only gravity changes its flight. The rig's
	// hopper is already in the ledger at cargoHeight, so the launch accounts
	// for the height difference. The terrain-prescribed vertical speed of a
	// climbing platform is not in platform kinetic energy: its contribution
	// to the launched grain is booked as terrain work. A rival's hopper and
	// machine are outside the rig's ledger, so the grain's whole initial
	// energy is imported instead.
	function fire(world, owner) {
		const id = ownerId(owner);
		if (!canFire(world, id)) return false;
		const physics = root.SteamPhysics;
		const machine = physics.machineById(world, id);
		const body = physics.machineBody(machine);
		const mineral = feed(world, id);
		let slot = 0;
		while (grainState[slot] !== FREE) slot++;
		const rig = machine === world;
		const lift = shotEnergy + (rig ? grainMass * gravity * root.SteamCeiling.state.cargoHeight : 0);
		if (rig) {
			world.battery -= shotEnergy;
			grainValue[slot] = root.SteamCeiling.unloadCargo(mineral, grainMass);
		} else grainValue[slot] = root.SteamPlayers.unloadCargo(machine, mineral, grainMass);
		const profile = profileFor(id);
		profile.fired++;
		profile.rate = rateStep;
		grainState[slot] = FLYING;
		grainOwner[slot] = ownerIndex(id);
		grainMineral[slot] = mineral;
		grainX[slot] = physics.sandblasterNozzleX(world, id);
		grainY[slot] = body.y + physics.config.deck + nozzleHeight;
		grainVx[slot] = body.vx;
		const relativeVy = Math.sqrt(Math.max(0, 2 * (lift - grainMass * gravity * grainY[slot]) / grainMass));
		grainVy[slot] = body.vy + relativeVy;
		if (rig) world.terrainWork += 0.5 * grainMass * (grainVy[slot] * grainVy[slot] - relativeVy * relativeVy);
		else world.importedEnergy += grainMass * (0.5 * (grainVx[slot] * grainVx[slot] + grainVy[slot] * grainVy[slot]) + gravity * grainY[slot]);
		grainAge[slot] = 0;
		grainTint[slot] = Math.floor(random() * tints.length);
		return true;
	}

	// The ground a falling body meets at x: rubble, or the deck of any platform.
	function groundAt(world, x) {
		const physics = root.SteamPhysics;
		let ground = root.SteamCeiling.floorAt(x);
		const half = physics.config.platformWidth * 0.5;
		const machines = physics.machinesOf(world);
		for (let i = 0; i < machines.length; i++) {
			const body = physics.machineBody(machines[i]);
			if (Math.abs(x - body.x) > half) continue;
			const deck = body.y + physics.config.deck;
			if (deck > ground) ground = deck;
		}
		return ground;
	}

	function stow(world, machine, i) {
		return machine === world
			? root.SteamCeiling.loadCargo(grainMineral[i], grainMass, grainValue[i])
			: root.SteamPlayers.loadCargo(machine, grainMineral[i], grainMass, grainValue[i]);
	}

	// A falling grain is caught by the first platform whose collector span it
	// crosses and whose hopper has room, and becomes that platform's cargo,
	// sharing its momentum with the platform. The rig's motion and its cargo
	// height are in the mine's ledger, so what the merge and the hopper keep
	// stays out of the heat; a rival's body and hopper are outside the ledger
	// and the grain's whole energy leaves as heat.
	function catchGrain(world, i) {
		const physics = root.SteamPhysics;
		const machines = physics.machinesOf(world);
		for (let m = 0; m < machines.length; m++) {
			const machine = machines[m];
			const body = physics.machineBody(machine);
			const deck = body.y + physics.config.deck;
			if (grainY[i] > deck) continue;
			const left = body.x - physics.config.platformWidth * 0.5;
			if (grainX[i] < left || grainX[i] > left + physics.config.platformWidth * physics.config.collectorFraction) continue;
			const mass = physics.machineMass(world, machine);
			if (!stow(world, machine, i)) continue;
			const before = 0.5 * mass * body.vx * body.vx;
			body.vx = (mass * body.vx + grainMass * grainVx[i]) / (mass + grainMass);
			world.heat += 0.5 * grainMass * (grainVx[i] * grainVx[i] + grainVy[i] * grainVy[i]) + grainMass * gravity * grainY[i];
			if (machine === world) world.heat += before - 0.5 * (mass + grainMass) * body.vx * body.vx - grainMass * gravity * root.SteamCeiling.state.cargoHeight;
			profileForIndex(grainOwner[i]).recovered++;
			grainState[i] = FREE;
			return true;
		}
		return false;
	}

	// A grain that misses every collector is spilled where it lands and joins
	// the floor rubble with its value, so the material is still in the mine.
	// Its whole remaining energy books to heat, like any landed fragment.
	function loseGrain(world, i) {
		profileForIndex(grainOwner[i]).lost++;
		world.heat += 0.5 * grainMass * (grainVx[i] * grainVx[i] + grainVy[i] * grainVy[i]) + grainMass * gravity * grainY[i];
		root.SteamCeiling.spill(grainX[i], grainMass / root.SteamCeiling.state.cellMass, grainValue[i]);
		grainState[i] = FREE;
	}

	// The impact: the grain's arriving energy chips the face through the shared
	// weakening rule. The grain leaves the impact with its fall spread and the
	// face's height, so the difference between what it arrived with and what it
	// keeps is what the rock can take; the share the rock took is booked as
	// fracture energy and the rest of the impact as heat, so the reserve draw
	// closes exactly.
	function impactGrain(world, i, face) {
		const fallVx = grainVx[i] + (2 * random() - 1) * spread;
		const before = 0.5 * grainMass * (grainVx[i] * grainVx[i] + grainVy[i] * grainVy[i]) + grainMass * gravity * grainY[i];
		const after = 0.5 * grainMass * fallVx * fallVx + grainMass * gravity * face;
		const energy = before - after;
		const index = grainOwner[i];
		const profile = profileForIndex(index);
		const taken = root.SteamCeiling.chip(grainX[i], face, energy, 1);
		profile.hits++;
		profile.lastImpactX = grainX[i];
		profile.lastImpactY = face;
		world.fractureEnergy += taken;
		world.heat += energy - taken;
		grainState[i] = FALLING;
		grainY[i] = face;
		grainVx[i] = fallVx;
		grainVy[i] = 0;
	}

	function stepGrain(world, i, dt) {
		grainAge[i] += dt;
		grainY[i] += grainVy[i] * dt - 0.5 * gravity * dt * dt;
		grainVy[i] -= gravity * dt;
		grainX[i] += grainVx[i] * dt;
		if (grainX[i] < 0 || grainX[i] > root.SteamPhysics.config.width) {
			loseGrain(world, i);
			return;
		}
		if (grainState[i] === FLYING) {
			const face = root.SteamCeiling.surfaceAt(grainX[i]);
			if (grainY[i] >= face) impactGrain(world, i, face);
			return;
		}
		if (catchGrain(world, i)) return;
		if (grainY[i] <= groundAt(world, grainX[i])) loseGrain(world, i);
	}

	// The standing order must not strand the rig: it holds its fire while the
	// reserve is under the share the trip to the charge pad starts at. The key
	// and the button still throw down to the last grain's worth.
	function autoFireAllowed(world, owner) {
		return owner !== world.platform.id || world.battery >= root.SteamPhysics.config.battery * autoFireReserve;
	}

	function stepOwner(world, dt, owner) {
		const profile = profileFor(owner);
		if (profile.rate > 0) profile.rate = profile.rate - dt > dt * 0.5 ? profile.rate - dt : 0;
		if ((profile.autoFire || profile.botFire) && autoFireAllowed(world, owner)) fire(world, owner);
	}

	function step(world, dt) {
		const roster = root.SteamPlayers && root.SteamPlayers.state.players;
		if (roster && roster.length) {
			for (let i = 0; i < roster.length; i++) stepOwner(world, dt, roster[i].id);
		} else stepOwner(world, dt, 'rig');
		for (let i = 0; i < maxGrains; i++) if (grainState[i] !== FREE) stepGrain(world, i, dt);
	}

	function draw(context) {
		const rock = root.SteamCeiling;
		for (let i = 0; i < maxGrains; i++) {
			if (grainState[i] === FREE) continue;
			const y = rock.rockDrawnY(grainY[i]);
			const scale = rock.perspectiveScale(grainY[i]);
			const fade = 1 - Math.min(1, grainAge[i] * 0.5);
			context.globalAlpha = 0.35 + fade * 0.5;
			// Only the grain's *current* position is drawn. A path back to its
			// muzzle looks like a stale beam once the platform has moved away.
			context.fillStyle = tints[grainTint[i]];
			context.beginPath();
			context.arc(grainX[i], y, 0.035 * scale, 0, Math.PI * 2);
			context.fill();
		}
		context.globalAlpha = 1;
	}

	function stateFor(owner) { return profileFor(owner).view; }
	const state = stateFor('rig');
	const api = { state, stateFor, reset, setAutoFire, setBotFire, clearBotFire, canFire, fire, feed, grainsAboard, hopperFull, step, draw };
	root.SteamSandblaster = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
