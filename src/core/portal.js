// Copied unchanged from Ianua (~/videos/ianua/src/core/portal.js, MIT, @anxchywl).
// Portal geometry. A portal is an ellipse on a plane: centre c, unit normal n out of its front,
// in-plane up v, right u = v x n, half sizes a (along u) and b (along v). It is linked to one partner.
// Whatever enters the front of one leaves the front of the other at the same local position,
// mirrored left to right, so two portals placed back to back behave as an open doorway.

import {add, cross, dot, norm, scale, sub, applyDir} from './vec.js';

export function frame(p) {
  const n = norm(p.n);
  const v = norm(sub(p.v, scale(n, dot(p.v, n))));
  return {...p, n, v, u: cross(v, n)};
}

export function local(P, p) {
  const d = sub(p, P.c);
  return [dot(d, P.u), dot(d, P.v), dot(d, P.n)];
}

export function localDir(P, d) {
  return [dot(d, P.u), dot(d, P.v), dot(d, P.n)];
}

export function inside(P, l, margin = 0) {
  return (l[0] / (P.a + margin)) ** 2 + (l[1] / (P.b + margin)) ** 2 <= 1;
}

export function portalMap(P, Q) {
  const E = [scale(Q.u, -1), Q.v, scale(Q.n, -1)];
  const L = [P.u, P.v, P.n];
  const ratio = portalScale(P, Q);
  const R = [0, 1, 2].map((j) => scale(add(add(scale(E[0], L[0][j]), scale(E[1], L[1][j])), scale(E[2], L[2][j])), ratio));
  const M = {R, t: [0, 0, 0]};
  M.t = sub(Q.c, applyDir(M, P.c));
  return M;
}

export const portalScale = (P, Q) => Math.min(P.a, Q.a) < 1e-6 ? 1 : Q.a / P.a;

// fraction along p0 -> p1 where the segment passes into P through its opening, or null.
// P0 and P1 are the portal at the start and end of the step, so a moving portal is handled.
export function crossing(P0, P1, p0, p1) {
  const a = local(P0, p0);
  const b = local(P1, p1);
  const depth = P1.surface?.renderDome;
  if (depth) {
    const d = sub(b, a);
    const radii = [P1.a, P1.b, Math.abs(depth)];
    const A = d.reduce((s, v, j) => s + (v / radii[j]) ** 2, 0);
    const B = 2 * a.reduce((s, v, j) => s + v * d[j] / radii[j] ** 2, 0);
    const C = a.reduce((s, v, j) => s + (v / radii[j]) ** 2, 0) - 1;
    const disc = B * B - 4 * A * C;
    if (A < 1e-18 || disc < 0) return null;
    for (const f of [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)]) {
      if (f > 1e-7 && f <= 1 && (a[2] + d[2] * f) * Math.sign(depth) >= 0) return f;
    }
    return null;
  }
  if (!(a[2] > 0 && b[2] <= 0)) return null;
  const f = a[2] / (a[2] - b[2]);
  return inside(P1, [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]) ? f : null;
}
