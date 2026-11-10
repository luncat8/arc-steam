// A two-handle range slider with a plot behind the track: the grey bars are
// the histogram of the value being ranged, the filled area is what the current
// selection actually yields, so a band can be placed where it produces rock
// instead of being guessed. Dependency-free classic script; pointer, touch and
// keyboard driven, no allocations while dragging.
// Provides: SteamRangeSlider.create(host, options) -> { element, setRange, getRange, setPlot, setLabel }
(function (root) {
	'use strict';

	const drag = { handle: 0, pointer: 0, active: false };

	function clamp(value, low, high) { return value < low ? low : value > high ? high : value; }

	function create(host, options) {
		const minimum = options.min === undefined ? 0 : options.min;
		const maximum = options.max === undefined ? 1 : options.max;
		const step = options.step || 0.005;
		const gap = options.minGap === undefined ? step * 4 : options.minGap;
		let low = options.low === undefined ? minimum : options.low;
		let high = options.high === undefined ? maximum : options.high;

		const wrap = document.createElement('div');
		wrap.className = 'range-slider';
		const head = document.createElement('div');
		head.className = 'range-head';
		const label = document.createElement('span');
		label.className = 'range-label';
		label.textContent = options.label || '';
		const readout = document.createElement('output');
		readout.className = 'range-value';
		head.append(label, readout);

		const track = document.createElement('div');
		track.className = 'range-track';
		const plot = document.createElement('canvas');
		plot.className = 'range-plot';
		const fill = document.createElement('div');
		fill.className = 'range-fill';
		const lowHandle = handle('low', (options.label || 'Range') + ' low');
		const highHandle = handle('high', (options.label || 'Range') + ' high');
		track.append(plot, fill, lowHandle, highHandle);
		wrap.append(head, track);
		host.append(wrap);

		function handle(name, aria) {
			const dot = document.createElement('div');
			dot.className = 'range-handle range-handle-' + name;
			dot.tabIndex = 0;
			dot.setAttribute('role', 'slider');
			dot.setAttribute('aria-label', aria);
			dot.dataset.handle = name;
			return dot;
		}

		function quantize(value) { return Math.round(value / step) * step; }

		function position(value) { return (value - minimum) / (maximum - minimum) * 100; }

		function share(value, total) { return total > 0 ? clamp(value / total, 0, 1) : 0; }

		function paint() {
			fill.style.left = position(low) + '%';
			fill.style.right = (100 - position(high)) + '%';
			lowHandle.style.left = position(low) + '%';
			highHandle.style.left = position(high) + '%';
			lowHandle.setAttribute('aria-valuemin', minimum);
			lowHandle.setAttribute('aria-valuemax', high - gap);
			highHandle.setAttribute('aria-valuemin', low + gap);
			highHandle.setAttribute('aria-valuemax', maximum);
			lowHandle.setAttribute('aria-valuenow', low.toFixed(3));
			highHandle.setAttribute('aria-valuenow', high.toFixed(3));
			lowHandle.setAttribute('aria-valuetext', text());
			highHandle.setAttribute('aria-valuetext', text());
			readout.textContent = text();
		}

		function text() { return low.toFixed(2) + ' – ' + high.toFixed(2); }

		// `finished` is false while a drag is moving, true on release, click and
		// key press, so a listener can do the cheap work live and the expensive
		// work once.
		function emit(finished) {
			if (options.onInput) options.onInput(low, high, finished);
		}

		function setLow(value, emitNow, finished) {
			low = clamp(quantize(value), minimum, high - gap);
			paint();
			if (emitNow) emit(finished !== false);
		}

		function setHigh(value, emitNow, finished) {
			high = clamp(quantize(value), low + gap, maximum);
			paint();
			if (emitNow) emit(finished !== false);
		}

		function valueAt(clientX) {
			const box = track.getBoundingClientRect();
			const ratio = box.width > 0 ? clamp((clientX - box.left) / box.width, 0, 1) : 0;
			return minimum + ratio * (maximum - minimum);
		}

		// A click on the track moves the nearer handle, so the whole bar is a
		// target; a click on a handle starts a drag on that handle only.
		function onDown(event) {
			const target = event.target;
			const picked = target.dataset ? target.dataset.handle : '';
			const value = valueAt(event.clientX);
			if (picked !== 'low' && picked !== 'high') {
				const useLow = Math.abs(value - low) <= Math.abs(value - high);
				drag.handle = useLow ? 0 : 1;
				if (useLow) setLow(value, true, true); else setHigh(value, true, true);
			} else {
				drag.handle = picked === 'low' ? 0 : 1;
			}
			drag.active = true;
			drag.pointer = event.pointerId;
			track.setPointerCapture(event.pointerId);
			const dot = drag.handle === 0 ? lowHandle : highHandle;
			dot.classList.add('is-active');
			dot.focus();
			event.preventDefault();
		}

		function onMove(event) {
			if (!drag.active || event.pointerId !== drag.pointer) return;
			const value = valueAt(event.clientX);
			if (drag.handle === 0) setLow(value, true, false); else setHigh(value, true, false);
		}

		function onUp(event) {
			if (!drag.active || event.pointerId !== drag.pointer) return;
			drag.active = false;
			lowHandle.classList.remove('is-active');
			highHandle.classList.remove('is-active');
			if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
			emit(true);
		}

		function onKey(event) {
			const dot = event.currentTarget;
			const isLow = dot.dataset.handle === 'low';
			const stride = event.shiftKey ? step * 10 : step;
			let delta = 0;
			if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') delta = -stride;
			else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') delta = stride;
			else if (event.key === 'Home') delta = -Infinity;
			else if (event.key === 'End') delta = Infinity;
			else return;
			event.preventDefault();
			if (isLow) setLow(delta === -Infinity ? minimum : delta === Infinity ? high - gap : low + delta, true, true);
			else setHigh(delta === Infinity ? maximum : delta === -Infinity ? low + gap : high + delta, true, true);
		}

		track.addEventListener('pointerdown', onDown);
		track.addEventListener('pointermove', onMove);
		track.addEventListener('pointerup', onUp);
		track.addEventListener('pointercancel', onUp);
		lowHandle.addEventListener('keydown', onKey);
		highHandle.addEventListener('keydown', onKey);

		// `counts` is the value histogram, `yields` what one unit of the value
		// is worth to the current selection; both are drawn normalised to their
		// own peak so the shapes, not the scales, can be compared.
		function setPlot(counts, yields, accent) {
			const dpr = Math.min(2, root.devicePixelRatio || 1);
			const width = track.clientWidth || 240;
			const height = track.clientHeight || 44;
			plot.width = Math.round(width * dpr);
			plot.height = Math.round(height * dpr);
			plot.style.width = width + 'px';
			plot.style.height = height + 'px';
			const context = plot.getContext('2d');
			context.setTransform(dpr, 0, 0, dpr, 0, 0);
			context.clearRect(0, 0, width, height);
			const bins = counts.length;
			let peakCount = 0;
			let peakYield = 0;
			for (let i = 0; i < bins; i++) {
				if (counts[i] > peakCount) peakCount = counts[i];
				if (yields[i] > peakYield) peakYield = yields[i];
			}
			const barWidth = width / bins;
			context.fillStyle = 'rgba(160, 184, 188, 0.16)';
			for (let i = 0; i < bins; i++) {
				const h = share(counts[i], peakCount) * height * 0.9;
				context.fillRect(i * barWidth, height - h, Math.max(1, barWidth - 0.6), h);
			}
			context.beginPath();
			context.moveTo(0, height);
			for (let i = 0; i < bins; i++) context.lineTo(i * barWidth + barWidth * 0.5, height - share(yields[i], peakYield) * height * 0.92);
			context.lineTo(width, height);
			context.closePath();
			context.fillStyle = accent || 'rgba(185, 237, 145, 0.22)';
			context.fill();
			context.strokeStyle = accent || 'rgba(185, 237, 145, 0.7)';
			context.lineWidth = 1;
			context.stroke();
		}

		paint();
		return {
			element: wrap,
			setRange(nextLow, nextHigh) {
				low = clamp(quantize(nextLow), minimum, maximum - gap);
				high = clamp(quantize(nextHigh), low + gap, maximum);
				paint();
			},
			getRange() { return [low, high]; },
			setLabel(text) { label.textContent = text; },
			setPlot: setPlot
		};
	}

	root.SteamRangeSlider = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
