// Adaptive resolution for the mobile tier: a pure governor (no DOM, no WebGL), fed by viewer.js once per
// drawn frame. Desktop keeps its own, older reducer in viewer.js.
//
// What counts as slow is the renderer's own cost, never the frame rate on its own:
//   cost     the GPU time of the frame (EXT_disjoint_timer_query_webgl2, where the browser has it) or the
//            CPU time of renderer.render(). Over budget is a direct sign the scene is too heavy.
//   missed   the gap between two drawn frames ran past 1.6x the display's frame clock (a dropped vsync).
//            The frame clock (cadence) is measured with empty requestAnimationFrame ticks while the car
//            is at rest, so a browser held at 30 fps by power saving has a 33 ms cadence and its steady
//            33 ms frames are not slow. A run of missed frames is only acted on after a fresh measurement
//            of the clock at the next rest: if the clock itself slowed (power saving switched on), nothing drops.
//
// Steps are 0.25 of a pixel ratio, between the top (device ratio, at most 2) and the floor (1.5).
// Down: a window of frames that is mostly slow; at once for cost, at the next rest for missed frames.
// Up: only at rest, after enough calm windows; each down that follows an up doubles the calm needed,
// and after three such failed climbs it stops climbing for the session, so a device on the edge settles
// instead of flipping between two levels.

export const MOBILE_QUALITY = { cap: 2, floor: 1.5, step: 0.25 };

const WINDOW = 30;      // drawn frames per verdict
const SETTLE = 10;      // frames ignored after a change (the new drawing buffer, its first frames)
const CALM_START = 4;   // calm windows before the first step up (~2 s of movement at 60 fps)
const CALM_MAX = 64;      // ~1 min of movement
const MAX_FAILED_CLIMBS = 3; // after three climbs that did not hold, the device stays where it holds
const TARGET_FPS_MS = 1000 / 60; // never chase more than 60 fps, so a 120 Hz screen is judged as 60

// the ratios the governor may use, highest first; never above the device's own ratio
export function qualityLevels(deviceDpr, { cap, floor, step } = MOBILE_QUALITY) {
  const top = Math.min(deviceDpr || 1, cap);
  const bottom = Math.min(floor, top);
  const levels = [];
  for (let d = top; d > bottom + 1e-6; d -= step) levels.push(Math.round(d * 100) / 100);
  levels.push(bottom);
  return levels;
}

export function createGovernor({ levels, start = 0 }) {
  let i = Math.min(Math.max(start, 0), levels.length - 1);
  let cadence = TARGET_FPS_MS; // until the first measurement at rest
  let n = 0, costSlow = 0, missed = 0, settle = 0;
  let gpuSum = 0, gpuN = 0;    // mean GPU cost of the window, to predict a step up
  let calm = 0, calmNeeded = CALM_START, lastMove = null, failedClimbs = 0;
  let suspect = false;         // a window of missed frames, waiting for the clock to be measured again
  let lastProbe = -Infinity;
  const log = [];
  let changes = 0;

  const target = () => Math.max(cadence, TARGET_FPS_MS);
  const budget = () => target() * 0.8;
  const reset = () => { n = costSlow = missed = gpuSum = gpuN = 0; };

  function move(dir, why) {
    const j = i + (dir === 'down' ? 1 : -1);
    if (j < 0 || j >= levels.length) return false;
    if (dir === 'down' && lastMove === 'up') {
      failedClimbs++;
      calmNeeded = failedClimbs >= MAX_FAILED_CLIMBS ? Infinity : Math.min(calmNeeded * 2, CALM_MAX);
    }
    log.push({ from: levels[i], to: levels[j], why });
    if (log.length > 20) log.shift();
    changes++;
    i = j; lastMove = dir; calm = 0; settle = SETTLE; suspect = false;
    reset();
    return true;
  }

  return {
    get dpr() { return levels[i]; },
    get cadence() { return cadence; },
    get budget() { return budget(); },
    // the longest gap between drawn frames that still counts as one continuous movement
    get maxGap() { return Math.max(100, target() * 3.5); },
    get wantsProbe() { return suspect; },
    probeDue(now) { return suspect || now - lastProbe > 15000; },
    get log() { return log.slice(); },
    get changes() { return changes; },

    // one drawn frame while something moves. intervalMs is omitted for the first frame of a movement.
    // returns true when the ratio dropped and the caller must resize.
    sample({ intervalMs, cpuMs = 0, gpuMs }) {
      if (settle > 0) { settle--; return false; }
      n++;
      const cost = gpuMs ?? cpuMs;
      if (cost > budget() || cpuMs > budget()) costSlow++;
      else if (intervalMs !== undefined && intervalMs > target() * 1.6) missed++;
      if (gpuMs !== undefined) { gpuSum += gpuMs; gpuN++; }
      if (n < WINDOW) return false;

      const slowShare = (costSlow + missed) / n;
      const costShare = costSlow / n;
      const mean = gpuN ? gpuSum / gpuN : undefined;
      reset();
      if (costShare > 0.5) return move('down', 'render cost over budget');
      if (slowShare > 0.5) { suspect = true; calm = 0; return false; }
      if (slowShare < 0.1) {
        // with a GPU time, a step up must also be predicted to fit: cost grows with the pixel count
        const next = levels[i - 1];
        const fits = mean === undefined || next === undefined || mean * (next / levels[i]) ** 2 < budget() * 0.7;
        if (fits) calm++;
      } else calm = 0;
      return false;
    },

    // a fresh measurement of the frame clock, taken at rest. Returns true when the ratio dropped.
    probed(ms, now = 0) {
      lastProbe = now;
      const was = cadence;
      cadence = ms;
      if (!suspect) return false;
      suspect = false;
      // the clock itself slowed (a power-saving cap): the frames were on time for it, so nothing drops
      if (ms >= was * 1.3) { reset(); return false; }
      return move('down', 'frames missed at a steady frame clock');
    },

    // called when the car comes to rest. Returns true when the ratio rose and the caller must resize.
    atRest() {
      if (i > 0 && !suspect && calm >= calmNeeded) return move('up', `${calm} calm windows`);
      return false;
    },
  };
}
