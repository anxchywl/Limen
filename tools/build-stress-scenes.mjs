// Generates the 6 required stress scene JSON documents for Limen prompt 07.
import fs from 'node:fs';
import path from 'node:path';
import {
  createScene, addBlock, addPortalPair, addBody, addEmitter,
  rng, randomBody, SHAPES, PORTAL_COLOURS
} from '../src/core/scene.js';
import {cleanScene, toJSON} from '../src/io/serialize.js';

const OUT_DIR = path.resolve('tests/stress');
fs.mkdirSync(OUT_DIR, {recursive: true});

function standardRoom(scene, W = 6, H = 6, T = 0.5) {
  const floor = addBlock(scene, {id: 'floor', kind: 'box', min: [-W - T, -T, -W - T], max: [W + T, 0, W + T]});
  const wx0 = addBlock(scene, {id: 'wall_nx', kind: 'box', min: [-W - T, 0, -W - T], max: [-W, H, W + T]});
  const wx1 = addBlock(scene, {id: 'wall_px', kind: 'box', min: [W, 0, -W - T], max: [W + T, H, W + T]});
  const wz0 = addBlock(scene, {id: 'wall_nz', kind: 'box', min: [-W, 0, -W - T], max: [W, H, -W]});
  const wz1 = addBlock(scene, {id: 'wall_pz', kind: 'box', min: [-W, 0, W], max: [W, H, W + T]});
  return {floor, wx0, wx1, wz0, wz1};
}

// 1. pile: 300 bodies dropped into one floor portal whose exit is a wall portal
{
  const s = createScene();
  s.settings.quality = 'auto';
  s.camera = {pos: [5.5, 4.5, 5.5], target: [0, 2, 0], fov: 60};
  const {floor, wx0} = standardRoom(s);
  addPortalPair(s,
    {block: floor.id, face: '+y', c: [0, 0, 0], n: [0, 1, 0], v: [-1, 0, 0], a: 0.9, b: 1.2},
    {block: wx0.id, face: '+x', c: [-6, 3.0, 0], n: [1, 0, 0], v: [0, 1, 0], a: 0.9, b: 1.2},
    PORTAL_COLOURS[0]
  );
  const r = rng(42);
  const cols = 5;
  for (let i = 0; i < 300; i++) {
    const gx = (i % cols) - 2;
    const gz = (Math.floor(i / cols) % cols) - 2;
    const gy = Math.floor(i / (cols * cols));
    const shape = SHAPES[i % SHAPES.length];
    addBody(s, {
      shape,
      size: [0.4, 0.4, 0.4],
      pos: [gx * 0.45 + (r() - 0.5) * 0.1, 1.8 + gy * 0.55, gz * 0.45 + (r() - 0.5) * 0.1],
      quat: [0, 0, 0, 1],
      vel: [0, -1, 0],
      angvel: [(r() - 0.5) * 2, (r() - 0.5) * 2, (r() - 0.5) * 2],
      mass: 1,
    });
  }
  fs.writeFileSync(path.join(OUT_DIR, 'pile.json'), toJSON(cleanScene(s), 2));
}

// 2. mirrors: two pairs facing each other across a corridor, the camera in the middle (worst-case recursion)
{
  const s = createScene();
  s.settings.quality = 'auto';
  // Camera placed at origin looking directly into the facing portal pair
  s.camera = {pos: [0, 2.5, 0], target: [-6, 2.5, 0], fov: 75};
  const {floor, wx0, wx1, wz0, wz1} = standardRoom(s);
  // Pair 1: -x wall <-> +x wall (facing each other)
  addPortalPair(s,
    {block: wx0.id, face: '+x', c: [-6, 2.5, 0], n: [1, 0, 0], v: [0, 1, 0], a: 1.0, b: 1.4},
    {block: wx1.id, face: '-x', c: [6, 2.5, 0], n: [-1, 0, 0], v: [0, 1, 0], a: 1.0, b: 1.4},
    PORTAL_COLOURS[0]
  );
  // Pair 2: -z wall <-> +z wall (facing each other across corridor)
  addPortalPair(s,
    {block: wz0.id, face: '+z', c: [0, 2.5, -6], n: [0, 0, 1], v: [0, 1, 0], a: 1.0, b: 1.4},
    {block: wz1.id, face: '-z', c: [0, 2.5, 6], n: [0, 0, -1], v: [0, 1, 0], a: 1.0, b: 1.4},
    PORTAL_COLOURS[1]
  );
  // A few dynamic bodies floating / bouncing
  const r = rng(101);
  for (let i = 0; i < 20; i++) {
    addBody(s, randomBody(r, SHAPES[i % SHAPES.length], {
      pos: [-2 + r() * 4, 1.5 + r() * 2, -2 + r() * 4],
    }));
  }
  fs.writeFileSync(path.join(OUT_DIR, 'mirrors.json'), toJSON(cleanScene(s), 2));
}

// 3. endless: 100 bodies in a floor <-> ceiling loop
{
  const s = createScene();
  s.settings.quality = 'auto';
  s.settings.terminalSpeed = 40;
  s.camera = {pos: [5.2, 4.0, 5.2], target: [0, 3, 0], fov: 60};
  const {floor} = standardRoom(s);
  const ceil = addBlock(s, {id: 'ceiling_plat', kind: 'box', min: [-3, 5.5, -3], max: [3, 6.0, 3], color: '#7E5BA6'});
  addPortalPair(s,
    {block: floor.id, face: '+y', c: [0, 0, 0], n: [0, 1, 0], v: [0, 0, 1], a: 1.0, b: 1.0},
    {block: ceil.id, face: '-y', c: [0, 5.5, 0], n: [0, -1, 0], v: [0, 0, 1], a: 1.0, b: 1.0},
    PORTAL_COLOURS[0]
  );
  const r = rng(202);
  for (let i = 0; i < 100; i++) {
    const rx = (r() - 0.5) * 1.2;
    const rz = (r() - 0.5) * 1.2;
    const ry = 0.5 + (i / 100) * 4.5;
    addBody(s, {
      shape: SHAPES[i % SHAPES.length],
      size: [0.35, 0.35, 0.35],
      pos: [rx, ry, rz],
      quat: [0, 0, 0, 1],
      vel: [0, -10 - r() * 20, 0],
      angvel: [(r() - 0.5) * 4, (r() - 0.5) * 4, (r() - 0.5) * 4],
      mass: 1,
    });
  }
  fs.writeFileSync(path.join(OUT_DIR, 'endless.json'), toJSON(cleanScene(s), 2));
}

// 4. emitters: 8 emitters at max rate (5/s) until cap
{
  const s = createScene();
  s.settings.quality = 'auto';
  s.camera = {pos: [6.0, 5.0, 6.0], target: [0, 2, 0], fov: 65};
  const {floor, wx0, wx1, wz0, wz1} = standardRoom(s);
  // Add a portal pair so emitted bodies interact with portals
  addPortalPair(s,
    {block: floor.id, face: '+y', c: [0, 0, 0], n: [0, 1, 0], v: [-1, 0, 0], a: 0.9, b: 1.2},
    {block: wx0.id, face: '+x', c: [-6, 3.0, 0], n: [1, 0, 0], v: [0, 1, 0], a: 0.9, b: 1.2},
    PORTAL_COLOURS[0]
  );
  // 8 emitters on the 4 walls pointing inward
  const emitterConfigs = [
    {pos: [-5.6, 2.5, -2], quat: [0, 0.7071, 0, 0.7071], shape: 'ball'},
    {pos: [-5.6, 4.0, 2], quat: [0, 0.7071, 0, 0.7071], shape: 'box'},
    {pos: [5.6, 2.5, -2], quat: [0, -0.7071, 0, 0.7071], shape: 'capsule'},
    {pos: [5.6, 4.0, 2], quat: [0, -0.7071, 0, 0.7071], shape: 'plank'},
    {pos: [-2, 2.5, -5.6], quat: [0, 0, 0, 1], shape: 'ball'},
    {pos: [2, 4.0, -5.6], quat: [0, 0, 0, 1], shape: 'box'},
    {pos: [-2, 2.5, 5.6], quat: [0, 1, 0, 0], shape: 'capsule'},
    {pos: [2, 4.0, 5.6], quat: [0, 1, 0, 0], shape: 'heavy_ball'},
  ];
  for (const ec of emitterConfigs) {
    addEmitter(s, {
      ...ec,
      size: [0.4, 0.4, 0.4],
      rate: 5,
      speed: 6,
      mass: 1,
    });
  }
  fs.writeFileSync(path.join(OUT_DIR, 'emitters.json'), toJSON(cleanScene(s), 2));
}

// 5. churn: portals re-placed every 0.5 s with bodies in transit
{
  const s = createScene();
  s.settings.quality = 'auto';
  s.camera = {pos: [5.0, 4.0, 5.0], target: [0, 2, 0], fov: 60};
  const {floor, wx0, wz0} = standardRoom(s);
  addPortalPair(s,
    {block: floor.id, face: '+y', c: [-2, 0, 0], n: [0, 1, 0], v: [-1, 0, 0], a: 0.8, b: 1.1},
    {block: wx0.id, face: '+x', c: [-6, 2.5, 0], n: [1, 0, 0], v: [0, 1, 0], a: 0.8, b: 1.1},
    PORTAL_COLOURS[0]
  );
  addPortalPair(s,
    {block: wz0.id, face: '+z', c: [0, 2.5, -6], n: [0, 0, 1], v: [0, 1, 0], a: 0.8, b: 1.1},
    {block: floor.id, face: '+y', c: [2, 0, 0], n: [0, 1, 0], v: [0, 0, 1], a: 0.8, b: 1.1},
    PORTAL_COLOURS[1]
  );
  const r = rng(555);
  for (let i = 0; i < 60; i++) {
    addBody(s, {
      shape: SHAPES[i % SHAPES.length],
      size: [0.4, 0.4, 0.4],
      pos: [-2 + (r() - 0.5) * 1.5, 1.0 + (i / 60) * 8.0, (r() - 0.5) * 1.5],
      quat: [0, 0, 0, 1],
      vel: [0, -3, 0],
      angvel: [(r() - 0.5) * 2, (r() - 0.5) * 2, (r() - 0.5) * 2],
      mass: 1,
    });
  }
  fs.writeFileSync(path.join(OUT_DIR, 'churn.json'), toJSON(cleanScene(s), 2));
}

// 6. phone: the pile scene at phone limits (120 bodies, depth 3, view budget 12)
{
  const s = createScene();
  s.settings.quality = 'auto';
  s.camera = {pos: [4.5, 4.0, 4.5], target: [0, 1.8, 0], fov: 65};
  const {floor, wx0} = standardRoom(s);
  addPortalPair(s,
    {block: floor.id, face: '+y', c: [0, 0, 0], n: [0, 1, 0], v: [-1, 0, 0], a: 0.8, b: 1.1},
    {block: wx0.id, face: '+x', c: [-6, 2.5, 0], n: [1, 0, 0], v: [0, 1, 0], a: 0.8, b: 1.1},
    PORTAL_COLOURS[0]
  );
  const r = rng(777);
  const cols = 4;
  for (let i = 0; i < 120; i++) {
    const gx = (i % cols) - 1.5;
    const gz = (Math.floor(i / cols) % cols) - 1.5;
    const gy = Math.floor(i / (cols * cols));
    addBody(s, {
      shape: SHAPES[i % SHAPES.length],
      size: [0.4, 0.4, 0.4],
      pos: [gx * 0.45 + (r() - 0.5) * 0.1, 1.5 + gy * 0.55, gz * 0.45 + (r() - 0.5) * 0.1],
      quat: [0, 0, 0, 1],
      vel: [0, -1, 0],
      angvel: [(r() - 0.5) * 2, (r() - 0.5) * 2, (r() - 0.5) * 2],
      mass: 1,
    });
  }
  fs.writeFileSync(path.join(OUT_DIR, 'phone.json'), toJSON(cleanScene(s), 2));
}

console.log('Successfully generated all 6 stress scenes in tests/stress/!');
