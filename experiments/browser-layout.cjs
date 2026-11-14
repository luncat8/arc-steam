'use strict';
// Optional browser tooling is supplied externally; the application has no dependencies.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

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
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.goto(process.env.TEST_URL || pathToFileURL(path.resolve(__dirname, '../index.html')).href);
		await page.locator('#pause').click();
		let wideCanvas = null;
		let wideCargo = 0;
		for (const [width, height] of [[1920, 1080], [2560, 1440], [3440, 1440], [5120, 1440], [2560, 800], [1440, 1000], [1024, 768], [761, 700], [760, 844], [390, 844], [320, 640]]) {
			await page.setViewportSize({ width, height });
			await page.waitForFunction(() => {
				const canvas = document.getElementById('c');
				const box = canvas.getBoundingClientRect();
				return canvas.width === Math.round(box.width * devicePixelRatio)
					&& canvas.height === Math.round(box.height * devicePixelRatio);
			});
			const layout = await page.evaluate(() => {
				const box = selector => document.querySelector(selector).getBoundingClientRect();
				const cargo = box('.cargo-panel');
				const canvas = box('#c');
				const controls = box('.controls-panel');
				const players = box('.scoreboard');
				const table = document.querySelector('.cargo-panel .table-wrap');
				return {
					pageWidth: document.documentElement.scrollWidth,
					mainWidth: box('main').width,
					cargoWidth: cargo.width,
					canvasWidth: canvas.width, canvasHeight: canvas.height,
					tableFits: table.scrollWidth <= table.clientWidth + 1,
					desktop: cargo.right < canvas.left && canvas.right < controls.left,
					playersAboveCargo: players.bottom <= cargo.top + 1 && Math.abs(players.left - cargo.left) < 1,
					playersLeft: players.right < canvas.left,
					stacked: canvas.bottom < controls.top && controls.bottom < cargo.top
				};
			});
			assert.ok(layout.pageWidth <= width, `${width}: no page-level horizontal scroll`);
			assert.equal(layout.mainWidth, width, `${width}: the page uses the full viewport`);
			assert.ok(layout.playersAboveCargo, `${width}: players sit directly above cargo`);
			if (width >= 761) assert.ok(layout.playersLeft, `${width}: players share the left column, not the full width`);
			if (width >= 1280) {
				assert.ok(layout.desktop, `${width}: cargo, chamber, controls remain in order`);
				assert.ok(layout.canvasWidth <= 1280.1, `${width}: canvas width is capped`);
				assert.ok(layout.canvasHeight <= Math.min(1280 / 1.71, height * 0.74) + 1, `${width}: canvas height is capped`);
				assert.ok(Math.abs(layout.canvasWidth / layout.canvasHeight - 1.71) < 0.01, `${width}: the chamber keeps its aspect ratio`);
			}
			if (width >= 1920) assert.ok(layout.tableFits, `${width}: cargo table needs no horizontal scrolling`);
			if (height === 1440) {
				const size = [layout.canvasWidth, layout.canvasHeight];
				if (wideCanvas) assert.deepEqual(size, wideCanvas, 'wider screens grow cargo, not the canvas');
				assert.ok(layout.cargoWidth > wideCargo, 'cargo receives the extra width');
				wideCanvas = size;
				wideCargo = layout.cargoWidth;
			}
			if (width <= 760) {
				assert.ok(layout.stacked, `${width}: mobile panels stack`);
				assert.equal(layout.canvasHeight, 320, `${width}: mobile canvas keeps its height`);
			}
			console.log(`${width}x${height}: canvas ${layout.canvasWidth.toFixed(1)}x${layout.canvasHeight.toFixed(1)}, cargo ${layout.cargoWidth.toFixed(1)}, table fits ${layout.tableFits}`);
		}
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.locator('#science-open').click();
		const ramp = page.locator('[data-item="ramp"]');
		const action = ramp.locator('.row-actions > button:not(.preview-mark)');
		const funds = await page.evaluate(() => SteamCeiling.state.funds);
		assert.match(await ramp.locator('b').textContent(), /RAMP · FREE/);
		assert.equal(await action.textContent(), 'Uninstall · free');
		assert.equal(await action.getAttribute('aria-disabled'), 'false');
		assert.equal(await action.getAttribute('aria-pressed'), 'true');
		await action.click();
		assert.equal(await action.textContent(), 'Install · free');
		assert.equal(await page.evaluate(() => SteamPlayers.state.rampsEnabled), false);
		assert.match(await ramp.locator('small').textContent(), /Removed · all platforms push/);
		await page.locator('#science-close').click();
		await page.locator('.player-select').nth(1).click();
		await page.locator('#science-open').click();
		assert.equal(await action.textContent(), 'Uninstall · free');
		assert.match(await ramp.locator('small').textContent(), /Installed but inactive/);
		await action.click();
		assert.equal(await page.evaluate(() => SteamEquipment.isInstalled('ramp', 'rival-1')), false);
		assert.equal(await page.locator('.player-bot input').nth(1).isChecked(), true, 'editing a ramp leaves the bot switch alone');
		await action.click();
		assert.equal(await page.evaluate(() => SteamPlayers.state.rampsEnabled), false, 'the rig still has no ramp');
		await page.locator('#science-close').click();
		await page.locator('.player-select').first().click();
		await page.locator('#science-open').click();
		await action.click();
		assert.equal(await page.evaluate(() => SteamPlayers.state.rampsEnabled), true);
		assert.equal(await page.evaluate(() => SteamCeiling.state.funds), funds);
		assert.match(await ramp.locator('small').textContent(), /All ramps installed/);
		for (const [width, height] of [[1440, 1000], [1024, 768], [761, 700], [390, 844]]) {
			await page.setViewportSize({ width, height });
			await action.scrollIntoViewIfNeeded();
			assert.ok(await page.evaluate(() => {
				const content = document.querySelector('#science-drawer .tool-drawer-content');
				const rows = document.querySelectorAll('.tree-root-bays > .upgrade-row');
				const root = document.querySelector('.tree-root').getBoundingClientRect();
				const nodes = document.querySelectorAll('#progression-tree .tree-node');
				return content.scrollWidth <= content.clientWidth + 1 && Array.from(rows).every(row => row.scrollWidth <= row.clientWidth + 1)
					&& Array.from(nodes).every(node => node.getBoundingClientRect().top >= root.bottom);
			}), `${width}: all four base-chassis bays fit without horizontal clipping`);
			assert.ok(await action.isVisible(), `${width}: the free ramp toggle is reachable`);
		}
		await action.click();
		assert.equal(await page.evaluate(() => SteamPlayers.state.rampsEnabled), false, 'the mobile toggle also removes ramps');
		await action.click();
		assert.equal(await page.evaluate(() => SteamPlayers.state.rampsEnabled), true);
		assert.deepEqual(errors, []);
		console.log('PASS: full-width workspace, fixed canvas, flexible cargo, responsive layout and free per-player ramp shop toggles.');
	} finally {
		await browser.close();
	}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
