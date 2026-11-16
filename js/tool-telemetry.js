(function (root) {
	'use strict';
	// Expected-value-per-energy telemetry for active mining tools (credits per kJ
	// drawn from the energy reserve). Estimates mirror the live ball-fracture,
	// sandblaster, water-gun/pump and road-grader mechanics into caller-owned
	// storage with zero per-frame allocations so HUD readouts can compare every
	// tool directly against the paid emergency fuel quote.
	//
	// Depends on (at call time): js/ceiling.js, js/physics.js, js/equipment.js,
	// js/sandblaster.js, js/water.js, js/players.js, js/prediction.js
	const node = typeof module !== 'undefined' && module.exports;
	const gravity = 9.81;

	function clamp(value, low, high) {
		return value < low ? low : value > high ? high : value;
	}

	function ownerIdOf(owner) {
		return owner && typeof owner === 'object' ? owner.id : owner || 'rig';
	}

	function createSummary() {
		return {
			owner: 'rig',
			fuelPrice: 0,
			commune: false,
			bestTool: '',
			bestValuePerKJ: 0,
			ball: {
				installed: true,
				ready: false,
				active: false,
				targetX: 12,
				valuePerUse: 0,
				energyPerUseKJ: 0,
				valuePerKJ: 0,
				viableFuel: false
			},
			sandblaster: {
				installed: false,
				ready: false,
				active: false,
				dry: false,
				targetX: 12,
				valuePerUse: 0,
				energyPerUseKJ: 0,
				valuePerKJ: 0,
				viableFuel: false
			},
			watergun: {
				installed: false,
				ready: false,
				active: false,
				targetX: 12,
				valuePerUse: 0,
				energyPerUseKJ: 0,
				valuePerKJ: 0,
				brinePerKJ: 0,
				gasLossPerKJ: 0,
				pumpIdle: true,
				viableFuel: false
			},
			grader: {
				installed: false,
				ready: false,
				active: false,
				targetX: 12,
				valuePerUse: 0,
				energyPerUseKJ: 0,
				valuePerKJ: 0,
				viableFuel: false
			}
		};
	}

	function isViable(valuePerKJ, commune, fuelPrice) {
		return valuePerKJ > 0 && (commune || valuePerKJ >= fuelPrice);
	}

	function resetBall(out, targetX) {
		out.installed = true;
		out.ready = false;
		out.active = false;
		out.targetX = targetX;
		out.valuePerUse = 0;
		out.energyPerUseKJ = 0;
		out.valuePerKJ = 0;
		out.viableFuel = false;
	}

	function measureBall(world, id, machine, body, out, ceiling, physics, prediction) {
		const config = physics.config;
		const isRig = machine === world;
		const balls = world.balls || [];
		let pushable = 0;
		for (let i = 0; i < balls.length; i++) if (physics.mayPush(balls[i], id)) pushable++;
		const focus = physics.focusBallOf(world, id);
		let targetX = body.x;
		if (prediction && prediction.platformId === id) {
			const trace = prediction.state;
			if (trace.kind === prediction.kinds.ROCK) {
				targetX = clamp(trace.endX, 0, config.width);
			} else if (trace.uncertain && focus && focus.state === 'flying' && focus.vy > 0 && trace.samples > 0) {
				let bestY = -Infinity;
				let bestX = focus.x;
				for (let i = 0; i < trace.samples; i++) {
					if (trace.pathY[i] > bestY) {
						bestY = trace.pathY[i];
						bestX = trace.pathX[i];
					}
				}
				targetX = clamp(bestX, 0, config.width);
			} else if (focus && focus.state === 'flying') {
				targetX = clamp(focus.x, 0, config.width);
			}
		} else if (focus && focus.state === 'flying') {
			targetX = clamp(focus.x, 0, config.width);
		}
		resetBall(out, targetX);
		if (pushable === 0) return;

		const pulse = physics.pulseNow(id);
		const reserveJ = physics.reserveCost(pulse, id);
		out.ready = !isRig || (physics.thermalFactor(world) > 0 && world.battery >= reserveJ);
		out.active = physics.machineDrive(machine);

		const retention = physics.retentionNow(id);
		const rockRetention = physics.rockRetentionNow(id);
		const steadyE = pulse / Math.max(0.05, 1 - retention * rockRetention);
		const faceY = ceiling.surfaceAt(targetX);
		const deck = body.y + config.deck;
		const ballMass = focus ? physics.ballMassFor(focus) : physics.ballMassNow(id);
		const keCeil = Math.max(0.5 * pulse, steadyE - ballMass * config.ballGravity * Math.max(0, faceY - deck));
		const impactJ = keCeil * (1 - rockRetention);

		const state = ceiling.state;
		const columns = state.columns;
		const rows = state.rows;
		const radius = ceiling.damageRadiusNow(id);
		const gain = ceiling.damageMultiplierNow(id);
		const falloff = state.damageFalloffPower;
		const hitCap = state.hitLooseCap;
		const debrisLimit = state.collapseStrengthLimit;
		const centerColumn = clamp(Math.floor(targetX / state.cell), 0, columns - 1);
		const range = Math.ceil(radius);
		const firstRow = state.firstRow;
		const strength = state.strength;
		const initialStrength = state.initialStrength;
		const prices = state.prices;

		let expectedValue = 0;
		for (let dc = -range; dc <= range; dc++) {
			const column = centerColumn + dc;
			if (column < 0 || column >= columns) continue;
			const baseRow = firstRow[column];
			for (let dr = 0; dr <= 1; dr++) {
				const row = baseRow + dr;
				if (row >= rows) continue;
				const distance = Math.hypot(dc, dr);
				if (distance > radius) continue;
				const index = row * columns + column;
				const before = strength[index];
				if (before <= 0) continue;
				const init = initialStrength[index] || before;
				const weight = Math.pow(Math.max(0, 1 - distance / radius), falloff);
				const amount = Math.min(impactJ * gain * weight, before * hitCap);
				const denom = Math.max(0.15 * init, before - debrisLimit + 0.08 * init);
				const share = Math.min(1, amount / denom);
				expectedValue += share * prices[index] * (dr === 0 ? 1 : 0.35);
			}
		}

		const energyKJ = reserveJ / 1000;
		out.valuePerUse = expectedValue;
		out.energyPerUseKJ = energyKJ;
		out.valuePerKJ = energyKJ > 0 ? expectedValue / energyKJ : 0;
	}

	function resetSandblaster(out, targetX) {
		out.installed = false;
		out.ready = false;
		out.active = false;
		out.dry = false;
		out.targetX = targetX;
		out.valuePerUse = 0;
		out.energyPerUseKJ = 0;
		out.valuePerKJ = 0;
		out.viableFuel = false;
	}

	function measureSandblaster(world, id, body, out, ceiling, physics, equipment, sand) {
		const installed = Boolean(equipment && equipment.isInstalled('sandblaster', id) && sand);
		const nozzleX = physics.sandblasterNozzleX(world, id);
		resetSandblaster(out, nozzleX);
		if (!installed) return;

		out.installed = true;
		out.dry = sand.feed(world, id) < 0;
		out.ready = sand.canFire(world, id);
		out.active = Boolean(sand.stateFor(id).autoFire || out.ready);

		const state = ceiling.state;
		const columns = state.columns;
		const rows = state.rows;
		const col = clamp(Math.floor(nozzleX / state.cell), 0, columns - 1);
		const row = state.firstRow[col];
		if (row >= rows) return;
		const index = row * columns + col;
		const before = state.strength[index];
		if (before <= 0) return;

		const sandState = sand.state;
		const shotEnergy = sandState.shotEnergy;
		const rate = sandState.rate;
		const grainMass = sandState.grainMass;
		const faceY = ceiling.surfaceAt(nozzleX);
		const impactJ = Math.max(1, shotEnergy + grainMass * gravity * (state.cargoHeight - faceY));
		const hitCap = state.hitLooseCap;
		const debrisLimit = state.collapseStrengthLimit;
		let remaining = before;
		let hits = 0;
		while (remaining > debrisLimit && hits < 32) {
			remaining -= Math.min(impactJ, remaining * hitCap);
			hits++;
		}
		if (hits < 1) hits = 1;
		const collapseWaste = (1 - Math.min(1, Math.abs(body.vx) / (state.cell * rate))) * 0.5 * rate * 0.25;
		const grains = hits + collapseWaste;
		const energyKJ = grains * physics.reserveCost(shotEnergy, id) / 1000;
		const value = state.prices[index];
		out.valuePerUse = value;
		out.energyPerUseKJ = energyKJ;
		out.valuePerKJ = energyKJ > 0 ? value / energyKJ : 0;
	}

	function resetWater(out, targetX) {
		out.installed = false;
		out.ready = false;
		out.active = false;
		out.targetX = targetX;
		out.valuePerUse = 0;
		out.energyPerUseKJ = 0;
		out.valuePerKJ = 0;
		out.brinePerKJ = 0;
		out.gasLossPerKJ = 0;
		out.pumpIdle = true;
		out.viableFuel = false;
	}

	function resetGrader(out, targetX) {
		out.installed = false;
		out.ready = false;
		out.active = false;
		out.targetX = targetX;
		out.valuePerUse = 0;
		out.energyPerUseKJ = 0;
		out.valuePerKJ = 0;
		out.viableFuel = false;
	}

	function measureGrader(world, id, machine, body, out, ceiling, physics, equipment) {
		const installed = Boolean(equipment && equipment.isInstalled('grader', id));
		resetGrader(out, body.x);
		if (!installed) return;

		out.installed = true;
		const isRig = machine === world;
		const state = ceiling.state;
		const half = state.graderSwath * 0.5;
		const first = Math.max(1, Math.floor((body.x - half) / state.cell));
		const last = Math.min(state.columns - 2, Math.floor((body.x + half) / state.cell));
		const floorPiles = state.floorPiles;
		const floorValues = state.floorValues;
		let shaved = 0;
		for (let column = first; column <= last; column++) {
			const h = floorPiles[column];
			if (h <= 0) continue;
			const cut = Math.min(h, state.graderCut);
			shaved += cut * (floorValues[column] / h);
		}
		const share = state.commune ? 0 : state.graderShare;
		const valuePerSecond = shaved * share;
		const speed = Math.max(Math.abs(body.vx), Math.min(4, physics.speedNow(id) * 0.25));
		const energyKJ = physics.reserveCost(physics.config.graderFriction * speed, id) / 1000;
		const moving = Math.abs(body.vx) > 0.02 || (isRig && world.direction !== 0);
		out.ready = (!isRig || physics.thermalFactor(world) > 0) && valuePerSecond > 0;
		out.active = moving && valuePerSecond > 0;
		out.valuePerUse = valuePerSecond;
		out.energyPerUseKJ = energyKJ;
		out.valuePerKJ = energyKJ > 0 ? valuePerSecond / energyKJ : 0;
	}

	function measure(world, owner, out) {
		const target = out || createSummary();
		const id = ownerIdOf(owner);
		const ceiling = root.SteamCeiling;
		const physics = root.SteamPhysics;
		const equipment = root.SteamEquipment;
		const sand = root.SteamSandblaster;
		const water = root.SteamWater;
		const prediction = root.SteamPrediction;

		target.owner = id;
		if (!world || !ceiling || !physics) return target;

		const commune = Boolean(ceiling.state.commune);
		const fuelPrice = commune ? 0 : ceiling.state.fuelPrice;
		target.commune = commune;
		target.fuelPrice = fuelPrice;

		const machine = physics.machineById(world, id);
		const body = physics.machineBody(machine);

		measureBall(world, id, machine, body, target.ball, ceiling, physics, prediction);
		target.ball.viableFuel = isViable(target.ball.valuePerKJ, commune, fuelPrice);

		measureSandblaster(world, id, body, target.sandblaster, ceiling, physics, equipment, sand);
		target.sandblaster.viableFuel = isViable(target.sandblaster.valuePerKJ, commune, fuelPrice);

		if (water && typeof water.estimateYield === 'function') {
			water.estimateYield(world, id, target.watergun);
		} else {
			resetWater(target.watergun, body.x);
		}
		target.watergun.viableFuel = isViable(target.watergun.valuePerKJ, commune, fuelPrice);

		measureGrader(world, id, machine, body, target.grader, ceiling, physics, equipment);
		target.grader.viableFuel = isViable(target.grader.valuePerKJ, commune, fuelPrice);

		let bestTool = '';
		let bestValuePerKJ = 0;
		if (target.ball.valuePerKJ > bestValuePerKJ) {
			bestTool = 'ball';
			bestValuePerKJ = target.ball.valuePerKJ;
		}
		if (target.sandblaster.installed && target.sandblaster.valuePerKJ > bestValuePerKJ) {
			bestTool = 'sandblaster';
			bestValuePerKJ = target.sandblaster.valuePerKJ;
		}
		if (target.watergun.installed && target.watergun.valuePerKJ > bestValuePerKJ) {
			bestTool = 'watergun';
			bestValuePerKJ = target.watergun.valuePerKJ;
		}
		if (target.grader.installed && target.grader.valuePerKJ > bestValuePerKJ) {
			bestTool = 'grader';
			bestValuePerKJ = target.grader.valuePerKJ;
		}
		target.bestTool = bestTool;
		target.bestValuePerKJ = bestValuePerKJ;
		return target;
	}

	const api = { createSummary, measure };
	root.SteamToolTelemetry = api;
	if (node) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
