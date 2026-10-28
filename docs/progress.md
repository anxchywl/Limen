# Progress

Each build step appends a short note here: what was done, what is left, and the measured numbers.

## 01: scaffold and render loop (2026-11-01)

**Done.** All acceptance checks pass in the in-app preview (entry `limen`, port 5180):
- the vendored deps load from the import map with no 404s
- the coloured room, with 40 stub bodies falling, bouncing and settling
- the fixed 60 Hz loop with interpolation
- instance growth past 512 per shape
- context loss and restore

`node tests/core.mjs` and `node tests/interp.mjs` pass.

### File map

| Path | What |
|---|---|
| `package.json`, `package-lock.json` | pins `three@0.187.0`, `@dimforge/rapier3d-simd-compat@0.21.0`, `@dimforge/rapier3d-compat@0.21.0` (dev deps only) |
| `tools/vendor.mjs` | checks the pins, copies 9 files into `vendor/` (`npm install && node tools/vendor.mjs`) |
| `vendor/three/` | `three.module.js` + `three.core.js` (the module imports the core), `addons/controls/{Orbit,Transform}Controls.js`, LICENSE |
| `vendor/rapier/{simd,compat}/rapier.mjs` | the compat builds inline the wasm as base64, so one 4.6 MB file each; nothing loads them yet |
| `index.html` | import map, full-window canvas `#view`, debug readout `#debug` |
| `.claude/launch.json` | `limen`: `python3 -m http.server 5180` |
| `src/main.js` | wiring: document → renderer, stub sim, loop, OrbitControls, readout, debug keys, `window.limen` |
| `src/app/loop.js` | `createLoop({sim, render, dt, maxSteps})`: rAF, fixed-step accumulator, ≤ 4 steps per frame, backlog dropped, `resync()` on tab return; owns the prev/curr frame buffers and grows them with `sim.slots` |
| `src/app/stubsim.js` | main-thread stand-in: gravity, terminal speed, bounce and friction against every block (convex planes), "settle flat" nudge. Interface: `slots`, `write(buf)`, `step(buf)`, `add(body)`, `reset()` |
| `src/core/vec.js`, `src/core/portal.js` | copied unchanged from Ianua (header line added) |
| `src/core/quat.js` | quaternions `[x,y,z,w]`: `qmul`, `qrot`, `qaxis`, `qfromR` (map R → quat), allocation-free `qslerpAt` |
| `src/core/frame.js` | frame buffer layout: `HEADER = 4` (step, time, count, spare), `STRIDE = 16`, offsets, flag bits, `teleportOf`, `withTeleport` |
| `src/core/interp.js` | `teleportMaps(portals)`, `blendSlot(prev, curr, i, alpha, maps, out)`: lerp/slerp, maps the older pose through the portal when the teleport bits are set, snaps fresh slots, blends the clone pose into `out[7..13]` |
| `src/core/scene.js` | the document: `createScene`, `addBlock`, `addBody`, `newId` (via `nextId`), `rng`, `randomBody`, `defaultScene` |
| `src/render/renderer.js` | WebGL2 `WebGLRenderer` (stencil, antialias, DPR ≤ 2), Neutral tone mapping, hemisphere + sun with a 2048 shadow map, context loss and restore (restore rebuilds level and instances), GPU timer (`EXT_disjoint_timer_query_webgl2`) |
| `src/render/level.js` | all blocks merged into one mesh (1 draw). Face colour comes from the normal via `ROOM`. Per-vertex `aEdge` holds the distances to the face borders |
| `src/render/instances.js` | one `InstancedMesh` per shape (box, ball, capsule, plank), with per-instance colour and an `aClip` vec4. Capacity starts at 512 and doubles by reallocating. `update()` writes the blended matrices without allocating |
| `src/render/ink.js` | the `MeshLambertMaterial` patch. Ink lines have a constant pixel width (fwidth): borders on faces, and rim, equator and meridian on balls and capsules. It also stretches capsules and does the per-instance clip discard, and has a matching depth material for shadows |
| `src/render/palette.js` | Ianua's `PAPER`/`INK`/`PORTAL`/`hex` unchanged, plus `ROOM` (saturated per normal), `BODY`, and four portal colours (`PORTAL_COLOURS`) |
| `tests/core.mjs` | inverse maps, doorway, the map quaternion, crossing hits and misses, the default scene is stable JSON |
| `tests/interp.mjs` | lerp/slerp, shortest arc, fresh slots, clones, teleport through a fake floor-to-wall pair, loop at 120 Hz and the 30 s clamp |

### Measured (Apple Silicon Mac, in-app browser = WebKit WebGL, DPR 2, canvas 1114 × 1506)

Main-thread ms is `performance.now()` around `loop.tick`: sim steps, blending, matrix upload and `renderer.render` submission. GPU ms comes from timer queries.

| Case | Main thread per frame | GPU per frame |
|---|---|---|
| 40 bodies, real rAF at 60 Hz | 0.43 ms avg | 3.0 ms |
| 2,040 bodies, real rAF, 142 frames | avg 0.81, p50 0.60, p95 2.20, max 4.00 ms; 0 frames over 4 ms | 5.6 ms |
| 2,040 bodies, 600 synthetic ticks | avg 0.35, p95 0.4, max 0.6 ms | n/a |
| stub sim alone, 2,040 bodies (node) | 0.23 ms per step | n/a |

- **Draws per pass:** 10 calls, with shadows. Level 1, bodies 4, then the same again for the shadow map.
- **Smoothness:** with 240 frames at a simulated 120 Hz, alpha alternates 0.10 → 0.60 between steps. It rose on all 119 frames that had no step, with 0 non-monotonic frames, and the same held at 144 Hz and 90 Hz. With real rAF at 60 Hz, there was exactly 1 step per frame and alpha held a steady phase around 0.27.
- **Hidden tab:**
  - A 30 s gap gives 4 steps (the clamp), then 1 step per frame.
  - `visibilitychange` calls `resync()`, so a real return gives 0 extra steps.
  - The hidden in-app pane runs at about 1 to 5 fps, and the clamp holds it to 4 steps per frame.
- **Growth:** two presses of `B` gave 4,040 bodies. Capacities became box 2048, ball 2048, capsule 1024 and plank 512, with no GL errors (`gl.getError() = 0`).
- **Context loss:** `WEBGL_lose_context` left the sim stepping and the drawing skipped. After restore, the level and instances were rebuilt and the scene drew again with no errors.

### Decisions to know

- **Open-topped room.** The 12 × 6 × 12 room has a floor and four 6 m walls, but no ceiling. The sun can then light it, and the orbit camera can look in from above. `main.js` clamps the camera inside the footprint (`keepInside`) so walls never block the view. That is a stopgap until prompt 05's camera.
- **Body schema.**
  - `size` is the full extent `[x, y, z]`. A ball is `[d, d, d]` and a capsule `[d, h, d]`, with caps of diameter `d` and total height `h`.
  - `color: null` means a colour picked by id hash from `BODY`.
  - Blocks: `color: null` means colour by face normal. Ramps and pillars use `pos`, `rot` (a quaternion) and `size`, and a ramp rises along its local +x.
- **Lighting.**
  - three's lights are divided by π, hence the high intensities: hemisphere 2.7, sun 3.0.
  - The sun is high, at (5, 20, 3), so wall shadows stay short.
  - Neutral tone mapping keeps the hues.
  - Grey is avoided by a lilac sky and a peach ground.
- **Dev deps.** `node_modules/` is ignored. `package-lock.json` is committed.

### For prompt 02

- **Stencil.** It is on (`stencil: true`). Each pass draws `level.group` and `bodies.group` from `view.scene`. That is 5 draws per pass plus a shadow pass. Render the shadow map once per frame, not per portal view: set `renderer.shadowMap.autoUpdate = false` and `needsUpdate = true` once per frame.
- **Clip planes.** Use `view.bodies.setClip(shape, j, [nx, ny, nz, w])`. Fragments with n·p + w < 0 are discarded, and `(0,0,0,0)` turns the clip off. Mind the indexing: `j` is the instance index within that shape, not the slot. `kinds[shape].slots[j]` maps instance to slot, so build the inverse if you need it. The shadow depth material clips too.
- **Clones.** `blendSlot` already returns the clone pose in `out[7..13]` when `HAS_CLONE` is set. `instances.update()` only draws masters, so draw clones either as extra instances or in a second pass.
- **Ink in recursive views.** Ink uses fwidth, so it stays 0.6 to 0.7 px wide at every depth. Width is the `uInkWidth` uniform in `material.userData.ink`. Add the per-pass tint as another uniform in `ink.js`, using the same `onBeforeCompile` patch (`FRAG_INK` is the place).
- **Teleport maps.** `teleportMaps(doc.portals)` is computed once in `main.js` and passed to `view.draw()`. Recompute it whenever portals change.
- **Ianua oracle.** The test needs Ianua's ray tracer. Read it from `~/videos/ianua/src/render/renderer.js` and copy it; never edit it there.

### For prompt 03

- `src/core/frame.js` holds the layout. Have `src/physics/protocol.js` re-export it rather than redefine it.
- **The stub's interface.** The loop calls `sim.step(curr)` synchronously and swaps buffers. A worker posts frames asynchronously, so the bridge should hand the loop the newest two frames it has received, and keep the interface shape: `slots`, `write`, `step`, `add`, `reset`.
- **Escaping bodies.** Bodies can leave the open-topped room over the walls, so add a kill plane or a respawn.
- **Debug keys.** `B` spawns 2,000 stub bodies with weighted shapes. `R` resets the sim. `window.limen` exposes `doc`, `view`, `sim`, `loop`, `spawn`, `reset` and `recordAlpha(ms)`.

## 02: portal rendering and recursion (2026-11-01)

**Done.** All acceptance checks pass on `http://localhost:5180` and in headless Node:
- two `0.7 × 1.0` m portal pairs in `defaultScene()`: blue floor ↔ `-x` wall (aligned at 45° so each opening sees its partner recursively) and orange `-z` wall ↔ `-x` wall at right angles
- ellipse rims in pair colours with constant-pixel ink borders, flat ellipse openings for stencil marking/depth restore, and inward-facing `-0.20` m pockets when the main camera comes within `near × 3`
- breadth-first view planner with screen-space scissor rects, back-face and `< 0.2%` area culling, view/depth budgets (`6 / 32` desktop, `3 / 12` when `(pointer: coarse)` matches), per-pass portal tint (`uPassTint`), darkened pair-colour terminal fills, and single shadow-map pass per frame
- Lengyel oblique near-plane projection (`src/render/oblique.js`), unit-tested in `tests/oblique.mjs`
- clipped master + clone instances driven by `HAS_CLONE` and `SPARE` (entry portal index), exercised by a sliding crimson box oscillating through the floor portal in `stubsim.js`
- `P` debug key and `window.limen.flyThrough(idx)` flying straight through all four portals with zero wall flash
- geometry oracle (`tests/oracle.html`) against Ianua's ray tracer: `1 / 115,515` differing silhouette pixels (`0.0009%`, `< 1%` threshold)

`node tests/core.mjs`, `node tests/interp.mjs` and `node tests/oblique.mjs` pass.

### File map

| Path | What |
|---|---|
| `src/render/oblique.js` | `applyObliqueNearPlane(camera, exitCenter, exitNormal, clipBias)`: Lengyel oblique near-plane modifier adapted from three.js `Reflector.js`, zero-allocation |
| `src/render/portals.js` | `createPortals(doc)` and `defaultViewBudget()`: rim/opening/pocket geometries, allocation-free BFS view planner with Sutherland–Hodgman near-plane scissor projection, stencil mark/clear/restore and terminal fills |
| `src/render/renderer.js` | multi-pass stencil recursion (`INCR` → tinted sky/depth clear → virtual render → opening depth restore & `DECR`), single shadow update per frame, `view.stats`, `view.budget`, `view.rebuildPortals()`, optional `measureFinish` timing |
| `src/render/ink.js` | `uPassTint` uniform in `FRAG_INK` and default `stencilWrite: true, stencilFunc: EqualStencilFunc` on `inkMaterial` |
| `src/render/level.js` | exposes `material`, `frustumCulled = false`, and `polygonOffset (1, 2)` so coplanar portal openings at exact `z = 0` beat host walls without pulling ahead of straddling bodies |
| `src/render/instances.js` | `setPortals(portals)`, `materials`, and clipped clone instances appended to each shape's `InstancedMesh` from `HAS_CLONE` + `SPARE`, with seamless mid-straddle teleport pose mapping |
| `src/core/scene.js` | `PORTAL_COLOURS`, `addPortal`, `addPortalPair`, and the two default portal pairs + floor-portal debug box in `defaultScene()` |
| `src/app/stubsim.js` | deterministic slot-0 slider through the floor portal writing `HAS_CLONE`, `CLONE_POS`, `CLONE_QUAT`, `SPARE` and `withTeleport` via `portalMap` |
| `src/main.js` | `P` debug key + `flyThrough(idx)`, portal-aware `keepInside()` and orbit crossing, `views/budget d/maxD` in `#debug` |
| `tests/oblique.mjs` | unit tests for `applyObliqueNearPlane` on axis-aligned and `portalMap`-transformed virtual cameras |
| `tests/oracle.html`, `tests/vendor-ianua/{renderer,palette}.js` | matched 1-room, 1-pair, 3-box silhouette comparison against a read-only copy of Ianua's ray tracer |
| `tests/core.mjs` | updated default-scene check for the two portal pairs and unique IDs across blocks, portals and bodies |

### Measured (Apple Silicon Mac, Chrome Headless Metal WebGL2, DPR 2, 2560 × 1800 buffer)

| Case | Main thread per frame | GPU per frame | Views / depth / draws |
|---|---|---|---|
| 40 bodies, default view | 0.39 ms avg | 6.47 ms | 4 views, d1/6, 60 draws |
| 300 bodies, depth-6 corridor, real rAF (90 frames) | avg 0.77, p50 0.60, p95 2.00, max 2.20 ms (≤ 4 ms budget) | 4.94 ms timer query (≤ 10 ms budget) | 7 views, d6/6, 1 terminal, 92 draws |
| 300 bodies, depth-6 corridor, 240 synthetic ticks | avg 0.29, p95 0.60 ms | n/a | 7 views, d6/6, 92 draws |
| Phone emulation (`390 × 844`, DPR 2, `pointer: coarse`) | 0 errors, 0 404s | `gl.getError() = 0` | budget `12`, `d3/3`, 3 views, 1 terminal, 48 draws |

- **Oracle (`tests/oracle.html`):** `1` differing pixel out of `115,515` compared pixels (`0.0009%`; `3.74%` masked ink/rim style band).
- **Camera crossing (`flyThrough(0..3)`):** 180-frame flights at 120 Hz across all four portals (`p10`–`p13`) had max centre-patch frame-to-frame deltas of `6.0` to `15.3 / 255` through the `±0.13 m` near-plane window, with zero wall flashes or black frames.

### For prompt 03 (and prompt 04)

- **Frame buffer clone contract.** Keep `src/core/frame.js` as the single layout definition and re-export it from `src/physics/protocol.js`. When `HAS_CLONE` is set on slot `i` (prompt 04 `transit.js`), write the clone world pose to `CLONE_POS` / `CLONE_QUAT` and write the **entry portal index** (`0 .. doc.portals.length - 1`) to `slot[SPARE]` (`offset 15`). `instances.js` already clips the master against `entry`, clips and scales the clone against `exit`, and maps the clone cleanly across mid-straddle teleport steps.
- **Replacing `stubsim.js`.** Prompt 03 replaces `createStubSim` with the Rapier worker bridge behind `slots`, `steps`, `write`, `step`, `add`, `reset`. Once Rapier drives slot 0 in prompt 03, bodies will simply fall onto the solid floor until prompt 04 adds portal sensors and transit clones.
- **Rebuilding portals.** Whenever `doc.portals` changes, call `view.rebuildPortals()` and refresh `maps = teleportMaps(doc.portals)`.
- **Debug handles.** Keys are `B` (spawn 2,000), `R` (reset), `P` (fly through next portal). `window.limen` exposes `doc`, `view`, `sim`, `loop`, `controls`, `spawn`, `reset`, `flyThrough(idx)` and `recordAlpha(ms)`.
