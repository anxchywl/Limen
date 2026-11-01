// Settings modal panel: gravity (on, off, low), terminal speed,
// quality (auto, high, low), recursion depth slider (1–8), and trails on/off.

export function createSettingsModal({container, doc, view, sim, quality, perfOverlay, onRunChaos}) {
  const modal = document.createElement('div');
  modal.className = 'limen-modal';
  modal.style.display = 'none';

  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-content">
      <div class="modal-header">
        <h3>Settings</h3>
        <button id="modal-close" class="btn btn-icon">✕</button>
      </div>
      <div class="modal-body">
        <div class="setting-row">
          <label class="setting-label">Gravity:</label>
          <div class="btn-group" id="gravity-group">
            <button class="btn btn-pill" data-grav="on">On (-9.8)</button>
            <button class="btn btn-pill" data-grav="low">Low (-2.5)</button>
            <button class="btn btn-pill" data-grav="off">Off (0.0)</button>
          </div>
        </div>

        <div class="setting-row">
          <label class="setting-label">Terminal Speed:</label>
          <input type="range" id="term-speed" min="10" max="80" step="5" value="${doc.settings.terminalSpeed ?? 40}">
          <span id="term-speed-val">${doc.settings.terminalSpeed ?? 40} m/s</span>
        </div>

        <div class="setting-row">
          <label class="setting-label">Quality:</label>
          <div class="btn-group" id="quality-group">
            <button class="btn btn-pill" data-qual="auto">Auto</button>
            <button class="btn btn-pill" data-qual="high">High</button>
            <button class="btn btn-pill" data-qual="low">Low</button>
          </div>
        </div>

        <div class="setting-row">
          <label class="setting-label">Recursion Depth:</label>
          <input type="range" id="depth-slider" min="1" max="8" step="1" value="${view.budget?.maxDepth ?? 4}">
          <span id="depth-val">${view.budget?.maxDepth ?? 4}</span>
        </div>

        <div class="setting-row">
          <label class="setting-label">Motion Trails:</label>
          <input type="checkbox" id="trails-check" ${doc.settings.trails ? 'checked' : ''}>
        </div>

        <div class="setting-row" style="margin-top: 14px; border-top: 1px solid var(--paper-border); padding-top: 12px;">
          <label class="setting-label">Diagnostics:</label>
          <div style="display: flex; gap: 8px;">
            <button id="toggle-perf-btn" class="btn btn-secondary">Stats Overlay (\`)</button>
            <button id="chaos-btn" class="btn btn-danger">Chaos Test</button>
          </div>
        </div>
      </div>
    </div>
  `;

  container.appendChild(modal);

  const closeBtn = modal.querySelector('#modal-close');
  const backdrop = modal.querySelector('.modal-backdrop');
  const termSlider = modal.querySelector('#term-speed');
  const termVal = modal.querySelector('#term-speed-val');
  const depthSlider = modal.querySelector('#depth-slider');
  const depthVal = modal.querySelector('#depth-val');
  const trailsCheck = modal.querySelector('#trails-check');
  const togglePerfBtn = modal.querySelector('#toggle-perf-btn');
  const chaosBtn = modal.querySelector('#chaos-btn');

  togglePerfBtn.onclick = () => {
    perfOverlay?.toggle();
    close();
  };

  chaosBtn.onclick = () => {
    close();
    onRunChaos?.();
  };

  function open() {
    updateUI();
    modal.style.display = 'flex';
  }

  function close() {
    modal.style.display = 'none';
  }

  closeBtn.onclick = close;
  backdrop.onclick = close;

  function updateUI() {
    const gy = doc.settings.gravity?.[1] ?? -9.81;
    modal.querySelectorAll('#gravity-group button').forEach((b) => {
      const mode = b.dataset.grav;
      const active = (mode === 'on' && gy < -5) || (mode === 'low' && gy >= -5 && gy < -0.1) || (mode === 'off' && Math.abs(gy) <= 0.1);
      b.classList.toggle('active', active);
    });

    const qual = doc.settings.quality ?? 'auto';
    modal.querySelectorAll('#quality-group button').forEach((b) => {
      b.classList.toggle('active', b.dataset.qual === qual);
    });

    termSlider.value = doc.settings.terminalSpeed ?? 40;
    termVal.textContent = `${doc.settings.terminalSpeed ?? 40} m/s`;

    depthSlider.value = view.budget?.maxDepth ?? 4;
    depthVal.textContent = view.budget?.maxDepth ?? 4;

    trailsCheck.checked = Boolean(doc.settings.trails);
  }

  modal.querySelectorAll('#gravity-group button').forEach((b) => {
    b.onclick = () => {
      const mode = b.dataset.grav;
      let grav = [0, -9.81, 0];
      if (mode === 'low') grav = [0, -2.5, 0];
      else if (mode === 'off') grav = [0, 0, 0];
      doc.settings.gravity = grav;
      sim.setSettings({gravity: grav});
      updateUI();
    };
  });

  modal.querySelectorAll('#quality-group button').forEach((b) => {
    b.onclick = () => {
      const q = b.dataset.qual;
      doc.settings.quality = q;
      quality?.setMode(q);
      sim.setSettings({quality: q});
      updateUI();
    };
  });

  termSlider.oninput = (e) => {
    const val = parseFloat(e.target.value);
    doc.settings.terminalSpeed = val;
    sim.setSettings({terminalSpeed: val});
    termVal.textContent = `${val} m/s`;
  };

  depthSlider.oninput = (e) => {
    const val = parseInt(e.target.value, 10);
    view.budget.maxDepth = val;
    depthVal.textContent = val;
  };

  trailsCheck.onchange = (e) => {
    doc.settings.trails = e.target.checked;
  };

  return {open, close};
}
