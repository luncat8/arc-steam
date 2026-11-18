// Wild Mine rubble ("improve debris", 0.4.0 draft): fallen cells are a heightmap
// of soil layers like the chamber's rubble floor, but the cave is
// two-dimensional — a pile can rest on ANY upward-facing rock cell, a ledge as
// happily as the bottom of the section.
//
// One pile per (absolute column, supporting face). A segment remembers the row
// of the solid cell it stands on, the metres it rises above that face, and the
// material it holds (cells + value). The crest presented to physics and to the
// renderer is the chamber's binomial-smoothed heightmap, restricted to piles on
// the same face run so a shelf pile never leaks into the cavern floor beneath
// it. The stencil drops a foreign-face column instead of averaging it in, so a
// crest never claims material that is not there.
//
// Mining can take the supporting cell with a pile on it: a segment whose
// supporting cell is gone collapses to the next face below (or is lost through
// the bottom of the section), so rubble never floats on nothing. Mass and
// value are conserved by the move.
//
// Piles are loose soil, not rock: they are indestructible, they never feed the
// cave's fracture ledger, and the ball rests and bounces on their smoothed
// crest exactly like it would on the rock's own free face.
//
// Depends on: js/cave.js (the only surface query of record), js/ceiling.js
// (the one market, the DEBRIS compression setting and the grader's rules).
(function (root) {
	'use strict';
	const node = typeof module !== 'undefined' && module.exports;
	const ceilingRef = node ? require('./ceiling.js') : root.SteamCeiling;

	function ceilApi() { return ceilingRef || root.SteamCeiling; }
	// The live cave instance is owned by the wild mode; resolving it per call
	// keeps this module mode-agnostic (it is inert in Classic).
	function cave() {
		const mine = root.SteamWildMine;
		return mine && mine.cave ? mine.cave : null;
	}

	const cell = 0.125;
	// The same 1-3-3-1 stencil the chamber's rock free face and floor use.
	const stencil = [0.125, 0.375, 0.375, 0.125];
	// Same run: a 45° shelf rises exactly one cell per column, so one cell of
	// base tolerance keeps the smoothing on the slope and drops it at a ledge.
	const faceTolerance = cell;
	// Deep overlaps merge onto their face (max 4 piles per column) and the
	// section never tracks more than this many piles at once.
	const maxPerColumn = 4;
	const maxSegments = 2048;
	const heightEpsilon = 1e-6;

	// piles: Map<absoluteColumn, Segment[]>. A segment is
	//   { base, row, height, cells, value }
	// where base = (row + 1) * cell is the top face of the supporting solid
	// cell, in world metres.
	const piles = new Map();
	let depositedCells = 0;
	let depositedValue = 0;
	let lostCells = 0;
	let lostValue = 0;
	let collapseCount = 0;
	let pileCells = 0;
	let pileValue = 0;
	let segmentCount = 0;
	let bladeCells = 0;

	const blade = { value: 0, idle: 0 };
	const bladeSettleDelay = 0.25;
	// The chamber's grader rules, read live so one setting drives both modes.
	function graderCut() { const c = ceilApi(); return c && c.state ? c.state.graderCut : 0.03; }
	function graderSmooth() { const c = ceilApi(); return c && c.state ? c.state.graderSmooth : 0.4; }
	function graderSwath() { const c = ceilApi(); return c && c.state ? c.state.graderSwath : 1.5; }
	function floorCellHeight() {
		const c = ceilApi();
		return c && c.state ? c.state.floorCellHeight : cell / 4;
	}

	function columnAt(x) { return Math.floor(x / cell); }

	function findSegment(list, row) {
		for (let i = 0; i < list.length; i++) if (list[i].row === row) return list[i];
		return null;
	}
	function findRunSegment(list, base) {
		for (let i = 0; i < list.length; i++) if (Math.abs(list[i].base - base) <= faceTolerance) return list[i];
		return null;
	}
	function removeAt(list, index) {
		const last = list.length - 1;
		const seg = list[index];
		pileCells -= seg.cells;
		pileValue -= seg.value;
		list[index] = list[last];
		list.pop();
		segmentCount--;
		return seg;
	}
	// A segment whose supporting solid cell is gone drops to the next face
	// below, keeping the material; with no rock below, it is lost through the
	// bottom of the section.
	function collapseSegment(column, index) {
		const list = piles.get(column);
		if (!list) return;
		const seg = list[index];
		const caveRef = cave();
		if (!caveRef) return;
		const face = caveRef.floorBelow((column + 0.5) * cell, seg.base - 1e-6);
		removeAt(list, index);
		collapseCount++;
		if (!Number.isFinite(face)) {
			lostCells += seg.cells;
			lostValue += seg.value;
			if (!list.length) piles.delete(column);
			return;
		}
		const row = Math.round(face / cell - 1);
		let target = findSegment(list, row);
		if (!target) {
			target = { base: face, row, height: 0, cells: 0, value: 0 };
			list.push(target);
			segmentCount++;
		}
		const cap = caveRef.state.mapTop - face;
		let keptHeight = seg.height;
		let keptCells = seg.cells;
		let keptValue = seg.value;
		if (keptHeight > cap) {
			const kept = cap / keptHeight;
			lostCells += seg.cells * (1 - kept);
			lostValue += seg.value * (1 - kept);
			keptCells = seg.cells * kept;
			keptValue = seg.value * kept;
			keptHeight = cap;
		}
		if (target.height + keptHeight > cap) {
			const room = Math.max(0, cap - target.height);
			const kept = keptHeight > 0 ? room / keptHeight : 0;
			lostCells += keptCells * (1 - kept);
			lostValue += keptValue * (1 - kept);
			keptCells *= kept;
			keptValue *= kept;
			keptHeight = room;
		}
		target.height += keptHeight;
		target.cells += keptCells;
		target.value += keptValue;
		pileCells += keptCells;
		pileValue += keptValue;
		if (!list.length) piles.delete(column);
	}

	// Collapse every undermined segment in one column. Cheap: one solidity
	// probe per segment, and the column is 1-2 segments in practice.
	function verifyColumn(column) {
		const list = piles.get(column);
		if (!list || !list.length) return;
		const caveRef = cave();
		if (!caveRef) return;
		for (let i = list.length - 1; i >= 0; i--) {
			const seg = list[i];
			const x = (column + 0.5) * cell;
			const y = (seg.row + 0.5) * cell;
			if (!caveRef.solidAt(x, y)) collapseSegment(column, i);
		}
	}

	function deposit(x, refY, cells, value) {
		const caveRef = cave();
		if (!caveRef || !(cells > 0)) return { added: 0 };
		const column = columnAt(x);
		verifyColumn(column);
		const face = caveRef.floorBelow(x, refY);
		if (!Number.isFinite(face)) {
			lostCells += cells;
			lostValue += value || 0;
			return { added: 0 };
		}
		const row = Math.round(face / cell - 1);
		let list = piles.get(column);
		if (!list) {
			list = [];
			piles.set(column, list);
		}
		let seg = findSegment(list, row);
		if (!seg) {
			if (list.length >= maxPerColumn || segmentCount >= maxSegments) {
				lostCells += cells;
				lostValue += value || 0;
				return { added: 0 };
			}
			seg = { base: face, row, height: 0, cells: 0, value: 0 };
			list.push(seg);
			segmentCount++;
		}
		const tile = floorCellHeight();
		const cap = caveRef.state.mapTop - seg.base;
		let addedCells = cells;
		let keptValue = value || 0;
		let height = cells * tile;
		const room = Math.max(0, cap - seg.height);
		if (height > room) {
			const kept = height > 0 ? room / height : 0;
			lostCells += cells * (1 - kept);
			lostValue += keptValue * (1 - kept);
			addedCells = cells * kept;
			keptValue *= kept;
			height = room;
		}
		if (!(addedCells > 0)) return { added: 0 };
		seg.height += height;
		seg.cells += addedCells;
		seg.value += keptValue;
		pileCells += addedCells;
		pileValue += keptValue;
		depositedCells += addedCells;
		depositedValue += keptValue;
		return { added: addedCells, row };
	}

	// ---- the smoothed crest -------------------------------------------------

	// Smoothed height of the piles standing on the face run `face` at one cell
	// vertex. A column whose rubble sits only on another face is skipped
	// outright (its weight is dropped, never averaged in), which keeps the
	// crest at or below the material actually printed there; an empty column
	// tapers to nothing exactly like the chamber's floor edge.
	function vertexHeight(vertex, face) {
		let sum = 0;
		for (let i = 0; i < 4; i++) {
			const column = vertex - 2 + i;
			const weight = stencil[i];
			const list = piles.get(column);
			if (!list || !list.length) continue; // taper: nothing here, weight kept at 0
			const seg = findRunSegment(list, face);
			if (seg) sum += weight * seg.height;
			// foreign-face pile only: drop this column's weight entirely
		}
		return sum;
	}

	function heightOnFace(x, face) {
		const fx = x / cell;
		const v = Math.floor(fx);
		const fraction = fx - v;
		const h0 = vertexHeight(v, face);
		const h1 = vertexHeight(v + 1, face);
		return h0 + (h1 - h0) * fraction;
	}

	// The rubble surface relevant at a point: the face the cave query finds
	// below (x, y), the smoothed height standing on it, and the slope normal.
	// Callers that only need the height use `heightAt`; everything else uses
	// caller-owned scratch (surfaceScratch) or passes its own.
	const surfaceScratch = { face: NaN, crest: NaN, height: 0, nx: 0, ny: 1, hasPile: false, row: -1 };
	function surfaceAt(x, y, out) {
		const target = out || surfaceScratch;
		target.face = NaN;
		target.crest = NaN;
		target.height = 0;
		target.nx = 0;
		target.ny = 1;
		target.hasPile = false;
		target.row = -1;
		const caveRef = cave();
		if (!caveRef) return target;
		verifyColumn(columnAt(x));
		const face = caveRef.floorBelow(x, y);
		if (!Number.isFinite(face)) return target;
		const h = heightOnFace(x, face);
		target.face = face;
		target.row = Math.round(face / cell - 1);
		target.height = h;
		target.crest = face + h;
		target.hasPile = h > heightEpsilon;
		if (target.hasPile) {
			const e = cell * 0.75;
			const hl = heightOnFace(x - e, face);
			const hr = heightOnFace(x + e, face);
			const nx = hl - hr;
			const ny = 2 * e;
			const inv = 1 / Math.hypot(nx, ny);
			target.nx = nx * inv;
			target.ny = ny * inv;
		}
		return target;
	}

	function heightAt(x, y) {
		const caveRef = cave();
		if (!caveRef) return 0;
		verifyColumn(columnAt(x));
		const face = caveRef.floorBelow(x, y);
		if (!Number.isFinite(face)) return 0;
		return heightOnFace(x, face);
	}

	function crestAt(x, y) {
		const caveRef = cave();
		if (!caveRef) return NaN;
		verifyColumn(columnAt(x));
		const face = caveRef.floorBelow(x, y);
		if (!Number.isFinite(face)) return NaN;
		return face + heightOnFace(x, face);
	}

	// Earliest time along a ballistic arc at which a circle of `radius` reaches
	// a rubble crest, or false when none exists inside the frame (or there is
	// no rubble in the spanned columns at all). Heightfield walk: half-cell
	// samples, then a crossing bisection, mirroring cave.traceCircle.
	const traceScratch = { x: 0, y: 0, nx: 0, ny: 1, face: NaN, crest: NaN, time: Infinity };
	function traceCrest(x, y, vx, vy, duration, radius, gravity, out) {
		const target = out || traceScratch;
		target.time = Infinity;
		target.x = x;
		target.y = y;
		target.nx = 0;
		target.ny = 1;
		target.face = NaN;
		target.crest = NaN;
		if (!(duration > 0)) return target;
		const endX = x + vx * duration;
		const minCol = Math.floor(Math.min(x, endX) / cell) - 1;
		const maxCol = Math.floor(Math.max(x, endX) / cell) + 1;
		let any = false;
		for (let column = minCol; column <= maxCol; column++) if (piles.has(column)) { any = true; break; }
		if (!any) return target;
		const caveRef = cave();
		if (!caveRef) return target;
		const travel = Math.hypot(vx, vy) * duration + 0.5 * Math.abs(gravity) * duration * duration;
		const samples = Math.max(4, Math.min(64, Math.ceil(travel / (cell * 0.5)) + 1));
		const bottomAt = (t) => {
			const py = y + vy * t - 0.5 * gravity * t * t;
			return py - radius;
		};
		const crestAtT = (t) => {
			const px = x + vx * t;
			const py = y + vy * t - 0.5 * gravity * t * t;
			const face = caveRef.floorBelow(px, py);
			if (!Number.isFinite(face)) return NaN;
			const h = heightOnFace(px, face);
			return h > heightEpsilon ? face + h : NaN;
		};
		let previous = 0;
		let prevBottom = bottomAt(0);
		let prevCrest = crestAtT(0);
		for (let i = 1; i <= samples; i++) {
			const t = duration * i / samples;
			const px = x + vx * t;
			const py = y + vy * t - 0.5 * gravity * t * t;
			// The arc's centre is inside raw rock: the rock owns whatever
			// follows, and its own trace resolves the contact. floorBelow from
			// inside a solid row reports that row's top, which is above py.
			if (py < caveRef.floorBelow(px, py)) {
				previous = t;
				continue;
			}
			const bottom = py - radius;
			const crest = crestAtT(t);
			const prevInside = Number.isFinite(prevCrest) && prevBottom <= prevCrest;
			if (Number.isFinite(crest) && bottom <= crest && !prevInside) {
				// Crossing inside (previous, t]: bisect the root.
				let low = previous;
				let high = t;
				for (let step = 0; step < 12; step++) {
					const mid = (low + high) * 0.5;
					const midCrest = crestAtT(mid);
					if (Number.isFinite(midCrest) && bottomAt(mid) <= midCrest) high = mid;
					else low = mid;
				}
				const time = (low + high) * 0.5;
				const pxAt = x + vx * time;
				const pyAt = y + vy * time - 0.5 * gravity * time * time;
				target.time = time;
				target.x = pxAt;
				target.y = pyAt;
				surfaceAt(pxAt, pyAt, target);
				return target;
			}
			previous = t;
			prevBottom = bottom;
			prevCrest = crest;
		}
		return target;
	}

	// ---- DEBRIS compression -------------------------------------------------

	// The chamber's floorCompression setting re-lays the piles by the same
	// ratio: no cell is created or destroyed, and a pile that the new factor
	// would push through the top of the section keeps what fits, exactly like
	// the chamber's own roof rule.
	function rescale(ratio) {
		if (!(ratio > 0) || ratio === 1) return;
		const caveRef = cave();
		const limit = caveRef ? caveRef.state.mapTop : Infinity;
		pileCells = 0;
		pileValue = 0;
		for (const [column, list] of piles) {
			for (let i = list.length - 1; i >= 0; i--) {
				const seg = list[i];
				let height = seg.height * ratio;
				const cap = limit - seg.base;
				if (height > cap) {
					const kept = height > 0 ? cap / height : 0;
					lostCells += seg.cells * (1 - kept);
					lostValue += seg.value * (1 - kept);
					seg.cells *= kept;
					seg.value *= kept;
					height = cap;
				}
				seg.height = height;
				if (seg.height <= heightEpsilon) {
					lostCells += seg.cells;
					lostValue += seg.value;
					removeAt(list, i);
					continue;
				}
				pileCells += seg.cells;
				pileValue += seg.value;
			}
			if (!list.length) piles.delete(column);
		}
	}

	// ---- collection -----------------------------------------------------------

	// A harvest blade shaves a thin layer off the piles under a swath, priced at
	// each pile's own value density so the ground and the purse never disagree.
	// With `refY`, only the face the body actually rides is shaved — a pile on a
	// ledge above the blade keeps its material. Without it, every pile in the
	// swath is fair game (the classic flat-floor call).
	function harvest(x, halfWidth, cut, maxCells, out, refY) {
		out.value = 0;
		out.cells = 0;
		if (!(cut > 0) || !(maxCells > 0)) return out;
		const caveRef = cave();
		const first = columnAt(x - halfWidth);
		const last = columnAt(x + halfWidth);
		const tile = floorCellHeight();
		let cells = 0;
		let value = 0;
		const faceFor = (column) => {
			if (!Number.isFinite(refY) || !caveRef) return NaN;
			return caveRef.floorBelow((column + 0.5) * cell, refY);
		};
		for (let column = first; column <= last; column++) {
			verifyColumn(column);
			const list = piles.get(column);
			if (!list || !list.length) continue;
			const face = faceFor(column);
			for (let i = list.length - 1; i >= 0; i--) {
				const seg = list[i];
				if (Number.isFinite(face) && Math.abs(seg.base - face) > faceTolerance) continue;
				const height = seg.height;
				const amount = Math.min(height, cut);
				const density = height > 0 ? seg.value / height : 0;
				let take = amount / tile;
				if (cells + take > maxCells) {
					take = maxCells - cells;
					if (!(take > 0)) return finish(out, cells, value);
				}
				const amountTaken = take * tile;
				const taken = density * amountTaken;
				seg.height -= amountTaken;
				seg.cells -= take;
				seg.value = Math.max(0, seg.value - taken);
				pileCells -= take;
				pileValue -= taken;
				cells += take;
				value += taken;
				if (seg.height <= heightEpsilon || seg.cells <= 1e-12) {
					removeAt(list, i);
				}
				if (cells >= maxCells) return finish(out, cells, value);
			}
		}
		return finish(out, cells, value);
	}
	function finish(out, cells, value) {
		out.cells = cells;
		out.value = value;
		for (const [column, list] of piles) if (!list.length) piles.delete(column);
		return out;
	}

	// The rig's road grader works the ground the platform rides: it moves
	// height between neighbouring columns on the same face run (material
	// transport, never creation) and shaves the top of the swath into the
	// blade. The blade's share settles as one ledger entry when the stint ends,
	// exactly like the chamber's.
	const gradeScratch = [null, null, null, null];
	function grade(world, dt) {
		if (blade.value > 0) {
			blade.idle += dt;
			if (blade.idle >= bladeSettleDelay) settleBlade(world);
		}
		const platform = world && world.platform;
		if (!platform) return;
		const moving = Math.abs(platform.vx) > 0.02 || world.direction !== 0;
		if (!moving) return;
		const caveRef = cave();
		if (!caveRef) return;
		const refY = platform.y;
		const half = graderSwath() * 0.5;
		const left = platform.x - half;
		const right = platform.x + half;
		const first = columnAt(Math.min(left, right));
		const last = columnAt(Math.max(left, right));
		const ease = Math.min(1, graderSmooth() * dt);
		const segAt = (column) => {
			verifyColumn(column);
			const list = piles.get(column);
			if (!list || !list.length) return null;
			const face = caveRef.floorBelow((column + 0.5) * cell, refY);
			if (!Number.isFinite(face)) return null;
			return findRunSegment(list, face);
		};
		// Redistribution: flow height (and its value) toward the mean across the
		// same face run only. Boundary columns feed the working swath.
		let previous = segAt(first - 1);
		for (let column = first; column <= last + 1; column++) {
			const current = segAt(column);
			if (current && previous) {
				const difference = previous.height - current.height;
				if (difference && Math.abs(previous.base - current.base) <= faceTolerance) {
					const source = difference > 0 ? previous : current;
					const destination = difference > 0 ? current : previous;
					const amount = Math.abs(difference) * ease * 0.5;
					const density = source.height > 0 ? source.value / source.height : 0;
					const value = amount * density;
					source.height -= amount;
					destination.height += amount;
					source.value = Math.max(0, source.value - value);
					destination.value += value;
				}
			}
			previous = current;
		}
		// Cut: shave the working columns; the blade keeps the value it removes.
		const cut = graderCut() * dt;
		const tile = floorCellHeight();
		for (let column = first; column <= last; column++) {
			const seg = segAt(column);
			if (!seg || seg.height <= 0) continue;
			const amount = Math.min(seg.height, cut);
			const density = seg.height > 0 ? seg.value / seg.height : 0;
			const shaved = amount * density;
			const cellsOut = amount / tile;
			seg.height -= amount;
			seg.value = Math.max(0, seg.value - shaved);
			seg.cells = Math.max(0, seg.cells - cellsOut);
			pileCells -= cellsOut;
			pileValue -= shaved;
			blade.value += shaved;
			blade.idle = 0;
			bladeCells += cellsOut;
			if (seg.height <= heightEpsilon) removeSeg(column, seg);
		}
	}
	function removeSeg(column, seg) {
		const list = piles.get(column);
		if (!list) return;
		const index = list.indexOf(seg);
		if (index >= 0) removeAt(list, index);
		if (!list.length) piles.delete(column);
	}
	function settleBlade(world) {
		if (blade.value <= 0) {
			blade.idle = 0;
			return;
		}
		const value = blade.value;
		blade.value = 0;
		blade.idle = 0;
		const c = ceilApi();
		if (c && c.settleGraderBlade) c.settleGraderBlade(world ? world.time : 0, value, 'Road grader blade');
	}

	// ---- reset & introspection ------------------------------------------------

	function reset() {
		piles.clear();
		depositedCells = 0;
		depositedValue = 0;
		lostCells = 0;
		lostValue = 0;
		collapseCount = 0;
		pileCells = 0;
		pileValue = 0;
		segmentCount = 0;
		bladeCells = 0;
		blade.value = 0;
		blade.idle = 0;
	}

	// The renderer's window into the map: verify each column of the draw range,
	// then call fn(column, segments). Iteration order is ascending column.
	function eachColumn(minCol, maxCol, fn) {
		for (let column = minCol; column <= maxCol; column++) {
			verifyColumn(column);
			const list = piles.get(column);
			if (list && list.length) fn(column, list);
		}
	}

	// Material that fell out of the world (through the bottom of the section):
	// booked lost, exactly like a chamber grain that left the floor map.
	function bookLost(cells, value) {
		lostCells += cells || 0;
		lostValue += value || 0;
	}

	function state() {
		return {
			segments: segmentCount,
			cells: pileCells,
			value: pileValue,
			depositedCells, depositedValue,
			lostCells, lostValue,
			collapseCount,
			bladeCells,
			bladeValue: blade.value
		};
	}

	const api = {
		reset, rescale, deposit,
		surfaceAt, heightAt, crestAt, vertexHeight, heightOnFace,
		traceCrest, harvest, grade, settleBlade, eachColumn, bookLost, state,
		surfaceScratch, traceScratch,
		get bladeValue() { return blade.value; }
	};
	root.SteamWildRubble = api;
	if (node) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
