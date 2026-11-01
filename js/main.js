(function () {
	'use strict';
	const physics = SteamPhysics;
	const autopilot = SteamAutopilot;
	const playerApi = SteamPlayers;
	const config = physics.config;
	const canvas = document.getElementById('c');
	const context = canvas.getContext('2d');
	const ids = ['clock', 'drive', 'launch', 'status-bar', 'status-ball', 'status-energy', 'fact-reserve', 'fact-cargo', 'fact-temp', 'prediction-status', 'force', 'force-value', 'piston-angle', 'piston-value',
		'autopilot', 'auto-move', 'auto-smart', 'auto-drive', 'auto-angle', 'autopilot-status', 'battery', 'cargo', 'platform-mass', 'funds', 'funds-note', 'ball-energy', 'heat', 'temperature', 'thermal-status', 'cooled', 'error', 'motion', 'pause', 'speed', 'shape', 'balls', 'commune', 'test-mode', 'view-modes',
		'platform-spec', 'spec-card', 'progression-tree', 'tree-links', 'progression-status', 'research-progress', 'science-funds',
		'mineral-cell', 'mineral-strength', 'strength-meter', 'mineral-composition', 'mineral-price',
		'extracted', 'falling', 'caught', 'lost', 'credits', 'cargo-mass', 'cargo-value', 'sold-mass', 'sold-value', 'sale-count',
		'inventory-rows', 'transaction-status', 'transaction-count', 'ledger',
		'refuel', 'refuel-cost', 'fuel-price', 'reserve-note', 'cargo-note',
		'reserve-telemetry', 'cargo-telemetry', 'thermal-telemetry', 'mineral-tooltip', 'science-drawer', 'market-drawer', 'science-open', 'science-close', 'market-open', 'market-close',
		'player-list', 'control-title', 'rig-drive'];
	// One mark per help topic, plus the drawer it feeds.
	for (const topic of window.SteamHelp.topics) ids.push('help-' + topic.id);
	ids.push('help-drawer', 'help-close', 'help-head', 'help-title', 'help-body', 'help-index');
	const ui = {};
	for (const id of ids) ui[id] = document.getElementById(id);

	// The readout cadence re-evaluates far more often than the panels actually
	// change, so every non-telemetry write goes through these guards: an
	// unchanged value never touches the DOM (no text replacement, attribute
	// churn, or button state flicker). Telemetry numbers below keep writing
	// directly, since they are expected to move.
	function setText(node, text) { if (node.textContent !== text) node.textContent = text; }
	function setDisabled(node, disabled) { if (node.disabled !== disabled) node.disabled = disabled; }
	function setHidden(node, hidden) { if (node.hidden !== hidden) node.hidden = hidden; }
	function setChecked(node, checked) { if (node.checked !== checked) node.checked = checked; }
	// A status-bar message is one preallocated node: empty text hides it, and the
	// tone attribute only moves when the severity really changed.
	function setMessage(node, text, tone) {
		setHidden(node, !text);
		if (!text) return;
		setText(node, text);
		setTone(node, tone);
	}
	function setTone(node, tone) { if (node.dataset.tone !== tone) node.dataset.tone = tone; }
	// Platform indicator ramps: index by a 0..1 ratio without allocating a new
	// string on every frame. Fuel runs green (full) to red (empty); the
	// thermometer runs blue (cold) through green and amber to red (cutoff).
	const fuelRamp = ['#b9ed91', '#b9ed91', '#e6b66e', '#e6b66e', '#e0775e', '#e0775e'];
	const tempRamp = ['#7fb6d9', '#7fb6d9', '#b9ed91', '#e6b66e', '#e0775e', '#e0775e'];
	function rampColor(ramp, ratio) {
		const steps = ramp.length - 1;
		const pos = Math.max(0, Math.min(steps, ratio * steps));
		return ramp[Math.floor(pos)];
	}
	// World height to drawn height through the rock layer's vertical perspective;
	// outside the layer the mapping is the identity.
	function rockWarpY(y) {
		const rock = window.SteamCeiling.state;
		if (y < rock.bottom || y > rock.top) return y;
		return rock.rockDrawnY(y);
	}
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
	playerApi.init(world);
	let testMode = false;
	let showPrediction = false;
	const equipmentRows = [];
	const tierRows = [];
	const researchRows = [];
	const nodeCards = {};
	const linkRecords = [];
	let treeRootEl = null;
	let commercialGraderButton = null;
	const specValues = [];
	const specLabels = ['Dry mass', 'Engine force', 'Top speed', 'Bounce pulse', 'Retention', 'Rock retention', 'Rock damage', 'Damage radius', 'Convective cooling', 'Brake recovery'];
	const SVG_NS = 'http://www.w3.org/2000/svg';
	// Planar 3-column grid coordinates: Strike/Ballistics (col 1), Bounce/Drive
	// spine (col 2), Chassis/Thermal/Recovery (col 3), below the Base Chassis root.
	const treeOrder = Object.freeze([
		'materials', 'alloys',
		'impact', 'electromagnetics', 'thermodynamics',
		'ballistics', 'traction', 'storage',
		'ballistics2', 'power'
	]);
	const treeLayout = Object.freeze({
		materials: Object.freeze({ row: 2, col: 2 }),
		alloys: Object.freeze({ row: 2, col: 3 }),
		impact: Object.freeze({ row: 3, col: 1 }),
		electromagnetics: Object.freeze({ row: 3, col: 2 }),
		thermodynamics: Object.freeze({ row: 3, col: 3 }),
		ballistics: Object.freeze({ row: 4, col: 1 }),
		traction: Object.freeze({ row: 4, col: 2 }),
		storage: Object.freeze({ row: 4, col: 3 }),
		ballistics2: Object.freeze({ row: 5, col: 1 }),
		power: Object.freeze({ row: 5, col: 2 })
	});
	const treeEdges = Object.freeze([
		Object.freeze({ from: 'root', to: 'materials', kind: 'trunk' }),
		Object.freeze({ from: 'root', to: 'alloys', kind: 'trunk' }),
		Object.freeze({ from: 'materials', to: 'impact', kind: 'branch' }),
		Object.freeze({ from: 'materials', to: 'electromagnetics', kind: 'spine' }),
		Object.freeze({ from: 'alloys', to: 'thermodynamics', kind: 'spine' }),
		Object.freeze({ from: 'electromagnetics', to: 'ballistics', kind: 'branch' }),
		Object.freeze({ from: 'electromagnetics', to: 'traction', kind: 'spine' }),
		Object.freeze({ from: 'thermodynamics', to: 'storage', kind: 'spine' }),
		Object.freeze({ from: 'traction', to: 'power', kind: 'spine' }),
		Object.freeze({ from: 'thermodynamics', to: 'power', kind: 'gutter' }),
		Object.freeze({ from: 'ballistics', to: 'ballistics2', kind: 'spine' }),
		Object.freeze({ from: 'power', to: 'ballistics2', kind: 'side' })
	]);

	function svgNode(tag) { return document.createElementNS(SVG_NS, tag); }

	// Row titles show list prices, FREE in Communism mode, or TEST for grants.
	function priceLabel(cost) {
		return window.SteamCeiling.state.commune ? 'FREE' : testMode ? 'TEST' : cost + ' CR';
	}

	function massSuffix(mass) {
		return mass ? ' · ' + (mass > 0 ? '+' : '−') + Math.abs(mass) + ' KG' : '';
	}

	function rowTitle(row) {
		return row.name.toUpperCase() + ' · ' + priceLabel(row.cost) + massSuffix(row.mass);
	}

	function prerequisiteNames(node) {
		let names = '';
		for (const id of node.requires) names += (names ? ', ' : '') + SteamResearch.find(id).name;
		return names;
	}

	function buildSlot(container, className, name, cost, mass, action, effect, activate) {
		const row = document.createElement('div');
		row.className = className;
		const heading = document.createElement('b');
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = action;
		const detail = document.createElement('small');
		detail.textContent = effect;
		row.append(heading, button, detail);
		container.appendChild(row);
		button.addEventListener('click', activate);
		return { row, button, heading, detail, name, cost, mass };
	}

	// Engines, radiators and strike balls each fit one unit at a time and swap
	// owned tiers for free, so one builder and one refresher drive all three.
	function buildTierSlot(container, spec) {
		const slot = document.createElement('div');
		slot.className = 'upgrade-row node-buy tier-slot';
		slot.dataset.family = spec.family;
		const heading = document.createElement('b');
		heading.textContent = spec.title;
		const button = document.createElement('button');
		button.type = 'button';
		const select = document.createElement('select');
		select.setAttribute('aria-label', spec.label);
		const options = [];
		for (const entry of spec.entries) {
			const option = document.createElement('option');
			option.value = entry.id;
			options.push(option);
			select.appendChild(option);
		}
		const detail = document.createElement('small');
		slot.append(heading, button, select, detail);
		container.appendChild(slot);
		const record = { slot, heading, button, select, detail, options, spec, selectedIndex: -1, lastInstalled: undefined };
		select.addEventListener('change', function () {
			record.selectedIndex = spec.entries.findIndex(function (entry) { return entry.id === select.value; });
			refresh();
		});
		button.addEventListener('click', function () {
			const entry = spec.entries[record.selectedIndex >= 0 ? record.selectedIndex : 0];
			const ok = spec.install(entry.id);
			if (ok) setText(ui['progression-status'], 'Installed ' + spec.entryName(entry) + '.');
			else setText(ui['progression-status'], spec.refuse(entry));
			refresh();
		});
		tierRows.push(record);
		return record;
	}

	function focusNodeLinks(nodeId) {
		for (const edge of linkRecords) {
			const hit = Boolean(nodeId) && (edge.from === nodeId || edge.to === nodeId);
			const flag = hit ? 'true' : 'false';
			if (edge.path.dataset.focus !== flag) edge.path.dataset.focus = flag;
		}
		for (const id in nodeCards) {
			let linked = false;
			if (nodeId && id !== nodeId) {
				for (const edge of treeEdges) {
					if ((edge.from === nodeId && edge.to === id) || (edge.to === nodeId && edge.from === id)) { linked = true; break; }
				}
			}
			const flag = linked ? 'true' : 'false';
			if (nodeCards[id].dataset.linked !== flag) nodeCards[id].dataset.linked = flag;
		}
	}

	(function buildUpgrades() {
		ui['fuel-price'].textContent = String(window.SteamCeiling.state.fuelPrice);
		const tree = ui['progression-tree'];
		for (const edge of treeEdges) {
			const path = svgNode('path');
			path.dataset.from = edge.from;
			path.dataset.to = edge.to;
			path.dataset.state = '';
			ui['tree-links'].appendChild(path);
			linkRecords.push({ from: edge.from, to: edge.to, kind: edge.kind, path });
		}

		// Root node: base chassis equipment and services unlocked from the start.
		treeRootEl = document.createElement('section');
		treeRootEl.className = 'tree-root';
		const rootTitle = document.createElement('div');
		rootTitle.className = 'tree-root-title';
		rootTitle.textContent = 'BASE CHASSIS · AVAILABLE FROM START';
		const rootBays = document.createElement('div');
		rootBays.className = 'tree-root-bays';
		treeRootEl.append(rootTitle, rootBays);
		tree.insertBefore(treeRootEl, ui['spec-card']);

		const itemsByResearch = {};
		for (const item of SteamEquipment.items) {
			if (item.requires) itemsByResearch[item.requires] = item;
		}
		const graderItem = SteamEquipment.find('grader');
		const graderSlot = buildSlot(rootBays, 'upgrade-row node-buy', graderItem.name, graderItem.cost, graderItem.mass || 0, 'Buy', graderItem.effect,
			function () { buyEquipment(graderItem.id); });
		graderSlot.row.dataset.item = graderItem.id;
		graderSlot.item = graderItem;
		equipmentRows.push(graderSlot);

		buildTierSlot(rootBays, {
			family: 'engines', title: 'ENGINE POWERTRAIN', label: 'Engine upgrades',
			entries: physics.engines, defaultId: 'electric',
			installed: function () { return physics.engineNow().id; },
			unlocked: function () { return true; },
			owned: function (id) { return SteamEquipment.ownsEngine(id); },
			ready: function () { return SteamEquipment.atShop(world); },
			cost: function (entry) { return SteamEquipment.engineCosts[entry.id]; },
			entryName: function (entry) { return entry.name + ' engine'; },
			optionText: function (entry, costText) { return entry.name.toUpperCase() + ' ENGINE · ' + costText; },
			detailText: function (entry) {
				return entry.mass + ' kg · ' + (entry.density / 1000) + ' kJ/kg · ' + entry.reload + ' s refill · ' + Math.round(entry.efficiency * 100) + '% eff · ×' + entry.force + ' force · ×' + entry.speed + ' speed · left shop';
			},
			install: function (id) { return SteamEquipment.buyEngine(id, world); },
			refuse: function (entry) {
				if (physics.engineNow().id === entry.id) return entry.name + ' engine is already installed.';
				if (!SteamEquipment.atShop(world)) return 'Park at the left shop to buy or swap engines.';
				return 'Not enough funds for the ' + entry.name + ' engine (' + SteamEquipment.engineCosts[entry.id] + ' cr needed).';
			}
		});

		const serviceSlot = document.createElement('div');
		serviceSlot.className = 'upgrade-row service-slot';
		const serviceHeading = document.createElement('b');
		serviceHeading.textContent = 'GARAGE GRADER';
		commercialGraderButton = document.createElement('button');
		commercialGraderButton.id = 'commercial-grader';
		commercialGraderButton.type = 'button';
		commercialGraderButton.setAttribute('aria-pressed', 'false');
		commercialGraderButton.addEventListener('click', function () {
			const wasReturning = window.SteamCeiling.state.graderBot.returning;
			const called = window.SteamCeiling.toggleGrader(world);
			refresh();
			setText(ui['progression-status'], called
				? wasReturning ? 'Grader return cancelled · working from its current position.' : 'Grader called from its garage · 50% share of each sweep.'
				: 'Grader dismissed · returning to its garage with the current load.');
		});
		const serviceDetail = document.createElement('small');
		serviceDetail.textContent = 'Autonomous right-bay bot sweeps floor wall-to-wall for a 50% ore share.';
		serviceSlot.append(serviceHeading, commercialGraderButton, serviceDetail);
		rootBays.appendChild(serviceSlot);

		const radiatorSpec = {
			family: 'radiators', title: 'COOLING RADIATORS', label: 'Radiator upgrades',
			entries: SteamEquipment.radiators,
			installed: function () { return SteamEquipment.installedRadiator(); },
			unlocked: function (id) { return SteamEquipment.radiatorUnlocked(id); },
			owned: function (id) { return SteamEquipment.ownsRadiator(id); },
			ready: function () { return true; },
			cost: function (entry) { return entry.cost; },
			entryName: function (entry) { return entry.name; },
			optionText: function (entry, costText) { return entry.name.toUpperCase() + ' · ' + costText + massSuffix(entry.mass); },
			detailText: function (entry) { return '+' + entry.radiatorArea.toFixed(2) + ' m² exposed fins · owned tiers swap free.'; },
			install: function (id) { return SteamEquipment.installRadiator(id, world); },
			refuse: function (entry) {
				if (!SteamEquipment.radiatorUnlocked(entry.id)) return 'The radiator tiers need the Heat transfer research first.';
				if (SteamEquipment.installedRadiator() === entry.id) return entry.name + ' is already installed.';
				return 'Not enough funds for ' + entry.name + ' (' + entry.cost + ' cr needed).';
			}
		};
		const ballSpec = {
			family: 'balls', title: 'STRIKE BALL', label: 'Ball upgrades',
			entries: SteamEquipment.balls, previewIndex: 1, defaultId: 'standard',
			installed: function () { return SteamEquipment.installedBall(); },
			unlocked: function (id) { return SteamEquipment.ballUnlocked(id); },
			owned: function (id) { return SteamEquipment.ownsBall(id); },
			ready: function () { return true; },
			cost: function (entry) { return entry.cost; },
			entryName: function (entry) { return entry.name; },
			optionText: function (entry, costText) { return entry.name.toUpperCase() + ' · ' + costText + massSuffix(entry.mass); },
			detailText: function (entry) {
				const dmg = (2 + (entry.damageBonus || 0)).toFixed(1);
				const loss = Math.round((1 - (0.9 + (entry.rockRetentionBonus || 0))) * 100);
				const rad = (8.775 + (entry.damageRadiusBonus || 0)).toFixed(1);
				return '×' + dmg + ' fracture · ' + loss + '% rock loss · ' + rad + '-cell splash · owned swap free.';
			},
			install: function (id) { return SteamEquipment.installBall(id, world); },
			refuse: function (entry) {
				if (SteamEquipment.installedBall() === entry.id) return entry.name + ' is already installed.';
				if (!SteamEquipment.ballUnlocked(entry.id)) return 'The ball upgrades need the Impact forging research first.';
				return 'Not enough funds for ' + entry.name + ' (' + entry.cost + ' cr needed).';
			}
		};

		// Combined progression nodes: research sits at the top of the card and the
		// equipment or tier family it unlocks sits directly beneath it in the same card.
		for (const id of treeOrder) {
			const node = SteamResearch.find(id);
			const pos = treeLayout[node.id];
			const card = document.createElement('article');
			card.className = 'tree-node';
			card.dataset.node = node.id;
			card.style.gridRow = String(pos.row);
			card.style.gridColumn = String(pos.col);
			const sci = buildSlot(card, 'upgrade-row node-sci', node.name, node.cost, 0, 'Research', node.effect,
				function () { buyResearch(node.id); });
			sci.row.dataset.technology = node.id;
			sci.node = node;
			sci.card = card;
			if (node.requires.length) {
				const req = document.createElement('small');
				req.className = 'mobile-req';
				req.textContent = '↖ Needs: ' + prerequisiteNames(node);
				sci.row.appendChild(req);
			}
			researchRows.push(sci);

			const unlockedItem = itemsByResearch[node.id];
			if (unlockedItem) {
				const buy = buildSlot(card, 'upgrade-row node-buy', unlockedItem.name, unlockedItem.cost, unlockedItem.mass || 0, 'Locked', unlockedItem.effect,
					function () { buyEquipment(unlockedItem.id); });
				buy.row.dataset.item = unlockedItem.id;
				buy.item = unlockedItem;
				equipmentRows.push(buy);
			} else if (node.id === 'thermodynamics') {
				buildTierSlot(card, radiatorSpec);
			} else if (node.id === 'impact') {
				buildTierSlot(card, ballSpec);
			} else {
				const cap = document.createElement('div');
				cap.className = 'node-cap';
				cap.textContent = '◈ ACTIVE ON RESEARCH · NO EXTRA PURCHASE';
				card.appendChild(cap);
			}
			card.addEventListener('pointerenter', function () { focusNodeLinks(node.id); });
			card.addEventListener('pointerleave', function () { focusNodeLinks(''); });
			nodeCards[node.id] = card;
			tree.insertBefore(card, ui['spec-card']);
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

	function localBox(el, treeBox) {
		const r = el.getBoundingClientRect();
		return {
			left: r.left - treeBox.left,
			right: r.right - treeBox.left,
			top: r.top - treeBox.top,
			bottom: r.bottom - treeBox.top,
			cx: (r.left + r.right) * 0.5 - treeBox.left
		};
	}

	function arrowTipDown(x, y) {
		return 'M' + (x - 3.6).toFixed(1) + ' ' + (y - 4.8).toFixed(1) + 'L' + x.toFixed(1) + ' ' + y.toFixed(1) + 'L' + (x + 3.6).toFixed(1) + ' ' + (y - 4.8).toFixed(1);
	}

	function arrowTipLeft(x, y) {
		return 'M' + (x + 4.8).toFixed(1) + ' ' + (y - 3.6).toFixed(1) + 'L' + x.toFixed(1) + ' ' + y.toFixed(1) + 'L' + (x + 4.8).toFixed(1) + ' ' + (y + 3.6).toFixed(1);
	}

	function elbowPath(x1, y1, midY, x2, y2) {
		if (Math.abs(x2 - x1) < 2) return 'M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + 'L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + arrowTipDown(x2, y2);
		const dir = x2 > x1 ? 1 : -1;
		const r = Math.min(6, Math.abs(midY - y1) * 0.5, Math.abs(y2 - midY) * 0.5, Math.abs(x2 - x1) * 0.5);
		return 'M' + x1.toFixed(1) + ' ' + y1.toFixed(1)
			+ 'L' + x1.toFixed(1) + ' ' + (midY - r).toFixed(1)
			+ 'Q' + x1.toFixed(1) + ' ' + midY.toFixed(1) + ' ' + (x1 + dir * r).toFixed(1) + ' ' + midY.toFixed(1)
			+ 'L' + (x2 - dir * r).toFixed(1) + ' ' + midY.toFixed(1)
			+ 'Q' + x2.toFixed(1) + ' ' + midY.toFixed(1) + ' ' + x2.toFixed(1) + ' ' + (midY + r).toFixed(1)
			+ 'L' + x2.toFixed(1) + ' ' + y2.toFixed(1)
			+ arrowTipDown(x2, y2);
	}

	function gutterPath(from, to, midRowTop) {
		const x1 = from.left + 28;
		const y1 = from.bottom;
		const yA = midRowTop - 8;
		const gx = (to.right + from.left) * 0.5;
		const yB = to.top - 8;
		const x2 = to.right - 34;
		const y2 = to.top - 1;
		const r = 5;
		return 'M' + x1.toFixed(1) + ' ' + y1.toFixed(1)
			+ 'L' + x1.toFixed(1) + ' ' + (yA - r).toFixed(1)
			+ 'Q' + x1.toFixed(1) + ' ' + yA.toFixed(1) + ' ' + (x1 - r).toFixed(1) + ' ' + yA.toFixed(1)
			+ 'L' + (gx + r).toFixed(1) + ' ' + yA.toFixed(1)
			+ 'Q' + gx.toFixed(1) + ' ' + yA.toFixed(1) + ' ' + gx.toFixed(1) + ' ' + (yA + r).toFixed(1)
			+ 'L' + gx.toFixed(1) + ' ' + (yB - r).toFixed(1)
			+ 'Q' + gx.toFixed(1) + ' ' + yB.toFixed(1) + ' ' + (gx - r).toFixed(1) + ' ' + yB.toFixed(1)
			+ 'L' + (x2 + r).toFixed(1) + ' ' + yB.toFixed(1)
			+ 'Q' + x2.toFixed(1) + ' ' + yB.toFixed(1) + ' ' + x2.toFixed(1) + ' ' + (yB + r).toFixed(1)
			+ 'L' + x2.toFixed(1) + ' ' + y2.toFixed(1)
			+ arrowTipDown(x2, y2);
	}

	function layoutTreeLinks() {
		if (ui['science-drawer'].hidden) return;
		const treeBox = ui['progression-tree'].getBoundingClientRect();
		if (treeBox.width <= 0) return;
		const rootBox = localBox(treeRootEl, treeBox);
		const boxes = {};
		for (const id in nodeCards) boxes[id] = localBox(nodeCards[id], treeBox);
		for (const edge of linkRecords) {
			const to = boxes[edge.to];
			let d = '';
			if (edge.kind === 'trunk') {
				d = 'M' + to.cx.toFixed(1) + ' ' + rootBox.bottom.toFixed(1) + 'L' + to.cx.toFixed(1) + ' ' + (to.top - 1).toFixed(1) + arrowTipDown(to.cx, to.top - 1);
			} else if (edge.kind === 'spine') {
				const from = boxes[edge.from];
				d = elbowPath(from.cx, from.bottom, to.top - 8, to.cx, to.top - 1);
			} else if (edge.kind === 'branch') {
				const from = boxes[edge.from];
				d = elbowPath(from.left + 34, from.bottom, to.top - 8, to.cx, to.top - 1);
			} else if (edge.kind === 'gutter') {
				d = gutterPath(boxes[edge.from], to, boxes.storage.top);
			} else {
				const from = boxes[edge.from];
				const y = Math.min(from.top + 22, to.top + 22);
				d = 'M' + from.left.toFixed(1) + ' ' + y.toFixed(1) + 'L' + (to.right + 1).toFixed(1) + ' ' + y.toFixed(1) + arrowTipLeft(to.right + 1, y);
			}
			if (edge.path.getAttribute('d') !== d) edge.path.setAttribute('d', d);
		}
	}

	function buyEquipment(id) {
		const item = SteamEquipment.find(id);
		if (SteamEquipment.install(id, world)) setText(ui['progression-status'], 'Installed ' + item.name + ' at ' + world.time.toFixed(1) + ' s.');
		else if (SteamEquipment.isInstalled(id)) setText(ui['progression-status'], item.name + ' is already installed.');
		else if (!SteamEquipment.isUnlocked(id)) setText(ui['progression-status'], item.name + ' needs the ' + SteamResearch.find(item.requires).name + ' research first.');
		else setText(ui['progression-status'], 'Not enough funds for ' + item.name + ' (' + item.cost + ' cr needed).');
		refresh();
	}

	function buyResearch(id) {
		const node = SteamResearch.find(id);
		if (SteamResearch.research(id, world)) setText(ui['progression-status'], 'Researched ' + node.name + ' at ' + world.time.toFixed(1) + ' s.');
		else if (SteamResearch.isResearched(id)) setText(ui['progression-status'], node.name + ' is already researched.');
		else if (SteamResearch.status(id) === SteamResearch.constants.LOCKED) setText(ui['progression-status'], node.name + ' stays locked until ' + prerequisiteNames(node) + ' is researched.');
		else setText(ui['progression-status'], 'Not enough funds for ' + node.name + ' (' + node.cost + ' cr needed).');
		refresh();
	}

	// Communism mode is one writer: the system-bar switch and the M shortcut
	// both go through it, so the economy and the panels never disagree.
	function setCommune(enabled) {
		window.SteamCeiling.setCommune(enabled);
		setChecked(ui.commune, enabled);
		setModeStatus();
		refresh();
	}

	// Test mode applies all normal research and equipment effects without funds
	// or progression gates. Turning it off leaves grants intact until New game.
	function grantTestState() {
		SteamResearch.researchAll(world);
		SteamEquipment.installAll(world);
		SteamEquipment.installRadiator('radiator', world, true);
		SteamEquipment.installBall('spike', world, true);
		const researched = SteamResearch.state.completed;
		let installed = 0;
		for (const item of SteamEquipment.items) if (SteamEquipment.isInstalled(item.id)) installed++;
		setText(ui['progression-status'], 'Test mode · all ' + researched + ' technologies researched and all ' + installed + ' equipment items installed.');
	}

	function setTestMode(enabled) {
		testMode = Boolean(enabled);
		setChecked(ui['test-mode'], testMode);
		if (testMode) grantTestState();
		else setText(ui['progression-status'], 'Test mode off · grants remain active until New game.');
		refresh();
	}

	function setModeStatus() {
		if (testMode) setText(ui['progression-status'], 'Test mode · every technology is researched and every equipment item is installed.');
		else if (window.SteamCeiling.state.commune) setText(ui['progression-status'], 'The commons shares every technology and machine · nothing costs credits.');
		else setText(ui['progression-status'], 'Sell cargo at a wall to fund research and shop gear.');
	}

	// Blocked upgrade buttons stay clickable (aria-disabled, not disabled): a real
	// disabled button swallows the click, and the refusal must say why.
	function setBlocked(button, blocked) {
		const value = blocked ? 'true' : 'false';
		if (button.getAttribute('aria-disabled') !== value) button.setAttribute('aria-disabled', value);
	}
	function setRowState(row, state) { if (row.dataset.state !== state) row.dataset.state = state; }

	function refreshGrader() {
		const bot = window.SteamCeiling.state.graderBot;
		setText(commercialGraderButton, bot.active
			? 'Dismiss · return'
			: bot.returning ? 'Call · cancel return' : 'Call · 50% share');
		const pressed = String(bot.active);
		if (commercialGraderButton.getAttribute('aria-pressed') !== pressed) commercialGraderButton.setAttribute('aria-pressed', pressed);
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

	// The panel is the selected platform's drive, named with the policy it runs
	// under. The rig's own machinery — bounce assist, piston tilt and autopilot —
	// has no meaning on a competitor, so it leaves the panel instead of sitting
	// there disabled with shortcut labels that would drive the other platform.
	let titleIndex = -1;
	let titleBot = null;
	function syncActiveControls() {
		const index = playerApi.state.active;
		const active = playerApi.state.players[index];
		const rigActive = active.kind === 'rig';
		if (index !== titleIndex || active.bot !== titleBot) {
			titleIndex = index;
			titleBot = active.bot;
			setText(ui['control-title'], active.name + ' · ' + (active.bot ? 'BOT' : 'MANUAL'));
		}
		setHidden(ui['rig-drive'], !rigActive);
		syncForceControl();
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
		autopilot.hold('move', false);
		endPistonDrag();
		syncActiveControls();
		refresh();
	}

	function refreshTierSlot(record, funds, commune) {
		const spec = record.spec;
		const installed = spec.installed();
		let selectedIndex = record.selectedIndex;
		if (selectedIndex < 0 || record.lastInstalled !== installed) {
			if (installed === spec.defaultId && spec.previewIndex !== undefined) {
				selectedIndex = spec.previewIndex;
			} else {
				selectedIndex = installed ? spec.entries.findIndex(function (entry) { return entry.id === installed; }) : 0;
				if (selectedIndex < 0) selectedIndex = 0;
			}
			record.selectedIndex = selectedIndex;
			record.lastInstalled = installed;
			for (let i = 0; i < record.options.length; i++) record.options[i].selected = i === selectedIndex;
			record.select.value = spec.entries[selectedIndex].id;
		}
		for (let i = 0; i < spec.entries.length; i++) {
			const entry = spec.entries[i];
			const costText = spec.owned(entry.id) ? 'OWNED' : priceLabel(spec.cost(entry));
			setText(record.options[i], spec.optionText(entry, costText));
		}
		const selected = spec.entries[selectedIndex];
		const active = installed === selected.id;
		const unlocked = spec.unlocked(selected.id);
		const owned = spec.owned(selected.id);
		const cost = spec.cost(selected);
		const blocked = active || !unlocked || !spec.ready() || (!owned && funds < cost && !commune);
		setBlocked(record.button, blocked);
		setText(record.button, active ? 'Installed' : !unlocked ? 'Locked' : owned ? 'Install free' : 'Buy & install');
		setRowState(record.slot, !unlocked && !active ? 'locked' : active && selected.id !== spec.defaultId ? 'installed' : 'available');
		setText(record.detail, spec.detailText(selected));
	}

	function refreshTreeLinks(commune) {
		for (const edge of linkRecords) {
			const done = edge.from === 'root' || commune || SteamResearch.isResearched(edge.from);
			const state = done ? 'done' : SteamResearch.status(edge.from) === SteamResearch.constants.AVAILABLE ? 'ready' : 'locked';
			if (edge.path.dataset.state !== state) edge.path.dataset.state = state;
		}
	}

	// Locked, available and researched states drive buttons, node cards and
	// prerequisite edges together through change-only DOM writers.
	function refreshUpgrades() {
		const ceiling = window.SteamCeiling.state;
		const funds = ceiling.funds;
		refreshGrader();
		for (const row of equipmentRows) {
			const installed = SteamEquipment.isInstalled(row.item.id);
			const unlocked = SteamEquipment.isUnlocked(row.item.id);
			setBlocked(row.button, installed || !unlocked || (funds < row.item.cost && !ceiling.commune));
			setText(row.button, installed ? 'Installed' : unlocked ? 'Buy' : 'Locked');
			setRowState(row.row, installed ? 'installed' : unlocked ? 'available' : 'locked');
			setText(row.heading, rowTitle(row));
		}
		for (const record of tierRows) refreshTierSlot(record, funds, ceiling.commune);
		let completed = 0;
		for (const row of researchRows) {
			const status = SteamResearch.status(row.node.id);
			if (status === SteamResearch.constants.RESEARCHED) completed++;
			setBlocked(row.button, status !== SteamResearch.constants.AVAILABLE || (funds < row.node.cost && !ceiling.commune));
			setText(row.button, status === SteamResearch.constants.RESEARCHED ? 'Done' : status === SteamResearch.constants.AVAILABLE ? 'Research' : 'Locked');
			setRowState(row.row, status);
			setRowState(row.card, status);
			setText(row.heading, rowTitle(row));
		}
		refreshTreeLinks(ceiling.commune);
		setText(ui['research-progress'], completed + ' / ' + researchRows.length);
		setText(ui['science-funds'], ceiling.commune ? 'commons' : funds.toFixed(1) + ' cr');
	}

	// Installed specification: the live result of base tuning plus every equipment
	// and research delta, which is what the row effects compare against.
	function specReadout() {
		setText(specValues[0], physics.dryMass().toFixed(1) + ' kg');
		setText(specValues[1], physics.forceNow().toFixed(0) + ' N');
		setText(specValues[2], physics.speedNow().toFixed(0) + ' m/s');
		setText(specValues[3], physics.pulseNow().toFixed(0) + ' J');
		setText(specValues[4], (physics.retentionNow() * 100).toFixed(0) + '%');
		setText(specValues[5], (physics.rockRetentionNow() * 100).toFixed(0) + '%');
		const dmg = (window.SteamCeiling.state.damageMultiplier).toFixed(1) + '×';
		setText(specValues[6], dmg);
		const rad = window.SteamCeiling.state.damageRadius.toFixed(1) + ' cells';
		setText(specValues[7], rad);
		setText(specValues[8], physics.conductanceNow().toFixed(2) + ' W/K');
		setText(specValues[9], (physics.recoveryNow() * 100).toFixed(0) + '%');
	}

	function predictionReadout() {
		if (!SteamResearch.state.prediction) {
			setHidden(ui['prediction-status'], true);
			return false;
		}
		setHidden(ui['prediction-status'], false);
		const computer = window.SteamPrediction;
		const kinds = computer.kinds;
		const path = computer.predict(world);
		if (path.kind === kinds.PARKED) setText(ui['prediction-status'], 'Ballistic computer: the ball is ' + world.ball.state + ', so there is no flight to predict.');
		else if (path.kind === kinds.ROCK) setText(ui['prediction-status'], 'Predicted rock contact at ' + path.endX.toFixed(1) + ' m in ' + path.time.toFixed(2) + (SteamResearch.state.predictionBounces ? ' s · tier II continues through estimated rebounds; fracture and future controls can change them.' : ' s · the rebound depends on fracture, so the path stops there.'));
		else if (path.kind === kinds.TIMEOUT) setText(ui['prediction-status'], 'Ballistic computer: still airborne after ' + computer.horizon.toFixed(0) + ' s of prediction.');
		else setText(ui['prediction-status'], 'Landing ' + (path.kind === kinds.DECK ? 'on the deck' : 'on the ground') + ' at ' + path.endX.toFixed(1) + ' m in ' + path.time.toFixed(2) + ' s · ghost coasts to ' + path.ghostX.toFixed(1) + ' m · '
			+ (path.reachable ? 'intercept reachable at full thrust' : 'intercept short by ' + path.gap.toFixed(1) + ' m at full thrust'));
		return true;
	}

	// One clause per engaged duty, so the panel says what the autopilot is doing
	// and not only which of its switches are on.
	function travelClause(plan) {
		if (!Number.isFinite(plan.interceptX)) return 'Intercept · ball held, no flight to meet';
		if (plan.contactIn <= 0) return 'Intercept · collecting at ' + plan.interceptX.toFixed(1) + ' m';
		return (plan.smart ? 'Timed intercept · ' : 'Intercept · ') + plan.interceptX.toFixed(1) + ' m in ' + plan.contactIn.toFixed(2) + ' s';
	}

	function autopilotText(plan) {
		let text = '';
		if (plan.move || plan.smart) text = autopilot.suspended('move') ? 'Intercept · manual override' : travelClause(plan);
		if (plan.drive) text += (text ? ' · ' : '') + 'Drive keeper · ' + (autopilot.suspended('drive') ? 'manual override' : plan.wantedDrive ? 'pulse armed' : 'pulse held');
		if (plan.angle) text += (text ? ' · ' : '') + 'Level bounce · ' + (autopilot.suspended('angle') ? 'manual override' : 'tilt to ' + (plan.wantedAngle * 180 / Math.PI).toFixed(1) + '°');
		return text;
	}

	function autopilotReadout() {
		const plan = autopilot.state;
		setHidden(ui['autopilot-status'], !plan.active);
		if (plan.active) setText(ui['autopilot-status'], autopilotText(plan));
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
	// An air drag tilts the piston from the angle it had when the drag began.
	let pistonDragActive = false;
	let pistonDragX = 0;
	let pistonDragY = 0;
	let pistonDragAngle = 0;
	// The canvas is redrawn after simulation steps or when something it shows
	// changed while time stands still (pause, resize, selection, view mode).
	let sceneDirty = true;
	const viewGroup = 'rock-view';
	let viewMode = 'minerals';
	// Hover switching is for precise hovering pointers only; touch and stylus stay click-only.
	const hoverPointer = window.matchMedia('(hover: hover) and (pointer: fine)');
	const viewMinX = -1.5;
	const viewWidth = 25.8 + window.SteamCeiling.state.garageDepth;
	// The chamber fills the canvas. Both 0.35 m boundary strips belong to the
	// scene, so the fit is the roof strip, the chamber and the floor strip; the
	// only room outside it is 2 px above the roof strip and the line the
	// charge-pad label is drawn on under the floor.
	const chamberRoofPad = 2;
	const boundaryStrip = 0.35;
	const padLabelDrop = 14;
	// A canvas taller than that scene keeps the chamber near its top: at most a
	// quarter of the leftover room, and never more than 18 px, may open above the
	// roof strip, so the rest stays under the floor, where it is only backdrop.
	const chamberTopShare = 0.25;
	const chamberTopMax = 18;
	// The fit itself, published so a harness can map a world point to a page
	// point instead of copying the arithmetic.
	const view = { scale: 1, offsetX: 0, floorY: 0 };
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

	function fitStatusBar() { document.body.style.paddingBottom = ui['status-bar'].offsetHeight + 12 + 'px'; }

	function resize() {
		const bounds = canvas.getBoundingClientRect();
		width = bounds.width;
		height = bounds.height;
		const ratio = window.devicePixelRatio || 1;
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(height * ratio);
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		const sceneHeight = config.ceiling + boundaryStrip * 2;
		scale = Math.min((width - 32) / viewWidth, (height - chamberRoofPad - padLabelDrop) / sceneHeight);
		const slack = height - chamberRoofPad - padLabelDrop - sceneHeight * scale;
		const topPad = chamberRoofPad + (slack > 0 ? Math.min(slack * chamberTopShare, chamberTopMax) : 0);
		offsetX = (width - viewWidth * scale) / 2 - viewMinX * scale;
		floorY = topPad + boundaryStrip * scale + config.ceiling * scale;
		view.scale = scale;
		view.offsetX = offsetX;
		view.floorY = floorY;
		sceneDirty = true;
	}

	// The rig's own machinery — fuel and heat bars, collector strip, reflector
	// piston — drawn inside the shared body so it moves, pitches and gets covered
	// exactly like the chassis it sits on.
	function drawRigMachinery(context) {
		const platform = world.platform;
		const left = -config.platformWidth * 0.5;
		const collectorWidth = config.platformWidth * config.collectorFraction;
		// Fuel and temperature ride on the chassis as horizontal and vertical
		// bars, so the platform's state reads at a glance without the telemetry.
		const fuelRatio = Math.max(0, Math.min(1, world.battery / config.battery));
		const tempRatio = Math.max(0, Math.min(1, (physics.temperature(world) - config.ambientTemperature) / (config.thermalCutoff - config.ambientTemperature)));
		const fuelX = left + 0.12;
		const fuelW = config.platformWidth - 0.60;
		const fuelY = 0.46;
		const fuelH = 0.045;
		context.fillStyle = '#0f1618';
		context.fillRect(fuelX, fuelY, fuelW, fuelH);
		context.fillStyle = rampColor(fuelRamp, fuelRatio);
		context.fillRect(fuelX, fuelY, fuelW * fuelRatio, fuelH);
		context.strokeStyle = '#3a4a50';
		context.lineWidth = 0.012;
		context.strokeRect(fuelX, fuelY, fuelW, fuelH);
		// Thermometer on the right end: bulb at the base, stem rising with heat.
		const tempX = left + config.platformWidth - 0.28;
		const tempW = 0.12;
		const tempTop = 0.34;
		const tempBot = 0.58;
		const bulbY = tempTop - 0.047;
		const bulbR = 0.085;
		context.fillStyle = '#0f1618';
		context.fillRect(tempX, tempTop, tempW, tempBot - tempTop);
		context.beginPath();
		context.arc(tempX + tempW * 0.5, bulbY, bulbR, 0, Math.PI * 2);
		context.fill();
		const fillTop = tempBot - tempRatio * (tempBot - tempTop);
		context.fillStyle = rampColor(tempRamp, tempRatio);
		context.fillRect(tempX, fillTop, tempW, tempBot - fillTop);
		context.beginPath();
		context.arc(tempX + tempW * 0.5, bulbY, bulbR * 0.82, 0, Math.PI * 2);
		context.fill();
		context.strokeStyle = '#3a4a50';
		context.lineWidth = 0.012;
		context.strokeRect(tempX, tempTop, tempW, tempBot - tempTop);
		context.fillStyle = '#e6b66e';
		context.fillRect(left, 0.55, collectorWidth, 0.15);
		// The chassis pitch follows the land; piston tilt stays relative to it.
		const pistonNx = -Math.sin(world.pistonAngle);
		const pistonNy = Math.cos(world.pistonAngle);
		const pistonTx = pistonNy;
		const pistonTy = -pistonNx;
		const pistonCentreX = config.pistonCentre - pistonNx * world.pistonOffset;
		const pistonCentreY = config.deck - pistonNy * world.pistonOffset;
		context.strokeStyle = '#718d75';
		context.lineWidth = 0.06;
		context.beginPath();
		context.moveTo(pistonCentreX - pistonNx * 0.15, pistonCentreY - pistonNy * 0.15);
		context.lineTo(config.pistonCentre, 0.22);
		context.stroke();
		context.lineWidth = 1 / scale;
		context.fillStyle = world.drive ? '#b9ed91' : '#718d75';
		context.beginPath();
		context.moveTo(pistonCentreX - pistonTx * config.pistonHalf, pistonCentreY - pistonTy * config.pistonHalf);
		context.lineTo(pistonCentreX + pistonTx * config.pistonHalf, pistonCentreY + pistonTy * config.pistonHalf);
		context.lineTo(pistonCentreX + pistonTx * config.pistonHalf - pistonNx * 0.15, pistonCentreY + pistonTy * config.pistonHalf - pistonNy * 0.15);
		context.lineTo(pistonCentreX - pistonTx * config.pistonHalf - pistonNx * 0.15, pistonCentreY - pistonTy * config.pistonHalf - pistonNy * 0.15);
		context.closePath();
		context.fill();
		context.lineWidth = 1 / scale;
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
		// Fallen rubble first, so the charge pad plate stays visible on top of it.
		if (window.SteamCeiling) window.SteamCeiling.drawFloor(context);
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
		// A recessed, low roof and back wall make the right-side bay read as a
		// garage. The parked bot is drawn inside it, while the same vehicle remains
		// visible throughout dispatch, work, dismissal and the return home.
		const garageHeight = window.SteamCeiling.state.garageHeight;
		const garageDepth = window.SteamCeiling.state.garageDepth;
		context.fillStyle = '#29383d';
		context.fillRect(config.width, garageHeight, 0.3, config.ceiling - garageHeight);
		context.fillStyle = '#0a0f11';
		context.fillRect(config.width, 0, garageDepth, garageHeight);
		context.fillStyle = '#29383d';
		context.fillRect(config.width, -0.08, garageDepth, 0.08);
		context.fillRect(config.width, garageHeight, garageDepth, 0.08);
		context.fillRect(config.width + garageDepth - 0.12, 0, 0.12, garageHeight + 0.08);
		window.SteamCeiling.drawGraderBot(context);
		context.fillStyle = '#29383d';
		context.fillRect(-pocketDepth, 0, pocketDepth, pocketTop);
		if (window.SteamCeiling) window.SteamCeiling.draw(context, viewMode);
		if (window.SteamCeiling) {
			const ceiling = window.SteamCeiling.state;
			const cellY0 = ceiling.rockDrawnY(ceiling.bottom + selectedLayer * ceiling.cell);
			const cellY1 = ceiling.rockDrawnY(ceiling.bottom + (selectedLayer + 1) * ceiling.cell);
			context.strokeStyle = '#edf6f1';
			context.lineWidth = 1.5 / scale;
			context.strokeRect(selectedColumn * ceiling.cell, cellY0, ceiling.cell, cellY1 - cellY0);
			context.lineWidth = 1 / scale;
		}
		context.strokeStyle = '#657578';
		context.beginPath(); context.moveTo(-pocketDepth, 0); context.lineTo(config.width, 0); context.stroke();
		const activeTarget = playerApi.activeTarget();
		if (Number.isFinite(activeTarget)) {
			const targetGround = window.SteamCeiling.floorAt(activeTarget);
			context.strokeStyle = '#627765';
			context.beginPath(); context.moveTo(activeTarget, targetGround); context.lineTo(activeTarget, targetGround + 1.7); context.stroke();
		}
		if (showPrediction) drawPrediction();
		// One body pass draws every platform, the riding one last. The rig's
		// machinery rides inside its body so a competitor on top covers it.
		playerApi.draw(context, drawRigMachinery);
		// Every ball is drawn where it flies. The rock layer is drawn through a
		// vertical perspective, so a ball inside the layer is warped with it;
		// otherwise it stays on the linear world axis. A ball owned by a
		// competitor carries that player's colour, so ownership needs no label.
		const rock = window.SteamCeiling.state;
		const balls = world.balls || [];
		for (let i = 0; i < balls.length; i++) {
			const ball = balls[i];
			const owner = ball.owner ? playerById(ball.owner) : null;
			const inRock = ball.y >= rock.bottom && ball.y <= rock.top;
			const ballY = inRock ? rock.rockDrawnY(ball.y) : ball.y;
			const ballScale = inRock ? rock.rockScale(ball.y) : 1;
			context.fillStyle = owner ? owner.colour : (ball.state === 'grounded' ? '#e6b66e' : '#edf6f1');
			context.beginPath(); context.ellipse(ball.x, ballY, config.radius, config.radius * ballScale, 0, 0, Math.PI * 2); context.fill();
			context.strokeStyle = owner ? '#6f5a44' : '#a9c7bc';
			context.beginPath(); context.ellipse(ball.x, ballY, config.radius + 0.13, (config.radius + 0.13) * ballScale, 0, 0, Math.PI * 2); context.stroke();
		}
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
		context.moveTo(path.pathX[0], rockWarpY(path.pathY[0]));
		for (let i = 1; i < path.samples; i++) context.lineTo(path.pathX[i], rockWarpY(path.pathY[i]));
		context.stroke();
		context.setLineDash([]);
		context.beginPath(); context.arc(path.endX, rockWarpY(path.endY), 0.26, 0, Math.PI * 2); context.stroke();
		context.strokeStyle = path.reachable ? '#b9ed91' : '#e6b66e';
		const ghostAngle = path.ghostAngle;
		const ghostY = path.ghostY;
		context.save();
		context.translate(path.ghostX, ghostY);
		context.rotate(ghostAngle);
		context.strokeRect(-config.platformWidth * 0.5, config.deck - 0.06, config.platformWidth, 0.12);
		context.restore();
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
		if (entry.source === 'test') return stamp + (entry.type === 'research' ? 'Test researched ' : 'Test installed ') + entry.label;
		if (entry.type === 'grader') return stamp + 'Grader settlement · +' + entry.credits.toFixed(2) + ' cr (50% share)';
		if (entry.type === 'fuel') return stamp + 'Recharged ' + (entry.energy / 1000).toFixed(2) + ' kJ · ' + spent(entry.credits, 1);
		if (entry.type === 'research') return stamp + 'Researched ' + entry.label + ' · ' + spent(entry.credits, 0);
		if (entry.type === 'buy') return stamp + 'Bought ' + entry.label + ' · ' + spent(entry.credits, 0);
		return stamp + 'Sold ' + entry.mass.toFixed(1) + ' kg (' + entry.cells + ' cells) · +' + entry.credits.toFixed(1) + ' cr';
	}

	function ledgerStatus(entry) {
		if (entry.source === 'test') return (entry.type === 'research' ? 'Test mode researched ' : 'Test mode installed ') + entry.label + ' at ' + entry.time.toFixed(1) + ' s.';
		if (entry.type === 'grader') return 'Grader completed one pass · received ' + entry.credits.toFixed(2) + ' cr (50% share).';
		if (entry.type === 'fuel') return 'Recharged ' + (entry.energy / 1000).toFixed(2) + ' kJ of reserve ' + (entry.credits > 0 ? 'for ' + entry.credits.toFixed(1) + ' cr' : 'for free') + ' at ' + entry.time.toFixed(1) + ' s.';
		if (entry.type === 'research') return 'Researched ' + entry.label + ' ' + (entry.credits > 0 ? 'for ' + entry.credits.toFixed(0) + ' cr' : 'for free') + ' at ' + entry.time.toFixed(1) + ' s.';
		if (entry.type === 'buy') return 'Bought ' + entry.label + ' ' + (entry.credits > 0 ? 'for ' + entry.credits.toFixed(0) + ' cr' : 'for free') + ' at ' + entry.time.toFixed(1) + ' s.';
		return 'Sold ' + entry.mass.toFixed(1) + ' kg for ' + entry.credits.toFixed(1) + ' cr at ' + entry.time.toFixed(1) + ' s.';
	}

	// A free entry has no credits to show, so the ledger says so.
	function spent(credits, digits) {
		return credits > 0 ? '−' + credits.toFixed(digits) + ' cr' : 'free';
	}

	function mineralReadout() {
		const ceiling = window.SteamCeiling.state;
		const index = selectedLayer * ceiling.columns + selectedColumn;
		const offset = index * 3;
		const remaining = ceiling.strength[index];
		const initial = ceiling.initialStrength[index];
		setText(ui['mineral-cell'], 'Column ' + (selectedColumn + 1) + ' / ' + ceiling.columns + ' · Layer ' + (selectedLayer + 1) + ' / ' + ceiling.rows);
		setText(ui['mineral-strength'], remaining.toFixed(2) + ' / ' + initial.toFixed(2) + ' J' + (remaining === 0 ? ' · depleted' : ' · remaining strength'));
		const strengthRatio = initial > 0 ? remaining / initial : 0;
		if (Number(ui['strength-meter'].value) !== strengthRatio) ui['strength-meter'].value = strengthRatio;
		setText(ui['mineral-composition'], 'Fe ' + (ceiling.minerals[offset] * 100).toFixed(1) + '% · Cu ' + (ceiling.minerals[offset + 1] * 100).toFixed(1) + '% · Cr ' + (ceiling.minerals[offset + 2] * 100).toFixed(1) + '%');
		setText(ui['mineral-price'], 'Value ' + ceiling.prices[index].toFixed(2) + ' cr/cell · R ' + (ceiling.elements[offset] * 100).toFixed(0) + '% G ' + (ceiling.elements[offset + 1] * 100).toFixed(0) + '% B ' + (ceiling.elements[offset + 2] * 100).toFixed(0) + '%');
	}

	function miningReadout() {
		const ceiling = window.SteamCeiling.state;
		mineralReadout();
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

	// The platform a ball belongs to, for its colour. A plain loop keeps the
	// draw pass free of a per-ball closure.
	function playerById(id) {
		const list = playerApi.state.players;
		for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
		return null;
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
		let rigBallCount = 0;
		for (let i = 0; i < balls.length; i++) if (physics.isRigBall(balls[i])) rigBallCount++;
		ui['ball-energy'].textContent = physics.ballEnergy(world.ball).toFixed(1) + ' J' + (rigBallCount > 1 ? ' · ' + rigBallCount + ' balls' : '');
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
		const pressed = String(world.drive);
		if (ui.drive.getAttribute('aria-pressed') !== pressed) ui.drive.setAttribute('aria-pressed', pressed);
		setText(ui.drive.firstChild, world.drive ? 'Drive on ' : 'Drive off ');
		const canLaunch = physics.canLaunch(world);
		setDisabled(ui.launch, !playerApi.rigActive() || !canLaunch);
		statusReadout(reserveWarning, onPad, cargoFull, thermalFactor, temperature, canLaunch);
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
	function statusReadout(reserveWarning, onPad, cargoFull, thermalFactor, temperature, canLaunch) {
		const ceiling = window.SteamCeiling.state;
		setText(ui['fact-reserve'], (world.battery / 1000).toFixed(2) + ' kJ');
		setTone(ui['fact-reserve'], reserveWarning === 'EMPTY' ? 'danger' : reserveWarning ? 'warn' : '');
		setText(ui['fact-cargo'], ceiling.cargoCells + '/' + ceiling.storageLimit);
		setTone(ui['fact-cargo'], cargoFull ? 'warn' : '');
		setText(ui['fact-temp'], temperature.toFixed(0) + ' °C');
		setTone(ui['fact-temp'], thermalFactor === 0 ? 'danger' : thermalFactor < 1 ? 'warn' : '');
		if (world.ball.state === 'held') {
			if (!world.drive) setMessage(ui['status-ball'], 'Ball held · enable drive to release', 'warn');
			else if (!canLaunch) setMessage(ui['status-ball'], thermalFactor === 0 ? 'Overheated · wait for cooling' : 'Insufficient energy to lift ball', 'warn');
			else setMessage(ui['status-ball'], 'Ball held · press E to release' + (thermalFactor < 1 ? ' · drive derated' : ''), 'info');
		} else if (world.ball.state === 'grounded') setMessage(ui['status-ball'], 'Ball grounded · move over it to collect', 'warn');
		else setMessage(ui['status-ball'], 'Ball in flight · ' + world.pushes + ' powered pushes' + (thermalFactor < 1 ? ' · drive derated' : ''), 'info');
		// The two ways out of a short reserve, said only while both apply: the
		// reserve is low and the platform is on the ground to act on it. Standing
		// on the pad already grants the first one, so it stops there.
		setMessage(ui['status-energy'], reserveWarning && !onPad && platformGrounded()
			? 'Park on the centre pad to refill · click low ground to travel' : '', 'danger');
	}

	// Event-driven readouts also mark the scene, so a paused chamber reflects the change.
	function refresh() { syncPistonControl(); readout(); sceneDirty = true; }

	// Single writer for the piston angle: slider, chamber wheel and air drag
	// all set the world angle through here, and the controls only move when
	// the angle actually changed.
	function pistonDegrees() { return world.pistonAngle * 180 / Math.PI; }
	function syncPistonControl() {
		const degrees = pistonDegrees();
		setText(ui['piston-value'], degrees.toFixed(1) + '°');
		const snapped = Math.round(degrees * 2) / 2;
		if (Number(ui['piston-angle'].value) !== snapped) ui['piston-angle'].value = snapped;
	}
	// Manual tilt is the one writer the tilt keeper yields to, so taking the slider,
	// the wheel or a drag temporarily pauses that duty, not its enabled switch.
	function setPistonAngle(degrees) {
		if (!Number.isFinite(degrees) || !playerApi.rigActive()) return;
		autopilot.override('angle');
		const before = world.pistonAngle;
		physics.setPistonAngle(world, Math.max(-10, Math.min(10, degrees)) * Math.PI / 180);
		if (world.pistonAngle !== before) sceneDirty = true;
		syncPistonControl();
	}

	// Autopilot switches. Checkboxes and shortcuts share one table and one writer,
	// and each duty yields to the manual command that does the same thing.
	const autopilotRows = [
		{ id: 'auto-move', channel: 'move' },
		{ id: 'auto-smart', channel: 'smart' },
		{ id: 'auto-drive', channel: 'drive' },
		{ id: 'auto-angle', channel: 'angle' }
	];

	function syncAutopilot() {
		for (const row of autopilotRows) setChecked(ui[row.id], autopilot.enabled(row.channel));
	}

	function setChannel(channel, on) {
		if (!playerApi.rigActive()) return;
		autopilot.set(channel, on);
		syncAutopilot();
		refresh();
	}

	function toggleChannel(channel) { setChannel(channel, !autopilot.enabled(channel)); }

	function channelForKey(code, shift) {
		if (code === 'KeyX') return shift ? 'smart' : 'move';
		if (code === 'KeyZ') return 'drive';
		if (code === 'KeyC') return 'angle';
		return '';
	}

	function autopilotChanged(event) {
		const input = event.target;
		for (const row of autopilotRows) {
			if (ui[row.id] !== input) continue;
			setChannel(row.channel, input.checked);
			return;
		}
	}

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
		// The layer is drawn through a vertical perspective, so the pointer's
		// screen height maps back to the cell's world height before the lookup.
		const cellY = ceiling.rockWorldY(worldY);
		const column = Math.min(ceiling.columns - 1, Math.floor(worldX / ceiling.cell));
		const row = Math.min(ceiling.rows - 1, Math.floor((cellY - ceiling.bottom) / ceiling.cell));
		const index = row * ceiling.columns + column;
		if (ceiling.shape === 'square') return ceiling.strength[index] > 0 ? index : -1;
		// The smooth surface is drawn as a linear profile between column vertices.
		const fraction = (worldX - column * ceiling.cell) / ceiling.cell;
		const surface = ceiling.heightmap[column] + (ceiling.heightmap[column + 1] - ceiling.heightmap[column]) * fraction;
		return cellY >= surface ? index : -1;
	}

	function inspectRockAtPointer(event) {
		const bounds = canvas.getBoundingClientRect();
		const worldX = (event.clientX - bounds.left - offsetX) / scale;
		const worldY = (floorY - (event.clientY - bounds.top)) / scale;
		const index = rockCellIndex(worldX, worldY);
		setHidden(ui['mineral-tooltip'], index < 0);
		if (index < 0) return;
		const columns = window.SteamCeiling.state.columns;
		const previousIndex = selectedLayer * columns + selectedColumn;
		selectedColumn = index % columns;
		selectedLayer = Math.floor(index / columns);
		if (index !== previousIndex) sceneDirty = true;
		const tip = ui['mineral-tooltip'];
		const x = event.clientX - bounds.left + 14;
		const y = event.clientY - bounds.top + 14;
		const tipWidth = tip.offsetWidth || 260;
		const tipHeight = tip.offsetHeight || 150;
		tip.style.left = Math.max(8, Math.min(bounds.width - tipWidth - 8, x)) + 'px';
		tip.style.top = Math.max(8, Math.min(bounds.height - tipHeight - 8, y)) + 'px';
		mineralReadout();
	}

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

	// A competitor command is only written when the direction really changed, so
	// releasing a key that was pressed on the other platform never puts a two
	// second manual window on the platform that has the controls now.
	let commandedDirection = 0;
	function updateDirection() {
		const direction = Number(rightHeld) - Number(leftHeld);
		if (!playerApi.rigActive()) {
			if (direction || commandedDirection) playerApi.command(direction);
			commandedDirection = direction;
			sceneDirty = true;
			return;
		}
		commandedDirection = 0;
		world.direction = direction;
		autopilot.hold('move', world.brake || leftHeld || rightHeld);
		if (leftHeld || rightHeld) world.target = NaN;
		sceneDirty = true;
	}

	function clearInput() { world.brake = false; leftHeld = false; rightHeld = false; playerApi.clearCommand(); updateDirection(); }
	function toggleDrive() { if (!playerApi.rigActive()) return; world.drive = !world.drive; autopilot.override('drive'); refresh(); }
	function releaseBall() { if (!playerApi.rigActive()) return; physics.launch(world); refresh(); }
	function togglePause() { paused = !paused; ui.pause.textContent = paused ? 'Resume' : 'Pause'; accumulator = 0; }
	// One force setting per player: the slider and W/S edit the platform being
	// driven, and switching players reads that player's setting back into the
	// control instead of leaving the rig's value on screen.
	function setForce(value) {
		const forceValue = playerApi.setForce(value);
		if (playerApi.rigActive()) world.forceSetting = forceValue;
		syncForceControl(forceValue);
		// The panel's summary line names that player's force, so it moves with
		// the slider instead of waiting for the next readout.
		refreshPlayers();
	}

	function syncForceControl(value) {
		const forceValue = value === undefined ? playerApi.force(playerApi.state.active) : value;
		const percent = Math.round(forceValue * 100);
		if (Number(ui.force.value) !== percent) ui.force.value = percent;
		setText(ui['force-value'], percent + '%');
	}

	function isGameKey(code) {
		return code === 'Space' || code === 'KeyQ' || code === 'KeyA' || code === 'KeyD' || code === 'KeyW' || code === 'KeyS' || code === 'KeyE'
			|| code === 'KeyB' || code === 'KeyX' || code === 'KeyZ' || code === 'KeyC' || code === 'KeyM';
	}

	function keydown(event) {
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		if (event.target.closest('textarea, [contenteditable]')) return;
		if (helpKey(event)) return;
		const key = event.code;
		if (!isGameKey(key)) return;
		event.preventDefault();
		if (document.activeElement && document.activeElement !== canvas && document.activeElement !== document.body) {
			document.activeElement.blur();
		}
		if (key === 'KeyB') {
			if (playerApi.rigActive()) { world.brake = true; world.target = NaN; autopilot.hold('move', true); }
			else playerApi.commandBrake(true);
		}
		if (key === 'KeyA') leftHeld = true;
		if (key === 'KeyD') rightHeld = true;
		if (key === 'KeyA' || key === 'KeyD') updateDirection();
		if (key === 'KeyW') setForce(playerApi.force(playerApi.state.active) + 0.1);
		if (key === 'KeyS') setForce(playerApi.force(playerApi.state.active) - 0.1);
		if (event.repeat) return;
		if (key === 'Space' || key === 'KeyQ') toggleDrive();
		if (key === 'KeyE') releaseBall();
		if (key === 'KeyM') setCommune(!window.SteamCeiling.state.commune);
		const channel = channelForKey(key, event.shiftKey);
		if (channel) toggleChannel(channel);
	}

	function keyup(event) {
		const key = event.code;
		if (key === 'Space' || key === 'KeyQ') event.preventDefault();
		if (key === 'KeyB') {
			if (playerApi.rigActive()) { world.brake = false; updateDirection(); }
			else playerApi.commandBrake(false);
		}
		if (key === 'KeyA') leftHeld = false;
		if (key === 'KeyD') rightHeld = false;
		if (key === 'KeyA' || key === 'KeyD') updateDirection();
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
		while (accumulator >= config.step) { autopilot.update(world, config.step); playerApi.update(world, config.step); physics.step(world, config.step); accumulator -= config.step; sceneDirty = true; }
		if (sceneDirty) { draw(); sceneDirty = false; }
		if (now - lastReadout > 100) { readout(); lastReadout = now; }
		requestAnimationFrame(frame);
	}

	document.getElementById('reset').addEventListener('click', function () {
		world = physics.createWorld(); playerApi.init(world); window.SteamCeiling.setShape(ui.shape.value); ui.balls.value = playerApi.state.ballMode; renderedSales = -1; clearInput(); endPistonDrag(); setForce(world.forceSetting); autopilot.reset(); accumulator = 0;
		syncActiveControls();
		for (const row of tierRows) row.selectedIndex = -1;
		if (testMode) grantTestState();
		setModeStatus();
		refresh();
	});
	ui.drive.addEventListener('click', toggleDrive);
	ui.commune.addEventListener('change', function () { setCommune(ui.commune.checked); });
	ui['test-mode'].addEventListener('change', function () { setTestMode(ui['test-mode'].checked); });
	ui.refuel.addEventListener('click', function () {
		const imported = window.SteamCeiling.recharge(world, world.time);
		refresh();
		if (!imported) {
			ui['transaction-status'].textContent = window.SteamCeiling.state.commune
				? 'The reserve is already full · the commons needs no import.'
				: 'Not enough funds to recharge · ' + window.SteamCeiling.rechargeCost(world).toFixed(1) + ' cr fills the reserve.';
		}
	});
	ui.launch.addEventListener('click', releaseBall);
	ui.pause.addEventListener('click', togglePause);
	ui.shape.addEventListener('change', function () { window.SteamCeiling.setShape(ui.shape.value); sceneDirty = true; });
	// The ball arrangement re-seats the balls, so the autopilot plan is dropped
	// with the old set instead of being carried across a new one.
	ui.balls.addEventListener('change', function () {
		playerApi.setBallMode(ui.balls.value);
		autopilot.reset();
		clearInput();
		refresh();
	});
	ui['view-modes'].addEventListener('change', viewModeChanged);
	ui.autopilot.addEventListener('change', autopilotChanged);
	ui['view-modes'].addEventListener('pointerover', viewModeHovered);
	ui.force.addEventListener('input', function () { setForce(Number(ui.force.value) / 100); });
	ui['piston-angle'].addEventListener('input', function () { setPistonAngle(Number(ui['piston-angle'].value)); });
	// Wheel over the chamber tilts the piston instead of scrolling the page:
	// up (negative delta) raises the angle, a standard notch steps about 4°.
	canvas.addEventListener('wheel', function (event) {
		event.preventDefault();
		if (!playerApi.rigActive()) return;
		setPistonAngle(pistonDegrees() - Math.max(-100, Math.min(100, event.deltaY)) * 0.04);
	}, { passive: false });
	canvas.addEventListener('pointerdown', function (event) {
		const bounds = canvas.getBoundingClientRect();
		const worldX = (event.clientX - bounds.left - offsetX) / scale;
		const worldY = (floorY - (event.clientY - bounds.top)) / scale;
		const cell = rockCellIndex(worldX, worldY);
		if (cell >= 0) {
			inspectRockAtPointer(event);
			canvas.focus();
			return;
		}
		if (worldY <= moveClickHeight && worldX >= 0 && worldX <= config.width) {
			if (playerApi.rigActive()) {
				world.direction = 0;
				world.target = Math.max(physics.platformMin(), Math.min(physics.platformMax(), worldX));
				autopilot.override('move');
			} else playerApi.commandTarget(worldX);
			sceneDirty = true;
		} else if (worldX >= 0 && worldX <= config.width && worldY <= config.ceiling && playerApi.rigActive()) {
			// Open air starts a piston drag; dragging left or up raises the angle.
			pistonDragActive = true;
			autopilot.hold('angle', true);
			pistonDragX = event.clientX;
			pistonDragY = event.clientY;
			pistonDragAngle = pistonDegrees();
			if (typeof canvas.setPointerCapture === 'function' && event.pointerId !== undefined) canvas.setPointerCapture(event.pointerId);
		}
		canvas.focus();
	});
	canvas.addEventListener('pointermove', function (event) {
		if (pistonDragActive) {
			// The drag aims the reflection: a positive angle sends a falling ball left,
			// so dragging left (or up) raises it and the bounce follows the pointer.
			setPistonAngle(pistonDragAngle - ((event.clientX - pistonDragX) + (event.clientY - pistonDragY)) * 0.05);
			return;
		}
		inspectRockAtPointer(event);
	});
	canvas.addEventListener('pointerleave', function () { setHidden(ui['mineral-tooltip'], true); });
	function endPistonDrag() { pistonDragActive = false; autopilot.hold('angle', false); }
	canvas.addEventListener('pointerup', endPistonDrag);
	canvas.addEventListener('pointercancel', endPistonDrag);
	canvas.addEventListener('lostpointercapture', endPistonDrag);
	ui['piston-angle'].addEventListener('pointerdown', function (event) {
		ui['piston-angle'].setPointerCapture(event.pointerId);
		autopilot.hold('angle', true);
	});
	ui['piston-angle'].addEventListener('pointerup', endPistonDrag);
	ui['piston-angle'].addEventListener('pointercancel', endPistonDrag);
	ui['piston-angle'].addEventListener('lostpointercapture', endPistonDrag);

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

	function bindHelp() {
		for (const topic of helpTopics) {
			const trigger = ui['help-' + topic.id];
			if (!trigger) continue;
			// A hovering pointer has already previewed the topic, so its click pins the
			// preview instead of closing what the pointer just opened; touch toggles.
			trigger.addEventListener('click', function () {
				if (hoverPointer.matches && helpOpen && helpTopic === topic.id) { helpPreview = false; return; }
				toggleHelp(topic.id);
			});
			const openPreview = function () { if (hoverPointer.matches) { openHelp(topic.id, false); helpPreview = true; } };
			trigger.addEventListener('pointerenter', openPreview);
			trigger.addEventListener('pointerover', openPreview);
			const closePreview = function (event) {
				if (!hoverPointer.matches || !helpPreview || !helpOpen || helpTopic !== topic.id) return;
				const next = event && event.relatedTarget;
				if (next && (((next.id && String(next.id).indexOf('help-') === 0) || (typeof next.closest === 'function' && next.closest('.help-mark'))) || (typeof next.closest === 'function' && next.closest('.help-drawer')))) return;
				helpPreview = false;
				closeHelp(false);
			};
			trigger.addEventListener('pointerout', closePreview);
			trigger.addEventListener('pointerleave', closePreview);
			trigger.addEventListener('focus', function () { if (helpOpen) openHelp(topic.id, false); });
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
	ui['science-open'].addEventListener('click', function () { toggleToolDrawer('science-drawer', ui['science-open']); });
	ui['market-open'].addEventListener('click', function () { toggleToolDrawer('market-drawer', ui['market-open']); });
	ui['science-close'].addEventListener('click', closeToolDrawers);
	ui['market-close'].addEventListener('click', closeToolDrawers);
	bindHelp();
	bindHelpGestures();

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
	resize(); refresh(); requestAnimationFrame(frame);
})();
