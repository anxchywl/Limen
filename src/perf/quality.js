// Adaptive quality controller for Limen.
// Monitors an Exponential Moving Average (EMA) of frame time against a target (16.7 ms default),
// and steps down resolution/shadows/depth/budget when under load.
// Steps back up only after 3.0 s continuously under 70 % of budget (hysteresis) to prevent flickering.

import {getLimits} from '../core/limits.js';

export const QUALITY_LEVELS = [
  // 0: Maximum
  {dprScale: 1.0, shadowMapSize: 2048, maxDepth: 6, maxViews: 32, name: 'ultra'},
  // 1: DPR scale step 1
  {dprScale: 0.75, shadowMapSize: 2048, maxDepth: 6, maxViews: 32, name: 'high-dpr'},
  // 2: DPR scale step 2 (down to 0.5)
  {dprScale: 0.5, shadowMapSize: 2048, maxDepth: 6, maxViews: 32, name: 'dpr-min'},
  // 3: Shadow-map reduction
  {dprScale: 0.5, shadowMapSize: 1024, maxDepth: 6, maxViews: 32, name: 'shadow-1024'},
  // 4: Shadow-map further reduction
  {dprScale: 0.5, shadowMapSize: 512, maxDepth: 6, maxViews: 24, name: 'shadow-512'},
  // 5: Recursion depth reduction
  {dprScale: 0.5, shadowMapSize: 512, maxDepth: 4, maxViews: 16, name: 'depth-4'},
  // 6: Recursion depth & view budget reduction
  {dprScale: 0.5, shadowMapSize: 512, maxDepth: 3, maxViews: 12, name: 'depth-3'},
  // 7: Lowest fallback
  {dprScale: 0.5, shadowMapSize: 0, maxDepth: 2, maxViews: 8, name: 'low'},
];

const TARGET_FRAME_MS = 16.7; // 60 FPS
const RECOVERY_RATIO = 0.70;  // 70% of target budget (~11.69 ms)
const RECOVERY_TIME_MS = 3000; // 3 seconds under budget before stepping up
const OVERLOAD_HOLD_MS = 350;  // 350 ms over budget before stepping down
const EMA_ALPHA = 0.08;

export function createQualityController(view, opts = {}) {
  let mode = opts.mode || 'auto'; // 'auto' | 'high' | 'low'
  let currentLevelIdx = 0;
  let emaFrameMs = TARGET_FRAME_MS * 0.5;
  let overloadDuration = 0;
  let underloadDuration = 0;
  let lastTick = performance.now();

  const limits = getLimits();
  if (limits.isMobile) {
    // Phone begins at level 4/5 appropriate for phone limits
    currentLevelIdx = 5;
  }

  function getEffectiveLevel() {
    if (mode === 'high') return limits.isMobile ? QUALITY_LEVELS[4] : QUALITY_LEVELS[0];
    if (mode === 'low') return QUALITY_LEVELS[QUALITY_LEVELS.length - 1];
    return QUALITY_LEVELS[currentLevelIdx];
  }

  function applyLevel(lvl) {
    if (!view) return;
    const baseDpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 2, limits.defaultDprCap);
    const dpr = Math.max(0.5, baseDpr * lvl.dprScale);
    view.renderer.setPixelRatio(dpr);

    // Shadow map adjustments
    if (lvl.shadowMapSize > 0) {
      view.renderer.shadowMap.enabled = true;
      if (view.sun) {
        view.sun.castShadow = true;
        if (view.sun.shadow.mapSize.x !== lvl.shadowMapSize) {
          view.sun.shadow.mapSize.set(lvl.shadowMapSize, lvl.shadowMapSize);
          view.sun.shadow.map?.dispose();
          view.sun.shadow.map = null;
          view.renderer.shadowMap.needsUpdate = true;
        }
      }
    } else {
      if (view.sun) view.sun.castShadow = false;
      view.renderer.shadowMap.enabled = false;
    }

    // Portal view budget adjustments
    const maxDepth = Math.min(lvl.maxDepth, limits.maxDepth);
    const maxViews = Math.min(lvl.maxViews, limits.maxViews);
    view.budget = {
      maxDepth,
      maxViews,
      minArea: lvl.dprScale < 0.75 ? 0.004 : 0.002,
    };
  }

  function setMode(newMode) {
    if (newMode !== 'auto' && newMode !== 'high' && newMode !== 'low') return;
    mode = newMode;
    if (mode === 'high') currentLevelIdx = limits.isMobile ? 4 : 0;
    else if (mode === 'low') currentLevelIdx = QUALITY_LEVELS.length - 1;
    applyLevel(getEffectiveLevel());
  }

  function tick(frameDurationMs) {
    const now = performance.now();
    const dt = Math.min(100, Math.max(1, now - lastTick));
    lastTick = now;

    // Filter out huge pauses (tab switches)
    const sample = Math.min(100, Math.max(0.1, frameDurationMs));
    emaFrameMs = emaFrameMs * (1 - EMA_ALPHA) + sample * EMA_ALPHA;

    if (mode !== 'auto') {
      applyLevel(getEffectiveLevel());
      return;
    }

    const target = TARGET_FRAME_MS;
    const recoverThreshold = target * RECOVERY_RATIO;

    if (emaFrameMs > target) {
      overloadDuration += dt;
      underloadDuration = 0;
      if (overloadDuration >= OVERLOAD_HOLD_MS) {
        overloadDuration = 0;
        // Step down
        if (currentLevelIdx < QUALITY_LEVELS.length - 1) {
          currentLevelIdx++;
          applyLevel(getEffectiveLevel());
        }
      }
    } else if (emaFrameMs < recoverThreshold) {
      underloadDuration += dt;
      overloadDuration = 0;
      // Step back up only after 3.0 s continuously under 70 % of budget
      if (underloadDuration >= RECOVERY_TIME_MS) {
        underloadDuration = 0;
        if (currentLevelIdx > 0) {
          // If on mobile, don't exceed mobile limits
          const minLevel = limits.isMobile ? 4 : 0;
          if (currentLevelIdx > minLevel) {
            currentLevelIdx--;
            applyLevel(getEffectiveLevel());
          }
        }
      }
    } else {
      // In middle band: reset recovery counter
      underloadDuration = 0;
      overloadDuration = 0;
    }
  }

  // Initial apply
  applyLevel(getEffectiveLevel());

  return {
    tick,
    setMode,
    get mode() { return mode; },
    get level() { return getEffectiveLevel(); },
    get levelIndex() { return currentLevelIdx; },
    get emaMs() { return emaFrameMs; },
    setLevelIndex(idx) {
      currentLevelIdx = Math.max(0, Math.min(QUALITY_LEVELS.length - 1, idx));
      applyLevel(getEffectiveLevel());
    },
    reset() {
      currentLevelIdx = limits.isMobile ? 5 : 0;
      emaFrameMs = TARGET_FRAME_MS * 0.5;
      underloadDuration = 0;
      overloadDuration = 0;
      applyLevel(getEffectiveLevel());
    },
  };
}
