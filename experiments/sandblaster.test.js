'use strict';
// Sandblaster: the magazine and its wall purchases, the grain's climb and
// impact, the chip damage through the shared weakening rule, the recovery of
// falling grains, the losses, and the closed energy ledger.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const harness = require('./harness.cjs');
const players = require('../js/players.js');
const sandblaster = require('../js/sandblaster.js');

const { ceiling, equipment, physics, c, near } = harness;
const rock = ceiling.state;
const sand = sandblaster.state;

function fresh(seed = 1) {
	const world = physics.createWorld();
	players.init(world, 0);
	if (seed !== 1) ceiling.reset(seed);
	sandblaster.reset(seed);
	sandblaster.setAutoBuy(false, 'rig');
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

// Leave the purse with exactly this much, spending the rest on nothing.
function leaveFunds(world, credits) {
	harness.afford(world, credits + 1);
	assert.equal(ceiling.purchase('ballast', rock.funds - credits, world.time), true);
	near(rock.funds, credits, 1e-9);
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

test('the magazine runs the planned rules', () => {
	assert.equal(sand.capacity, 60, 'a magazine holds 60 charges');
	assert.equal(sand.visitLimit, 10, 'up to ten charges per wall visit');
	assert.equal(sand.shotEnergy, 13.5, 'each grain draws its calibrated share of the reserve');
	assert.equal(sand.grainMass, 0.02, 'a grain is 20 g');
	assert.ok(sand.maxGrains >= sand.maxGrainsPerOwner, 'every owner has its own grain share');
});

test('charges are loaded only at a selling wall, within the magazine and the funds', () => {
	const world = fresh();
	leaveFunds(world, sand.price * 2.5);
	const entries = rock.ledger.length;

	park(world, 12);
	assert.equal(sandblaster.buy(world, 1), 0, 'no sand is loaded away from a wall');
	assert.equal(rock.ledger.length, entries);

	park(world, physics.platformMin());
	assert.equal(sandblaster.buy(world, 3), 2, 'the funds cover two of the three asked for');
	assert.equal(sand.charges, 2);
	near(rock.funds, sand.price * 0.5, 1e-9);
	const entry = rock.ledger[rock.ledger.length - 1];
	assert.equal(entry.type, 'buy');
	assert.equal(entry.label, '2 charges');
	near(entry.credits, sand.price * 2, 1e-9);
	assert.equal(sandblaster.buy(world, 1), 0, 'half a price buys nothing');
	assert.ok(rock.funds >= 0, 'the purse never goes negative');

	park(world, physics.platformMax());
	ceiling.setCommune(true);
	assert.equal(sand.unitPrice, 0, 'the commons hands sand out');
	assert.equal(sandblaster.buy(world, 99), sand.capacity - 2, 'either wall loads, and only up to the magazine');
	assert.equal(sand.charges, sand.capacity);
	assert.equal(sandblaster.buy(world, 1), 0, 'a full magazine takes no more');
	ceiling.setCommune(false);
	near(rock.funds, sand.price * 0.5, 1e-9);
});

test('auto-buy takes up to ten per wall visit and stops at the funds and the magazine', () => {
	const world = fresh();
	assert.equal(sand.autoBuy, false, 'the standing order is off until asked for');
	harness.afford(world, sand.price * 100);
	const funds = rock.funds;
	park(world, physics.platformMin());
	for (let i = 0; i < 30; i++) sandblaster.step(world, c.step);
	assert.equal(sand.charges, 0, 'nothing is bought without the order');

	sandblaster.setAutoBuy(true);
	for (let i = 0; i < 30; i++) sandblaster.step(world, c.step);
	assert.equal(sand.charges, sand.visitLimit, 'one visit buys the cap and no more, however long it lasts');
	near(rock.funds, funds - sand.price * sand.visitLimit, 1e-9);

	park(world, 12);
	for (let i = 0; i < 30; i++) sandblaster.step(world, c.step);
	assert.equal(sand.charges, sand.visitLimit, 'nothing is bought in the open');

	park(world, physics.platformMax());
	for (let i = 0; i < 30; i++) sandblaster.step(world, c.step);
	assert.equal(sand.charges, sand.visitLimit * 2, 'the next visit, at either wall, buys again');

	// Each visit is capped, so a full magazine takes the cap per visit.
	let visits = 0;
	while (sand.charges < sand.capacity && visits < 10) {
		park(world, 12);
		sandblaster.step(world, c.step);
		park(world, physics.platformMin());
		for (let i = 0; i < 30; i++) sandblaster.step(world, c.step);
		visits++;
	}
	assert.equal(sand.charges, sand.capacity, 'a full magazine ends the buying');
	near(rock.funds, funds - sand.price * sand.capacity, 1e-9);
	assert.equal(sand.bought, sand.capacity);
});

test('a new run empties the magazine and keeps the standing order', () => {
	let world = fresh();
	sandblaster.setAutoBuy(true);
	sandblaster.fill(world);
	park(world, 12);
	sandblaster.fire(world);
	sandblaster.step(world, c.step);
	assert.equal(sand.chamberAloft, 1);
	world = physics.createWorld();
	players.init(world, 0);
	assert.equal(sand.charges, 0);
	assert.equal(sand.chamberAloft, 0);
	assert.equal(sand.fired, 0);
	assert.equal(sand.autoBuy, true, "auto-buy is the player's order, not world state");
	sandblaster.setAutoBuy(false);
});

test('a grain spends reserve energy and a charge, climbs and chips the face', () => {
	const world = fresh();
	park(world, 12);
	sandblaster.fill(world);
	const battery = world.battery;
	const charges = sand.charges;
	const strength = Float64Array.from(rock.strength);

	assert.equal(sandblaster.fire(world), true);
	assert.equal(sand.charges, charges - 1, 'a throw spends one charge');
	near(world.battery, battery - sand.shotEnergy, 1e-9, 'a throw draws its energy from the reserve');
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
	sandblaster.fill(world);
	const x = physics.collectorX(world, 'rig');
	const column = Math.floor(x / rock.cell);
	const cellIndex = rock.firstRow[column] * rock.columns + column;
	// Fire the magazine at the same seam and watch the face cell weaken.
	// Each hit may take at most half the cell's remaining strength.
	const trail = [];
	let guard = 0;
	while (sand.charges > 0 && guard++ < 2400) {
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

test('caught grains return their charge and close the energy ledger', () => {
	const world = fresh();
	park(world, 12);
	sandblaster.fill(world);
	world.initialEnergy = physics.totalEnergy(world);
	const charges = sand.charges;
	for (let n = 0; n < 20; n++) {
		if (sandblaster.fire(world)) {
			while (sand.chamberAloft > 0) sandblaster.step(world, c.step);
		} else {
			sandblaster.step(world, c.step);
		}
	}
	assert.ok(sand.recovered > 0, sand.recovered + ' grains fell back into the collector');
	assert.equal(sand.charges, charges - sand.fired + sand.recovered, 'every caught grain returns its charge');
	assert.equal(sand.charges, sand.capacity, 'the fired and caught grains balance the magazine');
	settle(world);
	harness.balanced(world);
});

test('grains that miss the collector are lost, not recovered', () => {
	const world = fresh();
	sandblaster.fill(world);
	// Fire from the left wall pocket and move the body away, so the stream
	// falls on the open floor instead of any collector. Moving the body is a
	// test setup teleport; the energy base is taken once and never re-based.
	world.platform.x = physics.platformMin();
	world.platform.previousX = world.platform.x;
	world.platform.vx = 0;
	world.initialEnergy = physics.totalEnergy(world);
	const charges = sand.charges;
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
	assert.ok(fired > 0, 'the magazine threw');
	assert.equal(sand.lost, fired, 'every grain that missed the floor is booked lost');
	assert.equal(sand.recovered, 0, 'none of them came back');
	assert.equal(sand.charges, charges - fired, 'lost charges do not return');
	settle(world);
	harness.balanced(world);
});

test('the pools are fixed: a sustained stream never leaves anything in the air', () => {
	const world = fresh();
	park(world, 12);
	sandblaster.fill(world);
	let most = 0;
	for (let i = 0; i < Math.round(30 / c.step); i++) {
		sandblaster.step(world, c.step);
		sandblaster.fire(world);
		most = Math.max(most, sand.chamberAloft);
		if (sand.charges <= 0) sandblaster.fill(world);
	}
	assert.ok(sand.fired > 100, sand.fired + ' grains thrown in half a minute');
	assert.ok(most <= sand.maxGrains, 'peak ' + most + ' grains');
	assert.ok(sand.aloft <= sand.maxGrainsPerOwner, 'one owner never exceeds its share');
	settle(world);
	harness.balanced(world);
});

test('the same run and the same commands give the same grains', () => {
	function volley() {
		const world = fresh();
		park(world, 7);
		sandblaster.fill(world);
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
