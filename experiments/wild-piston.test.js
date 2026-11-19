'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { physics, equipment, research, c, near, run, sync } = require('./harness.cjs');
const players = require('../js/players.js');
const mine = require('../js/wild-mine.js');
const wildBall = require('../js/wild-ball.js');

function parked() {
	mine.setMode('wild');
	const world = physics.createWorld();
	players.init(world, 0);
	mine.init(world, { seed: 5 });
	world.wildWater.intakeOn = false;
	return world;
}

test('a moving release keeps the carried kinetic energy and adds only the funded pulse in the deck frame', () => {
	for (const [reserve, temp, useful] of [[100, 20, 42], [100, 110, 21], [5, 20, 4], [0, 20, 0], [100, 135, 0]]) {
		const world = parked();
		world.direction = 1;
		run(world, 0.4);
		const plate = world.platform;
		assert.ok(plate.vx > 1);
		physics.setPistonAngle(world, -Math.PI / 3);
		world.battery = reserve;
		world.heat = (temp - c.ambientTemperature) * c.heatCapacity;
		sync(world);
		const ball = world.balls[0];
		const battery = ball.battery;
		assert.ok(physics.launch(world, ball));
		const speed = Math.sqrt(2 * useful / physics.ballMassFor(ball));
		near(ball.vx, plate.stepVx - Math.sin(plate.angle + world.pistonAngle) * speed);
		near(ball.vy, plate.stepVy + Math.cos(plate.angle + world.pistonAngle) * speed);
		near(world.lastPush, useful);
		assert.equal(world.pushes, useful > 0 ? 1 : 0);
		near(reserve - world.battery, useful / physics.engineNow().efficiency);
		assert.equal(ball.battery, battery);
		near(physics.totalEnergy(world), world.initialEnergy, 1e-8);
	}
});

test('a launch into the flat stone roof uses the fitted strike head for both fracture and rebound', () => {
	for (const [head, loss] of [['standard', 0.09], ['hardened', 0.13], ['spike', 0.19]]) {
		const world = parked();
		research.grant('materials', world);
		research.grant('electromagnetics', world);
		equipment.grant('coil', world);
		equipment.grant('ram', world);
		if (head !== 'standard') {
			research.grant('impact', world);
			assert.ok(equipment.installBall(head, world, true));
		}
		const ball = world.balls[0];
		assert.ok(physics.launch(world, ball));
		near(world.lastPush, 84);
		const col = mine.cave.columnAt(ball.x), row = mine.cave.rowAt(mine.cave.roofAbove(ball.x, ball.y));
		const strength = mine.cave.strengthAt(col, row);
		for (let i = 0; !ball.hits && i < 480; i++) physics.step(world, c.step);
		assert.equal(ball.hits, 1);
		assert.equal(world.pushes, 1, 'hit on the first launch');
		const normalEnergy = 0.5 * physics.ballMassFor(ball) * ball.lastImpact ** 2;
		near(ball.lastFracture, normalEnergy * loss, 1e-8);
		assert.ok(mine.cave.strengthAt(col, row) < strength);
		// The remainder of the contact step can add at most one step of gravity.
		near(-ball.vy, ball.lastImpact * Math.sqrt(1 - loss), c.ballGravity * c.step + 1e-8);
		near(physics.totalEnergy(world), world.initialEnergy, 1e-8);
	}
});

test('the upgraded piston uses deck retention, not strike-head loss, and counts only powered returns', () => {
	const world = parked();
	research.grant('materials', world);
	equipment.grant('pad', world);
	research.grant('impact', world);
	assert.ok(equipment.installBall('spike', world, true));
	const ball = world.balls[0];
	const mass = physics.ballMassFor(ball);
	for (const [drive, reserve, useful] of [[true, 10, 8], [true, 0, 0], [false, 100, 0]]) {
		world.drive = drive;
		world.battery = reserve;
		ball.state = 'flying';
		ball.holder = null;
		ball.x = world.platform.x + c.pistonCentre;
		ball.y = world.platform.y + c.deck + c.radius;
		ball.vx = 0;
		ball.vy = -4;
		const pushes = world.pushes;
		sync(world);
		wildBall.step(world, mine.cave, c.step);
		assert.equal(ball.state, 'flying');
		const incoming = 4 + c.ballGravity * c.step;
		near(ball.vy, Math.sqrt(0.94 * incoming ** 2 + 2 * useful / mass));
		near(world.lastPush, useful);
		near(reserve - world.battery, useful / physics.engineNow().efficiency);
		assert.equal(world.pushes, pushes + (useful > 0 ? 1 : 0));
		assert.ok(world.pistonOffset > 0, 'front-face piston hit compresses the piston spring');
		near(physics.totalEnergy(world), world.initialEnergy, 1e-8);
	}
});

test('moving-deck bounce recycling is frame-invariant and unpowered launch leaves the piston still', () => {
	// Measure recuperated battery gain against a tilted piston on standing, advancing and retreating decks.
	const gains = [];
	for (const stepVx of [0, 4, -4]) {
		const world = parked();
		world.drive = false;
		world.pistonAngle = -Math.PI / 2; // piston normal points +x
		const ball = world.balls[0];
		ball.state = 'flying';
		ball.holder = null;
		ball.recycle = true;
		ball.battery = 0;
		ball.x = world.platform.x + c.pistonCentre + c.radius * 0.9;
		ball.y = world.platform.y + c.deck;
		world.platform.stepVx = stepVx;
		ball.vx = stepVx - 5; // identical -5 m/s deck-frame normal approach in all three cases
		ball.vy = 0;
		sync(world);
		wildBall.step(world, mine.cave, c.step);
		gains.push(ball.battery);
		assert.ok(ball.battery > 0, `deck stepVx ${stepVx} recuperates normal bounce loss`);
		near(physics.totalEnergy(world), world.initialEnergy, 1e-8);
	}
	near(gains[1], gains[0], 1e-6);
	near(gains[2], gains[0], 1e-6);

	// An unpowered release must not fake a powered piston stroke.
	const dry = parked();
	dry.battery = 0;
	dry.pistonOffset = 0;
	sync(dry);
	assert.ok(physics.launch(dry, dry.balls[0]));
	assert.equal(dry.pistonOffset, 0);
	near(physics.totalEnergy(dry), dry.initialEnergy, 1e-8);
});
