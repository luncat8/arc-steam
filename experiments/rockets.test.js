'use strict';
// Rockets: the rack and its wall purchases, the fuse and dud rules, shard
// damage through the chamber's weakening rule, and the debris that follows.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const harness = require('./harness.cjs');
const players = require('../js/players.js');
const rockets = require('../js/rockets.js');

const { ceiling, equipment, physics, c, near } = harness;
const rock = ceiling.state;
const rack = rockets.state;

function fresh(seed = 1) {
	const world = physics.createWorld();
	players.init(world, 0);
	if (seed !== 1) ceiling.reset(seed);
	rockets.reset(seed);
	rockets.setAutoBuy(false, 'rig');
	equipment.grant('rocket-rack', world, 'rig');
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

function flyingSlot() {
	for (let i = 0; i < rack.maxRockets; i++) if (rack.rocketState[i] !== rack.FREE) return i;
	return -1;
}

// Only the rockets move: the rock is chipped but nothing collapses, so the
// fuse and dud rules are measured against a still chamber.
function settle(world) {
	for (let i = 0; i < 1200 && (rack.aloft > 0 || rack.shardsAloft > 0); i++) rockets.step(world, c.step);
	assert.equal(rack.aloft, 0, 'every rocket comes down');
	assert.equal(rack.shardsAloft, 0, 'every shard burns out');
}

function liveCells() {
	let cells = 0;
	for (let i = 0; i < rock.rows * rock.columns; i++) if (rock.strength[i] > 0) cells++;
	return cells;
}

test('the rack runs the planned rules', () => {
	assert.equal(rack.visitLimit, 3, 'up to three rockets per wall visit');
	assert.equal(rack.fuseSpread, 0.2, 'burst height varies by ±20%');
	assert.equal(rack.dudChance, 0.05, '5% duds');
	assert.equal(rack.shardRadiusMin, 1);
	assert.equal(rack.shardRadiusMax, 4, 'a fragment damages a radius of 1–4 cells');
	assert.ok(rack.rackSize >= rack.visitLimit);
	assert.ok(rack.maxShards >= rack.maxRockets * rack.shardCount, 'every rocket in the air has its fan reserved');
});

test('each installed rack has its own stock, wall purchases and launcher', () => {
	const world = physics.createWorld();
	players.init(world, 1);
	rockets.reset(8);
	rockets.setAutoBuy(false, 'rig');
	rockets.setAutoBuy(false, 'rival-1');
	ceiling.setCommune(false);
	const rival = players.state.rivals[0];
	park(world, physics.platformMin());
	rival.x = physics.platformMax();
	rival.vx = 0;
	const rigFunds = rock.funds;

	assert.equal(rockets.fill(world, 'rig'), false, 'no stock before the rack is installed');
	assert.equal(rockets.buy(world, 1, 'rig'), 0, 'an unequipped platform cannot buy rounds');
	assert.equal(rockets.fire(world, 'rig'), false);
	assert.equal(rockets.buy(world, 1, rival.id), 0, 'the rival also needs its own rack');

	equipment.grant('rocket-rack', world, 'rig');
	equipment.grant('rocket-rack', world, rival.id);
	rival.money = rack.price * 2;
	assert.equal(rockets.buy(world, 2, rival.id), 2, 'the rival buys at its own wall');
	assert.equal(rockets.stateFor(rival.id).stock, 2);
	assert.equal(rack.stock, 0, 'the rival rack does not fill the rig rack');
	assert.equal(rock.funds, rigFunds, 'the rival purchase does not debit rig funds');
	near(rival.money, 0, 1e-9);
	assert.equal(rival.ledger[rival.ledger.length - 1].label, '2 rockets');

	rockets.fill(world, 'rig');
	assert.equal(rack.stock, rack.rackSize, 'test grants also address one owner');
	assert.equal(rockets.fire(world, rival.id), true);
	assert.equal(rockets.stateFor(rival.id).stock, 1);
	assert.equal(rack.stock, rack.rackSize, 'a rival shot spends only its own stock');
	const slot = flyingSlot();
	assert.equal(rack.rocketOwner[slot], 1);
	near(rack.rocketX[slot], rockets.launcherX(world, rival.id), 1e-12);
});

test('rockets are loaded only at a selling wall, within the rack and the funds', () => {
	const world = fresh();
	leaveFunds(world, rack.price * 2.5);
	const entries = rock.ledger.length;

	park(world, 12);
	assert.equal(rockets.buy(world, 1), 0, 'no rocket is loaded away from a wall');
	assert.equal(rock.ledger.length, entries);

	park(world, physics.platformMin());
	assert.equal(rockets.buy(world, 3), 2, 'the funds cover two of the three asked for');
	assert.equal(rack.stock, 2);
	near(rock.funds, rack.price * 0.5, 1e-9);
	const entry = rock.ledger[rock.ledger.length - 1];
	assert.equal(entry.type, 'buy');
	assert.equal(entry.label, '2 rockets');
	near(entry.credits, rack.price * 2, 1e-9);
	assert.equal(rockets.buy(world, 1), 0, 'half a price buys nothing');
	assert.ok(rock.funds >= 0, 'the purse never goes negative');

	park(world, physics.platformMax());
	ceiling.setCommune(true);
	assert.equal(rack.unitPrice, 0, 'the commons hand rockets out');
	assert.equal(rockets.buy(world, 99), rack.rackSize - 2, 'either wall loads, and only up to the rack');
	assert.equal(rack.stock, rack.rackSize);
	assert.equal(rockets.buy(world, 1), 0, 'a full rack takes no more');
	ceiling.setCommune(false);
	near(rock.funds, rack.price * 0.5, 1e-9);
});

test('auto-buy takes up to three per wall visit and stops at the funds and the rack', () => {
	const world = fresh();
	assert.equal(rack.autoBuy, false, 'the standing order is off until asked for');
	harness.afford(world, rack.price * 10);
	const funds = rock.funds;
	park(world, physics.platformMin());
	for (let i = 0; i < 30; i++) rockets.step(world, c.step);
	assert.equal(rack.stock, 0, 'nothing is bought without the order');

	rockets.setAutoBuy(true);
	for (let i = 0; i < 30; i++) rockets.step(world, c.step);
	assert.equal(rack.stock, rack.visitLimit, 'one visit buys the cap and no more, however long it lasts');
	near(rock.funds, funds - rack.price * rack.visitLimit, 1e-9);

	park(world, 12);
	for (let i = 0; i < 30; i++) rockets.step(world, c.step);
	assert.equal(rack.stock, rack.visitLimit, 'nothing is bought in the open');

	park(world, physics.platformMax());
	for (let i = 0; i < 30; i++) rockets.step(world, c.step);
	assert.equal(rack.stock, rack.visitLimit * 2, 'the next visit, at either wall, buys again');

	park(world, 12);
	rockets.step(world, c.step);
	park(world, physics.platformMin());
	for (let i = 0; i < 30; i++) rockets.step(world, c.step);
	assert.equal(rack.stock, rack.rackSize, 'a full rack ends the buying');
	near(rock.funds, funds - rack.price * rack.rackSize, 1e-9);
	assert.equal(rack.bought, rack.rackSize);
});

test('a rival auto-buys only from its own wall, order, and purse', () => {
	const world = physics.createWorld();
	players.init(world, 1);
	rockets.reset(9);
	ceiling.setCommune(false);
	const rival = players.state.rivals[0];
	equipment.grant('rocket-rack', world, rival.id);
	rockets.setAutoBuy(false, 'rig');
	rockets.setAutoBuy(true, rival.id);
	rival.x = physics.platformMax();
	rival.previousX = rival.x;
	rival.vx = 0;
	rival.money = rack.price * 4;
	const rigFunds = rock.funds;

	for (let i = 0; i < 30; i++) rockets.step(world, c.step);
	assert.equal(rockets.stateFor(rival.id).stock, rack.visitLimit, 'a rival visit buys up to three rounds');
	assert.equal(rockets.stateFor(rival.id).bought, rack.visitLimit);
	near(rival.money, rack.price, 1e-9, 'the rival keeps the unaffordable fourth-round balance');
	assert.equal(rockets.stateFor(rival.id).autoBuy, true);
	assert.equal(rack.stock, 0, 'the rig order and stock stay independent');
	assert.equal(rock.funds, rigFunds, 'the rival debit never reaches the rig ledger');
	assert.equal(rival.ledger[rival.ledger.length - 1].label, '3 rockets');

	const next = physics.createWorld();
	players.init(next, 1);
	assert.equal(rockets.stateFor(rival.id).stock, 0, 'New game clears rival rounds');
	assert.equal(rockets.stateFor(rival.id).autoBuy, true, 'New game preserves the rival standing order');
});

test('a short purse buys what it covers, and a sale during the visit pays for the rest', () => {
	const world = fresh();
	leaveFunds(world, rack.price * 2.5);
	rockets.setAutoBuy(true);
	park(world, physics.platformMin());
	for (let i = 0; i < 30; i++) physics.step(world, c.step);
	assert.equal(rack.stock, 2, 'two rockets are all the purse covers');
	near(rock.funds, rack.price * 0.5, 1e-9);

	// The rig stays on the wall while a load lands in its collector and sells.
	harness.earnFunds(world, 20);
	assert.ok(physics.atSellWall(world), 'the visit never ended');
	assert.equal(rack.stock, rack.visitLimit, 'the sale paid for the third rocket of this visit, and no fourth');
	assert.ok(rock.funds >= 0);
});

test('a new run empties the rack and keeps the standing order', () => {
	let world = fresh();
	rockets.setAutoBuy(true);
	rockets.fill(world);
	park(world, 12);
	rockets.fire(world);
	rockets.step(world, c.step);
	assert.equal(rack.aloft, 1);
	world = physics.createWorld();
	players.init(world, 0);
	assert.equal(rack.stock, 0);
	assert.equal(rack.aloft, 0);
	assert.equal(rack.shardsAloft, 0);
	assert.equal(rack.fired, 0);
	assert.equal(rack.autoBuy, true, 'auto-buy is the player\'s order, not world state');
	rockets.setAutoBuy(false);
});

test('a rocket leaves the collector tube, climbs straight up and reloads in half a second', () => {
	const world = fresh();
	park(world, 12);
	assert.equal(rockets.canFire(), false);
	assert.equal(rockets.fire(world), false, 'an empty rack fires nothing');
	assert.equal(rockets.fill(world), true);
	assert.equal(rack.stock, rack.rackSize);
	assert.equal(rockets.fill(world), false, 'a full rack is not granted again');

	assert.equal(rockets.fire(world), true);
	assert.equal(rack.stock, rack.rackSize - 1);
	const slot = flyingSlot();
	const collectorCentre = 12 - c.platformWidth * 0.5 + c.platformWidth * c.collectorFraction * 0.5;
	near(rack.rocketX[slot], collectorCentre, 1e-12);
	near(rockets.launcherX(world), collectorCentre, 1e-12);
	near(rack.rocketY[slot], world.platform.y + c.deck, 1e-12);
	assert.equal(rack.rocketState[slot], rack.BURNING);

	assert.equal(rockets.fire(world), false, 'the tube is still reloading');
	let previous = rack.rocketY[slot];
	let steps = 0;
	while (rack.rocketState[slot] === rack.BURNING && !rack.rocketDud[slot] && steps < 600) {
		rockets.step(world, c.step);
		steps++;
		if (rack.rocketState[slot] !== rack.BURNING) break;
		assert.ok(rack.rocketY[slot] > previous, 'the motor only climbs');
		near(rack.rocketX[slot], collectorCentre, 1e-12);
		previous = rack.rocketY[slot];
	}
	assert.ok(steps * c.step < 1.5, 'the climb to the rock takes about a second: ' + (steps * c.step).toFixed(2) + ' s');
	for (let i = 0; i < Math.round(rack.reload / c.step); i++) rockets.step(world, c.step);
	assert.equal(rockets.canFire(), true, 'the tube has reloaded');
	settle(world);
});

test('the fuse is cut within 20% of the rock gap, and one rocket in twenty is a dud', () => {
	const world = fresh();
	park(world, 12);
	const x = rockets.launcherX(world);
	const launchY = world.platform.y + c.deck;
	const count = 400;
	let lowest = Infinity;
	let highest = -Infinity;
	let contact = 0;
	let open = 0;
	let duds = 0;
	for (let n = 0; n < count; n++) {
		if (rack.stock === 0) rockets.fill(world);
		const face = ceiling.surfaceAt(x) - rack.noseReach;
		const gap = face - launchY;
		assert.equal(rockets.fire(world), true);
		const slot = flyingSlot();
		const share = (rack.rocketFuse[slot] - launchY) / gap;
		lowest = Math.min(lowest, share);
		highest = Math.max(highest, share);
		assert.ok(share >= 1 - rack.fuseSpread - 1e-9 && share <= 1 + rack.fuseSpread + 1e-9, 'fuse at ' + share.toFixed(3) + ' of the gap');
		const dud = rack.rocketDud[slot] === 1;
		const bursts = rack.bursts;
		while (rack.aloft > 0) rockets.step(world, c.step);
		assert.equal(rack.bursts, bursts + 1, 'every rocket bursts exactly once');
		if (dud) {
			duds++;
			near(rack.lastBurstY, launchY, 1e-9);
		} else if (share >= 1) {
			contact++;
			near(rack.lastBurstY, face, 1e-9);
		} else {
			open++;
			near(rack.lastBurstY, rack.rocketFuse[slot], 1e-9);
			assert.ok(rack.lastBurstY < face, 'an early fuse bursts in the open');
		}
		near(rack.lastBurstX, x, 1e-12);
		settle(world);
	}
	assert.ok(lowest < 1 - rack.fuseSpread * 0.9 && highest > 1 + rack.fuseSpread * 0.9, 'the fuses span the whole ±20%: ' + lowest.toFixed(3) + ' … ' + highest.toFixed(3));
	assert.ok(contact > count * 0.35 && open > count * 0.35, 'about half burst against the rock and half in the open: ' + contact + ' / ' + open);
	assert.equal(rack.duds, duds);
	const share = duds / count;
	assert.ok(share > 0.025 && share < 0.08, 'duds are about 5%: ' + (share * 100).toFixed(1) + '%');
	assert.equal(rack.fired, count);
});

test('a dud falls back and bursts on the ground it lands on', () => {
	const world = fresh();
	park(world, 12);
	let slot = -1;
	while (slot < 0) {
		if (rack.stock === 0) rockets.fill(world);
		rockets.fire(world);
		const flying = flyingSlot();
		if (rack.rocketDud[flying]) slot = flying;
		else settle(world);
	}
	const x = rack.rocketX[slot];
	const hits = rack.shardHits;
	let fell = false;
	let top = 0;
	// The rig drives away, so the dud comes down on the open floor.
	park(world, 20);
	while (rack.rocketState[slot] !== rack.FREE) {
		rockets.step(world, c.step);
		if (rack.rocketState[slot] === rack.FALLING) fell = true;
		top = Math.max(top, rack.rocketY[slot]);
	}
	assert.equal(fell, true, 'the motor burned out and the rocket fell');
	assert.ok(top > ceiling.surfaceAt(x) - rack.noseReach - 3, 'it had climbed most of the way first');
	near(rack.lastBurstY, ceiling.floorAt(x), 1e-9);
	assert.equal(rack.shardsAloft, rack.shardCount / 2, 'the half of the fan thrown into the ground is spent at once');
	settle(world);
	assert.ok(rack.shardHits > hits, 'shards thrown up from the floor still reach the rock');
});

test('a chip weakens only the cells inside its radius, joule for joule, and releases nothing a blow would not', () => {
	for (const radius of [1, 2.5, 4]) {
		fresh();
		const x = 9.3;
		const before = Float64Array.from(rock.strength);
		const face = ceiling.surfaceAt(x);
		const column = Math.floor(x / rock.cell);
		const row = rock.firstRow[column];
		const energy = 6;
		const taken = ceiling.chip(x, face, energy, radius);
		assert.ok(taken > 0 && taken <= energy, 'the rock takes part of the blow: ' + taken.toFixed(3) + ' J');
		let changed = 0;
		let removed = 0;
		for (let r = 0; r < rock.rows; r++) for (let k = 0; k < rock.columns; k++) {
			const index = r * rock.columns + k;
			if (rock.strength[index] === before[index]) continue;
			changed++;
			removed += before[index] - rock.strength[index];
			assert.ok(Math.hypot(k - column, r - row) <= radius, 'a changed cell lies inside the ' + radius + '-cell radius');
			assert.ok(rock.strength[index] >= before[index] * (1 - rock.hitLooseCap) - 1e-12, 'one chip takes at most half a cell\'s strength');
			assert.ok(rock.damageField[index] > 0, 'and leaves it looser');
		}
		assert.ok(changed > 0);
		// The rule spreads strength loss over the patch; the energy reported
		// back is capped at what the chip brought.
		near(taken, Math.min(energy, removed), 1e-9);
		assert.equal(rock.extractedCells, 0, 'a chip leaves the rock standing');
	}
	fresh();
	assert.equal(ceiling.chip(9.3, ceiling.surfaceAt(9.3), 0, 2), 0);
	assert.equal(ceiling.chip(9.3, ceiling.surfaceAt(9.3), 6, 0), 0);
});

test('the ball\'s impact still spends its owner\'s multiplier and radius through the shared rule', () => {
	fresh();
	const x = 9.3;
	const face = ceiling.surfaceAt(x);
	const before = Float64Array.from(rock.strength);
	const chipped = ceiling.chip(x, face, 6, rock.damageRadius);
	const afterChip = Float64Array.from(rock.strength);
	fresh();
	const struck = ceiling.damage(x, face, 6);
	let chipLoss = 0;
	let strikeLoss = 0;
	for (let i = 0; i < before.length; i++) {
		chipLoss += before[i] - afterChip[i];
		strikeLoss += before[i] - rock.strength[i];
	}
	assert.ok(strikeLoss > chipLoss * 1.2, 'the strike ball removes more strength per joule than a bare shard');
	assert.ok(struck <= 6 && chipped <= 6);
	near(struck, Math.min(6, strikeLoss / rock.damageMultiplier), 1e-9);
});

test('the free rock face is read in the shape a body collides with', () => {
	fresh();
	for (const shape of ['smooth', 'square']) {
		ceiling.setShape(shape);
		for (let x = 0.03; x < c.width; x += 0.61) {
			const column = Math.floor(x / rock.cell);
			const expected = shape === 'square'
				? rock.bottom + rock.firstRow[column] * rock.cell
				: rock.heightmap[column] + (rock.heightmap[column + 1] - rock.heightmap[column]) * (x / rock.cell - column);
			near(ceiling.surfaceAt(x), Math.min(rock.top, expected), 1e-9);
		}
	}
	ceiling.setShape('smooth');
});

test('shards chip the rock in patches of one to four cells and spend no more than they carry', () => {
	const world = fresh();
	park(world, 12);
	rockets.fill(world);
	const before = Float64Array.from(rock.strength);
	let radiusLow = Infinity;
	let radiusHigh = 0;
	for (let n = 0; n < 4; n++) {
		while (!rockets.canFire()) rockets.step(world, c.step);
		rockets.fire(world);
		while (rack.aloft > 0) rockets.step(world, c.step);
		for (let i = 0; i < rack.maxShards; i++) {
			if (rack.shardState[i] === rack.FREE) continue;
			radiusLow = Math.min(radiusLow, rack.shardRadius[i]);
			radiusHigh = Math.max(radiusHigh, rack.shardRadius[i]);
		}
	}
	settle(world);
	assert.ok(radiusLow >= rack.shardRadiusMin && radiusHigh <= rack.shardRadiusMax, 'chip radii stay within 1–4 cells: ' + radiusLow.toFixed(2) + ' … ' + radiusHigh.toFixed(2));
	assert.ok(rack.shardHits > 0 && rack.shardHits <= rack.bursts * rack.shardCount);
	const fastest = rack.shardSpeed * 1.3;
	assert.ok(rack.fracture > 0 && rack.fracture <= rack.shardHits * 0.5 * rack.shardMass * fastest * fastest, 'the rock takes ' + rack.fracture.toFixed(1) + ' J from ' + rack.shardHits + ' shards');
	let weakened = 0;
	let removed = 0;
	for (let i = 0; i < before.length; i++) {
		if (rock.strength[i] < before[i]) weakened++;
		removed += before[i] - rock.strength[i];
	}
	assert.ok(weakened > 20, weakened + ' cells weakened');
	assert.ok(removed >= rack.fracture, 'the booked energy is capped per shard, never above the strength removed');
	assert.equal(rock.extractedCells, 0, 'the shards themselves bring nothing down');
});

test('the rock a volley loosens falls as ordinary debris into the collector that fired it', () => {
	// The same idle rig without a rocket: what the chamber does on its own.
	const idle = fresh();
	park(idle, 9);
	harness.run(idle, 40 + rack.rackSize * rack.reload);
	assert.equal(rock.extractedCells, 0, 'an untouched bed drops nothing');
	const idleBattery = idle.battery;

	const world = fresh();
	park(world, 9);
	rockets.fill(world);
	const cells = liveCells();
	const rows = rock.generatedRows;
	for (let n = 0; n < rack.rackSize; n++) {
		while (!rockets.canFire()) physics.step(world, c.step);
		assert.equal(rockets.fire(world), true);
	}
	harness.run(world, 40);
	assert.ok(rock.extractedCells > 0, rock.extractedCells + ' cells came down');
	assert.equal(rock.extractedCells, rock.airborneCells + rock.caughtCells + rock.lostCells, 'they are booked like any other debris');
	assert.ok(rock.caughtCells > 0, 'the bin under the burst caught ' + rock.caughtCells + ' of them');
	assert.equal(rock.cargoCells, rock.caughtCells);
	if (rock.generatedRows === rows) assert.equal(liveCells() + rock.extractedCells, cells, 'a rocket creates and removes no rock itself');
	// The rocket carries its own charge: the reserve is the idle rig's, and the
	// only new entry in the energy ledger is the debris the bin caught.
	near(world.battery, idleBattery, 1e-9);
	harness.balanced(world);
});

test('the pools are fixed: a sustained volley never thins a burst or leaves anything in the air', () => {
	const world = fresh();
	park(world, 12);
	let most = 0;
	let mostShards = 0;
	for (let i = 0; i < Math.round(60 / c.step); i++) {
		if (rack.stock === 0) rockets.fill(world);
		const bursts = rack.bursts;
		rockets.fire(world);
		rockets.step(world, c.step);
		if (rack.bursts > bursts) {
			// A burst in the air throws every shard; one on the deck loses the
			// half thrown into the ground at once.
			let born = 0;
			for (let k = 0; k < rack.maxShards; k++) if (rack.shardState[k] !== rack.FREE && rack.shardAge[k] <= c.step * 1.5) born++;
			const half = rack.shardCount / 2;
			assert.ok(born >= half * (rack.bursts - bursts) && born % half === 0, 'a burst always finds its full fan: ' + born + ' shards');
		}
		most = Math.max(most, rack.aloft);
		mostShards = Math.max(mostShards, rack.shardsAloft);
	}
	assert.ok(rack.fired >= 100, rack.fired + ' rockets fired in a minute');
	assert.ok(most <= rack.maxRockets && mostShards <= rack.maxShards, 'peak ' + most + ' rockets and ' + mostShards + ' shards');
	settle(world);
	assert.equal(rack.bursts, rack.fired, 'every rocket fired has burst once');
});

test('the same run and the same commands give the same fuses and shards', () => {
	function volley() {
		const world = fresh();
		park(world, 7);
		rockets.fill(world);
		const fuses = [];
		for (let n = 0; n < 5; n++) {
			while (!rockets.canFire()) rockets.step(world, c.step);
			rockets.fire(world);
			fuses.push(rack.rocketFuse[flyingSlot()]);
			while (rack.aloft > 0) rockets.step(world, c.step);
		}
		settle(world);
		return { fuses, hits: rack.shardHits, fracture: rack.fracture, strength: Float64Array.from(rock.strength) };
	}
	const first = volley();
	const second = volley();
	assert.deepEqual(second.fuses, first.fuses);
	assert.equal(second.hits, first.hits);
	assert.equal(second.fracture, first.fracture);
	assert.deepEqual(second.strength, first.strength);
});
