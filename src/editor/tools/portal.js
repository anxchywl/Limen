// Portal tool: places linked portal pairs on flat static geometry faces.
// Auto-fits and slides within face bounds.
// Orients v toward world up (walls) or camera (floor/ceiling) snapped to face axes.
// Refuses if does not fit, overlaps (min gap 0.1 m), or exceeds 4 pairs.
// Two-click placement (A then B) with palette colours.
// Drag an existing portal to slide it along its face.

import * as THREE from 'three';
import {add, cross, dot, norm, scale, sub} from '../../core/vec.js';
import {frame, inside, local} from '../../core/portal.js';
import {PORTAL_COLOURS, newId} from '../../core/scene.js';
import {canAddPortalPair, getLimits} from '../../core/limits.js';
import {blockFaces, faceKey} from '../../render/level.js';

const MIN_GAP = 0.1;
const DEFAULT_A = 0.7;
const DEFAULT_B = 1.0;

export function createPortalTool({doc, view, sim, history, setNotice}) {
  let pendingA = null; // Pending first portal of a pair
  let draggingPortal = null;
  let dragStartPose = null;

  // Visual helper for pending placement or hover
  const hoverHelper = new THREE.Group();
  hoverHelper.visible = false;
  view.scene.add(hoverHelper);

  function resetPending() {
    pendingA = null;
    hoverHelper.visible = false;
  }

  // Intersect ray with all static block faces
  function raycastFaces(ray) {
    let closestDist = Infinity;
    let hitResult = null;

    const rOrigin = [ray.origin.x, ray.origin.y, ray.origin.z];
    const rDir = [ray.direction.x, ray.direction.y, ray.direction.z];

    for (const b of doc.blocks) {
      const faces = blockFaces(b);
      for (const f of faces) {
        // Plane normal
        const edge1 = sub(f[1], f[0]);
        const edge2 = sub(f[2], f[0]);
        const n = norm(cross(edge1, edge2));
        const denom = dot(n, rDir);
        if (denom >= -1e-6) continue; // Facing away or parallel

        const d = dot(sub(f[0], rOrigin), n) / denom;
        if (d < 1e-4 || d >= closestDist) continue;

        const hitPt = add(rOrigin, scale(rDir, d));

        // Check if hitPt is inside the convex polygon f
        let insidePoly = true;
        for (let i = 0; i < f.length; i++) {
          const p0 = f[i];
          const p1 = f[(i + 1) % f.length];
          const edge = sub(p1, p0);
          const inward = cross(n, edge);
          if (dot(sub(hitPt, p0), inward) < -1e-4) {
            insidePoly = false;
            break;
          }
        }
        if (insidePoly) {
          closestDist = d;
          hitResult = {
            block: b,
            face: f,
            normal: n,
            point: hitPt,
            dist: d,
          };
        }
      }
    }
    return hitResult;
  }

  // Determine u and v in-plane axes
  function computeFaceAxes(normal, hitPoint, cameraPos) {
    const n = norm(normal);
    let v, u;
    if (Math.abs(n[1]) > 0.8) {
      // Floor or ceiling: v points toward camera snapped to face axes
      const toCam = sub([cameraPos.x, cameraPos.y, cameraPos.z], hitPoint);
      const proj = norm(sub(toCam, scale(n, dot(toCam, n))));
      // Snap to closest principal horizontal axis: [+x, -x, +z, -z]
      const candidates = [
        [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
      ];
      let bestDot = -Infinity;
      let bestAxis = candidates[0];
      for (const cand of candidates) {
        const cDot = dot(proj, cand);
        if (cDot > bestDot) {
          bestDot = cDot;
          bestAxis = cand;
        }
      }
      v = bestAxis;
      u = cross(v, n);
    } else {
      // Wall: v is world up [0, 1, 0]
      v = [0, 1, 0];
      u = cross(v, n);
    }
    return {u: norm(u), v: norm(v), n};
  }

  // Slide portal to fit inside face and compute bounding checks
  function fitPortalToFace(corners, hitPoint, u, v, n, a = DEFAULT_A, b = DEFAULT_B) {
    let uMin = Infinity, uMax = -Infinity;
    let vMin = Infinity, vMax = -Infinity;

    for (const c of corners) {
      const du = dot(sub(c, hitPoint), u);
      const dv = dot(sub(c, hitPoint), v);
      if (du < uMin) uMin = du;
      if (du > uMax) uMax = du;
      if (dv < vMin) vMin = dv;
      if (dv > vMax) vMax = dv;
    }

    const faceW = uMax - uMin;
    const faceH = vMax - vMin;

    if (faceW < (2 * a - 1e-3) || faceH < (2 * b - 1e-3)) {
      return {fits: false, reason: `portal does not fit on this face (needs ${(2 * a).toFixed(1)} × ${(2 * b).toFixed(1)} m)`};
    }

    let centerU = 0;
    if (centerU - a < uMin) centerU = uMin + a;
    if (centerU + a > uMax) centerU = uMax - a;

    let centerV = 0;
    if (centerV - b < vMin) centerV = vMin + b;
    if (centerV + b > vMax) centerV = vMax - b;

    const center = add(add(hitPoint, scale(u, centerU)), scale(v, centerV));
    return {fits: true, center, uMin, uMax, vMin, vMax};
  }

  // Check overlap against existing portals
  function checkOverlap(center, normal, a = DEFAULT_A, b = DEFAULT_B, ignoreId = null) {
    for (const p of doc.portals) {
      if (p.id === ignoreId) continue;
      // Check if on same plane
      const pNorm = norm(p.n);
      if (Math.abs(dot(normal, pNorm)) < 0.95) continue;
      if (Math.abs(dot(normal, sub(center, p.c))) > 0.05) continue;

      // Distance in plane
      const dist = Math.hypot(...sub(center, p.c));
      const minAllowDist = (a + p.a) * 0.9 + MIN_GAP;
      if (dist < minAllowDist) {
        return {overlap: true, otherId: p.id};
      }
    }
    return {overlap: false};
  }

  function pickExistingPortal(ray) {
    for (const p of doc.portals) {
      const P = frame(p);
      const plane = new THREE.Plane().setComponents(P.n[0], P.n[1], P.n[2], -dot(P.n, P.c));
      const hitPt = new THREE.Vector3();
      if (ray.intersectPlane(plane, hitPt)) {
        const pt = [hitPt.x, hitPt.y, hitPt.z];
        const l = local(P, pt);
        if (inside(P, l, 0.05)) {
          return p;
        }
      }
    }
    return null;
  }

  function onPointerDown(e, ray) {
    if (e.button !== 0) return;

    // First check if clicking an existing portal to drag
    const existing = pickExistingPortal(ray);
    if (existing) {
      draggingPortal = existing;
      dragStartPose = {c: [...existing.c], v: [...existing.v], n: [...existing.n]};
      return;
    }

    // Otherwise, place a portal
    const hit = raycastFaces(ray);
    if (!hit) {
      setNotice?.('click on a flat face of static geometry');
      return;
    }

    // Check pair limit
    if (!pendingA) {
      const chk = canAddPortalPair(doc);
      if (!chk.ok) {
        setNotice?.(chk.reason);
        return;
      }
    }

    const {u, v, n} = computeFaceAxes(hit.normal, hit.point, view.camera.position);
    const fit = fitPortalToFace(hit.face, hit.point, u, v, n, DEFAULT_A, DEFAULT_B);
    if (!fit.fits) {
      setNotice?.(fit.reason);
      return;
    }

    const overlap = checkOverlap(fit.center, n, DEFAULT_A, DEFAULT_B);
    if (overlap.overlap) {
      setNotice?.(`overlaps existing portal (min gap ${MIN_GAP} m)`);
      return;
    }

    const pairIdx = Math.floor(doc.portals.length / 2) % PORTAL_COLOURS.length;
    const color = PORTAL_COLOURS[pairIdx];

    if (!pendingA) {
      // First click: place Portal A
      pendingA = {
        id: newId(doc, 'p'),
        pair: null,
        block: hit.block.id,
        face: faceKey(n),
        c: fit.center,
        n,
        v,
        a: DEFAULT_A,
        b: DEFAULT_B,
        color,
      };
      setNotice?.('placed portal A; click face to place portal B');
    } else {
      // Second click: place Portal B and link
      const pa = pendingA;
      const pb = {
        id: newId(doc, 'p'),
        pair: pa.id,
        block: hit.block.id,
        face: faceKey(n),
        c: fit.center,
        n,
        v,
        a: DEFAULT_A,
        b: DEFAULT_B,
        color: pa.color,
      };
      pa.pair = pb.id;
      pendingA = null;

      history.execute({
        name: 'place_portal_pair',
        execute() {
          doc.portals.push(pa, pb);
          view.rebuildPortals();
          sim.edit(pa);
          sim.edit(pb);
          setNotice?.('placed portal pair');
        },
        undo() {
          const idxB = doc.portals.findIndex((x) => x.id === pb.id);
          if (idxB >= 0) doc.portals.splice(idxB, 1);
          const idxA = doc.portals.findIndex((x) => x.id === pa.id);
          if (idxA >= 0) doc.portals.splice(idxA, 1);
          view.rebuildPortals();
          sim.remove(pb.id);
          sim.remove(pa.id);
          setNotice?.('undid portal pair placement');
        },
      });
    }
  }

  function onPointerMove(e, ray) {
    if (draggingPortal) {
      const hit = raycastFaces(ray);
      if (!hit) return;
      const {u, v, n} = computeFaceAxes(hit.normal, hit.point, view.camera.position);
      const fit = fitPortalToFace(hit.face, hit.point, u, v, n, draggingPortal.a, draggingPortal.b);
      if (!fit.fits) return;

      const overlap = checkOverlap(fit.center, n, draggingPortal.a, draggingPortal.b, draggingPortal.id);
      if (overlap.overlap) return;

      // Update position along face
      draggingPortal.c = fit.center;
      draggingPortal.v = v;
      draggingPortal.n = n;
      draggingPortal.face = faceKey(n);
      view.rebuildPortals();
      sim.edit(draggingPortal);
    }
  }

  function onPointerUp() {
    if (draggingPortal && dragStartPose) {
      const portal = draggingPortal;
      const startC = [...dragStartPose.c];
      const startV = [...dragStartPose.v];
      const startN = [...dragStartPose.n];
      const endC = [...portal.c];
      const endV = [...portal.v];
      const endN = [...portal.n];

      const moved = Math.hypot(...sub(startC, endC)) > 1e-4;
      if (moved) {
        history.execute({
          name: 'move_portal',
          execute() {
            portal.c = [...endC];
            portal.v = [...endV];
            portal.n = [...endN];
            view.rebuildPortals();
            sim.edit(portal);
          },
          undo() {
            portal.c = [...startC];
            portal.v = [...startV];
            portal.n = [...startN];
            view.rebuildPortals();
            sim.edit(portal);
          },
        });
      }
      draggingPortal = null;
      dragStartPose = null;
    }
  }

  function dispose() {
    view.scene.remove(hoverHelper);
  }

  return {
    name: 'portal',
    get pending() { return pendingA; },
    resetPending,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    dispose,
  };
}
