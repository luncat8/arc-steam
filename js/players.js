(function (root) {
	'use strict';
	// Players own the platforms in the chamber. Every player drives the same
	// machine — the same chassis, wheels, deck and retractable 45° tails — so the
	// rig and its competitors differ in colour, purse and policy only. Player 0
	// is the mining rig and keeps the reserve, ball, cargo and shop; every other
	// player works the floor rubble with a blade and banks its own credits.
	//
	// Two platforms that meet ride rather than collide: the platform applying
	// more drive power is the one lifted, and the other is carved out of its
	// ground query one way only, so no pair can lift itself. The tails unfold as
	// the gap closes and fold again when it opens, so a climbing wheel always
	// meets a 45° plate instead of a wall.
	const bodyBottom = 0.2;
	const bodyTop = 0.6;
	const tailAngle = Math.PI / 4;
	const tailPlate = bodyTop / Math.cos(tailAngle);
	const tailSlew = Math.PI / 2;
	const tailReach = 2.6;
	const tailFullGap = 0.6;
	const bladeSwath = 1.6;
	const bladeCut = 0.05;
	const loadLimitDefault = 100;
	// A hand command silences the platform's own policy for the same two seconds
	// the autopilot uses, so taking the wheel never fights the bot.
	const manualSeconds = 2;
	// The competitor is the rig's platform in a dimmer colour.
	const rivalBodies = [
		{ body: '#4a443c', tail: '#37332d', deck: '#5c554b' },
		{ body: '#45404a', tail: '#332f37', deck: '#57505d' }
	];
	const startSlots = [19, 5, 22, 2];
	const players = [];
	const rivals = [];
	const harvest = { value: 0, cells: 0 };
	const drawOrder = [];
	let rigWorld = null;
	let active = 0;
	let selling = false;

	function halfWidth() {
		return (root.SteamPhysics ? root.SteamPhysics.config.platformWidth : 3.6) * 0.5;
	}

	function terrainHeight(x) {
		return root.SteamCeiling ? root.SteamCeiling.floorAt(x) : 0;
	}

	function playerById(id) {
		for (let i = 0; i < players.length; i++) if (players[i].id === id) return players[i];
		return null;
	}

	// The rig's body is the live world platform; a competitor owns its own body.
	function posOf(player) {
		return player.kind === 'rig' && rigWorld ? rigWorld.platform : player;
	}

	function forceOf(player) {
		if (player.kind === 'rig' && rigWorld) return rigWorld.forceSetting;
		return player.force;
	}

	// Drive power is the force setting while the platform is commanding a move.
	// A coasting or braking platform applies none, so a driven competitor climbs
	// a parked rig and a raised slider climbs a driven competitor.
	function powerOf(player) {
		if (!Number.isFinite(posOf(player).x)) return 0;
		if (player.kind === 'rig') {
			if (!rigWorld || rigWorld.brake) return 0;
			const pushing = rigWorld.direction !== 0 || Number.isFinite(rigWorld.target);
			return pushing ? forceOf(player) : 0;
		}
		if (player.braking) return 0;
		const pushing = player.direction !== 0 || Number.isFinite(player.target) || (player.bot && player.manual <= 0);
		return pushing ? forceOf(player) : 0;
	}

	// Strict layering. Equal power keeps the lower index on top, so an undecided
	// pair never swaps every step.
	function above(a, b) {
		const pa = powerOf(a);
		const pb = powerOf(b);
		if (Math.abs(pa - pb) > 1e-6) return pa > pb;
		return a.index < b.index;
	}

	// Height of a platform body above its own base at horizontal offset dx. The
	// plate leaves the deck edge down-and-out at 45° when deployed and slides up
	// the end face as it folds, so the collision profile and the drawing stay one
	// shape and a folded tail presents a plain vertical face.
	function profileAt(player, dx) {
		const distance = Math.abs(dx);
		if (distance <= halfWidth()) return bodyTop;
		const angle = dx < 0 ? player.tailLeft : player.tailRight;
		if (angle <= 1e-4) return 0;
		if (distance >= halfWidth() + tailPlate * Math.sin(angle)) return 0;
		const height = bodyTop - (distance - halfWidth()) / Math.tan(angle);
		return height > 0 ? height : 0;
	}

	// Highest body under x that the asking platform rides on. A platform only
	// sees the platforms it outranks, so the one with more drive power climbs the
	// other and the looser stays on the floor instead of being lifted by a body
	// above it. An unscoped query is the rig's own view of the ground — the
	// autopilot and the prediction ask without an id — so a platform never
	// stands on itself.
	function surfaceAt(x, exceptId) {
		const self = playerById(exceptId === undefined ? 'rig' : exceptId);
		let height = 0;
		for (let i = 0; i < players.length; i++) {
			const player = players[i];
			if (player === self) continue;
			if (self && !above(self, player)) continue;
			const body = posOf(player);
			if (!Number.isFinite(body.y)) continue;
			const dx = x - body.x;
			if (Math.abs(dx) >= halfWidth() + tailPlate) continue;
			const top = body.y + profileAt(player, dx);
			if (top > height) height = top;
		}
		return height;
	}

	function settle(rival) {
		const physics = root.SteamPhysics;
		if (!physics) return;
		rival.angle = physics.platformPitchAt(rival.x, rival.id);
		rival.y = physics.platformBaseAt(rival.x, rival.angle, rival.id);
	}

	function createRig() {
		return {
			index: 0, id: 'rig', name: 'YOU', colour: '#7fb6d9', kind: 'rig', bot: false,
			force: 0.6, target: NaN, braking: false, direction: 0, manual: 0,
			cargoCells: 0, cargoValue: 0, money: 0, soldValue: 0,
			tailLeft: 0, tailRight: 0,
			body: '#35454b', tail: '#2c3a3f', deck: '#4a5c62'
		};
	}

	function createRival(index) {
		const colours = rivalBodies[index % rivalBodies.length];
		const rival = {
			index: index + 1, id: 'rival-' + (index + 1), name: 'RIVAL ' + (index + 1),
			colour: index % 2 ? '#8f86c9' : '#c98c5a', kind: 'rival', bot: true,
			force: 0.6, x: startSlots[index % startSlots.length], y: 0, angle: 0, vx: 0, spin: 0,
			direction: 0, botDirection: -1, target: NaN, braking: false, manual: 0,
			cargoCells: 0, cargoValue: 0, money: 0, soldValue: 0,
			tailLeft: 0, tailRight: 0,
			body: colours.body, tail: colours.tail, deck: colours.deck
		};
		settle(rival);
		return rival;
	}

	// A new game rebuilds the roster: the rig is handed the new world and every
	// competitor returns to its start slot with an empty load and purse.
	function init(world, count) {
		rigWorld = world;
		const rivalCount = count === undefined ? 1 : Math.max(0, Math.min(startSlots.length, count));
		players.length = 0;
		rivals.length = 0;
		const rig = createRig();
		if (world && Number.isFinite(world.forceSetting)) rig.force = world.forceSetting;
		players.push(rig);
		for (let i = 0; i < rivalCount; i++) {
			const rival = createRival(i);
			players.push(rival);
			rivals.push(rival);
		}
		active = 0;
		selling = false;
		return players;
	}

	function money(index) {
		const player = players[index];
		if (!player) return 0;
		if (player.kind === 'rig') return root.SteamCeiling ? root.SteamCeiling.state.funds : 0;
		return player.money;
	}

	function load(index) {
		const player = players[index];
		if (!player) return 0;
		if (player.kind === 'rig') return root.SteamCeiling ? root.SteamCeiling.state.cargoCells : 0;
		return player.cargoCells;
	}

	function force(index) {
		const player = players[index];
		return player ? forceOf(player) : 0;
	}

	function activeSpeed() {
		const player = players[active];
		if (!player) return 0;
		if (player.kind === 'rig') return rigWorld ? rigWorld.platform.vx : 0;
		return player.vx;
	}

	function activeTarget() {
		const player = players[active];
		if (!player || player.kind === 'rig') return rigWorld ? rigWorld.target : NaN;
		return player.target;
	}

	function rigActive() {
		return active === 0;
	}

	function setActive(index) {
		if (index < 0 || index >= players.length || index === active) return false;
		active = index;
		const player = players[active];
		if (player.kind === 'rival') player.manual = 0;
		return true;
	}

	// The rig's BOT flag is the autopilot's three operational duties; the drive
	// and tilt keepers are part of the policy, so a bot rig is a full rig.
	function setBot(index, on) {
		const player = players[index];
		if (!player) return false;
		const value = Boolean(on);
		player.bot = value;
		if (player.kind === 'rig') {
			const autopilot = root.SteamAutopilot;
			if (!autopilot) return value;
			autopilot.set('move', value);
			autopilot.set('drive', value);
			autopilot.set('angle', value);
			if (!value) {
				selling = false;
				autopilot.reset();
			}
			return value;
		}
		player.manual = 0;
		player.target = NaN;
		player.direction = 0;
		player.braking = false;
		return value;
	}

	// Read back the autopilot so the rig's BOT box follows its real duties even
	// when they are switched from the controls panel or a shortcut.
	function syncRigBot() {
		const rig = players[0];
		if (!rig || !root.SteamAutopilot) return rig ? rig.bot : false;
		const autopilot = root.SteamAutopilot;
		rig.bot = autopilot.state.move && autopilot.state.drive && autopilot.state.angle;
		if (!rig.bot) selling = false;
		return rig.bot;
	}

	function command(direction) {
		const player = players[active];
		if (!player || player.kind !== 'rival') return false;
		player.manual = manualSeconds;
		player.braking = false;
		player.direction = Math.sign(direction) || 0;
		if (player.direction) player.target = NaN;
		return true;
	}

	function commandTarget(x) {
		const player = players[active];
		if (!player || player.kind !== 'rival' || !Number.isFinite(x)) return false;
		const physics = root.SteamPhysics;
		const limit = physics ? physics.config.width : 24;
		const min = physics ? physics.platformMin() : 0;
		const max = physics ? physics.platformMax() : limit;
		player.manual = manualSeconds;
		player.braking = false;
		player.direction = 0;
		player.target = Math.max(min, Math.min(max, x));
		return true;
	}

	function commandBrake(on) {
		const player = players[active];
		if (!player || player.kind !== 'rival') return false;
		player.manual = manualSeconds;
		player.braking = Boolean(on);
		player.direction = 0;
		return true;
	}

	function clearCommand() {
		const player = players[active];
		if (!player || player.kind !== 'rival') return false;
		player.manual = manualSeconds;
		player.direction = 0;
		player.braking = false;
		player.target = NaN;
		return true;
	}

	// The force setting is per player, so the slider and W/S edit the platform
	// being driven instead of the rig behind it.
	function setForce(value) {
		const forceValue = Math.max(0.1, Math.min(1, value));
		const player = players[active];
		if (!player) return forceValue;
		player.force = forceValue;
		if (player.kind === 'rig' && rigWorld) rigWorld.forceSetting = forceValue;
		return forceValue;
	}

	function grade(rival, dt) {
		const ceiling = root.SteamCeiling;
		if (!ceiling || !ceiling.harvest) return;
		const limit = ceiling.state.storageLimit || loadLimitDefault;
		const capacity = limit - rival.cargoCells;
		if (capacity <= 0) return;
		harvest.value = 0;
		harvest.cells = 0;
		ceiling.harvest(rival.x, bladeSwath * 0.5, bladeCut * dt, capacity, harvest);
		if (harvest.cells <= 0) return;
		rival.cargoCells += harvest.cells;
		rival.cargoValue += harvest.value;
	}

	// A wall settles the load into this competitor's purse. Nothing is shared:
	// the competitor keeps its whole takings, unlike the grader service's share.
	function sell(rival) {
		if (rival.cargoCells <= 0 && rival.cargoValue <= 0) return 0;
		const value = rival.cargoValue;
		rival.money += value;
		rival.soldValue += value;
		rival.cargoCells = 0;
		rival.cargoValue = 0;
		return value;
	}

	function steerWanted(rival, speedLimit, brakeAcceleration) {
		// A held key or brake outranks the policy, however long it is held; the
		// two-second manual window only decides when the bot may take over again.
		if (rival.braking) return 0;
		if (rival.direction) return rival.direction * speedLimit;
		if (rival.bot && rival.manual <= 0) {
			if (!rival.botDirection) rival.botDirection = 1;
			return rival.botDirection * speedLimit;
		}
		if (!Number.isFinite(rival.target)) return 0;
		const distance = rival.target - rival.x;
		if (Math.abs(distance) < 0.05 && Math.abs(rival.vx) < 0.1) {
			rival.target = NaN;
			return 0;
		}
		// Never arrive faster than the remaining distance can brake from.
		const approach = Math.sqrt(2 * brakeAcceleration * Math.abs(distance));
		return Math.sign(distance) * Math.min(speedLimit, approach);
	}

	// A competitor drives the same engine as the rig: force per mass, speed per
	// force setting, and the same wheel bounds.
	function engineAcceleration(forceValue) {
		const physics = root.SteamPhysics;
		if (!physics) return 8 * forceValue;
		return physics.config.force / physics.config.platformMass * forceValue;
	}

	function engineSpeed(forceValue) {
		const physics = root.SteamPhysics;
		if (!physics) return 12 * forceValue;
		return physics.config.maxSpeed * forceValue;
	}

	function stepRival(rival, dt) {
		const physics = root.SteamPhysics;
		if (!physics) return;
		if (rival.manual > 0) rival.manual = Math.max(0, rival.manual - dt);
		const power = Math.max(0.1, rival.force);
		const acceleration = engineAcceleration(power);
		const limit = engineSpeed(power);
		const previousX = rival.x;
		const wanted = steerWanted(rival, limit, acceleration * 1.5);
		const delta = wanted - rival.vx;
		if (delta !== 0) {
			const speedingUp = wanted !== 0 && Math.abs(wanted) > Math.abs(rival.vx) && wanted * rival.vx >= 0;
			const rate = (speedingUp ? acceleration : acceleration * 1.5) * dt;
			rival.vx += Math.max(-rate, Math.min(rate, delta));
		}
		if (Math.abs(rival.vx) < 1e-4) rival.vx = 0;
		rival.x += rival.vx * dt;
		const minX = physics.platformMin();
		const maxX = physics.platformMax();
		if (rival.x < minX) { rival.x = minX; rival.vx = 0; }
		if (rival.x > maxX) { rival.x = maxX; rival.vx = 0; }
		rival.spin += (rival.x - previousX) / physics.config.platformWheelRadius;
		settle(rival);
		if (Math.abs(rival.vx) > 0.05) grade(rival, dt);
		const atWall = rival.x <= minX + 1e-3 || rival.x >= maxX - 1e-3;
		if (atWall && rival.cargoCells > 0) sell(rival);
		// The bot turns around at each wall and works the opposite direction.
		if (atWall && rival.bot && rival.manual <= 0) {
			rival.botDirection = rival.x <= minX + 1e-3 ? 1 : -1;
			rival.target = NaN;
		}
	}

	// Deployment follows the gap to the nearest platform on that side: folded at
	// the reach, fully down at the full gap and continuous in between. The slew
	// limit is what makes it a mechanism: the plate swings at 90°/s and never
	// snaps, so a fold or an unfold is visible as motion.
	function deployFor(gap) {
		if (gap <= tailFullGap) return 1;
		if (gap >= tailReach) return 0;
		return (tailReach - gap) / (tailReach - tailFullGap);
	}

	function stepTails(player, dt) {
		const body = posOf(player);
		if (!Number.isFinite(body.x)) return;
		const half = halfWidth();
		let left = 0;
		let right = 0;
		for (let i = 0; i < players.length; i++) {
			const other = players[i];
			if (other === player) continue;
			const target = posOf(other);
			if (!Number.isFinite(target.x)) continue;
			// A plate only answers a platform on its own side of the body: the
			// gap is measured edge to edge, and only a closing gap is a reason
			// to unfold. A platform moving away folds back.
			if (target.x >= body.x) {
				const gap = target.x - half - (body.x + half);
				if (gap < tailReach && target.vx - body.vx < -0.02) right = Math.max(right, deployFor(gap));
			} else {
				const gap = body.x - half - (target.x + half);
				if (gap < tailReach && body.vx - target.vx < -0.02) left = Math.max(left, deployFor(gap));
			}
		}
		const slew = tailSlew * dt;
		const wantLeft = left * tailAngle;
		const wantRight = right * tailAngle;
		player.tailLeft += Math.max(-slew, Math.min(slew, wantLeft - player.tailLeft));
		player.tailRight += Math.max(-slew, Math.min(slew, wantRight - player.tailRight));
	}

	// With a full hopper the rig's bot makes a selling trip. The intercept duty
	// is suspended through its own override while the drive keeper keeps the
	// ball in play, so a held or grounded ball is collected again after the sale.
	function stepRigBot(world, dt) {
		const rig = players[0];
		if (!world || !rig || !rig.bot) { selling = false; return; }
		const ceiling = root.SteamCeiling;
		const autopilot = root.SteamAutopilot;
		const physics = root.SteamPhysics;
		if (!ceiling || !autopilot || !physics) return;
		if (!autopilot.state.move || !autopilot.state.drive) { selling = false; return; }
		const full = ceiling.state.cargoCells >= ceiling.state.storageLimit;
		if (!selling) {
			if (!full) return;
			selling = true;
		}
		autopilot.override('move');
		world.direction = 0;
		if (!full) { selling = false; return; }
		// Aim through the wall so target following presses the chassis against the
		// SELL face instead of stopping a few centimetres short of it.
		world.target = world.platform.x < physics.config.width * 0.5 ? physics.platformMin() - 1 : physics.platformMax() + 1;
	}

	function update(world, dt) {
		rigWorld = world || rigWorld;
		if (!players.length) return;
		stepRigBot(world, dt);
		for (let i = 1; i < players.length; i++) stepRival(players[i], dt);
		for (let i = 0; i < players.length; i++) stepTails(players[i], dt);
	}

	// The plate leaves the deck edge at its current angle and stops on whatever
	// it leans against — the floor, or the deck of the platform it is about to
	// climb — which is the same line profileAt collides with.
	function drawTails(context, player, body) {
		const half = halfWidth();
		for (let end = 0; end < 2; end++) {
			const side = end ? 1 : -1;
			const angle = side < 0 ? player.tailLeft : player.tailRight;
			if (angle <= 1e-4) continue;
			const edgeX = side * half;
			const footX = side * (half + bodyTop * Math.tan(angle));
			const ground = Math.max(0, Math.min(bodyTop, surfaceAt(body.x + footX, player.id) - body.y));
			if (ground >= bodyTop - 1e-4) continue;
			context.fillStyle = player.tail;
			context.beginPath();
			context.moveTo(edgeX, bodyTop);
			context.lineTo(footX, ground);
			context.lineTo(edgeX, ground);
			context.closePath();
			context.fill();
			context.strokeStyle = player.deck;
			context.lineWidth = 0.025;
			context.beginPath();
			context.moveTo(edgeX, bodyTop);
			context.lineTo(footX, ground);
			context.stroke();
		}
	}

	function drawWheels(context, player) {
		const body = posOf(player);
		const radius = root.SteamPhysics ? root.SteamPhysics.config.platformWheelRadius : 0.18;
		const offset = halfWidth() - 0.5;
		context.fillStyle = '#10191d';
		for (let wheel = 0; wheel < 2; wheel++) {
			context.beginPath();
			context.arc(wheel ? offset : -offset, radius, radius, 0, Math.PI * 2);
			context.fill();
		}
		context.strokeStyle = '#39494e';
		context.lineWidth = 0.035;
		for (let wheel = 0; wheel < 2; wheel++) {
			context.save();
			context.translate(wheel ? offset : -offset, radius);
			context.rotate(-body.spin);
			context.beginPath();
			for (let spoke = 0; spoke < 4; spoke++) {
				const angle = spoke * Math.PI * 0.5;
				context.moveTo(0, 0);
				context.lineTo(Math.cos(angle) * radius * 0.84, Math.sin(angle) * radius * 0.84);
			}
			context.stroke();
			context.restore();
		}
		context.fillStyle = '#596a70';
		for (let wheel = 0; wheel < 2; wheel++) {
			context.beginPath();
			context.arc(wheel ? offset : -offset, radius, radius * 0.2, 0, Math.PI * 2);
			context.fill();
		}
	}

	function drawLoad(context, player) {
		const limit = root.SteamCeiling ? root.SteamCeiling.state.storageLimit : loadLimitDefault;
		const ratio = Math.min(1, player.cargoCells / limit);
		if (ratio <= 0) return;
		context.fillStyle = '#8a6b3f';
		context.fillRect(-0.9, bodyTop, 1.8, 0.03 + ratio * 0.16);
	}

	// One body routine for every player: chassis, deck, tails, wheels and load.
	// The rig passes its machinery as an overlay so it stays inside this pass and
	// is covered by a competitor that is riding on top of it.
	function drawBody(context, player, extras) {
		const body = posOf(player);
		const isActive = players[active] === player;
		const half = halfWidth();
		context.save();
		context.globalAlpha = isActive ? 1 : 0.55;
		context.translate(body.x, body.y);
		context.rotate(body.angle);
		drawTails(context, player, body);
		context.fillStyle = player.body;
		context.fillRect(-half, bodyBottom, half * 2, bodyTop - bodyBottom);
		context.fillStyle = player.deck;
		context.fillRect(-half, bodyTop - 0.05, half * 2, 0.05);
		if (player.kind === 'rival') drawLoad(context, player);
		drawWheels(context, player);
		if (extras) extras(context, player);
		if (isActive) {
			context.strokeStyle = '#b9ed91';
			context.lineWidth = 0.03;
			context.strokeRect(-half, bodyBottom, half * 2, bodyTop - bodyBottom);
		}
		context.restore();
	}

	function draw(context, extras) {
		drawOrder.length = 0;
		for (let i = 0; i < players.length; i++) drawOrder.push(players[i]);
		// The platform riding on top is drawn last, matching the collision order.
		for (let i = 1; i < drawOrder.length; i++) {
			const player = drawOrder[i];
			let j = i - 1;
			while (j >= 0 && posOf(drawOrder[j]).y > posOf(player).y) {
				drawOrder[j + 1] = drawOrder[j];
				j--;
			}
			drawOrder[j + 1] = player;
		}
		for (let i = 0; i < drawOrder.length; i++) drawBody(context, drawOrder[i], extras);
	}

	const state = Object.freeze({
		get players() { return players; },
		get rivals() { return rivals; },
		get active() { return active; },
		get rig() { return players[0]; },
		get selling() { return selling; },
		get force() { return players[active] ? forceOf(players[active]) : 0; },
		get halfWidth() { return halfWidth(); },
		bodyTop, bodyBottom, tailAngle, tailPlate, tailReach, tailFullGap, bladeSwath, bladeCut
	});

	const api = {
		init, update, surfaceAt, draw, profileAt, money, load, force, activeSpeed, activeTarget, rigActive,
		setActive, setBot, syncRigBot, command, commandTarget, commandBrake, clearCommand, setForce,
		state, bodyTop, bodyBottom, tailAngle, tailReach, tailFullGap, bladeSwath, bladeCut,
		get halfWidth() { return halfWidth(); }
	};
	root.SteamPlayers = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
