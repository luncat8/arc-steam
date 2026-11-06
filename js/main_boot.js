// One-time UI startup and cross-area wiring. Loaded last.
// provides: bootMain (invoked once below)
// depends: all main feature scripts

'use strict';

function fitStatusBar() { document.body.style.paddingBottom = ui['status-bar'].offsetHeight + 12 + 'px'; }

function setToolDrawer(drawer, trigger, open) {
	setHidden(ui[drawer], !open);
	trigger.setAttribute('aria-expanded', String(open));
	if (open && drawer === 'science-drawer') layoutTreeLinks();
}

function toggleToolDrawer(drawer, trigger) {
	const open = ui[drawer].hidden;
	closeToolDrawers();
	if (open) setToolDrawer(drawer, trigger, true);
}

function closeToolDrawers() {
	setToolDrawer('science-drawer', ui['science-open'], false);
	setToolDrawer('market-drawer', ui['market-open'], false);
}

function bindToolDrawers() {
	ui['science-open'].addEventListener('click', function () { toggleToolDrawer('science-drawer', ui['science-open']); });
	ui['market-open'].addEventListener('click', function () { toggleToolDrawer('market-drawer', ui['market-open']); });
	ui['science-close'].addEventListener('click', closeToolDrawers);
	ui['market-close'].addEventListener('click', closeToolDrawers);
}

function bootMain() {
	buildInventory();
	buildUpgrades();
	bindInput();
	bindHelp();
	bindHelpGestures();
	bindToolDrawers();

	window.SteamView = view;
	window.addEventListener('keydown', keydown);
	window.addEventListener('keyup', keyup);
	window.addEventListener('blur', function () { clearInput(); endPistonDrag(); });
	document.addEventListener('visibilitychange', function () { accumulator = 0; previous = 0; sceneDirty = true; clearInput(); endPistonDrag(); });
	bindDirection('left', -1); bindDirection('right', 1);
	new ResizeObserver(resize).observe(canvas);
	new ResizeObserver(layoutTreeLinks).observe(ui['progression-tree']);
	// The bar is fixed over the page, so the flow keeps exactly the room it needs
	// at this width and with this many messages.
	new ResizeObserver(fitStatusBar).observe(ui['status-bar']);
	fitStatusBar();
	buildPlayers();
	physics.setGroundBounce(ui['ground-bounce'].value);
	resize(); refresh(); requestAnimationFrame(frame);
}

bootMain();
