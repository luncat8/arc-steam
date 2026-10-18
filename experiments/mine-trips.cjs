'use strict';
// Measured mine-collect-sell trips (manual measurement script, not in node --test).
// Policy: drive the platform under the ball with the bounce drive on, sell at
// the nearest wall when the cargo is full or the reserve runs low. Reports
// yield, catch rate, sale value, energy cost and trip time per seed/shape.
const ceiling = require('../js/ceiling.js');
const physics = require('../js/physics.js');
const c = physics.config;

function runTrip(shape, seed, maxSeconds) {
	ceiling.reset(seed);
	ceiling.setShape(shape);
	const w = physics.createWorld();
	ceiling.reset(seed);
	ceiling.setShape(shape);
	w.drive = true;
	const st = ceiling.state();
	let maxSpeed = 0;
	const trips = [];
	let cellsAtStart = st.extractedCells();
	let salesSeen = 0;
	while (w.time < maxSeconds && w.battery > 45) {
		const cargo = st.cargoCells();
		if (cargo >= 100) {
			// Sell at the nearest wall, then return to mining.
			w.target = w.platform.x < c.width * 0.5 ? physics.platformMin() : physics.platformMax();
		} else {
			w.target = w.ball.x;
		}
		physics.step(w, c.step);
		if (w.ball.state === 'held' && !physics.launch(w)) {}
		if (w.ball.state === 'grounded') w.target = w.ball.x;
		if (w.sales > salesSeen) {
			salesSeen = w.sales;
			trips.push({ t: w.time, credits: w.lastSale });
		}
		const s = Math.hypot(w.ball.vx, w.ball.vy);
		if (s > maxSpeed) maxSpeed = s;
	}
	return {
		shape, seed, time: w.time,
		extracted: st.extractedCells() - cellsAtStart,
		caught: st.caughtCells(), lost: st.lostCells(),
		sold: st.soldCells(), credits: st.funds(),
		trips: trips.length,
		batteryUsed: c.battery - w.battery,
		heat: w.heat, fracture: w.fractureEnergy,
		maxSpeed, state: w.ball.state
	};
}

const rows = [];
for (const shape of ['smooth', 'square']) {
	for (let seed = 1; seed <= 8; seed++) {
		const r = runTrip(shape, seed, 240);
		rows.push(r);
		console.log(
			`${shape.padEnd(6)} seed ${String(seed).padStart(2)}  t ${r.time.toFixed(0)}s  extracted ${String(r.extracted).padStart(4)}  caught ${String(r.caught).padStart(4)}  lost ${String(r.lost).padStart(4)}` +
			`  sold ${String(r.sold).padStart(4)}  credits ${r.credits.toFixed(1).padStart(7)}  sales ${r.trips}  battery ${(r.batteryUsed / 1000).toFixed(2)} kJ  maxSpeed ${r.maxSpeed.toFixed(1)}`
		);
	}
}
for (const shape of ['smooth', 'square']) {
	const set = rows.filter(r => r.shape === shape);
	const sum = key => set.reduce((a, r) => a + r[key], 0);
	const avg = key => sum(key) / set.length;
	console.log(`\n${shape} averages over ${set.length} seeds of ${rows[0].time.toFixed(0)} s:`);
	console.log(`  extraction rate ${(avg('extracted') / avg('time') * 60).toFixed(1)} cells/min, catch rate ${(avg('caught') / Math.max(1, avg('extracted')) * 100).toFixed(1)}%`);
	console.log(`  sale value ${(avg('credits') / avg('time') * 60).toFixed(1)} cr/min, ${avg('trips').toFixed(1)} wall sales, ${(avg('credits') / Math.max(1, avg('trips'))).toFixed(0)} cr/sale`);
	console.log(`  energy ${(avg('batteryUsed') / avg('time')).toFixed(1)} W average draw, maxSpeed ${(avg('maxSpeed')).toFixed(1)} m/s`);
}
