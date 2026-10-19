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
		// The reflector is a sprung piston: its face tilts to steer reflections
		// (centre and half-width follow from the collector/reflector split) and
		// compresses along its normal in proportion to the impact speed.
		pistonCentre: 0.63, pistonHalf: 1.17, pistonMaxAngle: Math.PI / 18,
		pistonTravel: 0.16, pistonCompression: 0.024, pistonSpring: 650, pistonDamping: 18,
		// Actuator rate of the tilt, in rad/s (45°/s): the automatic keeper slews
		// towards the angle it wants instead of snapping to it. Direct manual tilt
		// stays immediate, because the player is the one aiming.
		pistonSlewRate: Math.PI / 4,
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

	function setPistonAngle(world, angle) {
		world.pistonAngle = Math.max(-config.pistonMaxAngle, Math.min(config.pistonMaxAngle, angle));
		return world.pistonAngle;
	}

	// Sprung return from a compression: stiff enough to extend again (the push)
	// within a few frames, damped enough not to rattle. Offset is along the
	// piston normal, positive when compressed into the platform.
	function advancePiston(world, dt) {
		if (!world.pistonOffset && !world.pistonVelocity) return;
		const acceleration = -config.pistonSpring * world.pistonOffset - config.pistonDamping * world.pistonVelocity;
		world.pistonVelocity += acceleration * dt;
		world.pistonOffset += world.pistonVelocity * dt;
		if (Math.abs(world.pistonOffset) < 1e-6 && Math.abs(world.pistonVelocity) < 1e-4) {
			world.pistonOffset = 0;
			world.pistonVelocity = 0;
		}
	}

	// Earliest time the ball centre reaches one radius from the tilted piston
	// face, or Infinity. The centre travels with the platform, so its velocity
	// is part of the approach; a contact only counts on the face segment.
	function pistonContactTime(x, y, vx, vy, centreX, centreVx, angle, limit) {
		const nx = -Math.sin(angle);
		const ny = Math.cos(angle);
		const signed = nx * (x - centreX) + ny * (y - config.deck) - config.radius;
		if (signed < -1e-9) return Infinity;
		const a = -0.5 * config.ballGravity * ny;
		const b = nx * (vx - centreVx) + ny * vy;
		const discriminant = b * b - 4 * a * signed;
		if (discriminant < 0) return Infinity;
		const root = Math.sqrt(discriminant);
		let time = (-b - root) / (2 * a);
		if (!(time >= -1e-10) || time > limit || b + 2 * a * time >= 0) time = (-b + root) / (2 * a);
		if (!(time >= -1e-10) || time > limit || b + 2 * a * time >= 0) return Infinity;
		time = Math.max(0, time);
		const contactX = x + vx * time;
		const contactY = y + vy * time - 0.5 * config.ballGravity * time * time;
		const foot = (contactX - (centreX + centreVx * time)) * ny + (contactY - config.deck) * -nx;
		return Math.abs(foot) <= config.pistonHalf + 1e-9 ? time : Infinity;
	}

	// Preallocated solver result. A contact is resolved once per bounce and the
	// automatic tilt keeper trials dozens of angles per step, so neither may
	// allocate: callers create their scratch once, with this factory, and reuse it.
	function contactResult() {
		return { impact: 0, vx: 0, vy: 0, platformVx: 0, heat: 0, push: 0, captured: false };
	}

	// Resolve a ball contact on the tilted piston face without touching the world:
	// friction along the face, the restitution impulse with the platform's
	// horizontal reaction, and the optional powered push along the normal. `push`
	// is the pulse energy already limited by the reserve and the thermal derate
	// (`launchCapacity`), so the automatic keepers can trial any tilt and either
	// drive state against exactly the impulses the simulation will apply.
	// `out.impact <= 0` means the ball is separating and nothing happens.
	function solvePiston(world, ballVx, ballVy, angle, push, out) {
		const nx = -Math.sin(angle);
		const ny = Math.cos(angle);
		const tx = ny;
		const ty = -nx;
		const ballMass = config.ballMass;
		const carriedMass = platformMass(world);
		const platformVx = world.platform.vx;
		const restitution = Math.sqrt(retentionNow());
		const relativeVx = ballVx - platformVx;
		const impact = -(relativeVx * nx + ballVy * ny);
		out.impact = impact;
		out.vx = ballVx;
		out.vy = ballVy;
		out.platformVx = platformVx;
		out.heat = 0;
		out.push = 0;
		out.captured = false;
		if (impact <= 0) return out;
		const before = 0.5 * ballMass * (ballVx * ballVx + ballVy * ballVy) + 0.5 * carriedMass * platformVx * platformVx;
		let vx = ballVx;
		let vy = ballVy;
		let platform = platformVx;
		const normalImpulse = ballMass * impact * (1 + restitution);
		const tangentVelocity = relativeVx * tx + ballVy * ty;
		const friction = Math.max(-normalImpulse * 0.35, Math.min(normalImpulse * 0.35, -tangentVelocity / (1 / ballMass + 1 / carriedMass)));
		vx += friction * tx / ballMass;
		vy += friction * ty / ballMass;
		platform -= friction * tx / carriedMass;
		const normalVelocity = (vx - platform) * nx + vy * ny;
		if (normalVelocity < 0) {
			const impulse = -(1 + restitution) * normalVelocity / (1 / ballMass + nx * nx / carriedMass);
			vx += impulse * nx / ballMass;
			vy += impulse * ny / ballMass;
			platform -= impulse * nx / carriedMass;
		}
		// Only the passive part is lost: the pulse is paid for separately.
		out.heat = Math.max(0, before - (0.5 * ballMass * (vx * vx + vy * vy) + 0.5 * carriedMass * platform * platform));
		if (push > 0) {
			const normalBallVelocity = vx * nx + vy * ny;
			const boosted = Math.sqrt(normalBallVelocity * normalBallVelocity + 2 * push / ballMass);
			vx += (boosted - normalBallVelocity) * nx;
			vy += (boosted - normalBallVelocity) * ny;
			out.push = push;
		}
		out.captured = (vx - platform) * nx + vy * ny < 0.08;
		out.vx = vx;
		out.vy = vy;
		out.platformVx = platform;
		return out;
	}

	// The simulation's own scratch for the contact it is resolving this step.
	const contact = contactResult();

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
			drive: true, forceSetting: 0.6, direction: 0, target: NaN,
			pistonAngle: 0, pistonOffset: 0, pistonVelocity: 0, pistonImpact: 0,
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

	// The released ball rests on the tilted piston face, a little right of its
	// centre, so its resting height follows the tilt.
	function launchHeight(world) {
		const along = config.platformWidth * 0.25 - config.pistonCentre;
		return config.deck + along * Math.sin(world.pistonAngle) + config.radius * Math.cos(world.pistonAngle) - config.radius;
	}

	function canLaunch(world) {
		if (world.ball.state !== 'held' || !world.drive) return false;
		return launchCapacity(world) > config.ballMass * config.ballGravity * launchHeight(world);
	}

	function launch(world) {
		if (!canLaunch(world)) return false;
		const ball = world.ball;
		const energy = spend(world, pulseNow() * thermalFactor(world));
		const height = launchHeight(world);
		const nx = -Math.sin(world.pistonAngle);
		ball.x = world.platform.x + config.pistonCentre + Math.cos(world.pistonAngle) * (config.platformWidth * 0.25 - config.pistonCentre) + nx * config.radius;
		ball.y = height + config.radius;
		ball.vx = world.platform.vx;
		ball.vy = Math.sqrt(2 * (energy - config.ballMass * config.ballGravity * height) / config.ballMass);
		ball.state = 'flying';
		// The piston visibly shoves the ball away, then springs back.
		world.pistonOffset = config.pistonTravel * 0.6;
		world.pistonVelocity = 0;
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
			const collectorEdgeX = platformX - config.platformWidth * 0.5 + config.platformWidth * config.collectorFraction;
			if (deckTime <= time && impactX >= platformX - config.platformWidth * 0.5 && impactX <= collectorEdgeX) { time = deckTime; type = 4; }
			const platformVelocity = (world.platform.x - oldPlatformX) / dt;
			const pistonCentreX = oldPlatformX + platformVelocity * elapsed + config.pistonCentre;
			const pistonTime = pistonContactTime(ball.x, ball.y, ball.vx, ball.vy, pistonCentreX, platformVelocity, world.pistonAngle, remaining);
			if (pistonTime <= time) { time = pistonTime; type = 6; }
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
			if (type === 6) {
				const angle = world.pistonAngle;
				solvePiston(world, ball.vx, ball.vy, angle, 0, contact);
				if (contact.impact <= 0) continue;
				// Compression follows the normal impact speed; the spring in
				// step() then extends the face back out as the visible push.
				world.pistonImpact = contact.impact;
				world.pistonOffset = Math.min(config.pistonTravel, Math.max(world.pistonOffset, contact.impact * config.pistonCompression));
				world.pistonVelocity = 0;
				// The impact heat lands before the pulse is priced, so the derate sees
				// it; the boost is then re-solved with what the reserve really delivers.
				world.heat += contact.heat;
				const push = world.drive ? spend(world, pulseNow() * thermalFactor(world)) : 0;
				if (push > 0) solvePiston(world, ball.vx, ball.vy, angle, push, contact);
				ball.vx = contact.vx;
				ball.vy = contact.vy;
				world.platform.vx = contact.platformVx;
				world.bounces++;
				world.lastPush = push;
				if (push > 0) world.pushes++;
				if (contact.captured) { capture(world); return; }
				continue;
			}
			// Type 4 is the flat collector only: it catches and holds the ball.
			capture(world);
			return;
		}
	}

	function step(world, dt) {
		const oldX = world.platform.x;
		movePlatform(world, dt);
		advanceBall(world, dt, oldX);
		advancePiston(world, dt);
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
		config, createWorld, step, launch, canLaunch, launchCapacity, ballEnergy, totalEnergy, temperature,
		thermalFactor, coolingPower, platformMass, platformMin, platformMax, dryMass,
		chargePadMin, chargePadMax, onChargePad, charging,
		retentionNow, pulseNow, recoveryNow, conductanceNow, radiatorArea, applyMassChange,
		setPistonAngle, pistonContactTime, solvePiston, contactResult
	};
	root.SteamPhysics = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
