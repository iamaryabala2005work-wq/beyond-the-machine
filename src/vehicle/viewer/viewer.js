// The 3D vehicle viewer. Mounted by stage.js into the hero's [data-vehicle-canvas] through the renderer
// contract ({ ready, destroy }), so the hero's markup, rings and HUD stay as they are.
//
// Model-agnostic: everything about the car (file, orientation, hidden parts, finishes, views, limits)
// comes from its manifest.json. Rendering is on demand: a frame is drawn only while something moves
// (a drag, damping, a preset, the light easing), and never while the hero is off screen.
import * as THREE from 'three';
import { loadManifest, loadModel, disposeObject } from './model.js';
import { createRig } from './camera-rig.js';
import { createLighting } from './lighting.js';
import { MOBILE_QUALITY, qualityLevels, createGovernor } from './quality.js';

const MAX_ANISOTROPY = 8;

export function createViewer(host, { stage, manifestUrl, tier, reducedMotion, onProgress }) {
  const mobile = tier === 'mobile';
  // Pixel ratio. Desktop: the device's, at most 2. Mobile: at most 2 (never above the device's own), held
  // between 2 and 1.5 by the governor (quality.js); a device that reports under 4 GB of memory starts at
  // the floor and climbs only when it proves calm.
  const levels = mobile ? qualityLevels(devicePixelRatio || 1, MOBILE_QUALITY) : null;
  const gov = mobile ? createGovernor({ levels, start: navigator.deviceMemory && navigator.deviceMemory < 4 ? levels.length - 1 : 0 }) : null;
  let dpr = mobile ? gov.dpr : Math.min(devicePixelRatio || 1, 2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = 'vehicle-stage__gl';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  host.append(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 2, 0.05, 200);

  let rig, lighting, model, manifest = null, raf = 0, visible = true, destroyed = false, offsetY = 0, offsetYCompact = 0;
  let frameShift = null; // the story's own vertical framing (a fraction of the height), or null for the manifest's
  let frameShiftX = 0;   // and its horizontal framing (a fraction of the width; positive moves the car right)
  const wide = matchMedia('(min-width: 1024px)');
  const accent = getComputedStyle(stage).getPropertyValue('--optic').trim() || '#7fe0ee';

  // ---- activity: true from the first frame of a movement until the car comes to rest. stage.js uses it
  // to let the hero's background light move only while the car does.
  let active = false;
  const activityListeners = new Set();
  function setActive(on) {
    if (on === active) return;
    active = on;
    activityListeners.forEach((f) => f(on));
  }

  // ---- draw loop: on demand
  const invalidate = () => {
    if (raf || !visible || destroyed || contextLost) return;
    raf = requestAnimationFrame(frame);
    setActive(true);
  };
  let slow = 0, samples = 0, last = 0, renders = 0;
  let gpuTimer = mobile ? createGpuTimer(renderer.getContext()) : null;

  // ---- WebGL context loss: a driver reset, or the browser reclaiming the GPU (often a phone with the tab
  // in the background). three.js stops drawing on loss and, on restore, rebuilds its own state and
  // re-uploads meshes and textures from their CPU copies. The viewer adds the rest: no frames while lost,
  // and listeners told at once (stage.js shows the poster again). On restore it remakes the room
  // reflection and the GPU timer, draws one frame, and only then tells the listeners the car is back.
  let contextLost = false, contextGen = 0;
  const contextListeners = new Set();
  const emitContext = () => contextListeners.forEach((f) => f(contextLost));
  function onContextLost(e) {
    e.preventDefault(); // without this the browser never offers the context back
    if (contextLost || destroyed) return;
    contextLost = true;
    contextGen++;
    cancelAnimationFrame(raf); raf = 0;
    cancelAnimationFrame(probing); probing = 0;
    gpuTimer?.dispose(); gpuTimer = null; // its queries belonged to the lost context
    last = 0;
    setActive(false);
    emitContext();
  }
  function onContextRestored() {
    if (!contextLost || destroyed) return;
    const gen = contextGen;
    // three.js's own restore listener has already run (it was added when the renderer was made)
    if (rig) {
      try {
        lighting.rebuild();
        if (mobile) gpuTimer = createGpuTimer(renderer.getContext());
        // a plain render compiles the shaders in place, a moment's work hidden behind the poster
        // (compileAsync would poll forever if the context were lost again meanwhile)
        lighting.update(rig.azimuth());
        renderer.render(scene, camera);
      } catch (err) {
        console.warn('[vehicle-viewer] could not restore the WebGL context; keeping the poster', err);
        return;
      }
    }
    if (gen !== contextGen || renderer.getContext().isContextLost()) return; // lost again meanwhile
    contextLost = false;
    emitContext();
    if (rig && mobile) probeCadence();
  }
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  function frame(now) {
    raf = 0;
    if (!rig) { setActive(false); return; }
    renders++;
    const moving = rig.update(now);
    const lit = lighting.update(rig.azimuth());
    if (!mobile) {
      renderer.render(scene, camera);
      adapt(now);
    } else {
      const timed = gpuTimer?.begin();
      const t0 = performance.now();
      renderer.render(scene, camera);
      const cpuMs = performance.now() - t0;
      if (timed) gpuTimer.end();
      adaptMobile(now, cpuMs);
    }
    if (moving || lit) invalidate();
    else {
      setActive(false);
      if (mobile) rest();
    }
  }

  // ---- mobile: the governor (quality.js) judges the render's own cost and dropped vsyncs, not the fps
  function adaptMobile(now, cpuMs) {
    const gap = last ? now - last : Infinity;
    last = now;
    const gpuMs = gpuTimer?.poll() ?? undefined;
    if (gov.sample({ intervalMs: gap < gov.maxGap ? gap : undefined, cpuMs, gpuMs })) applyDpr();
  }
  function applyDpr() {
    if (gov.dpr === dpr) return;
    dpr = gov.dpr;
    renderer.setPixelRatio(dpr);
    resize();
  }
  // the car came to rest: a step up waits for this moment (a resize mid-drag would hitch), and the frame
  // clock is measured again when the governor needs it or the last measurement is old
  function rest() {
    last = 0;
    if (gov.atRest()) applyDpr();
    if (gov.probeDue(performance.now())) probeCadence();
  }
  // the display's frame clock: the median gap between empty animation frames, nothing drawn. Abandoned
  // (and retried at the next rest) if the car starts moving or the page is hidden meanwhile.
  let probing = 0;
  function probeCadence() {
    if (probing || destroyed || !visible) return;
    const startRenders = renders;
    const ticks = [];
    const tick = (t) => {
      if (destroyed || renders !== startRenders || !visible) { probing = 0; return; }
      ticks.push(t);
      if (ticks.length < 10) { probing = requestAnimationFrame(tick); return; }
      probing = 0;
      const gaps = ticks.slice(1).map((v, k) => v - ticks[k]).sort((a, b) => a - b);
      if (gaps[gaps.length - 1] > 250) return; // a stall or a background pause, not the clock
      if (gov.probed(gaps[gaps.length >> 1], performance.now())) applyDpr();
    };
    probing = requestAnimationFrame(tick);
  }

  // ---- desktop: adaptive resolution as before: if frames run long while moving, step the pixel ratio
  // down (never below 1)
  function adapt(now) {
    if (last && now - last < 100) {
      samples++;
      if (now - last > 26) slow++;
      if (samples >= 40) {
        if (slow / samples > 0.5 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); renderer.setPixelRatio(dpr); resize(); }
        samples = slow = 0;
      }
    }
    last = now;
  }

  // ---- size: follows the stage (ResizeObserver), keeps the user's zoom
  // The drawing buffer is only resized when the size or the pixel ratio actually changed: assigning a
  // canvas its width, even the same one, reallocates and clears it, and a resize also runs for a change
  // of framing alone (setFrameShift) and for the ResizeObserver's echo after the story moves the canvas.
  let sizeKey = '';
  function resize() {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    const key = `${w}x${h}@${renderer.getPixelRatio()}`;
    if (key !== sizeKey) { sizeKey = key; renderer.setSize(w, h, false); }
    camera.aspect = w / h;
    // shift the car in the frame (manifest camera.offsetY, a fraction of the height; negative lifts it).
    // From 1024px the view controls sit under the car, so it is lifted clear of them; below that they sit
    // at the top of the stage and the car keeps offsetYCompact, settled on the rings.
    const shift = frameShift ?? (wide.matches ? offsetY : offsetYCompact);
    camera.setViewOffset(w, h, -w * frameShiftX, -h * shift, w, h);
    camera.updateProjectionMatrix();
    rig?.resize(camera.aspect);
    invalidate();
  }
  const ro = new ResizeObserver(resize);

  // ---- visibility: no frames off screen or in a background tab. It watches the canvas's own slot, which
  // the story moves out of the hero and back (src/story/story.js), so frames follow the car, not the hero.
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) invalidate(); });
  const onVis = () => { visible = !document.hidden; if (visible) invalidate(); };

  // ---- pointer light (fine pointers only; touch has no hover)
  const onMove = (e) => {
    if (e.pointerType !== 'mouse' || !lighting) return;
    const r = stage.getBoundingClientRect();
    if (lighting.setPointer((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)) invalidate();
  };
  const onLeave = () => { if (lighting?.release()) invalidate(); };

  const ready = (async () => {
    manifest = await loadManifest(manifestUrl);
    const cam = manifest.camera ?? {};
    camera.fov = cam.fov ?? 26;
    offsetY = cam.offsetY ?? 0;
    offsetYCompact = cam.offsetYCompact ?? offsetY;
    canvas.setAttribute('aria-label', `Interactive 3D model${manifest.standIn ? ' (a stand-in concept car, not the Jesko Absolut)' : ''}. Drag, swipe sideways or use the arrow keys to turn it; plus and minus zoom.`);

    model = await loadModel(manifest, tier, onProgress, { anisotropy: anisotropy() });
    if (destroyed) { disposeObject(model.root); return; }
    scene.add(model.root);

    lighting = createLighting({ scene, renderer, box: model.box, accent, reducedMotion });
    rig = createRig({ camera, canvas, stage, box: model.box, config: cam, reducedMotion, onChange: invalidate });

    resize();
    ro.observe(host);
    io.observe(host);
    document.addEventListener('visibilitychange', onVis);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerleave', onLeave);

    // compile shaders before the first frame, so the hand-off from the poster has no stall
    await compileShaders();
    lighting.update(rig.azimuth());
    renderer.render(scene, camera);
    if (mobile) probeCadence();
    return { manifest };
  })();

  // renderer.compileAsync() with a way out: three.js polls every 10 ms until each shader reports ready,
  // and with the context lost meanwhile that report never comes, so its poll never ends and the load
  // hangs. Same check here, but it stops (and the load fails, so stage.js can retry) once the viewer is
  // destroyed or the context is lost.
  async function compileShaders() {
    const pending = renderer.compile(scene, camera);
    while (pending.size) {
      if (destroyed || contextLost) throw new Error('shader compile stopped: viewer destroyed or WebGL context lost');
      for (const m of pending) if (renderer.properties.get(m).currentProgram?.isReady()) pending.delete(m);
      if (pending.size) await new Promise((r) => setTimeout(r, 10));
    }
  }

  // texture filtering at glancing angles: 8x, or the GPU's maximum if lower
  function anisotropy() { return Math.min(MAX_ANISOTROPY, renderer.capabilities.getMaxAnisotropy() || 1); }

  // a read-only snapshot of the render quality, for testing on a device (Web Inspector / remote debugging):
  //   document.querySelector('[data-vehicle-stage]').vehicle.quality()
  function quality() {
    const gl = renderer.getContext();
    return {
      tier,
      contextLost,
      devicePixelRatio,
      pixelRatio: renderer.getPixelRatio(),
      levels: levels ?? [Math.min(devicePixelRatio || 1, 2)],
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      cssSize: [canvas.clientWidth, canvas.clientHeight],
      antialias: gl.getContextAttributes()?.antialias, // null while the context is lost
      msaaSamples: gl.getParameter(gl.SAMPLES),
      anisotropy: anisotropy(),
      gpuTimer: Boolean(gpuTimer),
      cadenceMs: gov ? Math.round(gov.cadence * 10) / 10 : undefined,
      budgetMs: gov ? Math.round(gov.budget * 10) / 10 : undefined,
      changes: gov ? gov.log : [],
    };
  }

  return {
    ready,
    canvas,
    setView: (name) => rig?.setView(name),
    reset: () => rig?.reset(),
    onView: (f) => rig?.onView(f),
    zoomBy: (factor) => rig?.zoomBy(factor),
    // the camera's heading in radians (read-only; later phases and tests use it)
    azimuth: () => rig?.azimuth(),
    onZoom: (f) => rig?.onZoom(f),
    // ---- story (src/story/story.js): the camera follows the page's scroll instead of the visitor's hand
    // a named shot from the manifest (camera.shots), with its "compact" overrides on a phone-sized screen;
    // a shot the manifest lacks falls back to home, so an older manifest still runs the story
    shot(name) {
      const cam = manifest?.camera ?? {};
      const s = cam.shots?.[name] ?? cam.home ?? { azimuth: 0, polar: 75 };
      const compact = matchMedia('(max-width: 639px)').matches;
      const { compact: small, ...base } = s;
      return compact && small ? { ...base, ...small } : base;
    },
    pose: (a, b, t) => rig?.pose(a, b, t) ?? false,
    setMode: (m) => rig?.setMode(m),
    snapshot: () => rig?.snapshot(),
    restore: (snap) => rig?.restore(snap),
    // dims the studio light for the story (1 = the hero's)
    setKey(level) { if (lighting?.setKey(level)) invalidate(); },
    // shifts the car in the frame for the story: y a fraction of the height (negative lifts it, null = the
    // manifest's), x a fraction of the width (positive moves it right)
    setFrameShift(v, x = 0) { if (frameShift === v && frameShiftX === x) return; frameShift = v; frameShiftX = x; resize(); },
    // the story's silhouette light, 0..1: a cool rim along the roofline and a soft glow on the floor (0 = off, as in the hero)
    setSilhouette(level) { if (lighting?.setSilhouette(level)) invalidate(); },
    // f(true) when the car starts moving, f(false) when it comes to rest; called once at once with the
    // current state. Returns a function that unsubscribes.
    onActivity: (f) => { activityListeners.add(f); f(active); return () => activityListeners.delete(f); },
    // f(true) when the WebGL context is lost, f(false) once it is restored and a frame is drawn; called
    // at once if it is lost already. Returns a function that unsubscribes.
    onContextChange: (f) => { contextListeners.add(f); if (contextLost) f(true); return () => contextListeners.delete(f); },
    quality,
    destroy() {
      setActive(false);
      activityListeners.clear();
      contextListeners.clear();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      destroyed = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(probing);
      gpuTimer?.dispose();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', onLeave);
      rig?.dispose();
      lighting?.dispose();
      if (model) disposeObject(model.root);
      renderer.dispose();
      // free the GPU context now rather than at garbage collection: a failed load is retried with a
      // new viewer, and browsers cap how many contexts a page may hold
      if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

// GPU time of a frame, where the browser exposes it (EXT_disjoint_timer_query_webgl2: some Android and
// desktop browsers; not Safari). Results arrive a frame or more later; a disjoint period (the GPU was
// interrupted) discards them. Without it the governor reads the CPU time and dropped vsyncs instead.
function createGpuTimer(gl) {
  const ext = gl.getExtension?.('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;
  const pending = [];
  let active = null;
  return {
    begin() {
      if (active || pending.length > 4) return false;
      active = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
      return true;
    },
    end() {
      if (!active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    poll() {
      let ms;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = pending.shift();
        if (!disjoint) ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(q);
      }
      return ms;
    },
    dispose() { for (const q of pending) gl.deleteQuery(q); pending.length = 0; },
  };
}
