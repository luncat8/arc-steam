'use strict';
// Compare the real chassis drawing with world-space projectile origins and aim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const harness = require('./harness.cjs');
const players = require('../js/players.js');
const rockets = require('../js/rockets.js');
const sandblaster = require('../js/sandblaster.js');
const water = require('../js/water.js');
const { ceiling, equipment, physics, c, near } = harness;

const drawing = vm.createContext({
	window: { SteamCeiling: ceiling, matchMedia() { return { matches: false }; } },
	physics, config: c, playerApi: players, world: null,
	SteamEquipment: equipment, SteamRockets: rockets, SteamSandblaster: sandblaster, SteamWater: water
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/main_draw.js'), 'utf8'), drawing);

// Apply the canvas transforms instead of comparing unrotated local coordinates.
function recorder() {
	let matrix = [1, 0, 0, 1, 0, 0];
	const stack = [];
	let points = [];
	const point = (x, y) => ({ x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] });
	return {
		arcs: [], fills: [], strokes: [], rects: [], fillStyle: '', strokeStyle: '', globalAlpha: 1,
		save() { stack.push({ matrix: matrix.slice(), fill: this.fillStyle, stroke: this.strokeStyle }); },
		restore() {
			const saved = stack.pop();
			matrix = saved.matrix;
			this.fillStyle = saved.fill;
			this.strokeStyle = saved.stroke;
		},
		translate(x, y) {
			const origin = point(x, y);
			matrix[4] = origin.x;
			matrix[5] = origin.y;
		},
		rotate(angle) {
			const cosine = Math.cos(angle);
			const sine = Math.sin(angle);
			const [a, b, c, d] = matrix;
			matrix[0] = a * cosine + c * sine;
			matrix[1] = b * cosine + d * sine;
			matrix[2] = c * cosine - a * sine;
			matrix[3] = d * cosine - b * sine;
		},
		beginPath() { points = []; }, closePath() {},
		moveTo(x, y) { points.push(point(x, y)); },
		lineTo(x, y) { points.push(point(x, y)); },
		arc(x, y, radius) { this.arcs.push({ ...point(x, y), radius, style: this.fillStyle }); },
		fill() { this.fills.push({ style: this.fillStyle, points }); },
		stroke() { this.strokes.push({ style: this.strokeStyle, points }); },
		fillRect(x, y, width, height) { this.rects.push({ style: this.fillStyle, base: point(x + width * 0.5, y), height }); },
		strokeRect() {}
	};
}

function fresh(owner, pose) {
	const world = physics.createWorld();
	players.init(world, 1);
	rockets.reset(1);
	sandblaster.reset(1);
	water.reset(1);
	ceiling.setCommune(false);
	const player = players.state.players.find(player => player.id === owner);
	const body = physics.machineBody(players.machineOf(player));
	body.x = owner === 'rig' ? 9 : 18;
	body.y = pose.y;
	body.angle = pose.angle;
	body.vx = 1.25;
	body.vy = 0.4;
	world.drive = false;
	for (const tool of ['rocket-rack', 'sandblaster', 'watergun']) equipment.grant(tool, world, owner);
	const stone = ceiling.state.mineralIds.indexOf('stone');
	const mass = sandblaster.state.grainMass * 2;
	if (owner === 'rig') ceiling.loadCargo(stone, mass, 0);
	else players.loadCargo(body, stone, mass, 0);
	sandblaster.setAutoFire(false, owner);
	water.setAutoFire(false, owner);
	water.setAim(body.x + 3, 10);
	drawing.world = world;
	harness.sync(world);
	const context = recorder();
	players.renderPlatform(context, player, drawing.drawRigMachinery, true);
	return { world, body, context };
}

function samePoint(x, y, expected) {
	near(x, expected.x, 1e-10);
	near(y, expected.y, 1e-10);
}

const poses = [
	{ name: 'on the floor', y: 0, angle: 0 },
	{ name: 'raised and level', y: 2.5, angle: 0 },
	{ name: 'raised and climbing', y: 2.5, angle: c.platformMaxPitch },
	{ name: 'raised and descending', y: 2.5, angle: -c.platformMaxPitch }
];
for (const owner of ['rig', 'rival-1']) for (const pose of poses) {
	test(owner + ' emitters meet their drawn mounts ' + pose.name, () => {
		const { world, context } = fresh(owner, pose);
		const waterMount = context.arcs.find(arc => arc.style === '#bfe6f7');
		assert.ok(waterMount, 'the water mount is drawn');
		assert.equal(water.fire(world, owner), true);
		const drop = water.state.dropState.findIndex(state => state === water.state.FLYING);
		samePoint(water.state.dropX[drop], water.state.dropY[drop], waterMount);
		near(physics.waterNozzleX(world, owner), waterMount.x, 1e-10);
		const drops = recorder();
		water.draw(drops);
		assert.equal(drops.arcs.length, 1);
		samePoint(drops.arcs[0].x, drops.arcs[0].y, waterMount);

		const sandTip = context.fills.find(fill => fill.style === '#7a6a4f').points;
		const sandMount = { x: (sandTip[2].x + sandTip[3].x) * 0.5, y: (sandTip[2].y + sandTip[3].y) * 0.5 };
		const beforeSand = physics.totalEnergy(world);
		assert.equal(sandblaster.fire(world, owner), true);
		const sand = sandblaster.state;
		const grain = sand.grainState.findIndex(state => state === sand.FLYING);
		samePoint(sand.grainX[grain], sand.grainY[grain], sandMount);
		const grainEnergy = sand.grainMass * (0.5 * (sand.grainVx[grain] ** 2 + sand.grainVy[grain] ** 2) + c.gravity * sand.grainY[grain]);
		near(physics.totalEnergy(world) + grainEnergy, beforeSand, 1e-6);
		near(physics.sandblasterNozzleX(world, owner), sandMount.x, 1e-10);
		const grains = recorder();
		sandblaster.draw(grains);
		assert.equal(grains.arcs.length, 1);
		samePoint(grains.arcs[0].x, grains.arcs[0].y, sandMount);

		const tube = context.rects.find(rect => rect.style === '#59686b').base;
		assert.equal(rockets.fill(world, owner), true);
		assert.equal(rockets.fire(world, owner), true);
		const rack = rockets.state;
		const rocket = rack.rocketState.findIndex(state => state === rack.BURNING);
		samePoint(rack.rocketX[rocket], rack.rocketY[rocket], tube);
		near(rockets.launcherX(world, owner), tube.x, 1e-10);
	});

	test(owner + ' water barrel keeps the world aim ' + pose.name, () => {
		const { world, body, context } = fresh(owner, pose);
		const barrel = context.strokes.find(stroke => stroke.style === '#7fb6d9').points;
		const dx = barrel[1].x - barrel[0].x;
		const dy = barrel[1].y - barrel[0].y;
		const length = Math.hypot(dx, dy);
		const nozzle = water.nozzleOf(world, owner);
		near(dx / length, nozzle.dx, 1e-10);
		near(dy / length, nozzle.dy, 1e-10);
		assert.equal(water.fire(world, owner), true);
		const drop = water.state.dropState.findIndex(state => state === water.state.FLYING);
		const jetAngle = Math.atan2(water.state.dropVy[drop] - body.vy, water.state.dropVx[drop] - body.vx);
		assert.ok(Math.abs(jetAngle - Math.atan2(dy, dx)) <= 0.025 + 1e-10, 'the jet follows the barrel within its spread');
	});
}
