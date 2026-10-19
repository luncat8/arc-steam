(function (root) {
	'use strict';
	// Autopilot. Four switches over three duties: intercept the ball (a plain
	// chase, or a timed run that spends less energy), keep the bounce drive at the
	// energy the ball actually needs, and tilt the reflector so the next bounce
	// leaves straight up. Each duty temporarily yields to its matching manual command
	// without changing the enabled switches.
	//
	// The plan comes from the ballistic computer and is rebuilt 20 times a second
	// or whenever the ball's situation changes; the commands derived from it are
	// recomputed every simulation step against the live platform, so a prediction
	// stays cheap while the response stays exact. Nothing here allocates per step.
	const MOVE = 'move';
	const SMART = 'smart';
	const DRIVE = 'drive';
	const ANGLE = 'angle';
	const planInterval = 1 / 20;
	const overrideSeconds = 2;
	const overrides = { move: 0, drive: 0, angle: 0 };
	const held = { move: false, drive: false, angle: false };

	function duty(channel) { return channel === SMART ? MOVE : channel; }
	function suspended(channel) { return overrides[duty(channel)] > 0; }
	function override(channel) {
		const key = duty(channel);
		if (key === MOVE ? moveOn || smartOn : enabled(key)) overrides[key] = overrideSeconds;
	}
	function hold(channel, on) {
		const key = duty(channel);
		if (on || held[key]) override(key);
		held[key] = on;
	}
	function advanceOverride(channel, dt) {
		if (held[channel]) { override(channel); return; }
		if (overrides[channel] <= 0) return;
		overrides[channel] = Math.max(0, overrides[channel] - dt);
		if (overrides[channel] === 0) planAge = planInterval;
	}
	// The reflector face is 2.34 m wide, so an offset under a third of it does not
	// change the outcome; correcting it would cost more than it saves.
	const interceptTolerance = 0.4;
	// Arrival speed below which rolling through the mark is cheaper than stopping:
	// a reflector rolling this slowly still leaves the bounce to the tilt.
	const rollingArrival = 0.5;
	// Approach speed when there is no deadline to meet (a grounded ball, or a
	// rebound the ballistic computer will not promise): get there, stop there.
	const approachSpeed = 2.5;
	// Speed error the timed intercept leaves alone. Braking with a flywheel is
	// recuperated, so tracking is tight; without one every correction becomes
	// heat, so the platform is allowed to drift further before it pays for one.
	const trackedDeadband = 0.08;
	const coastingDeadband = 0.3;
	// Bisection of the ±10° tilt range: 20° / 2^12 is far finer than the actuator
	// can reach in a step, so the answer is the range limit, not the iteration count.
	const tiltIterations = 12;
	// Drive keeper band, in metres of apex. The pulse is a fixed chunk of energy,
	// so it is spent only when the passive bounce would fall short of the top of
	// the chamber; the margin stops the switch chattering at the threshold.
	const apexMargin = 0.25;

	let moveOn = false;
	let smartOn = false;
	let driveOn = false;
	let angleOn = false;

	// Cached plan, mutated in place.
	let planAge = planInterval;
	let seenState = '';
	let seenBounces = -1;
	let seenPushes = -1;
	let interceptX = NaN;
	let contactIn = 0;
	let contactVx = 0;
	let contactVy = 0;
	let contactY = 0;
	let contactOnPiston = false;
	let wantedDrive = true;
	let wantedAngle = 0;
	// One scratch is enough: every trial is read before the next one is solved.
	let trial = null;

	const state = Object.freeze({
		get move() { return moveOn; },
		get smart() { return smartOn; },
		get drive() { return driveOn; },
		get angle() { return angleOn; },
		get active() { return moveOn || smartOn || driveOn || angleOn; },
		// The live plan, so the panel can say what the autopilot is doing.
		get interceptX() { return interceptX; },
		get contactIn() { return contactIn; },
		get wantedDrive() { return wantedDrive; },
		get wantedAngle() { return wantedAngle; }
	});

	function enabled(channel) {
		if (channel === MOVE) return moveOn;
		if (channel === SMART) return smartOn;
		if (channel === DRIVE) return driveOn;
		return angleOn;
	}

	// The two intercept switches are one duty at two levels of care, so engaging
	// either clears the other instead of commanding travel twice.
	function set(channel, on) {
		const value = Boolean(on);
		if (channel === MOVE) { moveOn = value; if (value) smartOn = false; }
		else if (channel === SMART) { smartOn = value; if (value) moveOn = false; }
		else if (channel === DRIVE) driveOn = value;
		else angleOn = value;
		// A channel switched on acts on the next step, not on the next refresh.
		overrides[duty(channel)] = 0;
		if (value) planAge = planInterval;
		return value;
	}

	function toggle(channel) { set(channel, !enabled(channel)); }

	function reset() {
		overrides.move = overrides.drive = overrides.angle = 0;
		held.move = held.drive = held.angle = false;
		planAge = planInterval;
		interceptX = NaN;
		contactIn = 0;
		contactY = 0;
		contactOnPiston = false;
		seenState = '';
		seenBounces = -1;
		seenPushes = -1;
	}

	// Solve the cached upcoming contact with the simulation's own solver, so the
	// keepers trial exactly the impulses the bounce will apply.
	function solve(world, angle, push) {
		const physics = root.SteamPhysics;
		if (!trial) trial = physics.contactResult();
		return physics.solvePiston(world, contactVx, contactVy, angle, push, trial);
	}

	function stale(world) {
		return planAge >= planInterval || world.ball.state !== seenState
			|| world.bounces !== seenBounces || world.pushes !== seenPushes;
	}

	function clampTravel(x) {
		const physics = root.SteamPhysics;
		return Math.max(physics.platformMin(), Math.min(physics.platformMax(), x));
	}

	// Invert the terrain-following piston-centre offset to keep the target mark
	// under the face even when the chassis is pitched on a slope.
	function platformCentreForPiston(surfaceX) {
		const physics = root.SteamPhysics;
		const config = physics.config;
		let centreX = clampTravel(surfaceX - config.pistonCentre);
		for (let iteration = 0; iteration < 3; iteration++) {
			const angle = physics.platformPitchAt(centreX);
			const offsetX = Math.cos(angle) * config.pistonCentre - Math.sin(angle) * config.deck;
			centreX = clampTravel(centreX + surfaceX - (centreX + offsetX));
		}
		return centreX;
	}

	function replan(world) {
		planAge = 0;
		seenState = world.ball.state;
		seenBounces = world.bounces;
		seenPushes = world.pushes;
		contactOnPiston = false;
		contactIn = 0;
		contactY = 0;
		const ball = world.ball;
		// A grounded ball is a recovery, not an intercept: go and stand over it.
		if (ball.state === 'grounded') { interceptX = clampTravel(ball.x); return; }
		// A held ball has no flight to meet, so travel holds and coasts.
		if (ball.state !== 'flying') { interceptX = NaN; return; }
		const physics = root.SteamPhysics;
		const config = physics.config;
		const computer = root.SteamPrediction;
		const path = computer.predict(world);
		const kinds = computer.kinds;
		if (path.kind !== kinds.DECK && path.kind !== kinds.GROUND) {
			// Rock and horizon outcomes are unknown rebounds. Coasting would carry the
			// platform away from where the ball comes back down, so until the flight is
			// predictable again the mark tracks the ball itself, which is what a driver
			// watching an uncertain rebound does.
			interceptX = clampTravel(ball.x - config.pistonCentre);
			return;
		}
		// The reflector, not the collector, is what keeps the ball in play, so the
		// platform is commanded to put its face centre under the mark.
		interceptX = platformCentreForPiston(path.endX);
		contactVx = path.endVx;
		contactVy = path.endVy;
		contactY = path.endY;
		contactOnPiston = path.surface === computer.surfaces.PISTON;
		contactIn = path.time;
		if (path.kind !== kinds.GROUND) return;
		// A ground mark means nothing is under the ball yet; the save happens at
		// the platform's terrain-following deck height above the rubble surface.
		const pile = root.SteamCeiling ? root.SteamCeiling.floorAt(path.endX) : 0;
		const deckAngle = physics.platformPitchAt(interceptX);
		const deckBase = physics.platformBaseAt(interceptX, deckAngle);
		const deckHeight = deckBase + Math.sin(deckAngle) * config.pistonCentre + Math.cos(deckAngle) * config.deck;
		const deckSpeed = -Math.sqrt(Math.max(0, contactVy * contactVy - 2 * config.ballGravity * (deckHeight - pile)));
		contactIn = path.time - (deckSpeed - contactVy) / config.ballGravity;
		contactVy = deckSpeed;
		contactY = deckHeight + config.radius;
	}

	function commandTravel(world) {
		if (moveOn) {
			// The plain chase hands the mark to the platform's own target following:
			// full thrust to it, then a brake to a standstill on it.
			world.direction = 0;
			world.target = interceptX;
			return;
		}
		// The timed intercept owns the direction and never asks for a standstill it
		// does not need: a travel target would brake to zero and dump what is left
		// of the run as heat, whether or not a flywheel can take it back.
		world.target = NaN;
		const platform = world.platform;
		const distance = interceptX - platform.x;
		if (!Number.isFinite(distance)) { world.direction = 0; return; }
		const physics = root.SteamPhysics;
		const config = physics.config;
		const acceleration = config.force * world.forceSetting / physics.platformMass(world);
		// Offsets inside the reflector face do not change the outcome, so they are
		// not worth a manoeuvre: inside that slack the platform is left alone, which
		// is also why it never has to stand still on the mark.
		const reach = Math.abs(distance) - interceptTolerance;
		if (reach <= 0) { world.direction = 0; return; }
		const sign = Math.sign(distance);
		const speed = contactIn > 0 ? timedSpeed(reach, contactIn, acceleration)
			: Math.min(approachSpeed, Math.sqrt(2 * acceleration * reach));
		// Braking with a flywheel is recuperated, so tracking is tight; without one
		// every correction becomes heat and the platform is allowed to drift further
		// before it pays for one.
		const deadband = physics.recoveryNow() > 0 ? trackedDeadband : coastingDeadband;
		const demand = Math.max(-config.maxSpeed, Math.min(config.maxSpeed, sign * speed));
		world.direction = platform.vx < demand - deadband ? 1 : platform.vx > demand + deadband ? -1 : 0;
	}

	// The slowest run that is still on time. Rolling through the mark costs least,
	// but a moving reflector drags the ball sideways with it, so rolling is only
	// chosen while it is slow enough for the tilt keeper to hold the bounce
	// vertical. Otherwise the run spends the whole flight time: the peak speed of
	// an accelerate-coast-brake profile that stands still on the mark exactly when
	// the ball arrives, which is a fraction of the speed a rush-and-brake needs.
	// A mark that cannot be met and stopped for is met as fast as it can still be
	// braked out of, because being there beats arriving gently.
	function timedSpeed(reach, time, acceleration) {
		const roll = reach / time;
		const brake = Math.sqrt(2 * acceleration * reach);
		if (roll <= rollingArrival) return Math.min(roll, brake);
		const discriminant = acceleration * acceleration * time * time - 4 * acceleration * reach;
		if (discriminant <= 0) return Math.min(roll, brake);
		return (acceleration * time - Math.sqrt(discriminant)) * 0.5;
	}

	// Enough energy to reach the top of the chamber and no more. The pulse is a
	// fixed chunk, so spending it only when the passive bounce falls short bounds
	// the ball's apex at one pulse above the ceiling, where an always-on drive
	// would accelerate the ball every bounce until it is unplayably fast.
	function driveDecision(world) {
		// A held or grounded ball must stay launchable, so the drive is on.
		if (world.ball.state !== 'flying') return true;
		if (!contactOnPiston) return wantedDrive;
		const config = root.SteamPhysics.config;
		const bounce = solve(world, angleOn && !suspended(ANGLE) ? wantedAngle : world.pistonAngle, 0);
		const rise = Math.max(0, bounce.vy);
		const apex = contactY + rise * rise / (2 * config.ballGravity);
		const target = config.ceiling - config.radius;
		if (apex < target - apexMargin) return true;
		if (apex > target) return false;
		return wantedDrive;
	}

	function commandDrive(world) {
		wantedDrive = driveDecision(world);
		world.drive = wantedDrive;
		// A caught ball has no flight energy at all, so the keeper's own rule sends
		// it back up instead of letting the shift stall on a held ball.
		if (wantedDrive && world.ball.state === 'held') root.SteamPhysics.launch(world);
	}

	// The tilt that leaves the upcoming contact travelling straight up. Raising the
	// left edge sends the ball right and raising the right edge sends it left, so
	// the reflection's horizontal speed is monotonic in the tilt and the ±10° range
	// can be bisected. The pulse the drive keeper just decided is included, because
	// a powered push also leaves along the face normal. When no tilt in range
	// cancels the horizontal component — a fast platform, for instance — the closer
	// range limit is the best the actuator can do.
	function verticalTilt(world) {
		const physics = root.SteamPhysics;
		const push = world.drive ? physics.launchCapacity(world) : 0;
		const max = physics.config.pistonMaxAngle;
		let low = -max;
		let lowVx = solve(world, low, push).vx;
		const highVx = solve(world, max, push).vx;
		if (lowVx * highVx > 0) return Math.abs(lowVx) < Math.abs(highVx) ? low : max;
		let high = max;
		for (let iteration = 0; iteration < tiltIterations; iteration++) {
			const mid = (low + high) * 0.5;
			const midVx = solve(world, mid, push).vx;
			if (lowVx * midVx <= 0) high = mid;
			else { low = mid; lowVx = midVx; }
		}
		return (low + high) * 0.5;
	}

	// The tilt actuator slews at its own rate: an automatic correction arrives
	// during the flight instead of snapping the face under a falling ball.
	function commandTilt(world, dt) {
		if (contactOnPiston) wantedAngle = verticalTilt(world);
		const physics = root.SteamPhysics;
		const reach = physics.config.pistonSlewRate * dt;
		const delta = wantedAngle - world.pistonAngle;
		physics.setPistonAngle(world, Math.abs(delta) <= reach ? wantedAngle : world.pistonAngle + Math.sign(delta) * reach);
	}

	function update(world, dt) {
		advanceOverride(MOVE, dt);
		advanceOverride(DRIVE, dt);
		advanceOverride(ANGLE, dt);
		if (!(moveOn || smartOn || driveOn || angleOn)) return;
		planAge += dt;
		if (contactIn > 0) contactIn = Math.max(0, contactIn - dt);
		if (stale(world)) replan(world);
		if ((moveOn || smartOn) && !suspended(MOVE)) commandTravel(world);
		// The drive decision is priced with the tilt the angle keeper is holding,
		// and the tilt is solved with the drive state just decided.
		if (driveOn && !suspended(DRIVE)) commandDrive(world);
		if (angleOn && !suspended(ANGLE)) commandTilt(world, dt);
	}

	const api = { state, enabled, set, toggle, override, hold, suspended, overrideSeconds, reset, update, channels: Object.freeze({ MOVE, SMART, DRIVE, ANGLE }) };
	root.SteamAutopilot = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
