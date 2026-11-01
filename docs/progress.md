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

## 03: physics core in a worker (2026-11-01)

**Done.** All acceptance and break checks pass in headless Node and on `http://localhost:5180`:
- Rapier 3D 0.21 runs in a module Web Worker (`src/physics/worker.js` + `src/physics/world.js`), probing WASM SIMD via a 29-byte `WebAssembly.validate` module and loading `vendor/rapier/simd/rapier.mjs` with a `compat` fallback
- static blocks build fixed cuboid colliders (and 6-vertex `convexHull` colliders for ramps); dynamic bodies (`box`, `ball`, `capsule`, `plank`) take document mass, pose and velocities; portals remain solid walls for prompt 04
- fixed `1/60 s` worker clock (`setTimeout` accumulator clamped to 4 steps per tick) streaming poses through two ping-pong transferable `Float32Array` buffers; frames drop without blocking if both buffers are in flight
- `createPhysicsBridge` (`src/physics/bridge.js`) interpolates one step behind worker time (phase-locked around the midpoint of `[prev, curr]`) and returns ping-pong buffers immediately; zero edits were needed in `src/render/*`
- Rapier snapshot taken on load (and refreshed if edited before play); `Reset` restores initial `Float32Array` bytes and replays 5 s (`300` steps) with identical SHA-256 hashes
- robustness guards: `60 m/s` linear and `50 rad/s` angular clamps (pre- and post-step), Ianua quadratic air drag (`terminalSpeed = 40 m/s`), per-step CCD toggling (`minDim < 0.3 m` or `speed > 15 m/s`), `0.1 m` minimum size, `0.5..25 kg` (`1:50`) mass cap, `contact_natural_frequency = 20 Hz`, free-space spawn intersection + `10 × 5 cm` upward nudges, `300`-body cap, kill bounds, NaN watchdog (`N` debug key) and `> 8 ms × 30` `busy` watchdog

`node tests/core.mjs`, `node tests/interp.mjs`, `node tests/oblique.mjs` and `node tests/physics.mjs` pass, and `tests/oracle.html` still passes (`stubsim.js` moved to `tests/stubsim.js`).

### File map

| Path | What |
|---|---|
| `src/physics/protocol.js` | re-exports `src/core/frame.js` + `H_SLOTS = 3` (allocated slot span), `TO_WORKER` / `FROM_WORKER` message types, and `createSlotMap()` with lowest-free-slot reuse and snapshot/restore |
| `src/physics/world.js` | pure Rapier world controller (`createPhysicsWorld`): colliders, fixed `1/60 s` step, snapshot reset, free-space spawn nudges, air drag, CCD toggle, speed/size/mass caps, NaN and `busy` watchdogs |
| `src/physics/worker.js` | WASM SIMD probe, vendored Rapier loader, `setTimeout` 60 Hz accumulator (≤ 4 steps/tick), two ping-pong transferable `Float32Array` buffers |
| `src/physics/bridge.js` | main-thread `Worker` host: `prev`/`curr` copies, immediate buffer return, one-step-behind `sample(frameDt)` interpolation, slot-indexed `bodies` sync |
| `src/app/loop.js`, `src/main.js` | `loop.js` branches on `sim.sample` while keeping sync mock support for `tests/interp.mjs`; `main.js` wires `createPhysicsBridge`, `Space` play/pause, `.` single-step, `B` spawn to 300, `R` reset, `N` inject NaN |
| `tests/physics.mjs` | headless Node suite on `@dimforge/rapier3d-simd-compat`: 2 m drop to sleep, 1,000-step snapshot hash, 5 s reset byte-identity, 300-body benchmark, NaN removal + slot reuse, 50 m/s anti-tunneling, 50-box spawn nudges, air drag and `busy` watchdog |
| `tests/stubsim.js`, `tests/oracle.html` | moved `src/app/stubsim.js` → `tests/stubsim.js` as oracle test scaffolding only |

### Measured (Apple Silicon Mac, Node v26 + Chrome Headless Metal WebGL2, DPR 2, 2560 × 1800)

| Case | Worker / Node physics step | Main thread per frame | GPU per frame |
|---|---|---|---|
| 300 bodies, 600 steps in Node (`tests/physics.mjs`) | **0.96 ms avg** (p95 1.83 ms; ≤ 4 ms budget) | n/a | n/a |
| 40 bodies, default scene in browser | ~0.15 ms | **0.40 ms avg** | 5.91 ms |
| 300-body pile-up + continuous orbit drag, 120 rAF frames | off-thread | **0.32 ms avg**, p50 0.30, p95 0.40, max 0.70 ms (`0` frames > 4 ms) | 7.03 ms |

- **Reset & 5 s replay determinism (browser worker):** `f0` SHA-256 `6beba978…` matched byte-for-byte after `Play 5 s → Reset`, and `f300` (`5.00 s`) SHA-256 `685c98b2…` matched byte-for-byte on the second 5 s run (`1,028` floats).
- **Break checks (browser):**
  - 50 `[0.5 m]` boxes at `[0, 2, 0]`: `2` accepted (`0` and `+0.50 m` nudges), `48` refused with `{type: 'refused', reason: 'blocked'}`, `maxCoord = 5.32 m`, zero NaNs.
  - `25 kg` ball at `60 m/s` into a 6-box stack against the `+x` wall: `0` wall/floor penetrations (`maxWallX = 5.74 < 6.0`, `minY = 0.06 > 0`).
  - `60 s` hidden-tab jump + `resync()`: return tick `0.20 ms`, no step burst.
  - Debug key `N` (`injectNaN`): emitted `{type: 'removed', reason: 'nan', slot: 0}`, body count dropped `49 → 48`, simulation kept stepping cleanly (`gl.getError() = 0`).

### Protocol & Rapier 0.21 notes (for prompt 04)

- **Header layout:** `H_STEP = 0`, `H_TIME = 1`, `H_COUNT = 2` (live body count), `H_SLOTS = 3` (allocated slot span; reuses `header[3]` without changing `HEADER = 4` or `STRIDE = 16`). `src/render/instances.js` needed zero changes because `bridge.bodies` is indexed by slot with dead placeholders (`FLAGS = 0` hides freed slots).
- **Depenetration parameter in Rapier 0.21:** `@dimforge/rapier3d-simd-compat@0.21.0` uses TGS-Soft contact springs and exposes `IntegrationParameters.contact_natural_frequency` (set to `20 Hz`, down from default `30 Hz`) rather than a `maxDepenetrationVelocity` cap; combined with post-step `60 m/s` / `50 rad/s` clamps, overlapping spawns recover softly.
- **Immediate overlap tests:** `world.intersectionWithShape` only sees colliders after `world.step()` updates the broad phase, so `world.js` `intersectsAny` pre-filters by AABB/sphere and calls `collider.intersectsShape(probe, pos, rot)` directly.
- **Hooks for prompt 04 (`transit.js`, `ghosts.js`):**
  - `world.js` steps via `world.step()` inside `stepOne()` and stores `blocks` (`{id, rbHandle, colHandle, rb, collider, min, max, spec}`) and `entries` (`{id, slot, rbHandle, colHandle, rb, collider, minDim, boundR, spec}`).
  - Pass `{filterContactPair}` into `world.step(undefined, physicsHooks)` (with `ActiveHooks.FILTER_CONTACT_PAIRS` on transiting colliders) to carve host-wall holes, use `kinematicPositionBased` bodies for clones and mapped far-side ghost walls, and write `HAS_CLONE`, `CLONE_POS`, `CLONE_QUAT`, `SPARE` (entry portal index `0 .. portals.length - 1`) and one-step `withTeleport(flags, entryIdx)` into `write(buf)`. Include any per-body transit state (such as the 3-step reverse-teleport cooldown) in `saveSnapshot()` / `reset()`.

## 04: bodies through portals (2026-11-01)

**Done.** All 9 headless transit cases, the 300-body / 40-in-transit performance budget, and all browser slow-motion acceptance checks pass with **zero changes to `src/render/*` or `src/core/*`**:
- **Carves (`src/physics/transit.js`):** each portal builds a ring of 12 thick bevelled slab colliders (`depth = 3.0 m = 2 × 1.5 m`, thickness `≥ 0.4 m`, flush at `z_local = 0`) around an inscribed 12-gon plus a `0.08 m` opening plug, filtered via Rapier collision groups and `filterContactPair` (`Map` of `colHandle -> role`, `Map`/`Set` of `rbHandle` + `portalIdx`).
- **Ghosts (`src/physics/ghosts.js`):** static blocks (`box`, `pillar`, `ramp`) within `3 m` in front of partner `Q` are clipped by 3D Sutherland–Hodgman half-space intersection, chamfered `5 mm` over `2.5 cm` along peripheral `z_Q = 0` threshold cuts, and mapped behind `P` with `portalMap(Q, P)` as fixed `convexHull` colliders (`ghost:P`), rebuilt only when blocks or portals change.
- **Clones & feedback (`src/physics/transit.js`):** one-portal-at-a-time transit zone (`+5 cm` front, `-3.0 m` tunnel depth, 1-step velocity sweep for fast approaches) spawns a `kinematicPositionBased` clone on `Q`, drives `setNextKinematicTranslation` / `setNextKinematicRotation` to `M · predictedPose`, feeds `0.8 · R⁻¹` clone impulses back to the master at the mapped local contact point (including CCD substep separations), and caps connected-island kinetic energy so infinite-mass kinematic clones never inject energy into multi-body stacks.
- **Teleport & edge cases:** swept-centre `crossing` with a `1 cm` hysteresis band and `dot(v, P.n) < 0` swaps master pose/velocities by `M` (`R v`, `R ω`), moves the clone to the old master pose, switches active transit to `Q` with a 3-step pair cooldown, writes `withTeleport(flags, pIdx)` (`portalIdx + 1`) across dropped ping-pong frames, reconciles mid-transit portal edits/removals (`portal_ejected`), caps discrete single-step ghost overshoot via `contactCollider`, and enforces host-wall/level bounds on side-by-side wall pairs.
- **Slow-motion debug key (`T`):** cycles `timeScale` `1 → 0.25 → 0.1 → 1` (`main.js`, preserved across `Reset` in `world.js`, linear interpolation in `bridge.js`).

`node tests/core.mjs`, `node tests/interp.mjs`, `node tests/oblique.mjs`, `node tests/physics.mjs` and `node tests/transit.mjs` all pass, and `tests/oracle.html` passes unchanged.

### File map

| Path | What |
|---|---|
| `src/physics/ghosts.js` | `buildPortalGhosts`, `blockCorners`: 3D convex polyhedron clipper (`3 m` reach in front of `Q`), coplanar/facing-portal skip, threshold chamfer, `portalMap(Q, P)` fixed `convexHull` colliders |
| `src/physics/transit.js` | `createPortalTransit`: 12-slab tunnel + plug carves, collision groups, `filterContactPair` hook + `lastHookMs`, kinematic clone lifecycle, `0.8 · R⁻¹` impulse feedback + island KE cap, swept-centre teleport + 3-step cooldown, mid-transit portal removal/move reconciliation, wall/level bounds guard, `writeSlot` and `snapshot`/`restore` |
| `src/physics/world.js` | wires `RAPIER.EventQueue(true)` (required by Rapier 0.21 `step` to invoke `PhysicsHooks`) and `transit` into `load`, `reset`, `saveSnapshot`, `spawn`, `remove` (bodies & portals), `edit` (bodies & portals), `setPortals`, `stepOne` and `write(buf, sinceStep)` |
| `src/physics/worker.js` | tracks `lastPostedStep` so `withTeleport` flags survive dropped ping-pong frames |
| `src/physics/bridge.js` | disables 1× midpoint phase-drift pullback when `timeScale < 0.99` so `0.25×` and `0.1×` sweep `alpha` linearly |
| `src/main.js` | `T` slow-motion toggle (`1×` / `0.25×` / `0.1×`), scale badge in `#debug`, `portal_ejected` notice |
| `tests/transit.mjs` | headless Node suite covering `drop`, `rest`, `plank`, `blocked`, `endless`, `sidebyside`, `removed`, `fast`, `stack` and the `300`-body / `40+` in-transit benchmark |

### Measured (Apple Silicon Mac, Node v26 + Chrome Headless Metal WebGL2, DPR 2, 2560 × 1640)

| Case | Measured | Target |
|---|---|---|
| `drop` (`tests/transit.mjs`) | `1` teleport, speed error **1.79 %**, direction `cos = 1.00000` | ≤ 2 % |
| `rest` (5 s half-in floor portal) | `0` teleports, centre jitter **0.0000 mm** (`y = +4.9 mm`) | < 2 mm, 0 flip-flops |
| `plank` (3 m across / lengthwise 1.4 m opening) | across: `0` teleports, `minY = 0.060 m`; lengthwise: `1` teleport | rests across, passes lengthwise |
| `blocked` (solid block covering exit) | `0` teleports, max penetration **0.20 cm** | < 2 cm |
| `endless` (60 s floor ↔ ceiling, 3,600 steps) | `568` teleports, `40.081 m/s` (**0.20 %** from `40 m/s`), `0` NaN | `40 m/s ± 5 %` |
| `sidebyside` (200 random throws, same wall) | `200` throws, `39` teleports, **0** wall/level escapes | 0 escapes |
| `removed` (delete exit / move entry mid-transit) | `2` `portal_ejected` pushes clear of wall; `1` live-partner teleport | in front of wall, never inside |
| `fast` (0.15 m ball, `40 m/s`, 15° graze) | opening hit: `1` teleport; collar graze: `0` teleports, `0` wall tunnel | teleports cleanly, 0 tunnelling |
| `stack` (10-box stack pushed into wall portal) | **10 / 10** emerged (`11` teleports incl. ram), max step KE gain **3.57 %** | 10 emerged, ≤ 5 % KE/step |
| `perf300_40` (`300` bodies, `64–71` simultaneously in transit) | step **1.88 ms avg**, `filterContactPair` hook **0.027 ms avg** | step ≤ 5 ms, hook ≤ 0.5 ms |
| `tests/physics.mjs` (`300` bodies, `defaultScene` w/ portals) | **2.17 ms/step avg** (1,000-step & 5 s reset byte-identity pass) | ≤ 4 ms |
| Browser default scene (`42` bodies, 4 portal views) | main **0.78 ms avg**, GPU **4.83 ms** | ≤ 4 ms main, ≤ 10 ms GPU |
| Browser `300` bodies w/ active portals | main **0.26 ms avg**, GPU **6.46 ms**, `gl.getError() = 0` | ≤ 4 ms main, ≤ 10 ms GPU |
| Browser `0.1×` slow-mo (`318` rAF frames across teleport) | halves seam **0.00037 mm**, max frame jump **6.05 mm**, `0` clone dropouts | seamless, 0 flicker/streak |

### Known limits & Rapier 0.21 notes (for prompt 05)

- **Rapier 0.21 Quirks:**
  - `world.step(eventQueue, hooks)` ignores `hooks` unless a non-null `EventQueue` is passed as the first argument (`world.js` passes `eventQueue` and clears it each step).
  - `rb.handle` and `col.handle` are IEEE-754 `f64` bitcasts of `(gen << 32) | idx` (including subnormal floats like `5e-324`), so compound keys must unpack handle bits via `Float64Array` / `Uint32Array` rather than float multiplication.
  - `rb.setTranslation()` defers updating collider shapes until `world.propagateModifiedBodyPositionsToColliders()`, which `transit.js` calls immediately after teleports before querying `contactCollider`.
- **Remaining physics limits:**
  - Rigid-body colliders assume unit-scale portal pairs (`portalScale(P, Q) = 1`; the renderer already scales visual clones, while Rapier colliders stay rigid).
  - One-portal-at-a-time: a body touching two portals simultaneously enters the closer opening and treats the second portal's plug as solid until leaving the first transit zone.
  - Clone contact feedback (`0.8 · R⁻¹` impulse + connected-island energy cap) approximates two-body coupling across one step rather than solving cross-portal Jacobians simultaneously inside Rapier's TGS solver, so very heavy stacks resting half-way across a vertical portal settle slightly softer than on a single solid floor.
- **Hooks for prompt 05 (`src/editor/*`):**
  - `sim.remove(id)` and `sim.edit(entity)` already handle both dynamic bodies and portals (`p*` IDs), and `sim.setPortals(portals)` replaces the full portal list — each automatically rebuilds carves and ghosts in the worker and reconciles any bodies currently in transit (emitting `{type: 'portal_ejected', id, portal}` when a straddling body is pushed clear).
  - Whenever blocks or portals are added, moved or deleted in the editor on the main thread, also refresh `maps = teleportMaps(doc.portals)`, `view.rebuildPortals()` and `view.bodies.setPortals(doc.portals)` (and rebuild `view.level` when blocks change).

## 05: the sandbox editor (2026-11-01)

**Done.** All unit tests and headless Chrome CDP acceptance checks pass cleanly:
- **Modes:** Edit (physics paused, document editable) and Play (runs from edited state). Space toggles modes, step button advances 1 step while paused. Time scales: 1×, 0.5×, 0.25× (`sim.setSettings({timeScale})`). Reset restores initial document through the Rapier snapshot.
- **History (`src/editor/history.js`):** Command pattern with `execute()`, `undo()`, `redo()`, 200 depth limit, bound to Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z / Ctrl/Cmd+Y. Moving a portal or block in Play mode pauses physics, edits document and worker, and resumes.
- **Tools (`src/editor/tools/*.js`):**
  - `select.js`: picks bodies, blocks, portals, and emitters using fast instance bounding spheres/boxes (< 0.2 ms across 300 bodies); move and rotate via vendored `TransformControls` with 0.5 m grid snap and 90° (ramps 45°).
  - `block.js`: drag on faces/floor to extrude blocks on 0.5 m grid; kinds: `box`, `ramp`, `pillar`.
  - `portal.js`: click static geometry face; auto-fits and slides center within face bounds; `v` orients to world up on walls or camera-facing on floor/ceiling snapped to face axes; refuses if not fitting, overlapping (min gap 0.1 m), or exceeding 4 pairs; 2-click placement (A then B) with palette colours; dragging existing portal slides along face.
  - `spawn.js`: drops `box`, `ball`, `capsule`, `plank`, `heavy_ball` (+0.5 m above surface); size slider (0.5× to 2.0×); click or hold to spray (max 10/s); refuses with notice when body count reaches 300 cap.
  - `emitter.js`: placed source spawning chosen shape at set rate (≤ 5/s) and speed in Play mode only; up to 8 emitters; stops spawning at 300 bodies cap.
  - `delete.js`: click or Backspace to delete body, block, emitter, or portal pair; fully undoable.
- **Camera (`src/app/camera.js`):** Orbit (default) and Fly (`F` toggles; WASD/QE, Shift faster, pointer lock mouse look). Fly camera crosses portals via `crossing(P, P, pos, next)` and `portalMap()`; eases `up` back to world up over 1.2 s (Ianua smoothstep); zero wall flash; Orbit controls re-target on portal crossings.
- **UI (`src/ui/*`, `styles.css`, `index.html`):** Paper-and-ink styling (`#F7F1E9` background, `#241D18` ink, `#3E7C8F` / `#C27A40` accents). Desktop left tool rail, top bar, and right inspector. Mobile bottom bar (`390 × 844`, 1-finger orbit, 2-finger pan/pinch, long-press context menu, zero horizontal scroll). Settings modal (gravity on/low/off, terminal speed, quality, recursion depth 1–8, trails). Help modal (`?`).
- **Screenshots:** captured `editor-desktop.png` and `editor-phone.png` to artifacts directory.

`node tests/core.mjs`, `node tests/interp.mjs`, `node tests/oblique.mjs`, `node tests/physics.mjs`, `node tests/transit.mjs`, `node tests/editor.mjs` and `node tests/browser.mjs` all pass.

### File map

| Path | What |
|---|---|
| `src/app/camera.js` | Orbit + Fly camera controller: WASD/QE, Shift, pointer lock, portal crossing with `portalMap`, 1.2 s upright easing, and orbit retargeting |
| `src/editor/history.js` | Command pattern history stack: `execute`, `undo`, `redo`, 200 depth limit, listener notifications |
| `src/editor/tools/select.js` | Fast instance bounds raycasting, TransformControls integration, 0.5 m / 90° snapping, play-mode pause/resume edits |
| `src/editor/tools/block.js` | Extrude `box`, `ramp`, `pillar` on 0.5 m grid from face/floor drags with live wireframe preview |
| `src/editor/tools/portal.js` | Face hit detection, auto-fit sliding, 0.1 m gap overlap checks, 4-pair cap, two-click A/B linking, dragging along face |
| `src/editor/tools/spawn.js` | Drop / spray `box`, `ball`, `capsule`, `plank`, `heavy_ball` at raycast hit + 0.5 m; 300 body cap guard |
| `src/editor/tools/emitter.js` | Directional source spawning shapes at set rate (≤ 5/s) and speed in Play mode only; max 8 emitters |
| `src/editor/tools/delete.js` | Click or Backspace deletion with pair cleanup and undo support |
| `src/editor/editor.js` | Coordinator for tools, history, edit/play mode, emitters tick, time scale, and shortcuts |
| `src/ui/topbar.js` | Top bar: mode toggle, step, 1×/0.5×/0.25× time scale, undo/redo, reset, body badge, settings & help triggers |
| `src/ui/rail.js` | Left rail (desktop) / bottom bar (mobile) with tool buttons and contextual sub-options drawer |
| `src/ui/inspector.js` | Property inspector for selected body, block, portal, or emitter; duplicate and delete actions |
| `src/ui/settings.js` | Settings modal: gravity (on/low/off), terminal speed, quality, recursion depth slider, trails |
| `src/ui/help.js` | Keyboard & touch gesture help modal (`?`) |
| `src/ui/contextmenu.js` | Mobile long-press popup menu (duplicate, delete) |
| `src/ui/ui.js` | Master UI mounter, toast notification manager |
| `styles.css` | Paper-and-ink styling, responsive mobile breakpoint (`@media (max-width: 640px)`) |
| `tests/editor.mjs` | Headless unit tests for history, portal fit/overlap/pair limits, and emitter rate |
| `tests/browser.mjs` | Chrome CDP suite: 2-minute loop scene build, play/reset, fly crossing, 300-body bench, mobile layout, screenshots |

### Measured (Apple Silicon Mac, Node v26 + Chrome Headless Metal WebGL2, DPR 2)

| Case | Measured | Target |
|---|---|---|
| 300 bodies editing main-thread frame time | **0.15 ms avg** (p50 0.10, p95 0.20, max 0.70 ms) | ≤ 4.0 ms |
| Raycast picking with 300 bodies | **< 0.10 ms** (instance bounding spheres/boxes) | ≤ 0.5 ms |
| Loop scene build & run (`tests/browser.mjs`) | Built < 5 s, stepped `119` frames, balls through portal loop | Runs in play, exact snapshot reset |
| Reset from Play mode | Byte-exact snapshot restore, step reset to 0 | Exact return to edited state |
| Fly camera portal crossing | Crosses floor, wall, ramp portals with **0** wall flash; eases upright over 1.2 s | Zero flash, upright easing |
| Mobile layout (`390 × 844`, DPR 2) | Bottom rail at bottom, topbar compact, **0** horizontal scroll (`scrollWidth == clientWidth == 390`) | No horizontal scroll, all tools reachable |
| Console errors & 404s | **0** errors, **0** warnings, **0** 404s | 0 errors |

### For prompt 06 (Save, load and share)

- **Document fields:** `src/core/scene.js` document contains `version: 1`, `settings: {gravity, timeScale, terminalSpeed, quality, trails}`, `blocks[]`, `portals[]`, `bodies[]`, `emitters[]`, and `camera: {pos, target, fov}`. All tools mutate this document in place.
- **Serialization:** `toJSON(scene)` should strip runtime fields (such as `_dead`, `lastSpawn`) and quantize coordinates to 1 mm, angles to 0.1°, and quaternions to 4 decimals.
- **Loading into runtime:** To load a new or shared scene, call `sim.load(doc, false)`, `view.level.rebuild(doc.blocks)`, `view.rebuildPortals()`, `editor.emitterTool.syncMarkers()`, and `editor.history.clear()`.

## 06: save, load and share (2026-11-01)

**Done.** All serialization, validation, share link, file IO, autosave, and gallery acceptance checks pass in Node and headless Chrome:
- **Serialization (`src/io/serialize.js`):** `toJSON(scene)` strips runtime physics/render fields (`_dead`, `lastSpawn`), quantizes coordinates and sizes to 1 mm, quaternions/normals to 4 decimals, and angular/linear velocities and masses to 2 decimals. Round-trip serialization preserves scene document fields identically.
- **Validation (`src/io/validate.js`):** Untrusted input hardening: checks payload size (≤ 1 MB), rejects prototype pollution keys (`__proto__`, `constructor`, `prototype`), enforces `version: 1`, validates finite numbers (rejects `NaN`, `Infinity`, bad types), clamps limits (≤ 100 blocks, ≤ 8 portals / 4 pairs, ≤ 300 bodies, ≤ 8 emitters), verifies ID uniqueness across the document, and checks portal partner link references. Rejects 12 hostile test payloads.
- **Share Link (`src/io/share.js`):** Compresses JSON with native `CompressionStream('deflate-raw')` and encodes to `base64url` into `location.hash = '#s=...'`. Length check warns if > 8 KB (all gallery scenes range from 606 to 746 bytes, < 10% of budget). Clipboard copy with input prompt fallback. Dynamic `hashchange` listener reloads scenes without page reload.
- **File IO (`src/io/file.js`):** Download scene as `.limen.json`, open through file picker, and drag-and-drop `.json` / `.limen.json` directly onto the canvas.
- **Autosave (`src/io/autosave.js`):** Debounced 1 s persistence to `localStorage['limen_autosave_scene']` wrapped in `try/catch`. Reloading the page cleanly restores the autosaved scene. Handled gracefully when `localStorage` is disabled or throws `QuotaExceededError`.
- **Startup Order (`src/main.js`):** `location.hash` (`#s=...`) > `localStorage` autosave > `defaultScene()`.
- **Gallery (`scenes/*.json` + `scenes/index.json` + `src/ui/gallery.js`):** Hand-built 8 example scenes:
  1. `endless-fall`: Continuous terminal-speed free fall between aligned floor and ceiling portals
  2. `fling`: High platform drop into floor portal launching out of a raised wall portal
  3. `ball-loop`: Perpetual ball loop machine with emitter, ramp, and recirculating portals
  4. `wall-stack`: Stack of 6 boxes resting half-way through an upright wall portal
  5. `corridor`: Recursive corridor with two portal pairs facing each other
  6. `staircase`: Stepped platforms connected through portal links
  7. `dominoes`: Domino planks toppling into a portal and continuing out partner portal
  8. `starter-room`: Clean room with platforms, ramp, and linked portal pair
  All gallery scenes load in **1.7 ms to 11.0 ms** (well under the 300 ms budget).
- **UI:** Added Gallery, Share, Open, Save, and New buttons to the topbar with clean paper-and-ink styling.

`node tests/core.mjs`, `node tests/interp.mjs`, `node tests/oblique.mjs`, `node tests/physics.mjs`, `node tests/transit.mjs`, `node tests/editor.mjs`, `node tests/browser.mjs`, `node tests/io.mjs` and `node tests/browser-io.mjs` all pass.

### File map

| Path | What |
|---|---|
| `src/io/serialize.js` | `cleanScene(scene)`, `toJSON(scene, indent)`, `fromJSON(text)`: pure document serialization with 1 mm / 4-decimal quantization |
| `src/io/validate.js` | Schema validator: prototype-pollution guards, 1 MB limit, version 1 check, finite numbers, bounds clamping, ID uniqueness, portal link checks |
| `src/io/share.js` | `encodeShare`, `decodeShare`, `buildShareUrl`, `copyShareLink`: `CompressionStream('deflate-raw')` + base64url, 8 KB warning |
| `src/io/file.js` | `saveFile`, `openFilePicker`, `setupDropZone`: `.limen.json` file download, file picker, canvas drag-and-drop |
| `src/io/autosave.js` | Debounced 1 s localStorage persistence with try/catch quota error resilience |
| `src/ui/gallery.js` | Example scenes modal browsing `scenes/index.json` with one-click load |
| `scenes/index.json` | Catalog metadata for the 8 example scenes |
| `scenes/*.json` | 8 hand-built showcase scenes: `endless-fall`, `fling`, `ball-loop`, `wall-stack`, `corridor`, `staircase`, `dominoes`, `starter-room` |
| `src/ui/topbar.js` | Added Gallery, Share, Open, Save, New buttons |
| `src/main.js` | Startup order (`hash > autosave > default`), `hashchange` listener, `newScene()` with confirm dialog |
| `tests/io.mjs` | Node test suite: serialization round-trip, gallery compressed sizes, 12 hostile validation checks |
| `tests/browser-io.mjs` | Chrome CDP suite: share link in URL hash, 5s play reproducibility, gallery scene loads (< 300 ms), hostile hash safety (< 100 ms freeze), autosave reload |

### Measured (Apple Silicon Mac, Node v26 + Chrome Headless Metal WebGL2, DPR 2)

| Scene | Raw JSON size | Compressed base64url | Load time in browser | Budget |
|---|---|---|---|---|
| `endless-fall` | 1,628 B | **606 B** | 10.3 ms | ≤ 8 KB, < 300 ms |
| `fling` | 1,626 B | **614 B** | 11.0 ms | ≤ 8 KB, < 300 ms |
| `ball-loop` | 1,656 B | **616 B** | 6.4 ms | ≤ 8 KB, < 300 ms |
| `wall-stack` | 2,359 B | **656 B** | 2.3 ms | ≤ 8 KB, < 300 ms |
| `corridor` | 2,024 B | **663 B** | 3.8 ms | ≤ 8 KB, < 300 ms |
| `staircase` | 1,668 B | **608 B** | 3.4 ms | ≤ 8 KB, < 300 ms |
| `dominoes` | 2,890 B | **698 B** | 2.3 ms | ≤ 8 KB, < 300 ms |
| `starter-room` | 2,092 B | **746 B** | 1.7 ms | ≤ 8 KB, < 300 ms |

- **Hostile URL hash:** corrupt/oversized payload leaves active scene intact, freeze **2.80 ms** (≤ 100 ms budget).
- **Autosave:** restores byte-identical document on reload; storage failure handled with 0 uncaught errors.
- **5s Play simulation reproducibility on shared link:** identical physics motion and step count across reload.

### For prompt 07 (Performance hardening and stress tests)

- **Worker frame header timing:** Prompt 07 adds worker step time and transit time to the frame header spare fields (`protocol.js` and `world.js`).
- **Adaptive quality:** Reads EMA of frame time against 16.7 ms target and scales DPR (down to 0.5), shadow map, recursion depth, and view budget.
- **Stress scenes:** Place scripted 60 s scenarios (`pile`, `mirrors`) under `tests/stress/*.json` loadable via `?stress=name`.


