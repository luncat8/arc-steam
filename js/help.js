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
				'Game keys work anywhere on the page; pressing one releases the focused button or slider first, so Space never double-fires a control.',
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
				'BALLS in the system bar sets what is in the chamber. One shared ball is the classic game: a single ball both platforms may push, and only the rig can catch it in its collector and pulse it with its reflector.',
				'Two shared balls put two balls in flight at once and both platforms may push either of them. The rig still holds one at a time, and its autopilot, ballistic overlay and ball readouts follow the ball that will reach the platform sooner, so the second ball never splits the plan.',
				'One per platform gives every platform its own ball. Ownership is the collision rule: a platform cannot see, catch, bounce or pulse a ball it does not own, so the rig’s collector passes straight through a competitor’s ball and that competitor’s deck passes straight through the rig’s.',
				'A competitor keeps its own ball alive with its bounce drive — the deck returns the ball and a pulse of the rig’s base size is added while the ball is coming down — and scoops a grounded ball back up by driving over it. Its ball breaks the same ceiling rock, the debris lands as floor rubble, and its blade harvests that rubble into its own purse. Competitor balls and pulses are outside the rig’s energy ledger, exactly like the commercial grader.'
			],
			keys: [
				['1 shared', 'One ball, both platforms push it, the rig catches it'],
				['2 shared', 'Two balls in play, the autopilot plans for the sooner one'],
				['1 per platform', 'Each platform pushes only its own ball'],
				['Competitor ball', 'Mines rock, leaves rubble, pays its owner only']
			]
		},
		{
			id: 'chamber',
			label: 'Chamber',
			title: 'The chamber',
			text: [
				'The chamber is 24 × 15 m. A ball bounces on the platform deck and off the ceiling; the sprung reflector piston sends it where you aim it.',
				'Clicks have three meanings, and the zones never overlap: visible rock inspects a cell, the low band near the ground (the drawn 1.7 m target height) commands travel, and open air starts a piston drag.',
				'The recessed bay on the right is the road grader’s garage; a called grader works the floor and returns there.'
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
				'Only the checkbox or its shortcut switches a duty off, and the status line says “manual override” while a duty is suspended. With Trajectory computer II both intercept modes time economically and look through rock rebounds to the next landing.'
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
				'Ground contact dissipates all ball energy. Move over the ball to collect it, then release it; the drive is already on unless you switched it off.',
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
				'One tree combines technology research and the equipment each node unlocks. Base chassis gear — the road grader, engine powertrain bay and commercial grader bot — sits at the root and needs no research.',
				'Researching a node debits funds once, applies its measured bonus immediately, and unlocks the shop slot attached inside that node. Tiered families (engines, cooling radiators and strike balls) fit one unit at a time and swap owned tiers for free; engines are fitted while parked at the left shop.',
				'Blocked controls stay clickable and explain why in the status bar above the tree. Live platform specifications update in place as deltas stack. Communism mode drops every price and prerequisite; test mode grants the whole tree and shop at once.'
			]
		},
		{
			id: 'cargo',
			label: 'Cargo',
			title: 'Cargo and storage',
			text: [
				'Storage holds 100 cells at 0.6 kg each. A full load equals the dry platform mass, so cargo slows acceleration and participates in capture momentum, braking and kinetic energy.',
				'Fragments are caught only by the amber collector; the rest pile up on the floor heightmap as lost rubble. The road grader works a 1.5 m swath under the platform centre and shaves that rubble back down.',
				'Touch either wall marked SELL with a load aboard to sell it in one go.'
			]
		},
		{
			id: 'players',
			label: 'Players',
			title: 'Competitors and the scoreboard',
			text: [
				'The strip under the telemetry lists every platform at the mine, one line per player. The rig is YOU; the others are competitors that work the same floor rubble with a blade and keep their own credits. Every player drives the same machine — only the colour and the policy differ, and an idle platform is drawn dim.',
				'Click a line to take that platform’s controls. The force setting, A/D, the brake and the low-ground travel click all move to it, the panel retitles itself and its summary line names the player, its force, its load and its policy. The ball, piston and autopilot belong to the rig and disable while a competitor is being driven; the reserve, heat and shop cards always describe the rig.',
				'BOT hands a platform to its policy, and both platforms play the ball the same way. A bot competitor stands where the ball it may push is coming down, meets it on its flat deck, drives over a ball on the floor to scoop it up, and spends a pulse only while the passive bounce would still fall short of the rock. A bot rig runs the autopilot duties — the intercept, the drive keeper and the level bounce. Both make a selling trip to the nearer wall once their hopper is full, and both bank whatever their blade or collector took on the way. A ball the competitor may not push, and a ball already held in the rig’s collector, are not in its world at all, so it holds station instead of wandering.',
				'Two platforms that meet do not collide like walls. Each body has a retractable 45° plate at both ends: folded while the other platform is far or moving away, swinging down at a limited rate as the gap closes, and clipped at the floor so the plate and the ramp the wheels follow are the same line. The platform applying more drive power is the one that rides on top; the other stays on the floor and is driven over. Their credits never enter the rig’s ledger.'
			],
			keys: [
				['Click a player line', 'Take that platform’s controls and its force setting'],
				['BOT checkbox', 'Let that player’s policy drive it'],
				['45° plate', 'Unfolds as a platform closes in, folds when it leaves'],
				['Higher force', 'The platform that climbs over the other']
			]
		},
		{
			id: 'market',
			label: 'Market',
			title: 'Market and ledger',
			text: [
				'Touching either SELL wall sells the whole load automatically. The panel breaks cargo and lifetime sales down by mineral, and the ledger records every sale with its mix, every purchase, every research payment and every recharge.',
				'The emergency resupply imports energy instantly at the price shown, buying only what the funds cover; the centre pad remains the free route.',
				'Sales, spending and imports all move one funds balance, so the ledger and the funds card always agree.'
			]
		},
		{
			id: 'modes',
			label: 'Modes',
			title: 'Communism and test mode',
			text: [
				'Communism mode makes everything free: research, equipment and bought energy cost nothing and the research tree stops gating anything. Prices read FREE, the funds card reads commons, and sales are still measured and recorded.',
				'Test mode researches every technology and installs every equipment item at once, without cost or prerequisites, applying the normal measured effects. Grants stay in place when the mode is switched off and clear on New game.',
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
