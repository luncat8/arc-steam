(function (root) {
	'use strict';
	const config = Object.freeze({
		width: 24, ceiling: 10, gravity: 9.81, radius: 0.18, mass: 1,
		platformWidth: 3.6, deck: 0.7, collectorFraction: 0.35,
		platformMass: 60, force: 180, maxSpeed: 7,
		retention: 0.9, pulse: 36, efficiency: 0.8, battery: 12000, step: 1 / 240
	});

	function createWorld() {
		const world = {
			time: 0, battery: config.battery, heat: 0, initialEnergy: 0,
			drive: false, forceSetting: 0.6, direction: 0, target: NaN,
			platform: { x: 12, vx: 0 },
			ball: { x: 12.8, y: 5, vx: 1.2, vy: 0, state: 'flying' },
			bounces: 0, pushes: 0, lastPush: 0, groundings: 0
		};
		world.initialEnergy = totalEnergy(world);
		return world;
	}

	function ballEnergy(ball) {
		if (ball.state === 'held') return 0;
		return config.mass * (0.5 * (ball.vx * ball.vx + ball.vy * ball.vy) + config.gravity * (ball.y - config.radius));
	}

	function totalEnergy(world) {
		return world.battery + world.heat + ballEnergy(world.ball) + 0.5 * config.platformMass * world.platform.vx * world.platform.vx;
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
		world.heat += ballEnergy(ball);
		ball.state = 'held';
		ball.vx = 0;
		ball.vy = 0;
		ball.y = config.radius;
	}

	function launch(world) {
		const ball = world.ball;
		if (ball.state !== 'held' || !world.drive) return false;
		const lift = config.mass * config.gravity * config.deck;
		if (world.battery * config.efficiency <= lift) return false;
		const energy = spend(world, config.pulse);
		ball.x = world.platform.x + config.platformWidth * 0.25;
		ball.y = config.deck + config.radius;
		ball.vx = 0;
		ball.vy = Math.sqrt(2 * (energy - lift) / config.mass);
		ball.state = 'flying';
		world.lastPush = energy;
		world.pushes++;
		return true;
	}

	function movePlatform(world, dt) {
		const platform = world.platform;
		let direction = world.direction;
		if (!direction && Number.isFinite(world.target)) {
			const distance = world.target - platform.x;
			const acceleration = config.force * world.forceSetting / config.platformMass;
			const stopping = platform.vx * platform.vx / (2 * acceleration);
			direction = Math.sign(distance);
			if (platform.vx * distance > 0 && Math.abs(distance) < stopping + 0.04) direction = -Math.sign(platform.vx);
			if (Math.abs(distance) < 0.04 && Math.abs(platform.vx) < acceleration * dt * 2) {
				world.heat += 0.5 * config.platformMass * platform.vx * platform.vx;
				platform.vx = 0;
				direction = 0;
			}
		}
		const oldVelocity = platform.vx;
		let velocity = oldVelocity + direction * config.force * world.forceSetting / config.platformMass * dt;
		velocity = Math.max(-config.maxSpeed, Math.min(config.maxSpeed, velocity));
		const before = 0.5 * config.platformMass * oldVelocity * oldVelocity;
		const after = 0.5 * config.platformMass * velocity * velocity;
		if (after > before) {
			const available = spend(world, after - before);
			velocity = Math.sign(velocity) * Math.sqrt(2 * (before + available) / config.platformMass);
		} else {
			world.heat += before - after;
		}
		platform.vx = velocity;
		platform.x += (oldVelocity + velocity) * 0.5 * dt;
		const half = config.platformWidth * 0.5;
		if (platform.x >= half && platform.x <= config.width - half) return;
		platform.x = Math.max(half, Math.min(config.width - half, platform.x));
		world.heat += 0.5 * config.platformMass * velocity * velocity;
		platform.vx = 0;
	}

	function downwardTime(ball, height) {
		const discriminant = ball.vy * ball.vy + 2 * config.gravity * (ball.y - height);
		if (discriminant < 0) return Infinity;
		const time = (ball.vy + Math.sqrt(discriminant)) / config.gravity;
		return time >= -1e-10 ? Math.max(0, time) : Infinity;
	}

	function passiveVertical(world) {
		const ball = world.ball;
		const energy = 0.5 * config.mass * ball.vy * ball.vy;
		world.heat += energy * (1 - config.retention);
		ball.vy = -ball.vy * Math.sqrt(config.retention);
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
			const wall = ball.vx > 0 ? config.width - config.radius : config.radius;
			const wallTime = ball.vx ? (wall - ball.x) / ball.vx : Infinity;
			if (wallTime >= 0 && wallTime <= time) { time = wallTime; type = 1; }
			const groundTime = downwardTime(ball, config.radius);
			if (groundTime <= time) { time = groundTime; type = 2; }
			const topDiscriminant = ball.vy * ball.vy - 2 * config.gravity * (config.ceiling - config.radius - ball.y);
			const topTime = ball.vy > 0 && topDiscriminant >= 0 ? (ball.vy - Math.sqrt(topDiscriminant)) / config.gravity : Infinity;
			if (topTime >= 0 && topTime <= time) { time = topTime; type = 3; }
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
			if (type === 3) { passiveVertical(world); continue; }
			const collectorEdge = platformX - config.platformWidth * 0.5 + config.platformWidth * config.collectorFraction;
			if (ball.x < collectorEdge) { capture(world); return; }
			passiveVertical(world);
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
		world.time += dt;
	}

	const api = { config, createWorld, step, launch, ballEnergy, totalEnergy };
	root.SteamPhysics = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
