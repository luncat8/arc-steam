// Canvas geometry and rendering. Drawing reads game state; input owns state changes.
// provides: resize, draw, view, playerById, rockWarpY
// depends: main.js bindings, view/readout state, playerApi

'use strict';

// Platform indicator ramps: index by a 0..1 ratio without allocating a new
// string on every frame. Fuel runs green (full) to red (empty); the
// thermometer runs blue (cold) through green and amber to red (cutoff).
const fuelRamp = ['#b9ed91', '#b9ed91', '#e6b66e', '#e6b66e', '#e0775e', '#e0775e'];
const tempRamp = ['#7fb6d9', '#7fb6d9', '#b9ed91', '#e6b66e', '#e0775e', '#e0775e'];
function rampColor(ramp, ratio) {
	const steps = ramp.length - 1;
	const pos = Math.max(0, Math.min(steps, ratio * steps));
	return ramp[Math.floor(pos)];
}
// World height to drawn height through the rock layer's vertical perspective;
// outside the layer the mapping is the identity.
function rockWarpY(y) {
	const rock = window.SteamCeiling.state;
	if (y < rock.bottom || y > rock.top) return y;
	return rock.rockDrawnY(y);
}
let width = 0;
let height = 0;
let scale = 1;
let offsetX = 0;
let floorY = 0;
const viewGroup = 'rock-view';
let viewMode = 'minerals';
// Hover switching is for precise hovering pointers only; touch and stylus stay click-only.
const hoverPointer = window.matchMedia('(hover: hover) and (pointer: fine)');
const viewMinX = -1.5;
const viewWidth = 25.8 + window.SteamCeiling.state.garageDepth;
// The chamber fills the canvas. Both 0.35 m boundary strips belong to the
// scene, so the fit is the roof strip, the chamber and the floor strip; the
// only room outside it is 2 px above the roof strip and the line the
// charge-pad label is drawn on under the floor.
const chamberRoofPad = 2;
const boundaryStrip = 0.35;
const padLabelDrop = 14;
// A canvas taller than that scene keeps the chamber near its top: at most a
// quarter of the leftover room, and never more than 18 px, may open above the
// roof strip, so the rest stays under the floor, where it is only backdrop.
const chamberTopShare = 0.25;
const chamberTopMax = 18;
// The fit itself, published so a harness can map a world point to a page
// point instead of copying the arithmetic.
const view = { scale: 1, offsetX: 0, floorY: 0 };
// Clicks below this height are travel commands; rock clicks inspect instead.
// The target marker is drawn to the same height, so the zones are visible.
const padLabel = 'CHARGE PAD · 3 kW';
const padLabelActive = 'CHARGING';
function resize() {
	const bounds = canvas.getBoundingClientRect();
	width = bounds.width;
	height = bounds.height;
	const ratio = window.devicePixelRatio || 1;
	canvas.width = Math.round(width * ratio);
	canvas.height = Math.round(height * ratio);
	context.setTransform(ratio, 0, 0, ratio, 0, 0);
	const sceneHeight = config.ceiling + boundaryStrip * 2;
	scale = Math.min((width - 32) / viewWidth, (height - chamberRoofPad - padLabelDrop) / sceneHeight);
	const slack = height - chamberRoofPad - padLabelDrop - sceneHeight * scale;
	const topPad = chamberRoofPad + (slack > 0 ? Math.min(slack * chamberTopShare, chamberTopMax) : 0);
	offsetX = (width - viewWidth * scale) / 2 - viewMinX * scale;
	floorY = topPad + boundaryStrip * scale + config.ceiling * scale;
	view.scale = scale;
	view.offsetX = offsetX;
	view.floorY = floorY;
	sceneDirty = true;
}

// A platform's own machinery — fuel and heat bars, collector strip, reflector
// piston — drawn inside the shared body so it moves, pitches and gets covered
// exactly like the chassis it sits on. Every instrument reads its own
// platform's machine (machineOf), never another platform's state.
function drawRigMachinery(context, player) {
	const machine = playerApi.machineOf(player);
	const isRig = player.kind === 'rig';
	const left = -config.platformWidth * 0.5;
	const collectorWidth = config.platformWidth * config.collectorFraction;
	// Fuel and temperature ride on the chassis as horizontal and vertical
	// bars, so the platform's state reads at a glance without the telemetry.
	// A competitor carries its own reserve and heat, not the rig's.
	const fuelRatio = isRig ? Math.max(0, Math.min(1, world.battery / config.battery)) : 1;
	const tempRatio = isRig ? Math.max(0, Math.min(1, (physics.temperature(world) - config.ambientTemperature) / (config.thermalCutoff - config.ambientTemperature))) : 0;
	const fuelX = left + 0.12;
	const fuelW = config.platformWidth - 0.60;
	const fuelY = 0.46;
	const fuelH = 0.045;
	context.fillStyle = '#0f1618';
	context.fillRect(fuelX, fuelY, fuelW, fuelH);
	context.fillStyle = rampColor(fuelRamp, fuelRatio);
	context.fillRect(fuelX, fuelY, fuelW * fuelRatio, fuelH);
	context.strokeStyle = '#3a4a50';
	context.lineWidth = 0.012;
	context.strokeRect(fuelX, fuelY, fuelW, fuelH);
	// Thermometer on the right end: bulb at the base, stem rising with heat.
	const tempX = left + config.platformWidth - 0.28;
	const tempW = 0.12;
	const tempTop = 0.34;
	const tempBot = 0.58;
	const bulbY = tempTop - 0.047;
	const bulbR = 0.085;
	context.fillStyle = '#0f1618';
	context.fillRect(tempX, tempTop, tempW, tempBot - tempTop);
	context.beginPath();
	context.arc(tempX + tempW * 0.5, bulbY, bulbR, 0, Math.PI * 2);
	context.fill();
	const fillTop = tempBot - tempRatio * (tempBot - tempTop);
	context.fillStyle = rampColor(tempRamp, tempRatio);
	context.fillRect(tempX, fillTop, tempW, tempBot - fillTop);
	context.beginPath();
	context.arc(tempX + tempW * 0.5, bulbY, bulbR * 0.82, 0, Math.PI * 2);
	context.fill();
	context.strokeStyle = '#3a4a50';
	context.lineWidth = 0.012;
	context.strokeRect(tempX, tempTop, tempW, tempBot - tempTop);
	context.fillStyle = '#e6b66e';
	context.fillRect(left, 0.55, collectorWidth, 0.15);
	// The chassis pitch follows the land; piston tilt stays relative to it.
	const pistonAngle = machine.pistonAngle;
	const pistonNx = -Math.sin(pistonAngle);
	const pistonNy = Math.cos(pistonAngle);
	const pistonTx = pistonNy;
	const pistonTy = -pistonNx;
	const pistonOffset = Number.isFinite(machine.pistonOffset) ? machine.pistonOffset : 0;
	const pistonCentreX = config.pistonCentre - pistonNx * pistonOffset;
	const pistonCentreY = config.deck - pistonNy * pistonOffset;
	context.strokeStyle = '#718d75';
	context.lineWidth = 0.06;
	context.beginPath();
	context.moveTo(pistonCentreX - pistonNx * 0.15, pistonCentreY - pistonNy * 0.15);
	context.lineTo(config.pistonCentre, 0.22);
	context.stroke();
	context.lineWidth = 1 / scale;
	context.fillStyle = machine.drive ? '#b9ed91' : '#718d75';
	context.beginPath();
	context.moveTo(pistonCentreX - pistonTx * config.pistonHalf, pistonCentreY - pistonTy * config.pistonHalf);
	context.lineTo(pistonCentreX + pistonTx * config.pistonHalf, pistonCentreY + pistonTy * config.pistonHalf);
	context.lineTo(pistonCentreX + pistonTx * config.pistonHalf - pistonNx * 0.15, pistonCentreY + pistonTy * config.pistonHalf - pistonNy * 0.15);
	context.lineTo(pistonCentreX - pistonTx * config.pistonHalf - pistonNx * 0.15, pistonCentreY - pistonTy * config.pistonHalf - pistonNy * 0.15);
	context.closePath();
	context.fill();
	context.lineWidth = 1 / scale;
}

function draw() {
	context.clearRect(0, 0, width, height);
	context.save();
	context.translate(offsetX, floorY);
	context.scale(scale, -scale);
	context.lineWidth = 1 / scale;
	const pocketDepth = config.pocketDepth;
	const pocketTop = config.deck;
	context.strokeStyle = '#1e2c32';
	context.beginPath();
	for (let x = 0; x <= config.width; x += 2) { context.moveTo(x, 0); context.lineTo(x, config.ceiling); }
	for (let y = 0; y <= config.ceiling; y += 2) { context.moveTo(0, y); context.lineTo(config.width, y); }
	context.stroke();
	context.fillStyle = '#29383d';
	context.fillRect(-pocketDepth, -0.35, config.width + pocketDepth, 0.35);
	// Fallen rubble first, so the charge pad plate stays visible on top of it.
	if (window.SteamCeiling) window.SteamCeiling.drawFloor(context);
	const padMin = physics.chargePadMin();
	const padMax = physics.chargePadMax();
	const chargingNow = physics.charging(world);
	context.fillStyle = chargingNow ? '#2a4a3b' : '#1b3038';
	context.fillRect(padMin, -0.35, padMax - padMin, 0.35);
	context.fillStyle = chargingNow ? '#b9ed91' : '#7fb6d9';
	for (let x = padMin + 0.25; x < padMax; x += 0.5) context.fillRect(x, -0.35, 0.08, 0.35);
	context.fillRect(-pocketDepth - 0.3, 0, 0.3, pocketTop);
	context.fillRect(-0.3, pocketTop, 0.3, config.ceiling - pocketTop);
	context.fillRect(0, config.ceiling, config.width, 0.35);
	// A recessed, low roof and back wall make the right-side bay read as a
	// garage. The parked bot is drawn inside it, while the same vehicle remains
	// visible throughout dispatch, work, dismissal and the return home.
	const garageHeight = window.SteamCeiling.state.garageHeight;
	const garageDepth = window.SteamCeiling.state.garageDepth;
	context.fillStyle = '#29383d';
	context.fillRect(config.width, garageHeight, 0.3, config.ceiling - garageHeight);
	context.fillStyle = '#0a0f11';
	context.fillRect(config.width, 0, garageDepth, garageHeight);
	context.fillStyle = '#29383d';
	context.fillRect(config.width, -0.08, garageDepth, 0.08);
	context.fillRect(config.width, garageHeight, garageDepth, 0.08);
	context.fillRect(config.width + garageDepth - 0.12, 0, 0.12, garageHeight + 0.08);
	window.SteamCeiling.drawGraderBot(context);
	context.fillStyle = '#29383d';
	context.fillRect(-pocketDepth, 0, pocketDepth, pocketTop);
	if (window.SteamCeiling) window.SteamCeiling.draw(context, viewMode);
	if (window.SteamCeiling) {
		const ceiling = window.SteamCeiling.state;
		const cellY0 = ceiling.rockDrawnY(ceiling.bottom + selectedLayer * ceiling.cell);
		const cellY1 = ceiling.rockDrawnY(ceiling.bottom + (selectedLayer + 1) * ceiling.cell);
		context.strokeStyle = '#edf6f1';
		context.lineWidth = 1.5 / scale;
		context.strokeRect(selectedColumn * ceiling.cell, cellY0, ceiling.cell, cellY1 - cellY0);
		context.lineWidth = 1 / scale;
	}
	context.strokeStyle = '#657578';
	context.beginPath(); context.moveTo(-pocketDepth, 0); context.lineTo(config.width, 0); context.stroke();
	const activeTarget = playerApi.activeTarget();
	if (Number.isFinite(activeTarget)) {
		const targetGround = window.SteamCeiling.floorAt(activeTarget);
		context.strokeStyle = '#627765';
		context.beginPath(); context.moveTo(activeTarget, targetGround); context.lineTo(activeTarget, targetGround + 1.7); context.stroke();
	}
	if (showPrediction) drawPrediction();
	// One body pass draws every platform, the riding one last. The rig's
	// machinery rides inside its body so a competitor on top covers it.
	playerApi.draw(context, drawRigMachinery);
	// Every ball is drawn where it flies. The rock layer is drawn through a
	// vertical perspective, so a ball inside the layer is warped with it;
	// otherwise it stays on the linear world axis. A ball owned by a
	// competitor carries that player's colour, so ownership needs no label.
	const rock = window.SteamCeiling.state;
	const balls = world.balls || [];
	for (let i = 0; i < balls.length; i++) {
		const ball = balls[i];
		const owner = ball.owner ? playerById(ball.owner) : null;
		const inRock = ball.y >= rock.bottom && ball.y <= rock.top;
		const ballY = inRock ? rock.rockDrawnY(ball.y) : ball.y;
		const ballScale = inRock ? rock.rockScale(ball.y) : 1;
		context.fillStyle = owner ? owner.colour : (ball.state === 'grounded' ? '#e6b66e' : '#edf6f1');
		context.beginPath(); context.ellipse(ball.x, ballY, config.radius, config.radius * ballScale, 0, 0, Math.PI * 2); context.fill();
		context.strokeStyle = owner ? '#6f5a44' : '#a9c7bc';
		context.beginPath(); context.ellipse(ball.x, ballY, config.radius + 0.13, (config.radius + 0.13) * ballScale, 0, 0, Math.PI * 2); context.stroke();
	}
	context.restore();
	drawSellLabel(offsetX + 8, floorY - scale * 1.4, -Math.PI * 0.5);
	drawSellLabel(offsetX + config.width * scale - 8, floorY - scale * 1.4, Math.PI * 0.5);
	drawPadLabel(offsetX + config.width * 0.5 * scale, floorY + 0.35 * scale + 12, chargingNow);
}

// Ballistic overlay, drawn in world units inside the chamber transform: one
// dotted flight per ball the selected machine may push. The focus flight
// carries the landing mark and the platform ghost coasting to the predicted
// landing time; companion flights are dimmer and mark only their own end.
// Amber means the intercept is not reachable or the outcome is unknown.
function drawFlight(trace, primary) {
	if (trace.samples < 2) return;
	context.strokeStyle = primary ? (trace.uncertain ? '#9c8a55' : '#5f9c74') : '#4a6f60';
	context.lineWidth = (primary ? 1.2 : 0.9) / scale;
	context.setLineDash(primary ? [0.1, 0.13] : [0.06, 0.16]);
	context.beginPath();
	context.moveTo(trace.pathX[0], rockWarpY(trace.pathY[0]));
	for (let i = 1; i < trace.samples; i++) context.lineTo(trace.pathX[i], rockWarpY(trace.pathY[i]));
	context.stroke();
	context.setLineDash([]);
	if (!primary) {
		const last = trace.samples - 1;
		context.beginPath(); context.arc(trace.pathX[last], rockWarpY(trace.pathY[last]), 0.16, 0, Math.PI * 2); context.stroke();
		return;
	}
	context.beginPath(); context.arc(trace.endX, rockWarpY(trace.endY), 0.26, 0, Math.PI * 2); context.stroke();
	context.strokeStyle = trace.reachable ? '#b9ed91' : '#e6b66e';
	context.save();
	context.translate(trace.ghostX, trace.ghostY);
	context.rotate(trace.ghostAngle);
	context.strokeRect(-config.platformWidth * 0.5, config.deck - 0.06, config.platformWidth, 0.12);
	context.restore();
}

function drawPrediction() {
	const computer = window.SteamPrediction;
	const paths = computer.paths;
	const count = computer.pathCount;
	if (!count) return;
	context.save();
	for (let i = 1; i < count; i++) drawFlight(paths[i], false);
	drawFlight(paths[0], true);
	context.restore();
}

function drawSellLabel(x, y, rotation) {
	context.save();
	context.translate(x, y);
	context.rotate(rotation);
	context.fillStyle = '#e6b66e';
	context.font = '700 9px ui-monospace, monospace';
	context.textAlign = 'center';
	context.fillText('SELL', 0, 0);
	context.restore();
}

function drawPadLabel(x, y, active) {
	context.fillStyle = active ? '#b9ed91' : '#7fb6d9';
	context.font = '700 9px ui-monospace, monospace';
	context.textAlign = 'center';
	context.fillText(active ? padLabelActive : padLabel, x, y);
}

// One ledger carries sales, purchases and research; each entry keeps its own
// wording so the money trail stays explicit.
// The platform a ball belongs to, for its colour. A plain loop keeps the
// draw pass free of a per-ball closure.
function playerById(id) {
	const list = playerApi.state.players;
	for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
	return null;
}
