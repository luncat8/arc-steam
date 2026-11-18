// Wild Mine service cart (D10, simplified by the design owner): when the rig's
// hopper is full — or whenever it is not empty once a minute — a service cart
// arrives from the foreground (the z-axis storyline, not the cave simulation),
// waits beside the platform for a click to sell, and disappears. A HUD
// checkbox sets autosell, in which case it sells on arrival without a click.
//
// The sale hands the cart's keep-back rule to the economy: it sells everything
// in the hopper except 20% of each fuel-grade mineral (the minerals the
// engine burns — everything else is ore and sells outright), credits the
// funds at the live quote through ceiling.sellCargoKeeping, and books one
// frozen 'sell' ledger entry exactly like a wall sale.
//
// The cart never drives the cave: there are no waypoints, no collision, no
// physics. It is a rendered arrival and a transaction.
//
// Depends on: js/ceiling.js (cargo + the sale), js/fuel.js (fuel-grade
// tables), js/minerals.js (ids), js/physics.js (wild mode guard via the
// caller — wild-mine.step only runs this in wild).
(function (root) {
	'use strict';
	const node = typeof module !== 'undefined' && module.exports;
	const ceilingRef = node ? require('./ceiling.js') : root.SteamCeiling;
	const mineralsRef = node ? require('./minerals.js') : root.SteamMinerals;
	const fuelRef = node ? require('./fuel.js') : root.SteamFuel;

	function ceiling() { return ceilingRef || root.SteamCeiling; }
	function minerals() { return mineralsRef || root.SteamMinerals; }
	function fuel() { return fuelRef || root.SteamFuel; }

	// The 20% fuel reservation: every discipline burns only its own family, so
	// the reservation spans all three (any of them may end up in the hopper).
	const KEEP_FRACTION = 0.2;
	const INTERVAL = 60;      // seconds between scheduled services
	const DWELL = 30;         // seconds the docked cart waits for a click
	const LINGER = 2.2;       // seconds it lingers after selling
	const ARRIVE_TIME = 2.4;  // seconds of the foreground slide-in
	const DEPART_TIME = 1.6;  // seconds of the slide-out

	// state: 'hidden' → 'arriving' → 'docked' → 'departing' → 'hidden'
	let state = 'hidden';
	let anim = 0;
	let dwell = 0;
	let linger = 0;
	let lastDepart = 0; // run start: the first scheduled call lands a minute in
	let autosell = false;
	let lastSale = null; // { credits, cells, time }
	// Canvas-space rectangle of the drawn cart, for the click hit test. The
	// renderer writes it every frame; the pointer handler reads it.
	let bounds = null;

	function reset() {
		state = 'hidden';
		anim = 0;
		dwell = 0;
		linger = 0;
		lastDepart = 0; // a fresh run's first scheduled call lands a minute in
		lastSale = null;
		bounds = null;
	}

	// Indices of every mineral any engine burns, resolved once from the live
	// yield tables so this file never hard-codes a mineral name.
	let fuelIndices = null;
	function fuelGradeIndices() {
		if (fuelIndices) return fuelIndices;
		fuelIndices = [];
		const f = fuel();
		const m = minerals();
		const tables = f && f.yieldsById;
		if (!tables || !m) return fuelIndices;
		const ids = m.mineralIds;
		const flagged = new Set();
		for (let g = 0; g < tables.length; g++) {
			const table = tables[g];
			for (const key of Object.keys(table)) flagged.add(key);
		}
		for (let i = 0; i < ids.length; i++) if (flagged.has(ids[i])) fuelIndices.push(i);
		return fuelIndices;
	}

	// The cart's keep-back: 20% of every fuel-grade mineral in the hopper.
	function keepReservation() {
		const c = ceiling();
		const count = minerals().mineralCount;
		const keep = new Float64Array(count);
		const cargo = c.state.cargoMinerals;
		const wanted = fuelGradeIndices();
		for (let i = 0; i < wanted.length; i++) keep[wanted[i]] = cargo[wanted[i]] * KEEP_FRACTION;
		return keep;
	}

	// Sell the hopper now. Returns the credits banked (0 when there was
	// nothing to sell — the cart still departs on schedule either way).
	function sell(world) {
		const c = ceiling();
		if (!c || !c.sellCargoKeeping || !world) return 0;
		const plate = world.platform;
		if (!(c.state.cargoCells > 0)) {
			return 0;
		}
		const cellsBefore = c.state.cargoCells;
		const credits = c.sellCargoKeeping(keepReservation(), plate ? plate.vx : 0, world.time);
		if (credits > 0) {
			lastSale = { credits, cells: cellsBefore - c.state.cargoCells, time: world.time };
			// The sale closes the stop: linger a beat, then the cart is gone.
			linger = LINGER;
		}
		return credits;
	}

	function beginDepart() {
		state = 'departing';
	}

	function dispatchCheck(world) {
		const c = ceiling();
		if (!c || !c.state) return;
		const cargo = c.state.cargoCells || 0;
		const full = cargo >= c.state.storageLimit - 1e-9;
		const due = cargo > 0 && (world.time - lastDepart) >= INTERVAL;
		if (full || due) {
			state = 'arriving';
			anim = 0;
			lastSale = null;
		}
	}

	function step(world, dt) {
		if (!world || !(dt > 0)) return;
		const c = ceiling();
		if (!c || !c.state) return;
		switch (state) {
			case 'hidden':
				dispatchCheck(world);
				return;
			case 'arriving':
				anim = Math.min(1, anim + dt / ARRIVE_TIME);
				if (anim >= 1) {
					state = 'docked';
					dwell = DWELL;
					linger = 0;
					if (autosell) sell(world);
				}
				return;
			case 'docked':
				if (linger > 0) {
					linger -= dt;
					if (linger <= 0) beginDepart();
					return;
				}
				dwell -= dt;
				if (dwell <= 0) beginDepart();
				return;
			case 'departing':
				anim = Math.max(0, anim - dt / DEPART_TIME);
				if (anim <= 0) {
					state = 'hidden';
					lastDepart = world.time;
				}
				return;
		}
	}

	function stateReadout() {
		return {
			state, anim, autosell,
			lastSale,
			keepFraction: KEEP_FRACTION
		};
	}

	function setAutosell(value) {
		autosell = Boolean(value);
	}

	// The renderer publishes the drawn rectangle (canvas CSS pixels) and the
	// pointer handler tests it.
	function setBounds(rect) {
		bounds = rect;
	}

	function hitTest(x, y) {
		if (!bounds) return false;
		return x >= bounds.x && x <= bounds.x + bounds.w && y >= bounds.y && y <= bounds.y + bounds.h;
	}

	// Read-only snapshot for tests and hit-testing aids; the live object is not exposed.
	function snapshotBounds() {
		return bounds ? { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h } : null;
	}

	const api = {
		KEEP_FRACTION, INTERVAL, DWELL,
		step, reset, sell, setAutosell, setBounds, hitTest, bounds: snapshotBounds,
		state: stateReadout,
		get autosell() { return autosell; }
	};
	root.SteamWildCart = api;
	if (node) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
