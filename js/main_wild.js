// Wild Mine canvas renderer, tile cache and mode-aware UI helpers.
// Shares lexical scope with js/main*.js; all top-level bindings use a wild* prefix.
// provides: wildIsActive, wildDraw, wildResize, wildSyncMode, wildResetRun, wildInspectRockAtPointer, wildPointerDown, wildWorldYOf, wildMineralReadout, wildStatusReadout, wildModeNotes, wildPistonLimitDegrees
// depends: main.js bindings, SteamCave, SteamWildMine, SteamWildBall, SteamRockMaterials, SteamCeiling

'use strict';

const wildTileLimit = 12;
const wildTiles = new Map();
const wildElementsScratch = new Float32Array(3);
const wildMixScratch = new Float32Array(window.SteamMinerals.mineralCount);
const wildRgbScratch = new Float64Array(3);
const wildDamageRgba = new Uint32Array(101);
const wildLittleEndian = new Uint8Array(new Uint32Array([0x0a0b0c0d]).buffer)[0] === 0x0d;
const wildProbeCanvas = typeof document !== 'undefined' && document.createElement ? document.createElement('canvas') : null;
const wildProbeCtx = wildProbeCanvas && typeof wildProbeCanvas.getContext === 'function' ? wildProbeCanvas.getContext('2d') : null;
const wildCanUseTiles = Boolean(wildProbeCtx && typeof wildProbeCtx.createImageData === 'function');

let wildSelectedColumn = 0;
let wildSelectedRow = 246;
let wildPriceStamp = 0;
let wildLastPrices = null;
let wildMinPrice = 0;
let wildPriceSpan = 1;
let wildDrawnRowY = new Float64Array(0);

function wildPackRgba(r, g, b, a) {
	const cr = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
	const cg = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
	const cb = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
	const ca = a === undefined ? 255 : (a < 0 ? 0 : a > 255 ? 255 : Math.round(a));
	return wildLittleEndian
		? ((ca << 24) | (cb << 16) | (cg << 8) | cr) >>> 0
		: ((cr << 24) | (cg << 16) | (cb << 8) | ca) >>> 0;
}

for (let i = 0; i <= 100; i++) {
	const t = i / 100;
	wildDamageRgba[i] = wildPackRgba(65 + t * 185, 160 - t * 112, 190 - t * 152, 255);
}

function wildIsActive() {
	return Boolean(window.SteamWildMine && window.SteamWildMine.isWild());
}

// Debris rides the same draw map as the rock: a fragment is one cell, so it is
// drawn at the vertical scale of its own height and stays square in the world.
function wildDrawDebris(wild, anchorY, minWorldY, maxWorldY) {
	const ball = window.SteamWildBall;
	if (!ball || !ball.debrisCount) return;
	const count = ball.debrisActive.length;
	for (let i = 0; i < count; i++) {
		if (!ball.debrisActive[i]) continue;
		const y = ball.debrisY[i];
		if (y < minWorldY || y > maxWorldY) continue;
		const size = ball.debrisSize[i];
		const vertical = size * wild.scaleAt(y, anchorY);
		const half = size * 0.5;
		const drawn = wild.drawnY(y, anchorY);
		context.fillStyle = 'rgb(' + ball.debrisRed[i] + ', ' + ball.debrisGreen[i] + ', ' + ball.debrisBlue[i] + ')';
		context.fillRect(ball.debrisX[i] - half, drawn - vertical * 0.5, size, vertical);
	}
}

function wildPistonLimitDegrees() {
	return Math.round(physics.pistonMaxAngleNow() * 180 / Math.PI);
}

function wildSyncPriceRange() {
	const ceiling = window.SteamCeiling.state;
	const prices = ceiling.mineralPrices;
	let changed = !wildLastPrices;
	if (!changed) {
		for (let i = 0; i < prices.length; i++) {
			if (Math.abs(prices[i] - wildLastPrices[i]) > 1e-6) { changed = true; break; }
		}
	}
	if (!changed) return;
	if (!wildLastPrices) wildLastPrices = new Float64Array(prices.length);
	let minP = Infinity;
	let maxP = -Infinity;
	for (let i = 0; i < prices.length; i++) {
		wildLastPrices[i] = prices[i];
		if (ceiling.mineralTable[i].gen === false) continue;
		if (prices[i] < minP) minP = prices[i];
		if (prices[i] > maxP) maxP = prices[i];
	}
	wildMinPrice = Number.isFinite(minP) ? minP : 0;
	wildPriceSpan = maxP > minP ? maxP - minP : 1;
	wildPriceStamp++;
}

function wildCellRgba(cave, chunk, localIndex, column, row, mode) {
	const materials = window.SteamRockMaterials;
	if (mode === 'damage') {
		if (!chunk.sampled[localIndex]) return wildDamageRgba[0];
		cave.mixAt(column, row, wildMixScratch, wildElementsScratch);
		const initial = materials.strengthInto(wildMixScratch, 0);
		const remaining = chunk.strength[localIndex];
		const slot = Math.round(materials.clamp01((initial - remaining) / materials.maxStrength) * 100);
		return wildDamageRgba[slot];
	}
	if (mode === 'elements') {
		const el = cave.elementsAt(column, row, wildElementsScratch);
		return wildPackRgba(el[0] * 255, el[1] * 255, el[2] * 255, 255);
	}
	cave.mixAt(column, row, wildMixScratch, wildElementsScratch);
	if (mode === 'price') {
		const value = materials.valueInto(wildMixScratch, 0, wildLastPrices);
		materials.priceColorInto(wildRgbScratch, (value - wildMinPrice) / wildPriceSpan);
		return wildPackRgba(wildRgbScratch[0], wildRgbScratch[1], wildRgbScratch[2], 255);
	}
	if (mode === 'initial-strength') {
		const initial = materials.strengthInto(wildMixScratch, 0);
		materials.strengthColorInto(wildRgbScratch, initial / materials.maxStrength);
		return wildPackRgba(wildRgbScratch[0], wildRgbScratch[1], wildRgbScratch[2], 255);
	}
	if (mode === 'strength') {
		const initial = materials.strengthInto(wildMixScratch, 0);
		const remaining = chunk.sampled[localIndex] ? chunk.strength[localIndex] : initial;
		materials.strengthColorInto(wildRgbScratch, remaining / materials.maxStrength);
		if (remaining < materials.debrisLimit) materials.desaturateInto(wildRgbScratch);
		return wildPackRgba(wildRgbScratch[0], wildRgbScratch[1], wildRgbScratch[2], 255);
	}
	materials.colorInto(wildMixScratch, 0, wildRgbScratch);
	return wildPackRgba(wildRgbScratch[0], wildRgbScratch[1], wildRgbScratch[2], 255);
}

function wildAcquireTile(chunk, rows, cols) {
	let tile = wildTiles.get(chunk.index);
	if (tile) {
		wildTiles.delete(chunk.index);
		wildTiles.set(chunk.index, tile);
		return tile;
	}
	if (wildTiles.size >= wildTileLimit) {
		const oldest = wildTiles.keys().next().value;
		wildTiles.delete(oldest);
	}
	const tileCanvas = document.createElement('canvas');
	tileCanvas.width = cols;
	tileCanvas.height = rows;
	const tileContext = tileCanvas.getContext('2d');
	const imageData = tileContext.createImageData(cols, rows);
	tile = {
		index: chunk.index,
		canvas: tileCanvas,
		context: tileContext,
		imageData,
		data32: new Uint32Array(imageData.data.buffer),
		rowValid: new Uint8Array(rows),
		editStamp: -1,
		viewMode: '',
		priceStamp: -1
	};
	wildTiles.set(chunk.index, tile);
	return tile;
}

function wildSyncTileRows(cave, chunk, tile, minRow, maxRow) {
	const rows = cave.state.rows;
	const cols = cave.state.chunkColumns;
	const pad = cave.state.pad;
	const stride = cave.state.stride;
	if (tile.editStamp !== chunk.editStamp || tile.viewMode !== viewMode || (viewMode === 'price' && tile.priceStamp !== wildPriceStamp)) {
		tile.rowValid.fill(0);
		tile.editStamp = chunk.editStamp;
		tile.viewMode = viewMode;
		tile.priceStamp = wildPriceStamp;
	}
	const data32 = tile.data32;
	const solid = chunk.solid;
	let runStart = -1;
	for (let r = minRow; r <= maxRow; r++) {
		if (!tile.rowValid[r]) {
			const imgRowOffset = (rows - 1 - r) * cols;
			const chunkRowOffset = r * stride + pad;
			for (let c = 0; c < cols; c++) {
				const localIndex = chunkRowOffset + c;
				data32[imgRowOffset + c] = solid[localIndex]
					? wildCellRgba(cave, chunk, localIndex, chunk.column0 + c, r, viewMode)
					: 0;
			}
			tile.rowValid[r] = 1;
			if (runStart < 0) runStart = r;
		} else if (runStart >= 0) {
			tile.context.putImageData(tile.imageData, 0, 0, 0, rows - 1 - (r - 1), cols, r - runStart);
			runStart = -1;
		}
	}
	if (runStart >= 0) {
		tile.context.putImageData(tile.imageData, 0, 0, 0, rows - 1 - maxRow, cols, maxRow - runStart + 1);
	}
}

function wildDrawFallbackChunk(cave, chunk, minCol, maxCol, minRow, maxRow) {
	const cell = cave.state.cell;
	const pad = cave.state.pad;
	const stride = cave.state.stride;
	const startCol = Math.max(0, minCol - chunk.column0);
	const endCol = Math.min(cave.state.chunkColumns - 1, maxCol - chunk.column0);
	if (endCol < startCol) return;
	context.fillStyle = '#5a4e3f';
	for (let r = minRow; r <= maxRow; r++) {
		const dBottom = wildDrawnRowY[r];
		const dTop = wildDrawnRowY[r + 1];
		if (!(dTop > dBottom)) continue;
		const rowOffset = r * stride + pad;
		let runStart = -1;
		for (let c = startCol; c <= endCol; c++) {
			if (chunk.solid[rowOffset + c]) {
				if (runStart < 0) runStart = c;
			} else if (runStart >= 0) {
				context.fillRect((chunk.column0 + runStart) * cell, dBottom, (c - runStart) * cell + 0.002, dTop - dBottom + 0.002);
				runStart = -1;
			}
		}
		if (runStart >= 0) {
			context.fillRect((chunk.column0 + runStart) * cell, dBottom, (endCol + 1 - runStart) * cell + 0.002, dTop - dBottom + 0.002);
		}
	}
}

function wildDrawCave(cave, minX, maxX, minRow, maxRow) {
	const cell = cave.state.cell;
	const rows = cave.state.rows;
	const cols = cave.state.chunkColumns;
	const minCol = cave.columnAt(minX);
	const maxCol = cave.columnAt(maxX);
	const firstChunk = Math.floor(minCol / cols);
	const lastChunk = Math.floor(maxCol / cols);
	if (!wildCanUseTiles) {
		for (let idx = firstChunk; idx <= lastChunk; idx++) {
			const chunk = cave.chunkFor(idx * cols);
			wildDrawFallbackChunk(cave, chunk, minCol, maxCol, minRow, maxRow);
		}
		return;
	}
	wildSyncPriceRange();
	const prevSmooth = context.imageSmoothingEnabled;
	context.imageSmoothingEnabled = false;
	context.save();
	context.scale(1, -1);
	for (let idx = firstChunk; idx <= lastChunk; idx++) {
		const chunk = cave.chunkFor(idx * cols);
		const tile = wildAcquireTile(chunk, rows, cols);
		wildSyncTileRows(cave, chunk, tile, minRow, maxRow);
		const localStart = Math.max(0, minCol - chunk.column0);
		const localEnd = Math.min(cols - 1, maxCol - chunk.column0);
		if (localEnd < localStart) continue;
		const spanCols = localEnd - localStart + 1;
		const worldX0 = (chunk.column0 + localStart) * cell;
		const worldW = spanCols * cell;
		for (let r = minRow; r <= maxRow; r++) {
			const dBottom = wildDrawnRowY[r];
			const dTop = wildDrawnRowY[r + 1];
			if (!(dTop > dBottom)) continue;
			context.drawImage(tile.canvas, localStart, rows - 1 - r, spanCols, 1, worldX0, -dTop, worldW, dTop - dBottom + 0.002);
		}
	}
	context.restore();
	context.imageSmoothingEnabled = prevSmooth;
}

function wildResize() {
	const wild = window.SteamWildMine;
	const bounds = canvas.getBoundingClientRect();
	width = bounds.width;
	height = bounds.height;
	const ratio = window.devicePixelRatio || 1;
	canvas.width = Math.round(width * ratio);
	canvas.height = Math.round(height * ratio);
	context.setTransform(ratio, 0, 0, ratio, 0, 0);
	const sceneHeight = wild.viewHeight + boundaryStrip * 2;
	scale = Math.min((width - 32) / wild.viewWidth, (height - chamberRoofPad - padLabelDrop) / sceneHeight);
	view.scale = scale;
	sceneDirty = true;
}

function wildDrawGrid(wild, minX, maxX, minWorldY, maxWorldY) {
	context.strokeStyle = '#1b272c';
	context.lineWidth = 1 / scale;
	context.beginPath();
	const xStart = Math.floor(minX / 4) * 4;
	const dMin = wild.drawnY(minWorldY);
	const dMax = wild.drawnY(maxWorldY);
	for (let gx = xStart; gx <= maxX; gx += 4) {
		context.moveTo(gx, dMin);
		context.lineTo(gx, dMax);
	}
	const yStart = Math.max(0, Math.floor(minWorldY / 4) * 4);
	for (let gy = yStart; gy <= maxWorldY; gy += 4) {
		const dy = wild.drawnY(gy);
		context.moveTo(minX, dy);
		context.lineTo(maxX, dy);
	}
	context.stroke();
}

function wildDraw() {
	const wild = window.SteamWildMine;
	const cave = wild.cave;
	context.clearRect(0, 0, width, height);
	if (!cave) return;
	const cam = wild.camera;
	const anchorY = cam.anchorY;
	const drawnCamY = wild.drawnY(cam.y, anchorY);
	offsetX = width * 0.5 - cam.x * scale;
	floorY = height * 0.5 + drawnCamY * scale;
	view.scale = scale;
	view.offsetX = offsetX;
	view.floorY = floorY;

	const halfW = (width * 0.5) / scale + 0.5;
	const halfH = (height * 0.5) / scale + 0.5;
	const minX = cam.x - halfW;
	const maxX = cam.x + halfW;
	const minWorldY = Math.max(0, wild.worldY(drawnCamY - halfH, anchorY));
	const maxWorldY = Math.min(cave.state.mapTop, wild.worldY(drawnCamY + halfH, anchorY));
	const rows = cave.state.rows;
	const cell = cave.state.cell;
	if (wildDrawnRowY.length !== rows + 1) wildDrawnRowY = new Float64Array(rows + 1);
	const minRow = Math.max(0, Math.floor(minWorldY / cell));
	const maxRow = Math.min(rows - 1, Math.ceil(maxWorldY / cell));
	for (let r = minRow; r <= maxRow + 1; r++) wildDrawnRowY[r] = wild.drawnY(r * cell, anchorY);

	context.save();
	context.translate(offsetX, floorY);
	context.scale(scale, -scale);
	context.lineWidth = 1 / scale;

	wildDrawGrid(wild, minX, maxX, minRow * cell, (maxRow + 1) * cell);
	wildDrawCave(cave, minX, maxX, minRow, maxRow);
	wildDrawDebris(wild, anchorY, minRow * cell, (maxRow + 1) * cell);

	if (wildSelectedRow >= minRow && wildSelectedRow <= maxRow && wildSelectedColumn >= cave.columnAt(minX) - 1 && wildSelectedColumn <= cave.columnAt(maxX) + 1) {
		const y0 = wildDrawnRowY[wildSelectedRow];
		const y1 = wildDrawnRowY[wildSelectedRow + 1];
		if (y1 > y0) {
			context.strokeStyle = '#edf6f1';
			context.lineWidth = 1.5 / scale;
			context.strokeRect(wildSelectedColumn * cell, y0, cell, y1 - y0);
			context.lineWidth = 1 / scale;
		}
	}

	const activeTarget = playerApi.activeTarget();
	if (Number.isFinite(activeTarget)) {
		const floor = wild.groundAt(activeTarget, world.platform.y + 1);
		const d0 = wild.drawnY(floor, anchorY);
		const d1 = wild.drawnY(floor + 1.7, anchorY);
		context.strokeStyle = '#627765';
		context.beginPath();
		context.moveTo(activeTarget, d0);
		context.lineTo(activeTarget, d1);
		context.stroke();
	}

	const py = world.platform.y;
	const dpy = wild.drawnY(py, anchorY);
	const pScale = wild.scaleAt(py, anchorY);
	context.save();
	context.translate(0, dpy - py * pScale);
	context.scale(1, pScale);
	playerApi.draw(context, drawRigMachinery);
	context.restore();

	const balls = world.balls || [];
	for (let i = 0; i < balls.length; i++) {
		const ball = balls[i];
		const owner = ball.owner ? playerById(ball.owner) : null;
		const ballY = wild.drawnY(ball.y, anchorY);
		const ballScale = wild.scaleAt(ball.y, anchorY);
		const radius = config.radius * ballScale;
		context.fillStyle = owner ? owner.colour : (ball.state === 'grounded' ? '#e6b66e' : '#edf6f1');
		context.beginPath();
		context.arc(ball.x, ballY, radius, 0, Math.PI * 2);
		context.fill();
		context.strokeStyle = owner ? '#6f5a44' : '#a9c7bc';
		context.beginPath();
		context.arc(ball.x, ballY, radius + 0.13 * ballScale, 0, Math.PI * 2);
		context.stroke();
		if (ball.state !== 'held') {
			// The spin marker is the roll the contact solver really holds, so a
			// silent slip or a stuck ball shows at once.
			context.strokeStyle = '#0b1316';
			context.beginPath();
			context.moveTo(ball.x, ballY);
			context.lineTo(ball.x + Math.cos(ball.spin || 0) * radius, ballY - Math.sin(ball.spin || 0) * radius);
			context.stroke();
		}
		const battery = window.SteamWildBall ? ball.battery || 0 : 0;
		const charge = window.SteamWildBall ? battery / window.SteamWildBall.batteryCapacity : 1;
		if (charge < 0.999) {
			context.strokeStyle = charge < 0.2 ? '#e0775e' : '#e6b66e';
			context.beginPath();
			context.arc(ball.x, ballY, radius + 0.26 * ballScale, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * Math.max(0, charge));
			context.stroke();
		}
		if (showDamageRadius) {
			const rock = window.SteamCeiling.state;
			const dr = window.SteamCeiling.damageRadiusNow(ball.owner || 'rig') * rock.cell;
			context.strokeStyle = '#e6b66e';
			context.lineWidth = 1.2 / scale;
			context.setLineDash([0.14, 0.11]);
			context.beginPath();
			context.ellipse(ball.x, ballY, dr, dr * ballScale, 0, 0, Math.PI * 2);
			context.stroke();
			context.setLineDash([]);
			context.lineWidth = 1 / scale;
		}
	}
	context.restore();

	const ballState = window.SteamWildBall ? window.SteamWildBall.readouts(world) : null;
	const ballNote = ballState
		? ' · P2 ' + ballState.battery.toFixed(0) + ' J · ' + ballState.speed.toFixed(1) + ' m/s · '
			+ (ballState.contact === window.SteamWildBall.CONTACT_DECK ? 'DECK' : ballState.contact === window.SteamWildBall.CONTACT_ROCK ? 'ROLL' : 'AIR')
		: '';
	const hudText = 'WILD MINE · X ' + world.platform.x.toFixed(1) + ' m · Y ' + world.platform.y.toFixed(1) + ' m' + ballNote + ' · SCALE 1.00× @ P2';
	context.font = '600 10px ui-monospace, monospace';
	const textW = typeof context.measureText === 'function' ? context.measureText(hudText).width : hudText.length * 6;
	context.fillStyle = 'rgba(11, 18, 22, 0.82)';
	context.fillRect(8, 6, textW + 14, 18);
	context.fillStyle = '#b9c9cd';
	context.textAlign = 'left';
	context.fillText(hudText, 15, 18);
}

function wildSyncMode(nextMode) {
	if (!window.SteamWildMine) return;
	window.SteamWildMine.setMode(nextMode);
	const wild = window.SteamWildMine.isWild();
	if (ui['chamber-title']) {
		setText(ui['chamber-title'], wild ? 'ARC STEAM · WILD MINE / CAVE SECTION' : 'ARC STEAM · TEST CHAMBER / 24 × 15 M');
	}
	setHidden(ui['ball-controls'], !wild);
	const limitDeg = wildPistonLimitDegrees();
	if (ui['piston-angle']) {
		ui['piston-angle'].min = String(-limitDeg);
		ui['piston-angle'].max = String(limitDeg);
		ui['piston-angle'].setAttribute('min', String(-limitDeg));
		ui['piston-angle'].setAttribute('max', String(limitDeg));
	}
	wildTiles.clear();
}

function wildResetRun(targetWorld) {
	wildTiles.clear();
	window.SteamWildMine.init(targetWorld, { seed: 1 });
	const cave = window.SteamWildMine.cave;
	wildSelectedColumn = cave.columnAt(cave.state.spawnX);
	wildSelectedRow = Math.max(0, cave.state.shelfRow - 1);
	wildResize();
}

function wildWorldYOf(event) {
	const drawnY = (floorY - (event.clientY - canvas.getBoundingClientRect().top)) / scale;
	return window.SteamWildMine.worldY(drawnY);
}

function wildInspectRockAtPointer(event) {
	const cave = window.SteamWildMine.cave;
	if (!cave) return;
	const bounds = canvas.getBoundingClientRect();
	const worldX = (event.clientX - bounds.left - offsetX) / scale;
	const worldY = wildWorldYOf(event);
	const solid = cave.solidAt(worldX, worldY);
	setHidden(ui['mineral-tooltip'], !solid);
	if (!solid) return;
	const col = cave.columnAt(worldX);
	const row = cave.rowAt(worldY);
	if (col !== wildSelectedColumn || row !== wildSelectedRow) sceneDirty = true;
	wildSelectedColumn = col;
	wildSelectedRow = row;
	const tip = ui['mineral-tooltip'];
	const x = event.clientX - bounds.left + 14;
	const y = event.clientY - bounds.top + 14;
	const tipWidth = tip.offsetWidth || 260;
	const tipHeight = tip.offsetHeight || 150;
	tip.style.left = Math.max(8, Math.min(bounds.width - tipWidth - 8, x)) + 'px';
	tip.style.top = Math.max(8, Math.min(bounds.height - tipHeight - 8, y)) + 'px';
	wildMineralReadout();
}

function wildPointerDown(event) {
	const cave = window.SteamWildMine.cave;
	if (!cave) return;
	const bounds = canvas.getBoundingClientRect();
	const worldX = (event.clientX - bounds.left - offsetX) / scale;
	const worldY = wildWorldYOf(event);
	if (cave.solidAt(worldX, worldY)) {
		wildInspectRockAtPointer(event);
		canvas.focus();
		return;
	}
	const floor = window.SteamWildMine.groundAt(worldX, worldY);
	if (Number.isFinite(floor) && worldY >= floor && worldY - floor <= moveClickHeight) {
		world.direction = 0;
		world.target = worldX;
		sceneDirty = true;
	} else {
		pistonDragActive = true;
		pistonDragX = event.clientX;
		pistonDragY = event.clientY;
		pistonDragAngle = pistonDegrees();
		if (typeof canvas.setPointerCapture === 'function' && event.pointerId !== undefined) canvas.setPointerCapture(event.pointerId);
	}
	canvas.focus();
}

function wildMineralReadout() {
	const cave = window.SteamWildMine.cave;
	if (!cave) return;
	const ceiling = window.SteamCeiling.state;
	const materials = window.SteamRockMaterials;
	const info = window.SteamWildMine.inspectCell(wildSelectedColumn, wildSelectedRow, materials, ceiling.mineralPrices);
	setText(ui['mineral-cell'], 'Cave col ' + wildSelectedColumn + ' · row ' + wildSelectedRow);
	const tag = !info.solid ? ' · open' : info.damage > 0 ? ' · damaged' : ' · intact';
	setText(ui['mineral-strength'], info.strength.toFixed(2) + ' / ' + info.initialStrength.toFixed(2) + ' J' + tag);
	const ratio = info.initialStrength > 0 ? info.strength / info.initialStrength : 0;
	if (Number(ui['strength-meter'].value) !== ratio) ui['strength-meter'].value = ratio;
	let composition = '';
	for (let m = 0; m < ceiling.mineralNames.length; m++) {
		composition += (m ? ' · ' : '') + ceiling.mineralSymbols[m] + ' ' + (info.mix[m] * 100).toFixed(1) + '%';
	}
	setText(ui['mineral-composition'], composition);
	setText(ui['mineral-price'], 'Value ' + info.value.toFixed(2) + ' cr/cell · R ' + (info.elements[0] * 100).toFixed(0) + '% G ' + (info.elements[1] * 100).toFixed(0) + '% B ' + (info.elements[2] * 100).toFixed(0) + '%');
}

function wildModeNotes(reserveWarning) {
	if (reserveWarning === 'EMPTY') setText(ui['reserve-note'], 'Empty · hand-crank crawl · cart dock arrives in M5');
	else if (reserveWarning) setText(ui['reserve-note'], 'Low reserve · Wild Mine mode');
	else setText(ui['reserve-note'], 'Wild Mine · deck induction only · P1 platform / P2 ball');
	setText(ui['cargo-note'], 'Wild Mine · cart economy activates in M5');
	setText(ui['funds-note'], 'Wild Mine · open cave section');
}

function wildStatusReadout(reserveWarning, thermalFactor, driveOn) {
	const ceiling = window.SteamCeiling.state;
	const temperature = physics.temperature(world);
	setText(ui['fact-reserve'], (world.battery / 1000).toFixed(2) + ' kJ');
	setTone(ui['fact-reserve'], reserveWarning === 'EMPTY' ? 'danger' : reserveWarning ? 'warn' : '');
	setText(ui['fact-cargo'], cellCount(ceiling.cargoCells) + '/' + ceiling.storageLimit);
	setTone(ui['fact-cargo'], '');
	setText(ui['fact-temp'], temperature.toFixed(0) + ' °C');
	setTone(ui['fact-temp'], thermalFactor === 0 ? 'danger' : thermalFactor < 1 ? 'warn' : '');
	const ball = window.SteamWildBall ? window.SteamWildBall.readouts(world) : null;
	if (!ball) {
		setMessage(ui['status-ball'], 'Wild Mine · no ball in the section', 'warn');
	} else {
		const energy = ball.battery.toFixed(0) + ' J';
		if (world.ball && world.ball.state === 'held') {
			setMessage(ui['status-ball'], !driveOn ? 'Wild Mine · P2 held · drive off · E is disabled'
				: 'Wild Mine · P2 held · ' + energy + ' · E releases · deck induction charges', ball.battery < 30 ? 'warn' : 'info');
		} else if (ball.contact === window.SteamWildBall.CONTACT_ROCK) {
			setMessage(ui['status-ball'], 'Wild Mine · P2 rolling · ' + ball.speed.toFixed(1) + ' m/s · ' + energy + ' · ← → motor · ↑ jump', ball.battery < 30 ? 'warn' : 'info');
		} else if (ball.contact === window.SteamWildBall.CONTACT_DECK) {
			setMessage(ui['status-ball'], 'Wild Mine · P2 on the deck · ' + energy + ' · induction charging', 'info');
		} else {
			setMessage(ui['status-ball'], 'Wild Mine · P2 in the air · ' + ball.speed.toFixed(1) + ' m/s · ' + energy, ball.battery < 30 ? 'warn' : 'info');
		}
	}
	setMessage(ui['status-energy'], reserveWarning ? 'Low reserve · hand-crank crawl available' : '', 'danger');
}
