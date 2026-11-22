// The vehicle stage: the one place the car lives.
//
// The stage first shows the poster (a still cut-out of the car, public/vehicle). Once the poster has
// loaded and the browser is idle, the 3D viewer (three.js, its own lazy chunk) mounts into
// [data-vehicle-canvas] and loads the model named by the stage's data-vehicle-model manifest. The poster
// stays underneath as the loading state and the fallback (no WebGL, Save-Data, a low-memory device, or
// any load error). The hero's markup, the optics and the HUD never change.
//
// Contract for a renderer:
//   attachRenderer(stage, async (canvasEl, { poster, reducedMotion }) => {
//     ...mount the scene into canvasEl...
//     return { ready: Promise<void>, destroy() {} };   // resolve `ready` once the first frame is drawn
//   });
// The stage switches data-vehicle-mode from "poster" to "live" only after `ready` resolves, so the
// poster never blinks out before the model is on screen.
import { bindStageUI } from './stage-ui.js';
import { canRun3D, tierFor } from './gate.js';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function findStages(root = document) {
  return [...root.querySelectorAll('[data-vehicle-stage]')];
}

export async function attachRenderer(stage, mount, { onError } = {}) {
  const canvasEl = stage.querySelector('[data-vehicle-canvas]');
  const poster = stage.querySelector('[data-vehicle-poster]');
  if (!canvasEl || typeof mount !== 'function') return null;
  let handle = null;
  try {
    handle = await mount(canvasEl, { poster, reducedMotion: reducedMotion() });
    await handle?.ready;
    stage.dataset.vehicleMode = 'live';
    return handle;
  } catch (err) {
    if (onError) onError(err);
    else console.warn('[vehicle-stage] renderer failed; keeping the poster', err);
    handle?.destroy?.();
    canvasEl.replaceChildren();
    stage.dataset.vehicleMode = 'poster';
    return null;
  }
}

// The model file downloads alongside the 3D code: once the poster has loaded, a script in the page's
// <head> preloads the right tier's GLB (vite.config.js, vehicleModelPreload), using the same two checks.
const whenIdle = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 300));

// Loading the 3D car: two attempts at most, a short pause between them. An attempt fails on any error
// or when it stalls: LOAD_STALL_MS with no progress (the code chunk, the manifest, the model download,
// or the shader compile after it), so a slow connection that keeps downloading is never cut off, while
// one that hangs is. If both attempts fail, the poster stays and the readout says so quietly.
const LOAD_STALL_MS = 20000;
const RETRY_DELAY_MS = 1500;
const ATTEMPTS = 2;

async function boot(stage) {
  const ui = bindStageUI(stage);
  let handle = null;
  for (let attempt = 1; attempt <= ATTEMPTS && !handle; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    ui.loading();
    handle = await loadOnce(stage, ui, (err) => {
      reportVehicleIssue(attempt < ATTEMPTS ? 'vehicle_3d_retry' : 'vehicle_3d_failed', { attempt, reason: String(err?.message ?? err).slice(0, 120) });
    });
  }
  if (handle) {
    ui.live(handle);
    stage.vehicle = handle;
    const syncLight = linkBackgroundLight(stage, handle);
    followContext(stage, handle, ui, syncLight);
    // the story (src/story/story.js) borrows the live car from here
    stage.dispatchEvent(new CustomEvent('vehicle:live', { detail: handle }));
  }
  else ui.failed();
}

// One attempt, under a stall watchdog: every progress event (and each step that completes) restarts the
// LOAD_STALL_MS clock; if it runs out, the attempt fails and its viewer is destroyed.
function loadOnce(stage, ui, onError) {
  let timer = 0;
  let stall;
  const stalled = new Promise((_, reject) => { stall = reject; });
  stalled.catch(() => {}); // only ever read through the races below
  const kick = () => {
    clearTimeout(timer);
    timer = setTimeout(() => stall(new Error(`no loading progress for ${LOAD_STALL_MS / 1000} s`)), LOAD_STALL_MS);
  };
  kick();
  return attachRenderer(stage, async (canvasEl, { reducedMotion }) => {
    const { createViewer } = await Promise.race([import('./viewer/viewer.js'), stalled]);
    kick();
    const viewer = createViewer(canvasEl, {
      stage, reducedMotion, tier: tierFor(),
      manifestUrl: stage.dataset.vehicleModel,
      onProgress: (p) => { kick(); if (p != null) ui.progress(p); },
    });
    viewer.ready = Promise.race([viewer.ready, stalled]);
    return viewer;
  }, { onError }).finally(() => clearTimeout(timer));
}

// Loading problems go to Vercel Analytics as a custom event when the page has it (window.va, set up by
// @vercel/analytics' inject(); track() sends the same call), otherwise to the console. Event data must
// be flat strings, numbers and booleans. Custom events need a Vercel plan that includes them.
function reportVehicleIssue(name, data) {
  if (typeof window.va === 'function') window.va('event', { name, data });
  else console.warn(`[vehicle-stage] ${name}`, data);
}

// The car's WebGL context can be lost while live (a driver reset; a phone reclaiming the GPU from a
// background tab). The stage then goes back to the poster at once (vehicle-stage.css: no fade that way)
// with the controls put away, and returns to live, with the usual fade, once the viewer has restored
// the context and drawn a frame. If it never comes back, the poster simply stays.
function followContext(stage, handle, ui, syncLight) {
  if (typeof handle.onContextChange !== 'function') return;
  handle.onContextChange((lost) => {
    stage.dataset.vehicleMode = lost ? 'poster' : 'live';
    if (lost) ui.suspend();
    else ui.resume();
    syncLight?.();
  });
}

// The stage's background light ([data-fx], spotlight-cone, mounted by the kit's system.js) is a second
// WebGL canvas with its own frame loop. While the 3D car is live, that light moves only while the car
// does: it holds its current frame when the car comes to rest (after LIGHT_REST_MS, so a run of key
// presses or a coast does not stop and start it) and carries on from that same frame when the car moves
// again, so there is no jump. Its look never changes, only whether it animates.
// - It is mounted asynchronously and may be replaced (a theme change), so the controller is looked up
//   each time and the state applied again whenever it is (re)mounted.
// - On phones the kit bakes it to a still picture whose pause and resume do nothing; under reduced motion
//   it never runs. Both stay as they are.
// - A visitor who pressed the light's own pause button keeps it paused.
// - While the poster is back (the car's WebGL context was lost), the light moves as it does on the poster.
// - While the story has the car (data-vehicle-story on the stage, src/story/story.js), the light holds
//   still: the car moves with every scroll frame there, and the light, out of sight in the hero, would
//   otherwise draw a second WebGL canvas alongside it.
// The light's own WebGL canvas recovers from a lost context by itself (fx.js makes a fresh canvas) and
// keeps its paused or running state through that. Returns a function that applies the state again.
const LIGHT_REST_MS = 1200;
function linkBackgroundLight(stage, handle) {
  const light = stage.querySelector('[data-fx]');
  if (!light || typeof handle.onActivity !== 'function') return;
  let moving = false;
  let timer = 0;
  const pausedByVisitor = () => !!light.querySelector('.loop-pause.is-paused');
  const apply = () => {
    const ctl = light.__fx;
    if (!ctl) return;
    const posterShown = stage.dataset.vehicleMode !== 'live';
    const inStory = 'vehicleStory' in stage.dataset;
    if (!inStory && (moving || posterShown) && !pausedByVisitor()) ctl.resume();
    else ctl.pause();
  };
  handle.onActivity((on) => {
    clearTimeout(timer);
    if (on) { moving = true; apply(); }
    else timer = setTimeout(() => { moving = false; apply(); }, LIGHT_REST_MS);
  });
  new MutationObserver(apply).observe(light, { attributes: true, attributeFilter: ['data-fx-mounted'] });
  new MutationObserver(apply).observe(stage, { attributes: true, attributeFilter: ['data-vehicle-story'] });
  return apply;
}

export function initVehicleStages() {
  for (const stage of findStages()) {
    const poster = stage.querySelector('[data-vehicle-poster]');
    const start = () => {
      stage.dataset.posterReady = '';
      if (stage.dataset.vehicleModel && canRun3D()) whenIdle(() => boot(stage));
    };
    if (!poster || (poster.complete && poster.naturalWidth)) start();
    else {
      poster.addEventListener('load', start, { once: true });
      poster.addEventListener('error', start, { once: true });
    }
  }
}
