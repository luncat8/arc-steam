// Shared page bindings and DOM primitives. Keep feature state in its owner file.
// provides: physics, autopilotApi, playerApi, config, canvas, context, ui, world, testMode, showPrediction, setText/setDisabled/setHidden/setChecked/setMessage/setTone
// depends: domain globals loaded before this script

'use strict';

const physics = SteamPhysics;
const autopilotApi = SteamAutopilot;
const playerApi = SteamPlayers;
const config = physics.config;
const canvas = document.getElementById('c');
const context = canvas.getContext('2d');
const ids = ['clock', 'drive', 'launch', 'status-bar', 'status-ball', 'status-energy', 'fact-reserve', 'fact-cargo', 'fact-temp', 'prediction-status', 'force', 'force-value', 'piston-angle', 'piston-value',
	'autopilot', 'auto-move', 'auto-smart', 'auto-drive', 'auto-angle', 'autopilot-status', 'battery', 'cargo', 'platform-mass', 'funds', 'funds-note', 'ball-energy', 'heat', 'temperature', 'thermal-status', 'cooled', 'error', 'motion', 'pause', 'speed', 'shape', 'balls', 'ground-bounce', 'ball-perspective', 'debris-compression', 'commune', 'test-mode', 'view-modes',
	'platform-spec', 'spec-card', 'progression-tree', 'tree-links', 'progression-status', 'research-progress', 'science-funds', 'science-title',
	'mineral-cell', 'mineral-strength', 'strength-meter', 'mineral-composition', 'mineral-price', 'rock-damage-view',
	'cluster-settings', 'generate-test-rock', 'fall-test-status',
	'extracted', 'falling', 'caught', 'lost', 'credits', 'cargo-mass', 'cargo-value', 'sold-mass', 'sold-value', 'sale-count',
	'inventory-rows', 'market-rows', 'transaction-status', 'transaction-count', 'ledger',
	'refuel', 'refuel-cost', 'fuel-price', 'reserve-note', 'cargo-note',
	'reserve-telemetry', 'cargo-telemetry', 'thermal-telemetry', 'mineral-tooltip', 'science-drawer', 'market-drawer', 'science-open', 'science-close', 'market-open', 'market-close',
	'telemetry', 'player-list', 'control-title', 'rig-drive',
	'rocket-fire', 'rocket-buy', 'rocket-auto', 'rocket-status'];
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
let world = physics.createWorld();
playerApi.init(world);
let testMode = false;
let showPrediction = false;
