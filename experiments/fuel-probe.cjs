'use strict';
// Prints the Wild Mine fuel economy: the chemical and useful energy one cargo
// cell of each fuel mineral carries, the refill and useful power of every
// engine family, and what an average opening-bed cell is worth to each family.
// Run: node experiments/fuel-probe.cjs
const minerals = require('../js/minerals.js');
const ceiling = require('../js/ceiling.js');
const physics = require('../js/physics.js');
const fuel = require('../js/fuel.js');

const cellMass = ceiling.state.cellMass;
const prices = ceiling.state.mineralPrices;
const abundance = ceiling.state.mineralAbundance;
const engines = physics.engines;
const capacity = physics.config.battery;
const line = (label, value) => console.log(label.padEnd(30) + value);

console.log('WILD MINE FUEL · cell ' + cellMass + ' kg · stock electric reserve ' + (capacity / 1000).toFixed(2) + ' kJ');
console.log('\nENGINE FAMILIES');
for (const engine of engines) {
	const grade = fuel.engineGrades[engine.id];
	if (grade === undefined || grade < 0) {
		line(engine.name, 'hand · no fuel cycle');
		continue;
	}
	const power = capacity / engine.reload;
	line(engine.name + ' · ' + fuel.gradeIds[grade], (engine.efficiency * 100).toFixed(0) + '% · refill '
		+ (power / 1000).toFixed(2) + ' kW · useful ' + (power * engine.efficiency / 1000).toFixed(2) + ' kW'
		+ ' · ' + engine.reload + ' s to full');
}

console.log('\nFUEL MINERALS (per 0.6 kg cell)');
console.log('mineral        grade    chemical/cell   price   cr/kJ');
for (let m = 0; m < minerals.mineralCount; m++) {
	for (let g = 0; g < fuel.gradeIds.length; g++) {
		const yieldKg = fuel.yieldOf(g, m);
		if (!(yieldKg > 0)) continue;
		const chemical = yieldKg * cellMass;
		const price = prices[m];
		console.log(
			(minerals.mineralNames[m] + ' ' + minerals.mineralSymbols[m]).padEnd(15)
			+ fuel.gradeIds[g].padEnd(9)
			+ (chemical / 1000).toFixed(2).padStart(9) + ' kJ'
			+ price.toFixed(2).padStart(9)
			+ (price / (chemical / 1000)).toFixed(2).padStart(9)
		);
	}
}

console.log('\nAVERAGE OPENING BED · chemical energy per whole cargo cell by family');
for (let g = 0; g < fuel.gradeIds.length; g++) {
	let chemical = 0;
	let share = 0;
	for (let m = 0; m < minerals.mineralCount; m++) {
		const yieldKg = fuel.yieldOf(g, m);
		if (!(yieldKg > 0)) continue;
		const fraction = abundance[m] || 0;
		share += fraction;
		chemical += fraction * cellMass * yieldKg;
	}
	line(fuel.gradeNames[g] + ' family', (chemical / 1000).toFixed(3) + ' kJ chemical per cell · '
		+ (share * 100).toFixed(1) + '% of the bed is this fuel');
}

console.log('\nONE 100-CELL AVERAGE LOAD · chemical in, useful out, jet seconds at 1.66 kW');
for (const engine of engines) {
	const grade = fuel.engineGrades[engine.id];
	if (grade === undefined || grade < 0) continue;
	let chemical = 0;
	for (let m = 0; m < minerals.mineralCount; m++) chemical += (abundance[m] || 0) * 100 * cellMass * fuel.yieldOf(grade, m);
	const useful = chemical * engine.efficiency;
	line(engine.name + ' · ' + fuel.gradeIds[grade], (chemical / 1000).toFixed(1) + ' kJ chemical · '
		+ (useful / 1000).toFixed(1) + ' kJ useful · ' + (useful / 1660).toFixed(1) + ' s of jet');
}
