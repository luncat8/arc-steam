// The live water solver: 2D water parcels over the chamber's own rock, the water
// gun that floods them, and the under-platform pump that takes the brine back.
//
// Four rules shape everything here:
//   1. Water is an external fluid outside the dry mineral ledger. The rock owns
//      its mass and value (js/ceiling.js), a parcel owns dissolved load, and
//      nothing is created: every gram that leaves a cell lands in a parcel, in
//      the hopper, on the floor or in the lost-gas counter.
//   2. Only a cell's reactive share can leave as brine or gas. The insoluble
//      share stays standing until its skeleton is undermined, and then it falls
//      as ordinary debris through the ceiling's own deposit path, so wet mining
//      obeys the same collection and collapse rules as a hammer.
//   3. Every joule is booked. The gun converts reserve energy into heat and
//      water momentum at the muzzle; the pump charges the reserve and books the
//      lift, so physics.totalEnergy closes with the gun running or not.
//   4. The chemistry is not implemented here. js/water-chemistry.js holds the
//      one split rule the lab also runs, so a probe cannot measure a law the
//      game does not play.
//
// Depends on (at call time): js/ceiling.js, js/physics.js, js/equipment.js,
// js/players.js, js/water-chemistry.js, js/minerals.js
(function (root) {
	'use strict';
	const node = typeof module !== 'undefined' && module.exports;
	const chemistry = node ? require('./water-chemistry.js') : root.SteamWaterChemistry;
	const minerals = node ? require('./minerals.js') : root.SteamMinerals;

	const count = minerals.mineralCount;
	const gravity = 9.81;
	// Parcels are 0.25 m squares - two rock cells across - the scale the lab
	// measured its flow constants at.
	const cellSize = 0.25;
	const columns = Math.round(24 / cellSize);
	const rows = Math.round(15 / cellSize);
	const cellCount = columns * rows;
	const parcelCapacity = 1.02;

	const maxDroplets = 360;
	const dropletsPerSecond = 46;
	const dropletWater = 0.075;
	const jetSpeed = 15;
	const jetSpread = 0.05;
	// A droplet barely chips intact rock (hundredths of a joule against cells of
	// 3 to 8), so heavy breakers stay mandatory; chemistry mines the salt seam.
	const dropletChipPower = 0.05;
	// One droplet's wash: a share of a cell per hit, not a tiny trickle. Rock is a
	// ceiling over open ground, so water strikes the face and drips away at once;
	// the pooled-water path below can never do the mining on its own.
	//
	// `jetWashSeconds` is the residence of the film the strike leaves: the water
	// sheets over the rough underside and runs down it for a good fraction of a
	// second before it reaches the floor, and it works the whole time. At the
	// measured 0.06 s a cell needed every droplet the reserve could throw to
	// finish, which made the gun look inert.
	const jetDissolvePower = 1.9;
	const jetWashSeconds = 0.12;
	// A strike wets a patch, not a point: the droplet splashes, and the underside
	// is rough, so one hit works the cells around the impact as well as the cell
	// it touched. The wash thins by this share for every cell it spreads.
	const jetSplashShare = 0.6;
	const jetSplashCells = 2;
	const passiveDissolvePower = 0.55;
	const submergedGrainRate = 3;
	const undermineStart = 0.55;

	// Energy: the gun spends what a sandblaster grain spends; the pump pays a
	// fixed price per water unit it lifts back.
	const shotEnergy = 135;
	const pumpJoulesPerUnit = 420;
	const pumpUnitsPerSecond = 2.6;
	const pumpHalfWidth = 1.58;
	const pumpDepth = 0.85;
	const autoFireReserve = 0.2;

	const satCapDefault = 60;
	const dissolveRateDefault = 1;

	const FREE = 0;
	const FLYING = 1;
	const HOPPING = 2;

	// ---- Parcels ----
	const water = new Float32Array(cellCount);
	const waterNext = new Float32Array(cellCount);
	const load = new Float64Array(cellCount * count);
	const loadNext = new Float64Array(cellCount * count);
	const loadValue = new Float64Array(cellCount * count);
	const loadValueNext = new Float64Array(cellCount * count);
	const loadTotal = new Float64Array(cellCount);
	const loadTotalNext = new Float64Array(cellCount);
	const flowU = new Float32Array(cellCount);
	const solidMask = new Uint8Array(cellCount);

	// ---- Droplets ----
	const dropState = new Uint8Array(maxDroplets);
	const dropX = new Float64Array(maxDroplets);
	const dropY = new Float64Array(maxDroplets);
	const dropVx = new Float64Array(maxDroplets);
	const dropVy = new Float64Array(maxDroplets);
	const dropWater = new Float32Array(maxDroplets);
	const dropOwner = new Uint8Array(maxDroplets);
	const dropLoad = new Float64Array(maxDroplets * count);
	const dropLoadValue = new Float64Array(maxDroplets * count);
	let dropCursor = 0;

	// ---- Loose grains: the residue a leached cell leaves behind ----
	const maxGrains = 900;
	const grainActive = new Uint8Array(maxGrains);
	const grainX = new Float64Array(maxGrains);
	const grainY = new Float64Array(maxGrains);
	const grainVx = new Float64Array(maxGrains);
	const grainVy = new Float64Array(maxGrains);
	const grainMass = new Float64Array(maxGrains);
	const grainValue = new Float64Array(maxGrains);
	const grainMineral = new Uint8Array(maxGrains);
	const grainReactive = new Float64Array(maxGrains);
	const grainHop = new Float32Array(maxGrains);
	const grainPan = new Float32Array(maxGrains);
	let grainCursor = 0;

	// One claim stamp per rock cell per pass, so a cell bordered by two pools is
	// worked once. Grows on demand and never shrinks: the grid only gets bigger.
	let claimStamp = new Int32Array(0);
	let stamp = 0;
	function ensureClaims(size) {
		if (claimStamp.length >= size) return;
		claimStamp = new Int32Array(size);
		stamp = 0;
	}

	const nozzle = { x: 0, y: 0, angle: 0, dx: 0, dy: 1 };
	const aim = { x: 12, y: 11 };
	const split = chemistry.createSplit();
	const cellWet = { mass: 0, value: 0, leached: 0, residueMass: 0 };
	const detachOut = createDetachOut();

	const settings = {
		model: 'table', satCap: satCapDefault, dissolveRate: dissolveRateDefault,
		pumpOn: true, erosion: true
	};
	const profiles = new Map();
	let randomState = 1;
	let world = null;

	// The wet ledger: what water has carried, what it destroyed, what it pumped.
	const totals = {
		flooded: 0, pumped: 0, pumpedSolute: 0, pumpedValue: 0,
		lostGasMass: 0, lostGasValue: 0,
		dissolvedMass: 0, cellDissolvedMass: 0, dissolvedCells: 0,
		residueMass: 0, residueValue: 0, settledMass: 0, settledValue: 0,
		// A grain the chemistry left over can reach a hopper dry. It is cargo
		// from then on and outside this ledger, so the handover is booked here:
		// without it the ledger cannot say where that gram went.
		caughtMass: 0, caughtValue: 0,
		pumpJoules: 0, shotJoules: 0, droplets: 0, hops: 0
	};

	function createDetachOut() {
		return { x: 0, y: 0, mass: 0, value: 0, mineral: 0, dominant: 0, index: -1 };
	}

	function random() {
		randomState = (randomState + 0x6D2B79F5) | 0;
		let value = Math.imul(randomState ^ randomState >>> 15, 1 | randomState);
		value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
		return ((value ^ value >>> 14) >>> 0) / 4294967296;
	}

	function clamp(value, low, high) { return value < low ? low : value > high ? high : value; }
	function ownerIdOf(owner) { return owner && typeof owner === 'object' ? owner.id : owner || 'rig'; }

	function profileFor(owner) {
		const id = ownerIdOf(owner);
		let profile = profiles.get(id);
		if (profile) return profile;
		profile = { id, autoFire: false, botFire: false, fireBudget: 0, shots: 0, pumpedMass: 0, pumpedValue: 0, view: null };
		profile.view = Object.freeze({
			get autoFire() { return profile.autoFire || profile.botFire; },
			get shots() { return profile.shots; },
			get pumpedMass() { return profile.pumpedMass; },
			get pumpedValue() { return profile.pumpedValue; }
		});
		profiles.set(id, profile);
		return profile;
	}

	function hasTool(owner) {
		return Boolean(root.SteamEquipment && root.SteamEquipment.isInstalled('watergun', owner));
	}

	// ---- Run ownership ----
	// A new chamber invalidates every parcel, droplet and grain: they were made of
	// the old rock. Called from physics.createWorld beside the other tools, so a
	// fresh run always starts dry.
	function reset(seed) {
		randomState = Math.imul(Number.isFinite(seed) ? seed : 1, 0x9E3779B1);
		water.fill(0); waterNext.fill(0);
		load.fill(0); loadNext.fill(0);
		loadValue.fill(0); loadValueNext.fill(0);
		loadTotal.fill(0); loadTotalNext.fill(0);
		flowU.fill(0); solidMask.fill(0);
		dropState.fill(FREE);
		grainActive.fill(0);
		dropCursor = 0;
		grainCursor = 0;
		// The pump order is a chamber setting like the view and the shape rules: a
		// player who turned the pump off does not find it on again next shift. The
		// chemistry settings have no control yet, so they go back to their defaults.
		settings.model = 'table';
		settings.satCap = satCapDefault;
		settings.dissolveRate = dissolveRateDefault;
		settings.erosion = true;
		world = null;
		for (const key in totals) totals[key] = 0;
		for (const profile of profiles.values()) {
			profile.botFire = false;
			profile.fireBudget = 0;
			profile.shots = 0;
			profile.pumpedMass = 0;
			profile.pumpedValue = 0;
		}
	}

	// ---- Grid <-> world ----
	function cellIndexAt(x, y) {
		const column = clamp(Math.floor(x / cellSize), 0, columns - 1);
		const row = clamp(Math.floor(y / cellSize), 0, rows - 1);
		return row * columns + column;
	}

	// Which parcels hold rock. A parcel is solid when any part of it is rock: a
	// pond must sit on the surface a cell thick, not sink half a cell into it.
	// Rubble piles are solid to water too, so a pond rests on the pile.
	function rebuildSolidMask(rock) {
		const view = rock.rockView();
		ensureClaims(view.rows * view.columns);
		const strengthArray = view.strength;
		const bottom = view.bottom;
		const rockCell = view.cell;
		const rockColumns = view.columns;
		const rockRows = view.rows;
		const floorHeight = view.floorHeight;
		for (let row = 0; row < rows; row++) {
			for (let column = 0; column < columns; column++) {
				const x = (column + 0.5) * cellSize;
				const pile = pileAt(floorHeight, rockCell, x);
				let filled = 0;
				for (let sy = 0; sy < 2; sy++) {
					const wy = (row + 0.5) * cellSize + (sy - 0.5) * cellSize * 0.5;
					if (wy < pile) { filled += 2; continue; }
					const rr = Math.floor((wy - bottom) / rockCell);
					if (rr < 0 || rr >= rockRows) continue;
					for (let sx = 0; sx < 2; sx++) {
						const wx = x + (sx - 0.5) * cellSize * 0.5;
						const rc = Math.floor(wx / rockCell);
						if (rc < 0 || rc >= rockColumns) continue;
						if (strengthArray[rr * rockColumns + rc] > 0) filled++;
					}
				}
				const parcel = row * columns + column;
				const nowSolid = filled > 0 ? 1 : 0;
				if (nowSolid && !solidMask[parcel]) displaceParcel(parcel);
				solidMask[parcel] = nowSolid;
			}
		}
	}

	// Rock took the parcel: its water and load go to the nearest open neighbour
	// rather than being dropped on the floor of the ledger.
	function displaceParcel(parcel) {
		const target = openParcelNear(parcel);
		if (target === parcel) return;
		water[target] += water[parcel];
		loadTotal[target] += loadTotal[parcel];
		const from = parcel * count;
		const to = target * count;
		for (let m = 0; m < count; m++) {
			load[to + m] += load[from + m];
			loadValue[to + m] += loadValue[from + m];
			load[from + m] = 0;
			loadValue[from + m] = 0;
		}
		water[parcel] = 0;
		loadTotal[parcel] = 0;
	}

	function pileAt(floorHeight, rockCell, x) {
		const column = clamp(Math.floor(x / rockCell), 0, floorHeight.length - 2);
		const fraction = x / rockCell - column;
		return floorHeight[column] + (floorHeight[column + 1] - floorHeight[column]) * fraction;
	}

	// ---- Load helpers ----
	function parcelSaturation(index) {
		return chemistry.saturationFactor(loadTotal[index], water[index], settings.satCap);
	}

	// Move a share of one parcel's water and load into another. The solute is a
	// solution, not a second fluid, so it can never leave its water behind.
	function transferParcel(from, to, flow) {
		// Rock can claim a parcel between passes: water never moves into one.
		if (solidMask[from] || solidMask[to]) return;
		const available = waterNext[from];
		if (!(flow > 0) || !(available > 0)) return;
		const actual = flow > available ? available : flow;
		const fraction = actual / available;
		waterNext[from] -= actual;
		waterNext[to] += actual;
		if (loadTotalNext[from] <= 1e-12) return;
		const fromOffset = from * count;
		const toOffset = to * count;
		let moved = 0;
		for (let m = 0; m < count; m++) {
			const mass = loadNext[fromOffset + m] * fraction;
			if (mass === 0) continue;
			const value = loadValueNext[fromOffset + m] * fraction;
			loadNext[fromOffset + m] -= mass;
			loadValueNext[fromOffset + m] -= value;
			loadNext[toOffset + m] += mass;
			loadValueNext[toOffset + m] += value;
			moved += mass;
		}
		loadTotalNext[from] -= moved;
		loadTotalNext[to] += moved;
	}

	// ---- Gun ----
	// `world` is the chamber, not a machine: resolve the owner's collector with
	// its full chassis pose before measuring the world-space aim.
	function nozzleOf(world, owner) {
		const physics = root.SteamPhysics;
		physics.collectorPointAt(world, ownerIdOf(owner), physics.config.waterNozzleFraction, 0, nozzle);
		let dx = aim.x - nozzle.x;
		let dy = aim.y - nozzle.y;
		// A nozzle cannot fire into its own deck.
		if (dy < -0.35) dy = -0.35;
		const length = Math.hypot(dx, dy);
		if (length > 1e-5) { nozzle.dx = dx / length; nozzle.dy = dy / length; }
		else { nozzle.dx = 0; nozzle.dy = 1; }
		return nozzle;
	}

	function canFire(target, owner) {
		const id = ownerIdOf(owner);
		if (!target || !hasTool(id)) return false;
		if (profileFor(id).fireBudget > 0) return false;
		const machine = root.SteamPhysics.machineById(target, id);
		if (machine === target && target.battery < shotEnergy) return false;
		return true;
	}

	// Fire one droplet. The reserve pays for the throw and the same joules become
	// chamber heat at once - the motor's loss and the water's momentum together -
	// so the energy ledger closes without tracking a droplet's kinetic energy.
	function fire(target, owner) {
		const id = ownerIdOf(owner);
		if (!canFire(target, id)) return false;
		const machine = root.SteamPhysics.machineById(target, id);
		const body = root.SteamPhysics.machineBody(machine);
		// The gun points where the jet must go, not where the bound machine body is.
		const muzzle = nozzleOf(target, id);
		const slot = freeDroplet();
		if (slot < 0) return false;
		const angle = (random() - 0.5) * jetSpread;
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		dropState[slot] = FLYING;
		dropX[slot] = muzzle.x;
		dropY[slot] = muzzle.y;
		dropVx[slot] = body.vx + (muzzle.dx * cos - muzzle.dy * sin) * jetSpeed;
		dropVy[slot] = body.vy + (muzzle.dx * sin + muzzle.dy * cos) * jetSpeed;
		dropWater[slot] = dropletWater;
		dropOwner[slot] = 0;
		const offset = slot * count;
		for (let m = 0; m < count; m++) { dropLoad[offset + m] = 0; dropLoadValue[offset + m] = 0; }
		const rig = machine === target;
		if (rig) {
			target.battery -= shotEnergy;
			target.heat += shotEnergy;
			totals.shotJoules += shotEnergy;
		} else {
			// A rival's pack is outside the rig's ledger: its throw is imported work.
			target.importedEnergy += shotEnergy;
		}
		profileFor(id).shots++;
		profileFor(id).fireBudget = 1 / dropletsPerSecond;
		totals.flooded += dropletWater;
		totals.droplets++;
		return true;
	}

	function freeDroplet() {
		for (let i = 0; i < maxDroplets; i++) {
			const slot = (dropCursor + i) % maxDroplets;
			if (dropState[slot] === FREE) { dropCursor = (slot + 1) % maxDroplets; return slot; }
		}
		return -1;
	}

	// The nearest open parcel to one that is solid or out of reach: water that
	// arrives at a rock face must join the pool beside it, never the rock.
	function openParcelNear(index) {
		if (!solidMask[index]) return index;
		const column = index % columns;
		const row = (index / columns) | 0;
		for (let distance = 1; distance <= 3; distance++) {
			for (let dy = -distance; dy <= distance; dy++) {
				const r = row + dy;
				if (r < 0 || r >= rows) continue;
				for (let dx = -distance; dx <= distance; dx++) {
					if (Math.abs(dx) !== distance && Math.abs(dy) !== distance) continue;
					const c = column + dx;
					if (c < 0 || c >= columns) continue;
					const candidate = r * columns + c;
					if (!solidMask[candidate]) return candidate;
				}
			}
		}
		return index;
	}

	// A droplet reaching a parcel: its water and load join the pool, and the push
	// it arrived with becomes the parcel's current.
	// Returns the parcel it actually landed in: rock may have pushed it aside, and
	// the caller's wash must be applied where the water really is.
	function landDroplet(slot, parcel) {
		parcel = openParcelNear(parcel);
		const offset = slot * count;
		water[parcel] += dropWater[slot];
		let added = 0;
		for (let m = 0; m < count; m++) {
			const mass = dropLoad[offset + m];
			if (mass === 0) continue;
			load[parcel * count + m] += mass;
			loadValue[parcel * count + m] += dropLoadValue[offset + m];
			added += mass;
		}
		loadTotal[parcel] += added;
		flowU[parcel] = clamp(flowU[parcel] + dropVx[slot] * 0.22, -9, 9);
		dropState[slot] = FREE;
		return parcel;
	}

	// ---- Chemistry ----
	// One droplet's impact: a small mechanical bite through the shared weakening
	// rule, then the chemical wash over the face patch it wet.
	//
	// The bite is almost nothing, and it books nothing when it lands: the
	// droplet's whole throw already became chamber heat at the muzzle, and `chip`
	// returns what it *absorbed*, which is only ever spent again (a loosened cell
	// falls through the collapse scheduler, and that fall's heat is the next
	// booking). Adding it here would count the same joule twice.
	function strikeCell(rockIndex, parcelIndex, speed) {
		const rock = root.SteamCeiling;
		const view = rock.rockView();
		const wash = jetDissolvePower * Math.min(1.6, speed / jetSpeed);
		if (rockIndex < 0 || view.strength[rockIndex] <= 0) return;
		// The momentum bites one cell at the impact point: a splash carries
		// water, not force, so the patch is washed and only the hit is chipped.
		rock.chip(wetX(view, rockIndex), wetY(view, rockIndex), dropletChipPower, 1);
		washFace(rockIndex, parcelIndex, wash, jetWashSeconds);
	}

	// The wash one strike leaves on the face: the cell it hit at full power, then
	// the ring of exposed cells the splash spread over, weaker the further out it
	// reaches. Water that misses the reactive cell by one still works the seam
	// beside it, which is what turns a jet aimed at an arbitrary column from a
	// trickle into a cut: most of the bed is inert, so a point wash mines
	// nothing, and the droplet is spent either way.
	//
	// The patch is measured from the struck cell, not from the parcel the water
	// landed in: a rising jet is stopped by a face it is still a parcel short of,
	// so the two are not the same square.
	function washFace(rockIndex, parcelIndex, power, dt) {
		exposeCell(rockIndex, parcelIndex, power, dt);
		if (!(jetSplashShare > 0)) return;
		const view = root.SteamCeiling.rockView();
		const rockColumns = view.columns;
		const rockRows = view.rows;
		const column = rockIndex % rockColumns;
		const row = (rockIndex / rockColumns) | 0;
		const firstRow = Math.max(0, row - jetSplashCells);
		const lastRow = Math.min(rockRows - 1, row + jetSplashCells);
		const firstColumn = Math.max(0, column - jetSplashCells);
		const lastColumn = Math.min(rockColumns - 1, column + jetSplashCells);
		for (let rr = firstRow; rr <= lastRow; rr++) {
			const away = Math.abs(rr - row);
			for (let rc = firstColumn; rc <= lastColumn; rc++) {
				const index = rr * rockColumns + rc;
				if (index === rockIndex) continue;
				if (view.strength[index] <= 0) continue;
				if (!isExposed(view, index)) continue;
				// The sheet thins as it spreads: the further the cell, the
				// smaller the share of the impact's wash it gets.
				const spread = Math.max(away, Math.abs(rc - column));
				exposeCell(index, parcelIndex, power * Math.pow(jetSplashShare, spread), dt);
			}
		}
	}

	// Nearest rock cell with anything left in it, within one parcel of the point.
	// The search runs outwards from the point, not from the cell grid's own index:
	// a rising jet stops its step below the layer, where the row is negative, and
	// clamping before the search would walk it away from the face it is touching.
	// The rock cell this flight step meets. A rising jet that stops in the open
	// parcel under a face has still met it: the step is tested along its whole
	// length against the cells it passes through, and the nearest solid cell to
	// the arc decides the strike. Without the along-the-step test a droplet could
	// stop a few cells short, be recorded as splashed water, and never work the
	// face it was aimed at.
	// `verticalSpeed` is the droplet's own climb rate: while it is still rising the
	// step is tested forward along the jet, and once it is falling the apex it just
	// passed is what it struck. A jet aimed at a face from below reaches the face
	// row a step *after* its apex, which is why the test is not a single endpoint.
	function faceNear(x0, y0, x1, y1, verticalSpeed) {
		const view = root.SteamCeiling.rockView();
		const rockCell = view.cell;
		const rockColumns = view.columns;
		const reach = Math.ceil(cellSize / rockCell);
		const dxStep = x1 - x0;
		const dyStep = y1 - y0;
		// Sample at one rock cell: the finest spacing that cannot skip a cell.
		const samples = Math.max(2, Math.ceil(Math.hypot(dxStep, dyStep) / rockCell) + 1);
		let best = -1;
		let bestDistance = Infinity;
		for (let sample = 0; sample < samples; sample++) {
			const x = x0 + dxStep * (sample / (samples - 1));
			const y = y0 + dyStep * (sample / (samples - 1));
			const hit = root.SteamCeiling.cellAt(x, y);
			if (hit >= 0) {
				const column = hit % rockColumns;
				const row = (hit / rockColumns) | 0;
				const offsetX = (column + 0.5) * rockCell - x;
				const offsetY = view.bottom + (row + 0.5) * rockCell - y;
				const total = offsetX * offsetX + offsetY * offsetY;
				if (total < bestDistance) { bestDistance = total; best = hit; }
				continue;
			}
			// An open sample: a face one parcel away is the face the jet is passing.
			const centreColumn = Math.floor(x / rockCell);
			const centreRow = Math.floor((y - view.bottom) / rockCell);
			for (let dr = -reach; dr <= reach; dr++) {
				const row = centreRow + dr;
				if (row < 0 || row >= view.rows) continue;
				for (let dc = -reach; dc <= reach; dc++) {
					const column = centreColumn + dc;
					if (column < 0 || column >= rockColumns) continue;
					const index = row * rockColumns + column;
					if (view.strength[index] <= 0) continue;
					if (!isExposed(view, index)) continue;
					const offsetX = (column + 0.5) * rockCell - x;
					const offsetY = view.bottom + (row + 0.5) * rockCell - y;
					const total = offsetX * offsetX + offsetY * offsetY;
					if (total < bestDistance) { bestDistance = total; best = index; }
				}
			}
		}
		// A rising jet that stopped even a full unit short of the face has still
		// spent its climb on that face: take the exposed cell straight ahead.
		if (best >= 0) return best;
		if (verticalSpeed > 0) return -1;
		return aheadFace(x1, y1);
	}

	// The first face straight up from a point, within one parcel: the same contact
	// distance the standing-water pass uses, so a jet whose steps stop a parcel
	// short of the face it was aimed at has still reached it.
	function aheadFace(x, y) {
		const view = root.SteamCeiling.rockView();
		const probes = Math.ceil(cellSize / view.cell) + 1;
		for (let probe = 0; probe <= probes; probe++) {
			const hit = root.SteamCeiling.cellAt(x, y + probe * view.cell);
			if (hit >= 0) return hit;
		}
		return -1;
	}

	function wetX(view, index) {
		return (index % view.columns + 0.5) * view.cell;
	}

	function wetY(view, index) {
		return view.bottom + (Math.floor(index / view.columns) + 0.5) * view.cell;
	}

	// Evaluate the cell's split under the active model. Writes into `split`.
	function splitOf(view, index, wet) {
		if (settings.model === 'formula') {
			const elementOffset = index * 3;
			const elements = view.elements;
			return chemistry.evaluateFormulaSplit(elements[elementOffset], elements[elementOffset + 1],
				elements[elementOffset + 2], view.dominantAt(index), wet.mass, wet.value, view.mineralPrices, split);
		}
		return chemistry.evaluateTableSplit(view.minerals, index * view.mineralCount, wet.mass, wet.value, view.mineralPrices, split);
	}

	// Water meets one exposed rock cell: leach its reactive share into the
	// contacting parcel, and let the cell go when its residue is undermined.
	function exposeCell(rockIndex, parcelIndex, power, dt) {
		const rock = root.SteamCeiling;
		const view = rock.rockView();
		if (view.strength[rockIndex] <= 0) return false;
		const wet = rock.wetOf(rockIndex, cellWet);
		const cellSplit = splitOf(view, rockIndex, wet);
		if (!(cellSplit.speed > 0) || !(cellSplit.solubility > 0)) return false;
		const saturation = parcelSaturation(parcelIndex);
		if (saturation <= 0) return false;
		const progress = wet.leached;
		let step = cellSplit.speed * settings.dissolveRate * power * saturation * dt;
		if (step > 1 - progress) step = 1 - progress;
		if (!(step > 0)) return false;
		releaseSlice(rockIndex, parcelIndex, step);
		const leach = rock.wetLeach(rockIndex, step, cellSplit.undermined);
		// A residue below the rubble limit has nothing left to stand on. It goes
		// only after enough binder is gone, so a seam does not vanish at once.
		const ready = leach.leached >= 1 || (leach.residueStrength < view.debrisLimit && leach.leached > undermineStart);
		if (!ready) return false;
		if (leach.leached < 1 && random() >= (leach.leached - undermineStart) * 6 * dt) return false;
		return detachCell(rockIndex, parcelIndex, leach);
	}

	// Hand `share` of the cell's split to the contacting parcel and debit the
	// rock. The residue is deliberately not handed out: it is the part that
	// stands or falls, never something water can carry.
	function releaseSlice(rockIndex, parcelIndex, share) {
		const offset = parcelIndex * count;
		let brineMass = 0;
		let brineValue = 0;
		for (let m = 0; m < count; m++) {
			const mass = split.brine[m] * share;
			if (mass <= 0) continue;
			const value = split.brineValue[m] * share;
			load[offset + m] += mass;
			loadValue[offset + m] += value;
			brineMass += mass;
			brineValue += value;
		}
		const ventMass = split.ventMass * share;
		const ventValue = split.ventValueTotal * share;
		if (brineMass > 0) loadTotal[parcelIndex] += brineMass;
		if (ventMass > 0) {
			totals.lostGasMass += ventMass;
			totals.lostGasValue += ventValue;
		}
		root.SteamCeiling.wetSpend(rockIndex, brineMass, ventMass, brineValue, ventValue);
		totals.dissolvedMass += brineMass + ventMass;
		totals.cellDissolvedMass += brineMass + ventMass;
	}

	// The cell is finished. Whatever it still holds becomes one falling grain of
	// its residue mineral, and the grain carries the cell's exact remaining mass
	// and value, so the wet ledger and the mine's debits agree to the gram.
	//
	// The energy boundary. The ceiling books a standing cell at `cellMass * g * y`
	// and drops that whole term the moment the cell goes, whatever its remaining
	// mass; the grain, the brine and the lost gas are this module's fluid and live
	// outside the dry ledger. So the boundary is one number - the cell's full
	// potential energy - and it is booked as imported work: the wet system took
	// that mass-energy out of the rock. Everything downstream (a grain falling,
	// brine flowing, the gas lost) then stays outside the ledger exactly like the
	// ambient pool flow, and nothing has to be booked twice.
	function detachCell(rockIndex, parcelIndex, leach) {
		const rock = root.SteamCeiling;
		const view = rock.rockView();
		const wet = rock.wetOf(rockIndex, cellWet);
		if (leach.leached < 1) {
			// An early collapse still owes its reactive share to the water that
			// undermined it; the split is re-evaluated on the cell as it now is.
			const cellSplit = splitOf(view, rockIndex, wet);
			if (cellSplit.solubility > 0) releaseSlice(rockIndex, parcelIndex, 1 - leach.leached);
		}
		// The ceiling bills every standing cell at the full `cellMass`, so this is
		// exactly what its energy total loses when the cell goes - whether the
		// remainder became one grain, brine, or lost gas. Booking it as heat makes
		// the fluid the new owner of that mass-energy; the fluid's own movement is
		// outside the dry ledger from here on, and the place it re-enters (a
		// hopper) books its own entry.
		const height = view.bottom + (Math.floor(rockIndex / view.columns) + 0.5) * view.cell;
		if (!rock.wetDetach(rockIndex, detachOut)) return false;
		world.heat += rock.state.cellMass * gravity * height;
		totals.dissolvedCells++;
		const gained = detachOut.mass;
		if (gained > 1e-9) {
			spawnGrain(detachOut.x, detachOut.y, (random() - 0.5) * 0.4, -0.2, detachOut.mineral, gained, detachOut.value);
			totals.residueMass += gained;
			totals.residueValue += detachOut.value;
		}
		return true;
	}

	// Standing water works the rock it touches. This is the slow path: a stagnant
	// pool stops as soon as it saturates, which is what makes the pump part of the
	// mining loop rather than an optional extra.
	//
	// A wet parcel reaches one cell beyond its own square, because that is what a
	// pool filling a pocket actually touches. Each cell is claimed by the first
	// wet parcel that reaches it in this pass, so a cell bordered by two pools is
	// not worked twice as fast.
	function dissolveContacts(dt) {
		const rock = root.SteamCeiling;
		const view = rock.rockView();
		const rockCell = view.cell;
		const rockColumns = view.columns;
		const rockRows = view.rows;
		const bottom = view.bottom;
		// Water rests on rock rather than in it, so the nearest rock face is always
		// one parcel away: the contact test is a distance, not an overlap.
		const margin = cellSize;
		const span = margin * 2;
		stamp++;
		for (let parcel = 0; parcel < cellCount; parcel++) {
			const held = water[parcel];
			if (held < 0.06) continue;
			if (parcelSaturation(parcel) <= 0) continue;
			const intensity = (0.32 + 0.68 * Math.min(1, Math.abs(flowU[parcel]) / 2.2)) * Math.min(1, held * 2.2);
			if (intensity <= 0) continue;
			const power = passiveDissolvePower * intensity * dt;
			const column = parcel % columns;
			const row = (parcel / columns) | 0;
			const x0 = column * cellSize;
			const y0 = row * cellSize;
			const firstRow = Math.max(0, Math.floor((y0 - span - bottom) / rockCell));
			const lastRow = Math.min(rockRows - 1, Math.floor((y0 + cellSize + span - 1e-9 - bottom) / rockCell));
			const firstColumn = Math.max(0, Math.floor((x0 - span) / rockCell));
			const lastColumn = Math.min(rockColumns - 1, Math.floor((x0 + cellSize + span - 1e-9) / rockCell));
			for (let rr = firstRow; rr <= lastRow; rr++) {
				const cellY0 = bottom + rr * rockCell;
				const gapY = cellY0 > y0 + cellSize ? cellY0 - (y0 + cellSize) : (y0 > cellY0 + rockCell ? y0 - (cellY0 + rockCell) : 0);
				if (gapY > margin) continue;
				for (let rc = firstColumn; rc <= lastColumn; rc++) {
					const index = rr * rockColumns + rc;
					if (claimStamp[index] === stamp) continue;
					if (view.strength[index] <= 0) continue;
					const cellX0 = rc * rockCell;
					const gapX = cellX0 > x0 + cellSize ? cellX0 - (x0 + cellSize) : (x0 > cellX0 + rockCell ? x0 - (cellX0 + rockCell) : 0);
					if (gapX > margin) continue;
					if (!isExposed(view, index)) continue;
					claimStamp[index] = stamp;
					exposeCell(index, parcel, power, dt);
				}
			}
		}
	}

	// Only a cell with an open face can be reached by water. Off the grid is open
	// space: the underside of the seam and the tops of the walls are free faces.
	function isExposed(view, index) {
		const columnsInRock = view.columns;
		const rowsInRock = view.rows;
		const column = index % columnsInRock;
		const row = (index / columnsInRock) | 0;
		const strength = view.strength;
		if (row === 0 || strength[index - columnsInRock] <= 0) return true;
		if (row + 1 === rowsInRock || strength[index + columnsInRock] <= 0) return true;
		if (column === 0 || strength[index - 1] <= 0) return true;
		if (column + 1 === columnsInRock || strength[index + 1] <= 0) return true;
		return false;
	}

	// ---- Droplet flight ----
	function stepDroplets(dt) {
		for (let i = 0; i < maxDroplets; i++) {
			if (dropState[i] !== FLYING) continue;
			const nextVy = dropVy[i] - gravity * dt;
			const nextX = dropX[i] + dropVx[i] * dt;
			const nextY = dropY[i] + (dropVy[i] + nextVy) * 0.5 * dt;
			const parcel = cellIndexAt(nextX, nextY);
			const out = nextX <= 0.06 || nextX >= 23.94 || nextY >= 14.94 || nextY <= 0.02;
			// The flight hits rock on the step that *reaches* it, so the whole step is
			// tested, not just its end: a jet aimed at a face stops its step a few
			// cells short of the face, and a test of the endpoint alone would let it
			// fall away as splashed water without ever touching the rock.
			const speed = Math.hypot(dropVx[i], dropVy[i]);
			// Test the step from the droplet's height to where it would go, and the
			// whole height it climbs toward: the arc turns over inside a step, so the
			// apex of the flight is what the jet is aimed at.
			const face = out ? -1 : faceNear(dropX[i], dropY[i], nextX, Math.max(nextY, dropY[i]), nextVy);
			if (out || solidMask[parcel] || face >= 0) {
				const landed = landDroplet(i, parcel);
				if (face >= 0) strikeCell(face, landed, speed);
				continue;
			}
			if (water[parcel] > 0.3 && nextVy < 1.5) { landDroplet(i, parcel); continue; }
			dropX[i] = nextX;
			dropY[i] = nextY;
			dropVy[i] = nextVy;
		}
	}

	// ---- Fluid step ----
	// Gravity, then horizontal levelling between supported parcels, then upward
	// relief, twice per step. Solute moves only with its water.
	function stepFluid() {
		waterNext.set(water);
		loadNext.set(load);
		loadValueNext.set(loadValue);
		loadTotalNext.set(loadTotal);
		for (let sweep = 0; sweep < 2; sweep++) {
			for (let row = 1; row < rows; row++) {
				for (let column = 0; column < columns; column++) {
					const index = row * columns + column;
					if (solidMask[index]) continue;
					const held = waterNext[index];
					if (held <= 5e-4) continue;
					const below = index - columns;
					if (solidMask[below]) continue;
					const room = parcelCapacity - waterNext[below];
					if (room <= 0.001) continue;
					transferParcel(index, below, Math.min(held, room, 0.95));
				}
			}
			const rightFirst = (sweep & 1) === 0;
			for (let row = 0; row < rows; row++) {
				for (let step = 0; step < columns - 1; step++) {
					const column = rightFirst ? step : columns - 2 - step;
					const index = row * columns + column;
					if (solidMask[index] || solidMask[index + 1]) continue;
					const held = waterNext[index];
					const other = waterNext[index + 1];
					if (held <= 0.002 && other <= 0.002) continue;
					// A parcel spreads sideways only on rock or a full parcel below it.
					// The bottom of the grid is a wall, not a support: row 0 is open air
					// under the roof of a chamber that starts higher up.
					if (row > 0 && !solidMask[index - columns] && waterNext[index - columns] <= 0.55) continue;
					const flow = (held - other) * 0.30 + flowU[index] * 0.04;
					if (flow > 0) transferParcel(index, index + 1, Math.min(flow, held * 0.48));
					else if (flow < 0) transferParcel(index + 1, index, Math.min(-flow, other * 0.48));
				}
			}
			for (let row = 0; row < rows - 1; row++) {
				for (let column = 0; column < columns; column++) {
					const index = row * columns + column;
					if (solidMask[index]) continue;
					const excess = waterNext[index] - parcelCapacity;
					if (excess <= 0.005) continue;
					const above = index + columns;
					if (!solidMask[above]) transferParcel(index, above, excess * 0.65);
				}
			}
		}
		for (let index = 0; index < cellCount; index++) {
			if (waterNext[index] < 1e-6) {
				// A parcel carrying brine without water is a rounding ghost: its
				// solute cannot be destroyed, so the film stays until it is pumped.
				if (loadTotalNext[index] > 1e-7) waterNext[index] = 1e-5;
				else { waterNext[index] = 0; loadTotalNext[index] = 0; }
			}
			water[index] = waterNext[index];
			loadTotal[index] = loadTotalNext[index];
			flowU[index] *= 0.94;
		}
		load.set(loadNext);
		loadValue.set(loadValueNext);
	}

	// ---- Loose grains ----
	function spawnGrain(x, y, vx, vy, mineral, mass, value) {
		for (let tries = 0; tries < maxGrains; tries++) {
			const slot = (grainCursor + tries) % maxGrains;
			if (grainActive[slot]) continue;
			grainCursor = (slot + 1) % maxGrains;
			grainActive[slot] = 1;
			grainX[slot] = x;
			grainY[slot] = y;
			grainVx[slot] = vx;
			grainVy[slot] = vy;
			grainMass[slot] = mass;
			grainValue[slot] = value;
			grainMineral[slot] = mineral;
			grainReactive[slot] = mass;
			grainHop[slot] = 0;
			grainPan[slot] = 0;
			return slot;
		}
		// The pool is full, so the material joins the floor pile where it was
		// instead of vanishing.
		root.SteamCeiling.depositLoose(x, mass / root.SteamCeiling.state.cellMass, value);
		return -1;
	}

	function stepGrains(dt) {
		const physics = root.SteamPhysics;
		for (let i = 0; i < maxGrains; i++) {
			if (!grainActive[i]) continue;
			grainVy[i] -= gravity * dt;
			grainY[i] += grainVy[i] * dt - 0.5 * gravity * dt * dt;
			grainX[i] += grainVx[i] * dt;
			if (grainX[i] < 0 || grainX[i] > physics.config.width) { loseGrain(i); continue; }
			const parcel = cellIndexAt(grainX[i], grainY[i]);
			if (water[parcel] > 0.05) {
				const mineral = grainMineral[i];
				const def = minerals.mineralTable[mineral];
				dissolveGrain(i, parcel, def, dt);
				if (!grainActive[i]) continue;
				if (settings.erosion) erodeGrain(i, parcel, def, dt);
			}
			if (catchGrain(i)) continue;
			if (grainY[i] <= groundAt(grainX[i])) landGrain(i);
		}
	}

	// A light grain hops in a current that beats its critical speed; a heavy one
	// barely moves. This is transport, never dissolution.
	function erodeGrain(i, parcel, def, dt) {
		const speed = Math.abs(flowU[parcel]);
		const critical = 0.78 * Math.max(0.35, def.rho - 1);
		if (speed <= critical) { grainHop[i] = Math.max(0, grainHop[i] - dt); return; }
		if (random() >= Math.min(0.95, (2.8 + 4.5 * (speed / critical - 1)) * dt)) return;
		grainHop[i] = 0.14 + random() * 0.34;
		grainVy[i] = Math.max(grainVy[i], 0.75);
		grainVx[i] = clamp(grainVx[i] + flowU[parcel] * 0.35, -5.5, 5.5);
		totals.hops++;
	}

	// A soluble grain submerged in unsaturated water dissolves at three times the
	// wall rate and hands its channels to the parcel it sits in.
	function dissolveGrain(i, parcel, def, dt) {
		const leachable = def.brineF + def.ventF;
		if (leachable <= 0 || grainReactive[i] <= 1e-12) return;
		const saturation = parcelSaturation(parcel);
		if (saturation <= 0) return;
		let removed = grainMass[i] * 0.55 * def.dissolveSpeed * settings.dissolveRate * submergedGrainRate * saturation * dt;
		if (removed > grainReactive[i]) removed = grainReactive[i];
		if (removed <= 1e-12) return;
		let brineMass = removed * (def.brineF / leachable);
		let ventMass = removed - brineMass;
		const unit = grainMass[i] > 0 ? grainValue[i] / grainMass[i] : 0;
		const brineValue = brineMass * unit;
		const ventValue = ventMass * unit;
		if (brineMass > 0) {
			load[parcel * count + grainMineral[i]] += brineMass;
			loadValue[parcel * count + grainMineral[i]] += brineValue;
			loadTotal[parcel] += brineMass;
			totals.dissolvedMass += brineMass;
		}
		if (ventMass > 0) {
			totals.lostGasMass += ventMass;
			totals.lostGasValue += ventValue;
			totals.dissolvedMass += ventMass;
		}
		grainMass[i] -= removed;
		grainValue[i] -= brineValue + ventValue;
		grainReactive[i] -= removed;
		if (grainMass[i] <= 1e-9) { grainActive[i] = 0; return; }
		// The leach floor: a grain out of reactive share becomes its residue
		// mineral, priced at what is left rather than at the parent's quote.
		if (grainReactive[i] <= 1e-12 && def.residueF > 0) {
			const residueMineral = def.residueId === def.id ? grainMineral[i] : minerals.mineralIds.indexOf(def.residueId);
			if (residueMineral >= 0 && residueMineral !== grainMineral[i]) {
				const quote = root.SteamCeiling.state.mineralPrices[residueMineral];
				const booked = grainMass[i] * quote;
				if (grainValue[i] > booked) {
					totals.lostGasValue += grainValue[i] - booked;
					grainValue[i] = booked;
				}
				grainMineral[i] = residueMineral;
			}
		}
	}

	// The grain reaches a collector: it becomes cargo at the deck, and the deck
	// pays for it in the ceiling's books, where a hopper cell is worth
	// `cellMass * g * cargoHeight`. A grain that joins the rig's own hopper then
	// stops being fluid: it is dry rock again, in the ledger at that height, so
	// that addition is booked as imported mass-energy. The grain's own kinetic
	// energy was never in the dry ledger, and the only other thing that moves is
	// the rig's, whose inelastic merge loss is heat. A rival's pack is outside
	// this ledger, so its grain simply leaves it.
	function catchGrain(i) {
		const physics = root.SteamPhysics;
		const machines = physics.machinesOf(world);
		const collector = physics.config.collectorFraction;
		for (let m = 0; m < machines.length; m++) {
			const machine = machines[m];
			const body = physics.machineBody(machine);
			const deck = body.y + physics.config.deck;
			if (grainY[i] > deck) continue;
			const left = body.x - physics.config.platformWidth * 0.5;
			if (grainX[i] < left || grainX[i] > left + physics.config.platformWidth * collector) continue;
			if (!root.SteamCeiling.loadWetCargo(world, machine, grainMineral[i], grainMass[i], grainValue[i])) continue;
			const mass = physics.machineMass(world, machine);
			const before = 0.5 * mass * body.vx * body.vx;
			body.vx = (mass * body.vx + grainMass[i] * grainVx[i]) / (mass + grainMass[i]);
			if (machine === world) {
				world.heat += before - 0.5 * (mass + grainMass[i]) * body.vx * body.vx;
			world.importedEnergy += grainMass[i] * gravity * root.SteamCeiling.state.cargoHeight;
		}
		// The grain is cargo now, outside this ledger, so the handover is booked
		// or the ledger cannot say where the gram the chemistry took went.
		totals.caughtMass += grainMass[i];
		totals.caughtValue += grainValue[i];
		grainActive[i] = 0;
		return true;
	}
	return false;
}

	function groundAt(x) {
		const physics = root.SteamPhysics;
		let ground = root.SteamCeiling.floorAt(x);
		const machines = physics.machinesOf(world);
		const deck = physics.config.deck;
		const half = physics.config.platformWidth * 0.5;
		for (let i = 0; i < machines.length; i++) {
			const body = physics.machineBody(machines[i]);
			if (Math.abs(x - body.x) > half) continue;
			if (body.y + deck > ground) ground = body.y + deck;
		}
		return ground;
	}

	// A grain reaches the rubble and becomes floor material again. The floor pile
	// is outside the mechanical ledger (the ceiling bills standing rock only), so
	// nothing moves and nothing is booked: the fluid simply stops carrying it. The
	// settled totals keep the mass and value the wet ledger handed to the floor.
	function landGrain(i) {
		totals.settledMass += grainMass[i];
		totals.settledValue += grainValue[i];
		root.SteamCeiling.depositLoose(grainX[i], grainMass[i] / root.SteamCeiling.state.cellMass, grainValue[i]);
		grainActive[i] = 0;
	}

	function loseGrain(i) {
		totals.settledMass += grainMass[i];
		totals.settledValue += grainValue[i];
		root.SteamCeiling.depositLoose(clamp(grainX[i], 0, 23.99), grainMass[i] / root.SteamCeiling.state.cellMass, grainValue[i]);
		grainActive[i] = 0;
	}

	// ---- Pump ----
	// The pump lifts water and its dissolved load from under the hull into the
	// hopper. Solid grains are never pumped: dry collection stays a separate
	// mechanic. A full hopper stalls the pump instead of destroying
	// what it cannot hold.
	function stepPump(dt) {
		if (!settings.pumpOn) return 0;
		const physics = root.SteamPhysics;
		const machine = physics.machineById(world, 'rig');
		const body = physics.machineBody(machine);
		// Suction reaches from under the hull to the deck: the intake sits in the
		// hull, and a pond rests on the rock outside the hull's own footprint.
		const deck = body.y + physics.config.deck;
		const firstColumn = clamp(Math.floor((body.x - pumpHalfWidth) / cellSize), 0, columns - 1);
		const lastColumn = clamp(Math.floor((body.x + pumpHalfWidth) / cellSize), 0, columns - 1);
		const firstRow = clamp(Math.floor((body.y - pumpDepth) / cellSize), 0, rows - 1);
		const lastRow = clamp(Math.floor((deck + pumpDepth) / cellSize), 0, rows - 1);
		const cellMass = root.SteamCeiling.state.cellMass;
		let capacity = root.SteamCeiling.cargoSpace(world, machine) * cellMass;
		if (capacity <= 1e-9) return 0;
		let budget = pumpUnitsPerSecond * dt;
		let lifted = 0;
		let soluteMass = 0;
		for (let row = lastRow; row >= firstRow && budget > 1e-6 && capacity > 1e-9; row--) {
			for (let column = firstColumn; column <= lastColumn && budget > 1e-6 && capacity > 1e-9; column++) {
				const parcel = row * columns + column;
				const held = water[parcel];
				if (held <= 1e-6) continue;
				const take = Math.min(held, budget);
				const fraction = take / held;
				const offset = parcel * count;
				for (let m = 0; m < count && capacity > 1e-9; m++) {
					let mass = load[offset + m] * fraction;
					if (mass <= 0) continue;
					let value = loadValue[offset + m] * fraction;
					if (mass > capacity) { value *= capacity / mass; mass = capacity; }
					if (!root.SteamCeiling.loadWetCargo(world, machine, m, mass, value)) continue;
					load[offset + m] -= mass;
					loadValue[offset + m] -= value;
					loadTotal[parcel] -= mass;
					capacity -= mass;
					soluteMass += mass;
					totals.pumpedSolute += mass;
					totals.pumpedValue += value;
					const profile = profileFor('rig');
					profile.pumpedMass += mass;
					profile.pumpedValue += value;
				}
				water[parcel] -= take;
				budget -= take;
				lifted += take;
				totals.pumped += take;
			}
		}
		if (lifted <= 0) return 0;
		// The pump's work leaves the reserve and arrives as chamber heat: the lift
		// is real work, but the solute it lifted was already imported by the
		// chemistry, and the hopper books that solute at `g * cargoHeight`. The
		// brine leaves this module's fluid at the same moment, so that hopper
		// entry is imported mass-energy, not new energy.
		const joules = lifted * pumpJoulesPerUnit;
		const spent = Math.min(world.battery, joules);
		world.battery -= spent;
		world.heat += joules;
		world.importedEnergy += joules - spent + soluteMass * gravity * root.SteamCeiling.state.cargoHeight;
		totals.pumpJoules += joules;
		return lifted;
	}

	// ---- Step ----
	function step(target, dt) {
		if (!target || !root.SteamCeiling) return;
		world = target;
		const rock = root.SteamCeiling;
		rebuildSolidMask(rock);
		stepOwners(dt);
		stepDroplets(dt);
		// Standing water works the face before gravity drains it away, and before
		// the pump empties the parcels: only the brine that is left gets lifted.
		dissolveContacts(dt);
		stepFluid();
		stepPump(dt);
		stepGrains(dt);
		world = null;
	}

	function stepOwners(dt) {
		const roster = root.SteamPlayers && root.SteamPlayers.state.players;
		if (roster && roster.length) {
			for (let i = 0; i < roster.length; i++) stepOwner(dt, roster[i].id);
		} else stepOwner(dt, 'rig');
	}

	function stepOwner(dt, owner) {
		const profile = profileFor(owner);
		const left = profile.fireBudget - dt;
		profile.fireBudget = left > dt * 0.5 ? left : 0;
		if (!profile.autoFire && !profile.botFire) return;
		if (!autoFireAllowed(owner)) return;
		fire(world, owner);
	}

	function autoFireAllowed(owner) {
		return owner !== world.platform.id || world.battery >= root.SteamPhysics.config.battery * autoFireReserve;
	}

	// A bot only orders a jet its installed engine can replenish at the pad, and
	// only while its hopper has room for what the pump would lift. A hand press
	// is always allowed: the stream is the module's own rate limit, not a duty.
	function streamReady(target, owner) {
		const id = ownerIdOf(owner);
		if (!hasTool(id)) return false;
		const machine = root.SteamPhysics.machineById(target, id);
		if (!root.SteamCeiling.cargoSpace(target, machine)) return false;
		const engine = root.SteamPhysics.engineNow(id);
		return root.SteamPhysics.reserveNow(id) / engine.reload >= shotEnergy * dropletsPerSecond;
	}

	// ---- Metrics ----
	function createMetrics() {
		return {
			waterByMineral: new Float64Array(count), valueByMineral: new Float64Array(count),
			waterMass: 0, airborneWater: 0, brineMass: 0, brineValue: 0, maxSaturation: 0,
			grainCount: 0, grainMass: 0, grainValue: 0, waterDrift: 0,
			caughtMass: 0, caughtValue: 0
		};
	}

	// Reads only this module's own state plus the ceiling's cargo, so a caller can
	// pass a reusable buffer and the HUD never allocates.
	function measureMetrics(out) {
		const result = out || createMetrics();
		const byMineral = result.waterByMineral;
		const valueByMineral = result.valueByMineral;
		byMineral.fill(0);
		valueByMineral.fill(0);
		let waterMass = 0;
		let maxSaturation = 0;
		// Water in flight is still water: a droplet on its way to the face is
		// neither in a parcel nor pumped, so the conservation check must see it.
		let airborne = 0;
		for (let i = 0; i < maxDroplets; i++) if (dropState[i] === FLYING) airborne += dropWater[i];
		for (let parcel = 0; parcel < cellCount; parcel++) {
			waterMass += water[parcel];
			const offset = parcel * count;
			for (let m = 0; m < count; m++) {
				byMineral[m] += load[offset + m];
				valueByMineral[m] += loadValue[offset + m];
			}
			if (water[parcel] > 0.02 && loadTotal[parcel] > 0) {
				const saturation = loadTotal[parcel] / (water[parcel] * settings.satCap);
				if (saturation > maxSaturation) maxSaturation = saturation;
			}
		}
		let brineMass = 0;
		let brineValue = 0;
		for (let m = 0; m < count; m++) { brineMass += byMineral[m]; brineValue += valueByMineral[m]; }
		let grainCount = 0;
		let grainMassTotal = 0;
		let grainValueTotal = 0;
		for (let i = 0; i < maxGrains; i++) {
			if (!grainActive[i]) continue;
			grainCount++;
			grainMassTotal += grainMass[i];
			grainValueTotal += grainValue[i];
		}
		result.waterMass = waterMass + airborne;
		result.airborneWater = airborne;
		result.brineMass = brineMass;
		result.brineValue = brineValue;
		result.maxSaturation = maxSaturation;
		result.grainCount = grainCount;
		result.grainMass = grainMassTotal;
		result.grainValue = grainValueTotal;
		result.flooded = totals.flooded;
		result.pumped = totals.pumped;
		result.pumpedSolute = totals.pumpedSolute;
		result.pumpedValue = totals.pumpedValue;
		result.lostGasMass = totals.lostGasMass;
		result.lostGasValue = totals.lostGasValue;
		result.dissolvedMass = totals.dissolvedMass;
		result.cellDissolvedMass = totals.cellDissolvedMass;
		result.dissolvedCells = totals.dissolvedCells;
		result.residueMass = totals.residueMass;
		result.residueValue = totals.residueValue;
		result.settledMass = totals.settledMass;
		result.settledValue = totals.settledValue;
		result.caughtMass = totals.caughtMass;
		result.caughtValue = totals.caughtValue;
		result.pumpJoules = totals.pumpJoules;
		result.shotJoules = totals.shotJoules;
		result.droplets = totals.droplets;
		result.hops = totals.hops;
		// Water that left the parcels went into the hopper; nothing else removes it.
		result.waterDrift = Math.abs(totals.flooded - (waterMass + airborne + totals.pumped));
		return result;
	}

	// ---- Settings and orders ----
	function setSaturationCap(value) {
		const next = Number(value);
		if (Number.isFinite(next) && next > 0) settings.satCap = next;
		return settings.satCap;
	}

	function setDissolveRate(value) {
		const next = Number(value);
		if (Number.isFinite(next) && next >= 0) settings.dissolveRate = next;
		return settings.dissolveRate;
	}

	// The table law is the default; the formula law is the lab's own rule.
	function setModel(value) {
		settings.model = value === 'formula' ? 'formula' : 'table';
		return settings.model;
	}

	function setPump(on) { settings.pumpOn = Boolean(on); return settings.pumpOn; }
	function setErosion(on) { settings.erosion = Boolean(on); return settings.erosion; }

	// AIM is not a travel order: a click that sets the aim must never move the
	// platform's destination.
	function setAim(x, y) {
		if (Number.isFinite(x)) aim.x = clamp(x, 0, 24);
		if (Number.isFinite(y)) aim.y = clamp(y, 0, 15);
		return aim;
	}

	function setAutoFire(on, owner) {
		const profile = profileFor(owner);
		profile.autoFire = Boolean(on);
		return profile.autoFire;
	}

	function setBotFire(on, owner) {
		profileFor(owner).botFire = Boolean(on);
		return profileFor(owner).botFire;
	}

	function clearBotFire(owner) {
		profileFor(owner).botFire = false;
		return true;
	}

	// ---- Draw ----
	// One pass, no allocations in the frame: parcels are drawn as a single path
	// of filled squares tinted by the brine they carry, airborne droplets and
	// grains as dots, and the jet is never drawn as a line back to a nozzle that
	// has since moved. Everything is warped by the chamber's own perspective, so
	// water in the rock layer sits on the cells it touches.
	const tintScratch = { r: 0, g: 0, b: 0 };
	function draw(context) {
		const rock = root.SteamCeiling;
		if (!rock) return;
		context.save();
		// Pools: one translucent fill per parcel, so a pond reads as water and a
		// brine-rich parcel reads darker and greener without a second layer.
		for (let row = 0; row < rows; row++) {
			const y0 = rock.rockDrawnY(row * cellSize);
			const y1 = rock.rockDrawnY((row + 1) * cellSize);
			if (!(y1 > y0)) continue;
			for (let column = 0; column < columns; column++) {
				const parcel = row * columns + column;
				const held = water[parcel];
				if (held < 0.02) continue;
				const fill = Math.min(1, held / parcelCapacity);
				tintFor(parcel, fill);
				context.fillStyle = 'rgba(' + tintScratch.r + ',' + tintScratch.g + ',' + tintScratch.b + ',' + (0.18 + 0.42 * fill).toFixed(3) + ')';
				context.fillRect(column * cellSize, y0, cellSize + 0.002, y1 - y0 + 0.002);
			}
		}
		// The bright meniscus: the top water line of each column of parcels.
		context.fillStyle = 'rgba(198,238,255,0.55)';
		for (let column = 0; column < columns; column++) {
			let topRow = -1;
			for (let row = rows - 1; row >= 0; row--) if (water[row * columns + column] >= 0.1) { topRow = row; break; }
			if (topRow < 0) continue;
			const held = Math.min(1, water[topRow * columns + column]);
			const y = rock.rockDrawnY((topRow + 1) * cellSize);
			context.fillRect(column * cellSize, y, cellSize + 0.002, 0.03 + 0.02 * held);
		}
		// Droplets and grains keep the chamber's local scale, so a jet in the
		// layer is drawn at the size the cells there are drawn at.
		for (let i = 0; i < maxDroplets; i++) {
			if (dropState[i] !== FLYING) continue;
			const y = rock.rockDrawnY(dropY[i]);
			const scale = rock.perspectiveScale(dropY[i]);
			context.fillStyle = 'rgba(206,242,255,0.8)';
			context.beginPath();
			context.arc(dropX[i], y, 0.028 * scale, 0, Math.PI * 2);
			context.fill();
		}
		for (let i = 0; i < maxGrains; i++) {
			if (!grainActive[i]) continue;
			const y = rock.rockDrawnY(grainY[i]);
			const scale = rock.perspectiveScale(grainY[i]);
			context.fillStyle = '#c9b48a';
			context.beginPath();
			context.arc(grainX[i], y, 0.035 * scale, 0, Math.PI * 2);
			context.fill();
		}
		context.restore();
	}

	// Water colour: pale blue for fresh water, greener and darker as the brine
	// loads up, weighted by the dye each dissolved mineral carries.
	function tintFor(parcel, fill) {
		const offset = parcel * count;
		let mass = 0;
		let r = 0;
		let g = 0;
		let b = 0;
		for (let m = 0; m < count; m++) {
			const loaded = load[offset + m];
			if (loaded <= 0) continue;
			const dye = minerals.mineralTable[m].dye;
			if (!dye) continue;
			mass += loaded;
			r += dye[0] * loaded;
			g += dye[1] * loaded;
			b += dye[2] * loaded;
		}
		const fresh = 1 - fill * 0.35;
		if (mass <= 0) {
			tintScratch.r = Math.round(88 * fresh + 40);
			tintScratch.g = Math.round(150 * fresh + 60);
			tintScratch.b = Math.round(196 * fresh + 50);
			return;
		}
		const weight = Math.min(1, mass * 12);
		tintScratch.r = Math.round(88 * (1 - weight) + r / mass * weight);
		tintScratch.g = Math.round(150 * (1 - weight) + g / mass * weight);
		tintScratch.b = Math.round(196 * (1 - weight) + b / mass * weight);
	}

	function stateFor(owner) { return profileFor(owner).view; }

	function depthAt(x, y) { return water[cellIndexAt(x, y)]; }

	// Fill a rectangle with fresh water: a probe and test hook, not a game verb.
	// The mask is rebuilt first, because a caller fills before the first step and
	// water must never start inside rock.
	function fill(x0, y0, x1, y1) {
		if (root.SteamCeiling) rebuildSolidMask(root.SteamCeiling);
		const c0 = clamp(Math.floor(Math.min(x0, x1) / cellSize), 0, columns - 1);
		const c1 = clamp(Math.floor(Math.max(x0, x1) / cellSize), 0, columns - 1);
		const r0 = clamp(Math.floor(Math.min(y0, y1) / cellSize), 0, rows - 1);
		const r1 = clamp(Math.floor(Math.max(y0, y1) / cellSize), 0, rows - 1);
		let added = 0;
		for (let row = r0; row <= r1; row++) for (let column = c0; column <= c1; column++) {
			const parcel = row * columns + column;
			if (solidMask[parcel]) continue;
			const amount = parcelCapacity - water[parcel];
			if (amount <= 0) continue;
			water[parcel] += amount;
			totals.flooded += amount;
			added += amount;
		}
		return added;
	}

	const state = Object.freeze({
		columns, rows, cellSize, cellCount, parcelCapacity, maxDroplets, maxGrains,
		dropletsPerSecond, dropletWater, jetSpeed, shotEnergy, pumpJoulesPerUnit, pumpUnitsPerSecond,
		pumpHalfWidth, pumpDepth, satCapDefault, dissolveRateDefault,
		FREE, FLYING, HOPPING,
		get model() { return settings.model; },
		get satCap() { return settings.satCap; },
		get dissolveRate() { return settings.dissolveRate; },
		get pumpOn() { return settings.pumpOn; },
		get erosion() { return settings.erosion; },
		get aimX() { return aim.x; },
		get aimY() { return aim.y; },
		get nozzleX() { return nozzle.x; },
		get nozzleY() { return nozzle.y; },
		water, load, loadValue, loadTotal, flowU, solidMask,
		dropState, dropX, dropY, dropVx, dropVy, dropWater,
		grainActive, grainX, grainY, grainVx, grainVy, grainMass, grainValue, grainMineral,
		get totals() { return totals; },
		get waterFlooded() { return totals.flooded; },
		get waterPumped() { return totals.pumped; },
		get lostGasMass() { return totals.lostGasMass; },
		get lostGasValue() { return totals.lostGasValue; },
		get dissolvedCells() { return totals.dissolvedCells; }
	});

	const api = {
		state, stateFor, reset, step, measureMetrics, createMetrics, depthAt, fill,
		fire, canFire, setAim, setAutoFire, setBotFire, clearBotFire,
		setSaturationCap, setDissolveRate, setModel, setPump, setErosion,
		nozzleOf, cellIndexAt, settings, totals, draw, streamReady,
		water, load, loadValue, loadTotal, solidMask,
		dropState, dropX, dropY, dropWater, grainActive, grainX, grainY, grainMass, grainValue, grainMineral, maxGrains
	};
	root.SteamWater = api;
	if (node) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
