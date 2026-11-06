(function (root) {
	'use strict';
	// Players own the platforms in the chamber. Every player drives the same
	// machine — chassis, wheels, deck and retractable 45° tails — and owns a
	// separate purse, research tree and installed machinery. Player 0 is the rig
	// and keeps the shared energy reserve and market ledger; every competitor
	// settles its own cargo and invests its own credits.
	//
	// Two platforms that meet ride rather than collide: the platform applying
	// more drive power starts the climb, and the other is carved out of its
	// ground query one way only, so no pair can lift itself. Once one hull is on
	// top, the pair keeps that rider until the bodies part — a brake or a
	// direction change mid-crossing cannot swap them. The tails unfold as the
	// gap closes and fold again when it opens, so a climbing wheel always meets
	// a 45° plate instead of a wall.
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
	// One drawing for every platform, and the one difference between them: the
	// selected platform at full opacity, the others at this alpha.
	const dimAlpha = 0.6;
	// A hand command silences the platform's own policy for the same two seconds
	// the autopilot uses, so taking the wheel never fights the bot.
	const manualSeconds = 2;
	const startSlots = [19, 5, 22, 2];
	const players = [];
	const rivals = [];
	const harvest = { value: 0, cells: 0 };
	const drawOrder = [];
	let rigWorld = null;
	let active = 0;
	let selling = false;
	let ballMode = 'shared1';
	// Half the flat deck less a margin: a landing inside this of the platform
	// centre arrives on the deck, and inside it the mark is left alone instead
	// of chattering on it.
	const deckSlack = 0.9;
	// Close enough to a travel click to call it reached; a policy mark keeps the
	// wider deck slack instead.
	const approachSlack = 0.05;
	// A ball already being played keeps the competitor's attention unless another
	// one lands this much sooner, so two shared balls never make it dither
	// between landing points.
	const ballCommit = 0.6;
	const keeperInterval = 1 / 20;
	const tiltIterations = 12;
	const apexMargin = 0.25;
	const harvestReach = 1.15;
	const harvestDeadline = 0.8;
	let keeperTrial = null;
	// Sale income buys the next affordable step in this order. The first chain
	// earns the competitor its own computer before it spends on heavier machinery.
	const botBuild = Object.freeze([
		Object.freeze({ research: 'materials' }),
		Object.freeze({ research: 'electromagnetics' }),
		Object.freeze({ research: 'ballistics' }),
		Object.freeze({ equipment: 'coil' }),
		Object.freeze({ research: 'traction' }),
		Object.freeze({ equipment: 'motor' }),
		Object.freeze({ research: 'alloys' }),
		Object.freeze({ research: 'thermodynamics' }),
		Object.freeze({ research: 'power' }),
		Object.freeze({ research: 'ballistics2' }),
		Object.freeze({ equipment: 'overdrive' }),
		Object.freeze({ equipment: 'chassis' }),
		Object.freeze({ equipment: 'pad' }),
		Object.freeze({ research: 'impact' }),
		Object.freeze({ research: 'storage' }),
		Object.freeze({ equipment: 'flywheel' })
	]);

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

	// The machine controls are per platform: the rig's live in the world (the
	// physics reads the piston angle and drive there), every competitor keeps
	// its own copy on the player object. One accessor covers any number of
	// platforms, so the wheel, the slider and a drag address the selected
	// platform only and can never steer another one.
	function machineOf(player) {
		return player.kind === 'rig' && rigWorld ? rigWorld : player;
	}

	function pistonAngleOf(player) {
		const angle = machineOf(player).pistonAngle;
		return Number.isFinite(angle) ? angle : 0;
	}

	// One writer for the tilt, clamped to the same range physics enforces: the
	// rig's angle goes through the physics setter, a competitor's is its own.
	function setPistonAngleOf(player, angle) {
		const physics = root.SteamPhysics;
		const max = physics ? physics.config.pistonMaxAngle : Math.PI / 18;
		const clamped = Math.max(-max, Math.min(max, angle));
		if (player.kind === 'rig' && rigWorld && physics) return physics.setPistonAngle(rigWorld, clamped);
		machineOf(player).pistonAngle = clamped;
		return clamped;
	}

	function overrideMachine(player, channel) {
		if (!player || player.kind !== 'rival') return;
		if (channel === 'angle') player.tiltManual = manualSeconds;
		if (channel === 'drive') player.driveManual = manualSeconds;
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
		const pushing = player.direction !== 0 || Number.isFinite(player.target) || player.commanded;
		return pushing ? forceOf(player) : 0;
	}

	// A pair that has begun to ride keeps its rider until the bodies part. Drive
	// power decides the first climb, but a brake, a reached mark or a direction
	// change mid-crossing must not swap the two hulls while one is on top.
	const layers = [];
	const layerThreshold = 0.02;

	function powerAbove(a, b) {
		const pa = powerOf(a);
		const pb = powerOf(b);
		if (Math.abs(pa - pb) > 1e-6) return pa > pb;
		return a.index < b.index;
	}

	function layerOf(a, b) {
		for (let i = 0; i < layers.length; i++) {
			const layer = layers[i];
			if (layer.a === a && layer.b === b || layer.a === b && layer.b === a) return layer;
		}
		return null;
	}

	// Strict layering. Equal power keeps the lower index on top, so an undecided
	// pair never swaps every step; an engaged pair keeps the rider it has now.
	function above(a, b) {
		const layer = layerOf(a, b);
		if (layer && layer.engaged) return layer.rider === a;
		return powerAbove(a, b);
	}

	function syncLayers() {
		const engage = halfWidth() * 2 + tailPlate;
		const release = halfWidth() * 2 + tailReach;
		for (let i = 0; i < layers.length; i++) {
			const layer = layers[i];
			const a = posOf(layer.a);
			const b = posOf(layer.b);
			if (!Number.isFinite(a.x) || !Number.isFinite(b.x) || !Number.isFinite(a.y) || !Number.isFinite(b.y)) {
				layer.engaged = false;
				layer.rider = null;
				continue;
			}
			const gap = Math.abs(a.x - b.x);
			if (layer.engaged) {
				if (gap > release) { layer.engaged = false; layer.rider = null; }
				continue;
			}
			// Two hulls still on the same ground are ranked by drive power; once
			// one has climbed, the higher one is the rider for the whole crossing.
			if (gap > engage || Math.abs(a.y - b.y) <= layerThreshold) continue;
			layer.engaged = true;
			layer.rider = a.y > b.y ? layer.a : layer.b;
		}
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

	// A competitor settles through the same pose solve as the rig: one slew and
	// one rate-limited base, so its deck moves the way any platform's does and
	// the ball sees the same surface on either machine. A new body starts settled
	// and at rest.
	function settle(rival, dt) {
		const physics = root.SteamPhysics;
		if (!physics || !physics.settlePose) return;
		if (dt) { physics.settlePose(rival, dt, rival.id); return; }
		physics.settlePose(rival, 1, rival.id);
		rival.stepVx = 0;
		rival.stepVy = 0;
		rival.stepOmega = 0;
		rival.vy = 0;
		rival.omega = 0;
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
		const rival = {
			index: index + 1, id: 'rival-' + (index + 1), name: 'RIVAL ' + (index + 1),
			colour: index % 2 ? '#8f86c9' : '#c98c5a', kind: 'rival', bot: true,
			force: 0.6, x: startSlots[index % startSlots.length], y: 0, angle: 0, vx: 0, spin: 0,
			direction: 0, target: NaN, braking: false, manual: 0,
			pistonAngle: 0, pistonOffset: 0, pistonVelocity: 0, pistonImpact: 0,
			drive: false, bounces: 0, pushes: 0, engineId: 'electric',
			cargoCells: 0, cargoValue: 0, money: 0, spent: 0, soldValue: 0, ledger: [],
			lastPurchase: '', buildIndex: 0,
			tailLeft: 0, tailRight: 0,
			playing: null, mark: NaN, markTime: 0, commanded: false,
			harvesting: false, harvestTarget: NaN, harvestDirection: 1,
			tiltManual: 0, driveManual: 0, wantedAngle: 0,
			keeperAge: keeperInterval, keeperBall: null, keeperState: '', keeperBounces: -1, keeperPushes: -1,
			contactOnPiston: false, contactVx: 0, contactVy: 0, contactY: 0,
			previousX: 0, previousY: 0, previousAngle: 0, stepVx: 0, stepVy: 0, stepOmega: 0
		};
		settle(rival);
		// The ball solves a deck contact against this body between steps, so the
		// body starts with its own pose as the previous one, never at the origin.
		rival.previousX = rival.x;
		rival.previousY = rival.y;
		rival.previousAngle = rival.angle;
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
		layers.length = 0;
		for (let i = 0; i < players.length; i++) {
			for (let j = i + 1; j < players.length; j++) layers.push({ a: players[i], b: players[j], rider: null, engaged: false });
		}
		active = 0;
		selling = false;
		applyBalls(world);
		return players;
	}

	// The chamber's balls follow the chosen arrangement: one shared ball, two
	// shared balls, or one ball per platform, which only its owner may push.
	function applyBalls(world) {
		const physics = root.SteamPhysics;
		if (!physics || !world || !physics.setBallMode) return;
		const anchors = [];
		for (let i = 0; i < rivals.length; i++) {
			anchors.push({ id: rivals[i].id, x: rivals[i].x });
			// The set is rebuilt, so a remembered ball is a dead object.
			rivals[i].playing = null;
		}
		physics.setBallMode(world, ballMode, anchors);
		// Changing the arrangement re-seats the balls, so the rig's ledger is
		// re-based on the new set instead of chasing a teleported ball.
		world.initialEnergy = physics.totalEnergy(world);
	}

	function setBallMode(mode) {
		ballMode = mode === 'shared2' || mode === 'each' ? mode : 'shared1';
		if (rigWorld) applyBalls(rigWorld);
		return ballMode;
	}

	function money(index) {
		const player = players[index];
		if (!player) return 0;
		if (player.kind === 'rig') return root.SteamCeiling ? root.SteamCeiling.state.funds : 0;
		return player.money;
	}

	// A competitor has its own money trail. Research and equipment call this one
	// writer, so a purchase can never debit the rig or another rival by accident.
	function purchase(id, label, amount, time, type, testGrant) {
		const player = playerById(id);
		if (!player || player.kind !== 'rival') return false;
		const commune = root.SteamCeiling && root.SteamCeiling.state.commune;
		const credits = testGrant || commune ? 0 : amount;
		if (!(credits >= 0) || player.money < credits) return false;
		player.money -= credits;
		player.spent += credits;
		player.lastPurchase = label;
		player.ledger.push(Object.freeze({
			id: player.ledger.length + 1,
			type: type || 'buy',
			time: typeof time === 'number' ? time : 0,
			label,
			credits,
			source: testGrant ? 'test' : undefined
		}));
		return true;
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

	// A command belongs to the platform it was given to, so the one left behind
	// stands down at once: a held key or a travel click never keeps driving a
	// platform you are no longer looking at. The platform you take keeps its own
	// policy live until a key or a click actually addresses it.
	function setActive(index) {
		if (index < 0 || index >= players.length || index === active) return false;
		const outgoing = players[active];
		if (outgoing.kind === 'rival') {
			outgoing.direction = 0;
			outgoing.braking = false;
			outgoing.target = NaN;
			outgoing.manual = 0;
		}
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
		player.keeperAge = keeperInterval;
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

	// Only a platform that actually holds a command is stood down, so releasing a
	// pointer, a window blur or a reset cannot put a manual window on a platform
	// that its own policy was driving.
	function clearCommand() {
		const player = players[active];
		if (!player || player.kind !== 'rival') return false;
		if (!player.direction && !player.braking && !Number.isFinite(player.target)) return false;
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

	function invest(rival) {
		const research = root.SteamResearch;
		const equipment = root.SteamEquipment;
		if (!research || !equipment) return;
		while (rival.buildIndex < botBuild.length) {
			const entry = botBuild[rival.buildIndex];
			if (entry.research) {
				if (research.isResearched(entry.research, rival.id)) {
					rival.buildIndex++;
					continue;
				}
				if (research.status(entry.research, rival.id) !== research.constants.AVAILABLE) return;
				if (!research.research(entry.research, rigWorld, rival.id)) return;
			} else {
				if (equipment.isInstalled(entry.equipment, rival.id)) {
					rival.buildIndex++;
					continue;
				}
				if (!equipment.isUnlocked(entry.equipment, rival.id)) return;
				if (!equipment.install(entry.equipment, rigWorld, rival.id)) return;
			}
			rival.buildIndex++;
		}
	}

	// A wall settles the load into this competitor's purse. Nothing is shared:
	// the competitor keeps its whole takings, then its own bot invests what it can.
	function sell(rival) {
		if (rival.cargoCells <= 0 && rival.cargoValue <= 0) return 0;
		const value = rival.cargoValue;
		rival.money += value;
		rival.soldValue += value;
		rival.cargoCells = 0;
		rival.cargoValue = 0;
		if (rival.bot) invest(rival);
		return value;
	}

	// One mark either way: the platform's own policy mark while its bot is on,
	// the travel click otherwise. A bot's mark is where the ball comes down and
	// is met at the speed the autopilot's own arrival rule allows; a travel click
	// is followed at full speed until its braking distance and cleared when met.
	function steerWanted(rival, speedLimit, brakeAcceleration) {
		// A held key or brake outranks the policy, however long it is held; the
		// two-second manual window only decides when the bot may take over again.
		if (rival.braking) return 0;
		if (rival.direction) return rival.direction * speedLimit;
		const bot = rival.bot && rival.manual <= 0;
		const mark = bot ? rival.mark : rival.target;
		if (!Number.isFinite(mark)) return 0;
		const distance = mark - rival.x;
		const slack = bot && !rival.harvesting ? deckSlack : approachSlack;
		const reach = Math.abs(distance) - slack;
		if (reach <= 0) {
			if (!bot) rival.target = NaN;
			return 0;
		}
		// A bot meets the ball with the same arrival rule the rig's autopilot
		// uses; a travel click is followed at full speed until its braking
		// distance instead.
		const physics = root.SteamPhysics;
		const speed = bot
			? physics.arrivalSpeed(reach, rival.markTime, brakeAcceleration)
			: Math.min(speedLimit, Math.sqrt(2 * brakeAcceleration * reach));
		return Math.sign(distance) * Math.min(speedLimit, speed);
	}

	// A competitor drives the same engine as the rig: force per mass, speed per
	// force setting, and the same wheel bounds.
	function engineAcceleration(rival, forceValue) {
		const physics = root.SteamPhysics;
		if (!physics) return 8 * forceValue;
		return physics.forceNow(rival.id) * forceValue / physics.machineMass(rigWorld, rival);
	}

	function engineSpeed(rival, forceValue) {
		const physics = root.SteamPhysics;
		if (!physics) return 12 * forceValue;
		return physics.speedNow(rival.id) * forceValue;
	}

	// The ball this competitor works. Any ball it may push is playable, shared
	// ones included; a ball on the floor comes first because it can be recovered
	// at once, then the flight that lands soonest. A ball another platform holds
	// is out of play: it cannot be taken from a collector, and the release that
	// follows is a new flight.
	function playBall(rival) {
		const balls = rigWorld ? rigWorld.balls : null;
		const physics = root.SteamPhysics;
		if (!balls || !physics) return null;
		const deck = rival.y + physics.config.deck + physics.config.radius;
		let floor = null;
		let flying = null;
		let soonest = Infinity;
		for (let i = 0; i < balls.length; i++) {
			const ball = balls[i];
			if (!physics.mayPush(ball, rival.id)) continue;
			if (ball.state === 'held') continue;
			if (ball.state !== 'flying') { if (!floor) floor = ball; continue; }
			const landing = physics.ballLandingTime(ball, deck);
			if (landing < soonest) { soonest = landing; flying = ball; }
		}
		const best = floor || flying;
		// The ball already being played keeps its attention unless the other one
		// lands clearly sooner, so two shared balls never make the competitor
		// dither between landing points.
		const current = rival.playing;
		if (current && current !== best && physics.mayPush(current, rival.id) && current.state !== 'held') {
			const currentTime = current.state === 'flying' ? physics.ballLandingTime(current, deck) : 0;
			if (currentTime <= (floor ? 0 : soonest) + ballCommit) return current;
		}
		return best;
	}

	// The wall a full hopper is taken to: through the SELL face, so target
	// following presses the chassis against it instead of stopping short.
	function sellingMark(x) {
		const physics = root.SteamPhysics;
		return x < physics.config.width * 0.5 ? physics.platformMin() - 1 : physics.platformMax() + 1;
	}

	function solveKeeper(rival, angle, push) {
		const physics = root.SteamPhysics;
		if (!keeperTrial) keeperTrial = physics.contactResult();
		return physics.solveFace(rigWorld, rival, rival.contactVx, rival.contactVy,
			rival.angle + angle, push, keeperTrial, undefined, undefined, rival.playing);
	}

	function replanKeeper(rival) {
		const computer = root.SteamPrediction;
		rival.keeperAge = 0;
		rival.keeperBall = rival.playing;
		rival.keeperState = rival.playing ? rival.playing.state : '';
		rival.keeperBounces = rival.bounces;
		rival.keeperPushes = rival.pushes;
		rival.contactOnPiston = false;
		if (!computer || !rival.playing || rival.playing.state !== 'flying') return;
		const path = computer.predict(rigWorld, rival.playing, rival.id);
		if (path.kind !== computer.kinds.DECK || path.surface !== computer.surfaces.PISTON) return;
		rival.contactVx = path.endVx;
		rival.contactVy = path.endVy;
		rival.contactY = path.endY;
		rival.contactOnPiston = true;
	}

	function advanceKeeper(rival, dt) {
		rival.keeperAge += dt;
		const ball = rival.playing;
		const stale = rival.keeperAge >= keeperInterval || ball !== rival.keeperBall
			|| (ball ? ball.state : '') !== rival.keeperState
			|| rival.bounces !== rival.keeperBounces || rival.pushes !== rival.keeperPushes;
		if (stale) replanKeeper(rival);
	}

	// Price the next reflected apex, not the apex the ball already has. The
	// keeper can therefore leave a sufficient passive bounce unpowered.
	function keeperDrive(rival) {
		const ball = rival.playing;
		if (!ball) return false;
		if (ball.state !== 'flying') return true;
		const config = root.SteamPhysics.config;
		const target = config.ceiling - config.radius;
		if (rival.contactOnPiston) {
			const bounce = solveKeeper(rival, rival.wantedAngle, 0);
			const rise = Math.max(0, bounce.vy);
			const apex = rival.contactY + rise * rise / (2 * config.ballGravity);
			if (apex < target - apexMargin) return true;
			if (apex > target) return false;
			return rival.drive;
		}
		const apex = ball.y + ball.vy * ball.vy / (2 * config.ballGravity);
		if (apex < target - apexMargin) return true;
		if (apex > target) return false;
		return rival.drive;
	}

	// The horizontal reflection is monotonic over the actuator range. Bisection
	// uses the chamber's own solver on this rival, including its deck and pulse.
	function keeperTilt(rival) {
		const physics = root.SteamPhysics;
		const push = rival.drive ? physics.launchCapacity(rigWorld, rival) : 0;
		const max = physics.config.pistonMaxAngle;
		let low = -max;
		let lowVx = solveKeeper(rival, low, push).vx;
		const highVx = solveKeeper(rival, max, push).vx;
		if (lowVx * highVx > 0) return Math.abs(lowVx) < Math.abs(highVx) ? low : max;
		let high = max;
		for (let iteration = 0; iteration < tiltIterations; iteration++) {
			const mid = (low + high) * 0.5;
			const midVx = solveKeeper(rival, mid, push).vx;
			if (lowVx * midVx <= 0) high = mid;
			else { low = mid; lowVx = midVx; }
		}
		return (low + high) * 0.5;
	}

	function stepKeepers(rival, dt) {
		if (!rival.bot) { rival.contactOnPiston = false; return; }
		advanceKeeper(rival, dt);
		if (rival.driveManual <= 0) rival.drive = keeperDrive(rival);
		if (rival.tiltManual > 0) return;
		if (rival.contactOnPiston) rival.wantedAngle = keeperTilt(rival);
		const config = root.SteamPhysics.config;
		const reach = config.pistonSlewRate * dt;
		const delta = rival.wantedAngle - rival.pistonAngle;
		setPistonAngleOf(rival, Math.abs(delta) <= reach ? rival.wantedAngle : rival.pistonAngle + Math.sign(delta) * reach);
	}

	function clearHarvest(rival) {
		rival.harvesting = false;
		rival.harvestTarget = NaN;
	}

	function rubbleNear(x) {
		const economy = root.SteamCeiling;
		const physics = root.SteamPhysics;
		if (!economy || !physics) return false;
		const values = economy.state.floorValues;
		const centre = Math.floor(x / physics.config.width * values.length);
		for (let offset = -5; offset <= 5; offset++) {
			const column = centre + offset;
			if (column >= 0 && column < values.length && values[column] > 0.001) return true;
		}
		return false;
	}

	// A level bounce no longer forces the chassis to wander. While the flight is
	// safely away, sweep a short mark on either side of it to work the rubble
	// under the blade; the real landing always takes back priority near contact.
	function harvestMark(rival, mark) {
		const physics = root.SteamPhysics;
		if (!physics || rival.manual > 0 || rival.markTime < harvestDeadline || Math.abs(mark - rival.x) > deckSlack + harvestReach) {
			clearHarvest(rival);
			return mark;
		}
		if (rival.harvesting) {
			if (!rubbleNear(rival.x) || Math.abs(rival.harvestTarget - mark) > harvestReach * 1.5) {
				clearHarvest(rival);
				return mark;
			}
			if (Math.abs(rival.harvestTarget - rival.x) > approachSlack) return rival.harvestTarget;
			clearHarvest(rival);
			rival.harvestDirection = -rival.harvestDirection;
		}
		if (!rubbleNear(rival.x) || Math.abs(mark - rival.x) > deckSlack) return mark;
		const min = physics.platformMin();
		const max = physics.platformMax();
		let target = mark + rival.harvestDirection * harvestReach;
		if (target < min || target > max) {
			rival.harvestDirection = -rival.harvestDirection;
			target = mark + rival.harvestDirection * harvestReach;
		}
		target = Math.max(min, Math.min(max, target));
		if (Math.abs(target - rival.x) <= approachSlack) return mark;
		rival.harvesting = true;
		rival.harvestTarget = target;
		return target;
	}

	// A competitor plays the ball with the same machinery as the rig: its
	// collector catches, its reflector bounces off its own tilt, and it stands
	// where the flight comes down or drives over a ball on the floor to scoop
	// it. The drive stays armed only while the passive bounce would fall short
	// of the rock, using the rig's drive-keeper rule at this machine's pulse size.
	// A full hopper sends it to the nearer wall first, like the rig's selling
	// trip. With no ball in play it holds station instead of wandering.
	function stepBallPolicy(rival, dt) {
		rival.mark = NaN;
		rival.markTime = 0;
		const physics = root.SteamPhysics;
		if (!physics) return;
		const config = physics.config;
		// A caught ball is this platform's: the bot releases it at once, so a
		// competitor never parks the only ball in play. The platform under the
		// controls keeps its catch, because its computer and its release are the
		// player's to use.
		const caught = physics.heldBallOf(rigWorld, rival);
		rival.playing = caught || playBall(rival);
		stepKeepers(rival, dt);
		if (caught) {
			clearHarvest(rival);
			if (rival.bot && rival.driveManual <= 0) rival.drive = true;
			if (rival.bot && rival.manual <= 0 && players[active] !== rival && physics.canLaunch(rigWorld, caught)) physics.launch(rigWorld, caught, rival);
			return;
		}
		const ball = rival.playing;
		if (!ball) { clearHarvest(rival); return; }
		if (!rival.bot || rival.manual > 0 || rival.braking || rival.direction) { clearHarvest(rival); return; }
		if (rival.cargoCells >= (root.SteamCeiling ? root.SteamCeiling.state.storageLimit : loadLimitDefault)) {
			clearHarvest(rival);
			rival.mark = sellingMark(rival.x);
			return;
		}
		// A ball on the floor is a recovery: stand over it.
		rival.mark = ball.x;
		if (ball.state !== 'flying') { clearHarvest(rival); return; }
		// A flight is met at the deck height, one radius off the deck, so the
		// landing mark is where a deck bounce would happen.
		const landing = physics.ballLandingTime(ball, rival.y + config.deck + config.radius);
		if (!Number.isFinite(landing)) { clearHarvest(rival); return; }
		rival.mark = Math.max(0, Math.min(config.width, ball.x + ball.vx * landing));
		rival.markTime = landing;
		rival.mark = harvestMark(rival, rival.mark);
	}

	function stepRival(rival, dt) {
		const physics = root.SteamPhysics;
		if (!physics) return;
		if (rival.manual > 0) rival.manual = Math.max(0, rival.manual - dt);
		if (rival.tiltManual > 0) rival.tiltManual = Math.max(0, rival.tiltManual - dt);
		if (rival.driveManual > 0) rival.driveManual = Math.max(0, rival.driveManual - dt);
		stepBallPolicy(rival, dt);
		rival.previousX = rival.x;
		rival.previousY = rival.y;
		rival.previousAngle = rival.angle;
		const power = Math.max(0.1, rival.force);
		const acceleration = engineAcceleration(rival, power);
		const limit = engineSpeed(rival, power);
		const previousX = rival.x;
		const wanted = steerWanted(rival, limit, acceleration * 1.5);
		// Drive power for the ride-over rule is the platform's own command: a
		// chasing competitor pushes, a competitor standing on its mark does not.
		rival.commanded = wanted !== 0;
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
		// The pose solve reports the step's own velocities, which is what the ball
		// sees as this body's deck motion.
		settle(rival, dt);
		if (Math.abs(rival.vx) > 0.05) grade(rival, dt);
		const atWall = rival.x <= minX + 1e-3 || rival.x >= maxX - 1e-3;
		if (atWall && rival.cargoCells > 0) sell(rival);
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
		world.target = sellingMark(world.platform.x);
	}

	function update(world, dt) {
		rigWorld = world || rigWorld;
		if (!players.length) return;
		stepRigBot(world, dt);
		syncLayers();
		for (let i = 1; i < players.length; i++) stepRival(players[i], dt);
		for (let i = 0; i < players.length; i++) stepTails(players[i], dt);
	}

	// The plate leaves the deck edge at its current angle and stops on whatever
	// it leans against — the floor, or the deck of the platform it is about to
	// climb — which is the same line profileAt collides with.
	// skin is the one palette every platform wears; player supplies the
	// deployment angles, which are per-platform state.
	function drawTails(context, skin, player, body) {
		const half = halfWidth();
		for (let end = 0; end < 2; end++) {
			const side = end ? 1 : -1;
			const angle = side < 0 ? player.tailLeft : player.tailRight;
			if (angle <= 1e-4) continue;
			const edgeX = side * half;
			const footX = side * (half + bodyTop * Math.tan(angle));
			const ground = Math.max(0, Math.min(bodyTop, surfaceAt(body.x + footX, player.id) - body.y));
			if (ground >= bodyTop - 1e-4) continue;
			context.fillStyle = skin.tail;
			context.beginPath();
			context.moveTo(edgeX, bodyTop);
			context.lineTo(footX, ground);
			context.lineTo(edgeX, ground);
			context.closePath();
			context.fill();
			context.strokeStyle = skin.deck;
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

	// One machine, drawn once: every platform gets the whole body — tails,
	// chassis, deck, wheels, fuel bar, thermometer, collector strip and reflector
	// piston — in the same palette, and the only difference between them is the
	// dim applied to the platform the controls are not on. The machinery is the
	// machine's, so both hulls show the same instruments; nothing is added to or
	// taken from a competitor.
	function renderPlatform(context, player, rigMachinery, isActive) {
		if (isActive === undefined) isActive = players[active] === player;
		const body = posOf(player);
		const half = halfWidth();
		const rig = players[0];
		context.save();
		// globalAlpha is set, not multiplied into what was there, so drawing the
		// same platform again can never compound the dimming.
		context.globalAlpha = isActive ? 1 : dimAlpha;
		context.translate(body.x, body.y);
		context.rotate(body.angle);
		drawTails(context, rig, player, body);
		context.fillStyle = rig.body;
		context.fillRect(-half, bodyBottom, half * 2, bodyTop - bodyBottom);
		context.fillStyle = rig.deck;
		context.fillRect(-half, bodyTop - 0.05, half * 2, 0.05);
		drawWheels(context, player);
		if (rigMachinery) rigMachinery(context, player);
		context.restore();
	}

	function draw(context, rigMachinery) {
		drawOrder.length = 0;
		for (let i = 0; i < players.length; i++) drawOrder.push(players[i]);
		// The platform riding on top is drawn last, matching the collision order.
		for (let i = 1; i < drawOrder.length; i++) {
			const player = drawOrder[i];
			const thisY = posOf(player).y;
			let j = i - 1;
			while (j >= 0) {
				const otherY = posOf(drawOrder[j]).y;
				if (otherY > thisY + 1e-6) {
					drawOrder[j + 1] = drawOrder[j];
					j--;
					continue;
				}
				// Near-level platforms keep the collision order: the one applying
				// more drive power rides on top, so a direction change cannot
				// flicker the stacking when the heights are equal.
				if (otherY >= thisY - 1e-6 && above(player, drawOrder[j])) {
					drawOrder[j + 1] = drawOrder[j];
					j--;
					continue;
				}
				break;
			}
			drawOrder[j + 1] = player;
		}
		for (let i = 0; i < drawOrder.length; i++) {
			const player = drawOrder[i];
			renderPlatform(context, player, rigMachinery, player === players[active]);
		}
	}

	const state = Object.freeze({
		get players() { return players; },
		get rivals() { return rivals; },
		get active() { return active; },
		get rig() { return players[0]; },
		get selling() { return selling; },
		get force() { return players[active] ? forceOf(players[active]) : 0; },
		get ballMode() { return ballMode; },
		get world() { return rigWorld; },
		get halfWidth() { return halfWidth(); },
		bodyTop, bodyBottom, tailAngle, tailPlate, tailReach, tailFullGap, bladeSwath, bladeCut
	});

	const api = {
		init, update, surfaceAt, draw, renderPlatform, profileAt, money, purchase, load, force, activeSpeed, activeTarget, rigActive,
		setActive, setBot, syncRigBot, command, commandTarget, commandBrake, clearCommand, setForce, setBallMode,
		machineOf, pistonAngleOf, setPistonAngleOf, overrideMachine,
		state, bodyTop, bodyBottom, tailAngle, tailReach, tailFullGap, bladeSwath, bladeCut,
		get halfWidth() { return halfWidth(); }
	};
	root.SteamPlayers = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
