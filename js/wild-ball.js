// The Wild Mine ball player (P2). One rigid sphere (I = 2/5 m r^2) with an
// onboard battery: deck induction charges it, the motor applies spin torque on
// surfaces and in mid-air, the jump actuator toggles powered bounce pulses like
// the platform's reflector drive, and bounce recycling actively damps rebounds
// to return part of the energy to the battery like regenerative braking.
// Fallen rock lands in the shared rubble heightmap (js/wild-rubble.js), which
// rides on any rock face — see "improve debris" in the 0.4.0 draft.
//
// Contacts couple linear and angular velocity through Coulomb friction along
// the oriented surface tangent t = (ny, -nx), conserving angular momentum about
// the contact point and booking slip work as heat. Every mechanical and battery
// change goes through the single energy ledger so `physics.totalEnergy` stays
// exact while `cave.weaken` owns the rock.
//
// Depends on: js/cave.js, js/ceiling.js, js/minerals.js, js/physics.js,
// js/rock-materials.js
(function (root) {
	'use strict';
	const node = typeof module !== 'undefined' && module.exports;
	const physicsRef = node ? require('./physics.js') : root.SteamPhysics;
	const ceilingRef = node ? require('./ceiling.js') : root.SteamCeiling;
	const rockTable = node ? require('./minerals.js') : root.SteamMinerals;
	const materialsRef = node ? require('./rock-materials.js') : root.SteamRockMaterials;
	const rubble = node ? require('./wild-rubble.js') : root.SteamWildRubble;

	function phys() { return physicsRef || root.SteamPhysics; }
	function chamber() { return ceilingRef || root.SteamCeiling; }
	function materials() { return materialsRef || root.SteamRockMaterials; }

	const CONTACT_NONE = 0;
	const CONTACT_ROCK = 1;
	const CONTACT_DECK = 2;

	// Solid sphere geometry: I = 2/5 m r^2, rolling inertia m + I/r^2 = 7/5 m,
	// and effective tangential contact mass 1 / (1/m + r^2/I) = 2/7 m. In free
	// air the same motor torque accelerates omega 7/2 = 3.5x faster than a roll.
	const inertiaFactor = 0.4;
	const rollMassFactor = 1 + inertiaFactor;
	const tangentMassFactor = inertiaFactor / rollMassFactor;

	// D5: a contact rolls while the surface turns less than 30 degrees across one
	// ball diameter and the normal closing speed stays under 0.35 m/s.
	const curvatureLimit = Math.PI / 6;
	const bounceFloor = 0.35;
	// D4: Coulomb friction couples spin and tangential velocity on bounce and roll;
	// rolling resistance settles a coasting roll into heat; restSpeed sleeps a
	// motor-off ball once both centre and rim speeds have died.
	const surfaceFriction = 0.85;
	const rollingResistance = 0.35;

	// D1: onboard battery and actuators. Motor torque is flat up to motorTopSpeed
	// and tapers by back-EMF to motorFreeSpeed, so an unloaded ball in mid-air
	// both spins up 3.5x faster and reaches a higher rim speed than on ground.
	const batteryCapacity = 300;
	const chargePower = 60;
	const chargeEfficiency = 0.85;
	const motorAcceleration = 2.5;
	const motorTopSpeed = 5;
	const motorFreeSpeed = 8;
	const motorEfficiency = 0.8;
	const jumpSpeed = 2.6;
	const jumpEfficiency = 0.8;


	// Bounce recuperation mirrors the platform's brake flywheel (55% recovery at
	// 90% efficiency): active damping removes most of each rebound, stores the
	// recovered share in the ball battery, and vents the remainder as heat.
	const recycleDamping = 0.88;
	const recycleRecovery = 0.55;
	const recycleEfficiency = 0.9;

	const releaseCooldownTime = 0.5;
	const contactSlop = 0.012;
	const leaveSpeed = 0.02;
	// Below this rim/centre speed a supported, motor-off ball is asleep: leftover
	// micro-spin is booked as heat instead of freewheeling on a wall or settle.
	const restSpeed = 0.04;
	// A ball that touched rock this recently is ground-rattling, not flying: the
	// rough cave floor breaks a roll into micro-bounces that skip the supported
	// resolution entirely, and the coasting speed (and any no-slip spin) then
	// dissipates orders of magnitude too slowly. Keep rolling resistance alive
	// between contacts for this long so a ball stops in a small hole.
	const groundMemoryTime = 0.5;
	// A trace is a root of `sdf - r` sampled at half-cell steps, and the field
	// clamps to one band (0.9 m), so a trace can also land on the band edge or on
	// a plateau with the ball still clear. A contact this early in the frame is
	// not worth resolving blind: the frame is walked in `airSlices` ballistic
	// slices instead, and each contact is judged by the clearance the field
	// reports there (js/wild-ball.js land/airSlicesStep).
	const instantContactTime = 1e-4;
	const airSlices = 4;
	// Share of the rolling-resistance and rim-friction law that acts on a frame
	// the ball spends in the clear against a rim.
	const faintNibble = 0.05;
	// A contact resolution may hand the frame to the other driver (a landing
	// rolls, a roll that leaves the ground flies); two hand-offs must be enough,
	// a third would be the two drivers bouncing the same frame between them.
	const handOffLimit = 2;

	// Debris is outside the ball's ledger: a removed cell's potential energy was
	// never counted for the cave, exactly as a platform's own height is not.
	// A grain falls ballistically until it reaches the rubble crest below it —
	// the rock face, or a pile already standing on it — and is deposited into
	// that pile (heightmap-based, like the chamber's floor but on any rock
	// face). Grains never rest in mid-air; the pile is the rest state.
	const maxDebris = 512;
	const mineralCountTotal = rockTable.mineralCount;
	const debrisX = new Float64Array(maxDebris);
	const debrisY = new Float64Array(maxDebris);
	const debrisVx = new Float64Array(maxDebris);
	const debrisVy = new Float64Array(maxDebris);
	const debrisSize = new Float64Array(maxDebris);
	const debrisValue = new Float64Array(maxDebris);
	const debrisMinerals = new Float64Array(maxDebris * mineralCountTotal);
	const debrisRed = new Uint8Array(maxDebris);
	const debrisGreen = new Uint8Array(maxDebris);
	const debrisBlue = new Uint8Array(maxDebris);
	const debrisActive = new Uint8Array(maxDebris);
	let debrisCount = 0;
	let extractedCells = 0, caughtCells = 0;
	let debrisCursor = 0;

	const rockNormal = { nx: 0, ny: 1 };
	const trace = { time: Infinity, x: 0, y: 0, nx: 0, ny: 1 };
	const pileTrace = { time: Infinity, x: 0, y: 0, nx: 0, ny: 1, face: NaN, crest: NaN, height: 0, hasPile: false, row: -1 };
	const pileSupport = { face: NaN, crest: NaN, height: 0, nx: 0, ny: 1, hasPile: false, row: -1 };
	const deckHit = { hit: false, piston: false, front: false, nx: 0, ny: 1, lny: 0, pointX: 0, pointY: 0, push: 0 };
	const mixScratch = new Float64Array(rockTable.mineralCount);
	const elementScratch = new Float32Array(3);
	const rgbScratch = new Float64Array(3);

	function radiusOf() {
		return phys().config.radius;
	}

	function massOf(ball) {
		return phys().ballMassFor(ball);
	}

	function inertiaShare() {
		const r = radiusOf();
		return inertiaFactor * r * r;
	}

	function kineticEnergy(ball) {
		const m = massOf(ball);
		return 0.5 * m * (ball.vx * ball.vx + ball.vy * ball.vy + inertiaShare() * ball.omega * ball.omega);
	}

	// Translational + rotational + gravitational energy; a held ball contributes
	// none of it, matching a caught ball in the chamber.
	function mechanicalEnergy(ball) {
		if (!ball || ball.state === 'held') return 0;
		const m = massOf(ball);
		const gravity = phys().config.ballGravity;
		return kineticEnergy(ball) + m * gravity * (ball.y - radiusOf());
	}

	function bookMech(world, before, after) {
		const delta = after - before;
		if (delta > 0) world.importedEnergy += delta;
		else if (delta < 0) world.heat -= delta;
	}

	function bookLift(world, ball, dy) {
		if (!dy) return;
		const delta = massOf(ball) * phys().config.ballGravity * dy;
		if (delta > 0) world.importedEnergy += delta;
		else world.heat -= delta;
	}

	// Same recuperation law as physics.dissipate, routed into the ball's battery.
	function recycleEnergy(world, ball, energy) {
		if (!(energy > 0)) return 0;
		const room = Math.max(0, batteryCapacity - ball.battery);
		const returned = Math.min(room, energy * recycleRecovery * recycleEfficiency);
		ball.battery += returned;
		world.heat += energy - returned;
		ball.recycled += returned;
		ball.lastRecycle = returned;
		return returned;
	}

	function probeDeck(world, x, y, r) {
		const plate = world.platform;
		const config = phys().config;
		const cosine = Math.cos(plate.angle);
		const sine = Math.sin(plate.angle);
		const dx = x - plate.x;
		const dy = y - plate.y;
		const lx = dx * cosine + dy * sine;
		const ly = -dx * sine + dy * cosine;
		const boundary = -config.platformWidth * 0.5 + config.platformWidth * config.collectorFraction;
		const cx = Math.max(-config.platformWidth * 0.5, Math.min(boundary, lx));
		const ex = lx - cx;
		const ey = ly - config.deck;
		let distance = Math.hypot(ex, ey);
		let nx = distance > 1e-6 ? ex / distance : 0;
		let ny = distance > 1e-6 ? ey / distance : 1;
		let pointX = cx;
		let pointY = config.deck;
		let piston = false;
		const angle = world.pistonAngle || 0;
		const pc = Math.cos(angle), ps = Math.sin(angle);
		const px = lx - config.pistonCentre, py = ly - config.deck;
		const along = Math.max(-config.pistonHalf, Math.min(config.pistonHalf, px * pc + py * ps));
		const fx = config.pistonCentre + along * pc, fy = config.deck + along * ps;
		const fxDelta = lx - fx, fyDelta = ly - fy;
		const faceDistance = Math.hypot(fxDelta, fyDelta);
		if (faceDistance < distance) {
			distance = faceDistance;
			nx = distance > 1e-6 ? fxDelta / distance : -ps;
			ny = distance > 1e-6 ? fyDelta / distance : pc;
			pointX = fx;
			pointY = fy;
			piston = true;
		}
		deckHit.hit = distance < r;
		deckHit.piston = piston;
		deckHit.front = ny * pc - nx * ps > 0.5;
		deckHit.pointX = pointX;
		deckHit.pointY = pointY;
		deckHit.nx = nx * cosine - ny * sine;
		deckHit.ny = nx * sine + ny * cosine;
		deckHit.lny = ny;
		deckHit.push = r - distance;
		return deckHit;
	}

	function activeBall(world) {
		if (!world || !world.balls || world.balls.length === 0) return null;
		return world.balls[0];
	}

	// ---- ball state & commands --------------------------------------------

	function init(world) {
		debrisActive.fill(0);
		debrisCount = 0;
		extractedCells = caughtCells = 0;
		debrisCursor = 0;
		const ball = activeBall(world);
		if (!ball) return null;
		ball.kind = 'ball';
		ball.id = 'ball';
		ball.battery = batteryCapacity;
		ball.omega = 0;
		ball.spin = 0;
		ball.motor = 0;
		ball.jump = false;
		ball.recycle = false;
		ball.releaseCooldown = 0;
		ball.contact = CONTACT_NONE;
		ball.deckContact = false;
		ball.groundTimer = 0;
		ball.groundTx = 1;
		ball.groundTy = 0;
		ball.groundNy = 0;
		ball.hits = 0;
		ball.bounces = 0;
		ball.jumps = 0;
		ball.recycled = 0;
		ball.lastImpact = 0;
		ball.lastFracture = 0;
		ball.lastCharge = 0;
		ball.lastJump = 0;
		ball.lastRecycle = 0;
		return ball;
	}

	function setMotor(world, direction) {
		const ball = activeBall(world);
		if (!ball) return 0;
		ball.motor = direction > 0 ? 1 : direction < 0 ? -1 : 0;
		return ball.motor;
	}

	// Jump actuator and bounce recuperation are opposite duties of the same
	// bounce actuator, so engaging one disengages the other.
	function setJump(world, enabled) {
		const ball = activeBall(world);
		if (!ball) return false;
		const on = Boolean(enabled);
		ball.jump = on;
		if (on) ball.recycle = false;
		return ball.jump;
	}

	function toggleJump(world) {
		const ball = activeBall(world);
		if (!ball) return false;
		return setJump(world, !ball.jump);
	}

	function setRecycle(world, enabled) {
		const ball = activeBall(world);
		if (!ball) return false;
		const on = Boolean(enabled);
		ball.recycle = on;
		if (on) ball.jump = false;
		return ball.recycle;
	}

	function toggleRecycle(world) {
		const ball = activeBall(world);
		if (!ball) return false;
		return setRecycle(world, !ball.recycle);
	}

	// ---- motor, jump actuator & contact friction --------------------------

	function charge(world, ball, dt) {
		const room = batteryCapacity - ball.battery;
		if (!(room > 0)) return;
		const delivered = phys().spend(world, Math.min(chargePower * dt, room));
		if (!(delivered > 0)) return;
		const stored = delivered * chargeEfficiency;
		ball.battery += stored;
		world.heat += delivered - stored;
		ball.lastCharge = stored;
	}

	function floorGap(cave, x, y, r) {
		const floor = cave.floorBelow(x, y);
		if (!Number.isFinite(floor)) return Infinity;
		return y - r - floor;
	}

	function curvatureExceeds(cave, x, y, nx, ny, r) {
		const tx = ny;
		const ty = -nx;
		cave.normalAt(x + tx * r, y + ty * r, rockNormal);
		const ahead = nx * rockNormal.nx + ny * rockNormal.ny;
		cave.normalAt(x - tx * r, y - ty * r, rockNormal);
		const behind = nx * rockNormal.nx + ny * rockNormal.ny;
		const turn = Math.acos(ahead > 1 ? 1 : ahead < -1 ? -1 : ahead)
			+ Math.acos(behind > 1 ? 1 : behind < -1 ? -1 : behind);
		return turn > curvatureLimit;
	}

	// Internal motor applies spin torque directly to omega. Opposing existing
	// spin brakes into heat with no battery draw; accelerating spin draws battery
	// at motorEfficiency. Without surface contact, I alone carries the torque, so
	// omega climbs 3.5x faster than on flat rock and reaches motorFreeSpeed / r.
	function stepSpinMotor(world, ball, dt) {
		const direction = ball.motor;
		if (!direction || !(dt > 0)) return;
		const r = radiusOf();
		const m = massOf(ball);
		const inertia = inertiaFactor * m * r * r;
		const baseAlpha = (rollMassFactor / inertiaFactor) * (motorAcceleration / r);
		let remaining = dt;
		if (ball.omega * direction < 0) {
			const stopTime = Math.min(remaining, Math.abs(ball.omega) / baseAlpha);
			const before = 0.5 * inertia * ball.omega * ball.omega;
			const next = ball.omega + direction * baseAlpha * stopTime;
			ball.omega = next * direction >= 0 ? 0 : next;
			world.heat += before - 0.5 * inertia * ball.omega * ball.omega;
			remaining -= stopTime;
		}
		if (!(remaining > 0) || !(ball.battery > 0)) return;
		const rimSpeed = ball.omega * direction * r;
		if (rimSpeed >= motorFreeSpeed) return;
		const taper = rimSpeed <= motorTopSpeed ? 1 : (motorFreeSpeed - rimSpeed) / (motorFreeSpeed - motorTopSpeed);
		const alpha = baseAlpha * taper;
		const maxOmega = motorFreeSpeed / r;
		let target = ball.omega + direction * alpha * remaining;
		if (target * direction > maxOmega) target = direction * maxOmega;
		const before = 0.5 * inertia * ball.omega * ball.omega;
		const wanted = 0.5 * inertia * target * target - before;
		if (!(wanted > 0)) return;
		const available = ball.battery * motorEfficiency;
		const useful = wanted > available ? available : wanted;
		const cost = Math.min(ball.battery, useful / motorEfficiency);
		ball.battery -= cost;
		world.heat += cost - useful;
		ball.omega = direction * Math.sqrt((2 * (before + useful)) / inertia);
	}

	function clampImpulse(impulse, limit) {
		if (impulse > limit) return limit;
		if (impulse < -limit) return -limit;
		return impulse;
	}

	// Coulomb friction at contact point x - r*n along oriented tangent t = (ny, -nx).
	// Positive omega is clockwise, so contact slip relative to the surface is
	// (v - v_surface)·t - omega*r. Clamping by mu*Jn lets fast spin skid and keep
	// leftover spin for the next bounce while booking exact kinetic loss as heat.
	function applyRockFriction(world, ball, nx, ny, normalImpulse) {
		if (!(normalImpulse > 0)) return;
		const r = radiusOf();
		const m = massOf(ball);
		const tx = ny;
		const ty = -nx;
		const slip = ball.vx * tx + ball.vy * ty - ball.omega * r;
		if (Math.abs(slip) <= 1e-12) return;
		const jt = clampImpulse(-tangentMassFactor * m * slip, surfaceFriction * normalImpulse);
		const before = kineticEnergy(ball);
		ball.vx += (jt / m) * tx;
		ball.vy += (jt / m) * ty;
		ball.omega -= jt / (inertiaFactor * m * r);
		bookMech(world, before, kineticEnergy(ball));
	}

	function applyDeckFriction(world, ball, nx, ny, surfaceVx, surfaceVy, normalImpulse) {
		if (!(normalImpulse > 0)) return;
		const r = radiusOf();
		const m = massOf(ball);
		const tx = ny;
		const ty = -nx;
		const vt = (ball.vx - surfaceVx) * tx + (ball.vy - surfaceVy) * ty;
		const slip = vt - ball.omega * r;
		if (Math.abs(slip) <= 1e-12) return;
		const jt = clampImpulse(-tangentMassFactor * m * slip, surfaceFriction * normalImpulse);
		const before = mechanicalEnergy(ball);
		ball.vx += (jt / m) * tx;
		ball.vy += (jt / m) * ty;
		ball.omega -= jt / (inertiaFactor * m * r);
		bookMech(world, before, mechanicalEnergy(ball));
	}

	// Piston-like jump actuator: when switched on, each rock contact receives a
	// normal energy pulse from the battery (v_n' = sqrt(v_n^2 + 2*push/m)),
	// leaving tangential velocity and spin untouched. Returns added normal impulse.
	function applyJumpPulse(world, ball, nx, ny) {
		if (!ball.jump || ball.recycle || !(ball.battery > 0)) return 0;
		const m = massOf(ball);
		const pulse = 0.5 * m * jumpSpeed * jumpSpeed;
		const available = ball.battery * jumpEfficiency;
		const useful = pulse > available ? available : pulse;
		if (!(useful > 0)) return 0;
		const cost = Math.min(ball.battery, useful / jumpEfficiency);
		ball.battery -= cost;
		world.heat += cost - useful;
		const vn = Math.max(0, ball.vx * nx + ball.vy * ny);
		const before = kineticEnergy(ball);
		const boosted = Math.sqrt(vn * vn + (2 * useful) / m);
		const deltaVn = boosted - vn;
		ball.vx += deltaVn * nx;
		ball.vy += deltaVn * ny;
		bookMech(world, before + useful, kineticEnergy(ball));
		ball.jumps++;
		ball.lastJump = useful;
		return m * deltaVn;
	}

	// ---- ball step --------------------------------------------------------

	// Refresh the ground memory: the last rock contact, its tangent and the
	// load-bearing (upward) share of its normal. A ceiling or sideways face
	// carries no floor load; once a floor-like contact enters the memory window,
	// a sideways touch must not poison its authority — so the window keeps the
	// strongest support it has seen until it expires.
	function touchGround(ball, nx, ny) {
		const up = ny > 0 ? ny : 0;
		if (!(ball.groundTimer > 0) || up >= ball.groundNy) {
			ball.groundTx = ny;
			ball.groundTy = -nx;
			ball.groundNy = up;
		}
		ball.groundTimer = groundMemoryTime;
	}

	// Rolling resistance and rim friction carried across the micro-bounces of a
	// rough floor. Without them a ball skipping over cell corners never re-enters
	// the supported resolution, so neither the 0.35 m/s^2 coast nor the restSpeed
	// sleep ever acts and the ball spins/slides essentially forever - and a ball
	// sitting in the clear beside a rim keeps whatever spin it arrived with, the
	// missing friction on the edges of a small hole.
	//
	// `share` scales the whole law: 1 is the full carried roll, `faintNibble` is
	// the rim dither of a frame with no surface to resolve a contact on. The law
	// is the supported one with the step's own weight as the load: rolling
	// resistance on the coast, then a Coulomb impulse that drags contact slip
	// (`v_t - omega r`) to zero and books the slip work as heat. Gravity and the
	// bounce are already integrated by the caller.
	function groundDrag(world, ball, r, dt, share) {
		if (!(dt > 0)) return;
		const ny = ball.groundNy;
		if (!(ny > 0)) return;
		const tx = ball.groundTx;
		const ty = ball.groundTy;
		const gravity = phys().config.ballGravity;
		const m = massOf(ball);
		const before = kineticEnergy(ball);
		let vt = ball.vx * tx + ball.vy * ty;
		const keep = Math.max(0, Math.abs(vt) - rollingResistance * share * ny * dt);
		vt = vt < 0 ? -keep : keep;
		const slip = vt - ball.omega * r;
		const limit = surfaceFriction * share * m * gravity * ny * dt;
		const jt = Math.abs(slip) > 1e-9 ? clampImpulse(-tangentMassFactor * m * slip, limit) : 0;
		vt += jt / m;
		ball.omega -= jt / (inertiaFactor * m * r);
		ball.vx += (vt - ball.vx * tx - ball.vy * ty) * tx;
		ball.vy += (vt - ball.vx * tx - ball.vy * ty) * ty;
		const afterDrag = kineticEnergy(ball);
		if (afterDrag !== before) bookMech(world, before, afterDrag);
	}

	function carryGround(world, ball, r, dt) {
		if (!(ball.groundTimer > 0)) return;
		ball.groundTimer -= dt;
		groundDrag(world, ball, r, dt, 1);
	}

	// A frame the rim holds in the clear: no surface to resolve a contact on, but
	// the ball is far from flying either. It is a rim sliding under the ball, so
	// the faintNibble share of the same law drains the coast and any dithering
	// spin - enough to stop a ball at a hole's edge, far too little to feel in
	// free flight.
	function nibbleGround(world, ball, r, dt) {
		groundDrag(world, ball, r, dt, faintNibble);
	}

	function rollStep(world, cave, ball, r, dt, depth) {
		const support = rubble.surfaceAt(ball.x, ball.y, pileSupport);
		const onPile = support.hasPile && ball.y - r <= support.crest + contactSlop;
		if (onPile) {
			// The smoothed crest is the surface under the ball: its gentle slope
			// normal feeds the same supported-roll law the rock face uses.
			rockNormal.nx = support.nx;
			rockNormal.ny = support.ny;
		} else {
			cave.normalAt(ball.x, ball.y, rockNormal);
		}
		let nx = rockNormal.nx;
		let ny = rockNormal.ny;
		const sdfVn = ball.vx * nx + ball.vy * ny;
		// A wall or overhang must not steal a supported floor roll: that path
		// used to freeze omega in airStep while the ball sat still against the
		// face. Resolve the wall hit, then keep Coulomb + rolling resistance on
		// the floor so leftover spin dies by friction. Pile normals always face
		// up, so this branch belongs to the rock face alone.
		if (ny <= 0) {
			const gap = floorGap(cave, ball.x, ball.y, r);
			if (!(gap <= contactSlop)) {
				ball.contact = CONTACT_NONE;
				airStep(world, cave, ball, r, dt, depth + 1);
				return;
			}
			if (sdfVn < 0) resolveContact(world, cave, ball, nx, ny, r);
			cave.normalAt(ball.x, ball.y - gap, rockNormal);
			nx = rockNormal.nx;
			ny = rockNormal.ny;
			if (ny <= 0) {
				nx = 0;
				ny = 1;
			}
		}
		touchGround(ball, nx, ny);
		const vn = ball.vx * nx + ball.vy * ny;
		if (vn > leaveSpeed) {
			ball.contact = CONTACT_NONE;
			airStep(world, cave, ball, r, dt, depth + 1);
			return;
		}
		if (-vn > bounceFloor) {
			resolveContact(world, cave, ball, nx, ny, r, onPile ? support.face : NaN);
			if (ball.contact !== CONTACT_ROCK) return;
		}
		ball.contact = CONTACT_ROCK;
		const normalSpeed = ball.vx * nx + ball.vy * ny;
		if (normalSpeed !== 0) {
			const before = kineticEnergy(ball);
			ball.vx -= normalSpeed * nx;
			ball.vy -= normalSpeed * ny;
			const dropped = before - kineticEnergy(ball);
			if (ball.recycle && normalSpeed < 0 && dropped > 0) recycleEnergy(world, ball, dropped);
			else bookMech(world, before, before - dropped);
		}
		const jumpImpulse = applyJumpPulse(world, ball, nx, ny);
		if (jumpImpulse > 0) {
			applyRockFriction(world, ball, nx, ny, jumpImpulse);
			ball.contact = CONTACT_NONE;
			return;
		}
		const m = massOf(ball);
		const gravity = phys().config.ballGravity;
		const startOmega = ball.omega;
		stepSpinMotor(world, ball, dt);
		const mechBefore = mechanicalEnergy(ball);
		const startVx = ball.vx;
		const startVy = ball.vy;
		const tx = ny;
		const ty = -nx;
		let vt = startVx * tx + startVy * ty + gravity * nx * dt;
		const slip = vt - ball.omega * r;
		if (Math.abs(slip) > 1e-12) {
			const jt = clampImpulse(-tangentMassFactor * m * slip, surfaceFriction * m * gravity * Math.max(0, ny) * dt);
			vt += jt / m;
			ball.omega -= jt / (inertiaFactor * m * r);
		}
		if (Math.abs(vt - ball.omega * r) <= 1e-4) {
			const keep = Math.max(0, Math.abs(vt) - rollingResistance * Math.max(0, ny) * dt);
			vt = vt < 0 ? -keep : keep;
			ball.omega = keep === 0 ? 0 : vt / r;
		}
		if (!ball.motor && ny > 0 && Math.abs(vt) < restSpeed && Math.abs(ball.omega * r) < restSpeed) {
			vt = 0;
			ball.omega = 0;
		}
		ball.vx = vt * tx;
		ball.vy = vt * ty;
		// Trapezoidal travel matches slope gravity work to the height change.
		ball.x += 0.5 * (startVx + ball.vx) * dt;
		ball.y += 0.5 * (startVy + ball.vy) * dt;
		bookMech(world, mechBefore, mechanicalEnergy(ball));
		if (onPile) {
			const after = rubble.surfaceAt(ball.x, ball.y, pileSupport);
			if (after.hasPile && ball.y < after.crest + r) {
				const push = after.crest + r - ball.y;
				ball.y = after.crest + r;
				bookLift(world, ball, push);
			}
		}
		// A soil crest supports the roll, but does not switch off the adjacent
		// rock wall. Resolve the wall if the supported travel reached it.
		const distance = cave.sdfAt(ball.x, ball.y);
		if (distance < r) {
			cave.normalAt(ball.x, ball.y, rockNormal);
			const push = r - distance;
			ball.x += push * rockNormal.nx;
			ball.y += push * rockNormal.ny;
			bookLift(world, ball, push * rockNormal.ny);
			if (onPile && rockNormal.ny <= 0) resolveContact(world, cave, ball, rockNormal.nx, rockNormal.ny, r);
		}
		ball.spin += 0.5 * (startOmega + ball.omega) * dt;
	}

	// Returns true when a contact impulse was resolved (vn < 0); the caller uses
	// it to keep rolling resistance off the bounce frame, which owns those
	// impulses outright.
	function resolveContact(world, cave, ball, nx, ny, r, soilFace = NaN) {
		ball.contact = CONTACT_NONE;
		const vn = ball.vx * nx + ball.vy * ny;
		if (!(vn < 0)) return false;
		touchGround(ball, nx, ny);
		const impact = -vn;
		ball.lastImpact = impact;
		const m = massOf(ball);
		const throughSoil = Number.isFinite(soilFace);
		const smooth = throughSoil || !curvatureExceeds(cave, ball.x, ball.y, nx, ny, r);
		if (impact <= bounceFloor && smooth) {
			const before = kineticEnergy(ball);
			ball.vx -= vn * nx;
			ball.vy -= vn * ny;
			const dropped = before - kineticEnergy(ball);
			if (ball.recycle && dropped > 0) recycleEnergy(world, ball, dropped);
			else bookMech(world, before, before - dropped);
			const normalImpulse = m * impact + applyJumpPulse(world, ball, nx, ny);
			applyRockFriction(world, ball, nx, ny, normalImpulse);
			const outVn = ball.vx * nx + ball.vy * ny;
			ball.contact = outVn <= leaveSpeed && ny > 0 ? CONTACT_ROCK : CONTACT_NONE;
			return true;
		}
		// Only the normal energy lost by this strike head is available to weaken rock.
		const retention = phys().rockRetentionNow(ball.owner);
		const before = kineticEnergy(ball);
		const inboundEnergy = 0.5 * m * vn * vn;
		const budget = inboundEnergy * (1 - retention);
		// Aim into the struck cell, not the void side of a grid-aligned face.
		const inset = cave.state.cell * 0.5;
		const x = throughSoil ? ball.x : ball.x - nx * (r + inset);
		const y = throughSoil ? soilFace - inset : ball.y - ny * (r + inset);
		const spent = root.SteamWildMine.strike(x, y, budget, ball.owner, throughSoil);
		world.fractureEnergy += spent;
		world.heat += budget - spent;
		ball.lastFracture = spent;
		ball.hits++;
		let outVn = Math.sqrt(retention) * impact;
		if (ball.recycle) {
			const dampedVn = outVn * Math.sqrt(1 - recycleDamping);
			outVn = dampedVn < bounceFloor && smooth && ny > 0 ? 0 : dampedVn;
			ball.vx += (outVn - vn) * nx;
			ball.vy += (outVn - vn) * ny;
			const dampedEnergy = (before - budget) - kineticEnergy(ball);
			if (dampedEnergy > 0) recycleEnergy(world, ball, dampedEnergy);
			else bookMech(world, before - budget, kineticEnergy(ball));
		} else {
			ball.vx += (outVn - vn) * nx;
			ball.vy += (outVn - vn) * ny;
			bookMech(world, before - budget, kineticEnergy(ball));
		}
		let normalImpulse = m * (outVn - vn);
		const jumpImpulse = applyJumpPulse(world, ball, nx, ny);
		if (jumpImpulse > 0) {
			normalImpulse += jumpImpulse;
			outVn = ball.vx * nx + ball.vy * ny;
		}
		applyRockFriction(world, ball, nx, ny, normalImpulse);
		ball.contact = outVn < bounceFloor && ny > 0 ? CONTACT_ROCK : CONTACT_NONE;
		return true;
	}

	function pileLand(world, cave, ball, r, dt, time, depth) {
		const gravity = phys().config.ballGravity;
		const flightY = ball.y + ball.vy * time - 0.5 * gravity * time * time;
		ball.x = pileTrace.x;
		ball.y = pileTrace.y;
		ball.vy -= gravity * time;
		bookLift(world, ball, ball.y - flightY);
		advanceAirSpin(world, ball, time);
		if (ball.y < pileTrace.crest + r) {
			const push = pileTrace.crest + r - ball.y;
			ball.y += push;
			bookLift(world, ball, push);
		}
		resolveContact(world, cave, ball, pileTrace.nx, pileTrace.ny, r, pileTrace.face);
		if (ball.contact !== CONTACT_ROCK) return false;
		if (depth > handOffLimit) return true;
		rollStep(world, cave, ball, r, dt - time, depth + 1);
		return true;
	}

	function advanceAirSpin(world, ball, duration) {
		if (!(duration > 0)) return;
		const startOmega = ball.omega;
		stepSpinMotor(world, ball, duration);
		ball.spin += 0.5 * (startOmega + ball.omega) * duration;
	}

	// Pure ballistic travel for `duration`: no contact anywhere inside it. Drag is
	// left off on the frames right after a resolved contact, which owns its own
	// impulses - restitution and friction already accounted for that step.
	function flyFree(world, ball, r, duration, drag) {
		const gravity = phys().config.ballGravity;
		ball.x += ball.vx * duration;
		ball.y += ball.vy * duration - 0.5 * gravity * duration * duration;
		ball.vy -= gravity * duration;
		advanceAirSpin(world, ball, duration);
		if (drag !== false) carryGround(world, ball, r, duration);
	}

	// Move to a traced contact `time` into the frame, then act on what the field
	// actually says there. A trace is a root of `sdf - r` sampled at half-cell
	// steps, and the field clamps to one band (0.9 m), so a trace can land on the
	// band edge beside a cliff and cannot tell a surface from a hole's edge. The
	// clearance the field reports at the traced point is the ground truth; the
	// trace only says where to look.
	//  - clear: nothing to hit, fly on (the corner is still charged its share of
	//    rim friction, see below);
	//  - touching: bounce or roll there;
	//  - inside: the field's curve cuts the chord the trace walked, so separate
	//    first and resolve at the separated centre.
	// Returns true when the contact took the rest of the frame.
	function land(world, cave, ball, r, dt, time, depth) {
		const gravity = phys().config.ballGravity;
		const flightY = ball.y + ball.vy * time - 0.5 * gravity * time * time;
		ball.x = trace.x;
		ball.y = trace.y;
		ball.vy -= gravity * time;
		bookLift(world, ball, ball.y - flightY);
		advanceAirSpin(world, ball, time);
		const distance = cave.sdfAt(ball.x, ball.y);
		if (distance > r + contactSlop) {
			nibbleGround(world, ball, r, time);
			return false;
		}
		if (distance < r - contactSlop) {
			const push = r - distance;
			ball.x += push * trace.nx;
			ball.y += push * trace.ny;
			bookLift(world, ball, push * trace.ny);
		}
		resolveContact(world, cave, ball, trace.nx, trace.ny, r);
		if (ball.contact !== CONTACT_ROCK) return false;
		if (depth > handOffLimit) return true;
		// Only the rest of the frame is left: the contact happened `time` in.
		rollStep(world, cave, ball, r, dt - time, depth + 1);
		return true;
	}

	// A contact at (almost) zero time is the field's plateau: a ball radius is
	// only 1.44 cells and the bilinear field is flat across a cell, so a ball
	// resting against a corner reads "touching" for ever with no closing speed,
	// as does one hanging in the clear a band-edge artefact away from the corner.
	// Either way the frame must still integrate gravity and travel - the old code
	// stopped on the traced point every frame, which pinned the ball in mid-air
	// beside a hole. Walk the frame in slices so a real corner can still be met
	// inside it; a slice the field calls clear flies on and is charged the faint
	// nibble of rim friction, which is how a ball dies at a hole's edge instead
	// of skating along it.
	function airSlicesStep(world, cave, ball, r, dt, depth) {
		const gravity = phys().config.ballGravity;
		let used = 0;
		for (let index = 0; index < airSlices; index++) {
			const span = (dt - used) / (airSlices - index);
			const contact = cave.traceCircle(ball.x, ball.y, ball.vx, ball.vy, span, r, gravity, trace);
			if (contact.time <= span && contact.time > instantContactTime) {
				land(world, cave, ball, r, dt, contact.time, depth);
				used += contact.time;
				if (ball.contact === CONTACT_ROCK) return;
				flyFree(world, ball, r, dt - used, false);
				return;
			}
			if (contact.time <= instantContactTime) {
				const distance = cave.sdfAt(ball.x, ball.y);
				const closing = ball.vx * contact.nx + ball.vy * contact.ny < 0;
				const inside = distance <= r + contactSlop;
				if (inside) {
					if (distance < r) {
						const push = r - distance;
						ball.x += push * contact.nx;
						ball.y += push * contact.ny;
						bookLift(world, ball, push * contact.ny);
					}
					resolveContact(world, cave, ball, contact.nx, contact.ny, r);
				} else if (closing) {
					resolveContact(world, cave, ball, contact.nx, contact.ny, r);
				}
				if (ball.contact === CONTACT_ROCK) {
					if (depth > handOffLimit) return;
					rollStep(world, cave, ball, r, dt - used, depth + 1);
					return;
				}
				if (!inside) nibbleGround(world, ball, r, span);
			}
			flyFree(world, ball, r, span, false);
			used += span;
		}
	}

	function airStep(world, cave, ball, r, dt, depth) {
		ball.contact = CONTACT_NONE;
		const gravity = phys().config.ballGravity;
		const contact = cave.traceCircle(ball.x, ball.y, ball.vx, ball.vy, dt, r, gravity, trace);
		const rockHit = contact.time <= dt;
		const span = contact.time > 0 ? Math.min(contact.time, dt) : dt;
		const soil = rubble.traceCrest(ball.x, ball.y, ball.vx, ball.vy, span, r, gravity, pileTrace);
		// At a simultaneous overlap the coating owns an upward-facing hit;
		// a rock wall or an overhang still resolves its own contact.
		if (soil.time <= dt && (soil.time < contact.time || (soil.time === contact.time && contact.ny > 0))) {
			if (pileLand(world, cave, ball, r, dt, pileTrace.time, depth)) return;
			flyFree(world, ball, r, dt - pileTrace.time, false);
			return;
		}
		if (!rockHit) {
			flyFree(world, ball, r, dt);
			return;
		}
		if (contact.time <= instantContactTime) {
			airSlicesStep(world, cave, ball, r, dt, depth);
			return;
		}
		if (land(world, cave, ball, r, dt, contact.time, depth)) return;
		flyFree(world, ball, r, dt - contact.time, false);
	}

	function takePistonPulse(world, armed) {
		const p = phys();
		const useful = armed ? p.spend(world, p.launchCapacity(world)) : 0;
		world.lastPush = useful;
		if (useful > 0) world.pushes++;
		return useful;
	}

	function deckStep(world, ball, r, dt) {
		const plate = world.platform;
		if (!probeDeck(world, ball.x, ball.y, r).hit) {
			ball.deckContact = false;
			if (ball.contact === CONTACT_DECK) ball.contact = CONTACT_NONE;
			return;
		}
		const hit = deckHit;
		ball.x += hit.nx * hit.push;
		ball.y += hit.ny * hit.push;
		bookLift(world, ball, hit.push * hit.ny);
		ball.deckContact = hit.lny > 0.5;
		ball.contact = CONTACT_DECK;
		const cosine = Math.cos(plate.angle);
		const sine = Math.sin(plate.angle);
		const rx = hit.pointX * cosine - hit.pointY * sine;
		const ry = hit.pointX * sine + hit.pointY * cosine;
		const surfaceVx = plate.stepVx - plate.stepOmega * ry;
		const surfaceVy = plate.stepVy + plate.stepOmega * rx;
		const relativeVx = ball.vx - surfaceVx;
		const relativeVy = ball.vy - surfaceVy;
		const vn = relativeVx * hit.nx + relativeVy * hit.ny;
		const m = massOf(ball);
		let normalImpulse = m * phys().config.ballGravity * Math.max(0, hit.ny) * dt;
		if (vn < 0) {
			const before = mechanicalEnergy(ball);
			const passiveOut = -Math.sqrt(phys().retentionNow(plate.id)) * vn;
			ball.vx += (passiveOut - vn) * hit.nx;
			ball.vy += (passiveOut - vn) * hit.ny;
			const passiveAfter = mechanicalEnergy(ball);
			bookMech(world, before, passiveAfter);
			let outVn = passiveOut;
			if (ball.recycle) {
				const dampedVn = passiveOut * Math.sqrt(1 - recycleDamping);
				outVn = dampedVn < bounceFloor && hit.lny > 0.5 ? 0 : dampedVn;
				ball.vx += (outVn - passiveOut) * hit.nx;
				ball.vy += (outVn - passiveOut) * hit.ny;
				const dampedAfter = mechanicalEnergy(ball);
				if (passiveAfter > dampedAfter) recycleEnergy(world, ball, passiveAfter - dampedAfter);
				else bookMech(world, passiveAfter, dampedAfter);
			}
			const useful = hit.piston ? takePistonPulse(world, hit.front && phys().machineDrive(world)) : 0;
			if (useful > 0) {
				const boosted = Math.sqrt(outVn * outVn + 2 * useful / m);
				const beforePush = mechanicalEnergy(ball);
				ball.vx += (boosted - outVn) * hit.nx;
				ball.vy += (boosted - outVn) * hit.ny;
				bookMech(world, beforePush + useful, mechanicalEnergy(ball));
				outVn = boosted;
			}
			normalImpulse += m * (outVn - vn);
			ball.bounces++;
		}
		applyDeckFriction(world, ball, hit.nx, hit.ny, surfaceVx, surfaceVy, normalImpulse);
		if (!ball.deckContact) return;
		charge(world, ball, dt);
		if (!hit.piston && !(ball.releaseCooldown > 0)) capture(world, ball);
	}

	function capture(world, ball) {
		const plate = world.platform;
		const mass = phys().platformMass(world);
		const ballMass = massOf(ball);
		const joined = mass + ballMass;
		const before = mechanicalEnergy(ball) + 0.5 * mass * plate.vx * plate.vx;
		plate.vx = (mass * plate.vx + ballMass * ball.vx) / joined;
		ball.holder = plate.id;
		ball.state = 'held';
		ball.vx = 0;
		ball.vy = 0;
		ball.omega = 0;
		ball.spin = 0;
		ball.contact = CONTACT_NONE;
		ball.deckContact = true;
		phys().setHeldBallPose(world, ball);
		const after = 0.5 * joined * plate.vx * plate.vx;
		bookMech(world, before, after);
	}

	function step(world, cave, dt) {
		if (!world || !cave || !(dt > 0)) return;
		stepDebris(world, dt);
		const ball = activeBall(world);
		if (!ball) return;
		if (ball.releaseCooldown > 0) {
			ball.releaseCooldown = ball.releaseCooldown - dt < dt * 0.5 ? 0 : ball.releaseCooldown - dt;
		}
		ball.lastCharge = 0;
		ball.lastJump = 0;
		ball.lastRecycle = 0;
		if (ball.state === 'held') {
			phys().setHeldBallPose(world, ball);
			ball.omega = 0;
			ball.spin = 0;
			ball.contact = CONTACT_NONE;
			ball.deckContact = true;
			charge(world, ball, dt);
			return;
		}
		const r = radiusOf();
		const sdf = cave.sdfAt(ball.x, ball.y);
		const support = rubble.surfaceAt(ball.x, ball.y, pileSupport);
		const pileTouch = support.hasPile && ball.y - r <= support.crest + contactSlop;
		// The signed field is the surface for rock; a rubble crest seats the
		// ball the same way above the face it stands on. A stair-stepped
		// occupancy scan (`floorBelow`) reports a shelf floor under a pocket the
		// ball has fallen into, and would seat it in mid-air there — the SDF and
		// the crest decide, never the stair-step.
		const supported = sdf <= r + contactSlop || pileTouch;
		if (supported && (ball.contact === CONTACT_ROCK || Math.abs(ball.vy) <= leaveSpeed)) rollStep(world, cave, ball, r, dt, 0);
		else airStep(world, cave, ball, r, dt, 0);
		deckStep(world, ball, r, dt);
		if (ball.contact === CONTACT_ROCK) {
			// A ball can be supported by either surface: the rock face itself, or
			// a rubble crest standing above it. Only a contact supported by
			// neither loses its support.
			const nearRock = cave.sdfAt(ball.x, ball.y) <= r + contactSlop;
			const after = rubble.surfaceAt(ball.x, ball.y, pileSupport);
			const onCrest = after.hasPile && ball.y - r <= after.crest + contactSlop;
			if (!nearRock && !onCrest) ball.contact = CONTACT_NONE;
		}
	}

	// ---- release ----------------------------------------------------------

	function canLaunch(world, target) {
		const ball = target || activeBall(world);
		if (!ball || ball.state !== 'held') return false;
		const machine = phys().machineById(world, ball.holder);
		return Boolean(machine && phys().machineDrive(machine));
	}

	function launch(world, target, machine) {
		const ball = target || activeBall(world);
		if (!canLaunch(world, ball)) return false;
		const p = phys();
		const holder = machine || p.machineById(world, ball.holder);
		const plate = p.machineBody(holder);
		const baseAngle = plate.angle;
		const faceAngle = baseAngle + p.machinePistonAngle(holder);
		const r = radiusOf();
		const cosine = Math.cos(baseAngle);
		const sine = Math.sin(baseAngle);
		ball.x = plate.x + cosine * p.config.pistonCentre - sine * p.config.deck - Math.sin(faceAngle) * r;
		ball.y = plate.y + sine * p.config.pistonCentre + cosine * p.config.deck + Math.cos(faceAngle) * r;
		ball.holder = null;
		ball.state = 'flying';
		ball.vx = plate.stepVx;
		ball.vy = plate.stepVy;
		ball.omega = 0;
		ball.spin = 0;
		ball.contact = CONTACT_NONE;
		ball.deckContact = false;
		ball.groundTimer = 0;
		ball.groundTx = 1;
		ball.groundTy = 0;
		ball.groundNy = 0;
		ball.releaseCooldown = releaseCooldownTime;
		const m = massOf(ball);
		const useful = takePistonPulse(world, true);
		const speed = Math.sqrt(2 * useful / m);
		ball.vx += -Math.sin(faceAngle) * speed;
		ball.vy += Math.cos(faceAngle) * speed;
		// Before release this mass already carried horizontal energy in platformMass.
		const carried = 0.5 * m * plate.vx * plate.vx;
		bookMech(world, carried + useful, mechanicalEnergy(ball));
		holder.pistonOffset = p.config.pistonTravel * 0.6;
		holder.pistonVelocity = 0;
		return true;
	}

	// ---- debris -----------------------------------------------------------

	function spawnFragment(cave, column, row) {
		extractedCells++;
		let index = debrisCursor;
		if (debrisCount === maxDebris) {
			// The flight pool is bounded; settle its oldest grain rather than
			// silently overwriting its mass and break-time value.
			rubble.deposit(debrisX[index], debrisY[index], 1, debrisValue[index]);
		} else {
			while (debrisActive[index]) index = (index + 1) % maxDebris;
			debrisCount++;
		}
		debrisCursor = (index + 1) % maxDebris;
		debrisActive[index] = 1;
		debrisX[index] = cave.worldX(column);
		debrisY[index] = cave.worldY(row);
		debrisVx[index] = 0;
		debrisVy[index] = 0;
		debrisSize[index] = cave.state.cell;
		cave.mixAt(column, row, mixScratch, elementScratch);
		materials().colorInto(mixScratch, 0, rgbScratch);
		debrisRed[index] = rgbScratch[0];
		debrisGreen[index] = rgbScratch[1];
		debrisBlue[index] = rgbScratch[2];
		// Book the cell's mineral mass and market value at the moment it left
		// the rock, so a later catch or a pile deposit hands back exactly what
		// came down — like the chamber's falling cells do.
		const mOffset = index * mineralCountTotal;
		const storage = chamber().state;
		for (let m = 0; m < mineralCountTotal; m++) debrisMinerals[mOffset + m] = storage.cellMass * mixScratch[m];
		debrisValue[index] = materials().valueInto(mixScratch, 0, storage.mineralPrices);
	}

	// Test the crossing in the deck's own frame. A full hopper lets the
	// entire grain through to the supporting face rather than splitting it.
	function tryCatchGrain(world, i, oldX, oldY, newY) {
		const plate = world.platform;
		const deck = phys().config.deck;
		const cosine = Math.cos(plate.angle);
		const sine = Math.sin(plate.angle);
		const ly0 = -(oldX - plate.x) * sine + (oldY - plate.y) * cosine;
		const ly1 = -(oldX - plate.x) * sine + (newY - plate.y) * cosine;
		if (!(ly0 > deck && ly1 <= deck)) return false;
		const fraction = (deck - ly0) / (ly1 - ly0);
		const yCross = oldY + (newY - oldY) * fraction;
		const lx = (oldX - plate.x) * cosine + (yCross - plate.y) * sine;
		const collectorLeft = -phys().config.platformWidth * 0.5;
		const collectorRight = collectorLeft + phys().config.platformWidth * phys().config.collectorFraction;
		if (lx < collectorLeft || lx > collectorRight) return false;
		const ceil = chamber();
		const carried = phys().platformMass(world);
		if (!ceil.loadWholeCell(debrisMinerals, i * mineralCountTotal, debrisValue[i])) return false;
		const grainMass = ceil.state.cellMass;
		const before = 0.5 * carried * plate.vx * plate.vx;
		plate.vx = (carried * plate.vx + grainMass * debrisVx[i]) / (carried + grainMass);
		// Rock potential is outside the ledger; book only the tracked change
		// in platform kinetic energy and the new cargo's potential energy.
		const after = 0.5 * (carried + grainMass) * plate.vx * plate.vx + grainMass * phys().config.gravity * ceil.state.cargoHeight;
		world.terrainWork += after - before;
		debrisActive[i] = 0;
		debrisCount--;
		caughtCells++;
		return true;
	}

	function stepDebris(world, dt) {
		if (!debrisCount) return;
		const gravity = phys().config.gravity;
		for (let i = 0; i < maxDebris; i++) {
			if (!debrisActive[i]) continue;
			const oldX = debrisX[i];
			const oldY = debrisY[i];
			const oldVy = debrisVy[i];
			const newY = oldY + oldVy * dt - 0.5 * gravity * dt * dt;
			const crest = rubble.crestAt(oldX, oldY);
			const endY = Number.isFinite(crest) ? Math.max(crest, newY) : newY;
			if (tryCatchGrain(world, i, oldX, oldY, endY)) continue;
			if (Number.isFinite(crest) && newY <= crest) {
				// The grain has reached whatever holds the face below — bare rock
				// or a pile already standing there — and becomes part of a pile.
				rubble.deposit(oldX, oldY, 1, debrisValue[i]);
				debrisActive[i] = 0;
				debrisCount--;
				continue;
			}
			if (newY < 0) {
				// Fell out of the bottom of the section: the material is lost for
				// good, exactly like a chamber grain that hits the world edge.
				rubble.bookLost(1, debrisValue[i]);
				debrisActive[i] = 0;
				debrisCount--;
				continue;
			}
			debrisY[i] = newY;
			debrisVy[i] = oldVy - gravity * dt;
		}
	}

	// ---- readouts ---------------------------------------------------------

	const state = {
		battery: 0, speed: 0, omega: 0, contact: CONTACT_NONE,
		jump: false, recycle: false, recycled: 0,
		hits: 0, debris: 0,
		get extractedCells() { return extractedCells; },
		get airborneCells() { return debrisCount; },
		get caughtCells() { return caughtCells; },
		get lostCells() { return rubble.lostCells; }
	};

	function readouts(world) {
		const ball = activeBall(world);
		state.debris = debrisCount;
		if (!ball) {
			state.battery = 0;
			state.speed = 0;
			state.omega = 0;
			state.contact = CONTACT_NONE;
			state.jump = false;
			state.recycle = false;
			state.recycled = 0;
			state.hits = 0;
			return state;
		}
		state.battery = ball.battery || 0;
		state.speed = Math.hypot(ball.vx, ball.vy);
		state.omega = ball.omega || 0;
		state.contact = ball.state === 'held' || ball.deckContact ? CONTACT_DECK : ball.contact;
		state.jump = Boolean(ball.jump);
		state.recycle = Boolean(ball.recycle);
		state.recycled = ball.recycled || 0;
		state.hits = ball.hits || 0;
		return state;
	}

	const api = {
		CONTACT_NONE, CONTACT_ROCK, CONTACT_DECK,
		inertiaFactor, curvatureLimit, bounceFloor,
		surfaceFriction, rollingResistance, restSpeed, groundMemoryTime, faintNibble, handOffLimit,
		batteryCapacity, chargePower, chargeEfficiency,
		motorAcceleration, motorTopSpeed, motorFreeSpeed, motorEfficiency,
		jumpSpeed, jumpEfficiency,
		recycleDamping, recycleRecovery, recycleEfficiency,
		maxDebris,
		init, step, setMotor, setJump, toggleJump, setRecycle, toggleRecycle,
		canLaunch, launch, readouts, state, mechanicalEnergy,
		debrisX, debrisY, debrisVx, debrisVy, debrisSize, debrisRed, debrisGreen, debrisBlue, debrisActive,
		tryCatchGrain, spawnFragment,
		get debrisCount() { return debrisCount; }
	};
	root.SteamWildBall = api;
	if (node) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
