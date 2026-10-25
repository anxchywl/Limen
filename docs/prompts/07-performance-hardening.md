# 07: performance hardening and stress tests

You are continuing Limen in `~/limen`. First read `docs/prompts/00-overview.md` and `docs/progress.md` (it has the numbers measured so far), then `docs/research.md` §5 "Cost and budget of recursion" and all of §6.

## Previous steps

01–06 produced the full sandbox: rendering with stencil recursion, Rapier physics in a worker with portal transit, the editor, and save/load/share with a gallery. Earlier steps measured individual budgets. This step makes them hold everywhere, under abuse.

## Scope

1. **Instrumentation** (`src/perf/stats.js`):
   - Phase timers for interpolation, the instance upload, each recursion level, UI work and total CPU.
   - GPU time from `EXT_disjoint_timer_query_webgl2` when available.
   - Worker step time and transit time, taken from the frame header (add them to the header's spare fields and document them in `protocol.js`).
   - An overlay toggled with the backtick key: p50 and p95 over 2 s, views drawn, depth reached, bodies, bodies in transit.
2. **Adaptive quality** (`src/perf/quality.js`):
   - Watch an EMA of frame time against a target of 16.7 ms, plus vsync headroom on high-refresh screens.
   - Step down in this order: DPR scale (down to 0.5), shadow-map size, then recursion depth, then the view budget.
   - Step back up only after 3 s under 70 % of budget (hysteresis), so it never flickers between levels.
   - The "high" and "low" settings in the panel pin the levels; "auto" uses this controller.
3. **Limits audit.** Every limit in research.md §6 "Limits" is enforced in one place (`src/core/limits.js`) and shown in the UI when hit. Phones get their own column, detected by `pointer: coarse` and `hardwareConcurrency`.
4. **Watchdogs.** Wire the worker's `busy` event to the UI:
   - pause the emitters
   - show "simulation busy" with a button to remove the newest 50 bodies
   - raise the sleep thresholds until the step is back under budget
   - Rendering never blocks on physics.
5. **Memory.** Run a 10-minute churn: spawn and delete bodies, place and remove portals, load gallery scenes in a loop. The JS heap and the Rapier WASM memory must not grow without bound. Free removed colliders and bodies properly, call `world.free()` on reload, and dispose GPU resources on rebuild.
6. **Stress scenes** (`tests/stress/*.json`, loadable as `?stress=name`). Each runs a scripted 60 s scenario and prints a JSON report (p50/p95 frame, p95 step, views, any events):
   - `pile`: 300 bodies dropped into one floor portal whose exit is a wall portal
   - `mirrors`: two pairs facing each other across a corridor, the camera in the middle (worst-case recursion)
   - `endless`: 100 bodies in a floor ↔ ceiling loop
   - `emitters`: 8 emitters at max rate until the cap
   - `churn`: portals re-placed every 0.5 s with bodies in transit
   - `phone`: the `pile` scene at phone limits, run under the mobile preset
7. **Robustness re-check.** Re-run every break case from prompts 03–05 in the browser with the overlay on. Fix what regressed. Add a "chaos" debug button that runs, over 20 s:
   - random spawns at the cap
   - teleports of portals onto bodies
   - NaN injection
   - a forced WebGL context loss
   - a hidden tab

   The app must survive all of it with no stuck state.

## Files you own

`src/perf/**`, `src/core/limits.js`, `tests/stress/**`, the overlay in `src/ui/perf.js`, and small targeted fixes anywhere when a test fails. Each fix gets its own commit with a scoped message, such as `fix(render): skip zero-area portal views`.

## Do not touch

The document schema, except adding `settings.quality` fields with defaults. Make no visual restyle, no new features, and no change to `docs/research.md` or `docs/prompts/*`.

## Acceptance

- [ ] Desktop reference, 1080p: every stress scene except `mirrors` holds p95 ≤ 16.7 ms. `mirrors` holds p95 ≤ 16.7 ms after adaptive quality settles within 3 s. Physics p95 ≤ 4 ms at 300 bodies (5 ms with 40 in transit).
- [ ] Phone emulation: the `phone` stress scene holds the frame rate, with no frame over 33 ms after settling. If a real phone is available, note it; otherwise state clearly that only emulation was tested.
- [ ] The memory churn shows no unbounded growth. Report heap and WASM memory at 0, 5 and 10 min.
- [ ] Chaos button: the app survives, and the console shows only expected warnings.
- [ ] Reports from all stress scenes are saved to `docs/perf-report.md` with the machine name and browser version.
- [ ] Update `docs/progress.md`.
- [ ] Commit, for example `perf: adaptive quality, limits, watchdogs and stress scenes`.
