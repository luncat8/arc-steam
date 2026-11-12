// One geology configuration: the field settings, the affinity mode and the
// editable signature ranges that js/geology.js compiles into a formation.
// Every consumer (the game, the lab, the probes) takes its own snapshot from
// here, so a parameter change reaches all of them through one implementation
// and nobody mutates the defaults or another consumer's copy.
//
// Rarity targets are calibration goals, not formation inputs: they are
// exported as metadata beside the snapshot and never applied to geology.
// Depends on: js/minerals.js
// Provides: defaults, limits, modes, channelKeys, rangesOf, create, capture,
// resetInto, exportOf, validateExport, applyInto
(function (root) {
	'use strict';
	const node = typeof module !== 'undefined' && module.exports;
	const minerals = node ? require('./minerals.js') : root.SteamMinerals;

	const table = minerals.mineralTable;
	const count = minerals.mineralCount;
	const channelCount = 3;

	// The calibration the lab settled on; the game opens every run with it.
	const defaults = Object.freeze({
		frequency: 0.075,
		yCompression: 3,
		mode: 'balanced',
		specificity: 0.6,
		hostWeight: 0.08
	});

	// The editors' bounds. One table feeds the HTML ranges and validates an
	// imported snapshot, so a control and an import cannot disagree.
	const limits = Object.freeze({
		frequency: Object.freeze({ min: 0.01, max: 0.3 }),
		yCompression: Object.freeze({ min: 1, max: 6 }),
		specificity: Object.freeze({ min: 0, max: 1.5 }),
		hostWeight: Object.freeze({ min: 0, max: 2 })
	});
	const modes = Object.freeze(['balanced', 'product']);
	const channelKeys = Object.freeze(['r', 'g', 'b']);
	const format = 'steam-geology';
	const version = 1;

	// Editable copy of a table's ranges: ranges[mineral][channel] = [low, high].
	function rangesOf(source) {
		const ranges = new Array(source.length);
		for (let m = 0; m < source.length; m++) {
			const entry = source[m];
			ranges[m] = [[entry.r[0], entry.r[1]], [entry.g[0], entry.g[1]], [entry.b[0], entry.b[1]]];
		}
		return ranges;
	}

	// A fresh, caller-owned configuration. `seed` is not a formation input - it
	// only travels with the snapshot so an export names the run it came from.
	function create(seed) {
		return {
			seed: seed || 1,
			frequency: defaults.frequency,
			yCompression: defaults.yCompression,
			mode: defaults.mode,
			specificity: defaults.specificity,
			hostWeight: defaults.hostWeight,
			ranges: rangesOf(table)
		};
	}

	// An independent copy: the lab edits one, the game captures another.
	function capture(config) {
		const copy = create(config.seed);
		settingsInto(copy, config);
		rangesInto(copy, config.ranges);
		return copy;
	}

	// Restore the shipped defaults in place (the lab's reset).
	function resetInto(config) {
		config.frequency = defaults.frequency;
		config.yCompression = defaults.yCompression;
		config.mode = defaults.mode;
		config.specificity = defaults.specificity;
		config.hostWeight = defaults.hostWeight;
		rangesInto(config, table);
		return config;
	}

	function settingsInto(target, source) {
		target.seed = source.seed;
		target.frequency = source.frequency;
		target.yCompression = source.yCompression;
		target.mode = source.mode;
		target.specificity = source.specificity;
		target.hostWeight = source.hostWeight;
	}

	function rangesInto(target, source) {
		const ranges = target.ranges;
		for (let m = 0; m < count; m++) {
			for (let c = 0; c < channelCount; c++) {
				const range = source[m][c];
				ranges[m][c][0] = range[0];
				ranges[m][c][1] = range[1];
			}
		}
	}

	// The complete snapshot plus the desired shares as separate calibration
	// metadata, keyed by stable mineral id so a row reorder cannot misapply it.
	function exportOf(config, targets) {
		const ranges = {};
		const desired = {};
		for (let m = 0; m < count; m++) {
			const entry = table[m];
			ranges[entry.id] = config.ranges[m].map(range => [range[0], range[1]]);
			if (targets) desired[entry.id] = targets[m];
		}
		const exported = {
			format, version,
			seed: config.seed,
			settings: {
				frequency: config.frequency,
				yCompression: config.yCompression,
				mode: config.mode,
				specificity: config.specificity,
				hostWeight: config.hostWeight
			},
			ranges
		};
		if (targets) exported.calibration = { desiredShares: desired };
		return exported;
	}

	// Every reason a snapshot cannot be applied, as short readable strings. The
	// caller decides whether to show them or throw; nothing is mutated here.
	function validateExport(exported, problems) {
		const found = problems || [];
		if (!exported || typeof exported !== 'object') {
			found.push('snapshot is not an object');
			return found;
		}
		if (exported.format !== format) found.push('format must be ' + format);
		if (exported.version !== version) found.push('version must be ' + version);
		validateSettings(exported.settings, found);
		validateRanges(exported.ranges, found);
		return found;
	}

	function validateSettings(settings, found) {
		if (!settings || typeof settings !== 'object') {
			found.push('settings are missing');
			return;
		}
		for (const key of ['frequency', 'yCompression', 'specificity', 'hostWeight']) {
			const value = settings[key];
			const limit = limits[key];
			if (!Number.isFinite(value)) { found.push(key + ' must be a finite number'); continue; }
			if (value < limit.min || value > limit.max) found.push(key + ' must be inside ' + limit.min + '..' + limit.max);
		}
		if (modes.indexOf(settings.mode) < 0) found.push('mode must be one of ' + modes.join(', '));
	}

	function validateRanges(ranges, found) {
		if (!ranges || typeof ranges !== 'object') {
			found.push('ranges are missing');
			return;
		}
		for (let m = 0; m < count; m++) {
			const id = table[m].id;
			const entry = ranges[id];
			if (!Array.isArray(entry) || entry.length !== channelCount) {
				found.push('ranges for ' + id + ' must hold one range per channel');
				continue;
			}
			for (let c = 0; c < channelCount; c++) {
				const range = entry[c];
				if (!Array.isArray(range) || range.length !== 2) { found.push(id + '.' + channelKeys[c] + ' must be a [low, high] pair'); continue; }
				if (!Number.isFinite(range[0]) || !Number.isFinite(range[1])) { found.push(id + '.' + channelKeys[c] + ' must be finite'); continue; }
				if (range[0] < 0 || range[1] > 1) found.push(id + '.' + channelKeys[c] + ' must be inside 0..1');
				if (!(range[0] < range[1])) found.push(id + '.' + channelKeys[c] + ' needs low < high');
			}
		}
	}

	// Apply a validated snapshot in place. Throws with every problem at once and
	// leaves the configuration untouched when anything is wrong, so an import
	// never half-lands. Calibration metadata is deliberately not applied.
	function applyInto(config, exported) {
		const problems = validateExport(exported);
		if (problems.length) throw new Error('geology snapshot rejected: ' + problems.join('; '));
		config.frequency = exported.settings.frequency;
		config.yCompression = exported.settings.yCompression;
		config.mode = exported.settings.mode;
		config.specificity = exported.settings.specificity;
		config.hostWeight = exported.settings.hostWeight;
		if (Number.isFinite(exported.seed)) config.seed = exported.seed;
		for (let m = 0; m < count; m++) {
			const entry = exported.ranges[table[m].id];
			for (let c = 0; c < channelCount; c++) {
				config.ranges[m][c][0] = entry[c][0];
				config.ranges[m][c][1] = entry[c][1];
			}
		}
		return config;
	}

	const api = {
		defaults, limits, modes, channelKeys, format, version,
		rangesOf, create, capture, resetInto, settingsInto, rangesInto,
		exportOf, validateExport, applyInto
	};
	root.SteamGeologyConfig = api;
	if (node) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
