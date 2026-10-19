(function () {
	'use strict';
	const physics = SteamPhysics;
	const config = physics.config;
	const canvas = document.getElementById('c');
	const context = canvas.getContext('2d');
	const ids = ['clock', 'drive', 'launch', 'status', 'prediction-status', 'force', 'force-value', 'battery', 'cargo', 'platform-mass', 'funds', 'ball-energy', 'heat', 'temperature', 'thermal-status', 'cooled', 'error', 'motion', 'pause', 'speed', 'shape', 'view-modes',
		'platform-spec', 'research-rows', 'research-status', 'research-progress',
		'mineral-cell', 'mineral-strength', 'strength-meter', 'mineral-composition', 'mineral-price',
		'extracted', 'falling', 'caught', 'lost', 'credits', 'cargo-mass', 'cargo-value', 'sold-mass', 'sold-value', 'sale-count',
		'inventory-rows', 'transaction-status', 'transaction-count', 'ledger', 'equipment-rows', 'equipment-status',
		'refuel', 'refuel-cost', 'fuel-price', 'reserve-note', 'cargo-note',
		'reserve-telemetry', 'cargo-telemetry', 'thermal-telemetry'];
	const ui = {};
	for (const id of ids) ui[id] = document.getElementById(id);
	let selectedColumn = 95;
	let selectedLayer = 0;
	let renderedSales = -1;
	const inventoryCells = [];
	(function buildInventory() {
		const ceiling = window.SteamCeiling.state;
		for (let i = 0; i < ceiling.mineralNames.length; i++) {
			const row = document.createElement('tr');
			const name = document.createElement('th');
			name.scope = 'row';
			name.textContent = ceiling.mineralNames[i];
			row.appendChild(name);
			const price = document.createElement('td');
			price.textContent = ceiling.mineralPrices[i].toFixed(2);
			row.appendChild(price);
			for (let k = 0; k < 2; k++) {
				const cell = document.createElement('td');
				cell.textContent = '0.000';
				row.appendChild(cell);
				inventoryCells.push(cell);
			}
			ui['inventory-rows'].appendChild(row);
		}
	})();
	let world = physics.createWorld();
	let showPrediction = false;
	const equipmentRows = [];
	const researchRows = [];
	const specValues = [];
	const specLabels = ['Dry mass', 'Engine force', 'Top speed', 'Bounce pulse', 'Retention', 'Convective cooling', 'Brake recovery'];

	// Equipment and research rows share one layout: a title with cost and mass, an
	// action button, the measured effect, and a prerequisite/unlock note. Built
	// once at startup; only text and the blocked flag change afterwards.
	function buildRow(container, title, action, effect, note, activate) {
		const row = document.createElement('div');
		row.className = 'upgrade-row';
		const heading = document.createElement('b');
		heading.textContent = title;
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = action;
		const detail = document.createElement('small');
		detail.textContent = effect;
		const requirement = document.createElement('small');
		requirement.className = 'requirement';
		requirement.textContent = note;
		row.append(heading, button, detail, requirement);
		container.appendChild(row);
		button.addEventListener('click', activate);
		return { row, button, requirement };
	}

	// Names are quoted exactly as authored, so the equipment and research notes
	// read the same way.
	function prerequisiteNames(node) {
		let names = '';
		for (const id of node.requires) names += (names ? ', ' : '') + SteamResearch.find(id).name;
		return names;
	}

	function unlockText(node) {
		if (node.capability === 'prediction') return 'the predicted trajectory overlay';
		let names = '';
		for (const item of SteamEquipment.items) if (item.requires === node.id) names += (names ? ', ' : '') + item.name;
		return names;
	}

	(function buildUpgrades() {
		ui['fuel-price'].textContent = String(window.SteamCeiling.state.fuelPrice);
		for (const item of SteamEquipment.items) {
			const mass = item.mass ? ' · ' + (item.mass > 0 ? '+' : '−') + Math.abs(item.mass) + ' KG' : '';
			const technology = SteamResearch.find(item.requires);
			const row = buildRow(ui['equipment-rows'], item.name.toUpperCase() + ' · ' + item.cost + ' CR' + mass, 'Buy', item.effect,
				technology ? 'Needs research: ' + technology.name : 'No research needed',
				function () { buyEquipment(item.id); });
			row.item = item;
			equipmentRows.push(row);
		}
		for (const node of SteamResearch.nodes) {
			const unlocked = unlockText(node);
			const note = (node.requires.length ? 'Needs research: ' + prerequisiteNames(node) : 'No prerequisites') + (unlocked ? ' · unlocks ' + unlocked : '');
			const row = buildRow(ui['research-rows'], node.name.toUpperCase() + ' · ' + node.cost + ' CR', 'Research', node.effect, note,
				function () { buyResearch(node.id); });
			row.node = node;
			researchRows.push(row);
		}
		for (const label of specLabels) {
			const term = document.createElement('dt');
			term.textContent = label;
			const value = document.createElement('dd');
			value.textContent = '—';
			ui['platform-spec'].append(term, value);
			specValues.push(value);
		}
	})();

	function buyEquipment(id) {
		const item = SteamEquipment.find(id);
		if (SteamEquipment.install(id, world)) ui['equipment-status'].textContent = 'Installed ' + item.name + ' at ' + world.time.toFixed(1) + ' s.';
		else if (SteamEquipment.isInstalled(id)) ui['equipment-status'].textContent = item.name + ' is already installed.';
		else if (!SteamEquipment.isUnlocked(id)) ui['equipment-status'].textContent = item.name + ' needs the ' + SteamResearch.find(item.requires).name + ' research first.';
		else ui['equipment-status'].textContent = 'Not enough funds for ' + item.name + ' (' + item.cost + ' cr needed).';
		refresh();
	}

	function buyResearch(id) {
		const node = SteamResearch.find(id);
		if (SteamResearch.research(id, world)) ui['research-status'].textContent = 'Researched ' + node.name + ' at ' + world.time.toFixed(1) + ' s.';
		else if (SteamResearch.isResearched(id)) ui['research-status'].textContent = node.name + ' is already researched.';
		else if (SteamResearch.status(id) === SteamResearch.constants.LOCKED) ui['research-status'].textContent = node.name + ' stays locked until ' + prerequisiteNames(node) + ' is researched.';
		else ui['research-status'].textContent = 'Not enough funds for ' + node.name + ' (' + node.cost + ' cr needed).';
		refresh();
	}

	// Blocked upgrade buttons stay clickable (aria-disabled, not disabled): a real
	// disabled button swallows the click, and the refusal must say why.
	function setBlocked(button, blocked) { button.setAttribute('aria-disabled', blocked ? 'true' : 'false'); }

	// Locked, available and researched states drive both the button and the row
	// styling, so the panel shows progression without relying on colour alone.
	function refreshUpgrades() {
		const funds = window.SteamCeiling.state.funds;
		for (const row of equipmentRows) {
			const installed = SteamEquipment.isInstalled(row.item.id);
			const unlocked = SteamEquipment.isUnlocked(row.item.id);
			setBlocked(row.button, installed || !unlocked || funds < row.item.cost);
			row.button.textContent = installed ? 'Installed' : unlocked ? 'Buy' : 'Locked';
			row.row.dataset.state = installed ? 'installed' : unlocked ? 'available' : 'locked';
		}
		let completed = 0;
		for (const row of researchRows) {
			const status = SteamResearch.status(row.node.id);
			if (status === SteamResearch.constants.RESEARCHED) completed++;
			setBlocked(row.button, status !== SteamResearch.constants.AVAILABLE || funds < row.node.cost);
			// 'Locked' means a missing prerequisite; an unaffordable but available
			// node still reads 'Research' and is simply blocked.
			row.button.textContent = status === SteamResearch.constants.RESEARCHED ? 'Done' : status === SteamResearch.constants.AVAILABLE ? 'Research' : 'Locked';
			row.row.dataset.state = status;
		}
		ui['research-progress'].textContent = completed + ' / ' + researchRows.length;
	}

	// Installed specification: the live result of base tuning plus every equipment
	// and research delta, which is what the row effects compare against.
	function specReadout() {
		specValues[0].textContent = physics.dryMass().toFixed(1) + ' kg';
		specValues[1].textContent = config.force.toFixed(0) + ' N';
		specValues[2].textContent = config.maxSpeed.toFixed(0) + ' m/s';
		specValues[3].textContent = physics.pulseNow().toFixed(0) + ' J';
		specValues[4].textContent = (physics.retentionNow() * 100).toFixed(0) + '%';
		specValues[5].textContent = physics.conductanceNow().toFixed(2) + ' W/K';
		specValues[6].textContent = (physics.recoveryNow() * 100).toFixed(0) + '%';
	}

	function predictionReadout() {
		if (!SteamResearch.state.prediction) {
			ui['prediction-status'].hidden = true;
			return false;
		}
		ui['prediction-status'].hidden = false;
		const computer = window.SteamPrediction;
		const kinds = computer.kinds;
		const path = computer.predict(world);
		if (path.kind === kinds.PARKED) ui['prediction-status'].textContent = 'Ballistic computer: the ball is ' + world.ball.state + ', so there is no flight to predict.';
		else if (path.kind === kinds.ROCK) ui['prediction-status'].textContent = 'Predicted rock contact at ' + path.endX.toFixed(1) + ' m in ' + path.time.toFixed(2) + ' s · the rebound depends on fracture, so the path stops there.';
		else if (path.kind === kinds.TIMEOUT) ui['prediction-status'].textContent = 'Ballistic computer: still airborne after ' + computer.horizon.toFixed(0) + ' s of prediction.';
		else ui['prediction-status'].textContent = 'Landing ' + (path.kind === kinds.DECK ? 'on the deck' : 'on the ground') + ' at ' + path.endX.toFixed(1) + ' m in ' + path.time.toFixed(2) + ' s · ghost coasts to ' + path.ghostX.toFixed(1) + ' m · '
			+ (path.reachable ? 'intercept reachable at full thrust' : 'intercept short by ' + path.gap.toFixed(1) + ' m at full thrust');
		return true;
	}
	let paused = false;
	let accumulator = 0;
	let previous = 0;
	let lastReadout = -1;
	let width = 0;
	let height = 0;
	let scale = 1;
	let offsetX = 0;
	let floorY = 0;
	let leftHeld = false;
	let rightHeld = false;
	// The canvas is redrawn after simulation steps or when something it shows
	// changed while time stands still (pause, resize, selection, view mode).
	let sceneDirty = true;
	const viewGroup = 'rock-view';
	let viewMode = 'minerals';
	// Hover switching is for precise hovering pointers only; touch and stylus stay click-only.
	const hoverPointer = window.matchMedia('(hover: hover) and (pointer: fine)');
	const viewMinX = -1.5;
	const viewWidth = 25.5;
	// Clicks below this height are travel commands; rock clicks inspect instead.
	// The target marker is drawn to the same height, so the zones are visible.
	const moveClickHeight = 1.7;
	const warningState = { 'reserve-telemetry': '', 'cargo-telemetry': '', 'thermal-telemetry': '' };
	const padLabel = 'CHARGE PAD · 3 kW';
	const padLabelActive = 'CHARGING';

	function setWarning(id, state) {
		if (warningState[id] === state) return;
		warningState[id] = state;
		if (state) ui[id].dataset.warning = state;
		else delete ui[id].dataset.warning;
	}

	function resize() {
		const bounds = canvas.getBoundingClientRect();
		width = bounds.width;
		height = bounds.height;
		const ratio = window.devicePixelRatio || 1;
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(height * ratio);
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		scale = Math.min((width - 32) / viewWidth, (height - 80) / config.ceiling);
		offsetX = (width - viewWidth * scale) / 2 - viewMinX * scale;
		floorY = (height + config.ceiling * scale) / 2 + 9;
		sceneDirty = true;
	}

	function draw() {
		context.clearRect(0, 0, width, height);
		context.save();
		context.translate(offsetX, floorY);
		context.scale(scale, -scale);
		context.lineWidth = 1 / scale;
		const pocketDepth = config.pocketDepth;
		const pocketTop = config.deck;
		context.strokeStyle = '#1e2c32';
		context.beginPath();
		for (let x = 0; x <= config.width; x += 2) { context.moveTo(x, 0); context.lineTo(x, config.ceiling); }
		for (let y = 0; y <= config.ceiling; y += 2) { context.moveTo(0, y); context.lineTo(config.width, y); }
		context.stroke();
		context.fillStyle = '#29383d';
		context.fillRect(-pocketDepth, -0.35, config.width + pocketDepth, 0.35);
		const padMin = physics.chargePadMin();
		const padMax = physics.chargePadMax();
		const chargingNow = physics.charging(world);
		context.fillStyle = chargingNow ? '#2a4a3b' : '#1b3038';
		context.fillRect(padMin, -0.35, padMax - padMin, 0.35);
		context.fillStyle = chargingNow ? '#b9ed91' : '#7fb6d9';
		for (let x = padMin + 0.25; x < padMax; x += 0.5) context.fillRect(x, -0.35, 0.08, 0.35);
		context.fillRect(-pocketDepth - 0.3, 0, 0.3, pocketTop);
		context.fillRect(-0.3, pocketTop, 0.3, config.ceiling - pocketTop);
		context.fillRect(0, config.ceiling, config.width, 0.35);
		context.fillRect(config.width, 0, 0.3, config.ceiling);
		context.fillStyle = '#0a0f11';
		context.fillRect(-pocketDepth, 0, pocketDepth, pocketTop);
		if (window.SteamCeiling) window.SteamCeiling.draw(context, viewMode);
		if (window.SteamCeiling) {
			const ceiling = window.SteamCeiling.state;
			context.strokeStyle = '#edf6f1';
			context.lineWidth = 1.5 / scale;
			context.strokeRect(selectedColumn * ceiling.cell, ceiling.bottom + selectedLayer * ceiling.cell, ceiling.cell, ceiling.cell);
			context.lineWidth = 1 / scale;
		}
		context.strokeStyle = '#657578';
		context.beginPath(); context.moveTo(-pocketDepth, 0); context.lineTo(config.width, 0); context.stroke();
		if (Number.isFinite(world.target)) {
			context.strokeStyle = '#627765';
			context.beginPath(); context.moveTo(world.target, 0); context.lineTo(world.target, 1.7); context.stroke();
		}
		if (showPrediction) drawPrediction();
		const platform = world.platform;
		const left = platform.x - config.platformWidth * 0.5;
		const collectorWidth = config.platformWidth * config.collectorFraction;
		context.fillStyle = '#35454b';
		context.fillRect(left, 0.2, config.platformWidth, 0.4);
		context.fillStyle = '#e6b66e';
		context.fillRect(left, 0.55, collectorWidth, 0.15);
		context.fillStyle = world.drive ? '#b9ed91' : '#718d75';
		context.fillRect(left + collectorWidth, 0.55, config.platformWidth - collectorWidth, 0.15);
		context.fillStyle = '#10191d';
		context.beginPath(); context.arc(left + 0.5, 0.18, 0.18, 0, Math.PI * 2); context.arc(left + config.platformWidth - 0.5, 0.18, 0.18, 0, Math.PI * 2); context.fill();
		const ball = world.ball;
		const ballY = ball.state === 'held' ? config.deck + config.radius : ball.y;
		context.fillStyle = ball.state === 'grounded' ? '#e6b66e' : '#edf6f1';
		context.beginPath(); context.arc(ball.x, ballY, config.radius, 0, Math.PI * 2); context.fill();
		context.strokeStyle = '#a9c7bc';
		context.beginPath(); context.arc(ball.x, ballY, config.radius + 0.13, 0, Math.PI * 2); context.stroke();
		context.restore();
		drawSellLabel(offsetX + 8, floorY - scale * 1.4, -Math.PI * 0.5);
		drawSellLabel(offsetX + config.width * scale - 8, floorY - scale * 1.4, Math.PI * 0.5);
		drawPadLabel(offsetX + config.width * 0.5 * scale, floorY + 0.35 * scale + 12, chargingNow);
	}

	// Ballistic overlay, drawn in world units inside the chamber transform: the
	// dotted flight path, the landing mark, and the platform ghost coasting to the
	// predicted landing time. Amber means the intercept is not reachable or the
	// outcome is unknown.
	function drawPrediction() {
		const path = window.SteamPrediction.state;
		if (path.samples < 2) return;
		context.save();
		context.strokeStyle = path.uncertain ? '#9c8a55' : '#5f9c74';
		context.lineWidth = 1.2 / scale;
		context.setLineDash([0.1, 0.13]);
		context.beginPath();
		context.moveTo(path.pathX[0], path.pathY[0]);
		for (let i = 1; i < path.samples; i++) context.lineTo(path.pathX[i], path.pathY[i]);
		context.stroke();
		context.setLineDash([]);
		context.beginPath(); context.arc(path.endX, path.endY, 0.26, 0, Math.PI * 2); context.stroke();
		context.strokeStyle = path.reachable ? '#b9ed91' : '#e6b66e';
		context.strokeRect(path.ghostX - config.platformWidth * 0.5, config.deck - 0.06, config.platformWidth, 0.12);
		context.restore();
	}

	function drawSellLabel(x, y, rotation) {
		context.save();
		context.translate(x, y);
		context.rotate(rotation);
		context.fillStyle = '#e6b66e';
		context.font = '700 9px ui-monospace, monospace';
		context.textAlign = 'center';
		context.fillText('SELL', 0, 0);
		context.restore();
	}

	function drawPadLabel(x, y, active) {
		context.fillStyle = active ? '#b9ed91' : '#7fb6d9';
		context.font = '700 9px ui-monospace, monospace';
		context.textAlign = 'center';
		context.fillText(active ? padLabelActive : padLabel, x, y);
	}

	// One ledger carries sales, purchases and research; each entry keeps its own
	// wording so the money trail stays explicit.
	function ledgerText(entry) {
		const stamp = entry.time.toFixed(1) + ' s · ';
		if (entry.type === 'fuel') return stamp + 'Recharged ' + (entry.energy / 1000).toFixed(2) + ' kJ · −' + entry.credits.toFixed(1) + ' cr';
		if (entry.type === 'research') return stamp + 'Researched ' + entry.label + ' · −' + entry.credits.toFixed(0) + ' cr';
		if (entry.type === 'buy') return stamp + 'Bought ' + entry.label + ' · −' + entry.credits.toFixed(0) + ' cr';
		return stamp + 'Sold ' + entry.mass.toFixed(1) + ' kg (' + entry.cells + ' cells) · +' + entry.credits.toFixed(1) + ' cr';
	}

	function ledgerStatus(entry) {
		if (entry.type === 'fuel') return 'Recharged ' + (entry.energy / 1000).toFixed(2) + ' kJ of reserve for ' + entry.credits.toFixed(1) + ' cr at ' + entry.time.toFixed(1) + ' s.';
		if (entry.type === 'research') return 'Researched ' + entry.label + ' for ' + entry.credits.toFixed(0) + ' cr at ' + entry.time.toFixed(1) + ' s.';
		if (entry.type === 'buy') return 'Bought ' + entry.label + ' for ' + entry.credits.toFixed(0) + ' cr at ' + entry.time.toFixed(1) + ' s.';
		return 'Sold ' + entry.mass.toFixed(1) + ' kg for ' + entry.credits.toFixed(1) + ' cr at ' + entry.time.toFixed(1) + ' s.';
	}

	function miningReadout() {
		const ceiling = window.SteamCeiling.state;
		const index = selectedLayer * ceiling.columns + selectedColumn;
		const offset = index * 3;
		const remaining = ceiling.strength[index];
		const initial = ceiling.initialStrength[index];
		ui['mineral-cell'].textContent = 'Column ' + (selectedColumn + 1) + ' / ' + ceiling.columns + ' · Layer ' + (selectedLayer + 1) + ' / ' + ceiling.rows;
		ui['mineral-strength'].textContent = remaining.toFixed(2) + ' / ' + initial.toFixed(2) + ' J' + (remaining === 0 ? ' · depleted' : ' · remaining strength');
		ui['strength-meter'].value = initial > 0 ? remaining / initial : 0;
		ui['mineral-composition'].textContent = 'Fe ' + (ceiling.minerals[offset] * 100).toFixed(1) + '% · Cu ' + (ceiling.minerals[offset + 1] * 100).toFixed(1) + '% · Cr ' + (ceiling.minerals[offset + 2] * 100).toFixed(1) + '%';
		ui['mineral-price'].textContent = 'Value ' + ceiling.prices[index].toFixed(2) + ' cr/cell · R ' + (ceiling.elements[offset] * 100).toFixed(0) + '% G ' + (ceiling.elements[offset + 1] * 100).toFixed(0) + '% B ' + (ceiling.elements[offset + 2] * 100).toFixed(0) + '%';
		ui.extracted.textContent = ceiling.extractedCells + ' cells';
		ui.falling.textContent = ceiling.airborneCells + ' cells';
		ui.caught.textContent = ceiling.caughtCells + ' cells';
		ui.lost.textContent = ceiling.lostCells + ' cells';
		ui['cargo-mass'].textContent = ceiling.cargoMass.toFixed(1) + ' kg';
		ui['cargo-value'].textContent = ceiling.cargoValue.toFixed(1) + ' cr · ' + ceiling.cargoCells + ' cells';
		ui['sold-mass'].textContent = (ceiling.soldCells * ceiling.cellMass).toFixed(1) + ' kg';
		ui['sold-value'].textContent = ceiling.soldValue.toFixed(1) + ' cr · ' + ceiling.soldCells + ' cells';
		ui['sale-count'].textContent = ceiling.ledger.length + ' entries';
		ui.credits.textContent = ceiling.funds.toFixed(1) + ' cr';
		// Recharge is offered whenever the reserve is short and funds cover a joule.
		const refill = window.SteamCeiling.rechargeCost(world);
		ui['refuel-cost'].textContent = refill.toFixed(1) + ' cr';
		ui.refuel.disabled = refill <= 0 || ceiling.funds < ceiling.fuelPrice / 1000;
		ui.refuel.textContent = refill > 0 ? 'Recharge ' + ((config.battery - world.battery) / 1000).toFixed(2) + ' kJ' : 'Reserve full';
		for (let i = 0; i < 3; i++) {
			inventoryCells[i * 2].textContent = ceiling.cargoMinerals[i].toFixed(3);
			inventoryCells[i * 2 + 1].textContent = ceiling.soldMinerals[i].toFixed(3);
		}
		if (renderedSales === ceiling.ledger.length) return;
		renderedSales = ceiling.ledger.length;
		ui['transaction-count'].textContent = '(' + renderedSales + ')';
		ui.ledger.replaceChildren();
		ui.ledger.start = renderedSales;
		for (let i = renderedSales - 1; i >= Math.max(0, renderedSales - 8); i--) {
			const entry = ceiling.ledger[i];
			const item = document.createElement('li');
			item.textContent = ledgerText(entry);
			ui.ledger.appendChild(item);
		}
		if (renderedSales > 0) {
			ui['transaction-status'].textContent = ledgerStatus(ceiling.ledger[renderedSales - 1]);
		} else {
			ui['transaction-status'].textContent = 'Catch fragments in the amber collector, then touch a SELL wall.';
		}
	}

	function readout() {
		miningReadout();
		refreshUpgrades();
		specReadout();
		showPrediction = predictionReadout();
		ui.clock.textContent = world.time.toFixed(1) + ' s';
		ui.battery.textContent = (world.battery / 1000).toFixed(2) + ' kJ';
		const ceiling = window.SteamCeiling.state;
		const reserveWarning = world.battery < 0.5 ? 'EMPTY' : world.battery < config.battery * 0.1 ? 'LOW' : '';
		const onPad = physics.onChargePad(world);
		const chargingNow = physics.charging(world);
		setWarning('reserve-telemetry', reserveWarning);
		if (chargingNow) ui['reserve-note'].textContent = 'Charging ' + (config.chargePower / 1000).toFixed(1) + ' kW · ' + ((config.battery - world.battery) / config.chargePower).toFixed(1) + ' s to full';
		else if (onPad && world.battery >= config.battery) ui['reserve-note'].textContent = 'Reserve full · centre pad';
		else if (onPad) ui['reserve-note'].textContent = 'On the centre pad · stop to charge (' + config.chargeSeconds + ' s full)';
		else if (reserveWarning === 'EMPTY') ui['reserve-note'].textContent = 'Empty · market import or reach the centre pad';
		else if (reserveWarning) ui['reserve-note'].textContent = 'Low reserve · park on the centre pad';
		else ui['reserve-note'].textContent = 'Centre pad refills free in ' + config.chargeSeconds + ' s · emergency import in the market';
		const heldMass = world.ball.state === 'held' ? config.ballMass : 0;
		const cargoFull = ceiling.cargoCells >= ceiling.storageLimit;
		setWarning('cargo-telemetry', cargoFull ? 'FULL' : '');
		ui['cargo-note'].textContent = cargoFull ? 'Full · extra fragments are refused until you sell at a wall' : '100 cells maximum · cargo adds mass';
		ui.cargo.textContent = ceiling.cargoCells + ' / ' + ceiling.storageLimit;
		ui['platform-mass'].textContent = (physics.dryMass() + ceiling.cargoMass + heldMass).toFixed(1) + ' kg';
		ui.funds.textContent = ceiling.funds.toFixed(1) + ' cr';
		ui['ball-energy'].textContent = physics.ballEnergy(world.ball).toFixed(1) + ' J';
		ui.heat.textContent = world.heat.toFixed(1) + ' J';
		const temperature = physics.temperature(world);
		const thermalFactor = physics.thermalFactor(world);
		ui.temperature.textContent = temperature.toFixed(1) + ' °C';
		setWarning('thermal-telemetry', thermalFactor === 0 ? 'CUTOFF' : thermalFactor < 1 ? 'HOT' : '');
		ui['thermal-status'].textContent = thermalFactor >= 1 ? 'Drive output 100% · cooling normally'
			: thermalFactor > 0 ? 'Overheating · drive output ' + Math.round(thermalFactor * 100) + '%'
			: 'Cutoff · cool before powering';
		ui.cooled.textContent = world.cooledEnergy.toFixed(1) + ' J';
		ui.error.textContent = (physics.totalEnergy(world) - world.initialEnergy).toFixed(6) + ' J';
		ui.motion.textContent = world.platform.vx.toFixed(2) + ' m/s';
		ui.drive.setAttribute('aria-pressed', String(world.drive));
		ui.drive.firstChild.textContent = world.drive ? 'Drive on ' : 'Drive off ';
		ui.launch.disabled = !physics.canLaunch(world);
		if (world.ball.state === 'held') {
			if (!world.drive) ui.status.textContent = 'Ball held · enable drive to release';
			else if (!physics.canLaunch(world)) ui.status.textContent = thermalFactor === 0 ? 'Overheated · wait for cooling' : 'Insufficient energy to lift ball';
			else ui.status.textContent = 'Ball held · press E to release' + (thermalFactor < 1 ? ' · drive derated' : '');
		} else if (world.ball.state === 'grounded') ui.status.textContent = 'Ball grounded · move over it to collect';
		else ui.status.textContent = 'Ball in flight · ' + world.pushes + ' powered pushes' + (thermalFactor < 1 ? ' · drive derated' : '');
	}

	// Event-driven readouts also mark the scene, so a paused chamber reflects the change.
	function refresh() { readout(); sceneDirty = true; }

	// Single writer of the rock view mode; click, keyboard and hover all go through it.
	function setViewMode(mode) {
		if (mode === viewMode) return;
		viewMode = mode;
		sceneDirty = true;
	}

	function viewModeChanged(event) {
		const input = event.target;
		if (input.name === viewGroup) setViewMode(input.value);
	}

	// Runs on every pointer move across the menu, so it walks parents without allocating.
	function viewModeHovered(event) {
		if (!hoverPointer.matches) return;
		let node = event.target;
		while (node && node !== ui['view-modes'] && node.tagName !== 'LABEL') node = node.parentElement;
		if (!node || node === ui['view-modes']) return;
		const input = node.control;
		if (!input || input.name !== viewGroup) return;
		input.checked = true;
		setViewMode(input.value);
	}

	// Click zones: visible rock selects an inspector cell; the low band near the
	// ground commands travel. Open air between them does neither, so inspecting
	// rock never moves the platform by accident.
	function rockCellIndex(worldX, worldY) {
		const ceiling = window.SteamCeiling.state;
		if (worldX < 0 || worldX > config.width || worldY < ceiling.bottom || worldY > ceiling.top) return -1;
		const column = Math.min(ceiling.columns - 1, Math.floor(worldX / ceiling.cell));
		const row = Math.min(ceiling.rows - 1, Math.floor((worldY - ceiling.bottom) / ceiling.cell));
		const index = row * ceiling.columns + column;
		if (ceiling.shape === 'square') return ceiling.strength[index] > 0 ? index : -1;
		// The smooth surface is drawn as a linear profile between column vertices.
		const fraction = (worldX - column * ceiling.cell) / ceiling.cell;
		const surface = ceiling.heightmap[column] + (ceiling.heightmap[column + 1] - ceiling.heightmap[column]) * fraction;
		return worldY >= surface ? index : -1;
	}

	function selectCell(index) {
		const columns = window.SteamCeiling.state.columns;
		selectedColumn = index % columns;
		selectedLayer = Math.floor(index / columns);
		refresh();
	}

	function updateDirection() {
		world.direction = Number(rightHeld) - Number(leftHeld);
		if (world.direction) world.target = NaN;
		sceneDirty = true;
	}

	function clearInput() { leftHeld = false; rightHeld = false; updateDirection(); }
	function toggleDrive() { world.drive = !world.drive; refresh(); }
	function releaseBall() { physics.launch(world); refresh(); }
	function togglePause() { paused = !paused; ui.pause.textContent = paused ? 'Resume' : 'Pause'; accumulator = 0; }
	function setForce(value) {
		world.forceSetting = Math.max(0.1, Math.min(1, value));
		ui.force.value = Math.round(world.forceSetting * 100);
		ui['force-value'].textContent = ui.force.value + '%';
	}

	function isGameKey(code) {
		return code === 'Space' || code === 'KeyQ' || code === 'KeyA' || code === 'KeyD' || code === 'KeyW' || code === 'KeyS' || code === 'KeyE';
	}

	function keydown(event) {
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		if (event.target.closest('textarea, [contenteditable]')) return;
		const key = event.code;
		if (!isGameKey(key)) return;
		event.preventDefault();
		if (document.activeElement && document.activeElement !== canvas && document.activeElement !== document.body) {
			document.activeElement.blur();
		}
		if (key === 'KeyA') leftHeld = true;
		if (key === 'KeyD') rightHeld = true;
		updateDirection();
		if (key === 'KeyW') setForce(world.forceSetting + 0.1);
		if (key === 'KeyS') setForce(world.forceSetting - 0.1);
		if (event.repeat) return;
		if (key === 'Space' || key === 'KeyQ') toggleDrive();
		if (key === 'KeyE') releaseBall();
	}

	function keyup(event) {
		const key = event.code;
		if (key === 'Space' || key === 'KeyQ') event.preventDefault();
		if (key === 'KeyA') leftHeld = false;
		if (key === 'KeyD') rightHeld = false;
		updateDirection();
	}

	function bindDirection(id, direction) {
		const button = document.getElementById(id);
		button.addEventListener('pointerdown', function (event) {
			button.setPointerCapture(event.pointerId);
			if (direction < 0) leftHeld = true;
			else rightHeld = true;
			updateDirection();
		});
		button.addEventListener('pointerup', clearInput);
		button.addEventListener('pointercancel', clearInput);
		button.addEventListener('lostpointercapture', clearInput);
	}

	function frame(now) {
		const elapsed = previous ? Math.min((now - previous) / 1000, 0.1) : 0;
		previous = now;
		if (!paused && !document.hidden) accumulator += elapsed * Number(ui.speed.value);
		while (accumulator >= config.step) { physics.step(world, config.step); accumulator -= config.step; sceneDirty = true; }
		if (sceneDirty) { draw(); sceneDirty = false; }
		if (now - lastReadout > 100) { readout(); lastReadout = now; }
		requestAnimationFrame(frame);
	}

	document.getElementById('reset').addEventListener('click', function () {
		world = physics.createWorld(); window.SteamCeiling.setShape(ui.shape.value); renderedSales = -1; clearInput(); setForce(world.forceSetting); accumulator = 0;
		ui['equipment-status'].textContent = 'Sell cargo at a wall to earn credits.';
		ui['research-status'].textContent = 'Sell cargo at a wall to fund research.';
		refresh();
	});
	ui.drive.addEventListener('click', toggleDrive);
	ui.refuel.addEventListener('click', function () {
		const imported = window.SteamCeiling.recharge(world, world.time);
		refresh();
		if (!imported) ui['transaction-status'].textContent = 'Not enough funds to recharge · ' + window.SteamCeiling.rechargeCost(world).toFixed(1) + ' cr fills the reserve.';
	});
	ui.launch.addEventListener('click', releaseBall);
	ui.pause.addEventListener('click', togglePause);
	ui.shape.addEventListener('change', function () { window.SteamCeiling.setShape(ui.shape.value); sceneDirty = true; });
	ui['view-modes'].addEventListener('change', viewModeChanged);
	ui['view-modes'].addEventListener('pointerover', viewModeHovered);
	ui.force.addEventListener('input', function () { setForce(Number(ui.force.value) / 100); });
	canvas.addEventListener('pointerdown', function (event) {
		const bounds = canvas.getBoundingClientRect();
		const worldX = (event.clientX - bounds.left - offsetX) / scale;
		const worldY = (floorY - (event.clientY - bounds.top)) / scale;
		const cell = rockCellIndex(worldX, worldY);
		if (cell >= 0) {
			selectCell(cell);
			canvas.focus();
			return;
		}
		if (worldY <= moveClickHeight && worldX >= 0 && worldX <= config.width) {
			world.target = Math.max(physics.platformMin(), Math.min(physics.platformMax(), worldX));
			sceneDirty = true;
		}
		canvas.focus();
	});
	window.addEventListener('keydown', keydown);
	window.addEventListener('keyup', keyup);
	window.addEventListener('blur', clearInput);
	document.addEventListener('visibilitychange', function () { accumulator = 0; previous = 0; sceneDirty = true; clearInput(); });
	bindDirection('left', -1); bindDirection('right', 1);
	new ResizeObserver(resize).observe(canvas);
	resize(); refresh(); requestAnimationFrame(frame);
})();
