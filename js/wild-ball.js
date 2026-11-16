// The Wild Mine ball player (P2). One rigid body with an onboard battery: deck
// induction charges it, the motor and the jump spend it, and a contact is
// either a roll (no damage) or a hit (restitution, contact-force damage, the
// chamber's 10% loss) by the surface curvature and the normal speed (D5).
//
// The ball owns its share of the one energy ledger: translational and
// rotational energy on the ball, the charge in its battery, the fracture energy
// it puts into the cave and the heat it gives up all pass through `bookMech`,
// so `physics.totalEnergy` stays exact while `cave.weaken` owns the rock.
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

	// D5: a contact rolls while the surface turns less than 30 degrees across one
	// ball diameter and the normal closing speed stays under 0.35 m/s.
	const curvatureLimit = Math.PI / 6;
	const bounceFloor = 0.35;
	// D2: a hit keeps 90% of its normal energy.
	const restitution = Math.sqrt(0.9);
	// D1: the ball's own engine. The capacity is about seven seconds of full
	// throttle or twenty jumps, and a deck charge refills it in five seconds.
	const batteryCapacity = 300;
	const chargePower = 60;
	const chargeEfficiency = 0.85;
	const motorAcceleration = 3.2;
	const motorTopSpeed = 5;
	const motorEfficiency = 0.8;
	const jumpSpeed = 2.6;
	const jumpEfficiency = 0.8;
	const launchSpeed = 3.2;
	const launchEfficiency = 0.8;
	// D4: frictionless rolling never settles, so a small resistance does.
	const rollingResistance = 0.35;
	const releaseCooldownTime = 0.5;
	const contactSlop = 0.012;
	const leaveSpeed = 0.02;

	// Debris is outside the ball's ledger: a removed cell's potential energy was
	// never counted for the cave, exactly as a platform's own height is not. A
	// fragment is one cell, coloured by its own mix, and rests on the SDF face it
	// meets at any orientation unless that face is steeper than `debrisSteep`.
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
	// The deck is one capsule: a segment across the platform top, rounded at its
	// ends. This scratch is the only allocation-free way to ask it twice (the
	// step and the release) and get the same answer.
	const deckHit = { hit: false, nx: 0, ny: 1, lny: 0, distance: 0, clampedX: 0, push: 0 };
	const mixScratch = new Float32Array(rockTable.mineralCount);
	const elementScratch = new Float32Array(3);
	const rgbScratch = new Float64Array(3);

	function radiusOf(ball) {
		return phys().config.radius;
	}

	function massOf(ball) {
		return phys().ballMassFor(ball);
	}

	// I/m = 2/5 r^2, the only rotational constant the contact solver needs.
	function inertiaShare(ball) {
		const r = radiusOf(ball);
		return 0.4 * r * r;
	}

	// Where the ball is against the deck capsule. Both the step's contact and the
	// release's placement read this one query.
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
		let lnx;
		let lny;
		if (distance > 1e-6) {
			lnx = ex / distance;
			lny = ey / distance;
		} else {
			lnx = 0;
			lny = 1;
		}
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

	// Translational + rotational + gravitational energy; a held ball contributes
	// none of it, exactly as a caught ball in the chamber.
	function mechanicalEnergy(ball) {
		if (!ball || ball.state === 'held') return 0;
		const m = massOf(ball);
		const speed = ball.vx * ball.vx + ball.vy * ball.vy;
		const gravity = phys().config.ballGravity;
		return m * (0.5 * speed + gravity * (ball.y - radiusOf(ball))) + 0.5 * m * inertiaShare(ball) * ball.omega * ball.omega;
	}

	// One booking for every mechanical change the ball does not take from rock:
	// work by machinery outside the ledger or heat. Battery and fracture energy
	// are booked where they move.
	function bookMech(world, before, after) {
		const delta = after - before;
		if (delta > 0) world.importedEnergy += delta;
		else world.heat -= delta;
	}

	// A snap or push-out along a normal changes the ball's height without any
	// velocity doing the work, so the potential difference is booked here.
	function bookLift(world, ball, dy) {
		if (!dy) return;
		const delta = massOf(ball) * phys().config.ballGravity * dy;
		if (delta > 0) world.importedEnergy += delta;
		else world.heat -= delta;
	}

	// The chamber's own damage rule, over the cave: gain and radius are the
	// installed ball's, so the numbers stay comparable across the two modes.
	function weakenRock(world, cave, x, y, budget) {
		if (!(budget > 0)) return 0;
		const ceiling = chamber();
		const gain = ceiling ? ceiling.damageMultiplierNow('rig') : 2;
		const radius = ceiling ? ceiling.damageRadiusNow('rig') : 8.775;
		return Math.min(budget, cave.weaken(x, y, budget * gain, gain, radius));
	}

	// ---- ball state -------------------------------------------------------

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
		ball.releaseCooldown = 0;
		ball.contact = CONTACT_NONE;
		ball.deckContact = false;
		ball.hits = 0;
		ball.bounces = 0;
		ball.lastImpact = 0;
		ball.lastFracture = 0;
		ball.lastCharge = 0;
		return ball;
	}

	function setMotor(world, direction) {
		const ball = activeBall(world);
		if (!ball) return 0;
		ball.motor = direction > 0 ? 1 : direction < 0 ? -1 : 0;
		return ball.motor;
	}

	function requestJump(world) {
		const ball = activeBall(world);
		if (!ball || ball.state === 'held') return false;
		ball.jump = true;
		return true;
	}

	// ---- contacts ---------------------------------------------------------

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

	// D5's curvature half: the normal across one ball diameter. A convex corner
	// tighter than the radius turns further than the limit and is a wall.
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

	// D4: no-slip in one step without billing the ledger. The pair (v_t, omega)
	// shares its kinetic energy; solving v_t = omega r with the same total gives
	// the split below, so a slide becomes a roll for free and the drawn spin is
	// always the roll the ball is really in.
	function settleRoll(ball, nx, ny) {
		const r = radiusOf(ball);
		let tx = ny;
		let ty = -nx;
		if (tx < 0) { tx = -tx; ty = -ty; }
		const vt = ball.vx * tx + ball.vy * ty;
		const share = inertiaShare(ball);
		const omega = Math.sqrt((vt * vt + share * ball.omega * ball.omega) / (r * r + share));
		let sign;
		if (vt > 1e-9) sign = 1;
		else if (vt < -1e-9) sign = -1;
		else sign = ball.omega >= 0 ? 1 : -1;
		ball.omega = sign * omega;
		const delta = ball.omega * r - vt;
		ball.vx += delta * tx;
		ball.vy += delta * ty;
	}

	function rollResistance(world, ball, nx, ny, dt) {
		let tx = ny;
		let ty = -nx;
		if (tx < 0) { tx = -tx; ty = -ty; }
		const vt = ball.vx * tx + ball.vy * ty;
		const speed = Math.abs(vt);
		if (!(speed > 0)) return;
		const keep = speed - Math.min(speed, rollingResistance * dt);
		world.heat += 0.5 * massOf(ball) * (speed * speed - keep * keep);
		const delta = -Math.sign(vt) * (speed - keep);
		ball.vx += delta * tx;
		ball.vy += delta * ty;
	}

	// Torque from the battery: an acceleration along the contact tangent, priced
	// by the exact change in the tangential kinetic energy it buys.
	function driveMotor(world, ball, nx, ny, dt) {
		const direction = ball.motor;
		if (!direction || !(ball.battery > 0)) return;
		let tx = ny;
		let ty = -nx;
		if (tx < 0) { tx = -tx; ty = -ty; }
		const vt = ball.vx * tx + ball.vy * ty;
		if (vt * direction >= motorTopSpeed) return;
		const m = massOf(ball);
		let accel = motorAcceleration;
		if (vt * direction + accel * dt > motorTopSpeed) accel = (motorTopSpeed - vt * direction) / dt;
		let delta = accel * dt * direction;
		let useful = 0.5 * m * ((vt + delta) * (vt + delta) - vt * vt);
		if (useful > 0) {
			const cost = useful / motorEfficiency;
			if (cost > ball.battery) {
				delta *= ball.battery / cost;
				useful = 0.5 * m * ((vt + delta) * (vt + delta) - vt * vt);
			}
			if (useful > 0) {
				const paid = useful / motorEfficiency;
				ball.battery -= paid;
				world.heat += paid - useful;
			}
		}
		ball.vx += delta * tx;
		ball.vy += delta * ty;
	}

	function jumpImpulse(world, ball, nx, ny) {
		if (!(ball.battery > 0)) return false;
		const useful = 0.5 * massOf(ball) * jumpSpeed * jumpSpeed;
		const cost = useful / jumpEfficiency;
		if (cost > ball.battery) return false;
		ball.battery -= cost;
		world.heat += cost - useful;
		ball.vx += jumpSpeed * nx;
		ball.vy += jumpSpeed * ny;
		return true;
	}

	// ---- ball step --------------------------------------------------------

	function rollStep(world, cave, ball, r, dt) {
		cave.normalAt(ball.x, ball.y, rockNormal);
		const nx = rockNormal.nx;
		const ny = rockNormal.ny;
		const vn = ball.vx * nx + ball.vy * ny;
		if (vn > leaveSpeed) {
			ball.contact = CONTACT_NONE;
			airStep(world, cave, ball, r, dt);
			return;
		}
		ball.contact = CONTACT_ROCK;
		if (vn !== 0) {
			// The surface holds the ball: the normal part of the step's motion is
			// absorbed by the contact, and the energy it carried is heat.
			world.heat += 0.5 * massOf(ball) * vn * vn;
			ball.vx -= vn * nx;
			ball.vy -= vn * ny;
		}
		if (ball.jump) {
			ball.jump = false;
			// The impulse is instantaneous: the rest of this step belongs to the
			// flight, so the next step is a projectile and books its own gravity.
			if (jumpImpulse(world, ball, nx, ny)) {
				ball.contact = CONTACT_NONE;
				return;
			}
		}
		const startVx = ball.vx;
		const startVy = ball.vy;
		const gravity = phys().config.ballGravity;
		ball.vx += gravity * ny * nx * dt;
		ball.vy -= gravity * nx * nx * dt;
		driveMotor(world, ball, nx, ny, dt);
		rollResistance(world, ball, nx, ny, dt);
		settleRoll(ball, nx, ny);
		// Trapezoidal travel: the gravity work over the step then matches the
		// potential change exactly instead of drifting with Euler's error.
		ball.x += 0.5 * (startVx + ball.vx) * dt;
		ball.y += 0.5 * (startVy + ball.vy) * dt;
		const distance = cave.sdfAt(ball.x, ball.y);
		if (distance < r) {
			cave.normalAt(ball.x, ball.y, rockNormal);
			const push = r - distance;
			ball.x += push * rockNormal.nx;
			ball.y += push * rockNormal.ny;
			bookLift(world, ball, push * rockNormal.ny);
		}
		ball.spin += ball.omega * dt;
	}

	// One response for a traced hit and for a contact that is already touching at
	// the start of the step. A slow (or flat) touch rolls; anything faster is a
	// hit whose lost normal energy is the fracture budget, booked against what the
	// rock really gave up with the rest as heat. The caller places the ball on the
	// contact point first.
	function resolveContact(world, cave, ball, nx, ny, r) {
		ball.contact = CONTACT_NONE;
		const vn = ball.vx * nx + ball.vy * ny;
		if (!(vn < 0)) return;
		const impact = -vn;
		ball.lastImpact = impact;
		const m = massOf(ball);
		if (impact <= bounceFloor && !curvatureExceeds(cave, ball.x, ball.y, nx, ny, r)) {
			// A roll: the surface takes the normal motion, no fracture energy.
			world.heat += 0.5 * m * vn * vn;
			ball.vx -= vn * nx;
			ball.vy -= vn * ny;
			ball.contact = CONTACT_ROCK;
			settleRoll(ball, nx, ny);
			return;
		}
		// D3: the impact's lost normal energy is the fracture budget.
		const budget = 0.5 * m * vn * vn * (1 - restitution * restitution);
		const removed = weakenRock(world, cave, ball.x - nx * r, ball.y - ny * r, budget);
		const spent = Math.min(budget, removed);
		world.fractureEnergy += spent;
		world.heat += budget - spent;
		ball.lastFracture = spent;
		ball.hits++;
		spawnRemoved(cave);
		ball.vx -= (1 + restitution) * vn * nx;
		ball.vy -= (1 + restitution) * vn * ny;
		settleRoll(ball, nx, ny);
		ball.contact = ball.vx * nx + ball.vy * ny < bounceFloor ? CONTACT_ROCK : CONTACT_NONE;
	}

	function airStep(world, cave, ball, r, dt) {
		const gravity = phys().config.ballGravity;
		const contact = cave.traceCircle(ball.x, ball.y, ball.vx, ball.vy, dt, r, gravity, trace);
		ball.contact = CONTACT_NONE;
		if (!(contact.time <= dt)) {
			ball.x += ball.vx * dt;
			ball.y += ball.vy * dt - 0.5 * gravity * dt * dt;
			ball.vy -= gravity * dt;
			ball.spin += ball.omega * dt;
			return;
		}
		if (contact.time > 0) {
			// The contact lands inside the step: fly to it, then respond. The ball
			// is lifted from the ballistic flight line to the contact centre, so
			// that lift is booked like any other change of height.
			const flightY = ball.y + ball.vy * contact.time - 0.5 * gravity * contact.time * contact.time;
			ball.x = contact.x;
			ball.y = contact.y;
			ball.vy -= gravity * contact.time;
			bookLift(world, ball, ball.y - flightY);
			ball.spin += ball.omega * contact.time;
			resolveContact(world, cave, ball, contact.nx, contact.ny, r);
			return;
		}
		// Touching or overlapping at the start of the step: the query hands back
		// the separated centre. Resolve the contact there (a deep overlap still
		// has to punch rock) and fly the rest of the step from it, so a crevice
		// narrower than the ball cannot pump the normal speed up.
		bookLift(world, ball, contact.y - ball.y);
		ball.x = contact.x;
		ball.y = contact.y;
		resolveContact(world, cave, ball, contact.nx, contact.ny, r);
		ball.x += ball.vx * dt;
		ball.y += ball.vy * dt - 0.5 * gravity * dt * dt;
		ball.vy -= gravity * dt;
		ball.spin += ball.omega * dt;
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
		// The contact point rides the machine: its velocity is the plate's drive
		// plus its pitch rate about the plate centre.
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
		if (vn < 0) {
			const before = mechanicalEnergy(ball);
			ball.vx -= (1 + restitution) * vn * hit.nx;
			ball.vy -= (1 + restitution) * vn * hit.ny;
			bookMech(world, before, mechanicalEnergy(ball));
			ball.bounces++;
		}
		// The deck's tangential motion spins the ball; settleRoll does that at
		// fixed energy, so a deck contact can never mint rotation.
		settleRoll(ball, hit.nx, hit.ny);
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
			ball.releaseCooldown -= dt;
			if (ball.releaseCooldown < 0) ball.releaseCooldown = 0;
		}
		if (ball.state === 'held') {
			phys().setHeldBallPose(world, ball);
			ball.omega = 0;
			ball.spin = 0;
			ball.contact = CONTACT_NONE;
			ball.deckContact = true;
			ball.lastCharge = 0;
			charge(world, ball, dt);
			return;
		}
		ball.lastCharge = 0;
		const r = radiusOf(ball);
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

	// The release places the ball on the reflector face and lets the ball's own
	// engine kick it along the face normal; the tilt therefore aims the shot.
	function launch(world, target, machine) {
		const ball = target || activeBall(world);
		if (!canLaunch(world, ball)) return false;
		const p = phys();
		const holder = machine || p.machineById(world, ball.holder);
		const plate = p.machineBody(holder);
		const baseAngle = plate.angle;
		const faceAngle = baseAngle + p.machinePistonAngle(holder);
		const r = radiusOf(ball);
		// The ball leaves the deck at the reflector's own station, so every tilt
		// releases from above the machine and aims the kick instead of starting
		// the shot inside the hull.
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
		ball.jump = false;
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
		// The lift onto the face is work by the deck, so it is imported energy;
		// the kick itself came from the battery and is already booked.
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
				// Too steep to hold: the fragment keeps sliding down the face.
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
			state.hits = 0;
			return state;
		}
		state.battery = ball.battery || 0;
		state.speed = Math.hypot(ball.vx, ball.vy);
		state.omega = ball.omega || 0;
		state.contact = ball.state === 'held' || ball.deckContact ? CONTACT_DECK : ball.contact;
		state.hits = ball.hits || 0;
		return state;
	}

	const api = {
		CONTACT_NONE, CONTACT_ROCK, CONTACT_DECK,
		curvatureLimit, bounceFloor, restitution,
		batteryCapacity, chargePower, chargeEfficiency, motorAcceleration, motorTopSpeed,
		jumpSpeed, launchSpeed, rollingResistance, maxDebris,
		debrisRestingShare: debrisRadiusShare, debrisFriction, debrisSteep,
		init, step, setMotor, requestJump, canLaunch, launch, readouts, state,
		mechanicalEnergy,
		debrisX, debrisY, debrisSize, debrisRed, debrisGreen, debrisBlue, debrisActive, debrisResting,
		get debrisCount() { return debrisCount; }
	};
	root.SteamWildBall = api;
	if (node) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
