// Scene document validator: sanitizes and validates untrusted scene inputs
// (shared URLs, uploaded files, or imported JSON).
// Rejects oversized payloads, prototype pollution, malformed JSON, NaN/Infinity,
// unknown versions, broken ID links, or excessive entity counts.

const MAX_PAYLOAD_BYTES = 1024 * 1024; // 1 MB
const MAX_BLOCKS = 100;
const MAX_PORTALS = 8;
const MAX_BODIES = 300;
const MAX_EMITTERS = 8;
const VALID_SHAPES = new Set(['box', 'ball', 'capsule', 'plank']);
const VALID_BLOCK_KINDS = new Set(['box', 'ramp', 'pillar']);

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function isVec3(v) {
  return Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber);
}

function isVec4(v) {
  return Array.isArray(v) && v.length === 4 && v.every(isFiniteNumber);
}

export function validate(input) {
  const errors = [];

  let text = '';
  let obj = null;

  if (typeof input === 'string') {
    text = input;
    if (text.length > MAX_PAYLOAD_BYTES) {
      return {ok: false, error: 'Payload exceeds 1 MB limit', errors: ['Payload size > 1 MB']};
    }
    // Prototype pollution check
    if (text.includes('__proto__') || text.includes('constructor') || text.includes('prototype')) {
      return {ok: false, error: 'Invalid document: forbidden property key', errors: ['Prototype pollution keys detected']};
    }
    try {
      obj = JSON.parse(text);
    } catch (e) {
      return {ok: false, error: `Invalid JSON: ${e.message}`, errors: [e.message]};
    }
  } else if (input && typeof input === 'object') {
    obj = input;
  } else {
    return {ok: false, error: 'Invalid input: expected JSON string or object', errors: ['Root is not an object']};
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return {ok: false, error: 'Scene document must be a non-null JSON object', errors: ['Root is not an object']};
  }

  // Version check
  if (obj.version !== 1) {
    return {
      ok: false,
      error: `Unsupported scene version: ${obj.version ?? 'missing'} (expected 1)`,
      errors: [`Version ${obj.version} not supported`],
    };
  }

  const ids = new Set();
  const duplicateIds = new Set();

  function trackId(id, type) {
    if (typeof id !== 'string' || id.length === 0) {
      errors.push(`Missing or invalid ${type} id`);
      return false;
    }
    if (ids.has(id)) {
      duplicateIds.add(id);
      errors.push(`Duplicate entity id: ${id}`);
      return false;
    }
    ids.add(id);
    return true;
  }

  // 1. Settings
  const rawSettings = obj.settings ?? {};
  const settings = {
    gravity: isVec3(rawSettings.gravity) ? [...rawSettings.gravity] : [0, -9.81, 0],
    timeScale: isFiniteNumber(rawSettings.timeScale) ? Math.max(0.05, Math.min(2, rawSettings.timeScale)) : 1,
    terminalSpeed: isFiniteNumber(rawSettings.terminalSpeed) ? Math.max(5, Math.min(100, rawSettings.terminalSpeed)) : 40,
    quality: typeof rawSettings.quality === 'string' ? rawSettings.quality : 'auto',
    trails: Boolean(rawSettings.trails),
  };

  // 2. Camera
  const rawCam = obj.camera ?? {};
  const camera = {
    pos: isVec3(rawCam.pos) ? [...rawCam.pos] : [5.4, 7.4, 5.6],
    target: isVec3(rawCam.target) ? [...rawCam.target] : [-1, 0.4, -1.2],
    fov: isFiniteNumber(rawCam.fov) ? Math.max(20, Math.min(120, rawCam.fov)) : 60,
  };

  // 3. Blocks
  if (obj.blocks !== undefined && !Array.isArray(obj.blocks)) {
    errors.push('blocks must be an array');
  }
  const rawBlocks = Array.isArray(obj.blocks) ? obj.blocks : [];
  if (rawBlocks.length > MAX_BLOCKS) {
    errors.push(`Too many blocks: ${rawBlocks.length} exceeds limit (${MAX_BLOCKS})`);
  }
  const cleanBlocks = [];
  for (let i = 0; i < Math.min(rawBlocks.length, MAX_BLOCKS); i++) {
    const b = rawBlocks[i];
    if (!b || typeof b !== 'object') {
      errors.push(`blocks[${i}] is not an object`);
      continue;
    }
    trackId(b.id, `block[${i}]`);
    const kind = b.kind ?? (b.min && b.max ? 'box' : 'box');
    if (!VALID_BLOCK_KINDS.has(kind)) {
      errors.push(`Invalid block kind: "${kind}"`);
      continue;
    }
    if (kind === 'box') {
      if (!isVec3(b.min) || !isVec3(b.max)) {
        errors.push(`Block ${b.id}: min and max must be finite 3D vectors`);
        continue;
      }
      cleanBlocks.push({
        id: b.id,
        kind: 'box',
        min: [Math.min(b.min[0], b.max[0]), Math.min(b.min[1], b.max[1]), Math.min(b.min[2], b.max[2])],
        max: [Math.max(b.min[0], b.max[0]), Math.max(b.min[1], b.max[1]), Math.max(b.min[2], b.max[2])],
        color: typeof b.color === 'string' ? b.color : null,
      });
    } else {
      if (!isVec3(b.pos) || !isVec3(b.size)) {
        errors.push(`Block ${b.id}: pos and size must be finite 3D vectors`);
        continue;
      }
      cleanBlocks.push({
        id: b.id,
        kind,
        pos: [...b.pos],
        size: b.size.map((s) => Math.max(0.1, Math.min(20, Math.abs(s)))),
        rot: isVec4(b.rot) ? [...b.rot] : [0, 0, 0, 1],
        color: typeof b.color === 'string' ? b.color : null,
      });
    }
  }

  // 4. Portals
  if (obj.portals !== undefined && !Array.isArray(obj.portals)) {
    errors.push('portals must be an array');
  }
  const rawPortals = Array.isArray(obj.portals) ? obj.portals : [];
  if (rawPortals.length > MAX_PORTALS) {
    errors.push(`Too many portals: ${rawPortals.length} exceeds limit (${MAX_PORTALS})`);
  }
  const cleanPortals = [];
  const portalMap = new Map();
  for (let i = 0; i < Math.min(rawPortals.length, MAX_PORTALS); i++) {
    const p = rawPortals[i];
    if (!p || typeof p !== 'object') {
      errors.push(`portals[${i}] is not an object`);
      continue;
    }
    trackId(p.id, `portal[${i}]`);
    if (!isVec3(p.c) || !isVec3(p.n) || !isVec3(p.v)) {
      errors.push(`Portal ${p.id}: c, n, v must be finite 3D vectors`);
      continue;
    }
    const a = isFiniteNumber(p.a) && p.a > 0.05 ? Math.min(10, p.a) : 0.7;
    const b = isFiniteNumber(p.b) && p.b > 0.05 ? Math.min(10, p.b) : 1.0;
    const cleanP = {
      id: p.id,
      pair: typeof p.pair === 'string' ? p.pair : null,
      block: typeof p.block === 'string' ? p.block : null,
      face: typeof p.face === 'string' ? p.face : '+z',
      c: [...p.c],
      n: [...p.n],
      v: [...p.v],
      a,
      b,
      color: typeof p.color === 'string' ? p.color : '#3E7C8F',
    };
    cleanPortals.push(cleanP);
    portalMap.set(p.id, cleanP);
  }

  // Verify portal partner integrity
  for (const p of cleanPortals) {
    if (p.pair && !portalMap.has(p.pair)) {
      errors.push(`Portal ${p.id} references missing pair partner: "${p.pair}"`);
    }
  }

  // 5. Bodies
  if (obj.bodies !== undefined && !Array.isArray(obj.bodies)) {
    errors.push('bodies must be an array');
  }
  const rawBodies = Array.isArray(obj.bodies) ? obj.bodies : [];
  if (rawBodies.length > 1000) {
    errors.push(`Excessive body count (${rawBodies.length} > 1000)`);
  }
  const cleanBodies = [];
  for (let i = 0; i < Math.min(rawBodies.length, MAX_BODIES); i++) {
    const b = rawBodies[i];
    if (!b || typeof b !== 'object') {
      errors.push(`bodies[${i}] is not an object`);
      continue;
    }
    trackId(b.id, `body[${i}]`);
    const shape = b.shape;
    if (!VALID_SHAPES.has(shape)) {
      errors.push(`Body ${b.id}: invalid shape "${shape}"`);
      continue;
    }
    if (!isVec3(b.pos) || !isVec3(b.size)) {
      errors.push(`Body ${b.id}: pos and size must be finite 3D vectors`);
      continue;
    }
    const mass = isFiniteNumber(b.mass) && b.mass > 0 ? Math.min(200, b.mass) : 1;
    const vel = isVec3(b.vel) ? b.vel.map((v) => Math.max(-60, Math.min(60, v))) : [0, 0, 0];
    const angvel = isVec3(b.angvel) ? b.angvel.map((w) => Math.max(-50, Math.min(50, w))) : [0, 0, 0];

    cleanBodies.push({
      id: b.id,
      shape,
      size: b.size.map((s) => Math.max(0.05, Math.min(20, Math.abs(s)))),
      pos: [...b.pos],
      quat: isVec4(b.quat) ? [...b.quat] : [0, 0, 0, 1],
      vel,
      angvel,
      mass,
      color: typeof b.color === 'string' ? b.color : null,
    });
  }

  // 6. Emitters
  if (obj.emitters !== undefined && !Array.isArray(obj.emitters)) {
    errors.push('emitters must be an array');
  }
  const rawEmitters = Array.isArray(obj.emitters) ? obj.emitters : [];
  if (rawEmitters.length > MAX_EMITTERS) {
    errors.push(`Too many emitters: ${rawEmitters.length} exceeds limit (${MAX_EMITTERS})`);
  }
  const cleanEmitters = [];
  for (let i = 0; i < Math.min(rawEmitters.length, MAX_EMITTERS); i++) {
    const e = rawEmitters[i];
    if (!e || typeof e !== 'object') {
      errors.push(`emitters[${i}] is not an object`);
      continue;
    }
    trackId(e.id, `emitter[${i}]`);
    if (!isVec3(e.pos)) {
      errors.push(`Emitter ${e.id}: pos must be finite 3D vector`);
      continue;
    }
    cleanEmitters.push({
      id: e.id,
      shape: VALID_SHAPES.has(e.shape) || e.shape === 'heavy_ball' ? e.shape : 'ball',
      size: isVec3(e.size) ? e.size.map((s) => Math.max(0.1, Math.min(10, Math.abs(s)))) : [0.4, 0.4, 0.4],
      pos: [...e.pos],
      quat: isVec4(e.quat) ? [...e.quat] : [0, 0, 0, 1],
      rate: isFiniteNumber(e.rate) ? Math.max(0.1, Math.min(5, e.rate)) : 2,
      speed: isFiniteNumber(e.speed) ? Math.max(0.1, Math.min(20, e.speed)) : 4,
      mass: isFiniteNumber(e.mass) ? Math.max(0.1, Math.min(100, e.mass)) : 1,
      color: typeof e.color === 'string' ? e.color : null,
    });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      error: `Validation failed with ${errors.length} error(s): ${errors[0]}`,
      errors,
    };
  }

  const cleanDoc = {
    version: 1,
    settings,
    camera,
    blocks: cleanBlocks,
    portals: cleanPortals,
    bodies: cleanBodies,
    emitters: cleanEmitters,
    nextId: typeof obj.nextId === 'number' && Number.isFinite(obj.nextId) ? obj.nextId : 100,
  };

  return {ok: true, doc: cleanDoc};
}
