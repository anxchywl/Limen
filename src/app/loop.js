// The frame loop: requestAnimationFrame draws, a fixed-step accumulator advances the sim.
// Steps run at a fixed rate (60 Hz), at most maxSteps per frame, so a slow frame or a hidden tab
// never causes a burst ("spiral of death"). Render blends the last two frames by alpha = acc / dt.
//
// The sim is anything with `slots` (slot count, may grow), `write(buf)` (the current state) and
// `step(buf)` (advance one step, then write). Buffers use the layout in core/frame.js. The stub
// (app/stubsim.js) runs on the main thread now; prompt 03 puts Rapier behind the same interface.

import {frameLength} from '../core/frame.js';

export function createLoop({sim, render, dt = 1 / 60, maxSteps = 4, onFrame}) {
  let prev = new Float32Array(frameLength(sim.slots));
  let curr = new Float32Array(frameLength(sim.slots));
  sim.write?.(curr);
  prev.set(curr);
  let acc = 0, last = null, raf = 0;
  const stats = {steps: 0, frameSteps: 0, alpha: 0, ms: 0, msAvg: 0, msMax: 0, frames: 0};

  const fit = () => {
    const n = frameLength(sim.slots);
    if (curr.length >= n) return;
    const size = Math.max(n, curr.length * 2);
    const p = new Float32Array(size), c = new Float32Array(size);
    p.set(prev); c.set(curr);
    prev = p; curr = c;
  };

  function tick(now) {
    const t0 = performance.now();
    if (last === null) last = now;
    acc += Math.max(0, (now - last) / 1000);
    last = now;
    let n = 0;
    while (acc >= dt && n < maxSteps) {
      fit();
      [prev, curr] = [curr, prev];
      sim.step(curr);
      acc -= dt;
      n++;
    }
    if (acc >= dt) acc %= dt; // drop the backlog instead of catching up
    fit();
    const alpha = acc / dt;
    render(prev, curr, alpha);
    const ms = performance.now() - t0;
    stats.steps += n; stats.frameSteps = n; stats.alpha = alpha; stats.ms = ms; stats.frames++;
    stats.msAvg += (ms - stats.msAvg) * 0.05;
    stats.msMax = Math.max(stats.msMax * 0.995, ms);
    onFrame?.(stats, n, alpha);
  }

  const frame = (now) => { raf = requestAnimationFrame(frame); tick(now); };
  const start = () => { if (!raf) raf = requestAnimationFrame(frame); };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; last = null; };
  // after a hidden stretch, start the clock afresh rather than counting the time away
  const resync = () => { last = null; };

  return {tick, start, stop, resync, stats, dt, get prev() { return prev; }, get curr() { return curr; }};
}
