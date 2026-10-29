'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ceiling, physics, c, near, balanced, sync, run, earnFunds } = require('./harness.cjs');

const price = () => ceiling.state.fuelPrice;

test('recharge imports energy at the documented price and keeps the balance exact', () => {
	const w = physics.createWorld();
	assert.equal(ceiling.rechargeCost(w), 0, 'a full reserve costs nothing');
	assert.equal(ceiling.recharge(w, w.time), 0, 'so nothing is bought');
	earnFunds(w, 100);
	const funds = ceiling.state.funds;
	assert.ok(funds > 300, 'one full load covers a whole reserve');
	w.battery = 2000;
	sync(w);
	near(ceiling.rechargeCost(w), (c.battery - 2000) / 1000 * price());
	const imported = ceiling.recharge(w, w.time);
	near(imported, c.battery - 2000);
	near(w.battery, c.battery);
	near(w.importedEnergy, imported);
	near(ceiling.state.funds, funds - imported / 1000 * price());
	balanced(w);
	const entry = ceiling.state.ledger[ceiling.state.ledger.length - 1];
	assert.equal(entry.type, 'fuel');
	near(entry.energy, imported);
	near(entry.credits, imported / 1000 * price());
	assert.ok(Object.isFrozen(entry));
	assert.equal(ceiling.recharge(w, w.time), 0, 'a full reserve buys nothing more');
	near(ceiling.state.funds, funds - imported / 1000 * price());
	const fresh = physics.createWorld();
	// A reset clears the import ledger.
	near(fresh.importedEnergy, 0);
	near(fresh.battery, c.battery);
});

test('a short budget buys a partial recharge and an exhausted one refuses', () => {
	const w = physics.createWorld();
	earnFunds(w, 20);
	const funds = ceiling.state.funds;
	assert.ok(funds > 0 && funds < c.battery / 1000 * price(), 'the load does not cover a full reserve');
	w.battery = 0;
	sync(w);
	const imported = ceiling.recharge(w, w.time);
	near(imported, Math.floor(funds * 1000 / price()));
	assert.ok(imported > 0 && imported < c.battery, 'partial charge');
	assert.ok(ceiling.state.funds >= 0, 'funds never go negative');
	assert.ok(ceiling.state.funds < price() / 1000, 'less than one joule of credit is left');
	balanced(w);
	assert.equal(ceiling.recharge(w, w.time), 0, 'nothing affordable remains');
	near(w.battery, imported);
	physics.createWorld();
});

test('an empty reserve leaves only the crank crawl until credits buy energy back', () => {
	const w = physics.createWorld();
	w.ball.state = 'held';
	w.battery = 0;
	// Off the centre charge pad, so the empty reserve cannot refill itself.
	w.platform.x = 3;
	w.direction = 1;
	w.forceSetting = 1;
	sync(w);
	run(w, 1);
	near(w.platform.vx, c.crankMaxSpeed, 1e-9);
	assert.ok(w.platform.x > 3, 'the crew can still crawl toward the pad or a wall');
	assert.ok(w.crankEnergy > 0, 'the crawl is crew work, not reserve energy');
	assert.equal(ceiling.recharge(w, w.time), 0, 'no funds, no energy');
	balanced(w);
	earnFunds(w, 100);
	assert.ok(ceiling.recharge(w, w.time) > 0, 'one load buys the reserve back');
	sync(w);
	run(w, 1);
	assert.ok(w.platform.vx > c.crankMaxSpeed, 'the powered drive outruns the crawl again');
	assert.ok(w.battery < c.battery, 'driving spends the imported energy');
	balanced(w);
	physics.createWorld();
});
