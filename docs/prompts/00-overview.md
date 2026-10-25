# Limen build: overview

Read this first in every build session. It costs little context. Read `docs/research.md` only in the sections your prompt names.

## What we build

A browser sandbox with three activities:

- **Build.** Snap static blocks on a grid, then place linked portal pairs on their flat faces.
- **Spawn.** Add boxes, balls, capsules and planks, plus emitters that keep making them.
- **Play.** Watch rigid-body physics carry everything through the portals, with the view seen recursively through each opening.

Two rules govern every choice: **it must stay smooth, and it must never break.** The work comes out of Ianua (`~/videos/ianua`), the lab behind the portals film by @anxchywl. Limen is its own original thing: no names, items or art from any existing game.

## Stack (decided in research.md §8)

- three.js r187, `WebGLRenderer` (WebGL2), vendored at `vendor/three/`.
- Rapier 3D 0.21 `simd-compat`, with a plain `compat` fallback, vendored at `vendor/rapier/`. It runs in a module Web Worker.
- Plain JavaScript ES modules, an import map in `index.html`, and no bundler. Dependencies are pinned and copied from `node_modules` by `tools/vendor.mjs`.
- Tests: `node tests/*.mjs` for headless logic, and `?stress=<name>` pages in the browser.
- Local server: `python3 -m http.server 5180`, entry `limen` in `.claude/launch.json` (5178 is Mundana, 5179 is Ianua).

## Layout and owners

| Path | Owner prompt |
|---|---|
| `index.html`, `src/main.js`, `src/app/loop.js`, `.claude/launch.json`, `tools/vendor.mjs`, `vendor/`, `package.json` | 01 |
| `src/core/vec.js`, `src/core/portal.js` (ported from Ianua), `src/core/scene.js` (document schema and defaults) | 01, extended by later prompts only where they say so |
| `src/render/*` (`renderer.js`, `level.js`, `instances.js`, `palette.js`, `portals.js`, `oblique.js`) | 01, then 02 |
| `src/physics/*` (`bridge.js` on the main thread; `worker.js`, `world.js` in the worker) | 03 |
| `src/physics/transit.js`, `src/physics/ghosts.js` | 04 |
| `src/editor/*`, `src/ui/*`, `src/app/camera.js` | 05 |
| `src/io/*`, `scenes/*.json` | 06 |
| `src/perf/*`, `tests/stress/*` | 07 |
| `README.md`, `LICENSE`, `THIRD_PARTY_LICENSES.txt`, `CNAME`, `.github/` | 08 |
| `tests/*.mjs` | each prompt adds its own files |

## Shared contracts (keep stable)

- **The scene document** (`src/core/scene.js`) is the single source of truth. Physics and render are both rebuilt from it. Fields:
  - `version: 1`
  - `settings` (gravity, timeScale, terminalSpeed, quality)
  - `blocks[]` (`{id, kind: 'box'|'ramp'|'pillar', min, max | pos, rot, size, color}`)
  - `portals[]` (`{id, pair, block, face, c, n, v, a, b, color}`)
  - `bodies[]` (`{id, shape, size, pos, quat, vel, angvel, mass, color}`)
  - `emitters[]`
  - `camera`

  Prompts may add fields with defaults. They never rename existing ones.
- **The frame buffer**, worker to main: one `Float32Array` per physics step, 16 floats per body slot:
  - pos 3, quat 4 (the master)
  - flags 1 (bit 0 alive, bit 1 has clone, bits 8–15 teleport portal index + 1)
  - clone pos 3, clone quat 4
  - spare 1

  The header holds the step index and physics time. Prompt 03 defines it in `src/physics/protocol.js`. Later prompts may only use the spare slots and flags.
- **Portal maths** comes from `src/core/portal.js`: `frame`, `local`, `portalMap`, `crossing`. Do not fork it.

## Conventions

- **Code style:** Ianua's. Short modules, a comment at the top of each file saying what it does and why, plain arrays for vectors in the core, three.js types only inside `src/render/`.
- **Commits:** scoped, lowercase, conventional, with short subjects and no bodies. For example: `feat(render): stencil recursion through portal pairs`, `fix(physics): clamp angular speed`, `docs: ...`. Commit at the end of your prompt, once the acceptance checks pass. No remote and no push until the user says so.
- **Visual look:** the paper-and-ink palette from Ianua's `palette.js`, with one saturated colour per wall face so views through portals read at a glance. Portal pairs are coloured from a palette of four (blue `#3E7C8F`, orange `#C27A40`, and two more chosen to match), with a per-pass tint. No grey, dull defaults.
- **Measuring performance:** use `performance.now()` around each phase and GPU timer queries, never the fps counter alone. The in-app browser pane can run the page hidden at about 1 fps.
- **Never edit** `~/videos/**`. Read Ianua only, and copy what you need into Limen with a comment noting where it came from.

## Sequence

| # | Prompt | Produces |
|---|---|---|
| 01 | `01-scaffold-render-loop.md` | repo scaffold, vendored deps, scene document, a static room drawn with instanced bodies, fixed-step loop with interpolation |
| 02 | `02-portal-rendering.md` | stencil recursion, oblique near planes, view budget, clipped clones in render, raster vs Ianua oracle test |
| 03 | `03-physics-worker.md` | Rapier in a worker, frame protocol, play/pause/reset, robustness guards (no portals yet) |
| 04 | `04-portal-transit.md` | bodies through portals: carve, ghosts, clones, teleport, edge cases |
| 05 | `05-editor.md` | edit and play modes, block, portal, spawn and emitter tools, gizmos, undo, fly camera through portals, phone controls |
| 06 | `06-save-load-share.md` | JSON files, URL share, autosave, validation, example gallery |
| 07 | `07-performance-hardening.md` | adaptive quality, limits, stress scenes, watchdogs, context loss, measured budgets |
| 08 | `08-readme-license-deploy.md` | README, MIT licence, third-party notices, GitHub Pages workflow (push only with the user's OK) |

Each prompt ends with a short note appended to `docs/progress.md`: what was done, what is left, and the measured numbers. That note is the hand-over to the next fresh session.

## Decisions the user still owns

- The name: `Limen` is a working name (repo `anxchywl/Limen`, site `limen.anxchywl.dev`).
- The licence: MIT is recommended.
- Hosting: GitHub Pages is recommended; Cloudflare Pages only if threads are ever needed.
- No build step versus Vite: no build step is recommended, matching Ianua and Mundana.
