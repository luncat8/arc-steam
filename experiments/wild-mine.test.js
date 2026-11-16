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

test('M3 release: Wild Mine launches from the deck, D5 aims it, and only the ball battery pays', () => {
	try {
		const { world, ball } = wildWorld(1);
		assert.equal(physics.wildMode(), true);
		assert.equal(ball.state, 'held');
		assert.equal(physics.canLaunch(world, ball), true);
		world.initialEnergy = physics.totalEnergy(world);
		const before = ball.battery;
		assert.equal(physics.launch(world, ball), true);
		assert.equal(ball.state, 'flying');
		assert.equal(ball.holder, null);
		assert.ok(ball.vy > 3 && Math.abs(ball.vx) < 1e-9, 'a level piston releases straight up');
		const useful = 0.5 * physics.ballMassFor(ball) * wildBall.launchSpeed * wildBall.launchSpeed;
		assert.ok(Math.abs((before - ball.battery) - useful / 0.8) < 1e-9, 'the kick is priced at the motor efficiency');
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

test('M3 motor and jump: torque drives only a rolling contact, the jump is an impulse along the normal', () => {
	try {
		const { world, cave, ball } = wildWorld(1);
		freeBall(world, cave, 1.5, shelfRest(world, cave, 1.5), 0, 0);
		ball.contact = wildBall.CONTACT_ROCK;
		world.initialEnergy = physics.totalEnergy(world);
		const battery = ball.battery;
		wildBall.setMotor(world, 1);
		for (let i = 0; i < 120; i++) physics.step(world, physics.config.step);
		assert.ok(ball.vx > 0.5, 'right torque rolls the ball right');
		assert.ok(ball.omega > 1, 'the roll carries angular velocity');
		assert.ok(ball.x > 1.6, 'the ball travelled');
		assert.ok(ball.battery < battery - 1, 'the motor spends the battery');
		assert.equal(ball.contact, wildBall.CONTACT_ROCK);
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8);

		wildBall.setMotor(world, 0);
		const rollVx = ball.vx;
		wildBall.requestJump(world);
		for (let i = 0; i < 3; i++) physics.step(world, physics.config.step);
		assert.ok(ball.vy > wildBall.jumpSpeed * 0.9, 'the jump leaves along the contact normal');
		assert.ok(ball.battery < battery, 'the jump spends the battery');
		assert.equal(ball.contact, wildBall.CONTACT_NONE, 'the jump leaves the surface');
		assert.ok(Math.abs(ball.vx - rollVx) < 1e-9, 't_v is preserved by the jump');
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8);

		const airVx = ball.vx;
		wildBall.setMotor(world, 1);
		for (let i = 0; i < 30; i++) physics.step(world, physics.config.step);
		assert.equal(ball.contact, wildBall.CONTACT_NONE, 'still airborne');
		assert.ok(Math.abs(ball.vx - airVx) < 1e-9, 'no torque in the air: omega is carried, not driven');
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-8);
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
		const budget = 0.5 * physics.ballMassFor(fast.ball) * 36 * (1 - wildBall.restitution * wildBall.restitution);
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

test('M3 debris: broken cells become fragments that settle on the SDF face at any orientation', () => {
	try {
		const { world, cave, ball } = wildWorld(1);
		const x = 2.8;
		const rest = shelfRest(world, cave, x);
		// The cave's rule lets a blow take at most half a cell's remaining
		// strength, so one hole takes a run of hits on the same spot.
		for (let drop = 0; drop < 40 && wildBall.debrisCount === 0; drop++) {
			freeBall(world, cave, x, rest + 0.05, 0, -8);
			const before = ball.hits;
			for (let i = 0; i < 20 && ball.hits === before; i++) physics.step(world, physics.config.step);
			assert.ok(ball.hits > before, 'drop ' + drop + ' reaches the floor');
		}
		for (let i = 0; i < 240 * 8; i++) physics.step(world, physics.config.step);
		assert.ok(wildBall.debrisCount > 0, 'a strong hit breaks cells into debris');
		const readout = wildBall.readouts(world);
		assert.equal(readout.restingDebris, wildBall.debrisCount, 'every fragment is resting after settling');
		let checked = 0;
		for (let i = 0; i < wildBall.debrisActive.length; i++) {
			if (!wildBall.debrisActive[i]) continue;
			checked++;
			const half = wildBall.debrisSize[i] * wildBall.debrisRestingShare;
			assert.ok(cave.sdfAt(wildBall.debrisX[i], wildBall.debrisY[i]) >= half - 1e-3, 'fragment centre sits half a cell off the face');
			assert.equal(cave.solidAt(wildBall.debrisX[i], wildBall.debrisY[i]), false, 'no fragment rests inside rock');
		}
		assert.equal(checked, wildBall.debrisCount);
		assert.ok(Math.abs(ledgerDrift(world)) < 1e-6);
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
