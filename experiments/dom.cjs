'use strict';
// Minimal DOM shim for the always-available interface test: the interface
// wiring (ids, handlers, canvas calls, panel states) runs without a browser.
// It implements only what js/main.js touches and records canvas commands
// rather than rasterising them; real browser behaviour belongs in browser-smoke.cjs.
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

class Element {
	constructor(tagName, id) {
		this.tagName = tagName.toUpperCase();
		this.id = id || '';
		this.children = [];
		this.dataset = {};
		this.attributes = {};
		this.listeners = {};
		this.textContent = '';
		this.style = {};
		this.offsetHeight = 0;
		this.hidden = false;
		this.disabled = false;
		this.type = '';
		this.raw = initialValue(id);
		this.textNode = { textContent: '' };
		this.parentElement = null;
		this.name = '';
		this.checked = false;
		this.control = null;
	}
	// Form controls stringify assignments, exactly like the DOM does.
	get value() { return this.raw; }
	set value(next) { this.raw = next === null || next === undefined ? '' : String(next); }
	get firstChild() { return this.textNode; }
	appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
	append(...children) { for (const child of children) this.appendChild(child); }
	replaceChildren(...children) { this.children = children; }
	setAttribute(name, value) { this.attributes[name] = String(value); }
	getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
	addEventListener(type, handler) {
		if (!this.listeners[type]) this.listeners[type] = [];
		this.listeners[type].push(handler);
	}
	dispatch(type, extra) {
		const event = Object.assign({ type, target: this, preventDefault() {}, stopPropagation() {} }, extra);
		for (const handler of this.listeners[type] || []) handler.call(this, event);
		return event;
	}
	closest() { return null; }
	focus() { document.activeElement = this; }
	blur() { document.activeElement = document.body; }
	setPointerCapture() {}
	getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 420 }; }
	getContext() { return this.context; }
}

// Selected options live in markup, so a select reports the value the browser
// would report before any script runs.
function initialValue(id) {
	if (!id) return '';
	const tag = html.match(new RegExp('<[^>]*\\bid="' + id + '"[^>]*>'));
	if (!tag) return '';
	const attribute = tag[0].match(/\bvalue="([^"]*)"/);
	if (attribute) return attribute[1];
	if (!tag[0].startsWith('<select')) return '';
	const body = html.slice(html.indexOf(tag[0]) + tag[0].length, html.indexOf('</select>', html.indexOf(tag[0])));
	const selected = body.match(/<option value="([^"]*)"[^>]*selected/) || body.match(/<option value="([^"]*)"/);
	return selected ? selected[1] : '';
}

const contextCalls = [];
function createContext() {
	const context = { calls: contextCalls };
	const commands = ['clearRect', 'save', 'restore', 'translate', 'scale', 'setTransform', 'beginPath', 'moveTo',
		'lineTo', 'stroke', 'fill', 'fillRect', 'strokeRect', 'arc', 'closePath', 'setLineDash', 'fillText', 'rotate'];
	for (const command of commands) context[command] = function () { contextCalls.push(command); };
	return context;
}

const elements = new Map();
for (const match of html.matchAll(/<([a-z]+)([^>]*)>/g)) {
	const id = match[2].match(/\bid="([^"]+)"/);
	if (!id) continue;
	const element = new Element(match[1], id[1]);
	// Attributes are read from the tag, so aria wiring asserted in the markup is
	// tested as written instead of only after a script writes it.
	for (const attribute of match[2].matchAll(/([a-z-]+)="([^"]*)"/g)) element.attributes[attribute[1]] = attribute[2];
	element.hidden = /\bhidden(?:\s|>|$)/.test(match[2]);
	if (match[1] === 'canvas') element.context = createContext();
	elements.set(id[1], element);
}

// One shared media query result, so tests can switch between a hovering mouse and touch.
const pointerMedia = { matches: true };
const listeners = {};
const document = {
	body: new Element('body'),
	activeElement: null,
	hidden: false,
	elements,
	getElementById(id) { return elements.get(id) || null; },
	createElement(tagName) { return new Element(tagName); },
	addEventListener(type, handler) {
		if (!listeners[type]) listeners[type] = [];
		listeners[type].push(handler);
	},
	dispatch(type, extra) {
		const event = Object.assign({ type, target: document.body, preventDefault() {}, stopPropagation() {} }, extra);
		for (const handler of listeners[type] || []) handler(event);
		return event;
	}
};
document.body.addEventListener = document.addEventListener;
document.body.dispatch = document.dispatch;

let frameCallback = null;
const resizeCallbacks = [];

function install() {
	globalThis.document = document;
	globalThis.window = globalThis;
	globalThis.devicePixelRatio = 2;
	globalThis.innerWidth = 1440;
	globalThis.innerHeight = 1000;
	globalThis.addEventListener = document.addEventListener;
	globalThis.matchMedia = function () { return pointerMedia; };
	globalThis.requestAnimationFrame = function (callback) { frameCallback = callback; return 1; };
	globalThis.ResizeObserver = class {
		constructor(callback) { resizeCallbacks.push(callback); }
		observe() {}
	};
	document.activeElement = document.body;
	return api;
}

const api = {
	document,
	elements,
	contextCalls,
	pointerMedia,
	install,
	element(id) {
		const element = elements.get(id);
		if (!element) throw new Error('missing #' + id);
		return element;
	},
	resize() { for (const callback of resizeCallbacks) callback(); },
	// Frames run only when asked, so a test controls simulated time exactly.
	frame(now) {
		if (!frameCallback) throw new Error('no frame scheduled');
		const callback = frameCallback;
		frameCallback = null;
		callback(now);
	},
	frames(count, from = 0, step = 1000 / 60) {
		for (let i = 0; i < count; i++) api.frame(from + i * step);
	},
	key(code, extra) { return document.dispatch('keydown', Object.assign({ code, repeat: false }, extra)); },
	keyUp(code) { return document.dispatch('keyup', { code }); }
};

module.exports = api;
