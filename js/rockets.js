(function (root) {
	'use strict';
	// Rockets: a consumable the rig buys at a selling wall and fires straight up
	// from its deck. A rocket bursts like a firework into shards; a shard that
	// reaches the rock chips it with the chamber's own weakening rule in a radius
	// of a few cells, then drops spent. The rock a burst loosens falls later as
	// ordinary debris through the collapse scheduler, so a rocket never creates
	// or removes material itself.
	//
	// A rocket carries its own chemical energy. Like a competitor's ball it is
	// outside the rig's reserve and energy ledger: it draws nothing from the
	// battery, heats no machinery and books only its price.
	//
	// The rack is the rig's tool, like the road grader. Everything here lives in
	// fixed pools and the step allocates nothing.
	// Depends on (at call time): js/ceiling.js, js/physics.js
	const gravity = 9.81;
	// Price per rocket in credits; calibration in archive/0.3.5-plan.md.
	const price = 14;
	// One wall visit buys at most this many, into a rack of this size. The rack
	// bound keeps an unattended auto-buy from draining every sale into a pile
	// of rockets nobody fires.
	const visitLimit = 3;
	const rackSize = 6;
	const reload = 0.5;
	// The fuse is cut for the rock face above the launcher and burns within
	// this share of that flight either way. A fuse longer than the gap never
	// fires: the nose reaches the rock first and the rocket bursts there.
	const fuseSpread = 0.2;
	// A dud's fuse fails: the motor burns out, the rocket falls back and bursts
	// on whatever ground it lands on.
	const dudChance = 0.05;
	const launchSpeed = 3;
	const thrust = 45;
	// The charge sits this far behind the nose, so a burst against the rock
	// still fans its shards over a patch instead of a single cell.
	const noseReach = 0.25;
	const dudRebound = 0.25;
	const shardCount = 24;
	const shardSpeed = 22;
	const shardSpeedSpread = 0.3;
	const shardMass = 0.025;
	// Chip radius of one shard, in rock cells.
	const shardRadiusMin = 1;
	const shardRadiusMax = 4;
	// A spark burns this long; a shard still flying after it is a dead ember.
	const shardLife = 1.6;
	const wallKeep = 0.4;
	const spentKeep = 0.25;
	const flashLife = 0.22;
	// The rocket is drawn larger than its flight model so it reads on screen.
	const drawnSize = 1.6;
	const maxRockets = 8;
	const maxShards = maxRockets * shardCount;

	const FREE = 0;
	const BURNING = 1;
	const FALLING = 2;
	const LIVE = 1;
	const SPENT = 2;

	const rocketState = new Uint8Array(maxRockets);
	const rocketX = new Float64Array(maxRockets);
	const rocketY = new Float64Array(maxRockets);
	const rocketVy = new Float64Array(maxRockets);
	const rocketFuse = new Float64Array(maxRockets);
	const rocketDud = new Uint8Array(maxRockets);
	const rocketAge = new Float64Array(maxRockets);
	const shardState = new Uint8Array(maxShards);
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
	// A firework's colours, one per burst; fixed strings so drawing never
	// builds a colour.
	const tints = ['#ffd86b', '#ff9a4d', '#ff6f61', '#f5f1e3', '#9fe3ff'];

	let stock = 0;
	let autoBuy = false;
	let cooldown = 0;
	let visitBought = 0;
	let bought = 0;
	let fired = 0;
	let bursts = 0;
	let duds = 0;
	let shardHits = 0;
	let fracture = 0;
	let lastBurstX = 0;
	let lastBurstY = 0;
	let randomState = 1;

	// The run's own stream: the same seed and the same commands give the same
	// fuses, duds and shard fans. The seed is scrambled first, because a small
	// seed fed in raw makes the opening draws small too, and the first rocket
	// of every run would be a dud.
	function random() {
		randomState = (randomState + 0x6D2B79F5) | 0;
		let value = Math.imul(randomState ^ randomState >>> 15, 1 | randomState);
		value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
		return ((value ^ value >>> 14) >>> 0) / 4294967296;
	}

	// A new run empties the rack and the air. Auto-buy is the player's standing
	// order rather than world state, so New game keeps it.
	function reset(seed) {
		randomState = Math.imul(Number.isFinite(seed) ? seed : 1, 0x9E3779B1);
		rocketState.fill(FREE);
		shardState.fill(FREE);
		flashAge.fill(flashLife);
		flashCursor = 0;
		stock = 0;
		cooldown = 0;
		visitBought = 0;
		bought = 0;
		fired = 0;
		bursts = 0;
		duds = 0;
		shardHits = 0;
		fracture = 0;
	}

	function setAutoBuy(on) {
		autoBuy = Boolean(on);
		return autoBuy;
	}

	function unitPrice() {
		return root.SteamCeiling.price(price);
	}

	// Rockets are loaded where the rig trades: buy up to `wanted` with the rig's
	// funds, never past the rack and never into debt. Returns how many came
	// aboard.
	function buy(world, wanted) {
		if (!root.SteamPhysics.atSellWall(world)) return 0;
		const economy = root.SteamCeiling;
		const unit = unitPrice();
		const affordable = unit > 0 ? Math.floor(economy.state.funds / unit) : wanted;
		const count = Math.min(wanted, rackSize - stock, affordable);
		if (count <= 0) return 0;
		if (!economy.purchase(count === 1 ? '1 rocket' : count + ' rockets', count * price, world.time)) return 0;
		stock += count;
		bought += count;
		return count;
	}

	// Test mode loads a full rack as a grant, like its other equipment.
	function fill(world) {
		if (stock >= rackSize) return false;
		root.SteamCeiling.grant(rackSize - stock + ' rockets', world.time);
		stock = rackSize;
		return true;
	}

	// A wall visit lasts while the platform touches the wall. The standing
	// order fills what the visit may still buy, so a sale that lands during the
	// visit can pay for the rest of it.
	function visit(world) {
		if (!root.SteamPhysics.atSellWall(world)) {
			visitBought = 0;
			return;
		}
		if (!autoBuy || visitBought >= visitLimit) return;
		visitBought += buy(world, visitLimit - visitBought);
	}

	function aloft() {
		let count = 0;
		for (let i = 0; i < maxRockets; i++) if (rocketState[i] !== FREE) count++;
		return count;
	}

	function freeShards() {
		let count = 0;
		for (let i = 0; i < maxShards; i++) if (shardState[i] === FREE) count++;
		return count;
	}

	// Every rocket in the air keeps a full fan of shard slots reserved, so a
	// burst is never thinned by the pool.
	function canFire() {
		if (stock <= 0 || cooldown > 0) return false;
		const flying = aloft();
		return flying < maxRockets && freeShards() >= shardCount * (flying + 1);
	}

	// The launch tube stands in the middle of the collector, so the rock a
	// rocket loosens hangs over the bin that fired it.
	function launcherX(world) {
		const config = root.SteamPhysics.config;
		const offset = config.platformWidth * (config.collectorFraction - 1) * 0.5;
		return Math.max(0, Math.min(config.width, world.platform.x + offset));
	}

	function fire(world) {
		if (!canFire()) return false;
		const physics = root.SteamPhysics;
		let slot = 0;
		while (rocketState[slot] !== FREE) slot++;
		const x = launcherX(world);
		const y = world.platform.y + physics.config.deck;
		const gap = Math.max(0, root.SteamCeiling.surfaceAt(x) - noseReach - y);
		rocketState[slot] = BURNING;
		rocketX[slot] = x;
		rocketY[slot] = y;
		rocketVy[slot] = launchSpeed;
		rocketFuse[slot] = y + gap * (1 + fuseSpread * (2 * random() - 1));
		rocketDud[slot] = random() < dudChance ? 1 : 0;
		rocketAge[slot] = 0;
		stock--;
		fired++;
		cooldown = reload;
		return true;
	}

	function burst(x, y) {
		bursts++;
		lastBurstX = x;
		lastBurstY = y;
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
			shardX[slot] = x;
			shardY[slot] = y;
			shardVx[slot] = Math.cos(angle) * speed;
			shardVy[slot] = Math.sin(angle) * speed;
			shardAge[slot] = 0;
			shardRadius[slot] = shardRadiusMin + random() * (shardRadiusMax - shardRadiusMin);
			shardTint[slot] = tint;
		}
	}

	// The ground a falling body meets at x: the rubble, or the deck of a
	// platform standing over it.
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
		const face = root.SteamCeiling.surfaceAt(x) - noseReach;
		if (rocketState[i] === BURNING) {
			rocketVy[i] += thrust * dt;
			rocketY[i] += rocketVy[i] * dt;
			const stop = Math.min(face, rocketFuse[i]);
			if (rocketY[i] < stop) return;
			rocketY[i] = stop;
			if (!rocketDud[i]) {
				rocketState[i] = FREE;
				burst(x, stop);
				return;
			}
			rocketState[i] = FALLING;
			duds++;
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
		burst(x, ground);
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
		// Only a body coming down lands: a burst on the ground starts on it.
		if (shardVy[i] < 0 && shardY[i] <= groundAt(world, shardX[i])) {
			shardState[i] = FREE;
			return;
		}
		if (shardState[i] === SPENT) return;
		const face = root.SteamCeiling.surfaceAt(shardX[i]);
		if (shardY[i] < face) return;
		const energy = 0.5 * shardMass * (shardVx[i] * shardVx[i] + shardVy[i] * shardVy[i]);
		fracture += root.SteamCeiling.chip(shardX[i], face, energy, shardRadius[i]);
		shardHits++;
		shardState[i] = SPENT;
		shardY[i] = face;
		shardVx[i] *= spentKeep;
		shardVy[i] = 0;
	}

	function step(world, dt) {
		// Counted to the nearest step, so a float remainder never holds the tube
		// shut for one step longer than the reload.
		if (cooldown > 0) cooldown = cooldown - dt > dt * 0.5 ? cooldown - dt : 0;
		visit(world);
		for (let i = 0; i < maxRockets; i++) if (rocketState[i] !== FREE) stepRocket(world, i, dt);
		for (let i = 0; i < maxShards; i++) if (shardState[i] !== FREE) stepShard(world, i, dt);
		for (let i = 0; i < maxRockets; i++) if (flashAge[i] < flashLife) flashAge[i] += dt;
	}

	// Drawn in world units inside the chamber transform, through the chamber's
	// vertical perspective like every other flying body.
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
			// A dud tumbles on its way down.
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
	}

	// Stable live view: reading it allocates nothing and commands nothing.
	const state = Object.freeze({
		price, visitLimit, rackSize, reload, fuseSpread, dudChance, noseReach,
		shardCount, shardSpeed, shardMass, shardRadiusMin, shardRadiusMax, shardLife, maxRockets, maxShards,
		FREE, BURNING, FALLING, LIVE, SPENT,
		rocketState, rocketX, rocketY, rocketVy, rocketFuse, rocketDud,
		shardState, shardX, shardY, shardVx, shardVy, shardAge, shardRadius,
		get stock() { return stock; },
		get autoBuy() { return autoBuy; },
		get unitPrice() { return unitPrice(); },
		get cooldown() { return cooldown; },
		get bought() { return bought; },
		get fired() { return fired; },
		get bursts() { return bursts; },
		get duds() { return duds; },
		get shardHits() { return shardHits; },
		get fracture() { return fracture; },
		get lastBurstX() { return lastBurstX; },
		get lastBurstY() { return lastBurstY; },
		get aloft() { return aloft(); },
		get shardsAloft() { return maxShards - freeShards(); }
	});

	const api = { state, reset, setAutoBuy, buy, fill, canFire, fire, launcherX, step, draw };
	root.SteamRockets = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
