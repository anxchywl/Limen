// Quaternion helpers for the frame buffer and the stub sim. Quaternions are plain [x, y, z, w]
// arrays, matching three.js order, so the render side can copy them straight into its types.
// The `*At` variants read and write flat arrays at an offset and allocate nothing (hot path).

export const IDENTITY_Q = [0, 0, 0, 1];

export const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

export const qnorm = (q) => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};

export const qaxis = (axis, angle) => {
  const s = Math.sin(angle / 2), l = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  return [axis[0] / l * s, axis[1] / l * s, axis[2] / l * s, Math.cos(angle / 2)];
};

// rotate vector v by unit quaternion q
export const qrot = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
};

// quaternion of a rotation matrix given as three column vectors (vec.js map R); scale is removed
export function qfromR(R) {
  const s = Math.hypot(R[0][0], R[0][1], R[0][2]) || 1;
  const m00 = R[0][0] / s, m10 = R[0][1] / s, m20 = R[0][2] / s;
  const m01 = R[1][0] / s, m11 = R[1][1] / s, m21 = R[1][2] / s;
  const m02 = R[2][0] / s, m12 = R[2][1] / s, m22 = R[2][2] / s;
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) {
    const k = 0.5 / Math.sqrt(tr + 1);
    q = [(m21 - m12) * k, (m02 - m20) * k, (m10 - m01) * k, 0.25 / k];
  } else if (m00 > m11 && m00 > m22) {
    const k = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * k, (m01 + m10) / k, (m02 + m20) / k, (m21 - m12) / k];
  } else if (m11 > m22) {
    const k = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / k, 0.25 * k, (m12 + m21) / k, (m02 - m20) / k];
  } else {
    const k = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / k, (m12 + m21) / k, 0.25 * k, (m10 - m01) / k];
  }
  return qnorm(q);
}

// shortest-arc slerp of a[ao..ao+3] toward b[bo..bo+3] by t, written to out[oo..oo+3]
export function qslerpAt(a, ao, b, bo, t, out, oo) {
  const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3];
  let bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
  let c = ax * bx + ay * by + az * bz + aw * bw;
  if (c < 0) { c = -c; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let ka, kb;
  if (c > 0.9995) { ka = 1 - t; kb = t; } else {
    const th = Math.acos(c), s = Math.sin(th);
    ka = Math.sin((1 - t) * th) / s; kb = Math.sin(t * th) / s;
  }
  const x = ax * ka + bx * kb, y = ay * ka + by * kb, z = az * ka + bz * kb, w = aw * ka + bw * kb;
  const l = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  out[oo] = x / l; out[oo + 1] = y / l; out[oo + 2] = z / l; out[oo + 3] = w / l;
}

export const qslerp = (a, b, t) => { const o = [0, 0, 0, 1]; qslerpAt(a, 0, b, 0, t, o, 0); return o; };
