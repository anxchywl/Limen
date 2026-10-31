// Delete tool: click or Backspace to delete an entity (body, block, portal, emitter).
// Deleting a portal cleans up its paired partner.
// Every deletion is fully undoable via history.

export function createDeleteTool({doc, view, sim, history, selectTool, setNotice}) {
  function deleteEntity(entity) {
    if (!entity || !entity.id) return;

    if (entity.type === 'body') {
      const b = doc.bodies.find((x) => x.id === entity.id);
      if (!b) return;
      const bodySpec = structuredClone(b);
      history.execute({
        name: 'delete_body',
        execute() {
          const idx = doc.bodies.findIndex((x) => x.id === entity.id);
          if (idx >= 0) doc.bodies.splice(idx, 1);
          sim.remove(entity.id);
          selectTool?.deselect();
          setNotice?.(`deleted body ${entity.id}`);
        },
        undo() {
          doc.bodies.push(structuredClone(bodySpec));
          sim.spawn(structuredClone(bodySpec));
          setNotice?.(`restored body ${entity.id}`);
        },
      });
    } else if (entity.type === 'block') {
      const k = doc.blocks.find((x) => x.id === entity.id);
      if (!k) return;
      const blockSpec = structuredClone(k);
      history.execute({
        name: 'delete_block',
        execute() {
          const idx = doc.blocks.findIndex((x) => x.id === entity.id);
          if (idx >= 0) doc.blocks.splice(idx, 1);
          view.level.rebuild(doc.blocks);
          sim.remove(entity.id);
          selectTool?.deselect();
          setNotice?.(`deleted block ${entity.id}`);
        },
        undo() {
          doc.blocks.push(structuredClone(blockSpec));
          view.level.rebuild(doc.blocks);
          sim.edit(structuredClone(blockSpec));
          setNotice?.(`restored block ${entity.id}`);
        },
      });
    } else if (entity.type === 'portal') {
      const p = doc.portals.find((x) => x.id === entity.id);
      if (!p) return;
      const pair = doc.portals.find((x) => x.id === p.pair);
      const pSpec = structuredClone(p);
      const pairSpec = pair ? structuredClone(pair) : null;

      history.execute({
        name: 'delete_portal',
        execute() {
          const idx1 = doc.portals.findIndex((x) => x.id === pSpec.id);
          if (idx1 >= 0) doc.portals.splice(idx1, 1);
          if (pairSpec) {
            const idx2 = doc.portals.findIndex((x) => x.id === pairSpec.id);
            if (idx2 >= 0) doc.portals.splice(idx2, 1);
          }
          view.rebuildPortals();
          sim.remove(pSpec.id);
          if (pairSpec) sim.remove(pairSpec.id);
          selectTool?.deselect();
          setNotice?.(`deleted portal pair ${pSpec.id}`);
        },
        undo() {
          doc.portals.push(structuredClone(pSpec));
          if (pairSpec) doc.portals.push(structuredClone(pairSpec));
          view.rebuildPortals();
          sim.edit(structuredClone(pSpec));
          if (pairSpec) sim.edit(structuredClone(pairSpec));
          setNotice?.(`restored portal pair ${pSpec.id}`);
        },
      });
    } else if (entity.type === 'emitter') {
      const e = (doc.emitters ?? []).find((x) => x.id === entity.id);
      if (!e) return;
      const eSpec = structuredClone(e);
      history.execute({
        name: 'delete_emitter',
        execute() {
          const idx = doc.emitters.findIndex((x) => x.id === entity.id);
          if (idx >= 0) doc.emitters.splice(idx, 1);
          selectTool?.deselect();
          setNotice?.(`deleted emitter ${entity.id}`);
        },
        undo() {
          doc.emitters ??= [];
          doc.emitters.push(structuredClone(eSpec));
          setNotice?.(`restored emitter ${entity.id}`);
        },
      });
    }
  }

  function onPointerDown(e, ray) {
    if (e.button !== 0) return;
    const hit = selectTool?.pick(ray);
    if (hit) {
      deleteEntity(hit);
    }
  }

  function deleteSelected() {
    if (selectTool?.selected) {
      deleteEntity(selectTool.selected);
    }
  }

  return {
    name: 'delete',
    deleteEntity,
    deleteSelected,
    onPointerDown,
  };
}
