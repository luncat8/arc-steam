'use strict';
// Focused regressions from play: selected-bot catch, blocked sale, pad recovery,
// and two shared balls. No browser or legacy suites required.
const assert = require('node:assert/strict');
const h = require('./harness.cjs');
const physics = h.physics;
const players = require('../js/players.js');
const autopilot = require('../js/autopilot.js');
const c = physics.config;

function fresh(mode) {
	const world = physics.createWorld();
	players.init(world, 1);
	players.setBallMode(mode || 'shared1');
	for (const channel of ['move', 'smart', 'drive', 'angle']) autopilot.set(channel, false);
	autopilot.reset();
	return world;
}
function step(world) {
	autopilot.update(world, c.step);
	players.update(world, c.step);
	physics.step(world, c.step);
}
function report(label, detail) { console.log(label.padEnd(22), detail); }

{
	const world = fresh();
	const rival = players.state.rivals[0];
	const ball = world.balls[0];
	rival.x = 12; rival.vx = 0;
	ball.state = 'held'; ball.holder = rival.id;
	players.setActive(1);
	step(world);
	assert.equal(ball.state, 'flying');
	report('selected bot', 'catch released on the first step; BOT remains checked');
}
{
	const world = fresh();
	const rival = players.state.rivals[0];
	world.balls[0].state = 'held'; world.balls[0].holder = 'rig';
	rival.x = 12; rival.vx = 0; rival.cargoCells = 100; rival.cargoValue = 200;
	let frames = 0;
	while (rival.cargoCells > 0 && frames++ < 240 * 15) step(world);
	assert.equal(rival.soldValue, 200);
	report('blocked sale', 'full hopper sold in ' + (frames * c.step).toFixed(2) + ' s with no playable ball');
}
{
	const world = fresh();
	world.platform.x = 4; world.platform.vx = 0; world.battery = c.battery * 0.1;
	h.sync(world);
	players.setBot(0, true);
	let frames = 0;
	while (!players.state.recharging && frames++ < 240 * 20) step(world);
	assert.equal(players.state.recharging, true);
	while (players.state.recharging && frames++ < 240 * 50) step(world);
	assert.ok(world.battery >= c.battery * 0.95);
	assert.equal(autopilot.suspended('move'), false);
	report('pad recovery', (frames * c.step).toFixed(2) + ' s, reserve ' + (world.battery / 1000).toFixed(2) + ' kJ');
}
for (const start of [4, 12, 20]) {
	const world = fresh('shared2');
	world.platform.x = start; world.platform.vx = 0;
	players.state.rivals[0].bot = false;
	players.setBot(0, true);
	let idle = 0, worstIdle = 0, switches = 0, previous = world.focus;
	for (let frame = 0; frame < 240 * 60; frame++) {
		step(world);
		if (world.focus !== previous) { switches++; previous = world.focus; }
		const playable = world.balls.some(ball => ball.state !== 'grounded');
		idle = playable ? 0 : idle + c.step;
		worstIdle = Math.max(worstIdle, idle);
	}
	assert.ok(world.bounces > 0);
	assert.ok(Math.abs(physics.totalEnergy(world) - world.initialEnergy) < 1e-5);
	report('two balls x=' + start, 'bounces=' + world.bounces + ' focus switches=' + switches + ' longest both grounded=' + worstIdle.toFixed(2) + ' s');
}
