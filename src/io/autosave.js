// Autosave coordinator: debounced 1 s persistence to localStorage.
// Gracefully handles disabled or quota-exceeded storage.

import {toJSON, fromJSON} from './serialize.js';

const AUTOSAVE_KEY = 'limen_autosave_scene';
const DEBOUNCE_MS = 1000;

export function createAutosave(getDoc) {
  let timer = 0;

  function trigger() {
    clearTimeout(timer);
    timer = setTimeout(saveImmediate, DEBOUNCE_MS);
  }

  function saveImmediate() {
    clearTimeout(timer);
    try {
      const doc = typeof getDoc === 'function' ? getDoc() : getDoc;
      if (!doc) return;
      const json = toJSON(doc, 0);
      localStorage.setItem(AUTOSAVE_KEY, json);
    } catch (_) {
      // Ignore localStorage errors (private window, quota, etc.)
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      const res = fromJSON(raw);
      if (res.ok) return res.doc;
    } catch (_) {}
    return null;
  }

  function clear() {
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch (_) {}
  }

  return {
    trigger,
    saveImmediate,
    load,
    clear,
  };
}
