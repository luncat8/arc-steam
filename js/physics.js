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
		platformWheelHalfSpan: 1.3, platformWheelRadius: 0.18, platformBodyBottom: 0.2, platformBodyTop: 0.6,
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
		// Travel tuning shared by both bots: a mark with no deadline is approached
		// at this speed, and a mark met while rolling slower than the second is
		// passed through rather than stopped on.
		approachSpeed: 2.5, rollingArrival: 0.5,
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

	// The ground under a platform is the rock-and-rubble floor, the commercial
	// grader's low dome and every competitor platform's trapezoid body. Competitors
	// pass their own id so they never stand on their own 45° tails; the rig passes
	// 'rig', which no competitor uses.
	function platformGroundAt(x, exceptId) {
		let height = terrainHeight(x);
		if (root.SteamCeiling) height = Math.max(height, root.SteamCeiling.botSurfaceAt(x));
		if (root.SteamPlayers) height = Math.max(height, root.SteamPlayers.surfaceAt(x, exceptId));
		return height;
	}
	function platformPitchAt(x, exceptId) {
		const span = config.platformWheelHalfSpan;
		const rise = platformGroundAt(x + span, exceptId) - platformGroundAt(x - span, exceptId);
		return Math.max(-config.platformMaxPitch, Math.min(config.platformMaxPitch, Math.atan2(rise, span * 2)));
	}

	// The chassis origin puts both wheels on the ground under the lean, and never
	// lets the body under them sink into anything it is riding: the belly points
	// between the wheels are the same hull, so they can only raise the base.
	function platformBaseAt(x, angle, exceptId) {
		const cosine = Math.cos(angle);
		const sine = Math.sin(angle);
		const radius = config.platformWheelRadius;
		const span = config.platformWheelHalfSpan;
		const bodyBottom = config.platformBodyBottom;
		let height = 0;
		for (let sign = -1; sign <= 1; sign += 2) {
			const localX = sign * span;
			const groundX = x + localX * cosine - radius * sine;
			const required = platformGroundAt(groundX, exceptId) - localX * sine + radius - radius * cosine;
			height = Math.max(height, required);
		}
		const bellyHeight = Math.max(0, height);
		const halfWidth = config.platformWidth * 0.5;
		const cell = root.SteamCeiling ? root.SteamCeiling.state.cell : radius * 2;
		const sampleStep = Math.min(radius, cell * 0.5);
		for (let localX = -halfWidth; localX <= halfWidth; localX += sampleStep) {
			const groundX = x + localX * cosine - bodyBottom * sine;
			const required = platformGroundAt(groundX, exceptId) - localX * sine - bodyBottom * cosine;
			if (required > bellyHeight) height = Math.max(height, required);
		}
		return Math.max(0, height);
	}

	function settlePose(body, dt, exceptId) {
		const wantedAngle = platformPitchAt(body.x, exceptId);
		const turn = config.platformPitchRate * dt;
		// The lean and the base are one pose: the hull may not be driven down by a
		// pitch it cannot keep up with, so the slew is only taken as far as the
		// ground under the wheels allows while the hull falls at its own rate.
		const floor = body.previousY - config.platformDropRate * dt;
		let step = Math.max(-turn, Math.min(turn, wantedAngle - body.angle));
		body.angle += step;
		let wantedHeight = platformBaseAt(body.x, body.angle, exceptId);
		if (wantedHeight < floor) {
			for (let i = 0; i < 8; i++) {
				step *= 0.5;
				body.angle -= step;
				wantedHeight = platformBaseAt(body.x, body.angle, exceptId);
				if (wantedHeight >= floor) break;
			}
		}
		// Never pop up through a platform still sitting above us when the drive
		// order flips: rise onto a body above at the same rate as falling, so the
		// pair trade places smoothly instead of teleporting through each other.
		const players = root.SteamPlayers;
		if (players && wantedHeight > body.previousY) {
			const reach = config.platformWidth * 0.5 + (players.state.tailPlate || 0);
			for (let i = 0; i < players.state.players.length; i++) {
				const other = players.state.players[i];
				if (other.id === exceptId) continue;
				const above = other.kind === 'rig' ? players.state.world.platform : other;
				if (!Number.isFinite(above.y)) continue;
				if (Math.abs(body.x - above.x) >= reach) continue;
				if (above.y <= body.previousY) continue;
				wantedHeight = Math.min(wantedHeight, body.previousY + config.platformDropRate * dt);
			}
		}
		// Both directions are rate-limited: a wheel meeting a plate, or a hull
		// climbing one, moves the body like a machine and not like a jump.
		body.y = Math.max(Math.min(wantedHeight, body.previousY + config.platformDropRate * dt), body.previousY - config.platformDropRate * dt);
		body.stepVx = (body.x - body.previousX) / dt;
		body.stepVy = (body.y - body.previousY) / dt;
		body.stepOmega = (body.angle - body.previousAngle) / dt;
		body.vy = body.stepVy;
		body.omega = body.stepOmega;
	}

	function updatePlatformTerrain(world, dt) {
		settlePose(world.platform, dt, world.platform.id);
	}

	function platformPointAt(x, y, baseAngle, localX, localY, relativeAngle, out) {
		const cosine = Math.cos(baseAngle);
		const sine = Math.sin(baseAngle);
		out.x = x + cosine * localX - sine * localY;
		out.y = y + sine * localX + cosine * localY;
		out.angle = baseAngle + relativeAngle;
	}

	// A body's pose is prescribed by the terrain under it, so a boulder shoulder
	// can lift the deck by more in one step than any rate limit allows. That is
	// a pose correction, not motion: a ball must see the surface moving at most
	// at the body's own limits, or the contact solve injects unbounded energy.
	function clamp(value, limit) {
		return Math.max(-limit, Math.min(limit, value));
	}

	function bodySurfaceAt(body, elapsed, dt, localX, localY, relativeAngle, out) {
		const platform = body;
		const fraction = Math.max(0, Math.min(1, elapsed / dt));
		const x = platform.previousX + (platform.x - platform.previousX) * fraction;
		const y = platform.previousY + (platform.y - platform.previousY) * fraction;
		const angle = platform.previousAngle + (platform.angle - platform.previousAngle) * fraction;
		const cosine = Math.cos(angle);
		const sine = Math.sin(angle);
		const offsetX = cosine * localX - sine * localY;
		const offsetY = sine * localX + cosine * localY;
		const stepVx = clamp(platform.stepVx, speedNow());
		const stepVy = clamp(platform.stepVy, config.platformDropRate);
		const stepOmega = clamp(platform.stepOmega, config.platformPitchRate);
		out.x = x + offsetX;
		out.y = y + offsetY;
		out.vx = stepVx - stepOmega * offsetY;
		out.vy = stepVy + stepOmega * offsetX;
		out.angle = angle + relativeAngle;
	}

	function platformSurfaceAt(world, elapsed, dt, localX, localY, relativeAngle, out) {
		return bodySurfaceAt(world.platform, elapsed, dt, localX, localY, relativeAngle, out);
	}

	// Earliest time the ball centre comes within one radius of a moving face. The
	// ball is measured relative to the face, so the face's own motion is in both
	// the gap and the closing speed: a contact is only a contact while the face is
	// coming on the ball, and the quadratic's other root is the ball leaving the
	// face again. Taking that root was what made a descent read as a bounce a step
	// later — and let a fast ball step straight through the plane.
	function planeContactTime(x, y, vx, vy, centerX, centerY, centerVx, centerVy, angle, limit, halfExtent) {
		const nx = -Math.sin(angle);
		const ny = Math.cos(angle);
		const signed = nx * (x - centerX) + ny * (y - centerY) - config.radius;
		const a = -0.5 * config.ballGravity * ny;
		const b = nx * (vx - centerVx) + ny * (vy - centerVy);
		if (signed < -1e-9 && b >= 0) return Infinity;
		if (Math.abs(a) < 1e-12) {
			if (!(b < 0)) return Infinity;
			const flat = -signed / b;
			return flat >= -1e-10 && flat <= limit ? Math.max(0, flat) : Infinity;
		}
		const discriminant = b * b - 4 * a * signed;
		if (discriminant < 0) return Infinity;
		const root = Math.sqrt(discriminant);
		let time = (-b - root) / (2 * a);
		if (!(time >= -1e-10 && time <= limit && b + 2 * a * time < 0)) time = (-b + root) / (2 * a);
		if (!(time >= -1e-10 && time <= limit && b + 2 * a * time < 0)) return Infinity;
		time = Math.max(0, time);
		const contactX = x + vx * time;
		const contactY = y + vy * time - 0.5 * config.ballGravity * time * time;
		const faceX = centerX + centerVx * time;
		const faceY = centerY + centerVy * time;
		const foot = (contactX - faceX) * Math.cos(angle) + (contactY - faceY) * Math.sin(angle);
		if (Math.abs(foot) <= halfExtent) return time;
		// A face only blocks inside its span, so a descent just outside it passes on.
		// The hull under the face is the body's own solid stop, solved separately.
		return Infinity;
	}

	// A body's deck as the machine it is: a collector face that catches and a
	// reflector face that bounces, in the deck plane, on the body's own frame.
	// Every platform has both, so the rig and a competitor answer a ball with the
	// same geometry and the same solver.
	const SURFACE_NONE = 0;
	const SURFACE_COLLECTOR = 1;
	const SURFACE_PISTON = 2;
	const deckContact = { time: Infinity, surface: SURFACE_NONE, x: 0, y: 0, vx: 0, vy: 0, angle: 0 };
	const deckResult = { vx: 0, vy: 0 };
	const faceSurface = { x: 0, y: 0, vx: 0, vy: 0, angle: 0 };

	// A ball only touches the face it reaches first. The faces share the deck
	// plane, so a hit at a given time is assigned by its foot along the deck: the
	// collector where the strip is, the piston where the reflector is, the solid
	// hull in the gap between them. Solved separately, two faces at the same
	// height would hand the contact back and forth between steps.
	const hullSurface = { x: 0, y: 0, vx: 0, vy: 0, angle: 0 };
	const pitchedFace = { x: 0, y: 0, vx: 0, vy: 0, angle: 0 };
	function deckFaceOf(foot) {
		const collectorWidth = config.platformWidth * config.collectorFraction;
		const collectorMin = -config.platformWidth * 0.5;
		if (foot >= collectorMin && foot <= collectorMin + collectorWidth) return SURFACE_COLLECTOR;
		if (foot >= config.pistonCentre - config.pistonHalf && foot <= config.pistonCentre + config.pistonHalf) return SURFACE_PISTON;
		return SURFACE_NONE;
	}

	function solveDeck(body, elapsed, dt, x, y, vx, vy, limit, pistonAngle) {
		deckContact.time = Infinity;
		deckContact.surface = SURFACE_NONE;
		if (!(limit > 0)) return deckContact;
		// The two faces of the deck abut on the deck plane and each answers only
		// inside its own span, so a contact always belongs to exactly one of them.
		// The collector is flat and carries the ball; the reflector is the plane
		// its own tilt describes, and it bounces.
		const collectorWidth = config.platformWidth * config.collectorFraction;
		const collectorCentre = -config.platformWidth * 0.5 + collectorWidth * 0.5;
		bodySurfaceAt(body, elapsed, dt, collectorCentre, config.deck, 0, hullSurface);
		let time = planeContactTime(x, y, vx, vy, hullSurface.x, hullSurface.y,
			hullSurface.vx, hullSurface.vy, hullSurface.angle, limit, collectorWidth * 0.5);
		if (time < Infinity) {
			deckContact.time = time;
			deckContact.surface = SURFACE_COLLECTOR;
			deckContact.x = hullSurface.x;
			deckContact.y = hullSurface.y;
			deckContact.vx = hullSurface.vx;
			deckContact.vy = hullSurface.vy;
			deckContact.angle = hullSurface.angle;
		}
		bodySurfaceAt(body, elapsed, dt, config.pistonCentre, config.deck, pistonAngle, pitchedFace);
		time = planeContactTime(x, y, vx, vy, pitchedFace.x, pitchedFace.y,
			pitchedFace.vx, pitchedFace.vy, pitchedFace.angle, deckContact.time, config.pistonHalf);
		if (time < deckContact.time) {
			deckContact.time = time;
			deckContact.surface = SURFACE_PISTON;
			deckContact.x = pitchedFace.x;
			deckContact.y = pitchedFace.y;
			deckContact.vx = pitchedFace.vx;
			deckContact.vy = pitchedFace.vy;
			deckContact.angle = pitchedFace.angle;
		}
		return deckContact;
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
	const bodySurfaceScratch = { x: 0, y: 0, vx: 0, vy: 0, angle: 0 };

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
	// The speed a platform commands to cover `reach` metres: the slowest run
	// that still arrives in `time` seconds, or a gentle approach when no
	// deadline is due. The rig's travel controller and a competitor's own policy
	// both brake into their mark with this rule, so neither rushes a mark it
	// cannot stop on. Rolling through the mark costs least, but a moving deck
	// drags the ball sideways with it, so rolling is only chosen while it is slow
	// enough to steer; otherwise the run spends the whole flight time on the peak
	// speed of an accelerate-coast-brake profile that stands still on arrival.
	function arrivalSpeed(reach, time, acceleration) {
		const brake = Math.sqrt(2 * acceleration * reach);
		if (!(time > 0)) return Math.min(config.approachSpeed, brake);
		const roll = reach / time;
		if (roll <= config.rollingArrival) return Math.min(roll, brake);
		const discriminant = acceleration * acceleration * time * time - 4 * acceleration * reach;
		if (discriminant <= 0) return Math.min(roll, brake);
		return (acceleration * time - Math.sqrt(discriminant)) * 0.5;
	}

	// Platform travel model shared by the ballistic computer and the intercept
	// policy: full thrust from the speed the platform already has towards the
	// mark, up to the speed limit, then cruise. Braking is not budgeted, so
	// `coverage` is the reach of an optimistic manoeuvre and `travelTime` the
	// earliest arrival at a mark it must not stop on.
	function coverage(time, speed, acceleration, topSpeed) {
		if (!(time > 0)) return 0;
		const start = Math.min(speed, topSpeed);
		const ramp = Math.max(0, (topSpeed - start) / acceleration);
		if (time <= ramp) return start * time + 0.5 * acceleration * time * time;
		return start * ramp + 0.5 * acceleration * ramp * ramp + topSpeed * (time - ramp);
	}

	function travelTime(distance, speed, acceleration, topSpeed) {
		if (!(distance > 0)) return 0;
		const start = Math.min(speed, topSpeed);
		const ramp = Math.max(0, (topSpeed - start) / acceleration);
		const ramped = start * ramp + 0.5 * acceleration * ramp * ramp;
		// Below the ramped distance the manoeuvre is still accelerating, so the
		// arrival is the quadratic's positive root.
		if (distance < ramped) return (Math.sqrt(start * start + 2 * acceleration * distance) - start) / acceleration;
		return ramp + (distance - ramped) / topSpeed;
	}

	// Earliest arrival at a mark stopped, from rest: the peak of an
	// accelerate-brake triangle, capped by a cruise at the speed limit.
	function restStopTime(distance, acceleration, topSpeed) {
		const peak = Math.sqrt(acceleration * distance);
		if (peak <= topSpeed) return 2 * peak / acceleration;
		return 2 * topSpeed / acceleration + (distance - topSpeed * topSpeed / acceleration) / topSpeed;
	}

	// Earliest arrival at a mark with no speed left over, from the signed speed
	// already carried towards it. This is the manoeuvre both intercept
	// controllers actually fly — the timed run brakes onto its mark and the
	// chase's target follower brakes onto its target — so a mark is only
	// reachable in a flight time when this fits inside it, where the passing
	// `travelTime` above can promise a mark up to √2 sooner than either can
	// stop on it. Rolling away is braked first and the drift paid for; rolling
	// too fast for the mark brakes past it and comes back, which is dearer than
	// passing through, again as it should be.
	function stopTime(distance, speed, acceleration, topSpeed) {
		if (!(distance > 0)) return 0;
		if (!(acceleration > 0)) return Infinity;
		const start = Math.max(-topSpeed, Math.min(topSpeed, speed));
		if (start < 0) return -start / acceleration + restStopTime(distance + start * start / (2 * acceleration), acceleration, topSpeed);
		const brakeDistance = start * start / (2 * acceleration);
		if (distance < brakeDistance) return start / acceleration + restStopTime(brakeDistance - distance, acceleration, topSpeed);
		const peak = Math.sqrt(acceleration * distance + start * start * 0.5);
		if (peak <= topSpeed) return (2 * peak - start) / acceleration;
		const cruise = distance - (2 * topSpeed * topSpeed - start * start) / (2 * acceleration);
		return (topSpeed - start) / acceleration + cruise / topSpeed + topSpeed / acceleration;
	}

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

	// ---------------------------------------------------------------- balls
	// A ball is either shared (no owner) or owned by one platform. Ownership is
	// the only rule that decides which platform may push it, so a platform never
	// sees a ball it may not touch.
	function makeBall(owner, x, y, vx, vy) {
		return { owner, x, y, vx, vy, state: 'flying' };
	}

	function isRigBall(ball) { return !ball.owner || ball.owner === 'rig'; }

	function mayPush(ball, id) { return !ball.owner || ball.owner === id; }

	function rivalBodies() {
		return root.SteamPlayers && root.SteamPlayers.state ? root.SteamPlayers.state.rivals : [];
	}

	// Rebuilds the chamber's balls for the chosen arrangement. The rig keeps its
	// machinery on every ball it may push; a competitor owns its own ball and is
	// handed it here, at its current position.
	function setBallMode(world, mode, anchors) {
		const list = [];
		const speed = 1.2 * config.ballSpeedScale;
		if (mode === 'each') {
			list.push(makeBall('rig', 12.8, 5, speed, 0));
			const placed = anchors || [];
			for (let i = 0; i < placed.length; i++) {
				const x = Math.max(config.radius, Math.min(config.width - config.radius, placed[i].x + 1.4));
				list.push(makeBall(placed[i].id, x, 6, -speed, 0));
			}
		} else if (mode === 'shared2') {
			list.push(makeBall(null, 12.8, 5, speed, 0));
			list.push(makeBall(null, 7, 7, -speed, 0));
		} else {
			mode = 'shared1';
			list.push(makeBall(null, 12.8, 5, speed, 0));
		}
		world.balls = list;
		world.ballMode = mode;
		// A re-seated arrangement drops the intercept's chosen ball with it.
		world.focus = null;
		world.bounces = 0;
		world.pushes = 0;
		world.groundings = 0;
		// world.ball stays the rig's ball of the moment, so prediction, the
		// autopilot and the readouts keep reading one ball in every mode.
		if (!Object.getOwnPropertyDescriptor(world, 'ball')) {
			Object.defineProperty(world, 'ball', {
				enumerable: true,
				configurable: true,
				get: function () { return focusBall(this); }
			});
		}
		return list;
	}

	// When the ball next descends to a height, from its current flight.
	function ballLandingTime(ball, height) {
		const discriminant = ball.vy * ball.vy + 2 * config.ballGravity * (ball.y - height);
		if (discriminant < 0) return Infinity;
		const time = (ball.vy + Math.sqrt(discriminant)) / config.ballGravity;
		return time >= 0 ? time : Infinity;
	}

	// The rig holds at most one ball at a time.
	function heldBall(world) {
		const balls = world.balls || [];
		for (let i = 0; i < balls.length; i++) if (balls[i].state === 'held') return balls[i];
		return null;
	}

	// The rig's ball of the moment: the one it holds, then the ball its intercept
	// policy chose, else the one whose landing is soonest, so a two-ball game
	// never splits the plan. The policy choice is a hint, honoured only while it
	// is still a rig ball in the list.
	function focusBall(world) {
		const balls = world.balls || [];
		for (let i = 0; i < balls.length; i++) if (balls[i].state === 'held') return balls[i];
		const chosen = world.focus;
		if (chosen && isRigBall(chosen)) {
			for (let i = 0; i < balls.length; i++) if (balls[i] === chosen) return chosen;
		}
		let best = null;
		let bestTime = Infinity;
		for (let i = 0; i < balls.length; i++) {
			const ball = balls[i];
			if (!isRigBall(ball)) continue;
			if (!best) best = ball;
			if (ball.state !== 'flying') continue;
			const time = ballLandingTime(ball, config.deck);
			if (time < bestTime) { bestTime = time; best = ball; }
		}
		return best;
	}

	function heldBallMass(world) {
		const balls = world.balls || [];
		let mass = 0;
		for (let i = 0; i < balls.length; i++) if (balls[i].state === 'held') mass += ballMassNow();
		return mass;
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
			platform: { id: 'rig', x: 12, y: 0, vx: 0, vy: 0, angle: 0, omega: 0, spin: 0, previousX: 12, previousY: 0, previousAngle: 0, stepVx: 0, stepVy: 0, stepOmega: 0 },
			balls: [], ballMode: 'shared1', focus: null,
			bounces: 0, pushes: 0, lastPush: 0, groundings: 0, sales: 0, lastSale: 0
		};
		setBallMode(world, 'shared1', []);
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
		return dryMass() + cargoMass() + heldBallMass(world);
	}

	// Imported (bought) energy is subtracted and exported (sold, cooled) energy is
	// added, so the balance stays exact across both directions of trade.
	function totalEnergy(world) {
		const ceilingEnergy = root.SteamCeiling ? root.SteamCeiling.state.energy : 0;
		// Only the rig's own balls are in the rig's ledger: a competitor's ball is
		// outside it exactly like the commercial grader's blade.
		const balls = world.balls || [];
		let ballEnergyTotal = 0;
		for (let i = 0; i < balls.length; i++) if (isRigBall(balls[i])) ballEnergyTotal += ballEnergy(balls[i]);
		return world.battery + world.heat + world.cooledEnergy + world.fractureEnergy - world.importedEnergy - world.terrainWork + ceilingEnergy + ballEnergyTotal + 0.5 * platformMass(world) * world.platform.vx * world.platform.vx;
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

	function setHeldBallPose(world, ball) {
		const platform = world.platform;
		const localX = -config.platformWidth * 0.32;
		const localY = config.deck + config.radius;
		const cosine = Math.cos(platform.angle);
		const sine = Math.sin(platform.angle);
		ball.x = platform.x + cosine * localX - sine * localY;
		ball.y = platform.y + sine * localX + cosine * localY;
	}

	function capture(world, ball) {
		const platform = world.platform;
		const carriedMass = dryMass() + cargoMass();
		const before = ballEnergy(ball) + 0.5 * carriedMass * platform.vx * platform.vx;
		platform.vx = (carriedMass * platform.vx + ballMassNow() * ball.vx) / (carriedMass + ballMassNow());
		ball.state = 'held';
		ball.vx = 0;
		ball.vy = 0;
		setHeldBallPose(world, ball);
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

	function canLaunch(world, target) {
		const ball = target || world.ball;
		if (!ball || ball.state !== 'held' || !world.drive) return false;
		return launchCapacity(world) > ballMassNow() * config.ballGravity * launchHeight(world);
	}

	// The machine's release: the ball leaves the reflector face along its own
	// tilt, at the speed the pulse pays for. `machine` is the platform that holds
	// it — the world for the rig, the competitor's own body and tilt for it.
	// A competitor's release is its own: its pulse is the fixed deck charge and
	// its machinery is not in the rig's ledger, so only the rig's release spends
	// the reserve and heats the chamber.
	function launch(world, target, machine) {
		if (!canLaunch(world, target)) return false;
		const ball = target || world.ball;
		const body = machine || world;
		const rig = body === world;
		const platform = rig ? world.platform : body;
		const energy = rig ? spend(world, pulseNow() * thermalFactor(world)) : config.pulse;
		const height = launchHeight(world);
		const baseAngle = platform.angle;
		const faceAngle = baseAngle + (rig ? world.pistonAngle : body.pistonAngle);
		const along = config.platformWidth * 0.25 - config.pistonCentre;
		const centreX = platform.x + Math.cos(baseAngle) * config.pistonCentre - Math.sin(baseAngle) * config.deck;
		const centreY = platform.y + Math.sin(baseAngle) * config.pistonCentre + Math.cos(baseAngle) * config.deck;
		ball.x = centreX + Math.cos(faceAngle) * along - Math.sin(faceAngle) * config.radius;
		ball.y = centreY + Math.sin(faceAngle) * along + Math.cos(faceAngle) * config.radius;
		ball.vx = platform.vx;
		ball.vy = Math.sqrt(2 * (energy - ballMassNow() * config.ballGravity * height) / ballMassNow());
		ball.state = 'flying';
		if (!rig) return true;
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

	function passiveImpact(world, ball, nx, ny, fracture) {
		const normalVelocity = ball.vx * nx + ball.vy * ny;
		if (normalVelocity >= 0) return;
		const retention = retentionNow();
		const lost = 0.5 * ballMassNow() * normalVelocity * normalVelocity * (1 - retention);
		const spentOnRock = Math.min(lost, fracture || 0);
		const impulseVelocity = (1 + Math.sqrt(retention)) * normalVelocity;
		// A competitor's ball is outside the rig's ledger, so only a rig ball has
		// its losses booked; the velocity change applies to every ball.
		if (isRigBall(ball)) {
			world.fractureEnergy += spentOnRock;
			world.heat += lost - spentOnRock;
		}
		ball.vx -= impulseVelocity * nx;
		ball.vy -= impulseVelocity * ny;
	}
	function rockPassiveImpact(world, ball, nx, ny, fracture) {
		const normalVelocity = ball.vx * nx + ball.vy * ny;
		if (normalVelocity >= 0) return;
		const retention = rockRetentionNow();
		const lost = 0.5 * ballMassNow() * normalVelocity * normalVelocity * (1 - retention);
		const spentOnRock = Math.min(lost, fracture || 0);
		const impulseVelocity = (1 + Math.sqrt(retention)) * normalVelocity;
		if (isRigBall(ball)) {
			world.fractureEnergy += spentOnRock;
			world.heat += lost - spentOnRock;
		}
		ball.vx -= impulseVelocity * nx;
		ball.vy -= impulseVelocity * ny;
	}

	// The deck bounce itself, with no ledger: passive retention, a share of the
	// deck's tangential motion and the deck's own pulse. The simulation and the
	// ballistic computer share it, so a predicted deck contact is the one the
	// ball will really get.
	function deckBounce(ballVx, ballVy, angle, surfaceVx, surfaceVy, pulse, out) {
		const nx = -Math.sin(angle);
		const ny = Math.cos(angle);
		const relativeVx = ballVx - surfaceVx;
		const relativeVy = ballVy - surfaceVy;
		const impact = -(relativeVx * nx + relativeVy * ny);
		out.vx = ballVx;
		out.vy = ballVy;
		if (impact <= 0) return false;
		const restitution = Math.sqrt(retentionNow());
		let vx = ballVx + (1 + restitution) * impact * nx;
		let vy = ballVy + (1 + restitution) * impact * ny;
		// The deck carries the ball a little: a third of the relative tangent.
		const tx = ny;
		const ty = -nx;
		const tangent = relativeVx * tx + relativeVy * ty;
		vx -= tangent * 0.35 * tx;
		vy -= tangent * 0.35 * ty;
		if (pulse > 0 && impact > 0.05) {
			const normal = vx * nx + vy * ny;
			const boosted = Math.sqrt(normal * normal + 2 * pulse / ballMassNow());
			vx += (boosted - normal) * nx;
			vy += (boosted - normal) * ny;
		}
		// A deck that absorbed the contact must not hold the ball: a face angled
		// away from the ball's arrival leaves it travelling into the body, so it is
		// returned along the deck normal instead.
		if (vx * nx + vy * ny < 0.05) {
			const speed = Math.hypot(vx, vy) * Math.sqrt(retentionNow());
			vx = nx * speed;
			vy = ny * speed;
		}
		out.vx = vx;
		out.vy = vy;
		return true;
	}

	// A ball bouncing off a deck: the pure bounce above, booked. The competitor
	// is outside the rig's ledger, so only what a rig-pushable ball gains or
	// loses on it is, as heat or as imported work.
	function bounceOnDeck(world, ball, angle, surfaceVx, surfaceVy, pulse) {
		const before = 0.5 * ballMassNow() * (ball.vx * ball.vx + ball.vy * ball.vy);
		if (!deckBounce(ball.vx, ball.vy, angle, surfaceVx, surfaceVy, pulse, deckResult)) return false;
		ball.vx = deckResult.vx;
		ball.vy = deckResult.vy;
		if (isRigBall(ball)) {
			const after = 0.5 * ballMassNow() * (ball.vx * ball.vx + ball.vy * ball.vy);
			if (after < before) world.heat += before - after;
			else world.importedEnergy += after - before;
		}
		return true;
	}

	// A grounded ball under a competitor is scooped back up with one pulse: the
	// competitor's version of the rig's catch, without a collector. The lift and
	// the pulse come from outside the rig, so a ball that is in the rig's ledger
	// books them as imported energy, exactly like the deck pulses above.
	function scoop(world, ball) {
		const rivals = rivalBodies();
		for (let i = 0; i < rivals.length; i++) {
			const rival = rivals[i];
			if (!mayPush(ball, rival.id)) continue;
			if (Math.abs(ball.x - rival.x) > config.platformWidth * 0.5) continue;
			if (!rival.pulse) continue;
			const before = ballEnergy(ball);
			ball.state = 'flying';
			ball.x = rival.x;
			ball.y = rival.y + config.deck + config.radius + 0.01;
			ball.vx = rival.vx;
			ball.vy = Math.sqrt(2 * config.pulse / ballMassNow());
			if (isRigBall(ball)) world.importedEnergy += ballEnergy(ball) - before;
			return true;
		}
		return false;
	}

	// The chassis under the deck plane. Every deck contact is solved on that one
	// plane already, so the body is the second, lower plane that stops a ball
	// which somehow reaches the chassis top — its underside a deck below the
	// faces — instead of letting it into the machine.
	function hullContact(body, elapsed, dt, ball, limit) {
		bodySurfaceAt(body, elapsed, dt, 0, config.platformBodyTop, 0, hullSurface);
		return planeContactTime(ball.x, ball.y, ball.vx, ball.vy, hullSurface.x, hullSurface.y,
			hullSurface.vx, hullSurface.vy, hullSurface.angle, limit, config.platformWidth * 0.5);
	}

	// A bouncer that still travels into the body it just left is lifted to the
	// deck surface along that body's own normal: no deck face, however it is
	// angled, can pass a ball through it.
	function depenetrate(world, ball, body) {
		const cosine = Math.cos(body.angle);
		const sine = Math.sin(body.angle);
		if (ball.vx * -sine + ball.vy * cosine > -0.01) return;
		const localY = -(ball.x - body.x) * sine + (ball.y - body.y) * cosine;
		const surface = config.deck + config.radius;
		if (localY >= surface) return;
		const push = surface - localY;
		ball.x -= push * sine;
		ball.y += push * cosine;
		// The lift is work by the body, so a rig ball books it like terrain work.
		if (isRigBall(ball)) world.terrainWork += ballMassNow() * config.ballGravity * push * cosine;
	}

	function advanceBall(world, ball, dt) {
		const rigBall = isRigBall(ball);
		if (ball.state === 'held') {
			setHeldBallPose(world, ball);
			return;
		}
		if (ball.state === 'grounded') {
			// The rubble surface under a resting ball can still move (a fresh
			// deposit, a grader cut): re-seat on it so the ball is neither
			// buried nor left floating. Settling down dissipates as heat;
			// being lifted is work by the prescribed terrain.
			const rest = terrainHeight(ball.x) + config.radius;
			const delta = ballMassNow() * config.ballGravity * (rest - ball.y);
			if (rigBall) {
				if (delta > 0) world.terrainWork += delta;
				else world.heat -= delta;
			}
			ball.y = rest;
			// The rig catches a ball it lies under unless it already holds one; a
			// competitor pushes its ball back up by driving over it.
			if (rigBall && !heldBall(world) && Math.abs(ball.x - world.platform.x) <= config.platformWidth * 0.5) capture(world, ball);
			else scoop(world, ball);
			return;
		}
		let remaining = dt;
		let elapsed = 0;
		let rockImpulse = false;
		for (let event = 0; event < 12 && remaining > 1e-10; event++) {
			let time = remaining;
			let type = 0;
			let catchBody = null;
			let rockNx = 0;
			let rockNy = 0;
			let rockX = 0;
			let rockY = 0;
			let faceAngle = 0;
			let faceVx = 0;
			let faceVy = 0;
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
			// Every machine answers with the same deck: a collector face that
			// catches and a reflector face that bounces, and the solid hull under
			// them. The ownership rule decides which machines the ball sees at all,
			// so a ball a platform may not push passes through it untouched.
			if (rigBall) {
				solveDeck(world.platform, elapsed, dt, ball.x, ball.y, ball.vx, ball.vy, remaining, world.pistonAngle);
				if (deckContact.time < time) {
					time = deckContact.time;
					type = deckContact.surface === SURFACE_COLLECTOR ? 4 : 6;
					faceAngle = deckContact.angle;
					faceVx = deckContact.vx;
					faceVy = deckContact.vy;
				}
				const hullTime = hullContact(world.platform, elapsed, dt, ball, time);
				if (hullTime < time) {
					time = hullTime;
					type = 7;
					faceAngle = hullSurface.angle;
					faceVx = hullSurface.vx;
					faceVy = hullSurface.vy;
				}
			}
			const rivals = rivalBodies();
			for (let i = 0; i < rivals.length; i++) {
				const rival = rivals[i];
				if (!mayPush(ball, rival.id)) continue;
				solveDeck(rival, elapsed, dt, ball.x, ball.y, ball.vx, ball.vy, time, rival.pistonAngle);
				if (deckContact.time < time) {
					time = deckContact.time;
					type = deckContact.surface === SURFACE_COLLECTOR ? 8 : 9;
					catchBody = rival;
					faceAngle = deckContact.angle;
					faceVx = deckContact.vx;
					faceVy = deckContact.vy;
				}
				const hullTime = hullContact(rival, elapsed, dt, ball, time);
				if (hullTime < time) {
					time = hullTime;
					type = 7;
					catchBody = rival;
					faceAngle = hullSurface.angle;
					faceVx = hullSurface.vx;
					faceVy = hullSurface.vy;
				}
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
				if (rigBall) world.heat += ballEnergy(ball) - ballMassNow() * config.ballGravity * rest;
				ball.y = rest + config.radius;
				ball.vx = 0;
				ball.vy = 0;
				ball.state = 'grounded';
				if (rigBall) world.groundings++;
				return;
			}
			if (type === 3) {
				passiveImpact(world, ball, 0, -1, 0);
				continue;
			}
			if (type === 5) {
				// Contact position is exact (separated to radius), so the ball
				// cannot sit inside the surface between events. The snap's
				// potential change is booked so the energy ledger stays exact.
				if (rigBall) world.heat += ballMassNow() * config.ballGravity * (ball.y - rockY);
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
					rockPassiveImpact(world, ball, rockNx, rockNy, fracture);
					rockImpulse = true;
				}
				continue;
			}
			// One machine model for every deck. The flat faces — the collector strip
			// and the solid hull — are a deck bounce; the reflector is the machine's
			// piston, which the rig answers with its sprung solver and a competitor
			// with the same deck bounce off its own tilted face. A competitor's
			// pulse comes from its own drive and its machinery stays outside the
			// rig's ledger, so a shared ball's gain is booked as imported.
			if (type === 6) {
				const push = world.drive ? spend(world, pulseNow() * thermalFactor(world)) : 0;
				solvePiston(world, ball.vx, ball.vy, faceAngle - world.platform.angle, 0, contact, faceVx, faceVy);
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
				if (push > 0) solvePiston(world, ball.vx, ball.vy, faceAngle - world.platform.angle, push, contact, faceVx, faceVy);
				world.bounces++;
				world.lastPush = push;
				if (push > 0) world.pushes++;
				ball.vx = contact.vx;
				ball.vy = contact.vy;
				world.platform.vx = contact.platformVx;
				if (contact.captured) { capture(world, ball); return; }
				continue;
			}
			if (type === 7) {
				bounceOnDeck(world, ball, faceAngle, faceVx, faceVy, 0);
				continue;
			}
			if (type === 9) {
				// A competitor's machinery is outside the rig's ledger; bounceOnDeck
				// books a rig ball's gain from it as imported work.
				bounceOnDeck(world, ball, faceAngle, faceVx, faceVy, catchBody.drive || catchBody.pulse ? config.pulse : 0);
				depenetrate(world, ball, catchBody);
				continue;
			}
			// The flat collector strips. The rig's holds the ball; a competitor's
			// returns it — its catch is the deck bounce, with its own drive.
			if (type === 8) {
				bounceOnDeck(world, ball, faceAngle, faceVx, faceVy, catchBody.drive || catchBody.pulse ? config.pulse : 0);
				depenetrate(world, ball, catchBody);
				continue;
			}
			// Type 4 is the rig's own collector: it holds the ball, unless another
			// ball is already held — then it returns it like a deck.
			if (heldBall(world)) {
				bounceOnDeck(world, ball, faceAngle, faceVx, faceVy, 0);
				continue;
			}
			capture(world, ball);
			return;
		}
	}

	function step(world, dt) {
		movePlatform(world, dt);
		const balls = world.balls;
		for (let i = 0; i < balls.length; i++) advanceBall(world, balls[i], dt);
		advancePiston(world, dt);
		charge(world, dt);
		if (root.SteamCeiling) {
			const heldMass = heldBallMass(world);
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
		retentionNow, rockRetentionNow, ballMassNow, damageBonusNow, damageRadiusBonusNow, pulseNow, forceNow, speedNow, arrivalSpeed, coverage, travelTime, stopTime, recoveryNow, conductanceNow, radiatorArea, applyMassChange,
		settlePose, setPistonAngle, pistonContactTime, solvePiston, contactResult, deckBounce,
		setBallMode, mayPush, isRigBall, ballLandingTime, focusBall, heldBall, heldBallMass
	};
	root.SteamPhysics = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
