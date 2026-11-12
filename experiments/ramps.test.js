'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { physics, equipment, ceiling, research, c, near, sync, balanced } = require('./harness.cjs');
const players = require('../js/players.js');

function fresh(count = 1, ramps = false) {
	const world = physics.createWorld();
	players.init(world, count);
	world.balls.length = 0;
	world.drive = false;
	for (const rival of players.state.rivals) {
		rival.bot = false;
		rival.braking = false;
		rival.direction = 0;
	}
	if (!ramps) equipment.uninstall('ramp', world);
	sync(world);
	return world;
}

function place(body, x, vx = 0) {
	body.x = body.previousX = x;
	body.y = body.previousY = 0;
	body.angle = body.previousAngle = 0;
	body.vx = vx;
	body.brakeHeld = false;
	body.brakeImpulse = 0;
}

function run(world, seconds) {
	for (let i = 0; i < Math.round(seconds / c.step); i++) {
		players.update(world, c.step);
		physics.step(world, c.step);
	}
}

function momentum(world) {
	let value = 0;
	for (const player of players.state.players) {
		const machine = players.machineOf(player);
		value += physics.machineMass(world, machine) * physics.machineBody(machine).vx;
	}
	return value;
}

function kinetic(world) {
	let value = 0;
	for (const player of players.state.players) {
		const machine = players.machineOf(player);
		const vx = physics.machineBody(machine).vx;
		value += 0.5 * physics.machineMass(world, machine) * vx * vx;
	}
	return value;
}

function separated(world) {
	const bodies = players.state.players.map(player => physics.machineBody(players.machineOf(player))).sort((a, b) => a.x - b.x);
	for (let i = 0; i < bodies.length; i++) {
		assert.ok(bodies[i].x >= physics.platformMin() - 1e-8 && bodies[i].x <= physics.platformMax() + 1e-8, 'inside chamber bounds');
		if (i) assert.ok(bodies[i].x - bodies[i - 1].x >= c.platformWidth - 1e-8, 'no overlapping bumpers');
		near(bodies[i].y, 0);
	}
	balanced(world);
}

test('stock ramps are per-player, free to toggle anywhere, and restored by New game', () => {
	const world = fresh(4, true);
	const ramp = equipment.find('ramp');
	assert.equal(ramp.cost, 0);
	assert.equal(ramp.defaultInstalled, true);
	assert.equal(players.state.rampsEnabled, true);
	const reserve = world.battery;
	const mass = physics.platformMass(world);
	for (const player of players.state.players) {
		assert.equal(equipment.isInstalled('ramp', player.id), true);
		assert.equal(equipment.isUnlocked('ramp', player.id), true);
		for (let i = 0; i < 3; i++) {
			assert.equal(equipment.uninstall('ramp', world, player.id), true);
			assert.equal(equipment.uninstall('ramp', world, player.id), false, 'no duplicate removal');
			assert.equal(players.state.rampsEnabled, false);
			assert.equal(equipment.install('ramp', world, player.id), true);
			assert.equal(equipment.install('ramp', world, player.id), false, 'no duplicate installation');
			assert.equal(players.state.rampsEnabled, true);
		}
		assert.equal(research.stateFor(player.id).completed, 0);
	}
	assert.equal(equipment.uninstall('missing', world), false);
	equipment.grant('pad', world);
	assert.equal(equipment.uninstall('pad', world), false, 'paid upgrades are not removable');
	assert.equal(world.battery, reserve);
	assert.ok(physics.platformMass(world) > mass, 'only the granted pad adds mass');
	assert.equal(ceiling.state.funds, 0);
	assert.equal(ceiling.state.ledger.length, 1, 'free ramp toggles do not create paid transactions');
	for (const rival of players.state.rivals) {
		assert.equal(rival.money, 0);
		assert.equal(rival.spent, 0);
		assert.equal(rival.ledger.length, 0);
	}
	balanced(world);
	equipment.uninstall('ramp', world, 'rival-4');
	fresh(4, true);
	assert.ok(players.state.players.every(player => equipment.isInstalled('ramp', player.id)));
	assert.equal(players.state.rampsEnabled, true);
});

test('one absent ramp disables every climbing surface and folds all plates', () => {
	const world = fresh(2, true);
	const rig = players.state.rig;
	const rival = players.state.rivals[0];
	const distant = players.state.rivals[1];
	place(world.platform, 8, 1);
	place(rival, 12);
	place(distant, 21);
	world.direction = 1;
	for (let i = 0; i < 240; i++) players.update(world, c.step);
	near(rival.tailLeft, players.tailAngle);
	assert.ok(players.surfaceAt(rival.x, 'rig') > 0);
	assert.ok(players.profileAt(rival, -2) > 0);
	assert.equal(equipment.uninstall('ramp', world, distant.id), true);
	assert.equal(equipment.isInstalled('ramp', 'rig'), true, 'another player retains its own installation');
	assert.equal(equipment.isInstalled('ramp', rival.id), true);
	near(players.surfaceAt(rival.x, 'rig'), 0);
	near(players.profileAt(rival, -2), 0);
	near(physics.platformBaseAt(rival.x, 0, 'rig'), 0);
	for (let i = 0; i < 240; i++) players.update(world, c.step);
	near(rig.tailRight, 0);
	near(rival.tailLeft, 0);
	equipment.uninstall('ramp', world, rival.id);
	equipment.install('ramp', world, distant.id);
	assert.equal(players.state.rampsEnabled, false, 'all players, not just one, must reinstall');
	equipment.install('ramp', world, rival.id);
	assert.equal(players.state.rampsEnabled, true);
	for (let i = 0; i < 240; i++) players.update(world, c.step);
	near(rival.tailLeft, players.tailAngle);
	assert.ok(players.surfaceAt(rival.x, 'rig') > 0);
});

test('bot investment leaves installed and removed ramps alone; explicit test grants restore them', () => {
	const world = fresh(2, true);
	const removed = players.state.rivals[0];
	const installed = players.state.rivals[1];
	equipment.uninstall('ramp', world, removed.id);
	for (const rival of [removed, installed]) {
		rival.bot = true;
		place(rival, physics.platformMax());
		rival.cargoCells = 100;
		rival.cargoValue = 20000;
		players.update(world, c.step);
		assert.ok(rival.buildIndex > 10, 'the bot completed its investment sequence');
	}
	for (let i = 0; i < 240; i++) players.update(world, c.step);
	assert.equal(equipment.isInstalled('ramp', removed.id), false);
	assert.equal(equipment.isInstalled('ramp', installed.id), true);
	assert.equal(players.state.rampsEnabled, false);
	const money = removed.money;
	equipment.installAll(world, removed.id);
	assert.equal(equipment.isInstalled('ramp', removed.id), true);
	assert.equal(players.state.rampsEnabled, true);
	assert.equal(removed.money, money);
});

test('unbraked contacts conserve momentum, dissipate impact energy, and book rig transfers in either direction', () => {
	for (const direction of [-1, 1]) {
		const world = fresh();
		const rival = players.state.rivals[0];
		place(world.platform, direction > 0 ? 8 : 11.6, direction * 4);
		place(rival, direction > 0 ? 11.6 : 8);
		sync(world);
		const beforeMomentum = momentum(world);
		const beforeEnergy = kinetic(world);
		physics.resolvePlatformContacts(world, c.step);
		near(world.platform.vx, direction * 2);
		near(rival.vx, direction * 2);
		near(momentum(world), beforeMomentum);
		near(kinetic(world), beforeEnergy * 0.5);
		assert.ok(world.heat > 0, 'impact heat is not lost');
		assert.ok(world.platformWork < 0, 'work delivered to a rival leaves the rig ledger');
		separated(world);
	}
});

test('pushing uses machinery, cargo and the held ball in the actual inertial masses', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	world.balls.push({ owner: null, holder: 'rig', state: 'held', x: 7, y: 0.88, vx: 0, vy: 0 });
	equipment.grant('motor', world, rival.id);
	rival.cargoCells = 80;
	place(world.platform, 8, 5);
	place(rival, 11.6, -1.2);
	const rigMass = physics.platformMass(world);
	const rivalMass = physics.machineMass(world, rival);
	assert.ok(rigMass > c.platformMass);
	assert.ok(rivalMass > rigMass + 40);
	const expected = (rigMass * 5 - rivalMass * 1.2) / (rigMass + rivalMass);
	const before = momentum(world);
	sync(world);
	physics.resolvePlatformContacts(world, c.step);
	near(world.platform.vx, expected);
	near(rival.vx, expected);
	near(momentum(world), before);
	separated(world);
});

test('stock full-throttle thrust cannot creep a held brake in either direction', () => {
	for (const direction of [-1, 1]) {
		const world = fresh();
		const rival = players.state.rivals[0];
		place(world.platform, direction > 0 ? 8 : 16);
		place(rival, world.platform.x + direction * c.platformWidth);
		rival.braking = true;
		world.direction = direction;
		world.forceSetting = 1;
		const start = rival.x;
		assert.ok(physics.brakeAcceleration() * physics.machineMass(world, rival) > physics.forceNow());
		sync(world);
		run(world, 5);
		near(rival.x, start, 1e-9);
		near(rival.vx, 0);
		near(world.platform.vx, 0);
		separated(world);
	}
});

test('a fast coasting impact moves a braked platform a finite distance, then friction stops both', () => {
	for (const direction of [-1, 1]) {
		const world = fresh();
		const rival = players.state.rivals[0];
		place(world.platform, direction > 0 ? 8 : 16, direction * 8);
		place(rival, world.platform.x + direction * c.platformWidth);
		rival.braking = true;
		const start = rival.x;
		sync(world);
		run(world, 3);
		const travel = (rival.x - start) * direction;
		assert.ok(travel > 1 && travel < 2, `an inertial shove, not an immovable wall or a pass-through: ${travel}`);
		near(world.platform.vx, 0);
		near(rival.vx, 0);
		const stopped = rival.x;
		run(world, 1);
		near(rival.x, stopped, 1e-9);
		separated(world);
	}
});

test('continued normal thrust after a fast impact still loses to brake friction', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	place(world.platform, 7, 8);
	place(rival, 10.6);
	world.direction = 1;
	world.forceSetting = 1;
	rival.braking = true;
	sync(world);
	run(world, 4);
	const mass = physics.platformMass(world) + physics.machineMass(world, rival);
	const deceleration = (physics.brakeAcceleration() * physics.machineMass(world, rival) - physics.forceNow()) / mass;
	near(rival.x - 10.6, 4 * 4 / (2 * deceleration), 0.1);
	near(rival.vx, 0);
	const stopped = rival.x;
	run(world, 2);
	near(rival.x, stopped, 1e-9);
	separated(world);
});

test('the rig brake resists a rival with an empty, overheated engine and a low force setting', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	place(world.platform, 15);
	place(rival, 11.4, 8);
	world.brake = true;
	world.forceSetting = 0.1;
	world.battery = 0;
	world.heat = (c.thermalCutoff + 10 - c.ambientTemperature) * c.heatCapacity;
	rival.direction = 1;
	rival.force = 1;
	sync(world);
	run(world, c.step);
	assert.ok(world.platform.vx > 3, 'the rival transfers momentum into the rig');
	assert.ok(world.platformWork > 0, 'the incoming work is accounted for');
	run(world, 4);
	assert.ok(world.platform.x > 16 && world.platform.x < physics.platformMax());
	near(world.platform.vx, 0);
	near(world.battery, 0, 1e-9);
	const stopped = world.platform.x;
	run(world, 1);
	near(world.platform.x, stopped, 1e-9);
	separated(world);
});

test('the flywheel recovers brake work from a shove, not collision heat', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	equipment.grant('flywheel', world);
	place(world.platform, 15);
	place(rival, 11.4, 8);
	world.brake = true;
	world.battery = 0;
	rival.direction = 1;
	rival.force = 0.1;
	sync(world);
	run(world, 2);
	assert.ok(world.battery > 0, 'the rig recuperates its own braking work');
	assert.ok(world.heat > world.battery, 'the collision is not a fully regenerative stop');
	separated(world);
});

test('a stronger upgraded engine can overcome stock brake friction', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	equipment.grant('motor', world);
	place(world.platform, 8);
	place(rival, 11.6);
	rival.braking = true;
	world.direction = 1;
	world.forceSetting = 1;
	assert.ok(physics.forceNow() > physics.brakeAcceleration() * physics.machineMass(world, rival));
	sync(world);
	run(world, 0.5);
	assert.ok(rival.x > 11.65);
	assert.ok(rival.vx > 0.1);
	separated(world);
});

test('wall-pinned platforms cannot be driven through or pushed outside the chamber', () => {
	for (const direction of [-1, 1]) {
		const world = fresh();
		const rival = players.state.rivals[0];
		const wall = direction > 0 ? physics.platformMax() : physics.platformMin();
		place(rival, wall);
		place(world.platform, wall - direction * c.platformWidth, direction * 12);
		rival.direction = direction;
		world.direction = direction;
		world.forceSetting = 1;
		sync(world);
		run(world, 2);
		near(rival.x, wall);
		near(world.platform.x, wall - direction * c.platformWidth);
		near(rival.vx, 0);
		near(world.platform.vx, 0);
		separated(world);
	}
});

test('contact impulses propagate through five unbraked platforms, including a wall pin', () => {
	for (const wall of [false, true]) {
		const world = fresh(4);
		const start = wall ? physics.platformMax() - 4 * c.platformWidth : 4;
		for (const player of players.state.players) place(physics.machineBody(players.machineOf(player)), start + player.index * c.platformWidth);
		world.platform.vx = 10;
		const before = momentum(world);
		sync(world);
		physics.resolvePlatformContacts(world, c.step);
		for (const player of players.state.players) near(physics.machineBody(players.machineOf(player)).vx, wall ? 0 : 2, 1e-7);
		if (!wall) near(momentum(world), before);
		assert.ok(kinetic(world) < 0.5 * c.platformMass * 100);
		separated(world);
	}
});

test('one brake holds a train against weaker combined thrust without overlap or creep', () => {
	const world = fresh(4);
	for (const player of players.state.players) {
		const machine = players.machineOf(player);
		place(physics.machineBody(machine), 4 + player.index * c.platformWidth);
		if (player.kind === 'rig') { world.direction = 1; world.forceSetting = 0.1; }
		else { player.direction = player.index === 4 ? 0 : 1; player.force = 0.1; player.braking = player.index === 4; }
	}
	sync(world);
	run(world, 3);
	for (const player of players.state.players) {
		const body = physics.machineBody(players.machineOf(player));
		near(body.x, 4 + player.index * c.platformWidth, 1e-7);
		near(body.vx, 0, 1e-8);
	}
	separated(world);
});

test('live removal separates overlapping hulls without creating kinetic energy, and fast steps preserve order', () => {
	const world = fresh(1, true);
	const rival = players.state.rivals[0];
	place(world.platform, 12);
	place(rival, 12);
	equipment.uninstall('ramp', world, rival.id);
	sync(world);
	physics.resolvePlatformContacts(world, c.step);
	near(kinetic(world), 0);
	separated(world);
	place(world.platform, 6, 20);
	place(rival, 12);
	world.platform.x = 16;
	sync(world);
	physics.resolvePlatformContacts(world, 0.5);
	assert.ok(world.platform.x < rival.x, 'a proposed step past the other body still collides on the original side');
	near(world.platform.vx, 10);
	near(rival.vx, 10);
	separated(world);
});
