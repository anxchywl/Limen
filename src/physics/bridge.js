// Main-thread bridge to the Rapier physics worker.
// Keeps the two most recent worker frames (prev and curr), transfers each incoming ping-pong buffer
// straight back to the worker after copying, and samples an interpolated pose one step behind worker time.

import {
  ALIVE, FLAGS, FROM_WORKER, H_COUNT, H_IN_TRANSIT, H_SLOTS, H_STEP, H_STEP_MS, H_TIME, H_TRANSIT_MS, POS, QUAT,
  TO_WORKER, frameLength, slotOffset,
} from './protocol.js';
import {DT} from './world.js';

const MIN_SLOTS = 64;

function initialSlotBuffer(bodies) {
  let cap = MIN_SLOTS;
  while (cap < bodies.length) cap *= 2;
  const buf = new Float32Array(frameLength(cap));
  buf[H_STEP] = 0;
  buf[H_TIME] = 0;
  buf[H_COUNT] = bodies.length;
  buf[H_SLOTS] = bodies.length;
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i], o = slotOffset(i);
    buf[o + POS] = b.pos[0]; buf[o + POS + 1] = b.pos[1]; buf[o + POS + 2] = b.pos[2];
    buf[o + QUAT] = b.quat[0]; buf[o + QUAT + 1] = b.quat[1]; buf[o + QUAT + 2] = b.quat[2]; buf[o + QUAT + 3] = b.quat[3];
    buf[o + FLAGS] = ALIVE;
  }
  return buf;
}

const deadPlaceholder = (slot) => ({
  id: `_free_${slot}`, shape: 'box', size: [0.1, 0.1, 0.1],
  pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], angvel: [0, 0, 0], mass: 1, color: '#000000',
});

export function createPhysicsBridge(doc, {autoplay = true, onBodiesChanged, onEvent} = {}) {
  const worker = new Worker(new URL('./worker.js', import.meta.url), {type: 'module'});
  let prev = initialSlotBuffer(doc.bodies);
  let curr = new Float32Array(prev);
  let slotBodies = doc.bodies.map((b) => structuredClone(b));
  let bodiesDirty = false;
  let playing = Boolean(autoplay);
  let snapNextFrame = true;
  let snapToLatest = false;
  let primed = false;
  let renderTime = 0;
  let lastSeenStep = 0;
  let simd = false;
  let version = '';
  let lastEvent = null;
  let busy = false;
  const frameListeners = new Set();

  let resolveReady;
  const ready = new Promise((res) => { resolveReady = res; });

  function syncDocBodies() {
    doc.bodies.length = 0;
    for (let i = 0; i < slotBodies.length; i++) {
      const b = slotBodies[i];
      if (b && !b._dead) doc.bodies.push(b);
    }
  }

  function applySlotList(list) {
    slotBodies = [];
    for (const {slot, body} of list) {
      while (slotBodies.length < slot) slotBodies.push({...deadPlaceholder(slotBodies.length), _dead: true});
      slotBodies[slot] = body;
    }
    syncDocBodies();
    bodiesDirty = true;
  }

  worker.onmessage = (e) => {
    const msg = e.data;
    if (!msg) return;
    if (msg.type === FROM_WORKER.READY) {
      simd = msg.simd;
      version = msg.version;
      resolveReady({simd, version});
      return;
    }
    if (msg.type === FROM_WORKER.EVENT) {
      const ev = msg.event;
      lastEvent = ev;
      if (ev.type === 'loaded' || ev.type === 'reset') {
        applySlotList(ev.bodies);
        snapNextFrame = true;
        busy = false;
      } else if (ev.type === 'spawned') {
        while (slotBodies.length < ev.slot) slotBodies.push({...deadPlaceholder(slotBodies.length), _dead: true});
        slotBodies[ev.slot] = ev.body;
        syncDocBodies();
        bodiesDirty = true;
      } else if (ev.type === 'removed' && ev.slot >= 0) {
        if (ev.slot < slotBodies.length) slotBodies[ev.slot] = {...deadPlaceholder(ev.slot), _dead: true};
        syncDocBodies();
        bodiesDirty = true;
      } else if (ev.type === 'busy') {
        busy = true;
      }
      onEvent?.(ev);
      return;
    }
    if (msg.type === FROM_WORKER.FRAME) {
      const incoming = msg.buffer;
      if (curr.length !== incoming.length) {
        const nextPrev = new Float32Array(incoming.length);
        nextPrev.set(curr.subarray(0, Math.min(curr.length, incoming.length)));
        prev = nextPrev;
        curr = new Float32Array(incoming.length);
      } else {
        [prev, curr] = [curr, prev];
      }
      curr.set(incoming);
      if (snapNextFrame || curr[H_STEP] <= prev[H_STEP]) {
        prev.set(curr);
        renderTime = curr[H_TIME];
        snapNextFrame = false;
        snapToLatest = false;
        primed = false;
      } else if (snapToLatest) {
        renderTime = curr[H_TIME];
        snapToLatest = false;
      }
      // immediately return the ping-pong buffer to the worker
      worker.postMessage({type: TO_WORKER.RETURN, buffer: incoming}, [incoming.buffer]);
      for (const fn of frameListeners) fn(curr, prev);
    }
  };

  function sample(frameDt) {
    if (bodiesDirty) {
      bodiesDirty = false;
      onBodiesChanged?.(slotBodies);
    }
    const stepNow = curr[H_STEP] | 0;
    const stepDelta = Math.max(0, stepNow - lastSeenStep);
    lastSeenStep = stepNow;

    const t0 = prev[H_TIME];
    const t1 = curr[H_TIME];
    let alpha = 1;
    if (t1 > t0) {
      if (playing) {
        const scale = Math.max(0, doc.settings?.timeScale ?? 1);
        if (!primed) {
          renderTime = t0 + Math.min(0.5 * DT, frameDt * scale);
          primed = true;
        } else {
          // render one step behind: gently phase-lock toward the midpoint at 1x, linear sweep in slow-mo
          const target = t1 - 0.5 * DT;
          const drift = scale >= 0.99 ? (target - renderTime) * 0.05 : 0;
          renderTime += Math.max(0, frameDt * scale + drift);
        }
        if (renderTime < t0) renderTime = t0;
        if (renderTime > t1) renderTime = t1;
      }
      alpha = Math.max(0, Math.min(1, (renderTime - t0) / (t1 - t0)));
    } else {
      renderTime = t1;
    }
    return {prev, curr, alpha, steps: stepDelta};
  }

  function load(scene = doc, play = playing) {
    playing = Boolean(play);
    snapNextFrame = true;
    worker.postMessage({type: TO_WORKER.LOAD, scene, play: playing});
  }

  function spawn(body) {
    worker.postMessage({type: TO_WORKER.SPAWN, body});
  }

  function remove(id) {
    worker.postMessage({type: TO_WORKER.REMOVE, id});
  }

  function edit(entity) {
    worker.postMessage({type: TO_WORKER.EDIT, entity});
  }

  function play() {
    playing = true;
    worker.postMessage({type: TO_WORKER.PLAY});
  }

  function pause() {
    playing = false;
    primed = false;
    worker.postMessage({type: TO_WORKER.PAUSE});
  }

  function step(arg = 1) {
    if (arg instanceof Float32Array) {
      arg.set(curr.subarray(0, Math.min(arg.length, curr.length)));
      return;
    }
    snapToLatest = true;
    worker.postMessage({type: TO_WORKER.STEP, n: arg});
  }

  function reset({play: playAfter = false} = {}) {
    playing = Boolean(playAfter);
    snapNextFrame = true;
    lastSeenStep = 0;
    worker.postMessage({type: TO_WORKER.RESET, play: playing});
  }

  function setSettings(settings) {
    Object.assign(doc.settings, settings);
    worker.postMessage({type: TO_WORKER.SET_SETTINGS, settings});
  }

  function injectNaN(id) {
    worker.postMessage({type: TO_WORKER.INJECT_NAN, id});
  }

  function removeNewest(count = 50) {
    worker.postMessage({type: TO_WORKER.REMOVE_NEWEST, count});
    const liveIndices = [];
    for (let i = 0; i < slotBodies.length; i++) {
      if (slotBodies[i] && !slotBodies[i]._dead) liveIndices.push(i);
    }
    const toRemove = Math.min(count, liveIndices.length);
    for (let i = 0; i < toRemove; i++) {
      const idx = liveIndices[liveIndices.length - 1 - i];
      slotBodies[idx] = {...deadPlaceholder(idx), _dead: true};
    }
    syncDocBodies();
    bodiesDirty = true;
    busy = false;
  }

  function write(buf) {
    buf.set(curr.subarray(0, Math.min(buf.length, curr.length)));
  }

  load(doc, autoplay);

  return {
    ready,
    sample, write, step, add: spawn, spawn, remove, removeNewest, edit, play, pause, reset, setSettings, injectNaN, load,
    resync() { primed = false; renderTime = curr[H_TIME]; },
    onFrame(fn) { frameListeners.add(fn); return () => frameListeners.delete(fn); },
    dispose() { frameListeners.clear(); worker.terminate(); },
    get simd() { return simd; },
    get version() { return version; },
    get playing() { return playing; },
    get busy() { return busy; },
    get lastEvent() { return lastEvent; },
    get slots() { return Math.max(slotBodies.length, curr[H_SLOTS] | 0); },
    get count() { return curr[H_COUNT] | 0; },
    get steps() { return curr[H_STEP] | 0; },
    get time() { return curr[H_TIME]; },
    get prev() { return prev; },
    get curr() { return curr; },
    get bodies() { return slotBodies; },
    get workerStepMs() { return curr[H_STEP_MS] || 0; },
    get workerTransitMs() { return curr[H_TRANSIT_MS] || 0; },
    get inTransitCount() { return curr[H_IN_TRANSIT] | 0; },
  };
}
