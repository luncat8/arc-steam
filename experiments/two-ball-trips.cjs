'use strict';
// Measured two-ball shifts (manual measurement script, not in node --test).
// Two shared balls and one platform. What the autopilot is judged on: whether a
// ball is in play at all, how much rock that mines, how often the intercept
// changes its mind, and what the shift costs in joules.
const harness = require('./harness.cjs');
const physics = harness.physics;
const autopilot = require('../js/autopilot.js');
const players = require('../js/players.js');
const c = physics.config;

const channels = ['move', 'smart', 'drive', 'angle'];
const seconds = 120;
const starts = [3, 6, 9, 12, 15, 18, 21];

function prepare(startX) {
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
	return world;
}

function run(label, startX, policy) {
	const world = prepare(startX);
	for (const channel of channels) autopilot.set(channel, false);
	autopilot.reset();
	for (const channel of policy.channels) autopilot.set(channel, true);
	const balls = world.balls;
	const flying = [0, 0];
	const grounded = [0, 0];
	let switches = 0;
	let lastFocus = physics.focusBall(world);
	let travel = 0;
	let previousX = world.platform.x;
	let worstAbandon = 0;
	let worstDry = 0;
	let dry = 0;
	let inPlaySteps = 0;
	let bothDown = 0;
	let bothDownSteps = 0;
	const wait = [0, 0];
	const steps = Math.round(seconds / c.step);
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
			else if (ball.state === 'grounded') {
				grounded[i] += c.step;
				wait[i] += c.step;
				if (wait[i] > worstAbandon) worstAbandon = wait[i];
			} else { inPlay = true; down = false; }
		}
		dry = inPlay ? 0 : dry + c.step;
		if (inPlay) inPlaySteps++;
		if (dry > worstDry) worstDry = dry;
		// Both balls on the floor at once: the state the report is about.
		if (down) { bothDownSteps++; if (dry === c.step) bothDown++; }
		travel += Math.abs(world.platform.x - previousX);
		previousX = world.platform.x;
	}
	const stat = {
		any: inPlaySteps / steps,
		mined: harness.ceiling.state.extractedCells,
		funds: harness.ceiling.state.funds,
		bounces: world.bounces,
		groundings: world.groundings,
		switches,
		travel,
		draw: c.battery - world.battery + world.importedEnergy,
		worstDry,
		worstAbandon,
		bothDown,
		bothDownSteps,
		temperature: physics.temperature(world),
		balance: physics.totalEnergy(world) - world.initialEnergy,
		flying,
		grounded
	};
	console.log([
		label.padEnd(10),
		'x0=' + String(startX).padStart(2),
		'any=' + (100 * stat.any).toFixed(0).padStart(3) + '%',
		'fly=' + (100 * flying[0] / seconds).toFixed(0).padStart(3) + '/' + (100 * flying[1] / seconds).toFixed(0).padStart(3) + '%',
		'grd=' + (100 * grounded[0] / seconds).toFixed(0).padStart(3) + '/' + (100 * grounded[1] / seconds).toFixed(0).padStart(3) + '%',
		'drymax=' + worstDry.toFixed(1).padStart(5) + 's',
		'waitmax=' + worstAbandon.toFixed(1).padStart(5) + 's',
		'bnc=' + String(world.bounces).padStart(3),
		'grd-n=' + String(world.groundings).padStart(2),
		'sw=' + String(switches).padStart(3),
		'bothdown=' + String(bothDown).padStart(3),
		'travel=' + travel.toFixed(0).padStart(4),
		'draw=' + stat.draw.toFixed(0).padStart(6) + 'J',
		'mined=' + String(stat.mined).padStart(3),
		'cr=' + stat.funds.toFixed(0).padStart(5),
		'T=' + stat.temperature.toFixed(0).padStart(3),
		'bal=' + stat.balance.toExponential(1)
	].join(' '));
	return stat;
}

function sweep(label, policy) {
	const total = { any: 0, mined: 0, funds: 0, bounces: 0, groundings: 0, switches: 0, travel: 0, draw: 0, worstDry: 0, worstAbandon: 0, temperature: 0, bothDown: 0, bothDownSteps: 0, runs: 0 };
	for (const start of starts) {
		const stat = run(label, start, policy);
		total.any += stat.any;
		total.mined += stat.mined;
		total.funds += stat.funds;
		total.bounces += stat.bounces;
		total.groundings += stat.groundings;
		total.switches += stat.switches;
		total.travel += stat.travel;
		total.draw += stat.draw;
		total.temperature += stat.temperature;
		total.bothDown += stat.bothDown;
		total.bothDownSteps += stat.bothDownSteps;
		total.worstDry = Math.max(total.worstDry, stat.worstDry);
		total.worstAbandon = Math.max(total.worstAbandon, stat.worstAbandon);
		total.runs++;
	}
	const runs = total.runs;
	console.log([
		('mean ' + label).padEnd(18),
		'any=' + (100 * total.any / runs).toFixed(0).padStart(3) + '%',
		'bnc=' + (total.bounces / runs).toFixed(0).padStart(3),
		'grd-n=' + (total.groundings / runs).toFixed(1).padStart(4),
		'sw=' + (total.switches / runs).toFixed(1).padStart(5),
		'bothdown=' + (total.bothDown / runs).toFixed(1).padStart(4),
		'downS=' + (total.bothDownSteps / runs / 240).toFixed(1).padStart(4),
		'travel=' + (total.travel / runs).toFixed(0).padStart(4),
		'draw=' + (total.draw / runs).toFixed(0).padStart(6) + 'J',
		'mined=' + (total.mined / runs).toFixed(0).padStart(3),
		'cr=' + (total.funds / runs).toFixed(0).padStart(5),
		'T=' + (total.temperature / runs).toFixed(0).padStart(3),
		'drymax=' + total.worstDry.toFixed(1) + 's',
		'waitmax=' + total.worstAbandon.toFixed(1) + 's'
	].join(' '));
	console.log('');
}

console.log('two shared balls, 120 s per start, one platform · force 60% · rock layer at 13 m');
sweep('chase', { channels: ['move', 'drive', 'angle'] });
sweep('timed', { channels: ['smart', 'drive', 'angle'] });
sweep('chase only', { channels: ['move'] });
sweep('timed only', { channels: ['smart'] });
