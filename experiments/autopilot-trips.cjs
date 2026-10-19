'use strict';
// Measured autopilot shifts (manual measurement script, not in node --test).
// Runs the same seeded scenario under each policy so the plan's claims are
// measured rather than assumed: the ball stays off the ground, the timed
// intercept costs less than the plain chase, the drive keeper bounds the ball's
// speed, and the tilt keeper leaves the bounce travelling vertically.
const harness = require('./harness.cjs');
const ceiling = harness.ceiling;
const physics = harness.physics;
const autopilot = require('../js/autopilot.js');
const c = physics.config;

const channels = ['move', 'smart', 'drive', 'angle'];

// A fixed off-centre start keeps the platform away from the free charge pad, so
// the reserve draw is movement and pulses only.
function scenario(world) {
	world.platform.x = 5;
	world.platform.vx = 0;
	world.target = NaN;
	world.direction = 0;
	world.ball.x = 5;
	world.ball.y = 6;
	world.ball.vx = 1.5;
	world.ball.vy = 0;
	world.ball.state = 'flying';
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

function prepare(flywheel) {
	const world = physics.createWorld();
	if (flywheel) harness.buy(world, 'flywheel');
	return scenario(world);
}

function run(label, seconds, policy, flywheel) {
	const world = prepare(flywheel);
	for (const channel of channels) autopilot.set(channel, false);
	autopilot.reset();
	for (const channel of policy.channels) autopilot.set(channel, true);
	const simulate = physics.step;
	const contacts = [];
	let seenBounces = world.bounces;
	let seenAngle = world.pistonAngle;
	let maxAngleRate = 0;
	physics.step = function (stepped, dt) {
		seenBounces = stepped.bounces;
		simulate(stepped, dt);
		maxAngleRate = Math.max(maxAngleRate, Math.abs(stepped.pistonAngle - seenAngle) / dt);
		seenAngle = stepped.pistonAngle;
		if (stepped.bounces > seenBounces && stepped.ball.state === 'flying') {
			contacts.push({ vx: stepped.ball.vx, vy: stepped.ball.vy, angle: stepped.pistonAngle });
		}
	};
	const batteryStart = world.battery;
	const stat = {
		apex: 0, speed: 0, travel: 0, driveOn: 0, steps: 0, temperature: c.ambientTemperature,
		heldSteps: 0, maxAngle: 0
	};
	let previousX = world.platform.x;
	while (world.time < seconds && world.battery > 45) {
		if (policy.manual) policy.manual(world);
		autopilot.update(world, c.step);
		physics.step(world, c.step);
		if (world.ball.state === 'held') {
			stat.heldSteps++;
			// Only the policies without the drive keeper are helped by hand: the
			// keeper releases a caught ball as part of its own rule.
			if (!policy.channels.includes('drive')) physics.launch(world);
		}
		if (world.ball.state === 'grounded') world.target = world.ball.x;
		const rise = Math.max(0, world.ball.vy);
		if (world.ball.state === 'flying') stat.apex = Math.max(stat.apex, world.ball.y + rise * rise / (2 * c.ballGravity));
		stat.speed = Math.max(stat.speed, Math.hypot(world.ball.vx, world.ball.vy));
		stat.travel += Math.abs(world.platform.x - previousX);
		previousX = world.platform.x;
		if (world.drive) stat.driveOn++;
		stat.steps++;
		stat.temperature = Math.max(stat.temperature, physics.temperature(world));
		stat.maxAngle = Math.max(stat.maxAngle, Math.abs(world.pistonAngle));
	}
	physics.step = simulate;
	let horizontal = 0;
	let worstHorizontal = 0;
	for (const contact of contacts) {
		horizontal += Math.abs(contact.vx);
		worstHorizontal = Math.max(worstHorizontal, Math.abs(contact.vx));
	}
	const drawn = batteryStart - world.battery + world.importedEnergy;
	const waste = world.heat + world.cooledEnergy;
	const perBounce = world.bounces ? drawn / world.bounces : 0;
	console.log([
		label.padEnd(26),
		(flywheel ? 'flywheel' : 'base    '),
		't=' + world.time.toFixed(1).padStart(6),
		'bnc=' + String(world.bounces).padStart(4),
		'psh=' + String(world.pushes).padStart(4),
		'grd=' + world.groundings,
		'held=' + String(Math.round(stat.heldSteps / 240)).padStart(3) + 's',
		'draw=' + drawn.toFixed(0).padStart(6) + 'J',
		'J/bnc=' + perBounce.toFixed(1).padStart(6),
		'waste=' + waste.toFixed(0).padStart(6) + 'J',
		'travel=' + stat.travel.toFixed(0).padStart(5) + 'm',
		'apex=' + stat.apex.toFixed(2).padStart(6),
		'ballv=' + stat.speed.toFixed(2).padStart(6),
		'drive=' + (100 * stat.driveOn / stat.steps).toFixed(0).padStart(3) + '%',
		'|vx|=' + (contacts.length ? (horizontal / contacts.length).toFixed(2) : '  - ').padStart(5),
		'vxmax=' + (contacts.length ? worstHorizontal.toFixed(2) : '  - ').padStart(5),
		'tilt=' + (stat.maxAngle * 180 / Math.PI).toFixed(1).padStart(4) + '°',
		'slew=' + (maxAngleRate * 180 / Math.PI).toFixed(0).padStart(3) + '°/s',
		'T=' + stat.temperature.toFixed(1).padStart(5),
		'cargo=' + String(ceiling.state.caughtCells).padStart(4),
		'bal=' + (physics.totalEnergy(world) - world.initialEnergy).toExponential(1)
	].join(' '));
	return { drawn, perBounce, waste, travel: stat.travel, groundings: world.groundings, apex: stat.apex, speed: stat.speed, contacts, slew: maxAngleRate };
}

const manual = { manual(world) { world.target = world.ball.x; }, channels: [] };
const chase = { channels: ['move'] };
const timed = { channels: ['smart'] };
const keeper = { channels: ['move', 'drive'] };
const level = { channels: ['move', 'angle'] };
const fullChase = { channels: ['move', 'drive', 'angle'] };
const fullTimed = { channels: ['smart', 'drive', 'angle'] };

console.log('apex target (ceiling - radius) =', (c.ceiling - c.radius).toFixed(2), 'm · pulse apex gain =', (physics.pulseNow() / (c.ballMass * c.ballGravity)).toFixed(2), 'm · rock underside =', ceiling.state.bottom, 'm');
console.log('tilt actuator =', (c.pistonSlewRate * 180 / Math.PI).toFixed(0), '°/s · range =', (c.pistonMaxAngle * 180 / Math.PI).toFixed(0), '°');
run('manual chase (scripted)', 120, manual, false);
run('autopilot x chase', 120, chase, false);
run('autopilot X timed', 120, timed, false);
run('autopilot z drive', 120, keeper, false);
run('autopilot c tilt', 120, level, false);
run('autopilot x z c', 120, fullChase, false);
run('autopilot X z c', 120, fullTimed, false);
run('autopilot x z c', 120, fullChase, true);
run('autopilot X z c', 120, fullTimed, true);
