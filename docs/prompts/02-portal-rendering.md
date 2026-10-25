# 02: portal rendering and recursion

You are continuing Limen in `~/limen`. First read `docs/prompts/00-overview.md` and `docs/progress.md`, then `docs/research.md` §2 "Rendering" and §5 "Cost and budget of recursion". Skim Ianua's `~/videos/ianua/src/render/renderer.js` lines 1–20 and the portal branch of `trace()` (search `h.portal >= 0`) for the tint and terminal look. Do not port the ray tracer.

## Previous steps

01 produced:

- vendored three r187 and Rapier
- `src/core/{vec,portal,scene}.js`
- a coloured room of merged blocks
- instanced bodies with a per-instance clip-plane attribute
- a 60 Hz fixed-step stub simulation with interpolation and a tested teleport-aware interpolation hook

There are no portals yet.

## Scope

1. **Portals in the document.** Add two portal pairs to the default scene in `scene.js`: one pair floor ↔ wall, one pair wall ↔ wall at right angles. Field names are in the overview. Openings are ellipses, 0.7 × 1.0 m half sizes.
2. **The portal frame and surface.** `src/render/portals.js` draws:
   - each portal's rim, an ellipse ring in the pair colour with an ink outline
   - its opening mesh, an ellipse fan, used for stencil marking
3. **Stencil recursion.**
   - Draw the main view. For each visible portal, breadth-first up to the limits:
     - mark the stencil at the current level
     - clear depth inside it (a full-screen quad at the far plane, stencil EQUAL)
     - draw the scene from the virtual camera with stencil EQUAL to the level + 1
     - restore the portal opening's depth
   - The virtual camera is `portalMap(entry, exit)` applied to the current camera's world matrix. Use the overview's portal maths, wrapped in three.js matrices inside `src/render/` only.
   - Materials need `stencilWrite: true`, `stencilFunc: EqualStencilFunc` and `stencilRef = level`. Keep the material count small so updating refs per pass stays cheap.
4. **The oblique near plane.** Write `src/render/oblique.js`, adapted from three.js `Reflector.js` (Lengyel), with the clip plane on the exit portal in camera space. Unit-test it in `tests/oblique.mjs`: points behind the exit plane get clip z outside [−1, 1].
5. **Scissor and culling.**
   - Each view gets a scissor rect: the projected bounds of the portal's opening, intersected with the parent's rect.
   - Skip a portal if its rect is empty, if it faces away, or if its area is below 0.2 % of the screen.
6. **The view budget.** Use these defaults:
   - max depth 6 on desktop, 3 when `matchMedia('(pointer: coarse)')` matches
   - at most 32 views per frame on desktop, 12 on phones

   When a limit stops recursion, fill the opening with the pair's terminal colour, darkened per level. Each pass also tints its view slightly in the portal colour, as in Ianua (`uTint` 0.1, `uPassFade`), so depth reads as colour.
7. **The camera near a portal.** When the main camera is within `near × 3` of an opening, use a thickened opening: a shallow box behind the portal on the camera's side, or Sebastian Lague's offset. There must be no flash of wall when the camera passes through. Add a debug key that flies the orbit camera straight through a portal to test this.
8. **Clipped clones in render.**
   - The renderer reads the frame buffer's clone fields. A body whose `has clone` flag is set is drawn twice:
     - the master, clipped to the front of the entry portal
     - the clone, clipped to the front of the exit portal
   - Both use the per-instance clip plane. Extend the stub simulation with a debug body that slides back and forth through the floor portal and fills the clone fields using `portalMap`.
9. **Oracle check against Ianua.** Write `tests/oracle.html`: a page that renders the same simple scene (one room, one portal pair, three boxes) with Limen's raster path and with Ianua's ray tracer, imported read-only from `../../videos/ianua/src/render/renderer.js` through a relative URL. Both use a matched camera, and the page reports the share of differing pixels. The goal is to confirm geometry, not style. If importing across folders is blocked by the server root, copy Ianua's renderer into `tests/vendor-ianua/` with an origin note instead.

## Files you own

`src/render/portals.js`, `src/render/oblique.js`, and edits to `src/render/renderer.js`, `src/render/instances.js` and `src/render/level.js` needed for multi-pass rendering. Also the portal entries in `src/core/scene.js`, `tests/oblique.mjs`, `tests/oracle.html`, and the stub-simulation debug body in `src/app/loop.js`.

## Do not touch

`src/core/vec.js` and `src/core/portal.js` (use them, do not fork them). Also `docs/research.md` and `docs/prompts/*`. Add no physics engine, editor or sharing.

## Acceptance

- [ ] `node tests/oblique.mjs` passes. `tests/oracle.html` reports agreement on silhouettes: under 1 % of pixels differ in coverage of the portal opening, the boxes and the room edges, with the style differences masked.
- [ ] Views through both pairs are correct: walls keep their colours through the openings, and up stays up through the wall ↔ wall pair.
- [ ] Recursion: aim the orbit camera so a portal sees its partner. Depth goes to the limit. The terminal fill is the darkened pair colour, never black, never garbage. Views drawn never exceed the budget; log it.
- [ ] The camera flies straight through each portal with the debug key, with no wall flash and no frame showing the far side of the wall.
- [ ] The sliding debug body shows both halves meeting exactly at the opening while straddling it: no gap, no double, no z-fighting at the rim.
- [ ] Performance on the desktop reference: 2 pairs, depth 6, 300 stub bodies. GPU frame ≤ 10 ms (`EXT_disjoint_timer_query_webgl2` if available, otherwise `gl.finish()` timing in a debug mode). Main-thread CPU ≤ 4 ms. Record the numbers in `docs/progress.md`.
- [ ] Phone emulation (`resize_window` mobile preset, reload): depth 3, budget 12, no errors.
- [ ] Take a screenshot of a recursive view for the user.
- [ ] Commit, for example `feat(render): stencil recursion through portals with oblique near planes and clipped clones`.
