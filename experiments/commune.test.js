'use strict';
// Communism mode: the commons owns the machinery, so research, equipment and
// bought energy cost nothing and the technology tree stops gating anything.
// The mode is a pricing rule, so it lives with the money it rules.
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
require('../js/help.js');
require('../js/autopilot.js');

const near = harness.near;

test('communism mode hands out research, equipment and energy for nothing', () => {
	const world = physics.createWorld();
	ceiling.setCommune(true);
	assert.equal(ceiling.state.commune, true);
	// A node with an unmet prerequisite is available anyway, and it is free.
	assert.equal(research.status('ballistics'), research.constants.AVAILABLE);
	assert.equal(research.research('ballistics', world), true);
	assert.equal(ceiling.state.funds, 0, 'research costs nothing');
	assert.equal(research.state.prediction, true, 'the node still applies its effect');
	// Equipment follows the same rule, and the research gate is waived too.
	assert.equal(equipment.isUnlocked('flywheel'), true);
	assert.equal(equipment.install('flywheel', world), true);
	assert.equal(ceiling.state.funds, 0, 'equipment costs nothing');
	assert.equal(equipment.state.recoveryFraction, 0.55, 'the item still applies its effect');
	// The ledger records the handout as a free entry, not as a priced one.
	const entries = ceiling.state.ledger;
	assert.equal(entries[entries.length - 2].type, 'research');
	assert.equal(entries[entries.length - 2].credits, 0);
	assert.equal(entries[entries.length - 1].type, 'buy');
	assert.equal(entries[entries.length - 1].credits, 0);
	physics.createWorld();
});

test('the emergency resupply is free in communism mode', () => {
	const world = physics.createWorld();
	ceiling.setCommune(true);
	world.battery = 0;
	harness.sync(world);
	assert.equal(ceiling.rechargeCost(world), 0, 'the import costs nothing');
	const imported = ceiling.recharge(world, world.time);
	near(imported, physics.config.battery, 1);
	near(world.battery, physics.config.battery, 1);
	assert.equal(ceiling.state.funds, 0, 'no credits are spent');
	harness.balanced(world);
	const entry = ceiling.state.ledger[ceiling.state.ledger.length - 1];
	assert.equal(entry.type, 'fuel');
	assert.equal(entry.credits, 0);
	physics.createWorld();
});

test('leaving communism mode puts the prices and the gates back', () => {
	const world = physics.createWorld();
	ceiling.setCommune(false);
	assert.equal(research.status('ballistics'), research.constants.LOCKED, 'the tree gates again');
	assert.equal(research.research('ballistics', world), false);
	assert.equal(equipment.isUnlocked('flywheel'), false);
	assert.equal(equipment.install('flywheel', world), false);
	assert.equal(ceiling.purchase('Road grader', 300, 0, 'buy'), false, 'an empty purse buys nothing');
	world.battery = 0;
	harness.sync(world);
	near(ceiling.rechargeCost(world), physics.config.battery / 1000 * ceiling.state.fuelPrice, 1e-9);
	assert.equal(ceiling.recharge(world, world.time), 0, 'an empty purse buys no energy');
	physics.createWorld();
});

test('the mode is a setting, so a new game keeps it', () => {
	ceiling.setCommune(true);
	physics.createWorld();
	assert.equal(ceiling.state.commune, true, 'a new game keeps the mode');
	ceiling.setCommune(false);
	physics.createWorld();
	assert.equal(ceiling.state.commune, false);
});

// The page itself: the system-bar switch, the M shortcut, the FREE titles and
// the free entries in the ledger.
let pageWorld = null;
const step = physics.step;
physics.step = function (stepped, dt) {
	pageWorld = stepped;
	return step(stepped, dt);
};
require('../js/main.js');

function advance(count) {
	for (let i = 0; i < count; i++) dom.frame(1000 / 60 * (i + 1));
}
function gearRow(id) { return dom.element('equipment-rows').children[equipment.items.findIndex(item => item.id === id)]; }
function techRow(id) { return dom.element('research-rows').children[research.nodes.findIndex(node => node.id === id)]; }

test('the system-bar switch turns the commons on and the panels follow', () => {
	const box = dom.element('commune');
	assert.equal(box.checked, false, 'the mode starts off');
	assert.equal(ceiling.state.commune, false);
	box.checked = true;
	box.dispatch('change');
	advance(4);
	assert.equal(ceiling.state.commune, true);
	assert.equal(box.checked, true, 'the switch shows the mode');
	// Nothing is short of credits: the titles read FREE and no button is blocked.
	assert.match(gearRow('grader').children[0].textContent, /ROAD GRADER · FREE/);
	assert.match(techRow('materials').children[0].textContent, /REBOUND MATERIALS · FREE/);
	assert.equal(gearRow('pad').children[1].getAttribute('aria-disabled'), 'false', 'a research gate is waived');
	assert.equal(techRow('ballistics').children[1].getAttribute('aria-disabled'), 'false', 'a prerequisite is waived');
	assert.match(gearRow('pad').children[3].textContent, /The commons shares it/, 'the note stops asking for research');
	assert.match(techRow('ballistics').children[3].textContent, /The commons shares every node/);
	assert.match(dom.element('tech-hint').textContent, /Free · no prerequisites/, 'the panel introduction is short and still names the mode');
	assert.match(dom.element('equipment-hint').textContent, /Free · installs at once/);
	assert.equal(dom.element('credits').textContent, 'commons');
	assert.equal(dom.element('funds').textContent, 'commons');
	assert.match(dom.element('funds-note').textContent, /Nothing costs/);
	// The market imports energy without a purse.
	assert.equal(dom.element('refuel-cost').textContent, 'free');
	assert.equal(dom.element('fuel-price').textContent, 'free');
	// Off the centre pad, so the reserve stays empty and the import is the only way in.
	pageWorld.platform.x = 3;
	pageWorld.platform.vx = 0;
	pageWorld.battery = 0;
	advance(12);
	assert.equal(dom.element('refuel').disabled, false, 'a free import is always offered');
	dom.element('refuel').dispatch('click');
	advance(4);
	assert.ok(pageWorld.battery > 0, 'the reserve took the free energy');
	near(pageWorld.importedEnergy, pageWorld.battery, 1);
	assert.match(dom.element('ledger').children[0].textContent, /Recharged \d+\.\d\d kJ · free/);
	assert.match(dom.element('transaction-status').textContent, /for free at/);
});

test('a free purchase installs and is booked as free', () => {
	const pad = gearRow('pad');
	// The pad needs the rebound materials research, which the mode waives.
	assert.equal(dom.element('research-progress').textContent, '0 / ' + research.nodes.length);
	pad.children[1].dispatch('click');
	advance(4);
	assert.equal(equipment.isInstalled('pad'), true);
	assert.match(dom.element('equipment-status').textContent, /^Installed Rebound pad at /);
	assert.match(dom.element('ledger').children[0].textContent, /Bought Rebound pad · free/);
	assert.match(dom.element('transaction-status').textContent, /^Bought Rebound pad for free at /);
	assert.equal(ceiling.state.funds, 0, 'nothing was paid');
});

test('the M shortcut switches the mode off again', () => {
	dom.key('KeyM');
	advance(4);
	assert.equal(ceiling.state.commune, false);
	assert.equal(dom.element('commune').checked, false, 'the switch follows the shortcut');
	assert.match(gearRow('pad').children[0].textContent, /REBOUND PAD · 250 CR/, 'the list price is back');
	assert.match(dom.element('tech-hint').textContent, /Pay once/, 'the panel introduction is back too');
	assert.equal(dom.element('credits').textContent, '0.0 cr');
	dom.key('KeyM');
	advance(4);
	assert.equal(ceiling.state.commune, true);
	dom.key('KeyM');
	advance(4);
	assert.equal(ceiling.state.commune, false);
});
