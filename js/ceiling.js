(function (root) {
	'use strict';
	const width = 24;
	const cell = 0.5;
	const columns = width / cell;
	const rows = 1;
	const count = columns * rows;
	const maxDebris = 96;
	const initialStrength = new Float32Array(count);
	const strength = new Float32Array(count);
	const composition = new Float32Array(count * 3);
	const active = new Uint8Array(maxDebris);
	const debrisX = new Float32Array(maxDebris);
	const debrisY = new Float32Array(maxDebris);
	const debrisVx = new Float32Array(maxDebris);
	const debrisVy = new Float32Array(maxDebris);
	const debrisMass = new Float32Array(maxDebris);
	const debrisValue = new Float32Array(maxDebris);
	const debrisEnergy = 0.12;
	let seed = 1;
	let extractedMass = 0;
	let caughtMass = 0;
	let lostMass = 0;
	let cargoValue = 0;

	function hash(n) {
		let x = (n + seed * 374761393) | 0;
		x = Math.imul(x ^ x >>> 13, 1274126177);
		return ((x ^ x >>> 16) >>> 0) / 4294967295;
	}

	function smoothNoise(x) {
		const i = Math.floor(x);
		const f = x - i;
		const a = hash(i);
		const b = hash(i + 1);
		const t = f * f * (3 - 2 * f);
		return a + (b - a) * t;
	}

	function reset(newSeed) {
		seed = newSeed || 1;
		extractedMass = 0;
		caughtMass = 0;
		lostMass = 0;
		cargoValue = 0;
		active.fill(0);
		for (let i = 0; i < count; i++) {
			const x = i * 0.31;
			const a = 0.15 + smoothNoise(x) * 0.7;
			const b = 0.1 + smoothNoise(x + 17.3) * 0.65;
			const c = 0.12 + smoothNoise(x + 39.1) * 0.6;
			const total = a + b + c;
			composition[i * 3] = a / total;
			composition[i * 3 + 1] = b / total;
			composition[i * 3 + 2] = c / total;
			initialStrength[i] = strength[i] = 7 + composition[i * 3] * 7 + composition[i * 3 + 1] * 4;
		}
	}

	function damage(x, impactJ) {
		const center = Math.max(0, Math.min(columns - 1, Math.floor(x / cell)));
		let available = impactJ;
		let removed = 0;
		for (let offset = -3; offset <= 3 && available > 0; offset++) {
			const index = center + offset;
			if (index < 0 || index >= count || strength[index] <= 0) continue;
			const falloff = 1 - Math.abs(offset) / 4;
			const amount = Math.min(strength[index], available * falloff);
			strength[index] -= amount;
			available -= amount;
			if (strength[index] <= 0.0001) {
				strength[index] = 0;
				spawn(index, x);
			}
			removed += amount;
		}
		return removed;
	}

	function spawn(index, impactX) {
		for (let i = 0; i < maxDebris; i++) {
			if (active[i]) continue;
			active[i] = 1;
			debrisX[i] = (index + 0.5) * cell;
			debrisY[i] = 9.75;
			debrisVx[i] = (debrisX[i] - impactX) * 0.25;
			debrisVy[i] = -0.4;
			debrisMass[i] = 1;
			const offset = index * 3;
			debrisValue[i] = 2 + composition[offset] * 3 + composition[offset + 1] * 5 + composition[offset + 2] * 2;
			extractedMass += debrisMass[i];
			return;
		}
		lostMass++;
	}

	function step(world, dt) {
		for (let i = 0; i < maxDebris; i++) {
			if (!active[i]) continue;
			const oldY = debrisY[i];
			debrisX[i] += debrisVx[i] * dt;
			debrisY[i] += debrisVy[i] * dt - 0.5 * 9.81 * dt * dt;
			debrisVy[i] -= 9.81 * dt;
			if (debrisX[i] < 0 || debrisX[i] > width) { active[i] = 0; lostMass += debrisMass[i]; continue; }
			if (oldY >= 0.7 && debrisY[i] <= 0.7 && Math.abs(debrisX[i] - world.platform.x) <= 1.8 && debrisX[i] < world.platform.x - 1.8 + 1.26) {
				active[i] = 0;
				caughtMass += debrisMass[i];
				cargoValue += debrisValue[i];
				continue;
			}
			if (debrisY[i] <= 0.08) { active[i] = 0; lostMass += debrisMass[i]; }
		}
	}

	function draw(context, scale) {
		for (let i = 0; i < count; i++) {
			const remaining = strength[i] / initialStrength[i];
			if (remaining >= 1) continue;
			context.fillStyle = remaining > 0 ? '#9b7546' : '#0d1417';
			context.fillRect(i * cell, 9.68, cell, 0.32);
		}
		context.fillStyle = '#d7aa69';
		for (let i = 0; i < maxDebris; i++) if (active[i]) {
			context.beginPath(); context.arc(debrisX[i], debrisY[i], 0.09, 0, Math.PI * 2); context.fill();
		}
	}

	function state() { return { columns, cell, strength, initialStrength, composition, maxDebris, active, debrisX, debrisY, extractedMass: () => extractedMass, caughtMass: () => caughtMass, lostMass: () => lostMass, cargoValue: () => cargoValue }; }
	reset(1);
	const api = { reset, damage, step, draw, state, debrisEnergy };
	root.SteamCeiling = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
