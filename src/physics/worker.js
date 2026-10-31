// Module Web Worker hosting the Rapier 3D simulation on its own 60 Hz fixed-step clock.
// Probes WebAssembly SIMD support, loads vendored simd-compat (falling back to plain compat),
// and streams poses to the main thread through two ping-pong transferable Float32Arrays.

import {FROM_WORKER, TO_WORKER, frameLength} from './protocol.js';
import {DT, createPhysicsWorld} from './world.js';

// Minimal valid WASM module containing an i32x4.splat v128 SIMD instruction
const WASM_SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0,
  1, 5, 1, 96, 0, 1, 123,
  3, 2, 1, 0,
  10, 8, 1, 6, 0, 65, 0, 253, 17, 11,
]);

const MAX_STEPS_PER_TICK = 4;
const MIN_SLOTS = 64;

function targetFloatLength(slots) {
  let cap = MIN_SLOTS;
  while (cap < slots) cap *= 2;
  return frameLength(cap);
}

let sim = null;
let playing = false;
let hasSteppedSinceSnap = false;
let lastPostedStep = 0;
let timer = 0;
let lastTick = null;
let acc = 0;
const freeBuffers = [
  new Float32Array(targetFloatLength(MIN_SLOTS)),
  new Float32Array(targetFloatLength(MIN_SLOTS)),
];
const pendingMsgs = [];

function postEvent(event) {
  self.postMessage({type: FROM_WORKER.EVENT, event});
}

function postFrame({force = false} = {}) {
  if (!sim) return false;
  let buf = freeBuffers.pop();
  if (!buf) {
    if (!force) return false; // drop frame rather than blocking or growing the pool
    buf = new Float32Array(targetFloatLength(sim.slots));
  }
  const want = targetFloatLength(sim.slots);
  if (buf.length !== want) buf = new Float32Array(want);
  const since = sim.steps > lastPostedStep ? lastPostedStep : undefined;
  sim.write(buf, since);
  lastPostedStep = sim.steps;
  self.postMessage({type: FROM_WORKER.FRAME, buffer: buf}, [buf.buffer]);
  return true;
}

function stopClock() {
  if (timer) { clearTimeout(timer); timer = 0; }
  lastTick = null;
}

function scheduleNext() {
  if (!playing) return;
  const scale = Math.max(0.05, sim?.settings.timeScale ?? 1);
  const remMs = Math.max(1, Math.floor(((DT - acc) / scale) * 1000) - 1);
  timer = setTimeout(tick, remMs);
}

function tick() {
  timer = 0;
  if (!playing || !sim) return;
  const now = performance.now();
  if (lastTick === null) lastTick = now;
  const scale = Math.max(0, sim.settings.timeScale ?? 1);
  acc += Math.max(0, (now - lastTick) / 1000) * scale;
  lastTick = now;

  let todo = Math.min(MAX_STEPS_PER_TICK, Math.floor(acc / DT));
  acc -= todo * DT;
  if (acc >= DT) acc %= DT; // drop backlog after slow ticks or hidden tabs

  for (let i = 0; i < todo; i++) {
    sim.step(1);
    hasSteppedSinceSnap = true;
    // keep any scarce free ping-pong buffer for the newest step(s) of a multi-step tick
    if (freeBuffers.length > (todo - 1 - i)) postFrame({force: false});
  }
  scheduleNext();
}

function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case TO_WORKER.RETURN: {
      if (msg.buffer instanceof Float32Array && msg.buffer.buffer.byteLength > 0 && freeBuffers.length < 2) {
        freeBuffers.push(msg.buffer);
      }
      break;
    }
    case TO_WORKER.LOAD: {
      stopClock();
      playing = false;
      acc = 0;
      hasSteppedSinceSnap = false;
      lastPostedStep = 0;
      sim.load(msg.scene);
      postFrame({force: true});
      if (msg.play) {
        playing = true;
        lastTick = performance.now();
        scheduleNext();
      }
      break;
    }
    case TO_WORKER.SPAWN: {
      const inEdit = !playing;
      const res = sim.spawn(msg.body, {inEdit});
      if (res.ok && !playing) postFrame({force: true});
      break;
    }
    case TO_WORKER.REMOVE: {
      const inEdit = !playing;
      if (sim.remove(msg.id, 'user', {inEdit}) && !playing) postFrame({force: true});
      break;
    }
    case TO_WORKER.EDIT: {
      const inEdit = !playing;
      if (sim.edit(msg.entity, {inEdit}) && !playing) postFrame({force: true});
      break;
    }
    case TO_WORKER.PLAY: {
      if (!playing) {
        if (sim.dirtyEdit) {
          sim.saveSnapshot();
          hasSteppedSinceSnap = false;
        }
        playing = true;
        acc = 0;
        lastTick = performance.now();
        scheduleNext();
      }
      break;
    }
    case TO_WORKER.PAUSE: {
      playing = false;
      stopClock();
      break;
    }
    case TO_WORKER.STEP: {
      const n = Math.max(1, msg.n ?? 1);
      for (let i = 0; i < n; i++) {
        sim.step(1);
        hasSteppedSinceSnap = true;
        if (i >= n - 2) postFrame({force: i === n - 1});
      }
      break;
    }
    case TO_WORKER.RESET: {
      playing = false;
      stopClock();
      acc = 0;
      hasSteppedSinceSnap = false;
      lastPostedStep = 0;
      if (sim.reset()) postFrame({force: true});
      if (msg.play) {
        playing = true;
        lastTick = performance.now();
        scheduleNext();
      }
      break;
    }
    case TO_WORKER.SET_SETTINGS: {
      sim.setSettings(msg.settings, {inEdit: !playing && !hasSteppedSinceSnap});
      break;
    }
    case TO_WORKER.INJECT_NAN: {
      sim.injectNaN(msg.id);
      if (!playing) {
        sim.step(1);
        hasSteppedSinceSnap = true;
        postFrame({force: true});
      }
      break;
    }
  }
}

self.onmessage = (e) => {
  if (!sim) pendingMsgs.push(e.data);
  else handleMessage(e.data);
};

(async () => {
  const simd = typeof WebAssembly === 'object' && WebAssembly.validate(WASM_SIMD_PROBE);
  const modUrl = simd ? '../../vendor/rapier/simd/rapier.mjs' : '../../vendor/rapier/compat/rapier.mjs';
  const RAPIER = await import(modUrl);
  await RAPIER.init();
  sim = createPhysicsWorld(RAPIER, {onEvent: postEvent});
  self.postMessage({type: FROM_WORKER.READY, simd, version: RAPIER.version()});
  while (pendingMsgs.length) handleMessage(pendingMsgs.shift());
})();
