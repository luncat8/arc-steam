'use strict';
// Measure the shipped table through the live geology/economy APIs. No mirror
// solver: optional --adjust runs the same autoAdjust used by the mineral lab.
const assert = require('node:assert/strict');
const minerals = require('../js/minerals.js');
const config = require('../js/geology-config.js');
const geology = require('../js/geology.js');
const materials = require('../js/rock-materials.js');
const settings = config.create(1);
const sample = geology.buildSample({ seeds: [1, 2, 3, 4, 5, 6, 7, 8], columns: 192, rows: 120,
	frequency: settings.frequency, yCompression: settings.yCompression });
let formation = geology.compile(settings.ranges, settings.mode, settings.specificity);
let cache = geology.buildCache(sample, formation);
let stats = geology.statsAt(cache, settings.hostWeight, geology.emptyStats());
if (process.argv.includes('--adjust')) {
	const adjusted = geology.autoAdjust({ sample, ranges: settings.ranges, targets: minerals.rarityTargets,
		mode: settings.mode, specificity: settings.specificity, hostWeight: settings.hostWeight });
	formation = adjusted.formation;
	cache = adjusted.cache;
	stats = adjusted.stats;
	console.log('autoAdjust passes=' + adjusted.history.length + ' hostWeight=' + adjusted.hostWeight.toFixed(4));
}
const prices = new Float64Array(minerals.mineralCount);
const report = {};
materials.basePricesInto(prices, stats.shares, undefined, report);
console.log('Solubility geology: 8 seeds x 192x120; ' + minerals.formationCount + ' forming minerals + liberated Pure Gold');
console.log('hostWeight=' + stats.hostWeight.toFixed(4) + ' achievedMean=' + report.mean.toFixed(4) + ' targetMean=' + report.target);
for (let m = 0; m < minerals.mineralCount; m++) {
	const row = minerals.mineralTable[m];
	const target = minerals.rarityTargets[m];
	console.log(row.id.padEnd(10) + ' share=' + (stats.shares[m] * 100).toFixed(3) + '% target=' +
		(target * 100).toFixed(3) + '% quote=' + prices[m].toFixed(4));
	assert.ok(Math.abs(stats.shares[m] - target) < 0.001, row.id + ' misses calibration by >0.1 pp');
	if (row.gen === false) assert.equal(stats.shares[m], 0);
}
const copper = minerals.mineralIds.indexOf('copper');
const vitriol = minerals.mineralIds.indexOf('vitriol');
console.log('copper+vitriol=' + (100 * (stats.shares[copper] + stats.shares[vitriol])).toFixed(3) + '% (target 7.830%)');
assert.ok(Math.abs(stats.shares[copper] + stats.shares[vitriol] - 0.0783) < 0.001);
