(function (root) {
	'use strict';

	// Water & cave fluid prototype lab.
	// Compares three fluid models in the game's exact 24 x 15 m chamber scale:
	//   1. hybrid — ballistic aimed jet droplets feeding a 2D hydrostatic + wave-momentum cell grid
	//   2. sph    — unified 2D Double-Density Relaxation (Clavet et al.) particle fluid
	//   3. flip   — incompressible 2D staggered MAC-grid FLIP/PIC hybrid
	// All three share the same 192 x 120 rock occupancy + SDF, drivable 3.6 m platform,
	// unlimited-tank water gun, under-platform suction pump, rock dissolution -> slurry
	// conservation, and smooth Marching Squares visible-surface renderer.

	const WORLD_W = 24;
	const WORLD_H = 15;
	const GRAVITY = 9.81;

	const R_COLS = 192;
	const R_ROWS = 120;
	const R_CELL = WORLD_W / R_COLS; // 0.125 m (exact game rock cell)
	const R_COUNT = R_COLS * R_ROWS;

	const F_COLS = 96;
	const F_ROWS = 60;
	const F_CELL = WORLD_W / F_COLS; // 0.25 m (2x2 rock cells per fluid cell)
	const F_COUNT = F_COLS * F_ROWS;
	const F_AREA = F_CELL * F_CELL;

	const N_COLS = F_COLS + 1;
	const N_ROWS = F_ROWS + 1;
	const N_COUNT = N_COLS * N_ROWS;

	// Platform dimensions matching js/physics.js
	const PLAT_W = 3.6;
	const PLAT_HALF = PLAT_W * 0.5;
	const PLAT_DECK = 0.7;
	const WHEEL_HALF = 1.6;
	const WHEEL_R = 0.18;
	const NOZZLE_LOCAL_X = -PLAT_HALF + PLAT_W * 0.35 * 0.5; // -1.17 m (collector centre)
	const NOZZLE_LOCAL_Y = PLAT_DECK + 0.14;
	const SUCTION_HALF = 1.58;

	// Rock occupancy & materials
	const rockSolid = new Uint8Array(R_COUNT); // 0 open, 1 intact rock, 2 rubble
	const rockStrength = new Float32Array(R_COUNT);
	const rockMineral = new Uint8Array(R_COUNT);
	const rockSdf = new Float32Array(R_COUNT);
	const distOut = new Float32Array(R_COUNT);
	const distIn = new Float32Array(R_COUNT);
	const fSolid = new Uint8Array(F_COUNT);
	const fOpenCount = new Uint8Array(F_COUNT);

	// Game-aligned mineral palette (stone, sand, copper, iron, gold, quartz)
	const mineralPalette = [
		[84, 96, 102],
		[176, 156, 114],
		[184, 116, 82],
		[126, 138, 152],
		[214, 174, 78],
		[176, 194, 202]
	];

	// Shared smooth surface nodal buffers (zero hot-path allocations)
	const nodeVal = new Float32Array(N_COUNT);
	const nodeWeight = new Float32Array(N_COUNT);
	const nodeSlurry = new Float32Array(N_COUNT);
	const nodeWet = new Float32Array(N_COUNT);
	const nodeValScratch = new Float32Array(N_COUNT);
	const cellSurfH = new Float32Array(F_COUNT);
	const cellSurfH2 = new Float32Array(F_COUNT);

	// Marching Squares contour segment scratch buffer: [x1, y1, x2, y2, nx, ny, slurry]
	const MAX_SEGS = F_COUNT * 2;
	const segData = new Float32Array(MAX_SEGS * 7);
	let segCount = 0;

	// ---- Solver 1: Hybrid (Ballistic Jet + 2D Hydrostatic + Wave-Momentum Cells) ----
	const MAX_JET = 900;
	const jetActive = new Uint8Array(MAX_JET);
	const jetX = new Float32Array(MAX_JET);
	const jetY = new Float32Array(MAX_JET);
	const jetVx = new Float32Array(MAX_JET);
	const jetVy = new Float32Array(MAX_JET);
	const jetVol = new Float32Array(MAX_JET);
	const jetSlurry = new Float32Array(MAX_JET);
	const jetAge = new Float32Array(MAX_JET);
	const jetKind = new Uint8Array(MAX_JET); // 0 = pressurized gun jet, 1 = waterfall cascade
	let jetCursor = 0;

	const cellWater = new Float32Array(F_COUNT);
	const cellSlurry = new Float32Array(F_COUNT);
	const cellFall = new Float32Array(F_COUNT);
	const edgeU = new Float32Array((F_COLS + 1) * F_ROWS);
	const HYBRID_MAX_COMP = 0.028;

	// ---- Solver 2: Particle (2D SPH / Double-Density Relaxation) ----
	const MAX_SPH = 1800;
	const SPH_H = 0.36;
	const SPH_INV_H = 1 / SPH_H;
	const SPH_AREA = 0.017;
	const SPH_REST_DENS = 3.2;
	const SPH_K = 0.016;
	const SPH_K_NEAR = 0.042;
	const SPH_SIGMA = 0.14;
	const SPH_BETA = 0.24;
	const sphActive = new Uint8Array(MAX_SPH);
	const sphX = new Float32Array(MAX_SPH);
	const sphY = new Float32Array(MAX_SPH);
	const sphPrevX = new Float32Array(MAX_SPH);
	const sphPrevY = new Float32Array(MAX_SPH);
	const sphVx = new Float32Array(MAX_SPH);
	const sphVy = new Float32Array(MAX_SPH);
	const sphSlurry = new Float32Array(MAX_SPH);
	const sphAge = new Float32Array(MAX_SPH);
	let sphCount = 0;

	const HASH_COLS = Math.ceil(WORLD_W / SPH_H) + 1;
	const HASH_ROWS = Math.ceil(WORLD_H / SPH_H) + 1;
	const HASH_COUNT = HASH_COLS * HASH_ROWS;
	const hashHead = new Int32Array(HASH_COUNT);
	const partNext = new Int32Array(MAX_SPH);
	const sphNbrIdx = new Int32Array(96);
	const sphNbrQ = new Float32Array(96);
	const sphNbrDx = new Float32Array(96);
	const sphNbrDy = new Float32Array(96);

	// ---- Solver 3: Grid + Particle (2D FLIP / PIC on Staggered MAC Grid) ----
	const MAX_FLIP = 2400;
	const FLIP_REST_DENS = 4.0;
	const FLIP_AREA = F_AREA / FLIP_REST_DENS; // 0.015625 m^2
	const FLIP_MIN_DIST = 0.11;
	const FLIP_RATIO = 0.88;
	const flipActive = new Uint8Array(MAX_FLIP);
	const flipX = new Float32Array(MAX_FLIP);
	const flipY = new Float32Array(MAX_FLIP);
	const flipVx = new Float32Array(MAX_FLIP);
	const flipVy = new Float32Array(MAX_FLIP);
	const flipSlurry = new Float32Array(MAX_FLIP);
	let flipCount = 0;

	const MAC_U_STRIDE = F_COLS + 1;
	const MAC_U_COUNT = MAC_U_STRIDE * F_ROWS;
	const MAC_V_COUNT = F_COLS * (F_ROWS + 1);
	const macU = new Float32Array(MAC_U_COUNT);
	const macV = new Float32Array(MAC_V_COUNT);
	const macPrevU = new Float32Array(MAC_U_COUNT);
	const macPrevV = new Float32Array(MAC_V_COUNT);
	const macDu = new Float32Array(MAC_U_COUNT);
	const macDv = new Float32Array(MAC_V_COUNT);
	const macType = new Uint8Array(F_COUNT); // 0 air, 1 fluid, 2 solid
	const macDens = new Float32Array(F_COUNT);
	const flipHashHead = new Int32Array(F_COUNT);
	const flipPartNext = new Int32Array(MAX_FLIP);

	// Marching Squares lookup tables (CCW polygons; vertex codes 0..3 corners, 4..7 edges e0..e3)
	// Corners: 0=(0,0), 1=(1,0), 2=(1,1), 3=(0,1). Edges: 4=bot, 5=right, 6=top, 7=left.
	const MS_POLY = [
		null,
		[0, 4, 7],
		[1, 5, 4],
		[0, 1, 5, 7],
		[2, 6, 5],
		null, // saddle 5 handled explicitly
		[1, 2, 6, 4],
		[0, 1, 2, 6, 7],
		[3, 7, 6],
		[0, 4, 6, 3],
		null, // saddle 10 handled explicitly
		[0, 1, 5, 6, 3],
		[2, 3, 7, 5],
		[0, 4, 5, 2, 3],
		[1, 2, 3, 7, 4],
		null // full 15 merged into horizontal runs
	];
	const MS_SEG = [
		null,
		[7, 4],
		[4, 5],
		[7, 5],
		[5, 6],
		null,
		[4, 6],
		[7, 6],
		[6, 7],
		[6, 4],
		null,
		[6, 5],
		[5, 7],
		[5, 4],
		[4, 7],
		null
	];
	const vtxX = new Float32Array(8);
	const vtxY = new Float32Array(8);

	// Simulation state & settings
	const state = {
		solver: 'hybrid',
		scene: 'classic',
		tool: 'gun',
		renderMode: 'smooth',
		pumpOn: true,
		autoFire: false,
		dissolveOn: true,
		paused: false,
		jetSpeed: 17,
		flowRate: 1.0,
		pumpRate: 1.2,
		dissolveRate: 1.0,
		time: 0,
		fireBudget: 0,
		pumpCarry: 0,
		suctionPulse: 0,
		lastSuctionRate: 0,
		// Conservation & accounting metrics
		floodedArea: 0,
		pumpedArea: 0,
		dissolvedCells: 0,
		hopperSlurry: 0,
		// Timing telemetry
		simMs: 0,
		drawMs: 0,
		fps: 60,
		rockDirty: true
	};

	const platform = {
		x: 12,
		y: 0,
		vx: 0,
		angle: 0,
		minX: 2.0,
		maxX: WORLD_W - 2.0
	};

	const input = {
		left: false,
		right: false,
		fireKey: false,
		pointerDown: false,
		rightDown: false,
		aimX: 12,
		aimY: 11.5
	};

	let rngState = 0x13579bdf;
	function rand() {
		rngState = (rngState + 0x6D2B79F5) | 0;
		let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	function clamp(v, lo, hi) {
		return v < lo ? lo : v > hi ? hi : v;
	}

	function hash2(c, r, seed) {
		let h = Math.imul(c, 374761393) + Math.imul(r, 668265263) + Math.imul(seed, 1442695041);
		h = (h ^ (h >>> 13)) | 0;
		h = Math.imul(h, 1274126177);
		return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
	}

	function smoothNoise(x, y, seed) {
		const ix = Math.floor(x);
		const iy = Math.floor(y);
		const fx = x - ix;
		const fy = y - iy;
		const ux = fx * fx * (3 - 2 * fx);
		const uy = fy * fy * (3 - 2 * fy);
		const a = hash2(ix, iy, seed);
		const b = hash2(ix + 1, iy, seed);
		const c = hash2(ix, iy + 1, seed);
		const d = hash2(ix + 1, iy + 1, seed);
		return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
	}

	// ---- Rock Occupancy & Exact Chamfer SDF ----

	function pickMineral(c, r, kind) {
		if (kind === 2) return (c + r) & 1 ? 1 : 0;
		const n1 = smoothNoise(c * 0.08, r * 0.14, 11);
		const n2 = smoothNoise(c * 0.11, r * 0.18, 29);
		if (n1 > 0.78 && n2 > 0.62) return 4; // gold seam
		if (n1 > 0.67) return 2; // copper
		if (n2 > 0.70) return 3; // iron
		if (n1 < 0.24 && n2 > 0.52) return 5; // quartz
		if (n2 < 0.25) return 1; // sand
		return 0; // stone
	}

	function setRockCell(c, r, kind) {
		if (c < 0 || c >= R_COLS || r < 0 || r >= R_ROWS) return;
		const idx = r * R_COLS + c;
		rockSolid[idx] = kind;
		if (kind === 0) {
			rockStrength[idx] = 0;
			return;
		}
		rockMineral[idx] = pickMineral(c, r, kind);
		rockStrength[idx] = kind === 2 ? 0.45 : 0.75 + 0.5 * hash2(c, r, 7);
	}

	function rebuildSdfAndFluidMask() {
		const INF = 1e5;
		const DIAG = 1.41421356;
		for (let i = 0; i < R_COUNT; i++) {
			if (rockSolid[i]) {
				distOut[i] = 0;
				distIn[i] = INF;
			} else {
				distOut[i] = INF;
				distIn[i] = 0;
			}
		}
		// Forward pass (bottom-left to top-right)
		for (let r = 0; r < R_ROWS; r++) {
			const row = r * R_COLS;
			for (let c = 0; c < R_COLS; c++) {
				const i = row + c;
				let o = distOut[i];
				let n = distIn[i];
				if (c > 0) {
					const ol = distOut[i - 1] + 1;
					const nl = distIn[i - 1] + 1;
					if (ol < o) o = ol;
					if (nl < n) n = nl;
				}
				if (r > 0) {
					const od = distOut[i - R_COLS] + 1;
					const nd = distIn[i - R_COLS] + 1;
					if (od < o) o = od;
					if (nd < n) n = nd;
					if (c > 0) {
						const odl = distOut[i - R_COLS - 1] + DIAG;
						const ndl = distIn[i - R_COLS - 1] + DIAG;
						if (odl < o) o = odl;
						if (ndl < n) n = ndl;
					}
					if (c + 1 < R_COLS) {
						const odr = distOut[i - R_COLS + 1] + DIAG;
						const ndr = distIn[i - R_COLS + 1] + DIAG;
						if (odr < o) o = odr;
						if (ndr < n) n = ndr;
					}
				}
				distOut[i] = o;
				distIn[i] = n;
			}
		}
		// Backward pass (top-right to bottom-left)
		for (let r = R_ROWS - 1; r >= 0; r--) {
			const row = r * R_COLS;
			for (let c = R_COLS - 1; c >= 0; c--) {
				const i = row + c;
				let o = distOut[i];
				let n = distIn[i];
				if (c + 1 < R_COLS) {
					const or = distOut[i + 1] + 1;
					const nr = distIn[i + 1] + 1;
					if (or < o) o = or;
					if (nr < n) n = nr;
				}
				if (r + 1 < R_ROWS) {
					const ou = distOut[i + R_COLS] + 1;
					const nu = distIn[i + R_COLS] + 1;
					if (ou < o) o = ou;
					if (nu < n) n = nu;
					if (c > 0) {
						const oul = distOut[i + R_COLS - 1] + DIAG;
						const nul = distIn[i + R_COLS - 1] + DIAG;
						if (oul < o) o = oul;
						if (nul < n) n = nul;
					}
					if (c + 1 < R_COLS) {
						const our = distOut[i + R_COLS + 1] + DIAG;
						const nur = distIn[i + R_COLS + 1] + DIAG;
						if (our < o) o = our;
						if (nur < n) n = nur;
					}
				}
				distOut[i] = o;
				distIn[i] = n;
				rockSdf[i] = (o - n) * R_CELL;
			}
		}
		// Coarsen rock occupancy to fluid grid (2x2 rock cells per fluid cell)
		for (let fr = 0; fr < F_ROWS; fr++) {
			const r0 = fr * 2;
			for (let fc = 0; fc < F_COLS; fc++) {
				const c0 = fc * 2;
				let open = 0;
				if (!rockSolid[r0 * R_COLS + c0]) open++;
				if (!rockSolid[r0 * R_COLS + c0 + 1]) open++;
				if (!rockSolid[(r0 + 1) * R_COLS + c0]) open++;
				if (!rockSolid[(r0 + 1) * R_COLS + c0 + 1]) open++;
				const fi = fr * F_COLS + fc;
				fOpenCount[fi] = open;
				fSolid[fi] = open <= 2 ? 1 : 0;
			}
		}
		// Evict any cell water newly buried inside user-built rock into open neighbors
		for (let fr = 0; fr < F_ROWS; fr++) {
			for (let fc = 0; fc < F_COLS; fc++) {
				const fi = fr * F_COLS + fc;
				if (!fSolid[fi] || cellWater[fi] <= 0) continue;
				const w = cellWater[fi];
				const s = cellSlurry[fi];
				cellWater[fi] = 0;
				cellSlurry[fi] = 0;
				const target = findNearestOpenFluidCell(fc, fr);
				if (target >= 0) {
					cellWater[target] += w;
					cellSlurry[target] += s;
				}
			}
		}
		state.rockDirty = true;
	}

	function findNearestOpenFluidCell(fc, fr) {
		for (let rad = 1; rad <= 6; rad++) {
			for (let dr = -rad; dr <= rad; dr++) {
				for (let dc = -rad; dc <= rad; dc++) {
					const c = fc + dc;
					const r = fr + dr;
					if (c < 0 || c >= F_COLS || r < 0 || r >= F_ROWS) continue;
					const idx = r * F_COLS + c;
					if (!fSolid[idx]) return idx;
				}
			}
		}
		return -1;
	}

	function sampleSdf(x, y) {
		const gx = clamp(x / R_CELL - 0.5, 0, R_COLS - 1.001);
		const gy = clamp(y / R_CELL - 0.5, 0, R_ROWS - 1.001);
		const c0 = gx | 0;
		const r0 = gy | 0;
		const fx = gx - c0;
		const fy = gy - r0;
		const i00 = r0 * R_COLS + c0;
		const d0 = rockSdf[i00] + (rockSdf[i00 + 1] - rockSdf[i00]) * fx;
		const d1 = rockSdf[i00 + R_COLS] + (rockSdf[i00 + R_COLS + 1] - rockSdf[i00 + R_COLS]) * fx;
		let d = d0 + (d1 - d0) * fy;
		// Chamber outer walls
		if (x < d) d = x;
		if (WORLD_W - x < d) d = WORLD_W - x;
		if (y < d) d = y;
		if (WORLD_H - y < d) d = WORLD_H - y;
		return d;
	}

	const sdfGradOut = { d: 0, nx: 0, ny: 1 };
	function sampleSdfGrad(x, y) {
		const eps = R_CELL * 0.65;
		const d = sampleSdf(x, y);
		const dx = sampleSdf(x + eps, y) - sampleSdf(x - eps, y);
		const dy = sampleSdf(x, y + eps) - sampleSdf(x, y - eps);
		const len = Math.hypot(dx, dy);
		sdfGradOut.d = d;
		if (len > 1e-6) {
			sdfGradOut.nx = dx / len;
			sdfGradOut.ny = dy / len;
		} else {
			sdfGradOut.nx = 0;
			sdfGradOut.ny = 1;
		}
		return sdfGradOut;
	}

	function dissolveRockAt(x, y, amount) {
		if (!state.dissolveOn || amount <= 0) return 0;
		const cc = clamp(Math.floor(x / R_CELL), 0, R_COLS - 1);
		const cr = clamp(Math.floor(y / R_CELL), 0, R_ROWS - 1);
		let dissolved = 0;
		let changed = false;
		for (let dr = -1; dr <= 1; dr++) {
			const r = cr + dr;
			if (r <= 1 || r >= R_ROWS - 1) continue; // preserve bottom bedrock & top border
			for (let dc = -1; dc <= 1; dc++) {
				const c = cc + dc;
				if (c <= 0 || c >= R_COLS - 1) continue;
				const idx = r * R_COLS + c;
				if (!rockSolid[idx]) continue;
				const w = (dc === 0 && dr === 0) ? 1.0 : 0.35;
				rockStrength[idx] -= amount * w * state.dissolveRate;
				if (rockStrength[idx] <= 0) {
					rockSolid[idx] = 0;
					rockStrength[idx] = 0;
					dissolved += 1;
					state.dissolvedCells += 1;
					changed = true;
				} else {
					state.rockDirty = true;
				}
			}
		}
		if (changed) rebuildSdfAndFluidMask();
		return dissolved;
	}

	// ---- Platform Terrain Following (works inside caves with overhead roofs) ----

	function floorBelow(x, refY) {
		const c = clamp(Math.floor(x / R_CELL), 0, R_COLS - 1);
		const startR = clamp(Math.floor(refY / R_CELL), 0, R_ROWS - 1);
		for (let r = startR; r >= 0; r--) {
			if (rockSolid[r * R_COLS + c]) return (r + 1) * R_CELL;
		}
		return 0;
	}

	function updatePlatformPose(dt) {
		const driveAccel = 18;
		const maxVx = 8.5;
		const drag = 7.5;
		let ax = 0;
		if (input.left) ax -= driveAccel;
		if (input.right) ax += driveAccel;
		if (ax !== 0) {
			platform.vx = clamp(platform.vx + ax * dt, -maxVx, maxVx);
		} else {
			platform.vx *= Math.exp(-drag * dt);
			if (Math.abs(platform.vx) < 0.02) platform.vx = 0;
		}
		const nextX = clamp(platform.x + platform.vx * dt, platform.minX, platform.maxX);
		// Block driving straight into vertical cave walls
		const refY = platform.y + 1.2;
		const leadX = nextX + (platform.vx >= 0 ? PLAT_HALF : -PLAT_HALF);
		const leadFloor = floorBelow(leadX, refY);
		if (leadFloor - platform.y > 0.72) {
			platform.vx = 0;
		} else {
			platform.x = nextX;
		}
		const leftY = floorBelow(platform.x - WHEEL_HALF, platform.y + 1.15);
		const midY = floorBelow(platform.x, platform.y + 1.15);
		const rightY = floorBelow(platform.x + WHEEL_HALF, platform.y + 1.15);
		const targetAngle = clamp(Math.atan2(rightY - leftY, WHEEL_HALF * 2), -0.45, 0.45);
		const targetY = Math.max((leftY + rightY) * 0.5, midY - 0.14);
		const alpha = 1 - Math.exp(-16 * dt);
		platform.angle += (targetAngle - platform.angle) * alpha;
		platform.y += (targetY - platform.y) * alpha;
	}

	const nozzleOut = { x: 0, y: 0, dx: 0, dy: 1 };
	function getNozzle() {
		const c = Math.cos(platform.angle);
		const s = Math.sin(platform.angle);
		nozzleOut.x = platform.x + NOZZLE_LOCAL_X * c - NOZZLE_LOCAL_Y * s;
		nozzleOut.y = platform.y + NOZZLE_LOCAL_X * s + NOZZLE_LOCAL_Y * c;
		let dx = input.aimX - nozzleOut.x;
		let dy = input.aimY - nozzleOut.y;
		if (dy < -0.35) dy = -0.35;
		const len = Math.hypot(dx, dy);
		if (len > 1e-5) {
			nozzleOut.dx = dx / len;
			nozzleOut.dy = dy / len;
		} else {
			nozzleOut.dx = 0;
			nozzleOut.dy = 1;
		}
		return nozzleOut;
	}

	// ---- Water Clearing & Injection Helpers ----

	function clearWater() {
		jetActive.fill(0);
		cellWater.fill(0);
		cellSlurry.fill(0);
		cellFall.fill(0);
		edgeU.fill(0);
		sphActive.fill(0);
		sphCount = 0;
		flipActive.fill(0);
		flipCount = 0;
		macU.fill(0);
		macV.fill(0);
		state.floodedArea = 0;
		state.pumpedArea = 0;
		state.dissolvedCells = 0;
		state.hopperSlurry = 0;
		state.lastSuctionRate = 0;
		state.pumpCarry = 0;
	}

	function spawnWaterBlob(wx, wy, vx, vy, volCells, slurry) {
		if (state.solver === 'hybrid') {
			const fc = clamp(Math.floor(wx / F_CELL), 0, F_COLS - 1);
			const fr = clamp(Math.floor(wy / F_CELL), 0, F_ROWS - 1);
			let fi = fr * F_COLS + fc;
			if (fSolid[fi]) fi = findNearestOpenFluidCell(fc, fr);
			if (fi < 0) return false;
			cellWater[fi] += volCells;
			cellSlurry[fi] += slurry;
			state.floodedArea += volCells * F_AREA;
			return true;
		}
		if (state.solver === 'sph') {
			return spawnSphParticle(wx, wy, vx, vy, slurry);
		}
		return spawnFlipParticle(wx, wy, vx, vy, slurry);
	}

	function spawnJetDroplet(x, y, vx, vy, volCells, slurry, kind, countAsFlood) {
		for (let tries = 0; tries < MAX_JET; tries++) {
			const i = (jetCursor + tries) % MAX_JET;
			if (jetActive[i]) continue;
			jetCursor = (i + 1) % MAX_JET;
			jetActive[i] = 1;
			jetX[i] = x;
			jetY[i] = y;
			jetVx[i] = vx;
			jetVy[i] = vy;
			jetVol[i] = volCells;
			jetSlurry[i] = slurry || 0;
			jetAge[i] = 0;
			jetKind[i] = kind || 0;
			if (countAsFlood) state.floodedArea += volCells * F_AREA;
			return true;
		}
		return false;
	}

	function spawnSphParticle(x, y, vx, vy, slurry) {
		for (let i = 0; i < MAX_SPH; i++) {
			if (sphActive[i]) continue;
			sphActive[i] = 1;
			sphX[i] = x;
			sphY[i] = y;
			sphPrevX[i] = x;
			sphPrevY[i] = y;
			sphVx[i] = vx;
			sphVy[i] = vy;
			sphSlurry[i] = slurry;
			sphAge[i] = 0;
			sphCount++;
			state.floodedArea += SPH_AREA;
			return true;
		}
		return false;
	}

	function spawnFlipParticle(x, y, vx, vy, slurry) {
		for (let i = 0; i < MAX_FLIP; i++) {
			if (flipActive[i]) continue;
			flipActive[i] = 1;
			flipX[i] = x;
			flipY[i] = y;
			flipVx[i] = vx;
			flipVy[i] = vy;
			flipSlurry[i] = slurry;
			flipCount++;
			state.floodedArea += FLIP_AREA;
			return true;
		}
		return false;
	}

	function fillWaterBox(xMin, xMax, yMin, yMax) {
		if (state.solver === 'hybrid') {
			const c0 = clamp(Math.floor(xMin / F_CELL), 0, F_COLS - 1);
			const c1 = clamp(Math.floor(xMax / F_CELL), 0, F_COLS - 1);
			const r0 = clamp(Math.floor(yMin / F_CELL), 0, F_ROWS - 1);
			const r1 = clamp(Math.floor(yMax / F_CELL), 0, F_ROWS - 1);
			for (let r = r0; r <= r1; r++) {
				for (let c = c0; c <= c1; c++) {
					const fi = r * F_COLS + c;
					if (fSolid[fi]) continue;
					cellWater[fi] = 1.0;
					state.floodedArea += F_AREA;
				}
			}
			return;
		}
		const spacing = state.solver === 'sph' ? 0.145 : 0.125;
		for (let y = yMin + spacing * 0.5; y < yMax; y += spacing) {
			for (let x = xMin + spacing * 0.5; x < xMax; x += spacing) {
				if (sampleSdf(x, y) < 0.08) continue;
				const jx = (rand() - 0.5) * 0.025;
				const jy = (rand() - 0.5) * 0.025;
				if (state.solver === 'sph') {
					if (!spawnSphParticle(x + jx, y + jy, 0, 0, 0)) return;
				} else {
					if (!spawnFlipParticle(x + jx, y + jy, 0, 0, 0)) return;
				}
			}
		}
	}

	// ---- Four Test Scenes (Classic Chamber, Caves & Ledges, Wild Mine U-Tube, Dam Breach) ----

	function loadScene(name) {
		state.scene = name;
		rockSolid.fill(0);
		rockStrength.fill(0);
		clearWater();

		if (name === 'classic') {
			// Exact 24 x 15 m classic chamber: ceiling rock from y = 11.375..15, uneven rubble mounds on floor
			const ceilStartRow = Math.round(11.375 / R_CELL);
			for (let r = ceilStartRow; r < R_ROWS; r++) {
				for (let c = 0; c < R_COLS; c++) setRockCell(c, r, 1);
			}
			// Bottom bedrock strip (2 rock cells = 0.25 m) + flanking rubble mounds creating a central catch basin
			for (let c = 0; c < R_COLS; c++) {
				const x = (c + 0.5) * R_CELL;
				const mound1 = Math.exp(-Math.pow((x - 4.8) / 2.2, 2)) * 1.15;
				const mound2 = Math.exp(-Math.pow((x - 19.0) / 2.4, 2)) * 1.25;
				const lip = Math.exp(-Math.pow((x - 15.6) / 1.1, 2)) * 0.32;
				const h = 0.25 + mound1 + mound2 + lip;
				const topR = Math.floor(h / R_CELL);
				for (let r = 0; r < topR; r++) setRockCell(c, r, r < 2 ? 1 : 2);
			}
			platform.x = 12;
			platform.minX = 2.0;
			platform.maxX = WORLD_W - 2.0;
			input.aimX = 10.6;
			input.aimY = 11.6;
		} else if (name === 'caves') {
			// Terraced 2D caves, arches, overhangs, upper catch pocket, lower basin
			for (let r = 0; r < R_ROWS; r++) {
				for (let c = 0; c < R_COLS; c++) {
					const x = (c + 0.5) * R_CELL;
					const y = (r + 0.5) * R_CELL;
					let solid = r < 2 || r >= R_ROWS - 6 || c < 3 || c >= R_COLS - 3;
					// Upper rock shelf on left with arched roof & catch basin lip
					if (x < 10.5 && y > 8.2 && y < 9.4) solid = true;
					if (x > 8.6 && x < 9.4 && y >= 9.4 && y < 10.2) solid = true; // lip for upper pond
					// Mid overhang ledge on right
					if (x > 12.2 && y > 5.4 && y < 6.6) solid = true;
					if (x > 12.2 && x < 13.0 && y >= 6.6 && y < 7.3) solid = true; // lip
					// Rounded ceiling stalactite / arch
					const archY = 12.6 - 1.5 * Math.sin((x / WORLD_W) * Math.PI);
					if (y > archY + 1.1 * Math.cos((x - 6) * 0.55)) solid = true;
					// Floor basin dips & gentle ledge
					const floorH = 0.5 + 0.65 * Math.exp(-Math.pow((x - 17.5) / 2.8, 2)) + 0.55 * Math.exp(-Math.pow((x - 4.2) / 2.2, 2));
					if (y < floorH) solid = true;
					if (solid) setRockCell(c, r, 1);
				}
			}
			platform.x = 11.0;
			platform.minX = 2.4;
			platform.maxX = WORLD_W - 2.4;
			input.aimX = 6.2;
			input.aimY = 11.2;
		} else if (name === 'wild') {
			// Wild Mine cave tunnel with arched roof, undulating floor, and a submerged U-tube rock bridge
			for (let r = 0; r < R_ROWS; r++) {
				for (let c = 0; c < R_COLS; c++) {
					const x = (c + 0.5) * R_CELL;
					const y = (r + 0.5) * R_CELL;
					const floorH = 0.55 + 0.45 * Math.sin(x * 0.45) + 0.75 * Math.exp(-Math.pow((x - 20.5) / 2.6, 2));
					const roofH = 11.2 + 1.6 * Math.sin(x * 0.38 + 0.7);
					let solid = y < floorH || y > roofH || x < 0.75 || x > WORLD_W - 0.75;
					// Submerged U-tube rock pillar on the left (leaves open channel from y=0.6..2.0 underneath!)
					if (x > 5.8 && x < 7.2 && y > 2.25 && y < 8.4) solid = true;
					// Right overhang pocket
					if (x > 16.0 && x < 21.8 && y > 5.8 && y < 7.0) solid = true;
					if (solid) setRockCell(c, r, 1);
				}
			}
			platform.x = 12.6;
			platform.minX = 9.2;
			platform.maxX = 18.8;
			input.aimX = 3.2;
			input.aimY = 9.0;
		} else if (name === 'waterfall') {
			// Pre-filled upper reservoir behind a thin dissolvable rock dam + stepped cascade ledges
			for (let r = 0; r < R_ROWS; r++) {
				for (let c = 0; c < R_COLS; c++) {
					const x = (c + 0.5) * R_CELL;
					const y = (r + 0.5) * R_CELL;
					let solid = y < 0.375 || y > 13.75 || x < 0.5 || x > WORLD_W - 0.5;
					// Upper reservoir floor on left (x < 9.5, y = 7.75..8.75)
					if (x < 9.5 && y > 7.75 && y < 8.75) solid = true;
					// Thin dissolvable dam wall holding reservoir at x = 8.75..9.375, y = 8.75..12.2
					if (x >= 8.75 && x <= 9.375 && y >= 8.75 && y < 12.2) solid = true;
					// Middle step ledge catching the waterfall
					if (x > 10.6 && x < 16.5 && y > 4.25 && y < 5.15) solid = true;
					// Floor basin edges
					if (x > 19.8 && y < 1.6) solid = true;
					if (x < 3.4 && y < 1.2) solid = true;
					if (solid) setRockCell(c, r, 1);
				}
			}
			// Make the dam wall slightly softer so aiming the water gun breaches it cleanly
			for (let r = Math.floor(8.75 / R_CELL); r < Math.floor(12.2 / R_CELL); r++) {
				for (let c = Math.floor(8.75 / R_CELL); c <= Math.floor(9.375 / R_CELL); c++) {
					rockStrength[r * R_COLS + c] = 0.28;
				}
			}
			platform.x = 14.5;
			platform.minX = 4.2;
			platform.maxX = 18.2;
			input.aimX = 9.1;
			input.aimY = 9.8;
		}

		rebuildSdfAndFluidMask();
		platform.y = floorBelow(platform.x, 4.0);
		platform.vx = 0;
		platform.angle = 0;

		// Seed initial water in scenes that start with water to show flow immediately
		if (name === 'waterfall') {
			fillWaterBox(0.75, 8.65, 8.85, 11.75);
		} else if (name === 'caves') {
			fillWaterBox(1.0, 8.5, 9.45, 10.35);
		} else if (name === 'wild') {
			fillWaterBox(1.0, 5.7, 1.0, 5.8);
		}
	}

	// ---- Aimed Nozzle Firing (Unlimited Tank in v1) ----

	function stepGunAndTools(dt) {
		const firingGun = state.autoFire || input.fireKey || (input.pointerDown && state.tool === 'gun');
		if (firingGun) {
			const noz = getNozzle();
			const speed = state.jetSpeed;
			if (state.solver === 'hybrid') {
				const rate = 92 * state.flowRate;
				state.fireBudget += rate * dt;
				while (state.fireBudget >= 1) {
					state.fireBudget -= 1;
					const spread = (rand() - 0.5) * 0.055;
					const cs = Math.cos(spread);
					const sn = Math.sin(spread);
					const vx = platform.vx + (noz.dx * cs - noz.dy * sn) * speed;
					const vy = (noz.dx * sn + noz.dy * cs) * speed;
					spawnJetDroplet(noz.x, noz.y, vx, vy, 0.078, 0, 0, true);
				}
			} else if (state.solver === 'sph') {
				const rate = 34 * state.flowRate;
				state.fireBudget += rate * dt;
				while (state.fireBudget >= 1) {
					state.fireBudget -= 1;
					const spread = (rand() - 0.5) * 0.06;
					const cs = Math.cos(spread);
					const sn = Math.sin(spread);
					const vx = platform.vx + (noz.dx * cs - noz.dy * sn) * speed;
					const vy = (noz.dx * sn + noz.dy * cs) * speed;
					spawnSphParticle(noz.x + (rand() - 0.5) * 0.05, noz.y + (rand() - 0.5) * 0.05, vx, vy, 0);
				}
			} else {
				const rate = 38 * state.flowRate;
				state.fireBudget += rate * dt;
				while (state.fireBudget >= 1) {
					state.fireBudget -= 1;
					const spread = (rand() - 0.5) * 0.06;
					const cs = Math.cos(spread);
					const sn = Math.sin(spread);
					const vx = platform.vx + (noz.dx * cs - noz.dy * sn) * speed;
					const vy = (noz.dx * sn + noz.dy * cs) * speed;
					spawnFlipParticle(noz.x + (rand() - 0.5) * 0.06, noz.y + (rand() - 0.5) * 0.06, vx, vy, 0);
				}
			}
		} else {
			state.fireBudget = 0;
		}

		if (input.pointerDown && state.tool === 'pour') {
			const count = state.solver === 'hybrid' ? 3 : 4;
			for (let k = 0; k < count; k++) {
				const px = clamp(input.aimX + (rand() - 0.5) * 0.65, 0.5, WORLD_W - 0.5);
				const py = clamp(input.aimY + (rand() - 0.5) * 0.35, 0.5, WORLD_H - 0.5);
				if (sampleSdf(px, py) < 0.08) continue;
				spawnWaterBlob(px, py, (rand() - 0.5) * 0.8, -1.2, 0.16 * state.flowRate, 0);
			}
		}

		if ((input.pointerDown && (state.tool === 'carve' || state.tool === 'build')) || input.rightDown) {
			const build = input.pointerDown && state.tool === 'build' && !input.rightDown;
			sculptRock(input.aimX, input.aimY, build ? 1 : 0, 0.55);
		}
	}

	function sculptRock(wx, wy, kind, radius) {
		const rCells = Math.ceil(radius / R_CELL);
		const cc = Math.floor(wx / R_CELL);
		const cr = Math.floor(wy / R_CELL);
		let changed = false;
		for (let dr = -rCells; dr <= rCells; dr++) {
			const r = cr + dr;
			if (r < 2 || r >= R_ROWS - 2) continue;
			for (let dc = -rCells; dc <= rCells; dc++) {
				const c = cc + dc;
				if (c < 1 || c >= R_COLS - 1) continue;
				const dx = (c + 0.5) * R_CELL - wx;
				const dy = (r + 0.5) * R_CELL - wy;
				if (dx * dx + dy * dy > radius * radius) continue;
				const idx = r * R_COLS + c;
				if (rockSolid[idx] === kind) continue;
				setRockCell(c, r, kind);
				changed = true;
			}
		}
		if (changed) rebuildSdfAndFluidMask();
	}

	// ---- Solver 1 Implementation: Hybrid (Ballistic Jet + 2D Pressure/Wave Cells) ----

	function stableLowerFill(total) {
		if (total <= 1) return total;
		if (total < 2 + HYBRID_MAX_COMP) return (1 + total * HYBRID_MAX_COMP) / (1 + HYBRID_MAX_COMP);
		return (total + HYBRID_MAX_COMP) * 0.5;
	}

	function stepHybrid(dt) {
		// 1. Step airborne ballistic water jet droplets
		for (let i = 0; i < MAX_JET; i++) {
			if (!jetActive[i]) continue;
			jetAge[i] += dt;
			const oldX = jetX[i];
			const oldY = jetY[i];
			const nvx = jetVx[i];
			const nvy = jetVy[i] - GRAVITY * dt;
			const nx = oldX + nvx * dt;
			const ny = oldY + (jetVy[i] + nvy) * 0.5 * dt;

			const d = sampleSdf(nx, ny);
			if (d <= 0.07 || nx <= 0.12 || nx >= WORLD_W - 0.12 || ny <= 0.12 || ny >= WORLD_H - 0.12) {
				const speed = Math.hypot(nvx, nvy);
				const dissolved = jetKind[i] === 0 && speed > 5.0 ? dissolveRockAt(nx, ny, 0.085 * (speed / 15)) : 0;
				const fc = clamp(Math.floor(oldX / F_CELL), 0, F_COLS - 1);
				const fr = clamp(Math.floor(oldY / F_CELL), 0, F_ROWS - 1);
				let fi = fr * F_COLS + fc;
				if (fSolid[fi]) fi = findNearestOpenFluidCell(fc, fr);
				if (fi >= 0) {
					cellWater[fi] += jetVol[i];
					cellSlurry[fi] += jetSlurry[i] + dissolved;
					const ec = fi % F_COLS;
					const er = (fi / F_COLS) | 0;
					const push = clamp(nvx * 0.09, -1.8, 1.8);
					edgeU[er * (F_COLS + 1) + ec] += push * 0.5;
					edgeU[er * (F_COLS + 1) + ec + 1] += push * 0.5;
				}
				jetActive[i] = 0;
				continue;
			}

			// Merge smoothly into an existing pool when moving downward or slow
			const fc = clamp(Math.floor(nx / F_CELL), 0, F_COLS - 1);
			const fr = clamp(Math.floor(ny / F_CELL), 0, F_ROWS - 1);
			const fi = fr * F_COLS + fc;
			if (!fSolid[fi] && cellWater[fi] > 0.35 && (nvy < 1.5 || jetAge[i] > 0.14)) {
				cellWater[fi] += jetVol[i];
				cellSlurry[fi] += jetSlurry[i];
				const push = clamp(nvx * 0.1, -2.0, 2.0);
				edgeU[fr * (F_COLS + 1) + fc] += push * 0.5;
				edgeU[fr * (F_COLS + 1) + fc + 1] += push * 0.5;
				jetActive[i] = 0;
				continue;
			}

			jetX[i] = nx;
			jetY[i] = ny;
			jetVx[i] = nvx;
			jetVy[i] = nvy;
		}

		// 1b. Overhang-to-Droplet re-emission: water spilling off a ledge into open air
		// launches as a real ballistic waterfall arc (exact volume & slurry preserved!)
		for (let r = 2; r < F_ROWS; r++) {
			const row = r * F_COLS;
			const eRow = r * (F_COLS + 1);
			for (let c = 0; c < F_COLS; c++) {
				const idx = row + c;
				if (fSolid[idx]) continue;
				const w = cellWater[idx];
				if (w < 0.035) continue;
				const b1 = idx - F_COLS;
				const b2 = b1 - F_COLS;
				if (fSolid[b1] || fSolid[b2]) continue;
				if (cellWater[b1] > 0.22 || cellWater[b2] > 0.22) continue;
				// Cell is hanging over open air: convert smoothly into a ballistic cascade stream
				const u = (edgeU[eRow + c] + edgeU[eRow + c + 1]) * 0.5;
				const leftWet = c > 0 && !fSolid[idx - 1] && cellWater[idx - 1] > 0.08;
				const rightWet = c + 1 < F_COLS && !fSolid[idx + 1] && cellWater[idx + 1] > 0.08;
				const lipPush = leftWet && !rightWet ? 1.8 : (rightWet && !leftWet ? -1.8 : 0);
				const vx = clamp(u * 3.2 + lipPush, -6.5, 6.5) + (rand() - 0.5) * 0.45;
				const vy = -0.9 - rand() * 0.6;
				const emitVol = Math.min(w, 0.28);
				const emitSlurry = emitVol >= w ? cellSlurry[idx] : cellSlurry[idx] * (emitVol / w);
				if (spawnJetDroplet((c + 0.5) * F_CELL, (r + 0.35) * F_CELL, vx, vy, emitVol, emitSlurry, 1, false)) {
					cellWater[idx] -= emitVol;
					cellSlurry[idx] -= emitSlurry;
					edgeU[eRow + c] *= 0.5;
					edgeU[eRow + c + 1] *= 0.5;
				}
			}
		}

		// 2. Multi-pass 2D hydrostatic + horizontal wave-momentum cell solver
		cellFall.fill(0);
		const passes = 5;
		for (let pass = 0; pass < passes; pass++) {
			// Vertical gravity fall (bottom-to-top)
			for (let r = 1; r < F_ROWS; r++) {
				const row = r * F_COLS;
				const belowRow = row - F_COLS;
				for (let c = 0; c < F_COLS; c++) {
					const idx = row + c;
					if (fSolid[idx]) continue;
					const w = cellWater[idx];
					if (w <= 1e-6) continue;
					const bIdx = belowRow + c;
					if (fSolid[bIdx]) continue;
					const wb = cellWater[bIdx];
					const target = stableLowerFill(w + wb);
					let flow = target - wb;
					if (flow <= 0) continue;
					if (flow > w) flow = w;
					if (flow > 0.92) flow = 0.92;
					const sFlow = flow >= w ? cellSlurry[idx] : cellSlurry[idx] * (flow / w);
					cellWater[idx] -= flow;
					cellSlurry[idx] -= sFlow;
					cellWater[bIdx] += flow;
					cellSlurry[bIdx] += sFlow;
					if (wb < 0.85) {
						const fallAmp = Math.min(1, flow * 3.5);
						if (fallAmp > cellFall[idx]) cellFall[idx] = fallAmp;
						if (fallAmp > cellFall[bIdx]) cellFall[bIdx] = fallAmp;
					}
				}
			}

			// Horizontal momentum + pressure equalization (supported cells only — no mid-air pancakes!)
			const dir = (pass & 1) === 0 ? 1 : -1;
			const cStart = dir > 0 ? 0 : F_COLS - 2;
			const cEnd = dir > 0 ? F_COLS - 1 : -1;
			for (let r = 0; r < F_ROWS; r++) {
				const row = r * F_COLS;
				const eRow = r * (F_COLS + 1);
				for (let c = cStart; c !== cEnd; c += dir) {
					const li = row + c;
					const ri = li + 1;
					const ei = eRow + c + 1;
					if (fSolid[li] || fSolid[ri]) {
						edgeU[ei] = 0;
						continue;
					}
					const wl = cellWater[li];
					const wr = cellWater[ri];
					if (wl <= 1e-6 && wr <= 1e-6) {
						edgeU[ei] = 0;
						continue;
					}
					const supL = r === 0 || fSolid[li - F_COLS] || cellWater[li - F_COLS] > 0.65;
					const supR = r === 0 || fSolid[ri - F_COLS] || cellWater[ri - F_COLS] > 0.65;
					if (!supL && !supR) {
						edgeU[ei] *= 0.8;
						continue;
					}
					const diff = wl - wr;
					const damp = Math.abs(diff) < 0.04 ? 0.90 : 0.955;
					let u = edgeU[ei] * damp + diff * 1.25;
					u = clamp(u, -2.5, 2.5);
					const depthScale = Math.min(1, Math.max(wl, wr));
					let flow = diff * 0.30 + u * 0.095 * depthScale;
					if (flow > 0) {
						if (!supL) flow *= 0.15;
						const cap = wl * 0.48;
						if (flow > cap) {
							flow = cap;
							u *= 0.6;
						}
						const sFlow = flow >= wl ? cellSlurry[li] : (wl > 1e-9 ? cellSlurry[li] * (flow / wl) : 0);
						cellWater[li] -= flow;
						cellSlurry[li] -= sFlow;
						cellWater[ri] += flow;
						cellSlurry[ri] += sFlow;
					} else if (flow < 0) {
						let mag = -flow;
						if (!supR) mag *= 0.15;
						const cap = wr * 0.48;
						if (mag > cap) {
							mag = cap;
							u *= 0.6;
						}
						const sFlow = mag >= wr ? cellSlurry[ri] : (wr > 1e-9 ? cellSlurry[ri] * (mag / wr) : 0);
						cellWater[ri] -= mag;
						cellSlurry[ri] -= sFlow;
						cellWater[li] += mag;
						cellSlurry[li] += sFlow;
					}
					edgeU[ei] = u;
				}
			}

			// Upward hydrostatic pressure relief (drives U-tube equalization under arches!)
			for (let r = 0; r < F_ROWS - 1; r++) {
				const row = r * F_COLS;
				const aboveRow = row + F_COLS;
				for (let c = 0; c < F_COLS; c++) {
					const idx = row + c;
					if (fSolid[idx]) continue;
					const w = cellWater[idx];
					if (w <= 1.0) continue;
					const aIdx = aboveRow + c;
					if (fSolid[aIdx]) continue;
					const wa = cellWater[aIdx];
					const stableBot = stableLowerFill(w + wa);
					let upFlow = w - stableBot;
					if (upFlow <= 0) continue;
					if (upFlow > w) upFlow = w;
					const sFlow = cellSlurry[idx] * (upFlow / w);
					cellWater[idx] -= upFlow;
					cellSlurry[idx] -= sFlow;
					cellWater[aIdx] += upFlow;
					cellSlurry[aIdx] += sFlow;
				}
			}
		}

		// Platform bow wake ripple when driving through water
		if (Math.abs(platform.vx) > 0.25) {
			const c0 = clamp(Math.floor((platform.x - PLAT_HALF) / F_CELL), 1, F_COLS - 2);
			const c1 = clamp(Math.floor((platform.x + PLAT_HALF) / F_CELL), 1, F_COLS - 2);
			const r0 = clamp(Math.floor(platform.y / F_CELL), 0, F_ROWS - 1);
			const r1 = clamp(Math.floor((platform.y + 0.55) / F_CELL), 0, F_ROWS - 1);
			const wake = clamp(platform.vx * 0.12, -1.2, 1.2);
			for (let r = r0; r <= r1; r++) {
				for (let c = c0; c <= c1; c++) {
					if (!fSolid[r * F_COLS + c] && cellWater[r * F_COLS + c] > 0.05) {
						edgeU[r * (F_COLS + 1) + c + 1] += wake;
					}
				}
			}
		}

		// 3. Under-platform suction pump: directly sucks water & slurry beneath the hull
		let suckedArea = 0;
		if (state.pumpOn) {
			const cMin = clamp(Math.floor((platform.x - SUCTION_HALF) / F_CELL), 0, F_COLS - 1);
			const cMax = clamp(Math.floor((platform.x + SUCTION_HALF) / F_CELL), 0, F_COLS - 1);
			const rMin = clamp(Math.floor((platform.y - 0.65) / F_CELL), 0, F_ROWS - 1);
			const rMax = clamp(Math.floor((platform.y + 0.58) / F_CELL), 0, F_ROWS - 1);
			let budget = 11.5 * state.pumpRate * dt; // fluid cells/step
			for (let r = rMax; r >= rMin && budget > 1e-6; r--) {
				for (let c = cMin; c <= cMax && budget > 1e-6; c++) {
					const idx = r * F_COLS + c;
					if (fSolid[idx]) continue;
					const w = cellWater[idx];
					if (w <= 1e-6) continue;
					const take = Math.min(w, budget * 0.35 + 0.08 * state.pumpRate * dt * 60 / 12, budget);
					const actual = Math.min(w, take);
					const sTake = actual >= w ? cellSlurry[idx] : cellSlurry[idx] * (actual / w);
					cellWater[idx] -= actual;
					cellSlurry[idx] -= sTake;
					budget -= actual;
					suckedArea += actual * F_AREA;
					state.hopperSlurry += sTake;
				}
			}
		}
		state.pumpedArea += suckedArea;
		state.lastSuctionRate = suckedArea / dt;
	}

	// ---- Solver 2 Implementation: 2D SPH / Double-Density Relaxation ----

	function stepSph(dt) {
		const substeps = 2;
		const sdt = dt / substeps;
		let suckedArea = 0;
		if (state.pumpOn) state.pumpCarry = Math.min(8, state.pumpCarry + 42 * state.pumpRate * dt);
		else state.pumpCarry = 0;

		for (let sub = 0; sub < substeps; sub++) {
			// Integrate gravity & store previous positions
			for (let i = 0; i < MAX_SPH; i++) {
				if (!sphActive[i]) continue;
				sphAge[i] += sdt;
				sphVy[i] -= GRAVITY * sdt;
				sphPrevX[i] = sphX[i];
				sphPrevY[i] = sphY[i];
				sphX[i] += sphVx[i] * sdt;
				sphY[i] += sphVy[i] * sdt;
			}

			// Build uniform spatial hash
			hashHead.fill(-1);
			for (let i = 0; i < MAX_SPH; i++) {
				if (!sphActive[i]) continue;
				const hx = clamp((sphX[i] * SPH_INV_H) | 0, 0, HASH_COLS - 1);
				const hy = clamp((sphY[i] * SPH_INV_H) | 0, 0, HASH_ROWS - 1);
				const h = hy * HASH_COLS + hx;
				partNext[i] = hashHead[h];
				hashHead[h] = i;
			}

			// Viscosity impulses + Double-Density Relaxation
			for (let i = 0; i < MAX_SPH; i++) {
				if (!sphActive[i]) continue;
				const xi = sphX[i];
				const yi = sphY[i];
				const hx = clamp((xi * SPH_INV_H) | 0, 0, HASH_COLS - 1);
				const hy = clamp((yi * SPH_INV_H) | 0, 0, HASH_ROWS - 1);

				let dens = 0;
				let nearDens = 0;
				let nCount = 0;

				for (let dy = -1; dy <= 1; dy++) {
					const ry = hy + dy;
					if (ry < 0 || ry >= HASH_ROWS) continue;
					const rowOff = ry * HASH_COLS;
					for (let dx = -1; dx <= 1; dx++) {
						const rx = hx + dx;
						if (rx < 0 || rx >= HASH_COLS) continue;
						let j = hashHead[rowOff + rx];
						while (j !== -1) {
							if (j !== i) {
								const ddx = sphX[j] - xi;
								const ddy = sphY[j] - yi;
								const r2 = ddx * ddx + ddy * ddy;
								if (r2 < SPH_H * SPH_H && r2 > 1e-8) {
									const r = Math.sqrt(r2);
									const invR = 1 / r;
									const q = 1 - r * SPH_INV_H;
									const q2 = q * q;
									dens += q2;
									nearDens += q2 * q;
									const ux = ddx * invR;
									const uy = ddy * invR;
									if (nCount < 96) {
										sphNbrIdx[nCount] = j;
										sphNbrQ[nCount] = q;
										sphNbrDx[nCount] = ux;
										sphNbrDy[nCount] = uy;
										nCount++;
									}
									// Symmetric viscosity impulse (j > i only)
									if (j > i) {
										const uIn = (sphVx[i] - sphVx[j]) * ux + (sphVy[i] - sphVy[j]) * uy;
										if (uIn > 0) {
											const imp = sdt * q * (SPH_SIGMA * uIn + SPH_BETA * uIn * uIn) * 0.5;
											const capped = imp > uIn * 0.4 ? uIn * 0.4 : imp;
											sphVx[i] -= ux * capped;
											sphVy[i] -= uy * capped;
											sphVx[j] += ux * capped;
											sphVy[j] += uy * capped;
										}
									}
								}
							}
							j = partNext[j];
						}
					}
				}

				let P = SPH_K * (dens - SPH_REST_DENS);
				if (P < -0.004) P = -0.004; // prevent tensile clumping from braking airborne jets
				const Pnear = SPH_K_NEAR * nearDens;
				let dispX = 0;
				let dispY = 0;
				for (let k = 0; k < nCount; k++) {
					const j = sphNbrIdx[k];
					const q = sphNbrQ[k];
					const ux = sphNbrDx[k];
					const uy = sphNbrDy[k];
					let D = (P * q + Pnear * q * q);
					if (D > 0.05) D = 0.05;
					else if (D < -0.01) D = -0.01;
					const mx = ux * D * 0.5;
					const my = uy * D * 0.5;
					sphX[j] += mx;
					sphY[j] += my;
					dispX -= mx;
					dispY -= my;
				}
				sphX[i] += dispX;
				sphY[i] += dispY;
			}

			// Boundary collisions, rock dissolution, platform push, and under-platform suction
			for (let i = 0; i < MAX_SPH; i++) {
				if (!sphActive[i]) continue;
				let x = sphX[i];
				let y = sphY[i];
				const vx = (x - sphPrevX[i]) / sdt;
				const vy = (y - sphPrevY[i]) / sdt;

				// Under-platform suction intake: pulls water directly beneath the hull
				if (state.pumpOn) {
					const dxp = x - platform.x;
					if (Math.abs(dxp) < SUCTION_HALF && y < platform.y + 0.58 && y > platform.y - 0.85) {
						sphPrevY[i] -= 20 * sdt * sdt;
						sphPrevX[i] += clamp(dxp * 4.0, -7, 7) * sdt * sdt;
						if (state.pumpCarry >= 1 && y >= platform.y - 0.65 && y <= platform.y + 0.55) {
							state.pumpCarry -= 1;
							sphActive[i] = 0;
							sphCount--;
							suckedArea += SPH_AREA;
							state.hopperSlurry += sphSlurry[i];
							sphSlurry[i] = 0;
							continue;
						}
					}
				}

				// Rock & chamber SDF collision
				const g = sampleSdfGrad(x, y);
				const minD = 0.085;
				if (g.d < minD) {
					const vn = vx * g.nx + vy * g.ny;
					if (vn < -5.2) {
						const hitDist = Math.max(0.06, g.d + 0.08);
						const dissolved = dissolveRockAt(x - g.nx * hitDist, y - g.ny * hitDist, 0.24 * (-vn / 15));
						if (dissolved > 0) sphSlurry[i] += dissolved;
					}
					const pen = minD - g.d;
					x += g.nx * pen;
					y += g.ny * pen;
					const newVx = vx - Math.min(0, vn) * 1.15 * g.nx;
					const newVy = vy - Math.min(0, vn) * 1.15 * g.ny;
					sphX[i] = x;
					sphY[i] = y;
					sphVx[i] = clamp(newVx * 0.985, -28, 28);
					sphVy[i] = clamp(newVy * 0.985, -28, 28);
					continue;
				}

				// Platform chassis collision (above belly arch so water can pool underneath!)
				const relX = x - platform.x;
				const relY = y - platform.y;
				if (Math.abs(relX) < PLAT_HALF && relY > 0.34 && relY < PLAT_DECK + 0.04) {
					if (relY > (0.34 + PLAT_DECK) * 0.5) {
						y = platform.y + PLAT_DECK + 0.04;
						sphY[i] = y;
						sphVx[i] = platform.vx * 0.5 + vx * 0.5 + (relX >= 0 ? 0.6 : -0.6);
						sphVy[i] = Math.max(0, vy * 0.3);
					} else {
						x = platform.x + (relX >= 0 ? PLAT_HALF : -PLAT_HALF);
						sphX[i] = x;
						sphVx[i] = platform.vx;
						sphVy[i] = vy;
					}
					continue;
				}

				sphVx[i] = clamp(vx, -28, 28);
				sphVy[i] = clamp(vy, -28, 28);
			}
		}

		state.pumpedArea += suckedArea;
		state.lastSuctionRate = suckedArea / dt;
	}

	// ---- Solver 3 Implementation: 2D Incompressible FLIP / PIC on Staggered MAC Grid ----

	function stepFlip(dt) {
		let suckedArea = 0;
		if (state.pumpOn) state.pumpCarry = Math.min(8, state.pumpCarry + 46 * state.pumpRate * dt);
		else state.pumpCarry = 0;

		// 1. Substepped particle advection + SDF rock collision + under-platform suction
		const advSteps = 2;
		const sdt = dt / advSteps;
		for (let sub = 0; sub < advSteps; sub++) {
			for (let i = 0; i < MAX_FLIP; i++) {
				if (!flipActive[i]) continue;
				flipVy[i] -= GRAVITY * sdt;
				let x = flipX[i] + flipVx[i] * sdt;
				let y = flipY[i] + flipVy[i] * sdt;

				if (state.pumpOn) {
					const dxp = x - platform.x;
					if (Math.abs(dxp) < SUCTION_HALF && y < platform.y + 0.58 && y > platform.y - 0.85) {
						flipVy[i] += 24 * sdt;
						flipVx[i] -= clamp(dxp * 4.5, -6, 6) * sdt;
						if (state.pumpCarry >= 1 && y >= platform.y - 0.65 && y <= platform.y + 0.55) {
							state.pumpCarry -= 1;
							flipActive[i] = 0;
							flipCount--;
							suckedArea += FLIP_AREA;
							state.hopperSlurry += flipSlurry[i];
							flipSlurry[i] = 0;
							continue;
						}
					}
				}

				const g = sampleSdfGrad(x, y);
				const minD = 0.08;
				if (g.d < minD) {
					const vn = flipVx[i] * g.nx + flipVy[i] * g.ny;
					if (vn < -5.2) {
						const hitDist = Math.max(0.06, g.d + 0.08);
						const dissolved = dissolveRockAt(x - g.nx * hitDist, y - g.ny * hitDist, 0.24 * (-vn / 15));
						if (dissolved > 0) flipSlurry[i] += dissolved;
					}
					x += g.nx * (minD - g.d);
					y += g.ny * (minD - g.d);
					if (vn < 0) {
						flipVx[i] -= g.nx * vn * 1.05;
						flipVy[i] -= g.ny * vn * 1.05;
					}
				}

				// Platform hull wake push
				const relX = x - platform.x;
				const relY = y - platform.y;
				if (Math.abs(relX) < PLAT_HALF && relY > 0.34 && relY < PLAT_DECK + 0.04) {
					if (relY > (0.34 + PLAT_DECK) * 0.5) {
						y = platform.y + PLAT_DECK + 0.04;
						flipVx[i] += relX >= 0 ? 0.5 : -0.5;
						flipVy[i] = Math.max(0, flipVy[i] * 0.3);
					} else {
						x = platform.x + (relX >= 0 ? PLAT_HALF : -PLAT_HALF);
						flipVx[i] = platform.vx;
					}
				}

				flipX[i] = clamp(x, 0.12, WORLD_W - 0.12);
				flipY[i] = clamp(y, 0.12, WORLD_H - 0.12);
			}
		}

		// 2. Push overlapping particles apart (2 light passes via cell hash)
		const minD2 = FLIP_MIN_DIST * FLIP_MIN_DIST;
		for (let iter = 0; iter < 2; iter++) {
			flipHashHead.fill(-1);
			for (let i = 0; i < MAX_FLIP; i++) {
				if (!flipActive[i]) continue;
				const c = clamp((flipX[i] / F_CELL) | 0, 0, F_COLS - 1);
				const r = clamp((flipY[i] / F_CELL) | 0, 0, F_ROWS - 1);
				const h = r * F_COLS + c;
				flipPartNext[i] = flipHashHead[h];
				flipHashHead[h] = i;
			}
			for (let i = 0; i < MAX_FLIP; i++) {
				if (!flipActive[i]) continue;
				const xi = flipX[i];
				const yi = flipY[i];
				const c0 = clamp((xi / F_CELL) | 0, 0, F_COLS - 1);
				const r0 = clamp((yi / F_CELL) | 0, 0, F_ROWS - 1);
				for (let dr = -1; dr <= 1; dr++) {
					const r = r0 + dr;
					if (r < 0 || r >= F_ROWS) continue;
					const row = r * F_COLS;
					for (let dc = -1; dc <= 1; dc++) {
						const c = c0 + dc;
						if (c < 0 || c >= F_COLS) continue;
						let j = flipHashHead[row + c];
						while (j !== -1) {
							if (j > i) {
								const dx = flipX[j] - xi;
								const dy = flipY[j] - yi;
								const d2 = dx * dx + dy * dy;
								if (d2 < minD2 && d2 > 1e-9) {
									const d = Math.sqrt(d2);
									const s = 0.5 * (FLIP_MIN_DIST - d) / d;
									const sx = dx * s;
									const sy = dy * s;
									flipX[i] -= sx;
									flipY[i] -= sy;
									flipX[j] += sx;
									flipY[j] += sy;
								}
							}
							j = flipPartNext[j];
						}
					}
				}
			}
		}

		// 3. P2G: transfer particle velocities & density to staggered MAC grid
		macU.fill(0);
		macV.fill(0);
		macDu.fill(0);
		macDv.fill(0);
		macDens.fill(0);
		for (let i = 0; i < F_COUNT; i++) macType[i] = fSolid[i] ? 2 : 0;

		let minR = F_ROWS;
		let maxR = -1;
		let minC = F_COLS;
		let maxC = -1;
		const invH = 1 / F_CELL;
		for (let i = 0; i < MAX_FLIP; i++) {
			if (!flipActive[i]) continue;
			const px = flipX[i];
			const py = flipY[i];
			const fc = clamp((px * invH) | 0, 0, F_COLS - 1);
			const fr = clamp((py * invH) | 0, 0, F_ROWS - 1);
			const fi = fr * F_COLS + fc;
			if (macType[fi] !== 2) {
				macType[fi] = 1;
				if (fr < minR) minR = fr;
				if (fr > maxR) maxR = fr;
				if (fc < minC) minC = fc;
				if (fc > maxC) maxC = fc;
			}

			// Cell-centred particle density for drift compensation
			const gx = clamp(px * invH - 0.5, 0, F_COLS - 1.001);
			const gy = clamp(py * invH - 0.5, 0, F_ROWS - 1.001);
			const dc0 = gx | 0;
			const dr0 = gy | 0;
			const tx = gx - dc0;
			const ty = gy - dr0;
			const dBase = dr0 * F_COLS + dc0;
			macDens[dBase] += (1 - tx) * (1 - ty);
			macDens[dBase + 1] += tx * (1 - ty);
			macDens[dBase + F_COLS] += (1 - tx) * ty;
			macDens[dBase + F_COLS + 1] += tx * ty;

			// Staggered U faces at (c * h, (r + 0.5) * h)
			const ux = clamp(px * invH, 0, F_COLS - 0.001);
			const uy = clamp(py * invH - 0.5, 0, F_ROWS - 1.001);
			const uc0 = ux | 0;
			const ur0 = uy | 0;
			const ufx = ux - uc0;
			const ufy = uy - ur0;
			const u00 = ur0 * MAC_U_STRIDE + uc0;
			const u01 = u00 + 1;
			const u10 = u00 + MAC_U_STRIDE;
			const u11 = u10 + 1;
			const w00 = (1 - ufx) * (1 - ufy);
			const w01 = ufx * (1 - ufy);
			const w10 = (1 - ufx) * ufy;
			const w11 = ufx * ufy;
			const pvx = flipVx[i];
			macU[u00] += pvx * w00; macDu[u00] += w00;
			macU[u01] += pvx * w01; macDu[u01] += w01;
			macU[u10] += pvx * w10; macDu[u10] += w10;
			macU[u11] += pvx * w11; macDu[u11] += w11;

			// Staggered V faces at ((c + 0.5) * h, r * h)
			const vx = clamp(px * invH - 0.5, 0, F_COLS - 1.001);
			const vy = clamp(py * invH, 0, F_ROWS - 0.001);
			const vc0 = vx | 0;
			const vr0 = vy | 0;
			const vfx = vx - vc0;
			const vfy = vy - vr0;
			const v00 = vr0 * F_COLS + vc0;
			const v01 = v00 + 1;
			const v10 = v00 + F_COLS;
			const v11 = v10 + 1;
			const vw00 = (1 - vfx) * (1 - vfy);
			const vw01 = vfx * (1 - vfy);
			const vw10 = (1 - vfx) * vfy;
			const vw11 = vfx * vfy;
			const pvy = flipVy[i];
			macV[v00] += pvy * vw00; macDv[v00] += vw00;
			macV[v01] += pvy * vw01; macDv[v01] += vw01;
			macV[v10] += pvy * vw10; macDv[v10] += vw10;
			macV[v11] += pvy * vw11; macDv[v11] += vw11;
		}

		for (let i = 0; i < MAC_U_COUNT; i++) if (macDu[i] > 0) macU[i] /= macDu[i];
		for (let i = 0; i < MAC_V_COUNT; i++) if (macDv[i] > 0) macV[i] /= macDv[i];

		// Enforce solid boundary faces = 0
		for (let r = 0; r < F_ROWS; r++) {
			const uRow = r * MAC_U_STRIDE;
			macU[uRow] = 0;
			macU[uRow + F_COLS] = 0;
			for (let c = 1; c < F_COLS; c++) {
				if (fSolid[r * F_COLS + c - 1] || fSolid[r * F_COLS + c]) macU[uRow + c] = 0;
			}
		}
		for (let c = 0; c < F_COLS; c++) {
			macV[c] = 0;
			macV[F_ROWS * F_COLS + c] = 0;
			for (let r = 1; r < F_ROWS; r++) {
				if (fSolid[(r - 1) * F_COLS + c] || fSolid[r * F_COLS + c]) macV[r * F_COLS + c] = 0;
			}
		}
		macPrevU.set(macU);
		macPrevV.set(macV);

		// 4. Gauss-Seidel SOR Incompressibility Projection (skip isolated airborne jet cells!)
		if (maxR >= minR && maxC >= minC) {
			const omega = 1.72;
			for (let iter = 0; iter < 14; iter++) {
				for (let r = minR; r <= maxR; r++) {
					const row = r * F_COLS;
					const uRow = r * MAC_U_STRIDE;
					const vRow = r * F_COLS;
					for (let c = minC; c <= maxC; c++) {
						const fi = row + c;
						if (macType[fi] !== 1) continue;
						const hasSupport =
							(r === 0 || macType[fi - F_COLS] !== 0) ||
							(r + 1 < F_ROWS && macType[fi + F_COLS] === 2) ||
							(c > 0 && macType[fi - 1] !== 0) ||
							(c + 1 < F_COLS && macType[fi + 1] !== 0);
						if (macDens[fi] < 1.35 && !hasSupport) continue;
						const sL = c > 0 && !fSolid[fi - 1] ? 1 : 0;
						const sR = c + 1 < F_COLS && !fSolid[fi + 1] ? 1 : 0;
						const sB = r > 0 && !fSolid[fi - F_COLS] ? 1 : 0;
						const sT = r + 1 < F_ROWS && !fSolid[fi + F_COLS] ? 1 : 0;
						const sSum = sL + sR + sB + sT;
						if (sSum === 0) continue;
						let div = (macU[uRow + c + 1] - macU[uRow + c]) + (macV[vRow + F_COLS + c] - macV[vRow + c]);
						const excess = macDens[fi] - FLIP_REST_DENS;
						if (excess > 0) div -= 0.9 * excess;
						const p = -omega * div / sSum;
						macU[uRow + c] -= sL * p;
						macU[uRow + c + 1] += sR * p;
						macV[vRow + c] -= sB * p;
						macV[vRow + F_COLS + c] += sT * p;
					}
				}
			}
		}

		// 5. G2P: FLIP/PIC velocity transfer back to particles
		for (let i = 0; i < MAX_FLIP; i++) {
			if (!flipActive[i]) continue;
			const px = flipX[i];
			const py = flipY[i];
			const fc = clamp((px * invH) | 0, 0, F_COLS - 1);
			const fr = clamp((py * invH) | 0, 0, F_ROWS - 1);
			const fi = fr * F_COLS + fc;
			const airborne = macDens[fi] < 1.35 && fr > 0 && macType[fi - F_COLS] === 0;
			if (airborne) continue;

			const ux = clamp(px * invH, 0, F_COLS - 0.001);
			const uy = clamp(py * invH - 0.5, 0, F_ROWS - 1.001);
			const uc0 = ux | 0;
			const ur0 = uy | 0;
			const ufx = ux - uc0;
			const ufy = uy - ur0;
			const u00 = ur0 * MAC_U_STRIDE + uc0;
			const u01 = u00 + 1;
			const u10 = u00 + MAC_U_STRIDE;
			const u11 = u10 + 1;
			const v00 = macDu[u00] > 0 ? (1 - ufx) * (1 - ufy) : 0;
			const v01 = macDu[u01] > 0 ? ufx * (1 - ufy) : 0;
			const v10 = macDu[u10] > 0 ? (1 - ufx) * ufy : 0;
			const v11 = macDu[u11] > 0 ? ufx * ufy : 0;
			const vSumU = v00 + v01 + v10 + v11;
			if (vSumU > 1e-6) {
				const picU = (v00 * macU[u00] + v01 * macU[u01] + v10 * macU[u10] + v11 * macU[u11]) / vSumU;
				const oldU = (v00 * macPrevU[u00] + v01 * macPrevU[u01] + v10 * macPrevU[u10] + v11 * macPrevU[u11]) / vSumU;
				const flipU = flipVx[i] + (picU - oldU);
				flipVx[i] = clamp(FLIP_RATIO * flipU + (1 - FLIP_RATIO) * picU, -28, 28);
			}

			const vx = clamp(px * invH - 0.5, 0, F_COLS - 1.001);
			const vy = clamp(py * invH, 0, F_ROWS - 0.001);
			const vc0 = vx | 0;
			const vr0 = vy | 0;
			const vfx = vx - vc0;
			const vfy = vy - vr0;
			const q00 = vr0 * F_COLS + vc0;
			const q01 = q00 + 1;
			const q10 = q00 + F_COLS;
			const q11 = q10 + 1;
			const w00 = macDv[q00] > 0 ? (1 - vfx) * (1 - vfy) : 0;
			const w01 = macDv[q01] > 0 ? vfx * (1 - vfy) : 0;
			const w10 = macDv[q10] > 0 ? (1 - vfx) * vfy : 0;
			const w11 = macDv[q11] > 0 ? vfx * vfy : 0;
			const vSumV = w00 + w01 + w10 + w11;
			if (vSumV > 1e-6) {
				const picV = (w00 * macV[q00] + w01 * macV[q01] + w10 * macV[q10] + w11 * macV[q11]) / vSumV;
				const oldV = (w00 * macPrevV[q00] + w01 * macPrevV[q01] + w10 * macPrevV[q10] + w11 * macPrevV[q11]) / vSumV;
				const flipV = flipVy[i] + (picV - oldV);
				flipVy[i] = clamp(FLIP_RATIO * flipV + (1 - FLIP_RATIO) * picV, -28, 28);
			}
		}

		state.pumpedArea += suckedArea;
		state.lastSuctionRate = suckedArea / dt;
	}

	// ---- Main Simulation Step ----

	function stepSim(dt) {
		const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
		state.time += dt;
		updatePlatformPose(dt);
		stepGunAndTools(dt);

		if (state.solver === 'hybrid') stepHybrid(dt);
		else if (state.solver === 'sph') stepSph(dt);
		else stepFlip(dt);

		if (state.lastSuctionRate > 0.01) state.suctionPulse += dt * 9;
		if (typeof performance !== 'undefined') {
			const ms = performance.now() - t0;
			state.simMs = state.simMs * 0.88 + ms * 0.12;
		}
	}

	// ---- Metrics & Exact Conservation Inspection ----

	const metricsOut = {
		waterArea: 0,
		activeUnits: 0,
		unitCap: 0,
		suspendedSlurry: 0,
		slurryDrift: 0
	};

	function measureMetrics() {
		let waterArea = 0;
		let activeUnits = 0;
		let unitCap = 0;
		let slurry = 0;

		if (state.solver === 'hybrid') {
			for (let i = 0; i < F_COUNT; i++) {
				const w = cellWater[i];
				slurry += cellSlurry[i];
				if (w > 1e-6) {
					waterArea += w * F_AREA;
					if (w > 1e-4) activeUnits++;
				}
			}
			for (let i = 0; i < MAX_JET; i++) {
				if (!jetActive[i]) continue;
				waterArea += jetVol[i] * F_AREA;
				slurry += jetSlurry[i];
			}
			unitCap = F_COUNT;
		} else if (state.solver === 'sph') {
			for (let i = 0; i < MAX_SPH; i++) {
				if (!sphActive[i]) continue;
				activeUnits++;
				slurry += sphSlurry[i];
			}
			waterArea = activeUnits * SPH_AREA;
			unitCap = MAX_SPH;
		} else {
			for (let i = 0; i < MAX_FLIP; i++) {
				if (!flipActive[i]) continue;
				activeUnits++;
				slurry += flipSlurry[i];
			}
			waterArea = activeUnits * FLIP_AREA;
			unitCap = MAX_FLIP;
		}

		metricsOut.waterArea = waterArea;
		metricsOut.activeUnits = activeUnits;
		metricsOut.unitCap = unitCap;
		metricsOut.suspendedSlurry = slurry;
		metricsOut.slurryDrift = Math.abs(state.dissolvedCells - (slurry + state.hopperSlurry));
		return metricsOut;
	}

	// ---- Smooth Visible Surface Field Construction (Shared by All 3 Solvers) ----

	function buildHybridScalarField() {
		nodeVal.fill(0);
		nodeWeight.fill(0);
		nodeSlurry.fill(0);
		nodeWet.fill(0);
		cellSurfH.fill(0);

		// Compute smoothed local sub-cell water height for surface cells
		for (let r = 0; r < F_ROWS; r++) {
			const row = r * F_COLS;
			for (let c = 0; c < F_COLS; c++) {
				const i = row + c;
				if (fSolid[i]) continue;
				const w = cellWater[i];
				if (w <= 0.004) continue;
				let h = Math.min(1.0, w);
				const wetAbove = r + 1 < F_ROWS && !fSolid[i + F_COLS] && cellWater[i + F_COLS] > 0.015;
				if (!wetAbove && cellFall[i] < 0.2) {
					// Light horizontal surface smoothing across neighboring open surface cells
					let sum = h * 0.62;
					let wt = 0.62;
					if (c > 0 && !fSolid[i - 1]) {
						const wl = cellWater[i - 1];
						const lAbove = r + 1 < F_ROWS && !fSolid[i - 1 + F_COLS] && cellWater[i - 1 + F_COLS] > 0.015;
						sum += (lAbove ? 1.0 : Math.min(1.0, wl)) * 0.19;
						wt += 0.19;
					}
					if (c + 1 < F_COLS && !fSolid[i + 1]) {
						const wr = cellWater[i + 1];
						const rAbove = r + 1 < F_ROWS && !fSolid[i + 1 + F_COLS] && cellWater[i + 1 + F_COLS] > 0.015;
						sum += (rAbove ? 1.0 : Math.min(1.0, wr)) * 0.19;
						wt += 0.19;
					}
					h = sum / wt;
				}
				cellSurfH[i] = h;
			}
		}

		// Second light smoothing pass on surface cells for glassy calm pools
		cellSurfH2.set(cellSurfH);
		for (let r = 0; r < F_ROWS; r++) {
			const row = r * F_COLS;
			for (let c = 1; c < F_COLS - 1; c++) {
				const i = row + c;
				if (fSolid[i] || cellWater[i] <= 0.004) continue;
				const wetAbove = r + 1 < F_ROWS && !fSolid[i + F_COLS] && cellWater[i + F_COLS] > 0.015;
				if (wetAbove) continue;
				if (!fSolid[i - 1] && !fSolid[i + 1] && cellWater[i - 1] > 0.004 && cellWater[i + 1] > 0.004) {
					cellSurfH[i] = 0.5 * cellSurfH2[i] + 0.25 * cellSurfH2[i - 1] + 0.25 * cellSurfH2[i + 1];
				}
			}
		}

		// Accumulate signed sub-cell heights into nodal grid (ignoring solid cells so water meets rock flush!)
		for (let r = 0; r < F_ROWS; r++) {
			const row = r * F_COLS;
			const nRow0 = r * N_COLS;
			const nRow1 = nRow0 + N_COLS;
			for (let c = 0; c < F_COLS; c++) {
				const i = row + c;
				if (fSolid[i]) continue;
				const w = cellWater[i];
				const slurryRatio = w > 0.005 ? Math.min(1, cellSlurry[i] / (w * 0.9)) : 0;
				let sBot;
				let sTop;
				let wet = 0;

				if (w <= 0.004) {
					// Dry air cell: check if sitting directly above a wet surface cell for C0 continuity
					const belowWet = r > 0 && !fSolid[i - F_COLS] && cellWater[i - F_COLS] > 0.004;
					if (belowWet) {
						const hb = cellSurfH[i - F_COLS];
						sBot = hb - 1.0;
						sTop = -1.0;
					} else {
						sBot = -0.35;
						sTop = -1.0;
					}
				} else {
					wet = 1;
					const aboveOpen = r + 1 < F_ROWS && !fSolid[i + F_COLS];
					const wAbove = aboveOpen ? cellWater[i + F_COLS] : 0;
					const falling = cellFall[i] > 0.18 && r > 0 && !fSolid[i - F_COLS] && cellWater[i - F_COLS] < 0.82;
					if (wAbove > 0.004) {
						// Submerged cell: exact C0 height matching cell above
						const ha = cellSurfH[i + F_COLS];
						sTop = ha;
						sBot = 1.0 + ha;
					} else if (falling) {
						// Falling waterfall sheet: stay visually continuous vertically
						const amp = Math.min(0.9, w * 1.8) - 0.05;
						sBot = amp;
						sTop = amp;
					} else {
						const h = cellSurfH[i];
						sBot = h;
						sTop = h - 1.0;
					}
				}

				const n00 = nRow0 + c;
				const n10 = n00 + 1;
				const n01 = nRow1 + c;
				const n11 = n01 + 1;

				nodeVal[n00] += sBot; nodeWeight[n00] += 1;
				nodeVal[n10] += sBot; nodeWeight[n10] += 1;
				nodeVal[n01] += sTop; nodeWeight[n01] += 1;
				nodeVal[n11] += sTop; nodeWeight[n11] += 1;

				if (wet) {
					nodeSlurry[n00] += slurryRatio; nodeWet[n00] += 1;
					nodeSlurry[n10] += slurryRatio; nodeWet[n10] += 1;
					nodeSlurry[n01] += slurryRatio; nodeWet[n01] += 1;
					nodeSlurry[n11] += slurryRatio; nodeWet[n11] += 1;
				}
			}
		}

		for (let i = 0; i < N_COUNT; i++) {
			if (nodeWeight[i] > 0) nodeVal[i] /= nodeWeight[i];
			else nodeVal[i] = -1;
			if (nodeWet[i] > 0) nodeSlurry[i] /= nodeWet[i];
		}
	}

	function buildParticleScalarField(activeArr, xArr, yArr, slurryArr, maxN, isoLevel) {
		nodeVal.fill(0);
		nodeSlurry.fill(0);
		nodeWet.fill(0);

		const rad = 1.62;
		const invCell = 1 / F_CELL;
		for (let i = 0; i < maxN; i++) {
			if (!activeArr[i]) continue;
			const gx = xArr[i] * invCell;
			const gy = yArr[i] * invCell;
			const c0 = Math.max(0, Math.floor(gx - rad));
			const c1 = Math.min(N_COLS - 1, Math.ceil(gx + rad));
			const r0 = Math.max(0, Math.floor(gy - rad));
			const r1 = Math.min(N_ROWS - 1, Math.ceil(gy + rad));
			const sVal = Math.min(1, slurryArr[i] * 1.4);
			for (let r = r0; r <= r1; r++) {
				const dy = r - gy;
				const dy2 = dy * dy;
				const row = r * N_COLS;
				for (let c = c0; c <= c1; c++) {
					const dx = c - gx;
					const d2 = dx * dx + dy2;
					if (d2 >= rad * rad) continue;
					const q = 1 - Math.sqrt(d2) / rad;
					const k = q * q * (3 - 2 * q);
					const ni = row + c;
					nodeVal[ni] += k;
					nodeSlurry[ni] += sVal * k;
					nodeWet[ni] += k;
				}
			}
		}

		for (let i = 0; i < N_COUNT; i++) {
			if (nodeWet[i] > 1e-5) nodeSlurry[i] /= nodeWet[i];
			nodeVal[i] -= isoLevel;
		}

		// Extrapolate water density across rock walls so water hugs curved caves flush (zero air gap)
		nodeValScratch.set(nodeVal);
		for (let r = 0; r < N_ROWS; r++) {
			for (let c = 0; c < N_COLS; c++) {
				const ni = r * N_COLS + c;
				if (!nodeTouchesSolid(c, r)) continue;
				let best = nodeValScratch[ni];
				if (c > 0 && nodeValScratch[ni - 1] > best) best = nodeValScratch[ni - 1];
				if (c + 1 < N_COLS && nodeValScratch[ni + 1] > best) best = nodeValScratch[ni + 1];
				if (r > 0 && nodeValScratch[ni - N_COLS] > best) best = nodeValScratch[ni - N_COLS];
				if (r + 1 < N_ROWS && nodeValScratch[ni + N_COLS] > best) best = nodeValScratch[ni + N_COLS];
				if (best > -0.08) nodeVal[ni] = Math.max(nodeVal[ni], best * 0.85 + 0.08);
			}
		}
	}

	function nodeTouchesSolid(nc, nr) {
		if (nc === 0 || nc === F_COLS || nr === 0 || nr === F_ROWS) return true;
		return Boolean(
			fSolid[(nr - 1) * F_COLS + (nc - 1)] ||
			fSolid[(nr - 1) * F_COLS + nc] ||
			fSolid[nr * F_COLS + (nc - 1)] ||
			fSolid[nr * F_COLS + nc]
		);
	}

	function pushContourSeg(x1, y1, x2, y2, slurry, c, r) {
		if (segCount >= MAX_SEGS) return;
		const dx = x2 - x1;
		const dy = y2 - y1;
		const len = Math.hypot(dx, dy);
		if (len < 1e-5) return;
		// Outward air normal in world coords (y-up): right-hand side is fluid, left-hand is air
		const nx = -dy / len;
		const ny = dx / len;
		// Skip meniscus highlight if the outward air side is actually solid rock!
		const mx = (x1 + x2) * 0.5 + nx * 0.14;
		const my = (y1 + y2) * 0.5 + ny * 0.14;
		if (sampleSdf(mx, my) < 0.05) return;
		const off = segCount * 7;
		segData[off] = x1;
		segData[off + 1] = y1;
		segData[off + 2] = x2;
		segData[off + 3] = y2;
		segData[off + 4] = nx;
		segData[off + 5] = ny;
		segData[off + 6] = slurry;
		segCount++;
	}

	// ---- Canvas Rendering ----

	let canvas = null;
	let ctx = null;
	let rockCanvas = null;
	let rockCtx = null;
	let rockImageData = null;

	function initRockBuffer() {
		if (typeof document === 'undefined') return;
		rockCanvas = document.createElement('canvas');
		rockCanvas.width = R_COLS;
		rockCanvas.height = R_ROWS;
		rockCtx = rockCanvas.getContext('2d');
		rockImageData = rockCtx.createImageData(R_COLS, R_ROWS);
	}

	function refreshRockBuffer() {
		if (!rockImageData) return;
		const data = rockImageData.data;
		for (let r = 0; r < R_ROWS; r++) {
			const py = R_ROWS - 1 - r;
			const rowOff = r * R_COLS;
			const imgRow = py * R_COLS * 4;
			for (let c = 0; c < R_COLS; c++) {
				const idx = rowOff + c;
				const p = imgRow + c * 4;
				const kind = rockSolid[idx];
				if (!kind) {
					data[p + 3] = 0;
					continue;
				}
				const pal = mineralPalette[rockMineral[idx]];
				const depthShade = clamp(0.74 + Math.min(0.28, -rockSdf[idx] * 0.12), 0.72, 1.05);
				const edgeBright = rockSdf[idx] > -0.18 ? 1.12 : 1.0;
				const str = clamp(rockStrength[idx], 0.18, 1.1);
				const soak = str < 0.65 ? 0.78 + str * 0.32 : 1.0;
				const tone = edgeBright * (kind === 2 ? 0.92 : 1.0) * soak / depthShade;
				data[p] = clamp((pal[0] * tone) | 0, 0, 255);
				data[p + 1] = clamp((pal[1] * tone) | 0, 0, 255);
				data[p + 2] = clamp((pal[2] * tone) | 0, 0, 255);
				data[p + 3] = 255;
			}
		}
		rockCtx.putImageData(rockImageData, 0, 0);
		state.rockDirty = false;
	}

	function waterColorAt(depthFrac, slurry) {
		// Clear water: deep teal-blue -> bright aqua; slurry shifts toward silty ochre-gold
		const s = clamp(slurry, 0, 1);
		const d = clamp(depthFrac, 0, 1);
		const cr = 20 + d * 24 + s * 155;
		const cg = 112 + d * 68 + s * 36;
		const cb = 162 + d * 64 - s * 86;
		return 'rgba(' + (cr | 0) + ',' + (cg | 0) + ',' + (cb | 0) + ',' + (0.82 - d * 0.08).toFixed(2) + ')';
	}

	// Pre-baked discrete water color palette (depth x slurry buckets -> zero string allocs per cell!)
	const PAL_DEPTH = 4;
	const PAL_SLURRY = 5;
	const waterFills = [];
	for (let s = 0; s < PAL_SLURRY; s++) {
		for (let d = 0; d < PAL_DEPTH; d++) {
			waterFills.push(waterColorAt(d / (PAL_DEPTH - 1), s / (PAL_SLURRY - 1)));
		}
	}

	function pickWaterFill(depthFrac, slurry) {
		const di = clamp(Math.round(depthFrac * (PAL_DEPTH - 1)), 0, PAL_DEPTH - 1);
		const si = clamp(Math.round(slurry * (PAL_SLURRY - 1)), 0, PAL_SLURRY - 1);
		return waterFills[si * PAL_DEPTH + di];
	}

	function drawSmoothWater(scale, W, H) {
		if (state.solver === 'hybrid') {
			buildHybridScalarField();
		} else if (state.solver === 'sph') {
			buildParticleScalarField(sphActive, sphX, sphY, sphSlurry, MAX_SPH, 0.45);
		} else {
			buildParticleScalarField(flipActive, flipX, flipY, flipSlurry, MAX_FLIP, 0.50);
		}

		segCount = 0;

		// Pass 1: Build ONE unified seamless water body path (zero alpha double-blend seams!)
		ctx.beginPath();
		for (let r = 0; r < F_ROWS; r++) {
			const nRow0 = r * N_COLS;
			const nRow1 = nRow0 + N_COLS;
			const y0 = r * F_CELL;
			const y1 = y0 + F_CELL;
			const pyTop = H - y1 * scale;
			const cellPx = F_CELL * scale;
			let runStart = -1;

			for (let c = 0; c <= F_COLS; c++) {
				let isFull = false;
				if (c < F_COLS) {
					const n00 = nRow0 + c;
					const n10 = n00 + 1;
					const n01 = nRow1 + c;
					const n11 = n01 + 1;
					const v0 = nodeVal[n00];
					const v1 = nodeVal[n10];
					const v2 = nodeVal[n11];
					const v3 = nodeVal[n01];
					const mask = (v0 > 0 ? 1 : 0) | (v1 > 0 ? 2 : 0) | (v2 > 0 ? 4 : 0) | (v3 > 0 ? 8 : 0);

					if (mask === 15) {
						isFull = true;
					} else if (mask !== 0) {
						if (runStart >= 0) {
							ctx.rect(runStart * cellPx, pyTop, (c - runStart) * cellPx, cellPx);
							runStart = -1;
						}
						const x0 = c * F_CELL;
						const x1 = x0 + F_CELL;
						const slurry = 0.25 * (nodeSlurry[n00] + nodeSlurry[n10] + nodeSlurry[n11] + nodeSlurry[n01]);

						vtxX[0] = x0; vtxY[0] = y0;
						vtxX[1] = x1; vtxY[1] = y0;
						vtxX[2] = x1; vtxY[2] = y1;
						vtxX[3] = x0; vtxY[3] = y1;
						vtxX[4] = x0 + F_CELL * clamp(v0 / (v0 - v1 || 1), 0, 1); vtxY[4] = y0;
						vtxX[5] = x1; vtxY[5] = y0 + F_CELL * clamp(v1 / (v1 - v2 || 1), 0, 1);
						vtxX[6] = x0 + F_CELL * clamp(v3 / (v3 - v2 || 1), 0, 1); vtxY[6] = y1;
						vtxX[7] = x0; vtxY[7] = y0 + F_CELL * clamp(v0 / (v0 - v3 || 1), 0, 1);

						if (mask === 5 || mask === 10) {
							const center = 0.25 * (v0 + v1 + v2 + v3);
							if (mask === 5) {
								if (center > 0) {
									addPoly6(0, 4, 5, 2, 6, 7, scale, H);
									pushContourSeg(vtxX[4], vtxY[4], vtxX[5], vtxY[5], slurry, c, r);
									pushContourSeg(vtxX[6], vtxY[6], vtxX[7], vtxY[7], slurry, c, r);
								} else {
									addPoly3(0, 4, 7, scale, H);
									addPoly3(2, 6, 5, scale, H);
									pushContourSeg(vtxX[7], vtxY[7], vtxX[4], vtxY[4], slurry, c, r);
									pushContourSeg(vtxX[5], vtxY[5], vtxX[6], vtxY[6], slurry, c, r);
								}
							} else {
								if (center > 0) {
									addPoly6(1, 5, 6, 3, 7, 4, scale, H);
									pushContourSeg(vtxX[5], vtxY[5], vtxX[6], vtxY[6], slurry, c, r);
									pushContourSeg(vtxX[7], vtxY[7], vtxX[4], vtxY[4], slurry, c, r);
								} else {
									addPoly3(1, 5, 4, scale, H);
									addPoly3(3, 7, 6, scale, H);
									pushContourSeg(vtxX[4], vtxY[4], vtxX[5], vtxY[5], slurry, c, r);
									pushContourSeg(vtxX[6], vtxY[6], vtxX[7], vtxY[7], slurry, c, r);
								}
							}
						} else {
							const poly = MS_POLY[mask];
							ctx.moveTo(vtxX[poly[0]] * scale, H - vtxY[poly[0]] * scale);
							for (let k = 1; k < poly.length; k++) {
								ctx.lineTo(vtxX[poly[k]] * scale, H - vtxY[poly[k]] * scale);
							}
							ctx.closePath();
							const seg = MS_SEG[mask];
							pushContourSeg(vtxX[seg[0]], vtxY[seg[0]], vtxX[seg[1]], vtxY[seg[1]], slurry, c, r);
						}
					}
				}

				if (isFull) {
					if (runStart < 0) runStart = c;
				} else if (runStart >= 0) {
					ctx.rect(runStart * cellPx, pyTop, (c - runStart) * cellPx, cellPx);
					runStart = -1;
				}
			}
		}

		// Fill unified water body with depth gradient (no ctx.clip — fast in all Canvas 2D engines!)
		const bodyGrad = ctx.createLinearGradient(0, 0, 0, H);
		bodyGrad.addColorStop(0, 'rgba(46, 178, 224, 0.78)');
		bodyGrad.addColorStop(0.55, 'rgba(26, 134, 186, 0.82)');
		bodyGrad.addColorStop(1, 'rgba(16, 86, 134, 0.88)');
		ctx.fillStyle = bodyGrad;
		ctx.fill();

		// Soft golden-ochre slurry turbidity tint & flow shimmer strictly inside submerged water
		drawSlurryOverlay(scale, H);
		drawFlowShimmer(scale, H);

		// Pass 2: Luminous visible free-surface meniscus (glow + crisp specular crest)
		if (segCount > 0) {
			ctx.lineCap = 'round';
			ctx.strokeStyle = 'rgba(116, 228, 255, 0.34)';
			ctx.lineWidth = 4.8;
			ctx.beginPath();
			for (let s = 0; s < segCount; s++) {
				const off = s * 7;
				ctx.moveTo(segData[off] * scale, H - segData[off + 1] * scale);
				ctx.lineTo(segData[off + 2] * scale, H - segData[off + 3] * scale);
			}
			ctx.stroke();

			ctx.strokeStyle = 'rgba(222, 251, 255, 0.94)';
			ctx.lineWidth = 2.0;
			ctx.beginPath();
			for (let s = 0; s < segCount; s++) {
				const off = s * 7;
				if (segData[off + 5] < -0.3) continue;
				ctx.moveTo(segData[off] * scale, H - segData[off + 1] * scale);
				ctx.lineTo(segData[off + 2] * scale, H - segData[off + 3] * scale);
			}
			ctx.stroke();
		}

		// Pass 3: Airborne jets, waterfall cascades & fine spray droplets
		drawSprayAndJets(scale, H);
	}

	function drawSlurryOverlay(scale, H) {
		const cellPx = F_CELL * scale;
		ctx.fillStyle = 'rgba(218, 178, 86, 0.24)';
		ctx.beginPath();
		for (let r = 0; r < F_ROWS; r++) {
			const nRow0 = r * N_COLS;
			const nRow1 = nRow0 + N_COLS;
			const pyTop = H - (r + 1) * cellPx;
			let runStart = -1;
			for (let c = 0; c <= F_COLS; c++) {
				let wetSlurry = false;
				if (c < F_COLS) {
					const n00 = nRow0 + c;
					if (nodeVal[n00] > 0.12 && nodeVal[n00 + 1] > 0.12 && nodeVal[nRow1 + c] > 0.12 && nodeVal[nRow1 + c + 1] > 0.12) {
						const s = 0.25 * (nodeSlurry[n00] + nodeSlurry[n00 + 1] + nodeSlurry[nRow1 + c] + nodeSlurry[nRow1 + c + 1]);
						if (s >= 0.08) wetSlurry = true;
					}
				}
				if (wetSlurry) {
					if (runStart < 0) runStart = c;
				} else if (runStart >= 0) {
					ctx.rect(runStart * cellPx, pyTop, (c - runStart) * cellPx, cellPx);
					runStart = -1;
				}
			}
		}
		ctx.fill();
	}

	function addPoly3(a, b, c, scale, H) {
		ctx.moveTo(vtxX[a] * scale, H - vtxY[a] * scale);
		ctx.lineTo(vtxX[b] * scale, H - vtxY[b] * scale);
		ctx.lineTo(vtxX[c] * scale, H - vtxY[c] * scale);
		ctx.closePath();
	}

	function addPoly6(a, b, c, d, e, f, scale, H) {
		ctx.moveTo(vtxX[a] * scale, H - vtxY[a] * scale);
		ctx.lineTo(vtxX[b] * scale, H - vtxY[b] * scale);
		ctx.lineTo(vtxX[c] * scale, H - vtxY[c] * scale);
		ctx.lineTo(vtxX[d] * scale, H - vtxY[d] * scale);
		ctx.lineTo(vtxX[e] * scale, H - vtxY[e] * scale);
		ctx.lineTo(vtxX[f] * scale, H - vtxY[f] * scale);
		ctx.closePath();
	}

	function drawFlowShimmer(scale, H) {
		ctx.strokeStyle = 'rgba(185, 242, 255, 0.24)';
		ctx.lineWidth = 1.2;
		ctx.beginPath();
		if (state.solver === 'hybrid') {
			for (let r = 0; r < F_ROWS; r++) {
				const row = r * F_COLS;
				const eRow = r * (F_COLS + 1);
				for (let c = 0; c < F_COLS; c++) {
					if (((c * 7 + r * 13) & 3) !== 0) continue;
					const i = row + c;
					if (fSolid[i] || cellWater[i] < 0.45) continue;
					const u = (edgeU[eRow + c] + edgeU[eRow + c + 1]) * 0.5;
					const fall = cellFall[i];
					if (Math.abs(u) < 0.28 && fall < 0.28) continue;
					const jx = (hash2(c, r, 3) - 0.5) * 0.7;
					const jy = (hash2(c, r, 5) - 0.5) * 0.7;
					const sx = (c + 0.5 + jx) * F_CELL * scale;
					const sy = H - (r + 0.5 + jy) * F_CELL * scale;
					ctx.moveTo(sx, sy);
					ctx.lineTo(sx + clamp(u * 4.5, -8, 8), sy + fall * 8);
				}
			}
		} else {
			const act = state.solver === 'sph' ? sphActive : flipActive;
			const px = state.solver === 'sph' ? sphX : flipX;
			const py = state.solver === 'sph' ? sphY : flipY;
			const pvx = state.solver === 'sph' ? sphVx : flipVx;
			const pvy = state.solver === 'sph' ? sphVy : flipVy;
			const maxN = state.solver === 'sph' ? MAX_SPH : MAX_FLIP;
			for (let i = 0; i < maxN; i += 2) {
				if (!act[i]) continue;
				const sp = Math.hypot(pvx[i], pvy[i]);
				if (sp < 1.3) continue;
				const sx = px[i] * scale;
				const sy = H - py[i] * scale;
				ctx.moveTo(sx, sy);
				ctx.lineTo(sx - pvx[i] * 0.75, sy + pvy[i] * 0.75);
			}
		}
		ctx.stroke();
	}

	function drawSprayAndJets(scale, H) {
		if (state.solver === 'hybrid') {
			ctx.lineCap = 'round';
			for (let i = 0; i < MAX_JET; i++) {
				if (!jetActive[i]) continue;
				const sx = jetX[i] * scale;
				const sy = H - jetY[i] * scale;
				const isCascade = jetKind[i] === 1;
				const trailT = isCascade ? 0.042 : 0.024;
				const tailX = (jetX[i] - jetVx[i] * trailT) * scale;
				const tailY = H - (jetY[i] - jetVy[i] * trailT) * scale;
				const hasSlurry = jetSlurry[i] > 0.08;
				ctx.strokeStyle = hasSlurry
					? 'rgba(218, 190, 108, 0.82)'
					: (isCascade ? 'rgba(62, 196, 236, 0.80)' : 'rgba(130, 232, 255, 0.82)');
				ctx.lineWidth = isCascade ? (4.5 + Math.min(5, jetVol[i] * 14)) : 4.2;
				ctx.beginPath();
				ctx.moveTo(tailX, tailY);
				ctx.lineTo(sx, sy);
				ctx.stroke();
				ctx.fillStyle = isCascade ? 'rgba(210, 248, 255, 0.85)' : '#dffaff';
				ctx.beginPath();
				ctx.arc(sx, sy, isCascade ? 3.2 : 2.1, 0, Math.PI * 2);
				ctx.fill();
			}
			return;
		}

		// For SPH & FLIP: draw isolated fast spray/jet particles outside the contour threshold
		const act = state.solver === 'sph' ? sphActive : flipActive;
		const px = state.solver === 'sph' ? sphX : flipX;
		const py = state.solver === 'sph' ? sphY : flipY;
		const pvx = state.solver === 'sph' ? sphVx : flipVx;
		const pvy = state.solver === 'sph' ? sphVy : flipVy;
		const psl = state.solver === 'sph' ? sphSlurry : flipSlurry;
		const maxN = state.solver === 'sph' ? MAX_SPH : MAX_FLIP;
		const showAll = state.renderMode === 'debug';

		for (let i = 0; i < maxN; i++) {
			if (!act[i]) continue;
			const nc = clamp(Math.round(px[i] / F_CELL), 0, N_COLS - 1);
			const nr = clamp(Math.round(py[i] / F_CELL), 0, N_ROWS - 1);
			const isolated = nodeVal[nr * N_COLS + nc] < 0.06;
			if (!isolated && !showAll) continue;
			const sx = px[i] * scale;
			const sy = H - py[i] * scale;
			if (isolated) {
				ctx.strokeStyle = psl[i] > 0.25 ? 'rgba(220, 198, 120, 0.8)' : 'rgba(128, 230, 255, 0.75)';
				ctx.lineWidth = 3.2;
				ctx.beginPath();
				ctx.moveTo(sx - pvx[i] * 0.9, sy + pvy[i] * 0.9);
				ctx.lineTo(sx, sy);
				ctx.stroke();
			} else if (showAll) {
				ctx.fillStyle = psl[i] > 0.25 ? 'rgba(240, 210, 120, 0.5)' : 'rgba(215, 248, 255, 0.35)';
				ctx.fillRect(sx - 1.2, sy - 1.2, 2.4, 2.4);
			}
		}
	}

	function drawRawSim(scale, H) {
		if (state.solver === 'hybrid') {
			const cellPx = F_CELL * scale;
			for (let r = 0; r < F_ROWS; r++) {
				const row = r * F_COLS;
				for (let c = 0; c < F_COLS; c++) {
					const i = row + c;
					const w = cellWater[i];
					if (w <= 0.005 || fSolid[i]) continue;
					const h = Math.min(1, w) * cellPx;
					const slurry = Math.min(1, cellSlurry[i] / (w * 0.9));
					ctx.fillStyle = pickWaterFill(1 - Math.min(1, w * 0.8), slurry);
					ctx.fillRect(c * cellPx, H - r * cellPx - h, cellPx - 0.5, h);
				}
			}
			drawSprayAndJets(scale, H);
			return;
		}
		const act = state.solver === 'sph' ? sphActive : flipActive;
		const px = state.solver === 'sph' ? sphX : flipX;
		const py = state.solver === 'sph' ? sphY : flipY;
		const psl = state.solver === 'sph' ? sphSlurry : flipSlurry;
		const maxN = state.solver === 'sph' ? MAX_SPH : MAX_FLIP;
		for (let i = 0; i < maxN; i++) {
			if (!act[i]) continue;
			ctx.fillStyle = psl[i] > 0.25 ? '#d8b96a' : '#52ccf2';
			ctx.beginPath();
			ctx.arc(px[i] * scale, H - py[i] * scale, 3.2, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	function drawPlatformAndOverlays(scale, H) {
		const px = platform.x * scale;
		const py = H - platform.y * scale;

		// Under-platform suction intake zone & active streamlines
		if (state.pumpOn) {
			const active = state.lastSuctionRate > 0.015;
			ctx.save();
			ctx.translate(px, py);
			ctx.rotate(-platform.angle);
			const sw = SUCTION_HALF * 2 * scale;
			const grad = ctx.createLinearGradient(0, -0.22 * scale, 0, 0.55 * scale);
			grad.addColorStop(0, active ? 'rgba(120, 240, 255, 0.34)' : 'rgba(86, 204, 242, 0.12)');
			grad.addColorStop(1, 'rgba(86, 204, 242, 0.0)');
			ctx.fillStyle = grad;
			ctx.fillRect(-SUCTION_HALF * scale, -0.24 * scale, sw, 0.78 * scale);

			// Animated upward suction chevrons when retrieving water under the platform
			ctx.strokeStyle = active ? 'rgba(185, 250, 255, 0.85)' : 'rgba(86, 204, 242, 0.32)';
			ctx.lineWidth = active ? 1.8 : 1.1;
			const phase = (state.suctionPulse % 1);
			for (let k = -2; k <= 2; k++) {
				const lx = k * 0.58 * scale;
				const ly = (0.36 - phase * 0.52) * scale;
				ctx.beginPath();
				ctx.moveTo(lx - 4, ly + 4);
				ctx.lineTo(lx, ly);
				ctx.lineTo(lx + 4, ly + 4);
				ctx.stroke();
			}
			ctx.restore();
		}

		// Platform chassis matching the game's arched-belly wheeled rig
		ctx.save();
		ctx.translate(px, py);
		ctx.rotate(-platform.angle);

		// Wheels
		ctx.fillStyle = '#1e2c31';
		ctx.strokeStyle = '#7b9299';
		ctx.lineWidth = 2;
		for (let sign = -1; sign <= 1; sign += 2) {
			ctx.beginPath();
			ctx.arc(sign * WHEEL_HALF * scale, -WHEEL_R * scale, WHEEL_R * scale, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		}

		// Hull with belly arch & under-belly suction intake bar
		ctx.fillStyle = '#2d4147';
		ctx.strokeStyle = '#92acb2';
		ctx.lineWidth = 1.6;
		ctx.beginPath();
		ctx.moveTo(-PLAT_HALF * scale, -PLAT_DECK * scale);
		ctx.lineTo(PLAT_HALF * scale, -PLAT_DECK * scale);
		ctx.lineTo(PLAT_HALF * scale, -0.52 * scale);
		ctx.lineTo(WHEEL_HALF * scale, -0.22 * scale);
		ctx.quadraticCurveTo(0, -0.44 * scale, -WHEEL_HALF * scale, -0.22 * scale);
		ctx.lineTo(-PLAT_HALF * scale, -0.52 * scale);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();

		// Under-belly intake grill
		ctx.strokeStyle = state.pumpOn ? '#56ccf2' : '#4a5c62';
		ctx.lineWidth = 2.6;
		ctx.beginPath();
		ctx.moveTo(-1.15 * scale, -0.32 * scale);
		ctx.lineTo(1.15 * scale, -0.32 * scale);
		ctx.stroke();

		// Collector hopper strip (fills gold with recovered slurry!)
		const collW = PLAT_W * 0.35 * scale;
		ctx.fillStyle = '#e6b66e';
		ctx.fillRect(-PLAT_HALF * scale, -PLAT_DECK * scale, collW, 0.14 * scale);

		// Aimed water gun turret on the collector
		const noz = getNozzle();
		const aimAng = Math.atan2(noz.dy, noz.dx) - platform.angle;
		ctx.save();
		ctx.translate(NOZZLE_LOCAL_X * scale, -PLAT_DECK * scale);
		ctx.rotate(-aimAng);
		ctx.fillStyle = '#479bb8';
		ctx.strokeStyle = '#c0f2ff';
		ctx.lineWidth = 1.2;
		ctx.fillRect(0, -0.055 * scale, 0.36 * scale, 0.11 * scale);
		ctx.strokeRect(0, -0.055 * scale, 0.36 * scale, 0.11 * scale);
		ctx.restore();

		ctx.restore();

		// Aim ballistic preview dots (only in gun mode)
		if (state.tool === 'gun') {
			const noz = getNozzle();
			const vx = platform.vx + noz.dx * state.jetSpeed;
			const vy = noz.dy * state.jetSpeed;
			ctx.fillStyle = 'rgba(134, 232, 255, 0.55)';
			for (let k = 1; k <= 10; k++) {
				const t = k * 0.055;
				const tx = noz.x + vx * t;
				const ty = noz.y + vy * t - 0.5 * GRAVITY * t * t;
				if (tx < 0 || tx > WORLD_W || ty < 0 || ty > WORLD_H || sampleSdf(tx, ty) < 0) break;
				ctx.beginPath();
				ctx.arc(tx * scale, H - ty * scale, 2.2, 0, Math.PI * 2);
				ctx.fill();
			}
		} else {
			// Cursor brush ring for pour / carve / build
			ctx.strokeStyle = state.tool === 'pour' ? '#56ccf2' : state.tool === 'carve' ? '#e07a6a' : '#b9ed91';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.arc(input.aimX * scale, H - input.aimY * scale, 0.55 * scale, 0, Math.PI * 2);
			ctx.stroke();
		}
	}

	function drawFrame() {
		if (!ctx || !canvas) return;
		const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
		const W = canvas.width;
		const H = canvas.height;
		const scale = W / WORLD_W;

		// Backdrop + subtle metric grid
		ctx.fillStyle = '#081014';
		ctx.fillRect(0, 0, W, H);
		ctx.strokeStyle = 'rgba(42, 62, 68, 0.28)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let m = 2; m < WORLD_W; m += 2) {
			ctx.moveTo(m * scale, 0);
			ctx.lineTo(m * scale, H);
		}
		for (let m = 2; m < WORLD_H; m += 2) {
			ctx.moveTo(0, H - m * scale);
			ctx.lineTo(W, H - m * scale);
		}
		ctx.stroke();

		// Draw water BEFORE solid rock so solid-wall extrapolation meets curved caves 100% flush!
		if (state.renderMode === 'raw') {
			drawRawSim(scale, H);
		} else {
			drawSmoothWater(scale, W, H);
		}

		// Draw crisp rock / cave geometry on top
		if (state.rockDirty) refreshRockBuffer();
		if (rockCanvas) {
			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(rockCanvas, 0, 0, W, H);
			ctx.imageSmoothingEnabled = true;
		}

		// Platform, suction intake, nozzle & cursor overlay
		drawPlatformAndOverlays(scale, H);

		if (typeof performance !== 'undefined') {
			const ms = performance.now() - t0;
			state.drawMs = state.drawMs * 0.88 + ms * 0.12;
		}
	}

	// ---- Browser UI Wiring ----

	const modeDescriptions = {
		hybrid: 'Hybrid (Jet + 2D Cells): aimed ballistic jet dissolves rock and deposits into a 96×60 hydrostatic + wave-momentum grid. Unlimited volume, exact slurry conservation, U-tube equalization, smooth Marching Squares surface.',
		sph: 'Particles (2D SPH / DDR): unified Clavet Double-Density Relaxation particles (cap 1,800) with spatial hash and exact 192×120 cave SDF collision. Natural splashes & surface tension; hits particle cap under heavy unlimited flooding.',
		flip: 'Grid+Particle (2D FLIP): staggered 96×60 MAC grid Gauss-Seidel pressure projection + advected particles (cap 2,400). Incompressible flat pools, crisp waves & bow wakes; capped particle pool and heavier to row-stream.'
	};

	let syncUiHook = null;

	function bindUi() {
		if (typeof document === 'undefined') return;
		canvas = document.getElementById('stage');
		if (!canvas) return;
		ctx = canvas.getContext('2d');
		initRockBuffer();

		const elHeading = document.getElementById('stage-heading');
		const elNotes = document.getElementById('mode-notes');
		const elPerf = document.getElementById('perf-badge');
		const elWater = document.getElementById('m-water');
		const elUnits = document.getElementById('m-units');
		const elFlooded = document.getElementById('m-flooded');
		const elPumped = document.getElementById('m-pumped');
		const elDissolved = document.getElementById('m-dissolved');
		const elSlurry = document.getElementById('m-slurry');
		const elHopper = document.getElementById('m-hopper');
		const elDrift = document.getElementById('m-drift');

		function syncButtons() {
			document.querySelectorAll('#solver-buttons button').forEach((b) => {
				b.classList.toggle('is-active', b.dataset.solver === state.solver);
			});
			document.querySelectorAll('#scene-buttons button').forEach((b) => {
				b.classList.toggle('is-active', b.dataset.scene === state.scene);
			});
			document.querySelectorAll('#tool-buttons button').forEach((b) => {
				b.classList.toggle('is-active', b.dataset.tool === state.tool);
			});
			document.querySelectorAll('.compare-table tr[data-row]').forEach((tr) => {
				tr.classList.toggle('is-current', tr.dataset.row === state.solver);
			});
			const solverLabel = state.solver === 'hybrid' ? 'HYBRID (JET + 2D CELLS)' : state.solver === 'sph' ? 'PARTICLES (2D SPH)' : 'GRID+PARTICLE (2D FLIP)';
			elHeading.textContent = 'CHAMBER · 24 × 15 m · ' + solverLabel;
			elNotes.textContent = modeDescriptions[state.solver];
		}
		syncUiHook = syncButtons;

		document.getElementById('solver-buttons').addEventListener('click', (e) => {
			const btn = e.target.closest('button[data-solver]');
			if (!btn) return;
			state.solver = btn.dataset.solver;
			loadScene(state.scene);
			syncButtons();
		});

		document.getElementById('scene-buttons').addEventListener('click', (e) => {
			const btn = e.target.closest('button[data-scene]');
			if (!btn) return;
			loadScene(btn.dataset.scene);
			syncButtons();
		});

		document.getElementById('tool-buttons').addEventListener('click', (e) => {
			const btn = e.target.closest('button[data-tool]');
			if (!btn) return;
			state.tool = btn.dataset.tool;
			syncButtons();
		});

		document.getElementById('render-modes').addEventListener('change', (e) => {
			if (e.target.name === 'render-mode') state.renderMode = e.target.value;
		});

		const elPump = document.getElementById('pump-on');
		elPump.addEventListener('change', () => { state.pumpOn = elPump.checked; });
		const elAuto = document.getElementById('auto-fire');
		elAuto.addEventListener('change', () => { state.autoFire = elAuto.checked; });
		const elDiss = document.getElementById('dissolve-on');
		elDiss.addEventListener('change', () => { state.dissolveOn = elDiss.checked; });

		function bindRange(id, outId, prop, fmt) {
			const el = document.getElementById(id);
			const out = document.getElementById(outId);
			el.addEventListener('input', () => {
				state[prop] = Number(el.value);
				out.textContent = fmt(state[prop]);
			});
		}
		bindRange('jet-speed', 'jet-speed-out', 'jetSpeed', (v) => v.toFixed(1) + ' m/s');
		bindRange('jet-flow', 'jet-flow-out', 'flowRate', (v) => v.toFixed(1) + '×');
		bindRange('pump-rate', 'pump-rate-out', 'pumpRate', (v) => v.toFixed(1) + '×');
		bindRange('dissolve-rate', 'dissolve-rate-out', 'dissolveRate', (v) => v.toFixed(1) + '×');

		document.getElementById('flood-pulse').addEventListener('click', () => {
			fillWaterBox(platform.x - 3.2, platform.x + 3.2, platform.y + 2.8, platform.y + 4.4);
		});
		document.getElementById('drain-all').addEventListener('click', clearWater);
		document.getElementById('reset-scene').addEventListener('click', () => loadScene(state.scene));
		const elPause = document.getElementById('pause-btn');
		elPause.addEventListener('click', () => {
			state.paused = !state.paused;
			elPause.textContent = state.paused ? 'Resume' : 'Pause';
		});
		document.getElementById('step-btn').addEventListener('click', () => {
			state.paused = true;
			elPause.textContent = 'Resume';
			stepSim(1 / 60);
			drawFrame();
		});

		function pointerToWorld(e) {
			const rect = canvas.getBoundingClientRect();
			const nx = clamp((e.clientX - rect.left) / rect.width, 0, 1);
			const ny = clamp((e.clientY - rect.top) / rect.height, 0, 1);
			input.aimX = nx * WORLD_W;
			input.aimY = (1 - ny) * WORLD_H;
		}

		canvas.addEventListener('contextmenu', (e) => e.preventDefault());
		canvas.addEventListener('pointerdown', (e) => {
			pointerToWorld(e);
			canvas.setPointerCapture(e.pointerId);
			if (e.button === 2) input.rightDown = true;
			else input.pointerDown = true;
		});
		canvas.addEventListener('pointermove', (e) => { pointerToWorld(e); });
		canvas.addEventListener('pointerup', (e) => {
			if (e.button === 2) input.rightDown = false;
			else input.pointerDown = false;
		});
		canvas.addEventListener('pointercancel', () => {
			input.pointerDown = false;
			input.rightDown = false;
		});

		window.addEventListener('keydown', (e) => {
			if (e.code === 'KeyA' || e.code === 'ArrowLeft') { input.left = true; e.preventDefault(); }
			if (e.code === 'KeyD' || e.code === 'ArrowRight') { input.right = true; e.preventDefault(); }
			if (e.code === 'Space' || e.code === 'KeyF') { input.fireKey = true; e.preventDefault(); }
			if (e.code === 'KeyP') {
				state.pumpOn = !state.pumpOn;
				elPump.checked = state.pumpOn;
			}
		});
		window.addEventListener('keyup', (e) => {
			if (e.code === 'KeyA' || e.code === 'ArrowLeft') input.left = false;
			if (e.code === 'KeyD' || e.code === 'ArrowRight') input.right = false;
			if (e.code === 'Space' || e.code === 'KeyF') input.fireKey = false;
		});

		let lastTs = 0;
		let readoutClock = 0;
		function loop(ts) {
			const rawDt = lastTs ? Math.min(0.05, (ts - lastTs) * 0.001) : 1 / 60;
			lastTs = ts;
			if (rawDt > 0) state.fps = state.fps * 0.9 + (1 / rawDt) * 0.1;

			if (!state.paused) stepSim(1 / 60);
			drawFrame();

			readoutClock += rawDt;
			if (readoutClock >= 0.1) {
				readoutClock = 0;
				const m = measureMetrics();
				elPerf.textContent = state.fps.toFixed(0) + ' fps · sim ' + state.simMs.toFixed(2) + ' ms · draw ' + state.drawMs.toFixed(2) + ' ms';
				elWater.textContent = m.waterArea.toFixed(2) + ' m²';
				elUnits.textContent = state.solver === 'hybrid'
					? m.activeUnits + ' wet cells'
					: m.activeUnits + ' / ' + m.unitCap + ' pts';
				elUnits.className = state.solver !== 'hybrid' && m.activeUnits >= m.unitCap - 4 ? 'is-warn' : '';
				elFlooded.textContent = state.floodedArea.toFixed(2) + ' m²';
				elPumped.textContent = state.pumpedArea.toFixed(2) + ' m²';
				elDissolved.textContent = state.dissolvedCells + ' cells';
				elSlurry.textContent = m.suspendedSlurry.toFixed(2) + ' cells';
				elHopper.textContent = state.hopperSlurry.toFixed(2) + ' cells';
				elDrift.textContent = m.slurryDrift.toFixed(4);
				elDrift.className = m.slurryDrift < 0.001 ? 'is-good' : 'is-warn';
			}
			requestAnimationFrame(loop);
		}

		loadScene('classic');
		syncButtons();
		requestAnimationFrame(loop);
	}

	const api = {
		state,
		platform,
		input,
		loadScene,
		clearWater,
		fillWaterBox,
		stepSim,
		drawFrame,
		measureMetrics,
		sampleSdf,
		sculptRock,
		syncUi: () => { if (syncUiHook) syncUiHook(); },
		F_COLS,
		F_ROWS,
		F_CELL,
		R_COLS,
		R_ROWS,
		cellWater,
		cellSlurry
	};

	root.SteamWaterLab = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else if (typeof document !== 'undefined') {
		if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindUi);
		else bindUi();
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
