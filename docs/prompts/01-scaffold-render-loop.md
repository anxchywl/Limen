# 01: scaffold and render loop

You are starting Limen, a browser portal-physics sandbox, in `~/limen`. This repo is a git repo with no remote. First read `docs/prompts/00-overview.md`, then `docs/research.md` §1 (what Ianua gives us), §5 (render stack) and §6 "Loop and threads". Read nothing else from research.md.

## Previous steps

Only docs exist: `docs/research.md`, `docs/prompts/`, `START_HERE.md`. There is no code yet.

## Scope

Build the skeleton every later step stands on:

1. **Vendored dependencies.** Add a `package.json` with `three@0.187.0` and `@dimforge/rapier3d-simd-compat@0.21.0` + `@dimforge/rapier3d-compat@0.21.0` pinned. Write `tools/vendor.mjs` to copy only the needed files into `vendor/three/` (`three.module.js` plus the addons later prompts need: `controls/TransformControls.js`, `controls/OrbitControls.js`) and `vendor/rapier/`. Commit `vendor/`. Leave `node_modules/` out, via `.gitignore`.
2. **`index.html`.** An import map (`three` → `./vendor/three/three.module.js`, `three/addons/` → `./vendor/three/addons/`), a full-window canvas, and no UI yet beyond a tiny debug readout (frame ms, step count). Add `.claude/launch.json` with entry `limen`, `python3 -m http.server 5180`.
3. **The core.** Copy `vec.js` and `portal.js` from `~/videos/ianua/src/core/` into `src/core/`, unchanged except for a header line noting where they came from. Add `tests/core.mjs`, ported from the relevant asserts in Ianua's `tools/check-portals.js`. It must check:
   - `portalMap` followed by its inverse is the identity
   - back-to-back portals act as a doorway
   - `crossing` hits and misses
4. **The scene document.** Write `src/core/scene.js` with the schema from the overview: `createScene()` defaults, `addBlock` and `addBody` helpers, and id generation. Include one built-in default scene: a 12 × 6 × 12 m room made of blocks, a few blocks inside it, and about 40 bodies of mixed shapes placed in the air. No portals yet.
5. **The renderer** (`src/render/`):
   - **`renderer.js`:** a `WebGLRenderer` with `stencil: true` and `antialias: true`, DPR capped at 2, resize handling, and `webglcontextlost`/`webglcontextrestored` listeners. The restore handler may simply rebuild everything for now.
   - **`level.js`:** builds the static blocks from the document, merged per material.
   - **Wall colours:** each block face gets its colour from its normal direction, using the coloured-room palette in `palette.js`, ported from Ianua.
   - **Edges and lighting:** thin ink edges using `EdgesGeometry` or a fresnel outline in the shader. Soft daylight: one directional light with a shadow map sized for the room, plus a hemisphere light.
   - **`instances.js`:** one `InstancedMesh` per shape (box, sphere, capsule, plank as a scaled box), with per-instance colour. Capacity is 512 per shape, grown by reallocating if exceeded. Add a per-instance `vec4` clip-plane attribute now, through `onBeforeCompile`. The value `(0,0,0,0)` means no clip. Prompt 02 uses it for slices.
6. **The loop** (`src/app/loop.js`):
   - `requestAnimationFrame` drives rendering.
   - A fixed-step accumulator at 60 Hz, clamped to 4 steps per frame, advances a **stub simulation**: simple ballistic motion with bounce on the floor, in plain JS on the main thread. Prompt 03 replaces it with the worker; keep the stub behind the same interface (`step()`, `frame` buffer in the overview's 16-float layout).
   - Render interpolates between the last two frame buffers by `alpha = accumulator / dt`. Positions use lerp; quaternions use slerp.
   - Include the teleport hook now: if a slot's teleport field is set, map the previous pose through the portal before blending. Use a no-op until portals exist, but write and unit-test the function in `tests/interp.mjs` with a fake portal pair.
7. **The camera.** An orbit camera (vendored `OrbitControls`) aimed at the room.

## Files you own

`package.json`, `.gitignore`, `tools/vendor.mjs`, `vendor/**`, `index.html`, `.claude/launch.json`, `src/main.js`, `src/app/loop.js`, `src/core/*`, `src/render/renderer.js`, `src/render/level.js`, `src/render/instances.js`, `src/render/palette.js`, `tests/core.mjs`, `tests/interp.mjs`, `docs/progress.md` (create it).

## Do not touch

`docs/research.md` and `docs/prompts/*`. Anything under `~/videos/` is read only. Add no portal rendering, physics engine, editor UI or sharing; later prompts own those.

## Acceptance

- [ ] `node tests/core.mjs` and `node tests/interp.mjs` pass.
- [ ] `preview_start {name: "limen"}` shows the coloured room with 40 bodies falling and bouncing smoothly. The console has no errors and the network tab has no 404s.
- [ ] Smoothness: with the display at 120 Hz (or simulated by rendering at 2× the step rate), bodies move without stepping or jitter. Prove it by logging the interpolation alpha per frame for 2 s: it must be monotonic between steps.
- [ ] Hidden tab: hide the tab for 30 s, then return. No burst of steps (the clamp works) and no freeze.
- [ ] Spawning 2,000 stub bodies with a debug key grows the instance capacity without errors. Main-thread time per frame stays ≤ 4 ms on desktop. Measure with `performance.now()`, not fps.
- [ ] Context loss: force it with `WEBGL_lose_context`. The scene comes back after restore.
- [ ] Take a screenshot for the user. Check that it looks vivid (saturated wall colours, ink edges), not grey.
- [ ] Append to `docs/progress.md`: the file map, measured ms numbers, and anything left for 02.
- [ ] Commit, for example `feat: scaffold, vendored three and rapier, instanced room and fixed-step loop`.
