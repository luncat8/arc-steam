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
				['Click rock', 'Inspect that cell'],
				['Click low ground', 'Set a travel target'],
				['Hover or tap rock view', 'Change what the rock is coloured by']
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
			id: 'research',
			label: 'Research',
			title: 'Technology',
			text: [
				'Research debits funds once, applies its measured effect immediately, and unlocks the equipment that needs it. A node stays locked until every prerequisite is researched.',
				'A refused purchase always says why: a missing prerequisite reads Locked, an unaffordable node stays Research and is marked blocked.',
				'Communism mode makes every node free and drops the gates; test mode grants the whole tree at once.'
			]
		},
		{
			id: 'equipment',
			label: 'Equipment',
			title: 'Equipment and specification',
			text: [
				'Purchases debit funds and install at once. Each row states what buying it changes, and the installed specification above them is the live sum of base tuning plus every research and equipment delta.',
				'Radiator and ball tiers share one installed unit: fitting a tier swaps the previous one together with its mass and its cooling or damage change. Engines are bought at the left garage.',
				'Mass is real: dry mass sets acceleration, so a heavier platform reaches the same force more slowly.'
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
			id: 'inspector',
			label: 'Inspector',
			title: 'Mineral inspector',
			text: [
				'Click visible rock to inspect that cell. The outline marks the selection; the readout names the column and layer, the remaining fracture energy, the mineral mix and the cell value.',
				'Strength is the fracture energy still needed, in joules, and a depleted cell emits material only once.',
				'Rock view shows minerals, elemental R/G/B, price or remaining strength; hover a mode, tap it, or use the arrow keys while one has focus.'
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
