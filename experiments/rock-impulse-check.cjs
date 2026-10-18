'use strict';
// Rock-shape reflection impulse stress (run manually, kept out of node --test).
// 1) No amplification in any trace+reflect case (dense scan, both shapes).
// 2) At most one rock impulse per step: no stacked zero-time cascade flips.
//    Impulses are counted through SteamCeiling.damage calls (one per impact).
// 3) Shape switching cannot tunnel the ball through the rock; the ball keeps
//    its impulse (no speed gain, never inside the solid).
const assert = require('node:assert/strict');
const ceiling = require('../js/ceiling.js');
const physics = require('../js/physics.js');
const c = physics.config;

function speed(ball) { return Math.hypot(ball.vx, ball.vy); }

// --- 1: dense trace+reflect scan (both shapes, craters, overlaps) ---
{
	let checked = 0;
	let bad = 0;
	for (const shape of ['smooth', 'square']) {
		for (let seed = 1; seed <= 6; seed++) {
			ceiling.reset(seed);
			ceiling.setShape(shape);
			ceiling.damage(4.06, 8.06, 30);
			ceiling.damage(12.06, 8.06, 60);
			ceiling.damage(20.06, 8.06, 15);
			for (let gx = 0; gx < 240; gx++) {
				const x = gx * 0.1;
				for (let gy = 0; gy < 44; gy++) {
					const y = 6.6 + gy * 0.075;
					for (let a = 0; a < 360; a += 15) {
						const rad = a * Math.PI / 180;
						for (const v0 of [3, 8, 15, 25]) {
							const vx = Math.cos(rad) * v0;
							const vy = Math.sin(rad) * v0;
							const hit = ceiling.trace(x, y, vx, vy, 1 / 240, 0.18);
							if (!Number.isFinite(hit.time)) continue;
							checked++;
							const nlen = Math.hypot(hit.nx, hit.ny);
							const vn = vx * hit.nx + vy * hit.ny;
							let after = v0;
							if (vn < 0) {
								const e = Math.sqrt(0.9);
								const k = (1 + e) * vn;
								after = Math.hypot(vx - k * hit.nx, vy - k * hit.ny);
							}
							if (after > v0 + 1e-9 || Math.abs(nlen - 1) > 1e-9) bad++;
						}
					}
				}
			}
		}
	}
	console.log(`dense scan: ${checked} traces, ${bad} amplifications/nonunit normals`);
	assert.equal(bad, 0);
}

// --- 2: no stacked impulses in one step over aggressive gameplay ---
{
	const realDamage = ceiling.damage;
	let stepImpulses = 0;
	ceiling.damage = function (x, y, impactJ) {
		stepImpulses++;
		return realDamage(x, y, impactJ);
	};
	let rockImpulses = 0;
	let multiImpulseSteps = 0;
	let worstStepGain = 0;
	for (let trial = 0; trial < 240; trial++) {
		const shape = trial % 2 ? 'smooth' : 'square';
		const seed = 1 + (trial * 7) % 12;
		ceiling.reset(seed);
		ceiling.setShape(shape);
		const w = physics.createWorld();
		ceiling.reset(seed);
		ceiling.setShape(shape);
		w.drive = trial % 3 !== 0;
		for (let k = 0; k < 3; k++) ceiling.damage(3 + ((trial * 5 + k * 7) % 18), 8.06, 30 + (trial % 40));
		w.ball.x = 3 + (trial * 1.3) % 18;
		w.ball.y = 6.5 + (trial % 15) * 0.1;
		w.ball.vx = ((trial * 2.9) % 12) - 6;
		w.ball.vy = 4 + (trial % 12);
		w.ball.state = 'flying';
		w.platform.x = w.ball.x;
		for (let i = 0; i < 240 * 6 && w.ball.state === 'flying'; i++) {
			stepImpulses = 0;
			const spBefore = speed(w.ball);
			physics.step(w, c.step);
			const spAfter = speed(w.ball);
			// gravity, plus the deck pulse bound where a bounce can occur
			const allowed = spBefore + c.gravity * c.step + 8.5;
			if (spAfter > allowed + 1e-9) worstStepGain = Math.max(worstStepGain, spAfter - allowed);
			if (stepImpulses > 1) multiImpulseSteps++;
			rockImpulses += stepImpulses;
		}
	}
	ceiling.damage = realDamage;
	console.log(`cascade check: ${rockImpulses} rock impulses, ${multiImpulseSteps} steps with stacked impulses, worst unexplained gain ${worstStepGain.toExponential(2)} m/s`);
	assert.equal(multiImpulseSteps, 0);
	assert.ok(worstStepGain <= 0);
}

// --- 3: shape switch cannot tunnel; impulse kept ---
{
	for (const [from, to] of [['smooth', 'square'], ['square', 'smooth']]) {
		for (let seed = 1; seed <= 10; seed++) {
			ceiling.reset(seed);
			ceiling.setShape(from);
			ceiling.damage(10.06, 8.06, 40);
			ceiling.damage(10.56, 8.06, 25);
			const st = ceiling.state();
			const v = Math.floor(10.0 / st.cell);
			const w = physics.createWorld();
			ceiling.reset(seed);
			ceiling.setShape(from);
			ceiling.damage(10.06, 8.06, 40);
			ceiling.damage(10.56, 8.06, 25);
			const h = st.heightmap[v];
			w.ball.x = 10.0;
			w.ball.y = h - 0.18 - 1e-4;
			w.ball.vx = 1.5;
			w.ball.vy = 4;
			w.ball.state = 'flying';
			w.drive = false;
			ceiling.setShape(to);
			const v0 = speed(w.ball);
			let maxS = 0;
			for (let i = 0; i < 240 * 2 && w.ball.state === 'flying'; i++) {
				physics.step(w, c.step);
				maxS = Math.max(maxS, speed(w.ball));
				const st2 = ceiling.state();
				const vf = Math.max(0, Math.min(st2.columns - 1, Math.floor(w.ball.x / st2.cell)));
				if (to === 'smooth') {
					const vt = Math.max(0, Math.min(1, (w.ball.x - vf * st2.cell) / st2.cell));
					const hy = st2.heightmap[vf] + (st2.heightmap[vf + 1] - st2.heightmap[vf]) * vt;
					assert.ok(w.ball.y <= hy + 1e-9, `ball inside smooth rock: y=${w.ball.y} h=${hy} seed=${seed}`);
				} else {
					assert.ok(w.ball.y <= st2.bottom + st2.firstRow[vf] * st2.cell + 1e-9, `ball inside square rock: seed=${seed}`);
				}
			}
			assert.ok(maxS <= v0 + c.gravity * 2 + 1e-6, `speed gain on switch ${from}->${to} seed=${seed}: ${v0} -> ${maxS}`);
		}
	}
	console.log('shape-switch check: ball never tunnels and keeps its impulse');
}
console.log('ALL ROCK-REFLECTION IMPULSE CHECKS PASS');
