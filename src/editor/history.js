// Command pattern history with undo and redo.
// History depth is capped at 200 commands.
// Notifies listeners whenever the stack changes.

export function createHistory(maxDepth = 200) {
  const undoStack = [];
  const redoStack = [];
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) fn();
  }

  function execute(cmd) {
    if (!cmd || typeof cmd.execute !== 'function' || typeof cmd.undo !== 'function') {
      throw new Error('History command must have execute() and undo() functions');
    }
    cmd.execute();
    undoStack.push(cmd);
    redoStack.length = 0;
    if (undoStack.length > maxDepth) {
      undoStack.shift();
    }
    notify();
  }

  function undo() {
    if (undoStack.length === 0) return false;
    const cmd = undoStack.pop();
    cmd.undo();
    redoStack.push(cmd);
    notify();
    return true;
  }

  function redo() {
    if (redoStack.length === 0) return false;
    const cmd = redoStack.pop();
    if (typeof cmd.redo === 'function') cmd.redo();
    else cmd.execute();
    undoStack.push(cmd);
    notify();
    return true;
  }

  function clear() {
    undoStack.length = 0;
    redoStack.length = 0;
    notify();
  }

  return {
    execute,
    undo,
    redo,
    clear,
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    get undoCount() { return undoStack.length; },
    get redoCount() { return redoStack.length; },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
