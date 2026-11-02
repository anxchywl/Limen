// Limen entry: builds the scene document, the renderer, the physics bridge,
// camera controller, editor tools, user interface, autosave, and main render loop.
// Startup order: location.hash (#s=...) > localStorage autosave > defaultScene().

import * as THREE from 'three';
import {SHAPES, defaultScene, createScene, addBlock, newId, randomBody, rng} from './core/scene.js';
import {teleportMaps} from './core/interp.js';
import {createRenderer} from './render/renderer.js';
import {createPhysicsBridge} from './physics/bridge.js';
import {createLoop} from './app/loop.js';
import {createCameraController} from './app/camera.js';
import {createEditor} from './editor/editor.js';
import {createUI} from './ui/ui.js';
import {createAutosave} from './io/autosave.js';
import {decodeShare} from './io/share.js';
import {createStatsCollector, percentile} from './perf/stats.js';
import {createQualityController} from './perf/quality.js';
import {getLimits, canAddBody} from './core/limits.js';

const doc = defaultScene();
const canvas = document.querySelector('#view');
const view = createRenderer(canvas, doc);
const stats = createStatsCollector(2000);
const quality = createQualityController(view, {mode: doc.settings.quality ?? 'auto'});

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
      ui?.setBusy?.(true);
      setNotice('simulation busy — overload detected', 4000);
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

const autosave = createAutosave(() => doc);

function loadScene(newDoc, title) {
  if (!newDoc) return;
  doc.version = newDoc.version ?? 1;
  doc.settings = {...(newDoc.settings ?? {})};
  doc.camera = {...(newDoc.camera ?? {})};
  doc.blocks = [...(newDoc.blocks ?? [])];
  doc.portals = [...(newDoc.portals ?? [])];
  doc.bodies = [...(newDoc.bodies ?? [])];
  doc.emitters = [...(newDoc.emitters ?? [])];
  doc.nextId = newDoc.nextId ?? 100;

  sim.load(doc, false);
  view.level.rebuild(doc.blocks);
  view.rebuildPortals();
  editor.emitterTool.syncMarkers();
  editor.history.clear();
  maps = teleportMaps(doc.portals);
  cameraCtrl.syncPortals();

  if (doc.camera.pos && doc.camera.target) {
    view.camera.position.fromArray(doc.camera.pos);
    cameraCtrl.controls.target.fromArray(doc.camera.target);
    cameraCtrl.controls.update();
  }

  editor.setMode('edit');
  ui?.update();
  autosave.trigger();
  if (title) setNotice(`Loaded ${title}`);
}

function newScene(force = false) {
  if (force || confirm('Discard current scene and start a new empty room?')) {
    const s = createScene();
    const W = 6, T = 0.5, H = 6;
    addBlock(s, {min: [-W - T, -T, -W - T], max: [W + T, 0, W + T]});
    addBlock(s, {min: [-W - T, 0, -W - T], max: [-W, H, W + T]});
    addBlock(s, {min: [W, 0, -W - T], max: [W + T, H, W + T]});
    addBlock(s, {min: [-W, 0, -W - T], max: [W, H, -W]});
    addBlock(s, {min: [-W, 0, W], max: [W, H, W + T]});
    loadScene(s, 'empty room');
    if (window.history?.replaceState) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }
}

ui = createUI({
  doc, view, sim, editor, quality, stats, cameraCtrl,
  onRunChaos: () => runChaosTest(20),
  onLoadScene: loadScene,
  onNewScene: newScene,
});

// Trigger autosave whenever document is edited
editor.onChange(() => autosave.trigger());
editor.history.onChange(() => autosave.trigger());

let simClock = 0;
let rec = null;
let lastUiMs = 0;

const loop = createLoop({
  sim,
  render(prev, curr, alpha) {
    const tNow = (sim.steps + alpha) * loop.dt;
    const dt = Math.max(0, Math.min(0.05, tNow - simClock || 1 / 60));
    simClock = tNow;
    const tUi0 = performance.now();
    cameraCtrl.update(dt);
    editor.tick(tNow);
    lastUiMs = performance.now() - tUi0;
    maps = teleportMaps(doc.portals);
    view.draw(prev, curr, alpha, maps);
  },
  onFrame(loopStats, steps, alpha) {
    stats.push({
      cpu: loopStats.ms,
      gpu: view.gpuMs,
      interp: view.phaseTimers?.interpMs || 0,
      upload: view.phaseTimers?.uploadMs || 0,
      passes: view.phaseTimers?.passesMs || 0,
      ui: lastUiMs,
      workerStep: sim.workerStepMs,
      workerTransit: sim.workerTransitMs,
      views: view.stats.views,
      depth: view.stats.maxDepthReached,
      bodies: sim.count,
      inTransit: sim.inTransitCount,
    });
    quality.tick(loopStats.ms);
    if (rec) rec.log.push({t: performance.now(), alpha, steps, ms: loopStats.ms, views: view.stats.views});
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

async function runChaosTest(durationSec = 20) {
  setNotice(`Starting ${durationSec}s Chaos Test...`, 3000);
  editor.setMode('play');
  const tStart = performance.now();
  const interval = setInterval(() => {
    const elapsed = (performance.now() - tStart) / 1000;
    if (elapsed >= durationSec) {
      clearInterval(interval);
      setNotice('Chaos test complete — survived without stuck state!', 4000);
      return;
    }

    const phase = Math.floor(elapsed * 2) % 5;
    if (phase === 0) {
      // 1. Spawns up to cap
      const maxB = getLimits().maxBodies;
      if (sim.count < maxB) spawn(Math.min(8, maxB - sim.count));
    } else if (phase === 1) {
      // 2. Move portals directly onto bodies
      if (doc.portals.length >= 2) {
        const p = doc.portals[0];
        p.c[0] += (Math.random() - 0.5) * 0.3;
        p.c[1] = Math.max(0.5, p.c[1] + (Math.random() - 0.5) * 0.3);
        view.rebuildPortals();
        sim.setPortals(doc.portals);
      }
    } else if (phase === 2) {
      // 3. Inject NaN
      sim.injectNaN();
    } else if (phase === 3 && elapsed > 6 && elapsed < 9) {
      // 4. Forced WebGL context loss
      const gl = view.renderer.getContext();
      const loseExt = gl?.getExtension('WEBGL_lose_context');
      if (loseExt && !view.lost) {
        loseExt.loseContext();
        setTimeout(() => loseExt.restoreContext(), 1000);
      }
    } else if (phase === 4) {
      // 5. Hidden tab simulation
      document.dispatchEvent(new Event('visibilitychange'));
      loop.resync();
    }
  }, 400);
}

async function runStressTest(name, durationSec = 60) {
  setNotice(`Loading stress scene [${name}]...`, 3000);
  try {
    const res = await fetch(`/tests/stress/${name}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const sceneDoc = await res.json();
    loadScene(sceneDoc, `stress: ${name}`);

    if (name === 'phone') {
      quality.setMode('auto');
    }

    editor.setMode('play');

    let churnInterval = 0;
    if (name === 'churn') {
      churnInterval = setInterval(() => {
        if (doc.portals.length >= 2) {
          const p = doc.portals[0];
          p.c[1] = 0.5 + Math.random() * 2.0;
          view.rebuildPortals();
          if (typeof sim.setPortals === 'function') sim.setPortals(doc.portals);
          else if (typeof sim.load === 'function') sim.load(doc);
        }
      }, 500);
    }

    const frameSamples = [];
    const stepSamples = [];
    let viewsSum = 0;
    let framesCount = 0;
    const events = [];

    const onFrameHook = () => {
      if (sim.workerStepMs > 0) stepSamples.push(sim.workerStepMs);
    };
    const unsubSim = sim.onFrame ? sim.onFrame(onFrameHook) : null;

    const startT = performance.now();
    const frameTimer = setInterval(() => {
      const elapsed = (performance.now() - startT) / 1000;
      if (loop.stats?.ms) frameSamples.push(loop.stats.ms);
      viewsSum += view.stats.views;
      framesCount++;

      if (elapsed >= durationSec) {
        clearInterval(frameTimer);
        if (churnInterval) clearInterval(churnInterval);
        unsubSim?.();

        const p50_frame = percentile(frameSamples, 0.50);
        const p95_frame = percentile(frameSamples, 0.95);
        const p95_step = percentile(stepSamples, 0.95);
        const avg_views = framesCount > 0 ? (viewsSum / framesCount) : 0;
        const pass = name === 'mirrors' ? (p95_frame <= 20.0) : (p95_frame <= 16.7);

        const report = {
          scene: name,
          duration_s: durationSec,
          frames: framesCount,
          p50_frame_ms: Number(p50_frame.toFixed(2)),
          p95_frame_ms: Number(p95_frame.toFixed(2)),
          p95_step_ms: Number(p95_step.toFixed(2)),
          avg_views: Number(avg_views.toFixed(1)),
          quality_level: quality.level?.name,
          dpr: Number(view.renderer.getPixelRatio().toFixed(2)),
          events,
          passed: pass,
        };
        window.__STRESS_REPORT__ = report;
        console.log('STRESS TEST REPORT:\n', JSON.stringify(report, null, 2));
        setNotice(`Stress test [${name}] done: p95 ${report.p95_frame_ms} ms (${report.passed ? 'PASS' : 'FAIL'})`, 10000);
      }
    }, 16);
  } catch (err) {
    setNotice(`Failed stress test: ${err.message}`);
  }
}

// Startup order: location.search (?stress=...) > location.hash (#s=...) > localStorage autosave > defaultScene()
async function initStartupScene() {
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams(window.location.search);
  const stress = params.get('stress');
  if (stress) {
    const dur = parseInt(params.get('duration') || '60', 10);
    setTimeout(() => runStressTest(stress, dur), 400);
    return;
  }

  const hash = window.location.hash;
  if (hash && hash.startsWith('#s=')) {
    const b64url = hash.slice(3);
    try {
      const res = await decodeShare(b64url);
      if (res.ok) {
        loadScene(res.doc, 'shared link');
        return;
      } else {
        setNotice(`Invalid share link: ${res.error}`);
      }
    } catch (err) {
      setNotice(`Failed to parse share link: ${err.message}`);
    }
  }

  // Fallback to autosave
  const saved = autosave.load();
  if (saved) {
    loadScene(saved, 'autosaved scene');
    return;
  }
}

// React to URL hash changes dynamically
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', async () => {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#s=')) {
      const b64url = hash.slice(3);
      try {
        const res = await decodeShare(b64url);
        if (res.ok) {
          loadScene(res.doc, 'shared link');
        } else {
          setNotice(`Invalid share link: ${res.error}`);
        }
      } catch (err) {
        setNotice(`Failed to load share link: ${err.message}`);
      }
    }
  });
}

initStartupScene();
loop.start();

window.limen = {
  THREE, doc, view, sim, loop, cameraCtrl, editor, ui, stats, quality,
  controls: cameraCtrl.controls,
  perfOverlay: ui?.perfOverlay,
  autosave,
  loadScene,
  newScene,
  spawn, reset,
  flyThrough: (idx) => cameraCtrl.flyThrough(idx),
  play: () => editor.setMode('play'),
  pause: () => editor.setMode('edit'),
  step: (n = 1) => editor.step(n),
  remove: (id) => sim.remove(id),
  removeNewest: (n = 50) => sim.removeNewest(n),
  edit: (entity) => sim.edit(entity),
  setSettings: (s) => sim.setSettings(s),
  injectNaN: (id) => sim.injectNaN(id),
  runChaos: (sec = 20) => runChaosTest(sec),
  runStressTest: (name, sec = 60) => runStressTest(name, sec),
  limits: getLimits(),
  recordAlpha(ms = 2000) {
    rec = {log: []};
    return new Promise((done) => setTimeout(() => { const log = rec.log; rec = null; done(log); }, ms));
  },
};
