'use strict';
// Wild Mine UI wiring tests against the real index.html and dom.cjs shim.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const dom = require('./dom.cjs');

dom.install();
const physics = require('../js/physics.js');
const players = require('../js/players.js');
const wildMine = require('../js/wild-mine.js');

let world = null;
const simulate = physics.step;
physics.step = function (stepped, dt) {
	world = stepped;
	return simulate(stepped, dt);
};
dom.loadMainScripts();

function advance(frames = 8) {
	dom.frames(frames, performance.now(), 1000 / 60);
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

test('M3 ball controls: the ball panel appears only in Wild Mine and its keys and buttons reach the ball', () => {
	const modeSelect = dom.element('game-mode');
	modeSelect.value = 'wild';
	modeSelect.dispatch('change');
	advance(4);
	const panel = dom.element('ball-controls');
	assert.equal(panel.hidden, false, 'the ball panel shows in Wild Mine');
	const ball = world.balls[0];
	assert.equal(ball.state, 'held');

	// D1: the chamber's launch button releases the ball and the battery pays.
	const battery = ball.battery;
	dom.element('launch').dispatch('click');
	assert.equal(ball.state, 'flying');
	assert.ok(ball.battery < battery, 'the release draws the ball battery');

	dom.key('ArrowRight');
	assert.equal(ball.motor, 1, 'ArrowRight drives the motor right');
	dom.keyUp('ArrowRight');
	assert.equal(ball.motor, 0, 'releasing the key stops the motor');
	dom.key('ArrowLeft');
	assert.equal(ball.motor, -1, 'ArrowLeft drives the motor left');
	dom.keyUp('ArrowLeft');
	dom.key('ArrowUp');
	assert.equal(ball.jump, true, 'ArrowUp queues a jump along the contact normal');
	advance(2);

	const right = dom.element('ball-right');
	right.dispatch('pointerdown', { pointerId: 1 });
	assert.equal(ball.motor, 1, 'the panel button runs the motor');
	right.dispatch('pointerup', { pointerId: 1 });
	assert.equal(ball.motor, 0);
	dom.element('ball-jump').dispatch('pointerdown', { pointerId: 1 });
	assert.equal(ball.jump, true, 'the panel jump button queues a jump');

	// Classic mode keeps the ball panel out of the way and the arrows inert.
	modeSelect.value = 'classic';
	modeSelect.dispatch('change');
	advance(4);
	assert.equal(panel.hidden, true, 'the ball panel hides in Classic');
	assert.equal(physics.wildMode(), false);
	const classicMotor = world.balls[0].motor;
	dom.key('ArrowRight');
	assert.equal(world.balls[0].motor, classicMotor, 'arrows do not drive a classic ball');
	dom.keyUp('ArrowRight');
});
