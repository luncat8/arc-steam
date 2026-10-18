(function (root) {
	'use strict';
	const width = 24;
	const bottom = 8;
	const top = 10;
	const cell = 0.125;
	const defaultPixelSize = 4;
	const columns = Math.round(width / cell);
	const rows = Math.round((top - bottom) / cell);
	const count = columns * rows;
	const maxDebris = 384;
	const storageLimit = 100;
	const cellMass = 0.6;
	const gravity = 9.81;
	const cargoHeight = 0.7;
	// Impact tuning: each joule of impact loss removes 2 J of rock strength, spread
	// over a 4.5-cell radius with linear falloff to zero at the edge. Energy cost
	// booked to the ledger is strength removed divided by the multiplier, so the
	// energy balance stays exact while rock breaks faster and wider.
	const damageRadius = 4.5;
	const damageMultiplier = 2;
	const damageRange = 5;
	// Unbreakable left-wall deflector. Keep in sync with js/physics.js: the wedge
	// sits on the pocket top (deck height) and funnels falling bodies away from
	// the wall toward the reflector. Triangle (0,1.5) (0,0.7) (0.7,0.7).
	const wedgeX0 = 0;
	const wedgeY0 = 1.5;
	const wedgeX1 = 0.7;
	const wedgeY1 = 0.7;
	const wedgeDx = wedgeX1 - wedgeX0;
	const wedgeDy = wedgeY1 - wedgeY0;
	const wedgeLen = Math.sqrt(wedgeDx * wedgeDx + wedgeDy * wedgeDy);
	const wedgeNx = -wedgeDy / wedgeLen;
	const wedgeNy = wedgeDx / wedgeLen;
	const wedgeC = wedgeNx * wedgeX0 + wedgeNy * wedgeY0;
	const debrisRestitution = 0.4;
	const initialStrength = new Float32Array(count);
	const strength = new Float32Array(count);
	const elements = new Float32Array(count * 3);
	const minerals = new Float32Array(count * 3);
	const prices = new Float32Array(count);
	const elementColors = new Array(count);
	const mineralStyles = new Array(count);
	const priceColors = new Array(count);
	const strengthPalette = new Array(101);
	const active = new Uint8Array(maxDebris);
	const debrisX = new Float64Array(maxDebris);
	const debrisY = new Float64Array(maxDebris);
	const debrisVx = new Float64Array(maxDebris);
	const debrisVy = new Float64Array(maxDebris);
	const debrisCell = new Uint16Array(maxDebris);
	const hit = { time: Infinity, x: 0, y: 0, nx: 0, ny: 0, index: -1 };
	const mineralColors = [[184, 91, 64], [65, 174, 133], [133, 153, 202]];
	const mineralPrices = [3, 7, 11];
	const mineralNames = ['Iron', 'Copper', 'Crystal'];
	const cargoMinerals = new Float64Array(3);
	const soldMinerals = new Float64Array(3);
	for (let i = 0; i <= 100; i++) {
		const remaining = i / 100;
		strengthPalette[i] = 'rgb(' + Math.round(75 + remaining * 130) + ' ' + Math.round(45 + remaining * 125) + ' ' + Math.round(38 + remaining * 82) + ')';
	}
	let seed = 1;
	let extractedCells = 0;
	let caughtCells = 0;
	let lostCells = 0;
	let lostValue = 0;
	let cargoCells = 0;
	let cargoValue = 0;
	let soldCells = 0;
	let soldValue = 0;
	let funds = 0;
	let exportedEnergy = 0;
	let ledger = [];

	function hash(x, y, channel) {
		let value = Math.imul(x + seed * 101 + channel * 7919, 374761393) ^ Math.imul(y + 17, 668265263);
		value = Math.imul(value ^ value >>> 13, 1274126177);
		return ((value ^ value >>> 16) >>> 0) / 4294967295;
	}

	function smooth(t) { return t * t * (3 - 2 * t); }
	function noise(x, y, channel) {
		const ix = Math.floor(x);
		const iy = Math.floor(y);
		const fx = smooth(x - ix);
		const fy = smooth(y - iy);
		const a = hash(ix, iy, channel) + (hash(ix + 1, iy, channel) - hash(ix, iy, channel)) * fx;
		const b = hash(ix, iy + 1, channel) + (hash(ix + 1, iy + 1, channel) - hash(ix, iy + 1, channel)) * fx;
		return a + (b - a) * fy;
	}

	function reset(newSeed) {
		seed = newSeed || 1;
		extractedCells = 0;
		caughtCells = 0;
		lostCells = 0;
		lostValue = 0;
		cargoCells = 0;
		cargoValue = 0;
		soldCells = 0;
		soldValue = 0;
		funds = 0;
		exportedEnergy = 0;
		ledger = [];
		cargoMinerals[0] = cargoMinerals[1] = cargoMinerals[2] = 0;
		soldMinerals[0] = soldMinerals[1] = soldMinerals[2] = 0;
		active.fill(0);
		for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
			const index = row * columns + column;
			const x = column * 0.075;
			const y = row * 0.075;
			const red = 0.08 + noise(x, y, 0) * 0.92;
			const green = 0.08 + noise(x + 13.7, y + 5.1, 1) * 0.92;
			const blue = 0.08 + noise(x + 29.3, y + 11.9, 2) * 0.92;
			const elementTotal = red + green + blue;
			const offset = index * 3;
			elements[offset] = red / elementTotal;
			elements[offset + 1] = green / elementTotal;
			elements[offset + 2] = blue / elementTotal;
			const iron = elements[offset] * elements[offset] + elements[offset + 1] * 0.1;
			const copper = elements[offset + 1] * elements[offset + 1] + elements[offset + 2] * 0.12;
			const crystal = elements[offset + 2] * elements[offset + 2] + elements[offset] * 0.08;
			const mineralTotal = iron + copper + crystal;
			minerals[offset] = iron / mineralTotal;
			minerals[offset + 1] = copper / mineralTotal;
			minerals[offset + 2] = crystal / mineralTotal;
			prices[index] = minerals[offset] * mineralPrices[0] + minerals[offset + 1] * mineralPrices[1] + minerals[offset + 2] * mineralPrices[2];
			initialStrength[index] = 2.2 + minerals[offset] * 2.8 + minerals[offset + 1] * 1.7 + minerals[offset + 2] * 3.6;
			strength[index] = initialStrength[index];
			elementColors[index] = 'rgb(' + Math.round(elements[offset] * 255) + ' ' + Math.round(elements[offset + 1] * 255) + ' ' + Math.round(elements[offset + 2] * 255) + ')';
			const priceRatio = (prices[index] - mineralPrices[0]) / (mineralPrices[2] - mineralPrices[0]);
			priceColors[index] = 'rgb(' + Math.round(48 + priceRatio * 190) + ' ' + Math.round(72 + priceRatio * 150) + ' ' + Math.round(91 - priceRatio * 45) + ')';
			const mineralRed = minerals[offset] * mineralColors[0][0] + minerals[offset + 1] * mineralColors[1][0] + minerals[offset + 2] * mineralColors[2][0];
			const mineralGreen = minerals[offset] * mineralColors[0][1] + minerals[offset + 1] * mineralColors[1][1] + minerals[offset + 2] * mineralColors[2][1];
			const mineralBlue = minerals[offset] * mineralColors[0][2] + minerals[offset + 1] * mineralColors[1][2] + minerals[offset + 2] * mineralColors[2][2];
			mineralStyles[index] = 'rgb(' + Math.round(mineralRed) + ' ' + Math.round(mineralGreen) + ' ' + Math.round(mineralBlue) + ')';
		}
	}

	function damageWeight(distance) {
		return Math.max(0, 1 - distance / damageRadius);
	}

	function damage(x, y, impactJ) {
		const centerColumn = Math.max(0, Math.min(columns - 1, Math.floor(x / cell)));
		const centerRow = Math.max(0, Math.min(rows - 1, Math.floor((y - bottom) / cell)));
		let weightTotal = 0;
		for (let rowOffset = -damageRange; rowOffset <= damageRange; rowOffset++) for (let columnOffset = -damageRange; columnOffset <= damageRange; columnOffset++) {
			const distance = Math.sqrt(columnOffset * columnOffset + rowOffset * rowOffset);
			if (distance <= damageRadius) weightTotal += damageWeight(distance);
		}
		const budget = impactJ * damageMultiplier;
		let removed = 0;
		for (let rowOffset = -damageRange; rowOffset <= damageRange; rowOffset++) for (let columnOffset = -damageRange; columnOffset <= damageRange; columnOffset++) {
			const row = centerRow + rowOffset;
			const column = centerColumn + columnOffset;
			const distance = Math.sqrt(columnOffset * columnOffset + rowOffset * rowOffset);
			if (row < 0 || row >= rows || column < 0 || column >= columns || distance > damageRadius) continue;
			const index = row * columns + column;
			if (strength[index] <= 0) continue;
			const amount = Math.min(strength[index], budget * damageWeight(distance) / weightTotal);
			strength[index] -= amount;
			removed += amount / damageMultiplier;
			if (strength[index] > 0.0001) continue;
			strength[index] = 0;
			spawn(index);
		}
		return removed;
	}

	function spawn(index) {
		for (let i = 0; i < maxDebris; i++) {
			if (active[i]) continue;
			active[i] = 1;
			debrisCell[i] = index;
			debrisX[i] = (index % columns + 0.5) * cell;
			debrisY[i] = bottom + (Math.floor(index / columns) + 0.5) * cell;
			debrisVx[i] = 0;
			debrisVy[i] = 0;
			extractedCells++;
			return;
		}
		// A failed cell is extracted even when the fragment pool is full; its
		// mass is immediately lost and its potential exported for accounting.
		extractedCells++;
		lostCells++;
		lostValue += prices[index];
		exportedEnergy += cellMass * gravity * (bottom + (Math.floor(index / columns) + 0.5) * cell);
	}

	function rayBox(x, y, dx, dy, minX, minY, maxX, maxY, result) {
		let enter = 0;
		let exit = 1;
		let nx = 0;
		let ny = 0;
		if (Math.abs(dx) < 1e-12) {
			if (x <= minX || x >= maxX) return false;
		} else {
			let near = (minX - x) / dx;
			let far = (maxX - x) / dx;
			let normal = -1;
			if (near > far) { const swap = near; near = far; far = swap; normal = 1; }
			if (near > enter) { enter = near; nx = normal; ny = 0; }
			exit = Math.min(exit, far);
			if (enter > exit) return false;
		}
		if (Math.abs(dy) < 1e-12) {
			if (y <= minY || y >= maxY) return false;
		} else {
			let near = (minY - y) / dy;
			let far = (maxY - y) / dy;
			let normal = -1;
			if (near > far) { const swap = near; near = far; far = swap; normal = 1; }
			if (near > enter) { enter = near; nx = 0; ny = normal; }
			exit = Math.min(exit, far);
			if (enter > exit) return false;
		}
		if (enter < 1e-8 || enter > 1 || dx * nx + dy * ny >= 0) return false;
		result.enter = enter;
		result.nx = nx;
		result.ny = ny;
		return true;
	}

	const rayResult = { enter: 0, nx: 0, ny: 0 };
	function trace(x, y, vx, vy, duration, radius) {
		hit.time = Infinity;
		hit.index = -1;
		const dx = vx * duration;
		const dy = vy * duration - 0.5 * gravity * duration * duration;
		const minColumn = Math.max(0, Math.floor((Math.min(x, x + dx) - radius) / cell));
		const maxColumn = Math.min(columns - 1, Math.floor((Math.max(x, x + dx) + radius) / cell));
		const minRow = Math.max(0, Math.floor((Math.min(y, y + dy) - radius - bottom) / cell));
		const maxRow = Math.min(rows - 1, Math.floor((Math.max(y, y + dy) + radius - bottom) / cell));
		if (minColumn > maxColumn || minRow > maxRow) return hit;
		let best = 2;
		for (let row = minRow; row <= maxRow; row++) for (let column = minColumn; column <= maxColumn; column++) {
			const index = row * columns + column;
			if (strength[index] <= 0) continue;
			const minX = column * cell - radius;
			const minY = bottom + row * cell - radius;
			if (!rayBox(x, y, dx, dy, minX, minY, minX + cell + radius * 2, minY + cell + radius * 2, rayResult)) continue;
			if (rayResult.enter >= best) continue;
			best = rayResult.enter;
			hit.index = index;
			hit.time = duration * best;
			hit.x = x + dx * best;
			hit.y = y + dy * best;
			hit.nx = rayResult.nx;
			hit.ny = rayResult.ny;
		}
		return hit;
	}

	function fragmentMechanical(i) {
		return cellMass * (0.5 * (debrisVx[i] * debrisVx[i] + debrisVy[i] * debrisVy[i]) + gravity * Math.max(0, debrisY[i]));
	}

	function catchFragment(world, i, carriedMass) {
		if (cargoCells >= storageLimit) return false;
		const before = 0.5 * carriedMass * world.platform.vx * world.platform.vx + 0.5 * cellMass * (debrisVx[i] * debrisVx[i] + debrisVy[i] * debrisVy[i]);
		world.platform.vx = (carriedMass * world.platform.vx + cellMass * debrisVx[i]) / (carriedMass + cellMass);
		const after = 0.5 * (carriedMass + cellMass) * world.platform.vx * world.platform.vx;
		world.heat += Math.max(0, before - after);
		const index = debrisCell[i];
		const offset = index * 3;
		active[i] = 0;
		cargoCells++;
		caughtCells++;
		cargoValue += prices[index];
		for (let m = 0; m < 3; m++) cargoMinerals[m] += cellMass * minerals[offset + m];
		return true;
	}

	function fallTime(y, vy, height) {
		const discriminant = vy * vy + 2 * gravity * (y - height);
		if (discriminant < 0) return Infinity;
		const time = (vy + Math.sqrt(discriminant)) / gravity;
		return time >= 0 ? time : Infinity;
	}

	function wedgeDistance(x, y) {
		return wedgeNx * x + wedgeNy * y - wedgeC;
	}

	function reflectDebris(world, i, x, y, vx, vy) {
		const normalVelocity = vx * wedgeNx + vy * wedgeNy;
		if (normalVelocity >= 0) return { vx, vy };
		const before = 0.5 * cellMass * (vx * vx + vy * vy) + cellMass * gravity * Math.max(0, y);
		const impulse = (1 + debrisRestitution) * normalVelocity;
		vx -= impulse * wedgeNx;
		vy -= impulse * wedgeNy;
		const after = 0.5 * cellMass * (vx * vx + vy * vy) + cellMass * gravity * Math.max(0, y);
		world.heat += Math.max(0, before - after);
		return { vx, vy };
	}

	function step(world, dt, carriedMass) {
		for (let i = 0; i < maxDebris; i++) {
			if (!active[i]) continue;
			let oldX = debrisX[i];
			let oldY = debrisY[i];
			let oldVx = debrisVx[i];
			let oldVy = debrisVy[i];
			let timeLeft = dt;
			// Unbreakable wedge: fragments above the pocket top bounce off the
			// slope instead of falling through it. Debris is treated as a point.
			if (oldY >= wedgeY1 - 0.05 && oldX >= -0.05 && oldX <= wedgeX1 + 0.5) {
				const oldDistance = wedgeDistance(oldX, oldY);
				if (oldDistance < 0 && oldY >= wedgeY1 && oldX >= wedgeX0 && oldX <= wedgeX1) {
					// Penetrating after a fast step: project out to the slope.
					oldX += wedgeNx * -oldDistance;
					oldY += wedgeNy * -oldDistance;
					const reflected = reflectDebris(world, i, oldX, oldY, oldVx, oldVy);
					oldVx = reflected.vx;
					oldVy = reflected.vy;
				} else if (oldDistance >= 0) {
					const endX = oldX + oldVx * timeLeft;
					const endY = oldY + oldVy * timeLeft - 0.5 * gravity * timeLeft * timeLeft;
					const endDistance = wedgeDistance(endX, endY);
					if (endDistance < 0 && endY >= wedgeY1 - 0.02) {
						const hitTime = oldDistance / (oldDistance - endDistance) * timeLeft;
						const hitX = oldX + oldVx * hitTime;
						const hitY = oldY + oldVy * hitTime - 0.5 * gravity * hitTime * hitTime;
						if (hitX >= wedgeX0 - 1e-9 && hitX <= wedgeX1 + 1e-9 && hitY >= wedgeY1 - 1e-9) {
							const hitVy = oldVy - gravity * hitTime;
							const reflected = reflectDebris(world, i, hitX, hitY, oldVx, hitVy);
							oldX = hitX;
							oldY = hitY;
							oldVx = reflected.vx;
							oldVy = reflected.vy;
							timeLeft -= hitTime;
						}
					}
				}
			}
			const deckTime = oldY >= cargoHeight ? fallTime(oldY, oldVy, cargoHeight) : Infinity;
			const deckX = oldX + oldVx * deckTime;
			const platformLeft = world.platform.x - 1.8;
			if (deckTime <= timeLeft && deckX >= platformLeft && deckX <= platformLeft + 1.26 && cargoCells < storageLimit) {
				debrisX[i] = deckX;
				debrisY[i] = cargoHeight;
				debrisVx[i] = oldVx;
				debrisVy[i] = oldVy - gravity * deckTime;
				catchFragment(world, i, carriedMass + cargoCells * cellMass);
				continue;
			}
			const floorTime = oldY >= 0 ? fallTime(oldY, oldVy, 0) : 0;
			if (floorTime <= timeLeft) {
				debrisX[i] = oldX + oldVx * floorTime;
				debrisY[i] = 0;
				debrisVx[i] = oldVx;
				debrisVy[i] = oldVy - gravity * floorTime;
				world.heat += fragmentMechanical(i);
				active[i] = 0;
				lostCells++;
				lostValue += prices[debrisCell[i]];
				continue;
			}
			debrisX[i] = oldX + oldVx * timeLeft;
			debrisY[i] = oldY + oldVy * timeLeft - 0.5 * gravity * timeLeft * timeLeft;
			debrisVx[i] = oldVx;
			debrisVy[i] = oldVy - gravity * timeLeft;
			if (debrisX[i] >= 0 && debrisX[i] <= width) continue;
			world.heat += fragmentMechanical(i);
			active[i] = 0;
			lostCells++;
			lostValue += prices[debrisCell[i]];
		}
	}

	function sellCargo(platformVelocity, time) {
		if (!cargoCells) return 0;
		const value = cargoValue;
		exportedEnergy += cargoCells * cellMass * (gravity * cargoHeight + 0.5 * platformVelocity * platformVelocity);
		soldCells += cargoCells;
		soldValue += value;
		funds += value;
		const quantities = Object.freeze([cargoMinerals[0], cargoMinerals[1], cargoMinerals[2]]);
		for (let m = 0; m < 3; m++) {
			soldMinerals[m] += cargoMinerals[m];
			cargoMinerals[m] = 0;
		}
		ledger.push(Object.freeze({
			id: ledger.length + 1,
			type: 'sell',
			time: typeof time === 'number' ? time : 0,
			cells: cargoCells,
			mass: cargoCells * cellMass,
			credits: value,
			quantities
		}));
		cargoCells = 0;
		cargoValue = 0;
		return value;
	}

	function energy() {
		let value = exportedEnergy + cargoCells * cellMass * gravity * cargoHeight;
		for (let index = 0; index < count; index++) if (strength[index] > 0) value += cellMass * gravity * (bottom + (Math.floor(index / columns) + 0.5) * cell);
		for (let i = 0; i < maxDebris; i++) if (active[i]) value += fragmentMechanical(i);
		return value;
	}

	function airborneCells() {
		let total = 0;
		for (let i = 0; i < maxDebris; i++) if (active[i]) total++;
		return total;
	}

	function airborneValue() {
		let total = 0;
		for (let i = 0; i < maxDebris; i++) if (active[i]) total += prices[debrisCell[i]];
		return total;
	}

	function colorFor(index, mode) {
		if (mode === 'elements') return elementColors[index];
		if (mode === 'price') return priceColors[index];
		if (mode === 'strength') return strengthPalette[Math.round(strength[index] / initialStrength[index] * 100)];
		return mineralStyles[index];
	}

	function draw(context, mode) {
		for (let index = 0; index < count; index++) {
			if (strength[index] <= 0) continue;
			context.fillStyle = colorFor(index, mode);
			context.fillRect(index % columns * cell, bottom + Math.floor(index / columns) * cell, cell + 0.002, cell + 0.002);
		}
		for (let i = 0; i < maxDebris; i++) if (active[i]) {
			context.fillStyle = colorFor(debrisCell[i], mode);
			context.fillRect(debrisX[i] - cell * 0.38, debrisY[i] - cell * 0.38, cell * 0.76, cell * 0.76);
		}
	}

	function state() {
		return {
			columns, rows, cell, bottom, top, defaultPixelSize, storageLimit, cellMass,
			damageRadius, damageMultiplier,
			wedgeX0, wedgeY0, wedgeX1, wedgeY1, wedgeNx, wedgeNy,
			mineralNames, mineralPrices,
			strength, initialStrength, elements, minerals, prices, active, debrisX, debrisY, debrisVx, debrisVy, debrisCell,
			cargoMinerals, soldMinerals, ledger,
			extractedCells: () => extractedCells, caughtCells: () => caughtCells, lostCells: () => lostCells,
			lostValue: () => lostValue, airborneCells, airborneValue,
			caughtValue: () => cargoValue + soldValue,
			cargoCells: () => cargoCells, cargoMass: () => cargoCells * cellMass, cargoValue: () => cargoValue,
			soldCells: () => soldCells, soldValue: () => soldValue, funds: () => funds
		};
	}

	reset(1);
	function currentCargoMass() { return cargoCells * cellMass; }

	const api = { reset, damage, trace, step, sellCargo, energy, draw, state, cargoMass: currentCargoMass };
	root.SteamCeiling = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
