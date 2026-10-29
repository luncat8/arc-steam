(function (root) {
	'use strict';
	// Ballistic computer. Forward-integrates the passive ball flight with the same
	// gravity, wall, ceiling, deck and rock-trace rules as the simulation, into
	// preallocated buffers. Prediction never mutates the world and allocates
	// nothing per call, so the render loop can draw the cached path every frame
	// while it is recomputed at the slower readout cadence.
	// Cover a full deck-to-ceiling-to-deck flight at the tuned ball gravity.
	const horizon = 2 * Math.sqrt(2 * root.SteamPhysics.config.ceiling / root.SteamPhysics.config.ballGravity) + 1;
	const march = 1 / 100;
	const capacity = Math.ceil(horizon / march) + 2;
	const pathX = new Float64Array(capacity);
	const pathY = new Float64Array(capacity);
	const platformPose = { x: 0, y: 0, angle: 0 };
	const nextPlatformPose = { x: 0, y: 0, angle: 0 };
	const platformSurface = { x: 0, y: 0, angle: 0 };
	// Terminal outcomes. WALL and CEILING reflect and keep the march going, so
	// they never reach the caller as a kind.
	const NONE = 0;
	const DECK = 1;
	const GROUND = 2;
	const ROCK = 3;
	const TIMEOUT = 4;
	const PARKED = 5;
	const WALL = 6;
	const CEILING = 7;
	// Which platform surface the terminal deck contact lands on. The collector
	// catches and the reflector piston bounces, so an automatic keeper must know
	// whether the predicted contact is one it can shape.
	const NO_SURFACE = 0;
	const COLLECTOR = 1;
	const PISTON = 2;
	let samples = 0;
	let kind = NONE;
	let endX = 0;
	let endY = 0;
	let endVx = 0;
	let endVy = 0;
	let surface = NO_SURFACE;
	let endTime = 0;
	let uncertain = false;
	let ghostX = 0;
	let ghostY = 0;
	let ghostAngle = 0;
	let reachable = false;
	let gap = 0;

	const state = Object.freeze({
		pathX, pathY,
		get samples() { return samples; },
		get kind() { return kind; },
		get endX() { return endX; },
		get endY() { return endY; },
		// Ball velocity at the terminal contact, before the impact is resolved.
		get endVx() { return endVx; },
		get endVy() { return endVy; },
		get surface() { return surface; },
		get time() { return endTime; },
		get uncertain() { return uncertain; },
		get ghostX() { return ghostX; },
		get ghostY() { return ghostY; },
		get ghostAngle() { return ghostAngle; },
		get reachable() { return reachable; },
		// Metres of platform travel still missing from the intercept; <= 0 when the
		// landing can be met at full thrust.
		get gap() { return gap; }
	});

	// Descending crossing of a height, matching the simulation's own root choice.
	function crossing(y, vy, height, gravity) {
		const discriminant = vy * vy + 2 * gravity * (y - height);
		if (discriminant < 0) return Infinity;
		const time = (vy + Math.sqrt(discriminant)) / gravity;
		return time >= 0 ? time : Infinity;
	}

	function projectedPlatformPose(physics, platform, time, out) {
		const config = physics.config;
		const rawX = platform.x + platform.vx * time;
		out.x = Math.max(physics.platformMin(), Math.min(physics.platformMax(), rawX));
		const desiredAngle = physics.platformPitchAt(out.x);
		const turn = config.platformPitchRate * time;
		out.angle = platform.angle + Math.max(-turn, Math.min(turn, desiredAngle - platform.angle));
		const wantedY = physics.platformBaseAt(out.x, out.angle);
		out.y = Math.max(wantedY, platform.y - config.platformDropRate * time);
	}

	function predict(world) {
		const physics = root.SteamPhysics;
		const config = physics.config;
		const economy = root.SteamCeiling;
		const ball = world.ball;
		const platform = world.platform;
		samples = 0;
		kind = NONE;
		endX = ball.x;
		endY = ball.y;
		endVx = ball.vx;
		endVy = ball.vy;
		surface = NO_SURFACE;
		endTime = 0;
		uncertain = false;
		ghostX = platform.x;
		ghostY = platform.y;
		ghostAngle = platform.angle;
		reachable = false;
		gap = 0;
		if (ball.state !== 'flying') {
			kind = PARKED;
			return state;
		}
		const gravity = config.ballGravity;
		const retention = Math.sqrt(physics.retentionNow());
		// Rock contacts are only traced while the march can reach the layer, which
		// keeps the heightmap rebuild off the cheap low-flight marches.
		const rockReach = economy ? economy.state.bottom - config.radius - 0.5 : Infinity;
		let x = ball.x;
		let y = ball.y;
		let vx = ball.vx;
		let vy = ball.vy;
		let time = 0;
		pathX[0] = x;
		pathY[0] = y;
		samples = 1;
		while (time < horizon && samples < capacity - 1) {
			let step = march;
			let event = NONE;
			if (vx) {
				const wall = vx > 0 ? config.width - config.radius : config.radius;
				const wallTime = (wall - x) / vx;
				if (wallTime >= 0 && wallTime < step) { step = wallTime; event = WALL; }
			}
			if (vy > 0) {
				const discriminant = vy * vy - 2 * gravity * (config.ceiling - config.radius - y);
				if (discriminant >= 0) {
					const topTime = (vy - Math.sqrt(discriminant)) / gravity;
					if (topTime >= 0 && topTime < step) { step = topTime; event = CEILING; }
				}
			}
			// Ground is the rubble surface under the march, not the bare floor.
			const ground = (economy ? economy.floorAt(x) : 0) + config.radius;
			const groundTime = y < ground ? 0 : crossing(y, vy, ground, gravity);
			if (groundTime < step) { step = groundTime; event = GROUND; }
			// The coasting platform follows the terrain while its chassis pitch
			// slews at the live rate. Surface velocities include that tilt.
			projectedPlatformPose(physics, platform, time, platformPose);
			projectedPlatformPose(physics, platform, time + step, nextPlatformPose);
			const platformVx = step > 0 ? (nextPlatformPose.x - platformPose.x) / step : 0;
			const platformVy = step > 0 ? (nextPlatformPose.y - platformPose.y) / step : 0;
			const platformOmega = step > 0 ? (nextPlatformPose.angle - platformPose.angle) / step : 0;
			const collectorWidth = config.platformWidth * config.collectorFraction;
			const collectorCentre = -config.platformWidth * 0.5 + collectorWidth * 0.5;
			physics.platformPointAt(platformPose.x, platformPose.y, platformPose.angle, collectorCentre, config.deck, 0, platformSurface);
			let surfaceVx = platformVx - platformOmega * (platformSurface.y - platformPose.y);
			let surfaceVy = platformVy + platformOmega * (platformSurface.x - platformPose.x);
			const deckTime = physics.planeContactTime(x, y, vx, vy, platformSurface.x, platformSurface.y,
				surfaceVx, surfaceVy, platformSurface.angle, step, collectorWidth * 0.5);
			if (deckTime < step) { step = deckTime; event = DECK; surface = COLLECTOR; }
			physics.platformPointAt(platformPose.x, platformPose.y, platformPose.angle, config.pistonCentre, config.deck, world.pistonAngle, platformSurface);
			surfaceVx = platformVx - platformOmega * (platformSurface.y - platformPose.y);
			surfaceVy = platformVy + platformOmega * (platformSurface.x - platformPose.x);
			const pistonTime = physics.pistonContactTime(x, y, vx, vy, platformSurface.x, platformSurface.y,
				surfaceVx, surfaceVy, platformSurface.angle, step);
			if (pistonTime < step) { step = pistonTime; event = DECK; surface = PISTON; }
			let contactX = 0;
			let contactY = 0;
			if (economy && y + Math.max(0, vy) * step + config.radius > rockReach) {
				const hit = economy.trace(x, y, vx, vy, step, config.radius, gravity);
				// Rock wins over a deck contact found in the same march step, so the
				// surface it would have landed on is no longer the answer.
				if (hit.time < step) { step = hit.time; event = ROCK; surface = NO_SURFACE; contactX = hit.x; contactY = hit.y; }
			}
			x += vx * step;
			y += vy * step - 0.5 * gravity * step * step;
			vy -= gravity * step;
			time += step;
			if (event === WALL) vx = -vx;
			else if (event === CEILING) vy = -Math.abs(vy) * retention;
			else if (event !== NONE) {
				// Rock contacts end at the trace's own separated contact point, which
				// is where the simulation snaps the ball, so the mark and the impact agree.
				if (event === ROCK) { x = contactX; y = contactY; }
				kind = event;
				break;
			}
			pathX[samples] = x;
			pathY[samples] = y;
			samples++;
		}
		if (kind === NONE) kind = TIMEOUT;
		// Rock damage and an exhausted horizon both leave the outcome unknown, so
		// the overlay is flagged instead of promising a trajectory.
		uncertain = kind === ROCK || kind === TIMEOUT;
		endX = x;
		endY = y;
		endVx = vx;
		endVy = vy;
		endTime = time;
		pathX[samples] = x;
		pathY[samples] = y;
		samples++;
		projectedPlatformPose(physics, platform, time, platformPose);
		ghostX = platformPose.x;
		ghostY = platformPose.y;
		ghostAngle = platformPose.angle;
		// Intercept feasibility is a thrust bound, not a solved manoeuvre: the
		// platform accelerates at its current force setting to the speed limit and
		// then cruises for the rest of the flight time. Braking is not budgeted, so
		// a reachable mark means the landing can be met, not that coasting meets it.
		const acceleration = physics.forceNow() * world.forceSetting / physics.platformMass(world);
		const topSpeed = physics.speedNow();
		const ramp = Math.min(time, topSpeed / acceleration);
		const cover = 0.5 * acceleration * ramp * ramp + topSpeed * (time - ramp);
		gap = Math.abs(endX - platform.x) - cover;
		reachable = (kind === DECK || kind === GROUND) && gap <= 0;
		return state;
	}

	const api = {
		state, predict, horizon, march,
		kinds: Object.freeze({ NONE, DECK, GROUND, ROCK, TIMEOUT, PARKED }),
		surfaces: Object.freeze({ NONE: NO_SURFACE, COLLECTOR, PISTON })
	};
	root.SteamPrediction = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
