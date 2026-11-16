'use strict';
// Multi-seed 240 s progression-income sweep (0.3.8-plan.md) with all thirteen
// rock-forming minerals, live market cycles, top-row growth, rockets,
// sandblaster and water gun active. Parallelized across worker threads; logs
// init vs step timing.
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const { Worker, isMainThread, parentPort } = require('worker_threads');

const fullProgression = [
	['equipment', 'grader'],
	['research', 'materials'],
	['research', 'alloys'],
	['research', 'thermodynamics'],
	['radiator', 'vent'],
	['research', 'electromagnetics'],
	['equipment', 'coil'],
	['research', 'impact'],
	['equipment', 'rocket-rack'],
	['equipment', 'sandblaster'],
	['research', 'traction'],
	['equipment', 'motor'],
	['research', 'hydrology'],
	['equipment', 'watergun'],
	['radiator', 'radiator'],
	['research', 'storage'],
	['equipment', 'flywheel'],
	['research', 'ballistics'],
	['research', 'power'],
	['equipment', 'ram'],
	['equipment', 'overdrive'],
	['research', 'ballistics2'],
	['radiator', 'bank'],
	['ball', 'spike'],
	['engine', 'nuclear'],
	['equipment', 'chassis'],
	['equipment', 'pad']
];

if (!isMainThread) {
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
	const c = physics.config;
	const dt = c.step;

	function buyNextUpgrades(world, boughtLog) {
		let bought = true;
		while (bought) {
			bought = false;
			for (const [kind, id] of fullProgression) {
				let ok = false;
				if (kind === 'research') {
					if (research.isResearched(id, 'rig')) continue;
					ok = research.research(id, world, 'rig');
				} else if (kind === 'equipment') {
					if (equipment.isInstalled(id, 'rig')) continue;
					ok = equipment.install(id, world, 'rig');
				} else if (kind === 'radiator') {
					if (equipment.ownsRadiator(id, 'rig')) continue;
					ok = equipment.installRadiator(id, world, false, 'rig');
				} else if (kind === 'ball') {
					if (equipment.ownsBall(id, 'rig')) continue;
					ok = equipment.installBall(id, world, false, 'rig');
				} else if (kind === 'engine') {
					if (equipment.ownsEngine(id, 'rig')) continue;
					ok = equipment.buyEngine(id, world, 'rig');
				}
				if (ok) {
					boughtLog.push({ t: world.time, kind, id, funds: ceiling.state.funds });
					bought = true;
				}
			}
		}
	}

	function applyPreset(world, spec) {
		for (const id of spec.nodes || []) research.grant(id, world, 'rig');
		for (const id of spec.items || []) equipment.grant(id, world, 'rig');
		if (spec.rad) {
			research.grant('alloys', world, 'rig');
			research.grant('thermodynamics', world, 'rig');
			equipment.installRadiator(spec.rad, world, true, 'rig');
		}
		if (spec.ball) {
			research.grant('materials', world, 'rig');
			research.grant('impact', world, 'rig');
			equipment.installBall(spec.ball, world, true, 'rig');
		}
		if (spec.eng && spec.eng !== 'electric') {
			world.platform.x = world.platform.previousX = physics.platformMin();
			world.platform.vx = 0;
			physics.selectEngine(spec.eng, world, 'rig');
			world.platform.x = world.platform.previousX = 12;
		}
	}

	function snapshot(seed, seconds, world, spec, initMs, stepMs, rocketsFired, maxTemp, cutSteps, padSteps, steps, boughtLog) {
		let spent = 0;
		let graderCr = 0;
		for (const entry of ceiling.state.ledger) {
			if (entry.type === 'buy' || entry.type === 'research' || entry.type === 'fuel') spent += entry.credits;
			else if (entry.type === 'grader' || entry.type === 'blade') graderCr += entry.credits;
		}
		const gross = ceiling.state.soldValue + ceiling.state.cargoValue - (spec.seedMoney || 0);
		const totalEarned = gross + graderCr;
		const metrics = water.measureMetrics();
		return {
			label: spec.labelFor ? spec.labelFor(seconds) : spec.label,
			seconds, seed, initMs, stepMs,
			gross,
			graderCr,
			totalEarned,
			sold: ceiling.state.soldValue,
			funds: ceiling.state.funds,
			spent,
			sales: world.sales,
			extracted: ceiling.state.extractedCells,
			caught: ceiling.state.caughtCells,
			pumpedCr: metrics.pumpedValue,
			pumpedU: metrics.pumped,
			waterCells: metrics.dissolvedCells,
			sandFired: sand.state.fired,
			waterDrops: metrics.droplets,
			rocketsFired,
			topRows: ceiling.state.rows - 29,
			maxTemp,
			cutPct: cutSteps / steps * 100,
			padPct: padSteps / steps * 100,
			boughtLog: boughtLog.map(b => ({ ...b }))
		};
	}

	function runJob(spec) {
		const tInit0 = performance.now();
		ceiling.setCommune(false);
		const world = physics.createWorld();
		players.init(world, 0);
		ceiling.reset(spec.seed);
		water.reset(spec.seed);
		sand.reset(spec.seed);
		rockets.reset(spec.seed);
		sand.setAutoFire(false, 'rig');
		water.setAutoFire(false, 'rig');
		water.setPump(true);
		rockets.setAutoBuy(true, 'rig');
		for (const ch of ['move', 'smart', 'drive', 'angle']) autopilot.set(ch, false);
		autopilot.reset();
		applyPreset(world, spec);
		if (spec.seedMoney) {
			ceiling.loadCargo(0, ceiling.state.cellMass, spec.seedMoney);
			ceiling.sellCargo(0, 0);
		}
		if (equipment.isInstalled('rocket-rack', 'rig')) {
			world.platform.x = world.platform.previousX = physics.platformMin();
			rockets.buy(world, 6, 'rig');
		}
		world.platform.x = world.platform.previousX = 12;
		world.platform.vx = 0;
		world.battery = c.battery;
		world.initialEnergy = physics.totalEnergy(world);
		players.setBot(0, true);
		const tInit1 = performance.now();

		const checkpoints = (spec.checkpoints || [spec.seconds || 240]).slice().sort((a, b) => a - b);
		const maxSeconds = checkpoints[checkpoints.length - 1];
		const totalSteps = Math.round(maxSeconds / dt);
		const stepMarks = new Map(checkpoints.map(sec => [Math.round(sec / dt), sec]));

		const boughtLog = [];
		let maxTemp = c.ambientTemperature;
		let cutSteps = 0;
		let padSteps = 0;
		let rocketsFired = 0;
		let prevStock = rockets.state.stock;
		let prevSales = world.sales;
		const snapshots = [];

		const tStep0 = performance.now();
		for (let i = 1; i <= totalSteps; i++) {
			if (equipment.isInstalled('watergun', 'rig')) water.setAim(world.platform.x, 14.5);
			players.update(world, dt);
			autopilot.update(world, dt);
			physics.step(world, dt);

			if (rockets.state.stock < prevStock) rocketsFired += prevStock - rockets.state.stock;
			prevStock = rockets.state.stock;

			if (spec.organic && (world.sales > prevSales || i % 120 === 0 || equipment.atShop(world, 'rig'))) {
				prevSales = world.sales;
				buyNextUpgrades(world, boughtLog);
				if (equipment.isInstalled('rocket-rack', 'rig') && physics.atSellWall(world, 'rig')) {
					rockets.buy(world, 6 - rockets.state.stock, 'rig');
				}
			}

			const temp = physics.temperature(world);
			if (temp > maxTemp) maxTemp = temp;
			if (physics.thermalFactor(world) <= 0) cutSteps++;
			if (players.state.recharging || (physics.onChargePad(world) && Math.abs(world.platform.vx) < 0.1 && world.battery < c.battery * 0.95)) padSteps++;

			const markSec = stepMarks.get(i);
			if (markSec) {
				snapshots.push(snapshot(
					spec.seed, markSec, world, spec,
					tInit1 - tInit0, performance.now() - tStep0,
					rocketsFired, maxTemp, cutSteps, padSteps, i, boughtLog
				));
			}
		}

		players.setBot(0, false);
		sand.setAutoFire(false, 'rig');
		water.setAutoFire(false, 'rig');
		rockets.setAutoBuy(false, 'rig');
		return snapshots;
	}

	parentPort.on('message', spec => {
		parentPort.postMessage(runJob(spec));
	});
	return;
}

const tRequire0 = performance.now();
const research = require('../js/research.js');
const tRequire1 = performance.now();

const allNodes = research.nodes.map(n => n.id);
const allEndgameItems = ['grader', 'pad', 'coil', 'ram', 'motor', 'overdrive', 'chassis', 'flywheel', 'rocket-rack', 'sandblaster', 'watergun'];
const midNodes = ['materials', 'alloys', 'thermodynamics', 'electromagnetics', 'impact', 'traction', 'hydrology'];
const midItems = ['grader', 'coil', 'motor', 'rocket-rack', 'sandblaster', 'watergun'];

const seeds = [1, 2, 3, 4, 5, 6];
const jobs = [];
for (const seed of seeds) jobs.push({ key: 'organic', seed, organic: true, checkpoints: [240, 480, 720] });
const stages = [
	['Stage 1 bare T1 electric (240s)', { nodes: [], items: [], seconds: 240 }],
	['Stage 1 T1 + grader (240s)', { nodes: [], items: ['grader'], seconds: 240 }],
	['Stage 2 midgame T2+rad+grader+rk+sand+water electric (240s)', { nodes: midNodes, items: midItems, rad: 'radiator', seedMoney: 400, seconds: 240 }],
	['Stage 3 endgame T3+bank+ALL electric (240s)', { nodes: allNodes, items: allEndgameItems, rad: 'bank', ball: 'spike', eng: 'electric', seedMoney: 400, seconds: 240 }],
	['Stage 3 endgame T3+bank+ALL nuclear (240s)', { nodes: allNodes, items: allEndgameItems, rad: 'bank', ball: 'spike', eng: 'nuclear', seedMoney: 400, seconds: 240 }]
];
for (const [label, spec] of stages) {
	for (const seed of seeds) jobs.push({ key: label, label, seed, ...spec });
}

function summarize(label, rows) {
	rows.sort((a, b) => a.seed - b.seed);
	const n = rows.length;
	const avg = fn => rows.reduce((a, r) => a + fn(r), 0) / n;
	const sorted = rows.map(r => r.gross).sort((a, b) => a - b);
	const med = sorted[Math.floor(n / 2)];
	console.log(`\n--- ${label} (n=${n}) ---`);
	for (const r of rows) {
		console.log(
			`  seed ${r.seed} | earned ${r.totalEarned.toFixed(0).padStart(5)} cr (cargo ${r.gross.toFixed(0).padStart(5)} + grd ${r.graderCr.toFixed(0).padStart(5)}) | sold ${r.sold.toFixed(0).padStart(5)} | funds ${r.funds.toFixed(0).padStart(5)} | spent ${r.spent.toFixed(0).padStart(5)}` +
			` | ext ${String(r.extracted).padStart(4)} | cgt ${String(r.caught).padStart(4)} | rk ${String(r.rocketsFired).padStart(2)} | sF ${String(r.sandFired).padStart(5)} | wD ${String(r.waterDrops).padStart(5)}` +
			` | pmpCr ${r.pumpedCr.toFixed(0).padStart(4)} (${r.pumpedU.toFixed(0)}u) | top+${r.topRows} | Tmax ${r.maxTemp.toFixed(0)}C | pad ${r.padPct.toFixed(0)}% | init ${r.initMs.toFixed(0)}ms step ${r.stepMs.toFixed(0)}ms` +
			(r.boughtLog.length ? ` | bought(${r.boughtLog.length}): ${r.boughtLog.map(b => b.id + '@' + b.t.toFixed(0) + 's').join(', ')}` : '')
		);
	}
	console.log(
		`  AVG: earned ${avg(r => r.totalEarned).toFixed(0)} cr (cargo ${avg(r => r.gross).toFixed(0)}, med ${med.toFixed(0)}, grd ${avg(r => r.graderCr).toFixed(0)}) | sold ${avg(r => r.sold).toFixed(0)} | ` +
		`pumped ${avg(r => r.pumpedCr).toFixed(0)} cr (${avg(r => r.pumpedU).toFixed(1)} u) | rk ${avg(r => r.rocketsFired).toFixed(1)} | ` +
		`sF ${avg(r => r.sandFired).toFixed(0)} | wD ${avg(r => r.waterDrops).toFixed(0)} | step ${avg(r => r.stepMs).toFixed(0)} ms`
	);
}

const tTotal0 = performance.now();
const workerCount = Math.min(os.cpus().length || 2, jobs.length);
console.log(`Module require time: ${(tRequire1 - tRequire0).toFixed(1)} ms | Workers: ${workerCount} | Jobs: ${jobs.length}`);

let nextJob = 0;
const collected = [];
function spawnWorker() {
	return new Promise((resolve, reject) => {
		const wk = new Worker(__filename);
		wk.on('message', snaps => {
			for (const s of snaps) collected.push(s);
			const last = snaps[snaps.length - 1];
			console.error(`[done ${collected.length}] ${last.label || 'organic ' + last.seconds + 's'} s${last.seed} (${last.stepMs.toFixed(0)}ms)`);
			if (nextJob < jobs.length) wk.postMessage(jobs[nextJob++]);
			else { wk.terminate(); resolve(); }
		});
		wk.on('error', reject);
		if (nextJob < jobs.length) wk.postMessage(jobs[nextJob++]);
		else { wk.terminate(); resolve(); }
	});
}

Promise.all(Array.from({ length: workerCount }, spawnWorker)).then(() => {
	for (const sec of [240, 480, 720]) {
		summarize(`Organic progression ${sec}s (${sec / 240} shifts from bare T1 electric)`,
			collected.filter(r => !r.label && r.seconds === sec));
	}
	for (const [label] of stages) {
		summarize(label, collected.filter(r => r.label === label));
	}
	const tTotal1 = performance.now();
	console.log(`\nTotal sweep wall time: ${((tTotal1 - tTotal0) / 1000).toFixed(2)} s`);
});
