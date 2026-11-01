// Portal frames, openings, breadth-first view budgeting and stencil-buffer helpers.
// Each portal has a coloured ellipse rim with constant-pixel ink borders, a flat ellipse opening
// for stencil marking and depth restore, and a shallow inward-facing pocket behind the opening used
// when the main camera comes within `near * 3` so crossing never flashes the host wall.

import * as THREE from 'three';
import {dot, sub} from '../core/vec.js';
import {frame, inside, local, portalMap} from '../core/portal.js';
import {getLimits} from '../core/limits.js';
import {PAPER, PORTAL_COLOURS} from './palette.js';
import {inkMaterial} from './ink.js';
import {applyObliqueNearPlane} from './oblique.js';

const SEG = 64;
const RING_N = 16;
const RIM_W = 0.06;
const RIM_Z = 0.0018;
const POCKET_Z = 0.2;
const FAR_EDGE = 1e3;
const PASS_TINT = 0.1;
const PASS_FADE = 0.94;

export function defaultViewBudget() {
  const lim = getLimits();
  return {
    maxDepth: lim.maxDepth,
    maxViews: lim.maxViews,
    minArea: 0.002,
  };
}

const worldPt = (P, x, y, z = 0) => [
  P.c[0] + P.u[0] * x + P.v[0] * y + P.n[0] * z,
  P.c[1] + P.u[1] * x + P.v[1] * y + P.n[1] * z,
  P.c[2] + P.u[2] * x + P.v[2] * y + P.n[2] * z,
];

function rimGeometry(P, hexColor) {
  const pos = [], nrm = [], col = [], edge = [];
  const c = new THREE.Color(hexColor);
  for (let i = 0; i < SEG; i++) {
    const t0 = (i / SEG) * Math.PI * 2, t1 = ((i + 1) / SEG) * Math.PI * 2;
    const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
    const i0 = worldPt(P, P.a * c0, P.b * s0, RIM_Z);
    const i1 = worldPt(P, P.a * c1, P.b * s1, RIM_Z);
    const o0 = worldPt(P, (P.a + RIM_W) * c0, (P.b + RIM_W) * s0, RIM_Z);
    const o1 = worldPt(P, (P.a + RIM_W) * c1, (P.b + RIM_W) * s1, RIM_Z);
    const ei = [0, RIM_W, FAR_EDGE, FAR_EDGE], eo = [RIM_W, 0, FAR_EDGE, FAR_EDGE];
    for (const [p, e] of [[i0, ei], [o0, eo], [o1, eo], [i0, ei], [o1, eo], [i1, ei]]) {
      pos.push(...p); nrm.push(...P.n); col.push(c.r, c.g, c.b); edge.push(...e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 4));
  return g;
}

function openingGeometry(P) {
  const pos = [];
  for (let i = 0; i < SEG; i++) {
    const t0 = (i / SEG) * Math.PI * 2, t1 = ((i + 1) / SEG) * Math.PI * 2;
    const p0 = worldPt(P, P.a * Math.cos(t0), P.b * Math.sin(t0), 0);
    const p1 = worldPt(P, P.a * Math.cos(t1), P.b * Math.sin(t1), 0);
    pos.push(...P.c, ...p0, ...p1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// shallow inward-facing pocket behind the opening, so near-plane slicing never exposes the wall
function pocketGeometry(P) {
  const pos = [];
  const back = worldPt(P, 0, 0, -POCKET_Z);
  for (let i = 0; i < SEG; i++) {
    const t0 = (i / SEG) * Math.PI * 2, t1 = ((i + 1) / SEG) * Math.PI * 2;
    const x0 = P.a * Math.cos(t0), y0 = P.b * Math.sin(t0);
    const x1 = P.a * Math.cos(t1), y1 = P.b * Math.sin(t1);
    const f0 = worldPt(P, x0, y0, 0), f1 = worldPt(P, x1, y1, 0);
    const b0 = worldPt(P, x0, y0, -POCKET_Z), b1 = worldPt(P, x1, y1, -POCKET_Z);
    pos.push(...back, ...b0, ...b1);
    pos.push(...f0, ...f1, ...b1, ...f0, ...b1, ...b0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// Sutherland-Hodgman polygon clip against n.x * x + n.y * y + n.z * z + w >= 0
function clipPolyPlane(src, count, nx, ny, nz, w, dst) {
  if (count === 0) return 0;
  let out = 0;
  let px = src[(count - 1) * 3], py = src[(count - 1) * 3 + 1], pz = src[(count - 1) * 3 + 2];
  let pd = nx * px + ny * py + nz * pz + w;
  for (let i = 0; i < count; i++) {
    const cx = src[i * 3], cy = src[i * 3 + 1], cz = src[i * 3 + 2];
    const cd = nx * cx + ny * cy + nz * cz + w;
    if ((pd >= 0) !== (cd >= 0)) {
      const t = pd / (pd - cd);
      dst[out * 3] = px + (cx - px) * t;
      dst[out * 3 + 1] = py + (cy - py) * t;
      dst[out * 3 + 2] = pz + (cz - pz) * t;
      out++;
    }
    if (cd >= 0) {
      dst[out * 3] = cx; dst[out * 3 + 1] = cy; dst[out * 3 + 2] = cz;
      out++;
    }
    px = cx; py = cy; pz = cz; pd = cd;
  }
  return out;
}

const bufA = new Float64Array(64 * 3);
const bufB = new Float64Array(64 * 3);

// screen-space scissor {x, y, w, h} in CSS pixels (bottom-up), intersected with parentRect, or null
function projectScissor(ring, cam, exitPortal, parentRect, cssW, cssH, thickened) {
  if (thickened) return {...parentRect};
  let n = RING_N;
  bufA.set(ring);
  let cur = bufA, nxt = bufB;
  if (exitPortal) {
    const en = exitPortal.n, ew = -dot(en, exitPortal.c) - 1e-4;
    n = clipPolyPlane(cur, n, en[0], en[1], en[2], ew, nxt);
    if (n === 0) return null;
    [cur, nxt] = [nxt, cur];
  }
  const m = cam.matrixWorldInverse.elements;
  for (let i = 0; i < n; i++) {
    const x = cur[i * 3], y = cur[i * 3 + 1], z = cur[i * 3 + 2];
    nxt[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    nxt[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    nxt[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  [cur, nxt] = [nxt, cur];
  // camera looks along -z: keep vertices strictly in front of the eye (z <= -1e-3 <=> -z - 1e-3 >= 0)
  n = clipPolyPlane(cur, n, 0, 0, -1, -1e-3, nxt);
  if (n === 0) return null;
  cur = nxt;

  const p = cam.projectionMatrix.elements;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = cur[i * 3], y = cur[i * 3 + 1], z = cur[i * 3 + 2];
    const w = p[3] * x + p[7] * y + p[11] * z + p[15];
    if (w <= 1e-6) continue;
    const nx = (p[0] * x + p[4] * y + p[8] * z + p[12]) / w;
    const ny = (p[1] * x + p[5] * y + p[9] * z + p[13]) / w;
    if (nx < minX) minX = nx;
    if (nx > maxX) maxX = nx;
    if (ny < minY) minY = ny;
    if (ny > maxY) maxY = ny;
  }
  if (!(minX <= maxX && minY <= maxY)) return null;
  const x0 = Math.max(parentRect.x, Math.floor((minX * 0.5 + 0.5) * cssW) - 2);
  const y0 = Math.max(parentRect.y, Math.floor((minY * 0.5 + 0.5) * cssH) - 2);
  const x1 = Math.min(parentRect.x + parentRect.w, Math.ceil((maxX * 0.5 + 0.5) * cssW) + 2);
  const y1 = Math.min(parentRect.y + parentRect.h, Math.ceil((maxY * 0.5 + 0.5) * cssH) + 2);
  if (x1 <= x0 || y1 <= y0) return null;
  return {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
}

export function createPortals(doc) {
  const group = new THREE.Group();
  group.name = 'portals';
  const rimMaterial = inkMaterial({mode: 'faces', vertexColors: true, ink: PAPER.ink, width: 0.65});

  const markMat = new THREE.MeshBasicMaterial({
    colorWrite: false, depthTest: true, depthWrite: false, depthFunc: THREE.LessEqualDepth,
    stencilWrite: true, stencilFunc: THREE.EqualStencilFunc,
    stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.IncrementStencilOp,
  });
  const restoreMat = new THREE.MeshBasicMaterial({
    colorWrite: false, depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth,
    stencilWrite: true, stencilFunc: THREE.EqualStencilFunc,
    stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.DecrementStencilOp,
  });
  const termMat = new THREE.MeshBasicMaterial({
    depthTest: true, depthWrite: true, depthFunc: THREE.LessEqualDepth,
    stencilWrite: true, stencilFunc: THREE.EqualStencilFunc,
    stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp,
  });
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {uColor: {value: new THREE.Color(PAPER.background)}},
    vertexShader: /* glsl */`
      void main() {
        gl_Position = vec4(position.xy, 1.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      void main() {
        gl_FragColor = vec4(uColor, 1.0);
        #include <colorspace_fragment>
      }
    `,
    depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth,
    stencilWrite: true, stencilFunc: THREE.EqualStencilFunc,
    stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp,
    side: THREE.DoubleSide,
  });

  const quadGeo = new THREE.BufferGeometry();
  quadGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const auxScene = new THREE.Scene();
  auxScene.matrixWorldAutoUpdate = false;
  const auxMesh = new THREE.Mesh(quadGeo, skyMat);
  auxMesh.frustumCulled = false;
  auxMesh.matrixAutoUpdate = false;
  auxScene.add(auxMesh);

  let entries = [];
  const rims = [];

  function clearEntries() {
    for (const e of entries) {
      group.remove(e.rimMesh);
      e.rimMesh.geometry.dispose();
      e.openGeo.dispose();
      e.pocketGeo.dispose();
    }
    entries = [];
    rims.length = 0;
  }

  function rebuild(portals = doc.portals) {
    clearEntries();
    const idxById = new Map(portals.map((p, i) => [p.id, i]));
    entries = portals.map((p, i) => {
      const P = frame(p);
      const colorHex = p.color ?? PORTAL_COLOURS[Math.floor(i / 2) % PORTAL_COLOURS.length];
      const rimMesh = new THREE.Mesh(rimGeometry(P, colorHex), rimMaterial);
      rimMesh.frustumCulled = false;
      rimMesh.receiveShadow = true;
      rimMesh.name = `rim-${p.id}`;
      group.add(rimMesh);
      rims.push(rimMesh);
      const ring = new Float64Array(RING_N * 3);
      for (let k = 0; k < RING_N; k++) {
        const th = (k / RING_N) * Math.PI * 2;
        const pt = worldPt(P, P.a * Math.cos(th), P.b * Math.sin(th), 0);
        ring[k * 3] = pt[0]; ring[k * 3 + 1] = pt[1]; ring[k * 3 + 2] = pt[2];
      }
      return {
        index: i, id: p.id, pairIndex: idxById.get(p.pair) ?? -1, P,
        color: new THREE.Color(colorHex),
        rimMesh, openGeo: openingGeometry(P), pocketGeo: pocketGeometry(P), ring,
        mapMat: new THREE.Matrix4(),
      };
    });
    for (const e of entries) {
      const q = entries[e.pairIndex];
      if (!q) continue;
      const M = portalMap(e.P, q.P);
      e.mapMat.set(
        M.R[0][0], M.R[1][0], M.R[2][0], M.t[0],
        M.R[0][1], M.R[1][1], M.R[2][1], M.t[1],
        M.R[0][2], M.R[1][2], M.R[2][2], M.t[2],
        0, 0, 0, 1,
      );
    }
  }
  rebuild(doc.portals);

  const camPool = [];
  const nodePool = [];
  const termPool = [];
  const queue = [];
  const camPos = [0, 0, 0];
  const white = new THREE.Color(1, 1, 1);
  const bgBase = new THREE.Color(PAPER.background);
  const deepMix = new THREE.Color(PAPER.deep);
  const stepTint = new THREE.Color();
  const root = {
    depth: 0, entryIdx: -1, exitIdx: -1, camera: null,
    scissor: {x: 0, y: 0, w: 0, h: 0}, thickened: false,
    tint: new THREE.Color(1, 1, 1), children: [], terminals: [],
  };
  const planStats = {views: 0, maxDepthReached: 0, budget: 0, maxDepth: 0, terminals: 0};
  const planOut = {root, stats: planStats};

  function virtualCamera(i, mainCam) {
    while (camPool.length <= i) {
      const c = new THREE.PerspectiveCamera();
      c.matrixAutoUpdate = false;
      c.matrixWorldAutoUpdate = false;
      camPool.push(c);
    }
    const c = camPool[i];
    c.fov = mainCam.fov; c.aspect = mainCam.aspect; c.near = mainCam.near; c.far = mainCam.far;
    return c;
  }

  function allocNode(i) {
    while (nodePool.length <= i) {
      nodePool.push({
        depth: 0, entryIdx: -1, exitIdx: -1, camera: null,
        scissor: {x: 0, y: 0, w: 0, h: 0}, thickened: false,
        tint: new THREE.Color(), children: [], terminals: [],
      });
    }
    const n = nodePool[i];
    n.children.length = 0;
    n.terminals.length = 0;
    return n;
  }

  function allocTerm(i) {
    while (termPool.length <= i) {
      termPool.push({portalIdx: 0, thickened: false, scissor: null, color: new THREE.Color()});
    }
    return termPool[i];
  }

  // breadth-first plan of portal views within maxDepth, maxViews and minArea (allocation-free in steady state)
  function plan(mainCam, cssW, cssH, budget) {
    const screenArea = Math.max(1, cssW * cssH);
    root.camera = mainCam;
    root.scissor.x = 0; root.scissor.y = 0; root.scissor.w = cssW; root.scissor.h = cssH;
    root.tint.setRGB(1, 1, 1);
    root.children.length = 0;
    root.terminals.length = 0;
    queue.length = 0;
    queue.push(root);
    let views = 0, maxDepthReached = 0, terminals = 0;

    for (let qi = 0; qi < queue.length; qi++) {
      const node = queue[qi];
      const me = node.camera.matrixWorld.elements;
      camPos[0] = me[12]; camPos[1] = me[13]; camPos[2] = me[14];
      const exitP = node.exitIdx >= 0 ? entries[node.exitIdx]?.P : null;

      for (let i = 0; i < entries.length; i++) {
        if (i === node.exitIdx) continue;
        const e = entries[i];
        const q = entries[e.pairIndex];
        if (!q) continue;

        const dist = dot(sub(camPos, e.P.c), e.P.n);
        let thickened = false;
        if (node.depth === 0 && dist > -0.02 && dist < mainCam.near * 3) {
          const lp = local(e.P, camPos);
          thickened = inside(e.P, lp, mainCam.near * 3);
        }
        if (!thickened && dist <= 1e-4) continue;

        const rect = projectScissor(e.ring, node.camera, exitP, node.scissor, cssW, cssH, thickened);
        if (!rect) continue;

        const areaFrac = (rect.w * rect.h) / screenArea;
        const nextDepth = node.depth + 1;
        const canRecurse = (thickened || areaFrac >= budget.minArea) &&
          nextDepth <= budget.maxDepth && views < budget.maxViews;

        if (!canRecurse) {
          // terminal fill: darkened pair colour (never black, never bare wall)
          const fade = Math.max(0.28, Math.pow(0.84, nextDepth));
          const t = allocTerm(terminals++);
          t.portalIdx = i;
          t.thickened = thickened;
          t.scissor = rect;
          t.color.copy(e.color).lerp(deepMix, 0.14).multiplyScalar(fade).multiply(node.tint);
          node.terminals.push(t);
          continue;
        }

        const vcam = virtualCamera(views, mainCam);
        vcam.matrixWorld.multiplyMatrices(e.mapMat, node.camera.matrixWorld);
        vcam.matrixWorld.decompose(vcam.position, vcam.quaternion, vcam.scale);
        vcam.matrixWorldInverse.copy(vcam.matrixWorld).invert();
        vcam.projectionMatrix.copy(mainCam.projectionMatrix);
        applyObliqueNearPlane(vcam, q.P.c, q.P.n);

        stepTint.copy(white).lerp(e.color, PASS_TINT).multiplyScalar(PASS_FADE);
        const child = allocNode(views);
        child.depth = nextDepth;
        child.entryIdx = i;
        child.exitIdx = e.pairIndex;
        child.camera = vcam;
        child.scissor = rect;
        child.thickened = thickened;
        child.tint.copy(node.tint).multiply(stepTint);
        node.children.push(child);
        queue.push(child);
        views++;
        if (nextDepth > maxDepthReached) maxDepthReached = nextDepth;
      }
    }
    Object.assign(planStats, {views, maxDepthReached, budget: budget.maxViews, maxDepth: budget.maxDepth, terminals});
    return planOut;
  }

  function drawAux(renderer, cam, geo, mat) {
    auxMesh.geometry = geo;
    auxMesh.material = mat;
    renderer.render(auxScene, cam);
  }

  function markStencil(renderer, cam, portalIdx, level, thickened) {
    const e = entries[portalIdx];
    markMat.stencilRef = level;
    drawAux(renderer, cam, e.openGeo, markMat);
    if (thickened) drawAux(renderer, cam, e.pocketGeo, markMat);
  }

  function clearDepthAndSky(renderer, cam, level, passTint) {
    skyMat.stencilRef = level;
    skyMat.uniforms.uColor.value.copy(bgBase).multiply(passTint);
    drawAux(renderer, cam, quadGeo, skyMat);
  }

  function restoreDepthAndStencil(renderer, cam, portalIdx, level, thickened) {
    const e = entries[portalIdx];
    restoreMat.stencilRef = level;
    drawAux(renderer, cam, e.openGeo, restoreMat);
    if (thickened) drawAux(renderer, cam, e.pocketGeo, restoreMat);
  }

  function fillTerminal(renderer, cam, portalIdx, level, color, thickened = false) {
    const e = entries[portalIdx];
    termMat.stencilRef = level;
    termMat.color.copy(color);
    drawAux(renderer, cam, e.openGeo, termMat);
    if (thickened) drawAux(renderer, cam, e.pocketGeo, termMat);
  }

  function dispose() {
    clearEntries();
    quadGeo.dispose();
    rimMaterial.dispose();
    markMat.dispose();
    restoreMat.dispose();
    termMat.dispose();
    skyMat.dispose();
  }

  return {
    group, rims, rimMaterial,
    get entries() { return entries; },
    rebuild, plan, markStencil, clearDepthAndSky, restoreDepthAndStencil, fillTerminal, dispose,
  };
}
