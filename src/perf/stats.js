// Performance instrumentation and metrics aggregation for Limen.
// Tracks phase timings (interp, upload, passes per depth, UI, total CPU, GPU),
// reads worker physics & transit times from the frame header, and computes rolling
// p50/p95 statistics over a 2-second window.

export function percentile(arr, p) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx];
}

export function average(arr) {
  if (!arr || arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

export function createStatsCollector(windowDurationMs = 2000) {
  const samples = []; // [{t, cpu, interp, upload, passes, ui, gpu, workerStep, workerTransit, views, depth, bodies, inTransit}]

  function push(sample) {
    const now = performance.now();
    sample.t = now;
    samples.push(sample);

    const cutoff = now - windowDurationMs;
    while (samples.length > 0 && samples[0].t < cutoff) {
      samples.shift();
    }
  }

  function getMetrics() {
    if (samples.length === 0) {
      return {
        count: 0,
        cpu: {p50: 0, p95: 0, avg: 0, max: 0},
        gpu: {p50: 0, p95: 0, avg: 0},
        workerStep: {p50: 0, p95: 0, avg: 0, max: 0},
        workerTransit: {p50: 0, p95: 0, avg: 0},
        interp: {p50: 0, p95: 0, avg: 0},
        upload: {p50: 0, p95: 0, avg: 0},
        passes: {p50: 0, p95: 0, avg: 0},
        ui: {p50: 0, p95: 0, avg: 0},
        views: 0,
        depth: 0,
        bodies: 0,
        inTransit: 0,
      };
    }

    const cpus = samples.map((s) => s.cpu || 0);
    const gpus = samples.map((s) => s.gpu || 0).filter((v) => Number.isFinite(v) && v > 0);
    const steps = samples.map((s) => s.workerStep || 0);
    const transits = samples.map((s) => s.workerTransit || 0);
    const interps = samples.map((s) => s.interp || 0);
    const uploads = samples.map((s) => s.upload || 0);
    const passes = samples.map((s) => s.passes || 0);
    const uis = samples.map((s) => s.ui || 0);

    const latest = samples[samples.length - 1];

    return {
      count: samples.length,
      cpu: {
        p50: percentile(cpus, 0.50),
        p95: percentile(cpus, 0.95),
        avg: average(cpus),
        max: Math.max(...cpus),
      },
      gpu: {
        p50: percentile(gpus, 0.50),
        p95: percentile(gpus, 0.95),
        avg: average(gpus),
      },
      workerStep: {
        p50: percentile(steps, 0.50),
        p95: percentile(steps, 0.95),
        avg: average(steps),
        max: Math.max(...steps),
      },
      workerTransit: {
        p50: percentile(transits, 0.50),
        p95: percentile(transits, 0.95),
        avg: average(transits),
      },
      interp: {
        p50: percentile(interps, 0.50),
        p95: percentile(interps, 0.95),
        avg: average(interps),
      },
      upload: {
        p50: percentile(uploads, 0.50),
        p95: percentile(uploads, 0.95),
        avg: average(uploads),
      },
      passes: {
        p50: percentile(passes, 0.50),
        p95: percentile(passes, 0.95),
        avg: average(passes),
      },
      ui: {
        p50: percentile(uis, 0.50),
        p95: percentile(uis, 0.95),
        avg: average(uis),
      },
      views: latest?.views ?? 0,
      depth: latest?.depth ?? 0,
      bodies: latest?.bodies ?? 0,
      inTransit: latest?.inTransit ?? 0,
    };
  }

  function clear() {
    samples.length = 0;
  }

  return {
    push,
    getMetrics,
    clear,
    get samples() { return samples; },
  };
}
