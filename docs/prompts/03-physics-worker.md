# 03: physics core in a worker

You are continuing Limen in `~/limen`. First read `docs/prompts/00-overview.md` and `docs/progress.md`, then `docs/research.md` §4 (physics engine) and §6 "Loop and threads", "Limits" and "Robustness".

## Previous steps

01 built the scaffold, the scene document, instanced rendering and a fixed-step **stub** simulation behind a `step()` and frame-buffer interface. 02 added stencil portal recursion and clipped clone rendering, driven by a stub debug body. There is no real physics yet.

## Scope

Replace the stub with Rapier in a module Web Worker. Portals are **solid walls** in this step; prompt 04 opens them.

1. **The protocol** (`src/physics/protocol.js`, shared by both sides):
   - message types, main → worker: `load(scene)`, `spawn(body)`, `remove(id)`, `edit(entity)`, `play`, `pause`, `step(n)`, `reset`, `setSettings`
   - message types, worker → main: `ready`, `frame`, `event`
   - the 16-float slot layout from the overview, and the header (step index, time, body count)
   - the id ↔ slot map, with free-slot reuse
2. **The worker** (`src/physics/worker.js` and `world.js`):
   - Load `vendor/rapier/` with `simd-compat`. Fall back to `compat` if `WebAssembly.validate` of a tiny SIMD module fails.
   - Build the world from the scene document: blocks become fixed cuboid colliders (ramps use a convex hull), bodies become dynamic bodies with mass from the document.
   - Step at a fixed 1/60 s on its own clock: a `setTimeout`-driven loop with an accumulator, clamped to 4 steps per tick.
   - **Ping-pong buffers:** two `Float32Array`s. The worker fills one and transfers it; main transfers it back after reading. If none is free, the worker keeps stepping and drops that frame rather than blocking.
   - **Reset:** take a Rapier snapshot when play starts from edit mode; `reset` restores it exactly.
3. **The bridge** (`src/physics/bridge.js`, main thread):
   - It presents the same interface the loop used for the stub, so `loop.js` changes minimally.
   - Interpolation uses the two most recent frames by worker time. Render one step behind.
   - Delete the stub, or keep it only as `tests/` scaffolding.
4. **Robustness guards in the worker:**
   - clamp linear speed to 60 m/s and angular speed to 50 rad/s
   - quadratic air drag with terminal speed `settings.terminalSpeed`, default 40 m/s (Ianua's rule; see `~/videos/ianua/src/core/sim.js` `accelAt`)
   - CCD on for bodies smaller than 0.3 m and on any body faster than 15 m/s; toggle it per step
   - **NaN watchdog:** remove any body with a non-finite state and emit `event {type: 'removed', reason: 'nan'}`
   - spawn into free space only: an intersection test, then nudge up by 5 cm up to 10 times, otherwise refuse with an event
   - minimum body size of 0.1 m
   - cap the depenetration speed; find the parameter name in the vendored `.d.ts`
   - **step-time watchdog:** if one step takes over 8 ms for 30 steps in a row, emit `event {type: 'busy'}`
5. **The headless test** (`tests/physics.mjs`): run `world.js` in Node with Rapier from `node_modules`, with no worker and no DOM. It must check:
   - a box dropped from 2 m comes to rest on the floor within 3 s
   - a 1,000-step run gives the same snapshot hash twice
   - 300 bodies step in ≤ 4 ms each, averaged over 600 steps; print the number
   - a NaN injected into a body is removed and the world keeps stepping
   - a ball fired at 50 m/s at a 0.2 m wall does not tunnel

## Files you own

`src/physics/protocol.js`, `src/physics/worker.js`, `src/physics/world.js`, `src/physics/bridge.js`, `tests/physics.mjs`, and minimal edits to `src/app/loop.js` and `src/main.js` to switch from the stub to the bridge.

## Do not touch

`src/render/*`, apart from a field name the protocol forces, which you must note in progress.md. Also `src/core/portal.js`, `docs/research.md` and `docs/prompts/*`. Write no portal transit: no teleport, clone, ghost or carve. That is 04.

## Acceptance

- [ ] `node tests/physics.mjs` passes and prints the step time for 300 bodies.
- [ ] In the browser, the default scene's bodies fall, stack and slide with real contacts. Portals act as solid wall.
- [ ] Main-thread time stays ≤ 4 ms per frame with 300 bodies (the worker carries the physics). The page stays responsive while you drag the orbit camera during a 300-body pile-up.
- [ ] Play → wait 5 s → Reset returns every body to its exact start, with the same frame buffer bytes. Play again behaves identically for 5 s.
- [ ] Break checks:
  - spawn 50 boxes at the same point: they nudge or refuse, nothing explodes
  - fire a heavy ball at 60 m/s into a stack: no body passes through a wall
  - leave the tab hidden for 60 s: no burst on return
  - inject NaN with a debug key: the body is removed, the simulation goes on
- [ ] Record numbers and protocol notes in `docs/progress.md`.
- [ ] Commit, for example `feat(physics): rapier in a worker with fixed steps, snapshots and guards`.
