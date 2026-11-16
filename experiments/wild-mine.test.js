'use strict';
// Wild Mine M2 physics, D7 perspective warp, D8 camera follow, hull terrain
// collision, ±90° piston tilt and mode switching.
const assert = require('node:assert/strict');
const { test } = require('node:test');

const rockTable = require('../js/minerals.js');
const ceiling = require('../js/ceiling.js');
const physics = require('../js/physics.js');
const players = require('../js/players.js');
const wildMine = require('../js/wild-mine.js');

function resetClassic() {
	wildMine.setMode('classic');
	const world = physics.createWorld();
	players.init(world);
	return world;
}

test('Wild Mine mode switches between Classic and Wild cleanly with distinct piston bounds', () => {
	try {
		const classicWorld = resetClassic();
		assert.equal(physics.wildMode(), false);
		assert.equal(wildMine.isWild(), false);
		assert.ok(Math.abs(physics.pistonMaxAngleNow() - 10 * Math.PI / 180) < 1e-12);
		players.setPistonAngleOf(players.state.players[0], Math.PI / 2);
		assert.ok(Math.abs(players.pistonAngleOf(players.state.players[0]) - 10 * Math.PI / 180) < 1e-12);

		wildMine.setMode('wild');
		const world = physics.createWorld();
		players.init(world, 0);
		wildMine.init(world, { seed: 1 });
		assert.equal(physics.wildMode(), true);
		assert.equal(wildMine.isWild(), true);
		assert.equal(players.state.players.length, 1);
		assert.ok(Math.abs(physics.pistonMaxAngleNow() - Math.PI / 2) < 1e-12);

		players.setPistonAngleOf(players.state.players[0], Math.PI / 2);
		assert.ok(Math.abs(players.pistonAngleOf(players.state.players[0]) - Math.PI / 2) < 1e-12);
		players.setPistonAngleOf(players.state.players[0], -Math.PI * 0.75);
		assert.ok(Math.abs(players.pistonAngleOf(players.state.players[0]) + Math.PI / 2) < 1e-12);
	} finally {
		resetClassic();
	}
});

test('D7 vertical perspective anchors at 1.0x near P2, eases to minScale at scaleSpan, and round-trips exactly', () => {
	const anchorY = 32;
	assert.equal(wildMine.scaleAt(anchorY, anchorY), 1);
	assert.equal(wildMine.drawnY(anchorY, anchorY), anchorY);
	assert.equal(wildMine.scaleAt(anchorY + wildMine.scaleSpan, anchorY), wildMine.minScale);
	assert.equal(wildMine.scaleAt(anchorY - wildMine.scaleSpan, anchorY), wildMine.minScale);
	assert.equal(wildMine.scaleAt(anchorY + wildMine.scaleSpan * 2, anchorY), wildMine.minScale);

	let previousDrawn = -Infinity;
	for (let y = 0; y <= 64; y += 0.25) {
		const d = wildMine.drawnY(y, anchorY);
		assert.ok(d > previousDrawn, `drawnY strictly monotonic at y=${y}`);
		previousDrawn = d;
		const recovered = wildMine.worldY(d, anchorY);
		assert.ok(Math.abs(recovered - y) < 1e-9, `worldY(drawnY(${y})) = ${recovered}`);
	}
});

test('D8 camera tracks player smoothly and updates anchorY cleanly without abrupt snaps', () => {
	try {
		wildMine.setMode('wild');
		const world = physics.createWorld();
		players.init(world, 0);
		wildMine.init(world, { seed: 4 });
		const startCamX = wildMine.camera.x;
		const startAnchorY = wildMine.camera.anchorY;
		world.drive = true;
		world.direction = 1;
		world.forceSetting = 1;
		for (let i = 0; i < 240; i++) physics.step(world, physics.config.step);
		assert.ok(wildMine.camera.x > startCamX + 0.5, 'camera follows rig rightward');
		assert.ok(Math.abs(wildMine.camera.x - world.platform.x) < 4, 'camera stays bounded near rig');
		assert.ok(Math.abs(wildMine.camera.anchorY - startAnchorY) < 4, 'anchorY moves smoothly with P2');
	} finally {
		resetClassic();
	}
});

test('Wild Mine starts clear on shelf across seeds 1-5 and drives back and forth preserving energy', () => {
	try {
		wildMine.setMode('wild');
		for (let seed = 1; seed <= 5; seed++) {
			const world = physics.createWorld();
			players.init(world, 0);
			wildMine.init(world, { seed });
			assert.equal(wildMine.hullClear(world.platform.x, world.platform.y), true, `seed ${seed} start hull clear`);
			assert.equal(world.ball.state, 'held', `seed ${seed} holds P2 at start`);

			world.drive = true;
			world.forceSetting = 0.8;
			world.direction = 1;
			for (let i = 0; i < 180; i++) physics.step(world, physics.config.step);
			const rightX = world.platform.x;
			assert.ok(rightX > 0.5, `seed ${seed} drove right (${rightX})`);
			assert.equal(wildMine.hullClear(world.platform.x, world.platform.y), true, `seed ${seed} clear right`);

			world.direction = -1;
			for (let i = 0; i < 480; i++) physics.step(world, physics.config.step);
			assert.ok(world.platform.x < rightX - 0.5, `seed ${seed} drove back left (${world.platform.x} < ${rightX})`);
			assert.equal(wildMine.hullClear(world.platform.x, world.platform.y), true, `seed ${seed} clear left`);
			const drift = Math.abs(physics.totalEnergy(world) - world.initialEnergy);
			assert.ok(drift < 1e-8, `seed ${seed} energy drift ${drift} < 1e-8`);
		}
	} finally {
		resetClassic();
	}
});

test('seed 4 right cliff descent drops below shelf smoothly with clear hull and zero energy drift', () => {
	try {
		wildMine.setMode('wild');
		const world = physics.createWorld();
		players.init(world, 0);
		wildMine.init(world, { seed: 4 });
		const startY = world.platform.y;
		world.drive = true;
		world.forceSetting = 1;
		world.direction = 1;
		for (let i = 0; i < 600; i++) {
			physics.step(world, physics.config.step);
			assert.equal(wildMine.hullClear(world.platform.x, world.platform.y), true, `hullClear at step ${i}`);
		}
		assert.ok(world.platform.x > 6.5, `crossed shelf onto cave (${world.platform.x})`);
		assert.ok(world.platform.y < startY - 1.0, `descended cliff (${startY} -> ${world.platform.y})`);
		const drift = Math.abs(physics.totalEnergy(world) - world.initialEnergy);
		assert.ok(drift < 1e-8, `energy drift ${drift} < 1e-8`);
	} finally {
		resetClassic();
	}
});

test('held ball stays locked to angled piston up to ±90° and cave cell inspection reports solid vs void', () => {
	try {
		wildMine.setMode('wild');
		const world = physics.createWorld();
		players.init(world, 0);
		const cave = wildMine.init(world, { seed: 1 });
		players.setPistonAngleOf(players.state.players[0], Math.PI / 2);
		for (let i = 0; i < 30; i++) physics.step(world, physics.config.step);
		assert.equal(world.ball.state, 'held');
		assert.ok(Math.abs(world.ball.x - world.platform.x) > 0.25, 'held ball tracks 90° tilted piston offset');

		const voidInfo = wildMine.inspectCell(0, cave.columnAt ? Math.round(cave.state.spawnY / cave.state.cell) : 256,
			require('../js/rock-materials.js'), ceiling.state.mineralPrices);
		assert.equal(voidInfo.solid, false);
		const rockInfo = wildMine.inspectCell(0, 10, require('../js/rock-materials.js'), ceiling.state.mineralPrices);
		assert.equal(rockInfo.solid, true);
		assert.ok(rockInfo.initialStrength > 0);
		assert.ok(rockInfo.value > 0);
	} finally {
		resetClassic();
	}
});
