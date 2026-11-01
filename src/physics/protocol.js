// Shared protocol between the main-thread physics bridge and the Rapier module worker.
// Re-exports the 16-float frame-buffer layout from core/frame.js so render and physics never drift,
// defines the worker message types, and provides the deterministic id <-> slot map with free-slot reuse.
//
// Frame Header layout (HEADER = 8 floats / 32 bytes):
//   header[0] H_STEP:       integer step count
//   header[1] H_TIME:       accumulated physics time (seconds)
//   header[2] H_COUNT:      live body count
//   header[3] H_SLOTS:      allocated slot span (0 .. span - 1)
//   header[4] H_STEP_MS:    worker physics step execution duration in ms
//   header[5] H_TRANSIT_MS: worker portal transit execution duration in ms
//   header[6] H_IN_TRANSIT: count of bodies currently in portal transit
//   header[7] H_SPARE:      reserved spare field

export * from '../core/frame.js';

export const TO_WORKER = Object.freeze({
  LOAD: 'load',
  SPAWN: 'spawn',
  REMOVE: 'remove',
  EDIT: 'edit',
  PLAY: 'play',
  PAUSE: 'pause',
  STEP: 'step',
  RESET: 'reset',
  SET_SETTINGS: 'setSettings',
  RETURN: 'return',
  INJECT_NAN: 'injectNaN',
  REMOVE_NEWEST: 'removeNewest',
});

export const FROM_WORKER = Object.freeze({
  READY: 'ready',
  FRAME: 'frame',
  EVENT: 'event',
});

// deterministic id <-> slot table; freed slots are reused lowest-first so buffers stay compact
export function createSlotMap() {
  const byId = new Map();
  let ids = [];
  let freeList = []; // sorted descending so pop() yields the lowest free slot in O(1)

  function alloc(id) {
    const existing = byId.get(id);
    if (existing !== undefined) return existing;
    const slot = freeList.length ? freeList.pop() : ids.length;
    byId.set(id, slot);
    ids[slot] = id;
    return slot;
  }

  function free(id) {
    const slot = byId.get(id);
    if (slot === undefined) return -1;
    byId.delete(id);
    ids[slot] = null;
    // insert keeping descending order so pop() always returns the smallest free index
    let i = freeList.length;
    while (i > 0 && freeList[i - 1] < slot) i--;
    freeList.splice(i, 0, slot);
    return slot;
  }

  function clear() {
    byId.clear();
    ids = [];
    freeList = [];
  }

  function snapshot() {
    return {ids: [...ids], freeList: [...freeList]};
  }

  function restore(snap) {
    byId.clear();
    ids = [...snap.ids];
    freeList = [...snap.freeList];
    for (let i = 0; i < ids.length; i++) {
      if (ids[i] !== null && ids[i] !== undefined) byId.set(ids[i], i);
    }
  }

  return {
    alloc,
    free,
    clear,
    snapshot,
    restore,
    has: (id) => byId.has(id),
    slotOf: (id) => byId.get(id) ?? -1,
    idOf: (slot) => ids[slot] ?? null,
    get count() { return byId.size; },
    get span() { return ids.length; },
  };
}

