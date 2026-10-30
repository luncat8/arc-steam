'use strict';
const ceiling = require('../js/ceiling.js');
const equipment = require('../js/equipment.js');
const research = require('../js/research.js');
const physics = require('../js/physics.js');
const c = physics.config;

function earn(world, cells) {
    const target = ceiling.state.extractedCells + cells;
    for (let x = 1; x < 23 && ceiling.state.extractedCells < target; x += 2) ceiling.damage(x, ceiling.state.bottom + 0.2, 20);
    const state = ceiling.state;
    let prepared = 0;
    for (let i = 0; i < state.active.length && prepared < cells; i++) {
        if (!state.active[i]) continue;
        state.debrisX[i] = world.platform.x - 1;
        state.debrisY[i] = 0.701;
        state.debrisVx[i] = 0;
        state.debrisVy[i] = -1;
        prepared++;
    }
    physics.step(world, c.step);
    ceiling.sellCargo(0, world.time);
    for (let i = 0; i < 240 * 3; i++) physics.step(world, c.step);
    ceiling.sellCargo(0, world.time);
}

function run(label, seconds, withRadiator) {
    const world = physics.createWorld();
    world.platform.x = physics.platformMin();
    world.platform.vx = 0;
    world.direction = 1;
    world.forceSetting = 1;
    world.ball.state = 'held';
    world.battery = c.battery;
    earn(world, 100);
    earn(world, 100);
    earn(world, 100);
    research.research('alloys', world);
    research.research('thermodynamics', world);
    if (withRadiator) equipment.install('radiator', world);
    console.log(label, 'conductance:', physics.conductanceNow().toFixed(2), 'area:', physics.radiatorArea().toFixed(2), 'reserve kJ:', (c.battery / 1000).toFixed(1));
    let maxTemp = 20; let cutoffTime = 0;
    for (let i = 0; i < seconds / c.step; i++) {
        physics.step(world, c.step);
        const t = physics.temperature(world);
        if (t > maxTemp) maxTemp = t;
        if (physics.thermalFactor(world) === 0 && !cutoffTime) cutoffTime = world.time;
        if (world.platform.x <= physics.platformMin() || world.platform.x >= physics.platformMax()) world.direction *= -1;
        if (world.ball.state === 'held') physics.launch(world);
    }
    console.log(label, 'maxTemp', maxTemp.toFixed(1), 'C', 'cutoffAt', cutoffTime.toFixed(1), 's', 'endHeat', world.heat.toFixed(1), 'J cooled', world.cooledEnergy.toFixed(1), 'J');
}
run('without radiator', 120, false);
run('with radiator', 120, true);
