// Static blocks from the scene document, merged into one mesh (one draw, one material).
// Each face takes its colour from its normal (palette.js ROOM), or the block's own colour, and
// carries aEdge, its distances to its borders, so ink.js can draw constant-pixel ink edges.

import * as THREE from 'three';
import {qrot} from '../core/quat.js';
import {PAPER, ROOM} from './palette.js';
import {inkMaterial} from './ink.js';

const FAR = 1e3;

// the faces of a block, each a convex polygon (3 or 4 corners, counter-clockwise seen from outside)
export function blockFaces(b) {
  if (b.kind === 'box' || !b.kind) {
    const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
    return [
      [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
      [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
      [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
      [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
      [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
    ];
  }
  const [x, y, z] = b.size.map((s) => s / 2);
  const local = b.kind === 'ramp' ? [
    [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]],          // back, full height
    [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]],      // bottom
    [[-x, -y, z], [x, -y, z], [x, y, z]],                      // side
    [[x, -y, -z], [-x, -y, -z], [x, y, -z]],                   // side
    [[-x, -y, z], [x, y, z], [x, y, -z], [-x, -y, -z]],        // slope
  ] : blockFaces({kind: 'box', min: [-x, -y, -z], max: [x, y, z]});
  return local.map((f) => f.map((p) => qrot(b.rot, p).map((v, i) => v + b.pos[i])));
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossv = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };

// the ROOM key of the axis a normal points along most
export function faceKey(n) {
  const k = [0, 1, 2].reduce((m, i) => (Math.abs(n[i]) > Math.abs(n[m]) ? i : m), 0);
  return `${n[k] >= 0 ? '+' : '-'}${'xyz'[k]}`;
}

export function levelGeometry(blocks) {
  const pos = [], nrm = [], col = [], edge = [];
  const c = new THREE.Color();
  for (const b of blocks) {
    for (const f of blockFaces(b)) {
      const n = unit(crossv(sub(f[1], f[0]), sub(f[2], f[0])));
      c.set(b.color ?? ROOM[faceKey(n)]);
      // inward distance from each corner to each border line, up to four borders
      const borders = f.map((p, i) => {
        const q = f[(i + 1) % f.length];
        const inward = unit(crossv(n, sub(q, p)));
        return (x) => dotv(sub(x, p), inward);
      });
      const dist = (x) => [0, 1, 2, 3].map((i) => (borders[i] ? borders[i](x) : FAR));
      for (let i = 1; i + 1 < f.length; i++) {
        for (const p of [f[0], f[i], f[i + 1]]) {
          pos.push(...p); nrm.push(...n); col.push(c.r, c.g, c.b); edge.push(...dist(p));
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 4));
  g.computeBoundingSphere();
  return g;
}

export function createLevel(scene) {
  const material = inkMaterial({
    mode: 'faces', vertexColors: true, ink: PAPER.ink, width: 0.7,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2,
  });
  const mesh = new THREE.Mesh(levelGeometry(scene.blocks), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'level';
  const group = new THREE.Group();
  group.add(mesh);
  return {
    group, material,
    rebuild(blocks) { mesh.geometry.dispose(); mesh.geometry = levelGeometry(blocks); },
    dispose() { mesh.geometry.dispose(); material.dispose(); },
  };
}
