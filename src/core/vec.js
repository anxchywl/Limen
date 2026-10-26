// Copied unchanged from Ianua (~/videos/ianua/src/core/vec.js, MIT, @anxchywl).
// Small 3D vector and rigid-map helpers. Vectors are plain [x, y, z] arrays.
// A map is {R: [c0, c1, c2], t}: three column vectors and a translation, p -> R p + t.

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => scale(a, 1 / (len(a) || 1));
export const lerp = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

export const IDENTITY = {R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0]};

export const applyDir = (M, d) => add(add(scale(M.R[0], d[0]), scale(M.R[1], d[1])), scale(M.R[2], d[2]));
export const apply = (M, p) => add(applyDir(M, p), M.t);

// A after B: p -> A(B(p))
export const compose = (A, B) => ({R: B.R.map((c) => applyDir(A, c)), t: apply(A, B.t)});

export const invert = (M) => {
  const s2 = dot(M.R[0], M.R[0]);
  const R = [0, 1, 2].map((i) => scale([M.R[0][i], M.R[1][i], M.R[2][i]], 1 / s2));
  const inv = {R, t: [0, 0, 0]};
  inv.t = scale(applyDir(inv, M.t), -1);
  return inv;
};

// rotate v toward w by fraction f along the great circle (both unit length)
export const slerp = (v, w, f) => {
  const c = Math.max(-1, Math.min(1, dot(v, w)));
  const a = Math.acos(c);
  if (a < 1e-5) return w;
  const s = Math.sin(a);
  return add(scale(v, Math.sin((1 - f) * a) / s), scale(w, Math.sin(f * a) / s));
};
