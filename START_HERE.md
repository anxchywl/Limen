# Start here

Limen is a browser sandbox for portals and physics. You place linked portals, build with blocks, spawn objects, and watch real physics carry them through.

The app is built in steps. Use one fresh Claude Code session per step, opened in `~/limen`.

1. Paste this line: "Do docs/prompts/NN-….md". Start with `01-scaffold-render-loop.md`.
2. Each session reads `docs/prompts/00-overview.md` (stack, layout, contracts) and `docs/progress.md` (what earlier steps left), then only the research sections its prompt names.
3. A step is done when its acceptance checks pass. It then appends to `docs/progress.md` and makes a local commit. Nothing is pushed until you say so.

Other docs:

- `docs/research.md` covers the findings: how the games did portals, open-source projects, the physics and render choice, and performance.
- `docs/prompts/` holds the steps, `01` to `08`.

Decided on 2026-11-01: the name Limen (`anxchywl/Limen`, `limen.anxchywl.dev`), the MIT licence, GitHub Pages hosting, and no build step.
