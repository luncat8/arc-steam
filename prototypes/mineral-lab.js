// The minerals lab: look at the element fields and the mineral mix they turn
// into, drag the signature ranges with the plot behind them, and let the
// calibration find ranges that put some of every mineral on a typical map.
// Its configuration is a snapshot of js/geology-config.js, and the strength,
// colour and price of a mixture come from js/rock-materials.js, so the numbers
// here are the numbers the game produces.
// Depends on: js/minerals.js, js/element-cdf.js, js/geology-config.js,
// js/rock-materials.js, js/geology.js, range-slider.js
'use strict';

const minerals = SteamMinerals;
const geologyConfig = SteamGeologyConfig;
const geology = SteamGeology;
const materials = SteamRockMaterials;
const table = minerals.mineralTable;
const count = minerals.mineralCount;
const hostIndex = minerals.hostIndex;
const channelNames = ['Metal', 'Crystal', 'Gas'];
const channelKeys = geologyConfig.channelKeys;
const channelTint = [[196, 108, 96], [110, 148, 208], [124, 186, 130]];

// Reference quotes from the default target shares: they keep range edits
// comparable instead of repricing the map, and use the shared base-price curve
// with fixed input. The game's base quotes use measured abundance instead.
const referencePrices = new Float64Array(count);
materials.basePricesInto(referencePrices, minerals.rarityTargets, materials.economy);
const minPrice = Math.min(...referencePrices);
const priceSpan = Math.max(...referencePrices) - minPrice;
const maxStrength = materials.maxStrength;
const hoverPointer = window.matchMedia('(hover: hover) and (pointer: fine)');

function mixedValue(offset, prices) {
	return prices ? materials.valueInto(mapMix, offset, referencePrices) : materials.strengthInto(mapMix, offset);
}

const columns = 192;
const rows = 120;
const sampleColumns = 96;
const plotBins = 72;
// An ore share within a quarter of a point of its target reads as met; the
// calibrator's own stone floor is mirrored here so the lab never claims a
// stone target it cannot mix.
// Bar scale: a 35% share fills the bar. The red line marks the desired share
// on the same scale; press and drag the bar, or type in Desired, to move it.
const TOLERANCE_PP = 0.25;
const MIN_HOST_WEIGHT = 0.06;
const barFull = 0.35;

// The lab's own editable snapshot: the field settings, mode, specificity, host
// weight and every signature range. Nothing here aliases the defaults.
const config = geologyConfig.create(37);
// Stone's fall grouping is a game setting, not formation input; it stays out.
const state = config;
state.view = 'minerals';
state.selected = 1;
state.targets = Float64Array.from(minerals.rarityTargets);
state.edited = false;
state.seeds = 6;
state.depth = 160;
state.depth0 = 0;

const ui = {};
for (const id of ['seed', 'reseed', 'frequency', 'frequency-value', 'compression', 'compression-value',
	'sample-seeds', 'sample-seeds-value', 'sample-depth', 'sample-depth-value',
	'map-depth', 'map-depth-value', 'map-note',
	'map', 'cell-tip', 'cell-mineral', 'cell-elements', 'cell-mix', 'view-modes', 'view-label',
	'element-r', 'element-g', 'element-b', 'share-rows', 'stats-note', 'stats-hint',
	'desired-sum', 'error-sum',
	'range-sliders', 'host-weight', 'host-weight-value', 'solve-host',
	'export-formation', 'import-formation', 'import-panel', 'import-text', 'import-apply', 'import-cancel',
	'mode', 'specificity', 'specificity-value', 'target-host', 'target-host-value',
	'target-common', 'target-common-value', 'target-uncommon', 'target-uncommon-value',
	'target-rare', 'target-rare-value', 'target-veryrare', 'target-veryrare-value',
	'auto-adjust', 'spread', 'reset-ranges', 'copy-table', 'copy-report', 'help-calibrate',
	'calibrate-status', 'report']) {
	ui[id] = document.getElementById(id);
}

// Buffers: the visible rock, the measurement sample and the scratch every
// recompute walks through. Allocated once, rewritten in place.
const field = geology.createField({ seed: state.seed, frequency: state.frequency, yCompression: state.yCompression });
const mapElements = new Float32Array(columns * rows * 3);
const mapMix = new Float32Array(columns * rows * count);
const mapCanvas = document.createElement('canvas');
mapCanvas.width = columns;
mapCanvas.height = rows;
const mapContext = mapCanvas.getContext('2d');
const mapImage = mapContext.createImageData(columns, rows);
const elementImages = [];
const elementContexts = [ui['element-r'], ui['element-g'], ui['element-b']].map(canvas => {
	const context = canvas.getContext('2d');
	elementImages.push(context.createImageData(columns, rows));
	return context;
});
let formation = geology.compile(state.ranges, state.mode, state.specificity);
let sample = null;
let cache = null;
// Lowest stone share the calibrator can mix on this sample: the unmatched
// cells are pure host, and auto-adjust never drops the host weight under its
// floor, so a desired stone share below this cannot be reached.
let stoneFloor = 0;
const stats = geology.emptyStats();
const values = new Float64Array(3);
const rowMix = new Float64Array(count);
const plotCounts = Array.from({ length: 3 }, () => new Float64Array(plotBins));
const plotYields = Array.from({ length: count }, () => Array.from({ length: 3 }, () => new Float64Array(plotBins)));
// Connected patches of one dominant mineral on the visible map: whether an ore
// turns up as a seam you can work or as dust scattered between other ores.
const cellDominant = new Uint8Array(columns * rows);
const patchVisited = new Uint8Array(columns * rows);
const patchStack = new Int32Array(columns * rows);
const patchCount = new Float64Array(count);
const patchCells = new Float64Array(count);
const patchLargest = new Float64Array(count);
const dirty = { field: true, mixes: true, stats: true, plots: true, editor: true, draw: true };
let frame = 0;

const sliders = [];
const shareRows = [];
const desiredDrag = { mineral: -1, pointer: 0, active: false };

function schedule() {
	if (frame) return;
	frame = requestAnimationFrame(work);
}

function work() {
	frame = 0;
	if (dirty.field) {
		field.seed = state.seed;
		field.frequency = state.frequency;
		field.yCompression = state.yCompression;
		for (let row = 0; row < rows; row++) {
			for (let column = 0; column < columns; column++) {
				const at = (row * columns + column) * 3;
				field.elements(column, row + state.depth0, field.values);
				mapElements[at] = field.values[0];
				mapElements[at + 1] = field.values[1];
				mapElements[at + 2] = field.values[2];
			}
		}
		dirty.field = false;
		dirty.mixes = true;
	}
	if (dirty.mixes) {
		for (let i = 0; i < columns * rows; i++) {
			const at = i * 3;
			values[0] = mapElements[at];
			values[1] = mapElements[at + 1];
			values[2] = mapElements[at + 2];
			formation.mixInto(values, state.hostWeight, mapMix, i * count);
		}
		computePatches();
		dirty.mixes = false;
		dirty.draw = true;
	}
	if (dirty.stats) {
		measure();
		dirty.stats = false;
		dirty.plots = true;
	}
	if (dirty.plots) {
		buildPlots();
		dirty.plots = false;
		dirty.editor = true;
	}
	if (dirty.editor) {
		paintEditor();
		dirty.editor = false;
	}
	if (dirty.draw) {
		draw();
		dirty.draw = false;
	}
}

// `heavy` re-measures the multi-seed sample as well; a drag only re-mixes the
// visible rock and repaints, and the numbers follow when the handle is let go.
function recompile(heavy) {
	formation = geology.compile(state.ranges, state.mode, state.specificity);
	dirty.mixes = true;
	if (heavy === false) { schedule(); return; }
	cache = null;
	dirty.stats = true;
	schedule();
}

function rebuildSample() {
	const seeds = [];
	for (let s = 0; s < state.seeds; s++) seeds.push(state.seed + s * 811);
	sample = geology.buildSample({ seeds, columns: sampleColumns, rows: state.depth, frequency: state.frequency, yCompression: state.yCompression });
	cache = null;
	dirty.stats = true;
	schedule();
}

function measure() {
	if (!sample) rebuildSample();
	if (!cache) cache = geology.buildCache(sample, formation);
	geology.statsAt(cache, state.hostWeight, stats);
	stoneFloor = geology.meanHostShare(cache, MIN_HOST_WEIGHT);
	paintShares();
	updateDesiredSummary();
}

// The plot behind a range slider: how many sampled cells sit at each value of
// the channel, and how much of the edited mineral they actually hold. The band
// can then be dragged onto the part of the field that produces that mineral.
function buildPlots() {
	if (!cache) return;
	for (let c = 0; c < 3; c++) plotCounts[c].fill(0);
	for (let m = 0; m < count; m++) for (let c = 0; c < 3; c++) plotYields[m][c].fill(0);
	for (let i = 0; i < sample.cells; i++) {
		const total = cache.totals[i] + state.hostWeight;
		const scale = total > 0 ? 1 / total : 0;
		for (let c = 0; c < 3; c++) {
			const bin = Math.min(plotBins - 1, Math.floor(sample.elements[i * 3 + c] * plotBins));
			plotCounts[c][bin]++;
			for (let m = 0; m < count; m++) {
				const fraction = m === hostIndex ? state.hostWeight * scale : cache.affinities[i * count + m] * scale;
				plotYields[m][c][bin] += fraction;
			}
		}
	}
	for (let m = 0; m < count; m++) for (let c = 0; c < 3; c++) {
		for (let b = 0; b < plotBins; b++) if (plotCounts[c][b] > 0) plotYields[m][c][b] /= plotCounts[c][b];
	}
}

function colourStyle(rgb) { return 'rgb(' + rgb[0] + ' ' + rgb[1] + ' ' + rgb[2] + ')'; }

function setViewMode(mode) {
	if (state.view === mode) return;
	state.view = mode;
	dirty.draw = true;
	schedule();
}

// The rgb the current view paints a cell with. Price and strength go through
// the shared ramps on their fixed scales: the reference quote span and the
// strongest pure mineral, so a colour never depends on the map's own extremes.
const rgbScratch = [0, 0, 0];

function viewColor(offset) {
	if (state.view === 'host') {
		const host = mapMix[offset + hostIndex];
		rgbScratch[0] = 34 + host * 190;
		rgbScratch[1] = 44 + host * 186;
		rgbScratch[2] = 50 + host * 176;
		return rgbScratch;
	}
	if (state.view === 'dominant') {
		let best = -1;
		for (let m = 0; m < count; m++) if (mapMix[offset + m] > best) best = mapMix[offset + m];
		for (let m = 0; m < count; m++) {
			if (mapMix[offset + m] !== best) continue;
			const rgb = table[m].color;
			rgbScratch[0] = rgb[0];
			rgbScratch[1] = rgb[1];
			rgbScratch[2] = rgb[2];
			break;
		}
		return rgbScratch;
	}
	if (state.view === 'price') return materials.priceColorInto(rgbScratch, (mixedValue(offset, true) - minPrice) / priceSpan);
	if (state.view === 'strength') return materials.strengthColorInto(rgbScratch, mixedValue(offset, false) / maxStrength);
	return materials.colorInto(mapMix, offset, rgbScratch);
}

function draw() {
	const data = mapImage.data;
	for (let i = 0; i < columns * rows; i++) {
		const offset = i * count;
		const at = i * 3;
		const rgb = state.view === 'elements' ? null : viewColor(offset);
		const red = rgb ? rgb[0] : mapElements[at] * 255;
		const green = rgb ? rgb[1] : mapElements[at + 1] * 255;
		const blue = rgb ? rgb[2] : mapElements[at + 2] * 255;
		const pixel = i * 4;
		data[pixel] = red;
		data[pixel + 1] = green;
		data[pixel + 2] = blue;
		data[pixel + 3] = 255;
		for (let c = 0; c < 3; c++) {
			const value = mapElements[at + c];
			const tint = channelTint[c];
			const pixelData = elementImages[c].data;
			pixelData[pixel] = value * tint[0];
			pixelData[pixel + 1] = value * tint[1];
			pixelData[pixel + 2] = value * tint[2];
			pixelData[pixel + 3] = 255;
		}
	}
	mapContext.putImageData(mapImage, 0, 0);
	const context = ui.map.getContext('2d');
	context.imageSmoothingEnabled = false;
	context.clearRect(0, 0, ui.map.width, ui.map.height);
	context.drawImage(mapCanvas, 0, 0, ui.map.width, ui.map.height);
	for (let c = 0; c < 3; c++) elementContexts[c].putImageData(elementImages[c], 0, 0);
}

function computePatches() {
	for (let i = 0; i < columns * rows; i++) {
		const offset = i * count;
		let best = -1;
		let bestMineral = hostIndex;
		for (let m = 0; m < count; m++) {
			if (mapMix[offset + m] > best) { best = mapMix[offset + m]; bestMineral = m; }
		}
		cellDominant[i] = bestMineral;
	}
	patchVisited.fill(0);
	patchCount.fill(0);
	patchCells.fill(0);
	patchLargest.fill(0);
	for (let start = 0; start < columns * rows; start++) {
		if (patchVisited[start]) continue;
		const mineral = cellDominant[start];
		let top = 0;
		let size = 0;
		patchStack[top++] = start;
		patchVisited[start] = 1;
		while (top > 0) {
			const cell = patchStack[--top];
			size++;
			const column = cell % columns;
			const row = (cell - column) / columns;
			for (let d = 0; d < 4; d++) {
				const nextColumn = column + (d === 0 ? -1 : d === 1 ? 1 : 0);
				const nextRow = row + (d === 2 ? -1 : d === 3 ? 1 : 0);
				if (nextColumn < 0 || nextRow < 0 || nextColumn >= columns || nextRow >= rows) continue;
				const next = nextRow * columns + nextColumn;
				if (patchVisited[next] || cellDominant[next] !== mineral) continue;
				patchVisited[next] = 1;
				patchStack[top++] = next;
			}
		}
		patchCount[mineral]++;
		patchCells[mineral] += size;
		if (size > patchLargest[mineral]) patchLargest[mineral] = size;
	}
}

function patchText(mineral) {
	if (patchCount[mineral] === 0) return '—';
	return (patchCells[mineral] / patchCount[mineral]).toFixed(1);
}

// The one residual the lab reports everywhere: achieved minus desired, in
// percentage points (pp, what a designer reads) and relative to the desired
// share (what the calibrator minimises). Scratch objects, no per-row garbage.
const errorScratch = { pp: 0, relative: 0 };
const errorScan = { mineral: 0, pp: 0, relative: 0, within: 0 };

function errorInto(shares, mineral) {
	const desired = state.targets[mineral];
	const delta = shares[mineral] - desired;
	errorScratch.pp = delta * 100;
	errorScratch.relative = desired > 0 ? delta / desired : 0;
	return errorScratch;
}

function errorTone(pp) {
	const size = Math.abs(pp);
	if (size <= TOLERANCE_PP) return 'is-good';
	return size <= 1 ? 'is-warn' : 'is-bad';
}

function signed(value, digits) {
	const unit = Math.pow(10, -digits);
	const rounded = Math.abs(value) < unit * 0.5 ? 0 : value;
	return (rounded < 0 ? '−' : '+') + Math.abs(rounded).toFixed(digits);
}

function scanErrors(shares) {
	let worst = -1;
	errorScan.mineral = 0;
	errorScan.pp = 0;
	errorScan.relative = 0;
	errorScan.within = 0;
	for (let m = 0; m < count; m++) {
		const error = errorInto(shares, m);
		if (Math.abs(error.pp) <= TOLERANCE_PP) errorScan.within++;
		if (worst < 0 || Math.abs(error.pp) > worst) {
			worst = Math.abs(error.pp);
			errorScan.mineral = m;
			errorScan.pp = error.pp;
			errorScan.relative = error.relative;
		}
	}
	return errorScan;
}

function paintErrorSummary() {
	const scan = scanErrors(stats.shares);
	const line = ui['error-sum'];
	line.textContent = 'Worst ' + signed(scan.pp, 2) + ' pp (' + table[scan.mineral].name + ', ' +
		signed(scan.relative * 100, 0) + '% relative) · ' + scan.within + ' of ' + count +
		' within ' + TOLERANCE_PP + ' pp.' +
		(state.targets[hostIndex] < stoneFloor - 1e-9
			? ' Stone is floored at ' + (stoneFloor * 100).toFixed(1) + '% on this sample, so that target cannot be met.'
			: '');
	line.className = 'hint ' + errorTone(scan.pp);
}

function paintShares() {
	for (let m = 0; m < count; m++) {
		const row = shareRows[m];
		row.shareText.textContent = (stats.shares[m] * 100).toFixed(2) + '%';
		row.dominant.textContent = (stats.dominant[m] * 100).toFixed(1) + '%';
		row.visible.textContent = (stats.visible[m] * 100).toFixed(1) + '%';
		row.fill.style.width = Math.min(100, stats.shares[m] * 100 / barFull) + '%';
		row.patch.textContent = patchText(m);
		row.patch.title = patchLargest[m] ? 'largest patch ' + patchLargest[m] + ' cells' : 'not on this map';
		row.row.classList.toggle('is-selected', m === state.selected);
		const error = errorInto(stats.shares, m);
		row.error.textContent = signed(error.pp, 2);
		row.error.className = 'error ' + errorTone(error.pp);
		row.error.title = table[m].name + ': achieved ' + (stats.shares[m] * 100).toFixed(2) + '%, desired ' +
			(state.targets[m] * 100).toFixed(2) + '% · ' + signed(error.relative * 100, 1) + '% relative';
	}
	paintErrorSummary();
	const missing = [];
	for (let m = 0; m < count; m++) {
		if (m === hostIndex) continue;
		if (stats.visible[m] < 0.01) missing.push(table[m].name);
	}
	ui['stats-note'].textContent = (sample.cells / 1000).toFixed(0) + 'k cells · ' + state.seeds + ' seeds';
	ui['stats-hint'].textContent = (missing.length
		? 'Nearly absent: ' + missing.join(', ') + '. A mineral that shows in under 1% of cells will not be found by play.'
		: 'Every mineral is visible in at least 1% of cells. Host rock takes ' + (stats.shares[hostIndex] * 100).toFixed(1) + '% of the field.') +
		' Share is the mean fraction over the sample; patch is the mean size of one connected run on the visible map. Drag the red line on a bar, or type in Desired, to change the desired share; Stone is the residual and cannot be dragged; Error is achieved minus desired in percentage points.';
}

function buildShareRows() {
	const body = ui['share-rows'];
	for (let m = 0; m < count; m++) {
		const entry = table[m];
		const tr = document.createElement('tr');
		tr.className = 'share-row';
		const name = document.createElement('td');
		const chip = document.createElement('i');
		chip.className = 'chip';
		chip.style.background = colourStyle(entry.color);
		name.append(chip, document.createTextNode(entry.name));
		const desiredCell = document.createElement('td');
		desiredCell.className = 'desired-cell';
		const desired = document.createElement('input');
		desired.type = 'number';
		desired.className = 'desired';
		desired.min = '0';
		desired.max = '100';
		desired.step = '0.1';
		desired.value = percentText(state.targets[m]);
		desired.setAttribute('aria-label', entry.name + ' desired share, percent');
		desired.disabled = Boolean(entry.host);
		desired.title = entry.host
			? 'Stone is the residual: 100% minus the ore shares, so it is not edited directly'
			: 'Desired mean share of the rock, percent';
		desired.addEventListener('input', () => readDesired(m, desired.value));
		desired.addEventListener('change', function () {
			readDesired(m, desired.value);
			syncDesired(-1);
		});
		desiredCell.append(desired);
		const share = document.createElement('td');
		share.className = 'bar-cell';
		const bar = document.createElement('div');
		bar.className = entry.host ? 'bar is-static' : 'bar';
		const fill = document.createElement('i');
		const mark = document.createElement('b');
		bar.append(fill, mark);
		if (!entry.host) {
			bar.tabIndex = 0;
			bar.setAttribute('role', 'slider');
			bar.setAttribute('aria-label', entry.name + ' desired share — drag or use arrow keys');
			bar.setAttribute('aria-valuemin', '0');
			bar.setAttribute('aria-valuemax', String(barFull * 100));
			bar.addEventListener('pointerdown', function (event) {
				desiredDrag.mineral = m;
				desiredDrag.pointer = event.pointerId;
				desiredDrag.active = true;
				bar.setPointerCapture(event.pointerId);
				bar.classList.add('is-dragging');
				select(m);
				setDesired(m, desiredAt(bar, event.clientX), -1);
				event.preventDefault();
			});
			bar.addEventListener('pointermove', function (event) {
				if (!desiredDrag.active || event.pointerId !== desiredDrag.pointer || desiredDrag.mineral !== m) return;
				setDesired(m, desiredAt(bar, event.clientX), -1);
			});
			function endDrag(event) {
				if (!desiredDrag.active || event.pointerId !== desiredDrag.pointer) return;
				desiredDrag.active = false;
				bar.classList.remove('is-dragging');
				if (bar.hasPointerCapture(event.pointerId)) bar.releasePointerCapture(event.pointerId);
			}
			bar.addEventListener('pointerup', endDrag);
			bar.addEventListener('pointercancel', endDrag);
			bar.addEventListener('keydown', function (event) {
				const stride = event.shiftKey ? 1 : 0.1;
				let next = null;
				if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = state.targets[m] * 100 - stride;
				else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = state.targets[m] * 100 + stride;
				else if (event.key === 'Home') next = 0;
				else if (event.key === 'End') next = barFull * 100;
				else return;
				event.preventDefault();
				select(m);
				setDesired(m, next, -1);
			});
		}
		const shareText = document.createElement('span');
		share.append(bar, shareText);
		const error = document.createElement('td');
		error.className = 'error';
		const dominant = document.createElement('td');
		const visible = document.createElement('td');
		const patch = document.createElement('td');
		tr.append(name, desiredCell, share, error, dominant, visible, patch);
		tr.addEventListener('click', function (event) {
			if (event.target === desired) return;
			select(m);
		});
		body.append(tr);
		shareRows.push({
			row: tr, bar: bar, fill: fill, mark: mark, shareText: shareText, desired: desired,
			error: error, dominant: dominant, visible: visible, patch: patch
		});
	}
	updateTargetMarks();
	updateDesiredSummary();
}

function select(mineral) {
	state.selected = mineral;
	dirty.plots = true;
	dirty.editor = true;
	for (let m = 0; m < count; m++) shareRows[m].row.classList.toggle('is-selected', m === mineral);
	schedule();
}

function updateTargetMarks() {
	for (let m = 0; m < count; m++) shareRows[m].mark.style.left = Math.min(100, state.targets[m] * 100 / barFull) + '%';
}

function desiredAt(bar, clientX) {
	const box = bar.getBoundingClientRect();
	const ratio = box.width > 0 ? Math.min(1, Math.max(0, (clientX - box.left) / box.width)) : 0;
	return ratio * barFull * 100;
}

function percentText(share) { return (share * 100).toFixed(1); }

// Stone is the residual of the ore shares, so a hand-set ore share moves the
// stone target by the same amount instead of leaving the column short of 100%.
function settleHostTarget() {
	let ore = 0;
	for (let m = 0; m < count; m++) if (m !== hostIndex) ore += state.targets[m];
	state.targets[hostIndex] = Math.max(0, 1 - ore);
}

function readDesired(mineral, text) {
	const trimmed = String(text).trim();
	if (!trimmed) return;
	const percent = Number(trimmed);
	if (!Number.isFinite(percent)) return;
	setDesired(mineral, percent);
}

// `skip` is the input being typed in, so rewriting it would move the caret;
// a drag or key press passes -1 and every input is rewritten.
function setDesired(mineral, percent, skip) {
	state.targets[mineral] = Math.min(1, Math.max(0, percent / 100));
	state.edited = true;
	settleHostTarget();
	syncDesired(skip === undefined ? mineral : skip);
	dirty.stats = true;
	schedule();
}

// `skip` is the cell being typed in: rewriting it would move the caret.
function syncDesired(skip) {
	for (let m = 0; m < count; m++) {
		if (m === skip) continue;
		shareRows[m].desired.value = percentText(state.targets[m]);
	}
	updateTargetMarks();
	updateDesiredSummary();
}

function updateDesiredSummary() {
	let ore = 0;
	for (let m = 0; m < count; m++) if (m !== hostIndex) ore += state.targets[m];
	const stone = state.targets[hostIndex];
	const over = ore > 1 + 1e-9;
	const floor = !over && stone < stoneFloor - 1e-9;
	const line = ui['desired-sum'];
	line.textContent = (over
		? 'Ore desired ' + (ore * 100).toFixed(1) + '% is over 100% — stone pinned at 0.0%'
		: 'Desired ' + ((ore + stone) * 100).toFixed(1) + '% · ore ' + (ore * 100).toFixed(1) + '% · stone ' + (stone * 100).toFixed(1) + '%') +
		(floor ? ' · floor ' + (stoneFloor * 100).toFixed(1) + '%' : '') +
		(state.edited ? ' · hand-edited' : '');
	line.classList.toggle('is-bad', over);
	line.classList.toggle('is-warn', !over && floor);
}

function buildEditor() {
	for (let m = 0; m < count; m++) {
		const entry = table[m];
		const row = document.createElement('div');
		row.className = 'mineral-editor';
		row.id = 'editor-' + entry.id;
		const title = document.createElement('div');
		title.className = 'mineral-editor-title';
		title.textContent = entry.name + ' · ' + (entry.host ? 'host fallback' : entry.analog + ' · ' + entry.rarity + ' · strength ' + entry.strength.toFixed(1) + ' J');
		row.append(title);
		const controls = document.createElement('div');
		controls.className = 'mineral-editor-controls';
		row.append(controls);
		ui['range-sliders'].append(row);
		sliders[m] = [];
		if (entry.host) {
			controls.textContent = 'Host weight is constant; Stone has no signature ranges.';
			continue;
		}
		for (let c = 0; c < 3; c++) {
			sliders[m].push(SteamRangeSlider.create(controls, {
				label: channelNames[c] + ' · ' + 'RGB'[c] + ' · ' + entry.name,
				min: 0, max: 1, step: 0.005, minGap: 0.02,
				low: state.ranges[m][c][0], high: state.ranges[m][c][1],
				onInput(low, high, finished) {
					state.ranges[m][c][0] = low;
					state.ranges[m][c][1] = high;
					recompile(finished);
				}
			}));
		}
	}
}

function paintEditor() {
	for (let m = 0; m < count; m++) {
		if (table[m].host) continue;
		const color = table[m].color;
		const accent = 'rgba(' + color[0] + ', ' + color[1] + ', ' + color[2] + ', 0.7)';
		for (let c = 0; c < 3; c++) {
			const range = state.ranges[m][c];
			sliders[m][c].setRange(range[0], range[1]);
			sliders[m][c].setPlot(plotCounts[c], plotYields[m][c], accent);
		}
	}
}

function targetsFromWeights() {
	const weights = {
		host: Number(ui['target-host'].value),
		common: Number(ui['target-common'].value),
		uncommon: Number(ui['target-uncommon'].value),
		rare: Number(ui['target-rare'].value),
		'very rare': Number(ui['target-veryrare'].value)
	};
	let total = 0;
	for (let m = 0; m < count; m++) {
		const rarity = table[m].rarity;
		if (rarity === 'host') continue;
		total += weights[rarity] || 0;
	}
	const unit = total > 0 ? (1 - weights.host) / total : 0;
	for (let m = 0; m < count; m++) {
		const rarity = table[m].rarity;
		state.targets[m] = rarity === 'host' ? weights.host : unit * (weights[rarity] || 0);
	}
	state.edited = false;
	syncDesired(-1);
	dirty.stats = true;
	schedule();
}

function status(text) { ui['calibrate-status'].textContent = text; }

// Back to the shipped formation: one reset path, the same values the HTML
// controls and the game start from.
function resetToDefaults() {
	geologyConfig.resetInto(state);
	syncConfigControls();
	recompile();
}

// The complete snapshot, keyed by stable mineral id, with the desired shares as
// separate calibration metadata that the game never applies.
function formationExport() {
	return JSON.stringify(geologyConfig.exportOf(state, state.targets), null, '\t');
}

// Applying an import replaces the lab's snapshot only; the game takes its own
// copy deliberately, so a lab experiment can never leak into an active run.
function applyImportText() {
	let parsed = null;
	try {
		parsed = JSON.parse(ui['import-text'].value);
	} catch (error) {
		status('import rejected: ' + error.message);
		return false;
	}
	const problems = geologyConfig.validateExport(parsed);
	if (problems.length) {
		status('import rejected: ' + problems.join('; '));
		return false;
	}
	geologyConfig.applyInto(state, parsed);
	ui['import-panel'].hidden = true;
	syncConfigControls();
	recompile();
	status('import applied · field settings, mean, specificity and host weight follow the snapshot');
	return true;
}

// The controls mirror the snapshot after any change that did not come from a
// control itself (import, reset).
function syncConfigControls() {
	ui.seed.value = String(state.seed);
	ui.frequency.value = String(state.frequency);
	ui['frequency-value'].textContent = state.frequency.toFixed(3);
	ui.compression.value = String(state.yCompression);
	ui['compression-value'].textContent = state.yCompression.toFixed(1) + '×';
	ui['host-weight'].value = String(state.hostWeight);
	ui['host-weight-value'].textContent = state.hostWeight.toFixed(3);
	ui.mode.value = state.mode;
	ui.specificity.value = String(state.specificity);
	ui['specificity-value'].textContent = state.specificity.toFixed(2);
}

function runAdjust() {
	status('adjusting…');
	const started = performance.now();
	setTimeout(function () {
		const result = geology.autoAdjust({
			sample: sample,
			ranges: state.ranges,
			targets: state.targets,
			mode: state.mode,
			specificity: state.specificity,
			hostWeight: state.hostWeight,
			minHostWeight: MIN_HOST_WEIGHT
		});
		state.hostWeight = result.hostWeight;
		ui['host-weight'].value = String(result.hostWeight);
		ui['host-weight-value'].textContent = result.hostWeight.toFixed(3);
		recompile();
		const scan = scanErrors(result.stats.shares);
		status('auto-adjust: ' + result.history.length + ' passes, worst ' + signed(scan.pp, 2) + ' pp (' +
			table[scan.mineral].name + ', ' + signed(scan.relative * 100, 0) + '% relative), ' +
			Math.round(performance.now() - started) + ' ms' +
			(scan.within === count ? '' : ' — some desired shares stay out of tolerance; the fixed gas identity and the stone floor cannot be widened'));
	}, 20);
}

function reportText() {
	const lines = ['minerals lab · seed ' + state.seed + ' · frequency ' + state.frequency + ' · Y flattening ' + state.yCompression + '×',
		'sample ' + state.seeds + ' seeds × ' + sampleColumns + ' columns × ' + state.depth + ' rows = ' + sample.cells + ' cells',
		'affinity ' + state.mode + ', specificity ' + state.specificity + ', host weight ' + state.hostWeight.toFixed(3), ''];
	const scan = scanErrors(stats.shares);
	let ore = 0;
	for (let m = 0; m < count; m++) if (m !== hostIndex) ore += state.targets[m];
	lines.push('desired ' + ((ore + state.targets[hostIndex]) * 100).toFixed(1) + '% · ore ' + (ore * 100).toFixed(1) +
		'% · stone ' + (state.targets[hostIndex] * 100).toFixed(1) + '% · reachable stone floor ' +
		(stoneFloor * 100).toFixed(1) + '%' + (state.edited ? ' · hand-edited' : ''),
		'worst error ' + signed(scan.pp, 2) + ' pp ' + table[scan.mineral].name + ' (' + signed(scan.relative * 100, 0) +
		'% relative), ' + scan.within + ' of ' + count + ' within ' + TOLERANCE_PP + ' pp', '');
	lines.push('mineral              desired    share    error  dominant  visible   patch   signature R / G / B');
	for (let m = 0; m < count; m++) {
		const parts = [];
		for (let c = 0; c < 3; c++) {
			const range = state.ranges[m][c];
			parts.push(geology.isUnconstrained(range) ? 'any' : range[0].toFixed(2) + '-' + range[1].toFixed(2));
		}
		const error = errorInto(stats.shares, m);
		lines.push(table[m].name.padEnd(20) +
			(state.targets[m] * 100).toFixed(1).padStart(6) + '%' +
			(stats.shares[m] * 100).toFixed(2).padStart(8) + '%' +
			signed(error.pp, 2).padStart(8) + 'pp' +
			(stats.dominant[m] * 100).toFixed(2).padStart(9) + '%' +
			(stats.visible[m] * 100).toFixed(2).padStart(8) + '%' + (patchText(m) + ' cells').padStart(11) + '   ' + parts.join('  '));
	}
	lines.push('', 'js/minerals.js ranges');
	for (let m = 0; m < count; m++) {
		if (table[m].host) continue;
		const parts = channelKeys.map((key, c) => {
			const range = state.ranges[m][c];
			return key + ': ' + (geology.isUnconstrained(range) ? 'ANY' : 'Object.freeze([' + range[0].toFixed(2) + ', ' + range[1].toFixed(2) + '])');
		});
		lines.push('\t\t\t' + table[m].id + ': ' + parts.join(', ') + ',');
	}
	return lines.join('\n');
}

function copy(text, note) {
	navigator.clipboard.writeText(text).then(function () { status(note); }, function () {
		ui.report.hidden = false;
		ui.report.textContent = text;
		status('clipboard blocked · report shown below');
	});
}

function bindControls() {
	ui.seed.addEventListener('input', function () {
		state.seed = Math.max(1, Math.round(Number(ui.seed.value) || 1));
		dirty.field = true;
		rebuildSample();
	});
	ui.reseed.addEventListener('click', function () {
		state.seed = 1 + Math.floor(Math.random() * 99999);
		ui.seed.value = String(state.seed);
		dirty.field = true;
		rebuildSample();
	});
	ui.frequency.addEventListener('input', function () {
		state.frequency = Number(ui.frequency.value);
		ui['frequency-value'].textContent = state.frequency.toFixed(3);
		dirty.field = true;
		rebuildSample();
	});
	ui.compression.addEventListener('input', function () {
		state.yCompression = Number(ui.compression.value);
		ui['compression-value'].textContent = state.yCompression.toFixed(1) + '×';
		dirty.field = true;
		rebuildSample();
	});
	ui['map-depth'].addEventListener('input', function () {
		state.depth0 = Number(ui['map-depth'].value);
		ui['map-depth-value'].textContent = 'row ' + state.depth0;
		dirty.field = true;
		schedule();
	});
	ui['sample-seeds'].addEventListener('input', function () {
		state.seeds = Number(ui['sample-seeds'].value);
		ui['sample-seeds-value'].textContent = String(state.seeds);
		rebuildSample();
	});
	ui['sample-depth'].addEventListener('input', function () {
		state.depth = Number(ui['sample-depth'].value);
		ui['sample-depth-value'].textContent = String(state.depth);
		rebuildSample();
	});
	ui['view-modes'].addEventListener('change', function (event) {
		if (event.target.name !== 'lab-view') return;
		setViewMode(event.target.value);
	});
	ui['view-modes'].addEventListener('pointerover', function (event) {
		if (!hoverPointer.matches) return;
		const label = event.target.closest('label');
		if (!label || !ui['view-modes'].contains(label)) return;
		const input = label.control;
		if (!input || input.name !== 'lab-view') return;
		input.checked = true;
		setViewMode(input.value);
	});
	ui['host-weight'].addEventListener('input', function () {
		state.hostWeight = Number(ui['host-weight'].value);
		ui['host-weight-value'].textContent = state.hostWeight.toFixed(3);
		dirty.mixes = true;
		dirty.stats = true;
		schedule();
	});
	ui['solve-host'].addEventListener('click', function () {
		cache = geology.buildCache(sample, formation);
		state.hostWeight = geology.solveHostWeight(cache, state.targets[hostIndex]);
		ui['host-weight'].value = String(state.hostWeight);
		ui['host-weight-value'].textContent = state.hostWeight.toFixed(3);
		status('host solve: actual share ' + (geology.meanHostShare(cache, state.hostWeight) * 100).toFixed(1) + '%; unmatched cells can make the target unreachable.');
		dirty.mixes = true;
		dirty.stats = true;
		schedule();
	});
	ui.mode.addEventListener('change', function () {
		state.mode = ui.mode.value;
		recompile();
	});
	ui.specificity.addEventListener('input', function () {
		state.specificity = Number(ui.specificity.value);
		ui['specificity-value'].textContent = state.specificity.toFixed(2);
		recompile();
	});
	ui['target-host'].addEventListener('input', function () {
		ui['target-host-value'].textContent = Math.round(Number(ui['target-host'].value) * 100) + '%';
		targetsFromWeights();
	});
	for (const key of ['target-common', 'target-uncommon', 'target-rare', 'target-veryrare']) {
		ui[key].addEventListener('input', function () {
			ui[key + '-value'].textContent = Number(ui[key].value).toFixed(key === 'target-veryrare' ? 3 : 2);
			targetsFromWeights();
		});
	}
	ui['auto-adjust'].addEventListener('click', runAdjust);
	ui.spread.addEventListener('click', function () {
		const moved = geology.separate(state.ranges, 0.06);
		recompile();
		status(moved.length ? 'spread: gave ' + moved.length + ' swallowed signature(s) an edge of their own' : 'spread: no signature sits inside another');
	});
	ui['reset-ranges'].addEventListener('click', function () {
		resetToDefaults();
		status('formation reset to js/geology-config.js defaults');
	});
	ui['export-formation'].addEventListener('click', function () {
		copy(formationExport(), 'complete formation snapshot copied');
	});
	ui['import-formation'].addEventListener('click', function () {
		ui.report.hidden = true;
		ui['import-text'].value = '';
		ui['import-panel'].hidden = false;
		ui['import-text'].focus();
	});
	ui['import-apply'].addEventListener('click', applyImportText);
	ui['import-cancel'].addEventListener('click', function () { ui['import-panel'].hidden = true; });
	ui['copy-table'].addEventListener('click', function () { copy(reportText(), 'report and JS ranges copied'); });
	ui['copy-report'].addEventListener('click', function () {
		ui.report.hidden = false;
		ui.report.textContent = reportText();
		status('report shown below');
	});
	ui['help-calibrate'].addEventListener('click', function () {
		status('Auto-adjust widens or narrows every signature until the measured shares match the desired ' +
			'shares in the table, solves the host weight for the desired stone share, and pushes a signature ' +
			'out of any broader box that contains it. Gas stays fixed and stone cannot drop under the mix ' +
			'floor, so some desired shares may stay unreachable; the error column shows by how much.');
	});
}

function bindCellTip() {
	const canvas = ui.map;
	canvas.addEventListener('pointermove', function (event) {
		const box = canvas.getBoundingClientRect();
		const column = Math.floor((event.clientX - box.left) / box.width * columns);
		const row = Math.floor((event.clientY - box.top) / box.height * rows);
		if (column < 0 || row < 0 || column >= columns || row >= rows) return;
		const index = row * columns + column;
		const offset = index * count;
		let best = -1;
		let bestMineral = hostIndex;
		const parts = [];
		for (let m = 0; m < count; m++) {
			const fraction = mapMix[offset + m];
			if (fraction > best) { best = fraction; bestMineral = m; }
			if (fraction > 0.02) parts.push(table[m].symbol + ' ' + Math.round(fraction * 100) + '%');
		}
		ui['cell-mineral'].textContent = table[bestMineral].name + ' · ' + Math.round(best * 100) + '%';
		ui['cell-elements'].textContent = 'metal ' + mapElements[index * 3].toFixed(2) +
			'  crystal ' + mapElements[index * 3 + 1].toFixed(2) + '  gas ' + mapElements[index * 3 + 2].toFixed(2);
		ui['cell-mix'].textContent = parts.join(' · ') + '\nStrength ' + mixedValue(offset, false).toFixed(2) +
			' J/cell · Reference price ' + mixedValue(offset, true).toFixed(2) + ' credits/cell';
		ui['cell-tip'].hidden = false;
		ui['cell-tip'].style.left = Math.min(box.width - 220, (event.clientX - box.left) + 16) + 'px';
		ui['cell-tip'].style.top = ((event.clientY - box.top) + 16) + 'px';
	});
	canvas.addEventListener('pointerleave', function () { ui['cell-tip'].hidden = true; });
}

function start() {
	buildShareRows();
	updateDesiredSummary();
	buildEditor();
	bindControls();
	bindCellTip();
	ui['map-note'].textContent = columns + ' × ' + rows + ' cells · ' + count + ' materials';
	ui['stats-note'].textContent = 'measuring…';
	ui['error-sum'].title = 'Error is achieved minus desired, in percentage points: positive is too much rock, negative too little.';
	rebuildSample();
}

start();
