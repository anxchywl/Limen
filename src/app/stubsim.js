// A stand-in simulation on the main thread, so the render loop can be built before Rapier arrives.
// Ballistic motion with gravity and air drag; bodies bounce off the blocks (each a convex set of
// planes) and settle flat. No body-to-body contact. Prompt 03 replaces it with the physics worker
// behind the same interface: slots, write(buf), step(buf), add(body), reset().

import {apply, madd} from '../core/vec.js';
import {frame, portalMap} from '../core/portal.js';
import {
  ALIVE, CLONE_POS, CLONE_QUAT, FLAGS, HAS_CLONE, H_COUNT, H_STEP, H_TIME,
  SPARE, slotOffset, withTeleport,
} from '../core/frame.js';
import {qaxis, qfromR, qmul, qrot} from '../core/quat.js';

const DT = 1 / 60;

// outward planes [nx, ny, nz, d] (n . p <= d inside) and a bounding box for each block
export function blockPlanes(b) {
  if (b.kind === 'box' || !b.kind) {
    const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
    return {planes: [[1, 0, 0, x1], [-1, 0, 0, -x0], [0, 1, 0, y1], [0, -1, 0, -y0], [0, 0, 1, z1], [0, 0, -1, -z0]],
      min: [x0, y0, z0], max: [x1, y1, z1]};
  }
  const [sx, sy, sz] = b.size.map((s) => s / 2);
  const local = [[1, 0, 0, sx], [-1, 0, 0, sx], [0, -1, 0, sy], [0, 0, 1, sz], [0, 0, -1, sz]];
  if (b.kind === 'ramp') {
    const l = Math.hypot(sx, sy); // slope through (-sx, -sy) and (sx, sy), facing up and back
    local.push([-sy / l, sx / l, 0, 0]);
  } else local.push([0, 1, 0, sy]);
  const planes = local.map(([x, y, z, d]) => {
    const n = qrot(b.rot, [x, y, z]);
    return [...n, d + n[0] * b.pos[0] + n[1] * b.pos[1] + n[2] * b.pos[2]];
  });
  const r = Math.hypot(sx, sy, sz);
  return {planes, min: b.pos.map((p) => p - r), max: b.pos.map((p) => p + r)};
}

export function createStubSim(scene) {
  let cap = 0, n = 0, steps = 0;
  let P, Q, V, W, H; // positions, quaternions, velocities, angular velocities, half sizes
  let blocks = scene.blocks.map(blockPlanes);
  const g = scene.settings.gravity, vmax = scene.settings.terminalSpeed;

  const grow = (want) => {
    if (want <= cap) return;
    const c = Math.max(want, cap * 2, 64);
    const re = (a, k) => { const b = new Float64Array(c * k); if (a) b.set(a); return b; };
    P = re(P, 3); Q = re(Q, 4); V = re(V, 3); W = re(W, 3); H = re(H, 3);
    cap = c;
  };

  function add(body) {
    grow(n + 1);
    const i = n++;
    P.set(body.pos, i * 3); Q.set(body.quat, i * 4); V.set(body.vel, i * 3); W.set(body.angvel, i * 3);
    H.set(body.size.map((s) => s / 2), i * 3);
    return i;
  }

  let slider = null;

  function buildSlider() {
    slider = null;
    if (!scene.portals?.length) return;
    let pIdx = scene.portals.findIndex((p) => p.n[1] > 0.5);
    if (pIdx < 0) pIdx = 0;
    const p = scene.portals[pIdx];
    const qIdx = scene.portals.findIndex((x) => x.id === p.pair);
    if (qIdx < 0) return;
    const Pf = frame(p), Qf = frame(scene.portals[qIdx]);
    const Mpq = portalMap(Pf, Qf);
    slider = {pIdx, qIdx, P: Pf, Q: Qf, Mpq, qpq: qfromR(Mpq.R)};
  }

  function reset() {
    n = 0; steps = 0;
    blocks = scene.blocks.map(blockPlanes);
    buildSlider();
    scene.bodies.forEach(add);
  }

  // support distance of body i along unit n: how far its surface reaches past its centre
  const ax = new Float64Array(9);
  const axes = (i) => {
    const x = Q[i * 4], y = Q[i * 4 + 1], z = Q[i * 4 + 2], w = Q[i * 4 + 3];
    ax[0] = 1 - 2 * (y * y + z * z); ax[1] = 2 * (x * y + z * w); ax[2] = 2 * (x * z - y * w);
    ax[3] = 2 * (x * y - z * w); ax[4] = 1 - 2 * (x * x + z * z); ax[5] = 2 * (y * z + x * w);
    ax[6] = 2 * (x * z + y * w); ax[7] = 2 * (y * z - x * w); ax[8] = 1 - 2 * (x * x + y * y);
  };
  const support = (i, nx, ny, nz) =>
    Math.abs(ax[0] * nx + ax[1] * ny + ax[2] * nz) * H[i * 3] +
    Math.abs(ax[3] * nx + ax[4] * ny + ax[5] * nz) * H[i * 3 + 1] +
    Math.abs(ax[6] * nx + ax[7] * ny + ax[8] * nz) * H[i * 3 + 2];

  // turn body i a little so its local axis closest to n lines up with n: boxes come to rest flat
  function settle(i, nx, ny, nz, f) {
    let best = 0, bd = 0;
    for (let k = 0; k < 3; k++) {
      const d = ax[k * 3] * nx + ax[k * 3 + 1] * ny + ax[k * 3 + 2] * nz;
      if (Math.abs(d) > Math.abs(bd)) { bd = d; best = k; }
    }
    const s = Math.sign(bd) || 1;
    const a = [ax[best * 3] * s, ax[best * 3 + 1] * s, ax[best * 3 + 2] * s];
    const cx = a[1] * nz - a[2] * ny, cy = a[2] * nx - a[0] * nz, cz = a[0] * ny - a[1] * nx;
    rotate(i, cx * f, cy * f, cz * f);
  }

  // apply a small rotation vector (axis * angle) to quaternion i
  function rotate(i, rx, ry, rz) {
    const o = i * 4, x = Q[o], y = Q[o + 1], z = Q[o + 2], w = Q[o + 3];
    const hx = rx / 2, hy = ry / 2, hz = rz / 2;
    let qx = x + (hx * w + hy * z - hz * y), qy = y + (hy * w + hz * x - hx * z);
    let qz = z + (hz * w + hx * y - hy * x), qw = w - (hx * x + hy * y + hz * z);
    const l = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
    Q[o] = qx / l; Q[o + 1] = qy / l; Q[o + 2] = qz / l; Q[o + 3] = qw / l;
  }

  function stepBody(i) {
    const p = i * 3;
    V[p] += g[0] * DT; V[p + 1] += g[1] * DT; V[p + 2] += g[2] * DT;
    const sp = Math.hypot(V[p], V[p + 1], V[p + 2]);
    if (sp > vmax) { const k = vmax / sp; V[p] *= k; V[p + 1] *= k; V[p + 2] *= k; }
    P[p] += V[p] * DT; P[p + 1] += V[p + 1] * DT; P[p + 2] += V[p + 2] * DT;
    rotate(i, W[p] * DT, W[p + 1] * DT, W[p + 2] * DT);
    axes(i);
    const r = H[p] + H[p + 1] + H[p + 2];
    for (const b of blocks) {
      if (P[p] + r < b.min[0] || P[p] - r > b.max[0] || P[p + 1] + r < b.min[1] || P[p + 1] - r > b.max[1] ||
        P[p + 2] + r < b.min[2] || P[p + 2] - r > b.max[2]) continue;
      // the plane of least penetration; if any plane separates, there is no contact
      let best = null, bd = -Infinity;
      for (const pl of b.planes) {
        const d = pl[0] * P[p] + pl[1] * P[p + 1] + pl[2] * P[p + 2] - pl[3] - support(i, pl[0], pl[1], pl[2]);
        if (d >= 0) { best = null; break; }
        if (d > bd) { bd = d; best = pl; }
      }
      if (!best) continue;
      const [nx, ny, nz] = best;
      P[p] -= nx * bd; P[p + 1] -= ny * bd; P[p + 2] -= nz * bd;
      const vn = V[p] * nx + V[p + 1] * ny + V[p + 2] * nz;
      if (vn < 0) {
        const e = vn < -1.2 ? 0.45 : 0;
        V[p] -= (1 + e) * vn * nx; V[p + 1] -= (1 + e) * vn * ny; V[p + 2] -= (1 + e) * vn * nz;
        // friction on the tangential part, and spin that follows the slide
        const tx = V[p] - (V[p] * nx + V[p + 1] * ny + V[p + 2] * nz) * nx;
        const ty = V[p + 1] - (V[p] * nx + V[p + 1] * ny + V[p + 2] * nz) * ny;
        const tz = V[p + 2] - (V[p] * nx + V[p + 1] * ny + V[p + 2] * nz) * nz;
        V[p] -= tx * 0.08; V[p + 1] -= ty * 0.08; V[p + 2] -= tz * 0.08;
        W[p] *= 0.9; W[p + 1] *= 0.9; W[p + 2] *= 0.9;
      }
      if (vn > -1.2) settle(i, nx, ny, nz, 0.15);
    }
  }

  // slide slot 0 back and forth through the floor portal and fill its clone fields via portalMap
  function writeSlider(buf) {
    const t = steps * DT;
    const s = 0.45 * Math.cos(t * 1.8);
    const sPrev = steps > 0 ? 0.45 * Math.cos((steps - 1) * DT * 1.8) : s;
    const quatP = qmul(qaxis(slider.P.n, 0.4 + 0.3 * Math.sin(t * 0.7)), qaxis(slider.P.u, 0.25));
    const posP = madd(slider.P.c, slider.P.n, s);
    const posQ = apply(slider.Mpq, posP);
    const quatQ = qmul(slider.qpq, quatP);
    Q.set(quatP, 0);
    axes(0);
    const ext = support(0, slider.P.n[0], slider.P.n[1], slider.P.n[2]) + 0.01;
    const o = slotOffset(0);
    let flags = ALIVE, masterPos = posP, masterQuat = quatP, clonePos = null, cloneQuat = null, entryIdx = 0;
    if (s < 0) {
      masterPos = posQ; masterQuat = quatQ;
      if (s > -ext) { flags |= HAS_CLONE; clonePos = posP; cloneQuat = quatP; entryIdx = slider.qIdx; }
      if (steps > 0 && sPrev >= 0) flags = withTeleport(flags, slider.pIdx);
    } else if (s < ext) {
      flags |= HAS_CLONE; clonePos = posQ; cloneQuat = quatQ; entryIdx = slider.pIdx;
      if (steps > 0 && sPrev < 0) flags = withTeleport(flags, slider.qIdx);
    }
    P.set(masterPos, 0); Q.set(masterQuat, 0);
    buf.set(masterPos, o); buf.set(masterQuat, o + 3);
    buf[o + FLAGS] = flags;
    if (clonePos) {
      buf.set(clonePos, o + CLONE_POS); buf.set(cloneQuat, o + CLONE_QUAT);
      buf[o + SPARE] = entryIdx;
    } else {
      buf.fill(0, o + CLONE_POS, o + SPARE + 1);
    }
  }

  function write(buf) {
    buf[H_STEP] = steps; buf[H_TIME] = steps * DT; buf[H_COUNT] = n;
    const start = slider && n > 0 ? 1 : 0;
    if (start === 1) writeSlider(buf);
    for (let i = start; i < n; i++) {
      const o = slotOffset(i);
      buf[o] = P[i * 3]; buf[o + 1] = P[i * 3 + 1]; buf[o + 2] = P[i * 3 + 2];
      buf[o + 3] = Q[i * 4]; buf[o + 4] = Q[i * 4 + 1]; buf[o + 5] = Q[i * 4 + 2]; buf[o + 6] = Q[i * 4 + 3];
      buf[o + FLAGS] = ALIVE;
    }
  }

  function step(buf) {
    const start = slider && n > 0 ? 1 : 0;
    for (let i = start; i < n; i++) stepBody(i);
    steps++;
    write(buf);
  }

  reset();
  return {get slots() { return n; }, get steps() { return steps; }, write, step, add, reset};
}
