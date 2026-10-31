// Limen entry: builds the scene document, the renderer, the physics bridge,
// camera controller, editor tools, user interface, and main render loop.

import * as THREE from 'three';
import {SHAPES, defaultScene, newId, randomBody, rng} from './core/scene.js';
import {teleportMaps} from './core/interp.js';
import {createRenderer} from './render/renderer.js';
import {createPhysicsBridge} from './physics/bridge.js';
import {createLoop} from './app/loop.js';
import {createCameraController} from './app/camera.js';
import {createEditor} from './editor/editor.js';
import {createUI} from './ui/ui.js';

const doc = defaultScene();
const canvas = document.querySelector('#view');
const view = createRenderer(canvas, doc);

let ui = null;
const setNotice = (text, ms = 3000) => {
  if (ui) ui.showNotice(text, ms);
};

const sim = createPhysicsBridge(doc, {
  autoplay: false, // Start in Edit mode (physics paused)
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

const cameraCtrl = createCameraController(view.camera, canvas, doc);
const editor = createEditor({
  doc, view, sim, cameraCtrl, setNotice,
});
ui = createUI({doc, view, sim, editor});

let simClock = 0;
let rec = null;

const loop = createLoop({
  sim,
  render(prev, curr, alpha) {
    const tNow = (sim.steps + alpha) * loop.dt;
    const dt = Math.max(0, Math.min(0.05, tNow - simClock || 1 / 60));
    simClock = tNow;
    cameraCtrl.update(dt);
    editor.tick(tNow);
    maps = teleportMaps(doc.portals);
    view.draw(prev, curr, alpha, maps);
  },
  onFrame(stats, steps, alpha) {
    if (rec) rec.log.push({t: performance.now(), alpha, steps, ms: stats.ms, views: view.stats.views});
  },
});

const readout = document.querySelector('#debug');
if (readout) {
  setInterval(() => {
    const s = loop.stats, gpu = view.gpuMs, vs = view.stats;
    const ts = doc.settings.timeScale ?? 1;
    const scaleLabel = ts === 1 ? '' : ` · ${ts}×`;
    readout.textContent = `${s.msAvg.toFixed(2)} ms (max ${s.msMax.toFixed(1)})` +
      (Number.isNaN(gpu) ? '' : ` · gpu ${gpu.toFixed(2)} ms`) +
      ` · views ${vs.views}/${vs.budget} d${vs.maxDepthReached}/${vs.maxDepth}` +
      ` · step ${sim.steps} · ${sim.count} bodies${scaleLabel}` +
      `${sim.playing ? ' · play' : ' · edit'}${sim.busy ? ' · simulation busy' : ''}` +
      `${view.lost ? ' · context lost' : ''}`;
  }, 250);
}

// Spawn helper preserved for testing
const spawnRng = rng(11);
const pick = () => { const x = spawnRng(); return SHAPES[x < 0.45 ? 0 : x < 0.75 ? 1 : x < 0.88 ? 2 : 3]; };
function spawn(arg) {
  if (arg && typeof arg === 'object') {
    const body = {
      id: newId(doc, 'b'), shape: 'box', size: [0.5, 0.5, 0.5], pos: [0, 2, 0], quat: [0, 0, 0, 1],
      vel: [0, 0, 0], angvel: [0, 0, 0], mass: 1, color: null, ...arg,
    };
    sim.spawn(body);
    doc.bodies.push(body);
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
    const b = {
      id: newId(doc, 'b'), shape: 'box', size: [0.5, 0.5, 0.5], pos: [0, 2, 0], quat: [0, 0, 0, 1],
      vel: [0, 0, 0], angvel: [0, 0, 0], mass: 1, color: null,
      ...rb,
    };
    sim.spawn(b);
    doc.bodies.push(b);
  }
  return n;
}

function reset(opts = {play: false}) {
  simClock = 0;
  editor.reset();
}

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.repeat || e.metaKey || e.ctrlKey) return;
  if (e.key === 'b' || e.key === 'B') spawn();
  if (e.key === 'r' || e.key === 'R') reset();
  if (e.key === 'n' || e.key === 'N') sim.injectNaN();
  if (e.key === 'p' || e.key === 'P') cameraCtrl.flyThrough();
  if (e.key === 't' || e.key === 'T') {
    const cur = doc.settings.timeScale ?? 1;
    const next = cur > 0.5 ? 0.25 : cur > 0.15 ? 0.1 : 1;
    editor.setTimeScale(next);
  }
});

document.addEventListener('visibilitychange', () => { if (!document.hidden) loop.resync(); });
view.onRestored = () => {
  view.bodies.setPortals(doc.portals);
  view.bodies.setBodies(sim.bodies);
};

loop.start();

window.limen = {
  THREE, doc, view, sim, loop, cameraCtrl, editor, ui,
  controls: cameraCtrl.controls,
  spawn, reset,
  flyThrough: (idx) => cameraCtrl.flyThrough(idx),
  play: () => editor.setMode('play'),
  pause: () => editor.setMode('edit'),
  step: (n = 1) => editor.step(n),
  remove: (id) => sim.remove(id),
  edit: (entity) => sim.edit(entity),
  setSettings: (s) => sim.setSettings(s),
  injectNaN: (id) => sim.injectNaN(id),
  recordAlpha(ms = 2000) {
    rec = {log: []};
    return new Promise((done) => setTimeout(() => { const log = rec.log; rec = null; done(log); }, ms));
  },
};
