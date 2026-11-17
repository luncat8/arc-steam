// Controls, event handlers, simulation state and frame scheduling.
// provides: bindInput, refresh, syncPistonControl, setPistonAngle, keydown, keyup, frame, endPistonDrag
// depends: main.js bindings, draw geometry, readout/progression/player/help entry points

'use strict';

let selectedColumn = 95;
let selectedLayer = 0;
let selectedGeoLayer = 0;
function currentSelectedLayer(ceiling) {
	return Math.max(0, Math.min(ceiling.rows - 1, selectedGeoLayer - ceiling.baseRow));
}
let paused = false;
let accumulator = 0;
let previous = 0;
let lastReadout = -1;
let readoutPlayer = -1;
let leftHeld = false;
let rightHeld = false;
// P2's motor is a hold of its own: the arrow keys and the ball row address the
// ball, so they are tracked separately from P1's drive keys.
let ballLeftHeld = false;
let ballRightHeld = false;
// The sandblaster is a hold: the key or the Blast button keeps the nozzle
// throwing while it is down, and the module's own rate limits the stream.
let blastHeld = false;
// The water gun is the same hold, and its jet aims where the pointer last was:
// aim is not a travel order, so aiming never moves the platform.
let sprayHeld = false;
// An air drag tilts the piston from the angle it had when the drag began.
let pistonDragActive = false;
let pistonDragX = 0;
let pistonDragY = 0;
let pistonDragAngle = 0;
// The canvas is redrawn after simulation steps or when something it shows
// changed while time stands still (pause, resize, selection, view mode).
let sceneDirty = true;
const moveClickHeight = 1.7;
// Event-driven readouts also mark the scene, so a paused chamber reflects the change.
function refresh() { readoutPlayer = playerApi.state.active; syncPistonControl(); readout(); sceneDirty = true; }

// Single writer for the piston angle: slider, chamber wheel and air drag
// all set the selected platform's angle through here, and the controls only
// move when the angle actually changed.
function syncPistonControl() {
	const degrees = pistonDegrees();
	setText(ui['piston-value'], degrees.toFixed(1) + '°');
	const snapped = Math.round(degrees * 2) / 2;
	if (Number(ui['piston-angle'].value) !== snapped) ui['piston-angle'].value = snapped;
}
// Manual tilt is the one writer the tilt keeper yields to, so taking the slider,
// the wheel or a drag temporarily pauses that duty, not its enabled switch.
// The tilt keeper is the rig's own duty, so the override only applies there.
function setPistonAngle(degrees) {
	if (!Number.isFinite(degrees)) return;
	const player = activePlayer();
	if (playerApi.rigActive()) autopilotApi.override('angle');
	else playerApi.overrideMachine(player, 'angle');
	const before = playerApi.pistonAngleOf(player);
	const limit = typeof wildPistonLimitDegrees === 'function' ? wildPistonLimitDegrees() : 10;
	playerApi.setPistonAngleOf(player, Math.max(-limit, Math.min(limit, degrees)) * Math.PI / 180);
	if (playerApi.pistonAngleOf(player) !== before) sceneDirty = true;
	syncPistonControl();
}

// Autopilot switches. Checkboxes and shortcuts share one table and one writer,
// and each duty yields to the manual command that does the same thing.
const autopilotRows = [
	{ id: 'auto-move', channel: 'move' },
	{ id: 'auto-smart', channel: 'smart' },
	{ id: 'auto-drive', channel: 'drive' },
	{ id: 'auto-angle', channel: 'angle' }
];

function syncAutopilot() {
	for (const row of autopilotRows) setChecked(ui[row.id], autopilotApi.enabled(row.channel));
}

function setChannel(channel, on) {
	autopilotApi.set(channel, on);
	syncAutopilot();
	refresh();
}

function toggleChannel(channel) { setChannel(channel, !autopilotApi.enabled(channel)); }

function channelForKey(code, shift) {
	if (code === 'KeyX') return shift ? 'smart' : 'move';
	if (code === 'KeyZ') return 'drive';
	if (code === 'KeyC') return 'angle';
	return '';
}

function autopilotChanged(event) {
	const input = event.target;
	for (const row of autopilotRows) {
		if (ui[row.id] !== input) continue;
		setChannel(row.channel, input.checked);
		return;
	}
}

// Single writer of the rock view mode; click, keyboard and hover all go through it.
function setViewMode(mode) {
	if (mode === viewMode) return;
	viewMode = mode;
	sceneDirty = true;
}

function viewModeChanged(event) {
	const input = event.target;
	if (input.name === viewGroup) setViewMode(input.value);
}

// Runs on every pointer move across the menu, so it walks parents without allocating.
function viewModeHovered(event) {
	if (!hoverPointer.matches) return;
	let node = event.target;
	while (node && node !== ui['view-modes'] && node.tagName !== 'LABEL') node = node.parentElement;
	if (!node || node === ui['view-modes']) return;
	const input = node.control;
	if (!input || input.name !== viewGroup) return;
	input.checked = true;
	setViewMode(input.value);
}

// Click zones: visible rock selects an inspector cell; the low band near the
// ground commands travel. Open air between them does neither, so inspecting
// rock never moves the platform by accident.
function rockCellIndex(worldX, worldY) {
	const ceiling = window.SteamCeiling.state;
	if (worldX < 0 || worldX > config.width || worldY < ceiling.rockDrawnY(ceiling.bottom) || worldY > ceiling.top) return -1;
	// The layer is drawn through a vertical perspective, so the pointer's
	// screen height maps back to the cell's world height before the lookup.
	const cellY = ceiling.rockWorldY(worldY);
	const column = Math.min(ceiling.columns - 1, Math.floor(worldX / ceiling.cell));
	const row = Math.min(ceiling.rows - 1, Math.max(0, Math.floor((cellY - ceiling.bottom) / ceiling.cell)));
	const index = row * ceiling.columns + column;
	if (ceiling.shape === 'square') return ceiling.strength[index] > 0 ? index : -1;
	// The smooth surface is drawn as a linear profile between column vertices.
	const fraction = (worldX - column * ceiling.cell) / ceiling.cell;
	const surface = ceiling.heightmap[column] + (ceiling.heightmap[column + 1] - ceiling.heightmap[column]) * fraction;
	return cellY >= surface ? index : -1;
}

function inspectRockAtPointer(event) {
	if (typeof wildIsActive === 'function' && wildIsActive()) {
		wildInspectRockAtPointer(event);
		return;
	}
	const bounds = canvas.getBoundingClientRect();
	const worldX = (event.clientX - bounds.left - offsetX) / scale;
	const worldY = (floorY - (event.clientY - bounds.top)) / scale;
	const index = rockCellIndex(worldX, worldY);
	setHidden(ui['mineral-tooltip'], index < 0);
	if (index < 0) return;
	const ceiling = window.SteamCeiling.state;
	const columns = ceiling.columns;
	const previousIndex = currentSelectedLayer(ceiling) * columns + selectedColumn;
	selectedColumn = index % columns;
	selectedLayer = Math.floor(index / columns);
	selectedGeoLayer = ceiling.baseRow + selectedLayer;
	if (index !== previousIndex) sceneDirty = true;
	const tip = ui['mineral-tooltip'];
	const x = event.clientX - bounds.left + 14;
	const y = event.clientY - bounds.top + 14;
	const tipWidth = tip.offsetWidth || 260;
	const tipHeight = tip.offsetHeight || 150;
	tip.style.left = Math.max(8, Math.min(bounds.width - tipWidth - 8, x)) + 'px';
	tip.style.top = Math.max(8, Math.min(bounds.height - tipHeight - 8, y)) + 'px';
	mineralReadout();
}


// The held keys are the selected platform's command and nothing else: a key
// that is down addresses whichever platform has the controls, and a switch
// drops both the keys and the command they had left behind, so no platform
// keeps moving on a key the player pressed for another one.
let commandedDirection = 0;
function updateDirection() {
	const direction = Number(rightHeld) - Number(leftHeld);
	if (!playerApi.rigActive()) {
		world.direction = 0;
		// One command per change: a pointer release or a blur must not open a
		// manual window on a competitor the keys never addressed.
		if (direction !== commandedDirection) playerApi.command(direction);
		commandedDirection = direction;
		sceneDirty = true;
		return;
	}
	commandedDirection = 0;
	world.direction = direction;
	autopilotApi.hold('move', world.brake || leftHeld || rightHeld);
	if (leftHeld || rightHeld) world.target = NaN;
	sceneDirty = true;
}

function clearInput() { world.brake = false; leftHeld = false; rightHeld = false; ballLeftHeld = false; ballRightHeld = false; setBallMotor(); playerApi.clearCommand(); updateDirection(); }

// One writer for P2's motor, the same shape as P1's direction: the held arrow
// or button that is down is the command, and a release stops the torque.
function setBallMotor() {
	if (!window.SteamWildBall || !(typeof wildIsActive === 'function' && wildIsActive())) return;
	window.SteamWildBall.setMotor(world, Number(ballRightHeld) - Number(ballLeftHeld));
}

function toggleBallJump() {
	if (!window.SteamWildBall || !(typeof wildIsActive === 'function' && wildIsActive())) return;
	window.SteamWildBall.toggleJump(world);
	refresh();
}

function setBallRecycle(on) {
	if (!window.SteamWildBall || !(typeof wildIsActive === 'function' && wildIsActive())) return;
	window.SteamWildBall.setRecycle(world, on);
	refresh();
}

function toggleBallRecycle() {
	if (!window.SteamWildBall || !(typeof wildIsActive === 'function' && wildIsActive())) return;
	window.SteamWildBall.toggleRecycle(world);
	refresh();
}
// The drive toggle flips the selected machine's own drive, like every other
// machine control; the override is the rig bot's duty, so it applies there only.
function toggleDrive() {
	const machine = playerApi.machineOf(activePlayer());
	machine.drive = !machine.drive;
	if (playerApi.rigActive()) autopilotApi.override('drive');
	else playerApi.overrideMachine(activePlayer(), 'drive');
	refresh();
}
// The release is the selected platform's: the rig spends its reserve, a
// competitor spends its own pulse on the ball it holds.
function releaseBall() {
	const player = activePlayer();
	const ball = physics.focusBallOf(world, playerApi.machineOf(player));
	if (!ball || ball.state !== 'held') return;
	physics.launch(world, ball, playerApi.machineOf(player));
	refresh();
}
// Rockets belong to the selected platform; each rack, stock and order is its own.
function fireRocket() {
	SteamRockets.fire(world, activePlayerId());
	refresh();
}
function buyRocket() {
	SteamRockets.buy(world, 1, activePlayerId());
	refresh();
}
// The sandblaster is the selected platform's nozzle: a press throws one
// grain at once and holding keeps the stream going.
function blastSand() {
	SteamSandblaster.fire(world, activePlayerId());
	refresh();
}
// The water gun is the selected platform's own cannon: one droplet per press,
// and a hold keeps the jet running at the module's own rate.
function sprayWater() {
	SteamWater.fire(world, activePlayerId());
	refresh();
}
function togglePause() { paused = !paused; ui.pause.textContent = paused ? 'Resume' : 'Pause'; accumulator = 0; }
// One force setting per player: the slider and W/S edit the platform being
// driven, and switching players reads that player's setting back into the
// control instead of leaving the rig's value on screen.
function setForce(value) {
	const forceValue = playerApi.setForce(value);
	if (playerApi.rigActive()) world.forceSetting = forceValue;
	syncForceControl(forceValue);
	// The panel's summary line names that player's force, so it moves with
	// the slider instead of waiting for the next readout.
	refreshPlayers();
}

function syncForceControl(value) {
	const forceValue = value === undefined ? playerApi.force(playerApi.state.active) : value;
	const percent = Math.round(forceValue * 100);
	if (Number(ui.force.value) !== percent) ui.force.value = percent;
	setText(ui['force-value'], percent + '%');
}

// The chamber's own frame: the pointer handlers need the world point under it.
function worldXOf(event) { return (event.clientX - canvas.getBoundingClientRect().left - offsetX) / scale; }
function worldYOf(event) {
	if (typeof wildIsActive === 'function' && wildIsActive()) return wildWorldYOf(event);
	return (floorY - (event.clientY - canvas.getBoundingClientRect().top)) / scale;
}

function isGameKey(code) {
	return code === 'Space' || code === 'KeyQ' || code === 'KeyA' || code === 'KeyD' || code === 'KeyW' || code === 'KeyS' || code === 'KeyE'
		|| code === 'KeyR' || code === 'KeyB' || code === 'KeyX' || code === 'KeyZ' || code === 'KeyC' || code === 'KeyM' || code === 'KeyF' || code === 'KeyG' || code === 'F4'
		|| code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown';
}

function keydown(event) {
	if (event.ctrlKey || event.metaKey || event.altKey) return;
	if (event.target.closest('textarea, [contenteditable]')) return;
	if (helpKey(event)) return;
	const key = event.code;
	const wildBallOn = typeof wildIsActive === 'function' && wildIsActive();
	// The arrows are P2's commands in Wild Mine and do nothing in the chamber, so
	// the chamber leaves them to the browser instead of swallowing the scroll.
	if (!wildBallOn && (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown')) return;
	if (!isGameKey(key)) return;
	event.preventDefault();
	if (document.activeElement && document.activeElement !== canvas && document.activeElement !== document.body) {
		document.activeElement.blur();
	}
	if (key === 'KeyB') {
		if (playerApi.rigActive()) { world.brake = true; world.target = NaN; autopilotApi.hold('move', true); }
		else playerApi.commandBrake(true);
	}
	if (key === 'KeyA') leftHeld = true;
	if (key === 'KeyD') rightHeld = true;
	if (key === 'KeyF') blastHeld = true;
	if (key === 'KeyG') sprayHeld = true;
	if (key === 'ArrowLeft') { ballLeftHeld = true; setBallMotor(); }
	if (key === 'ArrowRight') { ballRightHeld = true; setBallMotor(); }
	if (key === 'KeyA' || key === 'KeyD') updateDirection();
	if (key === 'KeyW') setForce(playerApi.force(playerApi.state.active) + 0.1);
	if (key === 'KeyS') setForce(playerApi.force(playerApi.state.active) - 0.1);
	if (event.repeat) return;
	if (key === 'Space' || key === 'KeyQ') toggleDrive();
	if (key === 'KeyE') releaseBall();
	if (key === 'ArrowUp' && wildBallOn) toggleBallJump();
	if (key === 'ArrowDown' && wildBallOn) toggleBallRecycle();
	if (key === 'KeyR') fireRocket();
	if (key === 'KeyM') setCommune(!window.SteamCeiling.state.commune);
	if (key === 'F4') { showDamageRadius = !showDamageRadius; sceneDirty = true; }
	const channel = channelForKey(key, event.shiftKey);
	if (channel) toggleChannel(channel);
}

function keyup(event) {
	const key = event.code;
	if (key === 'Space' || key === 'KeyQ') event.preventDefault();
	if (key === 'KeyB') {
		if (playerApi.rigActive()) { world.brake = false; updateDirection(); }
		else playerApi.commandBrake(false);
	}
	if (key === 'KeyA') leftHeld = false;
	if (key === 'KeyD') rightHeld = false;
	if (key === 'KeyF') blastHeld = false;
	if (key === 'KeyG') sprayHeld = false;
	if (key === 'ArrowLeft') { ballLeftHeld = false; setBallMotor(); }
	if (key === 'ArrowRight') { ballRightHeld = false; setBallMotor(); }
	if (key === 'KeyA' || key === 'KeyD') updateDirection();
}

// P2's panel mirrors P1's: held pointers spin the motor, the jump actuator is
// an on/off toggle like Drive, and the checkbox engages bounce recuperation.
function bindBallControls() {
	const left = ui['ball-left'];
	const right = ui['ball-right'];
	left.addEventListener('pointerdown', function (event) {
		left.setPointerCapture(event.pointerId);
		ballLeftHeld = true;
		setBallMotor();
	});
	right.addEventListener('pointerdown', function (event) {
		right.setPointerCapture(event.pointerId);
		ballRightHeld = true;
		setBallMotor();
	});
	const stop = function () { ballLeftHeld = false; ballRightHeld = false; setBallMotor(); };
	for (const button of [left, right]) {
		button.addEventListener('pointerup', stop);
		button.addEventListener('pointercancel', stop);
		button.addEventListener('lostpointercapture', stop);
	}
	ui['ball-jump'].addEventListener('click', toggleBallJump);
	ui['ball-recycle'].addEventListener('change', function () {
		setBallRecycle(ui['ball-recycle'].checked);
	});
}

function bindDirection(id, direction) {
	const button = document.getElementById(id);
	button.addEventListener('pointerdown', function (event) {
		button.setPointerCapture(event.pointerId);
		if (direction < 0) leftHeld = true;
		else rightHeld = true;
		updateDirection();
	});
	button.addEventListener('pointerup', clearInput);
	button.addEventListener('pointercancel', clearInput);
	button.addEventListener('lostpointercapture', clearInput);
}

function frame(now) {
	const elapsed = previous ? Math.min((now - previous) / 1000, 0.1) : 0;
	previous = now;
	if (!paused && !document.hidden) accumulator += elapsed * Number(ui.speed.value);
	while (accumulator >= config.step) { autopilotApi.update(world, config.step); playerApi.update(world, config.step); physics.step(world, config.step); if (blastHeld) SteamSandblaster.fire(world, activePlayerId()); if (sprayHeld) SteamWater.fire(world, activePlayerId()); accumulator -= config.step; sceneDirty = true; }
	if (sceneDirty) { draw(); sceneDirty = false; }
	if (now - lastReadout > 100 || readoutPlayer !== playerApi.state.active) { refresh(); lastReadout = now; }
	requestAnimationFrame(frame);
}


function endPistonDrag() { pistonDragActive = false; autopilotApi.hold('angle', false); }

function resetRun(withTestRock) {
	const chosenMode = ui['game-mode'] ? ui['game-mode'].value : 'classic';
	if (withTestRock && chosenMode === 'wild' && ui['game-mode']) ui['game-mode'].value = 'classic';
	const wildOn = typeof wildSyncMode === 'function' && !withTestRock && chosenMode === 'wild';
	if (typeof wildSyncMode === 'function') wildSyncMode(wildOn ? 'wild' : 'classic');
	world = physics.createWorld();
	playerApi.init(world, wildOn ? 0 : undefined);
	window.SteamCeiling.setShape(ui.shape.value);
	// The two view-and-shape rules are chamber settings: New game keeps them.
	physics.setBallPerspective(ui['ball-perspective'].value !== 'flat');
	window.SteamCeiling.setFloorCompression(ui['debris-compression'].value);
	ui.balls.value = playerApi.state.ballMode;
	physics.setGroundBounce(ui['ground-bounce'].value);
	selectedLayer = 0;
	selectedGeoLayer = 0;
	renderedSales = -1;
	clearInput();
	endPistonDrag();
	if (wildOn) wildResetRun(world);
	else resize();
	setForce(world.forceSetting);
	autopilotApi.reset();
	accumulator = 0;
	syncActiveControls();
	for (const row of tierRows) row.selectedIndex = -1;
	if (testMode) grantTestState();
	if (withTestRock) {
		window.SteamCeiling.generateTestRock();
		setText(ui['fall-test-status'], 'Test rock ready · ' + window.SteamCeiling.state.testMineralOrder.map(i => window.SteamCeiling.state.mineralNames[i]).join(' → ') + ' · pre-applied damage rises from zero at the top to full damage at the bottom.');
	} else setText(ui['fall-test-status'], 'New run · mineral grouping settings carry over.');
	setModeStatus();
	refresh();
}

function mineralClusterChanged(event) {
	const growth = window.SteamCeiling.setMineralClusterGrowth(Number(event.target.getAttribute('data-mineral')), Number(event.target.value));
	setText(ui[event.target.id + '-value'], growth + '%');
	sceneDirty = true;
}

function bindInput() {
	bindBallControls();
	document.getElementById('reset').addEventListener('click', function () { resetRun(false); });
	ui['generate-test-rock'].addEventListener('click', function () { resetRun(true); });
	ui.drive.addEventListener('click', toggleDrive);
	ui.commune.addEventListener('change', function () { setCommune(ui.commune.checked); });
	ui['test-mode'].addEventListener('change', function () { setTestMode(ui['test-mode'].checked); });
	ui.refuel.addEventListener('click', function () {
		const imported = window.SteamCeiling.recharge(world, world.time);
		refresh();
		if (!imported) {
			ui['transaction-status'].textContent = window.SteamCeiling.state.commune
				? 'The reserve is already full · the commons needs no import.'
				: 'Not enough funds to recharge · ' + window.SteamCeiling.rechargeCost(world).toFixed(1) + ' cr fills the reserve.';
		}
	});
	ui.launch.addEventListener('click', releaseBall);
	ui['rocket-fire'].addEventListener('click', fireRocket);
	ui['rocket-buy'].addEventListener('click', buyRocket);
	ui['rocket-auto'].addEventListener('change', function () {
		SteamRockets.setAutoBuy(ui['rocket-auto'].checked, activePlayerId());
		refresh();
	});
	ui['sandblast-fire'].addEventListener('pointerdown', function (event) {
		ui['sandblast-fire'].setPointerCapture(event.pointerId);
		blastHeld = true;
		blastSand();
	});
	ui['sandblast-fire'].addEventListener('pointerup', function () { blastHeld = false; });
	ui['sandblast-fire'].addEventListener('pointercancel', function () { blastHeld = false; });
	ui['sandblast-fire'].addEventListener('lostpointercapture', function () { blastHeld = false; });
	ui['sandblast-auto'].addEventListener('change', function () {
		SteamSandblaster.setAutoFire(ui['sandblast-auto'].checked, activePlayerId());
		refresh();
	});
	ui['water-fire'].addEventListener('pointerdown', function (event) {
		ui['water-fire'].setPointerCapture(event.pointerId);
		sprayHeld = true;
		sprayWater();
	});
	ui['water-fire'].addEventListener('pointerup', function () { sprayHeld = false; });
	ui['water-fire'].addEventListener('pointercancel', function () { sprayHeld = false; });
	ui['water-fire'].addEventListener('lostpointercapture', function () { sprayHeld = false; });
	ui['water-aim'].addEventListener('click', function () {
		// The nozzle points where the pointer last hovered the chamber. A click
		// that only aims never sets a travel target.
		SteamWater.setAim(SteamWater.state.aimX, SteamWater.state.aimY);
		refresh();
	});
	ui['water-auto'].addEventListener('change', function () {
		SteamWater.setAutoFire(ui['water-auto'].checked, activePlayerId());
		refresh();
	});
	ui['water-pump'].addEventListener('change', function () {
		SteamWater.setPump(ui['water-pump'].checked);
		refresh();
	});
	ui['water-pump-solute'].addEventListener('change', function () {
		SteamWater.setPumpMode(ui['water-pump-solute'].checked ? 'solute' : 'always');
		refresh();
	});
	ui.pause.addEventListener('click', togglePause);
	if (ui['game-mode']) ui['game-mode'].addEventListener('change', function () { resetRun(false); });
	ui.shape.addEventListener('change', function () { window.SteamCeiling.setShape(ui.shape.value); sceneDirty = true; });
	// The ball arrangement re-seats the balls, so the autopilot plan is dropped
	// with the old set instead of being carried across a new one.
	ui.balls.addEventListener('change', function () {
		playerApi.setBallMode(ui.balls.value);
		autopilotApi.reset();
		clearInput();
		refresh();
	});
	// Ground rebound is a chamber rule, so the plan and the drawn flights are
	// rebuilt as soon as it changes.
	ui['ground-bounce'].addEventListener('change', function () {
		physics.setGroundBounce(ui['ground-bounce'].value);
		autopilotApi.reset();
		refresh();
	});
	// The perspective is the chamber's own law and it resizes the ball for real,
	// so the ball's collision, the platforms' deck heights and every forecast
	// are rebuilt with it; the damage overlay is a picture of the strike.
	ui['ball-perspective'].addEventListener('change', function () {
		physics.setBallPerspective(ui['ball-perspective'].value !== 'flat');
		autopilotApi.reset();
		refresh();
	});
	// Debris compression re-lays the piles at their new thickness, so the floor
	// the ball and the platform ride moves with the picture; the material, its
	// value and the ledger do not.
	ui['debris-compression'].addEventListener('change', function () {
		window.SteamCeiling.setFloorCompression(ui['debris-compression'].value);
		autopilotApi.reset();
		refresh();
	});
	ui['view-modes'].addEventListener('change', viewModeChanged);
	ui.autopilot.addEventListener('change', autopilotChanged);
	ui['view-modes'].addEventListener('pointerover', viewModeHovered);
	ui.force.addEventListener('input', function () { setForce(Number(ui.force.value) / 100); });
	ui['piston-angle'].addEventListener('input', function () { setPistonAngle(Number(ui['piston-angle'].value)); });
	// Wheel over the chamber tilts the piston instead of scrolling the page:
	// up (negative delta) raises the angle, a standard notch steps about 4°.
	canvas.addEventListener('wheel', function (event) {
		event.preventDefault();
		const stepRate = typeof wildIsActive === 'function' && wildIsActive() ? 0.08 : 0.04;
		setPistonAngle(pistonDegrees() - Math.max(-100, Math.min(100, event.deltaY)) * stepRate);
	}, { passive: false });
	canvas.addEventListener('pointerdown', function (event) {
		if (typeof wildIsActive === 'function' && wildIsActive()) {
			wildPointerDown(event);
			return;
		}
		const bounds = canvas.getBoundingClientRect();
		const worldX = (event.clientX - bounds.left - offsetX) / scale;
		const worldY = (floorY - (event.clientY - bounds.top)) / scale;
		const cell = rockCellIndex(worldX, worldY);
		if (cell >= 0) {
			inspectRockAtPointer(event);
			canvas.focus();
			return;
		}
		if (worldY <= moveClickHeight && worldX >= 0 && worldX <= config.width) {
			if (playerApi.rigActive()) {
				world.direction = 0;
				world.target = Math.max(physics.platformMin(), Math.min(physics.platformMax(), worldX));
				autopilotApi.override('move');
			} else playerApi.commandTarget(worldX);
			sceneDirty = true;
		} else if (worldX >= 0 && worldX <= config.width && worldY <= config.ceiling) {
			// Open air starts a piston drag; dragging left or up raises the angle.
			pistonDragActive = true;
			autopilotApi.hold('angle', true);
			pistonDragX = event.clientX;
			pistonDragY = event.clientY;
			pistonDragAngle = pistonDegrees();
			if (typeof canvas.setPointerCapture === 'function' && event.pointerId !== undefined) canvas.setPointerCapture(event.pointerId);
		}
		canvas.focus();
	});
	canvas.addEventListener('pointermove', function (event) {
		if (pistonDragActive) {
			// The drag aims the reflection: a positive angle sends a falling ball left,
			// so dragging left (or up) raises it and the bounce follows the pointer.
			const dragRate = typeof wildIsActive === 'function' && wildIsActive() ? 0.25 : 0.05;
			setPistonAngle(pistonDragAngle - ((event.clientX - pistonDragX) + (event.clientY - pistonDragY)) * dragRate);
			return;
		}
		inspectRockAtPointer(event);
		// The nozzle follows the pointer: a water aim is an order to the gun, not
		// a travel target, so hovering the chamber never moves the platform.
		SteamWater.setAim(worldXOf(event), worldYOf(event));
	});
	canvas.addEventListener('pointerleave', function () { setHidden(ui['mineral-tooltip'], true); });
	canvas.addEventListener('pointerup', endPistonDrag);
	canvas.addEventListener('pointercancel', endPistonDrag);
	canvas.addEventListener('lostpointercapture', endPistonDrag);
	ui['piston-angle'].addEventListener('pointerdown', function (event) {
		ui['piston-angle'].setPointerCapture(event.pointerId);
		autopilotApi.hold('angle', true);
	});
	ui['piston-angle'].addEventListener('pointerup', endPistonDrag);
	ui['piston-angle'].addEventListener('pointercancel', endPistonDrag);
	ui['piston-angle'].addEventListener('lostpointercapture', endPistonDrag);
}
