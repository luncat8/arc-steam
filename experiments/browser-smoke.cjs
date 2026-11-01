'use strict';
// Optional browser tooling is supplied externally; the application has no dependencies.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

// The page publishes its chamber fit, so a world point maps to a page point
// exactly as the renderer does it.
async function chamberTransform(page) {
	const box = await page.locator('#c').boundingBox();
	const view = await page.evaluate(() => ({ scale: SteamView.scale, offsetX: SteamView.offsetX, floorY: SteamView.floorY }));
	return { x: box.x + view.offsetX, y: box.y + view.floorY, scale: view.scale };
}

async function chamberPoint(page, worldX, worldY) {
	const view = await chamberTransform(page);
	return { x: view.x + worldX * view.scale, y: view.y - worldY * view.scale };
}

async function chamberClick(page, worldX, worldY) {
	const point = await chamberPoint(page, worldX, worldY);
	await page.mouse.click(point.x, point.y);
}

async function main() {
	const options = { headless: true };
	if (process.env.CHROMIUM_PACKAGE) {
		const loaded = await import(process.env.CHROMIUM_PACKAGE);
		const binary = loaded.default || loaded;
		options.executablePath = await binary.executablePath();
		options.args = binary.args;
	}
	const browser = await chromium.launch(options);
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(process.env.TEST_URL || pathToFileURL(path.resolve(__dirname, '../index.html')).href);
		await page.waitForFunction(() => document.getElementById('clock').textContent !== '0.0 s');
		// Cargo | chamber | controls share the workspace; telemetry cards lead to drawers.
		assert.deepEqual(await page.evaluate(() => {
			const box = selector => document.querySelector(selector).getBoundingClientRect();
			const cargo = box('.cargo-panel');
			const chamber = box('.mine-panel');
			const controls = box('.controls-panel');
			const telemetry = box('.telemetry');
			const workspace = box('.workspace');
			return [
				cargo.left < chamber.left && Math.abs(cargo.top - chamber.top) < 1,
				chamber.left < controls.left && Math.abs(controls.top - chamber.top) < 1,
				document.getElementById('market-drawer').hidden,
				Math.abs(telemetry.width - workspace.width) < 1,
				getComputedStyle(document.querySelector('.telemetry strong')).fontSize
			];
		}), [true, true, true, true, '17px']);
		// Side panels have independent scroll limits instead of setting canvas height.
		assert.equal(await page.evaluate(() => ['.cargo-panel', '.controls-panel'].every(selector => getComputedStyle(document.querySelector(selector)).maxHeight !== 'none')), true);
		// Rock view modes stay visible beneath the canvas and only change display.
		await page.locator('#pause').click();
		const pausedImage = await page.locator('#c').evaluate(canvas => canvas.toDataURL());
		await page.waitForTimeout(100);
		assert.equal(await page.locator('#c').evaluate(canvas => canvas.toDataURL()), pausedImage, 'a paused chamber is stable');
		// View mode: hover with a fine pointer or click; a paused chamber still redraws on change.
		await page.locator('#view-modes label', { hasText: 'Price' }).hover();
		assert.equal(await page.locator('#view-modes input[value="price"]').isChecked(), true);
		await page.waitForTimeout(50);
		const priceImage = await page.locator('#c').evaluate(canvas => canvas.toDataURL());
		assert.notEqual(priceImage, pausedImage, 'hovering redraws the paused chamber');
		await page.locator('#view-modes label', { hasText: 'Remaining strength' }).click();
		assert.equal(await page.locator('#view-modes input[value="strength"]').isChecked(), true);
		await page.waitForTimeout(50);
		assert.notEqual(await page.locator('#c').evaluate(canvas => canvas.toDataURL()), priceImage);
		await page.locator('#view-modes input[value="strength"]').focus();
		await page.keyboard.press('ArrowRight');
		assert.equal(await page.locator('#view-modes input[value="minerals"]').isChecked(), true, 'arrow keys cycle the radios');
		await page.locator('#science-open').click();
		await page.locator('#pause').click();
		const nodeCount = await page.evaluate(() => SteamResearch.nodes.length);
		assert.equal(await page.locator('#research-rows, #equipment-rows').count(), 0, 'separate split sections are gone');
		assert.equal(await page.locator('#progression-tree .tree-node').count(), nodeCount);
		assert.equal(await page.locator('#progression-tree [data-technology]').count(), nodeCount, 'each research node appears once');
		assert.equal(await page.locator('#progression-tree [data-item]').count(), await page.evaluate(() => SteamEquipment.items.length), 'each equipment item appears once');
		assert.equal(await page.locator('#progression-tree .tier-slot').count(), 3, 'engines, radiators and strike balls each have one tier slot');
		assert.equal(await page.locator('#tree-links path').count(), 12, 'twelve SVG prerequisite edges connect the tree');
		assert.equal(await page.evaluate(() => Array.from(document.querySelectorAll('#tree-links path')).every(path => Boolean(path.getAttribute('d')))), true, 'every SVG edge is laid out');
		assert.equal(await page.evaluate(() => {
			const content = document.querySelector('#science-drawer .tool-drawer-content');
			return content.scrollWidth <= content.clientWidth && content.scrollHeight <= content.clientHeight;
		}), true, 'the whole progression tree fits inside 1440x1000 without overflow');
		assert.equal(await page.locator('#commercial-grader').count(), 1);
		assert.equal(await page.locator('#research-progress').textContent(), '0 / ' + nodeCount);
		assert.equal(await page.locator('#platform-spec').evaluate(node => node.children.length), 20, 'ten specification labels with their values');
		await page.locator('#science-close').click();
		assert.equal(await page.locator('#refuel').isDisabled(), true, 'a full reserve needs no recharge');
		assert.equal(await page.locator('#prediction-status').isHidden(), true, 'the overlay waits for its research');
		assert.match(await page.locator('#temperature').textContent(), /°C/);
		assert.match(await page.locator('#heat').textContent(), /J/);
		assert.match(await page.locator('#cooled').textContent(), /J/);
		assert.deepEqual(await page.evaluate(() => [
			typeof window.SteamCeiling.state,
			typeof window.SteamCeiling.state.funds,
			typeof window.SteamCeiling.funds
		]), ['object', 'number', 'undefined']);
		assert.equal(await page.locator('#drive').getAttribute('aria-pressed'), 'true', 'the drive is enabled by default');
		await page.locator('#drive').click();
		assert.equal(await page.locator('#drive').getAttribute('aria-pressed'), 'false');
		await page.keyboard.press('Space');
		assert.equal(await page.locator('#drive').getAttribute('aria-pressed'), 'true');
		await page.keyboard.press('KeyQ');
		assert.equal(await page.locator('#drive').getAttribute('aria-pressed'), 'false');
		// Piston tilt: slider, chamber wheel (about 4° a notch) and an open-air drag share one angle.
		await page.locator('#piston-angle').evaluate(input => { input.value = '5'; input.dispatchEvent(new Event('input', { bubbles: true })); });
		assert.equal(await page.locator('#piston-value').textContent(), '5.0°');
		await page.locator('#c').hover();
		await page.mouse.wheel(0, -120);
		assert.equal(await page.locator('#piston-angle').inputValue(), '9');
		assert.equal(await page.locator('#piston-value').textContent(), '9.0°');
		// The drag aims the reflection, so it runs the way the ball should: left or up
		// raises the angle (a positive angle sends a falling ball left), right lowers it.
		const air = await chamberPoint(page, 5, 5);
		await page.mouse.move(air.x, air.y);
		await page.mouse.down();
		await page.mouse.move(air.x - 40, air.y - 20, { steps: 4 });
		await page.mouse.up();
		assert.equal(await page.locator('#piston-angle').inputValue(), '10', 'dragging left and up raises the tilt to its limit');
		await page.mouse.move(air.x, air.y);
		await page.mouse.down();
		await page.mouse.move(air.x + 100, air.y, { steps: 4 });
		await page.mouse.up();
		assert.equal(await page.locator('#piston-angle').inputValue(), '5', 'dragging right lowers it by the same rate');
		assert.equal(await page.locator('#piston-value').textContent(), '5.0°');
		await page.keyboard.press('KeyW');
		assert.equal(await page.locator('#force').inputValue(), '70');
		await page.locator('#pause').click();
		await page.waitForTimeout(150);
		const time = await page.locator('#clock').textContent();
		await page.waitForTimeout(200);
		assert.equal(await page.locator('#clock').textContent(), time);
		// Pressing Space while Pause was the last clicked GUI button toggles drive, not Pause.
		await page.keyboard.press('Space');
		assert.equal(await page.locator('#drive').getAttribute('aria-pressed'), 'true');
		assert.equal(await page.locator('#pause').textContent(), 'Resume');
		await page.locator('#reset').click();
		assert.equal(await page.locator('#force').inputValue(), '60');
		assert.equal(await page.locator('#piston-value').textContent(), '0.0°', 'reset levels the piston');
		await page.locator('#pause').click();
		assert.equal(await page.locator('#shape').inputValue(), 'smooth');
		await page.locator('#shape').selectOption('square');
		assert.equal(await page.locator('#shape').inputValue(), 'square');
		await page.locator('#shape').selectOption('smooth');
		// Mineral data is a hover tooltip, not a permanent inspector panel.
		assert.equal(await page.locator('#mineral-column, #mineral-layer').count(), 0, 'inspector sliders removed');
		assert.equal(await page.locator('#transaction-count').textContent(), '(0)');
		assert.match(await page.locator('#reserve-note').textContent(), /Centre pad|Reserve full|Charging/);
		assert.match(await page.locator('.mine-footer').textContent(), /CHARGE PAD · 3 kW/);
		// Locked upgrades explain themselves instead of failing silently: blocked buttons are
		// aria-disabled, so the click reaches the handler (force skips Playwright's enabled check).
		await page.locator('#science-open').click();
		await page.locator('[data-technology="ballistics2"] button').click({ force: true });
		assert.match(await page.locator('#progression-status').textContent(), /stays locked until/);
		// The road grader sits in the base chassis root and needs no research, so the
		// pad slot inside Rebound materials explains its research prerequisite.
		await page.locator('[data-item="pad"] button').click({ force: true });
		assert.match(await page.locator('#progression-status').textContent(), /needs the .* research first/);
		await page.locator('#science-close').click();
		await page.locator('#c').scrollIntoViewIfNeeded();
		const rockPoint = await chamberPoint(page, 12, 14.5);
		await page.mouse.move(rockPoint.x, rockPoint.y);
		assert.equal(await page.locator('#mineral-tooltip').isVisible(), true, 'hovering a visible cell shows its tooltip');
		assert.match(await page.locator('#mineral-cell').textContent(), /^Column \d+ \/ 192 · Layer \d+ \/ 16$/);
		assert.match(await page.locator('#mineral-strength').textContent(), /J/);
		await page.waitForTimeout(300);
		assert.equal(await page.locator('#motion').textContent(), '0.00 m/s', 'a rock click does not command travel');
		await chamberClick(page, 5, 0.5);
		await page.waitForTimeout(400);
		assert.notEqual(await page.locator('#motion').textContent(), '0.00 m/s');
		assert.equal(await page.locator('#launch').isDisabled(), true);
		assert.match(await page.locator('#mineral-cell').textContent(), /^Column \d+ \/ 192 · Layer \d+ \/ 16$/, 'travel does not change the selected cell');
		assert.ok(Math.abs(parseFloat(await page.locator('#error').textContent())) < 0.00001);
		// Communism mode: the system-bar switch zeroes every price, waives the
		// research gates and books the handouts as free.
		await page.locator('#science-open').click();
		await page.locator('#commune').click();
		assert.equal(await page.evaluate(() => SteamCeiling.state.commune), true);
		assert.equal(await page.locator('#credits').textContent(), 'commons');
		assert.equal(await page.locator('#science-funds').textContent(), 'commons');
		assert.equal(await page.locator('#refuel-cost').textContent(), 'free');
		assert.match(await page.locator('[data-item="grader"] b').textContent(), /ROAD GRADER · FREE/);
		assert.equal(await page.locator('[data-technology="ballistics2"] button').getAttribute('aria-disabled'), 'false', 'a gated node is open in the commons');
		await page.locator('[data-item="flywheel"] button').click({ force: true });
		assert.match(await page.locator('#progression-status').textContent(), /^Installed Brake flywheel at /);
		assert.match(await page.locator('#ledger').locator('li').first().textContent(), /Bought Brake flywheel · free/);
		assert.equal(await page.evaluate(() => SteamCeiling.state.funds), 0, 'the commons charges nothing');
		await page.keyboard.press('KeyM');
		assert.equal(await page.evaluate(() => SteamCeiling.state.commune), false);
		assert.match(await page.locator('[data-item="grader"] b').textContent(), /ROAD GRADER · 300 CR/);
		assert.equal(await page.locator('#credits').textContent(), '0.0 cr');
		// Test mode grants the whole tree and shop for free, persists as a mode
		// across New game, and leaves those grants in place when turned off.
		await page.locator('#test-mode').click();
		assert.equal(await page.locator('#research-progress').textContent(), nodeCount + ' / ' + nodeCount);
		assert.equal(await page.locator('#progression-tree [data-item][data-state="installed"]').count(), await page.evaluate(() => SteamEquipment.items.length));
		assert.match(await page.locator('#ledger li').first().textContent(), /Test installed /);
		await page.locator('#reset').click();
		assert.equal(await page.locator('#test-mode').isChecked(), true);
		assert.equal(await page.locator('#research-progress').textContent(), nodeCount + ' / ' + nodeCount);
		await page.locator('#test-mode').click();
		assert.equal(await page.locator('#research-progress').textContent(), nodeCount + ' / ' + nodeCount, 'test grants are not revoked by switching the mode off');
		await page.locator('#reset').click();
		assert.equal(await page.locator('#research-progress').textContent(), '0 / ' + nodeCount);
		await page.locator('#science-close').click();
			// Autopilot: one checkbox per duty, the same duty on a shortcut, and each one
		// temporarily yields to the manual command that does the same job.
		assert.equal(await page.locator('#autopilot input[type="checkbox"]').count(), 4);
		assert.equal(await page.locator('#autopilot-status').isHidden(), true, 'a disengaged autopilot says nothing');
		await page.locator('#autopilot label', { hasText: 'Chase the predicted landing' }).click();
		assert.equal(await page.locator('#auto-move').isChecked(), true);
		assert.match(await page.locator('#autopilot-status').textContent(), /^Intercept · /);
		await page.locator('#autopilot label', { hasText: 'Timed intercept' }).click();
		assert.equal(await page.locator('#auto-smart').isChecked(), true);
		assert.equal(await page.locator('#auto-move').isChecked(), false, 'one intercept duty at a time');
		assert.match(await page.locator('#autopilot-status').textContent(), /^Timed intercept · /);
		await page.keyboard.press('KeyX');
		assert.equal(await page.locator('#auto-move').isChecked(), true, 'X chases');
		assert.equal(await page.locator('#auto-smart').isChecked(), false);
		await page.keyboard.press('Shift+KeyX');
		assert.equal(await page.locator('#auto-smart').isChecked(), true, 'shift X takes the timed intercept');
		await page.keyboard.press('KeyZ');
		await page.keyboard.press('KeyC');
		assert.deepEqual(await page.evaluate(() => {
			const plan = window.SteamAutopilot.state;
			return [plan.move, plan.smart, plan.drive, plan.angle, plan.active];
		}), [false, true, true, true, true]);
		assert.match(await page.locator('#autopilot-status').textContent(), /Drive keeper · (pulse armed|pulse held) · Level bounce · tilt to -?\d+\.\d°/);
		await page.keyboard.press('KeyA');
		assert.equal(await page.locator('#auto-smart').isChecked(), true, 'manual travel keeps the preference enabled');
		assert.equal(await page.evaluate(() => SteamAutopilot.suspended('smart')), true);
		assert.equal(await page.locator('#auto-drive').isChecked(), true, 'and leaves the other duties alone');
		await page.locator('#piston-angle').evaluate(input => { input.value = '2'; input.dispatchEvent(new Event('input', { bubbles: true })); });
		assert.equal(await page.locator('#auto-angle').isChecked(), true, 'manual tilt keeps the preference enabled');
		assert.equal(await page.evaluate(() => SteamAutopilot.suspended('angle')), true);
		await page.locator('#drive').click();
		assert.equal(await page.locator('#auto-drive').isChecked(), true, 'manual drive keeps the preference enabled');
		assert.equal(await page.evaluate(() => SteamAutopilot.suspended('drive')), true);
		await page.waitForTimeout(150);
		assert.match(await page.locator('#autopilot-status').textContent(), /manual override/);
		await page.waitForFunction(() => !SteamAutopilot.suspended('smart') && !SteamAutopilot.suspended('drive') && !SteamAutopilot.suspended('angle'));
		for (const id of ['auto-smart', 'auto-drive', 'auto-angle']) assert.equal(await page.locator('#' + id).isChecked(), true);
		await page.keyboard.press('KeyZ');
		await page.keyboard.press('Space');
		assert.equal(await page.locator('#auto-drive').isChecked(), false, 'the drive shortcut keeps the duty manual');
		// Context help: hover previews a topic without stealing focus, a click pins it,
		// Escape closes, and the compact panels keep their short status lines.
		await page.locator('#c').scrollIntoViewIfNeeded();
		assert.equal(await page.evaluate(() => document.getElementById('help-drawer').dataset.open), 'false');
		await page.locator('#help-tilt').hover();
		await page.waitForTimeout(150);
		assert.equal(await page.evaluate(() => document.getElementById('help-drawer').dataset.open), 'true', 'hover opens the drawer');
		assert.equal(await page.locator('#help-title').textContent(), await page.evaluate(() => SteamHelp.find('tilt').title));
		assert.equal(await page.locator('#help-tilt').getAttribute('aria-expanded'), 'true');
		await page.locator('#help-index button', { hasText: 'Keys' }).click();
		assert.match(await page.locator('#help-title').textContent(), /Controls/);
		assert.ok(await page.locator('#help-body dt').count() > 10, 'the controls topic lists every shortcut');
		assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('#help-drawer'))), true, 'the index keeps focus inside the drawer');
		await page.keyboard.press('Escape');
		assert.equal(await page.evaluate(() => document.getElementById('help-drawer').dataset.open), 'false');
		assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('#help-drawer'))), false, 'closing never leaves focus inside the hidden drawer');
		await page.keyboard.press('KeyH');
		assert.equal(await page.evaluate(() => document.getElementById('help-drawer').dataset.open), 'true', 'H opens help');
		await page.keyboard.press('KeyH');
		assert.equal(await page.evaluate(() => document.getElementById('help-drawer').dataset.open), 'false');
		// Holding a panel opens its topic. Hold the pointer down and wait for the
		// state: this headless shell delays page timers by seconds, so a fixed
		// release delay would race the 550 ms gesture.
		const panelTitle = await page.locator('.cargo-panel .panel-title').boundingBox();
		await page.mouse.move(panelTitle.x + 40, panelTitle.y + panelTitle.height / 2);
		await page.mouse.down();
		await page.waitForFunction(() => document.getElementById('help-drawer').dataset.open === 'true', null, { timeout: 30000 });
		await page.mouse.up();
		assert.equal(await page.locator('#help-title').textContent(), 'Cargo and storage', 'the held panel names its topic');
		await page.keyboard.press('Escape');
		await page.setViewportSize({ width: 390, height: 844 });
		await page.waitForTimeout(100);
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		assert.equal(await page.evaluate(() => ['.mine-panel', '.controls-panel', '.cargo-panel'].every(selector => document.querySelector(selector).getBoundingClientRect().height > 200)), true, 'stacked panels keep their content height');
		assert.deepEqual(errors, []);
		// Touch-only devices keep the view menu click-only. The touch page must be in
		// front: a background page throttles its animation frames, and an unthrottled
		// page is what a hover needs to measure a stable layout.
		const touch = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true, isMobile: true });
		await touch.goto(process.env.TEST_URL || pathToFileURL(path.resolve(__dirname, '../index.html')).href);
		await touch.bringToFront();
		assert.equal(await touch.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches), false);
		// A raw pointer move instead of locator.hover(): the hover actionability check
		// waits for two identical animation frames, which a second page in this
		// single-process headless shell does not reliably deliver.
		const priceLabel = await touch.locator('#view-modes label', { hasText: 'Price' }).boundingBox();
		await touch.mouse.move(priceLabel.x + priceLabel.width / 2, priceLabel.y + priceLabel.height / 2);
		assert.equal(await touch.locator('#view-modes input[value="minerals"]').isChecked(), true, 'hover does not switch on touch');
		await touch.locator('#view-modes label', { hasText: 'Price' }).tap();
		assert.equal(await touch.locator('#view-modes input[value="price"]').isChecked(), true, 'tap switches on touch');
		// A tap is the whole help interaction on touch: no hover preview, the same
		// mark toggles, and a narrow screen gets a bottom sheet instead of a side
		// drawer. Holding a panel opens its topic with no mark at all.
		await touch.locator('#help-drive').tap();
		assert.equal(await touch.evaluate(() => document.getElementById('help-drawer').dataset.open), 'true', 'tap opens help');
		assert.equal(await touch.locator('#help-title').textContent(), 'Bounce drive');
		assert.equal(await touch.evaluate(() => document.activeElement.id), 'help-close', 'the sheet brings its own controls into focus');
		await touch.locator('#help-close').tap();
		assert.equal(await touch.evaluate(() => document.getElementById('help-drawer').dataset.open), 'false', 'the close button dismisses it');
		await touch.setViewportSize({ width: 390, height: 844 });
		await touch.waitForTimeout(150);
		await touch.locator('#help-drive').tap();
		assert.equal(await touch.evaluate(() => document.getElementById('help-drawer').getBoundingClientRect().top > 150), true, 'a narrow touch screen gets a bottom sheet');
		assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the sheet does not overflow');
		await touch.locator('#help-close').tap();
		assert.equal(await touch.evaluate(() => document.getElementById('help-drawer').dataset.open), 'false');
		console.log('PASS: startup, cargo/chamber/controls layout, always-visible rock view modes, cargo-to-market and funds-to-science drawers, view-mode hover/click/arrow keys with paused redraw and touch gating, drive on by default and toggling (Space/Q without pressing GUI controls), piston tilt by slider, chamber wheel and an inverted open-air drag, keyboard force, pause/reset, shape selector, rock-hover tooltip without inspector panel, rock-versus-low click zones, target travel, centre pad note, research/equipment gating, communism mode with free prices and waived gates, ledger, autopilot checkboxes with X/Z/C shortcuts and manual overrides, context help drawer (hover preview, click pin, H/Escape, touch tap and bottom sheet, held panel), narrow layout; no page errors.');
	} finally {
		await browser.close();
	}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
