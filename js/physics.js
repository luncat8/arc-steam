(function (root) {
	'use strict';
	const config = Object.freeze({
		width: 24, ceiling: 10, gravity: 9.81, radius: 0.18, mass: 1,
		platformWidth: 3.6, deck: 0.7, collectorFraction: 0.35,
		platformMass: 60, force: 180, maxSpeed: 7,
		retention: 0.9, pulse: 36, efficiency: 0.8, battery: 12000, step: 1 / 240
	});

	function createWorld() {
		if (root.SteamCeiling) root.SteamCeiling.reset(1);
		const world = {
			time: 0, battery: config.battery, heat: 0, fractureEnergy: 0, initialEnergy: 0,
			drive: false, forceSetting: 0.6, direction: 0, target: NaN,
			platform: { x: 12, vx: 0 },
			ball: { x: 12.8, y: 5, vx: 1.2, vy: 0, state: 'flying' },
			bounces: 0, pushes: 0, lastPush: 0, groundings: 0, sales: 0, lastSale: 0
		};
		world.initialEnergy = totalEnergy(world);
		return world;
	}

	function ballEnergy(ball) {
		if (ball.state === 'held') return 0;
		return config.mass * (0.5 * (ball.vx * ball.vx + ball.vy * ball.vy) + config.gravity * (ball.y - config.radius));
	}

	function cargoMass() {
		return root.SteamCeiling ? root.SteamCeiling.cargoMass() : 0;
	}

	function platformMass(world) {
		return config.platformMass + cargoMass() + (world.ball.state === 'held' ? config.mass : 0);
	}

	function totalEnergy(world) {
		const ceilingEnergy = root.SteamCeiling ? root.SteamCeiling.energy() : 0;
		return world.battery + world.heat + world.fractureEnergy + ceilingEnergy + ballEnergy(world.ball) + 0.5 * platformMass(world) * world.platform.vx * world.platform.vx;
	}

	function spend(world, useful) {
		const delivered = Math.min(useful, world.battery * config.efficiency);
		const cost = delivered / config.efficiency;
		world.battery -= cost;
		world.heat += cost - delivered;
		return delivered;
	}

	function capture(world) {
		const ball = world.ball;
		const platform = world.platform;
		const carriedMass = config.platformMass + cargoMass();
		const before = ballEnergy(ball) + 0.5 * carriedMass * platform.vx * platform.vx;
		platform.vx = (carriedMass * platform.vx + config.mass * ball.vx) / (carriedMass + config.mass);
		ball.state = 'held';
		ball.vx = 0;
		ball.vy = 0;
		ball.y = config.radius;
		world.heat += before - 0.5 * platformMass(world) * platform.vx * platform.vx;
	}

	function launch(world) {
		const ball = world.ball;
		if (ball.state !== 'held' || !world.drive) return false;
		const lift = config.mass * config.gravity * config.deck;
		if (world.battery * config.efficiency <= lift) return false;
		const energy = spend(world, config.pulse);
		ball.x = world.platform.x + config.platformWidth * 0.25;
		ball.y = config.deck + config.radius;
		ball.vx = world.platform.vx;
		ball.vy = Math.sqrt(2 * (energy - lift) / config.mass);
		ball.state = 'flying';
		world.lastPush = energy;
		world.pushes++;
		return true;
	}

	function movePlatform(world, dt) {
		const platform = world.platform;
		const mass = platformMass(world);
		let direction = world.direction;
		if (!direction && Number.isFinite(world.target)) {
			const distance = world.target - platform.x;
			const acceleration = config.force * world.forceSetting / mass;
			const stopping = platform.vx * platform.vx / (2 * acceleration);
			direction = Math.sign(distance);
			if (platform.vx * distance > 0 && Math.abs(distance) < stopping + 0.04) direction = -Math.sign(platform.vx);
			if (Math.abs(distance) < 0.04 && Math.abs(platform.vx) < acceleration * dt * 2) {
				world.heat += 0.5 * mass * platform.vx * platform.vx;
				platform.vx = 0;
				direction = 0;
			}
		}
		const oldVelocity = platform.vx;
		let velocity = oldVelocity + direction * config.force * world.forceSetting / mass * dt;
		velocity = Math.max(-config.maxSpeed, Math.min(config.maxSpeed, velocity));
		const before = 0.5 * mass * oldVelocity * oldVelocity;
		const after = 0.5 * mass * velocity * velocity;
		if (after > before) {
			const available = spend(world, after - before);
			velocity = Math.sign(velocity) * Math.sqrt(2 * (before + available) / mass);
		} else {
			world.heat += before - after;
		}
		platform.vx = velocity;
		platform.x += (oldVelocity + velocity) * 0.5 * dt;
		const half = config.platformWidth * 0.5;
		if (platform.x >= half && platform.x <= config.width - half) return;
		platform.x = Math.max(half, Math.min(config.width - half, platform.x));
		world.heat += 0.5 * mass * velocity * velocity;
		platform.vx = 0;
		if (root.SteamCeiling) {
			world.lastSale = root.SteamCeiling.sellCargo(platform.vx);
			if (world.lastSale > 0) world.sales++;
		}
	}

	function downwardTime(ball, height) {
		const discriminant = ball.vy * ball.vy + 2 * config.gravity * (ball.y - height);
		if (discriminant < 0) return Infinity;
		const time = (ball.vy + Math.sqrt(discriminant)) / config.gravity;
		return time >= -1e-10 ? Math.max(0, time) : Infinity;
	}

	function passiveImpact(world, nx, ny, fracture) {
		const ball = world.ball;
		const normalVelocity = ball.vx * nx + ball.vy * ny;
		const lost = 0.5 * config.mass * normalVelocity * normalVelocity * (1 - config.retention);
		const spentOnRock = Math.min(lost, fracture || 0);
		const impulseVelocity = (1 + Math.sqrt(config.retention)) * normalVelocity;
		world.fractureEnergy += spentOnRock;
		world.heat += lost - spentOnRock;
		ball.vx -= impulseVelocity * nx;
		ball.vy -= impulseVelocity * ny;
	}

	function advanceBall(world, dt, oldPlatformX) {
		const ball = world.ball;
		if (ball.state === 'held') {
			ball.x = world.platform.x - config.platformWidth * 0.32;
			return;
		}
		if (ball.state === 'grounded') {
			if (Math.abs(ball.x - world.platform.x) <= config.platformWidth * 0.5) capture(world);
			return;
		}
		let remaining = dt;
		let elapsed = 0;
		for (let event = 0; event < 12 && remaining > 1e-10; event++) {
			let time = remaining;
			let type = 0;
			let rockNx = 0;
			let rockNy = 0;
			const wall = ball.vx > 0 ? config.width - config.radius : config.radius;
			const wallTime = ball.vx ? (wall - ball.x) / ball.vx : Infinity;
			if (wallTime >= 0 && wallTime <= time) { time = wallTime; type = 1; }
			const groundTime = downwardTime(ball, config.radius);
			if (groundTime <= time) { time = groundTime; type = 2; }
			const topDiscriminant = ball.vy * ball.vy - 2 * config.gravity * (config.ceiling - config.radius - ball.y);
			const topTime = ball.vy > 0 && topDiscriminant >= 0 ? (ball.vy - Math.sqrt(topDiscriminant)) / config.gravity : Infinity;
			if (topTime >= 0 && topTime <= time) { time = topTime; type = 3; }
			if (root.SteamCeiling) {
				const rockHit = root.SteamCeiling.trace(ball.x, ball.y, ball.vx, ball.vy, remaining, config.radius);
				if (rockHit.time <= time) {
					time = rockHit.time;
					type = 5;
					rockNx = rockHit.nx;
					rockNy = rockHit.ny;
				}
			}
			const deckTime = ball.y >= config.deck + config.radius - 1e-10 ? downwardTime(ball, config.deck + config.radius) : Infinity;
			const platformX = oldPlatformX + (world.platform.x - oldPlatformX) * (elapsed + deckTime) / dt;
			const impactX = ball.x + ball.vx * deckTime;
			if (deckTime <= time && Math.abs(impactX - platformX) <= config.platformWidth * 0.5) { time = deckTime; type = 4; }
			ball.x += ball.vx * time;
			ball.y += ball.vy * time - 0.5 * config.gravity * time * time;
			ball.vy -= config.gravity * time;
			remaining -= time;
			elapsed += time;
			if (!type) return;
			if (type === 1) { ball.vx = -ball.vx; continue; }
			if (type === 2) {
				world.heat += ballEnergy(ball);
				ball.y = config.radius;
				ball.vx = 0;
				ball.vy = 0;
				ball.state = 'grounded';
				world.groundings++;
				return;
			}
			if (type === 3) {
				passiveImpact(world, 0, -1, 0);
				continue;
			}
			if (type === 5) {
				const normalVelocity = ball.vx * rockNx + ball.vy * rockNy;
				const damageBudget = 0.5 * config.mass * normalVelocity * normalVelocity * (1 - config.retention);
				const contactX = ball.x - rockNx * config.radius;
				const contactY = ball.y - rockNy * config.radius;
				const fracture = root.SteamCeiling.damage(contactX, contactY, damageBudget);
				passiveImpact(world, rockNx, rockNy, fracture);
				continue;
			}
			const collectorEdge = platformX - config.platformWidth * 0.5 + config.platformWidth * config.collectorFraction;
			if (ball.x < collectorEdge) { capture(world); return; }
			const carriedMass = platformMass(world);
			const relativeVx = ball.vx - (world.platform.x - oldPlatformX) / dt;
			const normalImpulse = config.mass * Math.abs(ball.vy) * (1 + Math.sqrt(config.retention));
			const frictionImpulse = Math.max(-normalImpulse * 0.35, Math.min(normalImpulse * 0.35, -relativeVx / (1 / config.mass + 1 / carriedMass)));
			const beforeTangential = 0.5 * config.mass * ball.vx * ball.vx + 0.5 * carriedMass * world.platform.vx * world.platform.vx;
			ball.vx += frictionImpulse / config.mass;
			world.platform.vx -= frictionImpulse / carriedMass;
			const afterTangential = 0.5 * config.mass * ball.vx * ball.vx + 0.5 * carriedMass * world.platform.vx * world.platform.vx;
			world.heat += Math.max(0, beforeTangential - afterTangential);
			passiveImpact(world, 0, 1, 0);
			world.bounces++;
			world.lastPush = 0;
			if (world.drive) {
				world.lastPush = spend(world, config.pulse);
				ball.vy = Math.sqrt(ball.vy * ball.vy + 2 * world.lastPush / config.mass);
				world.pushes++;
			}
			if (ball.vy < 0.08) { capture(world); return; }
		}
	}

	function step(world, dt) {
		const oldX = world.platform.x;
		movePlatform(world, dt);
		advanceBall(world, dt, oldX);
		if (root.SteamCeiling) {
			const heldMass = world.ball.state === 'held' ? config.mass : 0;
			root.SteamCeiling.step(world, dt, config.platformMass + heldMass);
			const half = config.platformWidth * 0.5;
			if (world.platform.x <= half + 1e-9 || world.platform.x >= config.width - half - 1e-9) {
				const sale = root.SteamCeiling.sellCargo(world.platform.vx);
				if (sale > 0) { world.lastSale = sale; world.sales++; }
			}
		}
		world.time += dt;
	}

	const api = { config, createWorld, step, launch, ballEnergy, totalEnergy };
	root.SteamPhysics = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
