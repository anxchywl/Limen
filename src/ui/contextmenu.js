// Mobile long-press context menu: delete, duplicate.

export function createContextMenu({container, view, editor, inspector}) {
  const menu = document.createElement('div');
  menu.className = 'limen-context-menu';
  menu.style.display = 'none';

  menu.innerHTML = `
    <button class="ctx-item" id="ctx-duplicate">Duplicate</button>
    <button class="ctx-item text-danger" id="ctx-delete">Delete</button>
    <button class="ctx-item" id="ctx-cancel">Cancel</button>
  `;

  container.appendChild(menu);

  let touchTimer = 0;
  let startX = 0, startY = 0;
  const canvas = view.renderer.domElement;

  function show(x, y) {
    menu.style.left = `${Math.min(window.innerWidth - 130, Math.max(10, x))}px`;
    menu.style.top = `${Math.min(window.innerHeight - 150, Math.max(10, y))}px`;
    menu.style.display = 'flex';
  }

  function hide() {
    menu.style.display = 'none';
  }

  menu.querySelector('#ctx-duplicate').onclick = () => {
    hide();
    const sel = editor.selectTool.selected;
    if (sel) inspector.duplicateSelected?.(sel);
  };

  menu.querySelector('#ctx-delete').onclick = () => {
    hide();
    editor.deleteTool.deleteSelected();
  };

  menu.querySelector('#ctx-cancel').onclick = hide;
  window.addEventListener('pointerdown', (e) => {
    if (!menu.contains(e.target)) hide();
  });

  // Touch handlers for long-press
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) {
      clearTimeout(touchTimer);
      return;
    }
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    clearTimeout(touchTimer);
    touchTimer = setTimeout(() => {
      // Find what's under touch
      const rect = canvas.getBoundingClientRect();
      const mouse = {
        x: ((startX - rect.left) / rect.width) * 2 - 1,
        y: -((startY - rect.top) / rect.height) * 2 + 1,
      };
      const THREE = window.THREE ?? view.THREE;
      if (editor.selectTool) {
        // synthesize ray
        const raycaster = new (view.camera.constructor.name === 'PerspectiveCamera' ? view.camera.constructor : Object)(view.camera);
        // or using active ray
        const hit = editor.selectTool.selected;
        if (hit) {
          show(startX, startY);
        }
      }
    }, 550);
  }, {passive: true});

  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length > 0) {
      const t = e.touches[0];
      if (Math.hypot(t.clientX - startX, t.clientY - startY) > 10) {
        clearTimeout(touchTimer);
      }
    }
  }, {passive: true});

  canvas.addEventListener('touchend', () => clearTimeout(touchTimer), {passive: true});
  canvas.addEventListener('touchcancel', () => clearTimeout(touchTimer), {passive: true});

  return {show, hide};
}
