// Top bar: floating control pill with mode toggle (Edit/Play), step button,
// time scale, quick actions (Gallery, Share, Reset), body badge, history, and overflow menu.

export function createTopBar({
  container, doc, sim, editor,
  onOpenSettings, onOpenHelp, onOpenGallery, onShare, onOpenFile, onSaveFile, onNewScene,
}) {
  const bar = document.createElement('div');
  bar.className = 'limen-topbar';

  bar.innerHTML = `
    <div class="topbar-left">
      <span class="limen-logo">LIMEN</span>
      <div class="topbar-sep"></div>
      <div class="mode-toggle">
        <button id="btn-mode" class="btn btn-primary" title="Toggle Edit/Play (Space)">
          <span class="icon">▶</span> <span class="label">Play</span>
        </button>
        <button id="btn-step" class="btn btn-icon btn-secondary" title="Advance 1 step (.)">
          <span class="icon">⏭</span>
        </button>
      </div>
      <div class="timescale-group">
        <button class="btn btn-pill" data-scale="1" title="Normal speed">1×</button>
        <button class="btn btn-pill" data-scale="0.5" title="Half speed">0.5×</button>
        <button class="btn btn-pill" data-scale="0.25" title="Quarter speed">0.25×</button>
      </div>
    </div>

    <div class="topbar-center">
      <div class="io-group">
        <button id="btn-gallery" class="btn btn-secondary btn-pill" title="Browse example scenes">
          <span class="icon">✦</span> <span>Gallery</span>
        </button>
        <button id="btn-share" class="btn btn-secondary btn-pill" title="Copy shareable link">
          <span class="icon">↗</span> <span>Share</span>
        </button>
        <button id="btn-reset" class="btn btn-secondary btn-pill" title="Reset scene to initial state (R)">
          <span class="icon">↺</span> <span>Reset</span>
        </button>
      </div>
    </div>

    <div class="topbar-right">
      <div class="history-group">
        <button id="btn-undo" class="btn btn-icon btn-secondary" title="Undo (Cmd+Z)">↶</button>
        <button id="btn-redo" class="btn btn-icon btn-secondary" title="Redo (Cmd+Shift+Z)">↷</button>
      </div>

      <div id="body-count-badge" class="body-badge" title="Bodies / 300 max">
        ${doc.bodies.length} / 300
      </div>

      <div class="topbar-sep"></div>

      <button id="btn-settings" class="btn btn-icon btn-secondary" title="Simulation & Rendering Settings">⚙</button>
      <button id="btn-help" class="btn btn-icon btn-secondary" title="Keyboard & Controls Help (?)">?</button>

      <!-- Overflow dropdown for File operations -->
      <div class="more-menu-wrapper">
        <button id="btn-more" class="btn btn-icon btn-secondary" title="More options (File I/O)">•••</button>
        <div class="more-menu-dropdown" id="topbar-dropdown" style="display: none;">
          <button id="btn-new" class="dropdown-item"><span>➕ New Empty Scene</span></button>
          <button id="btn-open" class="dropdown-item"><span>📁 Open Scene File…</span></button>
          <button id="btn-save" class="dropdown-item"><span>💾 Save Scene File</span></button>
        </div>
      </div>
    </div>
  `;

  container.appendChild(bar);

  const btnMode = bar.querySelector('#btn-mode');
  const btnStep = bar.querySelector('#btn-step');
  const btnUndo = bar.querySelector('#btn-undo');
  const btnRedo = bar.querySelector('#btn-redo');
  const btnReset = bar.querySelector('#btn-reset');
  const badge = bar.querySelector('#body-count-badge');
  const btnSettings = bar.querySelector('#btn-settings');
  const btnHelp = bar.querySelector('#btn-help');
  const btnGallery = bar.querySelector('#btn-gallery');
  const btnShare = bar.querySelector('#btn-share');
  const btnOpen = bar.querySelector('#btn-open');
  const btnSave = bar.querySelector('#btn-save');
  const btnNew = bar.querySelector('#btn-new');
  const btnMore = bar.querySelector('#btn-more');
  const dropdown = bar.querySelector('#topbar-dropdown');
  const scaleBtns = bar.querySelectorAll('[data-scale]');

  btnMode.onclick = () => editor.toggleMode();
  btnStep.onclick = () => editor.step(1);
  btnUndo.onclick = () => editor.history.undo();
  btnRedo.onclick = () => editor.history.redo();
  btnReset.onclick = () => editor.reset();
  btnSettings.onclick = () => onOpenSettings?.();
  btnHelp.onclick = () => onOpenHelp?.();
  btnGallery.onclick = () => onOpenGallery?.();
  btnShare.onclick = () => onShare?.();

  btnMore.onclick = (e) => {
    e.stopPropagation();
    const isShown = dropdown.style.display !== 'none';
    dropdown.style.display = isShown ? 'none' : 'flex';
  };

  btnOpen.onclick = () => {
    dropdown.style.display = 'none';
    onOpenFile?.();
  };
  btnSave.onclick = () => {
    dropdown.style.display = 'none';
    onSaveFile?.();
  };
  btnNew.onclick = () => {
    dropdown.style.display = 'none';
    onNewScene?.();
  };

  document.addEventListener('click', (e) => {
    if (!bar.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });

  scaleBtns.forEach((btn) => {
    btn.onclick = () => {
      const scale = parseFloat(btn.dataset.scale);
      editor.setTimeScale(scale);
      update();
    };
  });

  function update() {
    const isPlay = editor.mode === 'play';
    btnMode.innerHTML = isPlay
      ? '<span class="icon">⏸</span> <span class="label">Pause</span>'
      : '<span class="icon">▶</span> <span class="label">Play</span>';
    btnMode.classList.toggle('active', isPlay);
    btnStep.disabled = isPlay;

    btnUndo.disabled = !editor.history.canUndo;
    btnRedo.disabled = !editor.history.canRedo;

    const curScale = doc.settings.timeScale ?? 1;
    scaleBtns.forEach((b) => {
      b.classList.toggle('active', Math.abs(parseFloat(b.dataset.scale) - curScale) < 0.05);
    });

    const count = sim.count || doc.bodies.length;
    badge.textContent = `${count} / 300`;
    badge.classList.toggle('limit-reached', count >= 300);
  }

  editor.onChange(update);
  editor.history.onChange(update);
  setInterval(update, 250);
  update();

  return {update};
}
