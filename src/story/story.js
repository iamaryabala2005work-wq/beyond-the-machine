// The story: full-screen chapters over one pinned stage (index.html #story, src/styles/story.css).
//
// Scroll is always the browser's. Nothing here prevents a wheel or a touch, snaps or locks the page, and
// the page itself is never smoothed; it only reads where the page is and places things to match. One
// passive scroll listener and one animation frame per scroll frame. Chapter offsets are measured on
// resize, never during a scroll, so a scroll frame reads scrollY and does no layout work.
//
// The car: the hero's live 3D canvas (src/vehicle) is the only one. Once the hero's car has scrolled out
// of sight (the hero's canvas area above the screen, or the story's top reached, whichever is first), the
// canvas's slot moves into the story's stage and the camera switches to story mode: the chapters place it
// from their progress. Scrolling back moves the slot home and puts the hero's camera back exactly as the
// visitor left it. Moving a canvas keeps its WebGL context, so the page never holds a second one. While
// the story has the car, the hero's background light holds still (stage.js).
//
// Each chapter's progress p runs 0..1 while its frame is pinned, and its entry e runs 0..1 while it rises
// into the screen. Both are written to the chapter (--p, --e: the CSS reveals read them) and p is handed
// to the chapter's script for what CSS cannot do (a count, the camera).
//
// The stage is never empty. Until the live car is shown there, it shows stills of the chapter's car
// (scripts/render-posters.mjs), framed and lit as the chapter frames and lights it. When the canvas moves
// in, it stays hidden ("entering") until it has drawn the chapter's pose at its new size, then fades in
// over the stills: whatever angle the visitor left the hero's car at, the change of pose is never seen.
//
// What the chapter does with the car (its camera() hook: in Chapter III the light) follows p through a
// critically damped spring (SMOOTH): it eases toward where the scroll is instead of jumping with every
// scroll step, never overshoots, and stops (no more frames) once it has settled. The scroll and the words
// follow the finger 1:1. The level the chapter reports (its level() hook) is written to the stage as
// --lp, so the stills follow the same reveal.
//
// Reduced motion: nothing is scrubbed or smoothed. The camera cuts to a chapter's shot once its p passes
// 0.15, the words fade in over 150 ms at their thresholds, and numbers show their final value.
import { createPower } from './chapters/power.js';

const CHAPTERS = { power: createPower };
const CUT_AT = 0.15;      // reduced motion: where a chapter's shot replaces the one before it
const LEAVE_SLACK = 24;   // px above the handoff point before the car goes back to the hero (no flicker at the edge)
const SMOOTH = 0.16;      // s: the camera spring's smoothing time (critically damped; ~95% there in 3x this)
const SETTLED = 1e-4;     // the spring stops when it is this close to the scroll, and this slow (per s)

export function initStory() {
  const story = document.querySelector('[data-story]');
  const stageEl = story?.querySelector('[data-story-stage]');
  const slot = story?.querySelector('[data-story-canvas]');
  const hero = document.querySelector('[data-vehicle-stage]');
  if (!story || !stageEl || !slot) return;

  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reducedQuery.matches;
  const chapters = [...story.querySelectorAll('[data-chapter]')]
    .map((el) => {
      const make = CHAPTERS[el.dataset.chapter];
      return make ? { el, frame: el.querySelector('.chapter__frame') ?? el, top: 0, span: 1, p: -1, impl: make(el) } : null;
    })
    .filter(Boolean);
  if (!chapters.length) return;
  story.dataset.storyReady = '';
  const standinTag = stageEl.querySelector('[data-story-standin]');

  // ---- the car, borrowed from the hero once it is live
  let viewer = null;         // the hero's handle (stage.js), null while there is no live 3D
  let host = null;           // the canvas's slot element, moved between the hero and the story
  let homeMarker = null;     // where the slot goes back to in the hero
  let inStory = false;
  let snap = null;           // the hero's camera, kept while the story has the car
  let lost = false;          // the WebGL context is lost: the poster stands in
  let standIn = false;
  let lastShot = null;       // reduced motion: the shot the camera last cut to
  let ticking = 0;
  let needMeasure = true;
  // the camera spring: where the camera is (in p), its speed, and the frame time it last stepped at
  let camP = -1, camV = 0, camAt = 0, camChapter = null;
  let shown = false;         // the live canvas has drawn the chapter's pose and is shown
  let lastLp = '';

  function setState() {
    const state = !viewer || lost ? 'poster' : !inStory ? 'waiting' : shown ? 'live' : 'entering';
    if (stageEl.dataset.state !== state) stageEl.dataset.state = state;
    if (standinTag) standinTag.hidden = !(state === 'live' && standIn);
  }

  function adopt(handle) {
    if (viewer || !hero) return;
    viewer = handle;
    host = hero.querySelector('[data-vehicle-canvas]');
    if (!host) { viewer = null; return; }
    homeMarker = document.createComment(' the 3D canvas returns here from the story ');
    host.before(homeMarker);
    handle.ready.then((info) => { standIn = Boolean(info?.manifest?.standIn); setState(); });
    handle.onContextChange?.((isLost) => { lost = isLost; setState(); });
    setState();
    schedule(true);
  }
  if (hero?.vehicle) adopt(hero.vehicle);
  hero?.addEventListener('vehicle:live', (e) => adopt(e.detail));

  function enter() {
    inStory = true;
    snap = viewer.snapshot();
    viewer.setMode('story');
    slot.append(host);
    hero.dataset.vehicleStory = '';
    lastShot = null;
    camP = -1; // the camera starts where the scroll is, not eased in from elsewhere
    shown = false;
    setState();
    // the canvas is shown once it has drawn the chapter's pose at its new size: the pose is set in this
    // frame (tick), the new size is taken in the next (viewer.js), the frame after draws both
    let frames = 0;
    const wait = () => {
      if (!inStory) return;
      if (++frames < 4) { requestAnimationFrame(wait); return; }
      shown = true;
      setState();
    };
    requestAnimationFrame(wait);
  }
  function leave() {
    inStory = false;
    shown = false;
    lastLp = ''; // the stills are back: bring their light level up to date
    homeMarker.after(host);
    viewer.setFrameShift(null);
    viewer.setKey(1);
    viewer.setSilhouette(0);
    viewer.setMode('orbit');
    viewer.restore(snap);
    snap = null;
    delete hero.dataset.vehicleStory;
    setState();
  }

  // ---- measuring (on resize only)
  let storyTop = 0;
  let handoff = 0;   // the scroll position where the car moves into the story
  let vh = 1;
  function measure() {
    const y = scrollY;
    vh = Math.max(1, innerHeight);
    storyTop = story.getBoundingClientRect().top + y;
    // the hero's car is out of sight once the box that holds its canvas has left the top of the screen
    const home = homeMarker?.parentElement;
    const heroGone = home ? home.getBoundingClientRect().bottom + y : storyTop;
    handoff = Math.min(storyTop, Math.max(0, heroGone));
    for (const c of chapters) {
      const r = c.el.getBoundingClientRect();
      c.top = r.top + y;
      c.span = Math.max(1, c.el.offsetHeight - c.frame.offsetHeight); // the scroll distance the frame stays pinned
      c.p = -1; // force a fresh update
      c.e = -1;
    }
  }

  // one step of a critically damped spring toward target (the closed form, stable at any frame time)
  function spring(target, now) {
    const dt = Math.min(0.1, camAt ? (now - camAt) / 1000 : 1 / 60);
    camAt = now;
    const w = 2 / SMOOTH, x = w * dt;
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const off = camP - target;
    const tmp = (camV + w * off) * dt;
    camV = (camV - w * tmp) * decay;
    camP = target + (off + tmp) * decay;
    if (Math.abs(camP - target) < SETTLED && Math.abs(camV) < SETTLED * 60) { camP = target; camV = 0; }
    return camP !== target;
  }

  // ---- the frame
  function schedule(remeasure = false) {
    if (remeasure) needMeasure = true;
    if (!ticking) ticking = requestAnimationFrame(tick);
  }
  function tick(now = performance.now()) {
    ticking = 0;
    if (needMeasure) { measure(); needMeasure = false; }
    const y = scrollY;

    if (viewer) {
      if (!inStory && y >= handoff) enter();
      else if (inStory && y < handoff - LEAVE_SLACK) leave();
    }

    // the chapter on screen drives the camera: the last one whose top has been reached (the first before that)
    let active = chapters[0];
    for (const c of chapters) {
      const p = Math.min(1, Math.max(0, (y - c.top) / c.span));
      if (y >= c.top) active = c;
      // entry: 0 while the chapter's top is a screen below, 1 once it reaches the top of the screen
      const e = Math.min(1, Math.max(0, (y - (c.top - vh)) / vh));
      if (e !== c.e) { c.e = e; c.el.style.setProperty('--e', e.toFixed(4)); c.el.toggleAttribute('data-entered', e >= 0.5); }
      if (p === c.p) continue;
      c.p = p;
      c.el.style.setProperty('--p', p.toFixed(4));
      c.impl.update(p, { reduced });
    }

    if (inStory && !lost) {
      const i = chapters.indexOf(active);
      if (!reduced && (active !== camChapter || camP < 0)) { camChapter = active; camP = active.p; camV = 0; camAt = now; }
      const p = active.p;
      if (reduced) {
        // a cut, not a move: the shot before this chapter until it is well under way
        const c = p >= CUT_AT || i === 0 ? active : chapters[i - 1];
        if (c !== lastShot) { lastShot = c; c.impl.camera(viewer, 1, { reduced, cut: true }); }
      } else {
        const moving = spring(p, now);
        active.impl.camera(viewer, camP, { reduced });
        // keep stepping until the camera has caught up with the scroll; then nothing more is drawn
        if (moving) schedule();
      }
    } else {
      camP = -1;
    }

    // the stills' light level, straight from the scroll; not written while the live car hides them (a
    // style change every frame for images nobody sees)
    if (!(inStory && shown && !lost)) {
      const lp = (active.impl.level?.(Math.max(0, active.p), { reduced }) ?? 1).toFixed(3);
      if (lp !== lastLp) { lastLp = lp; stageEl.style.setProperty('--lp', lp); }
    }
  }

  addEventListener('scroll', () => schedule(), { passive: true });
  addEventListener('resize', () => schedule(true));
  new ResizeObserver(() => schedule(true)).observe(document.body);
  reducedQuery.addEventListener('change', () => {
    reduced = reducedQuery.matches;
    story.toggleAttribute('data-reduced', reduced);
    lastShot = null;
    for (const c of chapters) c.p = -1;
    schedule();
  });
  story.toggleAttribute('data-reduced', reduced);
  schedule(true);
}
