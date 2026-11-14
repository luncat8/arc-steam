'use strict';
// The mineral lab's share table: desired share is editable by typing, by
// dragging the red line on the achieved bar and by arrow keys, and Error
// always reads achieved minus desired. Stone is the residual of the ore
// shares and cannot be edited or dragged. The lab runs against a minimal DOM
// stub; only the share-table wiring is exercised, not the canvas drawing.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

class StubClassList {
	constructor() { this.values = new Set(); }
	add(name) { this.values.add(name); }
	remove(name) { this.values.delete(name); }
	toggle(name, force) {
		const on = force === undefined ? !this.values.has(name) : force;
		if (on) this.values.add(name); else this.values.delete(name);
		return on;
	}
	contains(name) { return this.values.has(name); }
}

class StubElement {
	constructor(tagName) {
		this.tagName = tagName.toUpperCase();
		this.children = [];
		this.style = {};
		this.dataset = {};
		this.classList = new StubClassList();
		this.listeners = {};
		this.attributes = {};
		this.textContent = '';
		this.value = '';
		this.hidden = false;
		this.disabled = false;
		this.title = '';
		this.tabIndex = -1;
		this.clientWidth = 240;
		this.clientHeight = 44;
		this.width = 0;
		this.height = 0;
	}
	setAttribute(name, value) { this.attributes[name] = String(value); }
	getAttribute(name) { return this.attributes[name]; }
	addEventListener(type, listener) {
		(this.listeners[type] = this.listeners[type] || []).push(listener);
	}
	append(...nodes) {
		for (const node of nodes) {
			if (typeof node === 'string') {
				const text = new StubElement('#text');
				text.textContent = node;
				this.children.push(text);
			} else this.children.push(node);
		}
	}
	getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 10 }; }
	setPointerCapture() {}
	hasPointerCapture() { return true; }
	releasePointerCapture() {}
	focus() {}
	getContext() {
		return {
			createImageData: (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
			putImageData() {}, drawImage() {}, clearRect() {}, fillRect() {},
			beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {}, setTransform() {}
		};
	}
}

function fire(element, type, event) {
	const full = Object.assign({ preventDefault() {}, target: element, currentTarget: element }, event || {});
	for (const listener of element.listeners[type] || []) listener(full);
}

function findAll(element, tagName, out) {
	out = out || [];
	for (const child of element.children) {
		if (child.tagName === tagName) out.push(child);
		findAll(child, tagName, out);
	}
	return out;
}

function loadLab() {
	const ids = ['seed', 'reseed', 'frequency', 'frequency-value', 'compression', 'compression-value',
		'sample-seeds', 'sample-seeds-value', 'sample-depth', 'sample-depth-value',
		'map-depth', 'map-depth-value', 'map-note',
		'map', 'cell-tip', 'cell-mineral', 'cell-elements', 'cell-mix', 'view-modes', 'view-label',
		'element-r', 'element-g', 'element-b', 'share-rows', 'stats-note', 'stats-hint',
		'desired-sum', 'error-sum',
		'range-sliders', 'host-weight', 'host-weight-value', 'solve-host',
		'mode', 'specificity', 'specificity-value', 'target-host', 'target-host-value',
		'target-filler', 'target-filler-value',
		'target-common', 'target-common-value', 'target-uncommon', 'target-uncommon-value',
		'target-rare', 'target-rare-value', 'target-veryrare', 'target-veryrare-value',
		'auto-adjust', 'spread', 'reset-ranges', 'copy-table', 'copy-report', 'help-calibrate',
		'export-formation', 'import-formation', 'import-panel', 'import-text', 'import-apply', 'import-cancel',
		'calibrate-status', 'report'];
	const byId = new Map(ids.map(id => [id, new StubElement('div')]));
	let frameCallback = null;
	const document = {
		activeElement: null,
		getElementById: id => byId.get(id) || null,
		createElement: tagName => new StubElement(tagName),
		createTextNode: text => {
			const node = new StubElement('#text');
			node.textContent = text;
			return node;
		}
	};
	const clipboard = { text: '', writeText(text) { clipboard.text = text; return Promise.resolve(); } };
	const sandbox = {
		console,
		document,
		navigator: { clipboard },
		// A fine pointer, so the lab's hover-to-preview path stays available.
		matchMedia: () => ({ matches: true }),
		performance: { now: () => 0 },
		requestAnimationFrame: callback => { frameCallback = callback; return 1; },
		setTimeout,
		clearTimeout
	};
	sandbox.globalThis = sandbox;
	// The lab page's window is the page global: geology-config and the lab read
	// it for their guarded globals, exactly as a classic script does in a page.
	sandbox.window = sandbox;
	vm.createContext(sandbox);
	for (const file of ['js/minerals.js', 'js/element-cdf.js', 'js/geology-config.js', 'js/rock-materials.js', 'js/geology.js', 'prototypes/range-slider.js', 'prototypes/mineral-lab.js']) {
		vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
	}
	function runFrame() {
		const callback = frameCallback;
		frameCallback = null;
		assert.ok(callback, 'a frame was scheduled');
		callback();
	}
	return { byId, runFrame, clipboard };
}

function shareRow(lab, index) {
	const rows = lab.byId.get('share-rows').children;
	const row = rows[index];
	const cells = row.children;
	const spans = findAll(row, 'SPAN');
	return {
		row,
		desired: findAll(row, 'INPUT')[0],
		bar: findAll(row, 'DIV')[0],
		fill: findAll(row, 'I').find(node => node !== findAll(row, 'I')[0] || findAll(row, 'I').length === 1),
		mark: findAll(row, 'B')[0],
		shareText: spans[0],
		spanCount: spans.length,
		error: cells[3],
		achieved: parseFloat(spans[0].textContent)
	};
}

function desiredTotal(lab) {
	const rows = lab.byId.get('share-rows').children;
	let total = 0;
	for (const row of rows) total += parseFloat(findAll(row, 'INPUT')[0].value);
	return total;
}

test('desired share is editable and error reads achieved minus desired', () => {
	const lab = loadLab();
	lab.runFrame();
	const minerals = require('../js/minerals.js');
	const count = minerals.mineralCount;
	const rows = lab.byId.get('share-rows').children;
	assert.equal(rows.length, count, 'one row per mineral');

	for (let m = 0; m < count; m++) {
		const parts = shareRow(lab, m);
		assert.ok(parts.desired, 'row ' + m + ' has a desired input');
		assert.equal(parts.desired.type, 'number');
		assert.ok(parts.bar, 'row ' + m + ' has a bar');
		assert.ok(parts.mark, 'row ' + m + ' has a red line');
		assert.equal(parts.spanCount, 1, 'row ' + m + ' has no rect handle, only the achieved text');
		const desired = parseFloat(parts.desired.value);
		const expectedLeft = Math.min(100, desired / 0.35) + '%';
		assert.ok(Math.abs(parseFloat(parts.mark.style.left) - parseFloat(expectedLeft)) < 0.6,
			'row ' + m + ' line sits at the desired share');
		const error = parseFloat(parts.error.textContent.replace('−', '-'));
		// Desired shows one decimal and achieved two, so allow the rounding.
		assert.ok(Math.abs(error - (parts.achieved - desired)) < 0.06,
			'row ' + m + ' error is achieved minus desired, got ' + parts.error.textContent);
	}

	// Stone is the residual: disabled input, no drag, and the column totals 100%.
	const stone = shareRow(lab, minerals.hostIndex);
	assert.equal(stone.desired.disabled, true, 'stone desired is disabled');
	assert.equal(stone.bar.getAttribute('role'), undefined, 'stone bar is not a slider');
	assert.ok(Math.abs(desiredTotal(lab) - 100) < 0.6, 'desired column totals 100%');

	// Press and drag on the bar: the whole bar width maps to 0..35%.
	const first = shareRow(lab, 1);
	fire(first.bar, 'pointerdown', { pointerId: 7, clientX: 50 });
	assert.equal(first.desired.value, '17.5', 'drag to the middle sets 17.5%');
	assert.equal(first.mark.style.left, '50%');
	fire(first.bar, 'pointermove', { pointerId: 7, clientX: 25 });
	assert.equal(first.mark.style.left, '25%');
	assert.ok(Math.abs(parseFloat(first.desired.value) - 8.8) < 0.05, 'drag to a quarter sets 8.8%');
	lab.runFrame();
	const draggedError = parseFloat(first.error.textContent.replace('−', '-'));
	assert.ok(Math.abs(draggedError - (first.achieved - parseFloat(first.desired.value))) < 0.06,
		'error follows the drag');
	fire(first.bar, 'pointerup', { pointerId: 7 });

	// Dragging an ore moves stone the other way; the total stays 100%.
	assert.ok(Math.abs(desiredTotal(lab) - 100) < 0.6, 'drag keeps the desired total at 100%');

	// Typing in Desired sets the same target.
	first.desired.value = '10.0';
	fire(first.desired, 'input');
	assert.ok(Math.abs(parseFloat(first.mark.style.left) - 10 / 0.35) < 0.1, 'typing moves the red line');
	assert.ok(Math.abs(desiredTotal(lab) - 100) < 0.6, 'typing keeps the desired total at 100%');

	// Arrow keys nudge the desired share without a pointer.
	const before = parseFloat(first.desired.value);
	fire(first.bar, 'keydown', { key: 'ArrowRight' });
	assert.ok(Math.abs(parseFloat(first.desired.value) - (before + 0.1)) < 0.05, 'arrow key nudges desired');

	// Clicking a row selects it; the old scroll-to-anchor is gone, so the
	// stub (which has no scrollIntoView) must not be called.
	fire(first.row, 'click');
	assert.ok(first.row.classList.contains('is-selected'), 'row click selects the mineral');
});

test('the formation snapshot exports keyed by mineral id and imports whole or not at all', () => {
	const lab = loadLab();
	lab.runFrame();
	const geoConfig = require('../js/geology-config.js');
	const minerals = require('../js/minerals.js');

	// Export is the complete formation, not just the ranges.
	fire(lab.byId.get('export-formation'), 'click');
	const exported = JSON.parse(lab.clipboard.text);
	assert.equal(exported.format, geoConfig.format);
	assert.equal(exported.version, geoConfig.version);
	assert.deepEqual(Object.keys(exported.ranges).sort(), minerals.mineralIds.slice().sort());
	assert.deepEqual(exported.settings, {
		frequency: geoConfig.defaults.frequency,
		yCompression: geoConfig.defaults.yCompression,
		mode: geoConfig.defaults.mode,
		specificity: geoConfig.defaults.specificity,
		hostWeight: geoConfig.defaults.hostWeight
	}, 'the lab exports the settings it is showing');
	assert.ok(exported.calibration.desiredShares.iron > 0, 'desired shares travel as calibration metadata');

	// An edit, exported, imports back in and returns the lab to the edited state.
	const frequency = lab.byId.get('frequency');
	frequency.value = '0.2';
	fire(frequency, 'input');
	const mode = lab.byId.get('mode');
	mode.value = 'product';
	fire(mode, 'change');
	fire(lab.byId.get('export-formation'), 'click');
	const edited = lab.clipboard.text;
	fire(lab.byId.get('reset-ranges'), 'click');
	fire(lab.byId.get('export-formation'), 'click');
	assert.equal(JSON.parse(lab.clipboard.text).settings.frequency, geoConfig.defaults.frequency, 'reset restored the defaults');

	fire(lab.byId.get('import-formation'), 'click');
	assert.equal(lab.byId.get('import-panel').hidden, false, 'import opens a paste panel');
	lab.byId.get('import-text').value = edited;
	fire(lab.byId.get('import-apply'), 'click');
	assert.equal(lab.byId.get('import-panel').hidden, true);
	fire(lab.byId.get('export-formation'), 'click');
	const restored = JSON.parse(lab.clipboard.text);
	assert.equal(restored.settings.frequency, 0.2, 'the imported field frequency is applied');
	assert.equal(restored.settings.mode, 'product', 'the imported mode is applied');
	assert.deepEqual(restored.ranges, JSON.parse(edited).ranges, 'the imported ranges are applied');
	assert.equal(lab.byId.get('host-weight-value').textContent, geoConfig.formatValue('hostWeight', restored.settings.hostWeight),
		'the controls mirror the imported snapshot');

	// A broken paste is reported and changes nothing.
	fire(lab.byId.get('import-formation'), 'click');
	lab.byId.get('import-text').value = '{ not json';
	fire(lab.byId.get('import-apply'), 'click');
	assert.match(lab.byId.get('calibrate-status').textContent, /import rejected/);
	lab.byId.get('import-text').value = JSON.stringify({ format: geoConfig.format, version: geoConfig.version, settings: {}, ranges: {} });
	fire(lab.byId.get('import-apply'), 'click');
	assert.match(lab.byId.get('calibrate-status').textContent, /import rejected: frequency must be a finite number/);
	assert.match(lab.byId.get('calibrate-status').textContent, /ranges for stone/);
	fire(lab.byId.get('export-formation'), 'click');
	assert.deepEqual(JSON.parse(lab.clipboard.text), restored, 'a rejected import left the lab untouched');
});
