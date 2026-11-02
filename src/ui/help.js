// Controls modal dialog: clean, crisp, zero-water shortcut reference.

export function createHelpModal({container}) {
  const modal = document.createElement('div');
  modal.className = 'limen-modal';
  modal.style.display = 'none';

  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-content help-content">
      <div class="modal-header">
        <h3>Controls</h3>
        <button id="help-close" class="btn btn-icon" title="Close">✕</button>
      </div>
      <div class="modal-body">
        <div class="help-section">
          <div class="help-section-title">Navigation & View</div>
          <div class="help-grid">
            <div class="help-row">
              <span class="help-keys"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span>
              <span class="help-desc">Move</span>
            </div>
            <div class="help-row highlight-row">
              <span class="help-keys"><kbd>E</kbd> / <kbd>Q</kbd></span>
              <span class="help-desc"><strong>Go Up / Below</strong></span>
            </div>
            <div class="help-row">
              <span class="help-keys"><kbd>2 Fingers</kbd></span>
              <span class="help-desc">Orbit camera</span>
            </div>
            <div class="help-row">
              <span class="help-keys"><kbd>Pinch / Scroll</kbd></span>
              <span class="help-desc">Zoom in & out</span>
            </div>
            <div class="help-row">
              <span class="help-keys"><kbd>Shift</kbd></span>
              <span class="help-desc">Boost speed</span>
            </div>
            <div class="help-row">
              <span class="help-keys"><kbd>F</kbd></span>
              <span class="help-desc">Fly mode</span>
            </div>
          </div>
        </div>

        <div class="help-section">
          <div class="help-section-title">Actions</div>
          <div class="help-grid">
            <div class="help-row">
              <span class="help-keys"><kbd>Space</kbd></span>
              <span class="help-desc">Play / Pause</span>
            </div>
            <div class="help-row">
              <span class="help-keys"><kbd>.</kbd></span>
              <span class="help-desc">Advance 1 step</span>
            </div>
            <div class="help-row">
              <span class="help-keys"><kbd>⌘Z</kbd> / <kbd>⇧⌘Z</kbd></span>
              <span class="help-desc">Undo / Redo</span>
            </div>
            <div class="help-row">
              <span class="help-keys"><kbd>R</kbd></span>
              <span class="help-desc">Reset scene</span>
            </div>
            <div class="help-row">
              <span class="help-keys"><kbd>Backspace</kbd></span>
              <span class="help-desc">Delete selected</span>
            </div>
          </div>
        </div>

        <div class="help-section">
          <div class="help-section-title">Touch Gestures</div>
          <div class="help-grid">
            <div class="help-row">
              <span class="help-keys">1 finger</span>
              <span class="help-desc">Orbit</span>
            </div>
            <div class="help-row">
              <span class="help-keys">2 fingers</span>
              <span class="help-desc">Pan & pinch zoom</span>
            </div>
            <div class="help-row">
              <span class="help-keys">Long-press</span>
              <span class="help-desc">Context menu</span>
            </div>
          </div>
        </div>
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
