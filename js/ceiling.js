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
	const maxDebris = count;
	const storageLimit = 100;
	const cellMass = 0.6;
	const gravity = 9.81;
	const cargoHeight = 0.7;
	// Impact tuning: hit point receives 2x impact energy in strength removal,
	// falling linearly to zero across a 4.5-cell radius (1.5x of the base 3-cell radius).
	const damageRadius = 4.5;
	const damageMultiplier = 2;
	const damageRange = 5;
	const initialStrength = new Float32Array(count);
	const strength = new Float32Array(count);
	const elements = new Float32Array(count * 3);
	const minerals = new Float32Array(count * 3);
	const prices = new Float32Array(count);
	const firstRow = new Uint8Array(columns);
	const heightmap = new Float64Array(columns + 1);
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
	const debrisCells = new Uint16Array(maxDebris);
	const debrisValue = new Float64Array(maxDebris);
	const debrisMinerals = new Float64Array(maxDebris * 3);
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
	let rockShape = 'smooth';
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

	function updateHeightmap() {
		for (let c = 0; c < columns; c++) {
			let r = 0;
			while (r < rows && strength[r * columns + c] <= 0) r++;
			firstRow[c] = r;
		}
		for (let v = 0; v <= columns; v++) {
			const c0 = Math.max(0, Math.min(columns - 1, v - 2));
			const c1 = Math.max(0, Math.min(columns - 1, v - 1));
			const c2 = Math.max(0, Math.min(columns - 1, v));
			const c3 = Math.max(0, Math.min(columns - 1, v + 1));
			heightmap[v] = bottom + (firstRow[c0] + 3 * firstRow[c1] + 3 * firstRow[c2] + firstRow[c3]) * 0.125 * cell;
		}
	}

	function setShape(mode) {
		rockShape = mode === 'square' ? 'square' : 'smooth';
		return rockShape;
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
		debrisCells.fill(0);
		debrisValue.fill(0);
		debrisMinerals.fill(0);
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
		updateHeightmap();
	}

	function damageWeight(distance) {
		return Math.max(0, 1 - distance / damageRadius);
	}

	function damage(x, y, impactJ) {
		const centerColumn = Math.max(0, Math.min(columns - 1, Math.floor(x / cell)));
		let firstIntact = 0;
		while (firstIntact < rows && strength[firstIntact * columns + centerColumn] <= 0) firstIntact++;
		const rawRow = Math.max(0, Math.min(rows - 1, Math.floor((y - bottom) / cell)));
		const centerRow = firstIntact < rows ? Math.max(firstIntact, rawRow) : rawRow;
		const budget = impactJ * damageMultiplier;
		let removed = 0;
		for (let rowOffset = -damageRange; rowOffset <= damageRange; rowOffset++) for (let columnOffset = -damageRange; columnOffset <= damageRange; columnOffset++) {
			const row = centerRow + rowOffset;
			const column = centerColumn + columnOffset;
			const distance = Math.sqrt(columnOffset * columnOffset + rowOffset * rowOffset);
			if (row < 0 || row >= rows || column < 0 || column >= columns || distance > damageRadius) continue;
			const index = row * columns + column;
			if (strength[index] <= 0) continue;
			const amount = Math.min(strength[index], budget * damageWeight(distance));
			strength[index] -= amount;
			removed += amount / damageMultiplier;
			if (strength[index] > 0.0001) continue;
			removed += strength[index] / damageMultiplier;
			strength[index] = 0;
			spawn(index);
		}
		const minCol = Math.max(0, centerColumn - damageRange);
		const maxCol = Math.min(columns - 1, centerColumn + damageRange);
		for (let column = minCol; column <= maxCol; column++) {
			let highestBroken = -1;
			for (let row = rows - 1; row >= 0; row--) {
				if (strength[row * columns + column] <= 0) { highestBroken = row; break; }
			}
			for (let row = 0; row < highestBroken; row++) {
				const index = row * columns + column;
				if (strength[index] <= 0) continue;
				removed += strength[index] / damageMultiplier;
				strength[index] = 0;
				spawn(index);
			}
		}
		updateHeightmap();
		return Math.min(impactJ, removed);
	}

	function fragmentCells(i) {
		return debrisCells[i] || 1;
	}

	function fragmentValue(i) {
		return debrisCells[i] ? debrisValue[i] : prices[debrisCell[i]];
	}

	function fragmentMechanical(i) {
		const mass = fragmentCells(i) * cellMass;
		return mass * (0.5 * (debrisVx[i] * debrisVx[i] + debrisVy[i] * debrisVy[i]) + gravity * Math.max(0, debrisY[i]));
	}

	function spawn(index) {
		const offset = index * 3;
		const x = (index % columns + 0.5) * cell;
		const y = bottom + (Math.floor(index / columns) + 0.5) * cell;
		for (let i = 0; i < maxDebris; i++) {
			if (active[i]) continue;
			active[i] = 1;
			debrisCell[i] = index;
			debrisCells[i] = 1;
			debrisValue[i] = prices[index];
			const mOffset = i * 3;
			debrisMinerals[mOffset] = cellMass * minerals[offset];
			debrisMinerals[mOffset + 1] = cellMass * minerals[offset + 1];
			debrisMinerals[mOffset + 2] = cellMass * minerals[offset + 2];
			debrisX[i] = x;
			debrisY[i] = y;
			debrisVx[i] = 0;
			debrisVy[i] = 0;
			extractedCells++;
			return;
		}
		// If every slot was externally marked active, aggregate into the closest
		// active fragment so broken cells are never lost and all broken mass falls.
		let target = 0;
		let bestDist = Infinity;
		for (let i = 0; i < maxDebris; i++) {
			const dx = debrisX[i] - x;
			const dy = debrisY[i] - y;
			const d = dx * dx + dy * dy;
			if (d < bestDist) { bestDist = d; target = i; }
		}
		const prevCells = fragmentCells(target);
		if (!debrisCells[target]) {
			const baseIndex = debrisCell[target];
			const baseOffset = baseIndex * 3;
			const mOffset = target * 3;
			debrisCells[target] = 1;
			debrisValue[target] = prices[baseIndex];
			debrisMinerals[mOffset] = cellMass * minerals[baseOffset];
			debrisMinerals[mOffset + 1] = cellMass * minerals[baseOffset + 1];
			debrisMinerals[mOffset + 2] = cellMass * minerals[baseOffset + 2];
		}
		const beforeE = fragmentMechanical(target) + cellMass * gravity * y;
		const nextCells = prevCells + 1;
		debrisVx[target] = debrisVx[target] * (prevCells / nextCells);
		debrisVy[target] = debrisVy[target] * (prevCells / nextCells);
		debrisX[target] = (debrisX[target] * prevCells + x) / nextCells;
		debrisY[target] = (debrisY[target] * prevCells + y) / nextCells;
		debrisCells[target] = nextCells;
		debrisValue[target] += prices[index];
		const mOffset = target * 3;
		debrisMinerals[mOffset] += cellMass * minerals[offset];
		debrisMinerals[mOffset + 1] += cellMass * minerals[offset + 1];
		debrisMinerals[mOffset + 2] += cellMass * minerals[offset + 2];
		exportedEnergy += beforeE - fragmentMechanical(target);
		extractedCells++;
	}

	function traceSmooth(x, y, vx, vy, duration, radius) {
		updateHeightmap();
		const dx = vx * duration;
		const dy = vy * duration - 0.5 * gravity * duration * duration;
		const minColumn = Math.max(0, Math.floor((Math.min(x, x + dx) - radius) / cell));
		const maxColumn = Math.min(columns - 1, Math.floor((Math.max(x, x + dx) + radius) / cell));
		if (minColumn > maxColumn) return hit;
		let minH = top + 1;
		for (let c = minColumn; c <= maxColumn; c++) {
			const h = Math.min(heightmap[c], heightmap[c + 1]);
			if (h < minH) minH = h;
		}
		if (Math.max(y, y + dy) + radius < minH - 1e-4) return hit;
		let best = 2;
		for (let c = minColumn; c <= maxColumn; c++) {
			if (heightmap[c] >= top - 1e-9 && heightmap[c + 1] >= top - 1e-9) continue;
			const x0 = c * cell;
			const y0 = heightmap[c];
			const y1 = heightmap[c + 1];
			const sx = cell;
			const sy = y1 - y0;
			const len = Math.hypot(sx, sy);
			const nx = sy / len;
			const ny = -sx / len;
			const vn = dx * nx + dy * ny;
			if (vn >= -1e-12) continue;
			const dist0 = (x - x0) * nx + (y - y0) * ny;
			let s = -1;
			if (dist0 >= radius) {
				s = (radius - dist0) / vn;
			} else if (dist0 >= radius - 1e-4) {
				const cx0 = x - nx * dist0;
				const cy0 = y - ny * dist0;
				const proj0 = ((cx0 - x0) * sx + (cy0 - y0) * sy) / (len * len);
				if (proj0 >= -1e-6 && proj0 <= 1 + 1e-6) s = 0;
			}
			if (s < 0 || s > 1 || s >= best) continue;
			const hx = x + dx * s;
			const hy = y + dy * s;
			const cx = hx - nx * radius;
			const cy = hy - ny * radius;
			const proj = ((cx - x0) * sx + (cy - y0) * sy) / (len * len);
			if (proj < -1e-6 || proj > 1 + 1e-6) continue;
			best = s;
			hit.time = duration * s;
			hit.x = hx;
			hit.y = hy;
			hit.nx = nx;
			hit.ny = ny;
			const row = Math.min(rows - 1, firstRow[c]);
			hit.index = row * columns + c;
		}
		const a = dx * dx + dy * dy;
		if (a <= 1e-18) return hit;
		for (let v = minColumn; v <= maxColumn + 1; v++) {
			const leftCol = Math.max(0, v - 1);
			const rightCol = Math.min(columns - 1, v);
			if (firstRow[leftCol] >= rows && firstRow[rightCol] >= rows) continue;
			const vx0 = v * cell;
			const vy0 = heightmap[v];
			const ox = x - vx0;
			const oy = y - vy0;
			const b = 2 * (ox * dx + oy * dy);
			if (b >= -1e-12) continue;
			const cQuad = ox * ox + oy * oy - radius * radius;
			let s = -1;
			if (cQuad >= 0) {
				const disc = b * b - 4 * a * cQuad;
				if (disc >= 0) s = (-b - Math.sqrt(disc)) / (2 * a);
			} else if (cQuad >= -2 * radius * 1e-4) {
				s = 0;
			}
			if (s < 0 || s > 1 || s >= best) continue;
			const hx = x + dx * s;
			const hy = y + dy * s;
			const rx = hx - vx0;
			const ry = hy - vy0;
			const rlen = Math.hypot(rx, ry);
			if (rlen <= 1e-9 || ry > 1e-6) continue;
			best = s;
			hit.time = duration * s;
			hit.x = hx;
			hit.y = hy;
			hit.nx = rx / rlen;
			hit.ny = Math.min(0, ry / rlen);
			const nlen = Math.hypot(hit.nx, hit.ny);
			hit.nx /= nlen;
			hit.ny /= nlen;
			const col = firstRow[rightCol] < rows ? rightCol : leftCol;
			hit.index = Math.min(rows - 1, firstRow[col]) * columns + col;
		}
		return hit;
	}

	function testCorner(x, y, dx, dy, a, cx0, cy0, radius, index, best) {
		const ox = x - cx0;
		const oy = y - cy0;
		const b = 2 * (ox * dx + oy * dy);
		if (b >= -1e-12) return best;
		const cQuad = ox * ox + oy * oy - radius * radius;
		let s = -1;
		if (cQuad >= 0) {
			const disc = b * b - 4 * a * cQuad;
			if (disc >= 0) s = (-b - Math.sqrt(disc)) / (2 * a);
		} else if (cQuad >= -2 * radius * 1e-4) {
			s = 0;
		}
		if (s < 0 || s > 1 || s >= best) return best;
		const hx = x + dx * s;
		const hy = y + dy * s;
		const rx = hx - cx0;
		const ry = hy - cy0;
		const rlen = Math.hypot(rx, ry);
		if (rlen <= 1e-9) return best;
		hit.time = s;
		hit.x = hx;
		hit.y = hy;
		hit.nx = rx / rlen;
		hit.ny = ry / rlen;
		hit.index = index;
		return s;
	}

	function traceSquare(x, y, vx, vy, duration, radius) {
		const dx = vx * duration;
		const dy = vy * duration - 0.5 * gravity * duration * duration;
		const minColumn = Math.max(0, Math.floor((Math.min(x, x + dx) - radius) / cell));
		const maxColumn = Math.min(columns - 1, Math.floor((Math.max(x, x + dx) + radius) / cell));
		const minRow = Math.max(0, Math.floor((Math.min(y, y + dy) - radius - bottom) / cell));
		const maxRow = Math.min(rows - 1, Math.floor((Math.max(y, y + dy) + radius - bottom) / cell));
		if (minColumn > maxColumn || minRow > maxRow) return hit;
		let best = 2;
		const a = dx * dx + dy * dy;
		for (let row = minRow; row <= maxRow; row++) for (let column = minColumn; column <= maxColumn; column++) {
			const index = row * columns + column;
			if (strength[index] <= 0) continue;
			const x0 = column * cell;
			const x1 = x0 + cell;
			const y0 = bottom + row * cell;
			const y1 = y0 + cell;
			const expBottom = row === 0 || strength[index - columns] <= 0;
			const expTop = row < rows - 1 && strength[index + columns] <= 0;
			const expLeft = column > 0 && strength[index - 1] <= 0;
			const expRight = column < columns - 1 && strength[index + 1] <= 0;
			if (expBottom && dy > 1e-12) {
				const dist0 = y0 - y;
				const s = dist0 >= radius ? (dist0 - radius) / dy : (dist0 >= radius - 1e-4 && x >= x0 && x <= x1 ? 0 : -1);
				const hx = x + dx * s;
				if (s >= 0 && s <= 1 && s < best && hx >= x0 - 1e-7 && hx <= x1 + 1e-7) {
					best = s; hit.time = s; hit.x = hx; hit.y = y + dy * s; hit.nx = 0; hit.ny = -1; hit.index = index;
				}
			}
			if (expTop && dy < -1e-12) {
				const dist0 = y - y1;
				const s = dist0 >= radius ? (dist0 - radius) / -dy : (dist0 >= radius - 1e-4 && x >= x0 && x <= x1 ? 0 : -1);
				const hx = x + dx * s;
				if (s >= 0 && s <= 1 && s < best && hx >= x0 - 1e-7 && hx <= x1 + 1e-7) {
					best = s; hit.time = s; hit.x = hx; hit.y = y + dy * s; hit.nx = 0; hit.ny = 1; hit.index = index;
				}
			}
			if (expLeft && dx > 1e-12) {
				const dist0 = x0 - x;
				const s = dist0 >= radius ? (dist0 - radius) / dx : (dist0 >= radius - 1e-4 && y >= y0 && y <= y1 ? 0 : -1);
				const hy = y + dy * s;
				if (s >= 0 && s <= 1 && s < best && hy >= y0 - 1e-7 && hy <= y1 + 1e-7) {
					best = s; hit.time = s; hit.x = x + dx * s; hit.y = hy; hit.nx = -1; hit.ny = 0; hit.index = index;
				}
			}
			if (expRight && dx < -1e-12) {
				const dist0 = x - x1;
				const s = dist0 >= radius ? (dist0 - radius) / -dx : (dist0 >= radius - 1e-4 && y >= y0 && y <= y1 ? 0 : -1);
				const hy = y + dy * s;
				if (s >= 0 && s <= 1 && s < best && hy >= y0 - 1e-7 && hy <= y1 + 1e-7) {
					best = s; hit.time = s; hit.x = x + dx * s; hit.y = hy; hit.nx = 1; hit.ny = 0; hit.index = index;
				}
			}
			if (a <= 1e-18) continue;
			if (expBottom || expLeft) best = testCorner(x, y, dx, dy, a, x0, y0, radius, index, best);
			if (expBottom || expRight) best = testCorner(x, y, dx, dy, a, x1, y0, radius, index, best);
			if (expTop || expLeft) best = testCorner(x, y, dx, dy, a, x0, y1, radius, index, best);
			if (expTop || expRight) best = testCorner(x, y, dx, dy, a, x1, y1, radius, index, best);
		}
		if (best <= 1) hit.time = duration * best;
		return hit;
	}

	function trace(x, y, vx, vy, duration, radius) {
		hit.time = Infinity;
		hit.index = -1;
		return rockShape === 'square' ? traceSquare(x, y, vx, vy, duration, radius) : traceSmooth(x, y, vx, vy, duration, radius);
	}

	function catchFragment(world, i, carriedMass) {
		if (cargoCells >= storageLimit) return false;
		const totalCells = fragmentCells(i);
		const take = Math.min(totalCells, storageLimit - cargoCells);
		const ratio = take / totalCells;
		const caughtMass = take * cellMass;
		const before = 0.5 * carriedMass * world.platform.vx * world.platform.vx + 0.5 * caughtMass * (debrisVx[i] * debrisVx[i] + debrisVy[i] * debrisVy[i]);
		world.platform.vx = (carriedMass * world.platform.vx + caughtMass * debrisVx[i]) / (carriedMass + caughtMass);
		const after = 0.5 * (carriedMass + caughtMass) * world.platform.vx * world.platform.vx;
		world.heat += Math.max(0, before - after);
		const index = debrisCell[i];
		const offset = index * 3;
		const mOffset = i * 3;
		cargoCells += take;
		caughtCells += take;
		const val = fragmentValue(i) * ratio;
		cargoValue += val;
		for (let m = 0; m < 3; m++) {
			const minMass = (debrisCells[i] ? debrisMinerals[mOffset + m] : cellMass * minerals[offset + m]) * ratio;
			cargoMinerals[m] += minMass;
			if (debrisCells[i]) debrisMinerals[mOffset + m] -= minMass;
		}
		if (take < totalCells) {
			debrisCells[i] = totalCells - take;
			debrisValue[i] -= val;
			return false;
		}
		active[i] = 0;
		debrisCells[i] = 0;
		debrisValue[i] = 0;
		return true;
	}

	function fallTime(y, vy, height) {
		const discriminant = vy * vy + 2 * gravity * (y - height);
		if (discriminant < 0) return Infinity;
		const time = (vy + Math.sqrt(discriminant)) / gravity;
		return time >= 0 ? time : Infinity;
	}

	function step(world, dt, carriedMass) {
		for (let i = 0; i < maxDebris; i++) {
			if (!active[i]) continue;
			const oldX = debrisX[i];
			const oldY = debrisY[i];
			const oldVx = debrisVx[i];
			const oldVy = debrisVy[i];
			const deckTime = oldY >= cargoHeight ? fallTime(oldY, oldVy, cargoHeight) : Infinity;
			const deckX = oldX + oldVx * deckTime;
			const platformLeft = world.platform.x - 1.8;
			if (deckTime <= dt && deckX >= platformLeft && deckX <= platformLeft + 1.26 && cargoCells < storageLimit) {
				debrisX[i] = deckX;
				debrisY[i] = cargoHeight;
				debrisVx[i] = oldVx;
				debrisVy[i] = oldVy - gravity * deckTime;
				if (catchFragment(world, i, carriedMass + cargoCells * cellMass)) continue;
			}
			const floorTime = oldY >= 0 ? fallTime(oldY, oldVy, 0) : 0;
			if (floorTime <= dt) {
				debrisX[i] = oldX + oldVx * floorTime;
				debrisY[i] = 0;
				debrisVx[i] = oldVx;
				debrisVy[i] = oldVy - gravity * floorTime;
				world.heat += fragmentMechanical(i);
				lostCells += fragmentCells(i);
				lostValue += fragmentValue(i);
				active[i] = 0;
				debrisCells[i] = 0;
				debrisValue[i] = 0;
				continue;
			}
			debrisX[i] = oldX + oldVx * dt;
			debrisY[i] = oldY + oldVy * dt - 0.5 * gravity * dt * dt;
			debrisVx[i] = oldVx;
			debrisVy[i] = oldVy - gravity * dt;
			if (debrisX[i] >= 0 && debrisX[i] <= width) continue;
			world.heat += fragmentMechanical(i);
			lostCells += fragmentCells(i);
			lostValue += fragmentValue(i);
			active[i] = 0;
			debrisCells[i] = 0;
			debrisValue[i] = 0;
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
		for (let i = 0; i < maxDebris; i++) if (active[i]) total += fragmentCells(i);
		return total;
	}

	function airborneValue() {
		let total = 0;
		for (let i = 0; i < maxDebris; i++) if (active[i]) total += fragmentValue(i);
		return total;
	}

	function colorFor(index, mode) {
		if (mode === 'elements') return elementColors[index];
		if (mode === 'price') return priceColors[index];
		if (mode === 'strength') return strengthPalette[Math.round(strength[index] / initialStrength[index] * 100)];
		return mineralStyles[index];
	}

	function draw(context, mode) {
		if (rockShape === 'square') {
			for (let index = 0; index < count; index++) {
				if (strength[index] <= 0) continue;
				context.fillStyle = colorFor(index, mode);
				context.fillRect(index % columns * cell, bottom + Math.floor(index / columns) * cell, cell + 0.002, cell + 0.002);
			}
		} else {
			updateHeightmap();
			for (let c = 0; c < columns; c++) {
				const startRow = firstRow[c];
				if (startRow >= rows) continue;
				const x0 = c * cell;
				const x1 = x0 + cell + 0.002;
				const yL = heightmap[c];
				const yR = heightmap[c + 1];
				for (let row = startRow; row < rows; row++) {
					const index = row * columns + c;
					if (strength[index] <= 0) continue;
					const cellBottom = bottom + row * cell;
					const cellTop = cellBottom + cell + 0.002;
					const bL = row === startRow ? yL : Math.max(cellBottom, yL);
					const bR = row === startRow ? yR : Math.max(cellBottom, yR);
					if (bL >= cellTop && bR >= cellTop) continue;
					context.fillStyle = colorFor(index, mode);
					if (bL === cellBottom && bR === cellBottom) {
						context.fillRect(x0, cellBottom, cell + 0.002, cell + 0.002);
					} else {
						context.beginPath();
						context.moveTo(x0, bL);
						context.lineTo(x1, bR);
						context.lineTo(x1, Math.max(bR, cellTop));
						context.lineTo(x0, Math.max(bL, cellTop));
						context.closePath();
						context.fill();
					}
				}
			}
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
			shape: rockShape, heightmap, firstRow,
			mineralNames, mineralPrices,
			strength, initialStrength, elements, minerals, prices, active, debrisX, debrisY, debrisVx, debrisVy, debrisCell, debrisCells,
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

	const api = { reset, damage, trace, step, sellCargo, energy, draw, state, setShape, cargoMass: currentCargoMass };
	root.SteamCeiling = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
