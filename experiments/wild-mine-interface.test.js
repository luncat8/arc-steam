'use strict';
// Wild Mine UI wiring tests against the real index.html and dom.cjs shim.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const dom = require('./dom.cjs');

dom.install();
const physics = require('../js/physics.js');
const players = require('../js/players.js');
const ceiling = require('../js/ceiling.js');
const minerals = require('../js/minerals.js');
const wildMine = require('../js/wild-mine.js');

let world = null;
const simulate = physics.step;
physics.step = function (stepped, dt) {
	world = stepped;
	return simulate(stepped, dt);
};
dom.loadMainScripts();

let frameClock = 1000;
function advance(frames = 8) {
	const step = 1000 / 60;
	dom.frames(frames, frameClock, step);
	frameClock += frames * step;
}

test('switching #game-mode between Classic and Wild Mine reconfigures chamber, players, piston bounds and view', () => {
	const modeSelect = dom.element('game-mode');
	const title = dom.element('chamber-title');
	const piston = dom.element('piston-angle');
	const playerList = dom.element('player-list');
	const reserveNote = dom.element('reserve-note');
	const statusBall = dom.element('status-ball');

	advance(4);
	assert.equal(wildMine.isWild(), false);
	assert.equal(piston.getAttribute('max'), '10');
	assert.equal(playerList.children.length, 2);
	assert.equal(playerList.children[1].hidden, false);

	// Switch to Wild Mine.
	modeSelect.value = 'wild';
	modeSelect.dispatch('change');
	dom.contextCalls.length = 0;
	advance(8);
	assert.equal(wildMine.isWild(), true);
	assert.equal(title.textContent, 'ARC STEAM · WILD MINE / CAVE SECTION');
	assert.equal(piston.getAttribute('min'), '-90');
	assert.equal(piston.getAttribute('max'), '90');
	assert.equal(players.state.players.length, 1);
	assert.equal(playerList.children[0].hidden, false);
	assert.equal(playerList.children[1].hidden, true);
	assert.ok(dom.contextCalls.includes('fillRect'), 'Wild Mine draws fallback tiles & HUD in headless shim');
	assert.ok(reserveNote.textContent.includes('Wild Mine'));
	assert.ok(statusBall.textContent.includes('Wild Mine'));

	// Cargo fuel reaches the reserve and cargo notes.
	const stone = minerals.mineralIds.indexOf('stone');
	ceiling.loadCargo(stone, ceiling.state.cellMass, 10);
	advance(10);
	assert.ok(reserveNote.textContent.includes('solid fuel'), reserveNote.textContent);
	assert.ok(dom.element('cargo-note').textContent.includes('stone'), dom.element('cargo-note').textContent);

	// Exercise all 6 rock view modes in Wild Mine headless draw without error.
	for (const mode of ['elements', 'price', 'initial-strength', 'strength', 'damage', 'minerals']) {
		const radio = dom.element('view-modes');
		radio.dispatch('change', { target: { name: 'view-mode', value: mode } });
		advance(2);
	}

	// Piston slider reaches 90° and -90° in Wild Mine.
	piston.value = '90';
	piston.dispatch('input');
	advance(4);
	assert.ok(Math.abs(players.pistonAngleOf(players.state.players[0]) - Math.PI / 2) < 1e-6);

	piston.value = '-90';
	piston.dispatch('input');
	advance(4);
	assert.ok(Math.abs(players.pistonAngleOf(players.state.players[0]) + Math.PI / 2) < 1e-6);

	// Clicking open cave ground commands travel without errors.
	const canvas = dom.element('c');
	canvas.dispatch('pointerdown', { clientX: 600, clientY: 210 });
	advance(6);
	assert.ok(Number.isFinite(world.target), 'Wild Mine pointer click sets travel target');

	// Hovering solid rock opens mineral tooltip with Cave coordinates.
	canvas.dispatch('pointermove', { clientX: 80, clientY: 80 });
	advance(2);
	assert.equal(dom.element('mineral-tooltip').hidden, false);
	assert.match(dom.element('mineral-cell').textContent, /^Cave col -?\d+ · row \d+$/);

	// Switch back to Classic and restore full 2-player 24x15 chamber.
	modeSelect.value = 'classic';
	modeSelect.dispatch('change');
	advance(8);
	assert.equal(wildMine.isWild(), false);
	assert.equal(title.textContent, 'ARC STEAM · TEST CHAMBER / 24 × 15 M');
	assert.equal(piston.getAttribute('min'), '-10');
	assert.equal(piston.getAttribute('max'), '10');
	assert.equal(players.state.players.length, 2);
	assert.equal(playerList.children[1].hidden, false);
});

test('Wild Bounce Assist shows available pulse work and measured fracture, not Classic sale estimates', () => {
	const mode = dom.element('game-mode');
	const note = dom.element('drive-yield');
	mode.value = 'wild';
	mode.dispatch('change');
	advance(8);
	assert.equal(note.hidden, false);
	assert.equal(note.textContent, 'Next pulse 42.0 J');
	dom.element('drive').dispatch('click');
	assert.match(note.textContent, /Drive off/);
	dom.element('drive').dispatch('click');
	SteamEquipment.grant('coil', world);
	world.battery = 10;
	globalThis.readout();
	assert.equal(note.textContent, 'Next pulse 8.0 J');
	world.battery = 0;
	globalThis.readout();
	assert.match(note.textContent, /No pulse · reserve empty/);
	world.battery = physics.config.battery;
	world.heat = (physics.config.thermalCutoff - physics.config.ambientTemperature) * physics.config.heatCapacity;
	globalThis.readout();
	assert.match(note.textContent, /No pulse · thermal cutoff/);
	world.heat = 0;
	dom.element('launch').dispatch('click');
	advance(48);
	const ball = world.balls[0];
	assert.ok(ball.hits && ball.lastFracture > 0);
	globalThis.readout();
	assert.equal(note.textContent, 'Next pulse 54.0 J · Last fracture ' + ball.lastFracture.toFixed(2) + ' J');
	mode.value = 'classic';
	mode.dispatch('change');
	assert.match(note.textContent, /cr\/kJ/);
});

test('M3 ball controls: motor buttons/keys, piston-style jump actuator toggle and bounce recycle checkbox', () => {
	const modeSelect = dom.element('game-mode');
	modeSelect.value = 'wild';
	modeSelect.dispatch('change');
	advance(4);
	const panel = dom.element('ball-controls');
	const jumpButton = dom.element('ball-jump');
	const recycleBox = dom.element('ball-recycle');
	assert.equal(panel.hidden, false, 'the ball panel shows in Wild Mine');
	assert.equal(jumpButton.getAttribute('aria-pressed'), 'false', 'jump actuator starts off like an unpowered piston');
	assert.equal(jumpButton.firstChild.textContent, 'Jump actuator off ');
	assert.equal(recycleBox.checked, false, 'bounce recycle starts unchecked');
	const ball = world.balls[0];
	assert.equal(ball.state, 'held');

	// The platform reserve powers the release, not the ball battery.
	const battery = ball.battery;
	const reserve = world.battery;
	dom.element('launch').dispatch('click');
	assert.equal(ball.state, 'flying');
	assert.equal(ball.battery, battery);
	assert.ok(world.battery < reserve, 'the release draws the platform reserve');

	// Motor spins up mid-air while ArrowRight is held.
	dom.key('ArrowRight');
	assert.equal(ball.motor, 1, 'ArrowRight drives the motor right');
	advance(8);
	assert.ok(ball.omega > 4, 'holding ArrowRight mid-air spins the ball up');
	dom.keyUp('ArrowRight');
	assert.equal(ball.motor, 0, 'releasing the key stops the motor');
	dom.key('ArrowLeft');
	assert.equal(ball.motor, -1, 'ArrowLeft drives the motor left');
	dom.keyUp('ArrowLeft');

	// Jump actuator toggles on/off via ArrowUp and click, mirroring #drive.
	dom.key('ArrowUp');
	assert.equal(ball.jump, true, 'ArrowUp switches jump actuator on');
	assert.equal(jumpButton.getAttribute('aria-pressed'), 'true');
	assert.equal(jumpButton.firstChild.textContent, 'Jump actuator on ');
	dom.key('ArrowUp');
	assert.equal(ball.jump, false, 'second ArrowUp switches jump actuator off');
	assert.equal(jumpButton.getAttribute('aria-pressed'), 'false');
	assert.equal(jumpButton.firstChild.textContent, 'Jump actuator off ');

	jumpButton.dispatch('click');
	assert.equal(ball.jump, true, 'clicking jump button switches actuator on');
	assert.equal(jumpButton.getAttribute('aria-pressed'), 'true');

	// Bounce recycling checkbox and ArrowDown toggle, mutually exclusive with jump.
	recycleBox.checked = true;
	recycleBox.dispatch('change');
	assert.equal(ball.recycle, true, 'checking ball-recycle enables bounce energy recycling');
	assert.equal(ball.jump, false, 'enabling recycling switches jump actuator off');
	assert.equal(jumpButton.getAttribute('aria-pressed'), 'false');
	assert.equal(jumpButton.firstChild.textContent, 'Jump actuator off ');

	dom.key('ArrowDown');
	assert.equal(ball.recycle, false, 'ArrowDown toggles bounce recycling off');
	assert.equal(recycleBox.checked, false);
	dom.key('ArrowDown');
	assert.equal(ball.recycle, true, 'ArrowDown toggles bounce recycling back on');
	assert.equal(recycleBox.checked, true);

	jumpButton.dispatch('click');
	assert.equal(ball.jump, true);
	assert.equal(ball.recycle, false, 'switching jump on unchecks bounce recycling');
	assert.equal(recycleBox.checked, false);
	jumpButton.dispatch('click');
	assert.equal(ball.jump, false);

	const right = dom.element('ball-right');
	right.dispatch('pointerdown', { pointerId: 1 });
	assert.equal(ball.motor, 1, 'the panel button runs the motor');
	right.dispatch('pointerup', { pointerId: 1 });
	assert.equal(ball.motor, 0);

	// Classic mode keeps the ball panel out of the way and all four arrows inert.
	modeSelect.value = 'classic';
	modeSelect.dispatch('change');
	advance(4);
	assert.equal(panel.hidden, true, 'the ball panel hides in Classic');
	assert.equal(physics.wildMode(), false);
	const classicBall = world.balls[0];
	dom.key('ArrowRight');
	dom.key('ArrowUp');
	dom.key('ArrowDown');
	assert.equal(classicBall.motor, undefined, 'ArrowRight does not touch a classic ball');
	assert.equal(classicBall.jump, undefined, 'ArrowUp does not touch a classic ball');
	assert.equal(classicBall.recycle, undefined, 'ArrowDown does not touch a classic ball');
	dom.keyUp('ArrowRight');
});

test('Wild Mine shows the finite tank, collects through its own switch and feeds the spray button', () => {
	const mode = dom.element('game-mode');
	const intake = dom.element('wild-intake');
	const level = dom.element('wild-tank-level');
	const classicPump = dom.element('water-pump');
	const spray = dom.element('water-fire');
	classicPump.checked = false;
	classicPump.dispatch('change');
	mode.value = 'wild';
	mode.dispatch('change');
	assert.equal(dom.element('wild-water-controls').hidden, false);
	assert.equal(dom.element('seep-key').hidden, false);
	assert.equal(dom.element('pad-key').hidden, true);
	assert.equal(dom.element('classic-pump-order').hidden, true);
	assert.equal(dom.element('classic-solute-order').hidden, true);
	assert.equal(intake.checked, true, 'Wild intake does not inherit the Classic brine order');
	assert.match(level.textContent, /^0\.0 \/ \d+ kg$/);
	intake.checked = false;
	intake.dispatch('change');
	advance(8);
	assert.equal(world.wildWater.mass, 0);
	assert.equal(dom.element('wild-intake-note').textContent, 'Intake off.');
	SteamEquipment.grant('watergun', world, 'rig');
	advance(8);
	assert.equal(spray.disabled, true);
	assert.match(dom.element('water-status').textContent, /Not enough spray water/);
	assert.match(dom.element('cargo-note').textContent, /No solid fuel in cargo/);
	intake.checked = true;
	intake.dispatch('change');
	advance(14);
	assert.ok(world.wildWater.mass > 0);
	assert.ok(Number(dom.element('wild-tank-meter').value) > 0);
	assert.match(dom.element('wild-tank-mix').textContent, /kg spray water · .* kg oil condensate/);
	assert.equal(spray.disabled, false);
	intake.checked = false;
	intake.dispatch('change');
	assert.equal(dom.element('platform-mass').textContent, physics.platformMass(world).toFixed(1) + ' kg');
	const tank = world.wildWater;
	const before = tank.water;
	spray.dispatch('pointerdown', { pointerId: 1 });
	spray.dispatch('pointerup', { pointerId: 1 });
	assert.ok(Math.abs(before - tank.water - SteamWater.state.dropletWater) < 1e-9);
	assert.equal(tank.airborneDrops, 1);
	world.battery = 0;
	advance(8);
	assert.match(dom.element('status-energy').textContent, /No solid fuel in cargo/);
	assert.equal(physics.selectEngine('oil', world, 'rig'), true);
	advance(8);
	assert.match(dom.element('reserve-note').textContent, /Oil burns liquid fuel.*condensate/);
	assert.match(dom.element('cargo-note').textContent, /Tank condensate first/);
	const drain = dom.element('wild-tank-drain');
	assert.equal(drain.disabled, false);
	const condensate = tank.condensate;
	drain.dispatch('click');
	assert.equal(tank.water, 0);
	assert.equal(tank.condensate, condensate);
	assert.equal(drain.disabled, true);

	dom.element('reset').dispatch('click');
	assert.match(level.textContent, /^0\.0 \/ \d+ kg$/, 'New game starts with an empty tank');
	assert.equal(intake.checked, true);
	mode.value = 'classic';
	mode.dispatch('change');
	assert.equal(dom.element('wild-water-controls').hidden, true);
	assert.equal(dom.element('seep-key').hidden, true);
	assert.equal(dom.element('pad-key').hidden, false);
	assert.equal(dom.element('classic-pump-order').hidden, false);
	assert.equal(classicPump.checked, false, 'Classic pump order is restored');
	classicPump.checked = true;
	classicPump.dispatch('change');
});

test('rocket fabrication controls report their gates and wire manual and auto production', () => {
	const mode = dom.element('game-mode');
	mode.value = 'wild';
	mode.dispatch('change');
	advance(8);
	const button = dom.element('rocket-fab');
	const auto = dom.element('rocket-fab-auto');
	const status = dom.element('rocket-fab-status');
	assert.equal(button.disabled, true);
	assert.match(status.textContent, /No rocket fab installed/);
	SteamEquipment.grant('rocket-rack', world, 'rig');
	SteamEquipment.grant('rocket-fab', world, 'rig');
	const iron = minerals.mineralIds.indexOf('iron');
	ceiling.loadCargo(iron, ceiling.state.cellMass, 15);
	advance(8);
	assert.equal(button.disabled, false);
	button.dispatch('click');
	assert.equal(SteamRockets.stateFor('rig').stock, 1);
	assert.equal(ceiling.state.cargoCells, 0);
	assert.equal(button.disabled, true);
	assert.match(status.textContent, /Cargo empty/);
	auto.checked = true;
	auto.dispatch('change');
	assert.equal(SteamRocketFab.isAuto('rig'), true);
	auto.checked = false;
	auto.dispatch('change');
	assert.equal(SteamRocketFab.isAuto('rig'), false);
	mode.value = 'classic';
	mode.dispatch('change');
});

test('service cart: autosell checkbox drives the cart service, a docked cart sells on click and books one ledger entry', () => {
	const mode = dom.element('game-mode');
	const autosell = dom.element('cart-autosell');
	const status = dom.element('cart-status');
	mode.value = 'wild';
	mode.dispatch('change');
	advance(8);
	assert.equal(autosell.checked, false);
	assert.equal(window.SteamWildCart.autosell, false);
	autosell.checked = true;
	autosell.dispatch('change');
	assert.equal(window.SteamWildCart.autosell, true, 'the checkbox drives the cart service');
	autosell.checked = false;
	autosell.dispatch('change');
	assert.equal(window.SteamWildCart.autosell, false);

	// Fill the hopper and let the cart call on it (full hopper dispatches at once).
	const iron = minerals.mineralIds.indexOf('iron');
	while (ceiling.loadCargo(iron, ceiling.state.cellMass, 10)) { /* fill to the brim */ }
	assert.equal(ceiling.state.cargoCells, ceiling.state.storageLimit);
	advance(260); // arrival takes 2.4 s of world time; the shim steps 1/240 per physics substep
	assert.equal(status.hidden, false, 'the cart announces itself while it is here');
	assert.match(status.textContent, /Service cart/);

	// Click where the cart is drawn: the hopper empties and one sale is booked.
	const bounds = window.SteamWildCart.bounds();
	assert.ok(bounds && bounds.w > 4 && bounds.h > 4, 'the renderer published the cart click target');
	const before = ceiling.state.ledger.length;
	const canvas = dom.element('c');
	canvas.dispatch('pointerdown', { clientX: bounds.x + bounds.w * 0.5, clientY: bounds.y + bounds.h * 0.5, pointerId: 1 });
	advance(2);
	assert.equal(ceiling.state.cargoCells, 0, 'clicking the cart sells the load');
	const entries = ceiling.state.ledger.slice(before).filter((entry) => entry.type === 'sell');
	assert.equal(entries.length, 1, 'one frozen sell entry per cart call');

	// Autosell path: refill, tick the box, and the cart sells itself on arrival.
	autosell.checked = true;
	autosell.dispatch('change');
	while (ceiling.loadCargo(iron, ceiling.state.cellMass, 10)) { /* refill */ }
	const beforeAuto = ceiling.state.ledger.length;
	advance(400);
	assert.equal(ceiling.state.cargoCells, 0, 'autosell clears the hopper without a click');
	assert.equal(ceiling.state.ledger.slice(beforeAuto).filter((entry) => entry.type === 'sell').length, 1);

	// Classic isolates the service: the panel hides and clicking does not sell.
	mode.value = 'classic';
	mode.dispatch('change');
	advance(4);
	assert.equal(dom.element('ball-controls').hidden, true, 'the cart order hides in Classic');
	autosell.checked = false;
	autosell.dispatch('change');
	assert.equal(window.SteamWildCart.autosell, false, 'the switch survives the trip back');
});

test('Wild Mine uses its selected compression on screen and reports its own mined and falling material', () => {
	const mode = dom.element('game-mode'), compression = dom.element('debris-compression');
	compression.value = '6';
	compression.dispatch('change');
	mode.value = 'wild';
	mode.dispatch('change');
	assert.equal(compression.value, '1.5');
	assert.equal(ceiling.state.floorCompression, 1.5);
	compression.value = '8';
	compression.dispatch('change');
	dom.element('reset').dispatch('click');
	assert.equal(ceiling.state.floorCompression, 8, 'New game keeps the current mode’s choice');
	const cave = wildMine.cave, r = cave.state.shelfRow - 1;
	const x = cave.worldX(20), y = cave.worldY(r);
	for (let hit = 0; hit < 6 && cave.solidAt(x, y); hit++) cave.weaken(x, y, 2, 2, 0.75);
	globalThis.miningReadout();
	assert.equal(dom.element('extracted').textContent, '1 cells');
	assert.equal(dom.element('falling').textContent, '1 cells');
	advance(25);
	assert.equal(dom.element('falling').textContent, '0 cells');
	assert.equal(window.SteamWildRubble.state().cells, 1);
	mode.value = 'classic';
	mode.dispatch('change');
	assert.equal(dom.element('extracted').textContent, '0 cells');
	assert.equal(compression.value, '6');
	assert.equal(ceiling.state.floorCompression, 6);
});

test('the cave renderer fills from each rock face to both projected crest vertices, including the shoulders', () => {
	const mode = dom.element('game-mode');
	mode.value = 'wild';
	mode.dispatch('change');
	const cave = wildMine.cave, c = -3, cell = cave.state.cell;
	window.SteamWildRubble.deposit(cave.worldX(c), 32, 7, 30);
	const ctx = dom.element('c').getContext('2d');
	const paths = [], crests = [];
	const saved = { moveTo: ctx.moveTo, lineTo: ctx.lineTo, fill: ctx.fill };
	let drawingFill = true, path;
	try {
		ctx.moveTo = (x, y) => {
			path = [[x, y]];
			(drawingFill ? paths : crests).push(path);
		};
		ctx.lineTo = (x, y) => path.push([x, y]);
		ctx.fill = () => { drawingFill = false; };
		globalThis.wildDrawRubble(c - 2, c + 2);
	} finally {
		Object.assign(ctx, saved);
	}
	assert.equal(paths.length, 5);
	assert.equal(crests.length, paths.length);
	const base = cave.floorBelow(cave.worldX(c), 32);
	for (let i = 0; i < paths.length; i++) {
		const x = (c - 2 + i) * cell;
		const left = [x, wildMine.drawnY(wildMine.groundAt(x, 32))];
		const right = [x + cell, wildMine.drawnY(wildMine.groundAt(x + cell, 32))];
		assert.deepEqual(paths[i], [[x, wildMine.drawnY(base)], left, right, [x + cell, wildMine.drawnY(base)]]);
		assert.deepEqual(crests[i], [left, right]);
	}
	mode.value = 'classic';
	mode.dispatch('change');
});
