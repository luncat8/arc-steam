// Wild Mine percussion hammer buffers: matched heads on both ends of the rig
// bore drivable 1.125 m (1.5x hull-clearance) level or sloped corridors at a
// reserve cost proportional to remaining rock strength. Classic stays inert.
(function (root) {
	'use strict';
	const node = typeof module !== 'undefined' && module.exports;
	const physicsRef = node ? require('./physics.js') : root.SteamPhysics;
	const equipmentRef = node ? require('./equipment.js') : root.SteamEquipment;

	function phys() { return physicsRef || root.SteamPhysics; }
	function equip() { return equipmentRef || root.SteamEquipment; }

	const config = physicsRef ? physicsRef.config : { platformWidth: 3.6, platformWheelHalfSpan: 1.6, platformMaxPitch: Math.PI / 6, deck: 0.7 };
	const platformClearance = 0.75;
	const heightRatio = 1.5;
	const tunnelHeight = platformClearance * heightRatio;
	const reach = tunnelHeight;
	const maxGrade = config.platformMaxPitch;
	const maxGradeDegrees = Math.round(maxGrade * 180 / Math.PI);
	const borePower = 1800;
	const workPerStrength = 14;
	const strokeTravel = 0.11;
	const strokeRate = 14;
	const borderRows = 2;
	const maxCandidates = 512;
	const epsilon = 1e-9;

	const candCols = new Int32Array(maxCandidates);
	const candRows = new Int32Array(maxCandidates);
	const candKeys = new Float64Array(maxCandidates);
	const cutResult = { weakened: 0, opened: 0 };
	const geometry = {
		side: 1, grade: 0, originX: 0, originY: 0, anchorX: 0, anchorY: 0,
		noseX: 0, noseY: 0, startRun: 0, maxRun: 0, height: tunnelHeight,
		verticalSpan: tunnelHeight, slopeTan: 0, cosG: 1
	};
	const read = {
		installed: false, auto: false, cursorAim: false, held: false, active: false,
		side: 1, grade: 0, gradeDegrees: 0, stroke: 0,
		headingCells: 0, headingStrength: 0, headingUseful: 0, headingReserve: 0,
		cellsCut: 0, fractureSpent: 0, usefulSpent: 0, reserveSpent: 0,
		power: 0, status: 'off', reason: ''
	};

	let auto = false;
	let grade = 0;
	let aimSide = 1;
	let activeSide = 1;
	let cursorAim = false;
	let held = false;
	let active = false;
	let phase = 0;
	let stroke = 0;
	let cellsCut = 0;
	let fractureSpent = 0;
	let usefulSpent = 0;
	let reserveSpent = 0;
	let status = 'idle';
	let pointerX = NaN;
	let pointerY = NaN;
	let locked = false;
	let lockSide = 1;
	let lockGrade = 0;
	let anchorX = 0;
	let anchorY = 0;

	function clearLock() {
		locked = false;
	}

	function reset() {
		grade = 0;
		aimSide = 1;
		activeSide = 1;
		cursorAim = false;
		held = false;
		active = false;
		phase = 0;
		stroke = 0;
		cellsCut = 0;
		fractureSpent = 0;
		usefulSpent = 0;
		reserveSpent = 0;
		status = 'idle';
		pointerX = NaN;
		pointerY = NaN;
		clearLock();
	}

	function clampGrade(value) {
		if (!Number.isFinite(value)) return 0;
		return Math.max(-maxGrade, Math.min(maxGrade, value));
	}

	function installed(owner) {
		const e = equip();
		return Boolean(e && e.isInstalled('bore', owner || 'rig'));
	}

	function travelSide(world) {
		if (!world || world.brake) return 0;
		if (world.direction > 0) return 1;
		if (world.direction < 0) return -1;
		const plate = world.platform;
		if (plate && Number.isFinite(world.target) && Math.abs(world.target - plate.x) > 0.05) {
			return world.target > plate.x ? 1 : -1;
		}
		return 0;
	}

	function resolveSide(world) {
		const drive = travelSide(world);
		if (drive) return drive;
		return aimSide < 0 ? -1 : 1;
	}

	function wheelPoint(world, dir, out) {
		const p = phys();
		const plate = world.platform;
		const halfWidth = p.config.platformWidth * 0.5;
		const wheelSpan = p.config.platformWheelHalfSpan;
		const cosA = Math.cos(plate.angle);
		const sinA = Math.sin(plate.angle);
		out.originX = plate.x + dir * wheelSpan * cosA;
		out.originY = plate.y + dir * wheelSpan * sinA;
		out.noseX = plate.x + dir * halfWidth * cosA;
		out.noseY = plate.y + dir * halfWidth * sinA;
		out.startRun = (halfWidth - wheelSpan) * cosA;
	}

	// Hold one world-space grade line for the entire continuous cut at a given
	// (side, grade) so neither grid stairs nor mid-cut face steps drift the slope;
	// re-seat when starting fresh after open travel or changing side or grade.
	function syncLock(dir, angle, wheelX, wheelY) {
		if (locked && lockSide === dir && Math.abs(lockGrade - angle) <= 1e-6) return;
		locked = true;
		lockSide = dir;
		lockGrade = angle;
		anchorX = wheelX;
		anchorY = wheelY;
	}

	// Shared by the cut loop, readout and canvas guide: verticalSpan = height/cos
	// gives an exact 1.5x perpendicular corridor height at every incline.
	function envelopeInto(world, side, slope, out, commitLock) {
		const target = out || geometry;
		const dir = side < 0 ? -1 : 1;
		const angle = clampGrade(slope);
		wheelPoint(world, dir, target);
		const cosG = Math.cos(angle);
		const slopeTan = Math.tan(angle);
		if (commitLock) syncLock(dir, angle, target.originX, target.originY);
		const useAnchor = locked && lockSide === dir && Math.abs(lockGrade - angle) <= 1e-6;
		target.side = dir;
		target.grade = angle;
		target.anchorX = useAnchor ? anchorX : target.originX;
		target.anchorY = useAnchor ? anchorY : target.originY;
		target.maxRun = target.startRun + reach * cosG;
		target.height = tunnelHeight;
		target.cosG = cosG;
		target.slopeTan = slopeTan;
		target.verticalSpan = tunnelHeight / cosG;
		return target;
	}

	function insertCandidate(count, column, row, key) {
		const limit = count < maxCandidates ? count : maxCandidates - 1;
		if (count >= maxCandidates && key >= candKeys[limit]) return count;
		let at = limit;
		while (at > 0 && candKeys[at - 1] > key) {
			candCols[at] = candCols[at - 1];
			candRows[at] = candRows[at - 1];
			candKeys[at] = candKeys[at - 1];
			at--;
		}
		candCols[at] = column;
		candRows[at] = row;
		candKeys[at] = key;
		return count < maxCandidates ? count + 1 : maxCandidates;
	}

	function collectCandidates(cave, box, plate) {
		const { originX: ox, originY: oy, anchorX: ax, anchorY: ay, maxRun, verticalSpan, slopeTan, side } = box;
		const cell = cave.state.cell;
		const halfCell = cell * 0.5;
		const collar = phys().config.platformWheelHalfSpan;
		const backX = ox - side * collar;
		const endX = ox + side * maxRun;
		const minCol = cave.columnAt(Math.min(backX, endX));
		const maxCol = cave.columnAt(Math.max(backX, endX));
		const maxRowCap = cave.state.rows - borderRows - 1;
		const cosA = plate ? Math.cos(plate.angle) : 1;
		const tanA = plate ? Math.tan(plate.angle) : 0;
		const deckPad = platformClearance / Math.max(0.5, cosA) + cell;
		const hullRun = box.startRun + 0.4;
		let count = 0;
		for (let col = minCol; col <= maxCol; col++) {
			const wx = cave.worldX(col);
			const run = side * (wx - ox);
			if (run < -collar - epsilon || run > maxRun + epsilon) continue;
			const floorY = ay + side * (wx - ax) * slopeTan;
			let roofY = floorY + verticalSpan;
			// When a downward break lifts the hull on its belly arch, keep the deck
			// immediately under the leading shoulder clear without widening straight cuts.
			if (plate && slopeTan < -1e-4 && run <= hullRun) {
				const deckTop = plate.y + (wx - plate.x) * tanA + deckPad;
				if (deckTop > roofY) roofY = deckTop;
			}
			const minY = run < 0 ? Math.max(floorY, oy + 0.35) : floorY;
			if (minY >= roofY - epsilon) continue;
			const aheadOfWheel = run >= halfCell;
			const low = Math.max(borderRows, cave.rowAt(minY));
			const high = Math.min(maxRowCap, cave.rowAt(roofY));
			for (let row = low; row <= high; row++) {
				if (!cave.solidCell(col, row)) continue;
				const wy = cave.worldY(row);
				if (wy < oy && !aheadOfWheel) continue;
				if (wy < minY - epsilon || wy > roofY - epsilon) continue;
				count = insertCandidate(count, col, row, run + (wy - floorY) * 1e-3);
			}
		}
		return count;
	}

	function strengthUpTo(cave, count, cap) {
		let sum = 0;
		for (let i = 0; i < count && sum < cap; i++) sum += cave.strengthAt(candCols[i], candRows[i]);
		return sum;
	}

	function decayStroke(dt) {
		active = false;
		if (!(stroke > 0)) return;
		stroke = Math.max(0, stroke - strokeTravel * 12 * dt);
	}

	function aimAt(world, x, y) {
		if (!world || !world.platform || !Number.isFinite(x) || !Number.isFinite(y)) return false;
		const p = phys();
		const plate = world.platform;
		const side = x >= plate.x ? 1 : -1;
		const halfWidth = p.config.platformWidth * 0.5;
		const cosA = Math.cos(plate.angle);
		const sinA = Math.sin(plate.angle);
		const refX = plate.x + side * halfWidth * cosA;
		const refY = plate.y + side * halfWidth * sinA + p.config.deck * 0.5 * cosA;
		const run = Math.max(0.25, side * (x - refX));
		aimSide = side;
		activeSide = side;
		grade = clampGrade(Math.atan2(y - refY, run));
		return true;
	}

	function updatePointer(world, x, y) {
		pointerX = x;
		pointerY = y;
		if (cursorAim) aimAt(world, x, y);
	}

	function setCursorAim(value, world) {
		cursorAim = Boolean(value);
		if (cursorAim && Number.isFinite(pointerX)) aimAt(world, pointerX, pointerY);
	}

	function setGrade(radians) {
		grade = clampGrade(radians);
		cursorAim = false;
	}

	function setGradeDegrees(degrees) {
		if (!Number.isFinite(degrees)) return;
		setGrade(degrees * Math.PI / 180);
	}

	function setSide(side) {
		aimSide = side < 0 ? -1 : 1;
		activeSide = aimSide;
	}

	function setAuto(value) { auto = Boolean(value); }
	function setHeld(value) { held = Boolean(value); }

	function step(world, cave, dt) {
		const p = phys();
		if (!world || !cave || !(dt > 0) || !p.wildMode()) {
			status = 'off';
			decayStroke(dt || 0);
			return 0;
		}
		if (!installed('rig')) {
			status = 'unfitted';
			decayStroke(dt);
			return 0;
		}
		const drive = travelSide(world);
		if (drive) {
			activeSide = drive;
			if (!cursorAim) aimSide = drive;
		} else activeSide = aimSide;
		const engaged = held || (auto && drive !== 0);
		if (!engaged) {
			clearLock();
			status = 'idle';
			decayStroke(dt);
			return 0;
		}
		// Only lock the grade line once rock actually enters the heading so open
		// travel across a chamber always starts its next tunnel at the wall foot.
		const probe = envelopeInto(world, activeSide, grade, geometry, false);
		const count = collectCandidates(cave, probe, world.platform);
		if (!count) {
			clearLock();
			status = 'clear';
			decayStroke(dt);
			return 0;
		}
		envelopeInto(world, activeSide, grade, geometry, true);
		const factor = p.thermalFactor(world);
		if (!(factor > 0)) {
			status = 'hot';
			decayStroke(dt);
			return 0;
		}
		if (!(world.battery > epsilon)) {
			status = 'empty';
			decayStroke(dt);
			return 0;
		}
		const request = borePower * factor * dt;
		const available = strengthUpTo(cave, count, request / workPerStrength + 1e-6);
		const wanted = Math.min(request, available * workPerStrength);
		if (!(wanted > epsilon)) {
			status = 'clear';
			decayStroke(dt);
			return 0;
		}
		const batteryBefore = world.battery;
		const delivered = p.spend(world, wanted);
		if (!(delivered > epsilon)) {
			status = 'empty';
			decayStroke(dt);
			return 0;
		}
		cave.boreCells(candCols, candRows, count, delivered / workPerStrength, cutResult);
		// Every joule drawn is accounted for: rock strength removed becomes
		// fracture energy and percussion overhead joins engine waste as heat.
		world.fractureEnergy += cutResult.weakened;
		world.heat += Math.max(0, delivered - cutResult.weakened);
		cellsCut += cutResult.opened;
		fractureSpent += cutResult.weakened;
		usefulSpent += delivered;
		reserveSpent += batteryBefore - world.battery;
		active = true;
		status = 'cutting';
		phase = (phase + dt * strokeRate * Math.PI * 2) % (Math.PI * 2);
		stroke = strokeTravel * (0.5 - 0.5 * Math.cos(phase));
		return cutResult.opened;
	}

	function reasonFor(state, count, world, p) {
		if (!state) return 'No hammer buffers installed · fit them in Science + Shop.';
		if (p.thermalFactor(world) <= 0) return 'Thermal cutoff · wait for the machine to cool.';
		if (!(world.battery > epsilon)) return 'Reserve empty · load fuel to bore.';
		if ((held || auto) && !count && status === 'clear') return 'Heading clear · drive in or aim at rock.';
		return '';
	}

	function readout(world, cave) {
		const p = phys();
		const on = Boolean(world && cave && p && p.wildMode());
		const fitted = on && installed('rig');
		const side = on ? resolveSide(world) : aimSide;
		let count = 0;
		let strength = 0;
		if (fitted) {
			count = collectCandidates(cave, envelopeInto(world, side, grade, geometry, false), world.platform);
			strength = strengthUpTo(cave, count, Infinity);
		}
		const useful = strength * workPerStrength;
		const eff = p ? p.engineNow('rig').efficiency : 1;
		read.installed = fitted;
		read.auto = auto;
		read.cursorAim = cursorAim;
		read.held = held;
		read.active = fitted && active;
		read.side = side;
		read.grade = grade;
		read.gradeDegrees = Math.round(grade * 180 / Math.PI);
		read.stroke = fitted ? stroke : 0;
		read.headingCells = count;
		read.headingStrength = strength;
		read.headingUseful = useful;
		read.headingReserve = eff > 0 ? useful / eff : useful;
		read.cellsCut = cellsCut;
		read.fractureSpent = fractureSpent;
		read.usefulSpent = usefulSpent;
		read.reserveSpent = reserveSpent;
		read.power = fitted ? borePower * p.thermalFactor(world) : 0;
		read.status = on ? (fitted ? status : 'unfitted') : 'off';
		read.reason = on ? reasonFor(fitted, count, world, p) : '';
		return read;
	}

	const api = {
		platformClearance, heightRatio, tunnelHeight, reach,
		maxGrade, maxGradeDegrees, borePower, workPerStrength, strokeTravel,
		reset, step, envelopeInto, aimAt, updatePointer,
		setCursorAim, setGrade, setGradeDegrees, setSide, setAuto, setHeld,
		readout,
		get auto() { return auto; },
		get cursorAim() { return cursorAim; },
		get held() { return held; },
		get active() { return active; },
		get side() { return activeSide; },
		get grade() { return grade; },
		get stroke() { return stroke; },
		get cellsCut() { return cellsCut; },
		get reserveSpent() { return reserveSpent; }
	};
	root.SteamWildBore = api;
	if (node) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
