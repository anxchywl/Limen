// Block tool: drag on a face or floor to extrude a block on the 0.5 m grid.
// Kinds: box, ramp, pillar.

import * as THREE from 'three';
import {newId} from '../../core/scene.js';

const GRID = 0.5;
const snap = (v) => Math.round(v / GRID) * GRID;

export function createBlockTool({doc, view, sim, history, cameraCtrl, setNotice}) {
  let kind = 'box'; // 'box' | 'ramp' | 'pillar'
  let dragging = false;
  let startPt = null;
  let currentPt = null;
  let hitNormal = [0, 1, 0];

  // Visual preview for the extruded block
  const previewGeo = new THREE.BoxGeometry(1, 1, 1);
  const previewMat = new THREE.MeshBasicMaterial({
    color: 0x3E7C8F,
    wireframe: true,
    transparent: true,
    opacity: 0.8,
  });
  const previewMesh = new THREE.Mesh(previewGeo, previewMat);
  previewMesh.visible = false;
  view.scene.add(previewMesh);

  // Floor plane for fallback raycasting
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  function setKind(newKind) {
    kind = newKind;
  }

  function raycastFloorOrLevel(ray) {
    const hits = [];
    // Raycast level mesh
    if (view.level?.group) {
      const raycaster = new THREE.Raycaster(ray.origin, ray.direction);
      const levelHits = raycaster.intersectObjects(view.level.group.children, true);
      if (levelHits.length > 0) {
        hits.push({
          point: levelHits[0].point,
          normal: levelHits[0].face ? levelHits[0].face.normal.clone() : new THREE.Vector3(0, 1, 0),
          dist: levelHits[0].distance,
        });
      }
    }
    // Raycast floor plane
    const pt = new THREE.Vector3();
    if (ray.intersectPlane(floorPlane, pt)) {
      hits.push({point: pt, normal: new THREE.Vector3(0, 1, 0), dist: ray.origin.distanceTo(pt)});
    }
    if (hits.length === 0) return null;
    hits.sort((a, b) => a.dist - b.dist);
    return hits[0];
  }

  function onPointerDown(e, ray) {
    if (e.button !== 0) return;
    const hit = raycastFloorOrLevel(ray);
    if (!hit) return;

    if (cameraCtrl?.controls) cameraCtrl.controls.enabled = false;
    dragging = true;
    startPt = [snap(hit.point.x), snap(hit.point.y), snap(hit.point.z)];
    currentPt = [...startPt];
    hitNormal = [hit.normal.x, hit.normal.y, hit.normal.z];
    previewMesh.visible = true;
    updatePreview();
  }

  function onPointerMove(e, ray) {
    if (!dragging) return;
    const hit = raycastFloorOrLevel(ray);
    if (!hit) return;

    currentPt = [snap(hit.point.x), snap(hit.point.y), snap(hit.point.z)];
    updatePreview();
  }

  function updatePreview() {
    if (!startPt || !currentPt) return;
    const minX = Math.min(startPt[0], currentPt[0]);
    const maxX = Math.max(startPt[0], currentPt[0]);
    const minZ = Math.min(startPt[2], currentPt[2]);
    const maxZ = Math.max(startPt[2], currentPt[2]);
    const sx = Math.max(GRID, maxX - minX);
    const sz = Math.max(GRID, maxZ - minZ);
    const sy = kind === 'pillar' ? 2.5 : 1.0;

    const cy = startPt[1] + sy / 2;
    const cx = (minX + maxX) / 2 || startPt[0] + sx / 2;
    const cz = (minZ + maxZ) / 2 || startPt[2] + sz / 2;

    previewMesh.scale.set(kind === 'pillar' ? 0.8 : sx, sy, kind === 'pillar' ? 0.8 : sz);
    previewMesh.position.set(cx, cy, cz);
    previewMesh.rotation.set(0, 0, 0);
  }

  function onPointerUp() {
    if (cameraCtrl?.controls) cameraCtrl.controls.enabled = true;
    if (!dragging) return;
    dragging = false;
    previewMesh.visible = false;

    if (!startPt || !currentPt) return;
    const minX = Math.min(startPt[0], currentPt[0]);
    const maxX = Math.max(startPt[0], currentPt[0]);
    const minZ = Math.min(startPt[2], currentPt[2]);
    const maxZ = Math.max(startPt[2], currentPt[2]);
    const sx = Math.max(GRID, maxX - minX);
    const sz = Math.max(GRID, maxZ - minZ);
    const sy = kind === 'pillar' ? 2.5 : 1.0;

    const cx = (minX + maxX) / 2 || startPt[0] + sx / 2;
    const cy = startPt[1] + sy / 2;
    const cz = (minZ + maxZ) / 2 || startPt[2] + sz / 2;

    let block;
    if (kind === 'box') {
      block = {
        id: newId(doc, 'k'),
        kind: 'box',
        min: [cx - sx / 2, startPt[1], cz - sz / 2],
        max: [cx + sx / 2, startPt[1] + sy, cz + sz / 2],
        color: null,
      };
    } else if (kind === 'ramp') {
      block = {
        id: newId(doc, 'k'),
        kind: 'ramp',
        pos: [cx, cy, cz],
        size: [Math.max(2, sx), sy, Math.max(1, sz)],
        rot: [0, 0, 0, 1],
        color: null,
      };
    } else if (kind === 'pillar') {
      block = {
        id: newId(doc, 'k'),
        kind: 'pillar',
        pos: [cx, cy, cz],
        size: [0.8, sy, 0.8],
        rot: [0, 0, 0, 1],
        color: null,
      };
    }

    startPt = null;
    currentPt = null;

    if (block) {
      history.execute({
        name: `add_${kind}`,
        execute() {
          doc.blocks.push(block);
          view.level.rebuild(doc.blocks);
          sim.edit(block);
          setNotice?.(`added ${kind}`);
        },
        undo() {
          const idx = doc.blocks.findIndex((x) => x.id === block.id);
          if (idx >= 0) doc.blocks.splice(idx, 1);
          view.level.rebuild(doc.blocks);
          sim.remove(block.id);
          setNotice?.(`removed ${kind}`);
        },
      });
    }
  }

  function dispose() {
    view.scene.remove(previewMesh);
    previewGeo.dispose();
    previewMat.dispose();
  }

  return {
    name: 'block',
    get kind() { return kind; },
    setKind,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    dispose,
  };
}
