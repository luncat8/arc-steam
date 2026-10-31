(function (root) {
	'use strict';
	const gravity = 9.81;
	const ballSpeedScale = 1 / (1.5 * 1.2);
	// Source packs are full-pack masses: fuel depletion does not remove ballast.
	const engines = Object.freeze([
		Object.freeze({ id: 'hand', name: 'Hand', mass: 3, density: 20000, efficiency: 0.97, reload: 18, force: 0.125, speed: 0.15 }),
		Object.freeze({ id: 'coal', name: 'Coal', mass: 45, density: 20000, efficiency: 0.2, reload: 16, force: 0.65, speed: 0.7 }),
		Object.freeze({ id: 'oil', name: 'Oil', mass: 28, density: 60000, efficiency: 0.55, reload: 3, force: 0.75, speed: 0.85 }),
		Object.freeze({ id: 'electric', name: 'Electric', mass: 18, density: 20000, efficiency: 0.8, reload: 6, force: 1, speed: 1 }),
		Object.freeze({ id: 'nuclear', name: 'Nuclear', mass: 55, density: 2000000, efficiency: 0.55, reload: 8, force: 1.1, speed: 1 })
	]);
	let engine = engines[3];
	// Stock electric pack is already included in the 60 kg base machine.
	const basePackMass = 4 * 0.5 * (60 + 3.24) * 12 * 12 / 0.8 / 20000;
	const config = Object.freeze({
		width: 24, ceiling: 15, gravity, ballGravity: gravity * ballSpeedScale * ballSpeedScale,
		ballMass: 1 / (ballSpeedScale * ballSpeedScale), ballSpeedScale, radius: 0.18,
		platformWidth: 3.6, deck: 0.7, collectorFraction: 0.35,
		platformWheelHalfSpan: 1.3, platformWheelRadius: 0.18, platformBodyBottom: 0.2,
		platformMaxPitch: Math.PI / 6, platformPitchRate: Math.PI / 2, platformDropRate: 3,
		// The reflector is a sprung piston: its face tilts to steer reflections
		// (centre and half-width follow from the collector/reflector split) and
		// compresses along its normal in proportion to the impact speed.
		pistonCentre: 0.63, pistonHalf: 1.17, pistonMaxAngle: Math.PI / 18,
		pistonTravel: 0.16, pistonCompression: 0.024, pistonSpring: 650, pistonDamping: 18,
		// Actuator rate of the tilt, in rad/s (45°/s): the automatic keeper slews
		// towards the angle it wants instead of snapping to it. Direct manual tilt
		// stays immediate, because the player is the one aiming.
		pistonSlewRate: Math.PI / 4,
		// Tier-1 engine tune: 480 N / 12 m/s (1.2x the previous 400 N / 10 m/s).
		// Research and machinery add forceBonus/speedBonus on top of this; the
		// electric full chain reaches 1920 N / 30 m/s.
		platformMass: 60, force: 480, maxSpeed: 12,
		// Bounce pulse sized for the three-bounce rule: from a release, the apex
		// after the third powered bounce must clear the ceiling plane (about
		// 15.1 m at 42 J) while the first two stay short of it. One pulse adds
		// P/(m·g) = 4.28 m of height; rounding up from the 41.2 J solution.
		retention: 0.9, pulse: 42, get efficiency() { return engine.efficiency; }, get battery() { return reserveNow(); }, step: 1 / 240,
		// Centre ground charge pad: a refuelling surface, not a consumable. It
		// fills the installed source pack at its reload rate while parked, so
		// the cost of energy is position and downtime rather than credits.
		chargePadWidth: 4, get chargeSeconds() { return engine.reload; }, get chargePower() { return reserveNow() / engine.reload; }, chargeMaxSpeed: 0.1,
		// Manual-drive fallback: an empty reserve leaves the crew's hand crank,
		// a crawl next to the powered engines but enough to always reach
		// the charge pad or a selling wall. It moves the platform only.
		crankForce: 60, crankMaxSpeed: 0.8,
		recoveryEfficiency: 0.9,
		ambientTemperature: 20, heatCapacity: 300,
		convectiveConductance: 1.1, radiatorConvectionCoefficient: 50,
		radiatingArea: 0.08, emissivity: 0.85,
		thermalDerateStart: 85, thermalCutoff: 135,
		// Left-wall pocket lets the asymmetric collector slide into the wall so
		// the reflector can cover the wall all the way to x = 0.
		pocketDepth: 3.6 * 0.35,
		// Road-grader rolling resistance when its blade is engaged under the
		// platform centre while moving. Adds friction opposite motion.
		// Kept below the 60 N hand crank so an empty reserve can still crawl
		// to the charge pad with the grader installed.
		graderFriction: 45
	});

	function platformMin() { return config.platformWidth * 0.5 - config.pocketDepth; }
	function platformMax() { return config.width - config.platformWidth * 0.5; }

	function terrainHeight(x) {
		return root.SteamCeiling ? root.SteamCeiling.floorAt(x) : 0;
	}

	function platformGroundAt(x) {
		return Math.max(terrainHeight(x), root.SteamCeiling ? root.SteamCeiling.botSurfaceAt(x) : 0);
	}
	function platformPitchAt(x) {
		const span = config.platformWheelHalfSpan;
		const rise = platformGroundAt(x + span) - platformGroundAt(x - span);
		return Math.max(-config.platformMaxPitch, Math.min(config.platformMaxPitch, Math.atan2(rise, span * 2)));
	}

	// The chassis origin follows the highest surface under its wheels and belly.
	// Sampling the full footprint lets a mound lift the platform instead of
	// letting the body tunnel through it.
	function platformBaseAt(x, angle) {
		const cosine = Math.cos(angle);
		const sine = Math.sin(angle);
		const halfWidth = config.platformWidth * 0.5;
		const bodyBottom = config.platformBodyBottom;
		let height = 0;
		const cell = root.SteamCeiling ? root.SteamCeiling.state.cell : config.platformWheelRadius * 2;
		const sampleStep = Math.min(config.platformWheelRadius, cell * 0.5);
		for (let localX = -halfWidth; localX < halfWidth; localX += sampleStep) {
			const groundX = x + localX * cosine - bodyBottom * sine;
			const required = platformGroundAt(groundX) - localX * sine - bodyBottom * cosine;
			height = Math.max(height, required);
		}
		const groundX = x + halfWidth * cosine - bodyBottom * sine;
		height = Math.max(height, platformGroundAt(groundX) - halfWidth * sine - bodyBottom * cosine);
		const radius = config.platformWheelRadius;
		const span = config.platformWheelHalfSpan;
		for (let sign = -1; sign <= 1; sign += 2) {
			const localX = sign * span;
			const groundX = x + localX * cosine - radius * sine;
			const required = platformGroundAt(groundX) - localX * sine + radius - radius * cosine;
			height = Math.max(height, required);
		}
		return Math.max(0, height);
	}

	function updatePlatformTerrain(world, dt) {
		const platform = world.platform;
		const wantedAngle = platformPitchAt(platform.x);
		const turn = config.platformPitchRate * dt;
		platform.angle += Math.max(-turn, Math.min(turn, wantedAngle - platform.angle));
		const wantedHeight = platformBaseAt(platform.x, platform.angle);
		platform.y = Math.max(wantedHeight, platform.previousY - config.platformDropRate * dt);
		platform.stepVx = (platform.x - platform.previousX) / dt;
		platform.stepVy = (platform.y - platform.previousY) / dt;
		platform.stepOmega = (platform.angle - platform.previousAngle) / dt;
		platform.vy = platform.stepVy;
		platform.omega = platform.stepOmega;
	}

	function platformPointAt(x, y, baseAngle, localX, localY, relativeAngle, out) {
		const cosine = Math.cos(baseAngle);
		const sine = Math.sin(baseAngle);
		out.x = x + cosine * localX - sine * localY;
		out.y = y + sine * localX + cosine * localY;
		out.angle = baseAngle + relativeAngle;
	}

	function platformSurfaceAt(world, elapsed, dt, localX, localY, relativeAngle, out) {
		const platform = world.platform;
		const fraction = Math.max(0, Math.min(1, elapsed / dt));
		const x = platform.previousX + (platform.x - platform.previousX) * fraction;
		const y = platform.previousY + (platform.y - platform.previousY) * fraction;
		const angle = platform.previousAngle + (platform.angle - platform.previousAngle) * fraction;
		const cosine = Math.cos(angle);
		const sine = Math.sin(angle);
		const offsetX = cosine * localX - sine * localY;
		const offsetY = sine * localX + cosine * localY;
		out.x = x + offsetX;
		out.y = y + offsetY;
		out.vx = platform.stepVx - platform.stepOmega * offsetY;
		out.vy = platform.stepVy + platform.stepOmega * offsetX;
		out.angle = angle + relativeAngle;
	}

	function planeContactTime(x, y, vx, vy, centerX, centerY, centerVx, centerVy, angle, limit, halfExtent) {
		const nx = -Math.sin(angle);
		const ny = Math.cos(angle);
		const signed = nx * (x - centerX) + ny * (y - centerY) - config.radius;
		if (signed < -1e-9) return Infinity;
		const a = -0.5 * config.ballGravity * ny;
		const b = nx * (vx - centerVx) + ny * (vy - centerVy);
		const discriminant = b * b - 4 * a * signed;
		if (discriminant < 0) return Infinity;
		const root = Math.sqrt(discriminant);
		let time = (-b - root) / (2 * a);
		if (!(time >= -1e-10) || time > limit || b + 2 * a * time >= 0) time = (-b + root) / (2 * a);
		if (!(time >= -1e-10) || time > limit || b + 2 * a * time >= 0) return Infinity;
		time = Math.max(0, time);
		const contactX = x + vx * time;
		const contactY = y + vy * time - 0.5 * config.ballGravity * time * time;
		const foot = (contactX - (centerX + centerVx * time)) * Math.cos(angle) + (contactY - (centerY + centerVy * time)) * Math.sin(angle);
		return Math.abs(foot) <= halfExtent + 1e-9 ? time : Infinity;
	}

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

	// Earliest time the ball centre reaches one radius from a moving piston face.
	// The face centre and its local velocity are supplied at the start of the
	// remaining step; the angle stays fixed over this short collision solve.
	function pistonContactTime(x, y, vx, vy, centerX, centerY, centerVx, centerVy, angle, limit) {
		return planeContactTime(x, y, vx, vy, centerX, centerY, centerVx, centerVy, angle, limit, config.pistonHalf);
	}

	// Preallocated solver result. A contact is resolved once per bounce and the
	// automatic tilt keeper trials dozens of angles per step, so neither may
	// allocate: callers create their scratch once, with this factory, and reuse it.
	function contactResult() {
		return { impact: 0, vx: 0, vy: 0, platformVx: 0, heat: 0, surfaceWork: 0, push: 0, captured: false };
	}

	// Resolve contact against the moving piston plane. The platform can recoil in
	// x; terrain-following vertical/rotational motion is prescribed, so its work
	// is tracked separately from collision heat.
	function solvePiston(world, ballVx, ballVy, angle, push, out, surfaceVx, surfaceVy) {
		const platform = world.platform;
		const baseAngle = platform.angle;
		const faceAngle = baseAngle + angle;
		const nx = -Math.sin(faceAngle);
		const ny = Math.cos(faceAngle);
		const tx = ny;
		const ty = -nx;
		const ballMass = config.ballMass;
		const carriedMass = platformMass(world);
		const platformVx = platform.vx;
		const localX = Math.cos(baseAngle) * config.pistonCentre - Math.sin(baseAngle) * config.deck;
		const localY = Math.sin(baseAngle) * config.pistonCentre + Math.cos(baseAngle) * config.deck;
		if (!Number.isFinite(surfaceVx)) surfaceVx = platformVx - platform.omega * localY;
		if (!Number.isFinite(surfaceVy)) surfaceVy = platform.vy + platform.omega * localX;
		const surfaceOffsetX = surfaceVx - platformVx;
		const restitution = Math.sqrt(retentionNow());
		const relativeVx = ballVx - surfaceVx;
		const relativeVy = ballVy - surfaceVy;
		const impact = -(relativeVx * nx + relativeVy * ny);
		out.impact = impact;
		out.vx = ballVx;
		out.vy = ballVy;
		out.platformVx = platformVx;
		out.heat = 0;
		out.surfaceWork = 0;
		out.push = 0;
		out.captured = false;
		if (impact <= 0) return out;
		const before = 0.5 * ballMass * (ballVx * ballVx + ballVy * ballVy) + 0.5 * carriedMass * platformVx * platformVx;
		let vx = ballVx;
		let vy = ballVy;
		let platformVxAfter = platformVx;
		const normalLimit = ballMass * impact * (1 + restitution);
		const tangentVelocity = relativeVx * tx + relativeVy * ty;
		const friction = Math.max(-normalLimit * 0.35, Math.min(normalLimit * 0.35, -tangentVelocity / (1 / ballMass + 1 / carriedMass)));
		vx += friction * tx / ballMass;
		vy += friction * ty / ballMass;
		platformVxAfter -= friction * tx / carriedMass;
		const surfaceXAfterFriction = platformVxAfter + surfaceOffsetX;
		const normalVelocity = (vx - surfaceXAfterFriction) * nx + (vy - surfaceVy) * ny;
		let normalImpulse = 0;
		if (normalVelocity < 0) {
			normalImpulse = -(1 + restitution) * normalVelocity / (1 / ballMass + nx * nx / carriedMass);
			vx += normalImpulse * nx / ballMass;
			vy += normalImpulse * ny / ballMass;
			platformVxAfter -= normalImpulse * nx / carriedMass;
		}
		const impulseX = friction * tx + normalImpulse * nx;
		const impulseY = friction * ty + normalImpulse * ny;
		const surfaceWork = impulseX * surfaceOffsetX + impulseY * surfaceVy;
		const after = 0.5 * ballMass * (vx * vx + vy * vy) + 0.5 * carriedMass * platformVxAfter * platformVxAfter;
		out.surfaceWork = surfaceWork;
		out.heat = Math.max(0, surfaceWork + before - after);
		if (push > 0) {
			const normalBallVelocity = vx * nx + vy * ny;
			const boosted = Math.sqrt(normalBallVelocity * normalBallVelocity + 2 * push / ballMass);
			vx += (boosted - normalBallVelocity) * nx;
			vy += (boosted - normalBallVelocity) * ny;
			out.push = push;
		}
		out.captured = (vx - (platformVxAfter + surfaceOffsetX)) * nx + (vy - surfaceVy) * ny < 0.08;
		out.vx = vx;
		out.vy = vy;
		out.platformVx = platformVxAfter;
		return out;
	}

	// The simulation's own scratch for the contact it is resolving this step.
	const contact = contactResult();
	const pistonSurfaceScratch = { x: 0, y: 0, vx: 0, vy: 0, angle: 0 };
	const collectorSurfaceScratch = { x: 0, y: 0, vx: 0, vy: 0, angle: 0 };

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
	function rockRetentionNow() {
		const r = retentionNow() + installed('rockRetentionBonus');
		return Math.max(0, Math.min(0.995, r));
	}
	function ballMassNow() { return config.ballMass + installed('ballMassBonus'); }
	function damageBonusNow() { return installed('damageBonus'); }
	function damageRadiusBonusNow() { return installed('damageRadiusBonus'); }
	function pulseNow() { return config.pulse + installed('pulseBonus'); }
	function forceNow() { return (config.force + installed('forceBonus')) * engine.force; }
	function speedNow() { return (config.maxSpeed + installed('speedBonus')) * engine.speed; }
	function packMass() { return reserveNow() / engine.density; }
	function dryMass() { return config.platformMass + engine.mass - 18 + installed('massDelta') + packMass() - basePackMass; }
	function reserveNow() {
		// Four full-throttle, wall-to-wall starts; acceleration distance caps
		// the kinetic cost when the map is too short to attain rated speed.
		const mass = config.platformMass + engine.mass - 18 + installed('massDelta') + ballMassNow();
		const speed = speedNow();
		const kinetic = Math.min(0.5 * mass * speed * speed, forceNow() * (platformMax() - platformMin()));
		return 4 * kinetic / engine.efficiency;
	}
	function engineNow() { return engine; }
	function selectEngine(id, world) {
		const next = engines.find(item => item.id === id);
		if (!next || !world || Math.abs(world.platform.vx) > 0.1 || world.platform.x > platformMin() + 0.2) return false;
		const oldMass = platformMass(world);
		engine = next;
		applyMassChange(world, platformMass(world) - oldMass, oldMass);
		const excess = Math.max(0, world.battery - reserveNow());
		world.battery -= excess;
		world.heat += excess;
		return true;
	}
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
		const returned = Math.min(Math.max(0, config.battery - world.battery), energy * recovery * config.recoveryEfficiency);
		world.battery += returned;
		world.heat += energy - returned;
	}

	function createWorld() {
		engine = engines[3];
		if (root.SteamCeiling) root.SteamCeiling.reset(1);
		if (root.SteamEquipment) root.SteamEquipment.reset();
		if (root.SteamResearch) root.SteamResearch.reset();
		const world = {
			time: 0, battery: config.battery, heat: 0, cooledEnergy: 0, fractureEnergy: 0, importedEnergy: 0, chargedEnergy: 0, crankEnergy: 0, terrainWork: 0,
			initialEnergy: 0,
			brake: false, drive: true, forceSetting: 0.6, direction: 0, target: NaN,
			pistonAngle: 0, pistonOffset: 0, pistonVelocity: 0, pistonImpact: 0,
			platform: { x: 12, y: 0, vx: 0, vy: 0, angle: 0, omega: 0, spin: 0, previousX: 12, previousY: 0, previousAngle: 0, stepVx: 0, stepVy: 0, stepOmega: 0 },
			ball: { x: 12.8, y: 5, vx: 1.2 * config.ballSpeedScale, vy: 0, state: 'flying' },
			bounces: 0, pushes: 0, lastPush: 0, groundings: 0, sales: 0, lastSale: 0
		};
		world.initialEnergy = totalEnergy(world);
		return world;
	}

	function ballEnergy(ball) {
		if (ball.state === 'held') return 0;
		return ballMassNow() * (0.5 * (ball.vx * ball.vx + ball.vy * ball.vy) + config.ballGravity * (ball.y - config.radius));
	}

	function cargoMass() {
		return root.SteamCeiling ? root.SteamCeiling.state.cargoMass : 0;
	}

	function platformMass(world) {
		return dryMass() + cargoMass() + (world.ball.state === 'held' ? ballMassNow() : 0);
	}

	// Imported (bought) energy is subtracted and exported (sold, cooled) energy is
	// added, so the balance stays exact across both directions of trade.
	function totalEnergy(world) {
		const ceilingEnergy = root.SteamCeiling ? root.SteamCeiling.state.energy : 0;
		return world.battery + world.heat + world.cooledEnergy + world.fractureEnergy - world.importedEnergy - world.terrainWork + ceilingEnergy + ballEnergy(world.ball) + 0.5 * platformMass(world) * world.platform.vx * world.platform.vx;
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
	const efficiency = engine.efficiency;
	const delivered = Math.min(useful, world.battery * efficiency);
	const cost = delivered / efficiency;
	world.battery -= cost;
	world.heat += cost - delivered;
	return delivered;
}

	function setHeldBallPose(world) {
		const platform = world.platform;
		const localX = -config.platformWidth * 0.32;
		const localY = config.deck + config.radius;
		const cosine = Math.cos(platform.angle);
		const sine = Math.sin(platform.angle);
		world.ball.x = platform.x + cosine * localX - sine * localY;
		world.ball.y = platform.y + sine * localX + cosine * localY;
	}

	function capture(world) {
		const ball = world.ball;
		const platform = world.platform;
		const carriedMass = dryMass() + cargoMass();
		const before = ballEnergy(ball) + 0.5 * carriedMass * platform.vx * platform.vx;
		platform.vx = (carriedMass * platform.vx + ballMassNow() * ball.vx) / (carriedMass + ballMassNow());
		ball.state = 'held';
		ball.vx = 0;
		ball.vy = 0;
		setHeldBallPose(world);
		world.heat += before - 0.5 * platformMass(world) * platform.vx * platform.vx;
	}

	function launchCapacity(world) {
		return Math.min(pulseNow() * thermalFactor(world), world.battery * engine.efficiency);
	}

	// The released ball rests on the tilted piston face, a little right of its
	// centre. Both the terrain-following chassis and piston tilt set the height.
	function launchHeight(world) {
		const platform = world.platform;
		const baseAngle = platform.angle;
		const faceAngle = baseAngle + world.pistonAngle;
		const along = config.platformWidth * 0.25 - config.pistonCentre;
		const centreY = platform.y + Math.sin(baseAngle) * config.pistonCentre + Math.cos(baseAngle) * config.deck;
		return centreY + Math.sin(faceAngle) * along + Math.cos(faceAngle) * config.radius - config.radius;
	}

	function canLaunch(world) {
		if (world.ball.state !== 'held' || !world.drive) return false;
		return launchCapacity(world) > ballMassNow() * config.ballGravity * launchHeight(world);
	}

	function launch(world) {
		if (!canLaunch(world)) return false;
		const ball = world.ball;
		const energy = spend(world, pulseNow() * thermalFactor(world));
		const height = launchHeight(world);
		const platform = world.platform;
		const baseAngle = platform.angle;
		const faceAngle = baseAngle + world.pistonAngle;
		const along = config.platformWidth * 0.25 - config.pistonCentre;
		const centreX = platform.x + Math.cos(baseAngle) * config.pistonCentre - Math.sin(baseAngle) * config.deck;
		const centreY = platform.y + Math.sin(baseAngle) * config.pistonCentre + Math.cos(baseAngle) * config.deck;
		ball.x = centreX + Math.cos(faceAngle) * along - Math.sin(faceAngle) * config.radius;
		ball.y = centreY + Math.sin(faceAngle) * along + Math.cos(faceAngle) * config.radius;
		ball.vx = platform.vx;
		ball.vy = Math.sqrt(2 * (energy - ballMassNow() * config.ballGravity * height) / ballMassNow());
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
		platform.previousX = platform.x;
		platform.previousY = platform.y;
		platform.previousAngle = platform.angle;
		const mass = platformMass(world);
		const engineForce = forceNow();
		let direction = world.direction;
		if (!world.brake && !direction && Number.isFinite(world.target)) {
			const distance = world.target - platform.x;
			const acceleration = engineForce * world.forceSetting / mass;
			const stopping = platform.vx * platform.vx / (2 * acceleration);
			direction = Math.sign(distance);
			if (platform.vx * distance > 0 && Math.abs(distance) < stopping + 0.04) direction = -Math.sign(platform.vx);
			if (Math.abs(distance) < 0.04 && Math.abs(platform.vx) < acceleration * dt * 2) {
				world.heat += 0.5 * mass * platform.vx * platform.vx;
				platform.vx = 0;
				direction = 0;
			}
		}
		if (world.brake) direction = -Math.sign(platform.vx);
		const oldVelocity = platform.vx;
		const acceleration = engineForce * world.forceSetting / mass;
		// An empty reserve leaves the manual drive: the crew hand-cranks the
		// platform at a crawl, so the charge pad (or a wall sale) stays
		// reachable. Braking above keeps full force either way, and crank work
		// is booked below as imported energy like a pad charge.
		const crank = world.battery <= 0;
		let velocity = oldVelocity;
		let remaining = dt;
		if (direction && oldVelocity * direction < 0) {
			const brakingTime = Math.min(remaining, Math.abs(oldVelocity) / acceleration);
			velocity += direction * acceleration * brakingTime;
			remaining -= brakingTime;
		}
		if (remaining > 0 && !world.brake) velocity += direction * (crank ? config.crankForce / mass : acceleration * thermalFactor(world)) * remaining;
		if (crank && direction) {
			// The crank tops out at its crawl, but never drags a faster coast
			// down to it: the limit is whichever the platform already has.
			const limit = Math.max(config.crankMaxSpeed, direction * oldVelocity);
			if (direction * velocity > limit) velocity = direction * limit;
		}
		velocity = Math.max(-speedNow(), Math.min(speedNow(), velocity));
		const before = 0.5 * mass * oldVelocity * oldVelocity;
		const after = 0.5 * mass * velocity * velocity;
		if (after > before) {
			if (crank) {
				world.importedEnergy += after - before;
				world.crankEnergy += after - before;
			} else {
				const available = spend(world, after - before);
				velocity = Math.sign(velocity) * Math.sqrt(2 * (before + available) / mass);
			}
		} else {
			dissipate(world, before - after);
		}
		// Road grader friction when its blade is working under the centre.
		// Applied after the engine so its cost appears as extra heat and reduced
		// net speed, keeping the energy ledger exact.
		let finalVelocity = velocity;
		const grading = root.SteamEquipment && root.SteamEquipment.isInstalled('grader')
			&& (Math.abs(velocity) > 1e-6 || Math.abs(oldVelocity) > 0.02 || world.direction !== 0 || Number.isFinite(world.target));
		if (grading && Math.abs(velocity) > 1e-9) {
			const frictionAccel = config.graderFriction / mass;
			let afterFriction = velocity - Math.sign(velocity) * frictionAccel * dt;
			if (Math.sign(afterFriction) !== Math.sign(velocity)) afterFriction = 0;
			const beforeFriction = 0.5 * mass * velocity * velocity;
			const afterFrictionEnergy = 0.5 * mass * afterFriction * afterFriction;
			const frictionLoss = beforeFriction - afterFrictionEnergy;
			if (frictionLoss > 0) world.heat += frictionLoss;
			finalVelocity = afterFriction;
		}
		platform.vx = finalVelocity;
		platform.x += (oldVelocity + finalVelocity) * 0.5 * dt;
		const minX = platformMin();
		const maxX = platformMax();
		if (platform.x < minX || platform.x > maxX) {
			// A wall stop is a crash, not braking: all of it becomes heat. The sale
			// itself is handled once per step by step(), which also covers fragments.
			platform.x = Math.max(minX, Math.min(maxX, platform.x));
			world.heat += 0.5 * mass * finalVelocity * finalVelocity;
			platform.vx = 0;
		}
		// Wheels roll with the distance actually travelled, so the drawn spokes
		// match the ground contact rather than the commanded velocity.
		platform.spin += (platform.x - platform.previousX) / config.platformWheelRadius;
		updatePlatformTerrain(world, dt);
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
		const lost = 0.5 * ballMassNow() * normalVelocity * normalVelocity * (1 - retention);
		const spentOnRock = Math.min(lost, fracture || 0);
		const impulseVelocity = (1 + Math.sqrt(retention)) * normalVelocity;
		world.fractureEnergy += spentOnRock;
		world.heat += lost - spentOnRock;
		ball.vx -= impulseVelocity * nx;
		ball.vy -= impulseVelocity * ny;
	}
	function rockPassiveImpact(world, nx, ny, fracture) {
		const ball = world.ball;
		const normalVelocity = ball.vx * nx + ball.vy * ny;
		if (normalVelocity >= 0) return;
		const retention = rockRetentionNow();
		const lost = 0.5 * ballMassNow() * normalVelocity * normalVelocity * (1 - retention);
		const spentOnRock = Math.min(lost, fracture || 0);
		const impulseVelocity = (1 + Math.sqrt(retention)) * normalVelocity;
		world.fractureEnergy += spentOnRock;
		world.heat += lost - spentOnRock;
		ball.vx -= impulseVelocity * nx;
		ball.vy -= impulseVelocity * ny;
	}

	function advanceBall(world, dt) {
		const ball = world.ball;
		if (ball.state === 'held') {
			setHeldBallPose(world);
			return;
		}
		if (ball.state === 'grounded') {
			// The rubble surface under a resting ball can still move (a fresh
			// deposit, a grader cut): re-seat on it so the ball is neither
			// buried nor left floating. Settling down dissipates as heat;
			// being lifted is work by the prescribed terrain.
			const rest = terrainHeight(ball.x) + config.radius;
				const delta = ballMassNow() * config.ballGravity * (rest - ball.y);
				if (delta > 0) world.terrainWork += delta;
				else world.heat -= delta;
				ball.y = rest;
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
			// The floor is a heightmap of fallen rubble: the crossing is solved at
			// the surface under the ball, and a centre already inside the surface
			// (a rise ahead of the drift between steps) grounds at once.
			const floor = root.SteamCeiling ? root.SteamCeiling.floorAt(ball.x) : 0;
			const groundTime = ball.y < floor + config.radius ? 0 : downwardTime(ball, floor + config.radius);
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
			const collectorWidth = config.platformWidth * config.collectorFraction;
			const collectorCentre = -config.platformWidth * 0.5 + collectorWidth * 0.5;
			platformSurfaceAt(world, elapsed, dt, collectorCentre, config.deck, 0, collectorSurfaceScratch);
			const deckTime = planeContactTime(ball.x, ball.y, ball.vx, ball.vy, collectorSurfaceScratch.x, collectorSurfaceScratch.y,
				collectorSurfaceScratch.vx, collectorSurfaceScratch.vy, collectorSurfaceScratch.angle, remaining, collectorWidth * 0.5);
			if (deckTime <= time) { time = deckTime; type = 4; }
			platformSurfaceAt(world, elapsed, dt, config.pistonCentre, config.deck, world.pistonAngle, pistonSurfaceScratch);
			const pistonTime = pistonContactTime(ball.x, ball.y, ball.vx, ball.vy, pistonSurfaceScratch.x, pistonSurfaceScratch.y,
				pistonSurfaceScratch.vx, pistonSurfaceScratch.vy, pistonSurfaceScratch.angle, remaining);
			let pistonAngleAtContact = 0;
			let pistonVxAtContact = 0;
			let pistonVyAtContact = 0;
			if (pistonTime <= time) {
				time = pistonTime;
				type = 6;
				pistonAngleAtContact = pistonSurfaceScratch.angle - world.platform.angle;
				pistonVxAtContact = pistonSurfaceScratch.vx;
				pistonVyAtContact = pistonSurfaceScratch.vy;
			}
			ball.x += ball.vx * time;
			ball.y += ball.vy * time - 0.5 * config.ballGravity * time * time;
			ball.vy -= config.ballGravity * time;
			remaining -= time;
			elapsed += time;
			if (!type) return;
			if (type === 1) { ball.vx = -ball.vx; continue; }
			if (type === 2) {
				// The ball settles on the rubble surface and keeps the potential
				// energy of its resting height; only the remainder becomes heat.
				const rest = root.SteamCeiling ? root.SteamCeiling.floorAt(ball.x) : 0;
				world.heat += ballEnergy(ball) - ballMassNow() * config.ballGravity * rest;
				ball.y = rest + config.radius;
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
				world.heat += ballMassNow() * config.ballGravity * (ball.y - rockY);
				ball.x = rockX;
				ball.y = rockY;
				const normalVelocity = ball.vx * rockNx + ball.vy * rockNy;
				// One impulse per step: later zero-time contacts only separate,
				// keeping the ball's contact impulse instead of stacking flips.
				if (normalVelocity < 0 && !rockImpulse) {
					const rockRetention = rockRetentionNow();
					const damageBudget = 0.5 * ballMassNow() * normalVelocity * normalVelocity * (1 - rockRetention);
					const contactX = ball.x - rockNx * config.radius;
					const contactY = ball.y - rockNy * config.radius;
					const fracture = root.SteamCeiling.damage(contactX, contactY, damageBudget);
					rockPassiveImpact(world, rockNx, rockNy, fracture);
					rockImpulse = true;
				}
				continue;
			}
			if (type === 6) {
				const angle = pistonAngleAtContact;
				solvePiston(world, ball.vx, ball.vy, angle, 0, contact, pistonVxAtContact, pistonVyAtContact);
				if (contact.impact <= 0) continue;
				// Compression follows the normal impact speed; the spring in
				// step() then extends the face back out as the visible push.
				world.pistonImpact = contact.impact;
				world.pistonOffset = Math.min(config.pistonTravel, Math.max(world.pistonOffset, contact.impact * config.pistonCompression));
				world.pistonVelocity = 0;
				// The impact heat lands before the pulse is priced, so the derate sees
				// it; the boost is then re-solved with what the reserve really delivers.
				world.heat += contact.heat;
				world.terrainWork += contact.surfaceWork;
				const push = world.drive ? spend(world, pulseNow() * thermalFactor(world)) : 0;
				if (push > 0) solvePiston(world, ball.vx, ball.vy, angle, push, contact, pistonVxAtContact, pistonVyAtContact);
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
		movePlatform(world, dt);
		advanceBall(world, dt);
		advancePiston(world, dt);
		charge(world, dt);
		if (root.SteamCeiling) {
			const heldMass = world.ball.state === 'held' ? ballMassNow() : 0;
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
		engines, engineNow, selectEngine, reserveNow, packMass,
		config, createWorld, step, launch, canLaunch, launchCapacity, ballEnergy, totalEnergy, temperature,
		thermalFactor, coolingPower, platformMass, platformMin, platformMax, dryMass,
		platformPitchAt, platformBaseAt, platformPointAt, platformSurfaceAt, planeContactTime,
		chargePadMin, chargePadMax, onChargePad, charging,
		retentionNow, rockRetentionNow, ballMassNow, damageBonusNow, damageRadiusBonusNow, pulseNow, forceNow, speedNow, recoveryNow, conductanceNow, radiatorArea, applyMassChange,
		setPistonAngle, pistonContactTime, solvePiston, contactResult
	};
	root.SteamPhysics = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
