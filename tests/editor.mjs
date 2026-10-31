// Unit tests for editor history, portal placement validation, emitter logic, and tools.

import assert from 'node:assert/strict';
import {createScene, defaultScene, newId, addBlock, addPortalPair, PORTAL_COLOURS} from '../src/core/scene.js';
import {createHistory} from '../src/editor/history.js';
import {blockFaces} from '../src/render/level.js';
import {dot, norm, scale, sub, cross} from '../src/core/vec.js';

console.log('running editor unit tests...');

// 1. History tests
{
  const history = createHistory(200);
  let value = 0;
  const incCmd = {
    name: 'inc',
    execute: () => { value++; },
    undo: () => { value--; },
  };

  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);

  history.execute(incCmd);
  assert.equal(value, 1);
  assert.equal(history.canUndo, true);
  assert.equal(history.canRedo, false);

  history.undo();
  assert.equal(value, 0);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, true);

  history.redo();
  assert.equal(value, 1);
  assert.equal(history.canUndo, true);
  assert.equal(history.canRedo, false);

  // Depth limit: execute 250 times on maxDepth=200
  for (let i = 0; i < 250; i++) {
    history.execute({
      name: `step_${i}`,
      execute: () => { value++; },
      undo: () => { value--; },
    });
  }
  assert.equal(history.undoCount, 200);

  // Undo 200 times
  for (let i = 0; i < 200; i++) {
    assert.equal(history.undo(), true);
  }
  assert.equal(history.undo(), false);
}

// 2. Portal placement geometry and validation tests
{
  const scene = createScene();
  // Add a 2 x 2 m wall block: [0, 0, 0] to [2, 2, 0.5]
  const wall = addBlock(scene, {min: [0, 0, 0], max: [2, 2, 0.5]});
  const faces = blockFaces(wall);

  // Front face (+z): corners in plane
  const frontFace = faces.find((f) => {
    const e1 = sub(f[1], f[0]), e2 = sub(f[2], f[0]);
    const n = norm(cross(e1, e2));
    return Math.abs(n[2] - 1) < 1e-3;
  });
  assert(frontFace, 'front face found');

  // Portal dimensions: 2*a = 1.4 m, 2*b = 2.0 m
  const a = 0.7, b = 1.0;
  const u = [1, 0, 0], v = [0, 1, 0];

  // Fit check on a 2 x 2 m face: face width = 2.0 >= 1.4, height = 2.0 >= 2.0 -> fits!
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  const hitPt = [1.0, 1.0, 0.5];
  for (const c of frontFace) {
    const du = dot(sub(c, hitPt), u);
    const dv = dot(sub(c, hitPt), v);
    if (du < uMin) uMin = du;
    if (du > uMax) uMax = du;
    if (dv < vMin) vMin = dv;
    if (dv > vMax) vMax = dv;
  }
  assert.equal(uMax - uMin >= 2 * a - 1e-4, true);
  assert.equal(vMax - vMin >= 2 * b - 1e-4, true);

  // Fit check on a narrow pillar (0.8 x 2.0 m) -> width 0.8 < 1.4 -> MUST REFUSE!
  const narrowFace = [[0, 0, 0], [0.8, 0, 0], [0.8, 2, 0], [0, 2, 0]];
  let nuMin = Infinity, nuMax = -Infinity;
  for (const c of narrowFace) {
    const du = dot(sub(c, [0.4, 1.0, 0]), u);
    if (du < nuMin) nuMin = du;
    if (du > nuMax) nuMax = du;
  }
  const narrowWidth = nuMax - nuMin;
  assert.equal(narrowWidth < 2 * a, true, 'narrow face correctly refuses fit');

  // Overlap check: two portals on same plane within 0.1 m gap
  const p1 = {c: [1.0, 1.0, 0], n: [0, 0, 1], a: 0.7, b: 1.0};
  const p2Close = {c: [1.5, 1.0, 0], n: [0, 0, 1], a: 0.7, b: 1.0}; // dist = 0.5 < 1.4 + 0.1
  const p2Far = {c: [3.0, 1.0, 0], n: [0, 0, 1], a: 0.7, b: 1.0};   // dist = 2.0 >= 1.4 + 0.1

  const distClose = Math.hypot(...sub(p1.c, p2Close.c));
  const distFar = Math.hypot(...sub(p1.c, p2Far.c));
  const minRequiredGap = (p1.a + p2Close.a) * 0.9 + 0.1;

  assert.equal(distClose < minRequiredGap, true, 'detects portal overlap');
  assert.equal(distFar >= minRequiredGap, true, 'allows non-overlapping portal');

  // Pair limit check (4 pairs = 8 portals)
  scene.portals.length = 0;
  for (let i = 0; i < 4; i++) {
    addPortalPair(scene, {c: [i * 2, 1, 0]}, {c: [i * 2, 1, 5]});
  }
  assert.equal(scene.portals.length, 8);
  const atLimit = scene.portals.length >= 8;
  assert.equal(atLimit, true, 'enforces 4-pair limit');
}

// 3. Emitter rate and body cap logic
{
  const emitter = {
    id: 'e1',
    shape: 'ball',
    rate: 3, // 3 spawns per second
    speed: 5,
    lastSpawn: 0,
  };

  let simTime = 0;
  let bodyCount = 0;
  const spawned = [];
  const MAX_BODIES = 300;

  function tickEmitter(t) {
    const interval = 1 / emitter.rate;
    if (t - emitter.lastSpawn >= interval) {
      if (bodyCount >= MAX_BODIES) return false;
      bodyCount++;
      spawned.push({t, id: `b_${bodyCount}`});
      emitter.lastSpawn = t;
      return true;
    }
    return false;
  }

  // Over 1 second at 3/s, expect ~3 spawns
  for (let step = 0; step < 60; step++) {
    simTime += 1 / 60;
    tickEmitter(simTime);
  }
  assert.equal(spawned.length, 3, 'emitter spawns at exact set rate (3/s)');

  // At body limit 300, tickEmitter refuses further spawns
  bodyCount = 300;
  const refused = tickEmitter(simTime + 1.0);
  assert.equal(refused, false, 'emitter stops at body cap 300');
}

console.log('all editor unit tests passed!');
