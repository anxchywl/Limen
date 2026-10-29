// Pure Rapier 3D world controller shared by the Web Worker (worker.js) and headless tests (tests/physics.mjs).
// Builds static block colliders and dynamic rigid bodies from the scene document, enforces robustness
// guards (speed clamps, Ianua quadratic air drag, per-step CCD toggling, free-space spawn nudges,
// depenetration frequency cap, NaN and step-time watchdogs), and supports exact snapshot reset.

import {
  ALIVE, FLAGS, H_COUNT, H_SLOTS, H_STEP, H_TIME, POS, QUAT,
  createSlotMap, frameLength, slotOffset,
} from './protocol.js';

export const DT = 1 / 60;
export const MAX_LINVEL = 60;
export const MAX_ANGVEL = 50;
export const CCD_MIN_SIZE = 0.3;
export const CCD_SPEED = 15;
export const MIN_BODY_SIZE = 0.1;
export const MIN_MASS = 0.5;
export const MAX_MASS = 25; // 1:50 dynamic mass-ratio cap (0.5 .. 25 kg)
export const DEFAULT_MAX_BODIES = 300;
const SPAWN_NUDGE = 0.05;
const SPAWN_TRIES = 10;
const BUSY_MS = 8;
const BUSY_STREAK = 30;
const KILL_Y = -60;
const KILL_EXTENT = 250;
// Rapier 0.21 exposes contact recovery stiffness as `IntegrationParameters.contact_natural_frequency`
// (default 30 Hz -> erp ~0.136); 20 Hz (~0.095 erp) softens overlap recovery so stacked/nudged bodies never pop
const CONTACT_FREQ_HZ = 20;

const finite3 = (a) => Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);
const finite4 = (q) => Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w);

function normQuat(q) {
  const x = q?.[0] ?? 0, y = q?.[1] ?? 0, z = q?.[2] ?? 0, w = q?.[3] ?? 1;
  const l = Math.hypot(x, y, z, w);
  if (!Number.isFinite(l) || l < 1e-9) return [0, 0, 0, 1];
  return [x / l, y / l, z / l, w / l];
}

function clampSize(size, shape) {
  const sx = Math.max(MIN_BODY_SIZE, Number.isFinite(size?.[0]) ? size[0] : 0.5);
  const sy = Math.max(MIN_BODY_SIZE, Number.isFinite(size?.[1]) ? size[1] : sx);
  const sz = Math.max(MIN_BODY_SIZE, Number.isFinite(size?.[2]) ? size[2] : sx);
  if (shape === 'ball') return [sx, sx, sx];
  if (shape === 'capsule') return [sx, Math.max(sx, sy), sx];
  return [sx, sy, sz];
}

function clampMass(m) {
  const raw = Number.isFinite(m) && m > 0 ? m : 1;
  return Math.max(MIN_MASS, Math.min(MAX_MASS, raw));
}

function cloneBodySpec(b) {
  return {
    ...b,
    size: [...b.size],
    pos: [...b.pos],
    quat: [...b.quat],
    vel: [...(b.vel ?? [0, 0, 0])],
    angvel: [...(b.angvel ?? [0, 0, 0])],
  };
}

export function createPhysicsWorld(RAPIER, {onEvent, now = () => performance.now()} = {}) {
  const slots = createSlotMap();
  let world = null;
  let settings = {
    gravity: [0, -9.81, 0], terminalSpeed: 40, timeScale: 1, quality: 'auto', maxBodies: DEFAULT_MAX_BODIES,
  };
  let blocks = new Map(); // blockId -> {id, rbHandle, colHandle, min, max, spec}
  let entries = [];       // [{id, slot, rbHandle, colHandle, rb, collider, minDim, boundR, spec}]
  let byId = new Map();   // bodyId -> entry
  let steps = 0;
  let busyCount = 0;
  let busyLatched = false;
  let lastStepMs = 0;
  let snap = null;
  let dirtyEdit = false;

  const emit = (ev) => onEvent?.(ev);

  function configureWorld(w) {
    w.timestep = DT;
    w.integrationParameters.contact_natural_frequency = CONTACT_FREQ_HZ;
    w.maxCcdSubsteps = 2;
  }

  function blockColliderDesc(b) {
    if (b.kind === 'box' || !b.kind) {
      const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
      const hx = Math.max(0.005, (x1 - x0) / 2);
      const hy = Math.max(0.005, (y1 - y0) / 2);
      const hz = Math.max(0.005, (z1 - z0) / 2);
      return {
        pos: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
        rot: [0, 0, 0, 1],
        desc: RAPIER.ColliderDesc.cuboid(hx, hy, hz),
        min: [x0, y0, z0],
        max: [x1, y1, z1],
      };
    }
    const [hx, hy, hz] = b.size.map((s) => Math.max(0.01, s / 2));
    const pos = b.pos ?? [0, 0, 0];
    const rot = normQuat(b.rot);
    const r = Math.hypot(hx, hy, hz);
    const desc = b.kind === 'ramp'
      ? RAPIER.ColliderDesc.convexHull(new Float32Array([
        -hx, -hy, -hz, -hx, -hy, hz,
        hx, -hy, -hz, hx, -hy, hz,
        hx, hy, -hz, hx, hy, hz,
      ]))
      : RAPIER.ColliderDesc.cuboid(hx, hy, hz);
    return {
      pos, rot, desc,
      min: [pos[0] - r, pos[1] - r, pos[2] - r],
      max: [pos[0] + r, pos[1] + r, pos[2] + r],
    };
  }

  function addStaticBlock(b) {
    const info = blockColliderDesc(b);
    if (!info.desc) return;
    info.desc.setFriction(0.6).setRestitution(0.2);
    const rbDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(info.pos[0], info.pos[1], info.pos[2])
      .setRotation({x: info.rot[0], y: info.rot[1], z: info.rot[2], w: info.rot[3]});
    const rb = world.createRigidBody(rbDesc);
    const col = world.createCollider(info.desc, rb);
    blocks.set(b.id, {
      id: b.id, rbHandle: rb.handle, colHandle: col.handle,
      rb, collider: col, min: info.min, max: info.max, spec: structuredClone(b),
    });
  }

  function bodyColliderDesc(shape, size, mass) {
    if (shape === 'ball') {
      const r = size[0] / 2;
      return {
        desc: RAPIER.ColliderDesc.ball(r).setMass(mass).setFriction(0.5).setRestitution(0.35),
        probe: new RAPIER.Ball(Math.max(0.01, r - 1e-4)),
        minDim: size[0],
        boundR: r,
      };
    }
    if (shape === 'capsule') {
      const r = size[0] / 2;
      const halfH = Math.max(0.001, (size[1] - size[0]) / 2);
      return {
        desc: RAPIER.ColliderDesc.capsule(halfH, r).setMass(mass).setFriction(0.55).setRestitution(0.25),
        probe: new RAPIER.Capsule(halfH, Math.max(0.01, r - 1e-4)),
        minDim: size[0],
        boundR: halfH + r,
      };
    }
    const hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
    return {
      desc: RAPIER.ColliderDesc.cuboid(hx, hy, hz).setMass(mass).setFriction(0.6).setRestitution(0.18),
      probe: new RAPIER.Cuboid(Math.max(0.01, hx - 1e-4), Math.max(0.01, hy - 1e-4), Math.max(0.01, hz - 1e-4)),
      minDim: Math.min(size[0], size[1], size[2]),
      boundR: Math.hypot(hx, hy, hz),
    };
  }

  function clampVec(vx, vy, vz, maxMag) {
    const m = Math.hypot(vx, vy, vz);
    if (m <= maxMag || m === 0) return [vx, vy, vz, m];
    const k = maxMag / m;
    return [vx * k, vy * k, vz * k, maxMag];
  }

  function intersectsAny(probe, boundR, px, py, pz, rotObj) {
    const posObj = {x: px, y: py, z: pz};
    for (const blk of blocks.values()) {
      if (px + boundR < blk.min[0] || px - boundR > blk.max[0] ||
          py + boundR < blk.min[1] || py - boundR > blk.max[1] ||
          pz + boundR < blk.min[2] || pz - boundR > blk.max[2]) continue;
      if (blk.collider.intersectsShape(probe, posObj, rotObj)) return true;
    }
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const tp = e.rb.translation();
      const dx = px - tp.x, dy = py - tp.y, dz = pz - tp.z;
      const rr = boundR + e.boundR;
      if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
      if (e.collider.intersectsShape(probe, posObj, rotObj)) return true;
    }
    return false;
  }

  function insertDynamicBody(rawBody, {checkFreeSpace = false} = {}) {
    const shape = rawBody.shape ?? 'box';
    const size = clampSize(rawBody.size, shape);
    const mass = clampMass(rawBody.mass);
    const quat = normQuat(rawBody.quat);
    const rotObj = {x: quat[0], y: quat[1], z: quat[2], w: quat[3]};
    const [vx, vy, vz, linSpeed] = clampVec(
      rawBody.vel?.[0] ?? 0, rawBody.vel?.[1] ?? 0, rawBody.vel?.[2] ?? 0, MAX_LINVEL);
    const [wx, wy, wz] = clampVec(
      rawBody.angvel?.[0] ?? 0, rawBody.angvel?.[1] ?? 0, rawBody.angvel?.[2] ?? 0, MAX_ANGVEL);
    const {desc, probe, minDim, boundR} = bodyColliderDesc(shape, size, mass);

    let px = rawBody.pos?.[0] ?? 0;
    let py = rawBody.pos?.[1] ?? 2;
    let pz = rawBody.pos?.[2] ?? 0;
    let nudges = 0;

    if (checkFreeSpace) {
      let clear = false;
      for (let attempt = 0; attempt <= SPAWN_TRIES; attempt++) {
        const ty = py + attempt * SPAWN_NUDGE;
        if (!intersectsAny(probe, boundR, px, ty, pz, rotObj)) {
          py = ty;
          nudges = attempt;
          clear = true;
          break;
        }
      }
      if (!clear) {
        emit({type: 'refused', reason: 'blocked', id: rawBody.id ?? null});
        return {ok: false, reason: 'blocked'};
      }
    }

    const id = rawBody.id ?? `b_${slots.span}`;
    if (byId.has(id)) remove(id, 'replace');

    const ccd = minDim < CCD_MIN_SIZE || linSpeed > CCD_SPEED;
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(px, py, pz)
      .setRotation(rotObj)
      .setLinvel(vx, vy, vz)
      .setAngvel({x: wx, y: wy, z: wz})
      .setAngularDamping(0.15)
      .setCcdEnabled(ccd);
    const rb = world.createRigidBody(rbDesc);
    const collider = world.createCollider(desc, rb);
    const slot = slots.alloc(id);
    const spec = {
      ...rawBody, id, shape, size, mass,
      pos: [px, py, pz], quat, vel: [vx, vy, vz], angvel: [wx, wy, wz],
    };
    const entry = {
      id, slot, rbHandle: rb.handle, colHandle: collider.handle,
      rb, collider, minDim, boundR, spec,
    };
    entries.push(entry);
    byId.set(id, entry);
    return {ok: true, id, slot, nudges, body: cloneBodySpec(spec)};
  }

  function removeEntryAt(idx, reason = 'user') {
    const e = entries[idx];
    if (!e) return false;
    entries.splice(idx, 1);
    byId.delete(e.id);
    slots.free(e.id);
    if (world && e.rb?.isValid?.()) world.removeRigidBody(e.rb);
    emit({type: 'removed', reason, id: e.id, slot: e.slot});
    return true;
  }

  function saveSnapshot() {
    if (!world) return null;
    snap = {
      rapierBytes: world.takeSnapshot(),
      slots: slots.snapshot(),
      settings: structuredClone(settings),
      steps,
      blocks: [...blocks.values()].map((b) => ({
        id: b.id, rbHandle: b.rbHandle, colHandle: b.colHandle,
        min: [...b.min], max: [...b.max], spec: structuredClone(b.spec),
      })),
      entries: entries.map((e) => ({
        id: e.id, slot: e.slot, rbHandle: e.rbHandle, colHandle: e.colHandle,
        minDim: e.minDim, boundR: e.boundR, spec: cloneBodySpec(e.spec),
      })),
    };
    dirtyEdit = false;
    return snap.rapierBytes;
  }

  function load(scene) {
    if (world) { world.free(); world = null; }
    slots.clear();
    blocks.clear();
    entries = [];
    byId.clear();
    steps = 0;
    busyCount = 0;
    busyLatched = false;
    settings = {
      gravity: [...(scene.settings?.gravity ?? [0, -9.81, 0])],
      terminalSpeed: scene.settings?.terminalSpeed ?? 40,
      timeScale: scene.settings?.timeScale ?? 1,
      quality: scene.settings?.quality ?? 'auto',
      maxBodies: scene.settings?.maxBodies ?? DEFAULT_MAX_BODIES,
    };
    const [gx, gy, gz] = settings.gravity;
    world = new RAPIER.World({x: gx, y: gy, z: gz});
    configureWorld(world);

    for (const b of scene.blocks ?? []) addStaticBlock(b);
    for (const b of scene.bodies ?? []) insertDynamicBody(b, {checkFreeSpace: false});
    saveSnapshot();
    emit({type: 'loaded', bodies: entries.map((e) => ({slot: e.slot, body: cloneBodySpec(e.spec)}))});
  }

  function reset() {
    if (!snap) return false;
    if (world) { world.free(); world = null; }
    world = RAPIER.World.restoreSnapshot(snap.rapierBytes);
    slots.restore(snap.slots);
    settings = structuredClone(snap.settings);
    steps = snap.steps;
    busyCount = 0;
    busyLatched = false;
    dirtyEdit = false;

    blocks.clear();
    for (const b of snap.blocks) {
      blocks.set(b.id, {
        ...b,
        min: [...b.min], max: [...b.max], spec: structuredClone(b.spec),
        rb: world.getRigidBody(b.rbHandle),
        collider: world.getCollider(b.colHandle),
      });
    }
    entries = snap.entries.map((e) => ({
      ...e,
      spec: cloneBodySpec(e.spec),
      rb: world.getRigidBody(e.rbHandle),
      collider: world.getCollider(e.colHandle),
    }));
    byId = new Map(entries.map((e) => [e.id, e]));
    emit({type: 'reset', bodies: entries.map((e) => ({slot: e.slot, body: cloneBodySpec(e.spec)}))});
    return true;
  }

  function spawn(body, {inEdit = false} = {}) {
    if (!world) return {ok: false, reason: 'unloaded'};
    const maxBodies = settings.maxBodies ?? DEFAULT_MAX_BODIES;
    if (!byId.has(body?.id) && slots.count >= maxBodies) {
      emit({type: 'refused', reason: 'limit', id: body?.id ?? null, max: maxBodies});
      return {ok: false, reason: 'limit'};
    }
    const res = insertDynamicBody(body, {checkFreeSpace: true});
    if (res.ok) {
      if (inEdit) dirtyEdit = true;
      emit({type: 'spawned', id: res.id, slot: res.slot, nudges: res.nudges, body: res.body});
    }
    return res;
  }

  function remove(id, reason = 'user', {inEdit = false} = {}) {
    const idx = entries.findIndex((e) => e.id === id);
    if (idx >= 0) {
      if (inEdit) dirtyEdit = true;
      return removeEntryAt(idx, reason);
    }
    const blk = blocks.get(id);
    if (blk) {
      blocks.delete(id);
      if (world && blk.rb?.isValid?.()) world.removeRigidBody(blk.rb);
      if (inEdit) dirtyEdit = true;
      emit({type: 'removed', reason, id, slot: -1});
      return true;
    }
    return false;
  }

  function edit(entity, {inEdit = false} = {}) {
    if (!world || !entity?.id) return false;
    const e = byId.get(entity.id);
    if (e) {
      if (entity.pos) e.rb.setTranslation({x: entity.pos[0], y: entity.pos[1], z: entity.pos[2]}, true);
      if (entity.quat) {
        const q = normQuat(entity.quat);
        e.rb.setRotation({x: q[0], y: q[1], z: q[2], w: q[3]}, true);
      }
      if (entity.vel) e.rb.setLinvel({x: entity.vel[0], y: entity.vel[1], z: entity.vel[2]}, true);
      if (entity.angvel) e.rb.setAngvel({x: entity.angvel[0], y: entity.angvel[1], z: entity.angvel[2]}, true);
      Object.assign(e.spec, entity);
      if (inEdit) dirtyEdit = true;
      return true;
    }
    if (blocks.has(entity.id)) {
      remove(entity.id, 'edit', {inEdit});
      addStaticBlock(entity);
      if (inEdit) dirtyEdit = true;
      return true;
    }
    return false;
  }

  function setSettings(patch = {}, {inEdit = false} = {}) {
    Object.assign(settings, patch);
    if (world && patch.gravity) {
      world.gravity = {x: settings.gravity[0], y: settings.gravity[1], z: settings.gravity[2]};
      world.forEachRigidBody((rb) => { if (rb.isDynamic()) rb.wakeUp(); });
    }
    if (inEdit) dirtyEdit = true;
  }

  function injectNaN(id) {
    const e = id ? byId.get(id) : entries[0];
    if (!e) return false;
    e.rb.setLinvel({x: NaN, y: NaN, z: NaN}, true);
    return true;
  }

  function stepOne() {
    if (!world) return 0;
    const t0 = now();
    const gMag = Math.hypot(settings.gravity[0], settings.gravity[1], settings.gravity[2]) || 9.81;
    const vTerm = Math.max(1, settings.terminalSpeed ?? 40);
    const dragK = (gMag * DT) / (vTerm * vTerm);

    // pre-step: NaN & kill-plane check, quadratic air drag, speed clamps, and per-step CCD toggle
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      const rb = e.rb;
      const p = rb.translation(), q = rb.rotation(), v = rb.linvel(), av = rb.angvel();
      if (!finite3(p) || !finite4(q) || !finite3(v) || !finite3(av)) {
        removeEntryAt(i, 'nan');
        continue;
      }
      if (p.y < KILL_Y || Math.abs(p.x) > KILL_EXTENT || Math.abs(p.y) > KILL_EXTENT || Math.abs(p.z) > KILL_EXTENT) {
        removeEntryAt(i, 'bounds');
        continue;
      }
      if (rb.isSleeping()) {
        if ((e.minDim < CCD_MIN_SIZE) !== rb.isCcdEnabled()) rb.enableCcd(e.minDim < CCD_MIN_SIZE);
        continue;
      }

      let vx = v.x, vy = v.y, vz = v.z;
      let sp = Math.hypot(vx, vy, vz);
      if (sp > 0) {
        // Ianua quadratic air drag: dv/dt = -g * |v| * v / vTerm^2
        const f = 1 / (1 + dragK * sp);
        vx *= f; vy *= f; vz *= f; sp *= f;
        if (sp > MAX_LINVEL) {
          const k = MAX_LINVEL / sp;
          vx *= k; vy *= k; vz *= k; sp = MAX_LINVEL;
        }
        rb.setLinvel({x: vx, y: vy, z: vz}, false);
      }

      const wMag = Math.hypot(av.x, av.y, av.z);
      if (wMag > MAX_ANGVEL) {
        const k = MAX_ANGVEL / wMag;
        rb.setAngvel({x: av.x * k, y: av.y * k, z: av.z * k}, false);
      }

      const wantCcd = e.minDim < CCD_MIN_SIZE || sp > CCD_SPEED;
      if (wantCcd !== rb.isCcdEnabled()) rb.enableCcd(wantCcd);
    }

    world.step();
    steps++;

    // post-step: catch solver NaNs and cap post-impact / depenetration speeds before writing frames
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      const rb = e.rb;
      const p = rb.translation(), q = rb.rotation(), v = rb.linvel(), av = rb.angvel();
      if (!finite3(p) || !finite4(q) || !finite3(v) || !finite3(av)) {
        removeEntryAt(i, 'nan');
        continue;
      }
      if (rb.isSleeping()) continue;
      const sp = Math.hypot(v.x, v.y, v.z);
      if (sp > MAX_LINVEL) {
        const k = MAX_LINVEL / sp;
        rb.setLinvel({x: v.x * k, y: v.y * k, z: v.z * k}, false);
      }
      const wMag = Math.hypot(av.x, av.y, av.z);
      if (wMag > MAX_ANGVEL) {
        const k = MAX_ANGVEL / wMag;
        rb.setAngvel({x: av.x * k, y: av.y * k, z: av.z * k}, false);
      }
    }

    lastStepMs = now() - t0;
    if (lastStepMs > BUSY_MS) {
      busyCount++;
      if (busyCount >= BUSY_STREAK && !busyLatched) {
        busyLatched = true;
        emit({type: 'busy', stepMs: lastStepMs, streak: busyCount});
      }
    } else {
      busyCount = 0;
      busyLatched = false;
    }
    return lastStepMs;
  }

  function step(n = 1) {
    let total = 0;
    const count = Math.max(1, n | 0);
    for (let i = 0; i < count; i++) total += stepOne();
    return total;
  }

  function write(buf) {
    buf.fill(0);
    buf[H_STEP] = steps;
    buf[H_TIME] = steps * DT;
    buf[H_COUNT] = slots.count;
    buf[H_SLOTS] = slots.span;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const o = slotOffset(e.slot);
      if (o + 8 > buf.length) continue;
      const p = e.rb.translation(), q = e.rb.rotation();
      buf[o + POS] = p.x; buf[o + POS + 1] = p.y; buf[o + POS + 2] = p.z;
      buf[o + QUAT] = q.x; buf[o + QUAT + 1] = q.y; buf[o + QUAT + 2] = q.z; buf[o + QUAT + 3] = q.w;
      buf[o + FLAGS] = ALIVE;
    }
    return buf;
  }

  return {
    load, spawn, remove, edit, setSettings, saveSnapshot, reset, step, write, injectNaN,
    snapshotBytes: () => world?.takeSnapshot() ?? new Uint8Array(0),
    get world() { return world; },
    get slots() { return slots.span; },
    get count() { return slots.count; },
    get steps() { return steps; },
    get time() { return steps * DT; },
    get settings() { return settings; },
    get entries() { return entries; },
    get lastStepMs() { return lastStepMs; },
    get dirtyEdit() { return dirtyEdit; },
    dispose() { if (world) { world.free(); world = null; } },
  };
}
