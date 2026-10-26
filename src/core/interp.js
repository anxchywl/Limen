// Render-side interpolation between the last two physics frames, by alpha = accumulator / dt.
// Positions lerp, quaternions slerp. If a slot teleported in the newer frame, its older pose is
// first carried through that portal's map, so the body never streaks across the room for a frame.

import {frame, portalMap} from './portal.js';
import {qfromR, qslerpAt} from './quat.js';
import {ALIVE, CLONE_POS, FLAGS, HAS_CLONE, POS, slotOffset, teleportOf} from './frame.js';

// one rigid map per portal index, from that portal to its partner, with its rotation as a quaternion
export function teleportMaps(portals) {
  const byId = new Map(portals.map((p) => [p.id, p]));
  return portals.map((p) => {
    const q = byId.get(p.pair);
    if (!q) return null;
    const M = portalMap(frame(p), frame(q));
    return {...M, q: qfromR(M.R)};
  });
}

const tmp = new Float64Array(7);

// carry the pose a[ao..ao+6] through map M into out[oo..oo+6]
export function mapPoseAt(M, a, ao, out, oo) {
  const x = a[ao], y = a[ao + 1], z = a[ao + 2], R = M.R;
  const px = R[0][0] * x + R[1][0] * y + R[2][0] * z + M.t[0];
  const py = R[0][1] * x + R[1][1] * y + R[2][1] * z + M.t[1];
  const pz = R[0][2] * x + R[1][2] * y + R[2][2] * z + M.t[2];
  const m = M.q, qx = a[ao + 3], qy = a[ao + 4], qz = a[ao + 5], qw = a[ao + 6];
  out[oo] = px; out[oo + 1] = py; out[oo + 2] = pz;
  out[oo + 3] = m[3] * qx + m[0] * qw + m[1] * qz - m[2] * qy;
  out[oo + 4] = m[3] * qy - m[0] * qz + m[1] * qw + m[2] * qx;
  out[oo + 5] = m[3] * qz + m[0] * qy - m[1] * qx + m[2] * qw;
  out[oo + 6] = m[3] * qw - m[0] * qx - m[1] * qy - m[2] * qz;
}

// blend the 7-float pose at offset `off` of prev and curr into out[oo..oo+6]; M maps prev first
export function blendPoseAt(prev, curr, off, alpha, M, out, oo) {
  let a = prev, ao = off;
  if (M) { mapPoseAt(M, prev, off, tmp, 0); a = tmp; ao = 0; }
  for (let k = 0; k < 3; k++) out[oo + k] = a[ao + k] + (curr[off + k] - a[ao + k]) * alpha;
  qslerpAt(a, ao + 3, curr, off + 3, alpha, out, oo + 3);
}

// blend slot i: out gets master pose at 0..6 and, if the slot has a clone, the clone pose at 7..13.
// Returns the current flags, or 0 if the slot is dead.
export function blendSlot(prev, curr, i, alpha, maps, out) {
  const o = slotOffset(i);
  const flags = curr[o + FLAGS];
  if (!(flags & ALIVE)) return 0;
  const was = prev.length > o + FLAGS && (prev[o + FLAGS] & ALIVE);
  const tp = teleportOf(flags);
  const M = tp >= 0 ? maps?.[tp] : null;
  if (!was) {
    for (let k = 0; k < 7; k++) out[k] = curr[o + POS + k];
  } else if (tp >= 0 && !M) {
    for (let k = 0; k < 7; k++) out[k] = curr[o + POS + k]; // unknown portal: snap rather than streak
  } else {
    blendPoseAt(prev, curr, o + POS, alpha, M, out, 0);
  }
  if (flags & HAS_CLONE) {
    if (was && (prev[o + FLAGS] & HAS_CLONE)) blendPoseAt(prev, curr, o + CLONE_POS, alpha, null, out, 7);
    else for (let k = 0; k < 7; k++) out[7 + k] = curr[o + CLONE_POS + k];
  }
  return flags;
}
