// Spawn tool: click to drop a shape 0.5 m above hovered surface,
// or hold to spray (max 10 per second).
// Shapes: box, ball, capsule, plank, heavy ball.
// Each has a size slider (0.5x to 2.0x).
// Refuses with a message at the 300 body cap.

import * as THREE from 'three';
import {newId} from '../../core/scene.js';

const MAX_BODIES = 300;
const SPRAY_INTERVAL_MS = 100; // max 10/s

export function createSpawnTool({doc, view, sim, history, setNotice}) {
  let shape = 'ball'; // 'box' | 'ball' | 'capsule' | 'plank' | 'heavy_ball'
  let sizeScale = 1.0;
  let spraying = false;
  let sprayTimer = 0;
  let lastRay = null;
  let sprayBatch = [];

  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  function setShape(s) {
    shape = s;
  }

  function setSizeScale(scale) {
    sizeScale = Math.max(0.3, Math.min(3.0, scale));
  }

  function raycastSurface(ray) {
    let hit = null;
    let minDist = Infinity;

    // Check level mesh
    if (view.level?.group) {
      const raycaster = new THREE.Raycaster(ray.origin, ray.direction);
      const hits = raycaster.intersectObjects(view.level.group.children, true);
      if (hits.length > 0 && hits[0].distance < minDist) {
        minDist = hits[0].distance;
        hit = hits[0].point;
      }
    }

    // Check floor plane
    const pt = new THREE.Vector3();
    if (ray.intersectPlane(floorPlane, pt)) {
      const d = ray.origin.distanceTo(pt);
      if (d < minDist) {
        minDist = d;
        hit = pt;
      }
    }
    return hit ? [hit.x, hit.y, hit.z] : null;
  }

  function createBodySpec(hitPt) {
    const s = sizeScale;
    let bodyShape = shape;
    let mass = 1;
    let color = null;
    let size = [0.5 * s, 0.5 * s, 0.5 * s];

    if (shape === 'heavy_ball') {
      bodyShape = 'ball';
      mass = 20;
      color = '#2A272A';
      size = [0.55 * s, 0.55 * s, 0.55 * s];
    } else if (shape === 'box') {
      size = [0.5 * s, 0.5 * s, 0.5 * s];
    } else if (shape === 'ball') {
      size = [0.45 * s, 0.45 * s, 0.45 * s];
    } else if (shape === 'capsule') {
      size = [0.35 * s, 0.9 * s, 0.35 * s];
    } else if (shape === 'plank') {
      size = [1.4 * s, 0.12 * s, 0.4 * s];
    }

    const pos = [hitPt[0], hitPt[1] + 0.5, hitPt[2]];
    return {
      id: newId(doc, 'b'),
      shape: bodyShape,
      size,
      pos,
      quat: [0, 0, 0, 1],
      vel: [0, 0, 0],
      angvel: [0, 0, 0],
      mass,
      color,
    };
  }

  function spawnOne(ray) {
    if (sim.count >= MAX_BODIES) {
      setNotice?.(`body limit reached (${MAX_BODIES})`);
      return null;
    }
    const hitPt = raycastSurface(ray);
    if (!hitPt) return null;

    const body = createBodySpec(hitPt);
    sim.spawn(body);
    doc.bodies.push(body);
    return body;
  }

  function onPointerDown(e, ray) {
    if (e.button !== 0) return;
    lastRay = ray;
    spraying = true;
    sprayBatch = [];

    const first = spawnOne(ray);
    if (first) sprayBatch.push(first);

    sprayTimer = setInterval(() => {
      if (!spraying || !lastRay) return;
      if (sim.count >= MAX_BODIES) {
        clearInterval(sprayTimer);
        setNotice?.(`body limit reached (${MAX_BODIES})`);
        return;
      }
      const b = spawnOne(lastRay);
      if (b) sprayBatch.push(b);
    }, SPRAY_INTERVAL_MS);
  }

  function onPointerMove(e, ray) {
    lastRay = ray;
  }

  function onPointerUp() {
    if (!spraying) return;
    spraying = false;
    clearInterval(sprayTimer);

    if (sprayBatch.length > 0) {
      const batch = [...sprayBatch];
      history.execute({
        name: `spawn_${batch.length > 1 ? 'spray' : shape}`,
        execute() {
          for (const b of batch) {
            if (!doc.bodies.some((x) => x.id === b.id)) {
              doc.bodies.push(b);
              sim.spawn(b);
            }
          }
        },
        undo() {
          for (const b of batch) {
            const idx = doc.bodies.findIndex((x) => x.id === b.id);
            if (idx >= 0) doc.bodies.splice(idx, 1);
            sim.remove(b.id);
          }
        },
      });
    }
    sprayBatch = [];
  }

  function dispose() {
    if (sprayTimer) clearInterval(sprayTimer);
  }

  return {
    name: 'spawn',
    get shape() { return shape; },
    get sizeScale() { return sizeScale; },
    setShape,
    setSizeScale,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    dispose,
  };
}
