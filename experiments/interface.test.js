'use strict';
// Interface smoke test without a browser: the real index.html wiring runs
// against experiments/dom.cjs, so panel building, gating, shortcuts, purchases,
// research and the ballistic overlay are all exercised end to end.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const dom = require('./dom.cjs');

dom.install();
const ceiling = require('../js/ceiling.js');
const equipment = require('../js/equipment.js');
const research = require('../js/research.js');
const physics = require('../js/physics.js');
const harness = require('./harness.cjs');
require('../js/prediction.js');
const help = require('../js/help.js');
const autopilot = require('../js/autopilot.js');
const players = require('../js/players.js');

// Capture the world the page owns so measured cargo sales can fund it.
let world = null;
const simulate = physics.step;
physics.step = function (stepped, dt) {
	world = stepped;
	return simulate(stepped, dt);
};
dom.loadMainScripts();

// The competitor plays its ball while the page runs, so the trajectory tests
// pin it at the far wall first: what they measure and assert is the rig's own
// motion, not where a rival chasing the same ball happens to have lifted it.
function parkRival() {
	const rival = players.state.rivals[0];
	rival.x = physics.platformMax();
	rival.vx = 0;
	rival.bot = false;
	rival.manual = 0;
	rival.target = NaN;
	rival.direction = 0;
	rival.braking = false;
	rival.tailLeft = 0;
	rival.tailRight = 0;
}

let clock = 0;
function advance(count) {
	for (let i = 0; i < count; i++) {
		clock += 1000 / 60;
		dom.frame(clock);
	}
}
function findRow(root, key, id) {
	if (root.dataset[key] === id) return root;
	for (const child of root.children) {
		const found = findRow(child, key, id);
		if (found) return found;
	}
	return null;
}
function findById(root, id) {
	if (root.id === id) return root;
	for (const child of root.children) {
		const found = findById(child, id);
		if (found) return found;
	}
	return null;
}
function countRows(root, key) {
	let total = key in root.dataset ? 1 : 0;
	for (const child of root.children) total += countRows(child, key);
	return total;
}
function nodeCard(id) { return findRow(dom.element('progression-tree'), 'node', id); }
function techRow(id) { return findRow(dom.element('progression-tree'), 'technology', id); }
function gearRow(id) { return findRow(dom.element('progression-tree'), 'item', id); }
function tierRow(family) { return findRow(dom.element('progression-tree'), 'family', family); }
// A row is heading, action cell, then detail; the action cell holds the
// purchase button and its preview mark side by side.
function buttonOf(target) { return target.children[1].children[0]; }
function previewMarkOf(target) { return target.children[1].children[1]; }
function selectOf(target) { return target.children[2]; }
function specValue(target, index) { return target.children[index].children[1].children[0].textContent; }
function specDelta(target, index) { return target.children[index].children[1].children[1].textContent; }
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
	const tree = dom.element('progression-tree');
	assert.equal(dom.elements.has('research-rows'), false, 'split research list is gone');
	assert.equal(dom.elements.has('equipment-rows'), false, 'split shop list is gone');
	assert.equal(dom.element('tree-links').children.length, 12, 'twelve prerequisite edges connect the tree');
	assert.equal(countRows(tree, 'node'), research.nodes.length, 'each technology has one node card');
	assert.equal(countRows(tree, 'technology'), research.nodes.length, 'no duplicate research rows');
	assert.equal(countRows(tree, 'item'), equipment.items.length, 'no duplicate equipment rows');
	assert.equal(countRows(tree, 'family'), 3, 'engines, radiators and strike balls each get one tier bay');
	assert.ok(research.nodes.every(node => techRow(node.id) && nodeCard(node.id)));
	assert.ok(equipment.items.every(item => gearRow(item.id)));
	assert.equal(gearRow('pad').parentElement, nodeCard('materials'), 'unlocked gear lives inside its research node');
	assert.equal(tierRow('radiators').parentElement, nodeCard('thermodynamics'));
	assert.equal(tierRow('balls').parentElement, nodeCard('impact'));
	assert.match(techRow('power').children[3].textContent, /Needs: Traction motors, Heat transfer/);
	// Hovering a node highlights its connected prerequisite and dependent edges.
	nodeCard('power').dispatch('pointerenter');
	assert.equal(dom.element('tree-links').children.filter(edge => edge.dataset.focus === 'true').length, 3);
	assert.equal(nodeCard('traction').dataset.linked, 'true');
	assert.equal(nodeCard('thermodynamics').dataset.linked, 'true');
	assert.equal(nodeCard('ballistics2').dataset.linked, 'true');
	nodeCard('power').dispatch('pointerleave');
	assert.equal(dom.element('tree-links').children.filter(edge => edge.dataset.focus === 'true').length, 0);
	assert.equal(dom.element('platform-spec').children.length, 10);
	assert.equal(dom.element('inventory-rows').children.length, ceiling.state.mineralNames.length);
	assert.match(dom.element('battery').textContent, /kJ$/);
	assert.match(dom.element('temperature').textContent, /°C$/);
	assert.match(dom.element('motion').textContent, /m\/s$/);
	assert.ok(Math.abs(parseFloat(dom.element('error').textContent)) < 1e-5);
	assert.equal(dom.element('drive').getAttribute('aria-pressed'), 'true', 'the bounce drive is enabled by default');
	assert.equal(dom.element('drive').firstChild.textContent, 'Drive on ');
	const graderButton = findById(tree, 'commercial-grader');
	assert.ok(graderButton, 'the commercial grader button is built in the base chassis root');
	assert.equal(graderButton.disabled, false, 'the grader hire button is always available');
	assert.equal(dom.element('research-progress').textContent, '0 / ' + research.nodes.length);
	assert.equal(dom.element('science-funds').textContent, '0.0 cr');
	assert.equal(dom.element('prediction-status').hidden, true, 'the overlay stays hidden before its research');
	// The installed specification starts at base tuning.
	const spec = dom.element('platform-spec').children;
	assert.equal(spec[0].children[1].children[0].textContent, physics.dryMass().toFixed(1) + ' kg');
	assert.equal(spec[1].children[1].children[0].textContent, physics.config.force.toFixed(0) + ' N');
	assert.equal(spec[2].children[1].children[0].textContent, physics.config.maxSpeed.toFixed(0) + ' m/s');
	assert.equal(spec[3].children[1].children[0].textContent, '42 J');
	assert.equal(spec[4].children[1].children[0].textContent, '90%');
	assert.equal(spec[9].children[1].children[0].textContent, '0%');
});

test('the player strip lists every player with money, a BOT switch and a control switch', () => {
	const list = dom.element('player-list');
	assert.equal(list.children.length, 2, 'the rig and its competitor each get a line');
	const rigRow = list.children[0];
	const rivalRow = list.children[1];
	assert.equal(rigRow.dataset.active, 'true');
	assert.equal(rigRow.children[0].children[1].textContent, 'YOU');
	assert.equal(rigRow.children[0].children[2].textContent, ceiling.state.funds.toFixed(1) + ' cr');
	const rivalBox = rivalRow.children[1].children[0];
	assert.equal(rivalBox.checked, true, 'the competitor starts bot controlled');
	// Every platform is the whole machine, so both hulls carry the same
	// machinery: chassis, deck, wheels, fuel bar, thermometer, collector and
	// reflector piston.
	const machinery = [];
	players.draw(dom.element('c').context, function (_context, player) { machinery.push(player.kind); });
	assert.deepEqual(machinery.slice().sort(), ['rig', 'rival'], 'both hulls draw the whole machine');
	// A command stays with the platform it was given to: the rig's travel target
	// is dropped when the competitor takes the keys.
	world.direction = 1;
	world.target = 8;
	// The line is the control switch: it hands the movement keys, travel click
	// and force slider to that platform.
	rivalRow.children[0].dispatch('click');
	assert.equal(players.state.active, 1);
	assert.equal(rivalRow.dataset.active, 'true');
	assert.equal(rigRow.dataset.active, 'false');
	// The menu is the machine's, and every platform is that machine: the panel
	// keeps the same controls under a new title instead of swapping its contents.
	assert.equal(dom.element('rig-drive').hidden, false, 'the machine controls stay on screen');
	assert.equal(dom.element('control-title').textContent, 'RIVAL 1 · BOT');
	// Taking the controls does not silence the policy: its BOT switch owns that.
	assert.equal(players.state.rivals[0].manual, 0, 'the competitor keeps its policy until a key is pressed');
	assert.equal(world.direction, 0, 'the rig stands down when the competitor takes the keys');
	assert.ok(Number.isNaN(world.target), 'and its travel target is dropped');
	// The checkbox is the policy switch and does not change the controlled player.
	rivalBox.checked = false;
	rivalBox.dispatch('change');
	assert.equal(players.state.players[1].bot, false);
	assert.equal(players.state.active, 1);
	assert.equal(dom.element('control-title').textContent, 'RIVAL 1 · MANUAL');
	rigRow.children[0].dispatch('click');
	assert.equal(players.state.active, 0);
	assert.equal(dom.element('control-title').textContent, 'YOU · MANUAL');
	// Restore the default policy for the remaining interface tests.
	rivalBox.checked = true;
	rivalBox.dispatch('change');
});

test('the BALLS setting changes the chamber between shared and owned balls', () => {
	const select = dom.element('balls');
	assert.equal(select.value, 'shared1');
	assert.equal(world.balls.length, 1, 'one shared ball by default');
	assert.equal(world.balls[0].owner, null);
	// A competitor ball is drawn and owned; the rig still reads its own ball.
	select.value = 'each';
	select.dispatch('change');
	assert.equal(players.state.ballMode, 'each');
	assert.equal(world.balls.length, 2);
	assert.deepEqual(world.balls.map(ball => ball.owner).sort(), ['rig', 'rival-1']);
	assert.equal(world.ball.owner, 'rig');
	// The change handler refreshes the panel, so the readout is right at once.
	assert.equal(dom.element('ball-energy').textContent.includes('balls'), false, 'one rig ball, no count');
	// Two shared balls are both the rig's, and the readout says so.
	select.value = 'shared2';
	select.dispatch('change');
	assert.equal(world.balls.length, 2);
	assert.deepEqual(world.balls.map(ball => ball.owner), [null, null]);
	assert.match(dom.element('ball-energy').textContent, /\u00b7 2 balls$/);
	assert.equal(select.value, 'shared2');
	// With two rig balls the autopilot's clause says which one it is working.
	world.platform.x = 8; world.platform.vx = 0; world.direction = 0; world.target = NaN;
	dom.element('auto-move').checked = true;
	dom.element('autopilot').dispatch('change', { target: dom.element('auto-move') });
	advance(8);
	assert.match(dom.element('autopilot-status').textContent, /^Intercept \u00b7 ball [12]\/2 \u00b7 /);
	dom.element('auto-move').checked = false;
	dom.element('autopilot').dispatch('change', { target: dom.element('auto-move') });
	assert.equal(dom.element('autopilot-status').hidden, true);
	// The help mark carries the new topic.
	const trigger = dom.element('help-balls');
	assert.equal(trigger.getAttribute('aria-controls'), 'help-drawer');
	assert.match(trigger.getAttribute('aria-label'), /^Help: /);
	assert.ok(help.find('balls'), 'the arrangement has a topic');
	// The drawer itself is left closed: the help test below opens it first.
	// Back to the default arrangement for the remaining tests.
	select.value = 'shared1';
	select.dispatch('change');
	assert.equal(world.balls.length, 1);
});

test('the controls and their readouts belong to the selected platform, not the rig', () => {
	const list = dom.element('player-list');
	// The rig drives at 60%; the competitor is switched in and given its own 90%.
	assert.equal(dom.element('force').value, '60');
	list.children[1].children[0].dispatch('click');
	assert.equal(dom.element('control-title').textContent, 'RIVAL 1 · BOT');
	dom.element('force').value = '90';
	dom.element('force').dispatch('input');
	assert.equal(dom.element('force-value').textContent, '90%');
	assert.equal(players.force(1), 0.9);
	assert.equal(players.force(0), 0.6, 'the rig keeps its own force setting');
	// Switching back restores the rig's own number instead of leaving the
	// competitor's value on the slider.
	list.children[0].children[0].dispatch('click');
	assert.equal(dom.element('force').value, '60');
	assert.equal(dom.element('control-title').textContent, 'YOU · MANUAL');
	assert.equal(dom.element('rig-drive').hidden, false);
	// A travel click while a competitor is selected commands that competitor.
	const rival = players.state.rivals[0];
	rival.bot = false;
	rival.manual = 0;
	rival.x = 18;
	rival.vx = 0;
	world.platform.x = 6;
	world.platform.vx = 0;
	world.target = NaN;
	list.children[1].children[0].dispatch('click');
	dom.element('c').dispatch('pointerdown', Object.assign(chamberPoint(14, 0.5), { pointerType: 'mouse', button: 0, preventDefault() {} }));
	assert.ok(Math.abs(rival.target - 14) < 0.4, 'the competitor takes the travel target');
	assert.ok(Number.isNaN(world.target), 'the rig is left alone');
	list.children[0].children[0].dispatch('click');
	world.platform.x = 12;
	world.platform.vx = 0;
	rival.x = 5;
	rival.bot = true;
	rival.target = NaN;
	rival.manual = 0;
	assert.equal(players.state.active, 0);
});

test('the machine keys stay live on the selected platform', () => {
	// Every platform is the same machine, so the panel that drives it is the same
	// panel: the drive, the release, the tilt and the autopilot duties answer for
	// whichever platform has the keys, instead of going dead with the switch.
	const list = dom.element('player-list');
	const rival = players.state.rivals[0];
	rival.bot = false;
	rival.direction = 0;
	rival.target = NaN;
	rival.manual = 0;
	list.children[1].children[0].dispatch('click');
	assert.equal(players.state.active, 1, 'the competitor takes the keys');
	assert.equal(dom.element('rig-drive').hidden, false, 'and the machine controls with it');
	dom.element('force').value = '50';
	dom.element('force').dispatch('input');
	// The drive toggle, the release and the tilt write the machine the keys drive.
	const driveBefore = dom.element('drive').getAttribute('aria-pressed');
	dom.key('Space');
	assert.notEqual(dom.element('drive').getAttribute('aria-pressed'), driveBefore, 'Space toggles the drive');
	dom.key('Space');
	dom.key('KeyX');
	assert.equal(autopilot.enabled('move'), true, 'the intercept engages');
	dom.key('KeyX');
	dom.key('KeyZ');
	assert.equal(autopilot.enabled('drive'), true, 'the drive keeper engages');
	dom.key('KeyZ');
	dom.key('KeyC');
	assert.equal(autopilot.enabled('angle'), true, 'the level bounce engages');
	dom.key('KeyC');
	assert.equal(autopilot.enabled('move'), false);
	assert.equal(autopilot.enabled('drive'), false);
	assert.equal(autopilot.enabled('angle'), false);
	// The movement keys still address only the selected platform, never both.
	assert.equal(world.direction, 0, 'the rig gets no command from the competitor selection');
	assert.ok(Number.isNaN(world.target));
	// The force keys edit the selected platform's own setting.
	const rigForce = world.forceSetting;
	dom.key('KeyW');
	assert.equal(players.force(1), 0.6, 'the competitor takes the force step');
	assert.equal(world.forceSetting, rigForce, 'the rig keeps its own force');
	dom.element('force').value = '60';
	dom.element('force').dispatch('input');
	list.children[0].children[0].dispatch('click');
	assert.equal(players.state.active, 0);
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
	countText(dom.element('status-ball'));
	countText(dom.element('fact-reserve'));
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
	assert.match(dom.element('progression-status').textContent, /needs the Rebound materials research first/);
	const materials = techRow('materials');
	assert.equal(materials.dataset.state, 'available');
	assert.equal(buttonOf(materials).textContent, 'Research');
	assert.equal(buttonOf(materials).getAttribute('aria-disabled'), 'true', 'available but not funded yet');
	buttonOf(materials).dispatch('click');
	assert.match(dom.element('progression-status').textContent, /Not enough funds for Rebound materials \(180 cr needed\)/);
	const ballistics = techRow('ballistics');
	assert.equal(ballistics.dataset.state, 'locked');
	buttonOf(ballistics).dispatch('click');
	assert.match(dom.element('progression-status').textContent, /stays locked until Pulse electromagnetics is researched/);
	assert.match(ballistics.children[3].textContent, /Needs: Pulse electromagnetics/);
	buttonOf(tierRow('radiators')).dispatch('click');
	assert.match(dom.element('progression-status').textContent, /need the Heat transfer research first/);
	buttonOf(tierRow('balls')).dispatch('click');
	assert.match(dom.element('progression-status').textContent, /need the Impact forging research first/);
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
	assert.equal(nodeCard('materials').dataset.state, 'researched');
	assert.equal(buttonOf(techRow('materials')).textContent, 'Done');
	assert.equal(dom.element('research-progress').textContent, '1 / ' + research.nodes.length);
	assert.match(dom.element('progression-status').textContent, /^Researched Rebound materials at /);
	const pad = gearRow('pad');
	assert.equal(pad.dataset.state, 'available');
	assert.equal(buttonOf(pad).textContent, 'Buy');
	fund(equipment.find('pad').cost);
	assert.equal(dom.element('science-funds').textContent, ceiling.state.funds.toFixed(1) + ' cr');
	buttonOf(pad).dispatch('click');
	assert.match(dom.element('progression-status').textContent, /^Installed Rebound pad at /);
	assert.equal(pad.dataset.state, 'installed');
	const spec = dom.element('platform-spec').children;
	assert.equal(spec[0].children[1].children[0].textContent, physics.dryMass().toFixed(1) + ' kg');
	assert.equal(spec[4].children[1].children[0].textContent, '94%', 'research and pad retention stack');
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
	// The computer is the selected platform's, so its readout names that machine.
	assert.match(status.textContent, /^Rig · landing on the ground at \d+\.\d m in \d+\.\d\d s · ghost coasts to \d+\.\d m · intercept short by \d+\.\d m at full thrust$/);
	dom.contextCalls.length = 0;
	advance(1);
	assert.ok(dom.contextCalls.includes('setLineDash'), 'the predicted path is drawn dashed');
	assert.ok(dom.contextCalls.includes('strokeRect'), 'the intercept ghost is drawn');
	assert.ok(Math.abs(parseFloat(dom.element('error').textContent)) < 1e-4, dom.element('error').textContent);
});

test('the market panel recharges the reserve from measured funds', () => {
	world.battery = harness.c.battery;
	world.drive = false;
	harness.sync(world);
	advance(8);
	assert.equal(dom.element('fuel-price').textContent, String(ceiling.state.fuelPrice));
	assert.equal(dom.element('refuel-cost').textContent, '0.0 cr');
	assert.equal(dom.element('refuel').textContent, 'Reserve full');
	assert.equal(dom.element('refuel').disabled, true, 'a full reserve cannot be recharged');
	world.battery = 2000;
	harness.sync(world);
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
	// Staging a catch is not a wall crash; don't inherit a previous test's speed.
	world.platform.vx = 0; world.direction = 0; world.target = NaN;
	harness.sync(world);
	const state = ceiling.state;
	const target = state.extractedCells + count;
	for (let x = 1; x < 23 && state.extractedCells < target; x += 2) { ceiling.damage(x, ceiling.state.bottom + 0.2, 20); ceiling.collapse(2); }
	let prepared = 0;
	for (let i = 0; i < state.active.length && prepared < count; i++) {
		if (!state.active[i]) continue;
		state.debrisX[i] = world.platform.x - 1;
		state.debrisY[i] = 0.701;
		state.debrisVx[i] = 0;
		state.debrisVy[i] = -1;
		prepared += state.debrisCells[i] || 1;
	}
	harness.sync(world);
	physics.step(world, physics.config.step);
}

// The shim canvas is 1000 × 420, matching the page's own view and margins.
// The page publishes its chamber fit, so a world point maps to a page point
// exactly as the renderer does it.
function chamberPoint(worldX, worldY) {
	const view = globalThis.SteamView;
	return { clientX: view.offsetX + worldX * view.scale, clientY: view.floorY - worldY * view.scale };
}

test('hovering rock shows its tooltip and clicking low commands travel, without inspector sliders', () => {
	assert.equal(dom.elements.has('mineral-column'), false, 'the column slider is gone');
	assert.equal(dom.elements.has('mineral-layer'), false, 'the layer slider is gone');
	world.platform.x = 12; world.platform.vx = 0; world.target = NaN; world.direction = 0;
	advance(8);
	const state = ceiling.state;
	let column = 0;
	while (column < state.columns - 1 && state.firstRow[column] >= state.rows) column++;
	const rockTop = (state.drawnRowY[state.rows - 1] + state.drawnRowY[state.rows]) * 0.5;
	const rock = chamberPoint((column + 0.5) * state.cell, rockTop);
	dom.element('c').dispatch('pointermove', rock);
	assert.equal(dom.element('mineral-tooltip').hidden, false, 'the inspector appears only over rock');
	dom.element('c').dispatch('pointerdown', rock);
	assert.equal(dom.element('mineral-cell').textContent, 'Column ' + (column + 1) + ' / ' + state.columns + ' · Layer ' + state.rows + ' / ' + state.rows);
	assert.ok(Number.isNaN(world.target), 'a rock click must not move the platform');
	dom.element('c').dispatch('pointerleave');
	assert.equal(dom.element('mineral-tooltip').hidden, true, 'leaving the canvas hides the inspector');
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

test('the chamber wheel and slider tilt the selected platform only', () => {
	const list = dom.element('player-list');
	const rival = players.state.rivals[0];
	assert.equal(players.state.active, 0);
	// Take the competitor's controls: the wheel must now steer its piston.
	list.children[1].children[0].dispatch('click');
	assert.equal(players.state.active, 1);
	dom.element('c').dispatch('wheel', { deltaY: -100 });
	assert.ok(Math.abs(rival.pistonAngle - 4 * Math.PI / 180) < 1e-12, 'one notch tilts the selected competitor about four degrees');
	assert.equal(world.pistonAngle, 0, 'the rig piston is not touched by the wheel');
	assert.equal(dom.element('piston-value').textContent, '4.0°', 'the slider reads the selected platform');
	// The slider writes the same platform's angle.
	dom.element('piston-angle').value = '-3';
	dom.element('piston-angle').dispatch('input');
	assert.ok(Math.abs(rival.pistonAngle + 3 * Math.PI / 180) < 1e-12);
	assert.equal(world.pistonAngle, 0);
	// Back on the rig the wheel and the slider follow the rig again, and the
	// competitor keeps the angle it was left at.
	list.children[0].children[0].dispatch('click');
	assert.equal(players.state.active, 0);
	assert.equal(dom.element('piston-value').textContent, '0.0°', 'the switch shows the rig angle at once');
	dom.element('c').dispatch('wheel', { deltaY: -100 });
	assert.ok(Math.abs(world.pistonAngle - 4 * Math.PI / 180) < 1e-12, 'the wheel drives the rig again');
	assert.ok(Math.abs(rival.pistonAngle + 3 * Math.PI / 180) < 1e-12, 'the competitor keeps its own angle');
	// Leave the page on the rig with a zero angle for the later tests.
	dom.element('piston-angle').value = '0';
	dom.element('piston-angle').dispatch('input');
	rival.pistonAngle = 0;
});

test('the autopilot switches, shortcuts and manual overrides share one writer', () => {
	parkRival();
	world.heat = 0; world.battery = physics.config.battery;
	harness.sync(world);
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
	world.ball.state = 'held'; world.ball.holder = 'rig'; world.ball.vx = 0; world.ball.vy = 0; world.drive = false;
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

test('the status bar keeps the facts and only the messages that apply now', () => {
	for (const channel of ['move', 'smart', 'drive', 'angle']) autopilot.set(channel, false);
	autopilot.reset();
	world.platform.x = 3; world.platform.vx = 0; world.target = NaN; world.direction = 0;
	world.ball.state = 'held'; world.ball.holder = 'rig'; world.drive = true;
	world.battery = physics.config.battery;
	harness.sync(world);
	advance(8);
	const ball = dom.element('status-ball');
	const energy = dom.element('status-energy');
	assert.equal(dom.element('fact-reserve').textContent, (world.battery / 1000).toFixed(2) + ' kJ');
	assert.equal(dom.element('fact-cargo').textContent, ceiling.state.cargoCells + '/' + ceiling.state.storageLimit);
	assert.match(dom.element('fact-temp').textContent, /^-?\d+ °C$/);
	assert.equal(energy.hidden, true, 'a full reserve says nothing');
	assert.match(ball.textContent, /^Ball held · press E to release/);
	assert.equal(ball.dataset.tone, 'info');

	// A grounded ball is collected when it rests under the platform, so it lies elsewhere.
	world.ball.state = 'grounded';
	world.ball.x = 20;
	advance(8);
	assert.equal(ball.textContent, 'Ball grounded · move over it to collect');
	assert.equal(ball.dataset.tone, 'warn', 'the grounded ball is an orange message');

	// A low reserve on the ground adds the red message with both ways out ...
	world.battery = physics.config.battery * 0.05;
	advance(8);
	assert.equal(dom.element('fact-reserve').dataset.tone, 'warn');
	assert.equal(energy.hidden, false);
	assert.equal(energy.textContent, 'Park on the centre pad to refill · click low ground to travel');
	assert.equal(energy.dataset.tone, 'danger');
	// ... and standing on the pad ends it, because the advice is being followed.
	world.platform.x = physics.config.width * 0.5;
	advance(8);
	assert.equal(energy.hidden, true, 'the pad already refills, so the bar stops asking');

	world.battery = physics.config.battery;
	world.ball.state = 'held';
	advance(8);
	assert.equal(energy.hidden, true);
	// Both hints moved out of the menu, where the drive panel used to carry them.
	const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
	assert.ok(html.includes('id="status-ball"'), 'the bar carries the ball message');
	assert.doesNotMatch(html, /id="status"/);
	assert.doesNotMatch(html, /click low ground to travel<\/p>/);
});

test('the centre pad is read as charging and uses the selected source reload rate', () => {
	for (const channel of ['move', 'smart', 'drive', 'angle']) autopilot.set(channel, false);
	autopilot.reset();
	world.platform.x = 12; world.platform.vx = 0; world.target = NaN; world.direction = 0;
	world.battery = 0;
	harness.sync(world);
	advance(8);
	assert.match(dom.element('reserve-note').textContent, /^Charging [\d.]+ kW/);
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
	assert.equal(specValue(dom.element('platform-spec'), 0), physics.config.platformMass.toFixed(1) + ' kg');
	assert.equal(dom.element('prediction-status').hidden, true);
	assert.equal(dom.element('progression-status').textContent, 'Sell cargo at a wall to fund research and shop gear.');
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
	assert.match(dom.element('progression-status').textContent, /all 10 technologies researched and all 8 equipment items installed/);
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
	assert.match(dom.element('progression-status').textContent, /remain active until New game/);
	dom.element('reset').dispatch('click');
	assert.equal(research.state.completed, 0, 'a fresh non-test game clears research');
	assert.ok(equipment.items.every(item => !equipment.isInstalled(item.id)));
	assert.equal(dom.element('test-mode').checked, false);
});

test('B and Shift+B hold braking, override travel, and release cleanly', () => {
	dom.element('reset').dispatch('click');
	advance(2);
	world.platform.x = 3;
	world.platform.vx = 3;
	world.target = 20;
	harness.sync(world);
	dom.key('KeyB');
	assert.ok(world.brake);
	assert.ok(Number.isNaN(world.target));
	advance(100);
	assert.ok(Math.abs(world.platform.vx) < 1e-6);
	dom.keyUp('KeyB');
	assert.equal(world.brake, false);
	dom.key('KeyB', { shiftKey: true });
	assert.ok(world.brake);
	dom.keyUp('KeyB');
	assert.equal(world.brake, false);
});

test('tier selector bays buy/install engines at left shop and swap owned tiers free', () => {
	for (const channel of ['move', 'smart', 'drive', 'angle']) autopilot.set(channel, false);
	dom.element('reset').dispatch('click');
	advance(2);
	const engines = tierRow('engines');
	const engineSelect = selectOf(engines);
	const engineButton = buttonOf(engines);
	assert.equal(engineSelect.value, 'electric');
	assert.equal(engineButton.textContent, 'Installed');
	engineSelect.value = 'hand';
	engineSelect.dispatch('change');
	assert.equal(engineButton.textContent, 'Buy & install');
	assert.equal(engineButton.getAttribute('aria-disabled'), 'true');
	engineButton.dispatch('click');
	assert.match(dom.element('progression-status').textContent, /Park at the left shop/);
	fund(equipment.engineCosts.hand);
	world.platform.x = physics.platformMin(); world.platform.vx = 0;
	world.direction = 0; world.target = NaN;
	harness.sync(world);
	advance(8);
	assert.equal(engineButton.getAttribute('aria-disabled'), 'false');
	engineButton.dispatch('click');
	assert.equal(physics.engineNow().id, 'hand');
	assert.equal(engineButton.textContent, 'Installed');
	engineSelect.value = 'electric';
	engineSelect.dispatch('change');
	assert.equal(engineButton.textContent, 'Install free');
	const funds = ceiling.state.funds;
	engineButton.dispatch('click');
	assert.equal(physics.engineNow().id, 'electric');
	assert.equal(engineButton.textContent, 'Installed');
	assert.equal(ceiling.state.funds, funds);

	// Radiators and strike balls unlock inside their research node cards and swap owned tiers free.
	study('thermodynamics');
	const radiators = tierRow('radiators');
	assert.equal(selectOf(radiators).value, 'vent');
	assert.equal(buttonOf(radiators).textContent, 'Buy & install');
	fund(300);
	buttonOf(radiators).dispatch('click');
	assert.equal(equipment.installedRadiator(), 'vent');
	assert.equal(buttonOf(radiators).textContent, 'Installed');

	study('impact');
	const balls = tierRow('balls');
	assert.equal(selectOf(balls).value, 'hardened');
	assert.equal(buttonOf(balls).textContent, 'Buy & install');
	fund(380);
	buttonOf(balls).dispatch('click');
	assert.equal(equipment.installedBall(), 'hardened');
	selectOf(balls).value = 'standard';
	selectOf(balls).dispatch('change');
	assert.equal(buttonOf(balls).textContent, 'Install free');
	buttonOf(balls).dispatch('click');
	assert.equal(equipment.installedBall(), 'standard');
});

test('commercial grader button toggles call/dismiss and can cancel a return', () => {
	dom.element('reset').dispatch('click');
	advance(2);
	const button = findById(dom.element('progression-tree'), 'commercial-grader');
	const bot = ceiling.state.graderBot;
	assert.match(button.textContent, /^Call · 50% share/);
	assert.equal(button.getAttribute('aria-pressed'), 'false');
	assert.equal(bot.x, ceiling.state.garageParkX);
	button.dispatch('click');
	assert.equal(bot.active, true);
	assert.match(button.textContent, /^Dismiss · return/);
	assert.equal(button.getAttribute('aria-pressed'), 'true');
	assert.match(dom.element('progression-status').textContent, /^Grader called/);
	const dispatchX = bot.x;
	advance(120);
	assert.ok(bot.x < dispatchX, 'the called grader physically leaves its bay');
	button.dispatch('click');
	assert.equal(bot.active, false);
	assert.equal(bot.returning, true);
	assert.match(button.textContent, /^Call · cancel return/);
	assert.match(dom.element('progression-status').textContent, /^Grader dismissed · returning/);
	const returnX = bot.x;
	advance(30);
	assert.ok(bot.x > returnX, 'dismissal returns the vehicle instead of despawning it');
	button.dispatch('click');
	assert.equal(bot.active, true);
	assert.equal(bot.returning, false);
	assert.match(dom.element('progression-status').textContent, /^Grader return cancelled/);
	button.dispatch('click');
	assert.equal(bot.returning, true);
});

test('telemetry cards open the market and science drawers', () => {
	assert.equal(dom.elements.has('help-inspector'), false, 'the inspector help mark is removed');
	assert.equal(help.find('inspector'), undefined, 'the inspector help topic is removed');
	assert.equal(dom.element('science-drawer').hidden, true);
	assert.equal(dom.element('market-drawer').hidden, true);
	dom.element('science-open').dispatch('click');
	assert.equal(dom.element('science-drawer').hidden, false, 'funds opens science and shop');
	assert.equal(dom.element('science-open').getAttribute('aria-expanded'), 'true');
	assert.ok(dom.element('tree-links').children.every(edge => edge.getAttribute('d')), 'opening the drawer lays out SVG connector paths');
	dom.element('market-open').dispatch('click');
	assert.equal(dom.element('science-drawer').hidden, true);
	assert.equal(dom.element('market-drawer').hidden, false, 'cargo storage opens market and ledger');
	assert.equal(dom.element('market-open').getAttribute('aria-expanded'), 'true');
	dom.key('Escape');
	assert.equal(dom.element('market-drawer').hidden, true);
	assert.equal(dom.element('market-open').getAttribute('aria-expanded'), 'false');
});

test('context help lives in one drawer, and the panels keep short lines only', () => {
	// The explanations moved out of the panels, so the workspace stays compact.
	assert.ok(help.find('progression'), 'one unified Sci+Shop progression topic replaces split topics');
	assert.equal(help.find('research'), undefined);
	assert.equal(help.find('equipment'), undefined);
	for (const node of ['progression-status', 'transaction-status', 'mineral-price']) assert.ok(dom.element(node).textContent.length < 120);
	// Every topic has one mark, every mark points at the drawer, and the index
	// lists all of them.
	for (const topic of help.topics) {
		const trigger = dom.element('help-' + topic.id);
		assert.equal(trigger.getAttribute('aria-expanded'), 'false', topic.id);
		assert.equal(trigger.getAttribute('aria-controls'), 'help-drawer', topic.id);
		// The ? marks carry a spoken name; the system-bar HELP button names its shortcut.
		const label = trigger.getAttribute('aria-label');
		if (label) assert.match(label, /^Help: /, topic.id);
		else assert.equal(trigger.getAttribute('aria-keyshortcuts'), 'H', 'the HELP button names its shortcut');
	}
	assert.equal(dom.element('help-index').children.length, help.topics.length);
	assert.equal(dom.element('help-drawer').dataset.open, 'false');
	assert.equal(dom.element('help-drawer').getAttribute('aria-hidden'), 'true');
	assert.equal(dom.element('help-body').children.length, 0, 'nothing is rendered before the first open');

	// A precise pointer previews on hover without taking focus. Compare identity
	// with ===, not assert.equal: two shim elements differ and the diff inspects
	// the whole cyclic shim.
	const focused = dom.document.activeElement;
	dom.element('help-tilt').dispatch('pointerenter');
	assert.equal(dom.element('help-drawer').dataset.open, 'true');
	assert.equal(dom.element('help-title').textContent, help.find('tilt').title);
	assert.equal(dom.element('help-drawer').getAttribute('aria-hidden'), 'false');
	assert.equal(dom.element('help-tilt').getAttribute('aria-expanded'), 'true');
	assert.equal(dom.element('help-body').children.length, help.find('tilt').text.length + 1, 'paragraphs plus the key list');
	assert.ok(dom.document.activeElement === focused, 'hover never moves focus');

	// Moving to another mark retargets the drawer and collapses the previous mark.
	dom.element('help-autopilot').dispatch('pointerenter');
	assert.equal(dom.element('help-title').textContent, help.find('autopilot').title);
	assert.equal(dom.element('help-tilt').getAttribute('aria-expanded'), 'false');
	assert.equal(dom.element('help-autopilot').getAttribute('aria-expanded'), 'true');

	dom.key('Escape');
	assert.equal(dom.element('help-drawer').dataset.open, 'false');
	assert.equal(dom.element('help-drawer').getAttribute('aria-hidden'), 'true');

	// Touch and stylus ignore hover; a tap is the whole interaction.
	dom.pointerMedia.matches = false;
	dom.element('help-cargo').dispatch('pointerenter');
	assert.equal(dom.element('help-drawer').dataset.open, 'false', 'touch stays tap-only');
	dom.element('help-cargo').dispatch('click');
	assert.equal(dom.element('help-title').textContent, help.find('cargo').title);
	assert.equal(dom.element('help-cargo').getAttribute('aria-expanded'), 'true');
	dom.pointerMedia.matches = true;
	dom.element('help-close').dispatch('click');
	assert.equal(dom.element('help-drawer').dataset.open, 'false');

	// The index switches topic inside the open drawer; a mark toggles its topic.
	dom.element('help-keys').dispatch('click');
	assert.equal(dom.element('help-title').textContent, help.find('keys').title);
	dom.element('help-index').children[3].dispatch('click');
	assert.equal(dom.element('help-title').textContent, help.topics[3].title);
	assert.equal(dom.element('help-index').children[3].dataset.active, 'true');
	assert.equal(dom.element('help-index').children[0].dataset.active, 'false');
	// With a hovering pointer a click pins the preview instead of closing it;
	// on touch the same mark toggles, so a tap is the whole interaction.
	dom.element('help-movement').dispatch('click');
	assert.equal(dom.element('help-drawer').dataset.open, 'true', 'a hover click pins the preview');
	dom.pointerMedia.matches = false;
	dom.element('help-movement').dispatch('click');
	assert.equal(dom.element('help-drawer').dataset.open, 'false', 'the same mark closes what it opened on touch');
	dom.element('help-movement').dispatch('click');
	assert.equal(dom.element('help-drawer').dataset.open, 'true', 'and opens it again');
	dom.pointerMedia.matches = true;

	// H and F1 toggle from anywhere and reopen the last topic read.
	dom.key('KeyH');
	assert.equal(dom.element('help-drawer').dataset.open, 'false', 'H closes the open drawer');
	dom.key('KeyH');
	assert.equal(dom.element('help-drawer').dataset.open, 'true');
	assert.equal(dom.element('help-title').textContent, help.find('movement').title, 'H reopens the last topic read');
	dom.key('F1');
	assert.equal(dom.element('help-drawer').dataset.open, 'false', 'F1 does the same');
	assert.equal(help.find('nope'), undefined);
});

test('holding a panel opens that panel\'s topic, and a moving pointer cancels the hold', async () => {
	const marker = dom.element('cargo-mass');
	marker.dataset.topic = 'cargo';
	const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

	dom.document.dispatch('pointerdown', { target: marker, clientX: 10, clientY: 10 });
	await wait(700);
	assert.equal(dom.element('help-drawer').dataset.open, 'true', 'a half-second hold opens the panel topic');
	assert.equal(dom.element('help-title').textContent, help.find('cargo').title);
	dom.document.dispatch('pointerup', { target: marker, clientX: 10, clientY: 10 });
	dom.element('help-close').dispatch('click');

	// Pressing a button, the chamber or a control is never a hold gesture.
	dom.document.dispatch('pointerdown', { target: dom.element('help-drive'), clientX: 10, clientY: 10 });
	dom.document.dispatch('pointerdown', { target: dom.element('c'), clientX: 10, clientY: 10 });
	await wait(700);
	assert.equal(dom.element('help-drawer').dataset.open, 'false');
	dom.document.dispatch('pointerup', { target: marker, clientX: 10, clientY: 10 });

	// Dragging away before the hold completes cancels it.
	dom.document.dispatch('pointerdown', { target: marker, clientX: 10, clientY: 10 });
	dom.document.dispatch('pointermove', { target: marker, clientX: 90, clientY: 10 });
	await wait(700);
	assert.equal(dom.element('help-drawer').dataset.open, 'false', 'a drag is not a hold');
	dom.document.dispatch('pointerup', { target: marker, clientX: 90, clientY: 10 });
	delete marker.dataset.topic;
});

test('a held key stays with the platform it was pressed for and never drives both', () => {
	// The reported bug: holding a direction while clicking the other player line
	// left the platform just left still driving. Keys address the selected
	// platform, so a switch drops the held keys and the command with them, and
	// pressing again drives only the platform in the title.
	const list = dom.element('player-list');
	const rival = players.state.rivals[0];
	rival.bot = false;
	rival.x = 18; rival.vx = 0; rival.direction = 0; rival.target = NaN; rival.manual = 0;
	world.platform.x = 6; world.platform.vx = 0; world.direction = 0; world.target = NaN; world.brake = false;
	assert.equal(players.state.active, 0);
	dom.key('KeyD');
	assert.equal(world.direction, 1, 'the rig takes the key');
	assert.equal(rival.direction, 0, 'the competitor does not');
	list.children[1].children[0].dispatch('click');
	assert.equal(players.state.active, 1);
	assert.equal(world.direction, 0, 'the rig stands down with the switch');
	assert.equal(rival.direction, 0, 'and the key is not re-issued to the platform just taken');
	advance(60);
	assert.equal(world.direction, 0, 'the rig never resumes the dropped key');
	// A second press belongs to the selected platform alone.
	dom.key('KeyA');
	assert.equal(rival.direction, -1, 'the competitor takes the fresh key');
	assert.equal(world.direction, 0, 'the rig stays out of it');
	dom.keyUp('KeyA');
	assert.equal(rival.direction, 0);
	// And a key pressed on the competitor is dropped by the switch back.
	dom.key('KeyA');
	assert.equal(rival.direction, -1);
	list.children[0].children[0].dispatch('click');
	assert.equal(world.direction, 0);
	assert.equal(rival.direction, 0, 'the competitor stands down with the switch');
	dom.keyUp('KeyA');
	assert.equal(world.direction, 0, 'the release of a dropped key never moves the rig');
	rival.bot = true;
});

test('switching platforms changes the title and nothing else in the menu', () => {
	// The reported bug: the menu changed when a row was clicked. Every platform is
	// the same machine, so the same panel drives it — only the name in the title
	// and the policy after the dot move, and the telemetry stays put.
	const list = dom.element('player-list');
	const rigDrive = dom.element('rig-drive');
	const forceBefore = dom.element('force').value;
	const cargoBefore = dom.element('cargo').textContent;
	const fundsBefore = dom.element('funds').textContent;
	const massBefore = dom.element('platform-mass').textContent;
	assert.equal(dom.element('control-title').textContent, 'YOU · MANUAL');
	list.children[1].children[0].dispatch('click');
	assert.equal(dom.element('control-title').textContent.startsWith('RIVAL 1 · '), true);
	assert.equal(rigDrive.hidden, false, 'the machine controls do not leave the panel');
	// Every control in the block is still reachable for the selected platform.
	assert.equal(dom.element('drive').disabled, false);
	assert.equal(dom.element('piston-angle').disabled, false);
	assert.equal(dom.element('auto-move').disabled, false);
	assert.equal(dom.element('force').value, forceBefore, 'the slider still reads the platform force');
	assert.equal(dom.element('cargo').textContent, cargoBefore, 'the telemetry does not move with the switch');
	assert.equal(dom.element('funds').textContent, fundsBefore);
	assert.equal(dom.element('platform-mass').textContent, massBefore);
	list.children[0].children[0].dispatch('click');
	assert.equal(dom.element('control-title').textContent, 'YOU · MANUAL');
	assert.equal(rigDrive.hidden, false);
});

test('the science and shop drawer spends the selected rival purse only', () => {
	dom.element('reset').dispatch('click');
	advance(2);
	const rival = players.state.rivals[0];
	players.setBot(1, false);
	rival.x = physics.platformMax();
	rival.vx = 0;
	rival.cargoCells = 100;
	rival.cargoValue = 2000;
	advance(1);
	assert.equal(rival.money, 2000);
	const list = dom.element('player-list');
	list.children[1].children[0].dispatch('click');
	assert.match(dom.element('science-title').textContent, /RIVAL 1/);
	buttonOf(techRow('materials')).dispatch('click');
	assert.equal(research.isResearched('materials', rival.id), true);
	assert.equal(research.isResearched('materials', 'rig'), false);
	buttonOf(gearRow('pad')).dispatch('click');
	assert.equal(equipment.isInstalled('pad', rival.id), true);
	assert.equal(equipment.isInstalled('pad', 'rig'), false);
	assert.equal(rival.money, 1570);
	assert.equal(ceiling.state.funds, 0, 'neither purchase can debit the rig');
	assert.equal(dom.element('science-funds').textContent, '1570.0 cr');
	list.children[0].children[0].dispatch('click');
	assert.equal(buttonOf(techRow('materials')).textContent, 'Research');
	assert.equal(dom.element('science-funds').textContent, '0.0 cr');
});

test('the computer, the release and the ball readout belong to the selected platform', () => {
	const list = dom.element('player-list');
	const rival = players.state.rivals[0];
	const computer = globalThis.SteamPrediction;
	advance(1);
	// A later test may have reset the chamber, and the computer needs its research.
	study('ballistics');
	advance(1);
	players.setBallMode('shared1');
	const ball = world.balls[0];
	// One shared ball in flight, the two platforms parked apart and neither
	// driving: what moves here is the computer, not the chamber.
	world.platform.x = 3;
	world.platform.vx = 0;
	world.platform.direction = 0;
	world.direction = 0;
	world.target = NaN;
	world.brake = false;
	world.drive = false;
	rival.bot = false;
	rival.manual = 0;
	rival.x = 19;
	rival.vx = 0;
	rival.direction = 0;
	rival.target = NaN;
	rival.braking = false;
	ball.state = 'flying';
	ball.holder = null;
	ball.x = 12;
	ball.y = 4;
	ball.vx = 1;
	ball.vy = 0;
	harness.sync(world);
	players.setActive(0);
	advance(10);
	assert.equal(computer.platformId, 'rig');
	assert.match(dom.element('prediction-status').textContent, /^Rig \u00b7 /);
	// Take the competitor: the same computer now describes its machine and the
	// ball it may push, and the panel says so.
	list.children[1].children[0].dispatch('click');
	assert.equal(players.state.active, 1);
	advance(1);
	assert.equal(dom.element('prediction-status').hidden, true, 'the rig\'s research does not give the rival a computer');
	assert.equal(computer.pathCount, 0, 'a machine without its own computer has no page paths');
	research.grant('ballistics', world, rival.id);
	advance(10);
	assert.equal(computer.platformId, rival.id, 'the computer follows the selected platform');
	assert.equal(computer.ball, ball, 'it describes the ball that platform may push');
	assert.match(dom.element('prediction-status').textContent, /^RIVAL 1 \u00b7 /);
	assert.ok(Math.abs(computer.state.ghostX - rival.x) < Math.abs(computer.state.ghostX - world.platform.x), 'the ghost is the selected platform');
	// The rig's own plan runs while the competitor is selected; its flight is
	// never left on the overlay the player is reading.
	dom.element('auto-move').checked = true;
	dom.element('autopilot').dispatch('change', { target: dom.element('auto-move') });
	advance(30);
	assert.equal(computer.platformId, rival.id, 'the rig plan never takes the page computer over');
	assert.equal(computer.ball, ball);
	assert.match(dom.element('prediction-status').textContent, /^RIVAL 1 \u00b7 /);
	dom.element('auto-move').checked = false;
	dom.element('autopilot').dispatch('change', { target: dom.element('auto-move') });
	// The competitor catches the ball in its own collector, and the release key
	// spends the competitor's drive, not the rig's reserve.
	world.platform.x = 2;
	world.direction = 0;
	world.target = NaN;
	ball.state = 'flying';
	ball.holder = null;
	const config = physics.config;
	ball.x = rival.x - config.platformWidth * 0.5 + config.platformWidth * config.collectorFraction * 0.5;
	ball.y = rival.y + config.deck + 0.6;
	ball.vx = 0;
	ball.vy = -2;
	rival.drive = true;
	advance(40);
	assert.equal(ball.state, 'held', 'the competitor collector caught the ball');
	assert.equal(ball.holder, rival.id);
	assert.match(dom.element('ball-energy').textContent, /^0\.0 J$/, 'the readout follows the caught ball');
	const battery = world.battery;
	rival.drive = true;
	dom.key('KeyE');
	assert.equal(ball.state, 'flying', 'the release belongs to the platform that holds the ball');
	assert.ok(ball.vy > 0);
	assert.equal(world.battery, battery, 'the competitor release does not spend the rig reserve');
	// Back on the rig the computer is the rig's again.
	list.children[0].children[0].dispatch('click');
	advance(10);
	assert.equal(computer.platformId, 'rig');
	assert.match(dom.element('prediction-status').textContent, /^Rig \u00b7 /);
	rival.bot = true;
	world.drive = false;
});

test('the GROUND selector changes the chamber rule and keeps it across New game', () => {
	const select = dom.element('ground-bounce');
	assert.equal(select.value, 'absorb');
	assert.equal(physics.groundRetentionNow(), 0);
	assert.ok(help.find('ground'), 'the setting has its own help topic');
	assert.equal(dom.element('help-ground').getAttribute('aria-controls'), 'help-drawer');
	select.value = 'half';
	select.dispatch('change');
	assert.equal(physics.groundRetentionNow(), 0.5);
	assert.equal(physics.groundBounceMode, 'half');
	// A ball dropped away from both decks rebounds instead of grounding.
	parkRival();
	const rival = players.state.rivals[0];
	rival.drive = false;
	rival.previousX = rival.x; rival.previousY = rival.y; rival.previousAngle = rival.angle;
	players.setActive(0);
	world.platform.x = 3; world.platform.vx = 0; world.direction = 0; world.target = NaN; world.drive = false;
	world.platform.previousX = 3; world.platform.previousY = 0; world.platform.previousAngle = 0;
	const ball = world.ball;
	ball.state = 'flying'; ball.holder = null;
	ball.x = 20; ball.y = 3; ball.vx = 0; ball.vy = 0;
	harness.sync(world);
	let arriving = 0, leaving = 0;
	for (let i = 0; i < 240 * 4; i++) {
		const before = ball.vy;
		physics.step(world, physics.config.step);
		assert.notEqual(ball.state, 'grounded', 'a half-energy ground does not ground the ball');
		if (before < 0 && ball.vy > 0 && ball.y < 1) { arriving = before; leaving = ball.vy; break; }
	}
	assert.ok(arriving < 0, 'the ball reached the floor');
	assert.ok(Math.abs(leaving / -arriving - Math.sqrt(0.5)) < 0.01);
	// New game rebuilds the world but keeps the bar's choice.
	dom.element('reset').dispatch('click');
	advance(2);
	assert.equal(select.value, 'half');
	assert.equal(physics.groundRetentionNow(), 0.5);
	assert.equal(physics.groundBounceMode, 'half');
	select.value = 'absorb';
	select.dispatch('change');
	assert.equal(physics.groundRetentionNow(), 0);
});

test('the overlay draws one dotted flight per ball the selected machine may push', () => {
	research.grant('ballistics', world);
	parkRival();
	players.setActive(0);
	const select = dom.element('balls');
	select.value = 'shared2';
	select.dispatch('change');
	world.balls[0].state = 'flying'; world.balls[0].holder = null;
	world.balls[0].x = 8; world.balls[0].y = 5; world.balls[0].vx = 1; world.balls[0].vy = 0;
	world.balls[1].state = 'flying'; world.balls[1].holder = null;
	world.balls[1].x = 18; world.balls[1].y = 6; world.balls[1].vx = -1; world.balls[1].vy = 0;
	advance(10);
	assert.equal(globalThis.SteamPrediction.pathCount, 2, 'two shared balls, two flights');
	dom.contextCalls.length = 0;
	advance(1);
	assert.equal(dom.contextCalls.filter(call => call === 'setLineDash').length, 4,
		'two dotted flights each set and clear their dash in one draw');
	// Owned balls: the other platform's ball is not drawn at all.
	select.value = 'each';
	select.dispatch('change');
	advance(10);
	assert.equal(globalThis.SteamPrediction.pathCount, 1, 'only the selected machine\'s own ball');
	dom.contextCalls.length = 0;
	advance(1);
	assert.equal(dom.contextCalls.filter(call => call === 'setLineDash').length, 2);
	select.value = 'shared1';
	select.dispatch('change');
	world.drive = false;
});

test('the road grader row follows the selected player: Locked for a rival, and the click says why', () => {
	// The row is built once and re-read by the drawer, so this states the rule
	// directly for both owners instead of depending on the page's selection.
	players.setActive(0);
	advance(2);
	assert.equal(equipment.isUnlocked('grader', 'rig'), true, 'the rig sees the ungated blade');
	players.setActive(1);
	advance(2);
	const rival = players.state.rivals[0];
	const row = gearRow('grader');
	assert.equal(buttonOf(row).textContent, 'Locked', 'a competitor cannot own the rig-only blade');
	assert.equal(row.dataset.state, 'locked');
	assert.equal(buttonOf(row).getAttribute('aria-disabled'), 'true', 'blocked but still clickable');
	// The refusal must name the rule instead of dereferencing a prerequisite the
	// item does not have.
	buttonOf(row).dispatch('click');
	assert.match(dom.element('progression-status').textContent, /grades under the rig's centre/);
	assert.equal(equipment.isInstalled('grader', rival.id), false);
	assert.equal(equipment.isUnlocked('grader', rival.id), false);
});

test('mineral fall sliders and test-rock button wire the controlled setup', () => {
	const iron = dom.element('cluster-iron');
	// The sliders span the whole mixed range: 10% is the plain loose-face clump
	// and 500% the widest group.
	for (const id of ['cluster-iron', 'cluster-copper', 'cluster-crystal']) {
		assert.equal(dom.element(id).getAttribute('min'), '10');
		assert.equal(dom.element(id).getAttribute('max'), '500');
	}
	assert.equal(dom.element('cluster-iron').getAttribute('value'), '300');
	assert.equal(dom.element('cluster-copper').getAttribute('value'), '100');
	assert.equal(dom.element('cluster-crystal').getAttribute('value'), '10');
	iron.value = '125';
	iron.dispatch('input');
	assert.equal(ceiling.state.mineralClusterGrowth[0], 125);
	assert.equal(dom.element('cluster-iron-value').textContent, '125%');
	const crystal = dom.element('cluster-crystal');
	crystal.value = '0';
	crystal.dispatch('input');
	assert.equal(ceiling.state.mineralClusterGrowth[2], 10, 'the slider cannot go below the plain clump');
	assert.equal(dom.element('cluster-crystal-value').textContent, '10%');

	dom.element('generate-test-rock').dispatch('click');
	assert.equal(ceiling.state.testRock, true);
	assert.equal(ceiling.state.extractedCells, 0, 'the generator starts from a clean run');
	assert.equal(ceiling.state.mineralClusterGrowth[0], 125, 'the live setting carries into the new run');
	assert.match(dom.element('fall-test-status').textContent, /Iron → Copper → Crystal/);
	assert.equal(dom.element('rock-damage-view').getAttribute('value'), 'damage');
	advance(3);
	assert.ok(Math.abs(physics.totalEnergy(world) - world.initialEnergy) < 1e-5);
});

test('a checked rival keeps releasing its catch after taking its controls', () => {
	const row = dom.element('player-list').children[1];
	const box = row.children[1].children[0];
	const rival = players.state.rivals[0];
	box.checked = true; box.dispatch('change');
	rival.x = 12; rival.vx = 0; rival.manual = 0; rival.driveManual = 0;
	const ball = world.balls[0];
	ball.state = 'held'; ball.holder = rival.id; ball.vx = 0; ball.vy = 0;
	world.drive = false;
	row.children[0].dispatch('click');
	assert.equal(players.state.active, 1);
	assert.equal(box.checked, true);
	assert.equal(rival.bot, true);
	advance(2);
	assert.equal(ball.state, 'flying', 'selection does not turn a checked bot into a parked collector');
	assert.ok(rival.pushes > 0, 'the release used the rival pulse');
	dom.element('player-list').children[0].children[0].dispatch('click');
});

// The specification strip leads the tree, and a hovered or pinned row reports
// the difference it would make without installing anything.
test('the specification leads the tree and previews a hovered row without buying it', () => {
	dom.element('reset').dispatch('click');
	advance(8);
	const spec = dom.element('platform-spec');
	const materials = techRow('materials');
	const funds = ceiling.state.funds;
	assert.equal(specDelta(spec, 4), '', 'a resting readout carries no difference');
	buttonOf(materials).dispatch('pointerenter');
	assert.equal(materials.dataset.preview, 'true');
	assert.equal(dom.element('spec-card').dataset.preview, 'true');
	assert.equal(specValue(spec, 4), '91%', 'the strip shows the retention the research would deliver');
	assert.equal(specDelta(spec, 4), '+1%');
	assert.equal(spec.children[4].children[1].children[1].dataset.tone, 'gain', 'a gain is toned as well as signed');
	assert.equal(ceiling.state.funds, funds, 'a preview never spends anything');
	assert.equal(research.state.completed, 0, 'a preview never researches');
	buttonOf(materials).dispatch('pointerleave');
	assert.equal(materials.dataset.preview, 'false');
	assert.equal(dom.element('spec-card').dataset.preview, 'false');
	assert.equal(specValue(spec, 4), '90%', 'the live value comes back');
	assert.equal(specDelta(spec, 4), '');
});

test('a preview mark pins the same difference for touch, and a purchase clears it', () => {
	dom.element('reset').dispatch('click');
	advance(8);
	const spec = dom.element('platform-spec');
	const pad = gearRow('pad');
	const materials = techRow('materials');
	assert.equal(previewMarkOf(pad).getAttribute('aria-disabled'), 'false', 'a locked row still previews what it would give');
	previewMarkOf(materials).dispatch('click');
	advance(2);
	assert.equal(materials.dataset.preview, 'true', 'the mark pins the preview');
	assert.equal(previewMarkOf(materials).getAttribute('aria-pressed'), 'true');
	assert.equal(specValue(spec, 4), '91%');
	// A pinned preview owns the strip: hovering another row does not steal it.
	buttonOf(pad).dispatch('pointerenter');
	assert.notEqual(pad.dataset.preview, 'true', 'the pinned row keeps the strip');
	assert.equal(specValue(spec, 4), '91%');
	// It is dropped as soon as the row's state changes under it.
	study('materials');
	assert.equal(materials.dataset.preview, 'false');
	assert.equal(previewMarkOf(materials).getAttribute('aria-pressed'), 'false');
	assert.equal(previewMarkOf(materials).getAttribute('aria-disabled'), 'true', 'a researched row cannot preview itself');
	assert.equal(specValue(spec, 4), '91%', 'the researched value is now the live one');
	assert.equal(specDelta(spec, 4), '');
	// A loss is toned like a loss, whichever way the number moves.
	fund(equipment.find('pad').cost);
	buttonOf(pad).dispatch('pointerenter');
	assert.equal(specValue(spec, 4), '94%');
	assert.equal(specDelta(spec, 4), '+3%');
	buttonOf(pad).dispatch('pointerleave');
	const grader = gearRow('grader');
	fund(equipment.find('grader').cost);
	buttonOf(grader).dispatch('pointerenter');
	assert.equal(specDelta(spec, 0), '+10.2 kg');
	assert.equal(spec.children[0].children[1].children[1].dataset.tone, 'loss', 'heavier is worse for the mass');
	buttonOf(grader).dispatch('pointerleave');
});

test('a tier family previews the selected tier as a swap, not as a stack', () => {
	study('thermodynamics');
	advance(4);
	const spec = dom.element('platform-spec');
	const bay = tierRow('radiators');
	const select = selectOf(bay);
	buttonOf(bay).dispatch('pointerenter');
	assert.equal(select.value, 'vent', 'the first unowned tier is preselected');
	assert.equal(specValue(spec, 8), '9.10 W/K', 'the strip shows the cooling the vent would add');
	assert.equal(spec.children[8].children[1].children[1].textContent, '+7.50 W/K');
	assert.equal(spec.children[0].children[1].children[1].textContent, '+4.1 kg');
	// Changing the tier under an open preview re-reads the strip at once.
	select.value = 'bank';
	select.dispatch('change');
	assert.equal(spec.children[8].children[1].children[1].textContent, '+35.00 W/K', 'the swap carries the whole bank, not a stack of both');
	assert.equal(spec.children[0].children[1].children[1].textContent, '+16.3 kg');
	buttonOf(bay).dispatch('pointerleave');
	advance(2);
	assert.equal(spec.children[8].children[1].children[1].textContent, '');
	assert.equal(specValue(spec, 8), '1.60 W/K', 'the live cooling comes back');
});

test('market drawer renders live quote drift and rate with zero redundant DOM writes when settled', () => {
	dom.element('reset').dispatch('click');
	const marketRows = dom.element('market-rows');
	const inventoryRows = dom.element('inventory-rows');
	assert.equal(marketRows.children.length, ceiling.state.mineralNames.length);
	ceiling.advanceMarket(25);
	advance(8);
	let directional = 0;
	for (let i = 0; i < marketRows.children.length; i++) {
		const row = marketRows.children[i];
		const quoteCell = row.children[1];
		const vsBaseCell = row.children[2];
		const trendCell = row.children[3];
		assert.equal(quoteCell.textContent, ceiling.state.mineralPrices[i].toFixed(2));
		assert.ok(vsBaseCell.textContent.endsWith('%'), 'vs-base cell formats percentage');
		assert.ok(trendCell.textContent.endsWith('%/m'), 'trend cell formats per-minute rate');
		if (trendCell.textContent.startsWith('↑') || trendCell.textContent.startsWith('↓')) directional++;
	}
	assert.ok(directional >= 2, 'live market drawer shows directional quote trends');

	// Freeze the world and verify zero redundant DOM writes on market and inventory cells.
	dom.element('pause').dispatch('click');
	advance(4);
	let writes = 0;
	function watchText(node) {
		let value = node.textContent;
		Object.defineProperty(node, 'textContent', {
			configurable: true,
			get() { return value; },
			set(next) { writes++; value = next; }
		});
	}
	watchText(marketRows.children[0].children[1]);
	watchText(marketRows.children[0].children[2]);
	watchText(marketRows.children[0].children[3]);
	watchText(inventoryRows.children[0].children[1].children[0]);
	watchText(inventoryRows.children[0].children[1].children[1]);
	advance(10);
	assert.equal(writes, 0, 'paused ticks do not rewrite unchanged quote or trend cells');
	dom.element('pause').dispatch('click');
});

test('pointer rock inspection hits grown low rock and follows compacted layers without jumping', () => {
	dom.element('reset').dispatch('click');
	ceiling.queueGrowth(20);
	ceiling.grow(5);
	advance(2);
	const view = global.window.SteamView;
	const bounds = dom.element('c').getBoundingClientRect();
	const targetCol = 50;
	const targetRow = 3;
	const worldX = (targetCol + 0.5) * ceiling.state.cell;
	const worldY = ceiling.state.rockDrawnY(ceiling.state.bottom + (targetRow + 0.5) * ceiling.state.cell);
	const clientX = bounds.left + view.offsetX + worldX * view.scale;
	const clientY = bounds.top + view.floorY - worldY * view.scale;
	dom.element('c').dispatch('pointermove', { clientX, clientY });
	assert.equal(dom.element('mineral-tooltip').hidden, false, 'grown rock below 11.375 m is inspectable');
	assert.match(dom.element('mineral-cell').textContent, /Column 51 \/ 192 · Layer 4 \//);

	// Mine out the bottom 2 rows and grow 1 more row so baseRow advances by 2: Layer 4 becomes Layer 2.
	const cols = ceiling.state.columns;
	for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) ceiling.state.strength[r * cols + c] = 0;
	ceiling.queueGrowth(1);
	ceiling.grow(0.25);
	advance(8);
	assert.match(dom.element('mineral-cell').textContent, /Column 51 \/ 192 · Layer 2 \//, 'selection follows the physical cell across compaction');
	dom.element('reset').dispatch('click');
});

