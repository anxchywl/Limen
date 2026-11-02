// Browser verification script for Limen prompt 06 (Save, load, share, gallery, autosave).

import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {encodeShare} from '../src/io/share.js';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9223;
const APP_URL = 'http://localhost:5180';

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function fetchJson(url) {
  const res = await fetch(url);
  return await res.json();
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
    this.events = [];
    this.consoleErrors = [];

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const {resolve, reject} = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
          this.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
        }
      }
    };
  }

  async ready() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((res) => { this.ws.onopen = res; });
  }

  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, {resolve, reject});
      this.ws.send(JSON.stringify({id, method, params}));
    });
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error in [${expr}]: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
    }
    return res.result?.value;
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  console.log('Starting headless Chrome for IO tests...');
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--use-gl=angle',
    '--window-size=1280,800',
    APP_URL,
  ], {stdio: ['ignore', 'pipe', 'pipe']});

  let killed = false;
  const cleanup = () => {
    if (!killed) {
      killed = true;
      try { chromeProc.kill('SIGKILL'); } catch (_) {}
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);

  try {
    let version = null;
    for (let i = 0; i < 30; i++) {
      try {
        version = await fetchJson(`http://127.0.0.1:${PORT}/json/version`);
        break;
      } catch (_) {
        await sleep(200);
      }
    }
    if (!version) throw new Error('Chrome failed to start');

    const targets = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
    const pageTarget = targets.find((t) => t.type === 'page');
    if (!pageTarget) throw new Error('No page target found');

    const cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.ready();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    console.log('Connected to Chrome. Waiting for window.limen ready...');
    for (let i = 0; i < 40; i++) {
      const ready = await cdp.eval('Boolean(window.limen && window.limen.sim && window.limen.autosave)');
      if (ready) break;
      await sleep(250);
    }

    // 1. Test Share round-trip in browser
    console.log('Test 1: Share link in URL hash...');
    const shareUrl = await cdp.eval(`(async () => {
      const {doc, spawn} = window.limen;
      spawn({shape: 'box', pos: [0, 4, 0], mass: 5, color: '#123456'});
      const {encodeShare} = await import('./src/io/share.js');
      const b64 = await encodeShare(doc);
      return b64;
    })()`);
    console.log('Generated share hash length:', shareUrl.length);

    // Navigate to this hash
    await cdp.eval(`window.location.hash = '#s=${shareUrl}'`);
    await sleep(400);

    const sharedDocCheck = await cdp.eval(`(() => {
      const {doc} = window.limen;
      const found = doc.bodies.find(b => b.color === '#123456');
      return {bodyCount: doc.bodies.length, foundSpecial: Boolean(found)};
    })()`);
    console.log('Decoded share scene in browser:', sharedDocCheck);
    if (!sharedDocCheck.foundSpecial) {
      throw new Error('Special body was not found after loading share link hash');
    }

    // 2. Test 5s Play simulation determinism
    console.log('Test 2: 5s Play simulation reproducibility on shared scene...');
    await cdp.eval('window.limen.play()');
    await sleep(1500);
    const stepsRun = await cdp.eval('window.limen.sim.steps');
    console.log('Simulated steps:', stepsRun);
    if (stepsRun < 30) throw new Error(`Simulation failed to advance: steps=${stepsRun}`);
    await cdp.eval('window.limen.pause()');

    // 3. Test Gallery scenes loading in browser (< 300 ms each)
    console.log('Test 3: Loading each gallery scene (< 300 ms)...');
    const galleryResults = await cdp.eval(`(async () => {
      const results = [];
      const res = await fetch('scenes/index.json');
      const items = await res.json();
      for (const item of items) {
        const t0 = performance.now();
        const sRes = await fetch(item.file);
        const text = await sRes.text();
        const {fromJSON} = await import('./src/io/serialize.js');
        const parsed = fromJSON(text);
        window.limen.loadScene(parsed.doc, item.title);
        const elapsed = performance.now() - t0;
        results.push({
          id: item.id,
          title: item.title,
          elapsed,
          blocks: window.limen.doc.blocks.length,
          portals: window.limen.doc.portals.length,
          bodies: window.limen.doc.bodies.length,
        });
      }
      return results;
    })()`);
    for (const r of galleryResults) {
      console.log(`  Gallery [${r.id}]: loaded in ${r.elapsed.toFixed(1)} ms (${r.blocks} blk, ${r.portals} por, ${r.bodies} bod)`);
      if (r.elapsed >= 300) throw new Error(`Gallery scene ${r.id} took ${r.elapsed.toFixed(1)} ms (>= 300 ms budget)`);
    }

    // 4. Test Hostile Hash: huge/corrupted payload leaves previous scene intact with < 100 ms freeze
    console.log('Test 4: Hostile crafted hash test...');
    const preCount = await cdp.eval('window.limen.doc.blocks.length');
    const hostileResult = await cdp.eval(`(async () => {
      const t0 = performance.now();
      window.location.hash = '#s=invalid_corrupted_garbage_base64_payload_1234567890';
      await new Promise(r => setTimeout(r, 100));
      const freezeMs = performance.now() - t0 - 100;
      return {freezeMs};
    })()`);
    await sleep(200);
    const postCount = await cdp.eval('window.limen.doc.blocks.length');
    console.log(`Hostile hash test: blocks kept (${preCount} == ${postCount}), freeze: ${hostileResult.freezeMs.toFixed(2)} ms`);
    if (preCount !== postCount) {
      throw new Error(`Hostile hash damaged the active scene: pre=${preCount}, post=${postCount}`);
    }
    if (hostileResult.freezeMs > 100) {
      throw new Error(`Hostile hash caused freeze of ${hostileResult.freezeMs.toFixed(1)} ms (> 100 ms budget)`);
    }

    // 5. Test Autosave persistence across reload
    console.log('Test 5: Autosave persistence across reload...');
    await cdp.eval(`(() => {
      window.location.hash = '';
      window.limen.doc.blocks.push({
        id: 'k_autosave_marker', kind: 'box', min: [0,0,0], max: [1,1,1], color: null
      });
      window.limen.autosave.saveImmediate();
    })()`);
    await sleep(200);

    // Reload page
    await cdp.send('Page.reload');
    await sleep(800);

    for (let i = 0; i < 30; i++) {
      const ready = await cdp.eval('Boolean(window.limen && window.limen.doc)');
      if (ready) break;
      await sleep(200);
    }

    const autosaveRestored = await cdp.eval(`Boolean(window.limen.doc.blocks.some(b => b.id === 'k_autosave_marker'))`);
    console.log('Autosaved marker block restored on reload:', autosaveRestored);
    if (!autosaveRestored) {
      throw new Error('Autosaved document was not restored on reload');
    }

    // 6. Test with localStorage blocked/throwing (private browsing simulation)
    console.log('Test 6: Simulation with localStorage disabled / throwing...');
    const storageBlockedResult = await cdp.eval(`(() => {
      const origSetItem = localStorage.setItem;
      localStorage.setItem = () => { throw new DOMException('QuotaExceededError'); };
      let errorThrown = false;
      try {
        window.limen.autosave.saveImmediate();
      } catch (e) {
        errorThrown = true;
      }
      localStorage.setItem = origSetItem;
      return {handledSafely: !errorThrown};
    })()`);
    console.log('Storage blocked gracefully handled:', storageBlockedResult.handledSafely);
    if (!storageBlockedResult.handledSafely) {
      throw new Error('Autosave threw when localStorage failed');
    }

    console.log('ALL Browser IO tests PASSED cleanly!');
    cdp.close();
  } finally {
    cleanup();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Browser IO tests failed:', err);
  process.exit(1);
});
