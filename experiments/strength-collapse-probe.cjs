'use strict';
// Compare light indirect strikes across pure minerals and an actual weak seam.
const ceiling = require('../js/ceiling.js');
const state = ceiling.state;
const offset = 5;

function hit(column, impact) {
	ceiling.damage((column + 0.5) * state.cell, state.bottom + state.cell * 0.5, impact);
}

for (const impact of [0.1, 0.75]) {
	console.log('\n' + impact + ' J strike, target five cells from contact; 5 s of delayed collapse');
	for (let m = 0; m < state.mineralCount; m++) {
		ceiling.reset(73);
		ceiling.generateTestRock();
		state.damageField.fill(0);
		const source = Math.floor((m + 0.5) * state.columns / state.mineralCount);
		const target = source + offset;
		const strength = state.strength[target];
		hit(source, impact);
		const looseness = state.damageField[target];
		const loose = state.looseCells;
		ceiling.collapse(5);
		console.log(state.mineralIds[m].padEnd(10), 'strength', strength.toFixed(2), 'J',
			'target looseness', looseness.toFixed(3), looseness >= state.collapseLooseFloor ? 'eligible ' : 'not loose',
			'loose faces', String(loose).padStart(2), 'fallen', String(state.extractedCells).padStart(3));
	}
}

ceiling.reset(1);
let weak = 0;
for (let c = 1; c < state.columns; c++) if (state.strength[c] < state.strength[weak]) weak = c;
const source = weak >= offset ? weak - offset : weak + offset;
const initial = state.strength[weak];
hit(source, 0.1);
const looseness = state.damageField[weak];
const loose = state.looseCells;
ceiling.collapse(5);
console.log('\nseed 1 weak seam, 0.1 J:', 'column', weak, 'strength', initial.toFixed(2), 'J',
	'target looseness', looseness.toFixed(3), 'loose faces', loose, 'fallen', state.extractedCells);
