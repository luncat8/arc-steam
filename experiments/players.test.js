'use strict';
// Competitor platforms: one body for every player, the retractable 45° tails,
// the power ranking that decides who rides over whom, the floor harvest and
// both policies (the competitor's ball play and the rig's selling trip).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const harness = require('./harness.cjs');
const physics = harness.physics;
const ceiling = harness.ceiling;
const equipment = harness.equipment;
const research = harness.research;
const prediction = harness.prediction;
const autopilot = require('../js/autopilot.js');
const players = require('../js/players.js');
const c = physics.config;

function fresh(count = 1) {
	const world = physics.createWorld();
	players.init(world, count);
	return world;
}

function near(actual, expected, tolerance = 1e-6) {
	assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

function fillFloor(height, value) {
	const state = ceiling.state;
	state.floorPiles.fill(height);
	state.floorValues.fill(value);
	ceiling.drawFloor({ fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} });
}

// Stage debris over the collector so a test can fill the rig's hopper without a
// scripted mining shift.
function fillCargo(world, cells) {
	const state = ceiling.state;
	let guard = 0;
	while (state.cargoCells < cells && guard++ < 100) {
		ceiling.damage(12, state.bottom + 0.2, 20);
		for (let i = 0; i < state.active.length; i++) {
			if (!state.active[i]) continue;
			state.debrisX[i] = world.platform.x - 1;
			state.debrisY[i] = 0.701;
			state.debrisVx[i] = 0;
			state.debrisVy[i] = -1;
		}
		physics.step(world, c.step);
	}
	assert.ok(state.cargoCells >= cells, 'the hopper filled');
}

// Hold the rig still at a set gap from a parked competitor and let the plates
// settle, so the deployment can be read as a function of the distance.
function deploymentAt(world, rival, gap) {
	players.setActive(0);
	world.platform.x = rival.x - players.halfWidth * 2 - gap;
	world.platform.vx = 0.5;
	rival.vx = 0;
	rival.bot = false;
	rival.manual = 0;
	rival.target = NaN;
	for (let i = 0; i < 240 * 3; i++) players.update(world, c.step);
	return rival.tailLeft / players.tailAngle;
}

test('every player drives the same platform body, told apart by opacity only', () => {
	fresh();
	const state = players.state;
	assert.equal(state.players.length, 2);
	const rig = state.players[0];
	const rival = state.players[1];
	assert.equal(rig.kind, 'rig');
	assert.equal(rival.kind, 'rival');
	// Same shape: one half-width, one deck height, one plate length.
	assert.equal(players.halfWidth, c.platformWidth * 0.5);
	near(players.profileAt(rig, 0), players.bodyTop);
	near(players.profileAt(rival, 0), players.bodyTop);
	near(players.profileAt(rig, players.halfWidth), players.bodyTop);
	assert.equal(rig.tailLeft, 0);
	assert.equal(rival.tailLeft, 0);
});

// Recording context: the geometry of one body drawn through one transform.
function recorder() {
	const calls = [];
	const context = {
		calls, globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 0,
		save() { calls.push('save'); }, restore() { calls.push('restore'); },
		translate(x, y) { calls.push('translate ' + x.toFixed(4) + ' ' + y.toFixed(4)); },
		rotate(a) { calls.push('rotate ' + a.toFixed(4)); },
		beginPath() { calls.push('beginPath'); }, closePath() { calls.push('close'); },
		moveTo(x, y) { calls.push('moveTo ' + x.toFixed(4) + ' ' + y.toFixed(4)); },
		lineTo(x, y) { calls.push('lineTo ' + x.toFixed(4) + ' ' + y.toFixed(4)); },
		arc(x, y, r) { calls.push('arc ' + x.toFixed(4) + ' ' + y.toFixed(4) + ' ' + r.toFixed(4)); },
		ellipse() { calls.push('ellipse'); }, fill() { calls.push('fill'); }, stroke() { calls.push('stroke'); },
		fillRect(x, y, w, h) { calls.push('fillRect ' + [x, y, w, h].map(v => v.toFixed(4)).join(' ')); },
		strokeRect() { calls.push('strokeRect'); }, setLineDash() { calls.push('setLineDash'); }
	};
	// globalAlpha is read through the plain property, so record every assignment.
	const alpha = [];
	let value = 1;
	Object.defineProperty(context, 'globalAlpha', {
		get() { return value; },
		set(next) { value = next; alpha.push(next); }
	});
	context.alpha = alpha;
	return context;
}

// What a platform is drawn as, with its position and pitch cancelled out, so two
// platforms at different places can be compared call for call.
function painting(player, isActive, machinery) {
	const context = recorder();
	players.renderPlatform(context, player, machinery, isActive);
	const at = context.calls.findIndex(call => call.startsWith('translate'));
	const geometry = context.calls.slice(at + 2).filter(call => call !== 'save' && call !== 'restore');
	return { geometry, alpha: context.alpha[0] };
}

test('both platforms are one drawing and the dim is the only difference', () => {
	const world = fresh();
	const rig = players.state.players[0];
	const rival = players.state.rivals[0];
	rival.bot = false;
	rival.direction = 0;
	rival.manual = 0;
	world.platform.x = 7;
	world.platform.angle = 0;
	rival.x = 15;
	rival.angle = 0;
	rival.tailLeft = 0; rival.tailRight = 0;
	rig.tailLeft = 0; rig.tailRight = 0;
	// Every platform is the whole machine: the overlay draws the same fuel bar,
	// thermometer, collector strip and reflector piston inside each hull, so a
	// platform never looks like a different, stripped vehicle.
	const machinery = [];
	const overlay = function (_context, player) { machinery.push(player.kind); };
	const activeRig = painting(rig, true, overlay);
	const dimRival = painting(rival, false, overlay);
	assert.deepEqual(machinery.slice().sort(), ['rig', 'rival'], 'both hulls carry the same machinery');
	assert.deepEqual(dimRival.geometry, activeRig.geometry, 'identical geometry, wheels, deck and instruments');
	assert.equal(activeRig.alpha, 1, 'the selected platform is drawn whole');
	assert.equal(dimRival.alpha, 0.6, 'the other platform is the same drawing, dimmed');
	// The dim follows the selection and never compounds: the drawing is the same
	// call sequence however often it runs, and only the alpha changes hands.
	players.setActive(1);
	const dimRig = painting(rig, false, overlay);
	const activeRival = painting(rival, true, overlay);
	assert.deepEqual(dimRig.geometry, activeRig.geometry);
	assert.deepEqual(activeRival.geometry, activeRig.geometry);
	assert.equal(dimRig.alpha, 0.6);
	assert.equal(activeRival.alpha, 1);
	const again = painting(rival, true, overlay);
	assert.equal(again.alpha, 1, 'redrawing a selected platform never dims it further');
	assert.deepEqual(again.geometry, activeRig.geometry);
	players.setActive(0);
});

test('tails stay folded far apart and open to a 45° plate as they close', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	rival.x = 12;
	// Far apart: no plate at all, so the body is a plain box with a vertical face.
	near(deploymentAt(world, rival, 4), 0);
	near(players.profileAt(rival, -(players.halfWidth + 0.05)), 0, 1e-9);
	// Halfway in, the plate is part-way down: deployment is a function of distance.
	const halfway = deploymentAt(world, rival, (players.tailReach + players.tailFullGap) * 0.5);
	near(halfway, 0.5, 0.02);
	// Touching: fully deployed on the facing side, and the plate is a straight
	// 45° ramp from the deck edge to the floor a body height out.
	near(deploymentAt(world, rival, 0.3), 1, 1e-3);
	assert.equal(rival.tailRight, 0, 'only the facing end opens');
	near(players.profileAt(rival, -(players.halfWidth + 0.3)), players.bodyTop * 0.5, 1e-5);
	near(players.profileAt(rival, -(players.halfWidth + players.tailPlate * Math.sin(players.tailAngle))), 0, 1e-5);
});

test('the plate swings at a limited rate instead of snapping open', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	rival.x = 12;
	rival.bot = false;
	world.platform.x = rival.x - players.halfWidth * 2 - 0.3;
	world.platform.vx = 1;
	players.update(world, c.step);
	const afterOneStep = rival.tailLeft;
	assert.ok(afterOneStep > 0, 'the plate starts moving on the first step');
	assert.ok(afterOneStep <= players.tailAngle * 0 + Math.PI / 2 * c.step + 1e-9, 'one step cannot jump the whole angle');
	for (let i = 0; i < 240; i++) players.update(world, c.step);
	near(rival.tailLeft, players.tailAngle, 1e-3);
	// Reversing the approach folds it back, again at the limited rate.
	world.platform.x = rival.x - players.halfWidth * 2 - 4;
	players.update(world, c.step);
	assert.ok(rival.tailLeft > players.tailAngle - Math.PI / 2 * c.step - 1e-9, 'the fold is rate limited too');
	for (let i = 0; i < 240 * 2; i++) players.update(world, c.step);
	near(rival.tailLeft, 0, 1e-9);
});

test('the platform applying more drive power is the one that rides on top', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	rival.x = 12;
	rival.bot = false;
	rival.tailLeft = 0;
	rival.tailRight = 0;
	world.platform.x = 12;
	world.platform.vx = 0;
	// The rig drives at 60%, the competitor coasts: the rig stands on the competitor.
	world.forceSetting = 0.6;
	world.direction = 1;
	world.target = NaN;
	rival.direction = 0;
	rival.target = NaN;
	rival.force = 0.6;
	near(physics.platformBaseAt(12, 0, 'rig'), players.bodyTop, 1e-6);
	near(physics.platformBaseAt(12, 0, rival.id), 0, 1e-6);
	// The competitor raises 80% and drives while the rig coasts: the roles swap.
	world.direction = 0;
	world.target = NaN;
	rival.force = 0.8;
	rival.direction = 1;
	near(physics.platformBaseAt(12, 0, rival.id), players.bodyTop, 1e-6);
	near(physics.platformBaseAt(12, 0, 'rig'), 0, 1e-6);
});

test('a driving competitor with a stronger setting rides over a parked rig', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	rival.x = 16;
	rival.bot = false;
	rival.force = 0.9;
	rival.direction = -1;
	rival.vx = 0;
	world.platform.x = 12;
	world.platform.vx = 0;
	world.direction = 0;
	world.target = NaN;
	let peak = 0;
	for (let i = 0; i < 240 * 4; i++) {
		players.update(world, c.step);
		physics.step(world, c.step);
		if (rival.y > peak) peak = rival.y;
		if (rival.x < 9) break;
	}
	assert.ok(rival.x < 9, 'the competitor drove across the rig');
	assert.ok(peak >= players.bodyTop - 0.02, 'the competitor climbed onto the rig');
	assert.ok(world.platform.y < 0.1, 'the parked rig was not lifted by the body above it');
});

test('the rig rides over a competitor tail instead of stopping at its side', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	rival.x = 12;
	rival.bot = false;
	rival.target = NaN;
	world.platform.x = 7;
	world.platform.y = 0;
	world.platform.vx = 0;
	world.direction = 1;
	world.target = NaN;
	let peak = 0;
	for (let i = 0; i < 240 * 4; i++) {
		players.update(world, c.step);
		physics.step(world, c.step);
		if (world.platform.y > peak) peak = world.platform.y;
		if (world.platform.x > 16) break;
	}
	assert.ok(world.platform.x > 16, 'the rig crossed the competitor');
	assert.ok(peak >= players.bodyTop - 0.02, 'the rig climbed onto the competitor');
	assert.ok(peak < players.bodyTop + 0.1, 'the ride stays a body height, not a wall');
	// The competitor was not lifted: it stays on the floor while the rig passes.
	near(rival.y, 0, 0.02);
});

test('a competitor blade takes floor value into its own load and honours capacity', () => {
	fresh();
	const state = ceiling.state;
	fillFloor(0.2, 12);
	const out = { value: 0, cells: 0 };
	const before = state.floorValues.reduce((total, value) => total + value, 0);
	ceiling.harvest(10, 0.8, 0.05, 100, out);
	const after = state.floorValues.reduce((total, value) => total + value, 0);
	assert.ok(out.cells > 0);
	assert.ok(out.value > 0);
	near(before - after, out.value, 1e-9);
	const column = Math.floor(10 / state.cell);
	near(state.floorPiles[column], 0.15, 1e-9);
	ceiling.harvest(10, 0.8, 0.05, 0.001, out);
	assert.ok(out.cells <= 0.001 + 1e-12, 'the hopper capacity caps the cut');
});

test('the competitor bot holds station when there is nothing it may play', () => {
	const world = fresh();
	// The rig's collector holds the only ball, so the competitor cannot act on
	// anything: it used to pace wall to wall in this state.
	const ball = world.balls[0];
	ball.state = 'held';
	ball.x = world.platform.x - 1.15;
	const rival = players.state.rivals[0];
	rival.x = 4;
	rival.vx = 0;
	players.setActive(1);
	for (let i = 0; i < 240 * 6; i++) players.update(world, c.step);
	assert.ok(!Number.isFinite(rival.mark), 'no mark without a ball in play');
	assert.equal(rival.commanded, false);
	assert.ok(Math.abs(rival.vx) < 0.05, 'the platform is stopped');
	assert.ok(Math.abs(rival.x - 4) < 0.5, 'and it stayed put instead of sweeping');
});

test('the competitor bot banks rubble it drives over at a wall, for its own credits', () => {
	const world = fresh();
	fillFloor(0.18, 10);
	const rival = players.state.rivals[0];
	players.setActive(1);
	for (let i = 0; i < 240 * 16 && rival.money === 0; i++) players.update(world, c.step);
	assert.ok(rival.money > 0, 'the bot reached a wall with a load');
	assert.equal(rival.cargoCells, 0, 'the load was settled');
	near(rival.soldValue, rival.money);
	assert.ok(rival.x <= physics.platformMin() + 0.001 || rival.x >= physics.platformMax() - 0.001, 'the sale happened at a wall');
	assert.equal(ceiling.state.funds, 0, 'the rig was not paid for the competitor sale');
});

test('a full competitor hopper makes its own selling trip and then resumes the ball', () => {
	const world = fresh();
	const state = ceiling.state;
	fillFloor(0.18, 10);
	const rival = players.state.rivals[0];
	rival.bot = true;
	// A load at the limit is what sends the platform to the wall on purpose,
	// exactly like the rig's own selling trip.
	rival.cargoCells = state.storageLimit;
	rival.cargoValue = 40;
	const ball = world.balls[0];
	ball.state = 'grounded';
	ball.x = 20;
	ball.y = c.radius + ceiling.floorAt(20);
	ball.vx = 0;
	ball.vy = 0;
	players.update(world, c.step);
	assert.ok(rival.mark > physics.platformMax(), 'a full hopper aims through the nearer wall');
	for (let i = 0; i < 240 * 12 && rival.money === 0; i++) players.update(world, c.step);
	assert.ok(rival.money > 0, 'the trip sold the load');
	near(rival.soldValue, rival.money);
	// With the hopper empty the ball is the mark again, so the trip is not a
	// one-way exit from the policy.
	for (let i = 0; i < 240 * 2; i++) players.update(world, c.step);
	assert.ok(Number.isFinite(rival.mark) && rival.mark < physics.platformMax(), 'the ball is played again after the sale');
});

test('a manual travel click silences the competitor bot, then its ball policy resumes', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	const ball = world.balls[0];
	ball.state = 'grounded';
	ball.x = 6;
	ball.y = c.radius + ceiling.floorAt(6);
	ball.vx = 0;
	ball.vy = 0;
	players.setActive(1);
	const start = rival.x;
	players.commandTarget(rival.x - 2);
	for (let i = 0; i < 180; i++) players.update(world, c.step);
	assert.ok(rival.x < start - 0.5, 'the manual target steers against the ball mark');
	assert.ok(rival.manual > 0);
	for (let i = 0; i < 240 * 3; i++) players.update(world, c.step);
	assert.ok(Number.isFinite(rival.mark), 'the ball is its mark again after the manual pause');
	assert.ok(rival.x < start - 1, 'and it drove toward it');
});

test('a held direction key outranks the competitor bot until it is released', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	const ball = world.balls[0];
	ball.state = 'grounded';
	ball.x = 6;
	ball.y = c.radius + ceiling.floorAt(6);
	ball.vx = 0;
	ball.vy = 0;
	rival.x = 12;
	rival.vx = 0;
	players.setActive(1);
	players.command(1);
	for (let i = 0; i < 240 * 1.5; i++) players.update(world, c.step);
	assert.ok(rival.vx > 0, 'the held key still steers after the manual window');
	assert.ok(rival.x > 13, 'the platform moved right against the ball mark');
	players.command(0);
	for (let i = 0; i < 240 * 3; i++) players.update(world, c.step);
	assert.ok(Number.isFinite(rival.mark) && rival.mark < rival.x, 'the ball policy takes over once the key is released');
	assert.ok(rival.vx < 0, 'and it drives back toward the ball');
});

test('the rig bot engages the autopilot and sells a full hopper at the wall', () => {
	const world = fresh();
	fillCargo(world, 100);
	world.initialEnergy = physics.totalEnergy(world);
	players.setBot(0, true);
	assert.equal(autopilot.state.move, true);
	assert.equal(autopilot.state.drive, true);
	assert.equal(autopilot.state.angle, true);
	assert.equal(players.state.rig.bot, true);
	let sold = 0;
	for (let i = 0; i < 240 * 12 && !sold; i++) {
		autopilot.update(world, c.step);
		players.update(world, c.step);
		physics.step(world, c.step);
		sold = ceiling.state.funds;
	}
	assert.ok(sold > 0, 'the rig sold the load at a wall');
	assert.equal(ceiling.state.cargoCells, 0);
	assert.ok(Math.abs(world.platform.x - physics.platformMax()) < 0.01 || Math.abs(world.platform.x - physics.platformMin()) < 0.01, 'the trip ended at a SELL wall');
	for (let i = 0; i < 10; i++) {
		players.update(world, c.step);
		physics.step(world, c.step);
	}
	assert.equal(players.state.selling, false, 'the trip ends once the hopper is empty');
	near(physics.totalEnergy(world), world.initialEnergy, 1e-6);
	players.setBot(0, false);
	assert.equal(autopilot.state.move, false);
});

test('each platform owns its machine controls, so a tilt never crosses platforms', () => {
	// Three platforms prove the accessor covers any roster size, not just two.
	const world = fresh(2);
	assert.equal(players.state.players.length, 3);
	const rig = players.state.players[0];
	const first = players.state.players[1];
	const second = players.state.players[2];
	// machineOf is the one accessor: the rig's machine is the world, every
	// competitor's is its own object.
	assert.equal(players.machineOf(rig), world);
	assert.equal(players.machineOf(first), first);
	assert.equal(players.machineOf(second), second);
	// Tilting one competitor leaves the rig and the other competitor untouched.
	players.setPistonAngleOf(first, 0.1);
	near(first.pistonAngle, 0.1);
	assert.equal(world.pistonAngle, 0, 'the rig angle is untouched');
	assert.equal(second.pistonAngle, 0, 'the other competitor is untouched');
	// The rig's tilt goes through the physics writer.
	players.setPistonAngleOf(rig, 0.05);
	near(world.pistonAngle, 0.05);
	near(first.pistonAngle, 0.1); // still not leaking back
	// The writer clamps to the physics range for every platform.
	players.setPistonAngleOf(second, 1);
	near(second.pistonAngle, physics.config.pistonMaxAngle);
	assert.equal(players.pistonAngleOf(second), second.pistonAngle);
	// Drive is per machine too.
	assert.equal(players.machineOf(rig).drive, world.drive);
	assert.equal(first.drive, false);
});

test('a command stays with the platform it was given to', () => {
	fresh();
	const rival = players.state.rivals[0];
	assert.equal(players.setActive(1), true);
	players.command(1);
	assert.equal(rival.direction, 1);
	assert.ok(rival.manual > 0);
	// The rig takes the keys: the competitor left behind stands down at once and
	// its own policy is live again, instead of coasting on the old command.
	assert.equal(players.setActive(0), true);
	assert.equal(rival.direction, 0);
	assert.ok(Number.isNaN(rival.target));
	assert.equal(rival.manual, 0);
	// Taking a running competitor's controls does not silence its policy either.
	assert.equal(players.setActive(1), true);
	assert.equal(rival.manual, 0);
});

test('switching players moves the controls and the force setting with them', () => {
	const world = fresh();
	assert.equal(players.setForce(0.6), 0.6);
	near(world.forceSetting, 0.6);
	assert.equal(players.setActive(1), true);
	assert.equal(players.state.active, 1);
	assert.equal(players.rigActive(), false);
	// The force writer addresses the selected player, not the rig behind it.
	assert.equal(players.setForce(0.3), 0.3);
	near(players.force(1), 0.3);
	near(world.forceSetting, 0.6);
	assert.equal(ceiling.state.funds >= 0, true);
	players.command(1);
	assert.ok(players.state.rivals[0].manual > 0);
	assert.equal(players.state.force, 0.3);
	assert.equal(players.setActive(0), true);
	assert.equal(players.rigActive(), true);
	near(players.force(0), 0.6);
	assert.equal(players.setActive(0), false);
});

// How deep any underside point of the upper hull is inside the lower body, over
// one pose. A point above the plate or the deck is not penetration.
function hullPenetration(upper, lower, lowerPlayer) {
	let deepest = 0;
	const half = players.halfWidth;
	const bottom = players.bodyBottom;
	const cosine = Math.cos(upper.angle);
	const sine = Math.sin(upper.angle);
	for (let localX = -half; localX <= half + 1e-9; localX += 0.02) {
		const x = upper.x + cosine * localX - sine * bottom;
		const y = upper.y + sine * localX + cosine * bottom;
		const dx = x - lower.x;
		if (Math.abs(dx) > half + players.tailPlate) continue;
		const top = lower.y + players.profileAt(lowerPlayer, dx);
		if (top - y > deepest) deepest = top - y;
	}
	return deepest;
}

test('a platform riding over another never sinks into it and never stutters', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	rival.bot = false;
	rival.target = NaN;
	rival.direction = 0;
	rival.x = 12;
	rival.vx = 0;
	rival.tailLeft = 0;
	rival.tailRight = 0;
	world.platform.x = 7;
	world.platform.y = 0;
	world.platform.vx = 0;
	world.platform.angle = 0;
	world.direction = 1;
	world.target = NaN;
	world.forceSetting = 0.6;
	let deepest = 0;
	let previousY = world.platform.y;
	let previousAngle = world.platform.angle;
	for (let i = 0; i < 240 * 4; i++) {
		players.update(world, c.step);
		physics.step(world, c.step);
		if (Math.abs(world.platform.x - rival.x) < players.halfWidth * 2) {
			const penetration = hullPenetration(world.platform, rival, rival);
			if (penetration > deepest) deepest = penetration;
		}
		// The pose is continuous: the base falls at the drop rate and climbs with
		// the ground passing under the hull, never by more than the platform moves.
		const climb = (c.platformDropRate + Math.abs(world.platform.vx)) * c.step + 1e-6;
		assert.ok(Math.abs(world.platform.y - previousY) <= climb, 'the base moves like a machine, not a jump');
		assert.ok(Math.abs(world.platform.angle - previousAngle) <= c.platformPitchRate * c.step + 1e-9, 'the pitch slews at its own rate');
		previousY = world.platform.y;
		previousAngle = world.platform.angle;
		if (world.platform.x > 16) break;
	}
	assert.ok(world.platform.x > 16, 'the rig crossed the competitor');
	assert.ok(deepest < 0.01, 'the upper hull stays out of the lower body, measured ' + deepest);
	// The pair never trades places: the parked competitor is not lifted by the
	// platform riding over it.
	near(rival.y, 0, 0.02);
});

test('a mid-crossing power change keeps the hull already on top', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	rival.x = 16; rival.bot = false; rival.force = 0.9; rival.direction = -1; rival.vx = 0; rival.target = NaN;
	rival.tailLeft = 0; rival.tailRight = 0;
	world.platform.x = 12; world.platform.vx = 0; world.direction = 0; world.target = NaN;
	let cut = false, flipped = false, deepest = 0;
	let rigY = world.platform.y, rivalY = rival.y;
	let maxJump = 0;
	for (let i = 0; i < 240 * 4; i++) {
		// The rider brakes and the lower hull starts driving while the pair is
		// still overlapping: the power ranking would swap them without a latch.
		if (rival.y > 0.35 && !cut) {
			rival.direction = 0;
			rival.braking = true;
			world.direction = 1;
			world.forceSetting = 0.9;
			cut = true;
		}
		players.update(world, c.step);
		physics.step(world, c.step);
		const rigJump = Math.abs(world.platform.y - rigY);
		const rivalJump = Math.abs(rival.y - rivalY);
		maxJump = Math.max(maxJump, rigJump, rivalJump);
		if (cut && world.platform.y > rival.y + 0.02) flipped = true;
		if (Math.abs(world.platform.x - rival.x) < players.halfWidth * 2) {
			deepest = Math.max(deepest, hullPenetration(rival, world.platform, players.state.rig));
		}
		rigY = world.platform.y; rivalY = rival.y;
	}
	assert.ok(cut, 'the competitor climbed onto the rig before its drive was cut');
	assert.equal(flipped, false, 'a brake and a direction change do not trade the hulls');
	assert.equal(world.platform.y, 0, 'the lower hull stays on the floor');
	assert.ok(rivalY >= 0 && maxJump < 0.05, 'no body teleports through the other');
	assert.ok(deepest < 0.03, 'a moving pair stays within a sampling step, measured ' + deepest);
});

test('a rival buys and installs its own research, coil and engine with sale proceeds', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	players.setBot(1, false);
	rival.x = physics.platformMax();
	rival.vx = 0;
	rival.cargoCells = 100;
	rival.cargoValue = 2000;
	players.update(world, c.step);
	assert.equal(rival.soldValue, 2000);
	assert.equal(ceiling.state.funds, 0, 'a rival sale never becomes rig credit');

	assert.equal(research.research('materials', world, rival.id), true);
	assert.equal(research.research('electromagnetics', world, rival.id), true);
	assert.equal(equipment.install('coil', world, rival.id), true);
	assert.equal(research.research('traction', world, rival.id), true);
	assert.equal(equipment.install('motor', world, rival.id), true);
	assert.equal(research.state.completed, 0, 'the rig did not inherit the rival research');
	assert.equal(research.stateFor(rival.id).completed, 3);
	assert.equal(equipment.isInstalled('coil'), false, 'the rig did not inherit the coil');
	assert.equal(physics.pulseNow(), 42);
	assert.equal(physics.pulseNow(rival.id), 58);
	assert.equal(physics.engineNow().id, 'electric');
	rival.x = physics.platformMin();
	rival.vx = 0;
	assert.equal(equipment.buyEngine('hand', world, rival.id), true);
	assert.equal(physics.engineNow(rival.id).id, 'hand');
	assert.ok(physics.machineMass(world, rival) > physics.platformMass(world));
	near(rival.money + rival.spent, rival.soldValue);
	assert.equal(rival.ledger.length, 6);
	assert.ok(rival.ledger.every(entry => entry.credits >= 0));

	players.setActive(1);
	rival.x = 12;
	rival.vx = 0;
	const expected = physics.forceNow(rival.id) * rival.force / physics.machineMass(world, rival) * c.step;
	players.command(1);
	players.update(world, c.step);
	near(rival.vx, expected, 1e-9, 'the bought engine and motor drive their owner');
});

test('a bot rival automatically invests its own takings and preserves sale accounting', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	rival.x = physics.platformMax();
	rival.vx = 0;
	rival.cargoCells = 100;
	rival.cargoValue = 2000;
	players.update(world, c.step);
	assert.equal(research.state.completed, 0);
	// 2000 cr buys the pulse chain (materials 180, electromagnetics 300, coil
	// 400) and the drive chain (traction 380, motor 550), then stops at alloys
	// (240) only because the mass cut is not what the machine needs first.
	assert.equal(research.stateFor(rival.id).completed, 3);
	assert.equal(equipment.isInstalled('coil', rival.id), true);
	assert.equal(equipment.isInstalled('motor', rival.id), true);
	assert.equal(equipment.isInstalled('coil'), false);
	// A rival's policy never opens the page overlay and never pays for it: the
	// computer chain waits until the machine's own pulse and drive are bought.
	assert.equal(research.stateFor(rival.id).prediction, false, 'no overlay research before the machine can use it');
	assert.equal(research.isResearched('ballistics', rival.id), false);
	assert.equal(rival.buildIndex, 5, 'the bot stops at the next purchase it can afford nothing of');
	assert.equal(rival.money, 190);
	assert.equal(rival.spent, 1810);
	near(rival.soldValue, rival.money + rival.spent);
	assert.match(rival.ledger[rival.ledger.length - 1].label, /High-torque motor/);
});

test('the page computer belongs to the selected player rather than to a shared research pool', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	research.grant('ballistics', world, 'rig');
	players.setActive(0);
	assert.equal(prediction.predictAll(world).kind, prediction.kinds.GROUND, 'rig computer works');
	assert.ok(prediction.pathCount > 0);
	players.setActive(1);
	assert.equal(prediction.predictAll(world).kind, prediction.kinds.PARKED);
	assert.equal(prediction.pathCount, 0, 'rig research does not unlock the rival overlay');
	research.grant('ballistics', world, rival.id);
	assert.notEqual(prediction.predictAll(world).kind, prediction.kinds.PARKED);
	assert.ok(prediction.pathCount > 0, 'the rival computer follows its own profile');
	players.setActive(0);
	assert.equal(prediction.predictAll(world).kind, prediction.kinds.GROUND);
});

test('the rival tilt keeper bisects its own contact face and leaves the rig alone', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	const ball = world.balls[0];
	world.platform.x = 3;
	rival.x = 8;
	rival.y = 0;
	rival.angle = 0;
	rival.vx = 1;
	rival.previousX = 8;
	rival.previousY = 0;
	rival.previousAngle = 0;
	rival.stepVx = 1;
	rival.stepVy = 0;
	rival.stepOmega = 0;
	rival.bot = true;
	rival.drive = true;
	ball.state = 'flying';
	ball.holder = null;
	ball.x = 8.63;
	ball.y = 2.5;
	ball.vx = 0;
	ball.vy = -4;
	for (let i = 0; i < 6; i++) players.update(world, c.step);
	assert.equal(rival.contactOnPiston, true);
	assert.ok(Math.abs(rival.wantedAngle) > 0.01, 'the keeper found a corrective tilt');
	assert.ok(Math.abs(rival.pistonAngle) > 0, 'the physical piston slews toward the solution');
	assert.ok(Math.abs(rival.pistonAngle) <= c.pistonSlewRate * c.step * 6 + 1e-9);
	assert.equal(world.platform.angle, 0, 'the rival keeper never writes the rig tilt');

	const path = prediction.predict(world, ball, rival.id);
	assert.equal(path.surface, prediction.surfaces.PISTON);
	const out = physics.contactResult();
	const push = physics.launchCapacity(world, rival);
	physics.solveFace(world, rival, path.endVx, path.endVy, rival.wantedAngle, push, out, undefined, undefined, ball);
	assert.ok(Math.abs(out.vx) < 0.04, 'the solved face sends the ball nearly vertically, measured ' + out.vx);
	physics.solveFace(world, rival, path.endVx, path.endVy, 0, push, out, undefined, undefined, ball);
	assert.ok(Math.abs(out.vx) > 0.5, 'the correction is caused by the keeper tilt');

	const manualAngle = rival.pistonAngle;
	players.overrideMachine(rival, 'angle');
	players.update(world, c.step);
	assert.equal(rival.pistonAngle, manualAngle, 'manual tilt suspends only the rival tilt keeper');
	rival.drive = false;
	players.overrideMachine(rival, 'drive');
	players.update(world, c.step);
	assert.equal(rival.drive, false, 'manual drive outranks the automatic pulse decision');
	rival.tiltManual = 0;
	rival.driveManual = 0;
	players.update(world, c.step);
	assert.equal(rival.drive, true, 'the keeper resumes when the override expires');
});

test('a bot rival spends on its own machine before page-only research', () => {
	const world = fresh();
	const rival = players.state.rivals[0];
	const order = [];
	rival.x = physics.platformMax();
	rival.vx = 0;
	// A long settlement sequence: each sale funds the next affordable step.
	for (let sale = 0; sale < 12; sale++) {
		rival.cargoCells = 100;
		rival.cargoValue = 900;
		rival.x = physics.platformMax();
		players.update(world, c.step);
		order.push(rival.lastPurchase);
	}
	// Nothing the rival's policy cannot read is ever bought: no page overlay
	// until the machine's own pulse and drive are complete, and no ball tier,
	// radiator, flywheel or metallurgy at all.
	const firstPulse = order.findIndex(label => /Drive coil/.test(label));
	const computer = order.findIndex(label => /Ballistic computer/.test(label));
	assert.ok(firstPulse >= 0, 'the coil is bought');
	assert.ok(computer < 0 || computer > firstPulse, 'the overlay never precedes the machine');
	assert.ok(!order.some(label => /Hardened|Spiked|Impact forging|Radiator|Vent grille|Heavy radiator|Brake flywheel|Flywheel/.test(label)), 'no research the policy cannot use');
	assert.equal(equipment.isInstalled('grader', rival.id), false, 'no rival buys the rig-only blade');
	near(rival.soldValue, rival.money + rival.spent);
});
