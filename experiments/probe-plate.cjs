'use strict';
// Measurement: how the wheels meet a 45° plate and stepped ground.
//
// Three numbers matter for "a wheel hanging in the air":
//   support  - which contact actually holds the body up (a wheel, or the hull
//              underside beached on something);
//   strut    - how far that wheel's strut extended to reach the ground under it,
//              which is how a hull carried by its belly keeps its wheels down;
//   float    - how far a wheel's contact point still hangs above the ground
//              under it once the strut has reached. Positive is a wheel really
//              in the air, so a platform supported on one wheel reports the
//              other one's float.
//
// The wheels ride at ±platformWheelHalfSpan and the underside between them is
// the chamfer `hullDepthAt` describes, so a probe has to read both from the
// simulation rather than assume a flat keel.
const harness = require('./harness.cjs');
const physics = harness.physics;
const ceiling = harness.ceiling;
const players = require('../js/players.js');
const c = physics.config;
const half = c.platformWidth * 0.5;
const span = c.platformWheelHalfSpan;
const radius = c.platformWheelRadius;

function groundAt(x, id) {
	return Math.max(ceiling.floorAt(x), players.surfaceAt(x, id));
}

// Height of each wheel's contact point above the ground under it: positive is
// a wheel hanging in the air, zero a wheel taking its share of the load.
function wheelFloat(body, id) {
	const cosine = Math.cos(body.angle);
	const sine = Math.sin(body.angle);
	const out = [0, 0];
	for (let k = 0; k < 2; k++) {
		const localX = (k ? 1 : -1) * span;
		const groundX = body.x + localX * cosine - radius * sine;
		const bottom = body.y + localX * sine + radius * cosine - radius;
		out[k] = bottom - body.wheelDrop[k] - groundAt(groundX, id);
	}
	return out;
}

// Which contact sets the base: the wheels' own contact points, or an underside
// point beached on something. `lift` is that contact's penetration when the
// body is resting on it, so the winner is simply the smallest clearance.
function support(body, id) {
	const cosine = Math.cos(body.angle);
	const sine = Math.sin(body.angle);
	let lift = Infinity;
	let kind = 'none';
	const wheels = wheelFloat(body, id);
	for (let k = 0; k < 2; k++) if (wheels[k] < lift) { lift = wheels[k]; kind = 'wheel'; }
	const sampleStep = Math.min(radius * 0.5, ceiling.state.cell * 0.25);
	const count = Math.max(1, Math.ceil(half * 2 / sampleStep));
	const width = half * 2 / count;
	for (let i = 0; i <= count; i++) {
		const localX = -half + width * i;
		const depth = physics.hullDepthAt(localX);
		const groundX = body.x + localX * cosine - depth * sine;
		const clearance = body.y + localX * sine + depth * cosine - groundAt(groundX, id);
		if (clearance < lift) { lift = clearance; kind = 'belly'; }
	}
	return { kind, lift };
}

function report(label, tally) {
	const frames = Math.max(1, tally.frames);
	const share = value => (value / frames * 100).toFixed(1) + '%';
	console.log(`${label.padEnd(26)} wheel-supported ${share(tally.wheel)}  beached ${share(tally.belly)}  ` +
		`one wheel in air ${share(tally.oneAir)}  both wheels in air ${share(tally.bothAir)}  ` +
		`worst float ${tally.worst.toFixed(2)} m  worst strut ${tally.drop.toFixed(2)} m` +
		(tally.label ? `  (${tally.label})` : ''));
}

function tallyOf() {
	return { frames: 0, wheel: 0, belly: 0, oneAir: 0, bothAir: 0, worst: 0, drop: 0 };
}

function record(tally, body, id) {
	tally.frames++;
	const state = support(body, id);
	if (state.kind === 'belly') tally.belly++;
	else tally.wheel++;
	const floats = wheelFloat(body, id);
	const low = Math.min(floats[0], floats[1]);
	const high = Math.max(floats[0], floats[1]);
	if (state.kind === 'belly' && low > 0.02) tally.bothAir++;
	else if (state.kind === 'wheel' && high > 0.02) tally.oneAir++;
	if (high > tally.worst) tally.worst = high;
	const drop = Math.max(body.wheelDrop[0], body.wheelDrop[1]);
	if (drop > tally.drop) tally.drop = drop;
}

// Drive at a parked competitor from a standing start and record the crossing.
function ride(speed) {
	const world = physics.createWorld();
	players.init(world, 1);
	const rival = players.state.rivals[0];
	rival.bot = false;
	rival.x = 16;
	rival.vx = 0;
	rival.target = NaN;
	rival.direction = 0;
	world.platform.x = 5;
	world.platform.vx = 0;
	world.direction = 1;
	world.target = NaN;
	const tally = tallyOf();
	let rideStart = NaN;
	let rideEnd = NaN;
	for (let i = 0; i < 240 * 8; i++) {
		world.platform.vx = Math.min(speed, world.platform.vx + 4 * c.step);
		players.update(world, c.step);
		physics.step(world, c.step);
		// Count only the crossing: the flat approach and the run-off after it are
		// ordinary floor driving and would drown the numbers.
		if (world.platform.y > 0.02 && !Number.isFinite(rideStart)) rideStart = world.time;
		if (world.platform.y > 0.02) rideEnd = world.time;
		if (Number.isFinite(rideStart) && Number.isFinite(rideEnd)) record(tally, world.platform, 'rig');
		if (world.platform.x > rival.x + half * 2) break;
	}
	tally.label = `climb took ${(rideEnd - rideStart).toFixed(2)} s`;
	report(`ride over at ${speed} m/s`, tally);
}

// Walk the platform up a floor of even steps and time the first wheel contact.
function stairs(height) {
	const world = physics.createWorld();
	players.init(world, 1);
	players.state.rivals[0].x = 22;
	const state = ceiling.state;
	state.floorPiles.fill(0);
	for (let column = 0; column < state.floorPiles.length; column++) {
		const x = (column + 0.5) * state.cell;
		if (x > 6) state.floorPiles[column] = Math.min(1.6, Math.floor((x - 6) / 1.2) * height);
	}
	ceiling.drawFloor({ fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} });
	world.platform.x = 4;
	world.platform.vx = 0;
	world.direction = 1;
	world.target = NaN;
	const tally = tallyOf();
	for (let i = 0; i < 240 * 6; i++) {
		physics.step(world, c.step);
		record(tally, world.platform, 'rig');
	}
	report(`${height} m stairs`, tally);
	console.log(`  reached x ${world.platform.x.toFixed(1)} at ${world.platform.y.toFixed(2)} m`);
}

// The rig at rest on a competitor's deck: the plate has to stay down while it
// carries a rider, and the rig has to sit on it rather than through it.
function resting() {
	const world = physics.createWorld();
	players.init(world, 1);
	const rival = players.state.rivals[0];
	rival.bot = false;
	rival.x = 14;
	rival.vx = 0;
	rival.target = NaN;
	rival.direction = 0;
	world.platform.x = 12.4;
	world.platform.vx = 0;
	world.direction = 0;
	world.target = NaN;
	world.platform.y = players.bodyTop;
	for (let i = 0; i < 240 * 3; i++) {
		players.update(world, c.step);
		physics.step(world, c.step);
	}
	const floats = wheelFloat(world.platform, 'rig');
	console.log(`resting on a deck, both stopped: plate ${(rival.tailLeft * 180 / Math.PI).toFixed(0)}°, ` +
		`rig y ${world.platform.y.toFixed(2)}, wheel floats ${floats.map(v => v.toFixed(2)).join(', ')}`);
}

resting();
for (const height of [0.2, 0.5]) stairs(height);
for (const speed of [2, 5]) ride(speed);
