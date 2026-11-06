'use strict';
// Measure the delayed-collapse behaviour of js/ceiling.js.
const ceiling = require('../js/ceiling.js');

function fresh(seed) {
	const w = { platform: { x: -5, vx: 0 }, heat: 0, ball: null, time: 0 };
	ceiling.reset(seed);
	return w;
}
function hit(w, x, y, j) { ceiling.damage(x, y, j); }
function collapse(seconds) { ceiling.collapse(seconds); }
function stats() {
	const s = ceiling.state;
	return { extracted: s.extractedCells, loose: s.looseCells, dust: s.dustCount, airborne: s.airborneCells };
}

function probe() {
	const w = fresh(47);
	const before = stats().extracted;
	hit(w, 8, ceiling.state.bottom + 0.2, 40);
	const immediate = stats().extracted - before;
	console.log('40 J hit: immediate extraction', immediate, 'loose', stats().loose);
	for (let t = 0; t < 60; t += 1) collapse(1);
	console.log('after 60 s of collapse: extracted', stats().extracted, 'loose', stats().loose);

	const w2 = fresh(33);
	let prev = stats().extracted;
	for (let i = 0; i < 40; i++) { hit(w2, 8, ceiling.state.bottom + 0.2, 3); collapse(0.25); }
	console.log('40x 3 J hits: extracted', stats().extracted - prev, 'loose', stats().loose);

	const w3 = fresh(21);
	const before3 = stats().extracted;
	hit(w3, 8, ceiling.state.bottom + 0.2, 200);
	collapse(60);
	console.log('200 J hit: immediate', stats().extracted - before3, 'after 60 s', stats().extracted);
}
probe();