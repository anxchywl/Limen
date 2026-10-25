# 04: bodies through portals

You are continuing Limen in `~/limen`. This is the hardest step. First read `docs/prompts/00-overview.md` and `docs/progress.md`, then `docs/research.md` §2 "Collision through portals", §4 "Why the attach-the-clone shortcut fails", §6 "Robustness" and §8 "Portal transit design". Read Ianua's teleport block in `~/videos/ianua/src/core/sim.js` (function `step`, the loop over `P1` calling `crossing`) for the velocity map and swept-centre test.

## Previous steps

- 01: scaffold, scene document, instanced rendering, interpolation with a tested teleport hook.
- 02: stencil recursion; the renderer draws master and clone clipped by the per-instance plane when a slot's `has clone` flag is set.
- 03: Rapier in a worker with the 16-float frame protocol (clone fields reserved), snapshots, guards. Portals are solid so far.

## Scope

All of this happens in the worker, in `src/physics/transit.js` and `src/physics/ghosts.js`, called from `world.js` before and after each step.

1. **Carve, per portal**, built when a portal is added or changed:
   - **Tunnel:** a ring of 12 thick slab colliders behind the opening, flush with the face, around a 12-gon inscribed in the ellipse. Depth = 2 × the largest body extent allowed (1.5 m by default). Slab thickness ≥ 0.4 m, so a plank lying across the opening rests on the slab tops.
   - **Plug:** a thin cuboid collider filling the opening, with `ActiveHooks.FILTER_CONTACT_PAIRS`.
   - **Filtering:** `filterContactPair` drops contacts between a body in transit through this portal and (a) the plug, (b) the host block. All other pairs keep their contacts, and the tunnel slabs collide only with bodies in transit.
   - Keep the hook fast: a `Map` from collider handle to role, and a `Set` of `bodyHandle:portalIndex`.
2. **Ghosts** (`ghosts.js`):
   - For each portal P with partner Q, take the static colliders within 3 m of Q, clipped to the half-space in front of Q. A clipped box becomes the convex hull of its clipped corners.
   - Map them with `portalMap(Q, P)` behind P.
   - They are fixed colliders that collide only with bodies in transit through P (hook role `ghost:P`).
   - Rebuild them when blocks or portals change, never per step.
3. **Transit state**, per body:
   - **Entering.** Enter transit through P when the body's bounding sphere overlaps P's opening disc, extended 5 cm in front and the tunnel depth behind. Then:
     - create a kinematic, position-based clone on the Q side with the same collider shape
     - set the slot's `has clone` flag
   - **Each step:** set the clone's next kinematic pose to `M · masterPose` with `setNextKinematicTranslation` and `setNextKinematicRotation`, so exit-side bodies are pushed with a real velocity.
   - **Feedback:** after the step, read contact pairs on the clone. Map each impulse by `R⁻¹` to the mapped point and apply it to the master on the next step, scaled by 0.8 for damping.
   - **Leaving:** the body leaves transit when its sphere no longer overlaps the zone. Remove the clone.
4. **Teleport:**
   - **Trigger:** the master's centre crosses P's opening during the step (`crossing(P, P, c0, c1)`) with `dot(v, P.n) < 0`, using a 1 cm hysteresis band.
   - **Swap:** set the master's pose to `M · pose`, linear velocity to `R v` and angular velocity to `R ω`. Move the clone to the old master pose, mapped back.
   - **State:** transit is now through Q, from the other side. Write the teleport field (portal index + 1) into the frame flags for interpolation.
   - **Cooldown:** block a reverse teleport through the same pair for 3 steps.
   - **Wake** both bodies.
5. **Rules for edge cases:**
   - **One portal at a time.** A body is in transit through one portal at a time. A second portal stays solid to it until the first transit ends.
   - **Portal removed or moved while a body is in transit:**
     - centre in front of the entry: drop transit and restore the plug
     - centre behind the entry with the partner alive: teleport it
     - otherwise: push it out along `+n` until it is free, and emit an event
   - **Blocked exit** (a block or wall right in front of Q): the ghost geometry stops the master, so it cannot pass. It must neither push through nor explode.
   - **Facing pairs** (floor ↔ ceiling straight above): endless fall reaches terminal speed and stays stable.
   - **Pair on the same wall, side by side** (Portal 64's "clip out of the level" bug): nothing may end up behind the wall or outside the level. Add a check that every body centre stays inside the level bounds or in a tunnel.
6. **Headless tests** (`tests/transit.mjs`), Node with real Rapier, no render. Each case asserts positions and velocities numerically:
   - **drop:** a box falls into a floor portal and exits a wall portal with speed `|v|` preserved within 2 % and direction mapped by `R`
   - **rest:** a box resting half-in a floor portal whose exit is a wall at the same height. After 5 s, centre jitter < 2 mm and no teleport flip-flops (count teleports)
   - **plank:** a 3 m plank slid across a 1.4 m opening rests on the slab tops and does not fall in. Pushed lengthwise, it passes through
   - **blocked:** the exit is covered by a fixed block. The body stops, with max penetration < 2 cm
   - **endless:** floor ↔ ceiling. Speed converges to terminal ± 5 % with no NaN after 60 s of simulated time
   - **sidebyside:** both portals on one wall. 200 random throws, and no body ever leaves the level
   - **removed:** delete the exit portal mid-transit. The body ends in front of the entry wall, not inside it
   - **fast:** a 0.15 m ball at 40 m/s at a grazing 15° into the opening teleports correctly, with no tunnelling through the host wall
   - **stack:** a 10-box stack pushed into a wall portal. Every box comes out, and the total kinetic energy never increases by more than 5 % in any step

## Files you own

`src/physics/transit.js`, `src/physics/ghosts.js`, `tests/transit.mjs`, hook and transit calls in `src/physics/world.js`, and the use of the reserved clone fields and flags in the worker's frame writer.

## Do not touch

`src/render/*`. The renderer already draws clones; if it needs a change, write the need in progress.md and keep it to a minimum. Also `src/core/portal.js`, apart from adding a pure helper with a test, `src/editor/*`, `docs/research.md` and `docs/prompts/*`.

## Acceptance

- [ ] `node tests/transit.mjs` passes every case and prints teleport counts, jitter and energy numbers.
- [ ] In the browser with the default scene, bodies fall through the floor portal and fly out of the wall portal. Halves meet exactly at the opening while straddling it. No body flickers or pops when it teleports; check by slowing time to 0.1× with a debug key.
- [ ] The interpolation across a teleport is seamless: no one-frame streak across the room. Watch at 0.1×.
- [ ] Performance: 300 bodies with 40 in transit at once keep the physics step ≤ 5 ms, and the hook adds ≤ 0.5 ms. Measure and record.
- [ ] Take a screenshot and a short sequence of 5 stills at 0.25× of a box passing through, for the user.
- [ ] Record the results and remaining known limits in `docs/progress.md`.
- [ ] Commit, for example `feat(physics): bodies through portals with carved tunnels, ghosts, clones and teleports`.
