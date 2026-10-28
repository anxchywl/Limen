// Limen entry: builds the default scene document, the renderer, the stub sim and the frame loop,
// and wires the orbit camera and a small debug readout.
// Debug keys: B spawns 2,000 stub bodies, R resets the sim, P flies straight through the next portal.

import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {apply, applyDir, madd, scale} from './core/vec.js';
import {crossing, frame, inside, local, portalMap} from './core/portal.js';
import {SHAPES, addBody, defaultScene, randomBody, rng} from './core/scene.js';
import {teleportMaps} from './core/interp.js';
import {createRenderer} from './render/renderer.js';
import {createStubSim} from './app/stubsim.js';
import {createLoop} from './app/loop.js';

const doc = defaultScene();
const canvas = document.querySelector('#view');
const view = createRenderer(canvas, doc);
const sim = createStubSim(doc);
let maps = teleportMaps(doc.portals);
let framedPortals = doc.portals.map(frame);

const controls = new OrbitControls(view.camera, canvas);
controls.target.fromArray(doc.camera.target);
controls.enableDamping = true;
controls.minDistance = 0.5;
controls.maxDistance = 14;
controls.update();

// keep the orbit camera inside the room's footprint except where a portal opening lets it reach the wall;
// prompt 05 replaces this with the real portal-aware fly/orbit camera
function keepInside() {
  const p = [view.camera.position.x, view.camera.position.y, view.camera.position.z];
  for (const P of framedPortals) {
    const l = local(P, p);
    if (l[2] > -0.2 && l[2] < 0.6 && inside(P, l, -0.08)) return;
  }
  view.camera.position.set(
    Math.max(-5.7, Math.min(5.7, p[0])),
    Math.max(0.35, Math.min(14, p[1])),
    Math.max(-5.7, Math.min(5.7, p[2])));
}

let lastCam = view.camera.position.toArray();
let fly = null, nextPortal = 0;

function flyThrough(idx = (nextPortal++) % Math.max(1, doc.portals.length)) {
  const p = doc.portals[idx];
  const qIdx = doc.portals.findIndex((x) => x.id === p?.pair);
  if (!p || qIdx < 0) return Promise.resolve();
  const P = frame(p), Q = frame(doc.portals[qIdx]);
  const M = portalMap(P, Q);
  controls.enabled = false;
  return new Promise((done) => {
    fly = {idx, P, Q, M, t: 0, duration: 1.5, dist: 2.4, done};
  });
}

function stepCamera(dt) {
  if (fly) {
    fly.t = Math.min(fly.duration, fly.t + dt);
    const s = fly.dist * (1 - (2 * fly.t) / fly.duration); // +2.4 m -> -2.4 m across the opening
    const rawPos = madd(fly.P.c, fly.P.n, s);
    const rawFwd = scale(fly.P.n, -1);
    const rawUp = fly.P.v;
    const pos = s > 0 ? rawPos : apply(fly.M, rawPos);
    const fwd = s > 0 ? rawFwd : applyDir(fly.M, rawFwd);
    const up = s > 0 ? rawUp : applyDir(fly.M, rawUp);
    view.camera.up.fromArray(up);
    view.camera.position.fromArray(pos);
    view.camera.lookAt(pos[0] + fwd[0], pos[1] + fwd[1], pos[2] + fwd[2]);
    lastCam = pos;
    if (fly.t >= fly.duration) {
      const done = fly.done;
      fly = null;
      view.camera.up.set(0, 1, 0);
      // avoid exact vertical look vector so OrbitControls resumes cleanly after emerging from a floor portal
      const tx = Math.abs(fwd[1]) > 0.95 ? 0.35 : fwd[0] * 2;
      const tz = Math.abs(fwd[1]) > 0.95 ? 0.35 : fwd[2] * 2;
      controls.target.set(pos[0] + tx, Math.max(0.4, pos[1] + fwd[1] * 2), pos[2] + tz);
      controls.enabled = true;
      controls.update();
      done?.();
    }
    return;
  }
  controls.update();
  keepInside();
  const cur = view.camera.position.toArray();
  for (let i = 0; i < framedPortals.length; i++) {
    const P = framedPortals[i];
    if (crossing(P, P, lastCam, cur) !== null && maps[i]) {
      const nextPos = apply(maps[i], cur);
      const nextTarget = apply(maps[i], controls.target.toArray());
      view.camera.position.fromArray(nextPos);
      controls.target.fromArray(nextTarget);
      controls.update();
      lastCam = view.camera.position.toArray();
      return;
    }
  }
  lastCam = cur;
}

// alpha recorder for the smoothness check: one entry per drawn frame
let rec = null, simClock = 0;
const loop = createLoop({
  sim,
  render(prev, curr, alpha) {
    const tNow = (sim.steps + alpha) * loop.dt;
    const dt = Math.max(0, Math.min(0.05, tNow - simClock || 1 / 60));
    simClock = tNow;
    stepCamera(dt);
    view.draw(prev, curr, alpha, maps);
  },
  onFrame(stats, steps, alpha) {
    if (rec) rec.log.push({t: performance.now(), alpha, steps, ms: stats.ms, views: view.stats.views});
  },
});

const readout = document.querySelector('#debug');
setInterval(() => {
  const s = loop.stats, gpu = view.gpuMs, vs = view.stats;
  readout.textContent = `${s.msAvg.toFixed(2)} ms (max ${s.msMax.toFixed(1)})` +
    (Number.isNaN(gpu) ? '' : ` · gpu ${gpu.toFixed(2)} ms`) +
    ` · views ${vs.views}/${vs.budget} d${vs.maxDepthReached}/${vs.maxDepth}` +
    ` · step ${sim.steps} · ${sim.slots} bodies${view.lost ? ' · context lost' : ''}`;
}, 250);

// spawned shapes are weighted, mostly boxes and balls
const spawnRng = rng(11);
const pick = () => { const x = spawnRng(); return SHAPES[x < 0.45 ? 0 : x < 0.75 ? 1 : x < 0.88 ? 2 : 3]; };
function spawn(n = 2000) {
  for (let i = 0; i < n; i++) sim.add(addBody(doc, randomBody(spawnRng, pick())));
  view.bodies.setBodies(doc.bodies);
}

function reset() {
  sim.reset();
  simClock = 0;
  maps = teleportMaps(doc.portals);
  framedPortals = doc.portals.map(frame);
  view.rebuildPortals();
  loop.curr.fill(0); loop.prev.fill(0);
  sim.write(loop.curr); loop.prev.set(loop.curr);
}

addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey) return;
  if (e.key === 'b' || e.key === 'B') spawn();
  if (e.key === 'r' || e.key === 'R') reset();
  if (e.key === 'p' || e.key === 'P') flyThrough();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) loop.resync(); });
view.onRestored = () => {
  view.bodies.setPortals(doc.portals);
  view.bodies.setBodies(doc.bodies);
};

loop.start();

window.limen = {
  doc, view, sim, loop, controls, spawn, reset, flyThrough,
  // log alpha and steps for every frame over `ms`, for the smoothness check
  recordAlpha(ms = 2000) {
    rec = {log: []};
    return new Promise((done) => setTimeout(() => { const log = rec.log; rec = null; done(log); }, ms));
  },
};
