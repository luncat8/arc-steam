(function (root) {
	'use strict';
	// Each platform owns its installed rack, stock and wall-buy order. Rockets
	// and shards share fixed chamber pools, but every projectile keeps its owner.
	// Depends on (at call time): js/ceiling.js, js/physics.js, js/equipment.js
	const gravity = 9.81;
	const price = 14;
	const visitLimit = 3;
	const rackSize = 6;
	const reload = 0.5;
	const fuseSpread = 0.2;
	const dudChance = 0.05;
	const launchSpeed = 3;
	const thrust = 45;
	const noseReach = 0.25;
	const dudRebound = 0.25;
	const shardCount = 24;
	const shardSpeed = 22;
	const shardSpeedSpread = 0.3;
	const shardMass = 0.025;
	const shardRadiusMin = 1;
	const shardRadiusMax = 4;
	const shardLife = 1.6;
	const wallKeep = 0.4;
	const spentKeep = 0.25;
	const flashLife = 0.22;
	const drawnSize = 1.6;
	const maxPlayers = 5;
	const maxRocketsPerRack = 8;
	const maxRockets = maxPlayers * maxRocketsPerRack;
	const maxShards = maxRockets * shardCount;

	const FREE = 0;
	const BURNING = 1;
	const FALLING = 2;
	const LIVE = 1;
	const SPENT = 2;

	const rocketState = new Uint8Array(maxRockets);
	const rocketOwner = new Uint8Array(maxRockets);
	const rocketX = new Float64Array(maxRockets);
	const rocketY = new Float64Array(maxRockets);
	const rocketVy = new Float64Array(maxRockets);
	const rocketFuse = new Float64Array(maxRockets);
	const rocketDud = new Uint8Array(maxRockets);
	const rocketAge = new Float64Array(maxRockets);
	const shardState = new Uint8Array(maxShards);
	const shardOwner = new Uint8Array(maxShards);
	const shardX = new Float64Array(maxShards);
	const shardY = new Float64Array(maxShards);
	const shardVx = new Float64Array(maxShards);
	const shardVy = new Float64Array(maxShards);
	const shardAge = new Float64Array(maxShards);
	const shardRadius = new Float64Array(maxShards);
	const shardTint = new Uint8Array(maxShards);
	const flashX = new Float64Array(maxRockets);
	const flashY = new Float64Array(maxRockets);
	const flashAge = new Float64Array(maxRockets).fill(flashLife);
	let flashCursor = 0;
	const tints = ['#ffd86b', '#ff9a4d', '#ff6f61', '#f5f1e3', '#9fe3ff'];
	const ownerIds = ['rig', 'rival-1', 'rival-2', 'rival-3', 'rival-4'];
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
			price, visitLimit, rackSize, reload, fuseSpread, dudChance, noseReach,
			shardCount, shardSpeed, shardMass, shardRadiusMin, shardRadiusMax, shardLife,
			maxRockets, maxRocketsPerRack, maxShards, FREE, BURNING, FALLING, LIVE, SPENT,
			rocketState, rocketOwner, rocketX, rocketY, rocketVy, rocketFuse, rocketDud,
			shardState, shardOwner, shardX, shardY, shardVx, shardVy, shardAge, shardRadius,
			get stock() { return profile.stock; },
			get autoBuy() { return profile.autoBuy; },
			get unitPrice() { return unitPrice(); },
			get cooldown() { return profile.cooldown; },
			get bought() { return profile.bought; },
			get fired() { return profile.fired; },
			get bursts() { return profile.bursts; },
			get duds() { return profile.duds; },
			get shardHits() { return profile.shardHits; },
			get fracture() { return profile.fracture; },
			get lastBurstX() { return profile.lastBurstX; },
			get lastBurstY() { return profile.lastBurstY; },
			get aloft() { return aloftBy(ownerIndex(profile.id)); },
			get shardsAloft() { return shardsAloftBy(ownerIndex(profile.id)); },
			get chamberAloft() { return aloft(); },
			get chamberShardsAloft() { return shardsAloft(); }
		});
	}

	function profileFor(owner) {
		const id = ownerId(owner);
		let profile = profiles.get(id);
		if (profile) return profile;
		profile = {
			id, stock: 0, autoBuy: false, cooldown: 0, visitBought: 0,
			bought: 0, fired: 0, bursts: 0, duds: 0, shardHits: 0, fracture: 0,
			lastBurstX: 0, lastBurstY: 0
		};
		profile.view = viewOf(profile);
		profiles.set(id, profile);
		return profile;
	}

	function hasRack(owner) {
		return Boolean(root.SteamEquipment && root.SteamEquipment.isInstalled('rocket-rack', owner));
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

	// A new run empties every rack and projectile pool but keeps each player's
	// standing order, just as the rig's order did before racks became per-player.
	function reset(seed) {
		randomState = Math.imul(Number.isFinite(seed) ? seed : 1, 0x9E3779B1);
		rocketState.fill(FREE);
		rocketOwner.fill(0);
		shardState.fill(FREE);
		shardOwner.fill(0);
		flashAge.fill(flashLife);
		flashCursor = 0;
		for (const profile of profiles.values()) {
			profile.stock = 0;
			profile.cooldown = 0;
			profile.visitBought = 0;
			profile.bought = 0;
			profile.fired = 0;
			profile.bursts = 0;
			profile.duds = 0;
			profile.shardHits = 0;
			profile.fracture = 0;
			profile.lastBurstX = 0;
			profile.lastBurstY = 0;
		}
	}

	function setAutoBuy(on, owner) {
		const profile = profileFor(owner);
		profile.autoBuy = Boolean(on);
		return profile.autoBuy;
	}

	// Test mode loads a full rack as a grant, like its other equipment.
	function fill(world, owner) {
		if (!hasRack(owner)) return false;
		const profile = profileFor(owner);
		if (profile.stock >= rackSize) return false;
		const count = rackSize - profile.stock;
		const label = count + ' rockets';
		const id = ownerId(owner);
		const time = world ? world.time : 0;
		if (id === 'rig') {
			if (!root.SteamCeiling || !root.SteamCeiling.grant(label, time, 'buy')) return false;
		} else {
			const players = root.SteamPlayers;
			if (!players || !players.purchase(id, label, 0, time, 'buy', true)) return false;
		}
		profile.stock = rackSize;
		return true;
	}

	function buy(world, wanted, owner) {
		const id = ownerId(owner);
		if (!hasRack(id) || !root.SteamPhysics.atSellWall(world, id)) return 0;
		const profile = profileFor(id);
		const economy = root.SteamCeiling;
		const unit = unitPrice();
		const affordable = unit > 0 ? Math.floor(fundsFor(id) / unit) : wanted;
		const count = Math.min(wanted, rackSize - profile.stock, affordable);
		if (count <= 0) return 0;
		const label = count === 1 ? '1 rocket' : count + ' rockets';
		const amount = count * price;
		const time = world.time;
		const paid = id === 'rig'
			? Boolean(economy && economy.purchase(label, amount, time))
			: Boolean(root.SteamPlayers && root.SteamPlayers.purchase(id, label, amount, time, 'buy'));
		if (!paid) return 0;
		profile.stock += count;
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
		if (!profile.autoBuy || profile.visitBought >= visitLimit || !hasRack(id)) return;
		profile.visitBought += buy(world, visitLimit - profile.visitBought, id);
	}

	function aloftBy(index) {
		if (index < 0) return 0;
		let count = 0;
		for (let i = 0; i < maxRockets; i++) if (rocketState[i] !== FREE && rocketOwner[i] === index) count++;
		return count;
	}

	function aloft() {
		let count = 0;
		for (let i = 0; i < maxRockets; i++) if (rocketState[i] !== FREE) count++;
		return count;
	}

	function shardsAloftBy(index) {
		if (index < 0) return 0;
		let count = 0;
		for (let i = 0; i < maxShards; i++) if (shardState[i] !== FREE && shardOwner[i] === index) count++;
		return count;
	}

	function shardsAloft() {
		let count = 0;
		for (let i = 0; i < maxShards; i++) if (shardState[i] !== FREE) count++;
		return count;
	}

	function freeShards() {
		return maxShards - shardsAloft();
	}

	// Every rocket in the chamber reserves a full shard fan, and no one rack can
	// have more than eight flights sharing the projectile pools at once.
	function canFire(owner) {
		const id = ownerId(owner);
		const profile = profileFor(id);
		const index = ownerIndex(id);
		if (!hasRack(id) || profile.stock <= 0 || profile.cooldown > 0 || index < 0) return false;
		const flying = aloft();
		return aloftBy(index) < maxRocketsPerRack && flying < maxRockets
			&& freeShards() >= shardCount * (flying + 1);
	}

	function launcherX(world, owner) {
		const physics = root.SteamPhysics;
		const machine = physics.machineById(world, ownerId(owner));
		const body = physics.machineBody(machine);
		const config = physics.config;
		const offset = config.platformWidth * (config.collectorFraction - 1) * 0.5;
		return Math.max(0, Math.min(config.width, body.x + offset));
	}

	function fire(world, owner) {
		const id = ownerId(owner);
		if (!world || !canFire(id)) return false;
		const index = ownerIndex(id);
		const physics = root.SteamPhysics;
		const machine = physics.machineById(world, id);
		const body = physics.machineBody(machine);
		let slot = 0;
		while (rocketState[slot] !== FREE) slot++;
		const x = launcherX(world, id);
		const y = body.y + physics.config.deck;
		const gap = Math.max(0, root.SteamCeiling.surfaceAt(x) - noseReach - y);
		rocketState[slot] = BURNING;
		rocketOwner[slot] = index;
		rocketX[slot] = x;
		rocketY[slot] = y;
		rocketVy[slot] = launchSpeed;
		rocketFuse[slot] = y + gap * (1 + fuseSpread * (2 * random() - 1));
		rocketDud[slot] = random() < dudChance ? 1 : 0;
		rocketAge[slot] = 0;
		const profile = profileFor(id);
		profile.stock--;
		profile.fired++;
		profile.cooldown = reload;
		return true;
	}

	function burst(x, y, index) {
		const profile = profileForIndex(index);
		profile.bursts++;
		profile.lastBurstX = x;
		profile.lastBurstY = y;
		flashX[flashCursor] = x;
		flashY[flashCursor] = y;
		flashAge[flashCursor] = 0;
		flashCursor = (flashCursor + 1) % maxRockets;
		const tint = Math.floor(random() * tints.length);
		let slot = 0;
		for (let n = 0; n < shardCount; n++) {
			while (slot < maxShards && shardState[slot] !== FREE) slot++;
			if (slot >= maxShards) return;
			const angle = (n + random()) / shardCount * Math.PI * 2;
			const speed = shardSpeed * (1 + shardSpeedSpread * (2 * random() - 1));
			shardState[slot] = LIVE;
			shardOwner[slot] = index;
			shardX[slot] = x;
			shardY[slot] = y;
			shardVx[slot] = Math.cos(angle) * speed;
			shardVy[slot] = Math.sin(angle) * speed;
			shardAge[slot] = 0;
			shardRadius[slot] = shardRadiusMin + random() * (shardRadiusMax - shardRadiusMin);
			shardTint[slot] = tint;
		}
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

	function stepRocket(world, i, dt) {
		rocketAge[i] += dt;
		const x = rocketX[i];
		const index = rocketOwner[i];
		const profile = profileForIndex(index);
		const face = root.SteamCeiling.surfaceAt(x) - noseReach;
		if (rocketState[i] === BURNING) {
			rocketVy[i] += thrust * dt;
			rocketY[i] += rocketVy[i] * dt;
			const stop = Math.min(face, rocketFuse[i]);
			if (rocketY[i] < stop) return;
			rocketY[i] = stop;
			if (!rocketDud[i]) {
				rocketState[i] = FREE;
				burst(x, stop, index);
				return;
			}
			rocketState[i] = FALLING;
			profile.duds++;
		}
		rocketVy[i] -= gravity * dt;
		rocketY[i] += rocketVy[i] * dt;
		if (rocketY[i] >= face && rocketVy[i] > 0) {
			rocketY[i] = face;
			rocketVy[i] = -rocketVy[i] * dudRebound;
		}
		const ground = groundAt(world, x);
		if (rocketY[i] > ground) return;
		rocketState[i] = FREE;
		burst(x, ground, index);
	}

	function stepShard(world, i, dt) {
		shardAge[i] += dt;
		if (shardAge[i] >= shardLife) {
			shardState[i] = FREE;
			return;
		}
		const width = root.SteamPhysics.config.width;
		shardVy[i] -= gravity * dt;
		shardX[i] += shardVx[i] * dt;
		shardY[i] += shardVy[i] * dt;
		if (shardX[i] < 0 || shardX[i] > width) {
			shardX[i] = shardX[i] < 0 ? 0 : width;
			shardVx[i] = -shardVx[i] * wallKeep;
		}
		if (shardVy[i] < 0 && shardY[i] <= groundAt(world, shardX[i])) {
			shardState[i] = FREE;
			return;
		}
		if (shardState[i] === SPENT) return;
		const face = root.SteamCeiling.surfaceAt(shardX[i]);
		if (shardY[i] < face) return;
		const energy = 0.5 * shardMass * (shardVx[i] * shardVx[i] + shardVy[i] * shardVy[i]);
		const index = shardOwner[i];
		const profile = profileForIndex(index);
		profile.fracture += root.SteamCeiling.chip(shardX[i], face, energy, shardRadius[i]);
		profile.shardHits++;
		shardState[i] = SPENT;
		shardY[i] = face;
		shardVx[i] *= spentKeep;
		shardVy[i] = 0;
	}

	function stepOwner(world, dt, owner) {
		const profile = profileFor(owner);
		if (profile.cooldown > 0) profile.cooldown = profile.cooldown - dt > dt * 0.5 ? profile.cooldown - dt : 0;
		visit(world, owner);
	}

	function step(world, dt) {
		const roster = root.SteamPlayers && root.SteamPlayers.state.players;
		if (roster && roster.length) {
			for (let i = 0; i < roster.length; i++) stepOwner(world, dt, roster[i].id);
		} else stepOwner(world, dt, 'rig');
		for (let i = 0; i < maxRockets; i++) if (rocketState[i] !== FREE) stepRocket(world, i, dt);
		for (let i = 0; i < maxShards; i++) if (shardState[i] !== FREE) stepShard(world, i, dt);
		for (let i = 0; i < maxRockets; i++) if (flashAge[i] < flashLife) flashAge[i] += dt;
	}

	function draw(context) {
		const rock = root.SteamCeiling;
		for (let i = 0; i < maxRockets; i++) {
			if (flashAge[i] >= flashLife) continue;
			const grow = flashAge[i] / flashLife;
			const scale = rock.perspectiveScale(flashY[i]);
			context.globalAlpha = (1 - grow) * 0.85;
			context.fillStyle = '#fff3c4';
			context.beginPath();
			context.arc(flashX[i], rock.rockDrawnY(flashY[i]), (0.25 + grow * 0.9) * scale, 0, Math.PI * 2);
			context.fill();
		}
		context.lineCap = 'round';
		for (let i = 0; i < maxShards; i++) {
			if (shardState[i] === FREE) continue;
			const y = rock.rockDrawnY(shardY[i]);
			const fade = 1 - shardAge[i] / shardLife;
			if (shardState[i] === SPENT) {
				context.globalAlpha = 0.35 + fade * 0.45;
				context.fillStyle = '#8f8a80';
				context.fillRect(shardX[i] - 0.03, y - 0.03, 0.06, 0.06);
				continue;
			}
			const trail = 0.022;
			context.globalAlpha = 0.25 + fade * 0.75;
			context.strokeStyle = tints[shardTint[i]];
			context.lineWidth = 0.05;
			context.beginPath();
			context.moveTo(shardX[i] - shardVx[i] * trail, rock.rockDrawnY(shardY[i] - shardVy[i] * trail));
			context.lineTo(shardX[i], y);
			context.stroke();
		}
		context.globalAlpha = 1;
		for (let i = 0; i < maxRockets; i++) {
			if (rocketState[i] === FREE) continue;
			const scale = rock.perspectiveScale(rocketY[i]);
			const burning = rocketState[i] === BURNING;
			context.save();
			context.translate(rocketX[i], rock.rockDrawnY(rocketY[i]));
			context.scale(scale * drawnSize, scale * drawnSize);
			if (!burning) context.rotate(rocketAge[i] * 7);
			if (burning) {
				const flicker = 0.32 + 0.14 * Math.sin(rocketAge[i] * 90);
				context.fillStyle = '#ff9a4d';
				context.beginPath();
				context.moveTo(-0.045, -0.2);
				context.lineTo(0, -0.2 - flicker);
				context.lineTo(0.045, -0.2);
				context.closePath();
				context.fill();
			}
			context.fillStyle = burning ? '#e8ece6' : '#8f8a80';
			context.fillRect(-0.04, -0.2, 0.08, 0.32);
			context.fillStyle = burning ? '#e0775e' : '#6d6a63';
			context.beginPath();
			context.moveTo(-0.04, 0.12);
			context.lineTo(0, noseReach);
			context.lineTo(0.04, 0.12);
			context.closePath();
			context.fill();
			context.restore();
		}
		context.lineCap = 'butt';
		context.globalAlpha = 1;
	}

	function stateFor(owner) { return profileFor(owner).view; }
	const state = stateFor('rig');
	const api = { state, stateFor, reset, setAutoBuy, buy, fill, canFire, fire, launcherX, step, draw };
	root.SteamRockets = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
