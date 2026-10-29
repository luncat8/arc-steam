'use strict';
// Optional browser tooling is supplied externally; the application has no dependencies.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

// Mirror the renderer's chamber transform to point at a known world point.
async function chamberTransform(page) {
	const box = await page.locator('#c').boundingBox();
	const chamberHeight = await page.evaluate(() => SteamPhysics.config.ceiling);
	const scale = Math.min((box.width - 32) / 25.5, (box.height - 80) / chamberHeight);
	const offsetX = (box.width - 25.5 * scale) / 2 + 1.5 * scale;
	const floorY = (box.height + chamberHeight * scale) / 2 + 9;
	return { x: box.x + offsetX, y: box.y + floorY, scale };
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
		// Four rows: system bar, full-width telemetry, research | chamber | controls | inspector, equipment | cargo | market.
		assert.deepEqual(await page.evaluate(() => {
			const rows = Array.from(document.querySelector('main').children, node => node.className);
			const centres = ['.tech-panel', '.mine-panel', '.controls-panel', '.mineral-panel', '.equipment-panel', '.cargo-panel', '.market-panel']
				.map(selector => document.querySelector(selector).getBoundingClientRect());
			const telemetry = document.querySelector('.telemetry').getBoundingClientRect();
			const workspace = document.querySelector('.workspace').getBoundingClientRect();
			return [
				rows,
				centres.slice(0, 4).every((box, i) => i === 0 || (box.left > centres[i - 1].left && Math.abs(box.top - centres[0].top) < 1)),
				centres.slice(4).every((box, i) => i === 0 || (box.left > centres[i + 3].left && Math.abs(box.top - centres[4].top) < 1)),
				centres[4].top > centres[1].bottom,
				Math.abs(telemetry.width - workspace.width) < 1,
				getComputedStyle(document.querySelector('.telemetry strong')).fontSize
			];
		}), [['system-bar panel', 'telemetry panel', 'workspace', 'economy'], true, true, true, true, '17px']);
		// Side columns take the chamber's height and scroll instead of stretching the row.
		assert.equal(await page.evaluate(() => {
			const chamber = document.querySelector('.mine-panel').getBoundingClientRect().height;
			return ['.tech-panel', '.controls-panel', '.mineral-panel'].every(selector => Math.abs(document.querySelector(selector).getBoundingClientRect().height - chamber) < 1);
		}), true);
		// View mode: hover with a fine pointer or click; a paused chamber still redraws on change.
		await page.locator('#pause').click();
		const pausedImage = await page.locator('#c').evaluate(canvas => canvas.toDataURL());
		await page.waitForTimeout(100);
		assert.equal(await page.locator('#c').evaluate(canvas => canvas.toDataURL()), pausedImage, 'a paused chamber is stable');
		await page.locator('#view-modes label', { hasText: 'Price' }).hover();
		assert.equal(await page.locator('#view-modes input[value="price"]').isChecked(), true);
		await page.waitForTimeout(50);
		const priceImage = await page.locator('#c').evaluate(canvas => canvas.toDataURL());
		assert.notEqual(priceImage, pausedImage, 'hovering redraws the paused chamber');
		await page.locator('#view-modes label', { hasText: 'Remain strength' }).click();
		assert.equal(await page.locator('#view-modes input[value="strength"]').isChecked(), true);
		await page.waitForTimeout(50);
		assert.notEqual(await page.locator('#c').evaluate(canvas => canvas.toDataURL()), priceImage);
		await page.locator('#view-modes input[value="strength"]').focus();
		await page.keyboard.press('ArrowRight');
		assert.equal(await page.locator('#view-modes input[value="minerals"]').isChecked(), true, 'arrow keys cycle the radios');
		await page.locator('#pause').click();
		const nodeCount = await page.evaluate(() => SteamResearch.nodes.length);
		assert.equal(await page.locator('#research-rows .upgrade-row').count(), nodeCount);
		assert.equal(await page.locator('#equipment-rows .upgrade-row').count(), await page.evaluate(() => SteamEquipment.items.length));
		assert.equal(await page.locator('#research-progress').textContent(), '0 / ' + nodeCount);
		assert.equal(await page.locator('#platform-spec').evaluate(node => node.children.length), 14);
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
		// The inspector follows clicks now: sliders are gone, and the low band
		// commands travel while open air between the zones does nothing.
		assert.equal(await page.locator('#mineral-column, #mineral-layer').count(), 0, 'inspector sliders removed');
		assert.match(await page.locator('#mineral-cell').textContent(), /^Column \d+ \/ 192 · Layer \d+ \/ 16$/);
		assert.match(await page.locator('#mineral-strength').textContent(), /J/);
		assert.equal(await page.locator('#transaction-count').textContent(), '(0)');
		assert.match(await page.locator('#reserve-note').textContent(), /Centre pad|Reserve full|Charging/);
		assert.match(await page.locator('.mine-footer').textContent(), /CHARGE PAD · 3 kW/);
		// Locked upgrades explain themselves instead of failing silently: blocked buttons are
		// aria-disabled, so the click reaches the handler (force skips Playwright's enabled check).
		await page.locator('#research-rows .upgrade-row').last().locator('button').click({ force: true });
		assert.match(await page.locator('#research-status').textContent(), /stays locked until/);
		// The road grader sits first and needs no research, so the pad row is the
		// one that must explain its research prerequisite.
		await page.locator('#equipment-rows .upgrade-row', { hasText: 'REBOUND PAD' }).locator('button').click({ force: true });
		assert.match(await page.locator('#equipment-status').textContent(), /needs the .* research first/);
		// The force-clicks above scrolled the economy row into view, which can
		// push the chamber's top above the viewport; a chamber point computed
		// from a bounding box up there clicks nothing. Scroll back first.
		await page.locator('#c').scrollIntoViewIfNeeded();
		const inspected = await page.locator('#mineral-cell').textContent();
		await chamberClick(page, 12, 14.5);
		assert.notEqual(await page.locator('#mineral-cell').textContent(), inspected, 'a rock click moves the inspector');
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
		await page.locator('#commune').click();
		assert.equal(await page.evaluate(() => SteamCeiling.state.commune), true);
		assert.equal(await page.locator('#credits').textContent(), 'commons');
		assert.equal(await page.locator('#refuel-cost').textContent(), 'free');
		assert.match(await page.locator('#equipment-rows .upgrade-row').first().locator('b').textContent(), /ROAD GRADER · FREE/);
		assert.equal(await page.locator('#research-rows .upgrade-row').last().locator('button').getAttribute('aria-disabled'), 'false', 'a gated node is open in the commons');
		await page.locator('#equipment-rows .upgrade-row', { hasText: 'BRAKE FLYWHEEL' }).locator('button').click({ force: true });
		assert.match(await page.locator('#equipment-status').textContent(), /^Installed Brake flywheel at /);
		assert.match(await page.locator('#ledger').locator('li').first().textContent(), /Bought Brake flywheel · free/);
		assert.equal(await page.evaluate(() => SteamCeiling.state.funds), 0, 'the commons charges nothing');
		await page.keyboard.press('KeyM');
		assert.equal(await page.evaluate(() => SteamCeiling.state.commune), false);
			assert.match(await page.locator('#equipment-rows .upgrade-row').first().locator('b').textContent(), /ROAD GRADER · 300 CR/);
			assert.equal(await page.locator('#credits').textContent(), '0.0 cr');
			// Test mode grants the whole tree and shop for free, persists as a mode
			// across New game, and leaves those grants in place when turned off.
			await page.locator('#test-mode').click();
			assert.equal(await page.locator('#research-progress').textContent(), nodeCount + ' / ' + nodeCount);
			assert.equal(await page.locator('#equipment-rows .upgrade-row[data-state="installed"]').count(), await page.evaluate(() => SteamEquipment.items.length));
			assert.match(await page.locator('#ledger li').first().textContent(), /Test installed /);
			await page.locator('#reset').click();
			assert.equal(await page.locator('#test-mode').isChecked(), true);
			assert.equal(await page.locator('#research-progress').textContent(), nodeCount + ' / ' + nodeCount);
			await page.locator('#test-mode').click();
			assert.equal(await page.locator('#research-progress').textContent(), nodeCount + ' / ' + nodeCount, 'test grants are not revoked by switching the mode off');
			await page.locator('#reset').click();
			assert.equal(await page.locator('#research-progress').textContent(), '0 / ' + nodeCount);
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
		await page.setViewportSize({ width: 390, height: 844 });
		await page.waitForTimeout(100);
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		assert.equal(await page.evaluate(() => ['.tech-panel', '.controls-panel', '.mineral-panel'].every(selector => document.querySelector(selector).getBoundingClientRect().height > 200)), true, 'stacked panels keep their content height');
		assert.deepEqual(errors, []);
		// Touch-only devices keep the view menu click-only.
		const touch = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true, isMobile: true });
		await touch.goto(process.env.TEST_URL || pathToFileURL(path.resolve(__dirname, '../index.html')).href);
		assert.equal(await touch.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches), false);
		await touch.locator('#view-modes label', { hasText: 'Price' }).hover();
		assert.equal(await touch.locator('#view-modes input[value="minerals"]').isChecked(), true, 'hover does not switch on touch');
		await touch.locator('#view-modes label', { hasText: 'Price' }).tap();
		assert.equal(await touch.locator('#view-modes input[value="price"]').isChecked(), true, 'tap switches on touch');
		console.log('PASS: startup, four-row layout, view-mode hover/click/arrow keys with paused redraw and touch gating, drive on by default and toggling (Space/Q without pressing GUI controls), piston tilt by slider, chamber wheel and an inverted open-air drag, keyboard force, pause/reset, shape selector, inspector click without sliders, rock-versus-low click zones, target travel, centre pad note, research/equipment gating, communism mode with free prices and waived gates, ledger, autopilot checkboxes with X/Z/C shortcuts and manual overrides, narrow layout; no page errors.');
	} finally {
		await browser.close();
	}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
