// Headless checks of the portal maths, ported from Ianua's tools/check-portals.js (the asserts that
// apply to equal-size flat portals): inverse maps, the back-to-back doorway, crossing hits and misses.

import assert from 'node:assert/strict';
import {apply, applyDir, compose, invert, len, sub} from '../src/core/vec.js';
import {crossing, frame, portalMap} from '../src/core/portal.js';
import {qfromR, qrot} from '../src/core/quat.js';
import {defaultScene} from '../src/core/scene.js';

const near = (a, b, eps = 1e-8) => assert.ok(len(sub(a, b)) < eps, `${a} != ${b}`);
const P = frame({c: [0, 0, 0], n: [0, 0, 1], v: [0, 1, 0], a: 1.5, b: 1.5, link: 1});
const Q = frame({...P, c: [4, 0, 0], n: [0, 0, -1], a: 0.5, b: 0.5, link: 0});
const M = portalMap(P, Q);
const door = portalMap(P, frame({...P, n: [0, 0, -1]}));
const S = frame({c: [1, 2, -3], n: [1, 0, 0], v: [0, 1, 0], a: 1, b: 1.2});
const T = frame({c: [-2, 0.5, 4], n: [0, 1, 0], v: [0, 0, 1], a: 1, b: 1.2});
const N = portalMap(S, T);

// portalMap followed by its inverse (and by the reverse map) is the identity
for (const p of [[0, 0, 0], [1, 2, 3], [-0.3, 0.8, -2]]) {
  near(apply(invert(M), apply(M, p)), p);
  near(apply(compose(portalMap(Q, P), M), p), p);
  near(apply(invert(N), apply(N, p)), p);
  near(apply(compose(portalMap(T, S), N), p), p);
}

// back-to-back portals act as a doorway: the map is the identity
for (const p of [[0, 0, 0], [1, 2, 3], [-0.3, 0.8, -2]]) near(apply(door, p), p);

// a direction into P's front leaves Q's front; scale follows the size ratio
near(applyDir(M, [0, 0, -3]), [0, 0, -1]);
near(applyDir(N, [-1, 0, 0]), [0, 1, 0]);
near(apply(N, S.c), T.c);

// a map of a closed (zero size) portal stays finite
const closed = portalMap({...P, a: 0}, {...Q, a: 0});
assert.ok(apply(closed, [1, 2, 3]).every(Number.isFinite));

// the map's rotation as a quaternion agrees with the matrix (used by render interpolation)
const q = qfromR(N.R);
for (const d of [[1, 0, 0], [0, 1, 0], [0.3, -0.4, 0.8]]) near(qrot(q, d), applyDir(N, d), 1e-9);

// crossing: a segment through the opening's front hits at the right fraction
assert.ok(Math.abs(crossing(P, P, [0, 0, 1], [0, 0, -1]) - 0.5) < 1e-12);
assert.ok(Math.abs(crossing(P, P, [0.5, 0.5, 3], [0.5, 0.5, -1]) - 0.75) < 1e-12);
// misses: outside the ellipse, from behind, parallel, and stopping short
assert.equal(crossing(P, P, [1.4, 1.4, 1], [1.4, 1.4, -1]), null);
assert.equal(crossing(P, P, [0, 0, -1], [0, 0, 1]), null);
assert.equal(crossing(P, P, [0, 0, 1], [1, 0, 1]), null);
assert.equal(crossing(P, P, [0, 0, 2], [0, 0, 0.5]), null);
// a moving portal: it sweeps past a still point
const P1 = frame({...P, c: [0, 0, 2]});
assert.ok(crossing(P, P1, [0, 0, 1], [0, 0, 1]) !== null);

// the default scene document is plain JSON, a 12 x 6 x 12 room with 40 bodies and no portals
const s = defaultScene();
assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
assert.equal(s.version, 1);
assert.equal(s.bodies.length, 40);
assert.equal(s.portals.length, 0);
assert.equal(new Set([...s.blocks, ...s.bodies].map((x) => x.id)).size, s.blocks.length + s.bodies.length);
assert.deepEqual(JSON.stringify(defaultScene()), JSON.stringify(s));

console.log('core checks passed: inverse maps, doorway, map quaternion, crossing hits and misses, default scene');
