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
				['R', 'Fire from the selected player’s installed rack'],
				['F', 'Throw a sand grain from the selected player’s nozzle; hold to keep the stream'],
				['G', 'Spray a water droplet from the selected player’s gun; hold to keep the jet'],
				['V', 'Wild Mine only · hammer the aimed tunnel ahead while held'],
				['X', 'Autopilot · chase the predicted landing'],
				['⇧X', 'Autopilot · timed intercept'],
				['↑ / ← / →', 'Wild Mine only · jump and run the P2 ball'],
				['Z', 'Autopilot · drive keeper'],
				['C', 'Autopilot · level bounce'],
				['M', 'Communism mode'],
				['H / F1', 'Open or close this help drawer'],
				['Escape', 'Close this help drawer'],
				['Wheel over chamber', 'Tilt the piston about 4° a notch'],
				['Drag in open air', 'Tilt the piston; left or up raises the angle'],
				['Hover over rock', 'Inspect its mix, value and remaining strength'],
				['Click low ground', 'Set a travel target'],
				['Rock view bar', 'Change what the rock is coloured by'],
				['F4', 'Show or hide each ball’s damage radius']
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
				'A competitor keeps its own ball alive with its own deck: the collector catches it, the reflector bounces it off the competitor’s tilt, a pulse from its own upgraded machinery is added while the reflected ball would fall short of a full strike on the rock, and a grounded ball is scooped back up by driving over it. Its owned ball uses its own strike-ball tier and breaks the same ceiling rock; the debris lands as floor rubble, and its chassis harvests that rubble into its own purse. Competitor balls, catches and pulses are outside the rig’s energy ledger, exactly like the commercial grader.'
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
			id: 'perspective',
			label: 'Perspective',
			title: 'Depth scale: one size for the picture and the ball',
			text: [
				'The chamber is drawn through a vertical perspective: true size at the floor and up to the near edge of the rock layer at 11.375 m, then compressed to a quarter at the roof, so a cell high in the layer is drawn small. PERSPECTIVE in the system bar decides whether the ball obeys that same law. Depth scale makes the ball the size of the cells around it — the radius it is drawn at is the radius it collides at, the height it rests on a deck, the gap it keeps to a wall and to the roof, and the clearance the ballistic computer flies it through. Constant size is the classic 0.18 m sphere everywhere.',
				'Below the rock layer both settings fly exactly the same ball, because the law is 1× there: the floor game is untouched either way. The difference shows when a ball is up in the layer, where Depth scale makes it a smaller body in a smaller-looking world instead of a full-size ball in front of a shrunken one. The setting is a chamber rule and survives New game, like the rock shape and the ball arrangement.',
				'A strike footprint is measured in cells, not in ball radii, so it does not shrink with the ball: F4 rings each ball with its owner’s own damage radius, foreshortened by the chamber’s local scale so the ring lies on the same plane as the ball.'
			],
			keys: [
				['Depth scale', 'The ball is drawn and collided at the chamber’s own scale'],
				['Constant size', 'The classic 0.18 m ball at every height'],
				['F4', 'Show or hide each ball’s damage radius']
			]
		},
		{
			id: 'debris',
			label: 'Debris',
			title: 'Debris Y compression and the pile ceiling',
			text: [
				'Fallen rubble is a heightmap of soil layers under every column. DEBRIS in the system bar says how many times wider than tall one layer is drawn. The layer thickness is the cell width divided by that number: 4 gives the classic 4:1 tile, 0.125 m by 0.03125 m; 1 gives square rubble, 8 a layer four times thinner still, so the same material stands twice as tall at 2 as at 4 and half as tall at 8.',
				'The number is not just a picture. Changing it re-lays the rubble already on the floor at the new thickness, so a pile that was four thin layers deep becomes one square tile and the surface the ball and the platform ride moves with it — the ground never lags behind what is drawn. A pile may stand as high as the roof: the chamber’s ceiling is the only level a column cannot pass, so with enough rock brought down the rubble can bury the whole flight room. A setting that would push a column through the roof keeps what fits and books the rest as lost, exactly like a deposit at that limit.',
				'Wild Mine starts at 1.5:1. Each exposed ledge has its own soil layer; the ball and wheels ride its crest. Mine out the rock under a pile and the soil drops to the next ledge. Rock overhead caps the layer. Hitting soil spreads a fifth of the normal fracture budget into the rock below it instead of destroying the soil.',
				'Except for material that cannot fit below a roof, compression changes height, not cells or value. Each mode remembers its own setting.'
			],
			keys: [
				['1', 'Square rubble: 0.125 m of height per cell'],
				['4', 'The classic 4:1 floor tile, 0.03125 m per cell'],
				['8', 'The flattest sheet, 0.015625 m per cell'],
				['Roof', 'The only cap: rubble may fill the chamber']
			]
		},
		{
			id: 'chamber',
			label: 'Chamber',
			title: 'The chamber',
			text: [
				'The chamber is 24 × 15 m. A ball bounces on the platform deck and off the ceiling; the sprung reflector piston sends it where you aim it. Every upward bounce off a platform deck or elastic ground feeds one fresh row of rock smoothly in from the top, and deep shafts near the roof also pull in fresh strata so a ball’s full damage radius stays inside the chamber (capped at 5 rows/s, stopping without destroying lower rock once 30% of the chamber height remains below).',
				'The amber collector catches only when it is empty: a ball arriving while it already holds one is returned off the flat strip instead. The green piston reflects through the same impulse solve the ballistic computer uses, so a forecast through a tilted bounce follows the ball’s real flight.',
				'Clicks have three meanings, and the zones never overlap: visible rock inspects a cell, the low band near the ground (the drawn 1.7 m target height) commands travel, and open air starts a piston drag.',
				'The recessed bay on the right is the road grader’s garage; a called grader works the floor and returns there.',
				'Initial strength and Remaining strength share one absolute scale and one warm ramp, so an undamaged cell reads the same in both. Damage shows strength removed by impacts on that scale; looseness is a separate measure used for collapse. Weak rock loosens more easily. An exposed cell can fall only when it is loose and its remaining strength is below the debris limit (0.8 J/cell): the Remaining strength view greys out exactly those cells, while rock that still holds stays warm, so grey means rubble. Sand forms already below the limit, so it is grey from the start and lets go as single grains. The lower the remaining strength, the faster a cell can fall. Rock behind the face remains held until exposed.',
				'Rock is not cleared at once. A blow spends at most half of a cell’s strength and leaves the ring around it standing; only the free face then lets go, so a piece never falls out of the inside of the rock. The mineral growth sliders run from 10% to 500% and mix two releases: at 10% a fall is the plain clump of loose free faces the rock always gave, and as the setting rises more of the piece is a connected, mineral-matched flake that leaves in one solid group; larger groups also release less often. Sand sits at the 10% floor, so it leaves as separate grains, while a high setting keeps a seam together as heavy flakes. There is one slider for each row of the shared mineral table, built from that table so a new material needs no new markup. Generate test rock lays pure mineral bands from strongest left to weakest right, with pre-applied damage increasing from zero at the top to 100% damage at the bottom. Fully damaged cells remain until they collapse; this is not one ordinary hit. Weak bands loosen and fall more readily; hover over rock to inspect its mix, value and remaining strength. The three element fields are independent concentrations and are compressed vertically, so a mineral range forms a flat seam rather than a round patch; a narrow range is a rare mineral.'
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
				'The drive is on by default. The stock piston delivers 42 J per pulse, drawing 52.5 J from the electric reserve at 80% efficiency. The drive coil and piston ram increase the pulse.',
				'In the classic chamber, three powered bounces from a stock release reach the ceiling, and the drive only pulses on contact, so it never fights the passive bounce.',
				'The drive heats with work. A hot drive is derated and a cut-off drive produces nothing until it cools; the temperature card tags HOT and CUTOFF.',
				'In Classic, the line below Release estimates credits per kJ. In Wild Mine it shows the next available pulse after heat and reserve limits. Last fracture is work actually spent weakening rock on the last hit, even if no cell came loose.'
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
				'B holds the mechanical brake without reversing. Its friction follows platform mass, not the force slider, engine, fuel or temperature. With the brake flywheel installed, brake work returns to the reserve; collision heat does not.',
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
				'The reflector is a sprung piston whose face tilts ±10° in Classic or ±90° in Wild Mine. A positive angle raises the right edge and sends a falling ball left, so drag towards where the ball should go — left or up raises the angle.',
				'Each contact compresses the piston in proportion to normal impact speed (0.024 m per m/s, capped at 0.16 m) and a damped spring pushes it back out. Compression is drawn only; the collision plane stays at its rest position.',
				'The tilt is the machine’s own: the wheel, the slider and a drag steer the selected platform’s reflector, every platform’s reflector answers a ball off its own tilt, and the ballistic computer draws the flight against it.',
				'The slider covers the whole range, and a wheel notch over the chamber steps about 4°.'
			],
			keys: [
				['Slider', '±10° in Classic · ±90° in Wild Mine'],
				['Wheel over chamber', 'About 4° a notch'],
				['Drag in open air', 'Follows the pointer; left or up raises the angle']
			]
		},
		{
			id: 'ball',
			label: 'Wild ball',
			title: 'Wild Mine ball player · P2',
			text: [
				'In Wild Mine the ball is the second player: a rigid sphere with moment of inertia 2/5 m r² and its own onboard battery. It rests in the collector until E releases it, then ← and → apply spin torque in either direction. On rock, surface friction turns that spin into rolling; release the motor and rolling resistance plus a rest snap stop both the roll and leftover spin, even when the ball is sitting against a wall. In mid-air there is no friction and no translational mass to push, so the motor winds spin up 3.5× faster and to a higher free speed. When a spinning ball hits a floor, wall, ceiling or deck, Coulomb friction bites in proportion to the normal impact force — kicking topspin forward, checking backspin, climbing walls or skidding and carrying leftover spin into the next bounce.',
				'The jump actuator works like the platform’s bounce drive: switching it on (the Jump actuator button or ↑) feeds battery energy into the actuator, kicking off from a roll along the contact normal while keeping tangential speed and spin, and boosting every subsequent rock bounce until switched off or drained.',
				'Recycle bounce energy (the checkbox or ↓) acts like the platform’s regenerative brake flywheel: it actively damps rebounds to stop bouncing quickly and returns 55% of the damped energy to the ball battery at 90% efficiency, venting the rest as heat while leaving the roll intact. Engaging jump switches recycling off, and engaging recycling switches jump off.',
				'The rig’s reserve powers releases and front-face piston pushes. Only the collector catches the ball. The ball battery recharges by induction while held or resting on the deck. Smooth contacts below 0.35 m/s roll without damage. On a hard hit the stock ball loses 10% of its normal energy to fracture and heat. Strike heads trade rebound height for more fracture on rock; they do not change deck retention.'
			],
			keys: [
				['← / →', 'Spin motor left or right — rolls on rock, winds up fast in mid-air'],
				['↑', 'Toggle jump actuator on or off (powered bounce pulses)'],
				['↓', 'Toggle bounce energy recycling (active damper + battery recovery)'],
				['E', 'Release the held ball along the tilted reflector face'],
				['Deck', 'Amber collector catches · green piston reflects']
			]
		},
		{
			id: 'fuel',
			label: 'Wild fuel',
			title: 'Wild Mine fuel from cargo and condensate',
			text: [
				'Wild Mine has no charge pad or refuelling wall, so the installed engine burns what you collect instead. It keeps the reserve topped up at its own reload rate, in the same seconds-to-full the centre pad would take: oil refills fastest, then electric, nuclear and coal. Tools that draw more power than that run the reserve buffer down, exactly as a pad-fed machine would.',
				'Each engine burns one family and the families are deliberately small: coal and electric burn stone and sand (the coal them in the cave), oil burns fizzy halite and vitriol, and nuclear burns gas rock. Nothing else is fuel — ore stays ore and sells, it does not heat the boiler. Each family has its own chemical energy per kilogram, so a fizzy-rich hopper is worth far more to the oil engine than host rock is to the coal one.',
				'A burn takes the cheapest loaded cell per joule in its own family first, using the live market quote, so ore stays in the hopper whenever cheaper fuel is beside it. The removed cell loses its sale value, its chemical energy enters the reserve, and the gravitational potential that was already counted is reconciled against the imported share, so the energy-balance readout stays exact.',
				'Oil uses condensate from the water tank first (24 kJ/kg), then the cheapest compatible cargo. It does not burn spray water. If the oil reserve is flat, park over a blue seep with the intake on: the crew hand-pumps slowly until the engine has enough condensate to restart.',
				'The service cart that buys your load keeps back 20% of every fuel-grade mineral — stone, sand, fizzy halite, vitriol and gas rock — so the engine can always be refuelled from the hopper. Everything else sells out in full.'
			],
			keys: [
				['Coal / Electric', 'Solid fuel · stone, sand'],
				['Oil', 'Tank condensate, then fizzy halite or vitriol'],
				['Nuclear', 'Fissile fuel · gas rock'],
				['Cargo fuel', 'Cheapest compatible cell per joule first'],
				['Service cart', 'Keeps 20% of fuel-grade cargo for the engine, sells the rest'],
				['Hand', 'No fuel cycle · the crew can still crank the platform']
			]
		},
		{
			id: 'autopilot',
			label: 'Autopilot',
			title: 'Autopilot duties',
			text: [
				'Four independent duties, each a checkbox and a shortcut. A duty yields to the manual command that does the same job — A/D or a travel click takes the intercept, Space takes the drive, the slider, wheel or drag takes the tilt — and resumes after two seconds of simulation time without manual input.',
				'The chase puts the reflector centre on the predicted landing and stops there. The timed intercept spends the whole flight time arriving as the ball does, rolling through the mark when that is the slower run.',
				'The drive keeper pulses only while the passive bounce would fall short of a full strike on the rock — a passive apex one pulse of height past the ceiling line, so the ball meets the face with real speed instead of a bare touch — and it releases a caught ball. A bounce that already clears the strike line is left passive. The level bounce slews the tilt at 45°/s so the next reflection leaves straight up.',
				'Only the checkbox or its shortcut switches a duty off, and the status line says “manual override” while a duty is suspended. With Trajectory computer II both intercept modes time economically and look through rock rebounds to the next landing.',
				'With more than one ball the clause names the one being worked (`ball 1/2`) and says when the landing is out of reach: the rig stops promising an intercept it cannot make and turns the run into the pickup that follows the grounding. A ball already on the floor is a sure catch, so it is worked whenever no landing can be met; a second flight it cannot reach costs nothing by waiting.'
			],
			keys: [
				['X', 'Chase the predicted landing'],
				['⇧X', 'Timed intercept · economy brake'],
				['Z', 'Drive keeper · hit the rock hard'],
				['C', 'Level bounce · reflect straight up']
			]
		},
		{
			id: 'rockets',
			label: 'Rockets',
			title: 'Rockets',
			text: [
				'Rockets are consumables for an installed Rocket rack, an optional shop item unlocked by Impact forging. No player starts with a rack. Each platform owns its installed rack, stock, purchase ledger and auto-buy order; the controls act on the selected platform. A round leaves the tube in that platform’s collector, climbs straight up and bursts like a firework. Each shard chips a patch one to four cells wide with the same weakening rule as a ball strike. The loosened rock falls as ordinary debris: the rig can catch it in its collector, while a rival harvests material that settles as floor rubble.',
				'The fuse is cut for the rock face above the tube, give or take 20%. A long fuse bursts on contact and concentrates the shards; a short one bursts early in the open and spreads them thin. About one rocket in twenty is a dud: its fuse fails, it falls back and bursts on whatever ground or deck it lands on.',
				'Rounds are loaded only while that platform touches a SELL wall, and the purchase debits its own purse. Each rack holds 6. With auto-buy on, every wall visit buys up to 3 after cargo is sold, never past the rack or beyond available funds. The per-player order survives New game, but each installed rack and its stock reset. A rocket carries its own charge: it draws nothing from the reserve and adds no heat.',
				'The 14 cr round is calibrated so a shot into common rock roughly pays for itself. The profit is in rich seams, a burst close under the rock and catching or harvesting the loosened material.',
				'Bots can use an installed, loaded rack. The rig works it after selling and recharging: it travels to the richest reachable seam, fires one rocket, then holds the collector beneath the burst before returning to the ball. A rival bot also takes a seam trip when its rack is ready; a full hopper interrupts that trip so selling takes priority, while the drive and tilt keepers continue playing the ball. Auto-buy remains each player’s standing order.'
			],
			keys: [
				['R / Fire', 'Launch one rocket from the selected player’s rack; reloads in half a second'],
				['Buy', 'Load one rocket for that player at a SELL wall'],
				['Auto-buy', 'Up to 3 rockets at each wall visit, from that player’s funds']
			]
		},
		{
			id: 'sandblaster',
			label: 'Sandblaster',
			title: 'Sandblaster',
			text: [
				'The sandblaster is an optional platform tool unlocked by Impact forging, like the rocket rack. Installed in a player’s collector, it throws a stream of abrasive grains up at the ceiling. Nothing is bought for it: the abrasive is the debris already in that player’s hopper. Every grain is 20 g of sand, or of stone once the sand is gone, and takes a fixed share of the reserve: 135 J per grain of launch work at up to 20 grains a second (2.7 kW useful, drawn through the installed engine’s efficiency — 168.75 J per grain or 3.4 kW on stock electric, with motor loss becoming heat). The mine’s energy ledger sees the full cost of the throw. Ores are never thrown, and a hopper holding neither sand nor stone leaves the nozzle dry.',
				'Each grain is a live particle, not a streak: it inherits the platform’s horizontal and vertical speed when fired, then flies ballistically under gravity — no motor, no fuse, and no following a later change in platform speed. It chips the rock face through the chamber’s ordinary weakening rule: at most half a cell’s strength per blow across a one-cell radius, so a seam needs several hits and one grain never brings a cell down by itself. The grain then falls back as the debris it is. Any platform whose collector it crosses catches it into its own hopper, with the value it left with; a grain that misses is spilled onto the floor rubble, where a grader can still pick it up. Holding station or a steady cruise keeps the abrasive cycling.',
				'The nozzle stops while the hopper is full or the machine is at thermal cutoff, and starts again after a sale or once it cools — selling also clears the abrasive, so the next seam has to feed it first. Your Auto-fire order survives New game and holds when the rig’s reserve falls below 20%; a hand throw is still allowed. Weak starter packs drain in a few seconds, while upgraded engines and radiators run it continuously. BOT turns on a separate, temporary stream only with abrasive and an engine whose pad refill power can sustain its draw; the rig starts its charge trip early, and BOT pauses the nozzle for service trips or overheating. Uncheck Auto-fire to pause a bot stream until you cycle BOT. At the paid emergency import price this high-power stream loses credits on ordinary rock; the return line under the nozzle prices the rock face ahead in cr/kJ so you can stick to free pad power or rich ore seams.'
			],
			keys: [
				['F / Blast', 'Throw one grain; hold to keep the stream going'],
				['Auto-fire', 'Keep the stream going while the hopper holds sand or stone']
			]
		},
		{
			id: 'water',
			label: 'Water gun',
			title: 'Water gun and the pump',
			text: [
				'The water gun is the third optional platform tool, unlocked by Hydrology (900 cr, +9 kg) and installed per player like the rack and the sandblaster. In Classic water is unlimited. Pressurizing a droplet puts 36 J of useful work into up to 46 droplets a second (1.66 kW useful), drawn from the owner’s reserve at the installed engine’s efficiency (45 J per droplet or 2.07 kW on stock electric). The jet is aimed at the pointer and inherits the platform’s speed at launch, so a nozzle on the move throws a leaning stream. A press throws one droplet; holding `G` keeps the stream going, and the Auto-fire order holds back below 20% reserve or at thermal cutoff.',
				'In Classic, water barely chips hard rock, but it dissolves certain minerals on contact. Each droplet that strikes a face washes it chemically: a soft seam gives way in a few hits while quartz, corundum and ore barely move. A dissolved cell splits three ways — brine into the water, gas into the air, and anything insoluble left as a residue clump that stays standing until the binder under it is gone, then falls as ordinary debris. Gas driven out of a seam is lost for good: it cannot be caught wet, so a fizzy seam pays less under the gun than a dry hammer would. Brine saturates: a stagnant pool stops cutting once its load reaches the chemistry cap, which is why the pump is part of the mining loop rather than an optional extra.',
				'The Classic under-hull pump reaches from beneath the chassis up to the deck while a water gun is fitted. It lifts up to 2.6 water units a second and their dissolved cargo into that player’s hopper as material — the water itself goes back to the tank — at 120 J of useful work per water unit (150 J/unit or up to 0.39 kW on stock electric, billed at engine efficiency). Checking Idle pump on shallow fresh water switches the pump to solute-gated mode: it skips shallow fresh floor puddles while still lifting concentrated brine and deep floods above the shallow floor layer, saving reserve energy and heat during parked washes. A full hopper, an empty reserve, or thermal cutoff stalls the pump instead of destroying solute or draining free power, and the wet residue grains are caught by a collector like any other debris while loose grains that miss join the floor rubble. A new chamber starts dry, with fresh water at 60 g per unit of dissolution capacity; both Pump orders are chamber settings like the view rules and survive New game. BOT runs its own temporary jet when engine power, reserve and temperature allow, leaving your Pump settings intact; uncheck Auto-fire to pause a bot jet until you cycle BOT.',
				'A droplet’s whole throw is booked as heat at the muzzle, the pump’s work as heat in the chamber, and a leached cell’s potential energy as heat when it goes, so the energy readout stays closed with the gun running. Every gram of dissolved rock is in a parcel, in the lost-gas counter, on the floor as a residue grain, or in the hopper, and the wet ledger can account for all of it. The live return line below the controls estimates expected recovered cr/kJ (and gas loss) at the current aim point and pump mode.',
				'Wild Mine has a 12 kg tank and a built-in intake, even without a water gun. Park over a blue seep with Collect liquid under the hull checked. The intake takes up to 2.6 kg/s at 120 J of useful work per kg (a slow hand pump works with an empty reserve). Tank liquid adds weight but takes no hopper space. Spray uses only the water; oil uses only the separated condensate. The Drain spray water button makes room without discarding fuel or spending reserve.',
				'Cave spray hits the cave surface and runs down to the floor below, where some can be collected again. Recovered spray is plain water and cannot fuel the oil engine. Cave-wide flow and mineral dissolution are not part of this loop; the full wet-mining chemistry remains in Classic.'
			],
			keys: [
				['G / Spray', 'Throw one droplet; hold to keep the jet going'],
				['Pointer over the chamber', 'Aim the nozzle — aiming never moves the platform'],
				['Auto-fire', 'Keep the jet running at the module’s own rate'],
				['Pump (Classic)', 'Lift water and its dissolved cargo from under the hull into the hopper'],
				['Collect liquid (Wild Mine)', 'Fill the water tank from cave seeps and runoff'],
				['Idle pump on shallow fresh water', 'Switch pump to solute-gated mode so shallow fresh puddles are skipped']
			]
		},
		{
			id: 'charge',
			label: 'Charge',
			title: 'Recovery and charge',
			text: [
				'Ground contact dissipates all ball energy at the default GROUND setting. Move over the ball to collect it, then release it; the drive is already on unless you switched it off. GROUND in the system bar can instead keep half or all of the impact energy, so the ball rebounds by itself — see the Ground topic.',
				'Park on the centre strip of the ground to refill the reserve free of charge in the installed engine’s reload window (6 s for the stock 22.8 kJ electric pack, 3 s for oil, 8 s for nuclear, 16 s for coal, 18 s for the hand crank; reserve scales with force and top-speed upgrades).',
				'Out of reach? The market’s emergency import buys energy at 25 cr/kJ up to the current reserve capacity, limited by the funds at hand. An empty reserve still hand-cranks at 0.8 m/s: movement only, no launch.',
				'While the reserve is low and the platform is on the ground, the status bar at the foot of the page repeats both ways out; a grounded ball is announced there in orange until it is collected.'
			]
		},
		{
			id: 'progression',
			label: 'Sci+Shop',
			title: 'Science and shop tree',
			text: [
				'One tree combines technology research and the equipment each node unlocks for the selected player. Every platform has its own purse, completed nodes, owned tiers and installed effects; nothing researched or bought for one player unlocks it for another. Base chassis gear — ramps, the road grader, engine powertrain bay and commercial grader bot — sits at the root and needs no research.',
				'Every player starts with Ramp installed. Install or uninstall it free for the selected player, anywhere in the chamber. Bots never change that choice. Ride-over works only while every player has a ramp; remove any one and all platforms push instead. The row says when an installed ramp is inactive because another player removed theirs.',
				'The road grader belongs to the rig alone: a competitor’s chassis already harvests the rubble it drives over, so its row reads Locked for every rival and the refusal explains why instead of naming a prerequisite the item does not have.',
				'Researching a node debits the selected player’s funds once, applies its measured bonus to that machine immediately, and unlocks the shop slot attached inside that node. Impact forging unlocks the strike-ball tiers and the Rocket rack; the rack is purchased equipment, while its 14 cr rounds are separate consumables bought at a SELL wall. Each player must research and install their own rack. Tiered families (engines, cooling radiators and strike balls) fit one unit at a time and swap owned tiers for free; engines are fitted while parked at the left shop.',
				'Live platform specifications lead the tree, above the base chassis. Hover a research or buy button to preview the row: the strip then reports the specification that row would deliver and signs the difference on each measure it would move — green where the measure improves, red where it costs, with the mass the one measure where less is better. A preview never spends or researches anything. On touch, the ✱ mark beside a button pins the same preview so the numbers can be read with the finger off the screen; tapping the mark again, or any change to the row itself, releases it.',
				'Blocked controls stay clickable and explain why in the status bar above the tree. Communism mode drops every price and prerequisite; test mode grants the whole tree and shop to every player at once.',
				'The ballistic computer must be researched by the selected platform itself: without that purchase it has no page overlay, even if another player owns one. Its overlay, its landing readout, its ghost and its release all address the platform whose controls you hold, and the autopilot’s own flight never replaces them — with the rig selected too. It draws every ball that platform may push and stops at the second bounce, using the chamber’s own reflector and collector answers.'
			]
		},
		{
			id: 'cargo',
			label: 'Cargo',
			title: 'Cargo and storage',
			text: [
				'Storage holds 100 cells at 0.6 kg each. A full load equals the dry platform mass, so cargo slows acceleration and participates in capture momentum, braking and kinetic energy.',
				'Fragments are caught only by the amber collector; the rest pile up on the floor heightmap as lost rubble. The road grader works a 1.5 m swath under the platform centre and shaves that rubble back down, and the blade keeps half of the shaved value for its owner — booked as one settlement when the swath goes quiet rather than thrown away. In Wild Mine the grader ships preinstalled with the machine; in the test chamber it is a purchase.',
				'In Wild Mine choose the blade mode: platform pitch follows the chassis, tunnel grade follows the bore’s signed climb or descent in the travel direction, and smooth redistributes rubble without shaving or paying a blade settlement. Work the 1.5 m swath by driving back and forth: loose material can fill connected rock steps and chamber drops into a ramp, but it cannot cut rock, bridge separate galleries, or create missing material. Angle-following modes still shave and settle the usual 50% share. The blade adds rolling resistance in every mode.',
				'The commercial grader calls the free garage bot on the right bay instead: it sweeps wall to wall and pays a 50% share of everything it lifts. Calling it first is the strongest opening the economy has measured; the road grader is a later purchase, because its 300 cr and its rolling resistance buy the most once the drive and pulse chain already carries them.',
				'Touch either wall marked SELL with a load aboard to sell it in one go.'
			]
		},
		{
			id: 'cart',
			label: 'Service cart',
			title: 'The Wild Mine service cart',
			text: [
				'Wild Mine has no SELL wall: the mine’s service cart does the buying. When the hopper fills — or once a minute while it is not empty — the cart arrives from the depot tunnel near the start of the section, drawn as a storyline cut-in rather than part of the cave: it comes out of the screen, docks beside the rig, and waits.',
				'Click the cart while it is there to sell the load: everything in the hopper is sold at the live quote except 20% of each fuel-grade mineral (stone, sand, fizzy halite, vitriol, gas rock), which stays aboard for the engine. One sale is booked in the ledger as a single entry. The cart lingers a moment and is gone until its next scheduled call.',
				'The “Service cart: autosell on arrival” checkbox sells automatically every time the cart appears, so a parked, working rig never has to be clicked. Uncheck it to sell manually. The cart keeps back the fuel reservation either way — autosell never sells the engine’s fuel.',
				'If the cart docks and the hopper holds nothing sellable beyond the fuel reservation, the call passes without a sale.'
			],
			keys: [
				['Click the cart', 'Sell the hopper at the live quote, minus the 20% fuel reservation'],
				['Autosell checkbox', 'Sell automatically at every arrival'],
				['Fuel reservation', 'Stone, sand, fizzy halite, vitriol and gas rock keep 20% by mass'],
				['Ledger', 'One frozen sale entry per call']
			]
		},
		{
			id: 'players',
			label: 'Players',
			title: 'Competitors and the scoreboard',
			text: [
				'The PLAYERS panel in the left column, above CARGO / STORAGE, lists every platform at the mine, one line per player. The rig is YOU; the others are independent competitors that work the same floor rubble and keep their own credits, research and installed upgrades. Every platform is the same complete machine — chassis, deck, wheels, 45° plates, fuel bar, thermometer, collector strip and reflector piston, in the same colours — and the selected one is drawn whole while the others are the same drawing at 60% opacity. Stock ramps are installed on every platform but may be removed in the shop.',
				'Click a line to take that platform’s controls. The force setting, A/D, the brake, the low-ground travel click, the bounce drive, the piston tilt and the rig autopilot duties stay with the rig, and only the panel title changes with the switch (`YOU · MANUAL` → `RIVAL 1 · BOT`): the menu itself never rearranges. No key reaches a platform you are not driving, and a direction key held during a switch is dropped with the command it gave, so neither platform can move on a key pressed for the other.',
				'BOT hands a platform to its policy, and both platforms play the ball the same way. A bot competitor meets the ball it may push, sweeps nearby rubble while the flight is safely away and returns before contact, scoops floor balls, uses its own tilt keeper to level the next reflection, and spends a pulse only while the reflected apex would still fall short of a full strike on the rock; a ball its collector caught is released again at once, including while that rival is selected. Each sale is automatically invested in that competitor’s own deterministic build order, with unspent credits saved for the next purchase. That order buys only what the competitor’s policy reads — pulse, force, mass, then the forecast chain — so it never spends on the page overlay, the cooling chain, the strike-ball metallurgy or the brake flywheel. A bot rig runs the autopilot duties — the intercept, the drive keeper and the level bounce — and visits the centre pad when its reserve falls below 20%, resuming play at 95%. The RIG AUTOPILOT checkboxes always describe the rig; a rival’s BOT switch runs its own policy. Both make a selling trip to the nearer wall once their hopper is full, and both bank whatever they took on the way. If fitted and loaded, the rig works its rack after selling and recharging, and a rival bot makes its own seam trip when ready (a full hopper keeps selling first); stock and auto-buy orders belong to each player. Manual travel, tilt and drive temporarily suspend the matching competitor keeper. A ball the competitor may not push, and a ball another platform holds, are not in its world at all, so it holds station instead of wandering.',
				'While every player has Ramp installed, platforms ride over each other instead of colliding. Each body has a retractable 45° plate at both ends: folded while the other platform is far or moving away, swinging down at a limited rate as the gap closes, and clipped at the floor so the plate and the ramp the wheels follow are the same line. The reach it unfolds over follows the closing speed, because a plate needs its own half second to swing, so a machine arriving fast is met by a full ramp rather than a half-folded face. A plate stays down while any part of the other hull is over it and folds once that hull has passed the ramp’s tip, and a deck carrying a rider brings both of its plates down — as does a hull closing fast enough to cross the deck inside one swing — so a rider drives off an end instead of dropping off a ledge. The wheels sit at the hull’s ends and the underside between them arches up, so a wheel takes the ramp and the machine does not beach itself on a flat keel; each wheel hangs on a short strut, so a wheel whose ground drops away reaches down for it instead of hanging in the air. The platform applying more drive power starts the climb; the other stays on the floor and is driven over. Once one hull is on top, the pair keeps that rider until the bodies part — braking or changing direction mid-crossing cannot swap them and make the hulls stutter through each other. Their credits never enter the rig’s ledger.',
				'If any player removes their ramp, all platforms use solid horizontal bumpers instead. Contacts transfer momentum according to each loaded machine’s mass, and impact losses become heat. A stock engine cannot push through a held brake from rest: its 480 N thrust is below the roughly 706 N friction of a 60 kg braked platform. A fast impact still shoves that platform some distance before friction stops it, and a stronger upgraded engine can overcome the brake. Competitor work entering or leaving the rig is included in the energy balance.'
			],
			keys: [
				['Click a player line', 'Take that platform’s controls and its force setting'],
				['Selected platform', 'Drawn whole; every other platform is the same complete machine at 60% opacity'],
				['BOT checkbox', 'Let that player’s policy drive it'],
				['Ramp shop item', 'Installed by default; install/uninstall free; bots never switch it'],
				['45° plate', 'When all ramps are installed: unfolds to meet a closing platform and folds after it passes'],
				['Higher force', 'With ramps: starts the climb; the rider stays on top for the crossing'],
				['No ramp on any player', 'All platforms push; a held brake resists thrust but can slide after a fast impact'],
				['Complete machine', 'Every platform carries the same instruments, dimmed when not selected']
			]
		},
		{
			id: 'market',
			label: 'Market',
			title: 'Market and ledger',
			text: [
				'Touching either SELL wall sells the whole load automatically. This rig panel breaks the rig’s cargo and lifetime sales down by mineral, and its ledger records every rig sale, purchase, research payment and recharge. Competitor purses and purchase ledgers stay separate. The live quote table shows each mineral’s cr/cell price, drift against its seed base price and 1-minute rate: each run opens with seed-random demand, and every quote moves on its own slow cycle, so a common ore can be dear for a few minutes. A broken fragment is booked at the price of the moment it breaks, which keeps cargo, rubble and the ledger exact while the market moves.',
				'The emergency resupply imports energy instantly at the price shown, buying only what the funds cover; the centre pad remains the free route. The return note below emergency resupply compares your best active mining tool against that cr/kJ import rate.',
				'For the rig, sales, spending and imports all move one funds balance, so this ledger and the funds card always agree.'
			]
		},
		{
			id: 'bore',
			label: 'Bore',
			title: 'Hammer buffers and sloped tunnels',
			text: [
				'Researching Impact forging unlocks matched percussion hammer buffers on both noses of the Wild Mine platform. Each head opens a 1.13 m corridor — 1.5× the rig’s clearance height — so the chassis can drive straight into adjacent chambers, new ore seams and distant blue seeps.',
				'Set Tunnel grade between −30° (descent) and +30° (climb), or press Cursor aim so the nearer buffer follows the pointer’s side and incline live; moving the slider returns to a fixed grade. Hold V or Bore to cut while parked, or enable Auto-bore ahead while driving so A, D or a ground click hammers through rock ahead of the leading nose.',
				'Reserve cost scales with remaining rock strength: soft salts cut cheaply while hard corundum draws roughly four times as much and heats the hull faster. Pre-fractured rock cuts for less and open air costs nothing. Bored rock is pulverised to leave corridors clear rather than yielding cargo, so stop before valuable veins and mine them with the piston, ball or rockets.'
			],
			keys: [
				['V', 'Hold to hammer the aimed tunnel ahead'],
				['Cursor aim', 'Follow pointer side and slope live'],
				['A / D', 'Drive left or right (engages that nose with Auto-bore on)']
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
