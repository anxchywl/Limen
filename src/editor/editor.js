// Editor coordinator: manages edit/play modes, history, active tools,
// raycasting, time scale, emitters tick, and keyboard shortcuts.

import * as THREE from 'three';
import {createHistory} from './history.js';
import {createSelectTool} from './tools/select.js';
import {createBlockTool} from './tools/block.js';
import {createPortalTool} from './tools/portal.js';
import {createSpawnTool} from './tools/spawn.js';
import {createEmitterTool} from './tools/emitter.js';
import {createDeleteTool} from './tools/delete.js';

export function createEditor({doc, view, sim, cameraCtrl, setNotice}) {
  const history = createHistory(200);
  let mode = 'edit'; // 'edit' | 'play'
  let activeToolName = 'select';
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) fn();
  }

  // Raycaster helper
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  function getRay(e) {
    const rect = view.renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, view.camera);
    return raycaster.ray;
  }

  // Create tools
  const selectTool = createSelectTool({
    doc, view, sim, history, cameraCtrl,
    onSelectionChange: () => notify(),
    setNotice,
  });

  const blockTool = createBlockTool({
    doc, view, sim, history, setNotice,
  });

  const portalTool = createPortalTool({
    doc, view, sim, history, setNotice,
  });

  const spawnTool = createSpawnTool({
    doc, view, sim, history, setNotice,
  });

  const emitterTool = createEmitterTool({
    doc, view, sim, history, setNotice,
  });

  const deleteTool = createDeleteTool({
    doc, view, sim, history, selectTool, setNotice,
  });

  const tools = {
    select: selectTool,
    block: blockTool,
    portal: portalTool,
    spawn: spawnTool,
    emitter: emitterTool,
    delete: deleteTool,
  };

  function setMode(newMode) {
    if (newMode === mode) return;
    mode = newMode;
    if (mode === 'play') {
      selectTool.deselect();
      sim.play();
      setNotice?.('Play mode');
    } else {
      sim.pause();
      setNotice?.('Edit mode');
    }
    notify();
  }

  function toggleMode() {
    setMode(mode === 'edit' ? 'play' : 'edit');
  }

  function setTool(name) {
    if (!tools[name]) return;
    if (activeToolName === 'portal' && name !== 'portal') {
      portalTool.resetPending();
    }
    activeToolName = name;
    if (name !== 'select') {
      selectTool.deselect();
    }
    notify();
  }

  function reset() {
    setMode('edit');
    sim.reset({play: false});
    view.rebuildPortals();
    view.level.rebuild(doc.blocks);
    emitterTool.syncMarkers();
    setNotice?.('Reset to snapshot');
    notify();
  }

  function step(n = 1) {
    if (mode === 'play') setMode('edit');
    sim.step(n);
  }

  function setTimeScale(scale) {
    sim.setSettings({timeScale: scale});
    notify();
  }

  // Pointer event listeners on canvas
  const canvas = view.renderer.domElement;

  function onPointerDown(e) {
    if (cameraCtrl.mode === 'fly') return;
    // If clicking on UI or not primary/secondary button
    if (e.target !== canvas) return;
    const ray = getRay(e);
    const tool = tools[activeToolName];
    tool?.onPointerDown?.(e, ray);
  }

  function onPointerMove(e) {
    if (cameraCtrl.mode === 'fly') return;
    if (e.target !== canvas) return;
    const ray = getRay(e);
    const tool = tools[activeToolName];
    tool?.onPointerMove?.(e, ray);
  }

  function onPointerUp(e) {
    if (cameraCtrl.mode === 'fly') return;
    const tool = tools[activeToolName];
    tool?.onPointerUp?.(e);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);

  // Keyboard shortcuts
  function onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    // Undo / Redo
    if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) history.redo();
      else history.undo();
      selectTool.updatePose();
      emitterTool.syncMarkers();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      history.redo();
      selectTool.updatePose();
      emitterTool.syncMarkers();
      return;
    }

    // Delete selected
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (selectTool.selected) {
        e.preventDefault();
        deleteTool.deleteSelected();
        emitterTool.syncMarkers();
      }
      return;
    }

    // Escape deselects
    if (e.key === 'Escape') {
      selectTool.deselect();
      portalTool.resetPending();
      return;
    }

    // Space toggles mode
    if (e.code === 'Space') {
      e.preventDefault();
      toggleMode();
      return;
    }

    // Single step while paused
    if (e.key === '.') {
      step(1);
      return;
    }

    // Tool hotkeys: 1-6
    if (e.key === '1') setTool('select');
    else if (e.key === '2') setTool('block');
    else if (e.key === '3') setTool('portal');
    else if (e.key === '4') setTool('spawn');
    else if (e.key === '5') setTool('emitter');
    else if (e.key === '6') setTool('delete');
  }

  window.addEventListener('keydown', onKeyDown);

  function tick(simTime) {
    emitterTool.tick(simTime);
  }

  function dispose() {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('keydown', onKeyDown);
    for (const tool of Object.values(tools)) {
      tool.dispose?.();
    }
  }

  return {
    get mode() { return mode; },
    get activeTool() { return activeToolName; },
    get history() { return history; },
    get selectTool() { return selectTool; },
    get blockTool() { return blockTool; },
    get portalTool() { return portalTool; },
    get spawnTool() { return spawnTool; },
    get emitterTool() { return emitterTool; },
    get deleteTool() { return deleteTool; },
    tools,
    setMode,
    toggleMode,
    setTool,
    reset,
    step,
    setTimeScale,
    tick,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose,
  };
}
