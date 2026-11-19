'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { physics, ceiling, near } = require('./harness.cjs');
const mine = require('../js/wild-mine.js');
const rubble = require('../js/wild-rubble.js');
const bore = require('../js/wild-bore.js');
const players = require('../js/players.js');

function fresh() {
	mine.setMode('wild');
	const world = physics.createWorld();
	players.init(world, 0);
	const cave = mine.init(world, { seed: 1 });
	world.wildWater.intakeOn = false;
	world.direction = 1;
	world.platform.vx = 1;
	return { world, cave };
}
function columnHeight(c, row) {
	let h = 0;
	rubble.eachColumn(c, c, (_, bins) => { for (const bin of bins) if (bin.row === row) h = bin.height; });
	return h;
}
function balanced(world) { near(physics.totalEnergy(world), world.initialEnergy, 1e-8); }
afterEach(() => { rubble.setGradeMode('platform'); mine.setMode('classic'); ceiling.setFloorCompression(4); });

test('platform and bore angles drive redistribution in world coordinates, with direction reversing bore slope', () => {
	for (const mode of ['platform', 'bore']) for (const dir of [-1, 1]) {
		const { world, cave } = fresh();
		const row = cave.state.shelfRow - 1, y = (row + 1) * cave.state.cell;
		world.platform.y = y;
		world.platform.angle = mode === 'platform' ? dir * 0.35 : 0;
		world.direction = dir;
		world.platform.vx = dir;
		bore.setGrade(0.35);
		rubble.setGradeMode(mode);
		for (let c = -8; c <= 8; c++) rubble.deposit(cave.worldX(c), y, 5, 10 + c + 8);
		for (let i = 0; i < 2400; i++) rubble.grade(world, 1 / 240);
		const left = columnHeight(-4, row), right = columnHeight(4, row);
		assert.ok(dir * (right - left) > 0.15, `${mode} ${dir}: ${left}, ${right}`);
		const s = rubble.state();
		near(s.cells + s.bladeCells + s.lostCells, s.depositedCells, 1e-8);
		near(s.value + s.bladeValueTotal + s.lostValue, s.depositedValue, 1e-8);
	}
});

test('smooth transports mixed material across a multi-cell drop, joining the physical crest without shaving', () => {
	const { world, cave } = fresh();
	const cell = cave.state.cell, row = cave.state.shelfRow - 1, y = (row + 1) * cell;
	for (let c = 0; c <= 9; c++) for (let r = row; r > row - 4; r--) cave.dig(c, r);
	world.platform.x = 0;
	world.platform.y = y;
	rubble.setGradeMode('smooth');
	for (let c = -5; c < 0; c++) rubble.deposit(cave.worldX(c), y, 12, c === -1 ? 120 : 12);
	for (let i = 0; i < 240 * 10; i++) rubble.grade(world, 1 / 240);
	const s = rubble.state();
	near(s.cells + s.lostCells, s.depositedCells, 1e-8);
	near(s.value + s.lostValue, s.depositedValue, 1e-8);
	near(s.bladeCells, 0);
	near(s.bladeValueTotal, 0);
	assert.ok(columnHeight(0, row - 4) >= 4 * cell, 'lower bed reaches the lip');
	assert.ok(mine.groundAt(-0.4, y + 1) > mine.groundAt(0.55, y + 1) + 0.04, 'the dressed surface slopes down into the chamber');
	const left = rubble.surfaceAt(-1e-8, y + 1).crest;
	const right = rubble.surfaceAt(1e-8, y + 1).crest;
	near(left, right, 1e-6);
	const ground = mine.groundAt(0.02, y + 1);
	const hit = rubble.traceCrest(0.02, ground + 0.4, 0, -1, 0.5, 0.18, 0);
	near(hit.time, 0.22, 2e-5);
	cave.stream(400, 420, 99);
	cave.stream(-10, 10, 99);
	near(mine.groundAt(0.02, y + 1), ground, 1e-10);
});

test('floating shelves and separate galleries are not linked, even under a grader', () => {
	const { world, cave } = fresh();
	const row = cave.state.shelfRow - 1, y = (row + 1) * cave.state.cell;
	cave.dig(-1, row - 1);
	for (let r = row; r > row - 3; r--) cave.dig(0, r);
	assert.equal(cave.connectedFloor(-1, row, 1), -1);
	rubble.deposit(cave.worldX(-1), y, 10, 50);
	rubble.deposit(cave.worldX(0), y, 2, 14);
	world.platform.x = -0.04;
	world.platform.y = y;
	rubble.setGradeMode('smooth');
	for (let i = 0; i < 240; i++) rubble.grade(world, 1 / 240);
	near(columnHeight(0, row - 3), 2 * ceiling.state.floorCellHeight);
	const s = rubble.state();
	near(s.cells, s.depositedCells);
	near(s.value, s.depositedValue);
});

test('real movement and grading preserve the energy ledger in every mode, including an empty reserve', () => {
	for (const mode of ['platform', 'bore', 'smooth']) for (const empty of [false, true]) {
		const { world, cave } = fresh();
		const y = world.platform.y;
		world.platform.vx = 0;
		world.direction = 1;
		world.battery = empty ? 0 : world.battery;
		for (let c = -8; c <= 8; c++) rubble.deposit(cave.worldX(c), y, 2 + (c & 1), 10 + c + 8);
		rubble.setGradeMode(mode);
		bore.setGradeDegrees(20);
		world.initialEnergy = physics.totalEnergy(world);
		for (let i = 0; i < 240 * 2; i++) { physics.step(world, 1 / 240); balanced(world); }
		const s = rubble.state();
		near(s.cells + s.lostCells + s.bladeCells, s.depositedCells, 1e-8);
		near(s.value + s.lostValue + s.bladeValueTotal, s.depositedValue, 1e-8);
	}
});

test('a smoothed chamber drop supports rig travel in both directions with an exact ledger', () => {
	const { world, cave } = fresh();
	const y = world.platform.y, row = cave.state.shelfRow - 1;
	for (let c = 0; c < 24; c++) for (let r = row; r > row - 4; r--) cave.dig(c, r);
	for (let c = -5; c < 0; c++) rubble.deposit(cave.worldX(c), y, 12, 12);
	rubble.setGradeMode('smooth');
	world.platform.x = 0;
	for (let i = 0; i < 240 * 10; i++) rubble.grade(world, 1 / 240);
	world.platform.x = world.platform.previousX = -1.5;
	world.platform.y = world.platform.previousY = physics.platformBaseAt(-1.5, 0, 'rig', y);
	world.platform.vx = 0;
	world.initialEnergy = physics.totalEnergy(world);
	for (let i = 0; i < 1000 && world.platform.x < 0.6; i++) { physics.step(world, 1 / 240); balanced(world); }
	assert.ok(world.platform.x >= 0.6, 'rig crosses the filled drop');
	world.direction = -1;
	for (let i = 0; i < 1000 && world.platform.x > -1.3; i++) { physics.step(world, 1 / 240); balanced(world); }
	assert.ok(world.platform.x <= -1.3, 'rig climbs back across the ramp');
	const s = rubble.state();
	near(s.cells + s.lostCells, s.depositedCells, 1e-8);
	near(s.value + s.lostValue, s.depositedValue, 1e-8);
});

test('buried tunnel stairs form a continuous grade; insufficient soil and overhangs stay bounded', () => {
	const { world, cave } = fresh();
	const cell = cave.state.cell, row = cave.state.shelfRow - 1, y = world.platform.y;
	for (let c = 0; c < 8; c++) for (let n = 0; n <= Math.floor(c / 2); n++) cave.dig(c, row - n);
	rubble.setGradeMode('smooth');
	world.platform.x = 0.45;
	world.platform.y = y;
	for (let c = -4; c < 8; c++) rubble.deposit(cave.worldX(c), y + 0.1, 8, 3 + c + 4);
	for (let i = 0; i < 240 * 12; i++) rubble.grade(world, 1 / 240);
	for (let c = 0; c < 7; c++) {
		const boundary = (c + 1) * cell;
		near(rubble.crestAt(boundary - 1e-8, y + 1), rubble.crestAt(boundary + 1e-8, y + 1), 1e-6);
	}
	const s = rubble.state();
	near(s.cells + s.lostCells, s.depositedCells, 1e-8);
	near(s.value + s.lostValue, s.depositedValue, 1e-8);

	// A thin deposit below an unburied lip stays below the lip and no fictitious
	// connection appears; neither can an isolated one-cell pocket overfill.
	const { cave: other } = fresh();
	const r = other.state.shelfRow - 1, face = (r + 1) * cell;
	for (let k = 0; k < 4; k++) other.dig(0, r - k);
	rubble.deposit(other.worldX(0), face, 0.1, 1);
	assert.equal(rubble.heightAt(other.worldX(-1), face + 1), 0);
	other.dig(8, r - 2);
	rubble.deposit(other.worldX(8), other.worldY(r - 2), 10, 10);
	assert.ok(columnHeight(8, r - 3) <= cell + 1e-9, 'roof bounds pocket capacity');
});

test('mode selection survives resets; bore follows signed grades without needing a fitted buffer', () => {
	const { world } = fresh();
	rubble.setGradeMode('bore');
	bore.setGradeDegrees(-25);
	world.direction = -1;
	near(rubble.gradeSlope(world), Math.tan(25 * Math.PI / 180), 1e-12);
	world.direction = 1;
	near(rubble.gradeSlope(world), -Math.tan(25 * Math.PI / 180), 1e-12);
	assert.equal(rubble.setGradeMode('invalid'), 'bore');
	mine.init(world, { seed: 2 });
	assert.equal(rubble.gradeMode, 'bore');
});
