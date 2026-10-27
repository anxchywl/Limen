// The WebGL2 renderer, lights and the three.js scene graph for a Limen scene document.
// Stencil is on now for prompt 02's portal recursion. DPR is capped at 2. On context loss the
// loop keeps stepping but nothing is drawn; on restore, everything GPU-side is rebuilt.
// Frame GPU time comes from EXT_disjoint_timer_query_webgl2 where the browser offers it.

import * as THREE from 'three';
import {PAPER} from './palette.js';
import {createLevel} from './level.js';
import {createInstances} from './instances.js';

export function createRenderer(canvas, doc) {
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, stencil: true, powerPreference: 'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping; // rolls off highlights without shifting hue
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAPER.background);
  const camera = new THREE.PerspectiveCamera(doc.camera.fov, 1, 0.05, 200);
  camera.position.fromArray(doc.camera.pos);
  camera.lookAt(...doc.camera.target);

  // soft daylight: warm sky over a warm bounce, one sun with a shadow map sized to the room
  const hemi = new THREE.HemisphereLight('#F4E4FF', '#F2C79B', 2.7);
  const sun = new THREE.DirectionalLight('#FFE9C7', 3.0);
  sun.position.set(5, 20, 3); // high sun: short wall shadows, walls lit mostly by the sky
  sun.castShadow = true;
  const sc = sun.shadow.camera;
  Object.assign(sc, {left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40});
  sc.updateProjectionMatrix();
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 3;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(hemi, sun, sun.target);

  let level, bodies;
  const build = () => {
    level?.dispose(); bodies?.dispose();
    if (level) scene.remove(level.group, bodies.group);
    level = createLevel(doc);
    bodies = createInstances();
    bodies.setBodies(doc.bodies);
    scene.add(level.group, bodies.group);
  };
  build();

  const resize = () => {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);

  // context loss: three skips drawing while lost; on restore, rebuild every GPU resource
  let lost = false;
  const events = {lost: 0, restored: 0};
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; events.lost++; });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false; events.restored++;
    timer = gpuTimer(renderer.getContext());
    build();
    api.onRestored?.();
  });

  let timer = gpuTimer(renderer.getContext());
  const api = {
    renderer, scene, camera, events,
    get level() { return level; },
    get bodies() { return bodies; },
    get lost() { return lost; },
    get gpuMs() { return timer.ms; },
    resize,
    draw(prev, curr, alpha, maps) {
      if (lost) return;
      bodies.update(prev, curr, alpha, maps);
      timer.begin();
      renderer.render(scene, camera);
      timer.end();
    },
  };
  return api;
}

// GPU time of each frame, read back a few frames late; ms stays NaN where the query is missing
function gpuTimer(gl) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const t = {ms: NaN, begin() {}, end() {}};
  if (!ext) return t;
  const pending = [];
  let active = null;
  t.begin = () => {
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = pending.shift();
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        t.ms = Number.isNaN(t.ms) ? ms : t.ms + (ms - t.ms) * 0.1;
      }
      gl.deleteQuery(q);
    }
    if (pending.length > 4) return;
    active = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
  };
  t.end = () => { if (active) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(active); active = null; } };
  return t;
}
