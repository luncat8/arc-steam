// Player strip and active-control handoff.
// provides: buildPlayers, refreshPlayers, syncActiveControls, activePlayer, activePlayerId
// depends: main.js bindings, input state/actions, autopilotApi, refresh

'use strict';

function activePlayerId() {
	const player = activePlayer();
	return player ? player.id : 'rig';
}

// One line per player: colour, name and purse, plus that player's policy
// switch. The line itself is the control switch; the checkbox is the only
// nested control and keeps its own click target.
const playerRows = [];

function buildPlayers() {
	const list = playerApi.state.players;
	for (let index = 0; index < list.length; index++) {
		const player = list[index];
		const row = document.createElement('li');
		row.className = 'player-row';
		const select = document.createElement('button');
		select.type = 'button';
		select.className = 'player-select';
		select.setAttribute('aria-label', 'Take control of ' + player.name);
		const dot = document.createElement('i');
		dot.className = 'player-dot';
		dot.style.background = player.colour;
		const name = document.createElement('span');
		name.className = 'player-name';
		name.textContent = player.name;
		const purse = document.createElement('span');
		purse.className = 'player-money';
		purse.textContent = '0.0 cr';
		select.append(dot, name, purse);
		const label = document.createElement('label');
		label.className = 'player-bot';
		const box = document.createElement('input');
		box.type = 'checkbox';
		box.setAttribute('aria-label', 'Bot controls ' + player.name);
		const botText = document.createElement('span');
		botText.textContent = 'BOT';
		label.append(box, botText);
		row.append(select, label);
		select.addEventListener('click', function () { setActivePlayer(index); });
		box.addEventListener('change', function () {
			playerApi.setBot(index, box.checked);
			refresh();
		});
		row.addEventListener('click', function (event) {
			const target = event.target;
			if (target === box || target === label || (target && target.parentElement === label)) return;
			setActivePlayer(index);
		});
		ui['player-list'].appendChild(row);
		playerRows.push({ row, select, box, name, purse });
	}
}

function refreshPlayers() {
	playerApi.syncRigBot();
	syncAutopilot();
	const list = playerApi.state.players;
	for (let index = 0; index < playerRows.length && index < list.length; index++) {
		const entry = playerRows[index];
		const player = list[index];
		setText(entry.purse, playerApi.money(index).toFixed(1) + ' cr');
		setChecked(entry.box, player.bot);
		const activeFlag = String(index === playerApi.state.active);
		if (entry.row.dataset.active !== activeFlag) entry.row.dataset.active = activeFlag;
		if (entry.select.getAttribute('aria-pressed') !== activeFlag) entry.select.setAttribute('aria-pressed', activeFlag);
		const title = player.name + ' · ' + Math.round(playerApi.load(index)) + ' cells carried · click to take the controls';
		if (entry.row.title !== title) entry.row.title = title;
	}
}

// Every platform is the same machine, so the panel is the same panel: it only
// changes the name and the policy in its title. Nothing appears or disappears
// with the switch, because every control on screen belongs to the machine the
// player is driving.
let titleIndex = -1;
let titleBot = null;
function syncActiveControls() {
	const index = playerApi.state.active;
	const active = playerApi.state.players[index];
	if (index !== titleIndex || active.bot !== titleBot) {
		titleIndex = index;
		titleBot = active.bot;
		setText(ui['control-title'], active.name + ' · ' + (active.bot ? 'BOT' : 'MANUAL'));
	}
	syncForceControl();
	// The tilt slider shows the selected platform's own angle, not the one
	// the platform you left was holding.
	syncPistonControl();
}

// Taking a platform's controls also drops the command left with the platform
// you were driving, so a held key, a brake or a travel click never keeps
// steering one platform while the keys drive another.
function setActivePlayer(index) {
	if (!playerApi.setActive(index)) return;
	leftHeld = false;
	rightHeld = false;
	commandedDirection = 0;
	world.brake = false;
	world.direction = 0;
	world.target = NaN;
	// The command stops with the switch: players.setActive stands a competitor
	// down, and the three lines above stand the rig down, so neither platform
	// keeps moving on a key or a click that belonged to the other.
	autopilotApi.hold('move', false);
	endPistonDrag();
	syncActiveControls();
	refreshPlayers();
	refresh();
}

function activePlayer() { return playerApi.state.players[playerApi.state.active]; }
function pistonDegrees() { return playerApi.pistonAngleOf(activePlayer()) * 180 / Math.PI; }
