'use strict';
// Wild Mine M2 physics, D7 perspective warp, D8 camera follow, hull terrain
// collision, ±90° piston tilt and mode switching.
const assert = require('node:assert/strict');
const { test } = require('node:test');

const rockTable = require('../js/minerals.js');
const ceiling = require('../js/ceiling.js');
const physics = require('../js/physics.js');
const players = require('../js/players.js');
const wildMine = require('../js/wild-mine.js');

function resetClassic() {
	wildMine.setMode('classic');
	const world = physics.createWorld();
	players.init(world);
	return world;
}

test('Wild Mine mode switches between Classic and Wild cleanly with distinct piston bounds', () => {
	try {
		const classicWorld = resetClassic();
		assert.equal(physics.wildMode(), false);
		assert.equal(wildMine.isWild(), false);
		assert.ok(Math.abs(physics.pistonMaxAngleNow() - 10 * Math.PI / 180) < 1e-12);
		players.setPistonAngleOf(players.state.players[0], Math.PI / 2);
		assert.ok(Math.abs(players.pistonAngleOf(players.state.players[0]) - 10 * Math.PI / 180) < 1e-12);

		wildMine.setMode('wild');
		const world = physics.createWorld();
		players.init(world, 0);
		wildMine.init(world, { seed: 1 });
		assert.equal(physics.wildMode(), true);
		assert.equal(wildMine.isWild(), true);
		assert.equal(players.state.players.length, 1);
		assert.ok(Math.abs(physics.pistonMaxAngleNow() - Math.PI / 2) < 1e-12);

		players.setPistonAngleOf(players.state.players[0], Math.PI / 2);
		assert.ok(Math.abs(players.pistonAngleOf(players.state.players[0]) - Math.PI / 2) < 1e-12);
		players.setPistonAngleOf(players.state.players[0], -Math.PI * 0.75);
		assert.ok(Math.abs(players.pistonAngleOf(players.state.players[0]) + Math.PI / 2) < 1e-12);
	} finally {
		resetClassic();
	}
});

test('D7 vertical perspective anchors at 1.0x near P2, eases to minScale at scaleSpan, and round-trips exactly', () => {
	const anchorY = 32;
	assert.equal(wildMine.scaleAt(anchorY, anchorY), 1);
	assert.equal(wildMine.drawnY(anchorY, anchorY), anchorY);
	assert.equal(wildMine.scaleAt(anchorY + wildMine.scaleSpan, anchorY), wildMine.minScale);
	assert.equal(wildMine.scaleAt(anchorY - wildMine.scaleSpan, anchorY), wildMine.minScale);
	assert.equal(wildMine.scaleAt(anchorY + wildMine.scaleSpan * 2, anchorY), wildMine.minScale);

	let previousDrawn = -Infinity;
	for (let y = 0; y <= 64; y += 0.25) {
		const d = wildMine.drawnY(y, anchorY);
		assert.ok(d > previousDrawn, `drawnY strictly monotonic at y=${y}`);
		previousDrawn = d;
		const recovered = wildMine.worldY(d, anchorY);
		assert.ok(Math.abs(recovered - y) < 1e-9, `worldY(drawnY(${y})) = ${recovered}`);
	}
});

test('D8 camera tracks player smoothly and updates anchorY cleanly without abrupt snaps', () => {
	try {
		wildMine.setMode('wild');
		const world = physics.createWorld();
		players.init(world, 0);
		wildMine.init(world, { seed: 4 });
		const startCamX = wildMine.camera.x;
		const startAnchorY = wildMine.camera.anchorY;
		world.drive = true;
		world.direction = 1;
		world.forceSetting = 1;
		for (let i = 0; i < 240; i++) physics.step(world, physics.config.step);
		assert.ok(wildMine.camera.x > startCamX + 0.5, 'camera follows rig rightward');
		assert.ok(Math.abs(wildMine.camera.x - world.platform.x) < 4, 'camera stays bounded near rig');
		assert.ok(Math.abs(wildMine.camera.anchorY - startAnchorY) < 4, 'anchorY moves smoothly with P2');
	} finally {
		resetClassic();
	}
});

test('Wild Mine starts clear on shelf across seeds 1-5 and drives back and forth preserving energy', () => {
	try {
		wildMine.setMode('wild');
		for (let seed = 1; seed <= 5; seed++) {
			const world = physics.createWorld();
			players.init(world, 0);
			wildMine.init(world, { seed });
			assert.equal(wildMine.hullClear(world.platform.x, world.platform.y), true, `seed ${seed} start hull clear`);
			assert.equal(world.ball.state, 'held', `seed ${seed} holds P2 at start`);

			world.drive = true;
			world.forceSetting = 0.8;
			world.direction = 1;
			for (let i = 0; i < 180; i++) physics.step(world, physics.config.step);
			const rightX = world.platform.x;
			assert.ok(rightX > 0.5, `seed ${seed} drove right (${rightX})`);
			assert.equal(wildMine.hullClear(world.platform.x, world.platform.y), true, `seed ${seed} clear right`);

			world.direction = -1;
			for (let i = 0; i < 480; i++) physics.step(world, physics.config.step);
			assert.ok(world.platform.x < rightX - 0.5, `seed ${seed} drove back left (${world.platform.x} < ${rightX})`);
			assert.equal(wildMine.hullClear(world.platform.x, world.platform.y), true, `seed ${seed} clear left`);
			const drift = Math.abs(physics.totalEnergy(world) - world.initialEnergy);
			assert.ok(drift < 1e-8, `seed ${seed} energy drift ${drift} < 1e-8`);
		}
	} finally {
		resetClassic();
	}
});

test('seed 4 right cliff descent drops below shelf smoothly with clear hull and zero energy drift', () => {
	try {
		wildMine.setMode('wild');
		const world = physics.createWorld();
		players.init(world, 0);
		wildMine.init(world, { seed: 4 });
		const startY = world.platform.y;
		world.drive = true;
		world.forceSetting = 1;
		world.direction = 1;
		for (let i = 0; i < 600; i++) {
			physics.step(world, physics.config.step);
			assert.equal(wildMine.hullClear(world.platform.x, world.platform.y), true, `hullClear at step ${i}`);
		}
		assert.ok(world.platform.x > 6.5, `crossed shelf onto cave (${world.platform.x})`);
		assert.ok(world.platform.y < startY - 1.0, `descended cliff (${startY} -> ${world.platform.y})`);
		const drift = Math.abs(physics.totalEnergy(world) - world.initialEnergy);
		assert.ok(drift < 1e-8, `energy drift ${drift} < 1e-8`);
	} finally {
		resetClassic();
	}
});

test('held ball stays locked to angled piston up to ±90° and cave cell inspection reports solid vs void', () => {
	try {
		wildMine.setMode('wild');
		const world = physics.createWorld();
		players.init(world, 0);
		const cave = wildMine.init(world, { seed: 1 });
		players.setPistonAngleOf(players.state.players[0], Math.PI / 2);
		for (let i = 0; i < 30; i++) physics.step(world, physics.config.step);
		assert.equal(world.ball.state, 'held');
		assert.ok(Math.abs(world.ball.x - world.platform.x) > 0.25, 'held ball tracks 90° tilted piston offset');

		const voidInfo = wildMine.inspectCell(0, cave.columnAt ? Math.round(cave.state.spawnY / cave.state.cell) : 256,
			require('../js/rock-materials.js'), ceiling.state.mineralPrices);
		assert.equal(voidInfo.solid, false);
		const rockInfo = wildMine.inspectCell(0, 10, require('../js/rock-materials.js'), ceiling.state.mineralPrices);
		assert.equal(rockInfo.solid, true);
		assert.ok(rockInfo.initialStrength > 0);
		assert.ok(rockInfo.value > 0);
	} finally {
		resetClassic();
	}
});

// ---- M3: the ball player (D1-D5) -----------------------------------------

const wildBall = require('../js/wild-ball.js');
const wildRubble = require('../js/wild-rubble.js');

function wildWorld(seed) {
	wildMine.setMode('wild');
	const world = physics.createWorld();
	players.init(world, 0);
	const cave = wildMine.init(world, { seed: seed || 1 });
	return { world, cave, ball: world.balls[0] };
}

// Places the one shared ball free in the cave and rebases the ledger on it.
function freeBall(world, cave, x, y, vx, vy) {
	const ball = world.balls[0];
	ball.state = 'flying';
	ball.holder = null;
	ball.x = x;
	ball.y = y;
	ball.vx = vx || 0;
	ball.vy = vy || 0;
	ball.omega = 0;
	ball.spin = 0;
	ball.contact = wildBall.CONTACT_NONE;
	ball.releaseCooldown = 0;
	world.initialEnergy = physics.totalEnergy(world);
	return ball;
}

function ledgerDrift(world) {
	return physics.totalEnergy(world) - world.initialEnergy;
}

function shelfRest(world, cave, x) {
	return cave.floorBelow(x, 31.5) + physics.config.radius;
}

test('M3 release: platform piston powers and aims the ball', () => {
	try {
		const { world, ball } = wildWorld(1);
		assert.equal(physics.wildMode(), true);
		assert.equal(ball.state, 'held');
		assert.equal(physics.canLaunch(world, ball), true);
		world.initialEnergy = physics.totalEnergy(world);
		const before = ball.battery;
		const reserve = world.battery;
		assert.equal(physics.launch(world, ball), true);
		assert.equal(ball.state, 'flying');
		assert.equal(ball.holder, null);
		assert.ok(ball.vy > 3 && Math.abs(ball.vx) < 1e-9, 'a level piston releases straight up');
		const useful = 0.5 * physics.ballMassFor(ball) * ball.vy * ball.vy;
		assert.equal(ball.battery, before, 'launch does not drain the ball battery');
		assert.ok(Math.abs(useful - physics.pulseNow()) < 1e-9);
		assert.ok(Math.abs(reserve - world.battery - useful / physics.engineNow().efficiency) < 1e-9);
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8, 'the lift onto the deck is booked as imported energy');

		const aimed = wildWorld(1);
		players.setPistonAngleOf(players.state.players[0], -Math.PI / 3);
		physics.launch(aimed.world, aimed.ball);
		assert.ok(aimed.ball.vx > 2, 'a right-tilted piston aims the release right');
		assert.ok(aimed.ball.vy > 1, 'and keeps the upward component');
	} finally {
		resetClassic();
	}
});

test('piston reflects and powers a returning ball; collector alone captures it', () => {
	try {
		const run = wildWorld(1);
		const { world, cave, ball } = run;
		const plate = world.platform;
		const r = physics.config.radius;
		freeBall(world, cave, plate.x + physics.config.pistonCentre, plate.y + physics.config.deck + r - 0.01, 0, -2);
		const reserve = world.battery;
		wildBall.step(world, cave, physics.config.step);
		assert.equal(ball.state, 'flying');
		assert.ok(ball.vy > 4, 'powered piston bounces the ball');
		assert.ok(world.battery < reserve);
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8);

		freeBall(world, cave, plate.x - 1.2, plate.y + physics.config.deck + r - 0.01, 0, -2);
		wildBall.step(world, cave, physics.config.step);
		assert.equal(ball.state, 'held', 'collector catches the ball');
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8);
	} finally {
		resetClassic();
	}
});

test('a vertical piston reflects on both sides but powers only a funded front-face hit', () => {
	try {
		const { world, cave, ball } = wildWorld(1);
		const plate = world.platform;
		world.pistonAngle = Math.PI / 2;
		world.battery = 0;
		const r = physics.config.radius;
		const cx = plate.x + physics.config.pistonCentre;
		const cy = plate.y + physics.config.deck;
		freeBall(world, cave, cx - r + 0.01, cy + 0.6, 2, 0);
		wildBall.step(world, cave, physics.config.step);
		assert.equal(ball.state, 'flying');
		assert.ok(ball.vx < -1, 'vertical piston reflects horizontally');
		assert.equal(world.battery, 0);
		assert.equal(world.pushes, 0);
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8);

		world.battery = 100;
		freeBall(world, cave, cx + r - 0.01, cy + 0.6, -2, 0);
		wildBall.step(world, cave, physics.config.step);
		assert.ok(ball.vx > 1, 'the back face reflects passively');
		assert.equal(world.battery, 100);
		assert.equal(world.pushes, 0);
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8);

		freeBall(world, cave, cx - r + 0.01, cy + 0.6, 2, 0);
		wildBall.step(world, cave, physics.config.step);
		assert.ok(ball.vx < -4, 'the charged front face adds a horizontal push');
		assert.equal(world.pushes, 1);
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8);
	} finally {
		resetClassic();
	}
});

test('stock piston pulse delivers substantially more rock fracture than the old launch', () => {
	function hit(speed) {
		const { world, cave, ball } = wildWorld(1);
		const x = 2.8;
		freeBall(world, cave, x, shelfRest(world, cave, x) + 0.05, 0, -speed);
		for (let i = 0; i < 120 && !ball.hits; i++) physics.step(world, physics.config.step);
		assert.ok(ball.hits > 0);
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8);
		return ball.lastFracture;
	}
	try {
		const oldFracture = hit(3.2);
		const newFracture = hit(Math.sqrt(2 * physics.config.pulse / physics.config.ballMass));
		assert.ok(oldFracture > 0);
		assert.ok(newFracture > oldFracture * 2, 'stronger pulse increases actual fracture work');
	} finally {
		resetClassic();
	}
});

test('M3 battery: deck induction charges from the platform reserve, only while the ball is on the deck', () => {
	try {
		const { world, cave, ball } = wildWorld(1);
		ball.battery = 100;
		world.initialEnergy = physics.totalEnergy(world);
		const reserve = world.battery;
		for (let i = 0; i < 240; i++) physics.step(world, physics.config.step);
		const charged = ball.battery - 100;
		assert.ok(charged > wildBall.chargePower * wildBall.chargeEfficiency * 0.9, 'a second on the deck nearly fills at the induction rate');
		assert.ok(charged < wildBall.chargePower * wildBall.chargeEfficiency * 1.1);
		assert.ok(world.battery < reserve, 'the platform reserve pays');
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8);

		freeBall(world, cave, 1.5, 32.4, 0, 0);
		const airborne = ball.battery;
		for (let i = 0; i < 60; i++) physics.step(world, physics.config.step);
		assert.equal(ball.battery, airborne, 'no induction away from the deck');
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8);
	} finally {
		resetClassic();
	}
});

test('M3 motor: spin torque rolls on rock and winds up much faster in frictionless mid-air', () => {
	try {
		const { world, cave, ball } = wildWorld(1);
		const r = physics.config.radius;
		freeBall(world, cave, 1.5, shelfRest(world, cave, 1.5), 0, 0);
		ball.contact = wildBall.CONTACT_ROCK;
		world.initialEnergy = physics.totalEnergy(world);
		const battery = ball.battery;
		wildBall.setMotor(world, 1);
		for (let i = 0; i < 120; i++) physics.step(world, physics.config.step);
		const groundOmega = ball.omega;
		assert.ok(ball.vx > 0.5, 'right torque rolls the ball right');
		assert.ok(groundOmega > 1, 'the roll carries clockwise angular velocity');
		assert.ok(Math.abs(ball.vx - groundOmega * r) < 1e-6, 'flat floor grip locks into pure no-slip rolling');
		assert.ok(ball.x > 1.6, 'the ball travelled');
		assert.ok(ball.battery < battery - 1, 'the motor spends the battery');
		assert.equal(ball.contact, wildBall.CONTACT_ROCK);
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8);

		// Mid-air motor: no ground reaction on vx, but I alone takes the full
		// torque (7/2 = 3.5x faster before rolling resistance) and reaches above
		// motorTopSpeed up to motorFreeSpeed.
		const air = wildWorld(1);
		freeBall(air.world, air.cave, 0, 32.0, 0.4, 1.8);
		const airStartBattery = air.ball.battery;
		wildBall.setMotor(air.world, 1);
		for (let i = 0; i < 120; i++) physics.step(air.world, physics.config.step);
		assert.equal(air.ball.contact, wildBall.CONTACT_NONE, 'still airborne');
		assert.ok(Math.abs(air.ball.vx - 0.4) < 1e-9, 'mid-air spin exerts no horizontal push without contact');
		assert.ok(air.ball.omega > groundOmega * 3.4, 'mid-air spin accelerates >3.4x faster than ground roll');
		assert.ok(air.ball.battery < airStartBattery - 5, 'mid-air spin pays for its rotational energy');
		assert.ok(Math.abs(ledgerDrift(air.world)) < 1e-8);

		for (let i = 0; i < 180 && air.ball.contact === wildBall.CONTACT_NONE; i++) {
			physics.step(air.world, physics.config.step);
		}
		assert.ok(air.ball.omega * r > wildBall.motorTopSpeed + 1.5, 'unloaded mid-air spin exceeds ground motorTopSpeed');
		assert.ok(air.ball.omega * r <= wildBall.motorFreeSpeed + 1e-9, 'free spin respects motorFreeSpeed');

		// Reversing motor in mid-air brakes existing spin into heat without spending battery.
		const rev = wildWorld(1);
		freeBall(rev.world, rev.cave, 0, 32.2, 0, 1.5);
		rev.ball.omega = 25;
		rev.world.initialEnergy = physics.totalEnergy(rev.world);
		const beforeBrake = rev.ball.battery;
		wildBall.setMotor(rev.world, -1);
		for (let i = 0; i < 60; i++) physics.step(rev.world, physics.config.step);
		assert.ok(rev.ball.omega > 0 && rev.ball.omega < 15, 'opposing torque decelerates mid-air spin');
		assert.equal(rev.ball.battery, beforeBrake, 'braking spin draws zero battery');
		assert.ok(Math.abs(ledgerDrift(rev.world)) < 1e-8);
	} finally {
		resetClassic();
	}
});

test('M3 Coulomb bounce friction: spinning bounces transfer spin by normal impulse on floor, wall, ceiling and deck', () => {
	try {
		const r = physics.config.radius;
		const m = physics.config.ballMass;
		const inertia = wildBall.inertiaFactor * m * r * r;

		// 1. Mid-air spin -> hard floor bounce grips to no-slip (vx = omega*r = 2/7 * w0*r)
		// and conserves angular momentum about the contact point.
		const hard = wildWorld(1);
		const floor = shelfRest(hard.world, hard.cave, 2.2);
		freeBall(hard.world, hard.cave, 2.2, floor + 0.01, 0, -4);
		hard.ball.omega = 40;
		hard.world.initialEnergy = physics.totalEnergy(hard.world);
		const contactAngularBefore = inertia * hard.ball.omega + m * r * hard.ball.vx;
		for (let i = 0; i < 8 && hard.ball.hits === 0; i++) physics.step(hard.world, physics.config.step);
		assert.equal(hard.ball.hits, 1);
		const expectedRoll = (2 / 7) * 40 * r;
		assert.ok(Math.abs(hard.ball.vx - expectedRoll) < 0.03, 'hard topspin bounce kicks right to 2/7 w0 r');
		assert.ok(Math.abs(hard.ball.vx - hard.ball.omega * r) < 1e-6, 'full grip settles into vx = omega*r');
		const contactAngularAfter = inertia * hard.ball.omega + m * r * hard.ball.vx;
		assert.ok(Math.abs(contactAngularAfter - contactAngularBefore) < 1e-6, 'angular momentum about contact conserved');
		assert.ok(Math.abs(ledgerDrift(hard.world)) < 1e-8);

		// 2. Same high spin on a gentle bounce exceeds mu*Jn: skids on first bounce,
		// retains surplus spin, and accelerates further on the second bounce.
		const soft = wildWorld(1);
		freeBall(soft.world, soft.cave, 2.2, floor + 0.01, 0, -0.75);
		soft.ball.omega = 44;
		soft.world.initialEnergy = physics.totalEnergy(soft.world);
		for (let i = 0; i < 12 && soft.ball.hits === 0; i++) physics.step(soft.world, physics.config.step);
		assert.equal(soft.ball.hits, 1);
		const firstVx = soft.ball.vx;
		assert.ok(firstVx > 0.8 && firstVx < (2 / 7) * 44 * r - 0.5, 'Coulomb cone caps tangential impulse on a gentle bounce');
		assert.ok(soft.ball.omega * r > firstVx + 2, 'leftover spin stays above linear speed after a skid');
		for (let i = 0; i < 200 && soft.ball.hits === 1; i++) physics.step(soft.world, physics.config.step);
		assert.equal(soft.ball.hits, 2);
		assert.ok(soft.ball.vx > firstVx + 0.5, 'leftover spin bites again on the second bounce');
		assert.ok(Math.abs(ledgerDrift(soft.world)) < 1e-8);

		// 3. Heavy backspin checks forward motion on bounce.
		const back = wildWorld(1);
		freeBall(back.world, back.cave, 2.2, floor + 0.01, 2.5, -4);
		back.ball.omega = -44;
		back.world.initialEnergy = physics.totalEnergy(back.world);
		for (let i = 0; i < 8 && back.ball.hits === 0; i++) physics.step(back.world, physics.config.step);
		assert.ok(back.ball.vx < 0, 'heavy backspin reverses forward bounce');
		assert.ok(Math.abs(ledgerDrift(back.world)) < 1e-8);

		// 4. Oriented tangent across cave faces: clockwise spin (+omega) kicks LEFT
		// off a ceiling (ny = -1) and UP off a right wall (nx = -1).
		const ceil = wildWorld(1);
		const roof = ceil.cave.roofAbove(0, 32);
		freeBall(ceil.world, ceil.cave, 0, roof - r - 0.02, 0, 5);
		ceil.ball.omega = 35;
		ceil.world.initialEnergy = physics.totalEnergy(ceil.world);
		for (let i = 0; i < 10 && ceil.ball.hits === 0; i++) physics.step(ceil.world, physics.config.step);
		assert.ok(ceil.ball.vx < -1, 'clockwise spin hitting ceiling kicks ball left');
		assert.ok(Math.abs(ledgerDrift(ceil.world)) < 1e-8);

		const wallRun = wildWorld(1);
		let wall = NaN;
		for (let x = 2.5; x < 6; x += 0.02) {
			if (wallRun.cave.solidAt(x, 31.5)) { wall = x; break; }
		}
		freeBall(wallRun.world, wallRun.cave, wall - r - 0.04, 31.5, 5, 0);
		wallRun.ball.omega = 35;
		wallRun.world.initialEnergy = physics.totalEnergy(wallRun.world);
		for (let i = 0; i < 10 && wallRun.ball.hits === 0; i++) physics.step(wallRun.world, physics.config.step);
		assert.ok(wallRun.ball.vx < 0 && wallRun.ball.vy > 1, 'clockwise spin hitting right wall climbs upward on rebound');
		assert.ok(Math.abs(ledgerDrift(wallRun.world)) < 1e-8);

		// 5. Spinning deck bounce transfers spin with exact energy balance.
		const deckRun = wildWorld(1);
		freeBall(deckRun.world, deckRun.cave, deckRun.world.platform.x + 0.3,
			deckRun.world.platform.y + physics.config.deck + r + 0.04, 0, -3);
		deckRun.ball.omega = 38;
		deckRun.ball.releaseCooldown = 0.4;
		deckRun.world.initialEnergy = physics.totalEnergy(deckRun.world);
		for (let i = 0; i < 12 && deckRun.ball.bounces === 0; i++) physics.step(deckRun.world, physics.config.step);
		assert.ok(deckRun.ball.vx > 1.5 && deckRun.ball.vy > 2, 'spinning bounce off deck converts spin to forward speed');
		assert.ok(Math.abs(ledgerDrift(deckRun.world)) < 1e-8);
	} finally {
		resetClassic();
	}
});

test('M3 friction: motor-off spin on land and against a wall dies instead of freewheeling', () => {
	try {
		const dt = physics.config.step;
		const r = physics.config.radius;

		// Open shelf: leftover spin couples into a roll, then rolling resistance
		// and restSpeed sleep stop both translation and omega.
		const coast = wildWorld(1);
		const floor = shelfRest(coast.world, coast.cave, 0);
		freeBall(coast.world, coast.cave, 0, floor, 0, 0);
		coast.ball.omega = 8;
		coast.ball.contact = wildBall.CONTACT_ROCK;
		coast.world.initialEnergy = physics.totalEnergy(coast.world);
		for (let i = 0; i < 240 * 4; i++) physics.step(coast.world, dt);
		assert.ok(Math.abs(coast.ball.vx) < wildBall.restSpeed, 'coasting translation stops on the shelf');
		assert.ok(Math.abs(coast.ball.omega * r) < wildBall.restSpeed, 'coasting spin stops on the shelf');
		assert.equal(coast.ball.contact, wildBall.CONTACT_ROCK);
		assert.ok(Math.abs(ledgerDrift(coast.world)) < 1e-8);

		// Sit against the start-room wall with leftover spin and no motor: the
		// wall used to steal the floor contact (ny = 0) and freeze omega in air.
		const wallRun = wildWorld(1);
		wallRun.world.platform.x = -8;
		let wall = NaN;
		for (let x = 2.5; x < 6; x += 0.02) {
			if (wallRun.cave.solidAt(x, 31.5)) { wall = x; break; }
		}
		assert.ok(Number.isFinite(wall), 'the start room has a right wall');
		const wallFloor = shelfRest(wallRun.world, wallRun.cave, wall - r - 0.01);
		freeBall(wallRun.world, wallRun.cave, wall - r - 0.01, wallFloor, 0, 0);
		wallRun.ball.omega = 12;
		wallRun.ball.contact = wildBall.CONTACT_ROCK;
		wallRun.ball.releaseCooldown = 1;
		wallRun.world.initialEnergy = physics.totalEnergy(wallRun.world);
		for (let i = 0; i < 240 * 3; i++) physics.step(wallRun.world, dt);
		assert.ok(Math.abs(wallRun.ball.omega) < 0.4, 'wall-pinned leftover spin dies by floor friction');
		assert.ok(Math.abs(wallRun.ball.vx) < 0.08, 'and translation sleeps with it');
		assert.ok(Math.abs(ledgerDrift(wallRun.world)) < 1e-8);
	} finally {
		resetClassic();
	}
});

test('M3 small holes: a spun ball wedged on a pit rim sleeps instead of spinning forever', () => {
	try {
		const dt = physics.config.step;
		const r = physics.config.radius;
		const { world, cave, ball } = wildWorld(1);
		const cell = cave.state.cell;
		const shelfRow = cave.state.shelfRow;
		const column = cave.columnAt(0);
		for (let c = column; c < column + 2; c++) for (let row = shelfRow - 1; row < shelfRow; row++) cave.dig(c, row);
		const shelfTop = shelfRow * cell;
		// A one-cell-deep, two-cell-wide pit carved into the shelf floor: the
		// ball wedges on the two rim corners with the motor off and a full
		// spin. Below the rim there is no floor to lean on, so the old contact
		// rules left the spin frozen in the air.
		ball.state = 'flying';
		ball.holder = null;
		ball.x = (column + 1) * cell;
		ball.y = shelfTop + Math.sqrt(r * r - (cell * 0.5) * (cell * 0.5));
		ball.vx = 0;
		ball.vy = 0;
		ball.omega = 6;
		ball.spin = 0;
		ball.contact = wildBall.CONTACT_NONE;
		ball.releaseCooldown = 0;
		world.initialEnergy = physics.totalEnergy(world);
		let settledAt = -1;
		for (let i = 0; i < 240 * 10; i++) {
			physics.step(world, dt);
			const speed = Math.hypot(ball.vx, ball.vy);
			const settled = speed < wildBall.restSpeed && Math.abs(ball.omega * r) < wildBall.restSpeed
				&& ball.contact === wildBall.CONTACT_ROCK;
			if (settledAt < 0 && settled) settledAt = i;
		}
		assert.ok(settledAt > 0 && settledAt < 240 * 5, 'ball sleeps on the pit rim');
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8);
	} finally {
		resetClassic();
	}
});

test('M3 small holes: a ball resting in the clear beside a rim never freezes mid-air', () => {
	try {
		const dt = physics.config.step;
		const { world, ball } = wildWorld(1);
		// The start room's right shelf rim: the ball lands in the clear within a
		// ball radius of the drop-off. There the one-band field answers every
		// trace with a contact a hair in the future while the ball still reads
		// clear, and the old airStep moved onto that point and returned - gravity
		// was never integrated and the ball hung at y = 33.057 for ever. That is
		// the reported "stuck in the geometry of a small hole".
		world.platform.x = -24.5;
		ball.state = 'flying';
		ball.holder = null;
		ball.x = -4.5;
		ball.y = 33;
		ball.vx = 0;
		ball.vy = 0;
		ball.omega = 0;
		ball.spin = 0;
		ball.contact = wildBall.CONTACT_NONE;
		ball.releaseCooldown = 0;
		world.initialEnergy = physics.totalEnergy(world);
		for (let i = 0; i < 240 * 2; i++) physics.step(world, dt);
		assert.ok(ball.y < 32.9, `gravity kept acting on the ball (y = ${ball.y})`);
		assert.ok(Math.hypot(ball.vx, ball.vy) > 0.5, 'the ball is falling, not pinned at the rim');
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8);
	} finally {
		resetClassic();
	}
});

test('M3 small holes: a coasting ball carries rim friction into a pit and settles in it', () => {
	try {
		const dt = physics.config.step;
		const r = physics.config.radius;
		const { world, cave, ball } = wildWorld(1);
		const cell = cave.state.cell;
		const shelfRow = cave.state.shelfRow;
		const column = cave.columnAt(0);
		for (let c = column; c < column + 3; c++) for (let row = shelfRow - 2; row < shelfRow; row++) cave.dig(c, row);
		const shelfTop = shelfRow * cell;
		ball.state = 'flying';
		ball.holder = null;
		ball.x = (column - 2) * cell;
		ball.y = shelfTop + r;
		ball.vx = 1.2;
		ball.vy = 0;
		ball.omega = 0;
		ball.spin = 0;
		ball.contact = wildBall.CONTACT_NONE;
		ball.releaseCooldown = 0;
		world.initialEnergy = physics.totalEnergy(world);
		let settledAt = -1;
		for (let i = 0; i < 240 * 12; i++) {
			physics.step(world, dt);
			const asleep = Math.hypot(ball.vx, ball.vy) < wildBall.restSpeed
				&& Math.abs(ball.omega * r) < wildBall.restSpeed
				&& ball.contact === wildBall.CONTACT_ROCK;
			if (settledAt < 0 && asleep) settledAt = i;
		}
		assert.ok(settledAt > 0 && settledAt < 240 * 10, 'ball comes to rest inside the pit');
		assert.ok(Math.abs(ball.omega * r) < wildBall.restSpeed, 'rim friction killed the leftover spin');
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8);
	} finally {
		resetClassic();
	}
});

test('M3 jump actuator: piston-style on/off energy toggle launches from roll and boosts repeated bounces', () => {
	try {
		const { world, cave, ball } = wildWorld(1);
		world.platform.x = -2.2;
		const r = physics.config.radius;
		const floor = shelfRest(world, cave, 2.2);
		freeBall(world, cave, 2.2, floor, 1.1, 0);
		ball.omega = 1.1 / r;
		ball.contact = wildBall.CONTACT_ROCK;
		world.initialEnergy = physics.totalEnergy(world);

		assert.equal(ball.jump, false, 'jump actuator starts off');
		const startBattery = ball.battery;
		wildBall.setJump(world, true);
		assert.equal(ball.jump, true);
		physics.step(world, physics.config.step);
		assert.equal(ball.contact, wildBall.CONTACT_NONE, 'energised jump actuator lifts off from a roll');
		assert.ok(Math.abs(ball.vy - wildBall.jumpSpeed) < 1e-6, 'first jump delivers jumpSpeed along normal');
		assert.ok(Math.abs(ball.vx - 1.1) < 1e-9, 'jump preserves tangential speed');
		assert.ok(Math.abs(ball.omega - 1.1 / r) < 1e-9, 'jump preserves rotational velocity');
		assert.equal(ball.jump, true, 'actuator remains switched on like platform Drive');
		assert.ok(ball.battery < startBattery - 10, 'jump pulse draws battery at jumpEfficiency');
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8);

		// Sustained powered bounces climb higher on each rock contact, then go
		// passive once the actuator is switched off.
		const pogo = wildWorld(1);
		pogo.world.platform.x = -2.2;
		freeBall(pogo.world, pogo.cave, 2.2, floor, 0, 0);
		pogo.ball.contact = wildBall.CONTACT_ROCK;
		pogo.world.initialEnergy = physics.totalEnergy(pogo.world);
		wildBall.setJump(pogo.world, true);
		let apex1 = floor;
		let apex2 = floor;
		for (let i = 0; i < 650; i++) {
			physics.step(pogo.world, physics.config.step);
			if (pogo.ball.jumps === 1 && pogo.ball.y > apex1) apex1 = pogo.ball.y;
			if (pogo.ball.jumps === 2 && pogo.ball.y > apex2) apex2 = pogo.ball.y;
		}
		assert.ok(pogo.ball.jumps >= 2, 'staying on powers subsequent bounces automatically');
		assert.ok(apex2 > apex1 + 0.5, 'second powered bounce reaches higher than the first');

		wildBall.setJump(pogo.world, false);
		const jumpsAtOff = pogo.ball.jumps;
		const batteryAtOff = pogo.ball.battery;
		const hitsAtOff = pogo.ball.hits;
		for (let i = 0; i < 480 && pogo.ball.hits === hitsAtOff; i++) physics.step(pogo.world, physics.config.step);
		assert.ok(pogo.ball.hits > hitsAtOff, 'ball hits rock again after actuator turned off');
		assert.equal(pogo.ball.jumps, jumpsAtOff, 'switched-off actuator adds no pulse');
		assert.equal(pogo.ball.battery, batteryAtOff, 'switched-off actuator spends no battery');
		assert.ok(Math.abs(ledgerDrift(pogo.world)) < 1e-8);
	} finally {
		resetClassic();
	}
});

test('M3 bounce energy recycling: actively stops bouncing, returns energy to battery, and coordinates with jump', () => {
	try {
		const dt = physics.config.step;
		const r = physics.config.radius;

		// Compare actuators on the same flat bed. Repeated direct impacts can
		// excavate bare rock and turn a vertical bounce into a sideways roll.
		function layBed(cave) {
			for (let c = -12; c < 32; c++) wildRubble.deposit(cave.worldX(c), 31.5, 1, 3);
			return wildMine.groundAt(2.5, 31.5) + r;
		}
		const passive = wildWorld(1);
		const floor = shelfRest(passive.world, passive.cave, 2.5);
		passive.ball.battery = 150;
		freeBall(passive.world, passive.cave, 2.5, layBed(passive.cave) + 1.5, 0, 0);
		let passiveSettle = -1;
		// A motor-off passive superball needs ~25 s of bouncing before its
		// rebound height collapses under one radius; watch well past that.
		for (let i = 0; i < 240 * 45; i++) {
			physics.step(passive.world, dt);
			if (passiveSettle < 0 && i > 10 && passive.ball.contact === wildBall.CONTACT_ROCK) passiveSettle = i;
		}

		// Recycled drop from identical height and battery (rolling left across the open shelf).
		const recycled = wildWorld(1);
		recycled.world.platform.x = -3;
		recycled.ball.battery = 150;
		wildBall.setRecycle(recycled.world, true);
		freeBall(recycled.world, recycled.cave, 2.5, layBed(recycled.cave) + 1.5, -0.8, 0);
		recycled.ball.omega = -0.8 / r;
		recycled.world.initialEnergy = physics.totalEnergy(recycled.world);
		let recycleSettle = -1;
		let settleHits = 0;
		let settleVx = 0;
		for (let i = 0; i < 240 * 3; i++) {
			physics.step(recycled.world, dt);
			if (recycleSettle < 0 && i > 10 && recycled.ball.contact === wildBall.CONTACT_ROCK) {
				recycleSettle = i;
				settleHits = recycled.ball.hits;
				settleVx = recycled.ball.vx;
			}
		}
		assert.ok(recycleSettle > 0 && recycleSettle < passiveSettle * 0.15, 'recycling settles bouncing much faster than passive');
		assert.ok(settleHits <= 3 && passive.ball.hits > 15, 'recycling cuts dozens of bounces down to a cushioned stop');
		assert.ok(recycled.ball.battery > 155, 'recycling returns damped bounce energy to the battery');
		assert.ok(Math.abs((recycled.ball.battery - 150) - recycled.ball.recycled) < 1e-9);
		// Rolling resistance bleeds the coat speed in both modes now, so a
		// recycled ball keeps the sign and most of the roll rather than every
		// unit of it; the normal rebound, not the tangent, is what dies.
		assert.ok(settleVx < -0.55, 'recycling stops normal rebound while preserving tangential roll');
		assert.ok(Math.abs(ledgerDrift(recycled.world)) < 1e-8);

		// Full battery: still stops bouncing, caps at batteryCapacity, vents rest as heat.
		const full = wildWorld(1);
		wildBall.setRecycle(full.world, true);
		freeBall(full.world, full.cave, 2.5, floor + 1.5, 0, 0);
		for (let i = 0; i < 240 * 3; i++) physics.step(full.world, dt);
		assert.equal(full.ball.contact, wildBall.CONTACT_ROCK, 'full battery still damps bouncing to a stop');
		assert.equal(full.ball.battery, wildBall.batteryCapacity, 'battery never overflows capacity');
		assert.ok(Math.abs(ledgerDrift(full.world)) < 1e-8);

		// Round-trip jump -> recycle strictly loses net energy (no free-energy loop)
		// and jump / recycle mutually disengage each other.
		const cycle = wildWorld(1);
		freeBall(cycle.world, cycle.cave, 2.4, floor, 0, 0);
		cycle.ball.contact = wildBall.CONTACT_ROCK;
		cycle.world.initialEnergy = physics.totalEnergy(cycle.world);
		const initialBatt = cycle.ball.battery;
		wildBall.setJump(cycle.world, true);
		physics.step(cycle.world, dt);
		const postJumpBatt = cycle.ball.battery;
		wildBall.setRecycle(cycle.world, true);
		assert.equal(cycle.ball.jump, false, 'enabling recycle turns jump actuator off');
		assert.equal(cycle.ball.recycle, true);
		for (let i = 0; i < 240 * 3; i++) physics.step(cycle.world, dt);
		assert.ok(cycle.ball.battery > postJumpBatt + 3, 'landing recovers part of the jump energy');
		assert.ok(cycle.ball.battery < initialBatt - 5, 'round trip stays strictly dissipative');
		wildBall.toggleJump(cycle.world);
		assert.equal(cycle.ball.jump, true);
		assert.equal(cycle.ball.recycle, false, 'enabling jump turns recycle off');
		assert.ok(Math.abs(ledgerDrift(cycle.world)) < 1e-8);
	} finally {
		resetClassic();
	}
});

test('M3 D5 classification: a slow contact is a roll, a fast one is a hit that weakens the rock', () => {
	try {
		assert.ok(Math.abs(wildBall.curvatureLimit - 30 * Math.PI / 180) < 1e-12);
		assert.equal(wildBall.bounceFloor, 0.35);

		const slow = wildWorld(1);
		const rest = shelfRest(slow.world, slow.cave, 1.5);
		freeBall(slow.world, slow.cave, 1.5, rest + 0.004, 0, -0.2);
		for (let i = 0; i < 24; i++) physics.step(slow.world, physics.config.step);
		assert.equal(slow.ball.contact, wildBall.CONTACT_ROCK, 'a sub-bounceFloor contact rolls');
		assert.ok(Math.abs(slow.ball.y - rest) < 2e-3, 'the dropped ball settles at surface + radius');
		assert.equal(slow.ball.hits, 0);
		assert.equal(slow.world.fractureEnergy, 0, 'a roll never weakens rock');

		const fast = wildWorld(1);
		const fastRest = shelfRest(fast.world, fast.cave, 1.5);
		freeBall(fast.world, fast.cave, 1.5, fastRest + 0.004, 0, -6);
		for (let i = 0; i < 10; i++) physics.step(fast.world, physics.config.step);
		assert.equal(fast.ball.hits, 1, 'the fast contact is one hit');
		assert.ok(fast.world.fractureEnergy > 5, 'the hit books fracture energy');
		assert.ok(fast.ball.vy > 3, 'the hit keeps sqrt(0.9) of the normal speed');
		const budget = 0.5 * physics.ballMassFor(fast.ball) * 36 * (1 - physics.rockRetentionNow(fast.ball.owner));
		assert.ok(Math.abs(fast.world.fractureEnergy - budget) < budget * 0.02, 'E = half m v_n^2 (1 - e^2) reaches weaken');
		assert.ok(Math.abs(ledgerDrift(fast.world)) < 1e-8);
	} finally {
		resetClassic();
	}
});

test('M3 damage on any surface: a wall hit weakens the cave and reflects, not only the floor', () => {
	try {
		const { world, cave, ball } = wildWorld(1);
		let wall = NaN;
		for (let x = 2.5; x < 6; x += 0.02) {
			if (cave.solidAt(x, 31.5)) { wall = x; break; }
		}
		assert.ok(Number.isFinite(wall), 'the start room has a right wall');
		freeBall(world, cave, wall - 0.8, 31.5, 6, 0);
		world.initialEnergy = physics.totalEnergy(world);
		for (let i = 0; i < 120; i++) physics.step(world, physics.config.step);
		assert.ok(ball.hits >= 1, 'the wall contact is a hit');
		assert.ok(world.fractureEnergy > 0, 'wall rock is weakened like floor rock');
		assert.ok(ball.vx < 0, 'the hit reflects the ball');
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8);
	} finally {
		resetClassic();
	}
});

test('M3 rubble: broken cells rain down, land on the rock face, and stand as a collectable pile', () => {
	try {
		const { world, cave, ball } = wildWorld(1);
		const x = 2.8;
		const rest = shelfRest(world, cave, x);
		// Stock-speed blows open the shelf without having to halve the same
		// cell's strength all the way down to floating-point dust.
		for (let drop = 0; drop < 6 && wildRubble.state().depositedCells === 0; drop++) {
			freeBall(world, cave, x, rest + 0.05, 0, -3.2);
			for (let i = 0; i < 120; i++) physics.step(world, physics.config.step);
		}
		assert.ok(ball.hits > 0, 'the drops broke rock');
		for (let i = 0; i < 240 * 8; i++) physics.step(world, physics.config.step);
		const pile = wildRubble.state();
		assert.ok(pile.depositedCells > 0, 'broken cells landed as rubble: ' + JSON.stringify(pile));
		// Nothing else consumed material in this test: every cell that left the
		// rock either stands in a pile or was booked lost, never both, never neither.
		assert.ok(Math.abs(pile.depositedCells - pile.cells - pile.lostCells - (pile.bladeCells || 0)) < 1e-9,
			'all deposited cells are accounted for: ' + JSON.stringify(pile));
		// A pile may stand on ANY upward-facing rock cell — a ledge as happily as
		// the floor — so every segment must remember the solid cell it rides on.
		const columns = [];
		const cellSize = cave.state.cell;
		wildRubble.eachColumn(Math.floor((x - 10) / cellSize), Math.ceil((x + 10) / cellSize), (column, segments) => {
			for (const seg of segments) columns.push({ column, seg });
		});
		assert.ok(columns.length > 0, 'the rubble field exposes columns to render and harvest');
		for (const { column, seg } of columns) {
			assert.ok(cave.solidAt((column + 0.5) * cave.state.cell, (seg.row + 0.5) * cave.state.cell),
				'every pile segment rides on a supporting solid cell');
			assert.ok(seg.height > 0 && seg.cells > 0);
			const face = cave.floorBelow((column + 0.5) * cave.state.cell, (seg.row + 1) * cave.state.cell + 1e-6);
			assert.ok(Math.abs(face - seg.base) < 1e-9, 'the segment base matches the face it stands on');
		}
		// This run is deliberately destructive: the ball may still be in the
		// air when the settle window ends, so the ledger is the invariant that
		// matters here — the pile accounting above covers the material.
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-6);
	} finally {
		resetClassic();
	}
});

test('M3 collector: a grain that drops through the collector span is caught into the hopper', () => {
	try {
		const { world, cave, ball } = wildWorld(1);
		const x = 2.8;
		const rest = shelfRest(world, cave, x);
		// Break cells until at least one grain is airborne, then aim it through
		// the deck: the collector is the window at the left end of the deck.
		for (let drop = 0; drop < 6 && wildBall.debrisCount === 0; drop++) {
			freeBall(world, cave, x, rest + 0.05, 0, -3.2);
			for (let i = 0; i < 120 && wildBall.debrisCount === 0; i++) physics.step(world, physics.config.step);
		}
		assert.ok(wildBall.debrisCount > 0, 'a strong hit breaks cells into grains');
		// Let the cave and the ball settle so nothing else is in flight, then drop
		// one grain through the collector span by hand.
		world.platform.vx = 0;
		const plate = world.platform;
		const deck = physics.config.deck;
		let grain = -1;
		for (let i = 0; i < wildBall.debrisActive.length; i++) {
			if (!wildBall.debrisActive[i]) continue;
			grain = i;
			break;
		}
		wildBall.debrisX[grain] = plate.x - 1.0;
		wildBall.debrisY[grain] = plate.y + deck + 0.8;
		wildBall.debrisVx[grain] = 0;
		wildBall.debrisVy[grain] = 0;
		const beforeCells = ceiling.state.cargoCells;
		const beforeValue = ceiling.state.cargoValue;
		world.initialEnergy = physics.totalEnergy(world);
		for (let i = 0; i < 240 * 4; i++) physics.step(world, physics.config.step);
		assert.ok(ceiling.state.cargoCells > beforeCells, 'the collector scooped the grain');
		assert.ok(ceiling.state.cargoValue > beforeValue, 'the grain brought its value with it');
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-6, 'the catch is ledger-exact: ' + ledgerDrift(world));
	} finally {
		resetClassic();
	}
});

test('saturating the flight pool settles displaced grains instead of losing their cells or value', () => {
	try {
		const { world, cave } = wildWorld(1);
		const c = cave.columnAt(2.8), r = cave.rowAt(cave.roofAbove(cave.worldX(c), 32));
		cave.dig(c, r);
		// Stress just the release queue with identical, known-value grains.
		const n = wildBall.maxDebris + 5;
		for (let i = 0; i < n; i++) wildBall.spawnFragment(cave, c, r);
		const overflow = wildRubble.state();
		assert.equal(wildBall.debrisCount, wildBall.maxDebris);
		assert.equal(overflow.cells, 5);
		for (let step = 0; wildBall.debrisCount && step < 480; step++) wildBall.step(world, cave, physics.config.step);
		const settled = wildRubble.state();
		assert.equal(wildBall.debrisCount, 0);
		assert.equal(settled.depositedCells, n);
		assert.ok(Math.abs(settled.cells + settled.lostCells - n) < 1e-8);
		assert.ok(Math.abs(settled.value + settled.lostValue - n * overflow.value / 5) < 1e-7);
	} finally {
		resetClassic();
	}
});

test('the last hopper slot takes a whole mixed grain; the next grain settles intact', () => {
	try {
		const { world, cave } = wildWorld(1);
		const s = ceiling.state, m = s.cellMass;
		assert.equal(ceiling.loadCargo(0, (s.storageLimit - 1) * m, 0), true);
		const before = s.cargoMinerals.slice();
		world.initialEnergy = physics.totalEnergy(world);
		// Both faces are at the same height above the amber collector; -7
		// releases first. Its Float32 shares used to total more than one.
		const values = [], mix = new Float64Array(rockTable.mineralCount);
		let firstMix;
		for (const col of [-7, -6]) {
			const x = cave.worldX(col), row = cave.rowAt(cave.roofAbove(x, 32)), y = cave.worldY(row);
			cave.mixAt(col, row, mix);
			if (!firstMix) firstMix = mix.slice();
			values.push(mix.reduce((value, share, i) => value + share * s.mineralPrices[i], 0));
			for (let hit = 0; cave.solidAt(x, y) && hit < 8; hit++) cave.weaken(x, y, 10, 1, 0.75);
		}
		assert.equal(wildBall.debrisCount, 2);
		for (let step = 0; wildBall.debrisCount && step < 480; step++) physics.step(world, physics.config.step);
		assert.equal(wildBall.debrisCount, 0);
		assert.equal(wildBall.state.caughtCells, 1);
		assert.equal(s.cargoCells, s.storageLimit);
		for (let i = 0; i < mix.length; i++) assert.ok(Math.abs(s.cargoMinerals[i] - before[i] - firstMix[i] * m) < 1e-10);
		assert.ok(Math.abs(s.cargoValue - values[0]) < 1e-9);
		const soil = wildRubble.state();
		assert.equal(soil.cells, 1);
		assert.ok(Math.abs(soil.value - values[1]) < 1e-9);
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8);
	} finally {
		resetClassic();
	}
});

test('M3 deck home: a ball landing back on the platform is caught and recharged', () => {
	try {
		const { world, ball } = wildWorld(1);
		world.initialEnergy = physics.totalEnergy(world);
		physics.launch(world, ball);
		let held = -1;
		for (let i = 0; i < 240 * 5; i++) {
			physics.step(world, physics.config.step);
			if (held < 0 && ball.state === 'held') held = i;
		}
		assert.ok(held > 0, 'the ball comes home into the collector');
		assert.equal(ball.state, 'held');
		assert.equal(ball.holder, world.platform.id);
		assert.equal(ball.battery, wildBall.batteryCapacity, 'the deck charged it back to full');
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8);
	} finally {
		resetClassic();
	}
});

test('M3 energy: ball kinetic + rotational + potential + battery + heat + fracture is constant across a bouncy shot', () => {
	try {
		const { world, cave, ball } = wildWorld(1);
		freeBall(world, cave, 3, 32.4, 1.2, 0);
		let deepest = 0;
		for (let i = 0; i < 240 * 8; i++) {
			physics.step(world, physics.config.step);
			const distance = cave.sdfAt(ball.x, ball.y);
			if (distance < deepest) deepest = distance;
		}
		assert.ok(deepest > -0.05, 'the centre never tunnels into rock: ' + deepest);
		assert.ok(ball.hits > 0, 'the shot hit rock');
		assert.ok(world.fractureEnergy > 0);
		assert.ok(world.heat > 0);
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-6, 'ledger drift ' + ledgerDrift(world));
	} finally {
		resetClassic();
	}
});

test('M4 streaming: a 12 m/s window stays in budget, evicts clean chunks, and restores edits', () => {
	try {
		const { world, cave, ball } = wildWorld(1);
		const cell = cave.state.cell;
		const dt = physics.config.step;
		const half = wildMine.viewWidth * 0.75;
		let editCol = 8;
		let editRow = -1;
		for (let r = 200; r < 300; r++) {
			if (cave.solidAt((editCol + 0.5) * cell, (r + 0.5) * cell)) {
				editRow = r;
				break;
			}
		}
		assert.ok(editRow > 0, 'found rock to edit in the start window');
		assert.equal(cave.dig(editCol, editRow), true);

		let x = 0;
		let maxLive = cave.state.liveChunks;
		for (let i = 0; i < 240 * 8; i++) {
			x += 12 * dt;
			cave.stream(x - half, x + half, 1);
			if (cave.state.liveChunks > maxLive) maxLive = cave.state.liveChunks;
			assert.ok(Number.isFinite(cave.sdfAt(x, 32)), 'sdf stays defined at the 12 m/s centre');
		}
		assert.ok(maxLive <= 12, 'liveChunks stay within chunkLimit at 12 m/s: ' + maxLive);
		assert.ok(x > 90, 'the window travelled past several chunks');
		assert.ok(cave.state.storedChunks >= 1, 'the edited start chunk was evicted to stored');

		cave.stream(-half, half, 99);
		assert.equal(cave.solidAt((editCol + 0.5) * cell, (editRow + 0.5) * cell), false, 'edits survive the 12 m/s round trip');

		world.drive = true;
		world.forceSetting = 1;
		world.direction = 1;
		ball.state = 'flying';
		ball.holder = null;
		ball.x = world.platform.x + 2;
		ball.y = world.platform.y + 2;
		ball.vx = 8;
		ball.vy = 1;
		ball.contact = wildBall.CONTACT_NONE;
		maxLive = cave.state.liveChunks;
		for (let i = 0; i < 240 * 3; i++) {
			physics.step(world, dt);
			if (cave.state.liveChunks > maxLive) maxLive = cave.state.liveChunks;
		}
		assert.ok(maxLive <= 12, 'player motion keeps liveChunks bounded: ' + maxLive);
		assert.ok(Number.isFinite(cave.sdfAt(world.platform.x, world.platform.y)), 'rock stays under the platform');
		assert.ok(Number.isFinite(cave.sdfAt(ball.x, ball.y)), 'and under the ball');
	} finally {
		resetClassic();
	}
});

test('a hit on a settled bed transmits only a diffuse share to its backing rock, even starting in contact', () => {
	try {
		const { world, cave, ball } = wildWorld(1);
		const c = 18, x = cave.worldX(c), row = cave.state.shelfRow - 1;
		for (let i = c - 3; i <= c + 3; i++) wildRubble.deposit(cave.worldX(i), 32, 15, 30);
		const crest = wildMine.groundAt(x, 32);
		const center = cave.strengthAt(c, row), far = cave.strengthAt(c - 12, row);
		const roofRow = cave.rowAt(cave.roofAbove(x, 32)), roof = cave.strengthAt(c, roofRow);
		const material = wildRubble.state();
		freeBall(world, cave, x, crest + physics.config.radius - 0.001, 0, -5);
		physics.step(world, physics.config.step);
		assert.ok(ball.vy > 0 && ball.y >= crest + physics.config.radius, 'the crest, not buried rock, owns the bounce');
		const budget = 0.5 * physics.ballMassFor(ball) * 25 * (1 - physics.rockRetentionNow(ball.owner));
		assert.ok(ball.lastFracture > 0 && ball.lastFracture <= budget * 0.2 + 1e-10);
		assert.ok(cave.strengthAt(c, row) < center);
		assert.ok(cave.strengthAt(c - 12, row) < far, 'transmitted damage reaches beyond the bare strike radius');
		assert.equal(cave.strengthAt(c, roofRow), roof, 'soil does not transmit a floor strike upward through the gallery');
		assert.equal(wildRubble.state().cells, material.cells);
		assert.equal(wildRubble.state().value, material.value);
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8);
	} finally {
		resetClassic();
	}
});
