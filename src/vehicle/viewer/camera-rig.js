// The camera rig: orbit controls with the manifest's limits, framing that fits any car to the canvas,
// eased view presets and zoom steps, keyboard control and a touch gesture that shares the page.
//
// Input, by device:
//   mouse     drag orbits (sideways freely, up and down within the polar limits); the wheel always
//             scrolls the page and never zooms. Zoom is the + and - buttons (or the + and - keys).
//   touch     the canvas is `touch-action: pan-y`: a vertical swipe belongs to the browser and scrolls
//             the page; a sideways swipe turns the car (heading only, so it never fights the scroll).
//             The camera's height on touch comes from the Front / Side / Rear views. A two-finger pinch
//             zooms within the same limits.
//   keyboard  arrows turn and tilt, + and - zoom, Home resets.
//
// Three modes. 'orbit' is all of the above. 'story' hands the camera to the page's scroll: every input
// above is ignored and only pose() places the camera (src/story/story.js). 'turn' is the story's hands-on
// chapter (Chapter V): a drag, a sideways swipe or the arrow keys turn the car, and the story may turn it
// too (turnBy); the camera's height and distance stay where the chapter's pose put them, so the chapter's
// framing (the car clear of its words) holds at every angle. No zoom, no tilt. snapshot() and restore()
// carry the orbit camera across a stretch of story untouched.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const DEG = Math.PI / 180;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const NO_GESTURE = -1; // an OrbitControls touch slot with no action: the rig's own handler takes one finger

export function createRig({ camera, canvas, stage, box, config, reducedMotion, onChange }) {
  const size = box.getSize(new THREE.Vector3());
  const homeTarget = [0, config.targetHeight ?? 0.4, 0];
  // a look-at point given as fractions of the car's box: x and z from its centre (-0.5..0.5), y from the
  // ground (0..1). The model is centred on the origin with its wheels on y = 0 (model.js).
  const targetAt = ([fx, fy, fz], out = new THREE.Vector3()) => out.set(fx * size.x, fy * size.y, fz * size.z);
  const target = targetAt(homeTarget);
  let mode = 'orbit';
  const limits = { polarMin: 58, polarMax: 86, zoomMin: 0.8, zoomMax: 1.6, ...config.limits };
  const views = { home: config.home, ...config.views };

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.enablePan = false;
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.6;
  controls.minPolarAngle = limits.polarMin * DEG;
  controls.maxPolarAngle = limits.polarMax * DEG;
  controls.enableZoom = false; // the wheel scrolls the page; a pinch turns zoom on for its own gesture
  controls.touches = { ONE: NO_GESTURE, TWO: THREE.TOUCH.DOLLY_PAN };
  // OrbitControls sets `touch-action: none` on connect, which would trap every swipe that starts on the
  // car. pan-y on every device (a mouse never reads it) hands vertical swipes back to the page.
  canvas.style.touchAction = 'pan-y';

  // ---- framing: the car (seen from `home`) fills `fill` of the canvas; zoom limits are multiples of it
  let fitDistance = 1;
  const corners = [...Array(8)].map((_, i) => new THREE.Vector3(
    i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
  function computeFit(aspect) {
    const dir = new THREE.Vector3().setFromSphericalCoords(1, views.home.polar * DEG, views.home.azimuth * DEG);
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const tanV = Math.tan((camera.fov * DEG) / 2) * (config.fill ?? 0.84);
    const tanH = tanV * aspect;
    let d = 0;
    for (const c of corners) {
      const p = c.clone().sub(target);
      const depth = p.dot(dir);
      d = Math.max(d, depth + Math.abs(p.dot(right)) / tanH, depth + Math.abs(p.dot(up)) / tanV);
    }
    return d;
  }
  // the visitor's limits (manifest camera.limits) hold in orbit mode; the story frames its own shots, so
  // in story mode they are opened (OrbitControls.update() would otherwise clamp every pose to them)
  let lock = null; // turn mode: the polar angle and the zoom (a multiple of fitDistance) it holds
  function applyLimits() {
    if (mode === 'turn' && lock) {
      controls.minPolarAngle = controls.maxPolarAngle = lock.phi;
      controls.minDistance = controls.maxDistance = fitDistance * lock.zoom;
      return;
    }
    const story = mode === 'story';
    controls.minPolarAngle = (story ? 1 : limits.polarMin) * DEG;
    controls.maxPolarAngle = (story ? 179 : limits.polarMax) * DEG;
    controls.minDistance = fitDistance * (story ? 0.05 : limits.zoomMin);
    controls.maxDistance = fitDistance * (story ? 20 : limits.zoomMax);
  }
  function resize(aspect) {
    const ratio = camera.position.distanceTo(controls.target) / fitDistance;
    fitDistance = computeFit(aspect);
    applyLimits();
    place(spherical(), fitDistance * (mode !== 'orbit' ? ratio : THREE.MathUtils.clamp(ratio, limits.zoomMin, limits.zoomMax)));
  }

  const spherical = () => new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  function place(s, radius = s.radius) {
    camera.position.setFromSphericalCoords(radius, s.phi, s.theta).add(controls.target);
    camera.lookAt(controls.target);
    controls.update();
    emitZoom();
  }

  // ---- listeners the UI subscribes to
  const viewListeners = new Set();
  const zoomListeners = new Set();
  let activeView = 'home';
  const setActive = (name) => { activeView = name; viewListeners.forEach((f) => f(name)); };
  let lastZoom = '';
  function emitZoom() {
    const r = camera.position.distanceTo(controls.target);
    const state = { canIn: r > controls.minDistance * 1.002, canOut: r < controls.maxDistance * 0.998 };
    const key = `${state.canIn}${state.canOut}`;
    if (key !== lastZoom) { lastZoom = key; zoomListeners.forEach((f) => f(state)); }
  }

  // ---- eased moves (views, zoom steps); reduced motion jumps there
  let tween = null;
  function tweenTo({ theta, phi, radius }, dur) {
    const from = spherical();
    const dTheta = theta === undefined ? 0
      : ((theta - from.theta + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; // shortest way round
    tween = {
      t0: performance.now(), dur: reducedMotion ? 0 : dur,
      from: { theta: from.theta, phi: from.phi, r: from.radius },
      delta: {
        theta: dTheta,
        phi: phi === undefined ? 0 : THREE.MathUtils.clamp(phi, controls.minPolarAngle, controls.maxPolarAngle) - from.phi,
        r: radius === undefined ? 0 : THREE.MathUtils.clamp(radius, controls.minDistance, controls.maxDistance) - from.radius,
      },
    };
    onChange();
  }
  function step(now) {
    if (!tween) return false;
    const k = tween.dur ? Math.min(1, (now - tween.t0) / tween.dur) : 1;
    const e = ease(k);
    place(new THREE.Spherical(tween.from.r + tween.delta.r * e, tween.from.phi + tween.delta.phi * e, tween.from.theta + tween.delta.theta * e));
    if (k >= 1) tween = null;
    return true;
  }
  function setView(name) {
    const v = views[name];
    if (!v || mode !== 'orbit') return;
    spin = 0;
    tweenTo({ theta: v.azimuth * DEG, phi: v.polar * DEG, radius: fitDistance }, 1100); // every view returns to 1x zoom
    setActive(name);
  }
  function zoomBy(factor) {
    if (mode !== 'orbit') return;
    const base = tween && tween.delta.r ? tween.from.r + tween.delta.r : camera.position.distanceTo(controls.target);
    tweenTo({ radius: base * factor }, 420);
  }

  // ---- mouse: OrbitControls drags; a drag cancels a running move and clears the pressed view
  controls.addEventListener('start', () => { tween = null; spin = 0; setActive(null); });
  controls.addEventListener('change', onChange);
  // the wheel never zooms (it scrolls the page); only a pinch, which starts with a touch, may
  const onWheelCapture = () => { controls.enableZoom = false; };
  stage.addEventListener('wheel', onWheelCapture, { capture: true, passive: true });

  // ---- touch: one finger turns the car sideways; the browser keeps vertical swipes (pan-y)
  let touch = null;
  let spin = 0; // radians per frame, for a short coast after the finger lifts
  const fingers = new Set();
  function turn(angle) {
    const s = spherical();
    s.theta += angle;
    place(s);
  }
  const onTouchDown = (e) => {
    if (e.pointerType !== 'touch' || mode === 'story') return;
    fingers.add(e.pointerId);
    controls.enableZoom = mode === 'orbit'; // pinch (turn mode: none)
    if (fingers.size > 1) { touch = null; spin = 0; return; } // two fingers: the pinch is OrbitControls'
    touch = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, locked: false };
    tween = null; spin = 0;
  };
  const onTouchMove = (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    // direction lock: nothing turns until the finger has clearly gone sideways; a swipe that starts
    // vertical is left to the page for its whole length
    if (!touch.locked) {
      const ax = Math.abs(e.clientX - touch.x0), ay = Math.abs(e.clientY - touch.y0);
      if (ax < 8 && ay < 8) return;
      if (ay >= ax) { touch = null; return; }
      touch.locked = true;
    }
    const dx = e.clientX - touch.x;
    touch.x = e.clientX;
    if (!dx) return;
    const angle = (-2 * Math.PI * dx / canvas.clientHeight) * 0.6;
    turn(angle);
    spin = reducedMotion ? 0 : spin * 0.6 + angle * 0.4; // smoothed release speed, for a short coast
    if (activeView) setActive(null);
    onChange();
  };
  const onTouchEnd = (e) => {
    fingers.delete(e.pointerId);
    if (touch && e.pointerId === touch.id) { touch = null; if (e.type === 'pointercancel') spin = 0; onChange(); }
  };
  canvas.addEventListener('pointerdown', onTouchDown);
  canvas.addEventListener('pointermove', onTouchMove);
  canvas.addEventListener('pointerup', onTouchEnd);
  canvas.addEventListener('pointercancel', onTouchEnd);

  // ---- keyboard: arrows turn and tilt, +/- zoom, Home resets
  function nudge(dTheta, dPhi) {
    tween = null; spin = 0;
    const s = spherical();
    s.theta += dTheta * DEG;
    s.phi = THREE.MathUtils.clamp(s.phi + dPhi * DEG, controls.minPolarAngle, controls.maxPolarAngle);
    place(s);
    setActive(null);
    onChange();
  }
  const onKey = (e) => {
    if (mode === 'story') return;
    const k = e.key;
    if (k === 'ArrowLeft') nudge(-15, 0);
    else if (k === 'ArrowRight') nudge(15, 0);
    else if (k === 'ArrowUp') nudge(0, -5);
    else if (k === 'ArrowDown') nudge(0, 5);
    else if (mode === 'turn' && (k === 'ArrowUp' || k === 'ArrowDown')) return; // no tilt: the page scrolls
    else if (k === '+' || k === '=') zoomBy(0.85);
    else if (k === '-' || k === '_') zoomBy(1 / 0.85);
    else if (k === 'Home') setView('home');
    else return;
    e.preventDefault();
  };
  canvas.addEventListener('keydown', onKey);

  // ---- story: the camera placed from the page's scroll position, never from a clock
  // A shot is { azimuth, polar (degrees), zoom (a multiple of the fit distance), target? ([fx, fy, fz]) }.
  // pose(a, b, t) places the camera t (0..1, already eased by the caller) of the way from shot a to shot b:
  // the heading the shortest way round, the look-at point and the distance in a straight line. It is
  // drawn only when the pose actually changes, so a scroll that holds still draws nothing.
  const tA = new THREE.Vector3(), tB = new THREE.Vector3();
  let lastPose = '';
  function pose(a, b = a, t = 0) {
    const k = THREE.MathUtils.clamp(t, 0, 1);
    const az0 = a.azimuth * DEG;
    const dAz = ((b.azimuth * DEG - az0 + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const theta = az0 + dAz * k;
    const phi = THREE.MathUtils.lerp(a.polar, b.polar, k) * DEG;
    const zoom = THREE.MathUtils.lerp(a.zoom ?? 1, b.zoom ?? 1, k);
    targetAt(a.target ?? homeTarget, tA);
    targetAt(b.target ?? homeTarget, tB);
    tA.lerp(tB, k);
    const key = `${theta.toFixed(4)} ${phi.toFixed(4)} ${zoom.toFixed(4)} ${tA.x.toFixed(4)} ${tA.y.toFixed(4)} ${tA.z.toFixed(4)} ${fitDistance.toFixed(4)}`;
    if (key === lastPose) return false;
    lastPose = key;
    tween = null; spin = 0;
    controls.target.copy(tA);
    place(new THREE.Spherical(fitDistance * zoom, phi, theta));
    onChange();
    return true;
  }
  // puts another camera (a clone, for fitting: fit.js) where pose() would put this one for a shot,
  // without moving this one or drawing anything
  const tP = new THREE.Vector3();
  function placeAt(cam, shot) {
    targetAt(shot.target ?? homeTarget, tP);
    cam.position.setFromSphericalCoords(fitDistance * (shot.zoom ?? 1), shot.polar * DEG, shot.azimuth * DEG).add(tP);
    cam.lookAt(tP);
    cam.updateMatrixWorld(true);
  }
  function setMode(next) {
    if (next === mode) return;
    mode = next;
    tween = null; spin = 0; touch = null;
    controls.enabled = mode !== 'story';
    controls.enableZoom = false;
    // turn mode is inside the story's stage, which is hidden from assistive tech: no tab stop there
    canvas.tabIndex = mode === 'orbit' ? 0 : -1;
    // turn mode holds the height and distance the last pose left
    if (mode === 'turn') { const s = spherical(); lock = { phi: s.phi, zoom: s.radius / fitDistance }; } else lock = null;
    applyLimits();
    lastPose = '';
  }
  // turn mode: the story turns the car by an angle on top of where the visitor's hand left it. Applied to
  // the camera as it stands, so it adds to a drag (and its damping) instead of replacing it.
  function turnBy(angle) {
    if (mode !== 'turn') return;
    turn(angle);
    onChange();
  }
  // the orbit camera as it stands (or where its running move will end), to put back after the story
  function snapshot() {
    const s = spherical();
    if (tween) { s.theta = tween.from.theta + tween.delta.theta; s.phi = tween.from.phi + tween.delta.phi; s.radius = tween.from.r + tween.delta.r; }
    return { theta: s.theta, phi: s.phi, zoom: s.radius / fitDistance, target: controls.target.clone(), view: activeView };
  }
  function restore(snap) {
    if (!snap) return;
    tween = null; spin = 0;
    controls.target.copy(snap.target);
    place(new THREE.Spherical(fitDistance * snap.zoom, snap.phi, snap.theta));
    setActive(snap.view);
    onChange();
  }

  // start at home
  place(new THREE.Spherical(1, views.home.polar * DEG, views.home.azimuth * DEG));

  return {
    controls, resize, setView, zoomBy, pose, setMode, snapshot, restore, turnBy, placeAt,
    get fitDistance() { return fitDistance; },
    get mode() { return mode; },
    reset: () => setView('home'),
    get view() { return activeView; },
    onView: (f) => viewListeners.add(f),
    onZoom: (f) => { zoomListeners.add(f); lastZoom = ''; emitZoom(); },
    azimuth: () => spherical().theta,
    update(now) {
      const moving = step(now);
      let coasting = false;
      if (!touch && Math.abs(spin) > 1e-4) { turn(spin); spin *= 0.85; coasting = true; }
      return controls.update() || moving || coasting;
    },
    dispose() {
      stage.removeEventListener('wheel', onWheelCapture, { capture: true });
      canvas.removeEventListener('pointerdown', onTouchDown);
      canvas.removeEventListener('pointermove', onTouchMove);
      canvas.removeEventListener('pointerup', onTouchEnd);
      canvas.removeEventListener('pointercancel', onTouchEnd);
      canvas.removeEventListener('keydown', onKey);
      controls.dispose();
    },
  };
}
