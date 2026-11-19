// The Wild Mine cave: a seeded 2D rock section with a signed distance field as
// its one surface, replacing the chamber's single heightmap per column.
//
// Three rules shape the file:
//   1. Generation is a pure function of (seed, absolute column, row). Any chunk
//      can be rebuilt identically, so streaming is cache management and never
//      state; only a mined chunk has to be kept.
//   2. Occupancy, strength and damage are separate arrays. Generated void,
//      mined void (`dug`) and standing rock are therefore distinguishable, and a
//      cave wall is just rock - it has no boundary immunity (see
//      gas-caves.1-plan.md).
//   3. The signed distance field is derived from occupancy alone: two exact
//      squared-Euclidean transforms, clamped to a one-metre band, refreshed in a
//      local rectangle after occupancy edits. Rock contact reads the field;
//      settled soil is a separate heightmap anchored to exposed floor faces.
//
// Depends on: js/minerals.js, js/geology-config.js, js/geology.js,
// js/rock-materials.js
(function (root) {
	'use strict';
	const node = typeof module !== 'undefined' && module.exports;
	const rockTable = node ? require('./minerals.js') : root.SteamMinerals;
	const geologyConfig = node ? require('./geology-config.js') : root.SteamGeologyConfig;
	const geology = node ? require('./geology.js') : root.SteamGeology;
	const materials = node ? require('./rock-materials.js') : root.SteamRockMaterials;

	const cell = 0.125;
	const rows = 512;
	const mapTop = rows * cell;
	const chunkColumns = 128;
	const chunkWidth = chunkColumns * cell;
	// One metre is wider than any body the cave holds (platform deck, ball,
	// cart), so every collision query has the distance it needs in the band.
	const bandCells = 8;
	const bandMeters = bandCells * cell;
	// One band of halo columns makes a chunk's own transform exact: the nearest
	// surface to any queried cell is inside the padded grid.
	const pad = bandCells;
	const stride = chunkColumns + pad * 2;
	const chunkCells = stride * rows;
	const FAR = 1e20;

	// Collision tuning, shared with the chamber's blow rule so damage numbers
	// stay comparable across the two modes (js/ceiling.js).
	const damageFalloffPower = 2.8;
	const hitLooseCap = 0.5;
	const loosedPerWeakened = 4;
	const weakRockSensitivity = 0.5;
	const maxRemoved = 512;
	const kernels = new Map();
	// 64 m: wider than any cave a platform crosses, and a hard bound on the
	// span walk.
	const spanLimitCells = 512;

	// Carving. `chamber` is a wide two-octave field; `vein` is the ridged field
	// that cuts the thin connecting tunnels. Flattening first makes the
	// threshold mean the same share of the section at every seed.
	const chamberFrequency = 0.02;
	const chamberFrequency2 = 0.054;
	const chamberThreshold = 0.72;
	const veinFrequency = 0.035;
	const veinThreshold = 0.9;
	const edgeRows = 2;
	// Start room: 25% of the classic 25.8 x 15 m view, over a wide flat shelf so
	// the 3.6 m platform has room on the first frame.
	const startHalfWidth = 3.2;
	const startHalfHeight = 1.9;
	const shelfHalfWidth = 4;
	const shelfDrop = 1.1;
	const shelfHeadroom = 2.4;

	const scratch = {
		line: new Float32Array(rows + 2),
		lineOut: new Float32Array(rows + 2),
		v: new Int32Array(rows + 2),
		z: new Float32Array(rows + 2),
		distSolid: new Float32Array(chunkCells),
		distVoid: new Float32Array(chunkCells),
		inverse: new Uint8Array(chunkCells),
		elements: new Float32Array(3),
		mix: new Float32Array(rockTable.mineralCount)
	};

	// Exact 1D squared distance transform (Felzenszwalb & Huttenlocher): the
	// lower envelope of parabolas, so a row of sources answers every cell at
	// once. Inputs are 0 at a source and FAR elsewhere.
	function distance1d(source, out, n, v, z) {
		let k = 0;
		v[0] = 0;
		z[0] = -Infinity;
		z[1] = Infinity;
		for (let q = 1; q < n; q++) {
			let s = ((source[q] + q * q) - (source[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
			while (s <= z[k]) {
				k--;
				s = ((source[q] + q * q) - (source[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
			}
			k++;
			v[k] = q;
			z[k] = s;
			z[k + 1] = Infinity;
		}
		k = 0;
		for (let q = 0; q < n; q++) {
			while (z[k + 1] < q) k++;
			const d = q - v[k];
			out[q] = d * d + source[v[k]];
		}
	}

	// Separable transform: rows first into `mid`, then columns into `out`.
	const mid = new Float32Array(chunkCells);
	function squaredDistance(sources, out) {
		const { line, lineOut, v, z } = scratch;
		for (let r = 0; r < rows; r++) {
			const base = r * stride;
			for (let c = 0; c < stride; c++) line[c] = sources[base + c] ? 0 : FAR;
			distance1d(line, lineOut, stride, v, z);
			for (let c = 0; c < stride; c++) mid[base + c] = lineOut[c];
		}
		for (let c = 0; c < stride; c++) {
			for (let r = 0; r < rows; r++) line[r] = mid[r * stride + c];
			distance1d(line, lineOut, rows, v, z);
			for (let r = 0; r < rows; r++) out[r * stride + c] = lineOut[r];
		}
	}

	// Radii come from equipment, not from the impact velocity. Build each radial
	// stencil once; a blow normalises its halo over just the rock it reaches.
	function kernelFor(radius) {
		let weights = kernels.get(radius);
		if (weights) return weights;
		const range = Math.ceil(radius);
		const side = 2 * range + 1;
		weights = new Float64Array(side * side);
		for (let dr = -range; dr <= range; dr++) for (let dc = -range; dc <= range; dc++) {
			const w = Math.max(0, 1 - Math.hypot(dc, dr) / radius);
			weights[(dr + range) * side + dc + range] = Math.pow(w, damageFalloffPower);
		}
		kernels.set(radius, weights);
		return weights;
	}

	function create(options) {
		const settings = options || {};
		const seed = settings.seed || 1;
		const spawnX = settings.spawnX === undefined ? 0 : settings.spawnX;
		const spawnY = settings.spawnY === undefined ? mapTop * 0.5 : settings.spawnY;
		const chunkLimit = settings.chunkLimit === undefined ? 12 : Math.max(3, settings.chunkLimit);
		const runGeology = geologyConfig.create(seed);
		const field = geology.createField(runGeology);
		const formation = geology.compile(runGeology.ranges, runGeology.mode, runGeology.specificity);
		const hostWeight = runGeology.hostWeight;

		const live = new Map();
		const stored = new Map();
		const removedColumns = new Int32Array(maxRemoved);
		const removedRows = new Int32Array(maxRemoved);
		let removedCount = 0;
		let primed = false;
		let generatedChunks = 0;
		// One-entry memo: a trace samples the field dozens of times inside one
		// chunk, so the map is not asked again for the same answer.
		let memoIndex = NaN;
		let memo;
		const spawnRow = rowAt(spawnY);
		const shelfRow = spawnRow - Math.round(shelfDrop / cell);

		function columnAt(x) { return Math.floor(x / cell); }
		function worldX(column) { return (column + 0.5) * cell; }
		function worldY(row) { return (row + 0.5) * cell; }

		// ---- generation -------------------------------------------------------

		// The start room is carved and then floored: a clean core, a noise-eroded
		// rim, and a flat shelf with headroom under it.
		function startRoom(column, row) {
			const x = worldX(column) - spawnX;
			const y = worldY(row) - spawnY;
			if (Math.abs(x) <= shelfHalfWidth) {
				if (row < shelfRow) return 1;
				if (row < shelfRow + Math.round(shelfHeadroom / cell)) return 0;
			}
			const ex = x / startHalfWidth;
			const ey = y / startHalfHeight;
			const radius = ex * ex + ey * ey;
			if (radius >= 1) return -1;
			if (radius < 0.7) return 0;
			const erosion = (geology.sampleNoise(seed + 7, column * 0.11, row * 0.11, 3) - 0.5) * 0.4;
			return radius + erosion < 1 ? 0 : -1;
		}

		// 1 solid, 0 void, -1 undecided.
		function carveAt(column, row) {
			if (row < edgeRows || row >= rows - edgeRows) return 1;
			const room = startRoom(column, row);
			if (room >= 0) return room;
			const chamber = 0.5 * geology.sampleNoise(seed, column * chamberFrequency, row * chamberFrequency, 0)
				+ 0.5 * geology.sampleNoise(seed, column * chamberFrequency2 + 31.7, row * chamberFrequency2 + 11.3, 1);
			if (geology.flatten(chamber) > chamberThreshold) return 0;
			const veinNoise = geology.sampleNoise(seed + 13, column * veinFrequency, row * veinFrequency * 2.2, 2);
			if (1 - Math.abs(2 * veinNoise - 1) > veinThreshold) return 0;
			return 1;
		}

		function elementsAt(column, row, out) {
			const target = out || scratch.elements;
			geology.fillElements(field, column, row, target, 0);
			return target;
		}

		function mixAt(column, row, out, elementsOut) {
			const target = out || scratch.mix;
			const elements = elementsAt(column, row, elementsOut);
			geology.fillMix(formation, elements, 0, hostWeight, target, 0);
			return target;
		}

		function createChunk(index) {
			return {
				index,
				column0: index * chunkColumns,
				editStamp: 0,
				solid: new Uint8Array(chunkCells),
				dug: new Uint8Array(chunkCells),
				damage: new Float32Array(chunkCells),
				sampled: new Uint8Array(chunkCells),
				strength: new Float32Array(chunkCells),
				sdf: new Float32Array(chunkCells)
			};
		}

		function existingChunk(index) {
			return live.get(index) || stored.get(index) || null;
		}

		function copyColumns(source, srcStart, target, dstStart, count) {
			for (let row = 0; row < rows; row++) {
				const srcBase = row * stride + srcStart;
				const dstBase = row * stride + dstStart;
				for (let i = 0; i < count; i++) {
					target.solid[dstBase + i] = source.solid[srcBase + i];
					target.dug[dstBase + i] = source.dug[srcBase + i];
					target.damage[dstBase + i] = source.damage[srcBase + i];
					target.sampled[dstBase + i] = source.sampled[srcBase + i];
					target.strength[dstBase + i] = source.strength[srcBase + i];
				}
			}
		}

		function syncHaloFromNeighbors(chunk) {
			const left = existingChunk(chunk.index - 1);
			if (left && left.edited) copyColumns(left, chunkColumns, chunk, 0, pad);
			const right = existingChunk(chunk.index + 1);
			if (right && right.edited) copyColumns(right, pad, chunk, chunkColumns + pad, pad);
		}

		function fillChunk(chunk) {
			const solid = chunk.solid;
			const column0 = chunk.column0 - pad;
			for (let row = 0; row < rows; row++) {
				const base = row * stride;
				for (let c = 0; c < stride; c++) if (carveAt(column0 + c, row)) solid[base + c] = 1;
			}
			syncHaloFromNeighbors(chunk);
			buildSdf(chunk);
		}

		// Strength is sampled from the shared geological field, exactly as the
		// chamber samples it: one material table, one strength rule. It is read
		// lazily on the first blow: generation only needs occupancy, and the
		// sampler is far too slow to run over every solid cell of a fresh chunk.
		function startStrength(column, row) {
			return materials.strengthInto(mixAt(column, row), 0);
		}

		function ensureStrength(chunk, index, column, row) {
			if (chunk.sampled[index]) return chunk.strength[index];
			chunk.sampled[index] = 1;
			chunk.strength[index] = startStrength(column, row);
			return chunk.strength[index];
		}

		// Distances are between cell centres, so half a cell is taken off on the
		// way out: the zero level then lies on the cell boundary a body collides
		// with, not half a cell inside the rock.
		function signDistance(solidHere, cells) {
			const metres = Math.max(0, Math.min(bandCells, cells) * cell - cell * 0.5);
			return solidHere ? -metres : metres;
		}

		function buildSdf(chunk) {
			const solid = chunk.solid;
			const inverse = scratch.inverse;
			for (let i = 0; i < chunkCells; i++) inverse[i] = solid[i] ? 0 : 1;
			squaredDistance(solid, scratch.distSolid);
			squaredDistance(inverse, scratch.distVoid);
			const sdf = chunk.sdf;
			const distSolid = scratch.distSolid;
			const distVoid = scratch.distVoid;
			for (let i = 0; i < chunkCells; i++) {
				sdf[i] = signDistance(solid[i], Math.sqrt(solid[i] ? distVoid[i] : distSolid[i]));
			}
		}

		// ---- chunks and streaming ---------------------------------------------

		function chunkIndexAt(column) { return Math.floor(column / chunkColumns); }

		function restoreStored(index) {
			const kept = stored.get(index);
			if (!kept) return null;
			stored.delete(index);
			live.set(index, kept);
			memoIndex = index;
			memo = kept;
			return kept;
		}

		function chunkFor(column) {
			const index = chunkIndexAt(column);
			if (index === memoIndex) return memo;
			const cached = live.get(index);
			if (cached) {
				memoIndex = index;
				memo = cached;
				return cached;
			}
			const kept = restoreStored(index);
			if (kept) {
				trim(index, index);
				return kept;
			}
			const chunk = createChunk(index);
			fillChunk(chunk);
			generatedChunks++;
			live.set(index, chunk);
			memoIndex = index;
			memo = chunk;
			trim(index, index);
			return chunk;
		}

		function evict(keepMin, keepMax) {
			const drop = [];
			for (const [index, chunk] of live) {
				if (index >= keepMin && index <= keepMax) continue;
				if (chunk.edited) stored.set(index, chunk);
				drop.push(index);
			}
			for (let i = 0; i < drop.length; i++) live.delete(drop[i]);
			if (drop.length) memoIndex = NaN;
		}

		// Keep the window's chunks live, then drop everything else. The first
		// call fills the whole window; later calls restore edited chunks for free
		// and add at most `maxNew` fresh chunks so a fast camera opens rock a
		// frame ahead instead of stalling.
		function stream(minX, maxX, maxNew) {
			const first = chunkIndexAt(columnAt(minX)) - 1;
			const last = chunkIndexAt(columnAt(maxX)) + 1;
			let budget = primed ? (maxNew === undefined ? 1 : maxNew) : Infinity;
			primed = true;
			for (let index = first; index <= last; index++) {
				if (live.has(index)) continue;
				if (stored.has(index)) {
					restoreStored(index);
					continue;
				}
				if (budget <= 0) continue;
				budget--;
				chunkFor(index * chunkColumns);
			}
			evict(first, last);
			trim(first, last);
			return live.size;
		}

		// A hard cap on live chunks, preferring entries outside the active window
		// first, so a caller that never streams cannot grow the cache without
		// bound.
		function trim(keepMin, keepMax) {
			if (live.size <= chunkLimit) return;
			const hasKeep = keepMin !== undefined && keepMax !== undefined;
			if (hasKeep) {
				for (const [index, chunk] of live) {
					if (live.size <= chunkLimit) return;
					if (index >= keepMin && index <= keepMax) continue;
					if (chunk.edited) stored.set(index, chunk);
					live.delete(index);
					memoIndex = NaN;
				}
			}
			for (const [index, chunk] of live) {
				if (live.size <= chunkLimit) break;
				if (hasKeep && index === keepMin && live.size > 1) continue;
				if (chunk.edited) stored.set(index, chunk);
				live.delete(index);
				memoIndex = NaN;
			}
		}

		function eachChunk() { return live.values(); }

		// ---- cell queries -----------------------------------------------------

		function solidCell(column, row) {
			if (row < 0 || row >= rows) return true;
			const chunk = chunkFor(column);
			return chunk.solid[row * stride + column - chunk.column0 + pad] === 1;
		}

		// Follow a top face across flat rock or one stair. Both the rock below
		// the step and the air above must join: a nearby hanging shelf is not
		// the next sample of this heightmap. The relation is symmetric.
		function adjacentFloor(column, row, direction) {
			const next = column + direction;
			if (solidCell(next, row)) {
				if (!solidCell(next, row + 1)) return row;
				if (!solidCell(next, row + 2) && !solidCell(column, row + 2)) return row + 1;
			} else if (row > 0 && solidCell(next, row - 1) && solidCell(column, row - 1) && !solidCell(next, row + 1)) {
				return row - 1;
			}
			return -1;
		}

		function sdfCell(column, row) {
			if (row < 0 || row >= rows) return -bandMeters;
			const chunk = chunkFor(column);
			return chunk.sdf[row * stride + column - chunk.column0 + pad];
		}

		function solidAt(x, y) {
			return solidCell(columnAt(x), rowAt(y));
		}

		// Bilinear over cell centres: the surface the collision reads is the
		// smooth field, not the stair-stepped occupancy it was derived from.
		function sdfAt(x, y) {
			const fx = x / cell - 0.5;
			const fy = y / cell - 0.5;
			const c0 = Math.floor(fx);
			const r0 = Math.floor(fy);
			const tx = fx - c0;
			const ty = fy - r0;
			const d00 = sdfCell(c0, r0);
			const d10 = sdfCell(c0 + 1, r0);
			const d01 = sdfCell(c0, r0 + 1);
			const d11 = sdfCell(c0 + 1, r0 + 1);
			const top = d00 + (d10 - d00) * tx;
			const bottom = d01 + (d11 - d01) * tx;
			return top + (bottom - top) * ty;
		}

		const gradient = { nx: 0, ny: 0 };
		function normalAt(x, y, out) {
			const target = out || gradient;
			const h = cell * 0.75;
			target.nx = sdfAt(x + h, y) - sdfAt(x - h, y);
			target.ny = sdfAt(x, y + h) - sdfAt(x, y - h);
			const length = Math.hypot(target.nx, target.ny);
			if (length <= 1e-9) {
				target.nx = 0;
				target.ny = 1;
				return target;
			}
			target.nx /= length;
			target.ny /= length;
			return target;
		}

		// Earliest contact of a circle swept along a ballistic arc. The field is
		// sampled at half-cell steps, then the crossing is bisected: a cave wall,
		// an overhang and a ledge all answer through the same query.
		function traceCircle(x, y, vx, vy, duration, radius, gravity, out) {
			const contact = out || traceScratch;
			contact.time = Infinity;
			contact.x = x;
			contact.y = y;
			contact.nx = 0;
			contact.ny = 1;
			if (!(duration > 0)) return contact;
			const start = sdfAt(x, y);
			let armed = start > radius;
			if (start <= radius) {
				normalAt(x, y, contact);
				const separating = vx * contact.nx + vy * contact.ny > 0;
				if (start < radius - 1e-4 || !separating) {
					contact.time = 0;
					if (start < radius) {
						const push = radius - start;
						contact.x = x + contact.nx * push;
						contact.y = y + contact.ny * push;
					}
					return contact;
				}
			}
			const travel = Math.hypot(vx, vy) * duration + 0.5 * Math.abs(gravity) * duration * duration;
			const samples = Math.max(4, Math.min(64, Math.ceil(travel / (cell * 0.5)) + 1));
			let previous = 0;
			let prevDistance = start;
			for (let i = 1; i <= samples; i++) {
				const t = duration * i / samples;
				const distance = sdfAt(x + vx * t, y + vy * t - 0.5 * gravity * t * t);
				if (distance > radius) {
					armed = true;
					previous = t;
					prevDistance = distance;
					continue;
				}
				if (!armed && distance >= prevDistance - 1e-7) {
					previous = t;
					prevDistance = distance;
					continue;
				}
				let low = previous;
				let high = t;
				for (let step = 0; step < 12; step++) {
					const mid = (low + high) * 0.5;
					if (sdfAt(x + vx * mid, y + vy * mid - 0.5 * gravity * mid * mid) > radius) low = mid;
					else high = mid;
				}
				const time = previous > 0 || start > radius ? low : high;
				contact.time = time;
				contact.x = x + vx * time;
				contact.y = y + vy * time - 0.5 * gravity * time * time;
				normalAt(contact.x, contact.y, contact);
				return contact;
			}
			return contact;
		}
		const traceScratch = { time: Infinity, x: 0, y: 0, nx: 0, ny: 1 };

		// The top of the first solid below a point, in world metres, or NaN when
		// the section has no rock below it. A whole column lives in one chunk, so
		// the scan crosses no cache boundary.
		function floorBelow(x, y) {
			const column = columnAt(x);
			const chunk = chunkFor(column);
			const offset = column - chunk.column0 + pad;
			const startRow = Math.min(rows - 1, Math.max(-1, rowAt(y)));
			for (let row = startRow; row >= 0; row--) {
				if (chunk.solid[row * stride + offset]) return (row + 1) * cell;
			}
			return NaN;
		}

		function roofAbove(x, y) {
			const column = columnAt(x);
			const chunk = chunkFor(column);
			const offset = column - chunk.column0 + pad;
			for (let row = Math.max(0, rowAt(y)); row < rows; row++) {
				if (chunk.solid[row * stride + offset]) return row * cell;
			}
			return NaN;
		}

		// The open width through a point: the span a platform may stand in, and
		// the width a water column may flow through. The walk is capped because a
		// cave has no side walls: a row can stay open past any distance a caller
		// would act on, and an unbounded scan would be one bad seed away from
		// never returning.
		function spanAt(x, y) {
			const row = rowAt(y);
			if (row < 0 || row >= rows) return 0;
			const column = columnAt(x);
			if (solidCell(column, row)) return 0;
			const limit = spanLimitCells;
			let left = column;
			let right = column;
			while (!solidCell(left - 1, row)) {
				left--;
				if (column - left >= limit) break;
			}
			while (!solidCell(right + 1, row)) {
				right++;
				if (right - column >= limit) break;
			}
			return (right - left + 1) * cell;
		}

		// ---- edits ------------------------------------------------------------

		function sdfRect(chunk, columnMin, columnMax, rowMin, rowMax) {
			const first = Math.max(0, columnMin + pad);
			const last = Math.min(stride - 1, columnMax + pad);
			const low = Math.max(0, rowMin);
			const high = Math.min(rows - 1, rowMax);
			for (let row = low; row <= high; row++) for (let local = first; local <= last; local++) {
				const column = chunk.column0 - pad + local;
				const solidHere = chunk.solid[row * stride + local] === 1;
				chunk.sdf[row * stride + local] = signDistance(solidHere, nearestBoundary(column, row, solidHere));
			}
		}

		function solidCellNoAlloc(column, row) {
			if (row < 0 || row >= rows) return true;
			const chunk = existingChunk(chunkIndexAt(column));
			if (chunk) return chunk.solid[row * stride + column - chunk.column0 + pad] === 1;
			return carveAt(column, row) === 1;
		}

		// Distance in cells to the nearest cell of the other type, by Euclidean
		// search out to the band. Beyond the band the answer is the band, which is
		// exactly what the chunk-wide transform stores there; squaring the
		// threshold prunes every cell that can no longer improve the answer.
		function nearestBoundary(column, row, solidHere) {
			let best = bandCells * bandCells;
			for (let dr = -bandCells; dr <= bandCells; dr++) {
				const r = row + dr;
				const outside = r < 0 || r >= rows;
				if (outside) {
					if (!solidHere) best = Math.min(best, dr * dr);
					continue;
				}
				for (let dc = -bandCells; dc <= bandCells; dc++) {
					const distance = dr * dr + dc * dc;
					if (distance >= best) continue;
					if (solidCellNoAlloc(column + dc, r) === solidHere) continue;
					best = distance;
				}
			}
			return Math.sqrt(best);
		}

		// Refresh the field around an edit in every existing chunk (live or
		// stored) it touches, so a change on a seam is seen from both sides
		// without spawning unvisited chunks.
		function refreshAround(minColumn, maxColumn, minRow, maxRow) {
			const low = minColumn - bandCells;
			const high = maxColumn + bandCells;
			const firstChunk = chunkIndexAt(low);
			const lastChunk = chunkIndexAt(high);
			for (let index = firstChunk; index <= lastChunk; index++) {
				const chunk = existingChunk(index);
				if (chunk) sdfRect(chunk, low - chunk.column0, high - chunk.column0, minRow - bandCells, maxRow + bandCells);
			}
		}

		function syncNeighborHalos(chunk, column, row, mined) {
			const local = column - chunk.column0;
			if (local < pad) {
				const left = existingChunk(chunk.index - 1);
				if (left) {
					const target = row * stride + chunkColumns + pad + local;
					left.solid[target] = 0;
					left.sampled[target] = 1;
					left.strength[target] = 0;
					left.damage[target] = 0;
					if (mined) left.dug[target] = 1;
					left.edited = true;
					left.editStamp++;
				}
			}
			if (local >= chunkColumns - pad) {
				const right = existingChunk(chunk.index + 1);
				if (right) {
					const target = row * stride + local - chunkColumns + pad;
					right.solid[target] = 0;
					right.sampled[target] = 1;
					right.strength[target] = 0;
					right.damage[target] = 0;
					if (mined) right.dug[target] = 1;
					right.edited = true;
					right.editStamp++;
				}
			}
		}

		function openCell(chunk, column, row, mined) {
			const index = row * stride + column - chunk.column0 + pad;
			chunk.solid[index] = 0;
			chunk.sampled[index] = 1;
			chunk.strength[index] = 0;
			chunk.damage[index] = 0;
			if (mined) chunk.dug[index] = 1;
			chunk.edited = true;
			chunk.editStamp++;
			syncNeighborHalos(chunk, column, row, mined);
		}

		function hasFreeFace(column, row) {
			if (row <= 0 || row >= rows - 1) return false;
			return !solidCellNoAlloc(column - 1, row)
				|| !solidCellNoAlloc(column + 1, row)
				|| !solidCellNoAlloc(column, row - 1)
				|| !solidCellNoAlloc(column, row + 1);
		}

		function loose(chunk, i) {
			return chunk.strength[i] < materials.debrisLimit && chunk.damage[i] >= materials.collapseLooseFloor;
		}

		function chipCell(column, row, share) {
			const chunk = chunkFor(column);
			const i = row * stride + column - chunk.column0 + pad;
			if (!chunk.solid[i]) return 0;
			const before = ensureStrength(chunk, i, column, row);
			let amount = 0;
			// Shattered interior rock holds its residual strength until exposed;
			// hitting it again neither heals it nor spends the same work twice.
			if (!loose(chunk, i)) {
				amount = Math.min(share, before * hitLooseCap);
				const susceptibility = 1 + weakRockSensitivity * (materials.maxStrength / before - 1);
				chunk.damage[i] = Math.min(1, chunk.damage[i] + amount / before * loosedPerWeakened * susceptibility);
				chunk.strength[i] = before - amount;
				chunk.edited = true;
				chunk.editStamp++;
			}
			if (loose(chunk, i) && removedCount < maxRemoved && hasFreeFace(column, row)) {
				removedColumns[removedCount] = column;
				removedRows[removedCount++] = row;
			}
			return amount;
		}

		// Open the snapshot together: this blow cannot tunnel through its own
		// fresh hole. Only occupancy edits dirty the field or dislodge soil.
		function releaseFaces() {
			let left = removedColumns[0], right = left, low = removedRows[0], high = low;
			for (let i = 0; i < removedCount; i++) {
				const c = removedColumns[i], r = removedRows[i];
				openCell(chunkFor(c), c, r, true);
				left = Math.min(left, c); right = Math.max(right, c);
				low = Math.min(low, r); high = Math.max(high, r);
			}
			refreshAround(left, right, low, high);
			if (settings.onOpen) for (let i = 0; i < removedCount; i++) settings.onOpen(removedColumns[i], removedRows[i], true);
		}

		// `energy` is the incoming fracture budget in joules, BEFORE the owner's
		// gain. A direct hit works the contact cell first (up to half the budget);
		// the remainder is distributed by falloff. A soil-cushioned hit has no
		// concentrated component. A wider radius spreads work, never creates it.
		function weaken(x, y, energy, gain, radius, diffuse = false) {
			removedCount = 0;
			if (!(energy > 0 && gain > 0 && radius > 0)) return 0;
			const col = columnAt(x), row = rowAt(y);
			const range = Math.ceil(radius), side = 2 * range + 1;
			const weights = kernelFor(radius);
			const bottom = Math.max(1, row - range), top = Math.min(rows - 2, diffuse ? row : row + range);
			const focus = !diffuse && row >= bottom && row <= top && solidCell(col, row);
			let weight = 0;
			for (let r = bottom; r <= top; r++) {
				const base = (r - row + range) * side + range;
				for (let dc = -range; dc <= range; dc++) {
					if (focus && r === row && dc === 0) continue;
					const w = weights[base + dc];
					if (w && solidCell(col + dc, r)) weight += w;
				}
			}
			const work = energy * gain;
			const direct = focus ? Math.min(work * (weight ? 0.5 : 1), strengthAt(col, row) * hitLooseCap) : 0;
			const perWeight = weight > 0 ? (work - direct) / weight : 0;
			let spent = 0;
			for (let r = bottom; r <= top; r++) {
				const base = (r - row + range) * side + range;
				for (let dc = -range; dc <= range; dc++) {
					const share = focus && !dc && r === row ? direct : perWeight * weights[base + dc];
					if (share > 0) spent += chipCell(col + dc, r, share);
				}
			}
			if (removedCount) releaseFaces();
			return Math.min(energy, spent / gain);
		}

		// Spend up to `strengthBudget` J in candidate order for the tunnel bore,
		// keeping the section's border band intact and refreshing the SDF once.
		function boreCells(cols, rws, count, strengthBudget, out) {
			removedCount = 0;
			out.weakened = 0;
			out.opened = 0;
			if (!(strengthBudget > 0) || !(count > 0)) return out;
			let remaining = strengthBudget;
			for (let k = 0; k < count && remaining > 1e-12; k++) {
				const col = cols[k], r = rws[k];
				if (r < edgeRows || r >= rows - edgeRows) continue;
				const chunk = chunkFor(col);
				const i = r * stride + col - chunk.column0 + pad;
				if (!chunk.solid[i]) continue;
				const before = ensureStrength(chunk, i, col, r);
				if (remaining + 1e-12 >= before) {
					if (removedCount >= maxRemoved) break;
					out.weakened += before;
					remaining -= before;
					removedColumns[removedCount] = col;
					removedRows[removedCount++] = r;
					continue;
				}
				const susceptibility = 1 + weakRockSensitivity * (materials.maxStrength / before - 1);
				chunk.damage[i] = Math.min(1, chunk.damage[i] + remaining / before * loosedPerWeakened * susceptibility);
				chunk.strength[i] = before - remaining;
				chunk.edited = true;
				chunk.editStamp++;
				out.weakened += remaining;
				remaining = 0;
			}
			if (!removedCount) return out;
			let left = removedColumns[0], right = left, low = removedRows[0], high = low;
			for (let i = 0; i < removedCount; i++) {
				const c = removedColumns[i], r = removedRows[i];
				openCell(chunkFor(c), c, r, true);
				if (c < left) left = c;
				if (c > right) right = c;
				if (r < low) low = r;
				if (r > high) high = r;
			}
			refreshAround(left, right, low, high);
			out.opened = removedCount;
			if (settings.onOpen) for (let i = 0; i < removedCount; i++) settings.onOpen(removedColumns[i], removedRows[i], false);
			return out;
		}

		// Remove one cell outright: the cart's shelf cut, a test's prepared
		// tunnel, a blast that leaves nothing to hold. Section border rows stay
		// solid so surface queries never fall out of the section.
		function dig(column, row) {
			if (row <= 0 || row >= rows - 1) return false;
			const chunk = chunkFor(column);
			const index = row * stride + column - chunk.column0 + pad;
			if (!chunk.solid[index]) return false;
			openCell(chunk, column, row, true);
			refreshAround(column, column, row, row);
			if (settings.onOpen) settings.onOpen(column, row, false);
			return true;
		}

		function damageAt(column, row) {
			if (row < 0 || row >= rows) return 0;
			const chunk = chunkFor(column);
			return chunk.damage[row * stride + column - chunk.column0 + pad];
		}

		function strengthAt(column, row) {
			if (row < 0 || row >= rows) return 0;
			const chunk = chunkFor(column);
			const index = row * stride + column - chunk.column0 + pad;
			if (!chunk.solid[index]) return 0;
			return ensureStrength(chunk, index, column, row);
		}

		const state = Object.freeze({
			cell, rows, mapTop, chunkColumns, chunkWidth, pad, stride, bandMeters, bandCells,
			spawnX, spawnY, spawnRow, shelfRow,
			get liveChunks() { return live.size; },
			get storedChunks() { return stored.size; },
			get generatedChunks() { return generatedChunks; },
			get removedCount() { return removedCount; },
			get removedColumn() { return removedColumns; },
			get removedRow() { return removedRows; }
		});

		const api = {
			state,
			columnAt, rowAt, worldX, worldY,
			stream, chunkFor, eachChunk,
			solidAt, solidCell, sdfAt, normalAt, traceCircle, floorBelow, adjacentFloor, roofAbove, spanAt,
			weaken, boreCells, dig, damageAt, strengthAt, elementsAt, mixAt,
			carveAt,
			get removedCount() { return removedCount; },
			get removedColumn() { return removedColumns; },
			get removedRow() { return removedRows; }
		};
		return api;
	}

	function rowAt(y) { return Math.floor(y / cell); }

	const api = { create, cell, rows, mapTop, chunkColumns, chunkWidth, bandCells, bandMeters };
	root.SteamCave = api;
	if (node) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
