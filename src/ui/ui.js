// Master UI coordinator: mounts top bar, tool rail, inspector, settings,
// help modal, mobile context menu, and floating toast notices.

import {createTopBar} from './topbar.js';
import {createToolRail} from './rail.js';
import {createInspector} from './inspector.js';
import {createSettingsModal} from './settings.js';
import {createHelpModal} from './help.js';
import {createContextMenu} from './contextmenu.js';

export function createUI({doc, view, sim, editor}) {
  let root = document.querySelector('#limen-ui');
  if (!root) {
    root = document.createElement('div');
    root.id = 'limen-ui';
    document.body.appendChild(root);
  }

  // Toast notice container
  const toastEl = document.createElement('div');
  toastEl.className = 'limen-toast';
  root.appendChild(toastEl);

  let toastTimer = 0;
  function showNotice(text, ms = 2500) {
    toastEl.textContent = text;
    toastEl.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('visible');
    }, ms);
  }

  // Modals
  const settingsModal = createSettingsModal({container: root, doc, view, sim});
  const helpModal = createHelpModal({container: root});

  // Top bar
  const topbar = createTopBar({
    container: root,
    doc,
    sim,
    editor,
    onOpenSettings: () => settingsModal.open(),
    onOpenHelp: () => helpModal.open(),
  });

  // Tool rail
  const rail = createToolRail({
    container: root,
    doc,
    editor,
  });

  // Inspector
  const inspector = createInspector({
    container: root,
    doc,
    view,
    sim,
    editor,
  });

  // Mobile context menu
  const contextMenu = createContextMenu({
    container: root,
    view,
    editor,
    inspector,
  });

  return {
    showNotice,
    settingsModal,
    helpModal,
    inspector,
    update() {
      topbar.update();
      rail.update();
      inspector.update();
    },
  };
}
