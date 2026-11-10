// Inventory, ledger, status and live text readouts.
// provides: buildInventory, readout, miningReadout, predictionReadout, autopilotReadout, statusReadout
// depends: main.js bindings, progression/player/input readout helpers

'use strict';

let renderedSales = -1;
const inventoryCells = [];
const inventoryPrices = [];
// The price column follows the live market: a quote, its move against the
// reference price, and an arrow for where the demand noise is heading, so a
// boom forming and a glut easing are both readable at a glance.
function marketText(price, reference, trend) {
	const move = (price / reference - 1) * 100;
	const sign = move >= 0 ? '+' : '';
	const arrow = trend > 0.004 ? ' ▲' : trend < -0.004 ? ' ▼' : ' ·';
	return price.toFixed(2) + ' · ' + sign + move.toFixed(0) + '%' + arrow;
}
function buildInventory() {
	const ceiling = window.SteamCeiling.state;
	for (let i = 0; i < ceiling.mineralNames.length; i++) {
		const row = document.createElement('tr');
		const name = document.createElement('th');
		name.scope = 'row';
		name.textContent = ceiling.mineralNames[i];
		row.appendChild(name);
		const price = document.createElement('td');
		price.textContent = marketText(ceiling.mineralPrices[i], ceiling.referencePrices[i], 0);
		row.appendChild(price);
		inventoryPrices.push(price);
		for (let k = 0; k < 2; k++) {
			const cell = document.createElement('td');
			cell.textContent = '0.000';
			row.appendChild(cell);
			inventoryCells.push(cell);
		}
		ui['inventory-rows'].appendChild(row);
	}
}
// The computer is the selected platform's, so its readout names that machine
// and describes the deck it will meet the ball on.
function predictionReadout() {
	const owner = activePlayerId();
	const technology = SteamResearch.stateFor(owner);
	if (!technology.prediction) {
		window.SteamPrediction.predictAll(world);
		setHidden(ui['prediction-status'], true);
		return false;
	}
	setHidden(ui['prediction-status'], false);
	const computer = window.SteamPrediction;
	const kinds = computer.kinds;
	const path = computer.predictAll(world);
	const machine = computer.platformRig ? 'Rig · ' : activePlayer().name + ' · ';
	if (path.kind === kinds.PARKED) setText(ui['prediction-status'], 'Ballistic computer: ' + machine + (computer.pathCount > 1 ? 'the focused ball is parked; the other flights are drawn.' : 'has no ball in flight, so there is nothing to predict.'));
	else if (path.kind === kinds.ROCK) setText(ui['prediction-status'], machine + 'predicted rock contact at ' + path.endX.toFixed(1) + ' m in ' + path.time.toFixed(2) + (technology.predictionBounces ? ' s · tier II looks through the rebound to the next landing; fracture and future controls can change them.' : ' s · the rebound depends on fracture, so the path stops there.'));
	else if (path.kind === kinds.TIMEOUT) setText(ui['prediction-status'], machine + 'still airborne after ' + computer.horizon.toFixed(0) + ' s of prediction.');
	else setText(ui['prediction-status'], machine + 'landing ' + (path.kind === kinds.DECK ? 'on the deck' : 'on the ground') + ' at ' + path.endX.toFixed(1) + ' m in ' + path.time.toFixed(2) + ' s · ghost coasts to ' + path.ghostX.toFixed(1) + ' m · '
		+ (path.reachable ? 'intercept reachable at full thrust' : 'intercept short by ' + path.gap.toFixed(1) + ' m at full thrust'));
	return true;
}

// One clause per engaged duty, so the panel says what the autopilot is doing
// and not only which of its switches are on. `ball` names the working ball
// when there is more than one, and the last two clauses say when the plan is
// no longer an intercept at all.
function travelClause(plan, ball) {
	if (!Number.isFinite(plan.interceptX)) return 'Intercept · ball held, no flight to meet';
	if (plan.uncertain) return 'Intercept · ' + ball + 'no landing yet, following the ball at ' + plan.interceptX.toFixed(1) + ' m';
	if (plan.contactIn <= 0) return 'Intercept · ' + ball + 'collecting at ' + plan.interceptX.toFixed(1) + ' m';
	if (plan.recovering) return 'Intercept · ' + ball + 'landing out of reach, collecting at ' + plan.interceptX.toFixed(1) + ' m';
	return (plan.smart ? 'Timed intercept · ' : 'Intercept · ') + ball + plan.interceptX.toFixed(1) + ' m in ' + plan.contactIn.toFixed(2) + ' s';
}

// Which of the rig's balls the autopilot plan is working, as `ball n/m`, so
// a two-ball game never leaves the panel saying only where the platform is
// going. The plan names its own ball: the page's computer is a separate
// flight and must not be read as the policy's choice.
function workingBall() {
	const balls = world.balls || [];
	const focus = autopilotApi.state.focus;
	let count = 0;
	let index = 0;
	for (let i = 0; i < balls.length; i++) {
		if (!physics.isRigBall(balls[i])) continue;
		count++;
		if (balls[i] === focus) index = count;
	}
	return count > 1 && index > 0 ? 'ball ' + index + '/' + count + ' · ' : '';
}

function autopilotText(plan, ball) {
	let text = '';
	if (plan.move || plan.smart) {
		text = playerApi.state.selling ? 'Rig · selling full cargo · wall trip'
			: playerApi.state.recharging ? 'Rig · recharging · centre pad trip'
			: autopilotApi.suspended('move') ? 'Intercept · manual override' : travelClause(plan, ball);
	}
	if (plan.drive) text += (text ? ' · ' : 'Rig · ') + 'Drive keeper · ' + (autopilotApi.suspended('drive') ? 'manual override' : plan.wantedDrive ? 'pulse armed' : 'pulse held');
	if (plan.angle) text += (text ? ' · ' : 'Rig · ') + 'Level bounce · ' + (autopilotApi.suspended('angle') ? 'manual override' : 'tilt to ' + (plan.wantedAngle * 180 / Math.PI).toFixed(1) + '°');
	return text;
}

function autopilotReadout() {
	const plan = autopilotApi.state;
	setHidden(ui['autopilot-status'], !plan.active);
	if (plan.active) setText(ui['autopilot-status'], autopilotText(plan, workingBall()));
}

const warningState = { 'reserve-telemetry': '', 'cargo-telemetry': '', 'thermal-telemetry': '' };
function setWarning(id, state) {
	if (warningState[id] === state) return;
	warningState[id] = state;
	if (state) ui[id].dataset.warning = state;
	else delete ui[id].dataset.warning;
}
function ledgerText(entry) {
	const stamp = entry.time.toFixed(1) + ' s · ';
	if (entry.source === 'test') return stamp + (entry.type === 'research' ? 'Test researched ' : 'Test installed ') + entry.label;
	if (entry.type === 'grader') return stamp + 'Grader settlement · +' + entry.credits.toFixed(2) + ' cr (50% share)';
	if (entry.type === 'blade') return stamp + 'Blade settlement · +' + entry.credits.toFixed(2) + ' cr (50% of the shaved rubble)';
	if (entry.type === 'fuel') return stamp + 'Recharged ' + (entry.energy / 1000).toFixed(2) + ' kJ · ' + spent(entry.credits, 1);
	if (entry.type === 'research') return stamp + 'Researched ' + entry.label + ' · ' + spent(entry.credits, 0);
	if (entry.type === 'buy') return stamp + 'Bought ' + entry.label + ' · ' + spent(entry.credits, 0);
	return stamp + 'Sold ' + entry.mass.toFixed(1) + ' kg (' + entry.cells + ' cells) · +' + entry.credits.toFixed(1) + ' cr';
}

function ledgerStatus(entry) {
	if (entry.source === 'test') return (entry.type === 'research' ? 'Test mode researched ' : 'Test mode installed ') + entry.label + ' at ' + entry.time.toFixed(1) + ' s.';
	if (entry.type === 'grader') return 'Grader completed one pass · received ' + entry.credits.toFixed(2) + ' cr (50% share).';
	if (entry.type === 'blade') return 'Road grader blade settled its stint · received ' + entry.credits.toFixed(2) + ' cr (50% of the rubble it shaved).';
	if (entry.type === 'fuel') return 'Recharged ' + (entry.energy / 1000).toFixed(2) + ' kJ of reserve ' + (entry.credits > 0 ? 'for ' + entry.credits.toFixed(1) + ' cr' : 'for free') + ' at ' + entry.time.toFixed(1) + ' s.';
	if (entry.type === 'research') return 'Researched ' + entry.label + ' ' + (entry.credits > 0 ? 'for ' + entry.credits.toFixed(0) + ' cr' : 'for free') + ' at ' + entry.time.toFixed(1) + ' s.';
	if (entry.type === 'buy') return 'Bought ' + entry.label + ' ' + (entry.credits > 0 ? 'for ' + entry.credits.toFixed(0) + ' cr' : 'for free') + ' at ' + entry.time.toFixed(1) + ' s.';
	return 'Sold ' + entry.mass.toFixed(1) + ' kg for ' + entry.credits.toFixed(1) + ' cr at ' + entry.time.toFixed(1) + ' s.';
}

// A free entry has no credits to show, so the ledger says so.
function spent(credits, digits) {
	return credits > 0 ? '−' + credits.toFixed(digits) + ' cr' : 'free';
}

const clusterNoteIds = ['cluster-iron-note', 'cluster-copper-note', 'cluster-crystal-note'];
const renderedFallCells = new Float64Array([-1, -1, -1]);

function mineralStateTag(ceiling, remaining, looseness) {
	if (remaining === 0) return ' · fallen';
	if (looseness < ceiling.collapseLooseFloor) return ' · remaining strength · sound';
	return selectedLayer === ceiling.firstRow[selectedColumn]
		? ' · remaining strength · loose'
		: ' · remaining strength · weakened (held)';
}

function mineralReadout() {
	const ceiling = window.SteamCeiling.state;
	const index = selectedLayer * ceiling.columns + selectedColumn;
	const offset = index * 3;
	const remaining = ceiling.strength[index];
	const initial = ceiling.initialStrength[index];
	const looseness = ceiling.damageField[index];
	setText(ui['mineral-cell'], 'Column ' + (selectedColumn + 1) + ' / ' + ceiling.columns + ' · Layer ' + (selectedLayer + 1) + ' / ' + ceiling.rows);
	setText(ui['mineral-strength'], remaining.toFixed(2) + ' / ' + initial.toFixed(2) + ' J' + mineralStateTag(ceiling, remaining, looseness));
	const strengthRatio = initial > 0 ? remaining / initial : 0;
	if (Number(ui['strength-meter'].value) !== strengthRatio) ui['strength-meter'].value = strengthRatio;
	setText(ui['mineral-composition'], 'Fe ' + (ceiling.minerals[offset] * 100).toFixed(1) + '% · Cu ' + (ceiling.minerals[offset + 1] * 100).toFixed(1) + '% · Cr ' + (ceiling.minerals[offset + 2] * 100).toFixed(1) + '%');
	setText(ui['mineral-price'], 'Value ' + ceiling.prices[index].toFixed(2) + ' cr/cell · Fe ' + (ceiling.minerals[offset] * 100).toFixed(0) + '% Cu ' + (ceiling.minerals[offset + 1] * 100).toFixed(0) + '% Cr ' + (ceiling.minerals[offset + 2] * 100).toFixed(0) + '% · R ' + (ceiling.elements[offset] * 100).toFixed(0) + '% G ' + (ceiling.elements[offset + 1] * 100).toFixed(0) + '% B ' + (ceiling.elements[offset + 2] * 100).toFixed(0) + '%');
}

function miningReadout() {
	const ceiling = window.SteamCeiling.state;
	mineralReadout();
	for (let i = 0; i < 3; i++) {
		const cells = ceiling.fallCells[i];
		if (renderedFallCells[i] === cells) continue;
		renderedFallCells[i] = cells;
		const groups = ceiling.fallGroups[i];
		setText(ui[clusterNoteIds[i]], groups > 0
			? groups + ' falls · ' + (cells / groups).toFixed(1) + ' cells/fall'
			: '10% is the plain loose-face clump');
	}
	setText(ui.extracted, ceiling.extractedCells + ' cells');
	setText(ui.falling, ceiling.airborneCells + ' cells');
	setText(ui.caught, ceiling.caughtCells + ' cells');
	setText(ui.lost, ceiling.lostCells + ' cells');
	setText(ui['cargo-mass'], ceiling.cargoMass.toFixed(1) + ' kg');
	setText(ui['cargo-value'], ceiling.cargoValue.toFixed(1) + ' cr · ' + ceiling.cargoCells + ' cells');
	setText(ui['sold-mass'], (ceiling.soldCells * ceiling.cellMass).toFixed(1) + ' kg');
	setText(ui['sold-value'], ceiling.soldValue.toFixed(1) + ' cr · ' + ceiling.soldCells + ' cells');
	setText(ui['sale-count'], ceiling.ledger.length + ' entries');
	setText(ui.credits, ceiling.commune ? 'commons' : ceiling.funds.toFixed(1) + ' cr');
	// Recharge is offered whenever the reserve is short and funds cover a joule.
	// In communism mode the import is free, so only the reserve decides.
	const deficit = config.battery - world.battery;
	const refill = window.SteamCeiling.rechargeCost(world);
	setText(ui['refuel-cost'], ceiling.commune ? 'free' : refill.toFixed(1) + ' cr');
	setText(ui['fuel-price'], ceiling.commune ? 'free' : String(ceiling.fuelPrice));
	setDisabled(ui.refuel, ceiling.commune ? deficit < 1 : refill <= 0 || ceiling.funds < ceiling.fuelPrice / 1000);
	setText(ui.refuel, deficit >= 1 ? 'Recharge ' + (deficit / 1000).toFixed(2) + ' kJ' : 'Reserve full');
	for (let i = 0; i < 3; i++) {
		setText(inventoryCells[i * 2], ceiling.cargoMinerals[i].toFixed(3));
		setText(inventoryCells[i * 2 + 1], ceiling.soldMinerals[i].toFixed(3));
		setText(inventoryPrices[i], marketText(ceiling.mineralPrices[i], ceiling.referencePrices[i], ceiling.demandTrend[i]));
	}
	if (renderedSales === ceiling.ledger.length) return;
	renderedSales = ceiling.ledger.length;
	setText(ui['transaction-count'], '(' + renderedSales + ')');
	ui.ledger.replaceChildren();
	ui.ledger.start = renderedSales;
	for (let i = renderedSales - 1; i >= Math.max(0, renderedSales - 8); i--) {
		const entry = ceiling.ledger[i];
		const item = document.createElement('li');
		item.textContent = ledgerText(entry);
		ui.ledger.appendChild(item);
	}
	if (renderedSales > 0) {
		setText(ui['transaction-status'], ledgerStatus(ceiling.ledger[renderedSales - 1]));
	} else {
		setText(ui['transaction-status'], 'Catch fragments in the amber collector, then touch a SELL wall.');
	}
}
function readout() {
	miningReadout();
	refreshUpgrades();
	specReadout();
	// The tilt keeper moves the piston by itself, so the slider and its readout
	// follow the world angle on the readout cadence instead of only on input.
	syncPistonControl();
	autopilotReadout();
	refreshPlayers();
	syncActiveControls();
	showPrediction = predictionReadout();
	ui.clock.textContent = world.time.toFixed(1) + ' s';
	ui.battery.textContent = (world.battery / 1000).toFixed(2) + ' kJ';
	const ceiling = window.SteamCeiling.state;
	const reserveWarning = world.battery < 0.5 ? 'EMPTY' : world.battery < config.battery * 0.1 ? 'LOW' : '';
	const onPad = physics.onChargePad(world);
	const chargingNow = physics.charging(world);
	setWarning('reserve-telemetry', reserveWarning);
	if (chargingNow) setText(ui['reserve-note'], 'Charging ' + (config.chargePower / 1000).toFixed(1) + ' kW · ' + ((config.battery - world.battery) / config.chargePower).toFixed(1) + ' s to full');
	else if (onPad && world.battery >= config.battery) setText(ui['reserve-note'], 'Reserve full · centre pad');
	else if (onPad) setText(ui['reserve-note'], 'On the centre pad · stop to charge (' + config.chargeSeconds + ' s full)');
	else if (reserveWarning === 'EMPTY') setText(ui['reserve-note'], 'Empty · hand-crank crawl to the centre pad, or market import');
	else if (reserveWarning) setText(ui['reserve-note'], 'Low reserve · park on the centre pad');
	else setText(ui['reserve-note'], 'Centre pad refills free in ' + config.chargeSeconds + ' s · emergency import in the market');
	const heldMass = physics.heldBallMass(world);
	const cargoFull = ceiling.cargoCells >= ceiling.storageLimit;
	setWarning('cargo-telemetry', cargoFull ? 'FULL' : '');
	setText(ui['cargo-note'], cargoFull ? 'Full · extra fragments are refused until you sell at a wall' : '100 cells maximum · cargo adds mass');
	ui.cargo.textContent = ceiling.cargoCells + ' / ' + ceiling.storageLimit;
	ui['platform-mass'].textContent = (physics.dryMass() + ceiling.cargoMass + heldMass).toFixed(1) + ' kg';
	ui.funds.textContent = ceiling.commune ? 'commons' : ceiling.funds.toFixed(1) + ' cr';
	setText(ui['funds-note'], ceiling.commune ? 'Nothing costs · sales still measured' : 'Automatic sale at either wall');
	const balls = world.balls || [];
	const machine = playerApi.machineOf(activePlayer());
	const watched = physics.focusBallOf(world, machine);
	let pushableCount = 0;
	for (let i = 0; i < balls.length; i++) if (physics.mayPush(balls[i], physics.machineBody(machine).id)) pushableCount++;
	ui['ball-energy'].textContent = (watched ? physics.ballEnergy(watched).toFixed(1) : '0.0') + ' J' + (pushableCount > 1 ? ' · ' + pushableCount + ' balls' : '');
	ui.heat.textContent = world.heat.toFixed(1) + ' J';
	const temperature = physics.temperature(world);
	const thermalFactor = physics.thermalFactor(world);
	ui.temperature.textContent = temperature.toFixed(1) + ' °C';
	setWarning('thermal-telemetry', thermalFactor === 0 ? 'CUTOFF' : thermalFactor < 1 ? 'HOT' : '');
	setText(ui['thermal-status'], thermalFactor >= 1 ? 'Drive output 100% · cooling normally'
		: thermalFactor > 0 ? 'Overheating · drive output ' + Math.round(thermalFactor * 100) + '%'
		: 'Cutoff · cool before powering');
	ui.cooled.textContent = world.cooledEnergy.toFixed(1) + ' J';
	ui.error.textContent = (physics.totalEnergy(world) - world.initialEnergy).toFixed(6) + ' J';
	ui.motion.textContent = playerApi.activeSpeed().toFixed(2) + ' m/s';
	const driveOn = Boolean(machine.drive);
	const pressed = String(driveOn);
	if (ui.drive.getAttribute('aria-pressed') !== pressed) ui.drive.setAttribute('aria-pressed', pressed);
	setText(ui.drive.firstChild, driveOn ? 'Drive on ' : 'Drive off ');
	const canLaunch = physics.canLaunch(world, watched);
	setDisabled(ui.launch, !canLaunch);
	statusReadout(reserveWarning, onPad, cargoFull, thermalFactor, temperature, canLaunch, driveOn);
}

// The platform rests on the terrain and only leaves it where the ground drops
// away, so the base height under it says whether it is on the ground now.
function platformGrounded() {
	const platform = world.platform;
	return platform.y <= physics.platformBaseAt(platform.x, platform.angle) + 0.02;
}

// The status bar: three facts that stay true all session, then the messages
// that exist only while their condition does. Each message keeps its own
// tone, so the ball's advice and the reserve warning stand side by side.
function statusReadout(reserveWarning, onPad, cargoFull, thermalFactor, temperature, canLaunch, driveOn) {
	const ceiling = window.SteamCeiling.state;
	setText(ui['fact-reserve'], (world.battery / 1000).toFixed(2) + ' kJ');
	setTone(ui['fact-reserve'], reserveWarning === 'EMPTY' ? 'danger' : reserveWarning ? 'warn' : '');
	setText(ui['fact-cargo'], ceiling.cargoCells + '/' + ceiling.storageLimit);
	setTone(ui['fact-cargo'], cargoFull ? 'warn' : '');
	setText(ui['fact-temp'], temperature.toFixed(0) + ' °C');
	setTone(ui['fact-temp'], thermalFactor === 0 ? 'danger' : thermalFactor < 1 ? 'warn' : '');
	// The line describes the selected platform's ball, like the computer does.
	const machine = playerApi.machineOf(activePlayer());
	const watched = physics.focusBallOf(world, machine);
	if (!watched) setMessage(ui['status-ball'], 'No ball this platform may push', 'warn');
	else if (watched.state === 'held') {
		if (!driveOn) setMessage(ui['status-ball'], 'Ball held · enable drive to release', 'warn');
		else if (!canLaunch) setMessage(ui['status-ball'], thermalFactor === 0 ? 'Overheated · wait for cooling' : 'Insufficient energy to lift ball', 'warn');
		else setMessage(ui['status-ball'], 'Ball held · press E to release' + (thermalFactor < 1 ? ' · drive derated' : ''), 'info');
	} else if (watched.state === 'grounded') setMessage(ui['status-ball'], 'Ball grounded · move over it to collect', 'warn');
	else setMessage(ui['status-ball'], 'Ball in flight · ' + (machine.pushes || 0) + ' powered pushes' + (thermalFactor < 1 ? ' · drive derated' : ''), 'info');
	// The two ways out of a short reserve, said only while both apply: the
	// reserve is low and the platform is on the ground to act on it. Standing
	// on the pad already grants the first one, so it stops there.
	setMessage(ui['status-energy'], reserveWarning && !onPad && platformGrounded()
		? 'Park on the centre pad to refill · click low ground to travel' : '', 'danger');
}
