// Help topic rendering, marks, drawer state and touch/hover gestures.
// provides: bindHelp, bindHelpGestures, helpKey, openHelp, closeHelp
// depends: main.js bindings, tool-drawer close action

'use strict';

// Context help. One drawer serves every topic: the ? marks open it on hover
// with a precise pointer, on click or tap and on focus once it is open; holding
// a panel for half a second opens that panel's topic, which is the touch route
// without hunting for a mark; H / F1 toggles, Escape closes.
const helpTopics = window.SteamHelp.topics;
const helpIndexButtons = [];
const helpSkipTags = { BUTTON: true, INPUT: true, SELECT: true, LABEL: true, TEXTAREA: true, CANVAS: true };
let helpOpen = false;
let helpTopic = '';
let helpLast = 'keys';
let helpReturn = null;
let helpPressed = 0;
let helpPressX = 0;
let helpPressY = 0;
let helpSwipeY = -1;
let helpPreview = false;

function setHelpState() {
	ui['help-drawer'].dataset.open = helpOpen ? 'true' : 'false';
	ui['help-drawer'].setAttribute('aria-hidden', helpOpen ? 'false' : 'true');
	for (const topic of helpTopics) {
		const trigger = ui['help-' + topic.id];
		if (trigger) trigger.setAttribute('aria-expanded', String(helpOpen && helpTopic === topic.id));
	}
	for (const entry of helpIndexButtons) entry.button.dataset.active = String(helpOpen && helpTopic === entry.id);
}

// The body is rebuilt only when the topic changes, so hovering along a row of
// marks costs one comparison per mark after the first.
function renderHelp(topic) {
	setText(ui['help-title'], topic.title);
	const body = ui['help-body'];
	body.replaceChildren();
	for (const paragraph of topic.text) {
		const node = document.createElement('p');
		node.textContent = paragraph;
		body.appendChild(node);
	}
	if (!topic.keys) return;
	const list = document.createElement('dl');
	list.className = 'help-keys';
	for (const entry of topic.keys) {
		const term = document.createElement('dt');
		term.textContent = entry[0];
		const value = document.createElement('dd');
		value.textContent = entry[1];
		list.append(term, value);
	}
	body.appendChild(list);
}

function openHelp(id, takeFocus) {
	helpPreview = false;
	const topic = window.SteamHelp.find(id);
	if (!topic) return;
	if (helpTopic !== id) { helpTopic = id; helpLast = id; renderHelp(topic); }
	if (!helpOpen) { helpOpen = true; helpReturn = document.activeElement; }
	setHelpState();
	if (takeFocus) ui['help-close'].focus();
}

function closeHelp(restoreFocus) {
	if (!helpOpen) return;
	helpOpen = false;
	helpPreview = false;
	helpTopic = '';
	setHelpState();
	const target = helpReturn;
	helpReturn = null;
	if (!restoreFocus) return;
	// Focus returns to the control that opened the drawer. A hover preview has
	// no such control (the body cannot take focus), so focus leaves the hidden
	// drawer instead of staying on a button nobody can see.
	if (target && target !== document.body && typeof target.focus === 'function') target.focus();
	else if (document.activeElement && document.activeElement.closest('.help-drawer')) document.activeElement.blur();
}

function toggleHelp(id) {
	if (helpOpen && helpTopic === id) closeHelp(true);
	else openHelp(id, true);
}

function helpKey(event) {
	if (event.code === 'Escape') {
		if (!helpOpen && ui['science-drawer'].hidden && ui['market-drawer'].hidden) return false;
		event.preventDefault();
		if (helpOpen) closeHelp(true);
		closeToolDrawers();
		return true;
	}
	if (event.code !== 'F1' && event.code !== 'KeyH') return false;
	event.preventDefault();
	if (event.repeat) return true;
	if (helpOpen) closeHelp(true);
	else openHelp(helpLast, true);
	return true;
}

// One mark carries one topic: a hovering pointer has already previewed it, so
// its click pins the preview instead of closing what the pointer just opened,
// while touch toggles. The same wiring serves every mark, including the ones
// that live outside the system bar.
function bindHelpMark(trigger, id) {
	// A hovering pointer has already previewed the topic, so its click pins the
	// preview instead of closing what the pointer just opened; touch toggles.
	trigger.addEventListener('click', function () {
		if (hoverPointer.matches && helpOpen && helpTopic === id) { helpPreview = false; return; }
		toggleHelp(id);
	});
	const openPreview = function () { if (hoverPointer.matches) { openHelp(id, false); helpPreview = true; } };
	trigger.addEventListener('pointerenter', openPreview);
	trigger.addEventListener('pointerover', openPreview);
	const closePreview = function (event) {
		if (!hoverPointer.matches || !helpPreview || !helpOpen || helpTopic !== id) return;
		const next = event && event.relatedTarget;
		if (next && (((next.id && String(next.id).indexOf('help-') === 0) || (typeof next.closest === 'function' && next.closest('.help-mark'))) || (typeof next.closest === 'function' && next.closest('.help-drawer')))) return;
		helpPreview = false;
		closeHelp(false);
	};
	trigger.addEventListener('pointerout', closePreview);
	trigger.addEventListener('pointerleave', closePreview);
	trigger.addEventListener('focus', function () { if (helpOpen) openHelp(id, false); });
}

function bindHelp() {
	for (const topic of helpTopics) {
		const trigger = ui['help-' + topic.id];
		if (trigger) bindHelpMark(trigger, topic.id);
	}
	for (const topic of helpTopics) {
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = topic.label;
		button.addEventListener('click', function () { openHelp(topic.id, false); });
		ui['help-index'].appendChild(button);
		helpIndexButtons.push({ id: topic.id, button });
	}
	setHelpState();
}

// The hold gesture walks up from the pressed node, skipping anything a press
// would otherwise mean: a button, a field, a slider label or the chamber.
function heldTopic(node) {
	while (node && node.dataset) {
		if (helpSkipTags[node.tagName]) return '';
		if (node.dataset.topic) return node.dataset.topic;
		node = node.parentElement;
	}
	return '';
}

function endHelpPress() {
	if (!helpPressed) return;
	clearTimeout(helpPressed);
	helpPressed = 0;
}

function bindHelpGestures() {
	document.addEventListener('pointerdown', function (event) {
		const id = heldTopic(event.target);
		if (!id) return;
		helpPressX = event.clientX;
		helpPressY = event.clientY;
		helpPressed = setTimeout(function () { helpPressed = 0; openHelp(id, true); }, 550);
	});
	document.addEventListener('pointerup', endHelpPress);
	document.addEventListener('pointercancel', endHelpPress);
	document.addEventListener('pointermove', function (event) {
		if (!helpPressed) return;
		if (Math.abs(event.clientX - helpPressX) + Math.abs(event.clientY - helpPressY) < 12) return;
		endHelpPress();
	});
	// A downward drag on the drawer head closes the sheet on touch screens.
	ui['help-head'].addEventListener('pointerdown', function (event) { helpSwipeY = event.clientY; });
	ui['help-head'].addEventListener('pointermove', function (event) {
		if (helpSwipeY < 0 || event.clientY - helpSwipeY < 48) return;
		helpSwipeY = -1;
		closeHelp(true);
	});
	ui['help-head'].addEventListener('pointerup', function () { helpSwipeY = -1; });
	ui['help-head'].addEventListener('pointercancel', function () { helpSwipeY = -1; });
	const closePreviewFromDrawer = function (event) {
		if (!hoverPointer.matches || !helpPreview || !helpOpen) return;
		const next = event && event.relatedTarget;
		if (next && ((typeof next.closest === 'function' && next.closest('.help-drawer')) || (next.id && String(next.id).indexOf('help-') === 0) || (typeof next.closest === 'function' && next.closest('.help-mark')))) return;
		helpPreview = false;
		closeHelp(false);
	};
	ui['help-drawer'].addEventListener('pointerout', closePreviewFromDrawer);
	ui['help-drawer'].addEventListener('pointerleave', closePreviewFromDrawer);
	ui['help-close'].addEventListener('click', function () { closeHelp(true); });
}
