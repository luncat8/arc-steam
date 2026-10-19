(function (root) {
	'use strict';
	const gravity = 9.81;
	const ballSpeedScale = 1 / 1.5;
	const reserveCapacity = 12000;
	const chargeSeconds = 4;
	const config = Object.freeze({
		width: 24, ceiling: 10, gravity, ballGravity: gravity * ballSpeedScale * ballSpeedScale,
		ballMass: 1 / (ballSpeedScale * ballSpeedScale), ballSpeedScale, radius: 0.18,
		platformWidth: 3.6, deck: 0.7, collectorFraction: 0.35,
		// Drive response: two 1.5x increases over the original 180 N / 7 m/s
		// tuning, each rounded down to a whole number.
		platformMass: 60, force: 400, maxSpeed: 10,
		retention: 0.9, pulse: 36, efficiency: 0.8, battery: reserveCapacity, step: 1 / 240,
		// Centre ground charge pad: a refuelling surface, not a consumable. It
		// fills the reserve in four seconds while the platform stands on it, so
		// the cost of energy is position and downtime rather than credits.
		chargePadWidth: 4, chargeSeconds, chargePower: reserveCapacity / chargeSeconds, chargeMaxSpeed: 0.1,
		recoveryEfficiency: 0.9,
		ambientTemperature: 20, heatCapacity: 300,
		convectiveConductance: 1.1, radiatorConvectionCoefficient: 8,
		radiatingArea: 0.08, emissivity: 0.85,
		thermalDerateStart: 85, thermalCutoff: 135,
		// Left-wall pocket lets the asymmetric collector slide into the wall so
		// the reflector can cover the wall all the way to x = 0.
		pocketDepth: 3.6 * 0.35
	});

	function platformMin() { return config.platformWidth * 0.5 - config.pocketDepth; }
	function platformMax() { return config.width - config.platformWidth * 0.5; }

	// The charge pad is a strip of ground at the chamber centre. Standing still
	// on it hands the installed engine its fuel; a moving platform cannot
	// collect, so recharging is a deliberate stop rather than free cruising.
	function chargePadMin() { return config.width * 0.5 - config.chargePadWidth * 0.5; }
	function chargePadMax() { return config.width * 0.5 + config.chargePadWidth * 0.5; }
	function onChargePad(world) {
		const x = world.platform.x;
		return x >= chargePadMin() && x <= chargePadMax();
	}
	function charging(world) {
		return onChargePad(world) && Math.abs(world.platform.vx) < config.chargeMaxSpeed && world.battery < config.battery;
	}
	function charge(world, dt) {
		if (!charging(world)) return;
		const added = Math.min(config.battery - world.battery, config.chargePower * dt);
		world.battery += added;
		world.importedEnergy += added;
		world.chargedEnergy += added;
	}

	// Installed equipment and completed research contribute explicit deltas on
	// top of base tuning through the same named channels.
	function installed(channel) {
		const machinery = root.SteamEquipment;
		const technology = root.SteamResearch;
		return (machinery ? machinery.state[channel] || 0 : 0) + (technology ? technology.state[channel] || 0 : 0);
	}
	function retentionNow() { return config.retention + installed('retentionBonus'); }
	function pulseNow() { return config.pulse + installed('pulseBonus'); }
	function dryMass() { return config.platformMass + installed('massDelta'); }
	function recoveryNow() { return installed('recoveryFraction'); }
	function radiatorArea() { return installed('radiatorArea'); }
	function conductanceNow() {
		return config.convectiveConductance + installed('coolingBonus') + config.radiatorConvectionCoefficient * radiatorArea();
	}

	// Added or removed machinery couples to the moving platform: momentum is
	// conserved for added mass and the kinetic-energy difference becomes heat, so
	// purchases and research never break the energy ledger.
	function applyMassChange(world, delta, oldMass) {
		if (!world || !delta) return;
		const velocity = world.platform.vx;
		if (delta < 0) {
			world.heat += 0.5 * -delta * velocity * velocity;
			return;
		}
		const nextMass = oldMass + delta;
		const before = 0.5 * oldMass * velocity * velocity;
		world.platform.vx = oldMass * velocity / nextMass;
		world.heat += before - 0.5 * nextMass * world.platform.vx * world.platform.vx;
	}

	// Braking energy first charges an installed flywheel; only the round-trip loss
	// and the unrecovered remainder stay in the machinery as heat.
	function dissipate(world, energy) {
		if (energy <= 0) return;
		const recovery = recoveryNow();
		const returned = energy * recovery * config.recoveryEfficiency;
		world.battery += returned;
		world.heat += energy - returned;
	}

	function createWorld() {
		if (root.SteamCeiling) root.SteamCeiling.reset(1);
		if (root.SteamEquipment) root.SteamEquipment.reset();
		if (root.SteamResearch) root.SteamResearch.reset();
		const world = {
			time: 0, battery: config.battery, heat: 0, cooledEnergy: 0, fractureEnergy: 0, importedEnergy: 0, chargedEnergy: 0,
			initialEnergy: 0,
			drive: false, forceSetting: 0.6, direction: 0, target: NaN,
			platform: { x: 12, vx: 0 },
			ball: { x: 12.8, y: 5, vx: 1.2 * config.ballSpeedScale, vy: 0, state: 'flying' },
			bounces: 0, pushes: 0, lastPush: 0, groundings: 0, sales: 0, lastSale: 0
		};
		world.initialEnergy = totalEnergy(world);
		return world;
	}

	function ballEnergy(ball) {
		if (ball.state === 'held') return 0;
		return config.ballMass * (0.5 * (ball.vx * ball.vx + ball.vy * ball.vy) + config.ballGravity * (ball.y - config.radius));
	}

	function cargoMass() {
		return root.SteamCeiling ? root.SteamCeiling.state.cargoMass : 0;
	}

	function platformMass(world) {
		return dryMass() + cargoMass() + (world.ball.state === 'held' ? config.ballMass : 0);
	}

	// Imported (bought) energy is subtracted and exported (sold, cooled) energy is
	// added, so the balance stays exact across both directions of trade.
	function totalEnergy(world) {
		const ceilingEnergy = root.SteamCeiling ? root.SteamCeiling.state.energy : 0;
		return world.battery + world.heat + world.cooledEnergy + world.fractureEnergy - world.importedEnergy + ceilingEnergy + ballEnergy(world.ball) + 0.5 * platformMass(world) * world.platform.vx * world.platform.vx;
	}

	function temperature(world) {
		return config.ambientTemperature + world.heat / config.heatCapacity;
	}

	function thermalFactor(world) {
		const range = config.thermalCutoff - config.thermalDerateStart;
		return Math.max(0, Math.min(1, (config.thermalCutoff - temperature(world)) / range));
	}

	function coolingPower(world) {
		const temperatureC = temperature(world);
		const delta = temperatureC - config.ambientTemperature;
		if (delta <= 0 || world.heat <= 0) return 0;
		const fins = radiatorArea();
		const area = config.radiatingArea + fins;
		const surfaceKelvin = temperatureC + 273.15;
		const ambientKelvin = config.ambientTemperature + 273.15;
		const surfaceSquared = surfaceKelvin * surfaceKelvin;
		const ambientSquared = ambientKelvin * ambientKelvin;
		const convection = conductanceNow() * delta;
		const radiation = config.emissivity * 5.670374419e-8 * area * (surfaceSquared * surfaceSquared - ambientSquared * ambientSquared);
		return convection + radiation;
	}

	function cool(world, dt) {
		if (world.heat <= 0) return;
		const removed = Math.min(world.heat, coolingPower(world) * dt);
		world.heat -= removed;
		world.cooledEnergy += removed;
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
		const carriedMass = dryMass() + cargoMass();
		const before = ballEnergy(ball) + 0.5 * carriedMass * platform.vx * platform.vx;
		platform.vx = (carriedMass * platform.vx + config.ballMass * ball.vx) / (carriedMass + config.ballMass);
		ball.state = 'held';
		ball.vx = 0;
		ball.vy = 0;
		ball.y = config.radius;
		world.heat += before - 0.5 * platformMass(world) * platform.vx * platform.vx;
	}

	function launchCapacity(world) {
		return Math.min(pulseNow() * thermalFactor(world), world.battery * config.efficiency);
	}

	function canLaunch(world) {
		if (world.ball.state !== 'held' || !world.drive) return false;
		return launchCapacity(world) > config.ballMass * config.ballGravity * config.deck;
	}

	function launch(world) {
		if (!canLaunch(world)) return false;
		const ball = world.ball;
		const energy = spend(world, pulseNow() * thermalFactor(world));
		ball.x = world.platform.x + config.platformWidth * 0.25;
		ball.y = config.deck + config.radius;
		ball.vx = world.platform.vx;
		ball.vy = Math.sqrt(2 * (energy - config.ballMass * config.ballGravity * config.deck) / config.ballMass);
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
		const acceleration = config.force * world.forceSetting / mass;
		let velocity = oldVelocity;
		let remaining = dt;
		if (direction && oldVelocity * direction < 0) {
			const brakingTime = Math.min(remaining, Math.abs(oldVelocity) / acceleration);
			velocity += direction * acceleration * brakingTime;
			remaining -= brakingTime;
		}
		if (remaining > 0) velocity += direction * acceleration * thermalFactor(world) * remaining;
		velocity = Math.max(-config.maxSpeed, Math.min(config.maxSpeed, velocity));
		const before = 0.5 * mass * oldVelocity * oldVelocity;
		const after = 0.5 * mass * velocity * velocity;
		if (after > before) {
			const available = spend(world, after - before);
			velocity = Math.sign(velocity) * Math.sqrt(2 * (before + available) / mass);
		} else {
			dissipate(world, before - after);
		}
		platform.vx = velocity;
		platform.x += (oldVelocity + velocity) * 0.5 * dt;
		const minX = platformMin();
		const maxX = platformMax();
		if (platform.x >= minX && platform.x <= maxX) return;
		// A wall stop is a crash, not braking: all of it becomes heat. The sale
		// itself is handled once per step by step(), which also covers fragments
		// caught during the same step.
		platform.x = Math.max(minX, Math.min(maxX, platform.x));
		world.heat += 0.5 * mass * velocity * velocity;
		platform.vx = 0;
	}

	function downwardTime(ball, height) {
		const discriminant = ball.vy * ball.vy + 2 * config.ballGravity * (ball.y - height);
		if (discriminant < 0) return Infinity;
		const time = (ball.vy + Math.sqrt(discriminant)) / config.ballGravity;
		return time >= -1e-10 ? Math.max(0, time) : Infinity;
	}

	function passiveImpact(world, nx, ny, fracture) {
		const ball = world.ball;
		const normalVelocity = ball.vx * nx + ball.vy * ny;
		if (normalVelocity >= 0) return;
		const retention = retentionNow();
		const lost = 0.5 * config.ballMass * normalVelocity * normalVelocity * (1 - retention);
		const spentOnRock = Math.min(lost, fracture || 0);
		const impulseVelocity = (1 + Math.sqrt(retention)) * normalVelocity;
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
		let rockImpulse = false;
		for (let event = 0; event < 12 && remaining > 1e-10; event++) {
			let time = remaining;
			let type = 0;
			let rockNx = 0;
			let rockNy = 0;
			let rockX = 0;
			let rockY = 0;
			const wall = ball.vx > 0 ? config.width - config.radius : config.radius;
			const wallTime = ball.vx ? (wall - ball.x) / ball.vx : Infinity;
			if (wallTime >= 0 && wallTime <= time) { time = wallTime; type = 1; }
			const groundTime = downwardTime(ball, config.radius);
			if (groundTime <= time) { time = groundTime; type = 2; }
			const topDiscriminant = ball.vy * ball.vy - 2 * config.ballGravity * (config.ceiling - config.radius - ball.y);
			const topTime = ball.vy > 0 && topDiscriminant >= 0 ? (ball.vy - Math.sqrt(topDiscriminant)) / config.ballGravity : Infinity;
			if (topTime >= 0 && topTime <= time) { time = topTime; type = 3; }
			if (root.SteamCeiling) {
				const rockHit = root.SteamCeiling.trace(ball.x, ball.y, ball.vx, ball.vy, remaining, config.radius, config.ballGravity);
				if (rockHit.time <= time) {
					time = rockHit.time;
					type = 5;
					rockNx = rockHit.nx;
					rockNy = rockHit.ny;
					rockX = rockHit.x;
					rockY = rockHit.y;
				}
			}
			const deckTime = ball.y >= config.deck + config.radius - 1e-10 ? downwardTime(ball, config.deck + config.radius) : Infinity;
			const platformX = oldPlatformX + (world.platform.x - oldPlatformX) * (elapsed + deckTime) / dt;
			const impactX = ball.x + ball.vx * deckTime;
			if (deckTime <= time && Math.abs(impactX - platformX) <= config.platformWidth * 0.5) { time = deckTime; type = 4; }
			ball.x += ball.vx * time;
			ball.y += ball.vy * time - 0.5 * config.ballGravity * time * time;
			ball.vy -= config.ballGravity * time;
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
				// Contact position is exact (separated to radius), so the ball
				// cannot sit inside the surface between events. The snap's
				// potential change is booked so the energy ledger stays exact.
				world.heat += config.ballMass * config.ballGravity * (ball.y - rockY);
				ball.x = rockX;
				ball.y = rockY;
				const normalVelocity = ball.vx * rockNx + ball.vy * rockNy;
				// One impulse per step: later zero-time contacts only separate,
				// keeping the ball's contact impulse instead of stacking flips.
				if (normalVelocity < 0 && !rockImpulse) {
					const damageBudget = 0.5 * config.ballMass * normalVelocity * normalVelocity * (1 - config.retention);
					const contactX = ball.x - rockNx * config.radius;
					const contactY = ball.y - rockNy * config.radius;
					const fracture = root.SteamCeiling.damage(contactX, contactY, damageBudget);
					passiveImpact(world, rockNx, rockNy, fracture);
					rockImpulse = true;
				}
				continue;
			}
			const collectorEdge = platformX - config.platformWidth * 0.5 + config.platformWidth * config.collectorFraction;
			if (ball.x < collectorEdge) { capture(world); return; }
			const carriedMass = platformMass(world);
			const relativeVx = ball.vx - (world.platform.x - oldPlatformX) / dt;
			const normalImpulse = config.ballMass * Math.abs(ball.vy) * (1 + Math.sqrt(retentionNow()));
			const frictionImpulse = Math.max(-normalImpulse * 0.35, Math.min(normalImpulse * 0.35, -relativeVx / (1 / config.ballMass + 1 / carriedMass)));
			const beforeTangential = 0.5 * config.ballMass * ball.vx * ball.vx + 0.5 * carriedMass * world.platform.vx * world.platform.vx;
			ball.vx += frictionImpulse / config.ballMass;
			world.platform.vx -= frictionImpulse / carriedMass;
			const afterTangential = 0.5 * config.ballMass * ball.vx * ball.vx + 0.5 * carriedMass * world.platform.vx * world.platform.vx;
			world.heat += Math.max(0, beforeTangential - afterTangential);
			passiveImpact(world, 0, 1, 0);
			world.bounces++;
			world.lastPush = 0;
			if (world.drive) {
				world.lastPush = spend(world, pulseNow() * thermalFactor(world));
				if (world.lastPush > 0) {
					ball.vy = Math.sqrt(ball.vy * ball.vy + 2 * world.lastPush / config.ballMass);
					world.pushes++;
				}
			}
			if (ball.vy < 0.08) { capture(world); return; }
		}
	}

	function step(world, dt) {
		const oldX = world.platform.x;
		movePlatform(world, dt);
		advanceBall(world, dt, oldX);
		charge(world, dt);
		if (root.SteamCeiling) {
			const heldMass = world.ball.state === 'held' ? config.ballMass : 0;
			root.SteamCeiling.step(world, dt, dryMass() + heldMass);
			const minX = platformMin();
			const maxX = platformMax();
			if (world.platform.x <= minX + 1e-9 || world.platform.x >= maxX - 1e-9) {
				const sale = root.SteamCeiling.sellCargo(world.platform.vx, world.time);
				if (sale > 0) { world.lastSale = sale; world.sales++; }
			}
		}
		cool(world, dt);
		world.time += dt;
	}

	const api = {
		config, createWorld, step, launch, canLaunch, ballEnergy, totalEnergy, temperature,
		thermalFactor, coolingPower, platformMass, platformMin, platformMax, dryMass,
		chargePadMin, chargePadMax, onChargePad, charging,
		retentionNow, pulseNow, recoveryNow, conductanceNow, radiatorArea, applyMassChange
	};
	root.SteamPhysics = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
