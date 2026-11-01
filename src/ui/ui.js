// Master UI coordinator: mounts top bar, tool rail, inspector, settings,
// help modal, gallery modal, mobile context menu, file drag-and-drop, and toast notices.

import {createTopBar} from './topbar.js';
import {createToolRail} from './rail.js';
import {createInspector} from './inspector.js';
import {createSettingsModal} from './settings.js';
import {createHelpModal} from './help.js';
import {createGalleryModal} from './gallery.js';
import {createContextMenu} from './contextmenu.js';
import {setupDropZone, openFilePicker, saveFile} from '../io/file.js';
import {copyShareLink} from '../io/share.js';

export function createUI({
  doc, view, sim, editor,
  onLoadScene, onNewScene,
}) {
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
  const galleryModal = createGalleryModal({
    container: root,
    onLoadScene(newDoc, title) {
      onLoadScene?.(newDoc, title);
    },
    setNotice: showNotice,
  });

  // Top bar
  const topbar = createTopBar({
    container: root,
    doc,
    sim,
    editor,
    onOpenSettings: () => settingsModal.open(),
    onOpenHelp: () => helpModal.open(),
    onOpenGallery: () => galleryModal.open(),
    async onShare() {
      try {
        const res = await copyShareLink(doc);
        if (res.copied) {
          showNotice(res.warning ? `Link copied! ${res.warning}` : 'Share link copied to clipboard!');
        } else {
          prompt('Copy share URL:', res.url);
        }
      } catch (err) {
        showNotice(`Failed to share: ${err.message}`);
      }
    },
    onOpenFile() {
      openFilePicker(
        (newDoc, name) => {
          onLoadScene?.(newDoc, name);
          showNotice(`Opened ${name}`);
        },
        (err) => showNotice(err)
      );
    },
    onSaveFile() {
      saveFile(doc, 'scene.limen.json');
      showNotice('Saved scene.limen.json');
    },
    onNewScene() {
      onNewScene?.();
    },
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

  // Setup file drag-and-drop on the canvas
  setupDropZone(
    view.renderer.domElement,
    (newDoc, name) => {
      onLoadScene?.(newDoc, name);
      showNotice(`Loaded ${name}`);
    },
    (err) => showNotice(err)
  );

  return {
    showNotice,
    settingsModal,
    helpModal,
    galleryModal,
    inspector,
    update() {
      topbar.update();
      rail.update();
      inspector.update();
    },
  };
}
