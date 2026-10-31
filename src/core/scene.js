// The scene document: the single source of truth that physics and render are both rebuilt from.
// Plain JSON. Later prompts may add fields with defaults, never rename these.
//
// blocks[]  {id, kind: 'box', min, max, color}               axis-aligned, min/max corners in metres
//           {id, kind: 'ramp'|'pillar', pos, rot, size, color} centred at pos, rot a quaternion [x,y,z,w];
//           a ramp rises along its local +x, from the bottom at -x to the full height at +x
//           color null means "by face normal" (palette.js ROOM); a hex string overrides
// portals[] {id, pair, block, face, c, n, v, a, b, color}    see core/portal.js
// bodies[]  {id, shape: 'box'|'ball'|'capsule'|'plank', size, pos, quat, vel, angvel, mass, color}
//           size is the full extent [x, y, z] in the body frame; a ball is [d, d, d], a capsule [d, h, d]

import {qaxis} from './quat.js';

export const VERSION = 1;
export const SHAPES = ['box', 'ball', 'capsule', 'plank'];
export const PORTAL_COLOURS = ['#3E7C8F', '#C27A40', '#7E5BA6', '#5E9A4E'];

export function createScene(over = {}) {
  return {
    version: VERSION,
    settings: {gravity: [0, -9.81, 0], timeScale: 1, terminalSpeed: 40, quality: 'auto', ...over.settings},
    blocks: [],
    portals: [],
    bodies: [],
    emitters: [],
    camera: {pos: [5.4, 7.4, 5.6], target: [-1, 0.4, -1.2], fov: 60},
    nextId: 1,
    ...over,
  };
}

export const newId = (scene, prefix) => `${prefix}${scene.nextId++}`;

export function addBlock(scene, b) {
  const block = {id: newId(scene, 'k'), kind: 'box', color: null, ...b};
  if (block.kind !== 'box') block.rot ??= [0, 0, 0, 1];
  scene.blocks.push(block);
  return block;
}

export function addPortal(scene, p) {
  const portal = {
    id: newId(scene, 'p'), pair: null, block: null, face: '+z',
    c: [0, 1, 0], n: [0, 0, 1], v: [0, 1, 0], a: 0.7, b: 1.0,
    color: PORTAL_COLOURS[0], ...p,
  };
  scene.portals.push(portal);
  return portal;
}

export function addPortalPair(scene, a, b, color = PORTAL_COLOURS[Math.floor(scene.portals.length / 2) % PORTAL_COLOURS.length]) {
  const pa = addPortal(scene, {color, ...a});
  const pb = addPortal(scene, {color, ...b, pair: pa.id});
  pa.pair = pb.id;
  return [pa, pb];
}

export function addBody(scene, b) {
  const body = {
    id: newId(scene, 'b'), shape: 'box', size: [0.5, 0.5, 0.5], pos: [0, 2, 0], quat: [0, 0, 0, 1],
    vel: [0, 0, 0], angvel: [0, 0, 0], mass: 1, color: null, ...b,
  };
  scene.bodies.push(body);
  return body;
}

export function addEmitter(scene, e) {
  const emitter = {
    id: newId(scene, 'e'), shape: 'ball', size: [0.4, 0.4, 0.4], pos: [0, 3, 0], quat: [0, 0, 0, 1],
    rate: 2, speed: 4, mass: 1, color: null, ...e,
  };
  scene.emitters ??= [];
  scene.emitters.push(emitter);
  return emitter;
}

// deterministic pseudo random, so the default scene is the same on every load
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export const BODY_SIZES = {
  box: (r) => { const s = 0.45 + r() * 0.35; return [s, s, s]; },
  ball: (r) => { const d = 0.4 + r() * 0.3; return [d, d, d]; },
  capsule: (r) => { const d = 0.3 + r() * 0.15; return [d, d * (2 + r()), d]; },
  plank: () => [1.4, 0.12, 0.4],
};

// a body of the given shape somewhere above the open floor, with a little spin
export function randomBody(r, shape, over = {}) {
  return {
    shape, size: BODY_SIZES[shape](r),
    pos: [-4.5 + r() * 9, 2.5 + r() * 3, -4.5 + r() * 9],
    quat: qaxis([r() - 0.5, r() - 0.5, r() - 0.5], r() * Math.PI * 2),
    vel: [(r() - 0.5) * 2, r() * 2, (r() - 0.5) * 2],
    angvel: [(r() - 0.5) * 6, (r() - 0.5) * 6, (r() - 0.5) * 6],
    ...over,
  };
}

// the built-in scene: an open-topped 12 x 6 x 12 m room of blocks, two portal pairs, 40 bodies
export function defaultScene() {
  const s = createScene();
  const W = 6, T = 0.5, H = 6;
  const floor = addBlock(s, {min: [-W - T, -T, -W - T], max: [W + T, 0, W + T]});   // floor
  const wx0 = addBlock(s, {min: [-W - T, 0, -W - T], max: [-W, H, W + T]});         // -x wall
  addBlock(s, {min: [W, 0, -W - T], max: [W + T, H, W + T]});                       // +x wall
  const wz0 = addBlock(s, {min: [-W, 0, -W - T], max: [W, H, -W]});                 // -z wall
  addBlock(s, {min: [-W, 0, W], max: [W, H, W + T]});                               // +z wall
  addBlock(s, {min: [-6, 0, -6], max: [-3, 1.5, -3]});                              // corner platform
  addBlock(s, {min: [2, 0, -1], max: [4.5, 0.75, 2.5]});                            // low step
  addBlock(s, {kind: 'ramp', pos: [-1.5, 0.5, 3.5], size: [3, 1, 2]});
  addBlock(s, {kind: 'pillar', pos: [3.5, 1.5, -4], size: [0.8, 3, 0.8], rot: qaxis([0, 1, 0], Math.PI / 6)});
  // pair 1 (blue): floor <-> -x wall, aligned at 45 degrees so each opening can see its partner recursively
  addPortalPair(s,
    {block: floor.id, face: '+y', c: [-3.8, 0, -0.8], n: [0, 1, 0], v: [-1, 0, 0], a: 0.7, b: 1.0},
    {block: wx0.id, face: '+x', c: [-6, 2.2, -0.8], n: [1, 0, 0], v: [0, 1, 0], a: 0.7, b: 1.0},
    PORTAL_COLOURS[0]);
  // pair 2 (orange): -z wall <-> -x wall at right angles, both upright
  addPortalPair(s,
    {block: wz0.id, face: '+z', c: [-0.5, 1.6, -6], n: [0, 0, 1], v: [0, 1, 0], a: 0.7, b: 1.0},
    {block: wx0.id, face: '+x', c: [-6, 1.6, 1.5], n: [1, 0, 0], v: [0, 1, 0], a: 0.7, b: 1.0},
    PORTAL_COLOURS[1]);
  const r = rng(7);
  addBody(s, {shape: 'box', size: [0.55, 0.55, 0.55], pos: [-3.8, 0.45, -0.8], quat: qaxis([0, 1, 0], 0.4), color: '#D2432A'});
  for (let i = 1; i < 40; i++) addBody(s, randomBody(r, SHAPES[i % SHAPES.length]));
  return s;
}
