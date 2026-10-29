// Headless checks of the Rapier physics world (physics/world.js) and protocol (physics/protocol.js):
// resting drop, 1,000-step snapshot determinism, reset byte-identity, 300-body step budget,
// NaN watchdog + free-slot reuse, 50 m/s anti-tunneling CCD, spawn nudges, air drag and watchdogs.

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import RAPIER from '@dimforge/rapier3d-simd-compat';
import {SHAPES, addBlock, addBody, createScene, defaultScene, randomBody, rng} from '../src/core/scene.js';
import {
  ALIVE, FLAGS, H_COUNT, H_SLOTS, H_STEP, POS, createSlotMap, frameLength, slotOffset,
} from '../src/physics/protocol.js';
import {MAX_ANGVEL, MAX_LINVEL, MIN_BODY_SIZE, createPhysicsWorld} from '../src/physics/world.js';

await RAPIER.init();

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// 1. protocol slot map: deterministic allocation, lowest-free-slot reuse, snapshot/restore
{
  const m = createSlotMap();
  assert.equal(m.alloc('a'), 0);
  assert.equal(m.alloc('b'), 1);
  assert.equal(m.alloc('c'), 2);
  assert.equal(m.free('c'), 2);
  assert.equal(m.free('a'), 0);
  assert.equal(m.alloc('d'), 0); // lowest free slot reused first
  const snap = m.snapshot();
  assert.equal(m.alloc('e'), 2);
  m.restore(snap);
  assert.equal(m.count, 2);
  assert.equal(m.slotOf('d'), 0);
  assert.equal(m.slotOf('b'), 1);
  assert.equal(m.alloc('f'), 2);
}

// 2. a box dropped from 2 m comes to rest on the floor within 3 s (180 steps at 60 Hz)
{
  const scene = createScene();
  addBlock(scene, {min: [-6, -0.5, -6], max: [6, 0, 6]});
  addBody(scene, {shape: 'box', size: [0.5, 0.5, 0.5], pos: [0, 2, 0]});
  const sim = createPhysicsWorld(RAPIER);
  sim.load(scene);
  sim.step(180);
  const rb = sim.entries[0].rb;
  const p = rb.translation(), v = rb.linvel(), av = rb.angvel();
  assert.ok(Math.abs(p.y - 0.25) < 0.015, `expected resting y ~ 0.25, got ${p.y}`);
  assert.ok(Math.hypot(v.x, v.y, v.z) < 1e-3, `expected near-zero linvel, got ${JSON.stringify(v)}`);
  assert.ok(Math.hypot(av.x, av.y, av.z) < 1e-3, `expected near-zero angvel, got ${JSON.stringify(av)}`);
  assert.equal(rb.isSleeping(), true, 'dropped box should sleep within 3 s');
  sim.dispose();
}

// 3. 1,000-step run gives the exact same snapshot hash twice, and reset replays byte-for-byte
{
  const runHash = () => {
    const sim = createPhysicsWorld(RAPIER);
    sim.load(defaultScene());
    sim.step(1000);
    const hash = sha256(sim.snapshotBytes());
    const frame = sim.write(new Float32Array(frameLength(sim.slots)));
    sim.dispose();
    return {hash, frameHash: sha256(new Uint8Array(frame.buffer))};
  };
  const a = runHash();
  const b = runHash();
  assert.equal(a.hash, b.hash, '1,000-step Rapier snapshot hashes must match');
  assert.equal(a.frameHash, b.frameHash, '1,000-step frame buffer hashes must match');

  // Play -> 5 s (300 steps) -> Reset -> Play 5 s (300 steps) reproduces exact frame bytes
  const sim = createPhysicsWorld(RAPIER);
  sim.load(defaultScene());
  const f0 = sim.write(new Float32Array(frameLength(sim.slots)));
  sim.step(300);
  const f300a = sim.write(new Float32Array(frameLength(sim.slots)));
  sim.reset();
  const f0Reset = sim.write(new Float32Array(frameLength(sim.slots)));
  assert.equal(Buffer.compare(Buffer.from(f0.buffer), Buffer.from(f0Reset.buffer)), 0,
    'reset must restore initial frame buffer bytes exactly');
  sim.step(300);
  const f300b = sim.write(new Float32Array(frameLength(sim.slots)));
  assert.equal(Buffer.compare(Buffer.from(f300a.buffer), Buffer.from(f300b.buffer)), 0,
    'second 5 s play after reset must match first 5 s frame buffer bytes');
  sim.dispose();
}

// 4. 300 bodies step in <= 4 ms each, averaged over 600 steps
let avg300Ms = 0, p95_300Ms = 0, max300Ms = 0;
{
  const scene = defaultScene();
  const r = rng(11);
  const pick = () => { const x = r(); return SHAPES[x < 0.45 ? 0 : x < 0.75 ? 1 : x < 0.88 ? 2 : 3]; };
  while (scene.bodies.length < 300) addBody(scene, randomBody(r, pick()));
  const sim = createPhysicsWorld(RAPIER);
  sim.load(scene);
  assert.equal(sim.count, 300);
  const times = new Float64Array(600);
  const t0 = performance.now();
  for (let i = 0; i < 600; i++) times[i] = sim.step(1);
  avg300Ms = (performance.now() - t0) / 600;
  const sorted = [...times].sort((x, y) => x - y);
  p95_300Ms = sorted[Math.floor(sorted.length * 0.95)];
  max300Ms = sorted[sorted.length - 1];
  assert.ok(avg300Ms <= 4, `300-body avg step ${avg300Ms.toFixed(3)} ms exceeded 4 ms budget`);
  sim.dispose();
}

// 5. NaN injected into a body is removed with an event, slot is freed/reused, world keeps stepping
{
  const events = [];
  const sim = createPhysicsWorld(RAPIER, {onEvent: (ev) => events.push(ev)});
  sim.load(defaultScene());
  sim.step(10);
  const victimId = sim.entries[0].id;
  const victimSlot = sim.entries[0].slot;
  assert.equal(sim.injectNaN(victimId), true);
  sim.step(1);
  const nanEv = events.find((e) => e.type === 'removed' && e.reason === 'nan');
  assert.ok(nanEv, 'expected removed(nan) event');
  assert.equal(nanEv.id, victimId);
  assert.equal(sim.count, 39);

  const buf = sim.write(new Float32Array(frameLength(sim.slots)));
  assert.equal(buf[H_STEP], 11);
  assert.equal(buf[H_COUNT], 39);
  assert.equal(buf[H_SLOTS], 40);
  assert.equal(buf[slotOffset(victimSlot) + FLAGS] & ALIVE, 0);
  for (let i = 0; i < buf.length; i++) assert.ok(Number.isFinite(buf[i]), `non-finite float at ${i}`);

  sim.step(60);
  const spawned = sim.spawn({id: 'b_reused', shape: 'ball', size: [0.4, 0.4, 0.4], pos: [0, 5, 0]});
  assert.equal(spawned.ok, true);
  assert.equal(spawned.slot, victimSlot, 'freed slot should be reused on next spawn');
  sim.dispose();
}

// 6. a ball fired at 50 m/s at a 0.2 m wall does not tunnel (both < 0.3 m and >= 0.3 m balls)
for (const d of [0.24, 0.5]) {
  const scene = createScene();
  addBlock(scene, {min: [-6, -0.5, -6], max: [6, 0, 6]});
  addBlock(scene, {min: [2.0, 0, -3], max: [2.2, 4, 3]}); // 0.2 m thick wall at x in [2.0, 2.2]
  addBody(scene, {shape: 'ball', size: [d, d, d], pos: [0, 1.5, 0], vel: [50, 0, 0]});
  const sim = createPhysicsWorld(RAPIER);
  sim.load(scene);
  for (let i = 0; i < 60; i++) {
    sim.step(1);
    const x = sim.entries[0].rb.translation().x;
    assert.ok(x < 2.0, `ball (d=${d}) tunnelled through 0.2 m wall at step ${i + 1}: x=${x}`);
  }
  sim.dispose();
}

// 7. guards: 50 boxes at one point nudge/refuse cleanly, speed clamps, terminal air drag, busy watchdog
{
  const events = [];
  let fakeClock = 0;
  let stepCost = 1;
  const sim = createPhysicsWorld(RAPIER, {
    onEvent: (ev) => events.push(ev),
    now: () => { const t = fakeClock; fakeClock += stepCost; return t; },
  });
  const scene = createScene({settings: {gravity: [0, -9.81, 0], terminalSpeed: 40}});
  addBlock(scene, {min: [-6, -0.5, -6], max: [6, 0, 6]});
  sim.load(scene);

  let accepted = 0, refused = 0;
  for (let i = 0; i < 50; i++) {
    const res = sim.spawn({id: `same_${i}`, shape: 'box', size: [0.5, 0.5, 0.5], pos: [0, 2, 0]});
    if (res.ok) accepted++;
    else refused++;
  }
  assert.ok(accepted >= 2 && accepted <= 3, `expected 2..3 boxes accepted via 5 cm nudges, got ${accepted}`);
  assert.equal(accepted + refused, 50);
  assert.equal(events.filter((e) => e.type === 'refused' && e.reason === 'blocked').length, refused);
  sim.step(120);
  for (const e of sim.entries) {
    const v = e.rb.linvel(), av = e.rb.angvel();
    assert.ok(Math.hypot(v.x, v.y, v.z) <= MAX_LINVEL + 1e-4);
    assert.ok(Math.hypot(av.x, av.y, av.z) <= MAX_ANGVEL + 1e-4);
  }

  // min size + speed clamp + quadratic air drag near terminalSpeed
  const tiny = sim.spawn({
    id: 'tiny_fast', shape: 'box', size: [0.01, 0.02, 0.03], pos: [3, 40, 0],
    vel: [200, 0, 0], angvel: [0, 200, 0],
  });
  assert.equal(tiny.ok, true);
  assert.deepEqual(tiny.body.size, [MIN_BODY_SIZE, MIN_BODY_SIZE, MIN_BODY_SIZE]);
  sim.step(1);
  const trb = sim.entries.find((e) => e.id === 'tiny_fast').rb;
  assert.ok(Math.hypot(trb.linvel().x, trb.linvel().y, trb.linvel().z) <= MAX_LINVEL + 1e-4);
  assert.ok(Math.hypot(trb.angvel().x, trb.angvel().y, trb.angvel().z) <= MAX_ANGVEL + 1e-4);

  // step-time watchdog: > 8 ms for 30 consecutive steps emits busy once
  stepCost = 10; // now() delta per step = 10 ms > 8 ms
  sim.step(29);
  assert.equal(events.filter((e) => e.type === 'busy').length, 0);
  sim.step(1);
  assert.equal(events.filter((e) => e.type === 'busy').length, 1);

  const buf = sim.write(new Float32Array(frameLength(sim.slots)));
  assert.ok(Number.isFinite(buf[slotOffset(0) + POS]));
  sim.dispose();

  // quadratic air drag: in free fall with terminalSpeed = 20 m/s, vertical speed asymptotes to ~20 m/s
  const dragScene = createScene({settings: {gravity: [0, -9.81, 0], terminalSpeed: 20}});
  addBody(dragScene, {shape: 'ball', size: [0.4, 0.4, 0.4], pos: [0, 180, 0]});
  const dragSim = createPhysicsWorld(RAPIER);
  dragSim.load(dragScene);
  dragSim.step(480); // 8 s free fall (without drag: ~60 m/s clamp; with drag: ~19.9 m/s)
  const vy = dragSim.entries[0].rb.linvel().y;
  assert.ok(Math.abs(vy + 20) < 0.35, `expected terminal vertical velocity ~ -20 m/s, got ${vy}`);
  dragSim.dispose();
}

console.log(
  `physics checks passed: 300 bodies averaged ${avg300Ms.toFixed(2)} ms/step ` +
  `(p95 ${p95_300Ms.toFixed(2)} ms, max ${max300Ms.toFixed(2)} ms; <= 4 ms budget)`
);