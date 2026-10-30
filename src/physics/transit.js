// Portal transit controller for the Rapier worker:
// - Carves each portal with a 12-slab tunnel behind the face and a hook-filtered opening plug
// - Builds mapped exit-side static ghosts via ghosts.js
// - Tracks per-body transit state (one portal at a time), drives kinematic position-based clones,
//   feeds damped R^-1 clone contact impulses back to masters, and teleports swept centres with
//   1 cm hysteresis and a 3-step reverse cooldown.

import {add, apply, applyDir, cross, dot, len, madd, norm, scale, sub} from '../core/vec.js';
import {qaxis, qfromR, qmul, qnorm, qrot} from '../core/quat.js';
import {crossing, frame, inside, local, portalMap} from '../core/portal.js';
import {ALIVE, CLONE_POS, CLONE_QUAT, FLAGS, HAS_CLONE, SPARE, withTeleport} from './protocol.js';
import {buildPortalGhosts} from './ghosts.js';

export const TUNNEL_SIDES = 12;
export const MAX_BODY_EXTENT = 1.5;
export const TUNNEL_DEPTH = 2 * MAX_BODY_EXTENT; // 3.0 m
export const MIN_SLAB_THICKNESS = 0.45;          // >= 0.4 m so planks rest cleanly on slab tops
export const MAX_SLAB_THICKNESS = 3.2;           // covers full 3 m plank span across host blocks
export const PLUG_THICKNESS = 0.08;
export const ENTRY_FRONT = 0.05;                 // 5 cm in front of opening
export const LEAVE_HYST = 0.03;                  // 3 cm hysteresis margin when leaving transit
export const TELEPORT_HYST = 0.01;               // 1 cm inward hysteresis on centre crossing
export const COOLDOWN_STEPS = 3;                 // 3-step reverse-teleport block per pair
export const CLONE_DAMPING = 0.8;

const ROLE_HOST = 1;
const ROLE_PLUG = 2;
const ROLE_TUNNEL = 3;
const ROLE_GHOST = 4;
const ROLE_CLONE = 5;

const G_STATIC = 1 << 0;
const G_HOST = 1 << 1;
const G_PLUG = 1 << 2;
const G_TUNNEL_GHOST = 1 << 3;
const G_DYN_FREE = 1 << 4;
const G_DYN_TRANSIT = 1 << 5;
const G_CLONE = 1 << 6;

const packGroups = (mem, flt) => (((mem & 0xffff) << 16) | (flt & 0xffff)) >>> 0;

export const CG_STATIC = packGroups(G_STATIC, G_DYN_FREE | G_DYN_TRANSIT);
export const CG_HOST = packGroups(G_HOST, G_DYN_FREE | G_DYN_TRANSIT);
export const CG_PLUG = packGroups(G_PLUG, G_DYN_FREE | G_DYN_TRANSIT);
export const CG_TUNNEL_GHOST = packGroups(G_TUNNEL_GHOST, G_DYN_TRANSIT);
export const CG_DYN_FREE = packGroups(
  G_DYN_FREE, G_STATIC | G_HOST | G_PLUG | G_DYN_FREE | G_DYN_TRANSIT | G_CLONE);
export const CG_DYN_TRANSIT = packGroups(
  G_DYN_TRANSIT, G_STATIC | G_HOST | G_PLUG | G_TUNNEL_GHOST | G_DYN_FREE | G_DYN_TRANSIT | G_CLONE);
export const CG_CLONE = packGroups(G_CLONE, G_DYN_FREE | G_DYN_TRANSIT);

function clonePortalSpec(p) {
  return {
    ...p,
    c: [...p.c],
    n: [...p.n],
    v: [...p.v],
  };
}

function blockCorners(spec) {
  if (!spec.kind || spec.kind === 'box') {
    const [x0, y0, z0] = spec.min, [x1, y1, z1] = spec.max;
    return [
      [x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1],
    ];
  }
  const [hx, hy, hz] = spec.size.map((s) => Math.max(0.01, s * 0.5));
  const pos = spec.pos ?? [0, 0, 0];
  const rq = qnorm(spec.rot ?? [0, 0, 0, 1]);
  const out = [];
  for (const sz of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sx of [-1, 1]) {
        out.push(add(pos, qrot(rq, [sx * hx, sy * hy, sz * hz])));
      }
    }
  }
  return out;
}

function entryKineticEnergy(e) {
  const rb = e.rb;
  const m = e.spec.mass;
  const v = rb.linvel(), w = rb.angvel(), q = rb.rotation();
  const lin = 0.5 * m * (v.x * v.x + v.y * v.y + v.z * v.z);
  const qInv = [-q.x, -q.y, -q.z, q.w];
  const wl = qrot(qInv, [w.x, w.y, w.z]);
  const [sx, sy, sz] = e.spec.size;
  let ix, iy, iz;
  if (e.spec.shape === 'ball') {
    const r = sx * 0.5;
    ix = iy = iz = 0.4 * m * r * r;
  } else if (e.spec.shape === 'capsule') {
    const r = sx * 0.5, h = Math.max(0, sy - sx);
    ix = iz = m * (r * r * 0.25 + (h + sx) * (h + sx) / 12);
    iy = 0.4 * m * r * r;
  } else {
    ix = (m / 12) * (sy * sy + sz * sz);
    iy = (m / 12) * (sx * sx + sz * sz);
    iz = (m / 12) * (sx * sx + sy * sy);
  }
  return lin + 0.5 * (ix * wl[0] * wl[0] + iy * wl[1] * wl[1] + iz * wl[2] * wl[2]);
}

function supportExtentAlong(e, dir, qArr) {
  const shape = e.spec.shape;
  const [sx, sy, sz] = e.spec.size;
  if (shape === 'ball') return sx * 0.5;
  if (shape === 'capsule') {
    const r = sx * 0.5;
    const halfH = Math.max(0, (sy - sx) * 0.5);
    const axisY = qrot(qArr, [0, 1, 0]);
    return r + Math.abs(dot(axisY, dir)) * halfH;
  }
  const ax = qrot(qArr, [1, 0, 0]);
  const ay = qrot(qArr, [0, 1, 0]);
  const az = qrot(qArr, [0, 0, 1]);
  return Math.abs(dot(ax, dir)) * (sx * 0.5) +
         Math.abs(dot(ay, dir)) * (sy * 0.5) +
         Math.abs(dot(az, dir)) * (sz * 0.5);
}

export function createPortalTransit(RAPIER, {onEvent, now = () => performance.now()} = {}) {
  const COMPUTE_IMPULSES = RAPIER.SolverFlags?.COMPUTE_IMPULSES ?? 1;
  const HOOK_FLAG = RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS;

  let world = null;
  let portalSpecs = [];
  let portalRecords = [];          // [{idx, spec, P, P_hyst, Q, pairIdx, isOpen, M_PQ, M_QP, hostBlockIds, hostColHandles, tangentBounds, wallSpan, carveRbHandle, plugColHandle, slabColHandles}]
  let ghostGroups = [];            // [{portalIdx, rbHandle, colHandles}]
  let ghostColsByPortal = [];      // Collider[][] indexed by portalIdx
  let explicitBounds = null;       // optional {min, max} from scene.bounds

  const roleByCollider = new Map(); // colHandle -> role object
  const bodyPortalMap = new Map();  // rbHandle -> active portalIdx
  const bodyPortalSet = new Set();  // integer key (rbHandle * 1024 + portalIdx)
  const activeByBody = new Map();   // bodyId -> {bodyId, entry, portalIdx, partnerIdx, cloneRb, cloneCol, cloneRbHandle, cloneColHandle, clonePos, cloneQuat}
  const cooldowns = new Map();      // `${bodyId}:${pairKey}` -> remaining steps
  const lastTeleports = new Map();  // bodyId -> {step, portalIdx}
  const entryByRbHandle = new Map();

  let teleportCount = 0;
  let hookTimeAcc = 0;
  let lastHookMs = 0;
  let lastDtStep = 1 / 60;
  const stepClonePairs = [];        // flat [ownerRbHandle, dynRbHandle, ...] recorded in filterContactPair

  const emit = (ev) => onEvent?.(ev);
  // Rapier 0.21 handles are bit-packed f64 values (including subnormals like 5e-324); decode raw bits cleanly
  const handleF64 = new Float64Array(1);
  const handleU32 = new Uint32Array(handleF64.buffer);
  const bpKey = (rbHandle, pIdx) => {
    handleF64[0] = rbHandle;
    return `${handleU32[1]}:${handleU32[0]}:${pIdx}`;
  };
  const pairKeyOf = (a, b) => (a < b ? a * 1024 + b : b * 1024 + a);

  const hooks = {
    filterContactPair(c1, c2, b1, b2) {
      const t0 = now();
      const r1 = roleByCollider.get(c1);
      const r2 = roleByCollider.get(c2);
      let res = COMPUTE_IMPULSES;

      if (r1 && !r2) {
        res = filterRoleVsBody(r1, b2);
      } else if (r2 && !r1) {
        res = filterRoleVsBody(r2, b1);
      } else if (r1 && r2) {
        res = 0;
      }

      hookTimeAcc += now() - t0;
      return res;
    },
  };

  function filterRoleVsBody(role, dynRbHandle) {
    const pBody = bodyPortalMap.get(dynRbHandle);
    switch (role.kind) {
      case ROLE_PLUG:
        return pBody === role.portalIdx ? 0 : COMPUTE_IMPULSES;
      case ROLE_HOST: {
        if (pBody === undefined) return COMPUTE_IMPULSES;
        const ps = role.portals;
        for (let i = 0; i < ps.length; i++) {
          if (ps[i] === pBody) return 0;
        }
        return COMPUTE_IMPULSES;
      }
      case ROLE_TUNNEL:
      case ROLE_GHOST:
        return pBody === role.portalIdx ? COMPUTE_IMPULSES : 0;
      case ROLE_CLONE: {
        if (role.ownerRbHandle === dynRbHandle) return 0;
        if (pBody === undefined) {
          stepClonePairs.push(role.ownerRbHandle, dynRbHandle);
          return COMPUTE_IMPULSES;
        }
        if (pBody === role.portalIdx) return 0;
        if (pBody === role.partnerIdx) {
          if (role.portalIdx < pBody) {
            stepClonePairs.push(role.ownerRbHandle, dynRbHandle);
            return COMPUTE_IMPULSES;
          }
          return 0;
        }
        stepClonePairs.push(role.ownerRbHandle, dynRbHandle);
        return COMPUTE_IMPULSES;
      }
      default:
        return COMPUTE_IMPULSES;
    }
  }

  function makeCloneColliderDesc(spec) {
    const [sx, sy, sz] = spec.size;
    let desc;
    if (spec.shape === 'ball') {
      desc = RAPIER.ColliderDesc.ball(sx * 0.5).setFriction(0.5).setRestitution(0.35);
    } else if (spec.shape === 'capsule') {
      const r = sx * 0.5;
      const halfH = Math.max(0.001, (sy - sx) * 0.5);
      desc = RAPIER.ColliderDesc.capsule(halfH, r).setFriction(0.55).setRestitution(0.25);
    } else {
      desc = RAPIER.ColliderDesc.cuboid(sx * 0.5, sy * 0.5, sz * 0.5).setFriction(0.6).setRestitution(0.18);
    }
    return desc.setCollisionGroups(CG_CLONE).setActiveHooks(HOOK_FLAG);
  }

  function clearCarvesAndGhosts() {
    if (!world) return;
    for (const rec of portalRecords) {
      if (rec.carveRbHandle !== null) {
        const rb = world.getRigidBody(rec.carveRbHandle);
        if (rb) world.removeRigidBody(rb);
      }
    }
    for (const g of ghostGroups) {
      const rb = world.getRigidBody(g.rbHandle);
      if (rb) world.removeRigidBody(rb);
    }
    portalRecords = [];
    ghostGroups = [];
    ghostColsByPortal = [];
    // keep only ROLE_CLONE entries in roleByCollider; host/plug/tunnel/ghost are rebuilt below
    for (const [colH, role] of roleByCollider.entries()) {
      if (role.kind !== ROLE_CLONE) roleByCollider.delete(colH);
    }
  }

  function detectHostBlocks(P, explicitBlockId, blocks) {
    const ids = new Set();
    if (explicitBlockId && blocks.has(explicitBlockId)) ids.add(explicitBlockId);
    const probe = new RAPIER.Cuboid(Math.max(0.02, P.a * 0.92), Math.max(0.02, P.b * 0.92), 0.06);
    const pc = madd(P.c, P.n, -0.04);
    const pq = qfromR([P.u, P.v, P.n]);
    const posObj = {x: pc[0], y: pc[1], z: pc[2]};
    const rotObj = {x: pq[0], y: pq[1], z: pq[2], w: pq[3]};
    const rad = Math.hypot(P.a, P.b, 0.1);
    for (const blk of blocks.values()) {
      if (ids.has(blk.id)) continue;
      if (pc[0] + rad < blk.min[0] || pc[0] - rad > blk.max[0] ||
          pc[1] + rad < blk.min[1] || pc[1] - rad > blk.max[1] ||
          pc[2] + rad < blk.min[2] || pc[2] - rad > blk.max[2]) continue;
      // a host block sits behind or flush with P's plane, never protruding into the room in front of P
      let maxFrontZ = -Infinity;
      for (const c of blockCorners(blk.spec)) {
        const z = local(P, c)[2];
        if (z > maxFrontZ) maxFrontZ = z;
      }
      if (maxFrontZ > 0.05) continue;
      if (blk.collider?.isValid?.() && blk.collider.intersectsShape(probe, posObj, rotObj)) {
        ids.add(blk.id);
      }
    }
    return [...ids];
  }

  function computeTangentBounds(P, hostBlockIds, blocks) {
    if (hostBlockIds.length === 0) return null;
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity, zMin = Infinity;
    for (const id of hostBlockIds) {
      const blk = blocks.get(id);
      if (!blk) continue;
      for (const c of blockCorners(blk.spec)) {
        const l = local(P, c);
        if (l[0] < uMin) uMin = l[0];
        if (l[0] > uMax) uMax = l[0];
        if (l[1] < vMin) vMin = l[1];
        if (l[1] > vMax) vMax = l[1];
        if (l[2] < zMin) zMin = l[2];
      }
    }
    if (!Number.isFinite(uMin)) return null;
    return {uMin, uMax, vMin, vMax, depth: Math.max(0.2, -zMin)};
  }

  function buildCarveForPortal(rec) {
    const {idx, P, tangentBounds} = rec;
    const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    rec.carveRbHandle = rb.handle;

    // 1. thin opening plug flush with the portal face (z_local in [-PLUG_THICKNESS, 0])
    const pq = qfromR([P.u, P.v, P.n]);
    const pCenter = madd(P.c, P.n, -PLUG_THICKNESS * 0.5);
    const plugDesc = RAPIER.ColliderDesc.cuboid(P.a, P.b, PLUG_THICKNESS * 0.5)
      .setTranslation(pCenter[0], pCenter[1], pCenter[2])
      .setRotation({x: pq[0], y: pq[1], z: pq[2], w: pq[3]})
      .setFriction(0.6)
      .setRestitution(0.2)
      .setCollisionGroups(CG_PLUG)
      .setActiveHooks(HOOK_FLAG);
    const plugCol = world.createCollider(plugDesc, rb);
    rec.plugColHandle = plugCol.handle;
    roleByCollider.set(plugCol.handle, {kind: ROLE_PLUG, portalIdx: idx});

    // 2. ring of 12 thick slabs around an inscribed 12-gon, flush at z_local = 0, depth = TUNNEL_DEPTH
    const verts = [];
    for (let k = 0; k < TUNNEL_SIDES; k++) {
      const th = (2 * Math.PI * k) / TUNNEL_SIDES;
      verts.push([P.a * Math.cos(th), P.b * Math.sin(th)]);
    }
    const edges = [];
    for (let k = 0; k < TUNNEL_SIDES; k++) {
      const A = verts[k], B = verts[(k + 1) % TUNNEL_SIDES];
      const dx = B[0] - A[0], dy = B[1] - A[1];
      const chordLen = Math.hypot(dx, dy) || 1e-6;
      const t2 = [dx / chordLen, dy / chordLen];
      let n2 = [t2[1], -t2[0]];
      const mid = [(A[0] + B[0]) * 0.5, (A[1] + B[1]) * 0.5];
      if (n2[0] * mid[0] + n2[1] * mid[1] < 0) n2 = [-n2[0], -n2[1]];
      edges.push({mid, chordLen, t2, n2});
    }

    const halfDepth = TUNNEL_DEPTH * 0.5;
    rec.slabColHandles = [];
    for (let k = 0; k < TUNNEL_SIDES; k++) {
      const prev = edges[(k + TUNNEL_SIDES - 1) % TUNNEL_SIDES];
      const cur = edges[k];
      const next = edges[(k + 1) % TUNNEL_SIDES];

      let thick = 0.8;
      if (tangentBounds) {
        const {uMin, uMax, vMin, vMax} = tangentBounds;
        const tu = cur.n2[0] > 1e-6 ? (uMax - cur.mid[0]) / cur.n2[0]
          : cur.n2[0] < -1e-6 ? (uMin - cur.mid[0]) / cur.n2[0] : MAX_SLAB_THICKNESS;
        const tv = cur.n2[1] > 1e-6 ? (vMax - cur.mid[1]) / cur.n2[1]
          : cur.n2[1] < -1e-6 ? (vMin - cur.mid[1]) / cur.n2[1] : MAX_SLAB_THICKNESS;
        thick = Math.max(MIN_SLAB_THICKNESS, Math.min(MAX_SLAB_THICKNESS, tu, tv));
      }

      const cosPrev = Math.max(-0.98, Math.min(1, prev.n2[0] * cur.n2[0] + prev.n2[1] * cur.n2[1]));
      const cosNext = Math.max(-0.98, Math.min(1, cur.n2[0] * next.n2[0] + cur.n2[1] * next.n2[1]));
      const extA = thick * Math.tan(0.5 * Math.acos(cosPrev)) + 0.015;
      const extB = thick * Math.tan(0.5 * Math.acos(cosNext)) + 0.015;

      const halfThick = thick * 0.5;
      const halfW = 0.5 * (cur.chordLen + extA + extB);
      const shiftT = 0.5 * (extB - extA);
      const shiftN = halfThick;

      const uC = cur.mid[0] + cur.t2[0] * shiftT + cur.n2[0] * shiftN;
      const vC = cur.mid[1] + cur.t2[1] * shiftT + cur.n2[1] * shiftN;
      const wCenter = add(add(add(P.c, scale(P.u, uC)), scale(P.v, vC)), scale(P.n, -halfDepth));

      const n3 = norm(add(scale(P.u, cur.n2[0]), scale(P.v, cur.n2[1])));
      const t3 = cross(P.n, n3); // guaranteed right-handed basis [n3, t3, P.n]
      const sq = qfromR([n3, t3, P.n]);

      // 8 mm 45-deg micro-chamfer on the inner-front rim (-halfThick, +halfDepth) so planks/boxes
      // sliding across an opening ride smoothly onto the far slab top without catching a 90-deg edge
      const ch = Math.min(0.008, halfThick * 0.25, halfDepth * 0.25);
      const hx = halfThick, hy = halfW, hz = halfDepth;
      const slabPts = new Float32Array([
        -hx, -hy, -hz, -hx, hy, -hz,
        hx, -hy, -hz, hx, hy, -hz,
        hx, -hy, hz, hx, hy, hz,
        -hx, -hy, hz - ch, -hx, hy, hz - ch,
        -hx + ch, -hy, hz, -hx + ch, hy, hz,
      ]);
      const slabDesc = (RAPIER.ColliderDesc.convexHull(slabPts) ?? RAPIER.ColliderDesc.cuboid(hx, hy, hz))
        .setTranslation(wCenter[0], wCenter[1], wCenter[2])
        .setRotation({x: sq[0], y: sq[1], z: sq[2], w: sq[3]})
        .setFriction(0.6)
        .setRestitution(0.2)
        .setCollisionGroups(CG_TUNNEL_GHOST)
        .setActiveHooks(HOOK_FLAG);
      const slabCol = world.createCollider(slabDesc, rb);
      rec.slabColHandles.push(slabCol.handle);
      roleByCollider.set(slabCol.handle, {kind: ROLE_TUNNEL, portalIdx: idx});
    }
  }

  function rebuildStaticRolesAndPortals(blocks) {
    clearCarvesAndGhosts();

    // reset all static blocks to CG_STATIC first; hosted blocks get promoted to CG_HOST below
    for (const blk of blocks.values()) {
      if (blk.collider?.isValid?.()) {
        blk.collider.setCollisionGroups(CG_STATIC);
        blk.collider.setActiveHooks(0);
      }
    }

    const byId = new Map();
    portalSpecs.forEach((p, idx) => byId.set(p.id, {p, idx}));

    const portalsByBlockCol = new Map(); // colHandle -> number[]
    portalRecords = portalSpecs.map((spec, idx) => {
      const P = frame(spec);
      const P_hyst = {...P, c: madd(P.c, P.n, -TELEPORT_HYST)};
      const partner = spec.pair ? byId.get(spec.pair) : null;
      const isOpen = Boolean(partner && partner.idx !== idx && partner.p.pair === spec.id);
      const Q = isOpen ? frame(partner.p) : null;
      const M_PQ = isOpen ? portalMap(P, Q) : null;
      const M_QP = isOpen ? portalMap(Q, P) : null;
      if (M_PQ) M_PQ.q = qfromR(M_PQ.R);
      if (M_QP) M_QP.q = qfromR(M_QP.R);

      const hostBlockIds = detectHostBlocks(P, spec.block, blocks);
      const hostColHandles = [];
      for (const blkId of hostBlockIds) {
        const blk = blocks.get(blkId);
        if (!blk) continue;
        hostColHandles.push(blk.colHandle);
        let list = portalsByBlockCol.get(blk.colHandle);
        if (!list) { list = []; portalsByBlockCol.set(blk.colHandle, list); }
        list.push(idx);
      }
      const tangentBounds = computeTangentBounds(P, hostBlockIds, blocks);

      return {
        idx, spec, P, P_hyst, Q,
        pairIdx: isOpen ? partner.idx : -1,
        isOpen, M_PQ, M_QP,
        hostBlockIds, hostColHandles, tangentBounds,
        carveRbHandle: null, plugColHandle: null, slabColHandles: [],
      };
    });

    for (const [colHandle, pList] of portalsByBlockCol.entries()) {
      const col = world.getCollider(colHandle);
      if (col) col.setCollisionGroups(CG_HOST);
      roleByCollider.set(colHandle, {kind: ROLE_HOST, portals: Int32Array.from(pList)});
    }

    for (const rec of portalRecords) {
      buildCarveForPortal(rec);
    }

    ghostGroups = buildPortalGhosts(RAPIER, world, portalRecords, blocks, {
      collisionGroups: CG_TUNNEL_GHOST,
      onCollider(colHandle, _rbHandle, portalIdx) {
        roleByCollider.set(colHandle, {kind: ROLE_GHOST, portalIdx});
      },
    });
    ghostColsByPortal = portalRecords.map(() => []);
    for (const g of ghostGroups) {
      ghostColsByPortal[g.portalIdx] = g.colHandles.map((gh) => world.getCollider(gh)).filter(Boolean);
    }
  }

  function wakeNearPortal(P, radius) {
    if (!world) return;
    const r2 = (Math.max(P.a, P.b) + radius + 0.5) ** 2;
    for (const e of entryByRbHandle.values()) {
      const tp = e.rb.translation();
      const dx = tp.x - P.c[0], dy = tp.y - P.c[1], dz = tp.z - P.c[2];
      if (dx * dx + dy * dy + dz * dz <= r2) e.rb.wakeUp();
    }
  }

  function enterTransit(e, pIdx) {
    const rec = portalRecords[pIdx];
    if (!rec?.isOpen) return null;
    const mp = e.rb.translation(), mq = e.rb.rotation();
    const cp = apply(rec.M_PQ, [mp.x, mp.y, mp.z]);
    const cq = qnorm(qmul(rec.M_PQ.q, [mq.x, mq.y, mq.z, mq.w]));

    const cloneRbDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(cp[0], cp[1], cp[2])
      .setRotation({x: cq[0], y: cq[1], z: cq[2], w: cq[3]});
    const cloneRb = world.createRigidBody(cloneRbDesc);
    const cloneCol = world.createCollider(makeCloneColliderDesc(e.spec), cloneRb);

    e.collider.setCollisionGroups(CG_DYN_TRANSIT);
    e.collider.setActiveHooks(HOOK_FLAG);
    e.rb.wakeUp();
    wakeNearPortal(rec.Q, e.boundR);

    bodyPortalMap.set(e.rbHandle, pIdx);
    bodyPortalSet.add(bpKey(e.rbHandle, pIdx));
    roleByCollider.set(cloneCol.handle, {
      kind: ROLE_CLONE,
      portalIdx: pIdx,
      partnerIdx: rec.pairIdx,
      ownerRbHandle: e.rbHandle,
    });

    const tr = {
      bodyId: e.id,
      entry: e,
      portalIdx: pIdx,
      partnerIdx: rec.pairIdx,
      cloneRb,
      cloneCol,
      cloneRbHandle: cloneRb.handle,
      cloneColHandle: cloneCol.handle,
      clonePos: cp,
      cloneQuat: cq,
    };
    activeByBody.set(e.id, tr);
    return tr;
  }

  function leaveTransit(bodyId) {
    const tr = activeByBody.get(bodyId);
    if (!tr) return;
    activeByBody.delete(bodyId);
    bodyPortalMap.delete(tr.entry.rbHandle);
    bodyPortalSet.delete(bpKey(tr.entry.rbHandle, tr.portalIdx));
    roleByCollider.delete(tr.cloneColHandle);
    if (world && tr.cloneRb?.isValid?.()) world.removeRigidBody(tr.cloneRb);
    if (tr.entry.collider?.isValid?.()) {
      tr.entry.collider.setCollisionGroups(CG_DYN_FREE);
      tr.entry.collider.setActiveHooks(0);
    }
  }

  // sphere-vs-zone check at a point, plus optional 1-step velocity sweep so fast bodies enter before hitting the plug
  function overlapsZonePoint(P, pos, boundR, hyst = 0) {
    const l = local(P, pos);
    if (l[2] - boundR > ENTRY_FRONT + hyst) return null;
    if (l[2] + boundR < -TUNNEL_DEPTH - hyst) return null;
    const ru = P.a + boundR + hyst;
    const rv = P.b + boundR + hyst;
    const normDist2 = (l[0] / ru) ** 2 + (l[1] / rv) ** 2;
    if (normDist2 > 1) return null;
    return {l, score: (l[0] / Math.max(0.05, P.a)) ** 2 + (l[1] / Math.max(0.05, P.b)) ** 2};
  }

  function overlapsZoneSwept(P, p0, p1, boundR) {
    const l0 = local(P, p0);
    // never enter transit from the back of a wall
    if (l0[2] < -0.05) return null;
    const hit0 = overlapsZonePoint(P, p0, boundR, 0);
    if (hit0) return hit0;
    const hit1 = overlapsZonePoint(P, p1, boundR, 0);
    if (hit1) return hit1;
    const l1 = local(P, p1);
    if (l0[2] > 0 && l1[2] < l0[2]) {
      const targetZ = Math.min(ENTRY_FRONT, Math.max(0, l1[2]));
      const dz = l0[2] - l1[2];
      if (dz > 1e-6) {
        const t = Math.max(0, Math.min(1, (l0[2] - targetZ) / dz));
        const pm = [
          p0[0] + (p1[0] - p0[0]) * t,
          p0[1] + (p1[1] - p0[1]) * t,
          p0[2] + (p1[2] - p0[2]) * t,
        ];
        return overlapsZonePoint(P, pm, boundR, 0);
      }
    }
    return null;
  }

  function pushBodyOutOfPortalWall(e, P, blocks, hostBlockIds) {
    const p = e.rb.translation(), q = e.rb.rotation(), v = e.rb.linvel();
    let pos = [p.x, p.y, p.z];
    const qArr = [q.x, q.y, q.z, q.w];
    const nExt = supportExtentAlong(e, P.n, qArr);
    const l = local(P, pos);
    let pushed = false;

    const minFrontZ = nExt + 0.004;
    if (l[2] < minFrontZ) {
      pos = madd(pos, P.n, minFrontZ - l[2]);
      pushed = true;
    }

    // verify free of host block colliders along +P.n in small increments if needed
    const rotObj = {x: q.x, y: q.y, z: q.z, w: q.w};
    const probe = e.collider.shape;
    for (let step = 0; step < 16; step++) {
      let hit = false;
      const posObj = {x: pos[0], y: pos[1], z: pos[2]};
      for (const blkId of hostBlockIds) {
        const blk = blocks.get(blkId);
        if (blk?.collider?.isValid?.() && blk.collider.intersectsShape(probe, posObj, rotObj)) {
          hit = true;
          break;
        }
      }
      if (!hit) break;
      pos = madd(pos, P.n, 0.025);
      pushed = true;
    }

    if (pushed) {
      e.rb.setTranslation({x: pos[0], y: pos[1], z: pos[2]}, true);
      const vn = dot([v.x, v.y, v.z], P.n);
      if (vn < 0) {
        const vFixed = madd([v.x, v.y, v.z], P.n, -vn);
        e.rb.setLinvel({x: vFixed[0], y: vFixed[1], z: vFixed[2]}, true);
      }
      e.rb.wakeUp();
    }
    return pushed;
  }

  // handle portals/blocks changing while bodies are currently in transit (Scope rule 5)
  function reconcileMidTransit(prevRecords, blocks, steps) {
    if (activeByBody.size === 0) return;
    const newIndexById = new Map(portalRecords.map((r) => [r.spec.id, r.idx]));

    for (const tr of [...activeByBody.values()]) {
      const e = tr.entry;
      if (!e?.rb?.isValid?.()) {
        leaveTransit(tr.bodyId);
        continue;
      }
      const oldRec = prevRecords[tr.portalIdx];
      if (!oldRec) {
        leaveTransit(tr.bodyId);
        continue;
      }

      const newPIdx = newIndexById.get(oldRec.spec.id);
      const newRec = newPIdx !== undefined ? portalRecords[newPIdx] : null;
      const oldPartnerSpec = prevRecords[tr.partnerIdx]?.spec;
      const newQIdx = oldPartnerSpec ? newIndexById.get(oldPartnerSpec.id) : undefined;
      const newQRec = newQIdx !== undefined ? portalRecords[newQIdx] : null;

      const unchanged = newRec && newRec.isOpen &&
        newRec.pairIdx === newQIdx &&
        len(sub(newRec.P.c, oldRec.P.c)) < 1e-5 &&
        len(sub(newRec.P.n, oldRec.P.n)) < 1e-5 &&
        len(sub(newQRec.P.c, oldRec.Q.c)) < 1e-5 &&
        len(sub(newQRec.P.n, oldRec.Q.n)) < 1e-5;

      if (unchanged) {
        // rebind indices and update clone pose against rebuilt world
        bodyPortalMap.delete(e.rbHandle);
        bodyPortalSet.delete(bpKey(e.rbHandle, tr.portalIdx));
        tr.portalIdx = newRec.idx;
        tr.partnerIdx = newRec.pairIdx;
        bodyPortalMap.set(e.rbHandle, tr.portalIdx);
        bodyPortalSet.add(bpKey(e.rbHandle, tr.portalIdx));
        roleByCollider.set(tr.cloneColHandle, {
          kind: ROLE_CLONE,
          portalIdx: tr.portalIdx,
          partnerIdx: tr.partnerIdx,
          ownerRbHandle: e.rbHandle,
        });
        continue;
      }

      // portal or partner was removed or moved mid-transit
      const tp = e.rb.translation(), tq = e.rb.rotation(), tv = e.rb.linvel(), tw = e.rb.angvel();
      const pos = [tp.x, tp.y, tp.z];
      const qArr = [tq.x, tq.y, tq.z, tq.w];
      const entryP = newRec ? newRec.P : oldRec.P;
      const hostIds = newRec ? newRec.hostBlockIds : oldRec.hostBlockIds;
      const lz = local(entryP, pos)[2];
      const nExt = supportExtentAlong(e, entryP.n, qArr);

      leaveTransit(tr.bodyId);

      if (lz >= 0 && lz >= nExt) {
        // centre in front of entry and clear of the wall: drop transit and restore plug
        e.rb.wakeUp();
      } else if (lz < 0 && newQRec) {
        // centre behind entry with partner still alive: teleport to partner
        const M = portalMap(oldRec.P, newQRec.P);
        const mq = qfromR(M.R);
        const pNew = apply(M, pos);
        const qNew = qnorm(qmul(mq, qArr));
        const vNew = applyDir(M, [tv.x, tv.y, tv.z]);
        const wNew = applyDir(M, [tw.x, tw.y, tw.z]);
        e.rb.setTranslation({x: pNew[0], y: pNew[1], z: pNew[2]}, true);
        e.rb.setRotation({x: qNew[0], y: qNew[1], z: qNew[2], w: qNew[3]}, true);
        e.rb.setLinvel({x: vNew[0], y: vNew[1], z: vNew[2]}, true);
        e.rb.setAngvel({x: wNew[0], y: wNew[1], z: wNew[2]}, true);
        e.rb.wakeUp();
        teleportCount++;
        if (newRec) lastTeleports.set(e.id, {step: steps, portalIdx: newRec.idx});
        if (newQRec.isOpen && overlapsZonePoint(newQRec.P, pNew, e.boundR, LEAVE_HYST)) {
          enterTransit(e, newQRec.idx);
        } else if (!newQRec.isOpen) {
          pushBodyOutOfPortalWall(e, newQRec.P, blocks, newQRec.hostBlockIds);
        }
      } else {
        // partner gone or straddling closed entry wall: push out along +n until free and emit event
        pushBodyOutOfPortalWall(e, entryP, blocks, hostIds);
        emit({type: 'portal_ejected', id: e.id, portal: oldRec.spec.id});
      }
    }
  }

  function registerDynamicBody(e) {
    entryByRbHandle.set(e.rbHandle, e);
    if (!activeByBody.has(e.id)) {
      e.collider.setCollisionGroups(CG_DYN_FREE);
      e.collider.setActiveHooks(0);
    }
  }

  function unregisterDynamicBody(e) {
    leaveTransit(e.id);
    entryByRbHandle.delete(e.rbHandle);
    lastTeleports.delete(e.id);
    for (const key of cooldowns.keys()) {
      if (key.startsWith(`${e.id}:`)) cooldowns.delete(key);
    }
  }

  function rebuild(newWorld, portals, blocks, entries = [], {steps = 0, bounds = null} = {}) {
    const prevWorld = world;
    const prevRecords = portalRecords;
    world = newWorld;
    explicitBounds = bounds ? {min: [...bounds.min], max: [...bounds.max]} : null;
    portalSpecs = (portals ?? []).map(clonePortalSpec);

    entryByRbHandle.clear();
    for (const e of entries) entryByRbHandle.set(e.rbHandle, e);

    if (prevWorld && prevWorld !== newWorld) {
      activeByBody.clear();
      bodyPortalMap.clear();
      bodyPortalSet.clear();
      roleByCollider.clear();
      cooldowns.clear();
      lastTeleports.clear();
      portalRecords = [];
      ghostGroups = [];
      teleportCount = 0;
    }

    rebuildStaticRolesAndPortals(blocks);

    if (prevWorld === newWorld && prevRecords.length > 0) {
      reconcileMidTransit(prevRecords, blocks, steps);
    } else {
      for (const e of entries) registerDynamicBody(e);
      syncBodies(entries, 0);
    }
  }

  function syncBodies(entries, dtStep = 1 / 60) {
    if (!world || portalRecords.length === 0) return;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const p = e.rb.translation(), v = e.rb.linvel();
      const p0 = [p.x, p.y, p.z];
      const p1 = dtStep > 0 ? [p.x + v.x * dtStep, p.y + v.y * dtStep, p.z + v.z * dtStep] : p0;

      const curTr = activeByBody.get(e.id);
      if (curTr) {
        const rec = portalRecords[curTr.portalIdx];
        if (!rec?.isOpen || !overlapsZonePoint(rec.P, p0, e.boundR, LEAVE_HYST)) {
          leaveTransit(e.id);
        } else {
          continue;
        }
      }

      // free body: pick the closest overlapping open portal (one portal at a time)
      let bestIdx = -1;
      let bestScore = Infinity;
      for (let pIdx = 0; pIdx < portalRecords.length; pIdx++) {
        const rec = portalRecords[pIdx];
        if (!rec.isOpen) continue;
        const hit = dtStep > 0
          ? overlapsZoneSwept(rec.P, p0, p1, e.boundR)
          : overlapsZonePoint(rec.P, p0, e.boundR, 0);
        if (hit && hit.score < bestScore) {
          bestScore = hit.score;
          bestIdx = pIdx;
        }
      }
      if (bestIdx >= 0) enterTransit(e, bestIdx);
    }
  }

  function beforeStep(entries, dtStep) {
    hookTimeAcc = 0;
    lastDtStep = dtStep;
    stepClonePairs.length = 0;
    if (!world) return;

    // tick down 3-step reverse-teleport cooldowns
    for (const [k, rem] of cooldowns.entries()) {
      if (rem <= 1) cooldowns.delete(k);
      else cooldowns.set(k, rem - 1);
    }

    entryByRbHandle.clear();
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      entryByRbHandle.set(e.rbHandle, e);
      const p = e.rb.translation(), v = e.rb.linvel();
      e._c0 = [p.x, p.y, p.z];
      e._v0 = [v.x, v.y, v.z];
      e._ke0 = e.rb.isSleeping() ? 0 : entryKineticEnergy(e);
    }

    if (portalRecords.length === 0) return;

    syncBodies(entries, dtStep);

    // drive each kinematic clone toward M . predictedEndPose so exit contacts receive true velocity R v
    for (const tr of activeByBody.values()) {
      const e = tr.entry;
      const rec = portalRecords[tr.portalIdx];
      if (!rec?.isOpen) continue;
      const p = e.rb.translation(), q = e.rb.rotation(), v = e.rb.linvel(), w = e.rb.angvel();
      const predPos = [p.x + v.x * dtStep, p.y + v.y * dtStep, p.z + v.z * dtStep];
      let predQuat = [q.x, q.y, q.z, q.w];
      const wMag = Math.hypot(w.x, w.y, w.z);
      if (wMag * dtStep > 1e-6) {
        predQuat = qnorm(qmul(qaxis([w.x, w.y, w.z], wMag * dtStep), predQuat));
      }
      const cp = apply(rec.M_PQ, predPos);
      const cq = qnorm(qmul(rec.M_PQ.q, predQuat));
      tr.cloneRb.setNextKinematicTranslation({x: cp[0], y: cp[1], z: cp[2]});
      tr.cloneRb.setNextKinematicRotation({x: cq[0], y: cq[1], z: cq[2], w: cq[3]});
    }
  }

  function enforceWallAndLevelBounds(entries, blocks) {
    if (portalRecords.length === 0 && !explicitBounds) return;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.rb.isSleeping()) continue;
      const p = e.rb.translation();
      let pos = [p.x, p.y, p.z];
      const tr = activeByBody.get(e.id);
      const activeRec = tr ? portalRecords[tr.portalIdx] : null;
      const inOwnTunnel = activeRec?.isOpen && (() => {
        const l = local(activeRec.P, pos);
        return l[2] <= 0.02 && l[2] >= -TUNNEL_DEPTH - 0.05 && inside(activeRec.P, l, 0.05);
      })();

      if (inOwnTunnel) continue;

      // 1. check portal host walls: no body centre may end up behind a host wall face outside an active tunnel
      for (let pIdx = 0; pIdx < portalRecords.length; pIdx++) {
        const rec = portalRecords[pIdx];
        if (!rec.tangentBounds) continue;
        const l = local(rec.P, pos);
        const l0 = local(rec.P, e._c0 ?? pos);
        const tb = rec.tangentBounds;
        if (l[2] < -0.005 && (l[2] > -tb.depth || l0[2] >= -tb.depth) &&
            l[0] >= tb.uMin + 0.02 && l[0] <= tb.uMax - 0.02 &&
            l[1] >= tb.vMin + 0.02 && l[1] <= tb.vMax - 0.02) {
          // allow if inside an open portal's tunnel on this exact plane
          let insideAnyOpen = false;
          for (let j = 0; j < portalRecords.length; j++) {
            const rj = portalRecords[j];
            if (!rj.isOpen) continue;
            const lj = local(rj.P, pos);
            if (lj[2] <= 0.02 && lj[2] >= -TUNNEL_DEPTH && inside(rj.P, lj, 0.04)) {
              insideAnyOpen = true;
              break;
            }
          }
          if (!insideAnyOpen) {
            pushBodyOutOfPortalWall(e, rec.P, blocks, rec.hostBlockIds);
            const np = e.rb.translation();
            pos = [np.x, np.y, np.z];
          }
        }
      }

      // 2. optional explicit scene.bounds box
      if (explicitBounds) {
        const {min, max} = explicitBounds;
        let clamped = false;
        const v = e.rb.linvel();
        const nv = [v.x, v.y, v.z];
        const r = e.minDim * 0.5;
        for (let k = 0; k < 3; k++) {
          if (pos[k] < min[k] + r) { pos[k] = min[k] + r; if (nv[k] < 0) nv[k] = 0; clamped = true; }
          if (pos[k] > max[k] - r) { pos[k] = max[k] - r; if (nv[k] > 0) nv[k] = 0; clamped = true; }
        }
        if (clamped) {
          e.rb.setTranslation({x: pos[0], y: pos[1], z: pos[2]}, true);
          e.rb.setLinvel({x: nv[0], y: nv[1], z: nv[2]}, true);
        }
      }
    }
  }

  function afterStep(entries, steps, settings, blocks) {
    lastHookMs = hookTimeAcc;
    if (!world || portalRecords.length === 0) {
      if (explicitBounds) enforceWallAndLevelBounds(entries, blocks);
      return;
    }

    // 1. clone contact impulse feedback: map R^-1, damp by 0.8, apply at mapped local contact point on master
    const cloneContactSeeds = [];
    const manifoldHandled = new Set();
    const g = settings.gravity ?? [0, -9.81, 0];

    for (const tr of activeByBody.values()) {
      const rec = portalRecords[tr.portalIdx];
      if (!rec?.isOpen || !tr.cloneCol?.isValid?.()) continue;
      const e = tr.entry;
      const mp = e.rb.translation(), mq = e.rb.rotation();
      const mqArr = [mq.x, mq.y, mq.z, mq.w];

      world.contactPairsWith(tr.cloneCol, (otherCol) => {
        const otherRb = otherCol.parent();
        if (!otherRb) return;
        const otherEntry = entryByRbHandle.get(otherRb.handle);
        if (!otherEntry || otherEntry.id === e.id) return;

        world.contactPair(tr.cloneCol, otherCol, (manifold, flipped) => {
          const n = manifold.normal();
          const sign = flipped ? 1 : -1;
          const num = manifold.numContacts();
          for (let i = 0; i < num; i++) {
            const imp = manifold.contactImpulse(i);
            if (!(imp > 1e-8)) continue;
            const lp = flipped ? manifold.localContactPoint2(i) : manifold.localContactPoint1(i);
            if (!lp) continue;

            const Jc = [n.x * sign * imp, n.y * sign * imp, n.z * sign * imp];
            let Jm = scale(applyDir(rec.M_QP, Jc), CLONE_DAMPING);
            const magJ = len(Jm);
            if (magJ > 1e-9) {
              const uJ = scale(Jm, 1 / magJ);
              const uJc = norm(Jc);
              const vMasterIn = Math.max(0, -dot(e._v0 ?? [0, 0, 0], uJ));
              const vOtherIn = Math.max(0, dot(otherEntry._v0 ?? [0, 0, 0], uJc));
              const maxJ = 1.25 * e.spec.mass * (vMasterIn + vOtherIn) + 0.04 * e.spec.mass;
              if (magJ > maxJ) Jm = scale(Jm, maxJ / magJ);
            }

            const rWorld = qrot(mqArr, [lp.x, lp.y, lp.z]);
            e.rb.applyImpulseAtPoint(
              {x: Jm[0], y: Jm[1], z: Jm[2]},
              {x: mp.x + rWorld[0], y: mp.y + rWorld[1], z: mp.z + rWorld[2]},
              true);
            cloneContactSeeds.push(e, otherEntry);
            manifoldHandled.add(`${e.id}:${otherEntry.id}`);
          }
        });
      });
    }

    // also catch CCD substep clone collisions whose contact pair already separated before world.step() returned
    if (stepClonePairs.length > 0) {
      const seenPairs = new Set();
      for (let i = 0; i < stepClonePairs.length; i += 2) {
        const owner = entryByRbHandle.get(stepClonePairs[i]);
        const otherEntry = entryByRbHandle.get(stepClonePairs[i + 1]);
        if (!owner || !otherEntry || owner.id === otherEntry.id) continue;
        const pk = `${owner.id}:${otherEntry.id}`;
        if (seenPairs.has(pk)) continue;
        seenPairs.add(pk);
        cloneContactSeeds.push(owner, otherEntry);
        if (manifoldHandled.has(pk)) continue;

        const tr = activeByBody.get(owner.id);
        const rec = tr ? portalRecords[tr.portalIdx] : null;
        if (!tr || !rec?.isOpen) continue;
        const ov1 = otherEntry.rb.linvel(), ov0 = otherEntry._v0 ?? [ov1.x, ov1.y, ov1.z];
        const dv = [
          ov1.x - ov0[0] - g[0] * lastDtStep,
          ov1.y - ov0[1] - g[1] * lastDtStep,
          ov1.z - ov0[2] - g[2] * lastDtStep,
        ];
        const op = otherEntry.rb.translation(), cp = tr.cloneRb.translation();
        const away = [op.x - cp.x, op.y - cp.y, op.z - cp.z];
        if (dot(dv, away) > 0.05) {
          const Jc = scale(dv, -otherEntry.spec.mass);
          let Jm = scale(applyDir(rec.M_QP, Jc), CLONE_DAMPING);
          const magJ = len(Jm);
          if (magJ > 1e-9) {
            const uJ = scale(Jm, 1 / magJ);
            const uJc = norm(Jc);
            const vMasterIn = Math.max(0, -dot(owner._v0 ?? [0, 0, 0], uJ));
            const vOtherIn = Math.max(0, dot(ov0, uJc));
            const maxJ = 1.25 * owner.spec.mass * (vMasterIn + vOtherIn) + 0.04 * owner.spec.mass;
            if (magJ > maxJ) Jm = scale(Jm, maxJ / magJ);
            owner.rb.applyImpulse({x: Jm[0], y: Jm[1], z: Jm[2]}, true);
          }
        }
      }
    }

    // prevent kinematic infinite-mass clones from injecting artificial kinetic energy into multi-body stacks
    if (cloneContactSeeds.length > 0) {
      const island = new Set(cloneContactSeeds);
      const queue = [...island];
      const visitCol = (col) => {
        if (!col?.isValid?.()) return;
        world.contactPairsWith(col, (otherCol) => {
          const orb = otherCol.parent();
          if (!orb) return;
          const oe = entryByRbHandle.get(orb.handle);
          if (oe && !island.has(oe)) {
            island.add(oe);
            queue.push(oe);
          }
          const role = roleByCollider.get(otherCol.handle);
          if (role?.kind === ROLE_CLONE) {
            const owner = entryByRbHandle.get(role.ownerRbHandle);
            if (owner && !island.has(owner)) {
              island.add(owner);
              queue.push(owner);
            }
          }
        });
      };
      while (queue.length > 0) {
        const cur = queue.pop();
        visitCol(cur.collider);
        visitCol(activeByBody.get(cur.id)?.cloneCol);
      }

      let keBefore = 0, keAfter = 0, gravWork = 0;
      for (const ie of island) {
        keBefore += ie._ke0 ?? 0;
        keAfter += entryKineticEnergy(ie);
        const p1 = ie.rb.translation();
        const c0 = ie._c0 ?? [p1.x, p1.y, p1.z];
        const w = ie.spec.mass * (g[0] * (p1.x - c0[0]) + g[1] * (p1.y - c0[1]) + g[2] * (p1.z - c0[2]));
        if (w > 0) gravWork += w;
      }
      const keBudget = keBefore + gravWork;
      if (keAfter > keBudget + 1e-6 && keAfter > 1e-6) {
        const k = Math.sqrt(Math.max(0, keBudget) / keAfter);
        for (const ie of island) {
          const v = ie.rb.linvel(), av = ie.rb.angvel();
          ie.rb.setLinvel({x: v.x * k, y: v.y * k, z: v.z * k}, false);
          ie.rb.setAngvel({x: av.x * k, y: av.y * k, z: av.z * k}, false);
        }
      }
    }

    // 2. swept-centre teleport test with 1 cm hysteresis and 3-step reverse cooldown
    let teleportedAny = false;
    for (const tr of activeByBody.values()) {
      const e = tr.entry;
      const pIdx = tr.portalIdx;
      const rec = portalRecords[pIdx];
      if (!rec?.isOpen) continue;

      const p1 = e.rb.translation(), q1 = e.rb.rotation(), v1 = e.rb.linvel(), w1 = e.rb.angvel();
      const c0 = e._c0 ?? [p1.x, p1.y, p1.z];
      const c1 = [p1.x, p1.y, p1.z];
      const vArr = [v1.x, v1.y, v1.z];
      const vn = dot(vArr, rec.P.n);
      if (!(vn < 0)) continue;

      const l1 = local(rec.P, c1);
      if (!(vn < -0.02 || l1[2] < -0.03)) continue;

      const pk = `${e.id}:${pairKeyOf(pIdx, rec.pairIdx)}`;
      if (cooldowns.has(pk)) continue;

      const crossed = crossing(rec.P_hyst, rec.P_hyst, c0, c1) !== null;
      const catchUp = !crossed &&
        local(rec.P_hyst, c0)[2] <= 0 &&
        local(rec.P_hyst, c1)[2] <= 0 &&
        inside(rec.P, l1, 0);
      if (!crossed && !catchUp) continue;

      const M = rec.M_PQ;
      const qIdx = rec.pairIdx;
      const qArr = [q1.x, q1.y, q1.z, q1.w];
      const pNew = apply(M, c1);
      const qNew = qnorm(qmul(M.q, qArr));
      const vNew = applyDir(M, vArr);
      const wNew = applyDir(M, [w1.x, w1.y, w1.z]);

      e.rb.setTranslation({x: pNew[0], y: pNew[1], z: pNew[2]}, true);
      e.rb.setRotation({x: qNew[0], y: qNew[1], z: qNew[2], w: qNew[3]}, true);
      e.rb.setLinvel({x: vNew[0], y: vNew[1], z: vNew[2]}, true);
      e.rb.setAngvel({x: wNew[0], y: wNew[1], z: wNew[2]}, true);
      e.rb.wakeUp();

      // move clone immediately to the old master pose on P so its base pose does not streak across the room
      tr.cloneRb.setTranslation({x: c1[0], y: c1[1], z: c1[2]}, true);
      tr.cloneRb.setRotation({x: qArr[0], y: qArr[1], z: qArr[2], w: qArr[3]}, true);
      tr.cloneRb.setNextKinematicTranslation({x: c1[0], y: c1[1], z: c1[2]});
      tr.cloneRb.setNextKinematicRotation({x: qArr[0], y: qArr[1], z: qArr[2], w: qArr[3]});

      bodyPortalSet.delete(bpKey(e.rbHandle, pIdx));
      tr.portalIdx = qIdx;
      tr.partnerIdx = pIdx;
      bodyPortalMap.set(e.rbHandle, qIdx);
      bodyPortalSet.add(bpKey(e.rbHandle, qIdx));
      roleByCollider.set(tr.cloneColHandle, {
        kind: ROLE_CLONE,
        portalIdx: qIdx,
        partnerIdx: pIdx,
        ownerRbHandle: e.rbHandle,
      });

      cooldowns.set(pk, COOLDOWN_STEPS);
      lastTeleports.set(e.id, {step: steps, portalIdx: pIdx});
      teleportCount++;
      teleportedAny = true;
      wakeNearPortal(rec.Q, e.boundR);
    }

    if (teleportedAny) world.propagateModifiedBodyPositionsToColliders();

    // 3. cap discrete single-step penetration into exit ghosts (< 5 mm) and enforce wall/level bounds
    for (const tr of activeByBody.values()) {
      const gCols = ghostColsByPortal[tr.portalIdx];
      if (!gCols || gCols.length === 0) continue;
      const e = tr.entry;
      let maxResolve = 0;
      let resDir = null;
      for (let i = 0; i < gCols.length; i++) {
        const c = e.collider.contactCollider(gCols[i], 0.002);
        if (!c || !(c.distance < -0.005)) continue;
        const resolve = -c.distance - 0.002;
        if (resolve > maxResolve) {
          maxResolve = resolve;
          resDir = [c.normal2.x, c.normal2.y, c.normal2.z];
        }
      }
      if (maxResolve > 0 && resDir) {
        const p = e.rb.translation(), v = e.rb.linvel();
        e.rb.setTranslation({
          x: p.x + resDir[0] * maxResolve,
          y: p.y + resDir[1] * maxResolve,
          z: p.z + resDir[2] * maxResolve,
        }, true);
        const vn = v.x * resDir[0] + v.y * resDir[1] + v.z * resDir[2];
        if (vn < 0) {
          const k = -1.18 * vn;
          e.rb.setLinvel({
            x: v.x + resDir[0] * k,
            y: v.y + resDir[1] * k,
            z: v.z + resDir[2] * k,
          }, true);
        }
      }
    }
    enforceWallAndLevelBounds(entries, blocks);

    // 4. snap every active clone to exact M . masterPose so visual halves meet seamlessly at the opening
    for (const tr of activeByBody.values()) {
      const rec = portalRecords[tr.portalIdx];
      if (!rec?.isOpen) continue;
      const mp = tr.entry.rb.translation(), mq = tr.entry.rb.rotation();
      const cp = apply(rec.M_PQ, [mp.x, mp.y, mp.z]);
      const cq = qnorm(qmul(rec.M_PQ.q, [mq.x, mq.y, mq.z, mq.w]));
      tr.cloneRb.setTranslation({x: cp[0], y: cp[1], z: cp[2]}, false);
      tr.cloneRb.setRotation({x: cq[0], y: cq[1], z: cq[2], w: cq[3]}, false);
      tr.clonePos = cp;
      tr.cloneQuat = cq;
    }
  }

  function writeSlot(e, buf, o, steps, sinceStep) {
    let flags = ALIVE;
    const tp = lastTeleports.get(e.id);
    if (tp && (sinceStep !== undefined ? tp.step > sinceStep && tp.step <= steps : tp.step === steps)) {
      flags = withTeleport(flags, tp.portalIdx);
    }
    const tr = activeByBody.get(e.id);
    if (tr) {
      flags |= HAS_CLONE;
      buf[o + CLONE_POS] = tr.clonePos[0];
      buf[o + CLONE_POS + 1] = tr.clonePos[1];
      buf[o + CLONE_POS + 2] = tr.clonePos[2];
      buf[o + CLONE_QUAT] = tr.cloneQuat[0];
      buf[o + CLONE_QUAT + 1] = tr.cloneQuat[1];
      buf[o + CLONE_QUAT + 2] = tr.cloneQuat[2];
      buf[o + CLONE_QUAT + 3] = tr.cloneQuat[3];
      buf[o + SPARE] = tr.portalIdx;
    }
    buf[o + FLAGS] = flags;
  }

  function snapshot() {
    return {
      portalSpecs: portalSpecs.map(clonePortalSpec),
      explicitBounds: explicitBounds ? {min: [...explicitBounds.min], max: [...explicitBounds.max]} : null,
      carves: portalRecords.map((r) => ({
        idx: r.idx,
        hostBlockIds: [...r.hostBlockIds],
        hostColHandles: [...r.hostColHandles],
        tangentBounds: r.tangentBounds ? {...r.tangentBounds} : null,
        carveRbHandle: r.carveRbHandle,
        plugColHandle: r.plugColHandle,
        slabColHandles: [...r.slabColHandles],
      })),
      ghostGroups: ghostGroups.map((g) => ({
        portalIdx: g.portalIdx,
        rbHandle: g.rbHandle,
        colHandles: [...g.colHandles],
      })),
      active: [...activeByBody.values()].map((tr) => ({
        bodyId: tr.bodyId,
        portalIdx: tr.portalIdx,
        partnerIdx: tr.partnerIdx,
        cloneRbHandle: tr.cloneRbHandle,
        cloneColHandle: tr.cloneColHandle,
        clonePos: [...tr.clonePos],
        cloneQuat: [...tr.cloneQuat],
      })),
      cooldowns: [...cooldowns.entries()],
      lastTeleports: [...lastTeleports.entries()].map(([id, tp]) => [id, {...tp}]),
      teleportCount,
    };
  }

  function restore(restoredWorld, snapData, entries) {
    world = restoredWorld;
    roleByCollider.clear();
    bodyPortalMap.clear();
    bodyPortalSet.clear();
    activeByBody.clear();
    cooldowns.clear();
    lastTeleports.clear();
    entryByRbHandle.clear();

    const byBodyId = new Map();
    for (const e of entries) {
      byBodyId.set(e.id, e);
      entryByRbHandle.set(e.rbHandle, e);
    }

    portalSpecs = snapData.portalSpecs.map(clonePortalSpec);
    explicitBounds = snapData.explicitBounds
      ? {min: [...snapData.explicitBounds.min], max: [...snapData.explicitBounds.max]}
      : null;

    const byId = new Map();
    portalSpecs.forEach((p, idx) => byId.set(p.id, {p, idx}));
    const portalsByBlockCol = new Map();

    portalRecords = portalSpecs.map((spec, idx) => {
      const P = frame(spec);
      const P_hyst = {...P, c: madd(P.c, P.n, -TELEPORT_HYST)};
      const partner = spec.pair ? byId.get(spec.pair) : null;
      const isOpen = Boolean(partner && partner.idx !== idx && partner.p.pair === spec.id);
      const Q = isOpen ? frame(partner.p) : null;
      const M_PQ = isOpen ? portalMap(P, Q) : null;
      const M_QP = isOpen ? portalMap(Q, P) : null;
      if (M_PQ) M_PQ.q = qfromR(M_PQ.R);
      if (M_QP) M_QP.q = qfromR(M_QP.R);
      const cSnap = snapData.carves[idx];
      for (const ch of cSnap.hostColHandles) {
        let list = portalsByBlockCol.get(ch);
        if (!list) { list = []; portalsByBlockCol.set(ch, list); }
        list.push(idx);
      }
      roleByCollider.set(cSnap.plugColHandle, {kind: ROLE_PLUG, portalIdx: idx});
      for (const sh of cSnap.slabColHandles) {
        roleByCollider.set(sh, {kind: ROLE_TUNNEL, portalIdx: idx});
      }
      return {
        idx, spec, P, P_hyst, Q,
        pairIdx: isOpen ? partner.idx : -1,
        isOpen, M_PQ, M_QP,
        hostBlockIds: [...cSnap.hostBlockIds],
        hostColHandles: [...cSnap.hostColHandles],
        tangentBounds: cSnap.tangentBounds ? {...cSnap.tangentBounds} : null,
        carveRbHandle: cSnap.carveRbHandle,
        plugColHandle: cSnap.plugColHandle,
        slabColHandles: [...cSnap.slabColHandles],
      };
    });

    for (const [ch, pList] of portalsByBlockCol.entries()) {
      roleByCollider.set(ch, {kind: ROLE_HOST, portals: Int32Array.from(pList)});
    }

    ghostColsByPortal = portalRecords.map(() => []);
    ghostGroups = snapData.ghostGroups.map((g) => {
      for (const gh of g.colHandles) {
        roleByCollider.set(gh, {kind: ROLE_GHOST, portalIdx: g.portalIdx});
      }
      ghostColsByPortal[g.portalIdx] = g.colHandles.map((gh) => world.getCollider(gh)).filter(Boolean);
      return {portalIdx: g.portalIdx, rbHandle: g.rbHandle, colHandles: [...g.colHandles]};
    });

    for (const a of snapData.active) {
      const e = byBodyId.get(a.bodyId);
      if (!e) continue;
      const cloneRb = world.getRigidBody(a.cloneRbHandle);
      const cloneCol = world.getCollider(a.cloneColHandle);
      bodyPortalMap.set(e.rbHandle, a.portalIdx);
      bodyPortalSet.add(bpKey(e.rbHandle, a.portalIdx));
      roleByCollider.set(a.cloneColHandle, {
        kind: ROLE_CLONE,
        portalIdx: a.portalIdx,
        partnerIdx: a.partnerIdx,
        ownerRbHandle: e.rbHandle,
      });
      activeByBody.set(a.bodyId, {
        bodyId: a.bodyId,
        entry: e,
        portalIdx: a.portalIdx,
        partnerIdx: a.partnerIdx,
        cloneRb,
        cloneCol,
        cloneRbHandle: a.cloneRbHandle,
        cloneColHandle: a.cloneColHandle,
        clonePos: [...a.clonePos],
        cloneQuat: [...a.cloneQuat],
      });
    }

    for (const [k, v] of snapData.cooldowns) cooldowns.set(k, v);
    for (const [id, tp] of snapData.lastTeleports) lastTeleports.set(id, {...tp});
    teleportCount = snapData.teleportCount;
  }

  return {
    hooks,
    rebuild,
    syncBodies,
    registerDynamicBody,
    unregisterDynamicBody,
    beforeStep,
    afterStep,
    writeSlot,
    snapshot,
    restore,
    get portals() { return portalSpecs; },
    get records() { return portalRecords; },
    get activeCount() { return activeByBody.size; },
    get bodyPortalSet() { return bodyPortalSet; },
    get roleByCollider() { return roleByCollider; },
    get teleportCount() { return teleportCount; },
    get lastHookMs() { return lastHookMs; },
  };
}
