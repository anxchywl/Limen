// Headless Rapier 3D portal-transit test suite (Prompt 04):
// Verifies all 9 required transit cases (drop, rest, plank, blocked, endless, sidebyside,
// removed, fast, stack), one-portal-at-a-time isolation, frame-buffer clone/teleport flags,
// and the 300-body / 40-in-transit step and hook performance budgets.

import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-simd-compat';
import {applyDir, dot, len, norm} from '../src/core/vec.js';
import {frame, inside, local, portalMap} from '../src/core/portal.js';
import {SHAPES, addBlock, addBody, addPortalPair, createScene, rng} from '../src/core/scene.js';
import {
  ALIVE, CLONE_POS, FLAGS, HAS_CLONE, SPARE, frameLength, slotOffset, teleportOf,
} from '../src/physics/protocol.js';
import {TUNNEL_DEPTH} from '../src/physics/transit.js';
import {createPhysicsWorld} from '../src/physics/world.js';

await RAPIER.init();

function bodyKE(e) {
  const m = e.spec.mass;
  const v = e.rb.linvel(), w = e.rb.angvel();
  const [sx, sy, sz] = e.spec.size;
  const lin = 0.5 * m * (v.x * v.x + v.y * v.y + v.z * v.z);
  const ix = (m / 12) * (sy * sy + sz * sz);
  const iy = (m / 12) * (sx * sx + sz * sz);
  const iz = (m / 12) * (sx * sx + sy * sy);
  return lin + 0.5 * (ix * w.x * w.x + iy * w.y * w.y + iz * w.z * w.z);
}

const report = {};

// ---------------------------------------------------------------------------
// 1. drop: box falls into a floor portal and exits a wall portal with |v| preserved within 2% and direction mapped by R
// ---------------------------------------------------------------------------
{
  const scene = createScene();
  const floor = addBlock(scene, {min: [-6, -0.5, -6], max: [6, 0, 6]});
  const wall = addBlock(scene, {min: [-6.5, 0, -6], max: [-6, 6, 6]});
  const [pA, pB] = addPortalPair(scene,
    {block: floor.id, face: '+y', c: [-3.5, 0, 0], n: [0, 1, 0], v: [-1, 0, 0], a: 0.7, b: 1.0},
    {block: wall.id, face: '+x', c: [-6, 3.0, 0], n: [1, 0, 0], v: [0, 1, 0], a: 0.7, b: 1.0});
  addBody(scene, {id: 'drop_box', shape: 'box', size: [0.5, 0.5, 0.5], pos: [-3.5, 4.0, 0]});

  const M = portalMap(frame(pA), frame(pB));
  const sim = createPhysicsWorld(RAPIER);
  sim.load(scene);

  const buf = new Float32Array(frameLength(4));
  let sawClone = false;
  let sawTeleportFlag = -1;
  let vPre = null;
  let vPost = null;

  for (let i = 0; i < 120; i++) {
    const rb = sim.entries[0].rb;
    const prevTp = sim.teleportCount;
    const lv = rb.linvel();
    const preCandidate = [lv.x, lv.y, lv.z];
    sim.step(1);
    sim.write(buf);
    const o = slotOffset(0);
    const flags = buf[o + FLAGS];
    if (flags & HAS_CLONE) {
      sawClone = true;
      assert.ok(buf[o + SPARE] === 0 || buf[o + SPARE] === 1);
      assert.ok(Number.isFinite(buf[o + CLONE_POS]));
    }
    if (sim.teleportCount > prevTp && !vPost) {
      vPre = preCandidate;
      const nv = rb.linvel();
      vPost = [nv.x, nv.y, nv.z];
      sawTeleportFlag = teleportOf(flags);
    }
  }

  assert.equal(sawClone, true, 'drop: expected HAS_CLONE while straddling portal');
  assert.equal(sawTeleportFlag, 0, 'drop: frame flags must report entered portal index 0');
  assert.ok(vPre && vPost, 'drop: box never teleported');
  assert.equal(sim.teleportCount, 1, `drop: expected 1 teleport, got ${sim.teleportCount}`);

  const speedErr = Math.abs(len(vPost) - len(vPre)) / len(vPre);
  const expectedDir = norm(applyDir(M, vPre));
  const actualDir = norm(vPost);
  const dirCos = dot(expectedDir, actualDir);

  assert.ok(speedErr <= 0.02, `drop: speed error ${(speedErr * 100).toFixed(2)}% > 2%`);
  assert.ok(dirCos > 0.998, `drop: direction cosine ${dirCos} < 0.998`);
  assert.ok(sim.entries[0].rb.translation().x > -4.0, 'drop: box should fly into the room from the wall portal');
  report.drop = {teleports: sim.teleportCount, speedErrPct: +(speedErr * 100).toFixed(3), dirCos: +dirCos.toFixed(5)};
  sim.dispose();
}

// ---------------------------------------------------------------------------
// 2. rest: box resting half-in a floor portal whose exit is a wall at the same height;
//    after 5 s, centre jitter < 2 mm and no teleport flip-flops
// ---------------------------------------------------------------------------
{
  const scene = createScene();
  const floor = addBlock(scene, {min: [-6, -0.5, -6], max: [6, 0, 6]});
  const wall = addBlock(scene, {min: [-6.5, 0, -6], max: [-6, 6, 6]});
  // wall portal bottom touches the floor y = 0; a low stop-block 0.255 m in front of the wall portal
  // maps to y = -0.255 m beneath the floor portal so a 0.52 m box rests half-in / half-out
  addBlock(scene, {min: [-5.745, 0, -1.5], max: [-5.0, 2.0, 1.5]});
  addPortalPair(scene,
    {block: floor.id, face: '+y', c: [0, 0, 0], n: [0, 1, 0], v: [-1, 0, 0], a: 0.7, b: 1.0},
    {block: wall.id, face: '+x', c: [-6, 1.0, 0], n: [1, 0, 0], v: [0, 1, 0], a: 0.7, b: 1.0});
  addBody(scene, {id: 'rest_box', shape: 'box', size: [0.52, 0.52, 0.52], pos: [0, 0.02, 0]});

  const sim = createPhysicsWorld(RAPIER);
  sim.load(scene);

  const tailPositions = [];
  for (let i = 0; i < 300; i++) { // 5.0 s at 60 Hz
    sim.step(1);
    if (i >= 180) { // measure settled jitter over final 2 s
      const p = sim.entries[0].rb.translation();
      tailPositions.push([p.x, p.y, p.z]);
    }
  }

  const mean = [0, 0, 0];
  for (const p of tailPositions) { mean[0] += p[0]; mean[1] += p[1]; mean[2] += p[2]; }
  mean[0] /= tailPositions.length; mean[1] /= tailPositions.length; mean[2] /= tailPositions.length;

  let maxJitterM = 0;
  for (const p of tailPositions) {
    const d = Math.hypot(p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]);
    if (d > maxJitterM) maxJitterM = d;
  }
  const jitterMm = maxJitterM * 1000;

  assert.equal(sim.activeTransitCount, 1, 'rest: box must remain straddling the portal');
  assert.ok(Math.abs(mean[1]) < 0.03, `rest: expected box half-in floor portal near y=0, got y=${mean[1]}`);
  assert.equal(sim.teleportCount, 0, `rest: expected 0 teleport flip-flops, got ${sim.teleportCount}`);
  assert.ok(jitterMm < 2.0, `rest: centre jitter ${jitterMm.toFixed(3)} mm >= 2 mm`);
  report.rest = {teleports: sim.teleportCount, jitterMm: +jitterMm.toFixed(4), restingY: +mean[1].toFixed(4)};
  sim.dispose();
}

// ---------------------------------------------------------------------------
// 3. plank: 3 m plank slid across a 1.4 m opening rests on slab tops; pushed lengthwise, it passes through
// ---------------------------------------------------------------------------
{
  // Part A: slid across a 1.4 m wide floor opening
  const sceneA = createScene();
  const floorA = addBlock(sceneA, {min: [-6, -0.5, -6], max: [6, 0, 6]});
  const wallA = addBlock(sceneA, {min: [-6.5, 0, -6], max: [-6, 6, 6]});
  // v = [0, 0, -1], n = [0, 1, 0] => u = v x n = [1, 0, 0], so opening along x is 2 * 0.7 = 1.4 m
  addPortalPair(sceneA,
    {block: floorA.id, face: '+y', c: [0, 0, 0], n: [0, 1, 0], v: [0, 0, -1], a: 0.7, b: 1.0},
    {block: wallA.id, face: '+x', c: [-6, 3.0, 0], n: [1, 0, 0], v: [0, 1, 0], a: 0.7, b: 1.0});
  addBody(sceneA, {
    id: 'plank_bridge', shape: 'plank', size: [3.0, 0.12, 0.4],
    pos: [-1.4, 0.06, 0], vel: [4.2, 0, 0],
  });

  const simA = createPhysicsWorld(RAPIER);
  simA.load(sceneA);
  let minPlankY = Infinity;
  for (let i = 0; i < 180; i++) {
    simA.step(1);
    const py = simA.entries[0].rb.translation().y;
    if (py < minPlankY) minPlankY = py;
  }
  const endA = simA.entries[0].rb.translation();
  assert.equal(simA.teleportCount, 0, 'plank across: must not teleport/fall into opening');
  assert.ok(Math.abs(endA.x) < 0.7, `plank across: expected plank bridged over x=0, got x=${endA.x}`);
  assert.ok(minPlankY >= 0.045, `plank across: dipped below slab tops (minY=${minPlankY})`);
  simA.dispose();

  // Part B: 3 m plank pushed lengthwise into a 1.4 m x 2.0 m wall portal
  const sceneB = createScene();
  addBlock(sceneB, {min: [-8, -0.5, -8], max: [8, 0, 8]});
  const wallEntry = addBlock(sceneB, {min: [-6, 0, -6.5], max: [6, 6, -6]});
  const wallExit = addBlock(sceneB, {min: [6, 0, -6], max: [6.5, 6, 6]});
  addPortalPair(sceneB,
    {block: wallEntry.id, face: '+z', c: [0, 1.0, -6], n: [0, 0, 1], v: [0, 1, 0], a: 0.7, b: 1.0},
    {block: wallExit.id, face: '-x', c: [6, 1.0, 0], n: [-1, 0, 0], v: [0, 1, 0], a: 0.7, b: 1.0});
  addBody(sceneB, {
    id: 'plank_lengthwise', shape: 'plank', size: [0.4, 0.12, 3.0],
    pos: [0, 0.2, -4.1], vel: [0, 0, -6.5],
  });

  const simB = createPhysicsWorld(RAPIER);
  simB.load(sceneB);
  simB.step(120);
  const endB = simB.entries[0].rb.translation();
  assert.equal(simB.teleportCount, 1, `plank lengthwise: expected 1 teleport, got ${simB.teleportCount}`);
  assert.ok(endB.x < 5.0, `plank lengthwise: expected plank to emerge from +x wall into x < 5, got x=${endB.x}`);
  report.plank = {bridgeTeleports: 0, bridgeMinY: +minPlankY.toFixed(4), lengthwiseTeleports: simB.teleportCount};
  simB.dispose();
}

// ---------------------------------------------------------------------------
// 4. blocked: exit covered by a fixed block; body stops with max penetration < 2 cm
// ---------------------------------------------------------------------------
{
  const scene = createScene();
  const floor = addBlock(scene, {min: [-6, -0.5, -6], max: [6, 0, 6]});
  const wall = addBlock(scene, {min: [-6.5, 0, -6], max: [-6, 6, 6]});
  // solid block flush against the exit opening
  addBlock(scene, {min: [-6.0, 0.5, -1.5], max: [-5.2, 3.5, 1.5]});
  addPortalPair(scene,
    {block: floor.id, face: '+y', c: [0, 0, 0], n: [0, 1, 0], v: [-1, 0, 0], a: 0.7, b: 1.0},
    {block: wall.id, face: '+x', c: [-6, 2.0, 0], n: [1, 0, 0], v: [0, 1, 0], a: 0.7, b: 1.0});
  addBody(scene, {id: 'blocked_box', shape: 'box', size: [0.5, 0.5, 0.5], pos: [0, 1.8, 0]});

  const sim = createPhysicsWorld(RAPIER);
  sim.load(scene);

  let maxPenM = 0;
  for (let i = 0; i < 240; i++) {
    sim.step(1);
    const yBottom = sim.entries[0].rb.translation().y - 0.25;
    if (-yBottom > maxPenM) maxPenM = -yBottom;
  }

  const finalY = sim.entries[0].rb.translation().y;
  assert.equal(sim.teleportCount, 0, `blocked: body must not teleport into blocked exit`);
  assert.ok(maxPenM < 0.02, `blocked: max penetration ${(maxPenM * 100).toFixed(2)} cm >= 2 cm`);
  assert.ok(Math.abs(finalY - 0.25) < 0.015, `blocked: expected resting y ~ 0.25, got ${finalY}`);
  report.blocked = {teleports: sim.teleportCount, maxPenCm: +(maxPenM * 100).toFixed(3)};
  sim.dispose();
}

// ---------------------------------------------------------------------------
// 5. endless: floor <-> ceiling; speed converges to terminal +- 5% with no NaN after 60 s
// ---------------------------------------------------------------------------
{
  const vTerm = 40;
  const scene = createScene({settings: {gravity: [0, -9.81, 0], terminalSpeed: vTerm}});
  const floor = addBlock(scene, {min: [-6, -0.5, -6], max: [6, 0, 6]});
  const ceiling = addBlock(scene, {min: [-6, 4.0, -6], max: [6, 4.5, 6]});
  addPortalPair(scene,
    {block: floor.id, face: '+y', c: [0, 0, 0], n: [0, 1, 0], v: [0, 0, -1], a: 0.9, b: 0.9},
    {block: ceiling.id, face: '-y', c: [0, 4.0, 0], n: [0, -1, 0], v: [0, 0, -1], a: 0.9, b: 0.9});
  addBody(scene, {id: 'endless_box', shape: 'box', size: [0.5, 0.5, 0.5], pos: [0, 2.0, 0]});

  const sim = createPhysicsWorld(RAPIER);
  sim.load(scene);
  sim.step(3600); // 60 s simulated time

  assert.equal(sim.count, 1, 'endless: body must survive 60 s without NaN/bounds removal');
  const rb = sim.entries[0].rb;
  const p = rb.translation(), v = rb.linvel();
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), 'endless: position NaN');
  const sp = Math.hypot(v.x, v.y, v.z);
  const relErr = Math.abs(sp - vTerm) / vTerm;
  assert.ok(relErr <= 0.05, `endless: speed ${sp.toFixed(3)} m/s outside ${vTerm} +- 5%`);
  assert.ok(sim.teleportCount >= 500, `endless: expected >= 500 teleports over 60 s, got ${sim.teleportCount}`);
  report.endless = {teleports: sim.teleportCount, finalSpeed: +sp.toFixed(3), relErrPct: +(relErr * 100).toFixed(3)};
  sim.dispose();
}

// ---------------------------------------------------------------------------
// 6. sidebyside: both portals on one wall (Portal 64 bug); 200 random throws, no body ever leaves the level
//    Also checks one-portal-at-a-time when aimed at the narrow strip between openings.
// ---------------------------------------------------------------------------
{
  const makeRoomWithSideBySide = () => {
    const s = createScene();
    addBlock(s, {min: [-6.5, -0.5, -6.5], max: [6.5, 0, 6.5]}); // floor
    addBlock(s, {min: [-6.5, 6.0, -6.5], max: [6.5, 6.5, 6.5]}); // ceiling
    addBlock(s, {min: [-6.5, 0, -6.5], max: [-6.0, 6, 6.5]});    // -x
    addBlock(s, {min: [6.0, 0, -6.5], max: [6.5, 6, 6.5]});      // +x
    const wz = addBlock(s, {min: [-6.0, 0, -6.5], max: [6.0, 6, -6.0]}); // -z host wall
    addBlock(s, {min: [-6.0, 0, 6.0], max: [6.0, 6, 6.5]});      // +z
    const [pA, pB] = addPortalPair(s,
      {block: wz.id, face: '+z', c: [-0.8, 1.8, -6], n: [0, 0, 1], v: [0, 1, 0], a: 0.7, b: 1.0},
      {block: wz.id, face: '+z', c: [0.8, 1.8, -6], n: [0, 0, 1], v: [0, 1, 0], a: 0.7, b: 1.0});
    return {scene: s, PA: frame(pA), PB: frame(pB)};
  };

  const r = rng(2026);
  let totalTeleports = 0;
  let throwsDone = 0;
  const batches = 10, perBatch = 20;

  for (let b = 0; b < batches; b++) {
    const {scene, PA, PB} = makeRoomWithSideBySide();
    const sim = createPhysicsWorld(RAPIER);
    sim.load(scene);

    let batchSpawned = 0;
    let guard = 0;
    while (batchSpawned < perBatch && guard++ < 200) {
      const k = batchSpawned;
      const shape = SHAPES[(b * perBatch + k) % SHAPES.length];
      const sx = shape === 'plank' ? 1.2 : 0.3 + r() * 0.35;
      const sy = shape === 'capsule' ? sx * 2.1 : shape === 'plank' ? 0.14 : sx;
      const sz = shape === 'plank' ? 0.35 : sx;
      const px = -3.0 + r() * 6.0;
      const py = 1.0 + r() * 3.0;
      const pz = -1.5 + r() * 5.0;
      // aim toward the side-by-side portals and the seam x = 0 between them
      const tx = -1.6 + r() * 3.2;
      const ty = 0.9 + r() * 1.8;
      const tz = -6.0;
      const speed = 12 + r() * 40;
      const dir = norm([tx - px, ty - py, tz - pz]);
      const res = sim.spawn({
        id: `sbs_${b}_${k}`,
        shape,
        size: [sx, sy, sz],
        pos: [px, py, pz],
        vel: [dir[0] * speed, dir[1] * speed, dir[2] * speed],
        angvel: [(r() - 0.5) * 10, (r() - 0.5) * 10, (r() - 0.5) * 10],
      });
      if (res.ok) {
        batchSpawned++;
        throwsDone++;
      }
    }

    for (let step = 0; step < 90; step++) {
      sim.step(1);
      for (const e of sim.entries) {
        const p = e.rb.translation();
        const pos = [p.x, p.y, p.z];
        const inRoom = p.x >= -6.05 && p.x <= 6.05 && p.y >= -0.05 && p.y <= 6.05 && p.z >= -6.05 && p.z <= 6.05;
        if (!inRoom) {
          const lA = local(PA, pos), lB = local(PB, pos);
          const inTunnelA = lA[2] <= 0.05 && lA[2] >= -TUNNEL_DEPTH - 0.05 && inside(PA, lA, 0.08);
          const inTunnelB = lB[2] <= 0.05 && lB[2] >= -TUNNEL_DEPTH - 0.05 && inside(PB, lB, 0.08);
          assert.ok(inTunnelA || inTunnelB,
            `sidebyside: body ${e.id} escaped level at step ${step}: ${JSON.stringify(pos)}`);
        }
      }
    }
    totalTeleports += sim.teleportCount;
    sim.dispose();
  }

  assert.equal(throwsDone, 200, `sidebyside: expected all 200 random throws spawned, got ${throwsDone}`);
  assert.ok(totalTeleports > 20, `sidebyside: expected many teleports across 200 throws, got ${totalTeleports}`);
  report.sidebyside = {throws: throwsDone, teleports: totalTeleports};
}

// ---------------------------------------------------------------------------
// 7. removed: delete the exit portal mid-transit; body ends in front of the entry wall, not inside it
// ---------------------------------------------------------------------------
{
  let ejectedEvents = 0;
  for (const [startZ, targetZ] of [[-5.5, -5.88], [-5.805, -6.004]]) { // front-straddling & behind-plane cases
    const events = [];
    const scene = createScene({settings: {gravity: [0, 0, 0]}});
    const wz = addBlock(scene, {min: [-6, 0, -6.5], max: [6, 6, -6.0]});
    const wx = addBlock(scene, {min: [-6.5, 0, -6], max: [-6.0, 6, 6]});
    const [, pExit] = addPortalPair(scene,
      {block: wz.id, face: '+z', c: [0, 2.0, -6], n: [0, 0, 1], v: [0, 1, 0], a: 0.7, b: 1.0},
      {block: wx.id, face: '+x', c: [-6, 2.0, 0], n: [1, 0, 0], v: [0, 1, 0], a: 0.7, b: 1.0});
    addBody(scene, {
      id: 'mid_box', shape: 'box', size: [0.6, 0.6, 0.6],
      pos: [0, 2.0, startZ], vel: [0, 0, -1.2],
    });

    const sim = createPhysicsWorld(RAPIER, {onEvent: (ev) => events.push(ev)});
    sim.load(scene);
    while (sim.entries[0].rb.translation().z > targetZ && sim.steps < 60) {
      sim.step(1);
    }
    assert.equal(sim.activeTransitCount, 1, 'removed: body should be in active transit before deleting exit');
    assert.equal(sim.teleportCount, 0, 'removed: body should not have teleported yet');

    assert.equal(sim.remove(pExit.id), true, 'removed: exit portal removal should succeed');
    assert.equal(sim.activeTransitCount, 0, 'removed: active transit must end when exit is deleted');
    ejectedEvents += events.filter((e) => e.type === 'portal_ejected').length;

    sim.step(60);
    const zFinal = sim.entries[0].rb.translation().z;
    assert.ok(zFinal >= -6.0 + 0.3 - 0.005,
      `removed: body ended inside/behind entry wall (z=${zFinal}, expected >= -5.705)`);
    sim.dispose();
  }

  // also verify: centre behind entry while partner is alive -> teleports cleanly when entry moves
  {
    const scene = createScene({settings: {gravity: [0, 0, 0]}});
    const wz = addBlock(scene, {min: [-6, 0, -6.5], max: [6, 6, -6.0]});
    const wx = addBlock(scene, {min: [-6.5, 0, -6], max: [-6.0, 6, 6]});
    const [pEntry] = addPortalPair(scene,
      {block: wz.id, face: '+z', c: [0, 2.0, -6], n: [0, 0, 1], v: [0, 1, 0], a: 0.7, b: 1.0},
      {block: wx.id, face: '+x', c: [-6, 2.0, 0], n: [1, 0, 0], v: [0, 1, 0], a: 0.7, b: 1.0});
    addBody(scene, {
      id: 'mid_tp', shape: 'box', size: [0.6, 0.6, 0.6],
      pos: [0, 2.0, -5.805], vel: [0, 0, -1.2],
    });
    const sim = createPhysicsWorld(RAPIER);
    sim.load(scene);
    while (sim.entries[0].rb.translation().z > -6.004 && sim.steps < 60) sim.step(1);
    assert.equal(sim.teleportCount, 0);
    sim.edit({id: pEntry.id, c: [3.0, 2.0, -6]});
    assert.equal(sim.teleportCount, 1, 'removed/moved: centre behind entry with live partner must teleport');
    assert.ok(sim.entries[0].rb.translation().x > -6.01, 'removed/moved: teleported body must be on partner side');
    sim.dispose();
  }

  assert.equal(ejectedEvents, 2, 'removed: expected portal_ejected events when straddling closed portal');
  report.removed = {ejectedEvents, partnerAliveTeleport: 1};
}

// ---------------------------------------------------------------------------
// 8. fast: 0.15 m ball at 40 m/s at a grazing 15 deg into opening teleports cleanly;
//    grazing 15 deg beside opening bounces without tunnelling through host wall
// ---------------------------------------------------------------------------
{
  const deg15 = (15 * Math.PI) / 180;
  const speed = 40;
  const vx = speed * Math.cos(deg15);
  const vz = -speed * Math.sin(deg15); // 15 deg grazing angle to the z = -6 wall plane

  // Shot A: grazing 15 deg into the portal opening
  const sceneHit = createScene({settings: {gravity: [0, 0, 0]}});
  const wz = addBlock(sceneHit, {min: [-6, 0, -6.5], max: [6, 6, -6.0]});
  const wx = addBlock(sceneHit, {min: [6.0, 0, -6], max: [6.5, 6, 6]});
  addPortalPair(sceneHit,
    {block: wz.id, face: '+z', c: [0, 2.0, -6], n: [0, 0, 1], v: [0, 1, 0], a: 0.7, b: 1.0},
    {block: wx.id, face: '-x', c: [6, 2.0, 0], n: [-1, 0, 0], v: [0, 1, 0], a: 0.7, b: 1.0});
  const tImpact = 0.055;
  addBody(sceneHit, {
    id: 'fast_ball_hit', shape: 'ball', size: [0.15, 0.15, 0.15],
    pos: [-vx * tImpact, 2.0, -6.0 - vz * tImpact],
    vel: [vx, 0, vz],
  });

  const simHit = createPhysicsWorld(RAPIER);
  simHit.load(sceneHit);
  for (let i = 0; i < 20; i++) {
    simHit.step(1);
    const p = simHit.entries[0].rb.translation();
    assert.ok(p.z > -6.2 && p.x < 6.2, `fast hit: ball tunnelled out of bounds at ${JSON.stringify(p)}`);
  }
  const endHit = simHit.entries[0].rb.translation();
  assert.equal(simHit.teleportCount, 1, `fast hit: expected 1 teleport, got ${simHit.teleportCount}`);
  assert.ok(endHit.x < 5.5, `fast hit: expected ball to exit -x from +x wall, got x=${endHit.x}`);
  simHit.dispose();

  // Shot B: grazing 15 deg hitting host wall just beside the opening (within transit-zone fringe)
  const sceneMiss = createScene({settings: {gravity: [0, 0, 0]}});
  const wz2 = addBlock(sceneMiss, {min: [-6, 0, -6.5], max: [6, 6, -6.0]});
  const wx2 = addBlock(sceneMiss, {min: [6.0, 0, -6], max: [6.5, 6, 6]});
  addPortalPair(sceneMiss,
    {block: wz2.id, face: '+z', c: [0, 2.0, -6], n: [0, 0, 1], v: [0, 1, 0], a: 0.7, b: 1.0},
    {block: wx2.id, face: '-x', c: [6, 2.0, 0], n: [-1, 0, 0], v: [0, 1, 0], a: 0.7, b: 1.0});
  // impact at x = +0.76 (just outside a = 0.70 opening, inside tunnel slab collar)
  addBody(sceneMiss, {
    id: 'fast_ball_wall', shape: 'ball', size: [0.15, 0.15, 0.15],
    pos: [0.76 - vx * tImpact, 2.0, -6.0 - vz * tImpact],
    vel: [vx, 0, vz],
  });

  const simMiss = createPhysicsWorld(RAPIER);
  simMiss.load(sceneMiss);
  for (let i = 0; i < 20; i++) {
    simMiss.step(1);
    const p = simMiss.entries[0].rb.translation();
    assert.ok(p.z >= -6.01, `fast wall: ball tunnelled into host wall (z=${p.z})`);
  }
  assert.equal(simMiss.teleportCount, 0, 'fast wall: wall-graze outside opening must not teleport');
  report.fast = {hitTeleports: 1, missTeleports: 0};
  simMiss.dispose();
}

// ---------------------------------------------------------------------------
// 9. stack: 10-box stack pushed into a wall portal; every box comes out and total KE never increases > 5% in any step
// ---------------------------------------------------------------------------
{
  const scene = createScene();
  addBlock(scene, {min: [-12, -0.5, -12], max: [28, 0.2, 12]});
  const wz = addBlock(scene, {min: [-6, 0.2, -6.5], max: [6, 6, -6.0]});
  const wx = addBlock(scene, {min: [-6.5, 0.2, -6], max: [-6.0, 6, 10]});
  addBlock(scene, {min: [-0.6, 0.2, -5.95], max: [-0.36, 2.0, -4.4]});
  addBlock(scene, {min: [0.36, 0.2, -5.95], max: [0.6, 2.0, -4.4]});
  addPortalPair(scene,
    {block: wz.id, face: '+z', c: [0, 1.1, -6], n: [0, 0, 1], v: [0, 1, 0], a: 0.9, b: 1.1},
    {block: wx.id, face: '+x', c: [-6, 1.1, 3], n: [1, 0, 0], v: [0, 1, 0], a: 0.9, b: 1.1});

  // 2 columns x 5 rows = 10-box vertical stack right in front of pA
  const boxSize = 0.30;
  const boxIds = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 2; col++) {
      const id = `stack_${row}_${col}`;
      boxIds.push(id);
      addBody(scene, {
        id, shape: 'box', size: [boxSize, boxSize, boxSize], mass: 0.6,
        pos: [(col === 0 ? -1 : 1) * (boxSize * 0.51), 0.2 + boxSize * (0.5 + row), -5.65],
      });
    }
  }
  addBody(scene, {
    id: 'ram', shape: 'box', size: [0.66, 1.55, 0.8], mass: 45,
    pos: [0, 0.98, -5.0],
  });

  const sim = createPhysicsWorld(RAPIER);
  sim.load(scene);
  // settle vertical stack contacts before launching horizontal push
  sim.step(15);
  sim.edit({id: 'ram', vel: [0, 0, -9.5]});

  const totalKE = () => sim.entries.reduce((s, e) => s + bodyKE(e), 0);
  let prevKE = totalKE();
  let maxStepKEGainPct = 0;

  for (let step = 0; step < 90; step++) {
    sim.step(1);
    const curKE = totalKE();
    if (prevKE > 0.05) {
      const gainPct = ((curKE - prevKE) / prevKE) * 100;
      if (gainPct > maxStepKEGainPct) maxStepKEGainPct = gainPct;
      assert.ok(gainPct <= 5.0,
        `stack: KE increased by ${gainPct.toFixed(2)}% > 5% at step ${step} (${prevKE.toFixed(3)} -> ${curKE.toFixed(3)} J)`);
    }
    prevKE = curKE;
  }

  let emergedCount = 0;
  for (const id of boxIds) {
    const e = sim.entries.find((x) => x.id === id);
    assert.ok(e, `stack: box ${id} missing`);
    const p = e.rb.translation();
    if (p.z > -2.0 && p.x > -5.95) emergedCount++;
  }
  assert.equal(emergedCount, 10, `stack: expected all 10 boxes to emerge out of exit portal, got ${emergedCount}`);
  report.stack = {
    emerged: emergedCount,
    teleports: sim.teleportCount,
    maxKEGainPct: +maxStepKEGainPct.toFixed(3),
  };
  sim.dispose();
}

// ---------------------------------------------------------------------------
// 10. Performance budget: 300 bodies with >= 40 in transit at once keep step <= 5 ms and hook <= 0.5 ms
// ---------------------------------------------------------------------------
{
  const scene = createScene({settings: {gravity: [0, -0.3, 0]}});
  const floor = addBlock(scene, {min: [-10, -0.5, -10], max: [10, 0, 10]});
  const wx0 = addBlock(scene, {min: [-10.5, 0, -10], max: [-10, 8, 10]});
  const wx1 = addBlock(scene, {min: [10, 0, -10], max: [10.5, 8, 10]});
  const wz0 = addBlock(scene, {min: [-10, 0, -10.5], max: [10, 8, -10]});
  const wz1 = addBlock(scene, {min: [-10, 0, 10], max: [10, 8, 10.5]});

  const pairs = [
    [[-5, 0, -5], [-10, 3.5, -5], wx0, [1, 0, 0]],
    [[5, 0, -5], [10, 3.5, -5], wx1, [-1, 0, 0]],
    [[-5, 0, 5], [-5, 3.5, -10], wz0, [0, 0, 1]],
    [[5, 0, 5], [5, 3.5, 10], wz1, [0, 0, -1]],
  ];
  for (const [fc, wc, wblk, wn] of pairs) {
    addPortalPair(scene,
      {block: floor.id, face: '+y', c: fc, n: [0, 1, 0], v: [0, 0, -1], a: 1.5, b: 1.5},
      {block: wblk.id, face: '+x', c: wc, n: wn, v: [0, 1, 0], a: 1.5, b: 1.5});
  }

  // place 64 bodies straddling the 4 wide floor portals so >= 40 remain in active transit on every benchmark step
  let idx = 0;
  for (const [fc] of pairs) {
    for (let k = 0; k < 16; k++) {
      const gx = (k % 4 - 1.5) * 0.54;
      const gz = (Math.floor(k / 4) - 1.5) * 0.54;
      addBody(scene, {
        id: `tr_${idx++}`,
        shape: SHAPES[k % 3],
        size: [0.38, 0.38, 0.38],
        pos: [fc[0] + gx, 0.16, fc[2] + gz],
        vel: [0, -0.22, 0],
      });
    }
  }
  const r = rng(99);
  while (scene.bodies.length < 300) {
    const i = scene.bodies.length;
    addBody(scene, {
      id: `bg_${i}`,
      shape: SHAPES[i % SHAPES.length],
      size: [0.4, 0.4, 0.4],
      pos: [-8 + r() * 16, 1.5 + (i % 12) * 0.55, -8 + r() * 16],
      vel: [(r() - 0.5) * 3, -1, (r() - 0.5) * 3],
    });
  }

  const sim = createPhysicsWorld(RAPIER);
  sim.load(scene);
  assert.equal(sim.count, 300);
  assert.ok(sim.activeTransitCount >= 40, `perf: expected >= 40 initial in-transit bodies, got ${sim.activeTransitCount}`);

  // warm up 3 steps then benchmark 60 steps while >= 40 bodies stay simultaneously in transit
  sim.step(3);
  let stepSum = 0, hookSum = 0, maxTransit = 0, minTransit = Infinity;
  const N = 60;
  for (let i = 0; i < N; i++) {
    const ms = sim.step(1);
    stepSum += ms;
    hookSum += sim.lastHookMs;
    if (sim.activeTransitCount > maxTransit) maxTransit = sim.activeTransitCount;
    if (sim.activeTransitCount < minTransit) minTransit = sim.activeTransitCount;
  }
  const avgStepMs = stepSum / N;
  const avgHookMs = hookSum / N;
  assert.ok(minTransit >= 40, `perf: expected >= 40 bodies in transit across every benchmark step, min was ${minTransit}`);
  assert.ok(avgStepMs <= 5.0, `perf: avg step ${avgStepMs.toFixed(3)} ms > 5 ms budget`);
  assert.ok(avgHookMs <= 0.5, `perf: avg hook ${avgHookMs.toFixed(3)} ms > 0.5 ms budget`);
  report.perf300_40 = {
    inTransitMin: minTransit,
    inTransitMax: maxTransit,
    avgStepMs: +avgStepMs.toFixed(3),
    avgHookMs: +avgHookMs.toFixed(3),
    teleports: sim.teleportCount,
  };
  sim.dispose();
}

console.log('transit checks passed:');
for (const [k, v] of Object.entries(report)) {
  console.log(`  ${k}:`, JSON.stringify(v));
}
