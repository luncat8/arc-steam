// Wild Mine mode state, vertical projection (D7), camera follow (D8),
// cave-grounded platform motion (M2) and the P1/P2 step owner. Lives behind a
// mode guard so Classic mode remains untouched.
//
// Depends on: js/cave.js, js/ceiling.js, js/physics.js, js/wild-rubble.js,
// js/wild-ball.js, js/wild-water.js, js/water.js
(function (root) {
	'use strict';
	const node = typeof module !== 'undefined' && module.exports;
	const caveApi = node ? require('./cave.js') : root.SteamCave;
	const physicsRef = node ? require('./physics.js') : root.SteamPhysics;
	const ballRef = node ? require('./wild-ball.js') : null;
	const water = node ? require('./wild-water.js') : root.SteamWildWater;
	const rubble = node ? require('./wild-rubble.js') : root.SteamWildRubble;
	const ceiling = node ? require('./ceiling.js') : root.SteamCeiling;

	function phys() { return physicsRef || root.SteamPhysics; }
	// Loaded after this file in the page, so the ball is resolved at call time.
	function ballApi() { return ballRef || root.SteamWildBall; }

	const pistonMaxAngle = Math.PI * 0.5;
	// D7 vertical scale: s(u) = 1 / (1 + 3u) anchored on the active ball's y,
	// falling to 0.25x at span = 16 m (matching the ~15 m drawn viewport) and
	// clamped at >= 0.25x beyond that.
	const scaleSpan = 16;
	const minScale = 0.25;
	const maxU = (1 / minScale - 1) / 3;
	const edgeIntegral = Math.log(1 + 3 * maxU) / 3;
	// D8 camera follow: critically damped at 2.5 /s toward the average of both
	// players.
	const cameraRate = 2.5;
	const viewWidth = 25.8;
	const viewHeight = 15;
	const deckClearanceLocalY = 0.74;
	const bumperMargin = 0.08;
	const bumperFloorY = 0.46;

	let mode = 'classic';
	let cave = null;
	let seed = 1;
	const camera = { x: 0, y: 31.5, vx: 0, vy: 0, anchorY: 31.5 };
	const inspectScratch = {
		solid: false,
		strength: 0,
		initialStrength: 0,
		damage: 0,
		value: 0,
		elements: new Float32Array(3),
		mix: null
	};

	function setMode(next) {
		if (mode === 'wild' && next !== 'wild') {
			rubble.reset(null);
			cave = null;
		}
		mode = next === 'wild' ? 'wild' : 'classic';
		return mode;
	}
	function getMode() { return mode; }
	function isWild() { return mode === 'wild'; }

	function activeBall(world) {
		if (!world) return null;
		if (world.balls && world.balls.length > 0) return world.balls[0];
		return world.ball || null;
	}

	function scaleAt(y, anchorY) {
		const anchor = anchorY === undefined ? camera.anchorY : anchorY;
		const u = Math.abs(y - anchor) / scaleSpan;
		return u >= maxU ? minScale : 1 / (1 + 3 * u);
	}

	function drawnY(y, anchorY) {
		const anchor = anchorY === undefined ? camera.anchorY : anchorY;
		const delta = y - anchor;
		const ad = Math.abs(delta) / scaleSpan;
		const mapped = ad <= maxU ? Math.log(1 + 3 * ad) / 3 : edgeIntegral + minScale * (ad - maxU);
		return anchor + (delta < 0 ? -mapped : mapped) * scaleSpan;
	}

	function worldY(drawn, anchorY) {
		const anchor = anchorY === undefined ? camera.anchorY : anchorY;
		const delta = drawn - anchor;
		const ad = Math.abs(delta) / scaleSpan;
		const worldAd = ad <= edgeIntegral ? (Math.exp(3 * ad) - 1) / 3 : maxU + (ad - edgeIntegral) / minScale;
		return anchor + (delta < 0 ? -worldAd : worldAd) * scaleSpan;
	}

	function cameraTarget(world) {
		const platform = world.platform;
		const ball = activeBall(world);
		if (!ball) {
			camera.anchorY = platform.y;
			return { x: platform.x, y: platform.y };
		}
		camera.anchorY = ball.y;
		return { x: (platform.x + ball.x) * 0.5, y: (platform.y + ball.y) * 0.5 };
	}

	const targetPoint = { x: 0, y: 31.5 };
	function readCameraTarget(world) {
		const platform = world.platform;
		const ball = activeBall(world);
		if (!ball) {
			camera.anchorY = platform.y;
			targetPoint.x = platform.x;
			targetPoint.y = platform.y;
			return;
		}
		camera.anchorY = ball.y;
		targetPoint.x = (platform.x + ball.x) * 0.5;
		targetPoint.y = (platform.y + ball.y) * 0.5;
	}

	function stepCamera(world, dt) {
		if (!world || !(dt > 0)) return;
		readCameraTarget(world);
		const w = cameraRate;
		const exp = Math.exp(-w * dt);
		const ex = camera.x - targetPoint.x;
		const ey = camera.y - targetPoint.y;
		const nextVx = (camera.vx - (camera.vx + w * ex) * w * dt) * exp;
		const nextVy = (camera.vy - (camera.vy + w * ey) * w * dt) * exp;
		camera.x = targetPoint.x + (ex + (camera.vx + w * ex) * dt) * exp;
		camera.y = targetPoint.y + (ey + (camera.vy + w * ey) * dt) * exp;
		camera.vx = nextVx;
		camera.vy = nextVy;
	}

	function groundAt(x, refY) {
		if (!cave) return 0;
		let probeY = Number.isFinite(refY) ? refY : camera.y;
		// When a pitched hull samples within a couple of cells of a low tunnel
		// roof, step just below the ceiling into the open passage rather than
		// mistaking the roof cell for a floor ledge.
		if (cave.solidAt(x, probeY)) {
			const cell = cave.state.cell;
			for (let drop = 1; drop <= 3; drop++) {
				const below = probeY - drop * cell;
				if (!cave.solidAt(x, below)) { probeY = below; break; }
			}
		}
		const floor = rubble.crestAt(x, probeY);
		return Number.isFinite(floor) ? floor : 0;
	}

	// Loose soil is not a second rock layer: only a fifth of the fracture
	// budget reaches the supporting rock, distributed across four times the radius.
	function strike(x, y, energy, owner, throughSoil = false) {
		const radius = ceiling.damageRadiusNow(owner);
		return cave.weaken(x, y, throughSoil ? energy * 0.2 : energy, ceiling.damageMultiplierNow(owner),
			throughSoil ? 4 * radius : radius, throughSoil);
	}

	function rockOpened(column, row, fractured) {
		rubble.rockOpened(column, row);
		if (fractured) ballApi().spawnFragment(cave, column, row);
	}

	function hullClear(x, y, angle) {
		if (!cave) return true;
		const p = phys();
		const half = p.config.platformWidth * 0.5;
		const cosine = Math.cos(angle);
		const sine = Math.sin(angle);
		const samples = Math.max(1, Math.ceil((half * 2) / cave.state.cell));
		const span = (half * 2) / samples;
		for (let i = 0; i <= samples; i++) {
			const localX = -half + span * i;
			const lowY = Math.max(bumperFloorY, p.hullDepthAt(localX) + bumperMargin);
			if (cave.solidAt(x + localX * cosine - lowY * sine, y + localX * sine + lowY * cosine)) return false;
			if (cave.solidAt(x + localX * cosine - deckClearanceLocalY * sine, y + localX * sine + deckClearanceLocalY * cosine)) return false;
		}
		return true;
	}

	function absorbImpact(world, platform) {
		const mass = phys().platformMass(world);
		world.heat += 0.5 * mass * platform.vx * platform.vx;
		platform.vx = 0;
	}

	function constrainPlatform(world) {
		if (!cave) return;
		const platform = world.platform;
		if (hullClear(platform.x, platform.y, platform.angle)) return;
		const prevX = platform.previousX;
		if (prevX === platform.x) {
			absorbImpact(world, platform);
			return;
		}
		if (hullClear(prevX, platform.y, platform.angle)) {
			let good = prevX;
			let bad = platform.x;
			for (let step = 0; step < 8; step++) {
				const mid = (good + bad) * 0.5;
				if (hullClear(mid, platform.y, platform.angle)) good = mid;
				else bad = mid;
			}
			platform.x = good;
			absorbImpact(world, platform);
			return;
		}
		platform.x = prevX;
		absorbImpact(world, platform);
	}

	function protectHull(world, dt) {
		if (!cave) return;
		const platform = world.platform;
		if (hullClear(platform.x, platform.y, platform.angle)) return;
		if (hullClear(platform.x, platform.y, platform.previousAngle)) {
			let good = platform.previousAngle;
			let bad = platform.angle;
			for (let step = 0; step < 6; step++) {
				const mid = (good + bad) * 0.5;
				if (hullClear(platform.x, platform.y, mid)) good = mid;
				else bad = mid;
			}
			platform.angle = good;
		} else if (hullClear(platform.x, platform.previousY, platform.previousAngle)) {
			platform.y = platform.previousY;
			platform.angle = platform.previousAngle;
		} else if (hullClear(platform.previousX, platform.previousY, platform.previousAngle)) {
			platform.x = platform.previousX;
			platform.y = platform.previousY;
			platform.angle = platform.previousAngle;
			absorbImpact(world, platform);
		}
		if (dt > 0) {
			platform.stepVx = (platform.x - platform.previousX) / dt;
			platform.stepVy = (platform.y - platform.previousY) / dt;
			platform.stepOmega = (platform.angle - platform.previousAngle) / dt;
			platform.vy = platform.stepVy;
			platform.omega = platform.stepOmega;
		}
	}

	function init(world, options) {
		const opts = options || {};
		if (opts.seed !== undefined) seed = opts.seed;
		cave = caveApi.create({ seed, onOpen: rockOpened });
		rubble.reset(cave);
		if (root.SteamWildCart && root.SteamWildCart.reset) root.SteamWildCart.reset();
		if (root.SteamWildBore && root.SteamWildBore.reset) root.SteamWildBore.reset();
		// Wild rubble re-lays at the finer 1.5:1 tile, not the chamber's 4:1
		// default (the plan's D9); classic keeps whatever the select says.
		ceiling.setFloorCompression(opts.compression === undefined ? 1.5 : opts.compression);
		// The road grader ships with the machine: the wild blade is what pays
		// for the ore, so it is preinstalled rather than sold.
		if (root.SteamEquipment && root.SteamEquipment.grant) root.SteamEquipment.grant('grader', world);
		ballApi().init(world);
		const startX = cave.state.spawnX;
		cave.stream(startX - viewWidth, startX + viewWidth, Infinity);
		if (world) {
			world.wildWater = water.create(cave, seed);
			const p = phys();
			const platform = world.platform;
			const startFloor = cave.floorBelow(startX, cave.state.spawnY + 1);
			platform.x = startX;
			platform.y = Number.isFinite(startFloor) ? startFloor : cave.state.shelfRow * cave.state.cell;
			platform.angle = 0;
			platform.vx = 0;
			platform.vy = 0;
			platform.omega = 0;
			platform.spin = 0;
			platform.previousX = platform.x;
			platform.previousY = platform.y;
			platform.previousAngle = 0;
			platform.stepVx = 0;
			platform.stepVy = 0;
			platform.stepOmega = 0;
			platform.wheelDrop[0] = 0;
			platform.wheelDrop[1] = 0;
			const ball = activeBall(world);
			if (ball) {
				ball.state = 'held';
				ball.holder = platform.id;
				ball.vx = 0;
				ball.vy = 0;
				p.setHeldBallPose(world, ball);
			}
			readCameraTarget(world);
			camera.x = targetPoint.x;
			camera.y = targetPoint.y;
			camera.vx = 0;
			camera.vy = 0;
			world.initialEnergy = p.totalEnergy(world);
		} else {
			camera.x = startX;
			camera.y = cave.state.spawnY;
			camera.vx = 0;
			camera.vy = 0;
			camera.anchorY = cave.state.spawnY;
		}
		return cave;
	}

	function step(world, dt) {
		if (!world || !cave) return;
		// No charge pad in the cave: the installed engine burns cargo fuel to
		// keep the reserve up before this frame's work is paid for.
		if (root.SteamFuel) root.SteamFuel.step(world, dt);
		if (root.SteamWildBore) root.SteamWildBore.step(world, cave, dt);
		const p = phys();
		p.movePlatform(world, dt);
		p.updatePlatformTerrain(world, dt);
		protectHull(world, dt);
		water.stepIntake(world, dt);
		if (root.SteamWater) root.SteamWater.stepWild(world, cave, dt);
		p.advancePiston(world, dt);
		// The Wild blade works connected rubble while moving. Smooth mode keeps
		// material for ramps; angle-following modes settle their shaved value.
		if (root.SteamEquipment && root.SteamEquipment.isInstalled('grader')) rubble.grade(world, dt);
		// The service cart's arrival and dwell are part of the frame.
		if (root.SteamWildCart && root.SteamWildCart.step) root.SteamWildCart.step(world, dt);
		const ballModule = ballApi();
		if (ballModule) ballModule.step(world, cave, dt);
		p.cool(world, dt);
		world.time += dt;
		stepCamera(world, dt);
		// Stream the union of the camera and both players so a ball that sprints
		// ahead of the follow still has rock, at 1 fresh chunk per frame.
		const halfSpan = viewWidth * 0.75;
		let minX = camera.x - halfSpan;
		let maxX = camera.x + halfSpan;
		const plateX = world.platform.x;
		if (plateX - halfSpan < minX) minX = plateX - halfSpan;
		if (plateX + halfSpan > maxX) maxX = plateX + halfSpan;
		const flying = activeBall(world);
		if (flying) {
			if (flying.x - halfSpan < minX) minX = flying.x - halfSpan;
			if (flying.x + halfSpan > maxX) maxX = flying.x + halfSpan;
		}
		cave.stream(minX, maxX, 1);
	}

	function inspectCell(column, row, materials, prices) {
		if (!cave || row < 0 || row >= cave.state.rows) {
			inspectScratch.solid = false;
			return inspectScratch;
		}
		if (!inspectScratch.mix) inspectScratch.mix = new Float32Array(materials.valueInto ? prices.length : 6);
		const x = cave.worldX(column);
		const y = cave.worldY(row);
		const solid = cave.solidAt(x, y);
		inspectScratch.solid = solid;
		cave.mixAt(column, row, inspectScratch.mix, inspectScratch.elements);
		inspectScratch.initialStrength = materials.strengthInto(inspectScratch.mix, 0);
		inspectScratch.strength = solid ? cave.strengthAt(column, row) : 0;
		inspectScratch.damage = solid ? cave.damageAt(column, row) : 0;
		inspectScratch.value = materials.valueInto(inspectScratch.mix, 0, prices);
		return inspectScratch;
	}

	const api = {
		pistonMaxAngle, scaleSpan, minScale, cameraRate, viewWidth, viewHeight,
		setMode, getMode, isWild,
		get cave() { return cave; },
		get seed() { return seed; },
		camera,
		scaleAt, drawnY, worldY, cameraTarget, stepCamera,
		groundAt, hullClear, constrainPlatform, protectHull, strike,
		init, step, inspectCell
	};
	root.SteamWildMine = api;
	if (node) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
