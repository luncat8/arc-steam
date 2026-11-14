// The chamber's rock: the geology of js/minerals.js through the sampler and
// formation of js/geology.js, with the shared strength, colour and base-price
// rules of js/rock-materials.js. There is no second material table and no
// copied formula: a lab parameter change reaches the game through
// js/geology-config.js alone.
// Depends on: js/minerals.js, js/geology-config.js, js/element-cdf.js,
// js/geology.js, js/rock-materials.js
(function (root) {
	'use strict';
	const node = typeof module !== 'undefined' && module.exports;
	const rockTable = node ? require('./minerals.js') : root.SteamMinerals;
	const geologyConfig = node ? require('./geology-config.js') : root.SteamGeologyConfig;
	const geology = node ? require('./geology.js') : root.SteamGeology;
	const materials = node ? require('./rock-materials.js') : root.SteamRockMaterials;
	const width = 24;
	const initialBottom = 11.375;
	const top = 15;
	// Rock is limited to 70% of chamber height (10.5 m): at least 30% (4.5 m)
	// stays open below, and intact lower rock is never destroyed when capped.
	const maxRockShare = 0.7;
	const minOpenShare = 1 - maxRockShare;
	const minBottom = top * minOpenShare;
	const cell = 0.125;
	// Debris Y compression: how many times wider than tall a fallen-soil tile is.
	// 4 is the classic 4:1 floor (0.125 m by 0.03125 m); 1 makes square rubble,
	// 8 the flattest sheet. It scales the drawn height of a pile, never the
	// material in it: every cells-to-metres conversion below reads this value.
const floorCompressionMin = 1;
const floorCompressionMax = 8;
let floorCompression = 4;
function floorCellHeightNow() { return cell / floorCompression; }
// A pile is stored in metres, so the same material is a different height at a
// different factor. Changing the factor therefore re-lays every column by the
// same ratio: no cell is created or lost, and the surface the ball and the
// platform ride moves with the picture instead of lagging behind it. A column
// that the new factor would push through the roof keeps what fits there and
// books the rest as lost, exactly like a deposit at the cap.
function setFloorCompression(value) {
	const next = Math.round(Number(value) * 2) / 2;
	const factor = Number.isFinite(next) ? Math.max(floorCompressionMin, Math.min(floorCompressionMax, next)) : 4;
	if (factor === floorCompression) return floorCompression;
	const ratio = floorCompression / factor;
	floorCompression = factor;
	for (let column = 0; column < columns; column++) {
		const height = floorPiles[column] * ratio;
		if (height <= pileLimit) {
			floorPiles[column] = height;
			continue;
		}
		const kept = height > 0 ? pileLimit / height : 0;
		const lost = 1 - kept;
		lostCells += lost * height / floorCellHeightNow();
		lostValue += lost * floorValues[column];
		floorValues[column] *= kept;
		floorPiles[column] = pileLimit;
	}
	updateFloor();
	return floorCompression;
}
	const defaultPixelSize = 4;
	const columns = Math.round(width / cell);
	const initialRows = Math.round((top - initialBottom) / cell);
	const maxRows = Math.round((top - minBottom) / cell) + 36;
	const maxCount = columns * maxRows;
	const maxDebris = columns * initialRows;
	// Queued top rows slide in smoothly at up to 5 rows/s instead of popping in.
	const growthRate = 5;
	const boundaryLookahead = 0.35;
	let rows = initialRows;
	let bottom = initialBottom;
	let baseRow = 0;
	let generatedRows = initialRows;
	let totalShift = 0;
	let queuedShift = 0;
	const storageLimit = 100;
	const cellMass = 0.6;
	const gravity = 9.81;
	const cargoHeight = 0.7;
	// Fallen rubble piles up on the floor heightmap, the mirror of the rock
	// surface above. A pile may stand as high as the roof and no higher: the
	// chamber's own ceiling is the only level a column cannot pass, so rubble
	// can bury the whole flight room when enough of the rock has come down.
	const pileLimit = top;
	// The grader works a swath under the platform centre while it moves,
	// not ahead of it. Neighbours flow toward their mean and the blade shaves
	// the top, clamped at the original floor so it cannot dig pits beneath
	// the chassis. Working adds rolling resistance (see physics graderFriction).
	const graderCut = 0.03;
	const graderSmooth = 0.4;
	const graderClearance = 0.5;
	const graderSwath = 1.5;
	// The commercial grader lives in a recessed low bay outside the right wall.
	// Calling and dismissing change its route, never its existence: a dismissed
	// bot drives back to this same visible parking place before becoming idle.
	const garageHeight = 0.25;
	const garageDepth = 1.5;
	const garageParkX = width + (garageDepth - 0.12) * 0.5;
	const graderSpeed = 1.5;
	// The blade keeps the value of the material its edge removed. The share is
	// the garage grader's 50% for the same reason: the machine that ground the
	// rubble does half the work, the platform that carried the blade the rest.
	const graderShare = 0.5;
	// A quarter of a second without finding rubble is a pause, not a pass: the
	// blade settles its stint then instead of waiting for the platform to stop.
	const bladeSettleDelay = 0.25;
	const blade = { value: 0, idle: 0 };
	// Impact tuning: hit point receives 2x impact energy in strength removal,
	// falling to zero across a 8.78-cell radius (2.93× the base 3-cell radius,
	// 1.5× the previous 5.85-cell radius) with a fast power-2.8 falloff.
	// Balls can add damage, radius and trade retention: see equipment.balls.
	// New curve falls a lot faster from the contact point: 1-2 cells typically
	// destroyed, medium damage in mid-ring, slight damage in wide tail.
	// power 2.8 gives ~0.68 at 1 cell, ~0.42 at 2 cells, ~0.10 at 5 cells vs linear 0.89/0.77/0.43.
	const baseDamageRadius = 8.775;
	const baseDamageMultiplier = 2;
	const baseDamageRange = 9;
	const damageFalloffPower = 2.8;
	// Delayed collapse. A hit weakens cells and leaves them standing; the rock
	// only lets go later, in a handful of loose pixels from a region that keeps
	// failing its roll. Damage in a region is the mean of how far its cells have
	// been taken down, so a heavily battered pocket of rock becomes the likeliest
	// place for the next fall without any pixel falling on the hit itself.
	const collapseRegionsX = 12;
	const collapseRegionsY = 6;
	const bandColumns = Math.ceil(columns / collapseRegionsX);
	const bandRows = Math.ceil(initialRows / collapseRegionsY);
	const regionCount = collapseRegionsX * collapseRegionsY;
	// A hit loosens rock instead of tearing it down: the share of a cell's
	// remaining strength the blow removes becomes the cell's damage, and only
	// when a region's rock is loose enough does the ceiling start giving way.
	// A hit loosens a cell far more than it weakens it: the share of a cell's
	// remaining strength taken becomes four times the share of its looseness it
	// gains. So the rock keeps answering the ball with intact rock that is close
	// to letting go, and the ceiling spends its time on the verge of a fall
	// instead of on the verge of crumbling.
	const loosedPerWeakened = 4;
	// A blow spends at most this share of a cell's remaining strength, so a single
	// impact never finishes a cell: the contact cells stay standing and the ring
	// around them is left loose, to fall later in a collapse burst.
	const hitLooseCap = 0.5;
	const collapseLooseFloor = 0.3;
	const collapseChanceSeconds = 0.25;
	// One blow never brings a band down: its mean looseness starts around the
	// loose floor, and the chance to let go ramps to half as the same spot is hit
	// again and again.
	const collapseChanceMax = 0.5;
	const collapseChanceSaturation = 1;
	const collapseChunkMin = 1;
	const collapseChunkMax = 4;
	// The mineral sliders run from a plain loose-face clump to a wide group.
	// The rock's element field is smooth, so no exact percentage separates the
	// two behaviours: growth is a mixing weight. At minClusterGrowth a release
	// is the original clump (loose free faces taken as they come); from there the
	// group rule takes over cell by cell until clusterGrowthFull, where every
	// cell of a piece is a connected, mineral-matched flake off the seed's face.
	const minClusterGrowth = 10;
	const maxClusterGrowth = 500;
	const clusterGrowthFull = 200;
	const collapseClumpLimit = collapseChunkMax * (1 + maxClusterGrowth / 100);
	const clumpDepthCost = 2;
	const maxSurfaceStep = 1;
	// A blow that would finish a cell with rock still under it leaves it hanging
	// at this share of its original strength instead. The free face is the only
	// rock that can be missing, so a fall always starts on the visible surface
	// and never out of the middle of a column.
	const heldCellShare = 0.12;
	const regionDamage = new Float32Array(regionCount);
	const regionEligible = new Int32Array(regionCount);
	// Each horizontal band tracks its loose free-surface columns, and a cluster
	// peels columns inward from firstRow so interior holes can never form.
	const bandLoose = new Int32Array(bandColumns);
	const clusterCells = new Int32Array(collapseClumpLimit);
	const peeled = new Uint8Array(columns);
	let collapseClock = 0;
	// One increment per pass, so the same rock does not keep rolling the same
	// number and a damaged region both fails and, later, succeeds.
	let collapseRoll = 0;
	// Drawable dust of the last few collapses: a ring of cells that fades out.
	const dustCount = 96;
	const dustX = new Float64Array(dustCount);
	const dustY = new Float64Array(dustCount);
	const dustLife = 0.55;
	const dustAge = new Float64Array(dustCount).fill(dustLife);
	let dustCursor = 0;
	function installed(channel, owner, extra) {
		const id = owner || 'rig';
		const machinery = root.SteamEquipment;
		const technology = root.SteamResearch;
		const equipmentState = machinery ? machinery.stateFor(id) : null;
		const researchState = technology ? technology.stateFor(id) : null;
		const base = (equipmentState ? equipmentState[channel] || 0 : 0) + (researchState ? researchState[channel] || 0 : 0);
		return extra ? base + (extra[channel] || 0) : base;
	}
	function damageRadiusNow(owner, extra) { return baseDamageRadius + installed('damageRadiusBonus', owner, extra); }
	function damageMultiplierNow(owner, extra) { return baseDamageMultiplier + installed('damageBonus', owner, extra); }
	function damageRangeNow(owner) { return Math.ceil(damageRadiusNow(owner)); }
	// The one material table: js/minerals.js. A mineral is a signature range in
	// the independent element cube, and the narrow signatures are the rare ones
	// because the field finds them rarely. Colour, impact strength, default fall
	// grouping and market behaviour all come from that row.
	const mineralTable = rockTable.mineralTable;
	const mineralCount = rockTable.mineralCount;
	const mineralNames = rockTable.mineralNames;
	const mineralSymbols = rockTable.mineralSymbols;
	const mineralIds = rockTable.mineralIds;
	const hostIndex = rockTable.hostIndex;
	// Element channels, in the order the typed arrays store them.
	const channelKeys = geologyConfig.channelKeys;
	// Base-price economy, shared with the lab and the probes.
	const targetCellValue = materials.economy.targetCellValue;
	const priceElasticity = materials.economy.elasticity;
	const mineralPriceFloor = materials.economy.floor;
	const mineralPriceCap = materials.economy.cap;
	const marketInterval = 0.5;
	const mineralBasePrices = new Float64Array(mineralCount);
	const mineralPrices = new Float64Array(mineralCount);
	const mineralTrends = new Float64Array(mineralCount);
	const mineralAbundance = new Float64Array(mineralCount);
	const demandBias = new Float64Array(mineralCount);
	const demandDepth = new Float64Array(mineralCount);
	const demandPeriod = new Float64Array(mineralCount);
	const demandPhase = new Float64Array(mineralCount);
	let marketClock = 0;
	let marketBudget = 0;
	const initialStrength = new Float32Array(maxCount);
	const strength = new Float32Array(maxCount);
	// How loose each cell has become, 0 (sound rock) to 1 (about to let go). It
	// is the share of a cell's remaining strength that impacts have taken since
	// it last fell, so repeated hits around one spot add up.
	const damageField = new Float32Array(maxCount);
	const elements = new Float32Array(maxCount * 3);
	const minerals = new Float32Array(maxCount * mineralCount);
	const prices = new Float32Array(maxCount);
	const firstRow = new Uint8Array(columns);
	const heightmap = new Float64Array(columns + 1);
	const floorPiles = new Float64Array(columns);
	const floorHeight = new Float64Array(columns + 1);
	const floorValues = new Float64Array(columns);
	const graderBot = { active: false, returning: false, x: garageParkX, direction: -1, value: 0, cells: 0 };
	// Columns the blade has already cut in the current sweep; cleared at each
	// settlement so the next pass grades the floor again.
	const graderCutMark = new Uint8Array(columns);
	const botRadius = 0.7;
	const botHeight = 0.12;

	function hireGrader(world) {
		if (!world || graderBot.active) return false;
		if (!graderBot.returning) {
			graderBot.x = garageParkX;
			graderBot.direction = -1;
			graderBot.value = 0;
			graderBot.cells = 0;
			graderCutMark.fill(0);
		} else {
			// A call during dismissal resumes work where the bot is, rather than
			// teleporting it back to the garage or losing the load it carries.
			graderBot.direction = graderBot.x >= width ? -1 : 1;
		}
		graderBot.active = true;
		graderBot.returning = false;
		return true;
	}

	function dismissGrader(world) {
		if (!world || !graderBot.active) return false;
		graderBot.active = false;
		graderBot.returning = true;
		graderBot.direction = 1;
		return true;
	}

	function toggleGrader(world) {
		if (graderBot.active) {
			dismissGrader(world);
			return false;
		}
		return hireGrader(world);
	}

	function botSurfaceAt(x) {
		if ((!graderBot.active && !graderBot.returning) || graderBot.x > width) return 0;
		const dx = x - graderBot.x;
		if (Math.abs(dx) >= botRadius) return 0;
		const height = Math.sqrt(botRadius * botRadius - dx * dx) - (botRadius - botHeight);
		return height > 0 ? floorAt(graderBot.x) + height : 0;
	}

	function settleGrader(world) {
		const credits = price(graderBot.value * 0.5);
		funds += credits;
		ledger.push(Object.freeze({ id: ledger.length + 1, type: 'grader', time: world.time, label: 'Commercial grader', credits, cells: graderBot.cells }));
		graderBot.value = 0;
		graderBot.cells = 0;
		graderCutMark.fill(0);
	}

	function stepGraderBot(world, dt) {
		if (!graderBot.active && !graderBot.returning) return;
		const previousX = graderBot.x;
		if (graderBot.returning) {
			graderBot.x = Math.min(garageParkX, graderBot.x + graderSpeed * dt);
			if (graderBot.x < garageParkX) return;
			settleGrader(world);
			graderBot.returning = false;
			graderBot.direction = -1;
			return;
		}
		graderBot.x += graderSpeed * dt * graderBot.direction;
		if (graderBot.x <= 0) graderBot.x = 0;
		if (graderBot.direction > 0 && graderBot.x >= width) graderBot.x = width;
		// Grade each column once per sweep when the blade passes its centre.
		// The approach from and return to the outside bay do not cut the floor.
		const from = Math.max(0, Math.min(previousX, graderBot.x));
		const to = Math.min(width, Math.max(previousX, graderBot.x));
		const first = Math.max(0, Math.floor(from / cell));
		const last = Math.min(columns - 1, Math.floor(to / cell));
		let changed = false;
		if (from <= to) for (let column = first; column <= last; column++) {
			const centre = (column + 0.5) * cell;
			if (centre < from || centre > to) continue;
			if (graderCutMark[column]) continue;
			const height = floorPiles[column];
			if (height <= 0) continue;
			const cut = Math.min(height, floorCellHeightNow());
			const value = floorValues[column] * cut / height;
			floorValues[column] -= value;
			floorPiles[column] -= cut;
			graderBot.value += value;
			graderBot.cells += cut / floorCellHeightNow();
			graderCutMark[column] = 1;
			changed = true;
		}
		if (changed) updateFloor();
		if (graderBot.x > 0 && (graderBot.x < width || graderBot.direction < 0)) return;
		settleGrader(world);
		graderBot.direction *= -1;
	}

	function drawGraderBot(context) {
		// Parked, working and returning all draw this same persistent vehicle.
		const x = graderBot.x;
		const base = x > width ? 0 : floorAt(x);
		const halfAngle = Math.acos((botRadius - botHeight) / botRadius);
		context.fillStyle = '#dfac52';
		context.beginPath();
		context.arc(x, base - botRadius + botHeight, botRadius, Math.PI / 2 - halfAngle, Math.PI / 2 + halfAngle);
		context.closePath();
		context.fill();
	}
	const floorScratch = new Float64Array(columns);
	const floorValueScratch = new Float64Array(columns);
	const elementColors = new Array(maxCount);
	const mineralStyles = new Array(maxCount);
	const priceColors = new Array(maxCount);
	// Strength and price ramps are shared rules; these caches only stringify
	// them once, so the render loop allocates no colour text.
	const strengthPalette = new Array(101);
	const rgbScratch = new Float64Array(3);
	const colorScratch = [0, 0, 0];
	const strengthScratch = [0, 0, 0];
	const basePriceReport = { target: 0, mean: 0, clamped: 0 };
	const active = new Uint8Array(maxDebris);
	const debrisX = new Float64Array(maxDebris);
	const debrisY = new Float64Array(maxDebris);
	const debrisVx = new Float64Array(maxDebris);
	const debrisVy = new Float64Array(maxDebris);
	const debrisCell = new Uint16Array(maxDebris);
	const debrisCells = new Uint16Array(maxDebris);
	const debrisValue = new Float64Array(maxDebris);
	const debrisMinerals = new Float64Array(maxDebris * mineralCount);
	const debrisDamage = new Float32Array(maxDebris);
	const hit = { time: Infinity, x: 0, y: 0, nx: 0, ny: 0, index: -1 };
	// Bought energy is the only import into the closed system: 25 cr per kJ of
	// reserve, measured against a scripted shift grossing roughly 560 cr.
	const fuelPrice = 25;
	// Each setting mixes the plain loose-face clump with the connected mineral
	// flake, so the one slider spans both behaviours instead of switching at a
	// threshold. A larger group has the matching inverse release chance, so it
	// falls less often and the difference between the settings stays visible.
	const mineralClusterGrowth = new Uint16Array(mineralCount);
	for (let m = 0; m < mineralCount; m++) mineralClusterGrowth[m] = mineralTable[m].growth;
	const damagePalette = new Array(101);
	const cargoMinerals = new Float64Array(mineralCount);
	const soldMinerals = new Float64Array(mineralCount);
	const fallGroups = new Float64Array(mineralCount);
	const fallCells = new Float64Array(mineralCount);
	for (let i = 0; i <= 100; i++) {
		const remaining = i / 100;
		materials.strengthColorInto(strengthScratch, remaining);
		strengthPalette[i] = 'rgb(' + Math.round(strengthScratch[0]) + ' ' + Math.round(strengthScratch[1]) + ' ' + Math.round(strengthScratch[2]) + ')';
		damagePalette[i] = 'rgb(' + Math.round(65 + remaining * 185) + ' ' + Math.round(160 - remaining * 112) + ' ' + Math.round(190 - remaining * 152) + ')';
	}
	let seed = 1;
	let rockShape = 'smooth';
	let testRock = false;
	let extractedCells = 0;
	// Cells that let go on their own schedule instead of on the hit that
	// loosened them, and how many separate clumps that took: the chamber's own
	// record of the delayed collapse.
	let collapseCells = 0;
	let collapseBursts = 0;
	let caughtCells = 0;
	let lostCells = 0;
	let lostValue = 0;
	let cargoCells = 0;
	let cargoValue = 0;
	let soldCells = 0;
	let soldValue = 0;
	let funds = 0;
	let exportedEnergy = 0;
	let ledger = [];
	// Communism mode: the commons owns the machinery, so every price in the game
	// drops to nothing. The flag lives beside the money it rules, and it is a
	// mode rather than world state, so a new game keeps it.
	let commune = false;

	// The hash the market and the collapse rolls draw on: a value from a cell
	// coordinate and a channel, shifted by the run's seed.
	function hash(x, y, channel) {
		let value = Math.imul(x + seed * 101 + channel * 7919, 374761393) ^ Math.imul(y + 17, 668265263);
		value = Math.imul(value ^ value >>> 13, 1274126177);
		return ((value ^ value >>> 16) >>> 0) / 4294967295;
	}

	// The run's geology, captured when the run starts. The lab and the game
	// sample the same absolute cell coordinates through this field and this
	// compiled formation, so equal seed and configuration give equal rock; the
	// rendering warp and the screen never enter the sampler.
	const runGeology = geologyConfig.create(seed);
	const runField = geology.createField(runGeology);
	let formation = geology.compile(runGeology.ranges, runGeology.mode, runGeology.specificity);
	let runHostWeight = runGeology.hostWeight;

	// The field is positioned by the run, not by the picture: only these cell
	// coordinates and the captured settings reach the sampler.
	function syncField() {
		runField.seed = seed;
		runField.frequency = runGeology.frequency;
		runField.yCompression = runGeology.yCompression;
	}

	// Take the settings of a validated snapshot into the run's live configuration
	// and compile the formation once, not once per cell. This changes the rock of
	// the next run; an active run's intact cells, fragments and cargo keep their
	// strength and booked prices.
	function applyGeology(snapshot) {
		geologyConfig.settingsInto(runGeology, snapshot);
		geologyConfig.rangesInto(runGeology, snapshot.ranges);
		formation = geology.compile(runGeology.ranges, runGeology.mode, runGeology.specificity);
		runHostWeight = runGeology.hostWeight;
		syncField();
	}

	// One cell's composition and mixture from absolute geological coordinates.
	function populateCell(index, column, geologicalRow) {
		const elementOffset = index * 3;
		const mixOffset = index * mineralCount;
		geology.fillElements(runField, column, geologicalRow, elements, elementOffset);
		geology.fillMix(formation, elements, elementOffset, runHostWeight, minerals, mixOffset);
	}
	function smooth(t) { return t * t * (3 - 2 * t); }
	function noise(x, y, channel) {
		const ix = Math.floor(x);
		const iy = Math.floor(y);
		const fx = smooth(x - ix);
		const fy = smooth(y - iy);
		const a = hash(ix, iy, channel) + (hash(ix + 1, iy, channel) - hash(ix, iy, channel)) * fx;
		const b = hash(ix, iy + 1, channel) + (hash(ix + 1, iy + 1, channel) - hash(ix, iy + 1, channel)) * fx;
		return a + (b - a) * fy;
	}

	// Demand is two octaves of one-dimensional value noise in chamber time: the
	// slow wave is the mineral's own cycle, the shorter one keeps a quote from
	// sitting on a flat lattice point for a whole minute. The bias and phase come
	// from the seed, which makes a run open with its own random market.
	function demandFactorAt(m, time) {
		const period = demandPeriod[m];
		const slow = noise(time / period + demandPhase[m], m * 0.37, 31 + m) * 2 - 1;
		const quick = noise(time / (period * 0.41) + demandPhase[m] * 2.3, m * 0.61, 61 + m) * 2 - 1;
		return demandBias[m] * (1 + demandDepth[m] * (slow * 0.85 + quick * 0.35));
	}

	function quoteAt(m, time) {
		return Math.max(mineralPriceFloor, mineralBasePrices[m] * demandFactorAt(m, time));
	}

	function revalueRange(startIndex, endIndex) {
		let minPrice = Infinity;
		let maxPrice = -Infinity;
		for (let m = 0; m < mineralCount; m++) {
			if (mineralPrices[m] < minPrice) minPrice = mineralPrices[m];
			if (mineralPrices[m] > maxPrice) maxPrice = mineralPrices[m];
		}
		const span = maxPrice > minPrice ? maxPrice - minPrice : 1;
		for (let index = startIndex; index < endIndex; index++) {
			const offset = index * mineralCount;
			const value = materials.valueInto(minerals, offset, mineralPrices);
			prices[index] = value;
			materials.priceColorInto(colorScratch, (value - minPrice) / span);
			priceColors[index] = 'rgb(' + Math.round(colorScratch[0]) + ' ' + Math.round(colorScratch[1]) + ' ' + Math.round(colorScratch[2]) + ')';
		}
	}

	// Repaint what the market says each cell and each mineral is worth now. A
	// fragment books its price when it breaks; the live cells and the price view
	// follow the market so the next blow is priced at the current quote.
	function revalueCells() {
		revalueRange(0, columns * rows);
	}

	function updateMarket(force) {
		let changed = force;
		for (let m = 0; m < mineralCount; m++) {
			const next = quoteAt(m, marketClock);
			const previous = quoteAt(m, marketClock - 1);
			mineralTrends[m] = next > 0 ? (next - previous) * 60 / next : 0;
			if (Math.abs(next - mineralPrices[m]) < 1e-6) continue;
			mineralPrices[m] = next;
			changed = true;
		}
		if (changed) revalueCells();
	}

	// Base prices follow measured abundance: a mineral that takes a small share
	// of the field costs more per cell, so a pure rare cell is a jackpot and a
	// trace of it is worth about as much as any other cell. Seed-derived bias
	// and phase give each run a market of its own, common ores included.
	function initMarket() {
		// The game's base quotes use the run's measured abundance; the lab's
		// reference quotes use the default target shares. Same curve, different
		// input, and the floor/cap may move the achieved mean off the nominal
		// target - basePriceReport says by how much.
		materials.basePricesInto(mineralBasePrices, mineralAbundance, materials.economy, basePriceReport);
		for (let m = 0; m < mineralCount; m++) {
			const entry = mineralTable[m];
			demandBias[m] = 0.72 + hash(m, seed, 41) * 0.66;
			demandPhase[m] = hash(m, seed, 43) * 97;
			demandPeriod[m] = entry.demandPeriod * (0.85 + hash(m, seed, 47) * 0.3);
			demandDepth[m] = entry.demandDepth;
		}
		marketClock = 0;
		marketBudget = 0;
		updateMarket(true);
	}

	// Market time in one call: the page advances it inside the simulation loop,
	// measurements and tests can move the market without running the chamber.
	function advanceMarket(seconds) {
		marketClock += Math.max(0, seconds);
		updateMarket(false);
	}

	function updateFirstRow() {
		for (let c = 0; c < columns; c++) {
			let r = 0;
			while (r < rows && strength[r * columns + c] <= 0) r++;
			firstRow[c] = r;
		}
	}

	// The rock's free face: a column with no intact cell left has no rock at all,
	// so its surface is the roof rather than the bottom row, and the whole layer
	// cannot stay behind as solid ground after it was mined away.
	function updateHeightmap() {
		updateFirstRow();
		for (let v = 0; v <= columns; v++) {
			const c0 = Math.max(0, Math.min(columns - 1, v - 2));
			const c1 = Math.max(0, Math.min(columns - 1, v - 1));
			const c2 = Math.max(0, Math.min(columns - 1, v));
			const c3 = Math.max(0, Math.min(columns - 1, v + 1));
			const top0 = firstRow[c0] * cell, top1 = firstRow[c1] * cell, top2 = firstRow[c2] * cell, top3 = firstRow[c3] * cell;
			heightmap[v] = Math.min(top, bottom + (top0 + 3 * top1 + 3 * top2 + top3) * 0.125);
		}
	}

	// The floor surface projects the per-column pile heights through the same
	// binomial stencil as the rock, so rubble reads as the rock's mirror image.
	function updateFloor() {
		for (let v = 0; v <= columns; v++) {
			const c0 = Math.max(0, Math.min(columns - 1, v - 2));
			const c1 = Math.max(0, Math.min(columns - 1, v - 1));
			const c2 = Math.max(0, Math.min(columns - 1, v));
			const c3 = Math.max(0, Math.min(columns - 1, v + 1));
			floorHeight[v] = (floorPiles[c0] + 3 * floorPiles[c1] + 3 * floorPiles[c2] + floorPiles[c3]) * 0.125;
		}
	}

	function floorAt(x) {
		const column = Math.max(0, Math.min(columns - 1, Math.floor(x / cell)));
		const fraction = Math.max(0, Math.min(1, (x - column * cell) / cell));
		return floorHeight[column] + (floorHeight[column + 1] - floorHeight[column]) * fraction;
	}

	function setShape(mode) {
		rockShape = mode === 'square' ? 'square' : 'smooth';
		return rockShape;
	}

	// The complete formation snapshot of the current run, ready to be checked in
	// as a source-controlled configuration update.
	function exportGeology() {
		return geologyConfig.exportOf(runGeology);
	}

	// Apply a validated snapshot and start a fresh run with it. Nothing inside
	// an active run is silently regenerated or repriced: the caller asks for the
	// new geology, and reset() rebuilds the rock from scratch.
	function applyGeologyExport(snapshot) {
		const next = geologyConfig.capture(runGeology);
		geologyConfig.applyInto(next, snapshot);
		applyGeology(next);
		reset(seed);
		return true;
	}

	// The mixture and element values of one absolute geological cell: the parity
	// probe compares this against the lab at the same coordinates.
	const sampleScratch = { elements: new Float64Array(3), mix: new Float64Array(mineralCount) };
	function sampleCell(column, geologicalRow) {
		geology.fillElements(runField, column, geologicalRow, sampleScratch.elements, 0);
		geology.fillMix(formation, sampleScratch.elements, 0, runHostWeight, sampleScratch.mix, 0);
		return sampleScratch;
	}

	function setMineralClusterGrowth(mineral, percent) {
		const index = Number.isInteger(mineral) ? mineral : mineralNames.indexOf(mineral);
		if (index < 0 || index >= mineralClusterGrowth.length || !Number.isFinite(percent)) return 0;
		mineralClusterGrowth[index] = Math.max(minClusterGrowth, Math.min(maxClusterGrowth, Math.round(percent)));
		return mineralClusterGrowth[index];
	}

	function collapseChunkMaxNow() {
		let largestGrowth = 0;
		for (let m = 0; m < mineralCount; m++) if (mineralClusterGrowth[m] > largestGrowth) largestGrowth = mineralClusterGrowth[m];
		return collapseChunkMax * (1 + largestGrowth / 100);
	}

	// Build one row of rock at array slot `row` using continuous geological depth
	// `geologicalRow` so top-row replenishment extends natural veins seamlessly.
	function populateRow(row, geologicalRow, rowDamage) {
		if (testRock) {
			populateTestRow(row, rowDamage);
			return;
		}
		for (let column = 0; column < columns; column++) {
			const index = row * columns + column;
			populateCell(index, column, geologicalRow);
			paintCell(index, rowDamage);
		}
	}

	// The run's calibration population: the measured abundance of the opening bed
	// only, so the base quotes describe the geology the run starts in. Generated
	// upper rows are not folded in - a deeper column would otherwise reprice the
	// market while the player scrolls. The sample is every initial cell, seed-wide
	// and column-wide at the run's own depth.
	function measureAbundance() {
		mineralAbundance.fill(0);
		for (let row = 0; row < initialRows; row++) {
			for (let column = 0; column < columns; column++) {
				const offset = (row * columns + column) * mineralCount;
				for (let m = 0; m < mineralCount; m++) mineralAbundance[m] += minerals[offset + m];
			}
		}
		const initialCells = columns * initialRows;
		for (let m = 0; m < mineralCount; m++) mineralAbundance[m] /= initialCells;
	}

	// The controlled bed: one pure band per table entry, left to right, so every
	// mineral of the table is testable in place. The band's strength is the
	// table's own pure strength.
	function populateTestRow(row, rowDamage) {
		for (let column = 0; column < columns; column++) {
			const index = row * columns + column;
			const mineral = Math.min(mineralCount - 1, Math.floor(column * mineralCount / columns));
			const entry = mineralTable[mineral];
			const elementOffset = index * 3;
			const mineralOffset = index * mineralCount;
			for (let m = 0; m < mineralCount; m++) minerals[mineralOffset + m] = m === mineral ? 1 : 0;
			for (let channel = 0; channel < 3; channel++) {
				const range = entry[channelKeys[channel]];
				elements[elementOffset + channel] = (range[0] + range[1]) * 0.5;
			}
			prices[index] = mineralPrices[mineral];
			initialStrength[index] = entry.strength;
			strength[index] = initialStrength[index];
			damageField[index] = rowDamage;
			const color = entry.color;
			mineralStyles[index] = 'rgb(' + color[0] + ' ' + color[1] + ' ' + color[2] + ')';
			elementColors[index] = 'rgb(' + Math.round(elements[elementOffset] * 255) + ' ' + Math.round(elements[elementOffset + 1] * 255) + ' ' + Math.round(elements[elementOffset + 2] * 255) + ')';
			priceColors[index] = 'rgb(48 72 91)';
		}
	}

	// Strength, colours and quote of one sampled cell, from the shared mixture
	// rules: initial strength is the mineral-weighted resistance in J/cell with
	// no additive offset, and the cell's colour is its mineral-weighted tint.
	function paintCell(index, rowDamage) {
		const offset = index * mineralCount;
		const elementOffset = index * 3;
		initialStrength[index] = materials.strengthInto(minerals, offset);
		strength[index] = initialStrength[index];
		damageField[index] = rowDamage;
		materials.colorInto(minerals, offset, rgbScratch);
		mineralStyles[index] = 'rgb(' + Math.round(rgbScratch[0]) + ' ' + Math.round(rgbScratch[1]) + ' ' + Math.round(rgbScratch[2]) + ')';
		elementColors[index] = 'rgb(' + Math.round(elements[elementOffset] * 255) + ' ' + Math.round(elements[elementOffset + 1] * 255) + ' ' + Math.round(elements[elementOffset + 2] * 255) + ')';
	}

	function lowestIntactY() {
		updateFirstRow();
		let minRow = rows;
		for (let c = 0; c < columns; c++) if (firstRow[c] < minRow) minRow = firstRow[c];
		return minRow < rows ? bottom + minRow * cell : top;
	}

	function availableGrowthShift() {
		const heightRoom = Math.max(0, lowestIntactY() - minBottom);
		const bufferRoom = Math.max(0, (maxRows - 1) * cell - (top - bottom));
		return Math.min(heightRoom, bufferRoom);
	}

	function pruneBottomRows() {
		updateFirstRow();
		let drop = rows;
		for (let c = 0; c < columns; c++) if (firstRow[c] < drop) drop = firstRow[c];
		for (let i = 0; i < maxDebris; i++) {
			if (!active[i]) continue;
			const dRow = Math.floor(debrisCell[i] / columns);
			if (dRow < drop) drop = dRow;
		}
		if (drop <= 0) return 0;
		const remaining = rows - drop;
		const shiftCells = drop * columns;
		const remainingCells = remaining * columns;
		initialStrength.copyWithin(0, shiftCells, shiftCells + remainingCells);
		strength.copyWithin(0, shiftCells, shiftCells + remainingCells);
		damageField.copyWithin(0, shiftCells, shiftCells + remainingCells);
		prices.copyWithin(0, shiftCells, shiftCells + remainingCells);
		elements.copyWithin(0, shiftCells * 3, (shiftCells + remainingCells) * 3);
		minerals.copyWithin(0, shiftCells * mineralCount, (shiftCells + remainingCells) * mineralCount);
		for (let idx = 0; idx < remainingCells; idx++) {
			elementColors[idx] = elementColors[idx + shiftCells];
			mineralStyles[idx] = mineralStyles[idx + shiftCells];
			priceColors[idx] = priceColors[idx + shiftCells];
		}
		const oldCells = rows * columns;
		initialStrength.fill(0, remainingCells, oldCells);
		strength.fill(0, remainingCells, oldCells);
		damageField.fill(0, remainingCells, oldCells);
		prices.fill(0, remainingCells, oldCells);
		for (let c = 0; c < columns; c++) firstRow[c] -= drop;
		for (let i = 0; i < maxDebris; i++) if (active[i]) debrisCell[i] -= shiftCells;
		rows = remaining;
		baseRow += drop;
		bottom = initialBottom + baseRow * cell - totalShift;
		return drop;
	}

	function appendTopRow() {
		pruneBottomRows();
		if (rows >= maxRows) return false;
		const row = rows;
		populateRow(row, generatedRows, 0);
		rows++;
		generatedRows++;
		revalueRange(row * columns, rows * columns);
		// Incoming strata bring potential energy from above the chamber; booking
		// the import keeps the chamber's energy balance invariant.
		exportedEnergy -= columns * cellMass * gravity * (bottom + (row + 0.5) * cell);
		return true;
	}

	function upperBoundaryY() {
		updateFirstRow();
		let highest = bottom;
		for (let c = 0; c < columns; c++) {
			let r = firstRow[c];
			if (!testRock) {
				while (r < rows && strength[r * columns + c] > 0 && damageField[r * columns + c] >= collapseLooseFloor) r++;
			}
			const y = Math.min(top, bottom + r * cell);
			if (y > highest) highest = y;
		}
		return highest;
	}

	function maxActiveDamageRadius(world) {
		let maxRadius = damageRadiusNow('rig');
		const balls = world && world.balls;
		if (balls) {
			for (let i = 0; i < balls.length; i++) {
				const r = damageRadiusNow(balls[i].owner || 'rig');
				if (r > maxRadius) maxRadius = r;
			}
		}
		return maxRadius;
	}

	function queueGrowth(rowCount) {
		const added = rowCount === undefined ? 1 : rowCount;
		pruneBottomRows();
		const room = availableGrowthShift();
		if (room <= 1e-12) {
			queuedShift = 0;
			return 0;
		}
		if (!(added > 0) || !Number.isFinite(added)) {
			if (queuedShift > room) queuedShift = room;
			return queuedShift / cell;
		}
		queuedShift = Math.min(room, queuedShift + added * cell);
		return queuedShift / cell;
	}

	// Keep at least one full damage radius of rock headroom below y = 15 m by
	// topping up queuedShift only above what bounce growth already queued.
	function watchBoundary(world) {
		const maxRadiusMeters = maxActiveDamageRadius(world) * cell;
		let neededShift = upperBoundaryY() + maxRadiusMeters - top;
		const balls = world && world.balls;
		if (balls) {
			const physics = root.SteamPhysics;
			const ballRadius = physics && physics.config ? physics.config.radius : 0.18;
			const ballGravity = physics && physics.config ? physics.config.ballGravity : gravity;
			for (let i = 0; i < balls.length; i++) {
				const ball = balls[i];
				if (!ball || ball.state !== 'flying') continue;
				const radiusMeters = damageRadiusNow(ball.owner || 'rig') * cell;
				const ballTop = ball.y + ballRadius;
				if (ballTop + radiusMeters - top > neededShift) neededShift = ballTop + radiusMeters - top;
				if (!(ball.vy > 0)) continue;
				const firstCol = Math.max(0, Math.floor((ball.x - ballRadius) / cell));
				const lastCol = Math.min(columns - 1, Math.floor((ball.x + ballRadius) / cell));
				let localRoof = bottom;
				for (let c = firstCol; c <= lastCol; c++) {
					let r = firstRow[c];
					if (!testRock) {
						while (r < rows && strength[r * columns + c] > 0 && damageField[r * columns + c] >= collapseLooseFloor) r++;
					}
					const y = Math.min(top, bottom + r * cell);
					if (y > localRoof) localRoof = y;
				}
				const tLook = Math.min(boundaryLookahead, ball.vy / ballGravity);
				const projectedTop = ballTop + ball.vy * tLook - 0.5 * ballGravity * tLook * tLook;
				if (projectedTop >= localRoof) {
					const lookShift = localRoof + 1.5 * radiusMeters - top;
					if (lookShift > neededShift) neededShift = lookShift;
				}
			}
		}
		if (neededShift > queuedShift + 1e-12) queueGrowth((neededShift - queuedShift) / cell);
		else {
			pruneBottomRows();
			const room = availableGrowthShift();
			if (queuedShift > room) queuedShift = room;
		}
		return queuedShift / cell;
	}

	function stepGrowth(dt) {
		pruneBottomRows();
		if (!(queuedShift > 0) || !(dt > 0)) return false;
		const room = availableGrowthShift();
		if (room <= 1e-12) {
			queuedShift = 0;
			return false;
		}
		if (queuedShift > room) queuedShift = room;
		let remainingShift = Math.min(queuedShift, growthRate * cell * dt);
		const maxSlice = cell * 0.5;
		let moved = false;
		while (remainingShift > 1e-12) {
			pruneBottomRows();
			const stepRoom = availableGrowthShift();
			if (stepRoom <= 1e-12) {
				queuedShift = 0;
				break;
			}
			const slice = Math.min(remainingShift, maxSlice, stepRoom);
			remainingShift -= slice;
			queuedShift = Math.max(0, queuedShift - slice);
			let intact = 0;
			const activeCells = columns * rows;
			for (let index = 0; index < activeCells; index++) if (strength[index] > 0) intact++;
			exportedEnergy += intact * cellMass * gravity * slice;
			totalShift += slice;
			bottom = initialBottom + baseRow * cell - totalShift;
			while (initialBottom + generatedRows * cell - totalShift < top - 1e-12 && rows < maxRows) appendTopRow();
			moved = true;
		}
		if (!moved) return false;
		updateHeightmap();
		updatePerspective();
		scanRegions();
		return true;
	}

	function grow(seconds, world) {
		const span = seconds === undefined || seconds === null ? 1 / growthRate : seconds;
		if (!(span > 0) || !Number.isFinite(span)) return false;
		let remaining = span;
		let moved = false;
		const maxChunk = 0.05;
		while (remaining > 1e-12) {
			const dt = Math.min(remaining, maxChunk);
			remaining -= dt;
			watchBoundary(world);
			if (stepGrowth(dt)) moved = true;
		}
		return moved;
	}

	// Controlled comparison bed: one pure mineral band per table entry, with
	// looseness rising from untouched at the roof to ready-to-fall at the
	// exposed lower edge. Elements take the centre of each band, so the
	// inspector shows the signature that formed the band.
	function generateTestRock() {
		testRock = true;
		syncField();
		rows = initialRows;
		bottom = initialBottom;
		baseRow = 0;
		generatedRows = initialRows;
		totalShift = 0;
		queuedShift = 0;
		exportedEnergy = 0;
		collapseClock = 0;
		collapseRoll = 0;
		dustCursor = 0;
		dustAge.fill(dustLife);
		peeled.fill(0);
		floorPiles.fill(0);
		floorValues.fill(0);
		fallGroups.fill(0);
		fallCells.fill(0);
		initialStrength.fill(0);
		strength.fill(0);
		damageField.fill(0);
		prices.fill(0);
		for (let row = 0; row < rows; row++) populateRow(row, row, (rows - 1 - row) / (rows - 1));
		revalueCells();
		updateHeightmap();
		updatePerspective();
		scanRegions();
		return true;
	}

	// The price the player actually pays. In communism mode every price is
	// zero, whatever it was before.
	function price(cost) {
		return commune ? 0 : cost;
	}

	function setCommune(value) {
		commune = Boolean(value);
		return commune;
	}

	// Start a fresh run. The geology configuration is captured here, once, so a
	// parameter change never reprices or regenerates intact rock, fragments or
	// cargo in the middle of a run.
	function reset(newSeed) {
		seed = newSeed || 1;
		runGeology.seed = seed;
		syncField();
		testRock = false;
		rows = initialRows;
		bottom = initialBottom;
		baseRow = 0;
		generatedRows = initialRows;
		totalShift = 0;
		queuedShift = 0;
		collapseRoll = 0;
		dustCursor = 0;
		dustAge.fill(dustLife);
		extractedCells = 0;
		collapseCells = 0;
		collapseBursts = 0;
		caughtCells = 0;
		lostCells = 0;
		lostValue = 0;
		cargoCells = 0;
		cargoValue = 0;
		soldCells = 0;
		soldValue = 0;
		funds = 0;
		exportedEnergy = 0;
		ledger = [];
		cargoMinerals.fill(0);
		soldMinerals.fill(0);
		fallGroups.fill(0);
		fallCells.fill(0);
		active.fill(0);
		debrisCells.fill(0);
		debrisValue.fill(0);
		debrisMinerals.fill(0);
		debrisDamage.fill(0);
		peeled.fill(0);
		floorPiles.fill(0);
		floorValues.fill(0);
		graderBot.active = false;
		graderBot.returning = false;
		graderBot.x = garageParkX;
		graderBot.value = graderBot.cells = 0;
		graderBot.direction = -1;
		graderCutMark.fill(0);
		blade.value = 0;
		blade.idle = 0;
		initialStrength.fill(0);
		strength.fill(0);
		damageField.fill(0);
		prices.fill(0);
		regionDamage.fill(0);
		regionEligible.fill(0);
		collapseClock = 0;
		marketClock = 0;
		marketBudget = 0;
		for (let row = 0; row < rows; row++) populateRow(row, row, 0);
		measureAbundance();
		initMarket();
		updateHeightmap();
		updatePerspective();
		scanRegions();
		updateFloor();
	}

	function damageWeight(distance, owner) {
		const t = Math.max(0, 1 - distance / damageRadiusNow(owner));
		return Math.pow(t, damageFalloffPower);
	}

	// An impact weakens the rock around its contact and returns only what it
	// actually took out. Weakened cells stay standing, so the pendulum of a hit
	// is answered by intact rock; the collapse scheduler above them decides when
	// a battered region lets go.
	function damage(x, y, impactJ, owner) {
		const centerColumn = Math.max(0, Math.min(columns - 1, Math.floor(x / cell)));
		let firstIntact = 0;
		while (firstIntact < rows && strength[firstIntact * columns + centerColumn] <= 0) firstIntact++;
		const rawRow = Math.max(0, Math.min(rows - 1, Math.floor((y - bottom) / cell)));
		const centerRow = firstIntact < rows ? Math.max(firstIntact, rawRow) : rawRow;
		const mult = damageMultiplierNow(owner);
		const budget = impactJ * mult;
		const radius = damageRadiusNow(owner);
		const range = damageRangeNow(owner);
		let removed = 0;
		for (let rowOffset = -range; rowOffset <= range; rowOffset++) for (let columnOffset = -range; columnOffset <= range; columnOffset++) {
			const row = centerRow + rowOffset;
			const column = centerColumn + columnOffset;
			const distance = Math.sqrt(columnOffset * columnOffset + rowOffset * rowOffset);
			if (row < 0 || row >= rows || column < 0 || column >= columns || distance > radius) continue;
			const index = row * columns + column;
			if (strength[index] <= 0) continue;
			const before = strength[index];
			// A blow spends at most half of a cell's remaining strength: the contact
			// cells stay standing and the ring around them is left loose, to fall
			// later in a collapse burst. The rest of the impact energy is absorbed.
			const amount = Math.min(before, budget * damageWeight(distance, owner), before * hitLooseCap);
			strength[index] = before - amount;
			damageField[index] = Math.min(1, damageField[index] + amount / before * loosedPerWeakened);
			removed += amount / mult;
			if (strength[index] > 0.0001) continue;
			// Only the free face lets go. A cell with rock still under it has
			// nothing to fall into, so the blow leaves it standing shattered at a
			// held share of its strength until the face above it is worked away;
			// the collapse scheduler then releases it from the surface.
			if (row > 0 && strength[index - columns] > 0) {
				strength[index] = initialStrength[index] * heldCellShare;
				continue;
			}
			removed += strength[index] / mult;
			strength[index] = 0;
			damageField[index] = 0;
			spawn(index);
		}
		updateHeightmap();
		scanRegions();
		return Math.min(impactJ, removed);
	}

	// Only the rock's free bottom face may let go, and across a uniformly loose
	// span no column runs far ahead of equally loose neighbours — keeping broad
	// falls cohesive without letting an unworked wall freeze a vertical shaft.
	function canStepSurface(column, row) {
		if (row >= rows) return false;
		const floor = Math.max(collapseLooseFloor, damageField[row * columns + column] * 0.5);
		if (column > 0) {
			const left = firstRow[column - 1] + peeled[column - 1];
			if (left < rows && damageField[left * columns + column - 1] >= floor && row > left + maxSurfaceStep) return false;
		}
		if (column < columns - 1) {
			const right = firstRow[column + 1] + peeled[column + 1];
			if (right < rows && damageField[right * columns + column + 1] >= floor && row > right + maxSurfaceStep) return false;
		}
		return true;
	}

	// Advance the collapse scheduler by a span of chamber time. The chamber
	// calls it from step(); exposing it lets a measurement or a test turn
	// loosened rock into falling rock without running the whole simulation.
	function collapse(seconds) {
		const span = (seconds === undefined || seconds === null) ? collapseChanceSeconds : seconds;
		const steps = Math.max(1, Math.round(span / collapseChanceSeconds));
		for (let i = 0; i < steps; i++) collapseTick(collapseChanceSeconds);
	}

	function cellWeakness(index) {
		const initial = initialStrength[index];
		const lost = initial > 0 ? 1 - strength[index] / initial : 0;
		return damageField[index] + lost * 2;
	}

	function compatibleMineral(index, seedIndex, mineral) {
		if (dominantMineral(index) === mineral) return true;
		const a = index * mineralCount;
		const b = seedIndex * mineralCount;
		let diff = 0;
		for (let m = 0; m < mineralCount; m++) diff += Math.abs(minerals[a + m] - minerals[b + m]);
		return diff < 0.22;
	}

	// Each horizontal surface band rolls at most once per tick over its live
	// free-surface front, so crossing a vertical row multiple never accelerates
	// a recessed column into an interior shaft.
	function collapseTick(dt) {
		collapseClock += dt;
		if (collapseClock < collapseChanceSeconds) return;
		collapseClock = 0;
		let rolled = 0;
		for (let band = 0; band < collapseRegionsX; band++) {
			const looseness = scanSurfaceBand(band);
			if (looseness < collapseLooseFloor || !bandLooseCount) continue;
			const excess = Math.min(1, (looseness - collapseLooseFloor) / (collapseChanceSaturation - collapseLooseFloor));
			const seedColumn = pickBandSeed(band);
			const seed = firstRow[seedColumn] * columns + seedColumn;
			const mineral = dominantMineral(seed);
			const growth = mineralClusterGrowth[mineral];
			const releaseFactor = 100 / (100 + growth);
			if (hash(band, collapseRoll + band, 5) >= collapseChanceMax * excess * releaseFactor) continue;
			const baseChunk = collapseChunkMin + excess * (collapseChunkMax - collapseChunkMin);
			const target = Math.max(1, Math.min(collapseClumpLimit, Math.round(baseChunk * (1 + growth / 100))));
			if (!peelSurfaceCluster(seedColumn, mineral, target, clusterShare(growth))) continue;
			rolled++;
			collapseBursts++;
		}
		collapseRoll++;
		if (rolled) updateHeightmap();
		scanRegions();
	}

	let bandLooseCount = 0;
	let bandWeightTotal = 0;
	function scanSurfaceBand(band) {
		const columnStart = band * bandColumns;
		const columnEnd = Math.min(columns, columnStart + bandColumns);
		let total = 0;
		let touched = 0;
		bandLooseCount = 0;
		bandWeightTotal = 0;
		for (let column = columnStart; column < columnEnd; column++) {
			const face = firstRow[column];
			if (face >= rows) continue;
			const rowEnd = Math.min(rows, face + bandRows);
			for (let row = face; row < rowEnd; row++) {
				const index = row * columns + column;
				if (strength[index] <= 0 || damageField[index] <= 0) continue;
				total += damageField[index];
				touched++;
			}
			const faceIndex = face * columns + column;
			if (damageField[faceIndex] >= collapseLooseFloor && canStepSurface(column, face)) {
				const w = cellWeakness(faceIndex);
				bandLoose[bandLooseCount++] = column;
				bandWeightTotal += w * w;
			}
		}
		return touched ? total / touched : 0;
	}

	function pickBandSeed(band) {
		let draw = hash(band, collapseRoll + band, 7) * bandWeightTotal;
		for (let i = 0; i < bandLooseCount - 1; i++) {
			const col = bandLoose[i];
			const w = cellWeakness(firstRow[col] * columns + col);
			draw -= w * w;
			if (draw <= 0) return col;
		}
		return bandLoose[bandLooseCount - 1];
	}

	// Keep the 12x6 region diagnostics synchronized with the live free surface.
	function scanRegions() {
		const regionRows = Math.max(1, Math.ceil(rows / collapseRegionsY));
		for (let region = 0; region < regionCount; region++) {
			const rowStart = Math.floor(region / collapseRegionsX) * regionRows;
			const columnStart = (region % collapseRegionsX) * bandColumns;
			const rowEnd = Math.min(rows, rowStart + regionRows);
			const columnEnd = Math.min(columns, columnStart + bandColumns);
			let total = 0;
			let touched = 0;
			let loose = 0;
			for (let row = rowStart; row < rowEnd; row++) for (let column = columnStart; column < columnEnd; column++) {
				const index = row * columns + column;
				if (strength[index] <= 0) continue;
				const damage = damageField[index];
				if (damage <= 0) continue;
				total += damage;
				touched++;
				if (row === firstRow[column] && damage >= collapseLooseFloor && canStepSurface(column, row)) loose++;
			}
			regionDamage[region] = touched ? total / touched : 0;
			regionEligible[region] = loose;
		}
	}

	// The dominant mineral sets both the cluster growth and how often its region
	// releases. Growth scales the damage-sized clump; its inverse scales the
	// roll chance, trading frequent grains for rarer, heavier falls.
	function dominantMineral(index) {
		const offset = index * mineralCount;
		let mineral = 0;
		for (let m = 1; m < mineralCount; m++) if (minerals[offset + m] > minerals[offset + mineral]) mineral = m;
		return mineral;
	}

	// Whether a column of the lump being peeled already holds this cell: a
	// column is always taken from its own face inward, so its lump cells are the
	// run of rows starting at firstRow.
	function lumpHolds(row, column) {
		if (row < 0 || row >= rows || column < 0 || column >= columns || !peeled[column]) return false;
		return row >= firstRow[column] && row < firstRow[column] + peeled[column];
	}

	// A candidate cell may join only while it touches rock the lump already
	// holds: the next cell of a column it took, or a cell beside one it holds
	// (faces may differ by a row, so a step counts as touching). The lump is then
	// one connected flake off the face, so its centre of mass lies in the notch
	// it opens and never in the rock around it.
	function touchesLump(row, column) {
		if (peeled[column]) return true;
		for (let side = -1; side <= 1; side += 2) {
			const beside = column + side;
			for (let offset = -1; offset <= 1; offset++) if (lumpHolds(row + offset, beside)) return true;
		}
		return false;
	}

	// How much of a release follows the group rule: 0 at the slider floor (the
	// plain loose-face clump the rock always let go) rising to 1 where every
	// cell of the piece is a connected, mineral-matched flake.
	function clusterShare(growth) {
		return Math.max(0, Math.min(1, (growth - minClusterGrowth) / (clusterGrowthFull - minClusterGrowth)));
	}

	// Grow a clump strictly from firstRow[column] inward, so no fall ever
	// hollows rock behind an intact face. Each cell is picked one of two ways,
	// mixed by the mineral's growth: either the original rule, a loose free face
	// of the band taken as it comes (mineral-blind, not necessarily touching),
	// or the group rule, the cheapest connected, mineral-matched cell that
	// widens the flake before it deepens. The rock's elements are smooth, so the
	// mix is what makes the slider a gradient instead of a threshold.
	function peelSurfaceCluster(seedColumn, mineral, target, share) {
		const seedRow = firstRow[seedColumn];
		if (seedRow >= rows) return 0;
		const seedIndex = seedRow * columns + seedColumn;
		const lean = hash(seedColumn, collapseRoll, 9) < 0.5 ? -1 : 1;
		clusterCells[0] = seedIndex;
		peeled[seedColumn] = 1;
		let minCol = seedColumn;
		let maxCol = seedColumn;
		let size = 1;
		while (size < target) {
			let bestCol = -1;
			let bestCost = Infinity;
			if (share > 0 && hash(seedColumn * 31 + size, collapseRoll, 11) < share) {
				const from = Math.max(0, minCol - 1);
				const to = Math.min(columns - 1, maxCol + 1);
				for (let col = from; col <= to; col++) {
					const row = firstRow[col] + peeled[col];
					if (row >= rows || !touchesLump(row, col)) continue;
					const index = row * columns + col;
					if (strength[index] <= 0 || damageField[index] < collapseLooseFloor) continue;
					if (!compatibleMineral(index, seedIndex, mineral) || !canStepSurface(col, row)) continue;
					const across = Math.abs(col - seedColumn);
					const tie = (col - seedColumn) * lean > 0 ? -0.05 : 0.05;
					const cost = across + peeled[col] * clumpDepthCost + (row - seedRow) * 1.25 - cellWeakness(index) * 0.6 + tie;
					if (cost >= bestCost) continue;
					bestCost = cost;
					bestCol = col;
				}
			} else {
				// The original clump rule: draw a loose free face of the band at
				// random and take its next cell. No mineral match, no adjacency,
				// nothing that would make a small setting read as a group.
				for (let attempt = 0; attempt < bandLooseCount; attempt++) {
					const col = bandLoose[Math.floor(hash(seedColumn + attempt * 977, collapseRoll + size, 13) * bandLooseCount) % bandLooseCount];
					const row = firstRow[col] + peeled[col];
					if (row >= rows) continue;
					const index = row * columns + col;
					if (strength[index] <= 0 || damageField[index] < collapseLooseFloor) continue;
					bestCol = col;
					break;
				}
			}
			if (bestCol < 0) break;
			const pickedRow = firstRow[bestCol] + peeled[bestCol];
			clusterCells[size++] = pickedRow * columns + bestCol;
			peeled[bestCol]++;
			if (bestCol < minCol) minCol = bestCol;
			if (bestCol > maxCol) maxCol = bestCol;
		}
		const representative = clusterCells[0];
		// Every cell of the flake keeps its own mass, value and mineral and falls
		// as its own grain, so the piece reaches the floor in the shape it left
		// the face in and spreads its pile over the columns it spans.
		for (let i = 0; i < size; i++) {
			const index = clusterCells[i];
			spawnFragment(index);
			strength[index] = 0;
			damageField[index] = 0;
			puff(index);
			collapseCells++;
		}
		recordFall(size, representative);
		for (let col = minCol; col <= maxCol; col++) {
			if (!peeled[col]) continue;
			const nextRow = firstRow[col] + peeled[col];
			firstRow[col] = nextRow;
			if (!testRock && nextRow < rows) damageField[nextRow * columns + col] *= 0.7;
			peeled[col] = 0;
		}
		return size;
	}

	// The clump's dust: a short-lived ring where the rock let go, drawn from a
	// fixed pool so a collapse never allocates and never leaves anything behind
	// but its own fall.
	function puff(index) {
		const row = Math.floor(index / columns);
		const slot = dustCursor;
		dustCursor = (dustCursor + 1) % dustCount;
		dustX[slot] = (index % columns + 0.5) * cell;
		dustY[slot] = drawnRowY[row];
		dustAge[slot] = 0;
	}
	function ageDust(dt) {
		for (let i = 0; i < dustCount; i++) if (dustAge[i] < dustLife) dustAge[i] += dt;
	}

	// Loose rock is drawn as a hairline of falling grit on the exposed free
	// surface: the sign that this part of the ceiling is about to go.
	function drawCollapse(context) {
		context.fillStyle = 'rgba(226, 196, 138, 0.5)';
		for (let column = 0; column < columns; column++) {
			const row = firstRow[column];
			if (row >= rows || damageField[row * columns + column] < collapseLooseFloor) continue;
			if (!canStepSurface(column, row)) continue;
			const faceY = rockShape === 'square'
				? drawnRowY[row]
				: rockDrawnY((heightmap[column] + heightmap[column + 1]) * 0.5);
			context.fillRect(column * cell, faceY - cell * 0.18, cell, cell * 0.12);
		}
		for (let i = 0; i < dustCount; i++) {
			if (dustAge[i] >= dustLife) continue;
			const fade = 1 - dustAge[i] / dustLife;
			context.fillStyle = 'rgba(214, 189, 148, ' + (fade * 0.55).toFixed(3) + ')';
			context.fillRect(dustX[i] - cell * 0.45, dustY[i] - dustAge[i] * 1.4 - cell * 0.45, cell * 0.9, cell * 0.9);
		}
	}

	function looseCells() {
		let total = 0;
		for (let column = 0; column < columns; column++) {
			const row = firstRow[column];
			if (row < rows && damageField[row * columns + column] >= collapseLooseFloor && canStepSurface(column, row)) total++;
		}
		return total;
	}

	function fragmentCells(i) {
		return debrisCells[i] || 1;
	}

	function fragmentValue(i) {
		return debrisCells[i] ? debrisValue[i] : prices[debrisCell[i]];
	}

	function fragmentMechanical(i) {
		const mass = fragmentCells(i) * cellMass;
		return mass * (0.5 * (debrisVx[i] * debrisVx[i] + debrisVy[i] * debrisVy[i]) + gravity * Math.max(0, debrisY[i]));
	}

	// A fall is counted as one let-go event with the cells it took, whichever
	// mix of the two release rules produced it, so the readout compares the
	// settings on the same terms.
	function recordFall(size, representative) {
		const mineral = dominantMineral(representative);
		fallGroups[mineral]++;
		fallCells[mineral] += size;
	}

	// One grain of falling rock: a single cell, drawn at its own cell size and
	// position, so a group of cells that let go together keeps the shape it had
	// in the rock instead of being redrawn as one block.
	function spawnFragment(index) {
		const offset = index * mineralCount;
		const x = (index % columns + 0.5) * cell;
		const y = bottom + (Math.floor(index / columns) + 0.5) * cell;
		for (let i = 0; i < maxDebris; i++) {
			if (active[i]) continue;
			active[i] = 1;
			debrisCell[i] = index;
			debrisCells[i] = 1;
			debrisValue[i] = prices[index];
			const mOffset = i * mineralCount;
			for (let m = 0; m < mineralCount; m++) debrisMinerals[mOffset + m] = cellMass * minerals[offset + m];
			debrisX[i] = x;
			debrisY[i] = y;
			debrisVx[i] = 0;
			debrisVy[i] = 0;
			debrisDamage[i] = damageField[index];
			extractedCells++;
			return;
		}
		// If every slot was externally marked active, aggregate into the closest
		// active fragment so broken cells are never lost and all broken mass falls.
		let target = 0;
		let bestDist = Infinity;
		for (let i = 0; i < maxDebris; i++) {
			const dx = debrisX[i] - x;
			const dy = debrisY[i] - y;
			const d = dx * dx + dy * dy;
			if (d < bestDist) { bestDist = d; target = i; }
		}
		const prevCells = fragmentCells(target);
		const previousDamage = debrisDamage[target];
		if (!debrisCells[target]) {
			const baseOffset = debrisCell[target] * mineralCount;
			const mOffset = target * mineralCount;
			debrisCells[target] = 1;
			debrisValue[target] = prices[debrisCell[target]];
			for (let m = 0; m < mineralCount; m++) debrisMinerals[mOffset + m] = cellMass * minerals[baseOffset + m];
		}
		const beforeE = fragmentMechanical(target) + cellMass * gravity * y;
		const nextCells = prevCells + 1;
		debrisVx[target] = debrisVx[target] * (prevCells / nextCells);
		debrisVy[target] = debrisVy[target] * (prevCells / nextCells);
		debrisX[target] = (debrisX[target] * prevCells + x) / nextCells;
		debrisY[target] = (debrisY[target] * prevCells + y) / nextCells;
		debrisCells[target] = nextCells;
		debrisValue[target] += prices[index];
		debrisDamage[target] = (previousDamage * prevCells + damageField[index]) / nextCells;
		const mOffset = target * mineralCount;
		for (let m = 0; m < mineralCount; m++) debrisMinerals[mOffset + m] += cellMass * minerals[offset + m];
		exportedEnergy += beforeE - fragmentMechanical(target);
		extractedCells++;
	}

	// A single cell let go on its own (a hit that finishes a free-face cell).
	function spawn(index) {
		spawnFragment(index);
		recordFall(1, index);
	}

	function traceSmooth(x, y, vx, vy, duration, radius, traceGravity) {
		updateHeightmap();
		// A centre above the heightmap is inside the solid (reachable on shape
		// switches). Resolve at once: drop it onto the surface so the contact
		// impulse applies instead of the ball flying through at full speed.
		const vf = Math.max(0, Math.min(columns - 1, Math.floor(x / cell)));
		const vt = Math.max(0, Math.min(1, (x - vf * cell) / cell));
		const surfaceY = heightmap[vf] + (heightmap[vf + 1] - heightmap[vf]) * vt;
		if (y > surfaceY) {
			hit.time = 0;
			hit.x = x;
			hit.y = surfaceY - radius;
			hit.nx = 0;
			hit.ny = -1;
			hit.index = Math.min(rows - 1, firstRow[vf]) * columns + vf;
			return hit;
		}
		const dx = vx * duration;
		const dy = vy * duration - 0.5 * traceGravity * duration * duration;
		const minColumn = Math.max(0, Math.floor((Math.min(x, x + dx) - radius) / cell));
		const maxColumn = Math.min(columns - 1, Math.floor((Math.max(x, x + dx) + radius) / cell));
		if (minColumn > maxColumn) return hit;
		let minH = top + 1;
		for (let c = minColumn; c <= maxColumn; c++) {
			const h = Math.min(heightmap[c], heightmap[c + 1]);
			if (h < minH) minH = h;
		}
		if (Math.max(y, y + dy) + radius < minH - 1e-4) return hit;
		let best = 2;
		for (let c = minColumn; c <= maxColumn; c++) {
			if (heightmap[c] >= top - 1e-9 && heightmap[c + 1] >= top - 1e-9) continue;
			const x0 = c * cell;
			const y0 = heightmap[c];
			const y1 = heightmap[c + 1];
			const sx = cell;
			const sy = y1 - y0;
			const len = Math.hypot(sx, sy);
			const nx = sy / len;
			const ny = -sx / len;
			const vn = dx * nx + dy * ny;
			if (vn >= -1e-12) continue;
			const dist0 = (x - x0) * nx + (y - y0) * ny;
			let s = -1;
			let push = 0;
			if (dist0 >= radius) {
				s = (radius - dist0) / vn;
			} else {
				// Touching or overlapping: resolve immediately when the contact
				// foot lies on the segment, separating out to exactly radius.
				const cx0 = x - nx * dist0;
				const cy0 = y - ny * dist0;
				const proj0 = ((cx0 - x0) * sx + (cy0 - y0) * sy) / (len * len);
				if (proj0 < -1e-6 || proj0 > 1 + 1e-6) continue;
				s = 0;
				push = radius - dist0;
			}
			if (s < 0 || s > 1 || s >= best) continue;
			const hx = x + dx * s + nx * push;
			const hy = y + dy * s + ny * push;
			const cx = hx - nx * radius;
			const cy = hy - ny * radius;
			const proj = ((cx - x0) * sx + (cy - y0) * sy) / (len * len);
			if (proj < -1e-6 || proj > 1 + 1e-6) continue;
			best = s;
			hit.time = duration * s;
			hit.x = hx;
			hit.y = hy;
			hit.nx = nx;
			hit.ny = ny;
			const row = Math.min(rows - 1, firstRow[c]);
			hit.index = row * columns + c;
		}
		const a = dx * dx + dy * dy;
		if (a <= 1e-18) return hit;
		for (let v = minColumn; v <= maxColumn + 1; v++) {
			const leftCol = Math.max(0, v - 1);
			const rightCol = Math.min(columns - 1, v);
			if (firstRow[leftCol] >= rows && firstRow[rightCol] >= rows) continue;
			const vx0 = v * cell;
			const vy0 = heightmap[v];
			const ox = x - vx0;
			const oy = y - vy0;
			const cdist = Math.hypot(ox, oy);
			if (cdist <= 1e-9) continue;
			const b = 2 * (ox * dx + oy * dy);
			if (b >= -1e-12) continue;
			const cQuad = cdist * cdist - radius * radius;
			let s = -1;
			let push = 0;
			if (cQuad >= 0) {
				const disc = b * b - 4 * a * cQuad;
				if (disc < 0) continue;
				s = (-b - Math.sqrt(disc)) / (2 * a);
			} else {
				// Overlapping the corner disc: resolve at once, separate to radius.
				s = 0;
				push = radius - cdist;
			}
			if (s < 0 || s > 1 || s >= best) continue;
			const hx = x + dx * s + (ox / cdist) * push;
			const hy = y + dy * s + (oy / cdist) * push;
			const rx = hx - vx0;
			const ry = hy - vy0;
			const rlen = Math.hypot(rx, ry);
			if (rlen <= 1e-9 || ry > 1e-6) continue;
			best = s;
			hit.time = duration * s;
			hit.x = hx;
			hit.y = hy;
			hit.nx = rx / rlen;
			hit.ny = Math.min(0, ry / rlen);
			const nlen = Math.hypot(hit.nx, hit.ny);
			hit.nx /= nlen;
			hit.ny /= nlen;
			const col = firstRow[rightCol] < rows ? rightCol : leftCol;
			hit.index = Math.min(rows - 1, firstRow[col]) * columns + col;
		}
		return hit;
	}

	function testCorner(x, y, dx, dy, a, cx0, cy0, radius, index, best) {
		const ox = x - cx0;
		const oy = y - cy0;
		const cdist = Math.hypot(ox, oy);
		if (cdist <= 1e-9) return best;
		const b = 2 * (ox * dx + oy * dy);
		if (b >= -1e-12) return best;
		const cQuad = cdist * cdist - radius * radius;
		let s = -1;
		let push = 0;
		if (cQuad >= 0) {
			const disc = b * b - 4 * a * cQuad;
			if (disc < 0) return best;
			s = (-b - Math.sqrt(disc)) / (2 * a);
		} else {
			// Overlapping the corner disc: resolve at once, separate to radius.
			s = 0;
			push = radius - cdist;
		}
		if (s < 0 || s > 1 || s >= best) return best;
		const hx = x + dx * s + (ox / cdist) * push;
		const hy = y + dy * s + (oy / cdist) * push;
		hit.time = s;
		hit.x = hx;
		hit.y = hy;
		hit.nx = (hx - cx0) / radius;
		hit.ny = (hy - cy0) / radius;
		hit.index = index;
		return s;
	}

	function traceSquare(x, y, vx, vy, duration, radius, traceGravity) {
		updateHeightmap();
		// A centre inside an intact cell is inside the solid (reachable on shape
		// switches). Resolve at once: drop it below the column surface so the
		// contact impulse applies instead of the ball flying through at full speed.
		const insideColumn = Math.max(0, Math.min(columns - 1, Math.floor(x / cell)));
		const insideRow = Math.max(0, Math.min(rows - 1, Math.floor((y - bottom) / cell)));
		if (y >= bottom && strength[insideRow * columns + insideColumn] > 0) {
			const surfaceY = bottom + firstRow[insideColumn] * cell;
			hit.time = 0;
			hit.x = x;
			hit.y = surfaceY - radius;
			hit.nx = 0;
			hit.ny = -1;
			hit.index = insideRow * columns + insideColumn;
			return hit;
		}
		const dx = vx * duration;
		const dy = vy * duration - 0.5 * traceGravity * duration * duration;
		const minColumn = Math.max(0, Math.floor((Math.min(x, x + dx) - radius) / cell));
		const maxColumn = Math.min(columns - 1, Math.floor((Math.max(x, x + dx) + radius) / cell));
		const minRow = Math.max(0, Math.floor((Math.min(y, y + dy) - radius - bottom) / cell));
		const maxRow = Math.min(rows - 1, Math.floor((Math.max(y, y + dy) + radius - bottom) / cell));
		if (minColumn > maxColumn || minRow > maxRow) return hit;
		let best = 2;
		const a = dx * dx + dy * dy;
		for (let row = minRow; row <= maxRow; row++) for (let column = minColumn; column <= maxColumn; column++) {
			const index = row * columns + column;
			if (strength[index] <= 0) continue;
			const x0 = column * cell;
			const x1 = x0 + cell;
			const y0 = bottom + row * cell;
			const y1 = y0 + cell;
			const expBottom = row === 0 || strength[index - columns] <= 0;
			const expTop = row < rows - 1 && strength[index + columns] <= 0;
			const expLeft = column > 0 && strength[index - 1] <= 0;
			const expRight = column < columns - 1 && strength[index + 1] <= 0;
			if (expBottom && dy > 1e-12) {
				const dist0 = y0 - y;
				const push = dist0 >= radius ? 0 : radius - dist0;
				const s = dist0 >= radius ? (dist0 - radius) / dy : (x >= x0 && x <= x1 ? 0 : -1);
				const hx = x + dx * s;
				if (s >= 0 && s <= 1 && s < best && hx >= x0 - 1e-7 && hx <= x1 + 1e-7) {
					best = s; hit.time = s; hit.x = hx; hit.y = y + dy * s - push; hit.nx = 0; hit.ny = -1; hit.index = index;
				}
			}
			if (expTop && dy < -1e-12) {
				const dist0 = y - y1;
				const push = dist0 >= radius ? 0 : radius - dist0;
				const s = dist0 >= radius ? (dist0 - radius) / -dy : (x >= x0 && x <= x1 ? 0 : -1);
				const hx = x + dx * s;
				if (s >= 0 && s <= 1 && s < best && hx >= x0 - 1e-7 && hx <= x1 + 1e-7) {
					best = s; hit.time = s; hit.x = hx; hit.y = y + dy * s + push; hit.nx = 0; hit.ny = 1; hit.index = index;
				}
			}
			if (expLeft && dx > 1e-12) {
				const dist0 = x0 - x;
				const push = dist0 >= radius ? 0 : radius - dist0;
				const s = dist0 >= radius ? (dist0 - radius) / dx : (y >= y0 && y <= y1 ? 0 : -1);
				const hy = y + dy * s;
				if (s >= 0 && s <= 1 && s < best && hy >= y0 - 1e-7 && hy <= y1 + 1e-7) {
					best = s; hit.time = s; hit.x = x + dx * s - push; hit.y = hy; hit.nx = -1; hit.ny = 0; hit.index = index;
				}
			}
			if (expRight && dx < -1e-12) {
				const dist0 = x - x1;
				const push = dist0 >= radius ? 0 : radius - dist0;
				const s = dist0 >= radius ? (dist0 - radius) / -dx : (y >= y0 && y <= y1 ? 0 : -1);
				const hy = y + dy * s;
				if (s >= 0 && s <= 1 && s < best && hy >= y0 - 1e-7 && hy <= y1 + 1e-7) {
					best = s; hit.time = s; hit.x = x + dx * s + push; hit.y = hy; hit.nx = 1; hit.ny = 0; hit.index = index;
				}
			}
			if (a <= 1e-18) continue;
			if (expBottom || expLeft) best = testCorner(x, y, dx, dy, a, x0, y0, radius, index, best);
			if (expBottom || expRight) best = testCorner(x, y, dx, dy, a, x1, y0, radius, index, best);
			if (expTop || expLeft) best = testCorner(x, y, dx, dy, a, x0, y1, radius, index, best);
			if (expTop || expRight) best = testCorner(x, y, dx, dy, a, x1, y1, radius, index, best);
		}
		if (best <= 1) hit.time = duration * best;
		return hit;
	}

	function trace(x, y, vx, vy, duration, radius, traceGravity) {
		if (!Number.isFinite(traceGravity)) traceGravity = gravity;
		hit.time = Infinity;
		hit.x = x;
		hit.y = y;
		hit.nx = 0;
		hit.ny = 0;
		hit.index = -1;
		return rockShape === 'square'
			? traceSquare(x, y, vx, vy, duration, radius, traceGravity)
			: traceSmooth(x, y, vx, vy, duration, radius, traceGravity);
	}

	function catchFragment(world, i, carriedMass) {
		if (cargoCells >= storageLimit) return false;
		const totalCells = fragmentCells(i);
		const take = Math.min(totalCells, storageLimit - cargoCells);
		const ratio = take / totalCells;
		const caughtMass = take * cellMass;
		const before = 0.5 * carriedMass * world.platform.vx * world.platform.vx + 0.5 * caughtMass * (debrisVx[i] * debrisVx[i] + debrisVy[i] * debrisVy[i]);
		world.platform.vx = (carriedMass * world.platform.vx + caughtMass * debrisVx[i]) / (carriedMass + caughtMass);
		const after = 0.5 * (carriedMass + caughtMass) * world.platform.vx * world.platform.vx;
		world.heat += Math.max(0, before - after);
		const index = debrisCell[i];
		const offset = index * mineralCount;
		const mOffset = i * mineralCount;
		cargoCells += take;
		caughtCells += take;
		const val = fragmentValue(i) * ratio;
		cargoValue += val;
		for (let m = 0; m < mineralCount; m++) {
			const minMass = (debrisCells[i] ? debrisMinerals[mOffset + m] : cellMass * minerals[offset + m]) * ratio;
			cargoMinerals[m] += minMass;
			if (debrisCells[i]) debrisMinerals[mOffset + m] -= minMass;
		}
		if (take < totalCells) {
			debrisCells[i] = totalCells - take;
			debrisValue[i] -= val;
			return false;
		}
		active[i] = 0;
		debrisCells[i] = 0;
		debrisValue[i] = 0;
		return true;
	}

	function fallTime(y, vy, height) {
		const discriminant = vy * vy + 2 * gravity * (y - height);
		if (discriminant < 0) return Infinity;
		const time = (vy + Math.sqrt(discriminant)) / gravity;
		return time >= 0 ? time : Infinity;
	}

	// A landed fragment adds a thin soil layer under its landing point. The floor
	// height quantum is one quarter of a rock cell, giving a 4:1 ground tile.
	// The pile is capped below the deck line; excess rubble is still counted lost.
	function deposit(i, x) {
		const column = Math.max(0, Math.min(columns - 1, Math.floor(x / cell)));
		const tile = floorCellHeightNow();
		const added = Math.min(pileLimit - floorPiles[column], fragmentCells(i) * tile);
		floorValues[column] += fragmentValue(i) * added / (fragmentCells(i) * tile);
		floorPiles[column] += added;
		updateFloor();
	}

	// The blade works a centred swath under the platform while it moves,
	// not ahead of it. Neighbouring columns flow toward one another while
	// the blade shaves the top; clamping at zero protects the original floor
	// from becoming a pit. Shaved material is not lost: the blade keeps the
	// value of the height it removed (the thickness it cut, not the
	// redistribution it caused) and settles it when the platform comes to rest,
	// like the garage grader's own share. A column keeps its value density, so
	// the floor and the purse can never disagree.
	function grade(world, dt) {
		// A stint ends when the blade stops finding rubble for this long, whatever
		// the platform is commanded to do: one settlement per working pause.
		if (blade.value > 0) {
			blade.idle += dt;
			if (blade.idle >= bladeSettleDelay) settleBlade(world);
		}
		const platform = world.platform;
		// Only while the platform is actually translating under the blade: a
		// platform parked on its mark must not keep grinding a fixed swath, which
		// would both eat the pile under it and never end a stint.
		const moving = Math.abs(platform.vx) > 0.02 || world.direction !== 0;
		if (!moving) return;
		const half = graderSwath * 0.5;
		const left = platform.x - half;
		const right = platform.x + half;
		const first = Math.max(1, Math.floor(Math.min(left, right) / cell));
		const last = Math.min(columns - 2, Math.floor(Math.max(left, right) / cell));
		if (first > last) return;
		floorScratch.set(floorPiles);
		floorValueScratch.set(floorValues);
		const ease = Math.min(1, graderSmooth * dt);
		// Smoothing is transport, not creation: move each edge's share of height
		// and its value together. Include the two boundary edges whose neighbours
		// feed the working swath, so the whole floor conserves both quantities.
		for (let column = first; column <= last + 1; column++) {
			const left = column - 1;
			const difference = floorPiles[left] - floorPiles[column];
			if (!difference) continue;
			const source = difference > 0 ? left : column;
			const destination = difference > 0 ? column : left;
			const amount = Math.abs(difference) * ease * 0.5;
			const value = amount * floorValues[source] / floorPiles[source];
			floorScratch[source] -= amount;
			floorScratch[destination] += amount;
			floorValueScratch[source] -= value;
			floorValueScratch[destination] += value;
		}
		const cut = graderCut * dt;
		for (let column = first; column <= last; column++) {
			const height = floorScratch[column];
			if (height <= 0) continue;
			const amount = Math.min(height, cut);
			const shaved = amount * floorValueScratch[column] / height;
			floorScratch[column] = height - amount;
			floorValueScratch[column] = Math.max(0, floorValueScratch[column] - shaved);
			blade.value += shaved;
			blade.idle = 0;
		}
		floorPiles.set(floorScratch);
		floorValues.set(floorValueScratch);
		updateFloor();
	}

	// One settled stint per working pause: the blade's share of the shaved
	// material enters the owner's purse as a single frozen entry, exactly like a
	// garage-grader settlement. Under Communism the material is free, so the
	// credit is zero and nothing is booked.
	function settleBlade(world) {
		if (blade.value <= 0) {
			blade.idle = 0;
			return;
		}
		const credits = price(blade.value * graderShare);
		blade.value = 0;
		blade.idle = 0;
		if (credits <= 0) return;
		funds += credits;
		ledger.push(Object.freeze({ id: ledger.length + 1, type: 'blade', time: world.time, label: 'Road grader blade', credits }));
	}

	// A competitor blade shaves a thin layer from the rubble under its body and
	// takes the value with it. The pile it removes is priced at the pile's own
	// value density, so the floor and the purse can never disagree; the caller
	// supplies the capacity left in its hopper.
	function harvest(x, halfWidth, cut, maxCells, out) {
		out.value = 0;
		out.cells = 0;
		if (!(cut > 0) || !(maxCells > 0)) return out;
		const first = Math.max(0, Math.floor((x - halfWidth) / cell));
		const last = Math.min(columns - 1, Math.floor((x + halfWidth) / cell));
		let cells = 0;
		let value = 0;
		let changed = false;
		for (let column = first; column <= last; column++) {
			const height = floorPiles[column];
			if (height <= 0) continue;
			const density = floorValues[column] / height;
			let amount = Math.min(height, cut);
			let take = amount / floorCellHeightNow();
			if (cells + take > maxCells) {
				take = maxCells - cells;
				amount = take * floorCellHeightNow();
			}
			if (take <= 0) break;
			const taken = density * amount;
			floorPiles[column] = height - amount;
			floorValues[column] = Math.max(0, floorValues[column] - taken);
			cells += take;
			value += taken;
			changed = true;
			if (cells >= maxCells) break;
		}
		if (changed) updateFloor();
		out.cells = cells;
		out.value = value;
		return out;
	}

	function step(world, dt, carriedMass) {
		for (let i = 0; i < maxDebris; i++) {
			if (!active[i]) continue;
			const oldX = debrisX[i];
			const oldY = debrisY[i];
			const oldVx = debrisVx[i];
			const oldVy = debrisVy[i];
			const deckTime = oldY >= cargoHeight ? fallTime(oldY, oldVy, cargoHeight) : Infinity;
			const deckX = oldX + oldVx * deckTime;
			const platformLeft = world.platform.x - 1.8;
			if (deckTime <= dt && deckX >= platformLeft && deckX <= platformLeft + 1.26 && cargoCells < storageLimit) {
				debrisX[i] = deckX;
				debrisY[i] = cargoHeight;
				debrisVx[i] = oldVx;
				debrisVy[i] = oldVy - gravity * deckTime;
				if (catchFragment(world, i, carriedMass + cargoCells * cellMass)) continue;
			}
			// The rubble surface sits under the fragment's current drift; the
			// crossing is solved at that height and the deposit books the landing.
			const surface = floorAt(oldX);
			const floorTime = oldY >= surface ? fallTime(oldY, oldVy, surface) : 0;
			if (floorTime <= dt) {
				// Book the fragment at its actual landing position: when the pile
				// rose under it mid-fall, the real state is below the new surface,
				// and the energy ledger may only see what the fragment carried.
				debrisX[i] = oldX + oldVx * floorTime;
				debrisY[i] = oldY + oldVy * floorTime - 0.5 * gravity * floorTime * floorTime;
				debrisVx[i] = oldVx;
				debrisVy[i] = oldVy - gravity * floorTime;
				world.heat += fragmentMechanical(i);
				lostCells += fragmentCells(i);
				lostValue += fragmentValue(i);
				deposit(i, debrisX[i]);
				active[i] = 0;
				debrisCells[i] = 0;
				debrisValue[i] = 0;
				continue;
			}
			debrisX[i] = oldX + oldVx * dt;
			debrisY[i] = oldY + oldVy * dt - 0.5 * gravity * dt * dt;
			debrisVx[i] = oldVx;
			debrisVy[i] = oldVy - gravity * dt;
			if (debrisX[i] >= 0 && debrisX[i] <= width) continue;
			world.heat += fragmentMechanical(i);
			lostCells += fragmentCells(i);
			lostValue += fragmentValue(i);
			active[i] = 0;
			debrisCells[i] = 0;
			debrisValue[i] = 0;
		}
		watchBoundary(world);
		stepGrowth(dt);
		collapseTick(dt);
		ageDust(dt);
		if (root.SteamEquipment && root.SteamEquipment.isInstalled('grader')) grade(world, dt);
		stepGraderBot(world, dt);
		marketBudget += dt;
		if (marketBudget < marketInterval) return;
		marketClock += marketBudget;
		marketBudget = 0;
		updateMarket(false);
	}

	// Purchases and research debit funds and append a ledger entry; false when
	// funds are short. In communism mode the debit is zero, so the entry is
	// booked as a free handout.
	function purchase(label, amount, time, type) {
		if (!(amount > 0)) return false;
		const cost = price(amount);
		if (funds < cost) return false;
		funds -= cost;
		ledger.push(Object.freeze({
			id: ledger.length + 1,
			type: type || 'buy',
			time: typeof time === 'number' ? time : 0,
			label,
			credits: cost
		}));
		return true;
	}

	// Test-mode grants share the ledger but do not debit funds or depend on a
	// purchase mode. Effects and their mass changes are still applied normally.
	function grant(label, time, type) {
		ledger.push(Object.freeze({
			id: ledger.length + 1,
			type: type || 'grant',
			time: typeof time === 'number' ? time : 0,
			label,
			credits: 0,
			source: 'test'
		}));
		return true;
	}

	// Top the reserve up towards its capacity with bought energy. Funds buy as
	// much as they cover, so a poor shift still refuels partially. Returns the
	// imported joules, or 0 when the reserve is full or nothing is affordable.
	// In communism mode the whole gap is free.
	function recharge(world, time) {
		const physics = root.SteamPhysics;
		if (!physics || !world) return 0;
		const deficit = physics.config.battery - world.battery;
		if (deficit < 1) return 0;
		const energy = commune ? deficit : Math.min(deficit, Math.floor(funds * 1000 / fuelPrice));
		if (energy < 1) return 0;
		const credits = price(energy * fuelPrice / 1000);
		if (funds < credits) return 0;
		funds -= credits;
		world.battery += energy;
		world.importedEnergy += energy;
		ledger.push(Object.freeze({
			id: ledger.length + 1,
			type: 'fuel',
			time: typeof time === 'number' ? time : 0,
			label: (energy / 1000).toFixed(2) + ' kJ reserve recharge',
			credits,
			energy
		}));
		return energy;
	}

	// Credits needed to fill the reserve; the panel shows it before the click.
	// Nothing is needed in communism mode.
	function rechargeCost(world) {
		const physics = root.SteamPhysics;
		if (!physics || !world) return 0;
		return price(Math.max(0, physics.config.battery - world.battery) / 1000 * fuelPrice);
	}

	function sellCargo(platformVelocity, time) {
		if (!cargoCells) return 0;
		const value = cargoValue;
		exportedEnergy += cargoCells * cellMass * (gravity * cargoHeight + 0.5 * platformVelocity * platformVelocity);
		soldCells += cargoCells;
		soldValue += value;
		funds += value;
		const quantities = Object.freeze(Array.from(cargoMinerals));
		for (let m = 0; m < mineralCount; m++) {
			soldMinerals[m] += cargoMinerals[m];
			cargoMinerals[m] = 0;
		}
		ledger.push(Object.freeze({
			id: ledger.length + 1,
			type: 'sell',
			time: typeof time === 'number' ? time : 0,
			cells: cargoCells,
			mass: cargoCells * cellMass,
			credits: value,
			quantities
		}));
		cargoCells = 0;
		cargoValue = 0;
		return value;
	}

	function energy() {
		let value = exportedEnergy + cargoCells * cellMass * gravity * cargoHeight;
		const activeCells = columns * rows;
		for (let index = 0; index < activeCells; index++) if (strength[index] > 0) value += cellMass * gravity * (bottom + (Math.floor(index / columns) + 0.5) * cell);
		for (let i = 0; i < maxDebris; i++) if (active[i]) value += fragmentMechanical(i);
		return value;
	}

	function airborneCells() {
		let total = 0;
		for (let i = 0; i < maxDebris; i++) if (active[i]) total += fragmentCells(i);
		return total;
	}

	function airborneValue() {
		let total = 0;
		for (let i = 0; i < maxDebris; i++) if (active[i]) total += fragmentValue(i);
		return total;
	}

	function colorFor(index, mode, damage) {
		if (mode === 'elements') return elementColors[index];
		if (mode === 'price') return priceColors[index];
		// The fixed absolute ceiling: the strongest pure mineral, so a cell's
		// colour never depends on its own initial strength.
		if (mode === 'strength') return strengthPalette[Math.round(materials.clamp01(strength[index] / materials.maxStrength) * 100)];
		if (mode === 'damage') return damagePalette[Math.round(Math.max(0, Math.min(1, damage === undefined ? damageField[index] : damage)) * 100)];
		return mineralStyles[index];
	}

	// The chamber is drawn with a vertical perspective anchored to the upper
	// span (warpBottom..top): below warpBottom world and drawn coordinates
	// coincide at 1x scale, while above warpBottom vertical scale eases smoothly
	// from 1x at warpBottom to 0.25x (4x smaller) at top along a monotone cubic.
	// Anchoring the warp to the chamber instead of the instantaneous row count
	// prevents visual jumps as new rows slide in from above or compact below.
	//
	// This is one law for the whole chamber, not a rule for the rock paper: the
	// ball reads the same scale at the same height, so its size, its drawn shape
	// and its collision geometry are three consequences of one number.
	const warpBottom = initialBottom;
	const warpSpan = top - warpBottom;
	// The rock cells shrink to a quarter of their floor size at the roof; the
	// ball may not be drawn as a smaller body than that, or a ball flying in the
	// open room above the layer would read as a speck.
	const depthFloorScale = 0.25;
	const drawnRowY = new Float64Array(maxRows + 1);
	let depthScale = true;
	function setDepthScale(on) {
		depthScale = Boolean(on);
		return depthScale;
	}
	// The size a body has at a height: the chamber's own vertical scale there,
	// the very number the rock cells are drawn at. Depth scale hands that number
	// to the ball as a real size, so the picture and the collision agree at every
	// height: below the warp it is 1 and the floor game is untouched, and up in
	// the layer the ball is a body of the size of the cells around it.
	function perspectiveScale(y) {
		return depthScale ? rockScale(y) : 1;
	}
	// Antiderivative of the warp law, in the same inset coordinate
	// (y(u) = u + 0.75u^2 - 0.75u^3).
	function warpIntegral(y) {
		if (y <= warpBottom) return 0;
		if (y >= top) return 1;
		const u = (y - warpBottom) / warpSpan;
		return u + 0.75 * u * u - 0.75 * u * u * u;
	}
	function rockDrawnY(y) {
		if (y <= warpBottom) return y;
		if (y >= top) return top;
		return warpBottom + warpSpan * warpIntegral(y);
	}
	function rockWorldY(drawnY) {
		if (drawnY <= warpBottom) return drawnY;
		if (drawnY >= top) return top;
		const target = (drawnY - warpBottom) / warpSpan;
		let u = target;
		for (let step = 0; step < 6; step++) {
			const f = u + 0.75 * u * u * (1 - u) - target;
			const df = 1 + 1.5 * u - 2.25 * u * u;
			u -= f / df;
			if (u < 0) u = 0;
			else if (u > 1) u = 1;
		}
		return warpBottom + u * warpSpan;
	}
	// Local vertical pixel scale of the perspective at a world height.
	function rockScale(y) {
		if (y <= warpBottom) return 1;
		if (y >= top) return 0.25;
		const u = (y - warpBottom) / warpSpan;
		return 1 + 1.5 * u - 2.25 * u * u;
	}
	function updatePerspective() {
		for (let r = 0; r <= rows; r++) drawnRowY[r] = rockDrawnY(Math.min(top, bottom + r * cell));
	}
	updatePerspective();

	// The underside of the rock across a footprint of this half width, in drawn
	// space: the lowest ceiling an object of that width can still hang from. A
	// grain that has just let go sits at the face it broke from, so it is held
	// below the rock instead of being painted into the wall behind it.
	function ceilingUnder(x, halfWidth) {
		const firstColumn = Math.max(0, Math.floor((x - halfWidth) / cell));
		const lastColumn = Math.min(columns - 1, Math.floor((x + halfWidth) / cell));
		if (rockShape === 'square') {
			let underside = top;
			for (let column = firstColumn; column <= lastColumn; column++) {
				if (firstRow[column] < rows) underside = Math.min(underside, drawnRowY[firstRow[column]]);
			}
			return underside;
		}
		let lowest = top;
		for (let vertex = firstColumn; vertex <= Math.min(columns, lastColumn + 1); vertex++) lowest = Math.min(lowest, heightmap[vertex]);
		return rockDrawnY(lowest);
	}

	function draw(context, mode) {
		updatePerspective();
		if (rockShape === 'square') {
			const activeCells = columns * rows;
			for (let index = 0; index < activeCells; index++) {
				if (strength[index] <= 0) continue;
				const row = Math.floor(index / columns);
				const y0 = drawnRowY[row];
				const y1 = drawnRowY[row + 1];
				if (y1 <= y0) continue;
				context.fillStyle = colorFor(index, mode);
				context.fillRect(index % columns * cell, y0, cell + 0.002, y1 - y0 + 0.002);
			}
		} else {
			updateHeightmap();
			for (let c = 0; c < columns; c++) {
				const startRow = firstRow[c];
				if (startRow >= rows) continue;
				const x0 = c * cell;
				const x1 = x0 + cell + 0.002;
				const yL = heightmap[c];
				const yR = heightmap[c + 1];
				const dL = rockDrawnY(yL);
				const dR = rockDrawnY(yR);
				for (let row = startRow; row < rows; row++) {
					const index = row * columns + c;
					if (strength[index] <= 0) continue;
					const cellBottom = bottom + row * cell;
					if (cellBottom >= top) continue;
					const cellTop = Math.min(top, cellBottom + cell) + 0.002;
					const bL = row === startRow ? yL : Math.max(cellBottom, yL);
					const bR = row === startRow ? yR : Math.max(cellBottom, yR);
					if (bL >= cellTop && bR >= cellTop) continue;
					const dBottom = drawnRowY[row];
					const dTop = drawnRowY[row + 1];
					if (dTop <= dBottom) continue;
					const eL = row === startRow ? dL : dBottom;
					const eR = row === startRow ? dR : dBottom;
					context.fillStyle = colorFor(index, mode);
					if (bL === cellBottom && bR === cellBottom) {
						context.fillRect(x0, dBottom, cell + 0.002, dTop - dBottom + 0.002);
					} else {
						context.beginPath();
						context.moveTo(x0, eL);
						context.lineTo(x1, eR);
						context.lineTo(x1, dTop);
						context.lineTo(x0, dTop);
						context.closePath();
						context.fill();
					}
				}
			}
		}
		// Every falling cell is drawn at its own cell size and position: a group
		// that let go together keeps the shape it broke out in while it falls,
		// and each grain lands and piles in its own column.
		const grain = cell * 0.76;
		const halfGrain = grain * 0.5;
		for (let i = 0; i < maxDebris; i++) if (active[i]) {
			const drawnY = Math.min(rockDrawnY(debrisY[i]), ceilingUnder(debrisX[i], halfGrain) - halfGrain);
			context.fillStyle = colorFor(debrisCell[i], mode, debrisDamage[i]);
			context.fillRect(debrisX[i] - halfGrain, drawnY - halfGrain, grain, grain);
		}
		drawCollapse(context);
	}

	// Fallen rubble is drawn as shallow floor tiles. Each full cell is
	// floorCompression times wider than it is tall, so the DEBRIS setting makes
	// the same pile read as a flat sheet or a deep bed; the smoothed crest keeps
	// their heightmap gentle either way.
	//
	// A pile may now reach the roof, and the 4:1 default would then be 3 840
	// tiles a column, so a column is charted in at most maxTileLayers rows: a
	// pile up to that many tiles tall keeps the exact tile the setting asks for,
	// and a deeper one is drawn in proportionally taller blocks of the same
	// material. The area a player sees is the pile either way.
	const maxTileLayers = 64;
	function drawFloor(context) {
		updateFloor();
		const unit = floorCellHeightNow();
		for (let column = 0; column < columns; column++) {
			const height = Math.max(0, floorAt((column + 0.5) * cell));
			if (!(height > 1e-9)) continue;
			const tile = Math.max(unit, height / maxTileLayers);
			const start = height - Math.ceil(height / tile) * tile;
			for (let y = start, row = 0; y < height - 1e-9; y += tile, row++) {
				const tileHeight = Math.min(tile, height - y);
				context.fillStyle = (column + row) % 2 ? '#443a2d' : '#4a3e2f';
				context.fillRect(column * cell, Math.max(0, y), cell, tileHeight);
			}
		}
		context.strokeStyle = '#8b7454';
		context.beginPath();
		context.moveTo(0, floorHeight[0]);
		for (let vertex = 1; vertex <= columns; vertex++) context.lineTo(vertex * cell, floorHeight[vertex]);
		context.stroke();
	}

	// Stable live view: reading simulation state allocates nothing and invokes no command.
	const state = Object.freeze({
		columns, get rows() { return rows; }, initialRows, maxRows, cell, get floorCellHeight() { return floorCellHeightNow(); },
		get floorCompression() { return floorCompression; }, floorCompressionMin, floorCompressionMax,
		get bottom() { return bottom; }, initialBottom, minBottom, maxRockShare, minOpenShare, top,
		get lowestRockY() { return lowestIntactY(); },
		get upperBoundaryY() { return upperBoundaryY(); },
		get baseRow() { return baseRow; }, get generatedRows() { return generatedRows; },
		get pendingRows() { return queuedShift / cell; }, growthRate, boundaryLookahead,
		defaultPixelSize, storageLimit, cellMass,
		rockDrawnY, rockWorldY, rockScale, perspectiveScale, drawnRowY, depthFloorScale,
		get depthScale() { return depthScale; },
		get damageRadius() { return damageRadiusNow(); },
		get baseDamageRadius() { return baseDamageRadius; },
		get damageMultiplier() { return damageMultiplierNow(); },
		get baseDamageMultiplier() { return baseDamageMultiplier; },
		get damageRange() { return damageRangeNow(); },
		damageFalloffPower, pileLimit, graderCut, graderSmooth, graderClearance, graderSwath,
		loosedPerWeakened, hitLooseCap, collapseLooseFloor, collapseChanceMax, collapseChanceSaturation, collapseChanceSeconds,
		collapseChunkMin, get collapseChunkMax() { return collapseChunkMaxNow(); }, mineralClusterGrowth, damagePalette,
		get testRock() { return testRock; },
		collapseRegionsX, collapseRegionsY, regionDamage, regionEligible, damageField,
		get looseCells() { return looseCells(); },
		graderBot, blade, graderShare, floorValues,
		get shape() { return rockShape; }, heightmap, firstRow, floorPiles, floorHeight,
		garageHeight, garageDepth, garageParkX, graderSpeed,
		mineralTable, mineralCount, mineralNames, mineralSymbols, mineralIds, hostIndex, mineralPrices, mineralBasePrices, mineralTrends, mineralAbundance,
		targetCellValue, priceElasticity, mineralPriceFloor, mineralPriceCap, basePriceReport,
		geology: runGeology, field: runField, formation, maxStrength: materials.maxStrength,
		fuelPrice,
		get marketTime() { return marketClock; },
		strength, initialStrength, elements, minerals, prices, active, debrisX, debrisY, debrisVx, debrisVy, debrisCell, debrisCells,
		debrisValue, debrisMinerals, debrisDamage,
		cargoMinerals, soldMinerals, fallGroups, fallCells,
		get ledger() { return ledger; },
		get extractedCells() { return extractedCells; },
		get caughtCells() { return caughtCells; },
		get lostCells() { return lostCells; },
		get lostValue() { return lostValue; },
		get airborneCells() { return airborneCells(); },
		get collapseCells() { return collapseCells; },
		get collapseBursts() { return collapseBursts; },
		get airborneValue() { return airborneValue(); },
		get caughtValue() { return cargoValue + soldValue; },
		get cargoCells() { return cargoCells; },
		get cargoMass() { return cargoCells * cellMass; },
		get cargoValue() { return cargoValue; },
		get soldCells() { return soldCells; },
		get soldValue() { return soldValue; },
		get funds() { return funds; },
		get commune() { return commune; },
		get energy() { return energy(); }
	});

	reset(1);

	const api = {
		hireGrader, dismissGrader, toggleGrader, botSurfaceAt, drawGraderBot, reset, damage, damageRadiusNow, damageMultiplierNow,
		trace, step, harvest, sellCargo, purchase, grant, recharge, rechargeCost, price, setCommune, draw, drawFloor, floorAt,
		state, setShape, setFloorCompression, setDepthScale, setMineralClusterGrowth, generateTestRock, rockDrawnY, rockWorldY, rockScale, collapse, advanceMarket,
		applyGeology, exportGeology, applyGeologyExport, sampleCell, perspectiveScale, setDepthScale,
		queueGrowth, watchBoundary, grow,
		get collapseChunkMax() { return collapseChunkMaxNow(); }
	};
	root.SteamCeiling = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
