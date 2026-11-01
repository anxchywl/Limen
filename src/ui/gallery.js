// Gallery modal: browse and load built-in example scenes showing off portals.

import {fromJSON} from '../io/serialize.js';

export function createGalleryModal({container, onLoadScene, setNotice}) {
  const modal = document.createElement('div');
  modal.className = 'limen-modal';
  modal.style.display = 'none';

  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-content gallery-content">
      <div class="modal-header">
        <h3>Example Scenes Gallery</h3>
        <button id="gallery-close" class="btn btn-icon">✕</button>
      </div>
      <div class="modal-body gallery-grid" id="gallery-list">
        <div style="font-size: 13px; color: var(--ink-light);">Loading scenes...</div>
      </div>
    </div>
  `;

  container.appendChild(modal);

  const closeBtn = modal.querySelector('#gallery-close');
  const backdrop = modal.querySelector('.modal-backdrop');
  const listEl = modal.querySelector('#gallery-list');

  let catalog = null;

  async function loadCatalog() {
    if (catalog) return catalog;
    try {
      const res = await fetch('scenes/index.json');
      catalog = await res.json();
      renderCatalog(catalog);
    } catch (err) {
      listEl.innerHTML = `<div style="color: var(--danger)">Failed to load gallery catalog: ${err.message}</div>`;
    }
    return catalog;
  }

  function renderCatalog(items) {
    listEl.innerHTML = '';
    for (const item of items) {
      const card = document.createElement('div');
      card.className = 'gallery-card';
      card.innerHTML = `
        <div class="gallery-card-header">
          <strong class="gallery-card-title">${item.title}</strong>
        </div>
        <p class="gallery-card-desc">${item.description}</p>
        <button class="btn btn-secondary btn-load" style="width: 100%; margin-top: 6px;">Load Scene</button>
      `;

      card.querySelector('.btn-load').onclick = async () => {
        try {
          const res = await fetch(item.file);
          const text = await res.text();
          const parsed = fromJSON(text);
          if (parsed.ok) {
            onLoadScene?.(parsed.doc, item.title);
            close();
            setNotice?.(`Loaded ${item.title}`);
          } else {
            setNotice?.(`Failed to load ${item.title}: ${parsed.error}`);
          }
        } catch (err) {
          setNotice?.(`Error loading scene: ${err.message}`);
        }
      };

      listEl.appendChild(card);
    }
  }

  function open() {
    loadCatalog();
    modal.style.display = 'flex';
  }

  function close() {
    modal.style.display = 'none';
  }

  closeBtn.onclick = close;
  backdrop.onclick = close;

  return {open, close};
}
