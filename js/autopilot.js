(function (root) {
	'use strict';
	// Autopilot. Four switches over three duties: intercept the ball (a plain
	// chase, or a timed run that spends less energy), keep the bounce drive at the
	// energy the ball actually needs, and tilt the reflector so the next bounce
	// leaves straight up. Each duty temporarily yields to its matching manual command
	// without changing the enabled switches.
	//
	// The intercept works one ball at a time, and with two shared balls that is a
	// decision of its own: every ball the rig may push is priced by whether the
	// platform can be under its mark inside the flight, by whether it can be
	// stopped on the mark inside the flight or only cross it at speed, and
	// by whether working it first still leaves the next landing reachable,
	// so of two landings that cannot both be kept a desperate cross-chamber
	// rush never takes the plan from a keep the rig can stop on. The plan
	// comes from the ballistic computer and is rebuilt 20 times a second or
	// whenever the ball's situation changes; the commands derived from it are
	// recomputed every simulation step against the live platform, so a
	// prediction stays cheap while the response stays exact. Nothing here
	// allocates per step.
	const MOVE = 'move';
	const SMART = 'smart';
	const DRIVE = 'drive';
	const ANGLE = 'angle';
	const planInterval = 1 / 20;
	const overrideSeconds = 2;
	// The ball the intercept works is re-chosen at this cadence: a landing becomes
	// the better choice over whole seconds, not over frames.
	const selectInterval = 1 / 4;
	// Seconds of control time a rival ball must offer before the plan is given up,
	// mirrored from the competitor bot's own commitment so two balls never make a
	// platform dither between them.
	const switchMargin = 0.6;
	// A landing the rig can still meet keeps its ball in play; a recovery puts it
	// back in play only after it has been lost. So the two are not priced against
	// each other at all: a recovery can always wait where it landed, and giving up
	// a landing pays a grounding plus the drive it could have skipped.
	const MEET = 0;
	const RECOVER = 1;
	// Inside a recovery, a landing out of reach still costs the grounding it could
	// not prevent, and an uncertain trajectory promises no landing at all.
	const recoveryPenalty = 0.35;
	const uncertainPenalty = 1;
	// A landing that only the edge of the reflector can be under in time is
	// still a keep, but a centre keep is worth this much travel over it: the
	// edge has no margin left for the prediction to be wrong by.
	const edgePenalty = 0.35;
	// A shared ball a rival platform is already close to is a fight the rig
	// will probably lose, and a long trip to it costs the energy a near ball
	// could have been worked with instead. Past this trip length (metres of
	// travel beyond the reflector slack) the rival's head start is priced in
	// seconds, growing with the trip and with how much of it the rival has
	// already covered; past `contestThreshold` seconds of it the ball counts
	// as contested, and a contested long trip never takes the plan from an
	// uncontested keep, however the landing order falls. An owned ball is
	// nobody else's to take, so it is never contested.
	const longTrip = 4;
	const contestThreshold = 1;
	// Clear air a stand-off point keeps beyond the face half-width, so a grounded
	// ball is never inside the machine's column while the rig waits out the heat.
	const standOffMargin = 0.3;
	// Headroom over the bare lift the rig waits for before it works a grounded
	// ball: the drive back to it costs heat of its own, and a release that only
	// just balances the ball would be refused again on arrival.
	const releaseMargin = 1.2;
	const overrides = { move: 0, drive: 0, angle: 0 };
	const held = { move: false, drive: false, angle: false };

	function duty(channel) { return channel === SMART ? MOVE : channel; }
	function suspended(channel) { return overrides[duty(channel)] > 0; }
	function override(channel) {
		const key = duty(channel);
		if (key === MOVE ? moveOn || smartOn : enabled(key)) overrides[key] = overrideSeconds;
	}
	// A service trip relinquishes only the duty it borrowed, never a hand hold.
	function resume(channel) {
		const key = duty(channel);
		if (held[key]) return;
		overrides[key] = 0;
		planAge = planInterval;
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
	// Speed error the timed intercept leaves alone. Braking with a flywheel is
	// recuperated, so tracking is tight; without one every correction becomes
	// heat, so the platform is allowed to drift further before it pays for one.
	const trackedDeadband = 0.08;
	const coastingDeadband = 0.3;
	// Bisection of the ±10° tilt range: 20° / 2^12 is far finer than the actuator
	// can reach in a step, so the answer is the range limit, not the iteration count.
	const tiltIterations = 12;
	// Drive keeper band, in metres of apex below the strike line. The pulse is
	// a fixed chunk of energy, so it is spent only when the passive bounce would
	// fall short of a full strike on the rock; the margin stops the switch
	// chattering at the threshold.
	const apexMargin = 0.25;

	let moveOn = false;
	let smartOn = false;
	let driveOn = false;
	let angleOn = false;

	// One plan of one ball, mutated in place: the mark the platform must put its
	// reflector face on, the deadline, the contact the keepers price, and the
	// outcome tier and control cost the selection compares.
	// `arrival` is when the platform can be under the mark, `effort` the
	// stopped-arrival travel the selection compares between keeps that save
	// the same landings, and `kept` the landings a schedule starting with
	// this ball still keeps, filled in by `select`.
	function blankPlan(out) {
		out.ball = null;
		out.interceptX = NaN;
		out.contactIn = 0;
		out.contactVx = 0;
		out.contactVy = 0;
		out.contactY = 0;
		out.contactOnPiston = false;
		out.recovering = false;
		out.uncertain = false;
		out.tier = RECOVER;
		out.cost = Infinity;
		out.arrival = Infinity;
		out.effort = Infinity;
		out.edge = false;
		out.kept = 0;
		out.counted = false;
		out.contest = 0;
		return out;
	}
	const plan = blankPlan({});
	// One priced plan per ball in the chamber, grown once to the ball count and
	// reused by every selection: pricing a ball overwrites the shared ballistic
	// computer, so the pair of landings can only be compared from records kept
	// side by side.
	const candidatePool = [];
	// The landing chain a schedule keeps after its first ball, mutated in place.
	const chain = { kept: 0, endX: 0 };

	// Cached plan age and the ball situation it was built for.
	let planAge = planInterval;
	let focusAge = selectInterval;
	let seenBall = null;
	let seenState = '';
	let seenBounces = -1;
	let seenPushes = -1;
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
		get focus() { return plan.ball; },
		get interceptX() { return plan.interceptX; },
		get contactIn() { return plan.contactIn; },
		// A landing this plan cannot meet: the ball will ground and be collected.
		get recovering() { return plan.recovering; },
		// The stopped arrival on the mark fits inside the flight: the landing
		// will be met, at the centre or only at the reflector's edge.
		get reachable() { return Boolean(plan.ball) && plan.tier === MEET && !plan.recovering; },
		get edge() { return plan.edge; },
		// No landing predicted at all (rock strike, horizon); the ball is shadowed.
		get uncertain() { return plan.uncertain; },
		// Seconds of rival head start priced into the plan's trip, and whether
		// that prices the ball as contested: a long trip a nearer rival is
		// already set to win.
		get contest() { return plan.contest; },
		get contested() { return plan.contest > contestThreshold; },
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
		// A channel switched on acts on the next step, not on the next refresh, and
		// picks its ball before it plans for it.
		overrides[duty(channel)] = 0;
		if (value) { planAge = planInterval; focusAge = selectInterval; }
		return value;
	}

	function toggle(channel) { set(channel, !enabled(channel)); }

	function reset() {
		overrides.move = overrides.drive = overrides.angle = 0;
		held.move = held.drive = held.angle = false;
		planAge = planInterval;
		focusAge = selectInterval;
		seenBall = null;
		seenState = '';
		seenBounces = -1;
		seenPushes = -1;
		plan.ball = null;
		plan.interceptX = NaN;
		plan.contactIn = 0;
		plan.contactOnPiston = false;
		plan.recovering = false;
		plan.uncertain = false;
		plan.edge = false;
		plan.contest = 0;
	}

	// Solve the cached upcoming contact with the simulation's own solver, so the
	// keepers trial exactly the impulses the bounce will apply.
	function solve(world, angle, push) {
		const physics = root.SteamPhysics;
		if (!trial) trial = physics.contactResult();
		return physics.solvePiston(world, plan.contactVx, plan.contactVy, angle, push, trial);
	}

	function stale(world) {
		// A different ball is a different flight: with two shared balls the plan
		// belongs to the one it was made for, so a focus change replans at once.
		// A ball a competitor caught leaves the rig with none at all.
		const ball = world.ball;
		return planAge >= planInterval || ball !== seenBall
			|| (ball ? ball.state : '') !== seenState
			|| world.bounces !== seenBounces || world.pushes !== seenPushes;
	}

	function clampTravel(x) {
		const physics = root.SteamPhysics;
		return Math.max(physics.platformMin(), Math.min(physics.platformMax(), x));
	}

	function accelerationOf(world) {
		const physics = root.SteamPhysics;
		return physics.forceNow() * world.forceSetting / physics.platformMass(world);
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

	// Seconds to bring the platform onto a mark it does not have to stop for on
	// time: the economical controller's own profile — accelerate to the approach
	// pace, cruise, brake at the mark — so a recovery is priced at the pace it is
	// actually driven at rather than at the chase's optimistic rush.
	function pacingTime(reach, acceleration) {
		if (!(reach > 0)) return 0;
		const pace = root.SteamPhysics.config.approachSpeed;
		const peak = Math.sqrt(2 * acceleration * reach);
		if (peak <= pace) return 2 * peak / acceleration;
		return reach / pace + pace / acceleration;
	}

	// Seconds of head start a nearer rival has on a shared ball's mark, priced
	// only once the rig's own trip is a long one: the longer the trip and the
	// larger the share of it the rival has already covered, the dearer the
	// trip. Measured centre to centre, since every platform puts the same
	// reflector under the same mark. Zero when no rival is closer, when the
	// trip is short enough to fight for cheaply, or when the ball is owned.
	function contestPenalty(world, ball, markX) {
		if (!ball || ball.owner) return 0;
		const physics = root.SteamPhysics;
		const rigReach = Math.max(0, Math.abs(markX - world.platform.x) - interceptTolerance);
		const excess = rigReach - longTrip;
		if (!(excess > 0)) return 0;
		let rivalReach = Infinity;
		const machines = physics.machinesOf(world);
		for (let i = 0; i < machines.length; i++) {
			const body = physics.machineBody(machines[i]);
			if (body.id === world.platform.id) continue;
			rivalReach = Math.min(rivalReach, Math.max(0, Math.abs(markX - body.x) - interceptTolerance));
		}
		if (!(rivalReach < rigReach)) return 0;
		return excess / physics.config.approachSpeed * (rigReach - rivalReach) / rigReach;
	}

	// The mark, the deadline and the control cost of one ball. A landing the
	// platform can cover in the time it has is an intercept with that deadline,
	// the only outcome that keeps the ball in play. Everything else is a recovery:
	// the ball grounds, so there is no deadline left to rush at, and the drive to
	// where it comes down is the whole plan. The selection and the cached plan
	// both read this, so the ball that is chosen is priced exactly as the ball
	// that is worked.
	function planBall(world, ball, out) {
		const physics = root.SteamPhysics;
		const config = physics.config;
		out.ball = ball;
		out.interceptX = NaN;
		out.contactIn = 0;
		out.contactOnPiston = false;
		out.recovering = false;
		out.uncertain = false;
		out.tier = MEET;
		out.arrival = Infinity;
		out.effort = Infinity;
		out.edge = false;
		out.kept = 0;
		out.contest = 0;
		// A held ball is already under control and has no flight to meet.
		out.cost = 0;
		out.effort = 0;
		out.arrival = 0;
		if (ball.state === 'held') return out;
		const acceleration = accelerationOf(world);
		// A grounded ball is a recovery, not an intercept: go and stand over it.
		if (ball.state === 'grounded') {
			out.interceptX = clampTravel(ball.x);
			out.tier = RECOVER;
			out.recovering = true;
			out.contest = contestPenalty(world, ball, out.interceptX);
			out.cost = pacingTime(Math.abs(ball.x - world.platform.x) - interceptTolerance, acceleration) + out.contest;
			out.effort = out.cost;
			return out;
		}
		const computer = root.SteamPrediction;
		// The rig's own duty predicts the rig, whichever platform the page has
		// selected: the computer the player reads is not this plan's.
		const path = computer.predict(world, ball, 'rig');
		const kinds = computer.kinds;
		if (path.kind !== kinds.DECK && path.kind !== kinds.GROUND) {
			// An uncertain or unfinished trajectory has no landing to meet. Track
			// the visible ball until the computer finds one; a rock strike itself is
			// not a platform target. Tier II normally continues through that strike
			// and supplies the later landing while the ball is still rising.
			out.interceptX = clampTravel(ball.x - config.pistonCentre);
			out.tier = RECOVER;
			out.uncertain = true;
			out.recovering = true;
			out.contest = contestPenalty(world, ball, out.interceptX);
			out.cost = Math.max(path.time, pacingTime(Math.abs(out.interceptX - world.platform.x) - interceptTolerance, acceleration)) + uncertainPenalty + out.contest;
			out.effort = out.cost;
			return out;
		}
		// The reflector, not the collector, is what keeps the ball in play, so the
		// platform is commanded to put its face centre under the mark.
		out.interceptX = platformCentreForPiston(path.endX);
		out.contactVx = path.endVx;
		out.contactVy = path.endVy;
		out.contactY = path.endY;
		out.contactOnPiston = path.surface === computer.surfaces.PISTON;
		out.contactIn = path.time;
		if (path.kind === kinds.GROUND) {
			// A ground mark means nothing is under the ball yet; the save happens at
			// the platform's terrain-following deck height above the rubble surface.
			const pile = root.SteamCeiling ? root.SteamCeiling.floorAt(path.endX) : 0;
			const deckAngle = physics.platformPitchAt(out.interceptX);
			const deckBase = physics.platformBaseAt(out.interceptX, deckAngle);
			const deckHeight = deckBase + Math.sin(deckAngle) * config.pistonCentre + Math.cos(deckAngle) * config.deck;
			const deckSpeed = -Math.sqrt(Math.max(0, path.endVy * path.endVy - 2 * config.ballGravity * (deckHeight - pile)));
			out.contactIn = path.time - (deckSpeed - path.endVy) / config.ballGravity;
			out.contactVy = deckSpeed;
			out.contactY = deckHeight + physics.ballRadiusAt(deckHeight);
		}
		// Feasibility is measured against the face mark, from the speed the
		// platform already carries towards it: the platform must be under the
		// ball when it arrives, though it may still be moving then — a rolling
		// contact is a real bounce, and the tilt keeper squares it. The travel
		// it costs is priced separately, as the stopped arrival: a mark that
		// can only be crossed at full speed leaves the rig spent and out of
		// position for the other ball, so between two landings that save the
		// same balls the one it can stop on is the one worth working.
		const distance = out.interceptX - world.platform.x;
		const reach = Math.abs(distance) - interceptTolerance;
		const towards = Math.sign(distance) * world.platform.vx;
		out.contest = contestPenalty(world, ball, out.interceptX);
		out.arrival = physics.travelTime(reach, towards, acceleration, physics.speedNow());
		out.effort = physics.stopTime(reach, towards, acceleration, physics.speedNow()) + out.contest;
		if (out.arrival <= out.contactIn) {
			out.cost = out.contactIn;
			return out;
		}
		// The centre cannot be there in time, but the face might: a landing
		// the edge of the reflector can still be under is kept, priced dearer
		// than a centre keep because nothing is left for the prediction to be
		// wrong by.
		const edgeReach = Math.abs(distance) - config.pistonHalf;
		if (physics.travelTime(edgeReach, towards, acceleration, physics.speedNow()) <= out.contactIn) {
			out.cost = out.contactIn;
			out.effort = physics.stopTime(edgeReach, towards, acceleration, physics.speedNow()) + edgePenalty + out.contest;
			out.edge = true;
			return out;
		}
		// Out of reach even at the edge, so nothing about this flight is
		// promised: the ball grounds where it falls and is collected there.
		// The plan keeps the landing mark and its deadline — that is where
		// the ball will lie, and getting there fast is still the quickest
		// collection — but it is priced as the pickup it will probably
		// become, with the grounding it could not prevent, so the selection
		// only spends that run when no landing can be kept instead.
		out.tier = RECOVER;
		out.recovering = true;
		out.cost = Math.max(out.contactIn, pacingTime(reach, acceleration)) + recoveryPenalty + out.contest;
		out.effort = out.cost;
		return out;
	}

	// The landings a schedule still keeps after starting at a mark and a time,
	// taking the rest in landing order from rest on each mark — a neutral
	// start, since a keep can leave the platform stopped or rolling either
	// way. Candidates already accounted for are marked `counted` by the
	// caller. Written into the shared `chain` record; `kept` counts only the
	// landings after the starting one.
	function chainAfter(world, count, startX, startTime) {
		const physics = root.SteamPhysics;
		const acceleration = accelerationOf(world);
		chain.kept = 0;
		chain.endX = startX;
		let time = startTime;
		for (;;) {
			let next = -1;
			for (let i = 0; i < count; i++) {
				const entry = candidatePool[i];
				if (entry.counted || entry.tier !== MEET || entry.ball.state === 'held') continue;
				if (entry.contactIn <= time) continue;
				if (next < 0 || entry.contactIn < candidatePool[next].contactIn) next = i;
			}
			if (next < 0) return chain;
			const entry = candidatePool[next];
			entry.counted = true;
			// A landing a nearer rival is already set to take is not a keep
			// this schedule can bank on: it neither counts nor moves the
			// platform, so the chain prices the landings after it from the
			// mark the platform actually holds.
			if (entry.contest > contestThreshold) continue;
			const reach = Math.abs(entry.interceptX - chain.endX) - interceptTolerance;
			if (physics.travelTime(reach, 0, acceleration, physics.speedNow()) > entry.contactIn - time) continue;
			chain.kept++;
			chain.endX = entry.interceptX;
			time = entry.contactIn;
		}
	}

	// Choose the ball worth working. A landing that can be kept beats any
	// recovery, because a recovery costs nothing by waiting; among keeps, a
	// schedule that keeps the next landing too beats one that spends the
	// flight making it unreachable, and a keep the rig can stop on beats a
	// desperate one it can only cross at speed — that crossing is what
	// drags it out of position for the other ball — while keeps of the same
	// kind are worked in landing order. The ball already in the plan keeps
	// the switch margin within its tier, so two flights never split the
	// intercept between them. The choice is published as a world hint, so
	// prediction, the overlay, the keepers and the readouts read the same
	// ball as the plan does.
	function select(world) {
		const physics = root.SteamPhysics;
		const balls = world.balls || [];
		while (candidatePool.length < balls.length) candidatePool.push(blankPlan({}));
		let count = 0;
		let priced = null;
		for (let i = 0; i < balls.length; i++) {
			const ball = balls[i];
			if (!physics.isRigBall(ball)) continue;
			planBall(world, ball, candidatePool[count]);
			priced = ball;
			count++;
		}
		// How many landings a schedule starting with each ball still keeps.
		for (let i = 0; i < count; i++) {
			const entry = candidatePool[i];
			entry.kept = 0;
			if (entry.tier !== MEET || entry.ball.state === 'held') continue;
			for (let j = 0; j < count; j++) candidatePool[j].counted = j === i;
			entry.kept = 1 + chainAfter(world, count, entry.interceptX, entry.contactIn).kept;
		}
		let bestMeet = -1;
		for (let i = 0; i < count; i++) {
			const entry = candidatePool[i];
			if (entry.tier !== MEET || entry.ball.state === 'held') continue;
			if (bestMeet < 0) { bestMeet = i; continue; }
			const best = candidatePool[bestMeet];
			// A contested long trip is a fight a nearer rival is set to win:
			// the energy is kept for an uncontested keep instead, and the
			// contested ball is fought for afterwards from wherever that
			// keep leaves the platform. Only when every keep is contested
			// (or none is) does the rest of the pricing decide.
			const contested = entry.contest > contestThreshold ? 1 : 0;
			const bestContested = best.contest > contestThreshold ? 1 : 0;
			if (contested !== bestContested) { if (contested < bestContested) bestMeet = i; continue; }
			if (entry.kept !== best.kept) { if (entry.kept > best.kept) bestMeet = i; continue; }
			// A keep is desperate when the platform can only cross its mark at
			// speed — the stopped arrival does not fit the flight, or only the
			// reflector's edge fits at all.
			const desperate = entry.edge || entry.effort > entry.contactIn ? 1 : 0;
			const bestDesperate = best.edge || best.effort > best.contactIn ? 1 : 0;
			if (desperate !== bestDesperate) { if (desperate < bestDesperate) bestMeet = i; continue; }
			const contact = entry.ball === plan.ball ? entry.contactIn - switchMargin : entry.contactIn;
			const bestContact = best.ball === plan.ball ? best.contactIn - switchMargin : best.contactIn;
			if (contact < bestContact || (contact === bestContact && entry.effort < best.effort)) bestMeet = i;
		}
		let chosen = bestMeet;
		if (chosen < 0) {
			// No landing can be kept: work the ball that is under control
			// soonest, with a held ball — already under control — first.
			let bestTier = Infinity;
			let bestCost = Infinity;
			for (let i = 0; i < count; i++) {
				const entry = candidatePool[i];
				const cost = entry.ball === plan.ball ? entry.cost - switchMargin : entry.cost;
				if (entry.tier < bestTier || (entry.tier === bestTier && cost < bestCost)) {
					chosen = i;
					bestTier = entry.tier;
					bestCost = cost;
				}
			}
		}
		const best = chosen >= 0 ? candidatePool[chosen].ball : null;
		if (world.focus !== best) world.focus = best;
		// The plan's own flight is priced by the policy trace of the computer, so
		// the overlay of the platform the player is looking at is never replaced.
		if (best && best !== priced) root.SteamPrediction.predict(world, best, 'rig');
	}

	function replan(world) {
		const ball = world.ball;
		planAge = 0;
		seenBall = ball;
		seenState = ball ? ball.state : '';
		seenBounces = world.bounces;
		seenPushes = world.pushes;
		if (ball) planBall(world, ball, plan);
		else blankPlan(plan);
	}

	// Where the rig waits while no ball can be released: the charge pad in the
	// middle, moved off the column of a grounded ball so the face never stands
	// over a ball it would only scoop up and have to sit on.
	function standOffTarget(world) {
		const physics = root.SteamPhysics;
		const config = physics.config;
		const centre = config.width * 0.5;
		const ball = plan.ball;
		if (!ball || ball.state !== 'grounded') return clampTravel(centre);
		const span = config.platformWidth * 0.5 + standOffMargin;
		if (Math.abs(ball.x - centre) > span) return clampTravel(centre);
		return clampTravel(ball.x + (ball.x < centre ? span : -span));
	}

	function commandTravel(world) {
		const physics = root.SteamPhysics;
		// A ball only goes back in the air by a pulse, so a refused release makes a
		// collection pointless: the rig waits out the heat on the pad instead of
		// driving onto a grounded ball it cannot lift. A ball already held rides
		// along and is released the moment the tank allows it, and a ball still in
		// flight is kept in play, because catching it costs nothing and the landing
		// is the only chance to keep working it.
		const ball = plan.ball;
		if (!physics.releaseReady(world, null, releaseMargin) && ball && ball.state !== 'flying') {
			world.direction = 0;
			world.target = standOffTarget(world);
			return;
		}
		const tierTwo = root.SteamResearch.state.predictionBounces;
		if (moveOn && !tierTwo) {
			// The plain chase hands the mark to the platform's own target following:
			// full thrust to it, then a brake to a standstill on it.
			world.direction = 0;
			world.target = plan.interceptX;
			return;
		}
		// Tier II always uses the economical controller, including uncertain
		// approaches and the new plan immediately after a bounce. A known contact
		// gets a just-in-time run; timed travel owns direction and never buys an
		// unnecessary full-throttle stop. Replanning gives every bounce a fresh
		// deadline and keeps the platform target tied to the visible landing mark.
		world.target = NaN;
		const platform = world.platform;
		const distance = plan.interceptX - platform.x;
		if (!Number.isFinite(distance)) { world.direction = 0; return; }
		const acceleration = accelerationOf(world);
		// Offsets inside the reflector face do not change the outcome, so they are
		// not worth a manoeuvre: inside that slack the platform is left alone, which
		// is also why it never has to stand still on the mark.
		const reach = Math.abs(distance) - interceptTolerance;
		if (reach <= 0) { world.direction = 0; return; }
		const sign = Math.sign(distance);
		const speed = physics.arrivalSpeed(reach, plan.contactIn, acceleration);
		// Braking with a flywheel is recuperated, so tracking is tight; without one
		// every correction becomes heat and the platform is allowed to drift further
		// before it pays for one.
		const deadband = physics.recoveryNow() > 0 ? trackedDeadband : coastingDeadband;
		const demand = Math.max(-physics.speedNow(), Math.min(physics.speedNow(), sign * speed));
		world.direction = platform.vx < demand - deadband ? 1 : platform.vx > demand + deadband ? -1 : 0;
	}

	// Drive the ball into the rock with real speed, not a bare touch. The pulse
	// is a fixed chunk of energy, so the keeper spends it until the passive
	// bounce would clear the ceiling by one pulse of apex height — a strike the
	// rock fractures quadratically harder than a feather touch — and holds once
	// the strike line is met. One pulse of headroom above the line is the most a
	// single contact can add, so the ball is bounded exactly the way it was
	// before, one pulse higher, and an always-on drive remains the failure mode
	// the keeper exists to prevent. The overshoot scales with this machine's own
	// pulse, so a fitted drive coil or piston ram aims proportionally higher.
	function strikeHeight(pulse) {
		const config = root.SteamPhysics.config;
		return pulse / (config.ballMass * config.ballGravity);
	}

	function driveDecision(world) {
		// A held or grounded ball must stay launchable, so the drive is on.
		const ball = world.ball;
		if (!ball || ball.state !== 'flying') return true;
		if (!plan.contactOnPiston) return wantedDrive;
		const physics = root.SteamPhysics;
		const config = physics.config;
		const bounce = solve(world, angleOn && !suspended(ANGLE) ? wantedAngle : world.pistonAngle, 0);
		const rise = Math.max(0, bounce.vy);
		const apex = plan.contactY + rise * rise / (2 * config.ballGravity);
		// The apex that matters is the ball's own size under the roof it strikes.
		const target = config.ceiling - physics.ballRadiusAt(config.ceiling) + strikeHeight(physics.pulseNow());
		if (apex < target - apexMargin) return true;
		if (apex > target) return false;
		return wantedDrive;
	}

	function commandDrive(world) {
		wantedDrive = driveDecision(world);
		world.drive = wantedDrive;
		const ball = world.ball;
		// A caught ball has no flight energy at all, so the keeper's own rule sends
		// it back up instead of letting the shift stall on a held ball. A release
		// the pulse cannot pay for - above the derate curve, or on an empty reserve
		// - is not attempted: the ball stays in the collector and rides to the
		// charge pad, where travel waits out the heat, and leaves on the first step
		// the tank allows it. Hammering the launch would only burn the reserve the
		// release is waiting for.
		if (wantedDrive && ball && ball.state === 'held' && root.SteamPhysics.canLaunch(world)) root.SteamPhysics.launch(world);
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
		if (plan.contactOnPiston) wantedAngle = verticalTilt(world);
		const physics = root.SteamPhysics;
		const reach = physics.config.pistonSlewRate * dt;
		const delta = wantedAngle - world.pistonAngle;
		physics.setPistonAngle(world, Math.abs(delta) <= reach ? wantedAngle : world.pistonAngle + Math.sign(delta) * reach);
	}

	function update(world, dt) {
		advanceOverride(MOVE, dt);
		advanceOverride(DRIVE, dt);
		advanceOverride(ANGLE, dt);
		if (!(moveOn || smartOn || driveOn || angleOn)) {
			if (world.focus) world.focus = null;
			return;
		}
		// The intercept owns the choice of ball; the keepers alone let the plain
		// focus rule decide again.
		if (moveOn || smartOn) {
			focusAge += dt;
			if (focusAge >= selectInterval) { focusAge = 0; select(world); }
		} else if (world.focus) world.focus = null;
		planAge += dt;
		if (plan.contactIn > 0) plan.contactIn = Math.max(0, plan.contactIn - dt);
		if (stale(world)) replan(world);
		if ((moveOn || smartOn) && !suspended(MOVE)) commandTravel(world);
		// The drive decision is priced with the tilt the angle keeper is holding,
		// and the tilt is solved with the drive state just decided.
		if (driveOn && !suspended(DRIVE)) commandDrive(world);
		if (angleOn && !suspended(ANGLE)) commandTilt(world, dt);
	}

	const api = { state, enabled, set, toggle, override, hold, resume, suspended, overrideSeconds, reset, update, channels: Object.freeze({ MOVE, SMART, DRIVE, ANGLE }) };
	root.SteamAutopilot = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
