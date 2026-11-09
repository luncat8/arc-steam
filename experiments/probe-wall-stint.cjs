'use strict';
// Probe the wall-stint mechanism: chase, two shared balls, x0=15. Log every
// step while the machine is pinned at the wall to see the ball states, the
// launch attempts and the temperature.
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

const minX = physics.platformMin();
const maxX = physics.platformMax();
const steps = Math.round(120 / c.step);
let wall = 0;
let worstWall = 0;
let wallStart = -1;
let logOpen = false;
let launchAttempts = 0;
let launchBlocks = 0;
const realLaunch = globalThis.SteamPhysics.launch;
globalThis.SteamPhysics.launch = function (w, t, m) {
	launchAttempts++;
	const ok = realLaunch.call(globalThis.SteamPhysics, w, t, m);
	if (!ok) launchBlocks++;
	return ok;
};

function logLine() {
	const ball = world.ball;
	console.log('t=' + world.time.toFixed(2).padStart(6) +
		' x=' + world.platform.x.toFixed(2).padStart(6) +
		' vx=' + world.platform.vx.toFixed(3).padStart(7) +
		' wall=' + wall.toFixed(1).padStart(5) +
		' T=' + physics.temperature(world).toFixed(1).padStart(6) +
		' batt=' + world.battery.toFixed(1).padStart(7) +
		' drive=' + world.drive +
		' balls=[' + world.balls.map(b => b.state.charAt(0) + (b.holder ? 'h' : '.')).join('') + ']' +
		' worldBall=' + (ball ? ball.state.charAt(0) + (ball.holder ? 'h' : '-') : '-') +
		' canLaunch=' + (ball && ball.state === 'held' ? (physics.canLaunch(world) ? 'Y' : 'N') : '-'));
}

for (let step = 0; step < steps; step++) {
	autopilot.update(world, c.step);
	physics.step(world, c.step);
	const atWall = world.platform.x <= minX + 0.05 || world.platform.x >= maxX - 0.05;
	wall = atWall ? wall + c.step : 0;
	if (wall > worstWall) worstWall = wall;
	if (atWall) {
		if (wallStart < 0) wallStart = world.time;
		if (wall < 1 || wall > worstWall - c.step || step % 25 === 0) logLine();
		logOpen = true;
	} else if (logOpen && wallStart >= 0) {
		console.log('--- left wall after ' + (world.time - wallStart).toFixed(1) + ' s at t=' + world.time.toFixed(2));
		logOpen = false;
		wallStart = -1;
	}
}
console.log('worstWall=' + worstWall.toFixed(1) + ' launchAttempts=' + launchAttempts + ' launchBlocks=' + launchBlocks + ' finalT=' + physics.temperature(world).toFixed(1));
