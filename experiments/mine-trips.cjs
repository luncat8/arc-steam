'use strict';
// Measured mine-collect-sell trips (manual measurement script, not in node --test).
// Policy: drive the platform under the ball with the bounce drive on, sell at the
// nearest wall when the cargo is full, and stop when the reserve runs out. Gross
// income is lifetime sale value; credits are what the run did not spend. The
// progression variant additionally buys research and equipment in a fixed order as
// funds allow, which is how the tree is calibrated against real trip income. The
// communism variant runs the same shift with every price zeroed, so the whole
// progression lands on the first tick and the energy is free.
//
// Since energy.1 the progression policy is pad-aware and buys no energy: below
// 20% reserve it parks on the centre charge pad until 95%, and its shift runs to
// the time cap instead of ending at an empty reserve, which is what the pad loop
// has to prove. The communism-with-grader variant installs the road grader on top
// of the free shift, so the grader's mass and floor work stand alone.
const ceiling = require('../js/ceiling.js');
const equipment = require('../js/equipment.js');
const research = require('../js/research.js');
const physics = require('../js/physics.js');
const c = physics.config;

// Cheapest first, prerequisites before the items they unlock, so a single pass
// per check buys whatever the measured income currently allows.
const progression = [
	['research', 'materials'], ['research', 'alloys'], ['equipment', 'pad'],
	['research', 'thermodynamics'], ['equipment', 'radiator'], ['equipment', 'chassis'],
	['research', 'electromagnetics'], ['equipment', 'coil'],
	['research', 'traction'], ['equipment', 'motor'],
	['research', 'storage'], ['equipment', 'flywheel'], ['research', 'ballistics'],
	['research', 'power'], ['equipment', 'overdrive']
];

function considerUpgrades(world) {
	for (const [kind, id] of progression) {
		if (kind === 'research') research.research(id, world);
		else equipment.install(id, world);
	}
}

function spent() {
	let total = 0;
	for (const entry of ceiling.state.ledger) if (entry.type !== 'sell') total += entry.credits;
	return total;
}

function refuels() {
	let total = 0;
	for (const entry of ceiling.state.ledger) if (entry.type === 'fuel') total++;
	return total;
}

function ownedCount() {
	let total = 0;
	for (const [, id] of progression) if (research.isResearched(id) || equipment.isInstalled(id)) total++;
	return total;
}

function floorMetrics() {
	let sum = 0;
	let max = 0;
	for (const height of ceiling.state.floorPiles) {
		sum += height;
		if (height > max) max = height;
	}
	return { floorSum: sum, floorMax: max };
}

function runTrip(shape, seed, maxSeconds, upgrades) {
	ceiling.setCommune(upgrades === 'free' || upgrades === 'free-grader');
	ceiling.reset(seed);
	ceiling.setShape(shape);
	const w = physics.createWorld();
	ceiling.reset(seed);
	ceiling.setShape(shape);
	if (upgrades === 'free-grader') equipment.install('grader', w);
	w.drive = true;
	const st = ceiling.state;
	let maxSpeed = 0;
	let maxTemperature = c.ambientTemperature;
	let minimumPower = 1;
	let maxPlatformSpeed = 0;
	const trips = [];
	let cellsAtStart = st.extractedCells;
	let salesSeen = 0;
	let stepCount = 0;
	let seekingPad = false;
	// The base shift ends when the reserve does; the pad-aware progression
	// shift has to sustain itself to the cap or the loop is not closed.
	while (w.time < maxSeconds && (upgrades === true || w.battery > 45)) {
		if (upgrades === true) {
			if (w.battery < c.battery * 0.2) seekingPad = true;
			if (w.battery > c.battery * 0.95) seekingPad = false;
		}
		const cargo = st.cargoCells;
		if (seekingPad) {
			w.target = c.width * 0.5;
		} else if (cargo >= 100) {
			// Sell at the nearest wall, then return to mining.
			w.target = w.platform.x < c.width * 0.5 ? physics.platformMin() : physics.platformMax();
		} else {
			w.target = w.ball.x;
		}
		physics.step(w, c.step);
		if (w.ball.state === 'held' && !physics.launch(w)) {}
		if (w.ball.state === 'grounded' && !seekingPad) w.target = w.ball.x;
		if (upgrades && ++stepCount % 240 === 0) {
			// The free shifts may import at will; the paid progression shift
			// must earn its energy positionally on the pad, so it never buys.
			if (upgrades !== true && w.battery < c.battery * 0.25 && st.funds >= ceiling.rechargeCost(w)) ceiling.recharge(w, w.time);
			considerUpgrades(w);
		}
		if (w.sales > salesSeen) {
			salesSeen = w.sales;
			trips.push({ t: w.time, credits: w.lastSale });
		}
		const s = Math.hypot(w.ball.vx, w.ball.vy);
		if (s > maxSpeed) maxSpeed = s;
		const platformSpeed = Math.abs(w.platform.vx);
		if (platformSpeed > maxPlatformSpeed) maxPlatformSpeed = platformSpeed;
		const temperature = physics.temperature(w);
		if (temperature > maxTemperature) maxTemperature = temperature;
		minimumPower = Math.min(minimumPower, physics.thermalFactor(w));
	}
	const floor = floorMetrics();
	return {
		shape, seed, time: w.time,
		extracted: st.extractedCells - cellsAtStart,
		caught: st.caughtCells, lost: st.lostCells,
		sold: st.soldCells, credits: st.funds, earned: st.soldValue,
		trips: trips.length,
		batteryUsed: c.battery - w.battery,
		heat: w.heat, fracture: w.fractureEnergy,
		maxSpeed, maxPlatformSpeed, maxTemperature, minimumPower,
		upgrades: upgrades ? ownedCount() : 0, spent: upgrades ? spent() : 0,
		refuels: upgrades ? refuels() : 0, imported: upgrades ? w.importedEnergy / 1000 : 0,
		pad: w.chargedEnergy / 1000, crank: w.crankEnergy / 1000,
		floorSum: floor.floorSum, floorMax: floor.floorMax,
		state: w.ball.state
	};
}

const modes = [['base tuning', false], ['with progression purchases (pad-aware)', true], ['communism mode (all free)', 'free'], ['communism mode + grader (all free)', 'free-grader']];
for (const [label, upgrades] of modes) {
	const rows = [];
	console.log(`\n=== ${label} (force ${c.force} N, top speed ${c.maxSpeed} m/s) ===`);
	for (const shape of ['smooth', 'square']) {
		for (let seed = 1; seed <= 8; seed++) {
			const r = runTrip(shape, seed, 240, upgrades);
			rows.push(r);
			console.log(
				`${shape.padEnd(6)} seed ${String(seed).padStart(2)}  t ${r.time.toFixed(0)}s  extracted ${String(r.extracted).padStart(4)}  caught ${String(r.caught).padStart(4)}  lost ${String(r.lost).padStart(4)}` +
				`  sold ${String(r.sold).padStart(4)}  earned ${r.earned.toFixed(0).padStart(5)} cr  credits ${r.credits.toFixed(0).padStart(5)}  sales ${r.trips}  battery ${(r.batteryUsed / 1000).toFixed(2)} kJ  ballSpeed ${r.maxSpeed.toFixed(1)}  platformSpeed ${r.maxPlatformSpeed.toFixed(1)}` +
				`  maxTemp ${r.maxTemperature.toFixed(1)} C  minPower ${(r.minimumPower * 100).toFixed(0)}%  pad ${r.pad.toFixed(2)} kJ  crank ${r.crank.toFixed(2)} kJ  floor ${r.floorSum.toFixed(2)} max ${r.floorMax.toFixed(2)}` +
				(upgrades ? `  upgrades ${r.upgrades}/${progression.length}  spent ${r.spent.toFixed(0)} cr  refuels ${r.refuels}  imported ${r.imported.toFixed(1)} kJ` : '')
			);
		}
	}
	for (const shape of ['smooth', 'square']) {
		const set = rows.filter(r => r.shape === shape);
		const avg = key => set.reduce((a, r) => a + r[key], 0) / set.length;
		console.log(`\n${shape} averages over ${set.length} seeds (240 s cap):`);
		console.log(`  extraction rate ${(avg('extracted') / avg('time') * 60).toFixed(1)} cells/min, catch rate ${(avg('caught') / Math.max(1, avg('extracted')) * 100).toFixed(1)}%`);
		console.log(`  gross income ${avg('earned').toFixed(0)} cr/shift, ${(avg('earned') / avg('time') * 60).toFixed(1)} cr/min, ${avg('trips').toFixed(1)} wall sales, ${(avg('earned') / Math.max(1, avg('trips'))).toFixed(0)} cr/sale, ${avg('credits').toFixed(0)} cr unspent`);
		console.log(`  energy ${(avg('batteryUsed') / avg('time')).toFixed(1)} W average draw, ball speed ${avg('maxSpeed').toFixed(1)} m/s, platform speed ${avg('maxPlatformSpeed').toFixed(1)} m/s`);
		console.log(`  maxTemperature ${avg('maxTemperature').toFixed(1)} °C average, minimum drive output ${(avg('minimumPower') * 100).toFixed(0)}%`);
		console.log(`  centre-pad charging ${avg('pad').toFixed(2)} kJ per shift (${(avg('pad') / avg('time') * 1000).toFixed(1)} W average), crank ${avg('crank').toFixed(2)} kJ per shift`);
		console.log(`  floor piles sum ${avg('floorSum').toFixed(2)} column-m, tallest pile ${avg('floorMax').toFixed(2)} m`);
		if (upgrades) console.log(`  progression ${avg('upgrades').toFixed(1)}/${progression.length} nodes owned, ${avg('spent').toFixed(0)} cr spent of ${avg('earned').toFixed(0)} cr earned, ${avg('refuels').toFixed(1)} recharges importing ${avg('imported').toFixed(1)} kJ`);
	}
}
