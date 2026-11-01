// Emitter tool: places an emitter source that continuously spawns
// a chosen shape at a set rate (<= 5 per second) and speed in Play mode only.
// Up to 8 emitters allowed.

import * as THREE from 'three';
import {addEmitter, newId} from '../../core/scene.js';
import {canAddEmitter, canAddBody, getLimits} from '../../core/limits.js';

export function createEmitterTool({doc, view, sim, history, setNotice}) {
  let shape = 'ball'; // 'ball' | 'box' | 'capsule' | 'plank' | 'heavy_ball'
  let rate = 2; // <= 5 / s
  let speed = 4; // m/s

  // Three.js visual markers for placed emitters
  const emitterMarkers = new Map();
  const markerGroup = new THREE.Group();
  view.scene.add(markerGroup);

  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  function syncMarkers() {
    // Remove markers for deleted emitters
    for (const [id, marker] of emitterMarkers.entries()) {
      if (!doc.emitters.some((e) => e.id === id)) {
        markerGroup.remove(marker);
        marker.geometry?.dispose();
        marker.material?.dispose();
        emitterMarkers.delete(id);
      }
    }
    // Add or update markers
    for (const e of doc.emitters) {
      let marker = emitterMarkers.get(e.id);
      if (!marker) {
        const geo = new THREE.ConeGeometry(0.25, 0.5, 12);
        geo.rotateX(Math.PI / 2); // Point along +z
        const mat = new THREE.MeshBasicMaterial({color: 0x7E5BA6, wireframe: true});
        marker = new THREE.Mesh(geo, mat);
        markerGroup.add(marker);
        emitterMarkers.set(e.id, marker);
      }
      marker.position.set(e.pos[0], e.pos[1], e.pos[2]);
      if (e.quat) marker.quaternion.set(e.quat[0], e.quat[1], e.quat[2], e.quat[3]);
    }
  }
  syncMarkers();

  function raycastSurface(ray) {
    let hit = null;
    let minDist = Infinity;
    let normal = [0, 1, 0];

    // Check level mesh
    if (view.level?.group) {
      const raycaster = new THREE.Raycaster(ray.origin, ray.direction);
      const hits = raycaster.intersectObjects(view.level.group.children, true);
      if (hits.length > 0 && hits[0].distance < minDist) {
        minDist = hits[0].distance;
        hit = hits[0].point;
        if (hits[0].face) {
          normal = [hits[0].face.normal.x, hits[0].face.normal.y, hits[0].face.normal.z];
        }
      }
    }

    // Check floor plane
    const pt = new THREE.Vector3();
    if (ray.intersectPlane(floorPlane, pt)) {
      const d = ray.origin.distanceTo(pt);
      if (d < minDist) {
        minDist = d;
        hit = pt;
        normal = [0, 1, 0];
      }
    }
    return hit ? {pos: [hit.x, hit.y, hit.z], normal} : null;
  }

  let downRay = null;

  function onPointerDown(e, ray) {
    if (e.button !== 0) return;
    downRay = ray;
  }

  function onPointerUp(e, ray, wasClick) {
    if (!wasClick) {
      downRay = null;
      return;
    }
    const targetRay = downRay || ray;
    downRay = null;
    if (!targetRay) return;

    doc.emitters ??= [];
    const chk = canAddEmitter(doc);
    if (!chk.ok) {
      setNotice?.(chk.reason);
      return;
    }

    const hit = raycastSurface(targetRay);
    if (!hit) return;

    // Emitter pos is 0.4 m off the surface, pointing outward along normal
    const pos = [
      hit.pos[0] + hit.normal[0] * 0.4,
      hit.pos[1] + hit.normal[1] * 0.4,
      hit.pos[2] + hit.normal[2] * 0.4,
    ];

    // Quaternion pointing along normal
    const vFrom = new THREE.Vector3(0, 0, 1);
    const vTo = new THREE.Vector3(hit.normal[0], hit.normal[1], hit.normal[2]).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(vFrom, vTo);
    const quat = [q.x, q.y, q.z, q.w];

    const emitter = {
      id: newId(doc, 'e'),
      shape,
      size: [0.4, 0.4, 0.4],
      pos,
      quat,
      rate: Math.min(5, Math.max(0.5, rate)),
      speed: Math.max(1, speed),
      mass: 1,
      color: null,
      lastSpawn: 0,
    };

    history.execute({
      name: 'add_emitter',
      execute() {
        doc.emitters.push(emitter);
        syncMarkers();
        setNotice?.('added emitter');
      },
      undo() {
        const idx = doc.emitters.findIndex((x) => x.id === emitter.id);
        if (idx >= 0) doc.emitters.splice(idx, 1);
        syncMarkers();
        setNotice?.('removed emitter');
      },
    });
  }

  // Tick active emitters in Play mode
  function tick(simTime) {
    if (!sim.playing || sim.busy) return; // Pause emitters when simulation is busy or paused
    if (!doc.emitters || doc.emitters.length === 0) return;

    const maxBodies = getLimits().maxBodies;
    for (const e of doc.emitters) {
      const interval = 1 / Math.min(5, Math.max(0.2, e.rate ?? 2));
      if (simTime - (e.lastSpawn ?? 0) >= interval) {
        if (sim.count >= maxBodies) continue; // body cap check

        // Direction from emitter quaternion
        const q = new THREE.Quaternion(e.quat[0], e.quat[1], e.quat[2], e.quat[3]);
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();
        const spd = e.speed ?? 4;
        const vel = [fwd.x * spd, fwd.y * spd, fwd.z * spd];

        const spawnPos = [
          e.pos[0] + fwd.x * 0.35,
          e.pos[1] + fwd.y * 0.35,
          e.pos[2] + fwd.z * 0.35,
        ];

        let bodyShape = e.shape ?? 'ball';
        let mass = 1;
        let color = e.color ?? null;
        let size = [0.4, 0.4, 0.4];

        if (bodyShape === 'heavy_ball') {
          bodyShape = 'ball';
          mass = 20;
          color = '#2A272A';
        } else if (bodyShape === 'box') {
          size = [0.45, 0.45, 0.45];
        } else if (bodyShape === 'capsule') {
          size = [0.3, 0.8, 0.3];
        } else if (bodyShape === 'plank') {
          size = [1.2, 0.12, 0.4];
        }

        const body = {
          id: newId(doc, 'b'),
          shape: bodyShape,
          size,
          pos: spawnPos,
          quat: [q.x, q.y, q.z, q.w],
          vel,
          angvel: [0, 0, 0],
          mass,
          color,
        };

        sim.spawn(body);
        doc.bodies.push(body);
        e.lastSpawn = simTime;
      }
    }
  }

  function dispose() {
    view.scene.remove(markerGroup);
    for (const marker of emitterMarkers.values()) {
      marker.geometry?.dispose();
      marker.material?.dispose();
    }
    emitterMarkers.clear();
  }

  return {
    name: 'emitter',
    get shape() { return shape; },
    get rate() { return rate; },
    get speed() { return speed; },
    setShape: (s) => { shape = s; },
    setRate: (r) => { rate = Math.min(5, Math.max(0.5, r)); },
    setSpeed: (s) => { speed = Math.max(1, s); },
    onPointerDown,
    onPointerUp,
    tick,
    syncMarkers,
    dispose,
  };
}
