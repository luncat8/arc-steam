(function () {
	'use strict';
	const physics = SteamPhysics;
	const config = physics.config;
	const canvas = document.getElementById('c');
	const context = canvas.getContext('2d');
	const ids = ['clock', 'drive', 'launch', 'status', 'force', 'force-value', 'battery', 'cargo', 'platform-mass', 'funds', 'ball-energy', 'heat', 'error', 'motion', 'pause', 'speed', 'shape', 'view',
		'mineral-column', 'column-label', 'mineral-layer', 'layer-label', 'mineral-strength', 'strength-meter', 'mineral-composition', 'mineral-price',
		'extracted', 'falling', 'caught', 'lost', 'credits', 'cargo-mass', 'cargo-value', 'sold-mass', 'sold-value', 'sale-count',
		'inventory-rows', 'transaction-status', 'transaction-count', 'ledger'];
	const ui = {};
	for (const id of ids) ui[id] = document.getElementById(id);
	let selectedColumn = 95;
	let selectedLayer = 0;
	let renderedSales = -1;
	const inventoryCells = [];
	(function buildInventory() {
		const ceiling = window.SteamCeiling.state();
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
	const viewMinX = -1.5;
	const viewWidth = 25.5;

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
		context.fillRect(-pocketDepth - 0.3, 0, 0.3, pocketTop);
		context.fillRect(-0.3, pocketTop, 0.3, config.ceiling - pocketTop);
		context.fillRect(0, config.ceiling, config.width, 0.35);
		context.fillRect(config.width, 0, 0.3, config.ceiling);
		context.fillStyle = '#0a0f11';
		context.fillRect(-pocketDepth, 0, pocketDepth, pocketTop);
		if (window.SteamCeiling) window.SteamCeiling.draw(context, ui.view.value);
		if (window.SteamCeiling) {
			const ceiling = window.SteamCeiling.state();
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

	function miningReadout() {
		const ceiling = window.SteamCeiling.state();
		const index = selectedLayer * ceiling.columns + selectedColumn;
		const offset = index * 3;
		const remaining = ceiling.strength[index];
		const initial = ceiling.initialStrength[index];
		ui['column-label'].textContent = (selectedColumn + 1) + ' / ' + ceiling.columns;
		ui['layer-label'].textContent = (selectedLayer + 1) + ' / ' + ceiling.rows;
		ui['mineral-strength'].textContent = remaining.toFixed(2) + ' / ' + initial.toFixed(2) + ' J' + (remaining === 0 ? ' · depleted' : ' · remaining strength');
		ui['strength-meter'].value = initial > 0 ? remaining / initial : 0;
		ui['mineral-composition'].textContent = 'Fe ' + (ceiling.minerals[offset] * 100).toFixed(1) + '% · Cu ' + (ceiling.minerals[offset + 1] * 100).toFixed(1) + '% · Cr ' + (ceiling.minerals[offset + 2] * 100).toFixed(1) + '%';
		ui['mineral-price'].textContent = 'Value ' + ceiling.prices[index].toFixed(2) + ' cr/cell · R ' + (ceiling.elements[offset] * 100).toFixed(0) + '% G ' + (ceiling.elements[offset + 1] * 100).toFixed(0) + '% B ' + (ceiling.elements[offset + 2] * 100).toFixed(0) + '%';
		ui.extracted.textContent = ceiling.extractedCells() + ' cells';
		ui.falling.textContent = ceiling.airborneCells() + ' cells';
		ui.caught.textContent = ceiling.caughtCells() + ' cells';
		ui.lost.textContent = ceiling.lostCells() + ' cells';
		ui['cargo-mass'].textContent = ceiling.cargoMass().toFixed(1) + ' kg';
		ui['cargo-value'].textContent = ceiling.cargoValue().toFixed(1) + ' cr · ' + ceiling.cargoCells() + ' cells';
		ui['sold-mass'].textContent = (ceiling.soldCells() * ceiling.cellMass).toFixed(1) + ' kg';
		ui['sold-value'].textContent = ceiling.soldValue().toFixed(1) + ' cr · ' + ceiling.soldCells() + ' cells';
		ui['sale-count'].textContent = ceiling.ledger.length + ' sales';
		ui.credits.textContent = ceiling.funds().toFixed(1) + ' cr';
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
			item.textContent = entry.time.toFixed(1) + ' s · Sold ' + entry.mass.toFixed(1) + ' kg (' + entry.cells + ' cells) · +' + entry.credits.toFixed(1) + ' cr';
			ui.ledger.appendChild(item);
		}
		if (renderedSales > 0) {
			const last = ceiling.ledger[renderedSales - 1];
			ui['transaction-status'].textContent = 'Sold ' + last.mass.toFixed(1) + ' kg for ' + last.credits.toFixed(1) + ' cr at ' + last.time.toFixed(1) + ' s.';
		} else {
			ui['transaction-status'].textContent = 'Catch fragments in the amber collector, then touch a SELL wall.';
		}
	}

	function readout() {
		miningReadout();
		ui.clock.textContent = world.time.toFixed(1) + ' s';
		ui.battery.textContent = (world.battery / 1000).toFixed(2) + ' kJ';
		const ceiling = window.SteamCeiling.state();
		const heldMass = world.ball.state === 'held' ? config.mass : 0;
		ui.cargo.textContent = ceiling.cargoCells() + ' / ' + ceiling.storageLimit;
		ui['platform-mass'].textContent = (config.platformMass + ceiling.cargoMass() + heldMass).toFixed(1) + ' kg';
		ui.funds.textContent = ceiling.funds().toFixed(1) + ' cr';
		ui['ball-energy'].textContent = physics.ballEnergy(world.ball).toFixed(1) + ' J';
		ui.heat.textContent = world.heat.toFixed(1) + ' J';
		ui.error.textContent = (physics.totalEnergy(world) - world.initialEnergy).toFixed(6) + ' J';
		ui.motion.textContent = world.platform.vx.toFixed(2) + ' m/s';
		ui.drive.setAttribute('aria-pressed', String(world.drive));
		ui.drive.firstChild.textContent = world.drive ? 'Drive on ' : 'Drive off ';
		ui.launch.disabled = world.ball.state !== 'held' || !world.drive || world.battery * config.efficiency <= config.mass * config.gravity * config.deck;
		if (world.ball.state === 'held') ui.status.textContent = world.drive ? 'Ball held · press E to release' : 'Ball held · enable drive to release';
		else if (world.ball.state === 'grounded') ui.status.textContent = 'Ball grounded · move over it to collect';
		else ui.status.textContent = 'Ball in flight · ' + world.pushes + ' powered pushes';
	}

	function updateDirection() {
		world.direction = Number(rightHeld) - Number(leftHeld);
		if (world.direction) world.target = NaN;
	}

	function clearInput() { leftHeld = false; rightHeld = false; updateDirection(); }
	function toggleDrive() { world.drive = !world.drive; readout(); }
	function releaseBall() { physics.launch(world); readout(); }
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
		while (accumulator >= config.step) { physics.step(world, config.step); accumulator -= config.step; }
		draw();
		if (now - lastReadout > 100) { readout(); lastReadout = now; }
		requestAnimationFrame(frame);
	}

	document.getElementById('reset').addEventListener('click', function () {
		world = physics.createWorld(); window.SteamCeiling.setShape(ui.shape.value); renderedSales = -1; clearInput(); setForce(world.forceSetting); accumulator = 0; readout();
	});
	ui.drive.addEventListener('click', toggleDrive);
	ui.launch.addEventListener('click', releaseBall);
	ui.pause.addEventListener('click', togglePause);
	ui.shape.addEventListener('change', function () { window.SteamCeiling.setShape(ui.shape.value); });
	ui.force.addEventListener('input', function () { setForce(Number(ui.force.value) / 100); });
	ui['mineral-column'].addEventListener('input', function () { selectedColumn = Number(ui['mineral-column'].value) - 1; readout(); });
	ui['mineral-layer'].addEventListener('input', function () { selectedLayer = Number(ui['mineral-layer'].value) - 1; readout(); });
	canvas.addEventListener('pointerdown', function (event) {
		const bounds = canvas.getBoundingClientRect();
		const worldX = (event.clientX - bounds.left - offsetX) / scale;
		const worldY = (floorY - (event.clientY - bounds.top)) / scale;
		const ceiling = window.SteamCeiling.state();
		if (worldY >= ceiling.bottom && worldX >= 0 && worldX <= config.width) {
			selectedColumn = Math.max(0, Math.min(ceiling.columns - 1, Math.floor(worldX / ceiling.cell)));
			selectedLayer = Math.max(0, Math.min(ceiling.rows - 1, Math.floor((worldY - ceiling.bottom) / ceiling.cell)));
			ui['mineral-column'].value = selectedColumn + 1;
			ui['mineral-layer'].value = selectedLayer + 1;
			readout();
			canvas.focus();
			return;
		}
		world.target = Math.max(physics.platformMin(), Math.min(physics.platformMax(), worldX));
		canvas.focus();
	});
	window.addEventListener('keydown', keydown);
	window.addEventListener('keyup', keyup);
	window.addEventListener('blur', clearInput);
	document.addEventListener('visibilitychange', function () { accumulator = 0; previous = 0; clearInput(); });
	bindDirection('left', -1); bindDirection('right', 1);
	new ResizeObserver(resize).observe(canvas);
	resize(); readout(); requestAnimationFrame(frame);
})();
