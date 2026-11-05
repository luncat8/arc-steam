(function (root) {
	'use strict';
	// Ballistic computer. Forward-integrates the passive ball flight with the same
	// gravity, wall, ceiling, deck and rock-trace rules as the simulation, into
	// preallocated buffers. Prediction never mutates the world and allocates
	// nothing per call, so the render loop can draw the cached path every frame
	// while it is recomputed at the slower readout cadence.
	//
	// The computer describes one machine and one ball: the platform the page has
	// selected and the ball that platform may push. The autopilot prices its own
	// plans with `predict(world, ball, 'rig')`, which is a different machine
	// whenever a competitor is selected, so the page's path and the plan's path
	// live in two separate traces. A keeper can never leave its own flight on the
	// overlay of a platform the player is looking at.
	// Cover a full deck-to-ceiling-to-deck flight at the tuned ball gravity.
	const horizon = 2 * Math.sqrt(2 * root.SteamPhysics.config.ceiling / root.SteamPhysics.config.ballGravity) + 1;
	const march = 1 / 100;
	const capacity = Math.ceil(horizon * 3 / march) + 100;
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

	// One trace: the drawn path, the terminal contact and the ghost of the
	// machine the path belongs to. Two of them exist — the page's and the
	// policy's — and both are written in place.
	function createTrace() {
		return {
			pathX: new Float64Array(capacity),
			pathY: new Float64Array(capacity),
			samples: 0, kind: NONE,
			endX: 0, endY: 0, endVx: 0, endVy: 0,
			surface: NO_SURFACE, time: 0, uncertain: false,
			ghostX: 0, ghostY: 0, ghostAngle: 0,
			reachable: false, gap: 0,
			id: 'rig', rig: true, ball: null
		};
	}
	const page = createTrace();
	const policy = createTrace();

	// The page's trace is the one the overlay, the labels and the controls read.
	const state = Object.freeze({
		pathX: page.pathX,
		pathY: page.pathY,
		get samples() { return page.samples; },
		get kind() { return page.kind; },
		get endX() { return page.endX; },
		get endY() { return page.endY; },
		// Ball velocity at the terminal contact, before the impact is resolved.
		get endVx() { return page.endVx; },
		get endVy() { return page.endVy; },
		get surface() { return page.surface; },
		get time() { return page.time; },
		get uncertain() { return page.uncertain; },
		get ghostX() { return page.ghostX; },
		get ghostY() { return page.ghostY; },
		get ghostAngle() { return page.ghostAngle; },
		get reachable() { return page.reachable; },
		// Metres of platform travel still missing from the intercept; <= 0 when the
		// landing can be met at full thrust.
		get gap() { return page.gap; }
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

	function playerList() {
		const players = root.SteamPlayers;
		return players && players.state ? players.state.players : null;
	}

	// The page's selection: the platform whose controls, computer and readouts
	// the player is looking at.
	function selectionId() {
		const list = playerList();
		if (!list || !list.length) return 'rig';
		return list[root.SteamPlayers.state.active].id;
	}

	// The body the computer describes: the one it is asked for, else the one the
	// page has selected, else the rig.
	function playerOf(world, id) {
		const list = playerList();
		if (!list || !list.length) return null;
		if (id !== undefined) {
			for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
		}
		return list[root.SteamPlayers.state.active] || list[0];
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
	function machineThrust(physics, world) {
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
	// never names a ball for the computer to draw the right flight. A ball held
	// by another platform is out of this machine's hands.
	function workingBall(world, id) {
		const physics = root.SteamPhysics;
		const balls = world.balls || [];
		let soonest = Infinity;
		let best = null;
		for (let i = 0; i < balls.length; i++) {
			const ball = balls[i];
			if (!physics.mayPush(ball, id)) continue;
			if (ball.state === 'held') {
				if ((ball.holder || world.platform.id) === id) return ball;
				continue;
			}
			if (!best) best = ball;
			if (ball.state !== 'flying') continue;
			const landing = crossing(ball.y, ball.vy, machine.y + physics.config.deck + physics.config.radius, physics.config.ballGravity);
			if (landing < soonest) { soonest = landing; best = ball; }
		}
		if (best) return best;
		const held = physics.heldBallOf(world, physics.machineById(world, id));
		return held || world.ball;
	}

	// What one step of the machine's face can deliver: the rig spends what its
	// reserve and its heat allow, a competitor its fixed deck charge.
	function machinePulse(physics, world, available) {
		if (!machine.drive) return 0;
		if (!machine.rig) return Math.min(available, physics.config.pulse);
		return Math.min(available, physics.pulseNow() * physics.thermalFactor(world));
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
		selectMachine(world, id);
		const ball = target || workingBall(world, machine.id);
		const platform = machine;
		const trace = id === undefined || id === selectionId() ? page : policy;
		const pathX = trace.pathX;
		const pathY = trace.pathY;
		trace.ball = ball;
		trace.id = machine.id;
		trace.rig = machine.rig;
		trace.samples = 0;
		trace.kind = NONE;
		trace.endX = ball.x;
		trace.endY = ball.y;
		trace.endVx = ball.vx;
		trace.endVy = ball.vy;
		trace.surface = NO_SURFACE;
		trace.time = 0;
		trace.uncertain = false;
		trace.ghostX = platform.x;
		trace.ghostY = platform.y;
		trace.ghostAngle = platform.angle;
		trace.reachable = false;
		trace.gap = 0;
		if (ball.state !== 'flying') {
			trace.kind = PARKED;
			return trace;
		}
		const extended = Boolean(root.SteamResearch && root.SteamResearch.state.predictionBounces);
		const limit = extended ? horizon * 3 : horizon;
		let crossedRock = false;
		let landingKind = NONE, landingX = 0, landingY = 0, landingVx = 0, landingVy = 0, landingTime = 0, landingSurface = NO_SURFACE;
		let landingUncertain = false;
		let available = machine.rig ? world.battery * physics.engineNow().efficiency : Infinity;
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
		let kind = NONE;
		let surface = NO_SURFACE;
		let samples = 1;
		pathX[0] = x;
		pathY[0] = y;
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
					const push = machinePulse(physics, world, available);
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
		pathX[samples] = x;
		pathY[samples] = y;
		samples++;
		if (extended && landingKind) {
			// The next deck/ground contact is the actionable landing. Rock strikes
			// before it add warning time without becoming bogus platform targets;
			// later simulated piston bounces stay in the drawn path but cannot feed
			// the autopilot's own future movement back into its current target.
			kind = landingKind; x = landingX; y = landingY; vx = landingVx; vy = landingVy;
			time = landingTime; surface = landingSurface;
		}
		// Rock damage and an exhausted horizon both leave the outcome unknown, so
		// the overlay is flagged instead of promising a trajectory.
		trace.uncertain = extended && landingKind
			? landingUncertain
			: crossedRock || kind === ROCK || kind === TIMEOUT;
		trace.kind = kind;
		trace.surface = surface;
		trace.samples = samples;
		trace.endX = x;
		trace.endY = y;
		trace.endVx = vx;
		trace.endVy = vy;
		trace.time = time;
		projectedPlatformPose(physics, time, platformPose);
		trace.ghostX = platformPose.x;
		trace.ghostY = platformPose.y;
		trace.ghostAngle = platformPose.angle;
		// Intercept feasibility is a thrust bound, not a solved manoeuvre: the
		// platform pushes at its current force setting towards the mark, from the
		// speed it already has, to the speed limit and then cruises for the rest of
		// the flight time. Braking is not budgeted, so a reachable mark means the
		// landing can be met, not that coasting meets it.
		const reach = machineThrust(physics, world);
		const distance = trace.endX - platform.x;
		const speed = Math.sign(distance) * platform.vx;
		const cover = physics.coverage(time, speed, reach.acceleration, reach.top);
		trace.gap = Math.abs(distance) - cover;
		trace.reachable = (kind === DECK || kind === GROUND) && trace.gap <= 0;
		return trace;
	}

	const api = {
		state, predict, horizon, march,
		// Which machine the drawn path belongs to, so the page's own labels and
		// highlights address the platform the computer is describing.
		get platformId() { return page.id; },
		get platformRig() { return page.rig; },
		// The ball this path belongs to, so a readout names the right flight.
		get ball() { return page.ball; },
		kinds: Object.freeze({ NONE, DECK, GROUND, ROCK, TIMEOUT, PARKED }),
		surfaces: Object.freeze({ NONE: NO_SURFACE, COLLECTOR, PISTON })
	};
	root.SteamPrediction = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
