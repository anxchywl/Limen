// Keyboard help modal dialog: triggered by ? or Help button.

export function createHelpModal({container}) {
  const modal = document.createElement('div');
  modal.className = 'limen-modal';
  modal.style.display = 'none';

  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-content help-content">
      <div class="modal-header">
        <h3>Keyboard & Gestures</h3>
        <button id="help-close" class="btn btn-icon">✕</button>
      </div>
      <div class="modal-body">
        <table class="help-table">
          <tr><th>Key</th><th>Action</th></tr>
          <tr><td><kbd>Space</kbd></td><td>Toggle Edit / Play mode</td></tr>
          <tr><td><kbd>.</kbd></td><td>Advance 1 physics step while paused</td></tr>
          <tr><td><kbd>F</kbd></td><td>Toggle Orbit / Fly camera</td></tr>
          <tr><td><kbd>WASD / QE</kbd></td><td>Fly camera movement (Fly mode)</td></tr>
          <tr><td><kbd>Shift</kbd></td><td>Fly camera fast speed</td></tr>
          <tr><td><kbd>1</kbd> – <kbd>6</kbd></td><td>Tools (Select, Block, Portal, Spawn, Emitter, Delete)</td></tr>
          <tr><td><kbd>Cmd/Ctrl + Z</kbd></td><td>Undo</td></tr>
          <tr><td><kbd>Cmd/Ctrl + Shift + Z</kbd></td><td>Redo</td></tr>
          <tr><td><kbd>Backspace</kbd> / <kbd>Del</kbd></td><td>Delete selection</td></tr>
          <tr><td><kbd>R</kbd></td><td>Reset simulation to edited snapshot</td></tr>
          <tr><td><kbd>T</kbd></td><td>Cycle time scale (1×, 0.5×, 0.25×)</td></tr>
          <tr><td><kbd>?</kbd></td><td>Toggle this help overlay</td></tr>
        </table>
        <h4 style="margin: 16px 0 8px">Touch Gestures (Phones)</h4>
        <ul style="padding-left: 20px; margin: 0; line-height: 1.6;">
          <li><strong>1 finger:</strong> Orbit camera around scene</li>
          <li><strong>2 fingers:</strong> Pan and pinch-to-zoom</li>
          <li><strong>Long-press:</strong> Open context menu (Delete / Duplicate)</li>
        </ul>
      </div>
    </div>
  `;

  container.appendChild(modal);

  const closeBtn = modal.querySelector('#help-close');
  const backdrop = modal.querySelector('.modal-backdrop');

  function open() { modal.style.display = 'flex'; }
  function close() { modal.style.display = 'none'; }
  function toggle() { modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex'; }

  closeBtn.onclick = close;
  backdrop.onclick = close;

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === '?') {
      e.preventDefault();
      toggle();
    }
  });

  return {open, close, toggle};
}
