'use strict';
// Level launches at three naturally flat spawn roofs of equal height. Keep the
// rig parked and the intake off; only the piston is drawing on the reserve.
// Run: node experiments/wild-piston-probe.cjs
const assert = require('node:assert/strict');
const minerals = require('../js/minerals.js');
const physics = require('../js/physics.js');
const equipment = require('../js/equipment.js');
const research = require('../js/research.js');
const players = require('../js/players.js');
const mine = require('../js/wild-mine.js');
const wildBall = require('../js/wild-ball.js');

function study(world, id) {
	if (research.isResearched(id)) return;
	for (const prerequisite of research.find(id).requires) study(world, prerequisite);
	assert.ok(research.grant(id, world));
}

function measure(seed, gear, head) {
	const world = physics.createWorld();
	players.init(world, 0);
	const cave = mine.init(world, { seed });
	world.wildWater.intakeOn = false;
	for (const id of gear) {
		study(world, equipment.find(id).requires);
		assert.ok(equipment.grant(id, world));
	}
	if (head !== 'standard') {
		study(world, 'impact');
		assert.ok(equipment.installBall(head, world, true));
	}

	const ball = world.balls[0];
	const startReserve = world.battery;
	assert.ok(physics.launch(world, ball));
	const pulse = world.lastPush;
	const col = cave.columnAt(ball.x);
	const x = cave.worldX(col);
	const row = cave.rowAt(cave.roofAbove(x, ball.y));
	const y = cave.worldY(row);
	const strength = cave.strengthAt(col, row);
	const mix = cave.mixAt(col, row);
	const share = Math.max(...mix);
	const mineral = minerals.mineralNames[mix.indexOf(share)];
	let firstFracture = null;
	let drift = Math.abs(physics.totalEnergy(world) - world.initialEnergy);
	while (world.time < 10 && ball.state !== 'held' && cave.solidAt(x, y)) {
		physics.step(world, physics.config.step);
		if (ball.hits && firstFracture === null) firstFracture = ball.lastFracture;
		drift = Math.max(drift, Math.abs(physics.totalEnergy(world) - world.initialEnergy));
	}
	return {
		target: `${mineral} ${(100 * share).toFixed(0)}% · ${strength.toFixed(2)} J/cell · (${col}, ${row})`,
		drift,
		result: {
			drive: gear.join('+') || 'stock', head, 'pulse J': pulse,
			'first fracture J': firstFracture === null ? 'no hit' : firstFracture.toFixed(2),
			'open at s': cave.solidAt(x, y) ? 'not open' : world.time.toFixed(2),
			hits: ball.hits, pulses: world.pushes, 'cells freed': wildBall.state.extractedCells,
			'reserve spent J': (startReserve - world.battery).toFixed(1)
		}
	};
}

const loadouts = [
	[[], 'standard'],
	[['coil'], 'standard'],
	[['coil', 'ram'], 'standard'],
	[['coil', 'ram'], 'hardened'],
	[['coil', 'ram'], 'spike']
];

mine.setMode('wild');
console.log('WILD PISTON · one level release on stock electric, then driven returns until the target cell opens (10 s limit)');
let worst = 0;
for (const seed of [20, 5, 24]) {
	const rows = [];
	for (const [gear, head] of loadouts) {
		const trial = measure(seed, gear, head);
		if (!rows.length) console.log(`\nSeed ${seed} · ${trial.target}`);
		rows.push(trial.result);
		worst = Math.max(worst, trial.drift);
	}
	console.table(rows);
}
console.log(`Maximum absolute ledger drift: ${worst.toExponential(2)} J`);
assert.ok(worst < 1e-8);
