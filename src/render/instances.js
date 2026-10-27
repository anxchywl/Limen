// Bodies as one InstancedMesh per shape (box, ball, capsule, plank), with per-instance colour and
// a per-instance clip plane (aClip, see ink.js). Capacity starts at 512 per shape and doubles by
// reallocating when exceeded. Each frame, poses are blended from the last two physics frames.

import * as THREE from 'three';
import {SHAPES} from '../core/scene.js';
import {blendSlot} from '../core/interp.js';
import {BODY, PAPER} from './palette.js';
import {inkDepthMaterial, inkMaterial} from './ink.js';

const START = 512;

function boxGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const uv = g.attributes.uv;
  const e = new Float32Array(uv.count * 4);
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    e.set([u, 1 - u, v, 1 - v], i * 4);
  }
  g.setAttribute('aEdge', new THREE.BufferAttribute(e, 4));
  return g;
}

function geometries() {
  const box = boxGeometry();
  return {
    box, plank: box,
    ball: new THREE.SphereGeometry(0.5, 24, 16),
    // a sphere split at the equator by a hair of cylinder; ink.js stretches it to the body's length
    capsule: new THREE.CapsuleGeometry(0.5, 0.002, 8, 24, 1),
  };
}

const hash = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
export const bodyColour = (body) => body.color ?? BODY[hash(body.id) % BODY.length];

export function createInstances() {
  const geo = geometries();
  const group = new THREE.Group();
  group.name = 'bodies';
  const kinds = {};
  for (const shape of SHAPES) {
    const round = shape === 'ball' || shape === 'capsule';
    const capsule = shape === 'capsule';
    kinds[shape] = {
      shape, mesh: null, cap: 0, slots: new Int32Array(0), sizes: new Float32Array(0), n: 0,
      material: inkMaterial({mode: round ? 'round' : 'faces', capsule, clip: true, ink: PAPER.ink, width: 0.6}),
      depth: inkDepthMaterial({capsule, clip: true}),
    };
  }

  // make room for at least `want` instances, keeping what is there
  function reserve(k, want) {
    if (want <= k.cap && k.mesh) return;
    let cap = Math.max(START, k.cap);
    while (cap < want) cap *= 2;
    // each mesh owns a full copy: disposing a shared one would free GL buffers another mesh still draws
    const geometry = geo[k.shape].clone();
    const clip = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    geometry.setAttribute('aClip', clip);
    const mesh = new THREE.InstancedMesh(geometry, k.material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color()); // allocates instanceColor
    mesh.customDepthMaterial = k.depth;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.name = k.shape;
    mesh.count = 0;
    if (k.mesh) {
      mesh.instanceMatrix.array.set(k.mesh.instanceMatrix.array);
      mesh.instanceColor.array.set(k.mesh.instanceColor.array);
      clip.array.set(k.mesh.geometry.attributes.aClip.array);
      mesh.count = k.mesh.count;
      group.remove(k.mesh);
      k.mesh.geometry.dispose();
      k.mesh.dispose();
    }
    const slots = new Int32Array(cap); slots.set(k.slots);
    const sizes = new Float32Array(cap * 3); sizes.set(k.sizes);
    Object.assign(k, {mesh, cap, slots, sizes});
    group.add(mesh);
  }

  // assign every body (slot i = bodies[i]) to its shape's mesh, with its colour and size
  const colour = new THREE.Color();
  function setBodies(bodies) {
    const counts = Object.fromEntries(SHAPES.map((s) => [s, 0]));
    for (const b of bodies) counts[b.shape]++;
    for (const s of SHAPES) { reserve(kinds[s], counts[s]); kinds[s].n = 0; }
    bodies.forEach((b, i) => {
      const k = kinds[b.shape];
      const j = k.n++;
      k.slots[j] = i;
      k.sizes.set(b.size, j * 3);
      k.mesh.setColorAt(j, colour.set(bodyColour(b)));
    });
    for (const s of SHAPES) {
      const k = kinds[s];
      k.mesh.count = k.n;
      k.mesh.instanceColor.needsUpdate = true;
      k.mesh.geometry.attributes.aClip.needsUpdate = true;
    }
  }

  // write blended instance matrices; no allocation per body
  const pose = new Float64Array(14);
  function update(prev, curr, alpha, maps) {
    for (const s of SHAPES) {
      const k = kinds[s], a = k.mesh.instanceMatrix.array;
      let live = 0;
      for (let j = 0; j < k.n; j++) {
        const flags = blendSlot(prev, curr, k.slots[j], alpha, maps, pose);
        const o = j * 16;
        if (!flags) { a.fill(0, o, o + 16); continue; }
        live++;
        const sx = k.sizes[j * 3], sy = k.sizes[j * 3 + 1], sz = k.sizes[j * 3 + 2];
        const x = pose[3], y = pose[4], z = pose[5], w = pose[6];
        const x2 = x + x, y2 = y + y, z2 = z + z;
        const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
        const wx = w * x2, wy = w * y2, wz = w * z2;
        a[o] = (1 - (yy + zz)) * sx; a[o + 1] = (xy + wz) * sx; a[o + 2] = (xz - wy) * sx; a[o + 3] = 0;
        a[o + 4] = (xy - wz) * sy; a[o + 5] = (1 - (xx + zz)) * sy; a[o + 6] = (yz + wx) * sy; a[o + 7] = 0;
        a[o + 8] = (xz + wy) * sz; a[o + 9] = (yz - wx) * sz; a[o + 10] = (1 - (xx + yy)) * sz; a[o + 11] = 0;
        a[o + 12] = pose[0]; a[o + 13] = pose[1]; a[o + 14] = pose[2]; a[o + 15] = 1;
      }
      k.mesh.instanceMatrix.needsUpdate = true;
      k.live = live;
    }
  }

  // set the clip plane of slot i's instance; (0,0,0,0) clears it. Prompt 02 drives this.
  function setClip(shape, j, plane) {
    const k = kinds[shape];
    k.mesh.geometry.attributes.aClip.array.set(plane, j * 4);
    k.mesh.geometry.attributes.aClip.needsUpdate = true;
  }

  return {
    group, kinds, setBodies, update, setClip,
    get capacity() { return Object.fromEntries(SHAPES.map((s) => [s, kinds[s].cap])); },
    dispose() {
      for (const s of SHAPES) {
        const k = kinds[s];
        k.mesh?.geometry.dispose(); k.mesh?.dispose(); k.material.dispose(); k.depth.dispose();
      }
      new Set(Object.values(geo)).forEach((g) => g.dispose());
    },
  };
}
