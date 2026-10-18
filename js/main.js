(function () {
	'use strict';
	const physics = SteamPhysics;
	const config = physics.config;
	const canvas = document.getElementById('c');
	const context = canvas.getContext('2d');
	const ids = ['clock', 'drive', 'launch', 'status', 'force', 'force-value', 'battery', 'ball-energy', 'heat', 'error', 'motion', 'pause', 'speed'];
	const ui = {};
	for (const id of ids) ui[id] = document.getElementById(id);
	let world = physics.createWorld();
	let paused = false;
	let accumulator = 0;
	let previous = 0;
	let lastReadout = -1;
	let width = 0;
	let height = 0;
	let scale = 1;
	let offsetX = 0;
	let floorY = 0;
	let leftHeld = false;
	let rightHeld = false;

	function resize() {
		const bounds = canvas.getBoundingClientRect();
		width = bounds.width;
		height = bounds.height;
		const ratio = window.devicePixelRatio || 1;
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(height * ratio);
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		scale = Math.min((width - 32) / config.width, (height - 80) / config.ceiling);
		offsetX = (width - config.width * scale) / 2;
		floorY = (height + config.ceiling * scale) / 2 + 9;
	}

	function draw() {
		context.clearRect(0, 0, width, height);
		context.save();
		context.translate(offsetX, floorY);
		context.scale(scale, -scale);
		context.lineWidth = 1 / scale;
		context.strokeStyle = '#1e2c32';
		context.beginPath();
		for (let x = 0; x <= config.width; x += 2) { context.moveTo(x, 0); context.lineTo(x, config.ceiling); }
		for (let y = 0; y <= config.ceiling; y += 2) { context.moveTo(0, y); context.lineTo(config.width, y); }
		context.stroke();
		context.fillStyle = '#29383d';
		context.fillRect(0, config.ceiling, config.width, 0.35);
		context.fillRect(0, -0.35, config.width, 0.35);
		context.strokeStyle = '#657578';
		context.beginPath(); context.moveTo(0, 0); context.lineTo(config.width, 0); context.stroke();
		if (Number.isFinite(world.target)) {
			context.strokeStyle = '#627765';
			context.beginPath(); context.moveTo(world.target, 0); context.lineTo(world.target, 1.7); context.stroke();
		}
		const platform = world.platform;
		const left = platform.x - config.platformWidth * 0.5;
		const collectorWidth = config.platformWidth * config.collectorFraction;
		context.fillStyle = '#35454b';
		context.fillRect(left, 0.2, config.platformWidth, 0.4);
		context.fillStyle = '#e6b66e';
		context.fillRect(left, 0.55, collectorWidth, 0.15);
		context.fillStyle = world.drive ? '#b9ed91' : '#718d75';
		context.fillRect(left + collectorWidth, 0.55, config.platformWidth - collectorWidth, 0.15);
		context.fillStyle = '#10191d';
		context.beginPath(); context.arc(left + 0.5, 0.18, 0.18, 0, Math.PI * 2); context.arc(left + config.platformWidth - 0.5, 0.18, 0.18, 0, Math.PI * 2); context.fill();
		const ball = world.ball;
		const ballY = ball.state === 'held' ? config.deck + config.radius : ball.y;
		context.fillStyle = ball.state === 'grounded' ? '#e6b66e' : '#edf6f1';
		context.beginPath(); context.arc(ball.x, ballY, config.radius, 0, Math.PI * 2); context.fill();
		context.strokeStyle = '#a9c7bc';
		context.beginPath(); context.arc(ball.x, ballY, config.radius + 0.13, 0, Math.PI * 2); context.stroke();
		context.restore();
	}

	function readout() {
		ui.clock.textContent = world.time.toFixed(1) + ' s';
		ui.battery.textContent = (world.battery / 1000).toFixed(2) + ' kJ';
		ui['ball-energy'].textContent = physics.ballEnergy(world.ball).toFixed(1) + ' J';
		ui.heat.textContent = world.heat.toFixed(1) + ' J';
		ui.error.textContent = (physics.totalEnergy(world) - world.initialEnergy).toFixed(6) + ' J';
		ui.motion.textContent = world.platform.vx.toFixed(2) + ' m/s';
		ui.drive.setAttribute('aria-pressed', String(world.drive));
		ui.drive.firstChild.textContent = world.drive ? 'Drive on ' : 'Drive off ';
		ui.launch.disabled = world.ball.state !== 'held' || !world.drive || world.battery * config.efficiency <= config.mass * config.gravity * config.deck;
		if (world.ball.state === 'held') ui.status.textContent = world.drive ? 'Ball held · press E to release' : 'Ball held · enable drive to release';
		else if (world.ball.state === 'grounded') ui.status.textContent = 'Ball grounded · move over it to collect';
		else ui.status.textContent = 'Ball in flight · ' + world.pushes + ' powered pushes';
	}

	function updateDirection() {
		world.direction = Number(rightHeld) - Number(leftHeld);
		if (world.direction) world.target = NaN;
	}

	function clearInput() { leftHeld = false; rightHeld = false; updateDirection(); }
	function toggleDrive() { world.drive = !world.drive; readout(); }
	function releaseBall() { physics.launch(world); readout(); }
	function togglePause() { paused = !paused; ui.pause.textContent = paused ? 'Resume' : 'Pause'; accumulator = 0; }
	function setForce(value) {
		world.forceSetting = Math.max(0.1, Math.min(1, value));
		ui.force.value = Math.round(world.forceSetting * 100);
		ui['force-value'].textContent = ui.force.value + '%';
	}

	function keydown(event) {
		if (event.target.closest('input, select, textarea') || event.ctrlKey || event.metaKey || event.altKey) return;
		const key = event.code;
		if (key === 'Space' && event.target.closest('button')) return;
		if (key !== 'Space' && key !== 'KeyA' && key !== 'KeyD' && key !== 'KeyW' && key !== 'KeyS' && key !== 'KeyE') return;
		event.preventDefault();
		if (key === 'KeyA') leftHeld = true;
		if (key === 'KeyD') rightHeld = true;
		updateDirection();
		if (key === 'KeyW') setForce(world.forceSetting + 0.1);
		if (key === 'KeyS') setForce(world.forceSetting - 0.1);
		if (event.repeat) return;
		if (key === 'Space') toggleDrive();
		if (key === 'KeyE') releaseBall();
	}

	function keyup(event) {
		if (event.code === 'KeyA') leftHeld = false;
		if (event.code === 'KeyD') rightHeld = false;
		updateDirection();
	}

	function bindDirection(id, direction) {
		const button = document.getElementById(id);
		button.addEventListener('pointerdown', function (event) {
			button.setPointerCapture(event.pointerId);
			if (direction < 0) leftHeld = true;
			else rightHeld = true;
			updateDirection();
		});
		button.addEventListener('pointerup', clearInput);
		button.addEventListener('pointercancel', clearInput);
		button.addEventListener('lostpointercapture', clearInput);
	}

	function frame(now) {
		const elapsed = previous ? Math.min((now - previous) / 1000, 0.1) : 0;
		previous = now;
		if (!paused && !document.hidden) accumulator += elapsed * Number(ui.speed.value);
		while (accumulator >= config.step) { physics.step(world, config.step); accumulator -= config.step; }
		draw();
		if (now - lastReadout > 100) { readout(); lastReadout = now; }
		requestAnimationFrame(frame);
	}

	document.getElementById('reset').addEventListener('click', function () {
		world = physics.createWorld(); clearInput(); setForce(world.forceSetting); accumulator = 0; readout();
	});
	ui.drive.addEventListener('click', toggleDrive);
	ui.launch.addEventListener('click', releaseBall);
	ui.pause.addEventListener('click', togglePause);
	ui.force.addEventListener('input', function () { setForce(Number(ui.force.value) / 100); });
	canvas.addEventListener('pointerdown', function (event) {
		const bounds = canvas.getBoundingClientRect();
		world.target = Math.max(config.platformWidth * 0.5, Math.min(config.width - config.platformWidth * 0.5, (event.clientX - bounds.left - offsetX) / scale));
		canvas.focus();
	});
	window.addEventListener('keydown', keydown);
	window.addEventListener('keyup', keyup);
	window.addEventListener('blur', clearInput);
	document.addEventListener('visibilitychange', function () { accumulator = 0; previous = 0; clearInput(); });
	bindDirection('left', -1); bindDirection('right', 1);
	new ResizeObserver(resize).observe(canvas);
	resize(); readout(); requestAnimationFrame(frame);
})();
