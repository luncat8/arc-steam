'use strict';
// Measurement: does a climbing wheel ever meet a folded plate?
//
// The plates are the ramps, so the whole claim "a climbing wheel always meets a
// 45° plate instead of a wall" is a claim about two moments per crossing:
//
//   approach  - a wheel leaves the floor onto the plate. A folded plate here is
//               a 0.6 m wall the hull has to beach itself on.
//   run-off   - a wheel leaves the deck onto the plate. A folded plate here is a
//               ledge: the wheel drops a body height instead of rolling down.
//
// Both are read from the simulation the drawing reads, so the plate angle
// reported is the angle the wheels are riding.
const harness = require('./harness.cjs');
const physics = harness.physics;
const players = require('../js/players.js');
const c = physics.config;
const half = c.platformWidth * 0.5;
const span = c.platformWheelHalfSpan;
const radius = c.platformWheelRadius;
const run = players.bodyTop * Math.tan(players.tailAngle);

function wheelX(body, side) {
	return body.x + side * span * Math.cos(body.angle) - radius * Math.sin(body.angle);
}

// A player record owns its plates; the rig's pose lives on the world's platform.
function poseOf(world, player) {
	return player.kind === 'rig' ? world.platform : player;
}

// Which part of `base` is under x: its deck, its plate, or nothing.
function partOf(world, base, x) {
	const dx = x - poseOf(world, base).x;
	if (Math.abs(dx) <= half) return 'deck';
	if (Math.abs(dx) <= half + run) return dx < 0 ? 'plateLeft' : 'plateRight';
	return 'off';
}

function plateAngle(base, part) {
	return part === 'plateLeft' ? base.tailLeft : base.tailRight;
}

function watch(label, world, base, rider, seconds, drive) {
	const approach = [];
	const runOff = [];
	const previous = ['', ''];
	let highest = 0;
	for (let i = 0; i < 240 * seconds; i++) {
		if (drive) drive(world, i);
		players.update(world, c.step);
		physics.step(world, c.step);
		const body = poseOf(world, rider);
		for (let k = 0; k < 2; k++) {
			const part = partOf(world, base, wheelX(body, k ? 1 : -1));
			const before = previous[k];
			previous[k] = part;
			if (part === before || part.indexOf('plate') !== 0) continue;
			const angle = plateAngle(base, part) * 180 / Math.PI;
			if (before === 'off') approach.push(angle);
			else if (before === 'deck') runOff.push(angle);
		}
		if (body.y > highest) highest = body.y;
	}
	const worst = list => (list.length ? Math.min(...list).toFixed(0) + '° over ' + list.length : 'none');
	console.log(
		label.padEnd(30),
		'approach plate', worst(approach).padEnd(14),
		'run-off plate', worst(runOff).padEnd(14),
		'peak ride', highest.toFixed(2) + ' m'
	);
}

function fresh(rivalX) {
	const world = physics.createWorld();
	players.init(world, 1);
	const rival = players.state.rivals[0];
	rival.bot = false;
	rival.x = rivalX;
	rival.vx = 0;
	rival.target = NaN;
	rival.direction = 0;
	world.platform.x = rivalX - 8;
	world.platform.vx = 0;
	world.direction = 1;
	world.target = NaN;
	return { world, rival };
}

function driveAt(speed) {
	return world => { world.platform.vx = Math.min(speed, world.platform.vx + 4 * c.step); };
}

// Drive over a parked competitor, left to right, across the speed range.
for (const speed of [1, 4, 8, 12]) {
	const { world, rival } = fresh(16);
	watch(`rig rides over at ${speed} m/s`, world, rival, players.state.players[0], 10, driveAt(speed));
}

// The same crossing from the other side, so the left plate is the run-off.
for (const speed of [1, 4]) {
	const { world, rival } = fresh(10);
	world.platform.x = 18;
	world.direction = -1;
	watch(`rig rides over leftwards ${speed}`, world, rival, players.state.players[0], 10, driveAt(speed));
}

// Climb on, stop on the deck, then drive off: the pause is when a plate used to
// fold under the rider.
{
	const { world, rival } = fresh(16);
	watch('rig stops on the deck, then off', world, rival, players.state.players[0], 12, (w, i) => {
		const phase = i / 240;
		if (phase < 3) w.platform.vx = Math.min(2, w.platform.vx + 4 * c.step);
		else if (phase < 7) w.platform.vx = 0;
		else w.platform.vx = Math.min(2, w.platform.vx + 4 * c.step);
	});
}

// Reverse off the deck: the run-off is over the plate the rig climbed.
{
	const { world, rival } = fresh(16);
	watch('rig climbs on, reverses off', world, rival, players.state.players[0], 12, (w, i) => {
		const phase = i / 240;
		if (phase < 4) w.platform.vx = Math.min(2, w.platform.vx + 4 * c.step);
		else w.platform.vx = Math.max(-2, w.platform.vx - 4 * c.step);
	});
}

// A competitor rides over the rig, under its own policy.
{
	const world = physics.createWorld();
	players.init(world, 1);
	const rival = players.state.rivals[0];
	rival.bot = true;
	rival.x = 6;
	rival.direction = 1;
	world.platform.x = 14;
	world.platform.vx = 0;
	world.platform.direction = 0;
	world.platform.target = NaN;
	world.ball.x = 6;
	world.ball.y = 5;
	world.ball.vx = 1.5;
	world.ball.vy = 0;
	world.ball.state = 'flying';
	harness.sync(world);
	watch('bot rival rides over the rig', world, players.state.players[0], rival, 30, null);
}
