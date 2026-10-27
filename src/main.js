// Limen entry: builds the default scene document, the renderer, the stub sim and the frame loop,
// and wires the orbit camera and a small debug readout.
// Debug keys: B spawns 2,000 stub bodies, R resets the sim. window.limen exposes the parts for checks.

import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {SHAPES, addBody, defaultScene, randomBody, rng} from './core/scene.js';
import {teleportMaps} from './core/interp.js';
import {createRenderer} from './render/renderer.js';
import {createStubSim} from './app/stubsim.js';
import {createLoop} from './app/loop.js';

const doc = defaultScene();
const canvas = document.querySelector('#view');
const view = createRenderer(canvas, doc);
const sim = createStubSim(doc);
const maps = teleportMaps(doc.portals);

const controls = new OrbitControls(view.camera, canvas);
controls.target.fromArray(doc.camera.target);
controls.enableDamping = true;
controls.minDistance = 1.5;
controls.maxDistance = 14;
controls.update();

// keep the camera inside the room's footprint (open above), so walls never block the view;
// prompt 05 replaces this with the real camera
const keepInside = () => view.camera.position.set(
  Math.max(-5.7, Math.min(5.7, view.camera.position.x)),
  Math.max(0.4, Math.min(14, view.camera.position.y)),
  Math.max(-5.7, Math.min(5.7, view.camera.position.z)));

// alpha recorder for the smoothness check: one entry per drawn frame
let rec = null;
const loop = createLoop({
  sim,
  render(prev, curr, alpha) {
    controls.update();
    keepInside();
    view.draw(prev, curr, alpha, maps);
  },
  onFrame(stats, steps, alpha) {
    if (rec) rec.log.push({t: performance.now(), alpha, steps, ms: stats.ms});
  },
});

const readout = document.querySelector('#debug');
setInterval(() => {
  const s = loop.stats, gpu = view.gpuMs;
  readout.textContent = `${s.msAvg.toFixed(2)} ms (max ${s.msMax.toFixed(1)})` +
    (Number.isNaN(gpu) ? '' : ` · gpu ${gpu.toFixed(2)} ms`) +
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
  loop.curr.fill(0); loop.prev.fill(0);
  sim.write(loop.curr); loop.prev.set(loop.curr);
}

addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey) return;
  if (e.key === 'b' || e.key === 'B') spawn();
  if (e.key === 'r' || e.key === 'R') reset();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) loop.resync(); });
view.onRestored = () => view.bodies.setBodies(doc.bodies);

loop.start();

window.limen = {
  doc, view, sim, loop, controls, spawn, reset,
  // log alpha and steps for every frame over `ms`, for the smoothness check
  recordAlpha(ms = 2000) {
    rec = {log: []};
    return new Promise((done) => setTimeout(() => { const log = rec.log; rec = null; done(log); }, ms));
  },
};
