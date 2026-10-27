// Headless checks of render interpolation (core/interp.js) and the fixed-step loop clamp.
// A fake portal pair checks the teleport hook: the older pose is carried through the portal first.

import assert from 'node:assert/strict';
import {len, sub} from '../src/core/vec.js';
import {qaxis, qrot} from '../src/core/quat.js';
import {ALIVE, FLAGS, HAS_CLONE, frameLength, slotOffset, withTeleport} from '../src/core/frame.js';
import {blendSlot, teleportMaps} from '../src/core/interp.js';
import {createLoop} from '../src/app/loop.js';

const near = (a, b, eps = 1e-6) => assert.ok(len(sub(a, b)) < eps, `${a} != ${b}`);
const put = (buf, i, pos, quat, flags = ALIVE) => {
  const o = slotOffset(i);
  buf.set([...pos, ...quat, flags], o);
};
const out = new Float64Array(14);
const pos = () => [out[0], out[1], out[2]];

// plain blend: lerp positions, slerp quaternions, unit length, ends exact
{
  const a = new Float32Array(frameLength(1)), b = new Float32Array(frameLength(1));
  put(a, 0, [0, 0, 0], qaxis([0, 1, 0], 0));
  put(b, 0, [2, 4, -6], qaxis([0, 1, 0], Math.PI / 2));
  for (const t of [0, 0.25, 0.5, 1]) {
    blendSlot(a, b, 0, t, [], out);
    near(pos(), [2 * t, 4 * t, -6 * t]);
    near([out[3], out[4], out[5], out[6]], qaxis([0, 1, 0], Math.PI / 2 * t));
  }
  // shortest arc: q and -q are the same rotation, so blending between them never spins
  put(b, 0, [0, 0, 0], [-0, -0, -0, -1]);
  blendSlot(a, b, 0, 0.5, [], out);
  assert.ok(Math.abs(Math.abs(out[6]) - 1) < 1e-6);
  // a slot that was dead in the older frame snaps to its new pose
  const fresh = new Float32Array(frameLength(1));
  put(b, 0, [5, 5, 5], [0, 0, 0, 1]);
  blendSlot(fresh, b, 0, 0.3, [], out);
  near(pos(), [5, 5, 5]);
  // a dead slot reports 0
  assert.equal(blendSlot(a, fresh, 0, 0.5, [], out), 0);
  // the clone pose blends too when both frames have one
  const c = new Float32Array(frameLength(1)), d = new Float32Array(frameLength(1));
  c.set([0, 0, 0, 0, 0, 0, 1, ALIVE | HAS_CLONE, 1, 1, 1, 0, 0, 0, 1], slotOffset(0));
  d.set([0, 0, 0, 0, 0, 0, 1, ALIVE | HAS_CLONE, 3, 1, 1, 0, 0, 0, 1], slotOffset(0));
  blendSlot(c, d, 0, 0.5, [], out);
  near([out[7], out[8], out[9]], [2, 1, 1]);
}

// teleport: a body falls into a floor portal and comes out of a wall portal
{
  const portals = [
    {id: 'p1', pair: 'p2', c: [0, 0, 0], n: [0, 1, 0], v: [0, 0, -1], a: 1, b: 1},
    {id: 'p2', pair: 'p1', c: [10, 3, 0], n: [-1, 0, 0], v: [0, 1, 0], a: 1, b: 1},
  ];
  const maps = teleportMaps(portals);
  const M = maps[0];
  const a = new Float32Array(frameLength(1)), b = new Float32Array(frameLength(1));
  const q0 = qaxis([1, 0, 0], 0.3);
  const before = [0.2, 0.1, 0.1];                          // just above the floor portal, falling
  // where `before` maps to, then one step further along the mapped velocity
  const vy = -6, dt = 1 / 60;
  const mappedBefore = [M.R[0], M.R[1], M.R[2]].reduce((s, col, k) => s.map((x, j) => x + col[j] * before[k]), [...M.t]);
  const vOut = [M.R[1][0] * vy, M.R[1][1] * vy, M.R[1][2] * vy];
  const after = mappedBefore.map((x, j) => x + vOut[j] * dt);
  near(vOut.map((x) => x / Math.abs(vy)), [-1, 0, 0]);    // falling down the floor portal = moving out of the wall
  const q1 = [...q0];
  // the frame after the step carries the mapped orientation and the teleport flag of portal 0
  const mq = M.q, x = q1;
  const qAfter = [
    mq[3] * x[0] + mq[0] * x[3] + mq[1] * x[2] - mq[2] * x[1],
    mq[3] * x[1] - mq[0] * x[2] + mq[1] * x[3] + mq[2] * x[0],
    mq[3] * x[2] + mq[0] * x[1] - mq[1] * x[0] + mq[2] * x[3],
    mq[3] * x[3] - mq[0] * x[0] - mq[1] * x[1] - mq[2] * x[2],
  ];
  put(a, 0, before, q0);
  put(b, 0, after, qAfter, withTeleport(ALIVE, 0));
  for (let t = 0; t <= 1; t += 0.125) {
    blendSlot(a, b, 0, t, maps, out);
    near(pos(), mappedBefore.map((v, j) => v + (after[j] - v) * t), 1e-5);
    assert.ok(len(sub(pos(), [10, 3, 0])) < 0.5, `blend left the exit portal at t=${t}: ${pos()}`);
    // orientation is the mapped one throughout: no spin across the teleport
    near(qrot([out[3], out[4], out[5], out[6]], [0, 1, 0]), qrot(qAfter, [0, 1, 0]), 1e-5);
  }
  // without the hook (no maps) the body snaps instead of streaking across the room
  blendSlot(a, b, 0, 0.5, [], out);
  near(pos(), after, 1e-6);
  // the pair's maps are each other's inverse
  const back = maps[1];
  near([0, 1, 2].map((j) => back.R[0][j] * mappedBefore[0] + back.R[1][j] * mappedBefore[1] + back.R[2][j] * mappedBefore[2] + back.t[j]), before);
}

// loop: fixed 60 Hz steps, at most 4 per frame, alpha in [0, 1) and rising between steps
{
  let steps = 0;
  const sim = {slots: 1, step(buf) { steps++; buf[0] = steps; }};
  const alphas = [];
  const loop = createLoop({sim, dt: 1 / 60, maxSteps: 4, render: (prev, curr, alpha) => alphas.push(alpha)});
  let t = 1000;
  loop.tick(t);
  for (let i = 0; i < 240; i++) loop.tick(t += 1000 / 120);   // a 120 Hz display for 2 s
  assert.ok(Math.abs(steps - 120) <= 1, `steps ${steps}`);
  let rises = 0;
  for (let i = 1; i < alphas.length; i++) {
    assert.ok(alphas[i] >= 0 && alphas[i] < 1);
    if (alphas[i] > alphas[i - 1]) rises++;
  }
  assert.ok(rises >= 115, `alpha rose ${rises} times`);
  const before = steps;
  loop.tick(t += 30000);                                     // back from a 30 s hidden tab
  assert.equal(steps - before, 4);
  loop.tick(t += 1000 / 60);
  assert.ok(steps - before <= 6);
}

console.log('interp checks passed: lerp and slerp, shortest arc, fresh slots, clones, teleport through a portal pair, loop clamp');
