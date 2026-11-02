// Tool rail: floating bottom dock with active tool options chip.
// Features 6 primary tools with hotkeys (1-6) and sub-option chip panel.

import {PORTAL_COLOURS} from '../core/scene.js';

export function createToolRail({container, doc, editor}) {
  const rail = document.createElement('div');
  rail.className = 'limen-rail';

  rail.innerHTML = `
    <!-- Contextual sub-options drawer (floats above the dock) -->
    <div class="rail-subpanel" id="rail-subpanel"></div>

    <div class="rail-tools">
      <button class="rail-btn" data-tool="select" title="Select & Transform">
        <span class="icon">↖</span>
        <span class="text">Select</span>
      </button>
      <button class="rail-btn" data-tool="block" title="Place Static Blocks">
        <span class="icon">⬚</span>
        <span class="text">Block</span>
      </button>
      <button class="rail-btn" data-tool="portal" title="Place Linked Portals">
        <span class="icon portal-swatch">○</span>
        <span class="text">Portal</span>
      </button>
      <button class="rail-btn" data-tool="spawn" title="Spawn Dynamic Bodies">
        <span class="icon">✦</span>
        <span class="text">Spawn</span>
      </button>
      <button class="rail-btn" data-tool="emitter" title="Continuous Particle Emitter">
        <span class="icon">⊚</span>
        <span class="text">Emitter</span>
      </button>
      <button class="rail-btn" data-tool="delete" title="Delete Objects">
        <span class="icon">✕</span>
        <span class="text">Delete</span>
      </button>
    </div>
  `;

  container.appendChild(rail);

  const subpanel = rail.querySelector('#rail-subpanel');
  const toolBtns = rail.querySelectorAll('.rail-btn');

  toolBtns.forEach((btn) => {
    btn.onclick = () => {
      const tool = btn.dataset.tool;
      editor.setTool(tool);
      update();
    };
  });

  function renderSubpanel() {
    const active = editor.activeTool;
    if (active === 'block') {
      const curKind = editor.blockTool.kind;
      subpanel.innerHTML = `
        <div class="subpanel-row">
          <span class="subpanel-title">Shape:</span>
          <button class="btn btn-pill ${curKind === 'box' ? 'active' : ''}" data-kind="box">Box</button>
          <button class="btn btn-pill ${curKind === 'ramp' ? 'active' : ''}" data-kind="ramp">Ramp</button>
          <button class="btn btn-pill ${curKind === 'pillar' ? 'active' : ''}" data-kind="pillar">Pillar</button>
        </div>
      `;
      subpanel.querySelectorAll('[data-kind]').forEach((b) => {
        b.onclick = () => {
          editor.blockTool.setKind(b.dataset.kind);
          renderSubpanel();
        };
      });
      subpanel.style.display = 'flex';
    } else if (active === 'portal') {
      const pairIdx = Math.floor(doc.portals.length / 2) % PORTAL_COLOURS.length;
      const color = PORTAL_COLOURS[pairIdx];
      const pending = editor.portalTool.pending;
      subpanel.innerHTML = `
        <div class="subpanel-row">
          <span class="subpanel-title">Pair:</span>
          <span class="color-dot" style="background: ${color}"></span>
          <span class="subpanel-hint">${pending ? 'Click wall for Portal B' : 'Click wall for Portal A'}</span>
        </div>
      `;
      subpanel.style.display = 'flex';
    } else if (active === 'spawn') {
      const curShape = editor.spawnTool.shape;
      const curScale = editor.spawnTool.sizeScale;
      subpanel.innerHTML = `
        <div class="subpanel-row">
          <span class="subpanel-title">Shape:</span>
          <button class="btn btn-pill ${curShape === 'ball' ? 'active' : ''}" data-shape="ball">Ball</button>
          <button class="btn btn-pill ${curShape === 'box' ? 'active' : ''}" data-shape="box">Box</button>
          <button class="btn btn-pill ${curShape === 'capsule' ? 'active' : ''}" data-shape="capsule">Capsule</button>
          <button class="btn btn-pill ${curShape === 'plank' ? 'active' : ''}" data-shape="plank">Plank</button>
          <button class="btn btn-pill ${curShape === 'heavy_ball' ? 'active' : ''}" data-shape="heavy_ball">Heavy</button>
        </div>
        <div class="subpanel-sep"></div>
        <div class="subpanel-row">
          <span class="subpanel-title">Size:</span>
          <input type="range" id="spawn-scale" min="0.5" max="2.0" step="0.1" value="${curScale}">
          <span id="spawn-scale-val" class="subpanel-val">${curScale.toFixed(1)}×</span>
        </div>
      `;
      subpanel.querySelectorAll('[data-shape]').forEach((b) => {
        b.onclick = () => {
          editor.spawnTool.setShape(b.dataset.shape);
          renderSubpanel();
        };
      });
      const slider = subpanel.querySelector('#spawn-scale');
      slider.oninput = (e) => {
        const val = parseFloat(e.target.value);
        editor.spawnTool.setSizeScale(val);
        subpanel.querySelector('#spawn-scale-val').textContent = `${val.toFixed(1)}×`;
      };
      subpanel.style.display = 'flex';
    } else if (active === 'emitter') {
      const curShape = editor.emitterTool.shape;
      const curRate = editor.emitterTool.rate;
      const curSpeed = editor.emitterTool.speed;
      subpanel.innerHTML = `
        <div class="subpanel-row">
          <span class="subpanel-title">Shape:</span>
          <button class="btn btn-pill ${curShape === 'ball' ? 'active' : ''}" data-eshape="ball">Ball</button>
          <button class="btn btn-pill ${curShape === 'box' ? 'active' : ''}" data-eshape="box">Box</button>
          <button class="btn btn-pill ${curShape === 'heavy_ball' ? 'active' : ''}" data-eshape="heavy_ball">Heavy</button>
        </div>
        <div class="subpanel-sep"></div>
        <div class="subpanel-row">
          <span class="subpanel-title">Rate:</span>
          <input type="range" id="emitter-rate" min="1" max="5" step="0.5" value="${curRate}">
          <span id="emitter-rate-val" class="subpanel-val">${curRate}/s</span>
          <span class="subpanel-title" style="margin-left: 6px">Speed:</span>
          <input type="range" id="emitter-speed" min="1" max="10" step="1" value="${curSpeed}">
          <span id="emitter-speed-val" class="subpanel-val">${curSpeed} m/s</span>
        </div>
      `;
      subpanel.querySelectorAll('[data-eshape]').forEach((b) => {
        b.onclick = () => {
          editor.emitterTool.setShape(b.dataset.eshape);
          renderSubpanel();
        };
      });
      const rSlider = subpanel.querySelector('#emitter-rate');
      rSlider.oninput = (e) => {
        const val = parseFloat(e.target.value);
        editor.emitterTool.setRate(val);
        subpanel.querySelector('#emitter-rate-val').textContent = `${val}/s`;
      };
      const sSlider = subpanel.querySelector('#emitter-speed');
      sSlider.oninput = (e) => {
        const val = parseFloat(e.target.value);
        editor.emitterTool.setSpeed(val);
        subpanel.querySelector('#emitter-speed-val').textContent = `${val} m/s`;
      };
      subpanel.style.display = 'flex';
    } else {
      subpanel.innerHTML = '';
      subpanel.style.display = 'none';
    }
  }

  function update() {
    const active = editor.activeTool;
    toolBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === active);
    });

    const portalDot = rail.querySelector('.portal-swatch');
    if (portalDot) {
      const pairIdx = Math.floor(doc.portals.length / 2) % PORTAL_COLOURS.length;
      portalDot.style.color = PORTAL_COLOURS[pairIdx];
    }

    renderSubpanel();
  }

  editor.onChange(update);
  update();

  return {update};
}
