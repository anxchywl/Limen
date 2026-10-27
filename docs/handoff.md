# Hand-off: continue the Limen build

You are taking over the build of **Limen** in `~/limen`. It is a browser sandbox: users place linked portals, build with blocks, spawn objects, and watch real physics carry them through. Two rules govern every choice: **it must stay smooth, and it must never break.**

The build is split into prompts `01` to `08` in `docs/prompts/`. **Prompt 01 is done** (commit `23bb6d9`). Your next task is **`docs/prompts/02-portal-rendering.md`**. Then do 03, 04 and onwards, one prompt at a time.

## Read first, in this order

1. `docs/prompts/00-overview.md`: the stack, the file owners, the shared contracts and the conventions. It is short, and it binds every step.
2. `docs/progress.md`: what each earlier step left. Read its "For prompt 02" and "For prompt 03" lists carefully.
3. The prompt you are doing, e.g. `docs/prompts/02-portal-rendering.md`.
4. In `docs/research.md`, read **only** the sections your prompt names. Do not read all of it.

Then read the source files your prompt touches. The repo is small (about 1,400 lines in `src/`).

## How to do one prompt

1. Do exactly what the prompt's **Scope** says. Touch only its **Files you own**, and respect its **Do not touch** list.
2. Check every item in its **Acceptance** list for real, not by assumption:
   - Run `node tests/*.mjs`.
   - Serve the app with `python3 -m http.server 5180` in `~/limen`, open `http://localhost:5180`, and check that the browser console has no errors and the network tab has no 404s.
   - Use the `window.limen` debug handle for measurements (see below).
   - If you cannot open a browser yourself, say so plainly and give the user the exact steps to check.
3. Append a note to `docs/progress.md` under a new heading `## NN: <title> (date)`. Cover:
   - what was done
   - the file map of new files
   - the measured numbers
   - what the next prompt must know
4. Make **one local commit**: scoped, lowercase, conventional, with a short subject and no body. For example `feat(render): stencil recursion through portal pairs` or `fix(physics): clamp angular speed`.
5. **Never push. Never create the GitHub repo.** Prompt 08 does that, and only with the user's explicit OK at that time.

## Hard rules

- **No build step.**
  - The code is plain ES modules plus an import map in `index.html`.
  - Dependencies are vendored in `vendor/` by `tools/vendor.mjs`, and the versions are pinned:
    - three.js r187 (`0.187.0`), on WebGL2
    - Rapier 3D 0.21 `simd-compat`, with a plain `compat` fallback, run in a module Web Worker from prompt 03 on
  - Do not add a bundler or a framework, and do not change these versions.
- **`~/videos/**` is read-only.** Ianua (`~/videos/ianua`) is the user's portal lab. Copy from it, with a header comment that names the source, and never edit it.
- **Do not fork the portal maths.** Use `src/core/portal.js` (`frame`, `local`, `portalMap`, `crossing`).
- **Keep the shared contracts stable.** Later prompts may add fields with defaults, but must never rename existing ones.
  - The scene document (`src/core/scene.js`) is the single source of truth.
  - The frame buffer layout (`src/core/frame.js`): a 4-float header, then 16 floats per body slot.
- **Style.** Follow the existing code:
  - short modules, each with a comment at the top saying what it does and why
  - plain arrays for vectors in `src/core/`
  - three.js types only inside `src/render/`
  - allocation-free hot paths
- **Original work.** No names, items or art from any existing game.

## The look (the user cares a lot)

- **Vivid and smooth.** Saturated wall colours by face normal (`ROOM` in `src/render/palette.js`), thin constant-pixel ink edges (`src/render/ink.js`), and a paper floor. Never grey, dull defaults.
- **Portal colours** come from `PORTAL_COLOURS` (blue `#3E7C8F`, orange `#C27A40`, violet, green), with a per-depth tint, as in Ianua's `uTint` / `uPassFade` / `uDeep`.
- **Check every visual change** in the browser before calling it done.

## Measuring

- Time each phase with `performance.now()`, and the GPU with timer queries (`view.gpuMs`). Never trust an fps counter alone.
- `window.limen` exposes `doc`, `view`, `sim`, `loop`, `spawn(n)`, `reset()` and `recordAlpha(ms)`.
  - Use `loop.stop()`, then call `loop.tick(t)` with your own timestamps, to simulate 120 Hz or a 30 s gap.
- **Debug keys:** `B` spawns 2,000 bodies, and `R` resets the sim.
- **Budget:** main-thread time per frame ≤ 4 ms on desktop.

## State after 01 (details in `docs/progress.md`)

- **Rendering:**
  - The room is open-topped: 12 × 6 × 12 m, a floor and four walls, no ceiling.
  - Blocks are merged into one mesh. Bodies are one `InstancedMesh` per shape (box, ball, capsule, plank), with a per-instance `aClip` plane.
  - Shadows come from one sun with a 2048 map, and tone mapping is Neutral.
- **Simulation:** a main-thread stub, `src/app/stubsim.js`, steps the bodies through a fixed 60 Hz loop (`src/app/loop.js`) with interpolation. Prompt 03 replaces the stub with the Rapier worker, behind the same interface: `slots`, `write(buf)`, `step(buf)`, `add`, `reset`.
- **Camera:** `main.js` keeps the camera inside the room's footprint as a stopgap. Prompt 05 replaces it.
- **Teleports:** `blendSlot` in `src/core/interp.js` already maps the previous pose through a portal when a body teleports, and it also blends clone poses.

## Pitfalls already hit

- **Shared geometry:** never share a `BufferGeometry` between meshes and then dispose one of them. It frees GL buffers the other mesh still draws, which shows up as "no buffer is bound to enabled attribute".
- **Light intensities:** three's lights are divided by π, which is why the intensities are high (hemisphere 2.7, sun 3.0).
- **Hidden preview:** a hidden browser preview may run at about 1 fps. Drive `loop.tick` manually for timing tests.

## With the user

- Keep replies short and plain, with no filler.
- Ask before anything hard to undo or outward-facing, such as a push, the repo, deleting files or touching anything outside `~/limen`.
- End each prompt with a short report: the commit hash, the measured numbers, a screenshot of what changed, and what the next prompt must know.
