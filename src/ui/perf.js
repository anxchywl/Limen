// Performance stats overlay for Limen.
// Toggled with the backtick (`) key.
// Shows rolling 2 s statistics: p50/p95 frame time, phase breakdown, GPU time,
// worker physics step/transit times, portal recursion depth, views, and active quality.

export function createPerfOverlay({container, stats, quality, sim, view}) {
  const root = document.createElement('div');
  root.id = 'limen-perf-overlay';
  root.style.cssText = `
    display: none;
    position: fixed;
    top: 54px;
    right: 10px;
    background: rgba(36, 29, 24, 0.92);
    color: #F7F1E9;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    line-height: 1.45;
    padding: 10px 14px;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    z-index: 150;
    pointer-events: none;
    user-select: none;
    min-width: 250px;
    border: 1px solid rgba(255, 255, 255, 0.15);
  `;

  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-weight: 700; color: #E8A850; margin-bottom: 6px; letter-spacing: 0.5px;';
  titleEl.textContent = 'LIMEN PERFORMANCE METRICS';
  root.appendChild(titleEl);

  const contentEl = document.createElement('div');
  root.appendChild(contentEl);

  let visible = false;
  let updateTimer = 0;

  function toggle(forced) {
    visible = typeof forced === 'boolean' ? forced : !visible;
    root.style.display = visible ? 'block' : 'none';
  }

  function update() {
    if (!visible) return;
    const m = stats.getMetrics();
    const qLvl = quality?.level;
    const qMode = quality?.mode ?? 'auto';
    const gpu = m.gpu.p50 > 0 ? `${m.gpu.p50.toFixed(2)} ms (p95 ${m.gpu.p95.toFixed(2)})` : 'n/a';
    const dpr = view?.renderer?.getPixelRatio?.()?.toFixed(2) ?? '1.0';

    contentEl.innerHTML = `
      <div style="border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px; margin-bottom: 4px;">
        <div><b>Frame CPU (2s):</b> p50 ${m.cpu.p50.toFixed(2)} ms · p95 ${m.cpu.p95.toFixed(2)} ms (max ${m.cpu.max.toFixed(1)})</div>
        <div><b>Frame GPU:</b> ${gpu}</div>
      </div>
      <div style="border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px; margin-bottom: 4px; color: #C8BEAF;">
        <div>· Interp: ${m.interp.p50.toFixed(2)} ms</div>
        <div>· Upload: ${m.upload.p50.toFixed(2)} ms</div>
        <div>· Passes: ${m.passes.p50.toFixed(2)} ms</div>
        <div>· UI work: ${m.ui.p50.toFixed(2)} ms</div>
      </div>
      <div style="border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px; margin-bottom: 4px;">
        <div><b>Worker Physics:</b> p50 ${m.workerStep.p50.toFixed(2)} ms · p95 ${m.workerStep.p95.toFixed(2)} ms</div>
        <div>· Transit time: p50 ${m.workerTransit.p50.toFixed(2)} ms</div>
        <div>· In transit: <b>${m.inTransit}</b> bodies (live ${m.bodies})</div>
        <div>· Worker status: ${sim?.busy ? '<span style="color:#FF6B6B">BUSY</span>' : '<span style="color:#6BCB77">OK</span>'}</div>
      </div>
      <div>
        <div><b>Portals:</b> views ${m.views} · depth ${m.depth}</div>
        <div><b>Quality:</b> ${qMode} (${qLvl?.name ?? 'standard'}) · DPR ${dpr}</div>
      </div>
    `;
  }

  const targetContainer = container || document.body;
  targetContainer.appendChild(root);

  updateTimer = setInterval(update, 200);

  // Toggle on backtick (`)
  const onKeyDown = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === '`' || e.code === 'Backquote') {
      e.preventDefault();
      toggle();
      update();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  return {
    toggle,
    show: () => toggle(true),
    hide: () => toggle(false),
    update,
    get visible() { return visible; },
    dispose() {
      clearInterval(updateTimer);
      window.removeEventListener('keydown', onKeyDown);
      root.remove();
    },
  };
}
