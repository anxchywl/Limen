// Headless checks of Lengyel's oblique near plane (render/oblique.js):
// points behind the exit portal plane get clip z outside [-1, 1], points on the plane land at -1,
// points in front up to the far plane stay inside (-1, 1) with monotonic depth, and NDC x/y stay fixed.

import assert from 'node:assert/strict';
import * as THREE from 'three';
import {frame, portalMap} from '../src/core/portal.js';
import {applyObliqueNearPlane} from '../src/render/oblique.js';

const v4 = new THREE.Vector4();
function clipOf(cam, [x, y, z]) {
  v4.set(x, y, z, 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
  return {x: v4.x / v4.w, y: v4.y / v4.w, z: v4.z / v4.w, w: v4.w, rawZ: v4.z};
}
const clipped = (c) => c.w <= 0 || c.z < -1 || c.z > 1;

// 1. Axis-aligned exit portal at z = 0 facing +z, virtual camera behind it at z = -4
{
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 200);
  cam.position.set(0, 1.5, -4);
  cam.lookAt(0, 1.5, 5);
  cam.updateMatrixWorld();
  const base = cam.clone();
  applyObliqueNearPlane(cam, [0, 1.5, 0], [0, 0, 1]);

  // on the exit plane: clip z is -1 across the opening
  for (const [x, y] of [[0, 1.5], [0.5, 2.1], [-0.6, 0.9]]) {
    const c = clipOf(cam, [x, y, 0]);
    assert.ok(Math.abs(c.z - -1) < 1e-5, `on plane z=${c.z}`);
  }
  // behind the exit plane (between virtual camera and exit wall, and behind the camera): outside [-1, 1]
  for (const p of [[0, 1.5, -0.01], [0.4, 1.8, -1.5], [-0.3, 1.2, -3.9], [0, 1.5, -6]]) {
    const c = clipOf(cam, p);
    assert.ok(clipped(c), `expected ${p} behind exit plane to clip, got z=${c.z}, w=${c.w}`);
  }
  // in front of the exit plane: strictly inside (-1, 1), monotonically increasing with distance, x/y unchanged
  let prevZ = -1;
  for (const z of [0.05, 0.5, 2, 10, 50, 120]) {
    const c = clipOf(cam, [0.3, 1.7, z]);
    const b = clipOf(base, [0.3, 1.7, z]);
    assert.ok(c.w > 0 && c.z > -1 && c.z < 1, `expected z=${z} inside (-1, 1), got ${c.z}`);
    assert.ok(c.z > prevZ, `depth not monotonic at z=${z}: ${c.z} <= ${prevZ}`);
    assert.ok(Math.abs(c.x - b.x) < 1e-6 && Math.abs(c.y - b.y) < 1e-6, 'screen x/y shifted');
    prevZ = c.z;
  }
}

// 2. Virtual camera mapped through a tilted / right-angle floor-to-wall portal pair
{
  const entry = frame({c: [-3.8, 0, -0.8], n: [0, 1, 0], v: [-1, 0, 0], a: 0.7, b: 1.0});
  const exit = frame({c: [-6, 2.2, -0.8], n: [1, 0, 0], v: [0, 1, 0], a: 0.7, b: 1.0});
  const M = portalMap(entry, exit);
  const m4 = new THREE.Matrix4().set(
    M.R[0][0], M.R[1][0], M.R[2][0], M.t[0],
    M.R[0][1], M.R[1][1], M.R[2][1], M.t[1],
    M.R[0][2], M.R[1][2], M.R[2][2], M.t[2],
    0, 0, 0, 1,
  );
  const mainCam = new THREE.PerspectiveCamera(60, 1.4, 0.05, 200);
  mainCam.position.set(1.2, 3.5, 2.0);
  mainCam.lookAt(-3.8, 0, -0.8);
  mainCam.updateMatrixWorld();

  const vcam = new THREE.PerspectiveCamera(60, 1.4, 0.05, 200);
  vcam.matrixAutoUpdate = false;
  vcam.matrixWorldAutoUpdate = false;
  vcam.matrixWorld.multiplyMatrices(m4, mainCam.matrixWorld);
  vcam.matrixWorldInverse.copy(vcam.matrixWorld).invert();
  vcam.projectionMatrix.copy(mainCam.projectionMatrix);
  applyObliqueNearPlane(vcam, exit.c, exit.n);

  // exit sits at x = -6 with normal +x: x < -6 is behind the exit wall ("banana juice"), x > -6 is inside the room
  for (const p of [[-6.02, 2.2, -0.8], [-6.5, 2.5, -1.0], [-8.0, 1.0, 0.0]]) {
    const c = clipOf(vcam, p);
    assert.ok(clipped(c), `expected ${p} behind x=-6 wall to clip, got z=${c.z}, w=${c.w}`);
  }
  const onExit = clipOf(vcam, [-6, 2.2, -0.8]);
  assert.ok(Math.abs(onExit.z - -1) < 1e-5, `exit centre z=${onExit.z}`);
  for (const p of [[-5.8, 2.2, -0.8], [-2.0, 1.5, -0.5], [4.0, 2.0, 1.0]]) {
    const c = clipOf(vcam, p);
    assert.ok(c.w > 0 && c.z > -1 && c.z < 1, `expected ${p} in room inside (-1, 1), got z=${c.z}`);
  }
}

console.log('oblique checks passed: exit plane maps to z=-1, points behind clip outside [-1, 1], room depths monotonic');
