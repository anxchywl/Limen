// Select tool: click to pick a body, block, portal, or emitter.
// Move and rotate with vendored TransformControls.
// Blocks snap to a 0.5 m grid and 90° (ramps 45°).
// Raycasting uses instance bounds rather than per-triangle tests across 300 bodies.

import * as THREE from 'three';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {frame, inside, local} from '../../core/portal.js';

export function createSelectTool({doc, view, sim, history, cameraCtrl, onSelectionChange, setNotice}) {
  const transform = new TransformControls(view.camera, view.renderer.domElement);
  transform.size = 0.75;
  transform.space = 'world';
  view.scene.add(transform.getHelper());

  // Dummy object to attach transform controls to
  const dummy = new THREE.Object3D();
  view.scene.add(dummy);

  let selected = null; // {type: 'body'|'block'|'portal'|'emitter', id, data}
  let isDragging = false;
  let transformMode = 'translate'; // 'translate' | 'rotate'
  let dragStartPose = null;

  transform.addEventListener('dragging-changed', (event) => {
    isDragging = event.value;
    if (cameraCtrl.controls) cameraCtrl.controls.enabled = !event.value;
    if (event.value) {
      // Drag started: record initial pose
      if (selected) {
        dragStartPose = capturePose(selected);
      }
    } else {
      // Drag ended: commit command if changed
      if (selected && dragStartPose) {
        const endPose = capturePose(selected);
        if (hasPoseChanged(dragStartPose, endPose)) {
          commitMoveCommand(selected, dragStartPose, endPose);
        }
      }
      dragStartPose = null;
    }
  });

  transform.addEventListener('change', () => {
    if (!isDragging || !selected) return;
    applyDummyToEntity(selected, dummy);
  });

  function capturePose(sel) {
    if (sel.type === 'body') {
      const b = doc.bodies.find((x) => x.id === sel.id);
      return b ? {pos: [...b.pos], quat: [...(b.quat ?? [0, 0, 0, 1])]} : null;
    } else if (sel.type === 'block') {
      const k = doc.blocks.find((x) => x.id === sel.id);
      if (!k) return null;
      if (k.kind === 'box') {
        return {min: [...k.min], max: [...k.max]};
      }
      return {pos: [...k.pos], rot: [...(k.rot ?? [0, 0, 0, 1])]};
    } else if (sel.type === 'portal') {
      const p = doc.portals.find((x) => x.id === sel.id);
      return p ? {c: [...p.c], v: [...p.v], n: [...p.n]} : null;
    } else if (sel.type === 'emitter') {
      const e = (doc.emitters ?? []).find((x) => x.id === sel.id);
      return e ? {pos: [...e.pos], quat: [...(e.quat ?? [0, 0, 0, 1])]} : null;
    }
    return null;
  }

  function hasPoseChanged(a, b) {
    if (!a || !b) return false;
    for (const key of Object.keys(a)) {
      if (Array.isArray(a[key])) {
        for (let i = 0; i < a[key].length; i++) {
          if (Math.abs(a[key][i] - b[key][i]) > 1e-4) return true;
        }
      }
    }
    return false;
  }

  function applyDummyToEntity(sel, obj) {
    const wasPlaying = sim.playing;
    if (wasPlaying) sim.pause();

    if (sel.type === 'body') {
      const b = doc.bodies.find((x) => x.id === sel.id);
      if (b) {
        b.pos = [obj.position.x, obj.position.y, obj.position.z];
        b.quat = [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w];
        sim.edit(b);
      }
    } else if (sel.type === 'block') {
      const k = doc.blocks.find((x) => x.id === sel.id);
      if (k) {
        if (k.kind === 'box') {
          const dx = obj.position.x - (k.min[0] + k.max[0]) / 2;
          const dy = obj.position.y - (k.min[1] + k.max[1]) / 2;
          const dz = obj.position.z - (k.min[2] + k.max[2]) / 2;
          k.min = [k.min[0] + dx, k.min[1] + dy, k.min[2] + dz];
          k.max = [k.max[0] + dx, k.max[1] + dy, k.max[2] + dz];
        } else {
          k.pos = [obj.position.x, obj.position.y, obj.position.z];
          k.rot = [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w];
        }
        view.level.rebuild(doc.blocks);
        sim.edit(k);
      }
    } else if (sel.type === 'portal') {
      const p = doc.portals.find((x) => x.id === sel.id);
      if (p) {
        p.c = [obj.position.x, obj.position.y, obj.position.z];
        view.rebuildPortals();
        sim.edit(p);
      }
    } else if (sel.type === 'emitter') {
      const e = (doc.emitters ?? []).find((x) => x.id === sel.id);
      if (e) {
        e.pos = [obj.position.x, obj.position.y, obj.position.z];
        e.quat = [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w];
      }
    }

    if (wasPlaying) sim.play();
  }

  function commitMoveCommand(sel, startPose, endPose) {
    const id = sel.id;
    const type = sel.type;
    history.execute({
      name: `move_${type}`,
      execute() {
        applyPose(type, id, endPose);
      },
      undo() {
        applyPose(type, id, startPose);
      },
    });
  }

  function applyPose(type, id, pose) {
    const wasPlaying = sim.playing;
    if (wasPlaying) sim.pause();

    if (type === 'body') {
      const b = doc.bodies.find((x) => x.id === id);
      if (b) {
        b.pos = [...pose.pos];
        b.quat = [...pose.quat];
        sim.edit(b);
      }
    } else if (type === 'block') {
      const k = doc.blocks.find((x) => x.id === id);
      if (k) {
        if (k.kind === 'box') {
          k.min = [...pose.min];
          k.max = [...pose.max];
        } else {
          k.pos = [...pose.pos];
          k.rot = [...pose.rot];
        }
        view.level.rebuild(doc.blocks);
        sim.edit(k);
      }
    } else if (type === 'portal') {
      const p = doc.portals.find((x) => x.id === id);
      if (p) {
        p.c = [...pose.c];
        if (pose.v) p.v = [...pose.v];
        if (pose.n) p.n = [...pose.n];
        view.rebuildPortals();
        sim.edit(p);
      }
    } else if (type === 'emitter') {
      const e = (doc.emitters ?? []).find((x) => x.id === id);
      if (e) {
        e.pos = [...pose.pos];
        e.quat = [...pose.quat];
      }
    }

    if (selected && selected.id === id) {
      updateDummyFromEntity(selected);
    }

    if (wasPlaying) sim.play();
  }

  function updateDummyFromEntity(sel) {
    if (!sel) {
      transform.detach();
      return;
    }
    if (sel.type === 'body') {
      const b = doc.bodies.find((x) => x.id === sel.id);
      if (!b) return transform.detach();
      dummy.position.set(b.pos[0], b.pos[1], b.pos[2]);
      if (b.quat) dummy.quaternion.set(b.quat[0], b.quat[1], b.quat[2], b.quat[3]);
      else dummy.quaternion.identity();
      transform.setTranslationSnap(0.1);
      transform.setRotationSnap(Math.PI / 12);
    } else if (sel.type === 'block') {
      const k = doc.blocks.find((x) => x.id === sel.id);
      if (!k) return transform.detach();
      if (k.kind === 'box') {
        dummy.position.set((k.min[0] + k.max[0]) / 2, (k.min[1] + k.max[1]) / 2, (k.min[2] + k.max[2]) / 2);
        dummy.quaternion.identity();
        transform.setTranslationSnap(0.5);
        transform.setRotationSnap(Math.PI / 2);
      } else {
        dummy.position.set(k.pos[0], k.pos[1], k.pos[2]);
        if (k.rot) dummy.quaternion.set(k.rot[0], k.rot[1], k.rot[2], k.rot[3]);
        else dummy.quaternion.identity();
        transform.setTranslationSnap(0.5);
        transform.setRotationSnap(k.kind === 'ramp' ? Math.PI / 4 : Math.PI / 2);
      }
    } else if (sel.type === 'portal') {
      const p = doc.portals.find((x) => x.id === sel.id);
      if (!p) return transform.detach();
      dummy.position.set(p.c[0], p.c[1], p.c[2]);
      dummy.quaternion.identity();
      transform.setTranslationSnap(0.1);
      transform.setRotationSnap(Math.PI / 12);
    } else if (sel.type === 'emitter') {
      const e = (doc.emitters ?? []).find((x) => x.id === sel.id);
      if (!e) return transform.detach();
      dummy.position.set(e.pos[0], e.pos[1], e.pos[2]);
      if (e.quat) dummy.quaternion.set(e.quat[0], e.quat[1], e.quat[2], e.quat[3]);
      else dummy.quaternion.identity();
      transform.setTranslationSnap(0.5);
      transform.setRotationSnap(Math.PI / 4);
    }
    dummy.updateMatrixWorld();
    transform.attach(dummy);
  }

  function select(entity) {
    selected = entity;
    updateDummyFromEntity(selected);
    onSelectionChange?.(selected);
  }

  function deselect() {
    selected = null;
    transform.detach();
    onSelectionChange?.(null);
  }

  function setMode(mode) {
    transformMode = mode;
    transform.setMode(mode);
  }

  // Fast raycast picking: uses instance bounds for bodies rather than per-triangle checks
  function pick(ray) {
    let closestDist = Infinity;
    let hitEntity = null;

    // 1. Check bodies by bounding sphere
    for (const b of doc.bodies) {
      if (!b.pos) continue;
      // Bounding radius based on shape and size
      const sx = b.size?.[0] ?? 0.5, sy = b.size?.[1] ?? 0.5, sz = b.size?.[2] ?? 0.5;
      const radius = Math.hypot(sx, sy, sz) * 0.5;
      const sphere = new THREE.Sphere(new THREE.Vector3(b.pos[0], b.pos[1], b.pos[2]), radius);
      const hitPoint = new THREE.Vector3();
      if (ray.intersectSphere(sphere, hitPoint)) {
        const dist = ray.origin.distanceTo(hitPoint);
        if (dist < closestDist) {
          closestDist = dist;
          hitEntity = {type: 'body', id: b.id, data: b};
        }
      }
    }

    // 2. Check portals by ellipse disc
    for (const p of doc.portals) {
      const P = frame(p);
      const plane = new THREE.Plane().setComponents(P.n[0], P.n[1], P.n[2], -P.n[0] * P.c[0] - P.n[1] * P.c[1] - P.n[2] * P.c[2]);
      const hitPoint = new THREE.Vector3();
      if (ray.intersectPlane(plane, hitPoint)) {
        const pt = [hitPoint.x, hitPoint.y, hitPoint.z];
        const l = local(P, pt);
        if (inside(P, l, 0.05)) {
          const dist = ray.origin.distanceTo(hitPoint);
          if (dist < closestDist) {
            closestDist = dist;
            hitEntity = {type: 'portal', id: p.id, data: p};
          }
        }
      }
    }

    // 3. Check emitters by bounding sphere
    for (const e of (doc.emitters ?? [])) {
      const sphere = new THREE.Sphere(new THREE.Vector3(e.pos[0], e.pos[1], e.pos[2]), 0.4);
      const hitPoint = new THREE.Vector3();
      if (ray.intersectSphere(sphere, hitPoint)) {
        const dist = ray.origin.distanceTo(hitPoint);
        if (dist < closestDist) {
          closestDist = dist;
          hitEntity = {type: 'emitter', id: e.id, data: e};
        }
      }
    }

    // 4. Check static blocks by AABB/box
    for (const k of doc.blocks) {
      let box;
      if (k.kind === 'box') {
        box = new THREE.Box3(
          new THREE.Vector3(k.min[0], k.min[1], k.min[2]),
          new THREE.Vector3(k.max[0], k.max[1], k.max[2])
        );
      } else {
        const hx = (k.size?.[0] ?? 1) / 2, hy = (k.size?.[1] ?? 1) / 2, hz = (k.size?.[2] ?? 1) / 2;
        box = new THREE.Box3(
          new THREE.Vector3(k.pos[0] - hx, k.pos[1] - hy, k.pos[2] - hz),
          new THREE.Vector3(k.pos[0] + hx, k.pos[1] + hy, k.pos[2] + hz)
        );
      }
      const hitPoint = new THREE.Vector3();
      if (ray.intersectBox(box, hitPoint)) {
        const dist = ray.origin.distanceTo(hitPoint);
        if (dist < closestDist) {
          closestDist = dist;
          hitEntity = {type: 'block', id: k.id, data: k};
        }
      }
    }

    return hitEntity;
  }

  function onPointerDown(e, ray) {
    if (isDragging) return;
    const hit = pick(ray);
    if (hit) {
      select(hit);
    } else {
      deselect();
    }
  }

  function dispose() {
    transform.dispose();
    view.scene.remove(transform.getHelper());
    view.scene.remove(dummy);
  }

  return {
    name: 'select',
    get selected() { return selected; },
    select,
    deselect,
    pick,
    setMode,
    onPointerDown,
    updatePose: () => updateDummyFromEntity(selected),
    dispose,
  };
}
