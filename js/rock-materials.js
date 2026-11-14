// Mixture maths shared by the game and the lab: an impact strength, a mineral
// colour, a base price and the two display ramps of one cell. Every function
// writes into caller-owned storage and allocates nothing, so the same rules run
// in the per-cell generation loop and in a calibration pass.
//
// Strength and price are unrelated: strength is material resistance in J/cell,
// price is an abundance curve over the measured mix. Collapse growth is a third
// rule again and lives with the fall mechanics, not here.
// Depends on: js/minerals.js
// Provides: economy, maxStrength, debrisLimit, strengthInto,
// colorInto, valueInto, basePricesInto, priceColorInto, strengthColorInto,
// desaturateInto
(function (root) {
	'use strict';
	const node = typeof module !== 'undefined' && module.exports;
	const minerals = node ? require('./minerals.js') : root.SteamMinerals;

	const table = minerals.mineralTable;
	const count = minerals.mineralCount;

	// A cell is worth this much on average at a neutral market. Base prices
	// follow a rarity curve over the measured abundance and each material's
	// average demand, normalised back to this target, so the spread between
	// ores can change without moving the economy. An elasticity above 1 makes a
	// rare mineral dearer than its share alone.
	const economy = Object.freeze({
		targetCellValue: 12.5,
		elasticity: 1.3,
		floor: 0.4,
		cap: 150
	});
	// A mineral that has not formed in the sample still needs a finite quote.
	const minimumShare = 1e-4;

	// The fixed top of the strength scale: the strongest pure mineral, so a
	// cell's colour never depends on its own initial strength.
	let maxStrength = 0;
	for (let m = 0; m < count; m++) if (table[m].strength > maxStrength) maxStrength = table[m].strength;
	// Rock holding less than this is rubble: it may let go, and the strength
	// view greys it. It is the one absolute collapse limit, so the table can
	// carry both rock that always holds here and materials that form below it
	// and are loose by nature.
	const debrisLimit = 0.8;

	// Mineral-weighted impact resistance in J/cell.
	function strengthInto(mix, offset) {
		let value = 0;
		for (let m = 0; m < count; m++) value += mix[offset + m] * table[m].strength;
		return value;
	}

	// Mineral-weighted colour into rgb[0..2].
	function colorInto(mix, offset, rgb) {
		let red = 0;
		let green = 0;
		let blue = 0;
		for (let m = 0; m < count; m++) {
			const fraction = mix[offset + m];
			if (fraction <= 0) continue;
			const tint = table[m].color;
			red += fraction * tint[0];
			green += fraction * tint[1];
			blue += fraction * tint[2];
		}
		rgb[0] = red;
		rgb[1] = green;
		rgb[2] = blue;
		return rgb;
	}

	// Mineral-weighted quote of one cell, from an explicit per-mineral price
	// vector: the game passes its live market, the lab its reference quotes.
	function valueInto(mix, offset, prices) {
		let value = 0;
		for (let m = 0; m < count; m++) value += mix[offset + m] * prices[m];
		return value;
	}

	function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }

	// Base quotes from an explicit abundance vector: the abundance curve times
	// the material's average demand, normalised so the average cell is worth the
	// target at a neutral market. Demand is inside the normalisation on purpose:
	// a filler nobody wants then makes the ores a little dearer instead of
	// making the whole rock poorer. `report`, when given, gets the achieved mean
	// next to the nominal target: the floor and cap can pull the real mean away
	// from the target, and that is reported, not hidden.
	function basePricesInto(out, shares, settings, report) {
		const tuning = settings || economy;
		let weightSum = 0;
		for (let m = 0; m < count; m++) weightSum += table[m].demandMean * Math.pow(Math.max(shares[m], minimumShare), 1 - tuning.elasticity);
		const scale = tuning.targetCellValue / weightSum;
		let mean = 0;
		let clamped = 0;
		for (let m = 0; m < count; m++) {
			const share = Math.max(shares[m], minimumShare);
			const raw = scale * table[m].demandMean * Math.pow(share, -tuning.elasticity);
			const value = Math.max(tuning.floor, Math.min(tuning.cap, raw));
			if (value !== raw) clamped++;
			out[m] = value;
			mean += value * shares[m];
		}
		if (report) {
			report.target = tuning.targetCellValue;
			report.mean = mean;
			report.clamped = clamped;
		}
		return out;
	}

	// Price and strength display ramps, writing RGB into caller-owned storage.
	// The strength ramp is indexed by strength/maxStrength, clamped by the
	// caller so a damaged cell darkens on the same fixed scale. One warm ramp
	// covers the whole scale: distance from the ceiling is the whole story, so
	// weaker rock is simply darker.
	function priceColorInto(rgb, ratio) {
		const t = clamp01(ratio);
		rgb[0] = 48 + t * 190;
		rgb[1] = 72 + t * 150;
		rgb[2] = 91 - t * 45;
		return rgb;
	}

	function strengthColorInto(rgb, ratio) {
		const t = clamp01(ratio);
		rgb[0] = 75 + t * 130;
		rgb[1] = 45 + t * 125;
		rgb[2] = 38 + t * 82;
		return rgb;
	}

	// The same colour with its saturation removed: HSL lightness kept, hue
	// dropped. The remaining-strength view marks rubble this way, so a grey
	// cell is one that is weak enough to fall while a warm one still holds.
	function desaturateInto(rgb) {
		const light = (Math.max(rgb[0], rgb[1], rgb[2]) + Math.min(rgb[0], rgb[1], rgb[2])) * 0.5;
		rgb[0] = light;
		rgb[1] = light;
		rgb[2] = light;
		return rgb;
	}

	const api = {
		economy, minimumShare, maxStrength, debrisLimit,
		strengthInto, colorInto, valueInto, basePricesInto, clamp01,
		priceColorInto, strengthColorInto, desaturateInto
	};
	root.SteamRockMaterials = api;
	if (node) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
