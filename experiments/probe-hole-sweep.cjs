'use strict';
// Sweep: dug pits in the shelf floor. For each pit the ball is rolled in from
// the shelf and dropped straight in, and the run reports whether it ever came to
// rest, how much of the pit it crossed, and whether it froze in mid-air.
// Two reported symptoms are checked here:
//   "no friction in edges of small holes" - a coasting ball at a rim must lose
//   its coast and spin, not skate along the rim;
//   "ball gets stuck in the geometry of small holes" - a ball in the clear next
//   to a rim used to stop dead every frame without gravity being integrated.
// Run: node experiments/probe-hole-sweep.cjs
const physics = require('../js/physics.js');
const players = require('../js/players.js');
const wildMine = require('../js/wild-mine.js');
const wildBall = require('../js/wild-ball.js');

const dt = physics.config.step;
const r = physics.config.radius;

function world(seed) {
	wildMine.setMode('wild');
	const w = physics.createWorld();
	players.init(w, 0);
	const cave = wildMine.init(w, { seed: seed || 1 });
	w.platform.x = -20;
	return { world: w, cave, ball: w.balls[0] };
}

function place(ball, x, y, vx, omega) {
	ball.state = 'flying';
	ball.holder = null;
	ball.x = x;
	ball.y = y;
	ball.vx = vx || 0;
	ball.vy = 0;
	ball.omega = omega || 0;
	ball.spin = 0;
	ball.contact = wildBall.CONTACT_NONE;
	ball.releaseCooldown = 0;
}

function pit(cave, offset, width, depth) {
	const base = cave.columnAt(0) + offset;
	const top = cave.state.shelfRow;
	for (let c = base; c < base + width; c++) for (let row = top - depth; row < top; row++) cave.dig(c, row);
}

// One run: returns the settle time (or -1), the longest frozen run, and the
// largest clearance the ball ever reported while its speed stayed nonzero.
function run(offset, width, depth, from, push, seconds) {
	const { world: w, cave, ball } = world(1);
	pit(cave, offset, width, depth);
	const cell = cave.state.cell;
	const x = from === 'above'
		? cave.worldX(cave.columnAt(0) + offset) + (width - 1) * cell * 0.5
		: cave.worldX(cave.columnAt(0) + offset - 2);
	const y = from === 'above' ? cave.state.shelfRow * cell + 2.5 : cave.floorBelow(x, 31.5) + r;
	place(ball, x, y, from === 'above' ? 0 : push, from === 'above' ? 0 : push / r);
	w.initialEnergy = physics.totalEnergy(w);
	let settled = -1;
	let frozen = 0;
	let longestFrozen = 0;
	let previousX = ball.x;
	let previousY = ball.y;
	for (let i = 0; i < Math.round(seconds / dt); i++) {
		physics.step(w, dt);
		const speed = Math.hypot(ball.vx, ball.vy);
		const asleep = speed < wildBall.restSpeed && Math.abs(ball.omega) * r < wildBall.restSpeed;
		if (settled < 0 && i > 30 && asleep) settled = i * dt;
		const moved = Math.hypot(ball.x - previousX, ball.y - previousY);
		frozen = moved < 1e-5 && !asleep ? frozen + 1 : 0;
		if (frozen > longestFrozen) longestFrozen = frozen;
		previousX = ball.x;
		previousY = ball.y;
	}
	const asleep = Math.hypot(ball.vx, ball.vy) < wildBall.restSpeed && Math.abs(ball.omega) * r < wildBall.restSpeed;
	return {
		pit: `${width}x${depth}`,
		start: from,
		settle: settled < 0 ? 'NEVER' : settled.toFixed(2),
		frozen: longestFrozen,
		asleep,
		spin: (Math.abs(ball.omega) * r).toFixed(3),
		drift: (physics.totalEnergy(w) - w.initialEnergy).toExponential(1)
	};
}

// Drop from a point in the clear, return the frozen-run length and the final
// height, which is what separates a freeze from a long fall.
function runClear(x, y) {
	const { world: w, cave, ball } = world(1);
	place(ball, x, y, 0, 0);
	w.initialEnergy = physics.totalEnergy(w);
	let frozen = 0;
	let longestFrozen = 0;
	let previousX = x;
	let previousY = y;
	for (let i = 0; i < Math.round(20 / dt); i++) {
		physics.step(w, dt);
		const moved = Math.hypot(ball.x - previousX, ball.y - previousY);
		const speed = Math.hypot(ball.vx, ball.vy);
		frozen = moved < 1e-5 && speed > wildBall.restSpeed ? frozen + 1 : 0;
		if (frozen > longestFrozen) longestFrozen = frozen;
		previousX = ball.x;
		previousY = ball.y;
	}
	return { pit: '-', start: `drop ${x},${y}`, settle: longestFrozen > 30 ? 'FROZEN' : 'ok', frozen: longestFrozen, asleep: false, spin: '-', drift: (physics.totalEnergy(w) - w.initialEnergy).toExponential(1) };
}

const rows = [];
for (const width of [1, 2, 3, 4, 6, 8]) for (const depth of [1, 2, 3]) rows.push(run(0, width, depth, 'roll', 1.2, 10));
for (const width of [1, 2, 3, 4, 6, 8]) rows.push(run(0, width, 4, 'above', 0, 40));
// A ball dropped in the clear beside the shelf rim: the one-band SDF clamps and
// the trace answers a contact a hair in the future with the ball still clear.
// The old airStep stopped on that point every frame without integrating gravity,
// so the ball hung in mid-air for ever ("stuck in the geometry").
for (const [x, y] of [[-3.97, 33.1], [-4.1, 33.3], [4.7, 32.9]]) rows.push(runClear(x, y));
// A pocket in a dug surface: the field reads touching against stair-stepped rock.
rows.push(runClear(0.0625, 30.9));
console.table(rows);
const stillBouncing = rows.filter((row) => row.settle !== 'NEVER' && row.pit !== '-' && !row.asleep);
console.log(rows.filter((row) => row.settle === 'NEVER').length
	? 'NEVER settled: a freeze or a loop, not a slow e = sqrt(0.9) decay'
	: 'every run reached rest inside its window');
console.log(stillBouncing.length
	? `still bouncing when the window closed (a superball in a pit it nearly fills): ${stillBouncing.map((row) => `${row.start} ${row.pit}`).join(', ')}`
	: 'no run was still bouncing at the end of its window');
