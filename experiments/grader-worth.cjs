'use strict';
// Opening-strategy probe (manual measurement script, not in node --test).
// Question: which early opening pays, and does the road grader earn its 300 cr?
//   none        — mine and sell, buy nothing, call nothing.
//   commercial  — call the garage grader at t = 0 (free, 50% of each sweep).
//   road        — buy the 300 cr road grader the moment the purse affords it.
//   both        — the proposed opening: garage grader at 0 s, road grader when affordable.
//   gear        — the alternative use of that money: materials + rebound pad (430 cr).
//   blade free  — the same machine granted instead of sold, which separates the
//                 300 cr price from the blade's own mass and rolling resistance.
//
// The policy is the pad-aware mining loop with no other spending, so the only
// differences between runs are the strategy's own calls and purchases. Every
// variant is measured on liquid wealth (purse + hopper + the garage grader's
// unsettled load at its 50% share). Floor rubble is NOT counted: the rig cannot
// recover it except through the garage grader, so pricing it as an asset would
// flatter the variant that leaves the most of it behind.
const ceiling = require('../js/ceiling.js');
const equipment = require('../js/equipment.js');
const research = require('../js/research.js');
const physics = require('../js/physics.js');
const c = physics.config;

// `free` grants the blade instead of selling it, which separates the 300 cr
// price from the machine's own cost: 10 kg of hull, 45 N of rolling resistance
// and a blade that grinds the rubble the garage grader would otherwise sweep.
const strategies = [
	{ id: 'none', commercial: false, road: false, gear: false, free: false },
	{ id: 'commercial', commercial: true, road: false, gear: false, free: false },
	{ id: 'road', commercial: false, road: true, gear: false, free: false },
	{ id: 'both', commercial: true, road: true, gear: false, free: false },
	{ id: 'gear', commercial: true, road: false, gear: true, free: false },
	{ id: 'blade free', commercial: true, road: false, gear: false, free: true }
];

function sums() {
	let floorValue = 0;
	for (const value of ceiling.state.floorValues) floorValue += value;
	return floorValue;
}

function liquid(state) {
	return state.funds + state.cargoValue + state.graderBot.value * 0.5;
}

function snapshot(world) {
	const state = ceiling.state;
	return { time: world.time, funds: state.funds, cargo: state.cargoValue, claim: state.graderBot.value * 0.5, net: liquid(state) };
}

function run(variant, seed, seconds) {
	ceiling.reset(seed);
	const w = physics.createWorld();
	ceiling.reset(seed);
	const st = ceiling.state;
	if (variant.commercial) ceiling.hireGrader(w);
	if (variant.free) equipment.grant('grader', w);
	let mid = null;
	let seekingPad = false;
	let boughtRoad = false;
	while (w.time < seconds) {
		if (w.battery < c.battery * 0.2) seekingPad = true;
		if (w.battery > c.battery * 0.95) seekingPad = false;
		if (seekingPad) w.target = c.width * 0.5;
		else if (st.cargoCells >= 100) w.target = w.platform.x < c.width * 0.5 ? physics.platformMin() : physics.platformMax();
		else w.target = w.ball.x;
		physics.step(w, c.step);
		if (w.ball.state === 'held') physics.launch(w);
		if (w.ball.state === 'grounded' && !seekingPad) w.target = w.ball.x;
		if (variant.road && !boughtRoad && st.funds >= 300) boughtRoad = equipment.install('grader', w);
		if (variant.gear) {
			research.research('materials', w);
			equipment.install('pad', w);
		}
		if (!mid && w.time >= seconds / 2) mid = snapshot(w);
	}
	const ended = snapshot(w);
	// Spending is what left the purse backwards: sales, the garage grader's
	// share and the blade's own settlement are income, not purchases.
	const spent = (() => {
		let total = 0;
		for (const entry of st.ledger) if (entry.type !== 'sell' && entry.type !== 'grader' && entry.type !== 'blade') total += entry.credits;
		return total;
	})();
	const blade = st.ledger.reduce((total, entry) => total + (entry.type === 'blade' ? entry.credits : 0), 0);
	return {
		seed, mid, end: ended, spent, blade,
		earned: st.soldValue, grader: st.ledger.reduce((total, entry) => total + (entry.type === 'grader' ? entry.credits : 0), 0) + ended.claim,
		floorValue: sums(), caught: st.caughtCells, lost: st.lostCells, extracted: st.extractedCells,
		road: boughtRoad
	};
}

function mean(list, pick) {
	return list.reduce((total, row) => total + pick(row), 0) / list.length;
}

const seeds = 8;
const seconds = 480;
const rows = new Map();
for (const variant of strategies) {
	const list = [];
	for (let seed = 1; seed <= seeds; seed++) list.push(run(variant, seed, seconds));
	rows.set(variant.id, list);
}

function line(label, list) {
	const mid = mean(list, row => row.mid.net);
	const net = mean(list, row => row.end.net);
	const earned = mean(list, row => row.earned);
	const spent = mean(list, row => row.spent);
	const grader = mean(list, row => row.grader);
	const floorValue = mean(list, row => row.floorValue);
	const caught = mean(list, row => row.caught);
	const extracted = mean(list, row => row.extracted);
	const road = list.filter(row => row.road).length;
	console.log(
		`  ${label.padEnd(11)} net ${net.toFixed(0).padStart(5)} cr  (240 s ${mid.toFixed(0).padStart(5)})  ` +
		`earned ${earned.toFixed(0).padStart(5)}  spent ${spent.toFixed(0).padStart(4)}  grader ${grader.toFixed(0).padStart(4)}  blade ${mean(list, row => row.blade).toFixed(0).padStart(4)}  ` +
		`floor ${floorValue.toFixed(0).padStart(5)}  caught ${(100 * caught / Math.max(1, extracted)).toFixed(0).padStart(3)}%` +
		(list.some(row => row.road || row.seed === 0) ? `  road ${road}/${list.length}` : '')
	);
}

console.log(`grader-worth probe — ${seconds} s shifts, pad-aware mining policy, ${seeds} seeds each`);
console.log('net = purse + hopper value + the garage grader\'s unsettled load at 50%; floor rubble is not counted\n');
for (const variant of strategies) {
	const list = rows.get(variant.id);
	line(variant.id, list);
}

const base = rows.get('none');
console.log('\ndelta vs none (net at ' + seconds + ' s, and at ' + seconds / 2 + ' s):');
for (const variant of strategies.slice(1)) {
	const list = rows.get(variant.id);
	const delta = key => mean(list, row => row.end.net) - mean(base, row => row.end.net);
	const early = mean(list, row => row.mid.net) - mean(base, row => row.mid.net);
	console.log(`  ${variant.id.padEnd(11)} ${delta('net') >= 0 ? '+' : ''}${delta('net').toFixed(0).padStart(5)} cr  (` + (early >= 0 ? '+' : '') + early.toFixed(0).padStart(5) + ' at half)');
}
