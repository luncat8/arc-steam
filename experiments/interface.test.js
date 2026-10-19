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
	assert.equal(dom.element('research-progress').textContent, '0 / ' + research.nodes.length);
	assert.equal(dom.element('prediction-status').hidden, true, 'the overlay stays hidden before its research');
	// The installed specification starts at base tuning.
	const spec = dom.element('platform-spec').children;
	assert.equal(spec[1].textContent, physics.config.platformMass.toFixed(1) + ' kg');
	assert.equal(spec[3].textContent, '400 N');
	assert.equal(spec[5].textContent, '10 m/s');
	assert.equal(spec[7].textContent, '36 J');
	assert.equal(spec[9].textContent, '90%');
	assert.equal(spec[13].textContent, '0%');
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
	dom.key('Space');
	assert.equal(dom.element('drive').getAttribute('aria-pressed'), 'true');
	assert.equal(dom.element('drive').firstChild.textContent, 'Drive on ');
	dom.key('KeyQ');
	assert.equal(dom.element('drive').getAttribute('aria-pressed'), 'false');
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
	assert.equal(dom.element('drive').getAttribute('aria-pressed'), 'true');
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
