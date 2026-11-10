// The rock's geology: three independent element fields and the mineral mix a
// cell's composition turns into. Shared by the page (js/ceiling.js), the
// calibration lab (prototypes/mineral-lab.html) and the probes, so the numbers
// measured outside the game are the numbers the game produces.
// Provides: sampleNoise, flatten, createField, membership, featherFor,
// rangesOf, compile, buildSample, buildCache, statsAt, solveHostWeight,
// autoAdjust.
// Depends on: js/minerals.js, js/element-cdf.js
(function (root) {
	'use strict';
	const node = typeof module !== 'undefined' && module.exports;
	const minerals = node ? require('./minerals.js') : root.SteamMinerals;
	const cdfTable = node ? require('./element-cdf.js') : root.SteamElementCdf;

	const mineralTable = minerals.mineralTable;
	const mineralCount = minerals.mineralCount;
	const hostIndex = minerals.hostIndex;
	const channelCount = 3;

	// Raw value noise: bilinear interpolation between hashed lattice points.
	// The seed only shifts the hash lattice, so every channel of every run has
	// the same value distribution - see js/element-cdf.js.
	function sampleNoise(seed, x, y, channel) {
		const ix = Math.floor(x);
		const iy = Math.floor(y);
		const fx = smoothstep(x - ix);
		const fy = smoothstep(y - iy);
		const a = hash(seed, ix, iy, channel) + (hash(seed, ix + 1, iy, channel) - hash(seed, ix, iy, channel)) * fx;
		const b = hash(seed, ix, iy + 1, channel) + (hash(seed, ix + 1, iy + 1, channel) - hash(seed, ix, iy + 1, channel)) * fx;
		return a + (b - a) * fy;
	}

	function hash(seed, x, y, channel) {
		let value = Math.imul(x + seed * 101 + channel * 7919, 374761393) ^ Math.imul(y + 17, 668265263);
		value = Math.imul(value ^ value >>> 13, 1274126177);
		return ((value ^ value >>> 16) >>> 0) / 4294967295;
	}

	function smoothstep(t) { return t * t * (3 - 2 * t); }

	// Raw value noise piles up around 0.5 (sd 0.215): without this remap a band
	// near 0 or 1 covers a small fraction of what its width promises, which
	// makes width-based rarity unpredictable and puts every extreme ore out of
	// reach. The remap is monotone, so the field stays smooth and the seams
	// keep their shape; it only evens out the histogram.
	function flatten(value) {
		const last = cdfTable.length - 1;
		const f = value * last;
		const i = f | 0;
		if (i >= last) return 1;
		const t = f - i;
		return cdfTable[i] + (cdfTable[i + 1] - cdfTable[i]) * t;
	}

	// One run's geology. `frequency` is cycles per cell, `yCompression` is the
	// geological flattening: a deposit spans yCompression times fewer rows than
	// columns, so veins read as stratified seams. Channels differ by a modest
	// frequency scale and an offset; all three carry the same flattening.
	const defaultFrequency = 0.075;
	const defaultYCompression = 3;
	const channelScale = [1, 0.82, 1.18];
	const channelOffsetX = [0, 7.3, 19.1];
	const channelOffsetY = [0, 5.1, 11.9];

	function createField(options) {
		const field = {
			seed: (options && options.seed) || 1,
			frequency: options && options.frequency ? options.frequency : defaultFrequency,
			yCompression: options && options.yCompression ? options.yCompression : defaultYCompression,
			values: new Float32Array(channelCount)
		};
		field.elements = function (column, row, out) {
			const x = column * field.frequency;
			const y = row * field.frequency * field.yCompression;
			for (let c = 0; c < channelCount; c++) {
				const s = channelScale[c];
				out[c] = flatten(sampleNoise(field.seed, x * s + channelOffsetX[c], y * s + channelOffsetY[c], c));
			}
		};
		field.raw = function (column, row, channel) {
			const s = channelScale[channel];
			return sampleNoise(field.seed, column * field.frequency * s + channelOffsetX[channel],
				row * field.frequency * field.yCompression * s + channelOffsetY[channel], channel);
		};
		return field;
	}

	// A constrained channel is a necessary condition, never a preference: 1
	// inside the range, falling to 0 across a feather outside it. The feather
	// keeps a narrow band narrow (it is capped by the width) while giving a
	// broad band a soft edge instead of a cliff.
	function featherFor(width) { return Math.min(0.08, width * 0.35); }

	function membership(value, low, high, feather) {
		if (value >= low && value <= high) return 1;
		const gap = value < low ? low - value : value - high;
		if (feather <= 0 || gap >= feather) return 0;
		return 1 - smoothstep(gap / feather);
	}

	function isUnconstrained(range) { return range[0] <= 0 && range[1] >= 1; }

	// Editable copy of a table's ranges: ranges[mineral][channel] = [low, high].
	function rangesOf(table) {
		const ranges = new Array(table.length);
		for (let m = 0; m < table.length; m++) {
			const entry = table[m];
			ranges[m] = [[entry.r[0], entry.r[1]], [entry.g[0], entry.g[1]], [entry.b[0], entry.b[1]]];
		}
		return ranges;
	}

	// Affinity modes. `product` multiplies the channel memberships; `balanced`
	// takes their geometric mean over the constrained channels only. The
	// geometric mean keeps every condition necessary - one zero membership is
	// still zero - but stops a three-condition ore from being eight times
	// weaker than a one-condition ore that is equally well matched, which is
	// what pushes most of the rock into the host matrix.
	const lutBins = 1024;
	const modes = { product: 0, balanced: 1 };

	// A narrower signature is more specific: where two signatures both match a
	// cell, `specificity` lets the narrower one dominate instead of splitting
	// the cell evenly with a broad ore whose box happens to contain it. It
	// never invents abundance - a narrow box still covers few cells - it only
	// decides who wins inside an overlap.
	function specificityOf(ranges, mineral) {
		let width = 0;
		let conditions = 0;
		for (let c = 0; c < channelCount; c++) {
			if (isUnconstrained(ranges[mineral][c])) continue;
			width += ranges[mineral][c][1] - ranges[mineral][c][0];
			conditions++;
		}
		return conditions === 0 ? 0 : 1 - width / conditions;
	}

	function compile(ranges, mode, specificity) {
		const constrained = new Uint8Array(ranges.length * channelCount);
		const lut = new Float32Array(ranges.length * channelCount * lutBins);
		const gain = new Float64Array(ranges.length);
		for (let m = 0; m < ranges.length; m++) {
			gain[m] = 1 + (specificity || 0) * specificityOf(ranges, m);
			for (let c = 0; c < channelCount; c++) {
				const range = ranges[m][c];
				if (isUnconstrained(range)) continue;
				constrained[m * channelCount + c] = 1;
				const feather = featherFor(range[1] - range[0]);
				const base = (m * channelCount + c) * lutBins;
				for (let i = 0; i < lutBins; i++) lut[base + i] = membership(i / (lutBins - 1), range[0], range[1], feather);
			}
		}
		const balanced = mode === 'balanced';
		const mixScratch = new Float64Array(ranges.length);

		function lutAt(base, value) {
			const f = value * (lutBins - 1);
			const i = f | 0;
			if (i >= lutBins - 1) return lut[base + lutBins - 1];
			const t = f - i;
			return lut[base + i] + (lut[base + i + 1] - lut[base + i]) * t;
		}

		// Ore affinities into `out`; the host slot stays 0 and is filled by
		// `mixInto` with the constant host weight.
		function affinityInto(values, out, offset) {
			for (let m = 0; m < ranges.length; m++) {
				if (m === hostIndex) { out[offset + m] = 0; continue; }
				let product = 1;
				let conditions = 0;
				let failed = false;
				for (let c = 0; c < channelCount; c++) {
					if (!constrained[m * channelCount + c]) continue;
					conditions++;
					const weight = lutAt((m * channelCount + c) * lutBins, values[c]);
					if (weight <= 0) { failed = true; break; }
					product *= weight;
				}
				out[offset + m] = conditions === 0 ? 1 : failed ? 0 : gain[m] * (balanced ? Math.pow(product, 1 / conditions) : product);
			}
		}

		// The mineral mix of one cell: host weight plus every ore affinity,
		// normalised. No ore affinity at all leaves pure host rock instead of
		// handing the cell to whichever rare box happens to be nearest.
		function mixInto(values, hostWeight, out, offset) {
			affinityInto(values, out, offset);
			let total = hostWeight;
			for (let m = 0; m < ranges.length; m++) if (m !== hostIndex) total += out[offset + m];
			const scale = total > 0 ? 1 / total : 0;
			out[offset + hostIndex] = hostWeight * scale;
			for (let m = 0; m < ranges.length; m++) if (m !== hostIndex) out[offset + m] *= scale;
			return out;
		}

		function mix(values, hostWeight) {
			mixInto(values, hostWeight, mixScratch, 0);
			return mixScratch;
		}

		return { ranges, mode, gain, constrained, lut, affinityInto, mixInto, mix, membershipAt(mineral, channel, value) {
			if (!constrained[mineral * channelCount + channel]) return 1;
			return lutAt((mineral * channelCount + channel) * lutBins, value);
		} };
	}

	// A fixed block of geology to measure: the element values of every sampled
	// cell, built once so range changes only cost the mix pass.
	function buildSample(options) {
		const seeds = options.seeds;
		const columns = options.columns;
		const rows = options.rows;
		const cells = seeds.length * columns * rows;
		const elements = new Float32Array(cells * channelCount);
		const field = createField(options);
		let at = 0;
		for (let s = 0; s < seeds.length; s++) {
			field.seed = seeds[s];
			for (let row = 0; row < rows; row++) {
				for (let column = 0; column < columns; column++) {
					field.elements(column, row, field.values);
					elements[at] = field.values[0];
					elements[at + 1] = field.values[1];
					elements[at + 2] = field.values[2];
					at += channelCount;
				}
			}
		}
		return { elements, cells, columns, rows, seeds: seeds.slice() };
	}

	// Per-cell ore affinities of a sample. The host weight is left out on
	// purpose: shares are then a cheap analytic function of it, which is what
	// lets the calibration solve for a target host share.
	function buildCache(sample, formation) {
		const cells = sample.cells;
		const affinities = new Float32Array(cells * mineralCount);
		const totals = new Float32Array(cells);
		const values = new Float64Array(channelCount);
		const row = new Float64Array(mineralCount);
		for (let i = 0; i < cells; i++) {
			const at = i * channelCount;
			values[0] = sample.elements[at];
			values[1] = sample.elements[at + 1];
			values[2] = sample.elements[at + 2];
			formation.affinityInto(values, row, 0);
			let total = 0;
			const base = i * mineralCount;
			for (let m = 0; m < mineralCount; m++) {
				const value = row[m];
				affinities[base + m] = value;
				total += value;
			}
			totals[i] = total;
		}
		return { affinities, totals, cells };
	}

	function emptyStats() {
		return {
			shares: new Float64Array(mineralCount),
			dominant: new Float64Array(mineralCount),
			visible: new Float64Array(mineralCount),
			hostPure: 0,
			orePure: 0,
			hostWeight: 0
		};
	}

	// Mean mineral fractions at a given host weight, plus how often a mineral
	// dominates a cell or is plainly present in it. `visible` counts cells that
	// hold at least a quarter of that mineral: the share a player can see.
	function statsAt(cache, hostWeight, out) {
		const shares = out.shares;
		const dominant = out.dominant;
		const visible = out.visible;
		shares.fill(0);
		dominant.fill(0);
		visible.fill(0);
		let hostPure = 0;
		let orePure = 0;
		const cells = cache.cells;
		for (let i = 0; i < cells; i++) {
			const base = i * mineralCount;
			const total = cache.totals[i] + hostWeight;
			const scale = total > 0 ? 1 / total : 0;
			const host = hostWeight * scale;
			let best = host;
			let bestMineral = hostIndex;
			for (let m = 0; m < mineralCount; m++) {
				const fraction = m === hostIndex ? host : cache.affinities[base + m] * scale;
				shares[m] += fraction;
				if (fraction >= 0.25) visible[m]++;
				if (m !== hostIndex && fraction > best) { best = fraction; bestMineral = m; }
			}
			dominant[bestMineral]++;
			if (host > 0.9) hostPure++;
			else if (best > 0.9) orePure++;
		}
		const inv = cells > 0 ? 1 / cells : 0;
		for (let m = 0; m < mineralCount; m++) {
			shares[m] *= inv;
			dominant[m] *= inv;
			visible[m] *= inv;
		}
		out.hostPure = hostPure * inv;
		out.orePure = orePure * inv;
		out.hostWeight = hostWeight;
		return out;
	}

	function meanHostShare(cache, hostWeight) {
		let sum = 0;
		for (let i = 0; i < cache.cells; i++) {
			const total = cache.totals[i] + hostWeight;
			sum += total > 0 ? hostWeight / total : 1;
		}
		return cache.cells > 0 ? sum / cache.cells : 1;
	}

	// The host weight is the one global knob that decides how much of the rock
	// is ordinary matrix, so it is solved from a target share rather than
	// guessed: mean host share decreases monotonically with the weight.
	function solveHostWeight(cache, targetHostShare) {
		let low = 1e-4;
		let high = 64;
		for (let step = 0; step < 40; step++) {
			const middle = Math.sqrt(low * high);
			if (meanHostShare(cache, middle) > targetHostShare) high = middle;
			else low = middle;
		}
		return Math.sqrt(low * high);
	}

	// Widen or narrow a constrained channel of a mineral around its centre,
	// so the signature keeps its identity while its abundance changes.
	function scaleRange(range, factor) {
		const width = Math.min(1, Math.max(0.01, (range[1] - range[0]) * factor));
		const centre = (range[0] + range[1]) * 0.5;
		let low = centre - width * 0.5;
		let high = low + width;
		if (low < 0) { low = 0; high = width; }
		if (high > 1) { high = 1; low = 1 - width; }
		range[0] = low;
		range[1] = high;
	}

	// Is mineral `inner` completely inside `outer`'s box? Then every cell the
	// narrow signature claims is also claimed by the broad one and the narrow
	// mineral can never dominate a cell, however well it matches.
	function contains(outer, inner) {
		for (let c = 0; c < channelCount; c++) {
			const o = outer[c];
			const i = inner[c];
			if (i[0] < o[0] - 1e-9 || i[1] > o[1] + 1e-9) return false;
		}
		return true;
	}

	// Where a range would sit if it were moved (keeping its width) far enough
	// past `outer`'s edge to clear it by `escape`. The walls of the unit
	// interval are hard: a range already pinned against 1 cannot stick out past
	// it, which is reported as a zero gain so another channel is tried.
	function escapeShift(range, outer, escape, toHigh) {
		const width = range[1] - range[0];
		const edge = toHigh ? outer[1] + escape : outer[0] - escape;
		let low = toHigh ? edge - width : edge;
		let high = low + width;
		if (low < 0) { low = 0; high = width; }
		if (high > 1) { high = 1; low = 1 - width; }
		const gain = toHigh ? high - outer[1] : outer[0] - low;
		if (gain < escape * 0.5) return 0;
		return Math.abs(low - range[0]);
	}

	// Give every swallowed signature an edge of its own: nudge it out of the
	// box that contains it, by the smallest move that leaves it sticking out,
	// so it keeps a region where it matches alone. Pure geometry, no sampling,
	// so it is cheap enough to run between measurement passes.
	function separate(ranges, escape) {
		const moved = [];
		for (let inner = 0; inner < ranges.length; inner++) {
			if (inner === hostIndex || mineralTable[inner].id === 'gas') continue;
			for (let outer = 0; outer < ranges.length; outer++) {
				if (outer === hostIndex || outer === inner) continue;
				if (!contains(ranges[outer], ranges[inner])) continue;
				let best = Infinity;
				let bestChannel = -1;
				let bestLow = 0;
				let bestHigh = 0;
				for (let c = 0; c < channelCount; c++) {
					const o = ranges[outer][c];
					const i = ranges[inner][c];
					const width = i[1] - i[0];
					const high = escapeShift(i, o, escape, true);
					const low = escapeShift(i, o, escape, false);
					if (high > 0 && high < best) { best = high; bestChannel = c; bestLow = o[1] + escape - width; bestHigh = o[1] + escape; }
					if (low > 0 && low < best) { best = low; bestChannel = c; bestLow = o[0] - escape; bestHigh = o[0] - escape + width; }
				}
				if (bestChannel < 0) continue;
				ranges[inner][bestChannel][0] = Math.max(0, Math.min(1, bestLow));
				ranges[inner][bestChannel][1] = Math.max(0, Math.min(1, bestHigh));
				moved.push(inner);
			}
		}
		return moved;
	}

	// Calibration: nudge every mineral's ranges until the measured shares sit
	// near their rarity targets, and solve the host weight for the target host
	// share. Widths move by a damped power of the share error because a mineral
	// with three conditions loses abundance roughly with the cube of its width;
	// the spread pass in between keeps a broad ore from swallowing a narrow one.
	// Gas is fixed in both passes to preserve its low-metal, low-crystal identity.
	function autoAdjust(options) {
		const sample = options.sample;
		const ranges = options.ranges;
		const targets = options.targets;
		const mode = options.mode || 'balanced';
		const specificity = options.specificity || 0;
		const spread = options.spread !== false;
		const iterations = options.iterations || 30;
		const gain = options.gain || 0.3;
		const tolerance = options.tolerance || 0.03;
		const maxWidth = options.maxWidth || 1;
		// A floor on the host weight keeps a little matrix in every ore cell, so
		// a full match is mostly one mineral rather than a laboratory pure one.
		const minHostWeight = options.minHostWeight === undefined ? 0.06 : options.minHostWeight;
		const history = [];
		const stats = emptyStats();
		let hostWeight = options.hostWeight || 0.08;
		let formation = compile(ranges, mode, specificity);
		let cache = buildCache(sample, formation);

		for (let pass = 0; pass < iterations; pass++) {
			hostWeight = Math.max(minHostWeight, solveHostWeight(cache, targets[hostIndex]));
			statsAt(cache, hostWeight, stats);
			let worst = 0;
			for (let m = 0; m < mineralCount; m++) {
				if (m === hostIndex) continue;
				const error = Math.abs(stats.shares[m] - targets[m]) / targets[m];
				if (error > worst) worst = error;
			}
			history.push({ pass, hostWeight, worst, shares: Float64Array.from(stats.shares) });
			if (worst <= tolerance) break;
			for (let m = 0; m < mineralCount; m++) {
				if (m === hostIndex || mineralTable[m].id === 'gas') continue;
				const ratio = targets[m] / Math.max(stats.shares[m], 1e-6);
				const factor = Math.min(1.25, Math.max(0.8, Math.pow(ratio, gain)));
				for (let c = 0; c < channelCount; c++) {
					const range = ranges[m][c];
					if (isUnconstrained(range)) continue;
					if (range[1] - range[0] >= maxWidth && factor > 1) continue;
					scaleRange(range, factor);
				}
			}
			if (spread) separate(ranges, 0.06);
			formation = compile(ranges, mode, specificity);
			cache = buildCache(sample, formation);
		}
		hostWeight = Math.max(minHostWeight, solveHostWeight(cache, targets[hostIndex]));
		statsAt(cache, hostWeight, stats);
		formation = compile(ranges, mode, specificity);
		return { ranges, hostWeight, stats, history, formation, cache };
	}

	const api = {
		mineralTable, mineralCount, hostIndex, channelCount, modes, lutBins,
		defaultFrequency, defaultYCompression, channelScale,
		sampleNoise, flatten, createField, membership, featherFor, isUnconstrained,
		rangesOf, compile, specificityOf, contains, separate, buildSample, buildCache,
		emptyStats, statsAt, meanHostShare, solveHostWeight, scaleRange, autoAdjust
	};
	root.SteamGeology = api;
	if (node) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
