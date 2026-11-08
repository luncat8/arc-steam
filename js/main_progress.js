// Research tree, equipment bays, progression actions and their refresh state.
// provides: buildUpgrades, refreshUpgrades, buyEquipment, buyResearch, setCommune, setTestMode, layoutTreeLinks, specReadout
// depends: main.js bindings, player helpers, refresh

'use strict';

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

function buildUpgrades() {
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

	// One node can unlock several items (Power electronics gates both the
	// overdrive and the piston ram), so each node keeps its whole list.
	const itemsByResearch = {};
	for (const item of SteamEquipment.items) {
		if (item.requires) (itemsByResearch[item.requires] = itemsByResearch[item.requires] || []).push(item);
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
		installed: function () { return physics.engineNow(activePlayerId()).id; },
		unlocked: function () { return true; },
		owned: function (id) { return SteamEquipment.ownsEngine(id, activePlayerId()); },
		ready: function () { return SteamEquipment.atShop(world, activePlayerId()); },
		cost: function (entry) { return SteamEquipment.engineCosts[entry.id]; },
		entryName: function (entry) { return entry.name + ' engine'; },
		optionText: function (entry, costText) { return entry.name.toUpperCase() + ' ENGINE · ' + costText; },
		detailText: function (entry) {
			return entry.mass + ' kg · ' + (entry.density / 1000) + ' kJ/kg · ' + entry.reload + ' s refill · ' + Math.round(entry.efficiency * 100) + '% eff · ×' + entry.force + ' force · ×' + entry.speed + ' speed · left shop';
		},
		install: function (id) { return SteamEquipment.buyEngine(id, world, activePlayerId()); },
		refuse: function (entry) {
			if (physics.engineNow(activePlayerId()).id === entry.id) return entry.name + ' engine is already installed.';
			if (!SteamEquipment.atShop(world, activePlayerId())) return 'Park at the left shop to buy or swap engines.';
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
		installed: function () { return SteamEquipment.installedRadiator(activePlayerId()); },
		unlocked: function (id) { return SteamEquipment.radiatorUnlocked(id, activePlayerId()); },
		owned: function (id) { return SteamEquipment.ownsRadiator(id, activePlayerId()); },
		ready: function () { return true; },
		cost: function (entry) { return entry.cost; },
		entryName: function (entry) { return entry.name; },
		optionText: function (entry, costText) { return entry.name.toUpperCase() + ' · ' + costText + massSuffix(entry.mass); },
		detailText: function (entry) { return '+' + entry.radiatorArea.toFixed(2) + ' m² exposed fins · owned tiers swap free.'; },
		install: function (id) { return SteamEquipment.installRadiator(id, world, false, activePlayerId()); },
		refuse: function (entry) {
			if (!SteamEquipment.radiatorUnlocked(entry.id, activePlayerId())) return 'The radiator tiers need the Heat transfer research first.';
			if (SteamEquipment.installedRadiator(activePlayerId()) === entry.id) return entry.name + ' is already installed.';
			return 'Not enough funds for ' + entry.name + ' (' + entry.cost + ' cr needed).';
		}
	};
	const ballSpec = {
		family: 'balls', title: 'STRIKE BALL', label: 'Ball upgrades',
		entries: SteamEquipment.balls, previewIndex: 1, defaultId: 'standard',
		installed: function () { return SteamEquipment.installedBall(activePlayerId()); },
		unlocked: function (id) { return SteamEquipment.ballUnlocked(id, activePlayerId()); },
		owned: function (id) { return SteamEquipment.ownsBall(id, activePlayerId()); },
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
		install: function (id) { return SteamEquipment.installBall(id, world, false, activePlayerId()); },
		refuse: function (entry) {
			if (SteamEquipment.installedBall(activePlayerId()) === entry.id) return entry.name + ' is already installed.';
			if (!SteamEquipment.ballUnlocked(entry.id, activePlayerId())) return 'The ball upgrades need the Impact forging research first.';
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

		const unlockedItems = itemsByResearch[node.id];
		if (unlockedItems) {
			for (const unlockedItem of unlockedItems) {
				const buy = buildSlot(card, 'upgrade-row node-buy', unlockedItem.name, unlockedItem.cost, unlockedItem.mass || 0, 'Locked', unlockedItem.effect,
					function () { buyEquipment(unlockedItem.id); });
				buy.row.dataset.item = unlockedItem.id;
				buy.item = unlockedItem;
				equipmentRows.push(buy);
			}
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
}

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
	const owner = activePlayerId();
	const item = SteamEquipment.find(id);
	if (SteamEquipment.install(id, world, owner)) setText(ui['progression-status'], 'Installed ' + item.name + ' at ' + world.time.toFixed(1) + ' s.');
	else if (SteamEquipment.isInstalled(id, owner)) setText(ui['progression-status'], item.name + ' is already installed.');
	// The grader's row is only ever locked for a competitor, and it has no
	// prerequisite to name, so the refusal says why instead of dereferencing one.
	else if (SteamEquipment.rigOnly(id, owner)) setText(ui['progression-status'], item.name + ' grades under the rig\'s centre; a competitor\'s chassis shaves rubble on its own.');
	else if (!SteamEquipment.isUnlocked(id, owner)) setText(ui['progression-status'], item.name + ' needs the ' + SteamResearch.find(item.requires).name + ' research first.');
	else setText(ui['progression-status'], 'Not enough funds for ' + item.name + ' (' + item.cost + ' cr needed).');
	refresh();
}

function buyResearch(id) {
	const owner = activePlayerId();
	const node = SteamResearch.find(id);
	if (SteamResearch.research(id, world, owner)) setText(ui['progression-status'], 'Researched ' + node.name + ' at ' + world.time.toFixed(1) + ' s.');
	else if (SteamResearch.isResearched(id, owner)) setText(ui['progression-status'], node.name + ' is already researched.');
	else if (SteamResearch.status(id, owner) === SteamResearch.constants.LOCKED) setText(ui['progression-status'], node.name + ' stays locked until ' + prerequisiteNames(node) + ' is researched.');
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
	const roster = playerApi.state.players;
	for (let i = 0; i < roster.length; i++) {
		const owner = roster[i].id;
		SteamResearch.researchAll(world, owner);
		SteamEquipment.installAll(world, owner);
		SteamEquipment.installRadiator('radiator', world, true, owner);
		SteamEquipment.installBall('spike', world, true, owner);
	}
	const researched = SteamResearch.stateFor(activePlayerId()).completed;
	let installed = 0;
	for (const item of SteamEquipment.items) if (SteamEquipment.isInstalled(item.id, activePlayerId())) installed++;
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

function refreshTierSlot(record, funds, commune) {
	const spec = record.spec;
	const owner = activePlayerId();
	if (record.lastOwner !== owner) {
		record.selectedIndex = -1;
		record.lastInstalled = undefined;
		record.lastOwner = owner;
	}
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

function refreshTreeLinks(commune, owner) {
	for (const edge of linkRecords) {
		const done = edge.from === 'root' || commune || SteamResearch.isResearched(edge.from, owner);
		const state = done ? 'done' : SteamResearch.status(edge.from, owner) === SteamResearch.constants.AVAILABLE ? 'ready' : 'locked';
		if (edge.path.dataset.state !== state) edge.path.dataset.state = state;
	}
}

// Locked, available and researched states drive buttons, node cards and
// prerequisite edges together through change-only DOM writers.
function refreshUpgrades() {
	const ceiling = window.SteamCeiling.state;
	const owner = activePlayerId();
	const funds = playerApi.money(playerApi.state.active);
	refreshGrader();
	setText(ui['science-title'], 'SCIENCE + SHOP · ' + activePlayer().name);
	for (const row of equipmentRows) {
		const installed = SteamEquipment.isInstalled(row.item.id, owner);
		const unlocked = SteamEquipment.isUnlocked(row.item.id, owner);
		setBlocked(row.button, installed || !unlocked || (funds < row.item.cost && !ceiling.commune));
		setText(row.button, installed ? 'Installed' : unlocked ? 'Buy' : 'Locked');
		setRowState(row.row, installed ? 'installed' : unlocked ? 'available' : 'locked');
		setText(row.heading, rowTitle(row));
	}
	for (const record of tierRows) refreshTierSlot(record, funds, ceiling.commune);
	let completed = 0;
	for (const row of researchRows) {
		const status = SteamResearch.status(row.node.id, owner);
		if (status === SteamResearch.constants.RESEARCHED) completed++;
		setBlocked(row.button, status !== SteamResearch.constants.AVAILABLE || (funds < row.node.cost && !ceiling.commune));
		setText(row.button, status === SteamResearch.constants.RESEARCHED ? 'Done' : status === SteamResearch.constants.AVAILABLE ? 'Research' : 'Locked');
		setRowState(row.row, status);
		setRowState(row.card, status);
		setText(row.heading, rowTitle(row));
	}
	refreshTreeLinks(ceiling.commune, owner);
	setText(ui['research-progress'], completed + ' / ' + researchRows.length);
	setText(ui['science-funds'], ceiling.commune ? 'commons' : funds.toFixed(1) + ' cr');
}

// Installed specification: the live result of base tuning plus every equipment
// and research delta, which is what the row effects compare against.
function specReadout() {
	const owner = activePlayerId();
	setText(specValues[0], physics.dryMass(owner).toFixed(1) + ' kg');
	setText(specValues[1], physics.forceNow(owner).toFixed(0) + ' N');
	setText(specValues[2], physics.speedNow(owner).toFixed(0) + ' m/s');
	setText(specValues[3], physics.pulseNow(owner).toFixed(0) + ' J');
	setText(specValues[4], (physics.retentionNow(owner) * 100).toFixed(0) + '%');
	setText(specValues[5], (physics.rockRetentionNow(owner) * 100).toFixed(0) + '%');
	const dmg = window.SteamCeiling.damageMultiplierNow(owner).toFixed(1) + '×';
	setText(specValues[6], dmg);
	const rad = window.SteamCeiling.damageRadiusNow(owner).toFixed(1) + ' cells';
	setText(specValues[7], rad);
	setText(specValues[8], physics.conductanceNow(owner).toFixed(2) + ' W/K');
	setText(specValues[9], (physics.recoveryNow(owner) * 100).toFixed(0) + '%');
}
