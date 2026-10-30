// Builds static "ghost" colliders behind each active portal P by taking static scene blocks within
// 3 m of its partner Q, clipping them to the half-space in front of Q, and mapping the clipped
// convex hulls through portalMap(Q, P). Rebuilt only when blocks or portals change, never per step.

import {add, apply, cross, dot, norm, scale, sub} from '../core/vec.js';
import {qrot} from '../core/quat.js';
import {local} from '../core/portal.js';

export const GHOST_REACH = 3.0;
const MIN_THICKNESS = 2e-3;

function normQuat(q) {
  const x = q?.[0] ?? 0, y = q?.[1] ?? 0, z = q?.[2] ?? 0, w = q?.[3] ?? 1;
  const l = Math.hypot(x, y, z, w) || 1;
  return [x / l, y / l, z / l, w / l];
}

// Sutherland-Hodgman clip of a 3D convex polygon against half-space n.x >= offset
function clipPolygon(poly, nx, ny, nz, offset) {
  const n = poly.length;
  if (n < 3) return [];
  const out = [];
  let prev = poly[n - 1];
  let dPrev = nx * prev[0] + ny * prev[1] + nz * prev[2] - offset;
  for (let i = 0; i < n; i++) {
    const curr = poly[i];
    const dCurr = nx * curr[0] + ny * curr[1] + nz * curr[2] - offset;
    if (dCurr >= -1e-7) {
      if (dPrev < -1e-7) {
        const t = dPrev / (dPrev - dCurr);
        out.push([
          prev[0] + (curr[0] - prev[0]) * t,
          prev[1] + (curr[1] - prev[1]) * t,
          prev[2] + (curr[2] - prev[2]) * t,
        ]);
      }
      out.push(curr);
    } else if (dPrev >= -1e-7) {
      const t = dPrev / (dPrev - dCurr);
      out.push([
        prev[0] + (curr[0] - prev[0]) * t,
        prev[1] + (curr[1] - prev[1]) * t,
        prev[2] + (curr[2] - prev[2]) * t,
      ]);
    }
    prev = curr;
    dPrev = dCurr;
  }
  return out;
}

function clipPolyByPlanes(poly, planes) {
  let cur = poly;
  for (let i = 0; i < planes.length && cur.length >= 3; i++) {
    const p = planes[i];
    cur = clipPolygon(cur, p[0], p[1], p[2], p[3]);
  }
  return cur;
}

function orientedBoxPoly(center, ax, ay, az, hx, hy, hz) {
  const corners = [];
  for (const sz of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sx of [-1, 1]) {
        corners.push([
          center[0] + ax[0] * sx * hx + ay[0] * sy * hy + az[0] * sz * hz,
          center[1] + ax[1] * sx * hx + ay[1] * sy * hy + az[1] * sz * hz,
          center[2] + ax[2] * sx * hx + ay[2] * sy * hy + az[2] * sz * hz,
        ]);
      }
    }
  }
  const faces = [
    [0, 4, 6, 2], [1, 3, 7, 5],
    [0, 1, 5, 4], [2, 6, 7, 3],
    [0, 2, 3, 1], [4, 5, 7, 6],
  ].map((idx) => idx.map((k) => corners[k]));
  const planes = [
    [ax[0], ax[1], ax[2], dot(ax, center) - hx],
    [-ax[0], -ax[1], -ax[2], -dot(ax, center) - hx],
    [ay[0], ay[1], ay[2], dot(ay, center) - hy],
    [-ay[0], -ay[1], -ay[2], -dot(ay, center) - hy],
    [az[0], az[1], az[2], dot(az, center) - hz],
    [-az[0], -az[1], -az[2], -dot(az, center) - hz],
  ];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const c of corners) {
    for (let k = 0; k < 3; k++) {
      if (c[k] < min[k]) min[k] = c[k];
      if (c[k] > max[k]) max[k] = c[k];
    }
  }
  return {faces, planes, min, max};
}

function polyhedronFromBlock(spec) {
  if (!spec.kind || spec.kind === 'box') {
    const [x0, y0, z0] = spec.min, [x1, y1, z1] = spec.max;
    return orientedBoxPoly(
      [(x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5],
      [1, 0, 0], [0, 1, 0], [0, 0, 1],
      Math.max(0.005, (x1 - x0) * 0.5),
      Math.max(0.005, (y1 - y0) * 0.5),
      Math.max(0.005, (z1 - z0) * 0.5));
  }
  const [hx, hy, hz] = spec.size.map((s) => Math.max(0.01, s * 0.5));
  const pos = spec.pos ?? [0, 0, 0];
  const rot = normQuat(spec.rot);
  if (spec.kind !== 'ramp') {
    return orientedBoxPoly(
      pos, qrot(rot, [1, 0, 0]), qrot(rot, [0, 1, 0]), qrot(rot, [0, 0, 1]), hx, hy, hz);
  }
  const localVerts = [
    [-hx, -hy, -hz], [-hx, -hy, hz],
    [hx, -hy, -hz], [hx, -hy, hz],
    [hx, hy, -hz], [hx, hy, hz],
  ];
  const verts = localVerts.map((v) => add(pos, qrot(rot, v)));
  const cen = add(pos, qrot(rot, [hx / 3, -hy / 3, 0]));
  const faceIdx = [[0, 2, 3, 1], [2, 4, 5, 3], [0, 1, 5, 4], [0, 4, 2], [1, 3, 5]];
  const faces = [];
  const planes = [];
  for (const idx of faceIdx) {
    const poly = idx.map((k) => verts[k]);
    faces.push(poly);
    let fn = norm(cross(sub(poly[1], poly[0]), sub(poly[2], poly[0])));
    if (dot(fn, sub(cen, poly[0])) < 0) fn = scale(fn, -1);
    planes.push([fn[0], fn[1], fn[2], dot(fn, poly[0])]);
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) {
    for (let k = 0; k < 3; k++) {
      if (v[k] < min[k]) min[k] = v[k];
      if (v[k] > max[k]) max[k] = v[k];
    }
  }
  return {faces, planes, min, max};
}

function aabbOverlap(aMin, aMax, bMin, bMax) {
  return aMin[0] <= bMax[0] && aMax[0] >= bMin[0] &&
         aMin[1] <= bMax[1] && aMax[1] >= bMin[1] &&
         aMin[2] <= bMax[2] && aMax[2] >= bMin[2];
}

function dedupePoints(points) {
  const uniq = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    let dup = false;
    for (let j = 0; j < uniq.length; j++) {
      const q = uniq[j];
      const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
      if (dx * dx + dy * dy + dz * dz < 1e-8) { dup = true; break; }
    }
    if (!dup) uniq.push(p);
  }
  return uniq;
}

function pointInsidePlanes(pt, planes, eps = 1e-5) {
  for (let i = 0; i < planes.length; i++) {
    const p = planes[i];
    if (p[0] * pt[0] + p[1] * pt[1] + p[2] * pt[2] < p[3] - eps) return false;
  }
  return true;
}

function clipIntersectionVerts(polyA, polyB) {
  const raw = [];
  for (const face of polyA.faces) {
    const clipped = clipPolyByPlanes(face, polyB.planes);
    for (const v of clipped) raw.push(v);
  }
  for (const face of polyB.faces) {
    const clipped = clipPolyByPlanes(face, polyA.planes);
    for (const v of clipped) raw.push(v);
  }
  return raw;
}

export function buildPortalGhosts(RAPIER, world, portalRecords, blocks, {collisionGroups, onCollider}) {
  const blockPolys = [];
  for (const blk of blocks.values()) {
    blockPolys.push({id: blk.id, colHandle: blk.colHandle, poly: polyhedronFromBlock(blk.spec)});
  }

  // map blockId -> open portals hosted on that block, so a directly facing open portal doesn't create a solid cap
  const openPortalsByBlock = new Map();
  for (const rec of portalRecords) {
    if (!rec.isOpen) continue;
    for (const blkId of rec.hostBlockIds) {
      let arr = openPortalsByBlock.get(blkId);
      if (!arr) { arr = []; openPortalsByBlock.set(blkId, arr); }
      arr.push(rec.P);
    }
  }

  const created = []; // [{portalIdx, rbHandle, colHandles}]
  for (let pIdx = 0; pIdx < portalRecords.length; pIdx++) {
    const rec = portalRecords[pIdx];
    if (!rec.isOpen) continue;
    const {Q, M_QP} = rec;
    const hu = Q.a + GHOST_REACH, hv = Q.b + GHOST_REACH, hz = GHOST_REACH * 0.5;
    const reachCenter = add(Q.c, scale(Q.n, hz));
    const reachBox = orientedBoxPoly(reachCenter, Q.u, Q.v, Q.n, hu, hv, hz);

    let ghostRb = null;
    const colHandles = [];

    for (let b = 0; b < blockPolys.length; b++) {
      const bp = blockPolys[b];
      if (!aabbOverlap(bp.poly.min, bp.poly.max, reachBox.min, reachBox.max)) continue;

      // if this block hosts an open portal aligned directly opposite Q, skip so its uncarved body never seals the tunnel
      const hosted = openPortalsByBlock.get(bp.id);
      if (hosted) {
        let facesQ = false;
        for (const R of hosted) {
          if (dot(R.n, Q.n) < -0.7) {
            const lr = local(R, Q.c);
            if (Math.hypot(lr[0] / Math.max(0.1, R.a), lr[1] / Math.max(0.1, R.b)) < 0.8) {
              facesQ = true;
              break;
            }
          }
        }
        if (facesQ) continue;
      }

      const rawVerts = clipIntersectionVerts(bp.poly, reachBox);
      if (rawVerts.length < 4) continue;

      let verts = dedupePoints(rawVerts);
      if (verts.length < 4) continue;

      let minU = Infinity, maxU = -Infinity;
      let minV = Infinity, maxV = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < verts.length; i++) {
        const lq = local(Q, verts[i]);
        if (lq[0] < minU) minU = lq[0]; if (lq[0] > maxU) maxU = lq[0];
        if (lq[1] < minV) minV = lq[1]; if (lq[1] > maxV) maxV = lq[1];
        if (lq[2] < minZ) minZ = lq[2]; if (lq[2] > maxZ) maxZ = lq[2];
      }
      // skip Q's own coplanar host wall (maxZ <= 2 mm) or degenerate planar slivers
      if (maxZ <= MIN_THICKNESS ||
          maxZ - minZ <= MIN_THICKNESS ||
          maxU - minU <= MIN_THICKNESS ||
          maxV - minV <= MIN_THICKNESS) {
        continue;
      }

      // chamfer artificial z_Q = 0 cut-edges on peripheral floors/walls by 5 mm over 2.5 cm
      // so bodies sliding flush into a threshold never snag on the solver's sub-mm contact margin
      let rawMinZ = Infinity;
      for (const face of bp.poly.faces) {
        for (const fv of face) {
          const zq = local(Q, fv)[2];
          if (zq < rawMinZ) rawMinZ = zq;
        }
      }
      const blocksCenter = pointInsidePlanes(add(Q.c, scale(Q.n, 0.02)), bp.poly.planes);
      if (rawMinZ < -0.02 && !blocksCenter && maxZ > 0.04) {
        const cu = (minU + maxU) * 0.5, cv = (minV + maxV) * 0.5;
        const cLen = Math.hypot(cu, cv);
        if (cLen > 1e-3) {
          const outDir = norm(add(scale(Q.u, cu / cLen), scale(Q.v, cv / cLen)));
          const chamferZ = 0.025, chamferDrop = 0.005;
          const innerBox = orientedBoxPoly(
            add(Q.c, scale(Q.n, (GHOST_REACH + chamferZ) * 0.5)),
            Q.u, Q.v, Q.n, hu, hv, (GHOST_REACH - chamferZ) * 0.5);
          const innerVerts = clipIntersectionVerts(bp.poly, innerBox);
          if (innerVerts.length >= 4) {
            const combined = [...innerVerts];
            for (const v of verts) {
              if (local(Q, v)[2] < 1e-3) combined.push(add(v, scale(outDir, chamferDrop)));
            }
            verts = dedupePoints(combined);
          }
        }
      }

      const mapped = new Float32Array(verts.length * 3);
      for (let i = 0; i < verts.length; i++) {
        const m = apply(M_QP, verts[i]);
        mapped[i * 3] = m[0];
        mapped[i * 3 + 1] = m[1];
        mapped[i * 3 + 2] = m[2];
      }

      const desc = RAPIER.ColliderDesc.convexHull(mapped);
      if (!desc) continue;
      desc.setFriction(0.6)
        .setRestitution(0.2)
        .setCollisionGroups(collisionGroups)
        .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);

      if (!ghostRb) ghostRb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      const col = world.createCollider(desc, ghostRb);
      colHandles.push(col.handle);
      onCollider?.(col.handle, ghostRb.handle, pIdx);
    }

    if (ghostRb) created.push({portalIdx: pIdx, rbHandle: ghostRb.handle, colHandles});
  }

  return created;
}
