// The Wild Mine ball player (P2). One rigid sphere (I = 2/5 m r^2) with an
// onboard battery: deck induction charges it, the motor applies spin torque on
// surfaces and in mid-air, the jump actuator toggles powered bounce pulses like
// the platform's reflector drive, and bounce recycling actively damps rebounds
// to return part of the energy to the battery like regenerative braking.
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
	// D2: a passive hit keeps 90% of its normal energy.
	const restitution = Math.sqrt(0.9);
	// D4: Coulomb friction couples spin and tangential velocity on bounce and roll;
	// rolling resistance settles a coasting roll into heat.
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
	const launchSpeed = 3.2;
	const launchEfficiency = 0.8;

	// Bounce recuperation mirrors the platform's brake flywheel (55% recovery at
	// 90% efficiency): active damping removes most of each rebound, stores the
	// recovered share in the ball battery, and vents the remainder as heat.
	const recycleDamping = 0.88;
	const recycleRecovery = 0.55;
	const recycleEfficiency = 0.9;

	const releaseCooldownTime = 0.5;
	const contactSlop = 0.012;
	const leaveSpeed = 0.02;

	// Debris is outside the ball's ledger: a removed cell's potential energy was
	// never counted for the cave, exactly as a platform's own height is not.
	const maxDebris = 512;
	const debrisRestitution = 0.2;
	const debrisFriction = 0.72;
	const debrisSteep = 0.6;
	const debrisRadiusShare = 0.5;
	const debrisX = new Float64Array(maxDebris);
	const debrisY = new Float64Array(maxDebris);
	const debrisVx = new Float64Array(maxDebris);
	const debrisVy = new Float64Array(maxDebris);
	const debrisSize = new Float64Array(maxDebris);
	const debrisRed = new Uint8Array(maxDebris);
	const debrisGreen = new Uint8Array(maxDebris);
	const debrisBlue = new Uint8Array(maxDebris);
	const debrisActive = new Uint8Array(maxDebris);
	const debrisResting = new Uint8Array(maxDebris);
	let debrisCount = 0;
	let debrisCursor = 0;

	const rockNormal = { nx: 0, ny: 1 };
	const trace = { time: Infinity, x: 0, y: 0, nx: 0, ny: 1 };
	const deckHit = { hit: false, nx: 0, ny: 1, lny: 0, distance: 0, clampedX: 0, push: 0 };
	const mixScratch = new Float32Array(rockTable.mineralCount);
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
		const cosine = Math.cos(plate.angle);
		const sine = Math.sin(plate.angle);
		const dx = x - plate.x;
		const dy = y - plate.y;
		const lx = dx * cosine + dy * sine;
		const ly = -dx * sine + dy * cosine;
		const half = phys().config.platformWidth * 0.5;
		const deck = phys().config.deck;
		const clampedX = lx < -half ? -half : lx > half ? half : lx;
		const ex = lx - clampedX;
		const ey = ly - deck;
		const distance = Math.hypot(ex, ey);
		deckHit.clampedX = clampedX;
		deckHit.distance = distance;
		deckHit.hit = distance < r;
		if (!deckHit.hit) return deckHit;
		const lnx = distance > 1e-6 ? ex / distance : 0;
		const lny = distance > 1e-6 ? ey / distance : 1;
		deckHit.nx = lnx * cosine - lny * sine;
		deckHit.ny = lnx * sine + lny * cosine;
		deckHit.lny = lny;
		deckHit.push = r - distance;
		return deckHit;
	}

	function activeBall(world) {
		if (!world || !world.balls || world.balls.length === 0) return null;
		return world.balls[0];
	}

	function weakenRock(world, cave, x, y, budget) {
		if (!(budget > 0)) return 0;
		const ceiling = chamber();
		const gain = ceiling ? ceiling.damageMultiplierNow('rig') : 2;
		const radius = ceiling ? ceiling.damageRadiusNow('rig') : 8.775;
		return Math.min(budget, cave.weaken(x, y, budget * gain, gain, radius));
	}

	// ---- ball state & commands --------------------------------------------

	function init(world) {
		debrisActive.fill(0);
		debrisResting.fill(0);
		debrisCount = 0;
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

	function rollStep(world, cave, ball, r, dt) {
		cave.normalAt(ball.x, ball.y, rockNormal);
		const nx = rockNormal.nx;
		const ny = rockNormal.ny;
		const vn = ball.vx * nx + ball.vy * ny;
		if (vn > leaveSpeed || ny <= 0) {
			ball.contact = CONTACT_NONE;
			airStep(world, cave, ball, r, dt);
			return;
		}
		if (-vn > bounceFloor) {
			resolveContact(world, cave, ball, nx, ny, r);
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
			const jt = clampImpulse(-tangentMassFactor * m * slip, surfaceFriction * m * gravity * ny * dt);
			vt += jt / m;
			ball.omega -= jt / (inertiaFactor * m * r);
		}
		const speed = Math.abs(vt);
		if (speed > 0 && Math.abs(vt - ball.omega * r) <= 1e-4) {
			const keep = Math.max(0, speed - rollingResistance * ny * dt);
			vt = vt < 0 ? -keep : keep;
			ball.omega = vt / r;
		}
		ball.vx = vt * tx;
		ball.vy = vt * ty;
		// Trapezoidal travel matches slope gravity work to the height change.
		ball.x += 0.5 * (startVx + ball.vx) * dt;
		ball.y += 0.5 * (startVy + ball.vy) * dt;
		bookMech(world, mechBefore, mechanicalEnergy(ball));
		const distance = cave.sdfAt(ball.x, ball.y);
		if (distance < r) {
			cave.normalAt(ball.x, ball.y, rockNormal);
			const push = r - distance;
			ball.x += push * rockNormal.nx;
			ball.y += push * rockNormal.ny;
			bookLift(world, ball, push * rockNormal.ny);
		}
		ball.spin += 0.5 * (startOmega + ball.omega) * dt;
	}

	function resolveContact(world, cave, ball, nx, ny, r) {
		ball.contact = CONTACT_NONE;
		const vn = ball.vx * nx + ball.vy * ny;
		if (!(vn < 0)) return;
		const impact = -vn;
		ball.lastImpact = impact;
		const m = massOf(ball);
		const smooth = !curvatureExceeds(cave, ball.x, ball.y, nx, ny, r);
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
			return;
		}
		// D3: the passive bounce's 10% normal loss is always the fracture budget.
		const before = kineticEnergy(ball);
		const inboundEnergy = 0.5 * m * vn * vn;
		const budget = inboundEnergy * (1 - restitution * restitution);
		const removed = weakenRock(world, cave, ball.x - nx * r, ball.y - ny * r, budget);
		const spent = Math.min(budget, removed);
		world.fractureEnergy += spent;
		world.heat += budget - spent;
		ball.lastFracture = spent;
		ball.hits++;
		spawnRemoved(cave);
		let outVn = restitution * impact;
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
	}

	function advanceAirSpin(world, ball, duration) {
		if (!(duration > 0)) return;
		const startOmega = ball.omega;
		stepSpinMotor(world, ball, duration);
		ball.spin += 0.5 * (startOmega + ball.omega) * duration;
	}

	function airStep(world, cave, ball, r, dt) {
		const gravity = phys().config.ballGravity;
		const contact = cave.traceCircle(ball.x, ball.y, ball.vx, ball.vy, dt, r, gravity, trace);
		ball.contact = CONTACT_NONE;
		if (!(contact.time <= dt)) {
			ball.x += ball.vx * dt;
			ball.y += ball.vy * dt - 0.5 * gravity * dt * dt;
			ball.vy -= gravity * dt;
			advanceAirSpin(world, ball, dt);
			return;
		}
		if (contact.time > 0) {
			const flightY = ball.y + ball.vy * contact.time - 0.5 * gravity * contact.time * contact.time;
			ball.x = contact.x;
			ball.y = contact.y;
			ball.vy -= gravity * contact.time;
			bookLift(world, ball, ball.y - flightY);
			advanceAirSpin(world, ball, contact.time);
			resolveContact(world, cave, ball, contact.nx, contact.ny, r);
			if (ball.contact === CONTACT_NONE) advanceAirSpin(world, ball, dt - contact.time);
			return;
		}
		bookLift(world, ball, contact.y - ball.y);
		ball.x = contact.x;
		ball.y = contact.y;
		resolveContact(world, cave, ball, contact.nx, contact.ny, r);
		if (ball.contact === CONTACT_ROCK) {
			rollStep(world, cave, ball, r, dt);
			return;
		}
		ball.x += ball.vx * dt;
		ball.y += ball.vy * dt - 0.5 * gravity * dt * dt;
		ball.vy -= gravity * dt;
		advanceAirSpin(world, ball, dt);
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
		const deck = phys().config.deck;
		const rx = hit.clampedX * cosine - deck * sine;
		const ry = hit.clampedX * sine + deck * cosine;
		const surfaceVx = plate.stepVx - plate.stepOmega * ry;
		const surfaceVy = plate.stepVy + plate.stepOmega * rx;
		const relativeVx = ball.vx - surfaceVx;
		const relativeVy = ball.vy - surfaceVy;
		const vn = relativeVx * hit.nx + relativeVy * hit.ny;
		const m = massOf(ball);
		let normalImpulse = m * phys().config.ballGravity * Math.max(0, hit.ny) * dt;
		if (vn < 0) {
			const before = mechanicalEnergy(ball);
			const passiveOut = -restitution * vn;
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
			normalImpulse += m * (outVn - vn);
			ball.bounces++;
		}
		applyDeckFriction(world, ball, hit.nx, hit.ny, surfaceVx, surfaceVy, normalImpulse);
		if (!ball.deckContact) return;
		charge(world, ball, dt);
		if (!(ball.releaseCooldown > 0)) capture(world, ball);
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
		stepDebris(world, cave, dt);
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
		const touching = ball.contact === CONTACT_ROCK && cave.sdfAt(ball.x, ball.y) <= r + contactSlop;
		if (touching) rollStep(world, cave, ball, r, dt);
		else airStep(world, cave, ball, r, dt);
		deckStep(world, ball, r, dt);
		if (ball.contact === CONTACT_ROCK && cave.sdfAt(ball.x, ball.y) > r + contactSlop) ball.contact = CONTACT_NONE;
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
		const seatY = p.config.deck + r;
		ball.x = plate.x + cosine * p.config.pistonCentre - sine * seatY;
		ball.y = plate.y + sine * p.config.pistonCentre + cosine * seatY;
		ball.holder = null;
		ball.state = 'flying';
		ball.vx = plate.stepVx;
		ball.vy = plate.stepVy;
		ball.omega = 0;
		ball.spin = 0;
		ball.contact = CONTACT_NONE;
		ball.deckContact = false;
		ball.releaseCooldown = releaseCooldownTime;
		let useful = 0;
		const m = massOf(ball);
		const cost = 0.5 * m * launchSpeed * launchSpeed / launchEfficiency;
		if (ball.battery >= cost) {
			useful = cost * launchEfficiency;
			ball.battery -= cost;
			world.heat += cost - useful;
			ball.vx += -Math.sin(faceAngle) * launchSpeed;
			ball.vy += Math.cos(faceAngle) * launchSpeed;
		}
		world.importedEnergy += Math.max(0, mechanicalEnergy(ball) - useful);
		holder.pistonOffset = p.config.pistonTravel * 0.6;
		holder.pistonVelocity = 0;
		world.pushes++;
		world.lastPush = useful;
		return true;
	}

	// ---- debris -----------------------------------------------------------

	function spawnFragment(cave, column, row) {
		const index = debrisCursor;
		debrisCursor = (debrisCursor + 1) % maxDebris;
		if (!debrisActive[index]) debrisCount++;
		debrisActive[index] = 1;
		debrisResting[index] = 0;
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
	}

	function spawnRemoved(cave) {
		const count = cave.removedCount;
		for (let i = 0; i < count; i++) spawnFragment(cave, cave.removedColumn[i], cave.removedRow[i]);
	}

	function stepDebris(world, cave, dt) {
		if (!debrisCount) return;
		const gravity = phys().config.gravity;
		for (let i = 0; i < maxDebris; i++) {
			if (!debrisActive[i] || debrisResting[i]) continue;
			debrisVy[i] -= gravity * dt;
			debrisX[i] += debrisVx[i] * dt;
			debrisY[i] += debrisVy[i] * dt;
			const half = debrisSize[i] * debrisRadiusShare;
			const distance = cave.sdfAt(debrisX[i], debrisY[i]);
			if (!(distance < half)) continue;
			cave.normalAt(debrisX[i], debrisY[i], rockNormal);
			const nx = rockNormal.nx;
			const ny = rockNormal.ny;
			debrisX[i] += (half - distance) * nx;
			debrisY[i] += (half - distance) * ny;
			const vn = debrisVx[i] * nx + debrisVy[i] * ny;
			if (vn < 0) {
				debrisVx[i] -= (1 + debrisRestitution) * vn * nx;
				debrisVy[i] -= (1 + debrisRestitution) * vn * ny;
			}
			debrisVx[i] *= debrisFriction;
			debrisVy[i] *= debrisFriction;
			if (Math.abs(nx) > debrisSteep) {
				debrisVx[i] += gravity * ny * nx * dt;
				debrisVy[i] -= gravity * nx * nx * dt;
				continue;
			}
			debrisResting[i] = 1;
			debrisVx[i] = 0;
			debrisVy[i] = 0;
		}
	}

	// ---- readouts ---------------------------------------------------------

	const state = {
		battery: 0, speed: 0, omega: 0, contact: CONTACT_NONE,
		jump: false, recycle: false, recycled: 0,
		hits: 0, debris: 0, restingDebris: 0
	};

	function readouts(world) {
		const ball = activeBall(world);
		state.debris = debrisCount;
		let resting = 0;
		for (let i = 0; i < maxDebris; i++) if (debrisActive[i] && debrisResting[i]) resting++;
		state.restingDebris = resting;
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
		inertiaFactor, curvatureLimit, bounceFloor, restitution,
		surfaceFriction, rollingResistance,
		batteryCapacity, chargePower, chargeEfficiency,
		motorAcceleration, motorTopSpeed, motorFreeSpeed, motorEfficiency,
		jumpSpeed, jumpEfficiency, launchSpeed, launchEfficiency,
		recycleDamping, recycleRecovery, recycleEfficiency,
		maxDebris, debrisRestingShare: debrisRadiusShare, debrisFriction, debrisSteep,
		init, step, setMotor, setJump, toggleJump, setRecycle, toggleRecycle,
		canLaunch, launch, readouts, state, mechanicalEnergy,
		debrisX, debrisY, debrisSize, debrisRed, debrisGreen, debrisBlue, debrisActive, debrisResting,
		get debrisCount() { return debrisCount; }
	};
	root.SteamWildBall = api;
	if (node) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
