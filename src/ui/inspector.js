// Inspector panel: displays and edits properties of the current selection
// (size, colour, mass, initial velocity, emitter rate/speed).
// Includes Duplicate and Delete action buttons.

import {newId} from '../core/scene.js';

export function createInspector({container, doc, view, sim, editor}) {
  const panel = document.createElement('div');
  panel.className = 'limen-inspector';
  panel.style.display = 'none';

  container.appendChild(panel);

  function duplicateSelected(sel) {
    if (!sel || !sel.id) return;
    if (sel.type === 'body') {
      const b = doc.bodies.find((x) => x.id === sel.id);
      if (!b) return;
      const clone = structuredClone(b);
      clone.id = newId(doc, 'b');
      clone.pos[1] += 0.6; // shift up slightly
      editor.history.execute({
        name: 'duplicate_body',
        execute() {
          doc.bodies.push(clone);
          sim.spawn(clone);
          editor.selectTool.select({type: 'body', id: clone.id, data: clone});
        },
        undo() {
          const idx = doc.bodies.findIndex((x) => x.id === clone.id);
          if (idx >= 0) doc.bodies.splice(idx, 1);
          sim.remove(clone.id);
          editor.selectTool.deselect();
        },
      });
    } else if (sel.type === 'block') {
      const k = doc.blocks.find((x) => x.id === sel.id);
      if (!k) return;
      const clone = structuredClone(k);
      clone.id = newId(doc, 'k');
      if (clone.kind === 'box') {
        clone.min[1] += 1.0;
        clone.max[1] += 1.0;
      } else {
        clone.pos[1] += 1.0;
      }
      editor.history.execute({
        name: 'duplicate_block',
        execute() {
          doc.blocks.push(clone);
          view.level.rebuild(doc.blocks);
          sim.edit(clone);
          editor.selectTool.select({type: 'block', id: clone.id, data: clone});
        },
        undo() {
          const idx = doc.blocks.findIndex((x) => x.id === clone.id);
          if (idx >= 0) doc.blocks.splice(idx, 1);
          view.level.rebuild(doc.blocks);
          sim.remove(clone.id);
          editor.selectTool.deselect();
        },
      });
    }
  }

  function render() {
    const sel = editor.selectTool.selected;
    if (!sel) {
      panel.style.display = 'none';
      panel.innerHTML = '';
      return;
    }

    panel.style.display = 'block';

    let content = `
      <div class="inspector-header">
        <span class="inspector-title">${sel.type.toUpperCase()}: ${sel.id}</span>
        <button id="insp-close" class="btn btn-icon">✕</button>
      </div>
      <div class="inspector-section">
        <div class="btn-group">
          <button id="btn-mode-translate" class="btn btn-pill active">Move</button>
          <button id="btn-mode-rotate" class="btn btn-pill">Rotate</button>
        </div>
      </div>
    `;

    if (sel.type === 'body') {
      const b = doc.bodies.find((x) => x.id === sel.id);
      if (b) {
        content += `
          <div class="inspector-section">
            <label class="insp-label">Shape: <strong>${b.shape}</strong></label>
            <div class="insp-field">
              <span>Mass (kg):</span>
              <input type="number" id="inp-mass" min="0.1" max="100" step="0.5" value="${b.mass ?? 1}">
            </div>
            <div class="insp-field">
              <span>Color:</span>
              <input type="color" id="inp-color" value="${b.color ?? '#D2432A'}">
            </div>
          </div>
        `;
      }
    } else if (sel.type === 'block') {
      const k = doc.blocks.find((x) => x.id === sel.id);
      if (k) {
        content += `
          <div class="inspector-section">
            <label class="insp-label">Kind: <strong>${k.kind ?? 'box'}</strong></label>
            <div class="insp-field">
              <span>Color:</span>
              <input type="color" id="inp-color" value="${k.color ?? '#D8CFBF'}">
            </div>
          </div>
        `;
      }
    } else if (sel.type === 'portal') {
      const p = doc.portals.find((x) => x.id === sel.id);
      if (p) {
        content += `
          <div class="inspector-section">
            <label class="insp-label">Linked Pair: <strong>${p.pair ?? 'none'}</strong></label>
            <label class="insp-label">Face: <strong>${p.face ?? '+z'}</strong></label>
            <label class="insp-label">Half-size: <strong>${p.a.toFixed(2)} × ${p.b.toFixed(2)} m</strong></label>
            <div class="insp-field">
              <span>Color:</span>
              <span class="color-dot" style="background: ${p.color}"></span>
            </div>
          </div>
        `;
      }
    } else if (sel.type === 'emitter') {
      const e = (doc.emitters ?? []).find((x) => x.id === sel.id);
      if (e) {
        content += `
          <div class="inspector-section">
            <div class="insp-field">
              <span>Rate (/s):</span>
              <input type="number" id="inp-erate" min="1" max="5" step="0.5" value="${e.rate ?? 2}">
            </div>
            <div class="insp-field">
              <span>Speed (m/s):</span>
              <input type="number" id="inp-espeed" min="1" max="10" step="1" value="${e.speed ?? 4}">
            </div>
          </div>
        `;
      }
    }

    content += `
      <div class="inspector-footer">
        <button id="btn-duplicate" class="btn btn-secondary">Duplicate</button>
        <button id="btn-delete" class="btn btn-danger">Delete</button>
      </div>
    `;

    panel.innerHTML = content;

    panel.querySelector('#insp-close').onclick = () => editor.selectTool.deselect();
    panel.querySelector('#btn-mode-translate').onclick = (e) => {
      editor.selectTool.setMode('translate');
      panel.querySelector('#btn-mode-translate').classList.add('active');
      panel.querySelector('#btn-mode-rotate').classList.remove('active');
    };
    panel.querySelector('#btn-mode-rotate').onclick = (e) => {
      editor.selectTool.setMode('rotate');
      panel.querySelector('#btn-mode-rotate').classList.add('active');
      panel.querySelector('#btn-mode-translate').classList.remove('active');
    };

    const duplicateBtn = panel.querySelector('#btn-duplicate');
    if (duplicateBtn) duplicateBtn.onclick = () => duplicateSelected(sel);

    const deleteBtn = panel.querySelector('#btn-delete');
    if (deleteBtn) deleteBtn.onclick = () => editor.deleteTool.deleteSelected();

    const inpMass = panel.querySelector('#inp-mass');
    if (inpMass) {
      inpMass.onchange = (e) => {
        const b = doc.bodies.find((x) => x.id === sel.id);
        if (b) {
          b.mass = parseFloat(e.target.value);
          sim.edit(b);
        }
      };
    }

    const inpColor = panel.querySelector('#inp-color');
    if (inpColor) {
      inpColor.onchange = (e) => {
        if (sel.type === 'body') {
          const b = doc.bodies.find((x) => x.id === sel.id);
          if (b) {
            b.color = e.target.value;
            sim.edit(b);
          }
        } else if (sel.type === 'block') {
          const k = doc.blocks.find((x) => x.id === sel.id);
          if (k) {
            k.color = e.target.value;
            view.level.rebuild(doc.blocks);
            sim.edit(k);
          }
        }
      };
    }

    const inpERate = panel.querySelector('#inp-erate');
    if (inpERate) {
      inpERate.onchange = (e) => {
        const em = (doc.emitters ?? []).find((x) => x.id === sel.id);
        if (em) em.rate = parseFloat(e.target.value);
      };
    }
    const inpESpeed = panel.querySelector('#inp-espeed');
    if (inpESpeed) {
      inpESpeed.onchange = (e) => {
        const em = (doc.emitters ?? []).find((x) => x.id === sel.id);
        if (em) em.speed = parseFloat(e.target.value);
      };
    }
  }

  editor.onChange(render);
  return {update: render, duplicateSelected};
}
