// File download, upload, and drag-and-drop handling for .limen.json scenes.

import {toJSON, fromJSON} from './serialize.js';

export function saveFile(doc, filename = 'scene.limen.json') {
  const json = toJSON(doc, 2);
  const blob = new Blob([json], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function openFilePicker(onLoad, onError) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.limen.json,application/json';
  input.style.display = 'none';

  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = fromJSON(text);
      if (res.ok) {
        onLoad?.(res.doc, file.name);
      } else {
        onError?.(res.error || 'Invalid scene file');
      }
    } catch (err) {
      onError?.(`Failed to read file: ${err.message}`);
    } finally {
      input.remove();
    }
  };

  document.body.appendChild(input);
  input.click();
}

export function setupDropZone(targetElement, onLoad, onError) {
  if (!targetElement) return;

  targetElement.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  targetElement.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      onError?.('Only .json or .limen.json files are supported');
      return;
    }

    try {
      const text = await file.text();
      const res = fromJSON(text);
      if (res.ok) {
        onLoad?.(res.doc, file.name);
      } else {
        onError?.(res.error || 'Invalid scene file');
      }
    } catch (err) {
      onError?.(`Failed to open dropped file: ${err.message}`);
    }
  });
}
