// Scene document serialization and deserialization.
// Writes only document fields (never runtime physics/render state),
// quantizes coordinates to 1 mm and rotations to 4 decimals,
// and parses safely via validation.

import {validate} from './validate.js';

export function quantize(val, decimals = 3) {
  if (Array.isArray(val)) {
    return val.map((v) => quantize(v, decimals));
  }
  if (typeof val === 'number') {
    const factor = 10 ** decimals;
    return Math.round(val * factor) / factor;
  }
  return val;
}

export function cleanBlock(b) {
  if (b.kind === 'box' || (!b.kind && b.min && b.max)) {
    return {
      id: b.id,
      kind: 'box',
      min: quantize(b.min, 3),
      max: quantize(b.max, 3),
      color: b.color ?? null,
    };
  }
  return {
    id: b.id,
    kind: b.kind ?? 'box',
    pos: quantize(b.pos, 3),
    size: quantize(b.size, 3),
    rot: quantize(b.rot ?? [0, 0, 0, 1], 4),
    color: b.color ?? null,
  };
}

export function cleanPortal(p) {
  return {
    id: p.id,
    pair: p.pair ?? null,
    block: p.block ?? null,
    face: p.face ?? '+z',
    c: quantize(p.c, 3),
    n: quantize(p.n, 4),
    v: quantize(p.v, 4),
    a: quantize(p.a, 3),
    b: quantize(p.b, 3),
    color: p.color ?? null,
  };
}

export function cleanBody(b) {
  return {
    id: b.id,
    shape: b.shape ?? 'box',
    size: quantize(b.size ?? [0.5, 0.5, 0.5], 3),
    pos: quantize(b.pos ?? [0, 1, 0], 3),
    quat: quantize(b.quat ?? [0, 0, 0, 1], 4),
    vel: quantize(b.vel ?? [0, 0, 0], 2),
    angvel: quantize(b.angvel ?? [0, 0, 0], 2),
    mass: quantize(b.mass ?? 1, 2),
    color: b.color ?? null,
  };
}

export function cleanEmitter(e) {
  return {
    id: e.id,
    shape: e.shape ?? 'ball',
    size: quantize(e.size ?? [0.4, 0.4, 0.4], 3),
    pos: quantize(e.pos ?? [0, 3, 0], 3),
    quat: quantize(e.quat ?? [0, 0, 0, 1], 4),
    rate: quantize(e.rate ?? 2, 2),
    speed: quantize(e.speed ?? 4, 2),
    mass: quantize(e.mass ?? 1, 2),
    color: e.color ?? null,
  };
}

export function cleanScene(scene) {
  return {
    version: 1,
    settings: {
      gravity: quantize(scene.settings?.gravity ?? [0, -9.81, 0], 2),
      timeScale: quantize(scene.settings?.timeScale ?? 1, 2),
      terminalSpeed: quantize(scene.settings?.terminalSpeed ?? 40, 1),
      quality: scene.settings?.quality ?? 'auto',
      trails: Boolean(scene.settings?.trails),
    },
    camera: {
      pos: quantize(scene.camera?.pos ?? [5.4, 7.4, 5.6], 3),
      target: quantize(scene.camera?.target ?? [-1, 0.4, -1.2], 3),
      fov: quantize(scene.camera?.fov ?? 60, 1),
    },
    blocks: (scene.blocks ?? []).map(cleanBlock),
    portals: (scene.portals ?? []).map(cleanPortal),
    bodies: (scene.bodies ?? []).filter((b) => !b._dead).map(cleanBody),
    emitters: (scene.emitters ?? []).map(cleanEmitter),
    nextId: typeof scene.nextId === 'number' ? scene.nextId : 1,
  };
}

export function toJSON(scene, indent = 2) {
  const clean = cleanScene(scene);
  return indent > 0 ? JSON.stringify(clean, null, indent) : JSON.stringify(clean);
}

export function fromJSON(text) {
  const res = validate(text);
  if (!res.ok) return res;
  return {ok: true, doc: res.doc};
}
