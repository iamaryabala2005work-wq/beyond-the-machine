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

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function findStages(root = document) {
  return [...root.querySelectorAll('[data-vehicle-stage]')];
}

export async function attachRenderer(stage, mount) {
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
    console.warn('[vehicle-stage] renderer failed; keeping the poster', err);
    handle?.destroy?.();
    canvasEl.replaceChildren();
    stage.dataset.vehicleMode = 'poster';
    return null;
  }
}

// Can this device run the viewer? Anything doubtful keeps the poster.
function canRun3D() {
  if (!('WebGL2RenderingContext' in window)) return false;
  const c = navigator.connection;
  if (c?.saveData || /(^|-)2g$/.test(c?.effectiveType ?? '')) return false;
  if (navigator.deviceMemory && navigator.deviceMemory < 2) return false;
  return true;
}

const tierFor = () => (matchMedia('(max-width: 639px), (pointer: coarse)').matches ? 'mobile' : 'desktop');
const whenIdle = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 300));

async function boot(stage) {
  const ui = bindStageUI(stage);
  ui.loading();
  const handle = await attachRenderer(stage, async (canvasEl, { reducedMotion }) => {
    const { createViewer } = await import('./viewer/viewer.js');
    return createViewer(canvasEl, {
      stage, reducedMotion, tier: tierFor(),
      manifestUrl: stage.dataset.vehicleModel,
      onProgress: ui.progress,
    });
  });
  if (handle) { ui.live(handle); stage.vehicle = handle; linkBackgroundLight(stage, handle); }
  else ui.failed();
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
    if (moving && !pausedByVisitor()) ctl.resume();
    else ctl.pause();
  };
  handle.onActivity((on) => {
    clearTimeout(timer);
    if (on) { moving = true; apply(); }
    else timer = setTimeout(() => { moving = false; apply(); }, LIGHT_REST_MS);
  });
  new MutationObserver(apply).observe(light, { attributes: true, attributeFilter: ['data-fx-mounted'] });
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
