// The WebGL2 renderer, lights, portal stencil recursion and three.js scene graph for Limen.
// Draws the main pass (and shadow map once), plans visible portal views breadth-first within the
// depth/view budget, and renders each portal view with stencil increment/decrement, scissor rects
// and Lengyel oblique near planes. Frame GPU time uses EXT_disjoint_timer_query_webgl2 (or optional
// gl.finish() timing in debug mode). Rebuilds all GPU resources on context restore.

import * as THREE from 'three';
import {PAPER} from './palette.js';
import {createLevel} from './level.js';
import {createInstances} from './instances.js';
import {createPortals, defaultViewBudget} from './portals.js';

export function createRenderer(canvas, doc, opts = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: opts.antialias ?? true, stencil: true,
    preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(opts.pixelRatio ?? Math.min(devicePixelRatio, 2));
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  renderer.setClearColor(PAPER.background, 1);
  renderer.shadowMap.enabled = opts.shadows ?? true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = opts.toneMapping ?? THREE.NeutralToneMapping; // rolls off highlights without shifting hue
  renderer.toneMappingExposure = opts.exposure ?? 1.05;

  const scene = new THREE.Scene();
  // scene.background stays null so WebGLBackground never forces an unscissored gl.clear on virtual passes
  const camera = new THREE.PerspectiveCamera(doc.camera.fov, 1, 0.05, 200);
  camera.position.fromArray(doc.camera.pos);
  camera.lookAt(...doc.camera.target);

  // soft daylight: warm sky over a warm bounce, one sun with a shadow map sized to the room
  const hemi = new THREE.HemisphereLight('#F4E4FF', '#F2C79B', 2.7);
  const sun = new THREE.DirectionalLight('#FFE9C7', 3.0);
  sun.position.set(5, 20, 3); // high sun: short wall shadows, walls lit mostly by the sky
  sun.castShadow = renderer.shadowMap.enabled;
  const sc = sun.shadow.camera;
  Object.assign(sc, {left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40});
  sc.updateProjectionMatrix();
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 3;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(hemi, sun, sun.target);

  let level, bodies, portals, materials = [];
  const build = () => {
    if (level) scene.remove(level.group, bodies.group, portals.group);
    level?.dispose(); bodies?.dispose(); portals?.dispose();
    level = createLevel(doc);
    bodies = createInstances();
    bodies.setPortals(doc.portals);
    bodies.setBodies(doc.bodies);
    portals = createPortals(doc);
    materials = [level.material, ...bodies.materials, portals.rimMaterial];
    scene.add(level.group, bodies.group, portals.group);
  };
  build();

  let customBudget = opts.budget ? {...defaultViewBudget(), ...opts.budget} : null;
  let budget = customBudget ?? defaultViewBudget();

  const resize = () => {
    const w = canvas.clientWidth || canvas.width || innerWidth;
    const h = canvas.clientHeight || canvas.height || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!customBudget) budget = defaultViewBudget();
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

  const white = new THREE.Color(1, 1, 1);
  const sizeVec = new THREE.Vector2();
  const stats = {views: 0, maxDepthReached: 0, budget: budget.maxViews, maxDepth: budget.maxDepth, terminals: 0, draws: 0};
  let timer = gpuTimer(renderer.getContext());
  let finishMs = NaN;

  function setPassState(stencilRef, tint) {
    for (let i = 0; i < materials.length; i++) {
      const m = materials[i];
      m.stencilRef = stencilRef;
      m.userData.ink.uPassTint.value.copy(tint);
    }
  }

  function renderNode(node, stencilLevel) {
    setPassState(stencilLevel, node.tint);
    if (stencilLevel === 0) renderer.setScissorTest(false);
    else {
      renderer.setScissorTest(true);
      renderer.setScissor(node.scissor.x, node.scissor.y, node.scissor.w, node.scissor.h);
    }

    const exitRim = node.exitIdx >= 0 ? portals.rims[node.exitIdx] : null;
    if (exitRim) exitRim.visible = false;
    renderer.render(scene, node.camera);
    if (exitRim) exitRim.visible = true;

    if (node.terminals.length) {
      renderer.setScissorTest(true);
      for (let i = 0; i < node.terminals.length; i++) {
        const t = node.terminals[i];
        renderer.setScissor(t.scissor.x, t.scissor.y, t.scissor.w, t.scissor.h);
        portals.fillTerminal(renderer, node.camera, t.portalIdx, stencilLevel, t.color, t.thickened);
      }
    }

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      renderer.setScissorTest(true);
      renderer.setScissor(child.scissor.x, child.scissor.y, child.scissor.w, child.scissor.h);
      portals.markStencil(renderer, node.camera, child.entryIdx, stencilLevel, child.thickened);
      portals.clearDepthAndSky(renderer, child.camera, stencilLevel + 1, child.tint);
      renderNode(child, stencilLevel + 1);
      renderer.setScissorTest(true);
      renderer.setScissor(child.scissor.x, child.scissor.y, child.scissor.w, child.scissor.h);
      portals.restoreDepthAndStencil(renderer, node.camera, child.entryIdx, stencilLevel + 1, child.thickened);
    }
  }

  const api = {
    renderer, scene, camera, events, stats,
    measureFinish: false,
    get level() { return level; },
    get bodies() { return bodies; },
    get portals() { return portals; },
    get budget() { return budget; },
    set budget(b) { customBudget = b ? {...defaultViewBudget(), ...b} : null; budget = customBudget ?? defaultViewBudget(); },
    get lost() { return lost; },
    get gpuMs() { return !Number.isNaN(timer.ms) ? timer.ms : finishMs; },
    get gpuFinishMs() { return finishMs; },
    rebuildPortals() {
      portals.rebuild(doc.portals);
      bodies.setPortals(doc.portals);
    },
    resize,
    draw(prev, curr, alpha, maps) {
      if (lost) return;
      bodies.update(prev, curr, alpha, maps);
      camera.updateMatrixWorld();
      scene.updateMatrixWorld();
      scene.matrixWorldAutoUpdate = false;

      renderer.getSize(sizeVec);
      const planned = portals.plan(camera, sizeVec.x, sizeVec.y, budget);
      Object.assign(stats, planned.stats);

      renderer.info.reset();
      timer.begin();
      const t0 = api.measureFinish ? performance.now() : 0;

      renderer.setScissorTest(false);
      renderer.state.buffers.depth.setMask(true);
      renderer.state.buffers.color.setMask(true);
      renderer.state.buffers.stencil.setMask(0xff);
      renderer.clear(true, true, true);
      if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;

      renderNode(planned.root, 0);

      renderer.setScissorTest(false);
      setPassState(0, white);
      scene.matrixWorldAutoUpdate = true;
      stats.draws = renderer.info.render.calls;

      if (api.measureFinish) {
        renderer.getContext().finish();
        const dt = performance.now() - t0;
        finishMs = Number.isNaN(finishMs) ? dt : finishMs + (dt - finishMs) * 0.1;
      }
      timer.end();
    },
    dispose() {
      removeEventListener('resize', resize);
      level?.dispose(); bodies?.dispose(); portals?.dispose();
      renderer.dispose();
    },
  };
  return api;
}

// GPU time of each frame, read back a few frames late; ms stays NaN where the query is missing
function gpuTimer(gl) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const t = {ms: NaN, available: Boolean(ext), begin() {}, end() {}};
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
