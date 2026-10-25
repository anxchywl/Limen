# Limen: research

Limen (Latin, "threshold") is a browser sandbox where anyone places linked portals, builds with blocks, spawns objects and watches rigid-body physics carry them through the openings. This file records what was learned before building and what the build should use. Researched 2026-11-01.

Contents:

1. What Ianua gives us
2. How the games did it
3. Open-source portal implementations
4. Physics engine
5. Render stack
6. Not lagging, not breaking
7. Editor, sharing, license, hosting
8. Recommendations
9. Sources

## 1. What Ianua gives us

Ianua (`~/videos/ianua`, MIT, plain JS modules, no build step) computed every simulated shot of the portals film. About 2,900 lines in total. It is a ray tracer plus a toy simulation, so it supplies the maths but not the engine.

### Reusable as is

| File | What | Use in Limen |
|---|---|---|
| `src/core/vec.js` (37 lines) | vectors as arrays; rigid maps `{R, t}` with `apply`, `applyDir`, `compose`, `invert` (which also handles uniform scale), `slerp` | the shared maths module, kept as is |
| `src/core/portal.js` (61 lines) | `frame()` builds an orthonormal portal frame from `n` and `v`. `portalMap(P, Q)` gives the map from one opening to its partner: mirrored left to right, so back-to-back portals act as a doorway, with optional uniform scale. `crossing(P0, P1, p0, p1)` intersects a segment with an elliptical opening that may move during the step | the core of rendering (virtual cameras), transit (body teleport, velocity map) and camera crossing |
| `src/core/camera.js` (142 lines) | camera paths that cross portals; after a crossing, `up` eases back to world up over 1.2 s | the free-fly camera's crossing and its upright easing |
| `src/core/sim.js` teleport block | teleport when the swept centre crosses the opening; positions and axes mapped by `M`; velocity mapped by `R`, with the portal's own velocity handled by rule A or rule B; air drag with a terminal speed | the transit rules, and terminal speed against endless-fall blow-ups |
| `src/render/palette.js` | the series' paper and ink colours, one muted colour per wall, portal blue `#3E7C8F` and orange `#C27A40` | the visual identity, so Limen matches the film |
| `tools/check*.js` | Node scripts that assert physical claims, such as energy conservation, inverse maps and camera crossings | the same testing habit: `node tests/*.mjs` |

### Reusable as ideas

- **Exact recursion by ray tracing.** `renderer.js` follows each ray through a portal to the partner and keeps going, tinting each pass in the portal's colour. Recursion depth costs almost nothing, and clipping is implicit. The catch is that it only knows analytic primitives and has fixed uniform arrays (`MAXB 64`, `MAXP 8`, 512 triangles), with every pixel testing every object. That does not scale to a sandbox with hundreds of bodies. Keep it as a **reference oracle**: on simple scenes, the raster renderer's output must match it (see prompt 02). It could later become a "photo mode".
- **The per-pass tint and terminal colour.** `uTint`, `uPassFade` and `uDeep` make recursion depth readable and hide the last level. Raster recursion should copy this.
- **Clipped travellers.** `uBClip` clips a body copy by the portal plane, which is the same as slicing in the games.
- **Constant-pixel ink edges and coloured walls.** Through a portal you can always tell which wall you are looking at. The user asked for vivid, saturated rooms (memory note `feedback-vivid-smooth-visuals`).
- **Moving-portal rules.** Rule A keeps velocity relative to the room, rule B keeps it relative to each opening, and the stop kick shares velocity by the fraction of the body that is through. This is a possible later feature, "moving portals". It is not in v1.

### Hacked for the video, do not port

- `field.js`, `flow.js`, `stream.js`: a 2D Laplace gravity solve on the glued side view, wind and streamlines. They are film-specific and two dimensional. "Gravity through portals" could become a later optional mode, but not in v1.
- Box-versus-room collision in `sim.js`: axis-aligned pushes, bounces at −0.25, no body-to-body contact. Replaced by a real engine.
- Mascot cards, capsules with a scarf, walking, `upright`, `hold`, rails for balls, the pocket experiment with explicit `space` ids, dome surfaces, the side-view blend, sun-disc glare, field heatmaps.
- Shots as timeline JSON with camera keys and `via` lists, and the Remotion coupling (`LabShot.tsx`).
- Scaled portals (different-size openings). These are natural for rays, but in a rigid-body engine they would mean resizing colliders and masses mid-contact. v1 pairs share one size.

## 2. How the games did it

Valve's Portal (2007) and Portal 2 (2011) are closed source. The best primary account is Dave Kircher's CS50 lecture "Portal Problems" (2018). Kircher was one of the students Valve hired from the Narbacular Drop team. The Portal developer commentary adds more.

### Rendering

- **Stencil, not textures.** There are two methods. Texture rendering needs a render target for every view, which costs memory and anti-aliasing. Stencil rendering draws everything into one framebuffer. Kircher called stencil "strictly cheaper": it draws the same geometry with no texture cost.
- **The stencil loop.** Draw the scene. Increment the stencil where the portal quad is drawn. Restrict drawing to that stencil value and punch the depth there out to the far plane. Draw the scene again from the virtual camera, which is the main camera mapped through the portal. Recurse for deeper levels. Then decrement the stencil and restore the portal's depth so later geometry occludes correctly.
- **Clip planes.** Geometry between the virtual camera and the exit portal must not be drawn, or the view shows the back of the exit wall ("banana juice" in the talk). Valve used clip planes. The standard GPU way is Lengyel's **oblique near plane**: change the projection matrix so the near plane lies on the portal plane. There is no extra clip plane, and the far plane is adjusted to keep depth precision usable. three.js already implements this in `examples/jsm/objects/Reflector.js` for orthographic and perspective cameras. Watch out: the clip plane must be in camera space, and WebGPU's depth range is [0, 1], not [−1, 1].
- **Frustum reduction.** Each portal view narrows the frustum to the portal's screen area (Valve used four sides), so most of the scene is culled. A scissor rectangle from the portal's projected bounds gets most of this cheaply.
- **Recursion limits.** On consoles, Valve stopped at **two** levels. Deeper levels reused the previous frame's image, which stretched and popped when walking through. Split-screen co-op with many portals forced level layouts to change.
- **Near-plane crossing.** When the camera's near plane cuts the portal quad, half the screen shows wall for a frame. The usual fixes: give the portal screen thickness on the camera side when the camera is close (Sebastian Lague's fix), or test against a portal volume rather than a plane (OpenGL wikibook, "Mini-Portal Smooth").

### Collision through portals

- **Two trigger volumes per portal.** In the larger "nearby" volume, objects still collide with the world. Objects in the inner volume go on a separate list and stop colliding with the main world. They collide only with a carved local copy.
- **Carved local geometry.** When a portal is placed, the engine snapshots the nearby world geometry around *both* portals and cuts a hole at the opening. The far side's snapshot is transformed into the near portal's space, so an object halfway through touches the walls and floor on the other side. This "bubble" physics was approximate. Kircher's commentary says the first version took about half a second when a portal was placed, and the bubble approach cut that to about 10 ms.
- **Shadow clones.** Each dynamic object in the zone gets a copy on the far side: one master, one shadow. The shadow is not teleported each step, because instant moves break the solver. It is driven toward its target pose with forces. This held up with two cubes and broke down with trains of three or four.
- **Crossing test.** A ray from the previous position to the current one decides whether an object passed through. Every ray cast in the game (bullets, line of sight) is split into two segments at a portal.
- **Third person** is hard when the feet and eyes are on different sides of a portal.

### Puzzle Maker (Portal 2, 2012), a closed reference for "users build anything"

- An in-game editor made of chambers on a coarse grid of wall tiles. Each tile is portal-friendly or not. Items are dragged in and connected. There is one key to jump between editing and testing, and puzzles publish to the Steam Workshop. Valve built it as a drag-and-drop tool, deliberately much simpler than Hammer.
- What to copy: a coarse grid with snapping, edit mode separate from play mode (play always starts from the edited state, reset returns to it), item limits, and one-click sharing. What not to copy: any names, items or art from the games. Limen must be its own thing in look and naming.

### Lessons from fan ports

- **Portal 64** (N64, open source; the active fork is `mwpenny/portal64-still-alive`, MIT code, needs the original game data) wrote its own portal-aware physics. Its known-bug list includes two wall portals side by side that "clip any object out of any level". This is the break case to test.

## 3. Open-source portal implementations

| Project | Stack, license | Does well | Weak or missing |
|---|---|---|---|
| **Ianua** (own) | WebGL2 ray tracer, MIT | exact recursion, moving and scaled portals, clipped travellers, checked maths | analytic primitives only, toy physics, does not scale |
| **SebLague/Portals** (2021, 935★) | Unity, MIT | render textures, oblique projection, slicing shader for travellers, portal screen thickness near the camera, clear video | render-texture recursion, teleport-only physics (no physics clone) |
| **three.js `webgl_portal`** example | three.js, MIT | `CameraUtils.frameCorners` off-axis projection, render target per portal, short | no recursion, no stencil, no physics |
| **three.js `Reflector`** | three.js, MIT | a tested oblique-near-plane implementation (Lengyel) | it is a mirror, not a portal |
| **BarthaBRW/Threejs-Portal** (2023, 85★) | three.js, stencil, OffscreenCanvas worker | stencil recursion in three.js, rendering off the main thread | **no license**: read it, do not copy code; tied to Angular, RxJS and DI |
| **efyang/portal-0.5** (2021) | three.js + cannon.js, MIT | a complete small game with portals and physics | student project, cannon.js, no recursion or clones |
| **Donitzo/godot-simple-portal-system** (2025) | Godot 4, CC0 | viewport-texture portals, teleport by trigger, easy to read | flat portal raycasts, no physics clones |
| **DeleteSystem32/godot-portal-example** (2020) | Godot 3.1, MIT | recursion | old, no physics |
| **portal64-still-alive** (active 2026) | C on N64, MIT code | a complete portal-aware physics engine on tiny hardware | needs proprietary game data; a design reference only |
| **Portal / Portal 2 / Puzzle Maker** | Source engine, closed | stencil recursion, carved bubbles, shadow clones, editor UX | closed; a reference only |

No public web sandbox was found that combines recursive portals, a real physics engine and free building. That gap is Limen's reason to exist.

## 4. Physics engine

Versions are from npm on 2026-11-01.

| Engine | Version, license | CCD | Determinism | Many bodies | In a worker | Portal-specific hooks |
|---|---|---|---|---|---|---|
| **Rapier** `@dimforge/rapier3d(-simd)-compat` | 0.21.0 (Sep 2026), Apache-2.0, Rust→WASM. JS bindings moved into the `dimforge/rapier` monorepo; the old `rapier.js` repo is archived | per body `enableCcd`, plus cheaper soft CCD (`setSoftCcdPrediction`). Fast bodies are swept against fixed colliders automatically | docs: the WASM build is cross-platform deterministic when the same version and insertion order are used; a dedicated `-deterministic` build exists; `takeSnapshot()` bytes can be hashed | good; SIMD build; sleeping; single-threaded | yes: plain WASM, one thread, no SharedArrayBuffer needed | `filterContactPair` hook (drop contacts per pair), collision and solver groups (16 bits), position-based kinematic bodies (`setNextKinematicTranslation` gives a real velocity to what they push), `takeSnapshot`/`restoreSnapshot` for reset and undo, contact-pair queries with impulses |
| **Jolt** `jolt-physics` | 1.1.1 (Oct 2026), MIT, C++→WASM | `LinearCast` motion quality per body | cross-platform only when built with `CROSS_PLATFORM_DETERMINISTIC` | excellent; multithreaded builds | multithreaded builds need SharedArrayBuffer, so COOP/COEP headers. GitHub Pages cannot send them; a service-worker shim or Cloudflare `_headers` is needed. The single-threaded build works anywhere | contact listener with `OnContactValidate` (reject) and contact-settings changes; very capable |
| **cannon-es** | 0.20.0, last published Aug 2022, MIT, pure JS | no swept CCD | JS floats, same engine everywhere | slow beyond a few hundred bodies | yes | none special |
| **Ammo.js** | Bullet via Emscripten, licence metadata unclear (Bullet is zlib) | Bullet CCD (swept sphere) | weak | fair | yes | Bullet callbacks; dated API, manual memory |
| **Havok** `@babylonjs/havok` | 1.3.14 (Sep 2026), MIT, **closed-source binary** | yes | engine is deterministic per docs | very good | yes | documented mainly through Babylon's plugin; few docs for raw use |

Weighed for this project:

- **Correctness tools matter more than raw speed.** Portal transit needs three things: drop contacts between a transiting body and the hole in its host wall, add mapped "ghost" walls from the far side, and drive a clone. Rapier's `filterContactPair` hook and position-based kinematic bodies do this directly. Jolt's contact listener can too.
- **Memory safety in a sandbox.** Users spawn and delete thousands of things. Jolt needs manual `Jolt.destroy` and reference counting, so one missed call is a leak. Rapier's handles are freed by removing the body, and `world.free()` releases everything at once.
- **Reset and undo.** Rapier's snapshot gives an exact "Reset" and play/rewind without rebuilding the world.
- **Hosting.** Rapier needs no special headers. Jolt's threads do.
- **Licence.** Apache-2.0 sits fine inside an MIT app; ship its licence text in `THIRD_PARTY_LICENSES.txt`.

**Recommendation: Rapier 3D, the `simd-compat` build** (WASM embedded as base64, so no bundler and no `.wasm` path issues), with a fallback to plain `compat` where WASM SIMD is not supported. It runs single-threaded in a module Web Worker. Jolt (single-threaded `wasm-compat`) is the plan B if profiling shows Rapier cannot hold the body budget. The physics bridge API (prompt 03) stays engine-neutral so a swap touches one folder.

### Why the "attach the clone collider to the master body" shortcut fails

It is tempting to give the master body a second collider at the clone's pose and let one rigid body touch both sides. It is wrong whenever the portal map rotates. A contact impulse `J` on the clone side should reach the master as `R⁻¹J` at the mapped point. A collider on the same body receives `J` unrotated, at a lever arm measured across the room. Fixed joints fail for the same reason: they enforce equal world-space motion, but a portal demands `v_clone = R v_master`. The coupling has to be explicit (prompt 04).

## 5. Render stack

- **WebGL2 (three.js `WebGLRenderer`, r187)** is universal: every desktop browser, iOS Safari and old Android. Material stencil state (`stencilWrite`, `stencilFunc`, `stencilRef`, `stencilZPass`) and `clippingPlanes` are mature, and `InstancedMesh` draws hundreds of bodies in one call. Portal recursion with stencils is proven on it.
- **WebGPU (three.js `WebGPURenderer`)** has shipped in Chrome (desktop, and Android 12+ since 121), Safari 26 and Firefox (Windows since 141, Apple-silicon macOS since 145). Firefox on Linux, Android and Intel Macs was still in progress at the last authoritative update. `WebGPURenderer` has a `stencil` option, off by default, and falls back to a WebGL2 backend. Its gains are lower CPU cost per draw (and render bundles for repeated passes) and compute shaders. Neither is what limits a scene made of a few instanced draws per pass. Risk: stencil-recursion examples on the node-material system are scarce, and the oblique projection must change for the [0, 1] depth range.
- **Decision: WebGL2 for v1**, with all GPU code behind `src/render/` so a WebGPU backend can come later.

### Cost and budget of recursion

- One portal view of depth *d* through a scene with *k* portals visible per view can cost up to kᵈ scene passes. Two pairs facing each other is the worst case.
- Make each pass cheap: static level geometry merged per material (1–3 draws), bodies as one `InstancedMesh` per shape (4–6 draws), portals as a few draws. That is about 10 draws per pass.
- Bound the count: walk the portal tree breadth-first and stop at the first of these limits:
  - maximum depth (desktop 6, phone 3, user-adjustable)
  - a **view budget** of at most N portal views per frame (desktop 32, phone 12)
  - a portal whose projected screen area is below a threshold (about 0.2 % of the screen)
  - a portal outside its parent's scissor rectangle
- A stopped view is filled with the portal's terminal colour, tinted per depth like Ianua's `uDeep`, so it reads as "deeper" instead of as a glitch.
- Use a scissor rectangle per view. Use an oblique near plane on every virtual camera. Cull frusta against the parent portal's rectangle.
- Stencil is 8 bits, so depth up to 255. Use increment/decrement on stencil level counts, not bit masks.

## 6. Not lagging, not breaking

### Loop and threads

- **Fixed timestep, interpolated rendering.** Physics steps at a fixed 60 Hz (option: 120 Hz on desktop) from an accumulator. Clamp the accumulator to at most 4 steps per frame, so a slow frame or a hidden tab never causes a "spiral of death". Rendering draws the state interpolated between the last two steps, so motion stays smooth at 120 or 144 Hz.
- **Interpolating across a teleport.** If a body teleported between the two states, the previous pose must first be mapped through the portal (`apply(M, prev)`) before blending. Otherwise the body streaks across the room for one frame.
- **A worker thread for physics.** The worker owns the Rapier world and the transit logic and posts one transferable `Float32Array` per step: 300 bodies × 16 floats is about 19 KB. Two buffers ping-pong (transfer, fill, transfer back), so no SharedArrayBuffer is needed and any static host works. Messages from main to worker are commands such as load, spawn, remove, edit, play, pause, step and reset.
- **Instancing.** One `InstancedMesh` per shape, with per-instance colour and a per-instance clip plane (an instanced `vec4` attribute, used in a shader patched through `onBeforeCompile`). A slice is then one instance attribute, not a new material.

### Limits

| Item | Desktop | Phone |
|---|---|---|
| dynamic bodies | 300 | 120 |
| portal pairs | 4 | 4 |
| recursion depth | 6 | 3 |
| portal views per frame | 32 | 12 |
| max body speed | 60 m/s | 60 m/s |
| emitters | 8, each at most 5 per second | 4 |

Show the limits in the UI, and refuse with a message, never silently.

### Robustness

- **Exploding bodies.** Clamp linear and angular speed every step. Spawn only into free space: test the shape for intersection, nudge it up or refuse. Cap the depenetration speed (Rapier integration parameters; check the names against the installed `.d.ts`). Use a minimum body size of 0.1 m and a mass-ratio cap of 1:50 between touching dynamic bodies.
- **NaN watchdog.** After each step, any body with a non-finite pose or velocity is removed and reported. The simulation keeps running.
- **Endless falls** between facing floor and ceiling portals: quadratic air drag with a terminal speed (Ianua's rule; the default terminal speed is 40 m/s), plus the speed clamp and CCD on fast bodies.
- **Portal-jitter loops.** Teleport only when the swept centre crosses the opening *and* moves into the portal (`dot(v, n) < 0`). After a teleport, block reverse teleport through the same pair for 3 steps. Use a 1 cm hysteresis band.
- **Overload watchdog.** If the physics step takes more than 8 ms for 30 steps in a row, stop emitters, raise sleep thresholds and show "simulation busy". Rendering never waits for physics: it keeps drawing the last state.
- **Adaptive render quality.** An EMA of GPU and CPU frame time drives the DPR scale (0.5–1.0) first, then recursion depth, then the view budget. It steps back up slowly (hysteresis).
- **WebGL context loss.** Handle `webglcontextlost` and `webglcontextrestored`; rebuild GPU resources from the scene document.

### Stress tests and FPS budgets

- **Desktop reference** (Apple M1 or Intel Iris Xe, 1080p, DPR 1): p95 frame time ≤ 16.7 ms with 4 pairs, depth 6 (or budget-capped), 300 bodies. Physics step ≤ 4 ms. Main-thread CPU per frame ≤ 4 ms.
- **Phone reference** (iPhone 12 or Pixel 6a class): p95 ≤ 16.7 ms with 2 pairs, depth 3, 120 bodies, DPR ≤ 1.5. Never below 30 fps in the worst stress scene once adaptive quality has settled.
- **Measure from timers**, not the fps counter: `performance.now()` around each phase and `EXT_disjoint_timer_query_webgl2` for the GPU where available. The in-app browser pane often runs pages hidden at about 1 fps (memory note on Mundana).
- **Built-in stress scenes** (`?stress=name`) and a headless Node physics test that runs the worker code without a renderer.

## 7. Editor, sharing, license, hosting

### Editor UX

- **Two modes, as in the Puzzle Maker.** In Edit mode physics is paused and you place things. Play runs from the edited state; Reset returns to it exactly (Rapier snapshot). One key (Space) toggles between them.
- **Tools:** select/move/rotate (three.js `TransformControls`), block (grid-snapped static boxes, ramps and pillars on a 0.5 m grid), portal (click a flat face of static geometry), spawn (box, ball, capsule, plank, heavy ball), emitter, delete. Undo and redo for every edit.
- **Portal placement:**
  - Snap to the clicked face and orient `up` toward world up, or along the face for floors and ceilings (toward the camera).
  - Slide the portal to fit inside the face, as the games do.
  - Refuse if it overlaps another portal or does not fit.
  - Place the pair in two clicks; colour pairs from a palette of four.
- **Camera:** orbit by default, fly (WASD/QE) on a key. The fly camera passes through portals and eases upright (Ianua `camera.js`). On phones: one-finger orbit, two-finger pan and pinch, and a bottom bar like Mundana's.
- **Readability:** coloured walls per face, a subtle grid, a portal tint per pass, optional trails on bodies, slow motion (0.25×), a step button.

### Save, load, share

- **The scene document is the single source of truth.** It is JSON with a `version` field: blocks, portals, bodies, emitters, settings and camera. The physics world and the GPU scene are both rebuilt from it.
- **Share in the URL hash.** `JSON → CompressionStream('deflate-raw') → base64url → #s=…`. This is native in every current browser and needs no library. The hash never reaches a server. Budget about 8 KB. Quantize numbers to 1 mm and 0.1° before encoding.
- **Files:** `.limen.json` download and upload, drag and drop.
- **Autosave** to `localStorage`, wrapped in try/catch.
- **A gallery** of built-in example scenes in `scenes/*.json`.
- **Validate on load:** a schema check, clamping to the limits, and rejecting unknown versions with a message. This matters because shared URLs are untrusted input.

### License

**MIT.** It matches Ianua, Mundana and the user's other repos, and allows the widest reuse. Apache-2.0 would add a patent grant, which matters little here. GPL would discourage reuse in other projects. Rapier (Apache-2.0) and three.js (MIT) notices go in `THIRD_PARTY_LICENSES.txt`.

### Hosting

**GitHub Pages with the custom domain `limen.anxchywl.dev`**, the same setup as Mundana: a CNAME file and DNS at name.com. The app needs no special headers because it avoids SharedArrayBuffer. If threads are ever needed, Cloudflare Pages can send COOP/COEP through a `_headers` file. On GitHub Pages, `coi-serviceworker` is a shim with reload-loop pitfalls.

## 8. Recommendations

**Stack:**

- three.js r187 with `WebGLRenderer` (WebGL2), stencil portal recursion, oblique near planes and instanced bodies
- Rapier 0.21 `simd-compat` in a module Web Worker, at a fixed 60 Hz with interpolation
- plain JavaScript ES modules with an import map and vendored, pinned dependencies (no bundler, as in Ianua and Mundana)
- Node test scripts
- static hosting on GitHub Pages
- MIT licence

**Architecture:**

```
scene document (JSON) ──► editor (main thread) ──commands──► physics worker (Rapier + transit)
        ▲                       │                                   │
        └──── save / share ─────┘        ◄──── Float32Array per step ┘
                                │
                     renderer (three.js): interpolate, instanced bodies,
                     stencil recursion through portals, clipped clones
```

**Portal transit design** (prompt 04):

- **Carve.** Each portal has a hole tunnel behind its opening: a ring of thick slabs, flush with the face, around a 12-sided approximation of the opening. A *plug* collider fills the opening. A `filterContactPair` hook drops plug and host-block contacts only for bodies in transit through that portal.
- **Ghosts.** Static colliders within reach of the partner portal, clipped to the half-space in front of it, are mapped behind this portal. They collide only with bodies in transit, so an object halfway through touches the far room's floor and walls.
- **Clone.** A kinematic, position-based body follows `M · masterPose` each step. Exit-side bodies get pushed with a real velocity. Contact impulses on the clone are read, mapped by `R⁻¹`, damped and applied to the master on the next step.
- **Teleport.** When the swept centre crosses the opening while moving inward, master and clone swap poses: position and orientation are mapped by `M`, linear and angular velocity by `R`. The exit is already clear, because the clone has been occupying it.
- **Render slices.** The master is clipped to the front half-space of the entry portal, and the clone to the front of the exit.
- **Limits.** A body is in transit through one portal at a time; others act solid to it. Pairs share one size. Portals sit on static geometry only in v1.

**Order of work:** the prompt series in `docs/prompts/`, one fresh session each.

## 9. Sources

Portals in the games:

- Dave Kircher, Colton Ogden: "Portal Problems", CS50's Introduction to Game Development, lecture 11 (2018). [Transcript](https://rosetta.to/u/cs50/portal-problems-lecture-11-cs50-s-introduction-to-game-development-2018), [course listing](https://www.classcentral.com/course/freecodecamp-valve-developers-discuss-portal-problems-cs50-s-intro-to-game-development-105059)
- [Portal developer commentary](https://theportalwiki.com/wiki/Portal_developer_commentary) (portal collision timings)
- [Portal 2 Puzzle Maker, Valve Developer Community](https://developer.valvesoftware.com/wiki/Portal_2_Puzzle_Maker), [Puzzle Creator, Portal Wiki](https://theportalwiki.com/wiki/Editor), [Valve interview on the editor](https://www.neowin.net/news/interview-valve-talks-about-portal-2s-new-puzzle-editor/)
- Eric Lengyel: [Oblique View Frustum Depth Projection and Clipping (PDF)](https://terathon.com/lengyel/Lengyel-Oblique.pdf), [code](https://terathon.com/code/oblique.html); [orthographic variant, Aras P.](https://www.aras-p.info/texts/obliqueortho.html)
- [OpenGL Programming/Mini-Portal Smooth (wikibook)](https://en.wikibooks.org/wiki/OpenGL_Programming/Mini-Portal_Smooth)
- [Rendering portals, RPI advanced graphics project (PDF)](https://www.cs.rpi.edu/~cutler/classes/advancedgraphics/S21/final_projects/metzlr.pdf)

Open-source implementations:

- [SebLague/Portals](https://github.com/SebLague/Portals), [Coding Adventure: Portals](https://rosetta.to/u/sebastianlague/coding-adventure-portals)
- [three.js webgl_portal example](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_portal.html), [three.js Reflector.js (oblique clip)](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/objects/Reflector.js)
- [BarthaBRW/Threejs-Portal](https://github.com/BarthaBRW/Threejs-Portal), [efyang/portal-0.5](https://github.com/efyang/portal-0.5)
- [Donitzo/godot-simple-portal-system](https://github.com/Donitzo/godot-simple-portal-system), [DeleteSystem32/godot-portal-example](https://github.com/DeleteSystem32/godot-portal-example), [Portals in Godot Engine, Masaryk University thesis](https://autoconfig.mail.muni.cz/th/ydltb/thesis.pdf)
- [mwpenny/portal64-still-alive](https://github.com/mwpenny/portal64-still-alive), [PC Gamer on Portal 64](https://www.pcgamer.com/legend-has-spent-years-making-portal-for-the-n64-and-by-gaben-hes-done-it)

Physics:

- Rapier: [JS getting started](https://rapier.rs/docs/user_guides/javascript/getting_started_js), [determinism](https://rapier.rs/docs/user_guides/javascript/determinism), [rigid bodies, CCD, kinematics](https://rapier.rs/docs/user_guides/javascript/rigid_bodies), [physics hooks and events](https://rapier.rs/docs/user_guides/javascript/advanced_collision_detection_js), [npm](https://npmjs.com/package/@dimforge/rapier3d), [rapier.js (archived, moved to monorepo)](https://github.com/dimforge/rapier.js)
- Jolt: [JoltPhysics.js](https://github.com/jrouwe/JoltPhysics.js), [multithreading discussion](https://github.com/jrouwe/JoltPhysics.js/discussions/110), [npm](https://npmjs.com/package/jolt-physics)
- [pmndrs/cannon-es](https://github.com/pmndrs/cannon-es), [kripken/ammo.js](https://github.com/kripken/ammo.js), [@babylonjs/havok](https://npmjs.com/package/@babylonjs/havok), [three.js forum on Havok](https://discourse.threejs.org/t/anyone-used-the-havok-physics-engine-for-three/53205)
- [Jolt vs Rapier API comparison (gist)](https://gist-githubusercontent-com.hhj520.top/LPGhatguy/71e8f777f1782b36bcf31b89e9ae17bf), [three.js physics manual](https://threejs.org/manual/en/physics.html)
- [Running JS physics in a web worker (dev.to)](https://dev.to/jerzakm/running-js-physics-in-a-webworker-part-1-proof-of-concept-ibj)

Render and hosting:

- [three.js WebGPURenderer docs](https://threejs.org/docs/pages/WebGPURenderer.html), [WebGPU is now supported in major browsers (web.dev)](https://web.dev/blog/webgpu-supported-major-browsers), [Khronos WebGL and WebGPU, SIGGRAPH 2026](https://www.khronos.org/developers/linkto/webgl-and-webgpu-sigg26)
- [Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/), [COOP/COEP on static hosting like GitHub Pages](https://engineered.at/articles/setting-the-coop-and-coep-headers-on-static-hosting-like-github-pages)
