// Loose soil on the exposed top faces of the cave. Only (column, support row,
// cells, value) are material. The chamber's 1-3-3-1 crest is derived from those
// bins, including its shoulders in empty columns. It follows connected steps,
// never mixing separate galleries.
(function (root) {
	'use strict';
	const node = typeof module !== 'undefined' && module.exports;
	const ceiling = node ? require('./ceiling.js') : root.SteamCeiling;
	const piles = new Map();
	const profiles = new Map();
	let cave = null;
	let cell = 0;
	let depositedCells = 0, depositedValue = 0, lostCells = 0, lostValue = 0;
	let collapseCount = 0, bladeCells = 0, bladeValueTotal = 0;
	let gradeMode = 'platform';
	const gradeRows = new Int32Array(64);
	const blade = { value: 0, idle: 0 };
	const bladeSettleDelay = 0.25;
	// Diffusion across many 12.5 cm bins must work within a driving pass.
	const gradeRate = 12;

	class Bin {
		constructor(row) {
			this.row = row;
			this.base = (row + 1) * cell;
			this.cells = 0;
			this.value = 0;
		}
		get height() { return this.cells * ceiling.state.floorCellHeight; }
	}

	function binAt(column, row) {
		const list = piles.get(column);
		if (list) for (let i = 0; i < list.length; i++) if (list[i].row === row) return list[i];
		return null;
	}

	function nearMaterial(column) {
		for (let c = column - 2; c <= column + 2; c++) if (piles.has(c)) return true;
		return false;
	}

	// Cache only the footprint of the stencil. Reads (including tracing and
	// drawing) never settle or otherwise change the material.
	function invalidate(center) {
		const occupied = piles.has(center);
		for (let c = center - 2; c <= center + 2; c++) {
			const profile = profiles.get(c);
			if (profile && !occupied && !nearMaterial(c)) profiles.delete(c);
			else if (profile) profile.dirty = true;
			else if (occupied) profiles.set(c, { dirty: true, count: 0, strips: [] });
		}
	}

	function roomAbove(column, base) {
		const roof = cave.roofAbove(cave.worldX(column), base);
		return (Number.isFinite(roof) ? roof : cave.state.mapTop) - base;
	}

	function add(column, row, cells, value) {
		let bin = binAt(column, row);
		if (!bin) {
			bin = new Bin(row);
			let list = piles.get(column);
			if (!list) piles.set(column, list = []);
			list.push(bin);
		}
		bin.cells += cells;
		bin.value += value;
		invalidate(column);
	}

	function take(column, bin, cells) {
		const value = cells === bin.cells ? bin.value : bin.value * (cells / bin.cells);
		bin.cells -= cells;
		bin.value -= value;
		if (bin.cells === 0) {
			const list = piles.get(column);
			list[list.indexOf(bin)] = list[list.length - 1];
			list.pop();
			if (!list.length) piles.delete(column);
		}
		invalidate(column);
		return value;
	}

	function bookLost(cells, value) {
		lostCells += cells;
		lostValue += value;
	}

	function settle(column, face, cells, value) {
		if (!Number.isFinite(face)) {
			bookLost(cells, value);
			return 0;
		}
		const row = cave.rowAt(face) - 1;
		const bin = binAt(column, row);
		const capacity = roomAbove(column, face) / ceiling.state.floorCellHeight;
		const kept = Math.min(cells, Math.max(0, capacity - (bin ? bin.cells : 0)));
		const keptValue = value * (kept / cells);
		if (kept > 0) add(column, row, kept, keptValue);
		if (kept < cells) bookLost(cells - kept, value - keptValue);
		return kept;
	}

	function deposit(x, refY, cells, value = 0) {
		if (!cave || !(cells > 0)) return 0;
		depositedCells += cells;
		depositedValue += value;
		const face = cave.floorBelow(x, refY);
		return settle(cave.columnAt(x), face <= refY ? face : NaN, cells, value);
	}

	// Called after occupancy edits, even for a direct dig with no fragment.
	// A removed roof can also uncover a shoulder in a neighbouring column.
	function rockOpened(column, row) {
		invalidate(column);
		const bin = binAt(column, row);
		if (!bin) return;
		const cells = bin.cells;
		const value = take(column, bin, cells);
		const face = cave.floorBelow(cave.worldX(column), cave.worldY(row));
		settle(column, face, cells, value);
		collapseCount++;
	}

	function rescale() {
		const tile = ceiling.state.floorCellHeight;
		for (const [column, list] of piles) {
			for (let i = list.length - 1; i >= 0; i--) {
				const bin = list[i];
				const excess = bin.cells - roomAbove(column, bin.base) / tile;
				if (excess > 0) bookLost(excess, take(column, bin, excess));
			}
			invalidate(column);
		}
	}

	function height(column, row) {
		const bin = binAt(column, row);
		return bin ? bin.height : 0;
	}

	// A stair joins two soil beds only when the lower bin fills to the lip.
	// Below that it is a real edge: even a thin layer on a one-cell pedestal
	// stays on its top rather than being averaged into the gallery below.
	function nextOnBed(column, row, direction) {
		const next = cave.connectedFloor(column, row, direction);
		if (next < 0 || next === row) return next;
		const lowerHeight = next > row ? height(column, row) : height(column + direction, next);
		return lowerHeight + 1e-10 >= Math.abs(next - row) * cell ? next : -1;
	}

	function level(column, row) { return (row + 1) * cell + height(column, row); }

	function roofAt(column, row) {
		const base = (row + 1) * cell;
		return base + roomAbove(column, base);
	}

	function buildStrip(column, row, profile) {
		const base = (row + 1) * cell, h = level(column, row);
		const left = nextOnBed(column, row, -1), right = nextOnBed(column, row, 1);
		const farLeft = left < 0 ? -1 : nextOnBed(column - 1, left, -1);
		const farRight = right < 0 ? -1 : nextOnBed(column + 1, right, 1);
		// Smooth absolute top elevations. Clamp the stencil at the end of the
		// run and clip each shared vertex to the lower overhang on its sides.
		const l = left < 0 ? h : level(column - 1, left), ll = farLeft < 0 ? l : level(column - 2, farLeft);
		const r = right < 0 ? h : level(column + 1, right), rr = farRight < 0 ? r : level(column + 2, farRight);
		const roof = roofAt(column, row);
		const leftRoof = left < 0 ? roof : Math.min(roof, roofAt(column - 1, left));
		const rightRoof = right < 0 ? roof : Math.min(roof, roofAt(column + 1, right));
		const leftBase = left < 0 ? base : Math.max(base, (left + 1) * cell);
		const rightBase = right < 0 ? base : Math.max(base, (right + 1) * cell);
		const y0 = Math.max(leftBase, Math.min(leftRoof, (ll + 3 * l + 3 * h + r) / 8));
		const y1 = Math.max(rightBase, Math.min(rightRoof, (l + 3 * h + 3 * r + rr) / 8));
		if (y0 <= base && y1 <= base) return;
		let strip = profile.strips[profile.count];
		if (!strip) profile.strips.push(strip = {});
		profile.count++;
		strip.row = row;
		strip.base = base;
		strip.left = y0;
		strip.right = y1;
	}

	function profileAt(column) {
		const profile = profiles.get(column);
		if (!profile || !profile.dirty) return profile;
		profile.dirty = false;
		profile.count = 0;
		for (let c = column - 2; c <= column + 2; c++) {
			const list = piles.get(c);
			if (!list) continue;
			for (let i = 0; i < list.length; i++) {
				let row = list[i].row;
				const step = c < column ? 1 : -1;
				for (let from = c; from !== column && row >= 0; from += step) row = nextOnBed(from, row, step);
				if (row >= 0 && !stripOn(profile, row)) buildStrip(column, row, profile);
			}
		}
		return profile;
	}

	function stripOn(profile, row) {
		if (profile) for (let i = 0; i < profile.count; i++) if (profile.strips[i].row === row) return profile.strips[i];
		return null;
	}

	function eachStrip(first, last, visit) {
		if (!profiles.size) return;
		for (let c = first; c <= last; c++) {
			const profile = profileAt(c);
			if (!profile) continue;
			for (let i = 0; i < profile.count; i++) visit(c, profile.strips[i]);
		}
	}

	function crestOn(strip, fraction) { return strip.left + (strip.right - strip.left) * fraction; }

	const surfaceScratch = { face: NaN, crest: NaN, height: 0, nx: 0, ny: 1, hasPile: false, row: -1 };
	function surfaceAt(x, y, out = surfaceScratch) {
		const face = cave ? cave.floorBelow(x, y) : NaN;
		const row = Number.isFinite(face) ? cave.rowAt(face) - 1 : -1;
		const column = Math.floor(x / cell);
		const strip = face <= y && stripOn(profileAt(column), row);
		out.face = face;
		out.row = row;
		out.crest = strip ? crestOn(strip, x / cell - column) : face;
		out.height = strip ? out.crest - face : 0;
		out.hasPile = out.height > 0;
		const rise = out.hasPile ? (strip.right - strip.left) / cell : 0;
		out.ny = rise ? 1 / Math.hypot(1, rise) : 1;
		out.nx = rise ? -rise * out.ny : 0;
		return out;
	}

	function crestAt(x, y) { return surfaceAt(x, y).crest; }
	function heightAt(x, y) { return surfaceAt(x, y).height; }

	function clearance(x, y, radius) {
		if (!profiles.has(Math.floor(x / cell))) return Infinity;
		const s = surfaceAt(x, y);
		return s.hasPile ? y - radius - s.crest : Infinity;
	}

	const traceScratch = { time: Infinity, x: 0, y: 0, nx: 0, ny: 1 };
	function traceCrest(x, y, vx, vy, duration, radius, gravity, out = traceScratch) {
		out.time = Infinity;
		if (!profiles.size || !(duration > 0)) return out;
		const end = Math.floor((x + vx * duration) / cell);
		const start = Math.floor(x / cell);
		let c = Math.min(start, end);
		const last = Math.max(start, end);
		while (c <= last && !profiles.has(c)) c++;
		if (c > last) return out;
		const gap = clearance(x, y, radius);
		if (gap < -1e-5 || (gap <= 0 && vx * surfaceScratch.nx + vy * surfaceScratch.ny <= 0)) {
			out.time = 0;
			out.x = x;
			out.y = y;
			return surfaceAt(x, y, out);
		}
		const travel = Math.hypot(vx, vy) * duration + 0.5 * gravity * duration * duration;
		const samples = Math.max(4, Math.min(64, Math.ceil(travel / (cell * 0.5)) + 1));
		let clear = gap > 0;
		for (let i = 1; i <= samples; i++) {
			let high = duration * i / samples;
			const distance = clearance(x + vx * high, y + (vy - 0.5 * gravity * high) * high, radius);
			if (distance > 0) { clear = true; continue; }
			if (!clear && distance >= gap) continue;
			let low = duration * (i - 1) / samples;
			for (let k = 0; k < 12; k++) {
				const mid = (low + high) * 0.5;
				if (clearance(x + vx * mid, y + (vy - 0.5 * gravity * mid) * mid, radius) > 0) low = mid;
				else high = mid;
			}
			out.time = high;
			out.x = x + vx * high;
			out.y = y + (vy - 0.5 * gravity * high) * high;
			return surfaceAt(out.x, out.y, out);
		}
		return out;
	}

	function harvest(x, halfWidth, cut, maxCells, out, refY) {
		out.value = 0;
		out.cells = 0;
		if (!cave || !piles.size || !(cut > 0)) return out;
		const perBin = cut / ceiling.state.floorCellHeight;
		const first = cave.columnAt(x - halfWidth), last = cave.columnAt(x + halfWidth);
		for (let c = first; c <= last && out.cells < maxCells; c++) {
			const list = piles.get(c);
			if (!list) continue;
			const face = Number.isFinite(refY) ? cave.floorBelow(cave.worldX(c), refY) : null;
			for (let i = list.length - 1; i >= 0 && out.cells < maxCells; i--) {
				const bin = list[i];
				if (face !== null && (bin.base !== face || face > refY)) continue;
				const n = Math.min(bin.cells, perBin, maxCells - out.cells);
				out.value += take(c, bin, n);
				out.cells += n;
			}
		}
		return out;
	}

	function levelEdge(right, leftFace, rightFace, ease, slope) {
		const left = right - 1, leftRow = cave.rowAt(leftFace) - 1, rightRow = cave.rowAt(rightFace) - 1;
		const a = binAt(left, leftRow), b = binAt(right, rightRow);
		if (!a && !b) return;
		if (cave.connectedFloor(left, leftRow, 1) !== rightRow) return;
		const difference = leftFace - rightFace + (a ? a.height : 0) - (b ? b.height : 0) + slope * cell;
		if (!difference) return;
		const source = difference > 0 ? a : b, dest = difference > 0 ? b : a;
		if (!source) return;
		const from = difference > 0 ? left : right, to = difference > 0 ? right : left;
		const destRow = difference > 0 ? rightRow : leftRow;
		const tile = ceiling.state.floorCellHeight;
		const room = roomAbove(to, (destRow + 1) * cell) / tile - (dest ? dest.cells : 0);
		const n = Math.min(source.cells, room, Math.abs(difference) * ease * 0.5 / tile);
		if (!(n > 0)) return;
		const value = take(from, source, n);
		add(to, destRow, n, value);
	}

	function setGradeMode(mode) {
		if (mode === 'platform' || mode === 'bore' || mode === 'smooth') gradeMode = mode;
		return gradeMode;
	}

	function gradeSlope(world) {
		if (gradeMode === 'smooth') return 0;
		if (gradeMode === 'platform') return Math.tan(world.platform.angle || 0);
		const bore = root.SteamWildBore;
		if (!bore) return 0;
		const direction = (!world.brake && (world.direction || (Number.isFinite(world.target) && Math.abs(world.target - world.platform.x) > 0.05
			? Math.sign(world.target - world.platform.x) : 0))) || bore.side;
		return direction * Math.tan(bore.grade);
	}

	function grade(world, dt) {
		if (!cave || !world || !(dt > 0)) return;
		if (blade.value > 0) {
			blade.idle += dt;
			if (blade.idle >= bladeSettleDelay) settleBlade(world);
		}
		const platform = world.platform;
		if (!piles.size || !(Math.abs(platform.vx) > 0.02 || world.direction !== 0)) return;
		const half = ceiling.state.graderSwath * 0.5;
		const first = cave.columnAt(platform.x - half) - 1;
		const last = cave.columnAt(platform.x + half) + 1;
		const center = cave.columnAt(platform.x);
		if (last - first >= gradeRows.length) return;
		gradeRows.fill(-1);
		const y = platform.y;
		const face = cave.floorBelow(cave.worldX(center), y + 0.05);
		if (!Number.isFinite(face) || face > y + 0.05) return;
		gradeRows[center - first] = cave.rowAt(face) - 1;
		for (let dir = -1; dir <= 1; dir += 2) {
			let row = gradeRows[center - first];
			for (let c = center + dir; c >= first && c <= last; c += dir) {
				row = cave.connectedFloor(c - dir, row, dir);
				if (row < 0 || (row + 1) * cell > y + 0.6) break;
				gradeRows[c - first] = row;
			}
		}
		const ease = Math.min(1, gradeRate * dt);
		const slope = gradeSlope(world);
		for (let c = first + 1; c <= last; c++) {
			const left = gradeRows[c - first - 1], right = gradeRows[c - first];
			if (left >= 0 && right >= 0) levelEdge(c, (left + 1) * cell, (right + 1) * cell, ease, slope);
		}
		// Smooth mode keeps every grain for ramps; the two grade-following
		// settings retain the normal blade's slow shave and settlement.
		if (gradeMode === 'smooth') return;
		const perBin = ceiling.state.graderCut * dt / ceiling.state.floorCellHeight;
		for (let c = first + 1; c < last; c++) {
			const row = gradeRows[c - first];
			const bin = row < 0 ? null : binAt(c, row);
			if (!bin) continue;
			const n = Math.min(bin.cells, perBin);
			const value = take(c, bin, n);
			bladeCells += n;
			bladeValueTotal += value;
			blade.value += value;
			blade.idle = 0;
		}
	}

	function settleBlade(world) {
		ceiling.settleGraderBlade(world.time, blade.value, 'Road grader blade');
		blade.value = 0;
		blade.idle = 0;
	}

	function reset(field = cave) {
		cave = field;
		if (cave) cell = cave.state.cell;
		piles.clear();
		profiles.clear();
		depositedCells = depositedValue = lostCells = lostValue = collapseCount = bladeCells = bladeValueTotal = 0;
		blade.value = blade.idle = 0;
	}

	function eachColumn(first, last, visit) {
		for (let c = first; c <= last; c++) if (piles.has(c)) visit(c, piles.get(c));
	}

	function state() {
		let segments = 0, cells = 0, value = 0;
		for (const list of piles.values()) for (const bin of list) {
			segments++;
			cells += bin.cells;
			value += bin.value;
		}
		return { segments, cells, value, depositedCells, depositedValue, lostCells, lostValue, collapseCount, bladeCells, bladeValueTotal, bladeValue: blade.value, gradeMode };
	}

	const api = { reset, deposit, rockOpened, rescale, surfaceAt, crestAt, heightAt, traceCrest,
		harvest, grade, setGradeMode, gradeSlope, settleBlade, eachStrip, eachColumn, bookLost, state,
		get gradeMode() { return gradeMode; },
		get bladeValue() { return blade.value; },
		get lostCells() { return lostCells; }
	};
	root.SteamWildRubble = api;
	if (node) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
