'use strict';
// Detailed probe of one chase run at x0=15 (two shared balls). Log the first
// wall stint and everything around it: ball states/positions, launch blocks,
// temperature, target/direction, and which ball the autopilot is focused on.
const harness = require('./harness.cjs');
const physics = harness.physics;
const autopilot = require('../js/autopilot.js');
const players = require('../js/players.js');
const c = physics.config;

const world = physics.createWorld();
players.init(world, 1);
players.setBallMode('shared2');
world.platform.x = 15;
world.platform.vx = 0;
world.target = NaN;
world.direction = 0;
world.drive = true;
world.pistonAngle = 0;
world.battery = c.battery;
world.importedEnergy = 0;
world.chargedEnergy = 0;
world.heat = 0;
world.cooledEnergy = 0;
world.bounces = 0;
world.pushes = 0;
world.groundings = 0;
harness.sync(world);

for (const channel of ['move', 'drive', 'angle']) autopilot.set(channel, true);
autopilot.reset();
const steps = Math.round(120 / c.step);
const minX = physics.platformMin();
const maxX = physics.platformMax();
let wall = 0;
let inWallStint = false;
let stintStart = 0;

const realLaunch = globalThis.SteamPhysics.launch;
let attempts = 0, blocks = 0;
globalThis.SteamPhysics.launch = function (w, t, m) {
	attempts++;
	const ok = realLaunch.call(globalThis.SteamPhysics, w, t, m);
	if (!ok) blocks++;
	return ok;
};

function note(step, tag) {
	const b0 = world.balls[0], b1 = world.balls[1];
	const ball = world.ball;
	const held = physics.heldBall(world);
	console.log(tag +
		' t=' + world.time.toFixed(2).padStart(7) +
		' x=' + world.platform.x.toFixed(3).padStart(7) +
		' vx=' + world.platform.vx.toFixed(3).padStart(7) +
		' target=' + (Number.isFinite(world.target) ? world.target.toFixed(2).padStart(6) : '  nan ') +
		' dir=' + String(world.direction).padStart(2) +
		' drive=' + String(world.drive).padStart(5) +
		' T=' + physics.temperature(world).toFixed(1).padStart(6) +
		' batt=' + String(world.battery >> 0).padStart(7) +
		' b0=' + b0.state.charAt(0) + (b0.holder ? 'h' : '.') + b0.x.toFixed(2).padStart(6) +
		' b1=' + b1.state.charAt(0) + (b1.holder ? 'h' : '.') + b1.x.toFixed(2).padStart(6) +
		' worldB=' + (ball ? ball.state.charAt(0) + (ball.holder ? 'h' : '-') + ball.x.toFixed(2).padStart(6) : 'none') +
		' canLaunchHeld=' + (ball && ball.state === 'held' ? (physics.canLaunch(world) ? 'Y' : 'N') : '-') +
		' launchBlk=' + blocks + '/' + attempts);
}

let lastLogT = -9;
for (let step = 0; step < steps; step++) {
	autopilot.update(world, c.step);
	if (world.ball.state === 'held' && world.drive) physics.launch(world);
	physics.step(world, c.step);
	const atWall = world.platform.x <= minX + 0.05 || world.platform.x >= maxX - 0.05;
	wall = atWall ? wall + c.step : 0;
	if (atWall && !inWallStint) {
		inWallStint = true;
		stintStart = world.time;
		console.log('=== entered wall stint at t=' + stintStart.toFixed(2) + ' x=' + world.platform.x.toFixed(3));
	}
	if (inWallStint && (wall < 2 || world.time - lastLogT > 0.5 || !atWall)) {
		note(step, atWall ? 'W ' : 'L ');
		lastLogT = world.time;
	}
	if (inWallStint && !atWall) {
		console.log('=== left wall stint after ' + wall.toFixed(2) + ' s at t=' + world.time.toFixed(2));
		inWallStint = false;
	}
}
console.log('worstWall=' + wall.toFixed(1) + ' attempts=' + attempts + ' blocks=' + blocks + ' finalT=' + physics.temperature(world).toFixed(1));
