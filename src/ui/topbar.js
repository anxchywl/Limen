// Top bar: mode toggle (Edit/Play), step button, time scale, undo/redo, reset,
// body count against 300 cap, settings button, and help button.

export function createTopBar({container, doc, sim, editor, onOpenSettings, onOpenHelp}) {
  const bar = document.createElement('div');
  bar.className = 'limen-topbar';

  bar.innerHTML = `
    <div class="topbar-left">
      <span class="limen-logo">LIMEN</span>
      <div class="mode-toggle">
        <button id="btn-mode" class="btn btn-primary" title="Toggle Edit/Play (Space)">
          <span class="icon">▶</span> <span class="label">Play</span>
        </button>
        <button id="btn-step" class="btn btn-secondary" title="Advance 1 step (.)">
          <span class="icon">⏯</span> Step
        </button>
      </div>
      <div class="timescale-group">
        <button class="btn btn-pill" data-scale="1">1×</button>
        <button class="btn btn-pill" data-scale="0.5">0.5×</button>
        <button class="btn btn-pill" data-scale="0.25">0.25×</button>
      </div>
    </div>
    <div class="topbar-right">
      <div class="history-group">
        <button id="btn-undo" class="btn btn-icon" title="Undo (Cmd+Z)">↶</button>
        <button id="btn-redo" class="btn btn-icon" title="Redo (Cmd+Shift+Z)">↷</button>
      </div>
      <button id="btn-reset" class="btn btn-secondary" title="Reset to edited snapshot (R)">
        Reset
      </button>
      <div id="body-count-badge" class="body-badge" title="Bodies / 300 max">
        ${doc.bodies.length} / 300
      </div>
      <button id="btn-settings" class="btn btn-icon" title="Settings">⚙</button>
      <button id="btn-help" class="btn btn-icon" title="Keyboard help (?)">?</button>
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
  const scaleBtns = bar.querySelectorAll('[data-scale]');

  btnMode.onclick = () => editor.toggleMode();
  btnStep.onclick = () => editor.step(1);
  btnUndo.onclick = () => editor.history.undo();
  btnRedo.onclick = () => editor.history.redo();
  btnReset.onclick = () => editor.reset();
  btnSettings.onclick = () => onOpenSettings?.();
  btnHelp.onclick = () => onOpenHelp?.();

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
      ? '<span class="icon">⏸</span> <span class="label">Edit</span>'
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
