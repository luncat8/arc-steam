'use strict';
// Measure tool power, engine storage, pad reload and machine temperature across
// early, mid and fully upgraded rigs, asserting exact energy conservation.
const ceiling = require('../js/ceiling.js');
const equipment = require('../js/equipment.js');
const research = require('../js/research.js');
const physics = require('../js/physics.js');
const players = require('../js/players.js');
require('../js/prediction.js');
const autopilot = require('../js/autopilot.js');
const rockets = require('../js/rockets.js');
const sand = require('../js/sandblaster.js');
require('../js/water-chemistry.js');
const water = require('../js/water.js');
const minerals = require('../js/minerals.js');

const c = physics.config;
const dt = c.step;
const sandIndex = minerals.mineralIds.indexOf('sand');
const engineIds = ['hand', 'coal', 'oil', 'electric', 'nuclear'];

function applyTier(world, tier, radiator, extras) {
	const nodes = tier === 1 ? []
		: tier === 2 ? ['materials', 'alloys', 'electromagnetics', 'traction', 'thermodynamics', 'impact', 'ballistics']
		: research.nodes.map(node => node.id);
	const items = tier === 1 ? []
		: tier === 2 ? ['pad', 'coil', 'motor']
		: ['pad', 'coil', 'ram', 'motor', 'overdrive', 'chassis', 'flywheel'];
	for (const id of nodes) research.grant(id, world, 'rig');
	for (const id of items) equipment.grant(id, world, 'rig');
	for (const id of extras) {
		if (id === 'thermodynamics') research.grant(id, world, 'rig');
		else equipment.grant(id, world, 'rig');
	}
	if (radiator) {
		research.grant('alloys', world, 'rig');
		research.grant('thermodynamics', world, 'rig');
		equipment.installRadiator(radiator, world, true, 'rig');
	}
	if (tier === 3) equipment.installBall('spike', world, 'rig');
}

console.log('=== 1. ENGINE x STAGE RESERVE, PAD POWER & NOZZLE STREAM DRAW ===');
for (const tier of [1, 2, 3]) {
	const rad = tier === 1 ? null : tier === 2 ? 'radiator' : 'bank';
	for (const eng of engineIds) {
		const world = physics.createWorld();
		players.init(world, 0);
		world.platform.x = world.platform.previousX = physics.platformMin();
		world.platform.vx = 0;
		physics.selectEngine(eng, world, 'rig');
		applyTier(world, tier, rad, []);
		const e = physics.engineNow('rig');
		const raw = physics.reserveNow('rig');
		const useful = raw * e.efficiency;
		const pad = raw / e.reload;
		const sandW = sand.streamPower('rig');
		const waterW = water.streamPower('rig');
		console.log([
			('T' + tier + ' ' + eng).padEnd(12),
			('eff ' + Math.round(e.efficiency * 100) + '%').padStart(8),
			('mass ' + physics.dryMass('rig').toFixed(1) + ' kg').padStart(13),
			('F ' + physics.forceNow('rig').toFixed(0) + ' N').padStart(9),
			('raw ' + (raw / 1000).toFixed(1) + ' kJ').padStart(13),
			('useful ' + (useful / 1000).toFixed(1) + ' kJ').padStart(15),
			('pad ' + (pad / 1000).toFixed(2) + ' kW (' + e.reload + 's)').padStart(18),
			('G ' + physics.conductanceNow('rig').toFixed(1) + ' W/K').padStart(12),
			('sand ' + (sandW / 1000).toFixed(2) + ' kW').padStart(13),
			('water ' + (waterW / 1000).toFixed(2) + ' kW').padStart(14)
		].join(' | '));
	}
}

console.log('\n=== 2. T1 WEAK-ENGINE OFF-PAD NOZZLE BURSTS (x=8, full pack -> 20% floor or 135 C cutoff, bare hull) ===');
for (const mode of ['sand', 'water', 'both']) {
	for (const eng of engineIds) {
		const world = physics.createWorld();
		players.init(world, 0);
		ceiling.reset(1);
		water.reset(1);
		sand.reset(1);
		world.platform.x = world.platform.previousX = physics.platformMin();
		world.platform.vx = 0;
		physics.selectEngine(eng, world, 'rig');
		if (mode !== 'water') equipment.grant('sandblaster', world, 'rig');
		if (mode !== 'sand') equipment.grant('watergun', world, 'rig');
		world.platform.x = world.platform.previousX = 8;
		world.platform.vx = 0;
		world.drive = false;
		if (mode !== 'water') ceiling.loadCargo(sandIndex, 25 * ceiling.state.cellMass, 0);
		world.battery = c.battery;
		world.initialEnergy = physics.totalEnergy(world);
		sand.setAutoFire(mode !== 'water', 'rig');
		water.setAutoFire(mode !== 'sand', 'rig');
		water.setPump(true);
		water.setAim(8, 14.5);
		let stopTime = 0;
		let stopReason = 'reserve';
		let maxTemp = c.ambientTemperature;
		for (let i = 0; i < 240 * 15; i++) {
			physics.step(world, dt);
			const temp = physics.temperature(world);
			if (temp > maxTemp) maxTemp = temp;
			if (!stopTime && physics.thermalFactor(world) <= 0) { stopTime = world.time; stopReason = 'cutoff'; }
			if (!stopTime && world.battery < c.battery * 0.2) { stopTime = world.time; stopReason = 'reserve'; }
		}
		sand.setAutoFire(false, 'rig');
		water.setAutoFire(false, 'rig');
		for (let i = 0; i < 240 * 6 && (sand.state.chamberAloft > 0 || ceiling.state.airborneCells > 0); i++) {
			physics.step(world, dt);
		}
		const botReady = mode === 'sand'
			? c.chargePower >= sand.streamPower('rig')
			: mode === 'water' ? water.streamReady(world, 'rig')
			: c.chargePower >= sand.streamPower('rig') + water.streamPower('rig');
		const drift = Math.abs(physics.totalEnergy(world) - world.initialEnergy);
		console.log([
			(mode + ' / ' + eng).padEnd(16),
			('res ' + (c.battery / 1000).toFixed(1) + ' kJ').padStart(12),
			('stop ' + (stopTime ? stopTime.toFixed(2) + 's ' + stopReason : '0.05s reserve')).padEnd(20),
			('sand ' + sand.state.fired).padStart(9),
			('drops ' + water.totals.droplets).padStart(10),
			('Tmax ' + maxTemp.toFixed(0) + ' C').padStart(10),
			('bot ' + (botReady ? 'yes' : 'no')).padStart(7),
			('err ' + drift.toExponential(1))
		].join(' | '));
	}
}

function runShift(spec) {
	const world = physics.createWorld();
	players.init(world, 0);
	ceiling.reset(1);
	water.reset(1);
	sand.reset(1);
	rockets.reset(1);
	sand.setAutoFire(false, 'rig');
	water.setAutoFire(false, 'rig');
	water.setPump(true);
	rockets.setAutoBuy(false, 'rig');
	for (const ch of ['move', 'smart', 'drive', 'angle']) autopilot.set(ch, false);
	autopilot.reset();
	world.platform.x = world.platform.previousX = physics.platformMin();
	world.platform.vx = 0;
	physics.selectEngine(spec.eng, world, 'rig');
	const extras = spec.extras || [];
	applyTier(world, spec.tier, spec.rad || null, extras);
	if (extras.includes('rocket-rack')) {
		ceiling.loadCargo(0, ceiling.state.cellMass, 800);
		ceiling.sellCargo(0, 0);
		rockets.setAutoBuy(true, 'rig');
		for (let i = 0; i < 6; i++) rockets.buy(world, 'rig');
	}
	if (extras.includes('sandblaster')) ceiling.loadCargo(sandIndex, 20 * ceiling.state.cellMass, 0);
	world.platform.x = world.platform.previousX = 12;
	world.platform.vx = 0;
	world.battery = c.battery;
	if (spec.moveOnly) {
		world.drive = false;
		world.ball.state = 'held';
		world.ball.holder = 'rig';
		physics.settlePose(world.platform);
		world.ball.x = world.platform.x;
		world.ball.y = world.platform.y + c.deck + c.radius;
		world.ball.vx = world.ball.vy = 0;
	}
	world.initialEnergy = physics.totalEnergy(world);
	if (spec.moveOnly) {
		players.setBot(0, false);
		players.setForce(0.55);
	} else if (spec.smartOnly) {
		players.setBot(0, false);
		autopilot.set('smart', true);
		autopilot.set('drive', true);
		autopilot.set('angle', true);
	} else {
		players.setBot(0, true);
	}
	if (spec.forceAuto) {
		if (extras.includes('sandblaster')) sand.setAutoFire(true, 'rig');
		if (extras.includes('watergun')) water.setAutoFire(true, 'rig');
	}
	const steps = Math.round((spec.seconds || 90) / dt);
	let maxTemp = c.ambientTemperature;
	let sumTemp = 0;
	let minFactor = 1;
	let hotSteps = 0;
	let cutSteps = 0;
	let padSteps = 0;
	let coolSteps = 0;
	let rocketsFired = 0;
	let prevStock = rockets.state.stock;
	let patrolGoal = 20;
	let patrolPause = 0;
	for (let i = 0; i < steps; i++) {
		if (spec.moveOnly) {
			world.direction = 0;
			if (world.battery < c.battery * 0.2) world.target = 12;
			else if (world.target === 12 && world.battery < c.battery * 0.95) world.target = 12;
			else if (patrolPause > 0) { patrolPause -= dt; world.target = NaN; }
			else {
				if (Math.abs(world.platform.x - patrolGoal) < 0.25 && Math.abs(world.platform.vx) < 0.2) {
					patrolGoal = patrolGoal > 12 ? 4 : 20;
					patrolPause = 1.5;
					world.target = NaN;
				} else world.target = patrolGoal;
			}
		} else {
			if (extras.includes('watergun')) water.setAim(world.platform.x, 14.5);
			players.update(world, dt);
			autopilot.update(world, dt);
		}
		physics.step(world, dt);
		if (rockets.state.stock < prevStock) rocketsFired += prevStock - rockets.state.stock;
		prevStock = rockets.state.stock;
		const temp = physics.temperature(world);
		const factor = physics.thermalFactor(world);
		if (temp > maxTemp) maxTemp = temp;
		if (factor < minFactor) minFactor = factor;
		if (i >= steps * 0.5) sumTemp += temp;
		if (factor < 1) hotSteps++;
		if (factor <= 0) cutSteps++;
		if (players.state.recharging || (physics.onChargePad(world) && Math.abs(world.platform.vx) < 0.1 && world.battery < c.battery * 0.95)) padSteps++;
		if (players.state.sandCooling) coolSteps++;
	}
	players.setBot(0, false);
	sand.setAutoFire(false, 'rig');
	water.setAutoFire(false, 'rig');
	rockets.setAutoBuy(false, 'rig');
	world.direction = 0;
	world.target = NaN;
	for (let i = 0; i < 240 * 8 && (sand.state.chamberAloft > 0 || ceiling.state.airborneCells > 0); i++) {
		physics.step(world, dt);
	}
	const drift = Math.abs(physics.totalEnergy(world) - world.initialEnergy);
	const seedFunds = extras.includes('rocket-rack') ? 800 : 0;
	const gross = ceiling.state.soldValue + ceiling.state.cargoValue - seedFunds;
	console.log([
		spec.label.padEnd(30),
		spec.eng.padEnd(8),
		('G ' + physics.conductanceNow().toFixed(1)).padStart(7),
		('T2h ' + (sumTemp / (steps * 0.5)).toFixed(0) + 'C').padStart(8),
		('Tmax ' + maxTemp.toFixed(0) + 'C').padStart(9),
		('min ' + Math.round(minFactor * 100) + '%').padStart(8),
		('hot ' + (hotSteps / steps * 100).toFixed(0) + '%').padStart(7),
		('cut ' + (cutSteps / steps * 100).toFixed(0) + '%').padStart(7),
		('pad ' + (padSteps / steps * 100).toFixed(0) + '%').padStart(7),
		('tP ' + (coolSteps / steps * 100).toFixed(0) + '%').padStart(6),
		('rk ' + rocketsFired).padStart(4),
		('sF ' + sand.state.fired).padStart(7),
		('wD ' + water.totals.droplets).padStart(7),
		('cr ' + gross.toFixed(0)).padStart(7),
		('err ' + drift.toExponential(1))
	].join(' | '));
}

console.log('\n=== 3. LIVE STAGE SHIFTS (S1 120 s, S2/S3 90 s, seed 1) ===');
runShift({ label: 'S1 move-only (55% thrust)', eng: 'electric', tier: 1, moveOnly: true, seconds: 120 });
runShift({ label: 'S1 smart move+piston', eng: 'electric', tier: 1, smartOnly: true, seconds: 120 });
runShift({ label: 'S1 chase BOT move+piston', eng: 'electric', tier: 1, seconds: 120 });
runShift({ label: 'S1 chase BOT + grader (bare)', eng: 'electric', tier: 1, extras: ['grader'], seconds: 120 });
runShift({ label: 'S1 smart + grader + thermo', eng: 'electric', tier: 1, extras: ['grader', 'thermodynamics'], smartOnly: true, seconds: 120 });
runShift({ label: 'S1 hand BOT (bare)', eng: 'hand', tier: 1, seconds: 120 });
runShift({ label: 'S1 coal chase BOT (bare)', eng: 'coal', tier: 1, seconds: 120 });
runShift({ label: 'S1 coal chase BOT + vent', eng: 'coal', tier: 1, rad: 'vent', seconds: 120 });
runShift({ label: 'S1 oil chase BOT (bare)', eng: 'oil', tier: 1, seconds: 120 });
runShift({ label: 'S1 nuclear chase BOT (bare)', eng: 'nuclear', tier: 1, seconds: 120 });

for (const eng of ['coal', 'oil', 'electric', 'nuclear']) {
	runShift({ label: 'S2 T2+vent+grader BOT', eng, tier: 2, rad: 'vent', extras: ['grader'], seconds: 90 });
}
for (const eng of ['electric', 'oil', 'nuclear', 'coal']) {
	runShift({ label: 'S2 T2+rad+grader+sand BOT', eng, tier: 2, rad: 'radiator', extras: ['grader', 'sandblaster'], seconds: 90 });
}
for (const eng of ['electric', 'oil', 'nuclear', 'coal']) {
	runShift({ label: 'S2 T2+rad+grader+water BOT', eng, tier: 2, rad: 'radiator', extras: ['grader', 'watergun'], seconds: 90 });
}
for (const eng of ['electric', 'oil', 'nuclear', 'coal']) {
	runShift({ label: 'S3 T3+bank+ALL BOT', eng, tier: 3, rad: 'bank', extras: ['grader', 'rocket-rack', 'sandblaster', 'watergun'], seconds: 90 });
}
for (const eng of ['electric', 'oil', 'nuclear', 'coal']) {
	runShift({ label: 'S3 T3+bank+ALL player-auto', eng, tier: 3, rad: 'bank', extras: ['grader', 'rocket-rack', 'sandblaster', 'watergun'], forceAuto: true, seconds: 90 });
}
