// The frame loop: requestAnimationFrame draws, a fixed-step accumulator advances the sim.
// Steps run at a fixed rate (60 Hz), at most maxSteps per frame, so a slow frame or a hidden tab
// never causes a burst ("spiral of death"). Render blends the last two frames by alpha = acc / dt.
//
// The sim is either a worker bridge with `sample(frameDt)` -> `{prev, curr, alpha, steps}` or a
// synchronous test double with `slots`, `write(buf)` and `step(buf)`. Buffers use core/frame.js.

import {frameLength} from '../core/frame.js';

export function createLoop({sim, render, dt = 1 / 60, maxSteps = 4, onFrame}) {
  const isAsync = typeof sim.sample === 'function';
  let prev = isAsync ? null : new Float32Array(frameLength(sim.slots));
  let curr = isAsync ? null : new Float32Array(frameLength(sim.slots));
  if (!isAsync) {
    sim.write?.(curr);
    prev.set(curr);
  }
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
    const dtSec = Math.max(0, (now - last) / 1000);
    last = now;
    if (isAsync) {
      const {prev: p, curr: c, alpha, steps: n} = sim.sample(Math.min(maxSteps * dt, dtSec));
      render(p, c, alpha);
      const ms = performance.now() - t0;
      stats.steps += n; stats.frameSteps = n; stats.alpha = alpha; stats.ms = ms; stats.frames++;
      stats.msAvg += (ms - stats.msAvg) * 0.05;
      stats.msMax = Math.max(stats.msMax * 0.995, ms);
      onFrame?.(stats, n, alpha);
      return;
    }
    acc += dtSec;
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
  const resync = () => { last = null; sim.resync?.(); };

  return {
    tick, start, stop, resync, stats, dt,
    get prev() { return sim.prev ?? prev; },
    get curr() { return sim.curr ?? curr; },
  };
}
