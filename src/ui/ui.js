// Master UI coordinator: mounts top bar, tool rail, inspector, settings,
// help modal, gallery modal, mobile context menu, file drag-and-drop, and toast notices.

import {createTopBar} from './topbar.js';
import {createToolRail} from './rail.js';
import {createInspector} from './inspector.js';
import {createSettingsModal} from './settings.js';
import {createHelpModal} from './help.js';
import {createGalleryModal} from './gallery.js';
import {createContextMenu} from './contextmenu.js';
import {createPerfOverlay} from './perf.js';
import {setupDropZone, openFilePicker, saveFile} from '../io/file.js';
import {copyShareLink} from '../io/share.js';

export function createUI({
  doc, view, sim, editor, quality, stats,
  onRunChaos, onLoadScene, onNewScene,
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

  // Floating controls HUD helper
  const hudHint = document.createElement('div');
  hudHint.className = 'limen-hud-hint';
  hudHint.innerHTML = `
    <span class="hud-item"><kbd>WASD</kbd> Move</span>
    <span class="hud-sep">·</span>
    <span class="hud-item">Drag to Orbit</span>
    <span class="hud-sep">·</span>
    <span class="hud-item"><kbd>Space</kbd> Play</span>
  `;
  root.appendChild(hudHint);

  let toastTimer = 0;
  function showNotice(text, ms = 2500) {
    toastEl.textContent = text;
    toastEl.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('visible');
    }, ms);
  }

  // Busy watchdog banner
  const busyBanner = document.createElement('div');
  busyBanner.className = 'limen-busy-banner';
  busyBanner.style.cssText = `
    display: none;
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: #D2432A;
    color: #FFF;
    padding: 8px 16px;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    z-index: 200;
    font-size: 13px;
    font-weight: 500;
    align-items: center;
    gap: 12px;
  `;
  busyBanner.innerHTML = `
    <span>⚠️ Simulation busy</span>
    <button id="busy-remove-btn" class="btn btn-pill" style="background:#FFF; color:#D2432A; font-weight:700; border:none; cursor:pointer;">Remove 50 newest bodies</button>
    <button id="busy-dismiss-btn" class="btn btn-icon" style="background:transparent; color:#FFF; border:none; font-size:16px; cursor:pointer;">✕</button>
  `;
  root.appendChild(busyBanner);

  busyBanner.querySelector('#busy-remove-btn').onclick = () => {
    sim.removeNewest(50);
    showNotice('Removed 50 newest bodies');
    busyBanner.style.display = 'none';
  };
  busyBanner.querySelector('#busy-dismiss-btn').onclick = () => {
    busyBanner.style.display = 'none';
  };

  function setBusy(isBusy) {
    busyBanner.style.display = isBusy ? 'inline-flex' : 'none';
  }

  // Performance overlay
  const perfOverlay = stats ? createPerfOverlay({container: root, stats, quality, sim, view}) : null;

  // Modals
  const settingsModal = createSettingsModal({
    container: root, doc, view, sim, quality, perfOverlay, onRunChaos,
  });
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
    setBusy,
    perfOverlay,
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
