(function (root) {
	'use strict';
	// The sandblaster: a nozzle in the collector that throws a stream of
	// abrasive grains at the ceiling. Each grain spends reserve energy and one
	// charge of the owner's magazine; a grain that hits the rock chips it
	// through the shared weakening rule and falls back as collectable material.
	// Depends on (at call time): js/ceiling.js, js/physics.js, js/equipment.js
	const gravity = 9.81;
	const price = 3;
	const capacity = 60;
	const visitLimit = 10;
	const shotEnergy = 13.5;
	const grainMass = 0.02;
	const rate = 10;
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
	const grainOX = new Float64Array(maxGrains);
	const grainOY = new Float64Array(maxGrains);
	const grainAge = new Float64Array(maxGrains);
	const grainTint = new Uint8Array(maxGrains);
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
			price, capacity, visitLimit, shotEnergy, grainMass, rate,
			maxGrains, maxGrainsPerOwner, FREE, FLYING, FALLING,
			grainState, grainOwner, grainX, grainY, grainVx, grainVy, grainAge, grainTint,
			get charges() { return profile.charges; },
			get autoBuy() { return profile.autoBuy; },
			get unitPrice() { return unitPrice(); },
			get bought() { return profile.bought; },
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
			id, charges: 0, autoBuy: false, visitBought: 0, rate: 0,
			bought: 0, fired: 0, hits: 0, recovered: 0, lost: 0,
			lastImpactX: 0, lastImpactY: 0
		};
		profile.view = viewOf(profile);
		profiles.set(id, profile);
		return profile;
	}

	function hasTool(owner) {
		return Boolean(root.SteamEquipment && root.SteamEquipment.isInstalled('sandblaster', owner));
	}

	function unitPrice() {
		return root.SteamCeiling ? root.SteamCeiling.price(price) : price;
	}

	function fundsFor(owner) {
		const id = ownerId(owner);
		if (id === 'rig') return root.SteamCeiling ? root.SteamCeiling.state.funds : 0;
		const players = root.SteamPlayers;
		const index = ownerIndex(id);
		return players && index >= 0 ? players.money(index) : 0;
	}

	function random() {
		randomState = (randomState + 0x6D2B79F5) | 0;
		let value = Math.imul(randomState ^ randomState >>> 15, 1 | randomState);
		value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
		return ((value ^ value >>> 14) >>> 0) / 4294967296;
	}

	// A new run empties every magazine and grain pool but keeps each player's
	// standing order, just as the racks do.
	function reset(seed) {
		randomState = Math.imul(Number.isFinite(seed) ? seed : 1, 0x9E3779B1);
		grainState.fill(FREE);
		grainOwner.fill(0);
		for (const profile of profiles.values()) {
			profile.charges = 0;
			profile.visitBought = 0;
			profile.rate = 0;
			profile.bought = 0;
			profile.fired = 0;
			profile.hits = 0;
			profile.recovered = 0;
			profile.lost = 0;
			profile.lastImpactX = 0;
			profile.lastImpactY = 0;
		}
	}

	function setAutoBuy(on, owner) {
		const profile = profileFor(owner);
		profile.autoBuy = Boolean(on);
		return profile.autoBuy;
	}

	// Test mode loads a full magazine as a grant, like its other equipment.
	function fill(world, owner) {
		if (!hasTool(owner)) return false;
		const profile = profileFor(owner);
		if (profile.charges >= capacity) return false;
		const count = capacity - profile.charges;
		const label = count + ' charges';
		const id = ownerId(owner);
		const time = world ? world.time : 0;
		if (id === 'rig') {
			if (!root.SteamCeiling || !root.SteamCeiling.grant(label, time, 'buy')) return false;
		} else {
			const players = root.SteamPlayers;
			if (!players || !players.purchase(id, label, 0, time, 'buy', true)) return false;
		}
		profile.charges = capacity;
		return true;
	}

	function buy(world, wanted, owner) {
		const id = ownerId(owner);
		if (!hasTool(id) || !root.SteamPhysics.atSellWall(world, id)) return 0;
		const profile = profileFor(id);
		const unit = unitPrice();
		const affordable = unit > 0 ? Math.floor(fundsFor(id) / unit) : wanted;
		const count = Math.min(wanted, capacity - profile.charges, affordable);
		if (count <= 0) return 0;
		const label = count === 1 ? '1 charge' : count + ' charges';
		const amount = count * price;
		const time = world.time;
		const paid = id === 'rig'
			? Boolean(root.SteamCeiling && root.SteamCeiling.purchase(label, amount, time))
			: Boolean(root.SteamPlayers && root.SteamPlayers.purchase(id, label, amount, time, 'buy'));
		if (!paid) return 0;
		profile.charges += count;
		profile.bought += count;
		return count;
	}

	function visit(world, owner) {
		const id = ownerId(owner);
		const profile = profileFor(id);
		if (!root.SteamPhysics.atSellWall(world, id)) {
			profile.visitBought = 0;
			return;
		}
		if (!profile.autoBuy || profile.visitBought >= visitLimit || !hasTool(id)) return;
		profile.visitBought += buy(world, visitLimit - profile.visitBought, id);
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

	function freeGrains() {
		return maxGrains - aloft();
	}

	// A grain is thrown only while the magazine has a charge, the reserve
	// covers the draw, the stream's rate has recovered and the pool has room.
	// The nozzle's throw: the reserve's per-grain draw buys the grain's lift
	// and its speed, exactly like the piston's pulse, so the flight energy the
	// ledger gives at the nozzle is the energy it receives back at the
	// resolution. The draw is calibrated so a held stream on ordinary rock
	// roughly breaks even against the caught material (yield probe).
	function throwSpeed(y) {
		return Math.sqrt(2 * (shotEnergy - grainMass * gravity * y) / grainMass);
	}

	// The rig's nozzle draws the mine's reserve; a rival's nozzle is its own
	// machinery outside the rig's ledger, so its throw books as imported work,
	// the same way its piston pulse does.
	function isRig(world, id) {
		return root.SteamPhysics.machineBody(root.SteamPhysics.machineById(world, id)).id === world.platform.id;
	}

	function canFire(world, owner) {
		const id = ownerId(owner);
		const profile = profileFor(id);
		const index = ownerIndex(id);
		if (!hasTool(id) || profile.charges <= 0 || profile.rate > 0 || index < 0) return false;
		if (!world) return false;
		const machine = root.SteamPhysics.machineById(world, id);
		if (!machine) return false;
		if (isRig(world, id) && world.battery < shotEnergy) return false;
		const deck = root.SteamPhysics.machineBody(machine).y + root.SteamPhysics.config.deck;
		return throwSpeed(deck) > 0 && aloftBy(index) < maxGrainsPerOwner && freeGrains() >= 1;
	}

	function fire(world, owner) {
		const id = ownerId(owner);
		if (!world || !canFire(world, id)) return false;
		const physics = root.SteamPhysics;
		const index = ownerIndex(id);
		let slot = 0;
		while (grainState[slot] !== FREE) slot++;
		const machine = physics.machineById(world, id);
		const body = physics.machineBody(machine);
		if (isRig(world, id)) world.battery -= shotEnergy;
		else world.importedEnergy += shotEnergy;
		const profile = profileFor(id);
		profile.charges--;
		profile.fired++;
		profile.rate = rateStep;
		grainState[slot] = FLYING;
		grainOwner[slot] = index;
		grainX[slot] = physics.collectorX(world, id);
		grainY[slot] = body.y + physics.config.deck;
		grainOX[slot] = grainX[slot];
		grainOY[slot] = grainY[slot];
		grainVx[slot] = 0;
		grainVy[slot] = throwSpeed(grainY[slot]);
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

	// A falling grain is caught by the first platform whose collector span it
	// crosses. The charge returns to the owner that fired it. The kinetic
	// energy books to heat through the platform's own momentum exchange, and
	// the height the catcher's deck stands at against the launch height closes
	// the grain's potential energy, so the mine's ledger stays exact.
	function catchGrain(world, i) {
		const physics = root.SteamPhysics;
		const index = grainOwner[i];
		const profile = profileForIndex(index);
		const machines = physics.machinesOf(world);
		for (let m = 0; m < machines.length; m++) {
			const machine = machines[m];
			const body = physics.machineBody(machine);
			const deck = body.y + physics.config.deck;
			if (grainY[i] > deck) continue;
			const left = body.x - physics.config.platformWidth * 0.5;
			if (grainX[i] < left || grainX[i] > left + physics.config.platformWidth * physics.config.collectorFraction) continue;
			const mass = physics.machineMass(world, machine);
			const wealth = 0.5 * grainMass * (grainVx[i] * grainVx[i] + grainVy[i] * grainVy[i]) + grainMass * gravity * grainY[i];
			const before = wealth + 0.5 * mass * body.vx * body.vx;
			body.vx = (mass * body.vx + grainMass * grainVx[i]) / (mass + grainMass);
			const after = 0.5 * (mass + grainMass) * body.vx * body.vx;
			world.heat += before - after;
			profile.charges = Math.min(capacity, profile.charges + 1);
			profile.recovered++;
			grainState[i] = FREE;
			return true;
		}
		return false;
	}

	// A grain that reaches the floor or leaves the chamber is gone: the charge
	// does not return. The grain's whole remaining energy books to heat, which
	// is what the reserve draw at the nozzle had left in it.
	function loseGrain(world, i) {
		const profile = profileForIndex(grainOwner[i]);
		profile.lost++;
		world.heat += 0.5 * grainMass * (grainVx[i] * grainVx[i] + grainVy[i] * grainVy[i]) + grainMass * gravity * grainY[i];
		grainState[i] = FREE;
	}

	// The impact: the grain's arriving energy chips the face through the shared
	// weakening rule. The grain leaves the impact with its fall spread and the
	// face's height, so the difference between what it arrived with and what it
	// keeps is what the rock can take; the share the rock took is booked as
	// fracture energy and the rest of the impact as heat, so the reserve draw
	// closes exactly.
	function impactGrain(world, i, face) {
		const fallVx = (2 * random() - 1) * spread;
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
		if (grainState[i] === FLYING) {
			grainY[i] += grainVy[i] * dt - 0.5 * gravity * dt * dt;
			grainVy[i] -= gravity * dt;
			const face = root.SteamCeiling.surfaceAt(grainX[i]);
			if (grainY[i] < face) return;
			impactGrain(world, i, face);
			return;
		}
		grainY[i] += grainVy[i] * dt - 0.5 * gravity * dt * dt;
		grainVy[i] -= gravity * dt;
		grainX[i] += grainVx[i] * dt;
		const width = root.SteamPhysics.config.width;
		if (grainX[i] < 0 || grainX[i] > width) {
			loseGrain(world, i);
			return;
		}
		if (catchGrain(world, i)) return;
		if (grainY[i] <= groundAt(world, grainX[i])) loseGrain(world, i);
	}

	function stepOwner(world, dt, owner) {
		const profile = profileFor(owner);
		if (profile.rate > 0) profile.rate = profile.rate - dt > dt * 0.5 ? profile.rate - dt : 0;
		visit(world, owner);
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
			if (grainState[i] === FLYING) {
				context.strokeStyle = tints[grainTint[i]];
				context.lineWidth = 0.02;
				context.beginPath();
				context.moveTo(grainOX[i], rock.rockDrawnY(grainOY[i]));
				context.lineTo(grainX[i], y);
				context.stroke();
			}
			context.fillStyle = tints[grainTint[i]];
			context.beginPath();
			context.arc(grainX[i], y, 0.035 * scale, 0, Math.PI * 2);
			context.fill();
		}
		context.globalAlpha = 1;
	}

	function stateFor(owner) { return profileFor(owner).view; }
	const state = stateFor('rig');
	const api = { state, stateFor, reset, setAutoBuy, buy, fill, canFire, fire, step, draw };
	root.SteamSandblaster = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
