// Context help content. The page keeps one drawer and renders whichever topic a
// ? mark, a held panel or the H shortcut asks for. Text lives here so the panels
// stay compact and every explanation has a single home.
(function (root) {
	'use strict';
	// label - short name in the drawer's topic index.
	// text  - paragraphs, in reading order.
	// keys  - optional [input, action] pairs rendered as a definition list.
	const topics = [
		{
			id: 'keys',
			label: 'Keys',
			title: 'Controls',
			text: [
				'Game keys work anywhere on the page; pressing one releases the focused button or slider first, so Space never double-fires a control. A and D, the brake, the force keys, the drive and the piston tilt address the platform selected in PLAYERS; the ball release and the autopilot keys belong to the rig and are ignored while a competitor is driven.',
				'Help itself: hover a ? mark (or tap it on touch), press and hold a panel for that panel’s topic, press H or F1 to toggle this drawer, Escape to close it.'
			],
			keys: [
				['A / D', 'Engine and brake left/right — releasing coasts'],
				['← / → buttons', 'Hold to drive or brake with the pointer'],
				['W / S', 'Movement force, ±10% a press'],
				['B', 'Brake without reversing (either case)'],
				['Space / Q', 'Toggle the bounce drive'],
				['E', 'Release a held ball while the drive is on'],
				['X', 'Autopilot · chase the predicted landing'],
				['⇧X', 'Autopilot · timed intercept'],
				['Z', 'Autopilot · drive keeper'],
				['C', 'Autopilot · level bounce'],
				['M', 'Communism mode'],
				['H / F1', 'Open or close this help drawer'],
				['Escape', 'Close this help drawer'],
				['Wheel over chamber', 'Tilt the piston about 4° a notch'],
				['Drag in open air', 'Tilt the piston; left or up raises the angle'],
				['Hover over rock', 'Inspect its mix, value and remaining strength'],
				['Click low ground', 'Set a travel target'],
				['Rock view bar', 'Change what the rock is coloured by']
			]
		},
		{
			id: 'balls',
			label: 'Balls',
			title: 'Shared and owned balls',
			text: [
				'BALLS in the system bar sets what is in the chamber. One shared ball is the classic game: a single ball both platforms may push, and whichever platform it comes down on catches it in its own collector and pulses it with its own reflector.',
				'Two shared balls put two balls in flight at once and both platforms may push either of them. Every platform holds one at a time. The ballistic overlay draws a flight for every ball the selected platform may push — the focus flight with its landing mark and coasting ghost, the others as dimmer dotted paths — while the readouts still follow the one the platform is working. In the one-per-platform arrangement only that platform’s own ball is drawn: a ball it may not push has no flight to show.',
				'One per platform gives every platform its own ball. Ownership is the collision rule: a platform cannot see, catch, bounce or pulse a ball it does not own, so the rig’s collector passes straight through a competitor’s ball and that competitor’s deck passes straight through the rig’s.',
				'A competitor keeps its own ball alive with its own deck: the collector catches it, the reflector bounces it off the competitor’s tilt, a pulse from its own upgraded machinery is added while the reflected ball would fall short of the rock, and a grounded ball is scooped back up by driving over it. Its owned ball uses its own strike-ball tier and breaks the same ceiling rock; the debris lands as floor rubble, and its chassis harvests that rubble into its own purse. Competitor balls, catches and pulses are outside the rig’s energy ledger, exactly like the commercial grader.'
			],
			keys: [
				['1 shared', 'One ball, both platforms push it, the rig catches it'],
				['2 shared', 'Two balls in play, the computer draws both flights'],
				['1 per platform', 'Each platform pushes only its own ball'],
				['Competitor ball', 'Mines rock, leaves rubble, pays its owner only']
			]
		},
		{
			id: 'ground',
			label: 'Ground',
			title: 'Ground bounce',
			text: [
				'GROUND in the system bar is a chamber rule, not an upgrade. It says how much of the energy a ball brings into the rubble floor it keeps after the strike. The default loses all of it: the ball settles on the floor until a platform collects it and releases it again.',
				'Lose 50% keeps half of the normal impact energy, so the ball leaves the ground with about 71% of its downward speed and goes on bouncing, each rebound smaller than the last. Lose none keeps all of it. Only the normal component is damped; sideways motion is untouched, and the share that is lost becomes machinery heat for a ball in the rig’s ledger. A rebound too small to see settles the ball instead of buzzing a millimetre above the floor.',
				'The ballistic computer follows the same rule. Its drawn flight ends at the second ground or platform contact — or at the first when that strike ends the flight — so the overlay shows the next one or two bounces rather than a long speculative chain. The setting stays chosen across New game, like the rock shape and the ball arrangement.'
			],
			keys: [
				['Lose all', 'Default · the ball grounds and waits to be collected'],
				['Lose 50%', 'A half-energy ground rebound, drawn through the next bounce'],
				['Lose none', 'An elastic ground rebound'],
				['GROUND ?', 'This topic, from the system bar']
			]
		},
		{
			id: 'chamber',
			label: 'Chamber',
			title: 'The chamber',
			text: [
				'The chamber is 24 × 15 m. A ball bounces on the platform deck and off the ceiling; the sprung reflector piston sends it where you aim it.',
				'The amber collector catches only when it is empty: a ball arriving while it already holds one is returned off the flat strip instead. The green piston reflects through the same impulse solve the ballistic computer uses, so a forecast through a tilted bounce follows the ball’s real flight.',
				'Clicks have three meanings, and the zones never overlap: visible rock inspects a cell, the low band near the ground (the drawn 1.7 m target height) commands travel, and open air starts a piston drag.',
				'The recessed bay on the right is the road grader’s garage; a called grader works the floor and returns there.',
				'Rock is not cleared at once. A blow spends at most half of a cell’s strength and leaves the ring around it standing; only the free face then lets go, so a piece never falls out of the inside of the rock. The mineral growth sliders run from 10% to 500% and mix two releases: at 10% a fall is the plain clump of loose free faces the rock always gave, and as the setting rises more of the piece is a connected, mineral-matched flake that leaves in one solid group; larger groups also release less often. Generate test rock starts a fresh run with Iron, Copper and Crystal bands left to right (defaults 300%, 100% and 10%) and looseness rising from 0% at the top to 100% at the bottom. The Damage rock view shows that gradient; hover over rock to inspect its mix, value and remaining strength.'
			],
			keys: [
				['Collector', 'Amber strip, catches and holds balls and debris'],
				['Reflector', 'Green piston, centre of the deck'],
				['Charge pad', 'Blue centre strip of the ground, 3 kW'],
				['Garage', 'Right-hand bay, road grader home'],
				['SELL', 'Either wall; a load aboard sells on touch']
			]
		},
		{
			id: 'drive',
			label: 'Drive',
			title: 'Bounce drive',
			text: [
				'The drive is on by default. Each powered contact adds the pulse shown in the installed specification — 42 J at base tuning, drawn from the 12 kJ reserve at about 80% efficiency, so one powered bounce costs up to 52.5 J.',
				'Three powered bounces from a release reach the ceiling, and the drive only pulses on contact, so it never fights the passive bounce.',
				'The drive heats with work. A hot drive is derated and a cut-off drive produces nothing until it cools; the temperature card tags HOT and CUTOFF.'
			],
			keys: [
				['Space / Q', 'Toggle the drive without pressing a focused control'],
				['E', 'Release a held ball (the drive must be on)']
			]
		},
		{
			id: 'movement',
			label: 'Move',
			title: 'Movement and force',
			text: [
				'Hold A or D, or hold the arrow buttons, to drive or brake; releasing coasts. W and S, or the force slider, set movement force from 10% to 100% — less force is slower but easier to place and cheaper on the flywheel.',
				'B brakes without reversing. With the brake flywheel installed, braking energy returns to the reserve.',
				'A click on the low band near the ground sets a travel target, and manual movement overrides it. An empty reserve still hand-cranks at a 0.8 m/s crawl, so the centre pad always stays reachable.',
				'The platform follows the ground under its wheels and pitches with the terrain, so slopes change grip and speed.'
			],
			keys: [
				['A / D', 'Drive or brake'],
				['W / S', 'Movement force'],
				['B', 'Brake without reversing'],
				['Click low ground', 'Set a travel target']
			]
		},
		{
			id: 'tilt',
			label: 'Tilt',
			title: 'Reflector tilt',
			text: [
				'The reflector is a sprung piston whose face tilts ±10°. A positive angle raises the right edge and sends a falling ball left, so drag towards where the ball should go — left or up raises the angle.',
				'Each contact compresses the piston in proportion to normal impact speed (0.024 m per m/s, capped at 0.16 m) and a damped spring pushes it back out. Compression is drawn only; the collision plane stays at its rest position.',
				'The tilt is the machine’s own: the wheel, the slider and a drag steer the selected platform’s reflector, every platform’s reflector answers a ball off its own tilt, and the ballistic computer draws the flight against it.',
				'The slider covers the whole range, and a wheel notch over the chamber steps about 4°.'
			],
			keys: [
				['Slider', '−10° to +10°'],
				['Wheel over chamber', 'About 4° a notch'],
				['Drag in open air', 'Follows the pointer; left or up raises the angle']
			]
		},
		{
			id: 'autopilot',
			label: 'Autopilot',
			title: 'Autopilot duties',
			text: [
				'Four independent duties, each a checkbox and a shortcut. A duty yields to the manual command that does the same job — A/D or a travel click takes the intercept, Space takes the drive, the slider, wheel or drag takes the tilt — and resumes after two seconds of simulation time without manual input.',
				'The chase puts the reflector centre on the predicted landing and stops there. The timed intercept spends the whole flight time arriving as the ball does, rolling through the mark when that is the slower run.',
				'The drive keeper pulses only when the passive bounce would fall short of the ceiling, which holds the ball within one pulse of the top, and it releases a caught ball. The level bounce slews the tilt at 45°/s so the next reflection leaves straight up.',
				'Only the checkbox or its shortcut switches a duty off, and the status line says “manual override” while a duty is suspended. With Trajectory computer II both intercept modes time economically and look through rock rebounds to the next landing.',
				'With more than one ball the clause names the one being worked (`ball 1/2`) and says when the landing is out of reach: the rig stops promising an intercept it cannot make and turns the run into the pickup that follows the grounding. A ball already on the floor is a sure catch, so it is worked whenever no landing can be met; a second flight it cannot reach costs nothing by waiting.'
			],
			keys: [
				['X', 'Chase the predicted landing'],
				['⇧X', 'Timed intercept · economy brake'],
				['Z', 'Drive keeper · reach the top, no more'],
				['C', 'Level bounce · reflect straight up']
			]
		},
		{
			id: 'charge',
			label: 'Charge',
			title: 'Recovery and charge',
			text: [
				'Ground contact dissipates all ball energy at the default GROUND setting. Move over the ball to collect it, then release it; the drive is already on unless you switched it off. GROUND in the system bar can instead keep half or all of the impact energy, so the ball rebounds by itself — see the Ground topic.',
				'Park on the centre strip of the ground to refill the reserve at 3 kW — 4 s from empty to full, free of charge.',
				'Out of reach? The market’s emergency import buys energy at 25 cr/kJ up to the full 12 kJ, limited by the funds at hand. An empty reserve still hand-cranks at 0.8 m/s: movement only, no launch.',
				'While the reserve is low and the platform is on the ground, the status bar at the foot of the page repeats both ways out; a grounded ball is announced there in orange until it is collected.'
			]
		},
		{
			id: 'progression',
			label: 'Sci+Shop',
			title: 'Science and shop tree',
			text: [
				'One tree combines technology research and the equipment each node unlocks for the selected player. Every platform has its own purse, completed nodes, owned tiers and installed effects; nothing researched or bought for one player unlocks it for another. Base chassis gear — the road grader, engine powertrain bay and commercial grader bot — sits at the root and needs no research.',
				'The road grader belongs to the rig alone: a competitor’s chassis already harvests the rubble it drives over, so its row reads Locked for every rival and the refusal explains why instead of naming a prerequisite the item does not have.',
				'Researching a node debits the selected player’s funds once, applies its measured bonus to that machine immediately, and unlocks the shop slot attached inside that node. Tiered families (engines, cooling radiators and strike balls) fit one unit at a time and swap owned tiers for free; engines are fitted while parked at the left shop.',
				'Blocked controls stay clickable and explain why in the status bar above the tree. Live platform specifications update in place as deltas stack. Communism mode drops every price and prerequisite; test mode grants the whole tree and shop to every player at once.',
				'The ballistic computer must be researched by the selected platform itself: without that purchase it has no page overlay, even if another player owns one. Its overlay, its landing readout, its ghost and its release all address the platform whose controls you hold, and the autopilot’s own flight never replaces them — with the rig selected too. It draws every ball that platform may push and stops at the second bounce, using the chamber’s own reflector and collector answers.'
			]
		},
		{
			id: 'cargo',
			label: 'Cargo',
			title: 'Cargo and storage',
			text: [
				'Storage holds 100 cells at 0.6 kg each. A full load equals the dry platform mass, so cargo slows acceleration and participates in capture momentum, braking and kinetic energy.',
				'Fragments are caught only by the amber collector; the rest pile up on the floor heightmap as lost rubble. The road grader works a 1.5 m swath under the platform centre and shaves that rubble back down, and the blade keeps half of the shaved value for its owner — booked as one settlement when the swath goes quiet rather than thrown away.',
				'The commercial grader calls the free garage bot on the right bay instead: it sweeps wall to wall and pays a 50% share of everything it lifts. Calling it first is the strongest opening the economy has measured; the road grader is a later purchase, because its 300 cr and its rolling resistance buy the most once the drive and pulse chain already carries them.',
				'Touch either wall marked SELL with a load aboard to sell it in one go.'
			]
		},
		{
			id: 'players',
			label: 'Players',
			title: 'Competitors and the scoreboard',
			text: [
				'The strip under the telemetry lists every platform at the mine, one line per player. The rig is YOU; the others are independent competitors that work the same floor rubble and keep their own credits, research and installed upgrades. Every platform is the same complete machine — chassis, deck, wheels, 45° plates, fuel bar, thermometer, collector strip and reflector piston, in the same colours — and the selected one is drawn whole while the others are the same drawing at 60% opacity. Nothing is added to a platform and nothing is taken away.',
				'Click a line to take that platform’s controls. The force setting, A/D, the brake, the low-ground travel click, the bounce drive, the piston tilt and the rig autopilot duties stay with the rig, and only the panel title changes with the switch (`YOU · MANUAL` → `RIVAL 1 · BOT`): the menu itself never rearranges. No key reaches a platform you are not driving, and a direction key held during a switch is dropped with the command it gave, so neither platform can move on a key pressed for the other.',
				'BOT hands a platform to its policy, and both platforms play the ball the same way. A bot competitor meets the ball it may push, sweeps nearby rubble while the flight is safely away and returns before contact, scoops floor balls, uses its own tilt keeper to level the next reflection, and spends a pulse only while the reflected apex would still fall short of the rock; a ball its collector caught is released again at once, including while that rival is selected. Each sale is automatically invested in that competitor’s own deterministic build order, with unspent credits saved for the next purchase. That order buys only what the competitor’s policy reads — pulse, force, mass, then the forecast chain — so it never spends on the page overlay, the cooling chain, the strike-ball metallurgy or the brake flywheel. A bot rig runs the autopilot duties — the intercept, the drive keeper and the level bounce — and visits the centre pad when its reserve falls below 20%, resuming play at 95%. The RIG AUTOPILOT checkboxes always describe the rig; a rival’s BOT switch runs its own policy. Both make a selling trip to the nearer wall once their hopper is full, and both bank whatever they took on the way. Manual travel, tilt and drive temporarily suspend the matching competitor keeper. A ball the competitor may not push, and a ball another platform holds, are not in its world at all, so it holds station instead of wandering.',
				'Two platforms that meet do not collide like walls. Each body has a retractable 45° plate at both ends: folded while the other platform is far or moving away, swinging down at a limited rate as the gap closes, and clipped at the floor so the plate and the ramp the wheels follow are the same line. A plate stays down while the hulls overlap and folds once the other has cleared it, and a deck carrying a rider brings both of its plates down, so a rider drives off an end instead of dropping off a ledge. The wheels sit at the hull’s ends and the underside between them arches up, so a wheel takes the ramp and the machine does not beach itself on a flat keel with a wheel in the air. The platform applying more drive power starts the climb; the other stays on the floor and is driven over. Once one hull is on top, the pair keeps that rider until the bodies part — braking or changing direction mid-crossing cannot swap them and make the hulls stutter through each other. Their credits never enter the rig’s ledger.'
			],
			keys: [
				['Click a player line', 'Take that platform’s controls and its force setting'],
				['Selected platform', 'Drawn whole; every other platform is the same complete machine at 60% opacity'],
				['BOT checkbox', 'Let that player’s policy drive it'],
				['45° plate', 'Unfolds as a platform closes in, stays down while it is ridden, folds when it leaves'],
				['Higher force', 'Starts the climb; the rider stays on top for the crossing'],
				['Complete machine', 'Every platform carries the same instruments, dimmed when not selected']
			]
		},
		{
			id: 'market',
			label: 'Market',
			title: 'Market and ledger',
			text: [
				'Touching either SELL wall sells the whole load automatically. This rig panel breaks the rig’s cargo and lifetime sales down by mineral, and its ledger records every rig sale, purchase, research payment and recharge. Competitor purses and purchase ledgers stay separate.',
				'The emergency resupply imports energy instantly at the price shown, buying only what the funds cover; the centre pad remains the free route.',
				'For the rig, sales, spending and imports all move one funds balance, so this ledger and the funds card always agree.'
			]
		},
		{
			id: 'modes',
			label: 'Modes',
			title: 'Communism and test mode',
			text: [
				'Communism mode makes everything free: research, equipment and bought energy cost nothing and the research tree stops gating anything. Prices read FREE, the funds card reads commons, and sales are still measured and recorded.',
				'Test mode researches every technology and installs every equipment item for every player at once, without cost or prerequisites, applying the normal measured effects to each machine. Grants stay in place when the mode is switched off and clear on New game.',
				'Both are modes rather than world state, so New game keeps them selected.'
			]
		}
	];

	function find(id) {
		for (const topic of topics) if (topic.id === id) return topic;
		return undefined;
	}

	const api = { topics, find };
	root.SteamHelp = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
