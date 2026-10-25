# 05: the sandbox editor

You are continuing Limen in `~/limen`. First read `docs/prompts/00-overview.md` and `docs/progress.md`, then `docs/research.md` §7 "Editor UX". For the fly camera, read Ianua's `~/videos/ianua/src/core/camera.js` (crossing and the `UPRIGHT_SECONDS` easing) and the free-camera part of `~/videos/ianua/src/app/app.js`.

## Previous steps

- 01–02: scaffold, render loop, stencil portal recursion, clipped clones.
- 03–04: Rapier in a worker; bodies pass through portals with carving, ghosts, clones and teleports. The scene document drives everything. The worker accepts `load`, `spawn`, `remove`, `edit`, `play`, `pause`, `step`, `reset` and `setSettings`.

## Scope

1. **Modes.** **Edit** (physics paused, the document is editable) and **Play**. Play always starts from the edited document. `Reset` returns to it through the snapshot. Space toggles between them; a step button advances one physics step while paused. Time scale: 0.25×, 0.5×, 1×.
2. **History** (`src/editor/history.js`): every edit is a command on the scene document, with do and undo. Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z, history depth 200. Edits are sent to the worker as `edit` messages, not full reloads, unless a block or portal change needs ghosts and carves rebuilt (the worker decides).
3. **Tools** (`src/editor/tools/*.js`), one module each:
   - **select:** click to pick a body, block or portal. Move and rotate with vendored `TransformControls`. Blocks snap to a 0.5 m grid and 90° (ramps 45°).
   - **block:** drag on a face to extrude a box on the grid. Kinds: box, ramp, pillar.
   - **portal:**
     - Click a flat face of static geometry. The portal centres on the hit point and slides to fit inside the face.
     - `v` is world up for walls, or toward the camera for floors and ceilings, snapped to the face axes.
     - Refuse with a message if it does not fit, overlaps another portal (min gap 0.1 m), or the pair limit (4) is reached.
     - The first click places A and the second places B of the same pair. Pairs take colours in order from the palette of four.
     - Drag an existing portal to move it along its face.
   - **spawn:** box, ball, capsule, plank, heavy ball, each with a size slider. Click to drop at the hovered point 0.5 m above the surface, or hold to spray (max 10 per second).
   - **emitter:** a placed source that spawns a chosen shape at a set rate (≤ 5 per second) and speed in Play mode only, up to 8 emitters.
   - **delete:** click or Backspace.
   - **Limits:** show the body count against the cap. At the cap, spawning refuses with a short message.
4. **Camera** (`src/app/camera.js`):
   - **Orbit** (default) and **fly** (F toggles; WASD/QE, Shift for faster, mouse look with pointer lock).
   - **Crossing:** the fly camera crosses portals. Map its pose with `portalMap` when its position crosses an opening (`crossing`), then ease `up` back to world up over 1.2 s, as in Ianua.
   - **Orbit target:** the orbit target never sits behind a wall after a crossing; re-target on the mapped point.
5. **UI** (`src/ui/*`): plain DOM, no framework.
   - **Desktop:** a left tool rail, a top bar (mode, step, time scale, undo/redo, settings), and a small inspector for the selection (size, colour, mass, initial velocity).
   - **Phones:** a bottom bar like Mundana's. One finger orbits, two fingers pan and pinch. Long-press opens the context menu: delete, duplicate.
   - **Style:** the paper-and-ink look; pair colours on the portal tool. No generic dark-UI template.
   - **Keyboard help:** `?`.
6. **Settings panel:** gravity (on, off, or low), terminal speed, quality (auto / high / low; prompt 07 drives auto), recursion depth slider (1–8, clamped by budget), trails on/off.

## Files you own

`src/editor/**`, `src/ui/**`, `src/app/camera.js`, `styles.css`, the UI markup in `index.html`, and new optional document fields with defaults in `src/core/scene.js` (emitters, selection colours).

## Do not touch

`src/physics/transit.js` and `ghosts.js`. Put requests in progress.md; small hooks in `world.js` are fine if unavoidable. Also the stencil core in `src/render/portals.js`, `docs/research.md` and `docs/prompts/*`. Add no save/load/share (06) and no adaptive quality (07).

## Acceptance

- [ ] From the empty room, build a scene in under 2 minutes: a ramp, two portal pairs, an emitter of balls into a floor portal, and a loop where balls come back around. Press Play: it runs. Reset: it returns exactly.
- [ ] Undo and redo every action type, including portal placement and moving a portal in Play mode (which must pause, edit, and resume or refuse cleanly; pick one and document it).
- [ ] Portal placement refuses, with a message, when it does not fit, overlaps, or exceeds the pair limit. Dragging a portal across a face never leaves it half off the face.
- [ ] Moving a portal in Edit mode while a body rests half in it (the case from 04): the body ends in front of the wall, not inside it.
- [ ] The fly camera passes through every portal orientation (floor, wall, ramp) with no wall flash, and eases upright.
- [ ] Phone emulation (`resize_window` mobile, reload): all tools reachable, gestures work, no horizontal page scroll.
- [ ] Main-thread time per frame during editing with 300 bodies stays ≤ 4 ms. Raycast picking uses instance bounds, not per-triangle tests on every instance.
- [ ] Take a screenshot of the editor on desktop and on phone for the user.
- [ ] Update `docs/progress.md`.
- [ ] Commit, for example `feat(editor): edit and play modes, block, portal, spawn and emitter tools, fly camera through portals`.
