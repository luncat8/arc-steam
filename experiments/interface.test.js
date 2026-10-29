'use strict';
// Interface smoke test without a browser: the real index.html wiring runs
// against experiments/dom.cjs, so panel building, gating, shortcuts, purchases,
// research and the ballistic overlay are all exercised end to end.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const dom = require('./dom.cjs');

dom.install();
const ceiling = require('../js/ceiling.js');
const equipment = require('../js/equipment.js');
const research = require('../js/research.js');
const physics = require('../js/physics.js');
const harness = require('./harness.cjs');
require('../js/prediction.js');
const autopilot = require('../js/autopilot.js');

// Capture the world the page owns so measured cargo sales can fund it.
let world = null;
const simulate = physics.step;
physics.step = function (stepped, dt) {
	world = stepped;
	return simulate(stepped, dt);
};
require('../js/main.js');

let clock = 0;
function advance(count) {
	for (let i = 0; i < count; i++) {
		clock += 1000 / 60;
		dom.frame(clock);
	}
}
function row(panel, id, list) {
	const index = list.findIndex(entry => entry.id === id);
	assert.ok(index >= 0, 'missing ' + id);
	return dom.element(panel).children[index];
}
function techRow(id) { return row('research-rows', id, research.nodes); }
function gearRow(id) { return dom.element('equipment-rows').children[equipment.items.findIndex(item => item.id === id)]; }
function buttonOf(target) { return target.children[1]; }
function fund(cost) {
	let guard = 0;
	while (ceiling.state.funds < cost) {
		harness.earnFunds(world, 100);
		harness.sync(world);
		assert.ok(++guard < 20, 'the page economy cannot fund ' + cost + ' cr');
	}
	advance(8);
}
function study(id) {
	for (const prerequisite of research.find(id).requires) if (!research.isResearched(prerequisite)) study(prerequisite);
	if (research.isResearched(id)) return;
	let guard = 0;
	while (!research.isResearched(id)) {
		fund(research.find(id).cost);
		buttonOf(techRow(id)).dispatch('click');
		assert.ok(++guard < 20, 'research ' + id + ' never completed');
	}
	advance(8);
}

advance(2);

test('the page boots, builds every panel, and reports live telemetry', () => {
	assert.equal(dom.element('equipment-rows').children.length, equipment.items.length);
	assert.equal(dom.element('research-rows').children.length, research.nodes.length);
	assert.equal(dom.element('platform-spec').children.length, 14);
	assert.equal(dom.element('inventory-rows').children.length, ceiling.state.mineralNames.length);
	assert.match(dom.element('battery').textContent, /kJ$/);
	assert.match(dom.element('temperature').textContent, /°C$/);
	assert.match(dom.element('motion').textContent, /m\/s$/);
	assert.ok(Math.abs(parseFloat(dom.element('error').textContent)) < 1e-5);
	assert.equal(dom.element('drive').getAttribute('aria-pressed'), 'true', 'the bounce drive is enabled by default');
	assert.equal(dom.element('drive').firstChild.textContent, 'Drive on ');
	assert.equal(dom.element('research-progress').textContent, '0 / ' + research.nodes.length);
	assert.equal(dom.element('prediction-status').hidden, true, 'the overlay stays hidden before its research');
	// The installed specification starts at base tuning.
	const spec = dom.element('platform-spec').children;
	assert.equal(spec[1].textContent, physics.config.platformMass.toFixed(1) + ' kg');
	assert.equal(spec[3].textContent, physics.config.force.toFixed(0) + ' N');
	assert.equal(spec[5].textContent, physics.config.maxSpeed.toFixed(0) + ' m/s');
	assert.equal(spec[7].textContent, '42 J');
	assert.equal(spec[9].textContent, '90%');
	assert.equal(spec[13].textContent, '0%');
});

test('settled readouts do not rewrite buttons, status or control state', () => {
	// Freeze the world: telemetry may keep reporting, but with nothing changed
	// no button label, status line, pressed state or disabled flag may be
	// written again. Count the actual DOM writes instead of comparing values,
	// because a redundant write stores the same string it replaces.
	dom.element('pause').dispatch('click');
	advance(4);
	const counts = { text: 0, disabled: 0, attribute: 0 };
	function countText(node) {
		let value = node.textContent;
		Object.defineProperty(node, 'textContent', {
			configurable: true,
			get() { return value; },
			set(next) { counts.text++; value = next; }
		});
	}
	countText(dom.element('drive').firstChild);
	countText(dom.element('status'));
	countText(dom.element('refuel'));
	countText(dom.element('piston-value'));
	countText(buttonOf(gearRow('pad')));
	countText(buttonOf(techRow('materials')));
	const launch = dom.element('launch');
	let launchDisabled = launch.disabled;
	Object.defineProperty(launch, 'disabled', {
		configurable: true,
		get() { return launchDisabled; },
		set(next) { counts.disabled++; launchDisabled = next; }
	});
	const drive = dom.element('drive');
	const writeAttribute = drive.setAttribute.bind(drive);
	drive.setAttribute = function (name, value) { counts.attribute++; return writeAttribute(name, value); };
	advance(30);
	assert.deepEqual(counts, { text: 0, disabled: 0, attribute: 0 });
	dom.element('pause').dispatch('click');
});

test('locked and unaffordable upgrades say why instead of failing silently', () => {
	const pad = gearRow('pad');
	assert.equal(pad.dataset.state, 'locked');
	assert.equal(buttonOf(pad).textContent, 'Locked');
	assert.equal(buttonOf(pad).getAttribute('aria-disabled'), 'true', 'blocked but still clickable, so the refusal is explained');
	buttonOf(pad).dispatch('click');
	assert.match(dom.element('equipment-status').textContent, /needs the Rebound materials research first/);
	const materials = techRow('materials');
	assert.equal(materials.dataset.state, 'available');
	assert.equal(buttonOf(materials).textContent, 'Research');
	assert.equal(buttonOf(materials).getAttribute('aria-disabled'), 'true', 'available but not funded yet');
	buttonOf(materials).dispatch('click');
	assert.match(dom.element('research-status').textContent, /Not enough funds for Rebound materials \(180 cr needed\)/);
	const ballistics = techRow('ballistics');
	assert.equal(ballistics.dataset.state, 'locked');
	buttonOf(ballistics).dispatch('click');
	assert.match(dom.element('research-status').textContent, /stays locked until Pulse electromagnetics is researched/);
	assert.match(ballistics.children[3].textContent, /Needs research: Pulse electromagnetics · unlocks the predicted trajectory overlay/);
	assert.match(gearRow('flywheel').children[3].textContent, /Needs research: Flywheel storage/);
});

test('shortcuts drive the simulation without re-triggering focused controls', () => {
	// The drive starts on (see the boot test), so the first toggle turns it off.
	assert.equal(dom.element('drive').getAttribute('aria-pressed'), 'true');
	assert.equal(dom.element('drive').firstChild.textContent, 'Drive on ');
	dom.key('Space');
	assert.equal(dom.element('drive').getAttribute('aria-pressed'), 'false');
	assert.equal(dom.element('drive').firstChild.textContent, 'Drive off ');
	dom.key('KeyQ');
	assert.equal(dom.element('drive').getAttribute('aria-pressed'), 'true');
	dom.key('KeyW');
	assert.equal(dom.element('force').value, '70');
	assert.equal(dom.element('force-value').textContent, '70%');
	dom.key('KeyS');
	assert.equal(dom.element('force').value, '60');
	dom.key('KeyD');
	advance(12);
	assert.notEqual(dom.element('motion').textContent, '0.00 m/s');
	dom.keyUp('KeyD');
	dom.element('pause').dispatch('click');
	assert.equal(dom.element('pause').textContent, 'Resume');
	const frozen = dom.element('clock').textContent;
	advance(12);
	assert.equal(dom.element('clock').textContent, frozen);
	// Space after clicking Pause still toggles the drive, not the pause button.
	dom.key('Space');
	assert.equal(dom.element('drive').getAttribute('aria-pressed'), 'false');
	assert.equal(dom.element('pause').textContent, 'Resume');
	dom.key('Space');
	dom.element('pause').dispatch('click');
	assert.equal(dom.element('pause').textContent, 'Pause');
});

test('measured sales fund research, which unlocks equipment and the overlay', () => {
	advance(4);
	assert.ok(world, 'the page owns the stepped world');
	study('materials');
	assert.equal(techRow('materials').dataset.state, 'researched');
	assert.equal(buttonOf(techRow('materials')).textContent, 'Done');
	assert.equal(dom.element('research-progress').textContent, '1 / ' + research.nodes.length);
	assert.match(dom.element('research-status').textContent, /^Researched Rebound materials at /);
	const pad = gearRow('pad');
	assert.equal(pad.dataset.state, 'available');
	assert.equal(buttonOf(pad).textContent, 'Buy');
	fund(equipment.find('pad').cost);
	buttonOf(pad).dispatch('click');
	assert.match(dom.element('equipment-status').textContent, /^Installed Rebound pad at /);
	assert.equal(pad.dataset.state, 'installed');
	const spec = dom.element('platform-spec').children;
	assert.equal(spec[1].textContent, (physics.config.platformMass + 6).toFixed(1) + ' kg');
	assert.equal(spec[9].textContent, '94%', 'research and pad retention stack');
	// One ledger carries sales, research and purchases, newest first.
	assert.match(dom.element('ledger').children[0].textContent, /Bought Rebound pad · −250 cr/);
	assert.match(dom.element('ledger').children[1].textContent, /Researched Rebound materials · −180 cr/);
	assert.match(dom.element('transaction-status').textContent, /^Bought Rebound pad for 250 cr at /);
	assert.equal(dom.element('transaction-count').textContent, '(' + ceiling.state.ledger.length + ')');
	// The energy balance survives every purchase, research delta and sale.
	assert.ok(Math.abs(parseFloat(dom.element('error').textContent)) < 1e-4, dom.element('error').textContent);
});

// A fixed scene keeps the overlay assertions exact: the platform parks away from
// the landing column, so the prediction ends on the ground out of reach.
function scene() {
	world.platform.x = 3;
	world.platform.vx = 0;
	world.direction = 0;
	world.target = NaN;
	world.drive = false;
	world.ball.state = 'flying';
	world.ball.x = 12; world.ball.y = 5; world.ball.vx = 2; world.ball.vy = 0;
	harness.sync(world);
}

test('the ballistic computer overlay appears only after its research', () => {
	scene();
	advance(2);
	assert.equal(dom.element('prediction-status').hidden, true);
	dom.contextCalls.length = 0;
	advance(1);
	assert.equal(dom.contextCalls.includes('setLineDash'), false, 'no overlay is drawn while locked');
	study('ballistics');
	scene();
	advance(8);
	const status = dom.element('prediction-status');
	assert.equal(status.hidden, false);
	assert.match(status.textContent, /^Landing on the ground at \d+\.\d m in \d+\.\d\d s · ghost coasts to \d+\.\d m · intercept short by \d+\.\d m at full thrust$/);
	dom.contextCalls.length = 0;
	advance(1);
	assert.ok(dom.contextCalls.includes('setLineDash'), 'the predicted path is drawn dashed');
	assert.ok(dom.contextCalls.includes('strokeRect'), 'the intercept ghost is drawn');
	assert.ok(Math.abs(parseFloat(dom.element('error').textContent)) < 1e-4, dom.element('error').textContent);
});

test('the market panel recharges the reserve from measured funds', () => {
	world.battery = harness.c.battery;
	world.drive = false;
	advance(8);
	assert.equal(dom.element('fuel-price').textContent, String(ceiling.state.fuelPrice));
	assert.equal(dom.element('refuel-cost').textContent, '0.0 cr');
	assert.equal(dom.element('refuel').textContent, 'Reserve full');
	assert.equal(dom.element('refuel').disabled, true, 'a full reserve cannot be recharged');
	world.battery = 2000;
	fund(400);
	advance(8);
	assert.equal(dom.element('refuel-cost').textContent, ceiling.rechargeCost(world).toFixed(1) + ' cr');
	assert.equal(dom.element('refuel').disabled, false);
	assert.match(dom.element('refuel').textContent, /^Recharge \d+\.\d\d kJ$/);
	dom.element('refuel').dispatch('click');
	advance(8);
	assert.ok(world.battery > 2000, 'the reserve took the imported energy');
	assert.ok(world.importedEnergy > 0);
	assert.match(dom.element('transaction-status').textContent, /^Recharged \d+\.\d\d kJ of reserve for \d+\.\d cr at \d+\.\d s\.$/);
	assert.match(dom.element('ledger').children[0].textContent, /Recharged \d+\.\d\d kJ · −\d+\.\d cr/);
	assert.ok(Math.abs(parseFloat(dom.element('error').textContent)) < 1e-4, dom.element('error').textContent);
});

// Catch a full load through the real collector, then let the page read it.
function fillCargo(count) {
	const state = ceiling.state;
	const target = state.extractedCells + count;
	for (let x = 1; x < 23 && state.extractedCells < target; x += 2) ceiling.damage(x, ceiling.state.bottom + 0.2, 20);
	let prepared = 0;
	for (let i = 0; i < state.active.length && prepared < count; i++) {
		if (!state.active[i]) continue;
		state.debrisX[i] = world.platform.x - 1;
		state.debrisY[i] = 0.701;
		state.debrisVx[i] = 0;
		state.debrisVy[i] = -1;
		prepared++;
	}
	physics.step(world, physics.config.step);
}

// The shim canvas is 1000 × 420, matching the page's own view and margins.
function chamberPoint(worldX, worldY) {
	const scale = Math.min((1000 - 32) / 25.5, (420 - 80) / physics.config.ceiling);
	return { clientX: (1000 - 25.5 * scale) / 2 + 1.5 * scale + worldX * scale, clientY: (420 + physics.config.ceiling * scale) / 2 + 9 - worldY * scale };
}

test('clicking rock inspects a cell and clicking low commands travel, without inspector sliders', () => {
	assert.equal(dom.elements.has('mineral-column'), false, 'the column slider is gone');
	assert.equal(dom.elements.has('mineral-layer'), false, 'the layer slider is gone');
	world.platform.x = 12; world.platform.vx = 0; world.target = NaN; world.direction = 0;
	advance(8);
	const state = ceiling.state;
	let column = 0;
	while (column < state.columns - 1 && state.firstRow[column] >= state.rows) column++;
	const rock = chamberPoint((column + 0.5) * state.cell, state.top - 0.05);
	dom.element('c').dispatch('pointerdown', rock);
	assert.equal(dom.element('mineral-cell').textContent, 'Column ' + (column + 1) + ' / ' + state.columns + ' · Layer ' + state.rows + ' / ' + state.rows);
	assert.ok(Number.isNaN(world.target), 'a rock click must not move the platform');
	const low = chamberPoint(5, 0.5);
	dom.element('c').dispatch('pointerdown', low);
	assert.ok(Math.abs(world.target - 5) < 1e-6, 'the low band sets a travel target');
	assert.equal(dom.element('mineral-cell').textContent, 'Column ' + (column + 1) + ' / ' + state.columns + ' · Layer ' + state.rows + ' / ' + state.rows, 'travel does not change the inspected cell');
});

test('the piston angle is set by the slider, the chamber wheel and an air drag', () => {
	const slider = dom.element('piston-angle');
	slider.value = '-4';
	slider.dispatch('input');
	assert.ok(Math.abs(world.pistonAngle + 4 * Math.PI / 180) < 1e-12);
	assert.equal(dom.element('piston-value').textContent, '-4.0°');
	slider.value = '0';
	slider.dispatch('input');
	assert.equal(world.pistonAngle, 0);
	// Wheel up over the chamber raises the angle; a notch steps about four degrees.
	dom.element('c').dispatch('wheel', { deltaY: -100 });
	assert.ok(Math.abs(world.pistonAngle - 4 * Math.PI / 180) < 1e-12, 'one wheel notch tilts about four degrees');
	assert.equal(slider.value, '4');
	dom.element('c').dispatch('wheel', { deltaY: 50 });
	assert.ok(Math.abs(world.pistonAngle - 2 * Math.PI / 180) < 1e-12);
	// A drag through open air (above the travel band, below the rock) aims the
	// reflection: dragging left raises the angle, and a positive angle is the tilt
	// that sends a falling ball left, so the bounce follows the pointer.
	world.target = NaN;
	const start = chamberPoint(12, 5);
	dom.element('c').dispatch('pointerdown', start);
	dom.element('c').dispatch('pointermove', { clientX: start.clientX - 100, clientY: start.clientY });
	dom.element('c').dispatch('pointerup', {});
	assert.ok(Math.abs(world.pistonAngle - 7 * Math.PI / 180) < 1e-9, `dragging left tilts to seven degrees, got ${world.pistonAngle * 180 / Math.PI}`);
	assert.equal(dom.element('piston-value').textContent, '7.0°');
	assert.ok(Number.isNaN(world.target), 'an air drag does not command travel');
	// Dragging right takes the same angle back off, and the diagonal reads as one
	// aim: left-or-up raises it, right-or-down lowers it.
	dom.element('c').dispatch('pointerdown', start);
	dom.element('c').dispatch('pointermove', { clientX: start.clientX + 100, clientY: start.clientY });
	dom.element('c').dispatch('pointerup', {});
	assert.ok(Math.abs(world.pistonAngle - 2 * Math.PI / 180) < 1e-9, `dragging right tilts back to two degrees, got ${world.pistonAngle * 180 / Math.PI}`);
	// The angle clamps at ten degrees however it is set.
	slider.value = '10';
	slider.dispatch('input');
	dom.element('c').dispatch('wheel', { deltaY: -500 });
	assert.ok(Math.abs(world.pistonAngle - physics.config.pistonMaxAngle) < 1e-12);
	slider.value = '0';
	slider.dispatch('input');
	assert.equal(world.pistonAngle, 0);
});

test('the autopilot switches, shortcuts and manual overrides share one writer', () => {
	const panel = dom.element('autopilot');
	const status = dom.element('autopilot-status');
	const boxes = { move: 'auto-move', smart: 'auto-smart', drive: 'auto-drive', angle: 'auto-angle' };
	assert.equal(status.hidden, true, 'a fresh page flies by hand');
	function check(channel, value) {
		const box = dom.element(boxes[channel]);
		box.checked = value;
		panel.dispatch('change', { target: box });
	}
	// A ball in flight, so the intercept has a mark to report.
	world.platform.x = 8; world.platform.vx = 0; world.direction = 0; world.target = NaN;
	world.ball.state = 'flying'; world.ball.x = 12; world.ball.y = 5; world.ball.vx = 0; world.ball.vy = 0;
	world.drive = true;
	harness.sync(world);
	check('move', true);
	assert.equal(autopilot.enabled('move'), true);
	advance(8);
	assert.equal(status.hidden, false);
	assert.match(status.textContent, /^Intercept · 11\.4 m in /);
	assert.ok(Number.isFinite(world.target), 'the chase commands travel instead of leaving the platform alone');
	// The two intercept switches are one duty at two levels of care.
	check('smart', true);
	assert.equal(autopilot.enabled('smart'), true);
	assert.equal(autopilot.enabled('move'), false);
	assert.equal(dom.element(boxes.move).checked, false, 'the panel shows the exclusivity');
	advance(8);
	assert.match(status.textContent, /^Timed intercept/);
	assert.ok(Number.isNaN(world.target), 'the timed intercept owns the direction, not a travel target');
	// The shortcuts name the same channels: X, shift-X, Z and C.
	dom.key('KeyX');
	assert.equal(autopilot.enabled('move'), true);
	assert.equal(autopilot.enabled('smart'), false);
	dom.key('KeyX', { shiftKey: true });
	assert.equal(autopilot.enabled('smart'), true);
	dom.key('KeyZ');
	dom.key('KeyC');
	assert.equal(autopilot.enabled('drive'), true);
	assert.equal(autopilot.enabled('angle'), true);
	advance(8);
	assert.match(status.textContent, /Drive keeper · pulse (armed|held)/);
	assert.match(status.textContent, /Level bounce · tilt to -?\d+\.\d°/);
	assert.ok(Math.abs(world.pistonAngle) <= physics.config.pistonMaxAngle + 1e-12, 'the tilt keeper stays inside its range');
	// The drive keeper releases a caught ball instead of stalling the shift.
	world.ball.state = 'held'; world.ball.vx = 0; world.ball.vy = 0; world.drive = false;
	harness.sync(world);
	advance(4);
	assert.equal(world.ball.state, 'flying', 'a held ball goes back up');
	assert.equal(dom.element('drive').getAttribute('aria-pressed'), 'true');
	// Manual controls suspend only their duty and leave the switches checked.
	dom.key('KeyA');
	assert.equal(autopilot.enabled('smart'), true);
	assert.equal(dom.element(boxes.smart).checked, true);
	advance(180);
	assert.equal(autopilot.suspended('move'), true, 'holding A outlasts the grace period');
	assert.equal(world.direction, -1, 'the autopilot does not fight held movement');
	dom.keyUp('KeyA');
	dom.key('Space');
	const manualDrive = world.drive;
	dom.element('piston-angle').value = 6;
	dom.element('piston-angle').dispatch('input');
	dom.element('c').dispatch('pointerdown', chamberPoint(5, 0.5));
	advance(8);
	assert.equal(world.drive, manualDrive);
	assert.ok(Math.abs(world.target - 5) < 1e-9);
	assert.equal(world.pistonAngle, 6 * Math.PI / 180);
	for (const channel of ['smart', 'drive', 'angle']) {
		assert.equal(autopilot.enabled(channel), true);
		assert.equal(autopilot.suspended(channel), true);
		assert.equal(dom.element(boxes[channel]).checked, true);
	}
	assert.match(status.textContent, /manual override/);
	advance(130);
	for (const channel of ['smart', 'drive', 'angle']) assert.equal(autopilot.suspended(channel), false);
	assert.doesNotMatch(status.textContent, /manual override/);
	for (const channel of ['smart', 'drive', 'angle']) check(channel, false);
	advance(8);
	assert.equal(status.hidden, true, 'explicit switch-off stays off');
	world.target = NaN; world.direction = 0;
});

test('held tilt survives the grace period and pause freezes override time', () => {
	autopilot.set('angle', true);
	const slider = dom.element('piston-angle');
	slider.dispatch('pointerdown', { pointerId: 1 });
	slider.value = 7;
	slider.dispatch('input');
	advance(180);
	assert.equal(autopilot.suspended('angle'), true);
	assert.equal(world.pistonAngle, 7 * Math.PI / 180);
	slider.dispatch('pointercancel');
	dom.element('pause').dispatch('click');
	advance(180);
	assert.equal(autopilot.suspended('angle'), true, 'paused simulation never consumes the grace period');
	dom.element('pause').dispatch('click');
	advance(130);
	assert.equal(autopilot.suspended('angle'), false, 'cancel releases the held override');
	autopilot.set('angle', false);
});

test('telemetry highlights an empty reserve, a full cargo and overheating', () => {
	world.platform.x = 3; world.platform.vx = 0; world.target = NaN; world.direction = 0;
	world.ball.state = 'held'; world.drive = false;
	world.battery = 0;
	advance(8);
	assert.equal(dom.element('reserve-telemetry').dataset.warning, 'EMPTY');
	assert.match(dom.element('reserve-note').textContent, /^Empty · hand-crank crawl/);
	world.battery = physics.config.battery * 0.05;
	advance(8);
	assert.equal(dom.element('reserve-telemetry').dataset.warning, 'LOW');
	world.battery = physics.config.battery;
	advance(8);
	assert.equal(dom.element('reserve-telemetry').dataset.warning, undefined);

	world.heat = physics.config.heatCapacity * (physics.config.thermalDerateStart + 20 - physics.config.ambientTemperature);
	advance(8);
	assert.equal(dom.element('thermal-telemetry').dataset.warning, 'HOT');
	world.heat = physics.config.heatCapacity * (physics.config.thermalCutoff + 50 - physics.config.ambientTemperature);
	advance(8);
	assert.equal(dom.element('thermal-telemetry').dataset.warning, 'CUTOFF');
	world.heat = 0;
	advance(8);
	assert.equal(dom.element('thermal-telemetry').dataset.warning, undefined);

	fillCargo(100);
	advance(8);
	assert.equal(dom.element('cargo').textContent, '100 / 100');
	assert.equal(dom.element('cargo-telemetry').dataset.warning, 'FULL');
	assert.match(dom.element('cargo-note').textContent, /^Full/);
});

test('the centre pad is read as charging and refills the reserve in four seconds', () => {
	world.platform.x = 12; world.platform.vx = 0; world.target = NaN; world.direction = 0;
	world.battery = 0;
	harness.sync(world);
	advance(8);
	assert.match(dom.element('reserve-note').textContent, /^Charging 3\.0 kW/);
	const charged = world.battery;
	assert.ok(charged > 0, 'the pad charges while the platform is parked');
	advance(150);
	assert.ok(world.battery > charged + 5000, 'a two-second stop imports several kilojoules');
	assert.ok(Math.abs(parseFloat(dom.element('error').textContent)) < 1e-4, dom.element('error').textContent);
	// Off the pad the note points at it instead of claiming a charge.
	world.platform.x = 3;
	advance(8);
	assert.match(dom.element('reserve-note').textContent, /Centre pad/);
});

test('reset clears research, equipment and the overlay together', () => {
	dom.element('reset').dispatch('click');
	advance(8);
	assert.equal(research.state.completed, 0);
	assert.equal(equipment.isInstalled('pad'), false);
	assert.equal(dom.element('research-progress').textContent, '0 / ' + research.nodes.length);
	assert.equal(techRow('materials').dataset.state, 'available');
	assert.equal(gearRow('pad').dataset.state, 'locked');
	assert.equal(dom.element('platform-spec').children[1].textContent, physics.config.platformMass.toFixed(1) + ' kg');
	assert.equal(dom.element('prediction-status').hidden, true);
	assert.equal(dom.element('research-status').textContent, 'Sell cargo at a wall to fund research.');
	assert.equal(dom.element('transaction-count').textContent, '(0)');
	assert.ok(Math.abs(parseFloat(dom.element('error').textContent)) < 1e-5);
});

// The shim parses only elements with ids, so the menu labels are built here
// exactly as the markup nests them: label > radio + text span.
function viewLabel(value) {
	const label = dom.document.createElement('label');
	const input = dom.document.createElement('input');
	const text = dom.document.createElement('span');
	input.type = 'radio';
	input.name = 'rock-view';
	input.value = value;
	label.control = input;
	label.append(input, text);
	dom.element('view-modes').appendChild(label);
	return { label, input, text };
}

test('the rock view switches by click or mouse hover through one writer, redrawing only when dirty', () => {
	const modes = dom.element('view-modes');
	const price = viewLabel('price');
	const strength = viewLabel('strength');
	const elements = viewLabel('elements');
	let drawnMode = null;
	const drawRock = ceiling.draw;
	ceiling.draw = function (context, mode) { drawnMode = mode; return drawRock(context, mode); };
	dom.element('pause').dispatch('click');
	advance(2);
	dom.contextCalls.length = 0;
	advance(3);
	assert.equal(dom.contextCalls.length, 0, 'a paused, unchanged chamber is not redrawn');

	price.input.checked = true;
	modes.dispatch('change', { target: price.input });
	advance(1);
	assert.equal(drawnMode, 'price', 'a click redraws the paused chamber in the new mode');

	modes.dispatch('pointerover', { target: strength.text });
	assert.equal(strength.input.checked, true, 'hover checks the radio it selects');
	advance(1);
	assert.equal(drawnMode, 'strength');
	dom.contextCalls.length = 0;
	modes.dispatch('pointerover', { target: strength.label });
	advance(1);
	assert.equal(dom.contextCalls.length, 0, 'hovering the active mode changes nothing');
	modes.dispatch('pointerover', { target: modes });
	advance(1);
	assert.equal(dom.contextCalls.length, 0, 'the gaps between labels are ignored');

	dom.pointerMedia.matches = false;
	modes.dispatch('pointerover', { target: elements.text });
	advance(1);
	assert.equal(elements.input.checked, false, 'touch and stylus devices stay click-only');
	assert.equal(drawnMode, 'strength');
	modes.dispatch('change', { target: elements.input });
	advance(1);
	assert.equal(drawnMode, 'elements', 'click still works without hover');

	dom.pointerMedia.matches = true;
	ceiling.draw = drawRock;
	dom.element('pause').dispatch('click');
});

test('test mode grants all upgrades, preserves credits, and reapplies them on New game', () => {
	const toggle = dom.element('test-mode');
	const funds = ceiling.state.funds;
	toggle.checked = true;
	toggle.dispatch('change');
	assert.equal(research.state.completed, research.nodes.length);
	assert.ok(equipment.items.every(item => equipment.isInstalled(item.id)));
	assert.equal(ceiling.state.funds, funds, 'test grants do not use credits');
	assert.equal(dom.element('research-progress').textContent, research.nodes.length + ' / ' + research.nodes.length);
	assert.ok(research.nodes.every(node => techRow(node.id).dataset.state === 'researched'));
	assert.ok(equipment.items.every(item => gearRow(item.id).dataset.state === 'installed'));
	assert.match(dom.element('equipment-status').textContent, /all \d+ equipment items installed/);
	assert.match(dom.element('research-status').textContent, /all \d+ technologies researched/);
	assert.ok(ceiling.state.ledger.filter(entry => entry.source === 'test').length >= research.nodes.length + equipment.items.length);
	assert.match(dom.element('ledger').children[0].textContent, /Test installed /);
	assert.match(dom.element('transaction-status').textContent, /Test mode installed /);
	assert.ok(Math.abs(parseFloat(dom.element('error').textContent)) < 1e-4, dom.element('error').textContent);

	dom.element('reset').dispatch('click');
	assert.equal(toggle.checked, true, 'test mode is a mode and survives New game');
	assert.equal(research.state.completed, research.nodes.length);
	assert.ok(equipment.items.every(item => equipment.isInstalled(item.id)));

	toggle.checked = false;
	toggle.dispatch('change');
	assert.equal(research.state.completed, research.nodes.length, 'turning the mode off does not revoke grants');
	assert.match(dom.element('research-status').textContent, /remains active until New game/);
	dom.element('reset').dispatch('click');
	assert.equal(research.state.completed, 0, 'a fresh non-test game clears research');
	assert.ok(equipment.items.every(item => !equipment.isInstalled(item.id)));
	assert.equal(dom.element('test-mode').checked, false);
});
