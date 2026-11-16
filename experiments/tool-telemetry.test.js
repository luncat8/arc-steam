'use strict';
// Expected-value-per-energy telemetry for active mining tools across ball bounce,
// sandblaster, water gun + under-hull pump, and road grader.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const harness = require('./harness.cjs');
const minerals = require('../js/minerals.js');
const players = require('../js/players.js');
const autopilot = require('../js/autopilot.js');
const prediction = require('../js/prediction.js');
const sandblaster = require('../js/sandblaster.js');
const water = require('../js/water.js');
const telemetry = require('../js/tool-telemetry.js');

const { ceiling, equipment, physics, research, c, near } = harness;
const sandId = minerals.mineralIds.indexOf('sand');
const haliteId = minerals.mineralIds.indexOf('halite');

function fresh(seed = 1) {
	const world = physics.createWorld();
	players.init(world, 0);
	for (const ch of ['move', 'smart', 'drive', 'angle']) autopilot.set(ch, false);
	autopilot.reset();
	ceiling.setCommune(false);
	ceiling.reset(seed);
	water.reset(seed);
	sandblaster.reset(seed);
	water.setAutoFire(false, 'rig');
	water.setPump(true);
	water.setPumpMode('always');
	water.setModel('table');
	harness.sync(world);
	return world;
}

function bandCenterX(mineralName) {
	const id = minerals.mineralIds.indexOf(mineralName);
	const order = ceiling.state.testMineralOrder;
	const band = order.indexOf(id);
	assert.ok(band >= 0, 'unknown mineral ' + mineralName);
	return (band + 0.5) * (physics.config.width / order.length);
}

test('createSummary and measure reuse caller storage deterministically', () => {
	const world = fresh(1);
	const buf = telemetry.createSummary();
	const a = telemetry.measure(world, 'rig', buf);
	const b = telemetry.measure(world, 'rig', buf);
	assert.equal(a, buf);
	assert.equal(b, buf);
	assert.deepEqual(a, b);
	assert.equal(buf.owner, 'rig');
	assert.equal(buf.fuelPrice, ceiling.state.fuelPrice);
	assert.equal(buf.ball.installed, true);
	assert.equal(buf.sandblaster.installed, false);
	assert.equal(buf.watergun.installed, false);
	assert.equal(buf.grader.installed, false);
});

test('ball strike telemetry scales with engine efficiency, ball upgrades and rock prices', () => {
	const world = fresh(1);
	research.researchAll(world, 'rig');
	const out = telemetry.createSummary();

	world.platform.x = world.platform.previousX = physics.platformMin();
	world.platform.vx = 0;
	telemetry.measure(world, 'rig', out);
	const electricRate = out.ball.valuePerKJ;
	const electricEnergy = out.ball.energyPerUseKJ;
	assert.ok(electricRate > 0, 'ball strike expects positive return over rock');

	// Coal boiler has 20% efficiency vs 80% electric -> 4x higher energy cost, 4x lower cr/kJ.
	assert.equal(physics.selectEngine('coal', world, 'rig'), true);
	telemetry.measure(world, 'rig', out);
	near(out.ball.energyPerUseKJ, electricEnergy * 4, 1e-9, 'coal spends 4x reserve per bounce');
	near(out.ball.valuePerKJ, electricRate / 4, 1e-9, 'cr/kJ drops in inverse proportion to efficiency');

	assert.equal(physics.selectEngine('electric', world, 'rig'), true);
	// Spiked hammer ball raises damage bonus, radius and energy transfer.
	assert.equal(equipment.installBall('spike', world, true, 'rig'), true);
	telemetry.measure(world, 'rig', out);
	const spikeRate = out.ball.valuePerKJ;
	assert.ok(spikeRate > electricRate, 'spiked ball yields more cr/kJ at same pulse');

	// Predicted ROCK hit steers targetX to the predicted impact column.
	const ball = physics.focusBallOf(world, 'rig');
	ball.state = 'flying';
	ball.x = 6;
	ball.y = 6;
	ball.vx = 5;
	ball.vy = 18;
	prediction.predictAll(world);
	telemetry.measure(world, 'rig', out);
	let expectedHitX = prediction.state.endX;
	if (prediction.state.kind !== prediction.kinds.ROCK) {
		let topY = -Infinity;
		for (let i = 0; i < prediction.state.samples; i++) {
			if (prediction.state.pathY[i] > topY) {
				topY = prediction.state.pathY[i];
				expectedHitX = prediction.state.pathX[i];
			}
		}
	}
	assert.equal(prediction.state.uncertain, true);
	near(out.ball.targetX, expectedHitX, 1e-6, 'uses predicted rock impact column');

	// Market doubling doubles expected cr/kJ when rock values double.
	const prices = ceiling.state.prices;
	const baseRate = out.ball.valuePerKJ;
	for (let i = 0; i < prices.length; i++) prices[i] *= 2;
	telemetry.measure(world, 'rig', out);
	near(out.ball.valuePerKJ, baseRate * 2, 1e-6, 'cr/kJ scales linearly with live rock value');
});

test('sandblaster telemetry captures rock resistance, nozzle dry state, sweep speed and efficiency', () => {
	const world = fresh(1);
	research.researchAll(world, 'rig');
	equipment.grant('sandblaster', world, 'rig');
	const out = telemetry.createSummary();

	telemetry.measure(world, 'rig', out);
	assert.equal(out.sandblaster.installed, true);
	assert.equal(out.sandblaster.dry, true, 'empty hopper reports dry nozzle');
	assert.equal(out.sandblaster.ready, false);
	const stationaryRate = out.sandblaster.valuePerKJ;
	assert.ok(stationaryRate > 0 && stationaryRate < ceiling.state.fuelPrice, 'bulk sandblasting ordinary rock stays below 25 cr/kJ');

	ceiling.loadCargo(sandId, 40 * sandblaster.state.grainMass, 0.1);
	harness.sync(world);
	telemetry.measure(world, 'rig', out);
	assert.equal(out.sandblaster.dry, false);
	assert.equal(out.sandblaster.ready, true);

	// Moving fast over the face avoids stationary collapse wait waste.
	world.platform.vx = 6;
	telemetry.measure(world, 'rig', out);
	assert.ok(out.sandblaster.valuePerKJ > stationaryRate, 'sweeping increases cr/kJ by cutting wait waste');

	// Coal efficiency divides cr/kJ by 4.
	world.platform.vx = 0;
	world.platform.x = world.platform.previousX = physics.platformMin();
	telemetry.measure(world, 'rig', out);
	const elecAtShop = out.sandblaster.valuePerKJ;
	assert.equal(physics.selectEngine('coal', world, 'rig'), true);
	telemetry.measure(world, 'rig', out);
	near(out.sandblaster.valuePerKJ, elecAtShop / 4, 1e-6, 'coal cuts sandblaster cr/kJ by 4x');
});

test('water gun telemetry separates inert, brine and gas seams, pump modes, saturation and chemistry models', () => {
	const world = fresh(1);
	research.researchAll(world, 'rig');
	equipment.grant('watergun', world, 'rig');
	ceiling.generateTestRock();
	const out = telemetry.createSummary();

	const quartzX = bandCenterX('quartz');
	const haliteX = bandCenterX('halite');
	const fizzyX = bandCenterX('fizzy');

	// 1. Inert quartz face: 0 cr/kJ; solute pump mode idles pump draw.
	world.platform.x = world.platform.previousX = quartzX;
	water.setAim(quartzX, 13.5);
	water.setPump(true);
	water.setPumpMode('always');
	telemetry.measure(world, 'rig', out);
	assert.equal(out.watergun.installed, true);
	assert.equal(out.watergun.valuePerKJ, 0, 'inert quartz yields 0 cr/kJ');
	assert.equal(out.watergun.pumpIdle, false, 'always mode draws pump energy even on inert rock');
	const alwaysInertKJ = out.watergun.energyPerUseKJ;

	water.setPumpMode('solute');
	telemetry.measure(world, 'rig', out);
	assert.equal(out.watergun.pumpIdle, true, 'solute mode idles pump on dry inert face');
	assert.ok(out.watergun.energyPerUseKJ < alwaysInertKJ, 'idle pump cuts per-shot energy draw to jet only');
	near(out.watergun.energyPerUseKJ, physics.reserveCost(water.state.shotEnergy, 'rig') / 1000, 1e-9);

	// 2. Soluble halite seam: positive cr/kJ and solute mode keeps pump engaged.
	world.platform.x = world.platform.previousX = haliteX;
	water.setAim(haliteX, 13.5);
	telemetry.measure(world, 'rig', out);
	const haliteAlwaysOrSolute = out.watergun.valuePerKJ;
	assert.ok(haliteAlwaysOrSolute > 0, 'soluble halite yields positive cr/kJ');
	assert.equal(out.watergun.pumpIdle, false, 'soluble brine seam engages solute pump');
	assert.ok(out.watergun.brinePerKJ > 0);

	// Pump off forfeits brine recovery and pump energy draw.
	water.setPump(false);
	telemetry.measure(world, 'rig', out);
	assert.equal(out.watergun.pumpIdle, true);
	assert.equal(out.watergun.brinePerKJ, 0, 'pump off recovers no brine');
	assert.ok(out.watergun.valuePerKJ < haliteAlwaysOrSolute, 'pump off lowers recovered cr/kJ on pure brine seam');

	// 3. Gas-venting fizzy halite band reports positive gas loss.
	water.setPump(true);
	world.platform.x = world.platform.previousX = fizzyX;
	water.setAim(fizzyX, 13.5);
	telemetry.measure(world, 'rig', out);
	assert.ok(out.watergun.gasLossPerKJ > 0, 'fizzy seam reports lost gas per kJ');

	// 4. Formula chemistry model evaluates cleanly without mutating state.
	water.setModel('formula');
	telemetry.measure(world, 'rig', out);
	assert.ok(Number.isFinite(out.watergun.valuePerKJ) && out.watergun.valuePerKJ >= 0);

	// 5. Saturated landing zone blocks further dissolution.
	water.setModel('table');
	world.platform.x = world.platform.previousX = haliteX;
	water.setAim(haliteX, 13.5);
	const hitY = ceiling.surfaceAt(haliteX);
	for (let dy = -0.5; dy <= 0.25; dy += 0.25) {
		for (let dx = -0.25; dx <= 0.25; dx += 0.25) {
			const parcel = water.cellIndexAt(haliteX + dx, Math.max(0.2, hitY + dy));
			water.water[parcel] = 0.5;
			water.loadTotal[parcel] = 0.6 * water.state.satCap;
		}
	}
	telemetry.measure(world, 'rig', out);
	assert.equal(out.watergun.valuePerKJ, 0, 'saturated parcel stops expected dissolution');
});

test('road grader telemetry reflects floor rubble, commune and per-player isolation', () => {
	const world = fresh(1);
	equipment.grant('grader', world, 'rig');
	const out = telemetry.createSummary();

	// Bare floor -> 0 cr/kJ.
	telemetry.measure(world, 'rig', out);
	assert.equal(out.grader.installed, true);
	assert.equal(out.grader.valuePerKJ, 0, 'bare floor yields 0 cr/kJ');

	// Loose rubble under the rig blade produces positive cr/kJ.
	ceiling.depositLoose(12, 0.5, 40);
	world.platform.vx = 2;
	telemetry.measure(world, 'rig', out);
	assert.equal(out.grader.active, true);
	assert.ok(out.grader.valuePerKJ > 0, 'loose rubble under blade gives positive cr/kJ');
	assert.equal(out.grader.viableFuel, out.grader.valuePerKJ >= ceiling.state.fuelPrice);

	// Communism drops sales payout on blade settlements -> 0 cr/kJ.
	ceiling.setCommune(true);
	telemetry.measure(world, 'rig', out);
	assert.equal(out.grader.valuePerKJ, 0, 'commune zeroes grader credit rate');
	ceiling.setCommune(false);

	// Rivals never inherit rig-only road grader or rig tools.
	players.init(world, 1);
	const rivalOut = telemetry.createSummary();
	telemetry.measure(world, 'rival-1', rivalOut);
	assert.equal(rivalOut.owner, 'rival-1');
	assert.equal(rivalOut.grader.installed, false, 'road grader stays rig-only');
	assert.equal(rivalOut.sandblaster.installed, false);
	assert.equal(rivalOut.watergun.installed, false);
});

// The drive flag belongs to the machine, not to the world: a parked rival's
// ball readout must not inherit the rig's drive.
test('ball telemetry reports the drive of the measured machine', () => {
	const world = fresh(1);
	players.init(world, 1);
	const rival = players.state.rivals[0];
	const out = telemetry.createSummary();
	rival.drive = false;
	telemetry.measure(world, rival.id, out);
	assert.equal(out.ball.active, false, 'a parked rival ball is not active');
	rival.drive = true;
	telemetry.measure(world, rival.id, out);
	assert.equal(out.ball.active, true);
	world.drive = false;
	telemetry.measure(world, 'rig', out);
	assert.equal(out.ball.active, false, 'the rig drive flag is the rig machine flag');
	world.drive = true;
	telemetry.measure(world, 'rig', out);
	assert.equal(out.ball.active, true);
});
