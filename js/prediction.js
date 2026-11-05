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
	const capacity = Math.ceil(horizon * 3 / march) + 100;
	const pathX = new Float64Array(capacity);
	const pathY = new Float64Array(capacity);
	const platformPose = { x: 0, y: 0, angle: 0 };
	const nextPlatformPose = { x: 0, y: 0, angle: 0 };
	const platformSurface = { x: 0, y: 0, angle: 0 };
	const deckBounce = { vx: 0, vy: 0 };
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
	let pathBall = null;
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

	// The machine the computer describes: the body and the deck of one platform.
	// The page selects a platform and the computer follows it, so the rig's live
	// world platform and a competitor's own body are read into one record here
	// and nowhere else.
	const machine = { rig: true, id: 'rig', x: 0, y: 0, vx: 0, angle: 0, pistonAngle: 0, drive: false, force: 1 };
	const thrust = { acceleration: 0, top: 0 };

	// The body the computer describes: the one it is asked for, else the one the
	// page has selected, else the rig.
	function playerOf(world, id) {
		const players = root.SteamPlayers;
		const list = players && players.state ? players.state.players : null;
		if (!list || !list.length) return null;
		if (id !== undefined) {
			for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
		}
		return list[players.state.active] || list[0];
	}

	function selectMachine(world, id) {
		const player = playerOf(world, id);
		if (!player || player.kind === 'rig') {
			const platform = world.platform;
			machine.rig = true;
			machine.id = platform.id;
			machine.x = platform.x;
			machine.y = platform.y;
			machine.vx = platform.vx;
			machine.angle = platform.angle;
			machine.pistonAngle = world.pistonAngle;
			machine.drive = Boolean(world.drive);
			machine.force = world.forceSetting;
			return player;
		}
		machine.rig = false;
		machine.id = player.id;
		machine.x = player.x;
		machine.y = player.y;
		machine.vx = player.vx;
		machine.angle = player.angle;
		machine.pistonAngle = player.pistonAngle;
		machine.drive = Boolean(player.drive);
		machine.force = player.force;
		return player;
	}

	// What the machine can do: the rig's researched engine and loaded mass, or a
	// competitor's own power setting on its bare hull, which is the same rule its
	// controller drives by.
	function machineThrust(physics, world, player) {
		if (machine.rig) {
			thrust.acceleration = physics.forceNow() * world.forceSetting / physics.platformMass(world);
			thrust.top = physics.speedNow();
			return thrust;
		}
		const force = Math.max(0.1, machine.force);
		thrust.acceleration = physics.config.force / physics.config.platformMass * force;
		thrust.top = physics.config.maxSpeed * force;
		return thrust;
	}

	// The ball a machine works: the one it holds, then the ball landing soonest,
	// then a ball on the floor. Mirrors the simulation's own focus, so the page
	// never names a ball for the computer to draw the right flight.
	function workingBall(world, id) {
		const physics = root.SteamPhysics;
		const balls = world.balls || [];
		let soonest = Infinity;
		let best = null;
		for (let i = 0; i < balls.length; i++) {
			const ball = balls[i];
			if (!physics.mayPush(ball, id)) continue;
			if (ball.state === 'held') return ball;
			if (!best) best = ball;
			if (ball.state !== 'flying') continue;
			const landing = crossing(ball.y, ball.vy, machine.y + physics.config.deck + physics.config.radius, physics.config.ballGravity);
			if (landing < soonest) { soonest = landing; best = ball; }
		}
		return best || world.ball;
	}

	function projectedPlatformPose(physics, time, out) {
		const config = physics.config;
		const rawX = machine.x + machine.vx * time;
		out.x = Math.max(physics.platformMin(), Math.min(physics.platformMax(), rawX));
		const desiredAngle = physics.platformPitchAt(out.x, machine.id);
		const turn = config.platformPitchRate * time;
		out.angle = machine.angle + Math.max(-turn, Math.min(turn, desiredAngle - machine.angle));
		const wantedY = physics.platformBaseAt(out.x, out.angle, machine.id);
		out.y = Math.max(wantedY, machine.y - config.platformDropRate * time);
	}

	// `target` prices any ball of the chamber and `id` any platform's machine; the
	// page's overlay and readouts leave both out and get the selected platform and
	// the ball it works. The rig's own policy passes its id, because the platform
	// the page is looking at is not the platform that policy drives.
	function predict(world, target, id) {
		const physics = root.SteamPhysics;
		const config = physics.config;
		const economy = root.SteamCeiling;
		const player = selectMachine(world, id);
		const ball = target || workingBall(world, machine.id);
		const platform = machine;
		pathBall = ball;
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
		const extended = Boolean(root.SteamResearch && root.SteamResearch.state.predictionBounces);
		const limit = extended ? horizon * 3 : horizon;
		let crossedRock = false;
		let landingKind = NONE, landingX = 0, landingY = 0, landingVx = 0, landingVy = 0, landingTime = 0, landingSurface = NO_SURFACE;
		let landingUncertain = false;
		let available = world.battery * physics.engineNow().efficiency;
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
		while (time < limit && samples < capacity - 1) {
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
			projectedPlatformPose(physics, time, platformPose);
			projectedPlatformPose(physics, time + step, nextPlatformPose);
			const platformVx = step > 0 ? (nextPlatformPose.x - platformPose.x) / step : 0;
			const platformVy = step > 0 ? (nextPlatformPose.y - platformPose.y) / step : 0;
			const platformOmega = step > 0 ? (nextPlatformPose.angle - platformPose.angle) / step : 0;
			// The machine's two deck faces, at the spans the simulation uses: the flat
			// collector strip catches and the reflector bounces off its own tilt.
			const collectorWidth = config.platformWidth * config.collectorFraction;
			const collectorCentre = -config.platformWidth * 0.5 + collectorWidth * 0.5;
			physics.platformPointAt(platformPose.x, platformPose.y, platformPose.angle, collectorCentre, config.deck, 0, platformSurface);
			let surfaceVx = platformVx - platformOmega * (platformSurface.y - platformPose.y);
			let surfaceVy = platformVy + platformOmega * (platformSurface.x - platformPose.x);
			const deckTime = physics.planeContactTime(x, y, vx, vy, platformSurface.x, platformSurface.y,
				surfaceVx, surfaceVy, platformSurface.angle, step, collectorWidth * 0.5);
			if (deckTime < step) { step = deckTime; event = DECK; surface = COLLECTOR; }
			physics.platformPointAt(platformPose.x, platformPose.y, platformPose.angle, config.pistonCentre, config.deck, platform.pistonAngle, platformSurface);
			surfaceVx = platformVx - platformOmega * (platformSurface.y - platformPose.y);
			surfaceVy = platformVy + platformOmega * (platformSurface.x - platformPose.x);
			const pistonTime = physics.planeContactTime(x, y, vx, vy, platformSurface.x, platformSurface.y,
				surfaceVx, surfaceVy, platformSurface.angle, step, config.pistonHalf);
			if (pistonTime < step) { step = pistonTime; event = DECK; surface = PISTON; }
			let nx = 0, ny = -1;
			let contactX = 0;
			let contactY = 0;
			if (economy && y + Math.max(0, vy) * step + config.radius > rockReach) {
				const hit = economy.trace(x, y, vx, vy, step, config.radius, gravity);
				// Rock wins over a deck contact found in the same march step, so the
				// surface it would have landed on is no longer the answer.
				if (hit.time < step) { step = hit.time; event = ROCK; surface = NO_SURFACE; contactX = hit.x; contactY = hit.y; nx = hit.nx; ny = hit.ny; }
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
				if (event === ROCK) crossedRock = true;
				if (!landingKind && (event === GROUND || event === DECK)) {
					landingKind = event; landingX = x; landingY = y; landingVx = vx; landingVy = vy;
					landingTime = time; landingSurface = surface; landingUncertain = crossedRock;
				}
				// A catch ends the plan: the platform owns the ball from here. Only a
				// reflector bounce is worth continuing past, and only with tier II.
				if (!extended || event === GROUND || event === DECK && surface === COLLECTOR) break;
				pathX[samples] = x; pathY[samples] = y; samples++;
				if (event === ROCK) {
					const normal = vx * nx + vy * ny;
					if (normal < 0) { vx -= (1 + retention) * normal * nx; vy -= (1 + retention) * normal * ny; }
					x += nx * 0.0001; y += ny * 0.0001;
				} else if (surface === COLLECTOR) {
					// A collector holds the ball: the next contact would be a catch of
					// this platform, so the flight ends there either way.
					break;
				} else {
					// The reflector answers with the same bounce the simulation gives it:
					// this machine's face, its own tilt and its own drive.
					const push = machine.drive ? Math.min(available, physics.pulseNow() * physics.thermalFactor(world)) : 0;
					physics.deckBounce(vx, vy, platformSurface.angle, surfaceVx, surfaceVy, push, deckBounce);
					vx = deckBounce.vx; vy = deckBounce.vy;
					available -= push;
					x -= Math.sin(platformSurface.angle) * 0.0001;
					y += Math.cos(platformSurface.angle) * 0.0001;
				}
				time += 0.00001;
			}
			pathX[samples] = x;
			pathY[samples] = y;
			samples++;
		}
		if (kind === NONE) kind = TIMEOUT;
		// Rock damage and an exhausted horizon both leave the outcome unknown, so
		// the overlay is flagged instead of promising a trajectory.
		uncertain = crossedRock || kind === ROCK || kind === TIMEOUT;
		endX = x;
		endY = y;
		endVx = vx;
		endVy = vy;
		endTime = time;
		pathX[samples] = x;
		pathY[samples] = y;
		samples++;
		if (extended && landingKind) {
			// The next deck/ground contact is the actionable landing. Rock strikes
			// before it add warning time without becoming bogus platform targets;
			// later simulated piston bounces stay in the drawn path but cannot feed
			// the autopilot's own future movement back into its current target.
			kind = landingKind; endX = landingX; endY = landingY; endVx = landingVx; endVy = landingVy;
			endTime = landingTime; surface = landingSurface; time = landingTime;
			uncertain = landingUncertain;
		}
		projectedPlatformPose(physics, time, platformPose);
		ghostX = platformPose.x;
		ghostY = platformPose.y;
		ghostAngle = platformPose.angle;
		// Intercept feasibility is a thrust bound, not a solved manoeuvre: the
		// platform pushes at its current force setting towards the mark, from the
		// speed it already has, to the speed limit and then cruises for the rest of
		// the flight time. Braking is not budgeted, so a reachable mark means the
		// landing can be met, not that coasting meets it.
		const reach = machineThrust(physics, world, player);
		const distance = endX - platform.x;
		const speed = Math.sign(distance) * platform.vx;
		const cover = physics.coverage(time, speed, reach.acceleration, reach.top);
		gap = Math.abs(distance) - cover;
		reachable = (kind === DECK || kind === GROUND) && gap <= 0;
		return state;
	}

	const api = {
		state, predict, horizon, march,
		// Which machine the drawn path belongs to, so the page's own labels and
		// highlights address the platform the computer is describing.
		get platformId() { return machine.id; },
		get platformRig() { return machine.rig; },
		// The ball this path belongs to, so a readout names the right flight.
		get ball() { return pathBall; },
		kinds: Object.freeze({ NONE, DECK, GROUND, ROCK, TIMEOUT, PARKED }),
		surfaces: Object.freeze({ NONE: NO_SURFACE, COLLECTOR, PISTON })
	};
	root.SteamPrediction = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
