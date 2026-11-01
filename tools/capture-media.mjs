// Captures screenshot for docs/media/screenshot.png and og-image.png using Chrome CDP
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9225;
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

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const {resolve, reject} = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
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

  async screenshot(filePath) {
    const res = await this.send('Page.captureScreenshot', {format: 'png'});
    const buf = Buffer.from(res.data, 'base64');
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
    fs.writeFileSync(filePath, buf);
    console.log(`Saved screenshot to ${filePath}`);
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  const chrome = spawn(CHROME_PATH, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--use-gl=angle',
    '--use-angle=metal',
    '--hide-scrollbars',
    '--mute-audio',
    APP_URL,
  ], {stdio: 'ignore'});

  const cleanup = () => {
    try { chrome.kill(); } catch (_) {}
  };
  process.on('exit', cleanup);

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
    if (!version) throw new Error('Chrome failed to start or open CDP port');

    const targets = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
    const pageTarget = targets.find((t) => t.type === 'page');
    if (!pageTarget) throw new Error('No page target found');

    const cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.ready();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 720,
      deviceScaleFactor: 2,
      mobile: false,
    });

    console.log('Waiting for window.limen ready...');
    let ready = false;
    for (let i = 0; i < 40; i++) {
      ready = await cdp.eval('Boolean(window.limen && window.limen.sim && window.limen.editor)');
      if (ready) break;
      await sleep(250);
    }
    if (!ready) throw new Error('window.limen not ready in time');

    // Load "starter-room" gallery scene
    await cdp.eval(`(async () => {
      const res = await fetch('./scenes/starter-room.json');
      const docData = await res.json();
      window.limen.loadScene(docData, 'Sandbox Starter');
    })()`);
    await sleep(1000);

    // Save screenshots
    await cdp.screenshot('docs/media/screenshot.png');
    await cdp.screenshot('og-image.png');

    console.log('Screenshots captured successfully!');
    cdp.close();
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error('Failed to capture media:', err);
  process.exit(1);
});
