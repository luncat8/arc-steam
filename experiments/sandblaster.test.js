'use strict';
// Sandblaster: the hopper feed (sand, then stone, never ore), auto-fire, the
// grain's climb and impact, the chip damage through the shared weakening rule,
// the return of falling grains to cargo, the spill, and the closed ledger.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const harness = require('./harness.cjs');
const players = require('../js/players.js');
const autopilot = require('../js/autopilot.js');
const sandblaster = require('../js/sandblaster.js');

const { ceiling, equipment, physics, c, near } = harness;
const rock = ceiling.state;
const sand = sandblaster.state;

function fresh(seed = 1) {
	const world = physics.createWorld();
	players.init(world, 0);
	for (const channel of ['move', 'smart', 'drive', 'angle']) autopilot.set(channel, false);
	autopilot.reset();
	if (seed !== 1) ceiling.reset(seed);
	sandblaster.reset(seed);
	sandblaster.setAutoFire(false, 'rig');
	equipment.grant('sandblaster', world, 'rig');
	ceiling.setCommune(false);
	world.drive = false;
	return world;
}

// Parking is a test setup teleport, not simulated work.
function park(world, x) {
	world.platform.x = x;
	world.platform.previousX = x;
	world.platform.vx = 0;
	harness.sync(world);
}

const sandIndex = rock.mineralIds.indexOf('sand');
const stoneIndex = rock.mineralIds.indexOf('stone');
const ironIndex = rock.mineralIds.indexOf('iron');
const grainCells = sand.grainMass / rock.cellMass;

// Stocking the hopper is a test setup grant, not simulated work.
function stock(world, mineral, grains, value = 0) {
	assert.equal(ceiling.loadCargo(mineral, grains * sand.grainMass, value), true);
	harness.sync(world);
}

function liveCells() {
	let cells = 0;
	for (let i = 0; i < rock.rows * rock.columns; i++) if (rock.strength[i] > 0) cells++;
	return cells;
}

// Only the grains move: the rock is chipped but nothing collapses, so the
// impact and recovery rules are measured against a still chamber.
function settle(world) {
	for (let i = 0; i < 240 * 30 && sand.chamberAloft > 0; i++) sandblaster.step(world, c.step);
	assert.equal(sand.chamberAloft, 0, 'every grain comes down');
}

test('the nozzle runs the planned rules', () => {
	assert.equal(sand.shotEnergy, 135, 'each grain draws at least ten times the former 13.5 J');
	assert.equal(sand.rate, 20, 'twice as many individual grains are fired per second');
	assert.equal(sand.grainMass, 0.02, 'a grain is 20 g');
	assert.ok(sand.maxGrains >= sand.maxGrainsPerOwner, 'every owner has its own grain share');
	assert.equal(sandblaster.buy, undefined, 'nothing is bought for the nozzle');
});

test('the nozzle feeds on the hopper: sand first, then stone, never ore', () => {
	const world = fresh();
	park(world, 12);
	assert.equal(sandblaster.feed(world), -1);
	assert.equal(sandblaster.fire(world), false, 'an empty hopper leaves the nozzle dry');

	stock(world, ironIndex, 60, 30);
	assert.equal(sandblaster.grainsAboard(world), 0);
	assert.equal(sandblaster.fire(world), false, 'ore is not abrasive');

	stock(world, stoneIndex, 3, 0.3);
	stock(world, sandIndex, 2, 0.02);
	assert.equal(sandblaster.grainsAboard(world), 5);
	const cells = rock.cargoCells;
	const value = rock.cargoValue;
	const thrown = [];
	for (let n = 0; n < 5; n++) {
		while (!sandblaster.fire(world)) sandblaster.step(world, c.step);
		for (let i = 0; i < sand.maxGrains; i++) {
			if (sand.grainState[i] === sand.FLYING && sand.grainAge[i] === 0) thrown.push(sand.grainMineral[i]);
		}
		sandblaster.step(world, c.step);
	}
	assert.deepEqual(thrown, [sandIndex, sandIndex, stoneIndex, stoneIndex, stoneIndex]);
	near(rock.cargoCells, cells - 5 * grainCells, 1e-9, 'the grains left the cargo');
	assert.ok(rock.cargoValue < value, 'and took their value with them');
	near(rock.cargoMinerals[ironIndex], 60 * sand.grainMass, 1e-12, 'the ore is untouched');
	while (!sandblaster.canFire(world) && sand.chamberAloft > 0) sandblaster.step(world, c.step);
	settle(world);
	assert.equal(sand.recovered + sand.lost, 5);
	if (sand.lost === 0) {
		near(rock.cargoCells, cells, 1e-9, 'every grain is back in the hopper');
		near(rock.cargoValue, value, 1e-9, 'at the value it left with');
	}
	harness.balanced(world);
});

test('a full hopper stops the nozzle', () => {
	const world = fresh();
	park(world, 12);
	stock(world, stoneIndex, rock.storageLimit / grainCells);
	assert.equal(rock.cargoCells, rock.storageLimit);
	assert.equal(sandblaster.hopperFull(world), true);
	assert.equal(sandblaster.fire(world), false, 'nothing loosened could be caught');
	assert.equal(ceiling.loadCargo(stoneIndex, sand.grainMass, 0), false, 'and a full hopper takes no grain');
	ceiling.sellCargo(0, world.time);
});

test('auto-fire keeps the stream going and is the player\'s standing order', () => {
	let world = fresh();
	park(world, 12);
	stock(world, sandIndex, 90);
	assert.equal(sand.autoFire, false, 'the order is off until asked for');
	for (let i = 0; i < 60; i++) sandblaster.step(world, c.step);
	assert.equal(sand.fired, 0, 'nothing is thrown without the order or the key');

	sandblaster.setAutoFire(true);
	const seconds = 3;
	for (let i = 0; i < Math.round(seconds / c.step); i++) sandblaster.step(world, c.step);
	assert.ok(sand.fired >= seconds * sand.rate - 1 && sand.fired <= seconds * sand.rate + 1, sand.fired + ' grains at the stream rate');

	// The order never drains the reserve below the charge-trip share; the key still throws.
	const fired = sand.fired;
	world.battery = c.battery * sand.autoFireReserve - 1;
	for (let i = 0; i < 60; i++) sandblaster.step(world, c.step);
	assert.equal(sand.fired, fired, 'auto-fire holds on a low reserve');
	assert.equal(sandblaster.fire(world), true, 'a hand throw still goes');

	world = physics.createWorld();
	players.init(world, 0);
	assert.equal(sand.chamberAloft, 0);
	assert.equal(sand.fired, 0);
	assert.equal(sand.autoFire, true, "auto-fire is the player's order, not world state");
	for (let i = 0; i < 60; i++) sandblaster.step(world, c.step);
	assert.equal(sand.fired, 0, 'an empty hopper keeps the order waiting');
	sandblaster.setAutoFire(false);
});

test('a grain spends reserve energy and hopper material, climbs and chips the face', () => {
	const world = fresh();
	park(world, 12);
	stock(world, stoneIndex, 60);
	const battery = world.battery;
	const grains = sandblaster.grainsAboard(world);
	const strength = Float64Array.from(rock.strength);

	assert.equal(sandblaster.fire(world), true);
	assert.equal(sandblaster.grainsAboard(world), grains - 1, 'a throw takes one grain out of the hopper');
	near(world.battery, battery - physics.reserveCost(sand.shotEnergy), 1e-9, 'a throw draws its engine-efficiency cost from the reserve');
	assert.equal(sandblaster.fire(world), false, 'the stream has a rate');

	let slot = -1;
	for (let i = 0; i < sand.maxGrains; i++) if (sand.grainState[i] !== sand.FREE) { slot = i; break; }
	assert.ok(slot >= 0);
	assert.equal(sand.grainState[slot], sand.FLYING);
	const x = sand.grainX[slot];
	assert.ok(sand.grainY[slot] < ceiling.surfaceAt(x), 'the grain starts under the face');

	let previous = sand.grainY[slot];
	let steps = 0;
	while (sand.grainState[slot] === sand.FLYING && steps < 600) {
		sandblaster.step(world, c.step);
		steps++;
		if (sand.grainState[slot] !== sand.FLYING) break;
		assert.ok(sand.grainY[slot] > previous, 'the grain only climbs');
		previous = sand.grainY[slot];
	}
	assert.equal(sand.grainState[slot], sand.FALLING, 'the grain impacts and falls back');
	assert.ok(sand.hits > 0, 'the impact is booked');
	near(sand.lastImpactY, ceiling.surfaceAt(x), 1e-9, 'the impact is on the face');

	// One hit takes at most half a cell's strength and brings nothing down.
	let changed = 0;
	let removed = 0;
	for (let i = 0; i < strength.length; i++) {
		if (rock.strength[i] === strength[i]) continue;
		changed++;
		removed += strength[i] - rock.strength[i];
	}
	assert.ok(changed > 0, 'the hit weakened the rock');
	assert.ok(removed <= sand.shotEnergy, 'the booked fracture is capped at the blow');
	assert.equal(rock.extractedCells, 0, 'one grain brings nothing down');
	settle(world);
	harness.balanced(world);
});

test('a stream of grains loosens a seam through the shared weakening rule', () => {
	const world = fresh();
	park(world, 12);
	stock(world, stoneIndex, 60);
	const x = physics.sandblasterNozzleX(world, 'rig');
	const column = Math.floor(x / rock.cell);
	const cellIndex = rock.firstRow[column] * rock.columns + column;
	// Fire grain after grain at the same seam and watch the face cell weaken.
	// Each hit may take at most half the cell's remaining strength.
	const trail = [];
	let guard = 0;
	while (trail.length < 60 && guard++ < 2400) {
		if (sandblaster.fire(world)) {
			while (sand.chamberAloft > 0) sandblaster.step(world, c.step);
			trail.push(rock.strength[cellIndex]);
			if (rock.strength[cellIndex] <= 0) break;
		} else {
			sandblaster.step(world, c.step);
		}
	}
	assert.ok(trail.length >= 2, trail.length + ' grains landed on the seam');
	for (let i = 1; i < trail.length; i++) {
		assert.ok(trail[i] <= trail[i - 1], 'the seam only loosens');
		// A blow spends at most half the cell's remaining strength; a face
		// cell the blow would leave at the removal threshold lets go instead.
		const drop = trail[i - 1] - trail[i];
		assert.ok(drop <= trail[i - 1] * rock.hitLooseCap + 1e-9 || trail[i - 1] * (1 - rock.hitLooseCap) <= 1e-4, "one hit takes at most half the cell's strength");
	}
	assert.ok(trail[trail.length - 1] < rock.initialStrength[cellIndex], 'the seam cell is looser than the throw started it');
	settle(world);
	harness.balanced(world);
});

test('caught grains return to the cargo and close the energy ledger', () => {
	const world = fresh();
	park(world, 12);
	stock(world, stoneIndex, 60, 1.2);
	const cells = rock.cargoCells;
	const value = rock.cargoValue;
	const caught = rock.caughtCells;
	for (let n = 0; n < 20; n++) {
		if (sandblaster.fire(world)) {
			while (sand.chamberAloft > 0) sandblaster.step(world, c.step);
		} else {
			sandblaster.step(world, c.step);
		}
	}
	assert.ok(sand.fired > 0 && sand.recovered === sand.fired, sand.recovered + ' grains fell back into the collector');
	near(rock.cargoCells, cells, 1e-9, 'the fired and caught grains balance the hopper');
	near(rock.cargoMinerals[stoneIndex], 60 * sand.grainMass, 1e-9);
	near(rock.cargoValue, value, 1e-9, 'a round trip neither makes nor loses value');
	assert.equal(rock.caughtCells, caught, 'a returning grain is not newly mined rock');
	settle(world);
	harness.balanced(world);
});

test('grains that miss the collector are spilled onto the floor, not recovered', () => {
	const world = fresh();
	// Fire from the left wall pocket and move the body away, so the stream
	// falls on the open floor instead of any collector. Moving the body is a
	// test setup teleport; the energy base is taken once and never re-based.
	world.platform.x = physics.platformMin();
	world.platform.previousX = world.platform.x;
	world.platform.vx = 0;
	stock(world, stoneIndex, 60, 1.2);
	const cells = rock.cargoCells;
	const x = physics.sandblasterNozzleX(world, 'rig');
	const floor = ceiling.floorAt(x);
	let fired = 0;
	for (let n = 0; n < 12; n++) {
		if (sandblaster.fire(world)) {
			fired++;
			world.platform.x = physics.platformMax();
			world.platform.previousX = world.platform.x;
			while (sand.chamberAloft > 0) sandblaster.step(world, c.step);
			world.platform.x = physics.platformMin();
			world.platform.previousX = world.platform.x;
		} else {
			sandblaster.step(world, c.step);
		}
	}
	assert.ok(fired > 0, 'the nozzle threw');
	assert.equal(sand.lost, fired, 'every grain that missed is booked lost');
	assert.equal(sand.recovered, 0, 'none of them came back');
	near(rock.cargoCells, cells - fired * grainCells, 1e-9, 'lost grains do not return to the hopper');
	assert.ok(ceiling.floorAt(x) > floor, 'the spilled material lies on the floor');
	settle(world);
	harness.balanced(world);
});

test('a moving rig throws and catches with the ledger closed', () => {
	const world = fresh();
	park(world, 8);
	stock(world, sandIndex, 120);
	world.direction = 1;
	for (let i = 0; i < Math.round(4 / c.step); i++) {
		physics.step(world, c.step);
		sandblaster.fire(world);
	}
	assert.ok(sand.fired > 20, sand.fired + ' grains thrown on the move');
	world.direction = 0;
	for (let i = 0; i < 240 * 30 && sand.chamberAloft > 0; i++) physics.step(world, c.step);
	assert.equal(sand.recovered + sand.lost, sand.fired);
	harness.balanced(world);
});

test('a grain leaves with the platform travel, so a steady cruise still catches it', () => {
	const world = fresh();
	park(world, 4);
	stock(world, sandIndex, 120);
	// A constant-velocity carry is a test setup motion, not simulated drive.
	const speed = 3;
	world.platform.vx = speed;
	for (let i = 0; i < Math.round(3 / c.step); i++) {
		world.platform.x += speed * c.step;
		sandblaster.step(world, c.step);
		sandblaster.fire(world);
	}
	for (let i = 0; i < 240 * 30 && sand.chamberAloft > 0; i++) {
		world.platform.x += speed * c.step;
		sandblaster.step(world, c.step);
	}
	assert.ok(sand.fired > 20, sand.fired + ' grains thrown at a cruise');
	assert.equal(sand.recovered, sand.fired, 'every grain came down into the collector that threw it');
});

test('a rival nozzle feeds on its own hopper and leaves the rig cargo alone', () => {
	const world = physics.createWorld();
	players.init(world, 1);
	sandblaster.reset(1);
	const rival = players.state.rivals[0];
	equipment.grant('sandblaster', world, rival.id);
	assert.equal(sandblaster.fire(world, rival.id), false, 'an empty rival hopper is dry');
	assert.equal(players.loadCargo(rival, stoneIndex, 10 * sand.grainMass, 0.5), true);
	harness.sync(world);
	const battery = world.battery;
	const imported = world.importedEnergy;
	const cells = rival.cargoCells;
	assert.equal(sandblaster.fire(world, rival.id), true);
	near(rival.cargoCells, cells - grainCells, 1e-12);
	near(rival.cargoMinerals[stoneIndex], 9 * sand.grainMass, 1e-12);
	assert.equal(world.battery, battery, 'the rig reserve is not drawn');
	near(world.importedEnergy, imported + sand.shotEnergy, 1e-9, 'a rival throw is imported work');
	assert.equal(rock.cargoCells, 0);
	const state = sandblaster.stateFor(rival.id);
	for (let i = 0; i < 240 * 30 && state.chamberAloft > 0; i++) sandblaster.step(world, c.step);
	assert.equal(state.recovered + state.lost, 1);
	if (state.recovered) near(rival.cargoCells, cells, 1e-12, 'the grain came home to the rival hopper');
	harness.balanced(world);
});

test('the pools are fixed: a sustained stream never leaves anything in the air', () => {
	const world = fresh();
	park(world, 12);
	stock(world, sandIndex, 600);
	let most = 0;
	for (let i = 0; i < Math.round(30 / c.step); i++) {
		sandblaster.step(world, c.step);
		sandblaster.fire(world);
		most = Math.max(most, sand.chamberAloft);
	}
	assert.ok(sand.fired > 100, sand.fired + ' grains thrown in half a minute');
	assert.ok(most <= sand.maxGrains, 'peak ' + most + ' grains');
	assert.ok(sand.aloft <= sand.maxGrainsPerOwner, 'one owner never exceeds its share');
	settle(world);
	harness.balanced(world);
});

test('a long high-power stream fills the hopper and spills the rest with its ledger closed', () => {
	const world = fresh();
	harness.research.grant('thermodynamics', world, 'rig');
	assert.equal(equipment.installRadiator('radiator', world, true, 'rig'), true);
	park(world, 12);
	stock(world, stoneIndex, 1000);
	world.drive = false;
	harness.sync(world);
	for (let i = 0; i < 240 * 50; i++) {
		sandblaster.fire(world);
		physics.step(world, c.step);
	}
	for (let i = 0; i < 240 * 30 && (sand.chamberAloft || rock.airborneCells); i++) physics.step(world, c.step);
	assert.equal(rock.cargoCells, rock.storageLimit, 'the mined rock fills the rig hopper');
	assert.ok(sand.lost > 0, 'grains that return to a full hopper spill instead');
	assert.equal(sand.recovered + sand.lost, sand.fired, 'no grains vanish from the pool');
	assert.equal(rock.airborneCells, 0, 'even partly caught rock fragments resolve');
	harness.balanced(world);
});

test('the same run and the same commands give the same grains', () => {
	function volley() {
		const world = fresh();
		park(world, 7);
		stock(world, stoneIndex, 60);
		const marks = [];
		for (let n = 0; n < 6; n++) {
			while (!sandblaster.fire(world)) sandblaster.step(world, c.step);
			while (sand.chamberAloft > 0) sandblaster.step(world, c.step);
			marks.push([sand.lastImpactX, sand.lastImpactY]);
		}
		settle(world);
		return { marks, hits: sand.hits, strength: Float64Array.from(rock.strength) };
	}
	const first = volley();
	const second = volley();
	assert.deepEqual(second.marks, first.marks);
	assert.equal(second.hits, first.hits);
	assert.deepEqual(second.strength, first.strength);
});

test('grains inherit the platform velocity at launch, then fly independently under gravity', () => {
	const world = fresh();
	park(world, 8);
	stock(world, sandIndex, 40);
	world.platform.vx = 2;
	world.platform.vy = 1.5;
	harness.sync(world);
	assert.equal(sandblaster.fire(world), true);
	const slot = sand.grainState.findIndex(state => state === sand.FLYING);
	assert.ok(slot >= 0);
	const x = sand.grainX[slot];
	const y = sand.grainY[slot];
	const vx = sand.grainVx[slot];
	const vy = sand.grainVy[slot];
	near(vx, 2, 1e-12, 'horizontal motion is inherited at launch');
	const relativeVy = Math.sqrt(2 * (sand.shotEnergy + sand.grainMass * c.gravity * (rock.cargoHeight - y)) / sand.grainMass);
	near(vy, relativeVy + 1.5, 1e-9, 'the upward throw is relative to a climbing platform');
	near(world.terrainWork, 0.5 * sand.grainMass * (vy * vy - relativeVy * relativeVy), 1e-9,
		'the extra vertical energy from the prescribed terrain motion is booked');
	// Reversing the platform after launch cannot steer a grain already in air.
	// Equal and opposite speeds also leave the ledger's platform kinetic energy unchanged.
	world.platform.vx = -2;
	world.platform.vy = 0;
	for (let i = 1; i <= 5; i++) {
		sandblaster.step(world, c.step);
		assert.equal(sand.grainState[slot], sand.FLYING);
		near(sand.grainX[slot], x + vx * c.step * i, 1e-9);
		near(sand.grainY[slot], y + vy * c.step * i - 0.5 * c.gravity * (c.step * i) ** 2, 1e-9);
	}
	settle(world);
	assert.equal(sand.recovered + sand.lost, 1, 'the inherited-speed grain still resolves as cargo or spill');
	harness.balanced(world);
});

test('the sand stream draws only live particle positions, never origin-to-grain streaks', () => {
	const world = fresh();
	park(world, 7);
	stock(world, sandIndex, 20);
	assert.equal(sandblaster.fire(world), true);
	const dots = [];
	const context = {
		globalAlpha: 1, fillStyle: '',
		beginPath() {}, arc(x, y, radius) { dots.push([x, y, radius]); }, fill() {},
		moveTo() { assert.fail('no path back to the nozzle'); },
		lineTo() { assert.fail('no streak'); },
		stroke() { assert.fail('grains are filled dots, not lines'); }
	};
	sandblaster.draw(context);
	assert.equal(dots.length, 1);
	for (let i = 0; i < 5; i++) sandblaster.step(world, c.step);
	dots.length = 0;
	sandblaster.draw(context);
	assert.equal(dots.length, 1);
	near(dots[0][0], sand.grainX[sand.grainState.findIndex(state => state === sand.FLYING)]);
	assert.equal(context.globalAlpha, 1);
	settle(world);
	harness.balanced(world);
});

test('the rig bot starts its own stream, obeys a manual pause, and leaves player orders intact', () => {
	const world = fresh();
	park(world, 8);
	stock(world, sandIndex, 100);
	assert.equal(sand.autoFire, false);
	players.setBot(0, true);
	players.update(world, c.step);
	assert.equal(sand.botFire, true, 'a capable electric rig orders the nozzle on by itself');
	assert.equal(sand.autoFire, true);
	sandblaster.step(world, c.step);
	assert.equal(sand.fired, 1);
	sandblaster.setAutoFire(false);
	assert.equal(sand.botFire, false, 'unchecking Auto-fire pauses a bot-owned stream immediately');
	players.update(world, c.step);
	assert.equal(sand.autoFire, false, 'the bot does not undo the manual pause on the next step');
	players.setBot(0, false);
	players.setBot(0, true);
	players.update(world, c.step);
	assert.equal(sand.botFire, true, 'cycling BOT releases the pause');
	sandblaster.setAutoFire(true);
	players.setBot(0, false);
	assert.equal(sand.botFire, false);
	assert.equal(sand.autoFire, true, 'turning BOT off does not erase the player’s own standing order');
	sandblaster.setAutoFire(false);
	settle(world);
	harness.balanced(world);
});

test('the bot pauses its high-power nozzle before thermal derating and waits to cool', () => {
	const world = fresh();
	park(world, 8);
	stock(world, sandIndex, 100);
	players.setBot(0, true);
	const heatAt = degrees => (degrees - c.ambientTemperature) * c.heatCapacity;
	world.heat = heatAt(c.thermalDerateStart - 5);
	players.update(world, c.step);
	assert.equal(sand.botFire, false, 'the bot will not fire through the drive derating band');
	world.heat = heatAt(c.thermalDerateStart - 15);
	players.update(world, c.step);
	assert.equal(sand.botFire, false, 'the cooling pause has hysteresis');
	world.heat = heatAt(c.thermalDerateStart - 21);
	players.update(world, c.step);
	assert.equal(sand.botFire, true, 'the bot resumes after cooling');
	world.heat = heatAt(c.thermalDerateStart - 6);
	players.update(world, c.step);
	assert.equal(sand.botFire, true, 'the resumed nozzle does not chatter below the stop threshold');
	players.setBot(0, false);
});

test('bots avoid a stream their engine cannot sustain, but a hand blast still works', () => {
	const world = fresh();
	park(world, physics.platformMin());
	stock(world, stoneIndex, 20);
	assert.equal(physics.selectEngine('hand', world, 'rig'), true);
	assert.ok(physics.config.chargePower < sand.shotEnergy * sand.rate);
	players.setBot(0, true);
	players.update(world, c.step);
	assert.equal(sand.autoFire, false, 'a hand pack cannot sustain a 2.7 kW stream');
	sandblaster.step(world, c.step);
	assert.equal(sand.fired, 0);
	assert.equal(sandblaster.fire(world), true, 'a manual grain can still use the available reserve');
	players.setBot(0, false);
	settle(world);
	harness.balanced(world);
});

test('the rig charge trip includes a second of stream draw, without charging early for a dry nozzle', () => {
	let world = fresh();
	park(world, 8);
	const reserve = c.battery * sand.autoFireReserve + sandblaster.streamPower('rig') * 0.5;
	world.battery = reserve;
	harness.sync(world);
	players.setBot(0, true);
	players.update(world, c.step);
	assert.equal(players.state.recharging, false, 'a dry nozzle does not change the old charge threshold');
	players.setBot(0, false);

	world = fresh();
	park(world, 8);
	stock(world, sandIndex, 100);
	world.battery = reserve;
	harness.sync(world);
	players.setBot(0, true);
	players.update(world, c.step);
	assert.equal(players.state.recharging, true, 'the stream draw prompts an early trip to the pad');
	assert.equal(sand.botFire, false, 'the bot pauses the stream while travelling to charge');
	near(world.target, c.width * 0.5);
	world.battery = c.battery * 0.95;
	harness.sync(world);
	players.update(world, c.step);
	assert.equal(players.state.recharging, false, 'the usual high threshold ends the trip');
	players.update(world, c.step);
	assert.equal(sand.botFire, true, 'the nozzle resumes once charged');
	players.setBot(0, false);
});

test('a rival bot runs its own nozzle, but not on an underpowered engine', () => {
	const world = physics.createWorld();
	players.init(world, 1);
	const rival = players.state.rivals[0];
	const state = sandblaster.stateFor(rival.id);
	sandblaster.setAutoFire(false, rival.id);
	equipment.grant('sandblaster', world, rival.id);
	assert.equal(players.loadCargo(rival, stoneIndex, 20 * sand.grainMass, 0.4), true);
	players.update(world, c.step);
	assert.equal(state.botFire, true, 'the rival bot turns on only its own installed nozzle');
	assert.equal(sand.botFire, false);
	const battery = world.battery;
	sandblaster.step(world, c.step);
	assert.equal(state.fired, 1);
	assert.equal(world.battery, battery, 'the rival’s stream never draws the rig reserve');
	rival.bot = false;
	players.update(world, c.step);
	assert.equal(state.autoFire, false, 'the bot-owned order stops with BOT');
	settle(world);
	harness.balanced(world);
	rival.x = physics.platformMin();
	rival.vx = 0;
	assert.equal(physics.selectEngine('hand', world, rival.id), true);
	rival.bot = true;
	players.update(world, c.step);
	assert.equal(state.botFire, false, 'a rival also checks its own engine before ordering a stream');
});

test('a raised rival imports its full grain energy, including inherited vertical motion', () => {
	const world = physics.createWorld();
	players.init(world, 1);
	const rival = players.state.rivals[0];
	rival.bot = false;
	sandblaster.setAutoFire(false, rival.id);
	equipment.grant('sandblaster', world, rival.id);
	assert.equal(players.loadCargo(rival, stoneIndex, 10 * sand.grainMass, 0.3), true);
	rival.y = 1.5;
	rival.vx = 2.4;
	rival.vy = -1.2;
	const imported = world.importedEnergy;
	assert.equal(sandblaster.fire(world, rival.id), true);
	const slot = sand.grainState.findIndex(state => state === sand.FLYING);
	near(sand.grainVx[slot], rival.vx);
	const relative = Math.sqrt(2 * (sand.shotEnergy - sand.grainMass * c.gravity * sand.grainY[slot]) / sand.grainMass);
	near(sand.grainVy[slot], relative + rival.vy);
	const energy = sand.grainMass * (0.5 * (sand.grainVx[slot] ** 2 + sand.grainVy[slot] ** 2) + c.gravity * sand.grainY[slot]);
	near(world.importedEnergy - imported, energy, 1e-9);
	settle(world);
	harness.balanced(world);
});

test('nozzle charges engine-efficiency reserve cost, books motor waste as heat, and stops at thermal cutoff', () => {
	const world = fresh();
	park(world, physics.platformMin());
	stock(world, sandIndex, 40);
	assert.equal(physics.selectEngine('coal', world, 'rig'), true);
	world.battery = c.battery;
	world.heat = 0;
	harness.sync(world);

	const before = world.battery;
	assert.equal(sandblaster.fire(world), true);
	const expectedCost = sand.shotEnergy / physics.engineNow('rig').efficiency;
	near(before - world.battery, expectedCost, 1e-9, 'coal pays 5x useful launch work');
	near(world.heat, expectedCost - sand.shotEnergy, 1e-9, 'motor loss lands in machine heat');
	settle(world);
	harness.balanced(world);

	world.heat = (c.thermalCutoff + 4 - c.ambientTemperature) * c.heatCapacity;
	harness.sync(world);
	assert.equal(sandblaster.canFire(world), false, 'thermal cutoff stops the nozzle');
	assert.equal(sandblaster.fire(world), false);
	world.heat = (c.thermalCutoff - 4 - c.ambientTemperature) * c.heatCapacity;
	harness.sync(world);
	assert.equal(sandblaster.canFire(world), true, 'cooling below cutoff re-enables the nozzle');
	harness.balanced(world);
});

