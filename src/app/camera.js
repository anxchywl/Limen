// Camera controller: orbit mode (default) with portal-aware retargeting, and free fly mode
// (WASD/QE, Shift faster, mouse look with pointer lock).
// Crossing any portal remaps the fly camera's pose with portalMap and eases its up vector
// back to world up [0, 1, 0] over 1.2 s, adapted from Ianua (~/videos/ianua/src/core/camera.js).

import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {add, apply, applyDir, cross, dot, madd, norm, scale, slerp, sub} from '../core/vec.js';
import {crossing, frame, inside, local, portalMap} from '../core/portal.js';
import {teleportMaps} from '../core/interp.js';

const UPRIGHT_SECONDS = 1.2;

export function createCameraController(threeCamera, canvas, doc) {
  const controls = new OrbitControls(threeCamera, canvas);
  controls.target.fromArray(doc.camera.target);
  controls.enableDamping = true;
  controls.minDistance = 0.5;
  controls.maxDistance = 25;
  controls.update();

  let mode = 'orbit'; // 'orbit' | 'fly'
  let flyState = null;
  let crossedAt = -Infinity;
  let mappedUp = [0, 1, 0];
  let animFly = null;
  let nextPortalIdx = 0;
  let lastCamPos = threeCamera.position.toArray();
  let framedPortals = (doc.portals ?? []).map(frame);
  let maps = teleportMaps(doc.portals ?? []);

  const keysDown = new Set();

  function syncPortals() {
    framedPortals = (doc.portals ?? []).map(frame);
    maps = teleportMaps(doc.portals ?? []);
  }

  function keepInside(p) {
    for (const P of framedPortals) {
      const l = local(P, p);
      if (l[2] > -0.2 && l[2] < 0.6 && inside(P, l, -0.08)) return p;
    }
    return [
      Math.max(-5.7, Math.min(5.7, p[0])),
      Math.max(0.35, Math.min(14, p[1])),
      Math.max(-5.7, Math.min(5.7, p[2])),
    ];
  }

  function initFlyState() {
    const pos = threeCamera.position.toArray();
    // Compute current forward direction from camera rotation
    const dir = [0, 0, -1];
    const q = threeCamera.quaternion;
    // qrot(q, dir)
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const ix = qw * dir[0] + qy * dir[2] - qz * dir[1];
    const iy = qw * dir[1] + qz * dir[0] - qx * dir[2];
    const iz = qw * dir[2] + qx * dir[1] - qy * dir[0];
    const iw = -qx * dir[0] - qy * dir[1] - qz * dir[2];
    const fwd = norm([
      ix * qw + iw * -qx + iy * -qz - iz * -qy,
      iy * qw + iw * -qy + iz * -qx - ix * -qz,
      iz * qw + iw * -qz + ix * -qy - iy * -qx,
    ]);
    const up = norm(threeCamera.up.toArray());
    flyState = {pos, fwd, up};
    crossedAt = -Infinity;
    mappedUp = up;
  }

  function setMode(newMode) {
    if (newMode === mode) return;
    if (newMode === 'fly') {
      mode = 'fly';
      controls.enabled = false;
      initFlyState();
      try {
        if (document.pointerLockElement !== canvas) {
          const p = canvas.requestPointerLock?.();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      } catch (_) {}
    } else {
      mode = 'orbit';
      if (document.pointerLockElement === canvas) {
        try {
          document.exitPointerLock?.();
        } catch (_) {}
      }
      controls.enabled = true;
      if (flyState) {
        threeCamera.position.fromArray(flyState.pos);
        threeCamera.up.set(0, 1, 0);
        // Retarget orbit controls in front of the fly camera
        const fwd = flyState.fwd;
        const tx = Math.abs(fwd[1]) > 0.95 ? 0.35 : fwd[0] * 3.0;
        const tz = Math.abs(fwd[1]) > 0.95 ? 0.35 : fwd[2] * 3.0;
        const target = [
          flyState.pos[0] + tx,
          Math.max(0.4, flyState.pos[1] + fwd[1] * 3.0),
          flyState.pos[2] + tz,
        ];
        controls.target.fromArray(target);
        controls.update();
      }
      flyState = null;
    }
  }

  function toggleMode() {
    setMode(mode === 'orbit' ? 'fly' : 'orbit');
  }

  function onPointerMove(e) {
    if (mode !== 'fly' || !flyState) return;
    // Mouse look when in pointer lock or dragging
    const isLocked = document.pointerLockElement === canvas;
    if (!isLocked && !(e.buttons & 1)) return;
    const mx = e.movementX || 0;
    const my = e.movementY || 0;
    if (mx === 0 && my === 0) return;

    const right = norm(cross(flyState.fwd, flyState.up));
    flyState.fwd = norm(madd(madd(flyState.fwd, right, -mx * 0.0025), flyState.up, -my * 0.0025));
  }

  function onPointerDown(e) {
    if (mode === 'fly' && e.button === 0) {
      if (document.pointerLockElement !== canvas) {
        try {
          const p = canvas.requestPointerLock?.();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (_) {}
      }
    }
  }

  function onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      toggleMode();
      return;
    }
    keysDown.add(e.code);
  }

  function onKeyUp(e) {
    keysDown.delete(e.code);
  }

  function onBlur() {
    keysDown.clear();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);

  function flyThrough(idx = (nextPortalIdx++) % Math.max(1, doc.portals.length)) {
    const p = doc.portals[idx];
    const qIdx = doc.portals.findIndex((x) => x.id === p?.pair);
    if (!p || qIdx < 0) return Promise.resolve();
    const P = frame(p), Q = frame(doc.portals[qIdx]);
    const M = portalMap(P, Q);
    const wasOrbit = mode === 'orbit';
    controls.enabled = false;
    return new Promise((done) => {
      animFly = {idx, P, Q, M, t: 0, duration: 1.5, dist: 2.4, wasOrbit, done};
    });
  }

  function update(dt) {
    syncPortals();

    // Scripted flight (P key / test helper)
    if (animFly) {
      animFly.t = Math.min(animFly.duration, animFly.t + dt);
      const s = animFly.dist * (1 - (2 * animFly.t) / animFly.duration);
      const rawPos = madd(animFly.P.c, animFly.P.n, s);
      const rawFwd = scale(animFly.P.n, -1);
      const rawUp = animFly.P.v;
      const pos = s > 0 ? rawPos : apply(animFly.M, rawPos);
      const fwd = s > 0 ? rawFwd : applyDir(animFly.M, rawFwd);
      const up = s > 0 ? rawUp : applyDir(animFly.M, rawUp);
      threeCamera.up.fromArray(up);
      threeCamera.position.fromArray(pos);
      threeCamera.lookAt(pos[0] + fwd[0], pos[1] + fwd[1], pos[2] + fwd[2]);
      lastCamPos = pos;
      if (animFly.t >= animFly.duration) {
        const done = animFly.done;
        const wasOrbit = animFly.wasOrbit;
        animFly = null;
        threeCamera.up.set(0, 1, 0);
        const tx = Math.abs(fwd[1]) > 0.95 ? 0.35 : fwd[0] * 2.5;
        const tz = Math.abs(fwd[1]) > 0.95 ? 0.35 : fwd[2] * 2.5;
        controls.target.set(pos[0] + tx, Math.max(0.4, pos[1] + fwd[1] * 2.5), pos[2] + tz);
        if (wasOrbit) {
          controls.enabled = true;
          controls.update();
        } else if (flyState) {
          flyState.pos = pos;
          flyState.fwd = fwd;
          flyState.up = [0, 1, 0];
        }
        done?.();
      }
      return;
    }

    if (mode === 'fly' && flyState) {
      const isShift = keysDown.has('ShiftLeft') || keysDown.has('ShiftRight');
      const speed = (isShift ? 9.0 : 3.5) * dt;
      const right = norm(cross(flyState.fwd, flyState.up));
      let step = [0, 0, 0];
      if (keysDown.has('KeyW')) step = madd(step, flyState.fwd, speed);
      if (keysDown.has('KeyS')) step = madd(step, flyState.fwd, -speed);
      if (keysDown.has('KeyD')) step = madd(step, right, speed);
      if (keysDown.has('KeyA')) step = madd(step, right, -speed);
      if (keysDown.has('KeyE')) step = madd(step, flyState.up, speed);
      if (keysDown.has('KeyQ')) step = madd(step, flyState.up, -speed);

      const nextPos = add(flyState.pos, step);

      // Check portal crossing
      let crossed = false;
      for (let i = 0; i < framedPortals.length; i++) {
        const P = framedPortals[i];
        if (crossing(P, P, flyState.pos, nextPos) !== null && maps[i]) {
          const M = maps[i];
          flyState.pos = apply(M, nextPos);
          flyState.fwd = norm(applyDir(M, flyState.fwd));
          flyState.up = norm(applyDir(M, flyState.up));
          mappedUp = [...flyState.up];
          crossedAt = performance.now();
          crossed = true;
          break;
        }
      }
      if (!crossed) {
        flyState.pos = nextPos;
      }

      // Ease up back to world up [0, 1, 0] over 1.2 s
      const now = performance.now();
      if (crossedAt > 0) {
        const f = Math.min(1, Math.max(0, (now - crossedAt) / (UPRIGHT_SECONDS * 1000)));
        const ease = f * f * (3 - 2 * f);
        flyState.up = slerp(norm(mappedUp), [0, 1, 0], ease);
      }

      threeCamera.position.fromArray(flyState.pos);
      threeCamera.up.fromArray(flyState.up);
      threeCamera.lookAt(
        flyState.pos[0] + flyState.fwd[0],
        flyState.pos[1] + flyState.fwd[1],
        flyState.pos[2] + flyState.fwd[2]
      );
      lastCamPos = flyState.pos;
      return;
    }

    // Orbit mode: continuous WASD / QE / Arrow translation
    const hasMoveKeys = keysDown.has('KeyW') || keysDown.has('KeyS') ||
                        keysDown.has('KeyA') || keysDown.has('KeyD') ||
                        keysDown.has('KeyQ') || keysDown.has('KeyE') ||
                        keysDown.has('KeyC') ||
                        keysDown.has('ArrowUp') || keysDown.has('ArrowDown') ||
                        keysDown.has('ArrowLeft') || keysDown.has('ArrowRight');

    if (hasMoveKeys) {
      const isShift = keysDown.has('ShiftLeft') || keysDown.has('ShiftRight');
      const speed = (isShift ? 9.5 : 4.5) * dt;

      const pos = threeCamera.position.toArray();
      const target = controls.target.toArray();
      let fwd = sub(target, pos);
      const fwdLen = Math.hypot(fwd[0], fwd[1], fwd[2]);
      if (fwdLen > 1e-4) {
        fwd = [fwd[0] / fwdLen, fwd[1] / fwdLen, fwd[2] / fwdLen];
      } else {
        fwd = [0, 0, -1];
      }

      const worldUp = [0, 1, 0];
      let right = cross(fwd, worldUp);
      let rLen = Math.hypot(right[0], right[1], right[2]);
      if (rLen < 1e-3) {
        right = cross(fwd, [0, 0, 1]);
        rLen = Math.hypot(right[0], right[1], right[2]);
      }
      if (rLen > 1e-4) {
        right = [right[0] / rLen, right[1] / rLen, right[2] / rLen];
      } else {
        right = [1, 0, 0];
      }

      let step = [0, 0, 0];
      if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) step = madd(step, fwd, 1);
      if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) step = madd(step, fwd, -1);
      if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) step = madd(step, right, 1);
      if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) step = madd(step, right, -1);
      if (keysDown.has('KeyE')) step = madd(step, worldUp, 1);
      if (keysDown.has('KeyQ') || keysDown.has('KeyC')) step = madd(step, worldUp, -1);

      const sLen = Math.hypot(step[0], step[1], step[2]);
      if (sLen > 1e-4) {
        const factor = speed / sLen;
        const dx = step[0] * factor;
        const dy = step[1] * factor;
        const dz = step[2] * factor;

        threeCamera.position.x += dx;
        threeCamera.position.y += dy;
        threeCamera.position.z += dz;
        controls.target.x += dx;
        controls.target.y += dy;
        controls.target.z += dz;
      }
    }

    controls.update();
    const curRaw = threeCamera.position.toArray();
    const bounded = keepInside(curRaw);
    if (bounded[0] !== curRaw[0] || bounded[1] !== curRaw[1] || bounded[2] !== curRaw[2]) {
      const bx = bounded[0] - curRaw[0];
      const by = bounded[1] - curRaw[1];
      const bz = bounded[2] - curRaw[2];
      threeCamera.position.fromArray(bounded);
      controls.target.x += bx;
      controls.target.y += by;
      controls.target.z += bz;
    }
    const cur = threeCamera.position.toArray();

    // Check orbit camera portal crossing
    for (let i = 0; i < framedPortals.length; i++) {
      const P = framedPortals[i];
      if (crossing(P, P, lastCamPos, cur) !== null && maps[i]) {
        const nextPos = apply(maps[i], cur);
        const curTarget = controls.target.toArray();
        const curFwd = norm(sub(curTarget, cur));
        const mappedFwd = norm(applyDir(maps[i], curFwd));
        const dist = Math.max(1.5, Math.hypot(curTarget[0] - cur[0], curTarget[1] - cur[1], curTarget[2] - cur[2]));
        const nextTarget = [
          nextPos[0] + mappedFwd[0] * dist,
          nextPos[1] + mappedFwd[1] * dist,
          nextPos[2] + mappedFwd[2] * dist,
        ];
        threeCamera.position.fromArray(nextPos);
        controls.target.fromArray(nextTarget);
        threeCamera.up.set(0, 1, 0);
        controls.update();
        lastCamPos = threeCamera.position.toArray();
        return;
      }
    }
    lastCamPos = cur;
  }

  function dispose() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerdown', onPointerDown);
    controls.dispose();
  }

  return {
    controls,
    get mode() { return mode; },
    setMode,
    toggleMode,
    flyThrough,
    update,
    syncPortals,
    dispose,
  };
}
