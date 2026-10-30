// Limen entry: builds the default scene document, the renderer, the Rapier worker bridge and the
// frame loop, and wires the orbit camera and a small debug readout.
// Debug keys: Space play/pause, . single-step, T slow-mo (1x/0.25x/0.1x), B spawn, R reset, N NaN, P fly portal.

import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {apply, applyDir, madd, scale} from './core/vec.js';
import {crossing, frame, inside, local, portalMap} from './core/portal.js';
import {SHAPES, defaultScene, newId, randomBody, rng} from './core/scene.js';
import {teleportMaps} from './core/interp.js';
import {createRenderer} from './render/renderer.js';
import {createPhysicsBridge} from './physics/bridge.js';
import {createLoop} from './app/loop.js';

const doc = defaultScene();
const canvas = document.querySelector('#view');
const view = createRenderer(canvas, doc);
let notice = null;
const setNotice = (text, ms = 3000) => { notice = {text, until: performance.now() + ms}; };

const sim = createPhysicsBridge(doc, {
  autoplay: true,
  onBodiesChanged: (bodies) => view.bodies.setBodies(bodies),
  onEvent(ev) {
    if (ev.type === 'removed' && (ev.reason === 'nan' || ev.reason === 'bounds')) {
      setNotice(`removed ${ev.id} (${ev.reason})`);
    } else if (ev.type === 'refused') {
      setNotice(`spawn refused (${ev.reason})`);
    } else if (ev.type === 'busy') {
      setNotice('simulation busy', 5000);
    } else if (ev.type === 'portal_ejected') {
      setNotice(`pushed ${ev.id} clear of ${ev.portal}`);
    }
  },
});
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
  const ts = doc.settings.timeScale ?? 1;
  const scaleLabel = ts === 1 ? '' : ` · ${ts}×`;
  const note = notice && performance.now() < notice.until ? ` · ${notice.text}` : '';
  readout.textContent = `${s.msAvg.toFixed(2)} ms (max ${s.msMax.toFixed(1)})` +
    (Number.isNaN(gpu) ? '' : ` · gpu ${gpu.toFixed(2)} ms`) +
    ` · views ${vs.views}/${vs.budget} d${vs.maxDepthReached}/${vs.maxDepth}` +
    ` · step ${sim.steps} · ${sim.count} bodies${scaleLabel}` +
    `${sim.playing ? '' : ' · paused'}${sim.busy ? ' · simulation busy' : ''}${note}` +
    `${view.lost ? ' · context lost' : ''}`;
}, 250);

// spawned shapes are weighted, mostly boxes and balls
const spawnRng = rng(11);
const pick = () => { const x = spawnRng(); return SHAPES[x < 0.45 ? 0 : x < 0.75 ? 1 : x < 0.88 ? 2 : 3]; };
function spawn(arg) {
  if (arg && typeof arg === 'object') {
    const body = {
      id: newId(doc, 'b'), shape: 'box', size: [0.5, 0.5, 0.5], pos: [0, 2, 0], quat: [0, 0, 0, 1],
      vel: [0, 0, 0], angvel: [0, 0, 0], mass: 1, color: null, ...arg,
    };
    sim.spawn(body);
    return body;
  }
  const n = typeof arg === 'number' ? arg : Math.max(1, 300 - sim.count);
  const cols = 7, stepXZ = 1.35, stepY = 1.35;
  for (let i = 0; i < n; i++) {
    const rb = randomBody(spawnRng, pick());
    if (n > 10) {
      const gx = i % cols;
      const gz = Math.floor(i / cols) % cols;
      const gy = Math.floor(i / (cols * cols));
      rb.pos = [
        (gx - (cols - 1) / 2) * stepXZ + (spawnRng() - 0.5) * 0.25,
        5.8 + gy * stepY + spawnRng() * 0.2,
        (gz - (cols - 1) / 2) * stepXZ + (spawnRng() - 0.5) * 0.25,
      ];
    }
    sim.spawn({
      id: newId(doc, 'b'), shape: 'box', size: [0.5, 0.5, 0.5], pos: [0, 2, 0], quat: [0, 0, 0, 1],
      vel: [0, 0, 0], angvel: [0, 0, 0], mass: 1, color: null,
      ...rb,
    });
  }
  return n;
}

function reset(opts = {play: false}) {
  simClock = 0;
  maps = teleportMaps(doc.portals);
  framedPortals = doc.portals.map(frame);
  view.rebuildPortals();
  sim.reset(opts);
}

addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey) return;
  if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); sim.playing ? sim.pause() : sim.play(); }
  if (e.key === '.') { if (!sim.playing) sim.step(1); }
  if (e.key === 'b' || e.key === 'B') spawn();
  if (e.key === 'r' || e.key === 'R') reset();
  if (e.key === 'n' || e.key === 'N') sim.injectNaN();
  if (e.key === 'p' || e.key === 'P') flyThrough();
  if (e.key === 't' || e.key === 'T') {
    const cur = doc.settings.timeScale ?? 1;
    const next = cur > 0.5 ? 0.25 : cur > 0.15 ? 0.1 : 1;
    sim.setSettings({timeScale: next});
  }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) loop.resync(); });
view.onRestored = () => {
  view.bodies.setPortals(doc.portals);
  view.bodies.setBodies(sim.bodies);
};

loop.start();

window.limen = {
  doc, view, sim, loop, controls, spawn, reset, flyThrough,
  play: () => sim.play(),
  pause: () => sim.pause(),
  step: (n = 1) => sim.step(n),
  remove: (id) => sim.remove(id),
  edit: (entity) => sim.edit(entity),
  setSettings: (s) => sim.setSettings(s),
  injectNaN: (id) => sim.injectNaN(id),
  // log alpha and steps for every frame over `ms`, for the smoothness check
  recordAlpha(ms = 2000) {
    rec = {log: []};
    return new Promise((done) => setTimeout(() => { const log = rec.log; rec = null; done(log); }, ms));
  },
};
