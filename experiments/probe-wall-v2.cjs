'use strict';
// Chase run at a given start, two shared balls: full stats like two-ball-trips,
// plus the wall stint trace. Argument: start x.
const harness = require('./harness.cjs');
const physics = harness.physics;
const autopilot = require('../js/autopilot.js');
const players = require('../js/players.js');
const c = physics.config;

const startX = Number(process.argv[2] || 15);

const world = physics.createWorld();
players.init(world, 1);
players.setBallMode('shared2');
world.platform.x = startX;
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
const balls = world.balls;
const flying = [0, 0];
const grounded = [0, 0];
let switches = 0;
let lastFocus = physics.focusBall(world);
let travel = 0;
let previousX = world.platform.x;
let worstWall = 0;
let wall = 0;
let dry = 0;
let inPlaySteps = 0;
let worstAbandon = 0;
let wait = [0, 0];
const steps = Math.round(120 / c.step);
const minX = physics.platformMin();
const maxX = physics.platformMax();

for (let step = 0; step < steps; step++) {
	autopilot.update(world, c.step);
	const focus = physics.focusBall(world);
	if (focus !== lastFocus) { switches++; lastFocus = focus; }
	physics.step(world, c.step);
	if (world.ball.state === 'held' && world.drive) physics.launch(world);
	let inPlay = false;
	let down = true;
	for (let i = 0; i < balls.length; i++) {
		const ball = balls[i];
		if (ball.state === 'flying') { flying[i] += c.step; wait[i] = 0; inPlay = true; down = false; }
		else if (ball.state === 'grounded') { grounded[i] += c.step; wait[i] += c.step; if (wait[i] > worstAbandon) worstAbandon = wait[i]; }
		else { inPlay = true; down = false; }
	}
	dry = inPlay ? 0 : dry + c.step;
	if (inPlay) inPlaySteps++;
	const atWall = Math.abs(world.platform.x - minX) < 0.05 || Math.abs(world.platform.x - maxX) < 0.05;
	wall = atWall ? wall + c.step : 0;
	if (wall > worstWall) worstWall = wall;
	if (step % 240 === 0) {
		const ball = world.ball;
		console.log('t=' + world.time.toFixed(3).padStart(8) +
			' x=' + world.platform.x.toFixed(2).padStart(6) +
			' vx=' + world.platform.vx.toFixed(3).padStart(7) +
			' T=' + physics.temperature(world).toFixed(1).padStart(6) +
			' wall=' + wall.toFixed(2).padStart(6) +
			' drive=' + world.drive +
			' balls=[' + balls.map(b => b.state.charAt(0) + (b.holder ? 'h' : '.') + b.x.toFixed(1)).join(',') + ']' +
			' worldB=' + (ball ? ball.state.charAt(0) + (ball.holder ? 'h' : '-') : '-') +
			' canL=' + (ball && ball.state === 'held' ? (physics.canLaunch(world) ? 'Y' : 'N') : '-') +
			' rel=' + (physics.releaseReady(world) ? 'Y' : 'N'));
	}
	travel += Math.abs(world.platform.x - previousX);
	previousX = world.platform.x;
}
console.log('any=' + (100 * inPlaySteps / steps).toFixed(0) +
	' fly=' + (100 * flying[0] / 120).toFixed(0) + '/' + (100 * flying[1] / 120).toFixed(0) +
	' grd=' + (100 * grounded[0] / 120).toFixed(0) + '/' + (100 * grounded[1] / 120).toFixed(0) +
	' worstWall=' + worstWall.toFixed(1) + ' waitmax=' + worstAbandon.toFixed(1) +
	' bnc=' + world.bounces + ' grd-n=' + world.groundings + ' sw=' + switches +
	' travel=' + travel.toFixed(0) + ' T=' + physics.temperature(world).toFixed(1) +
	' bal=' + (physics.totalEnergy(world) - world.initialEnergy).toExponential(2));
