// Wild Mine liquid: finite seeps and spray runoff on the cave's own cells.
// Only liquid in the tank contributes to the rig's mechanical ledger.
(function (root) {
	'use strict';
	const node = typeof module !== 'undefined' && module.exports;
	const physics = node ? require('./physics.js') : root.SteamPhysics;
	const capacity = 12;
	const cellCapacity = 1;
	const condensateFraction = 0.25;
	const condensateYield = 24000;
	const intakeRate = 2.6;
	const handRate = 0.3;
	const intakeWork = 120;
	const intakeHalfWidth = 1.58;
	const intakeReach = 0.6;
	const liftPerKg = physics.config.gravity * physics.config.deck;
	const epsilon = 1e-9;

	function seepBand(seed, column, row) {
		let hash = seed ^ Math.imul(Math.floor(column / 16), 0x9e3779b1) ^ Math.imul(Math.floor(row / 8), 0x85ebca6b);
		hash = Math.imul(hash ^ hash >>> 16, 0x7feb352d);
		hash = Math.imul(hash ^ hash >>> 15, 0x846ca68b);
		return ((hash ^ hash >>> 16) >>> 0) < 0x20000000;
	}

	function createField(cave, seed) {
		const { cell, chunkColumns, rows, pad, stride, shelfRow, spawnX } = cave.state;
		const generated = new WeakMap();
		const edits = new Map();

		function cellsFor(chunk) {
			let cells = generated.get(chunk);
			if (cells) return cells;
			cells = new Map();
			const { solid, dug, column0 } = chunk;
			for (let row = 1; row < rows - 1; row++) {
				const offset = row * stride + pad;
				for (let local = 0; local < chunkColumns; local++) {
					const i = offset + local;
					// Read the original floor even if a ball dug here before the first view.
					if (solid[i] || dug[i] || !(solid[i - stride] || dug[i - stride])) continue;
					const column = column0 + local;
					const fromSpawn = cave.worldX(column) - spawnX;
					const starter = row === shelfRow && Math.abs(fromSpawn) < 4;
					if (starter ? fromSpawn < 1 || fromSpawn >= 3.5 : !seepBand(seed, column, row)) continue;
					const key = row * chunkColumns + local;
					cells.set(key, { key, water: cellCapacity * (1 - condensateFraction), condensate: cellCapacity * condensateFraction });
				}
			}
			const changed = edits.get(chunk.index);
			if (changed) for (const liquid of changed.values()) {
				if (liquid.water + liquid.condensate > 0) cells.set(liquid.key, liquid);
				else cells.delete(liquid.key);
			}
			generated.set(chunk, cells);
			return cells;
		}

		// Keep only changes on eviction, including zeroes that mask drained seeps.
		function remember(chunk, cells, liquid) {
			let changed = edits.get(chunk.index);
			if (!changed) {
				changed = new Map();
				edits.set(chunk.index, changed);
			}
			changed.set(liquid.key, liquid);
			if (liquid.water + liquid.condensate > 0) cells.set(liquid.key, liquid);
			else cells.delete(liquid.key);
		}

		function collect(tank, body, budget) {
			const pitch = Math.tan(body.angle);
			const first = cave.columnAt(body.x - intakeHalfWidth);
			const last = cave.columnAt(body.x + intakeHalfWidth);
			let remaining = budget;
			for (let column = first; column <= last && remaining > 0; column++) {
				const offset = cave.worldX(column) - body.x;
				if (Math.abs(offset) > intakeHalfWidth) continue;
				const chunk = cave.chunkFor(column);
				const local = column - chunk.column0;
				const cells = cellsFor(chunk);
				if (cells.size === 0) continue;
				const y = body.y + offset * pitch;
				const top = Math.min(rows - 1, cave.rowAt(y + physics.config.platformBodyBottom));
				const bottom = Math.max(0, cave.rowAt(y - intakeReach));
				for (let row = top; row >= bottom && remaining > 0; row--) {
					if (chunk.solid[row * stride + local + pad]) break;
					const liquid = cells.get(row * chunkColumns + local);
					if (!liquid) continue;
					const mass = liquid.water + liquid.condensate;
					const take = Math.min(remaining, mass);
					const share = take / mass;
					const fuel = liquid.condensate * share;
					const water = liquid.water * share;
					liquid.water -= water;
					liquid.condensate -= fuel;
					tank.water += water;
					tank.condensate += fuel;
					tank.collectedWater += water;
					tank.collectedCondensate += fuel;
					remaining -= take;
					remember(chunk, cells, liquid);
				}
			}
			return budget - remaining;
		}

		function returnWater(x, y, amount) {
			if (cave.solidAt(x, y)) return 0;
			const floor = cave.floorBelow(x, y);
			if (!Number.isFinite(floor)) return 0;
			const column = cave.columnAt(x);
			const chunk = cave.chunkFor(column);
			const key = cave.rowAt(floor) * chunkColumns + column - chunk.column0;
			const cells = cellsFor(chunk);
			let liquid = cells.get(key);
			if (!liquid) liquid = { key, water: 0, condensate: 0 };
			const returned = Math.min(amount, cellCapacity - liquid.water - liquid.condensate);
			if (returned <= 0) return 0;
			liquid.water += returned;
			remember(chunk, cells, liquid);
			return returned;
		}

		return { cellsFor, collect, returnWater };
	}

	function create(cave, seed) {
		return {
			field: createField(cave, seed), water: 0, condensate: 0, intakeOn: true, intakeStatus: 'dry',
			collectedWater: 0, collectedCondensate: 0, sprayedWater: 0, airborneDrops: 0,
			returnedWater: 0, drainedWater: 0, discardedWater: 0, burnedCondensate: 0,
			get mass() { return this.water + this.condensate; },
			get potential() { return this.mass * liftPerKg; }
		};
	}

	function stepIntake(world, dt) {
		const tank = world.wildWater;
		if (!tank || !(dt > 0)) return 0;
		if (!tank.intakeOn) { tank.intakeStatus = 'off'; return 0; }
		const room = capacity - tank.mass;
		if (room <= epsilon) { tank.intakeStatus = 'full'; return 0; }
		const hand = world.battery <= epsilon;
		if (!hand && physics.thermalFactor(world) <= 0) { tank.intakeStatus = 'hot'; return 0; }
		const affordable = world.battery * physics.engineNow().efficiency / intakeWork;
		const limit = hand ? handRate * dt : Math.min(intakeRate * dt, affordable);
		const oldMass = physics.platformMass(world);
		const lifted = tank.field.collect(tank, world.platform, Math.min(room, limit));
		if (!(lifted > 0)) { tank.intakeStatus = 'dry'; return 0; }
		const work = lifted * intakeWork;
		if (hand) {
			world.importedEnergy += work;
			world.crankEnergy += work;
		}
		const delivered = hand ? work : physics.spend(world, work);
		world.heat += delivered - lifted * liftPerKg;
		physics.applyMassChange(world, lifted, oldMass);
		tank.intakeStatus = hand ? 'hand' : 'pumping';
		return lifted;
	}

	function discharge(world, component, mass) {
		const tank = world.wildWater;
		const removed = Math.min(tank[component], mass);
		tank[component] -= removed;
		physics.applyMassChange(world, -removed);
		world.heat += removed * liftPerKg;
		return removed;
	}

	// The waste valve frees tank room with a flat reserve without spilling over
	// the same intake. Only the water side is drained, not the recovered fuel.
	function drain(world) {
		const tank = world.wildWater;
		if (!tank || tank.water <= 0) return 0;
		const removed = discharge(world, 'water', tank.water);
		tank.discardedWater += removed;
		return removed;
	}

	function spray(world, mass) {
		const tank = world.wildWater;
		tank.sprayedWater += discharge(world, 'water', mass);
		tank.airborneDrops++;
	}

	function settle(tank, x, y, mass) {
		const returned = tank.field.returnWater(x, y, mass);
		tank.airborneDrops--;
		tank.returnedWater += returned;
		tank.drainedWater += mass - returned;
	}

	function takeFuel(world, chemical) {
		const tank = world.wildWater;
		if (!tank || tank.condensate <= 0) return 0;
		const removed = discharge(world, 'condensate', chemical / condensateYield);
		tank.burnedCondensate += removed;
		return Math.min(chemical, removed * condensateYield);
	}

	const api = { capacity, cellCapacity, condensateFraction, condensateYield, intakeRate, handRate, intakeWork,
		create, stepIntake, drain, spray, settle, takeFuel };
	root.SteamWildWater = api;
	if (node) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
