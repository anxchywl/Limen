// Lengyel's oblique near-plane projection matrix, adapted from three.js Reflector.js (MIT).
// Replaces the third row of a virtual camera's projection matrix so the near clip plane (z_ndc = -1
// in WebGL2) lies on the exit portal's plane, clipping geometry behind the exit wall with no extra
// shader clip plane and tilting the far plane to keep depth precision usable.

import * as THREE from 'three';

const plane = new THREE.Plane();
const nVec = new THREE.Vector3();
const cVec = new THREE.Vector3();
const clipPlane = new THREE.Vector4();
const q = new THREE.Vector4();

export function applyObliqueNearPlane(camera, exitCenter, exitNormal, clipBias = 0) {
  nVec.set(exitNormal[0], exitNormal[1], exitNormal[2]).normalize();
  cVec.set(exitCenter[0], exitCenter[1], exitCenter[2]);
  plane.setFromNormalAndCoplanarPoint(nVec, cVec);
  plane.applyMatrix4(camera.matrixWorldInverse);
  clipPlane.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  // keep the near plane at least 0.1 mm in front of the eye so the projection stays non-singular
  if (clipPlane.w > -1e-4) clipPlane.w = -1e-4;

  const e = camera.projectionMatrix.elements;
  if (camera.isOrthographicCamera) {
    q.x = (Math.sign(clipPlane.x) + e[8]) / e[0];
    q.y = (Math.sign(clipPlane.y) + e[9]) / e[5];
    q.z = -camera.far;
    q.w = 1.0;
  } else {
    q.x = (Math.sign(clipPlane.x) + e[8]) / e[0];
    q.y = (Math.sign(clipPlane.y) + e[9]) / e[5];
    q.z = -1.0;
    q.w = (1.0 + e[10]) / e[14];
  }

  clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));
  e[2] = clipPlane.x;
  e[6] = clipPlane.y;
  if (camera.isOrthographicCamera) {
    e[10] = clipPlane.z - clipBias;
    e[14] = clipPlane.w - 1.0;
  } else {
    e[10] = clipPlane.z + 1.0 - clipBias;
    e[14] = clipPlane.w;
  }
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  return camera;
}
