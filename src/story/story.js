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
// Each chapter's progress p runs 0..1 while its frame is pinned, its entry e runs 0..1 while it rises
// into the screen, and its exit x runs 0..1 while its frame scrolls off the top after p reaches 1. All
// three are written to the chapter (--p, --e, --x: the CSS reveals read them) and p is handed to the
// chapter's script for what CSS cannot do (a count, the camera).
//
// The last chapter (VI, Close) ends the story: once it has scrolled by, the stage's sticky box ends with
// #story and the car scrolls up and away with the last frame; off screen, the viewer draws nothing.
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
// Between chapters the car changes shot the same way, never in view: once the next chapter is half way
// up the screen (its entry past 0.5), the canvas fades out over that chapter's still, takes the new pose
// while hidden, and fades back in once it has drawn it ("reshoot"). The stills follow the same chapter
// (data-shot on the stage), so the stage always shows a car, live or still, through the change.
//
// A chapter that is hands-on (its handsOn: Chapter V) gets the car in the rig's turn mode, and the canvas
// takes pointer input there (data-hands-on on the stage): a drag or a sideways swipe turns the car, while
// the page still scrolls under the wheel and vertical swipes.
//
// Chapter hooks: update(p) always; camera(viewer, p, { reduced, fresh }) and level(p) for the chapter the
// car is in; and, when a chapter has them, measure() on resize, state(state, viewer) when the stage's
// state changes, enter(viewer) when the car moves into the story, setReduced(r).
//
// Reduced motion: nothing is scrubbed or smoothed. The camera changes shot as above but at once (no
// fades), the words fade in over 150 ms at their thresholds, and numbers show their final value.
import { createPower } from './chapters/power.js';
import { createYours } from './chapters/yours.js';
import { createClose } from './chapters/close.js';

const CHAPTERS = { power: createPower, yours: createYours, close: createClose };
const SHOT_AT = 0.5;      // a chapter takes the car once it is this far into the screen (its entry)
const ARRIVED = 0.98;     // its frame has landed (data-arrived): words that must not cross the car come in then
const FADE_MS = 420;      // the canvas's fade out before a reshoot (story.css: 400 ms)
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
      return make ? { el, name: el.dataset.chapter, frame: el.querySelector('.chapter__frame') ?? el, top: 0, span: 1, p: -1, e: -1, x: -1, impl: make(el, { stage: stageEl }) } : null;
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
  let shot = null;           // the chapter whose pose the live car holds
  let hideUntil = 0;         // a reshoot: the canvas is fading out until then
  let ticking = 0;
  let needMeasure = true;
  // the camera spring: where the camera is (in p), its speed, and the frame time it last stepped at
  let camP = -1, camV = 0, camAt = 0, camChapter = null;
  let shown = false;         // the live canvas has drawn the chapter's pose and is shown
  let lastLp = '', lastLv = '';

  let lastState = '';
  function setState() {
    const state = !viewer || lost ? 'poster' : !inStory ? 'waiting' : shown ? 'live' : 'entering';
    if (stageEl.dataset.state !== state) stageEl.dataset.state = state;
    if (standinTag) standinTag.hidden = !(state === 'live' && standIn);
    const handsOn = state === 'live' && Boolean(shot?.impl.handsOn);
    if (stageEl.hasAttribute('data-hands-on') !== handsOn) stageEl.toggleAttribute('data-hands-on', handsOn);
    if (state !== lastState) { lastState = state; for (const c of chapters) c.impl.state?.(state, viewer); }
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
    handle.onResize?.(() => schedule()); // a hands-on chapter fits the car to the canvas's new size
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
    shot = null;       // the tick poses the chapter on screen while the canvas is hidden
    hideUntil = 0;
    camP = -1; // the camera starts where the scroll is, not eased in from elsewhere
    shown = false;
    lastLv = '';
    for (const c of chapters) c.impl.enter?.(viewer);
    setState();
  }
  // the canvas is shown once it has drawn the chapter's pose at its new size: the pose is set in this
  // frame (tick), a new size is taken in the next (viewer.js), the frame after draws both
  let revealing = 0;
  function reveal() {
    const token = ++revealing;
    let frames = 0;
    const wait = () => {
      if (!inStory || token !== revealing) return;
      if (++frames < 4) { requestAnimationFrame(wait); return; }
      shown = true;
      setState();
    };
    requestAnimationFrame(wait);
  }
  // the canvas, hidden, takes chapter c's pose
  function takeShot(c, now) {
    viewer.setMode('story'); // a hands-on chapter's turn mode would hold the next pose to its height
    shot = c;
    camChapter = c; camP = c.p; camV = 0; camAt = now;
    viewer.setSweep?.(0, 0); // Chapter VI's light sweep is its own: off for every other shot
    c.impl.camera(viewer, reduced ? 1 : c.p, { reduced, fresh: true });
    setLv(c.impl.level?.(c.p, { reduced }) ?? 1);
  }
  function leave() {
    inStory = false;
    shown = false;
    shot = null;
    revealing++;
    lastLp = ''; // the stills are back: bring their light level up to date
    homeMarker.after(host);
    viewer.setFrameShift(null);
    viewer.setKey(1);
    viewer.setSilhouette(0);
    viewer.setSweep?.(0, 0);
    viewer.setMode('story'); // out of a hands-on chapter's turn mode, so the hero's camera is put back whole
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
      c.x = -1;
      c.impl.measure?.();
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

    // every chapter follows the scroll; the car belongs to the last chapter half way into the screen
    let want = chapters[0];
    for (const c of chapters) {
      const p = Math.min(1, Math.max(0, (y - c.top) / c.span));
      // entry: 0 while the chapter's top is a screen below, 1 once it reaches the top of the screen
      const e = Math.min(1, Math.max(0, (y - (c.top - vh)) / vh));
      if (e >= SHOT_AT) want = c;
      if (e !== c.e) { c.e = e; c.el.style.setProperty('--e', e.toFixed(4)); c.el.toggleAttribute('data-entered', e >= 0.5); c.el.toggleAttribute('data-arrived', e >= ARRIVED); }
      // exit: 0 until the frame lets go, 1 once it has scrolled a screen up
      const x = Math.min(1, Math.max(0, (y - c.top - c.span) / vh));
      if (x !== c.x) { c.x = x; c.el.style.setProperty('--x', x.toFixed(4)); }
      if (p === c.p) continue;
      c.p = p;
      c.el.style.setProperty('--p', p.toFixed(4));
      c.impl.update(p, { reduced });
    }
    if (stageEl.dataset.shot !== want.name) stageEl.dataset.shot = want.name;

    if (inStory && !lost) {
      if (want !== shot) {
        if (shown) {
          // a reshoot: fade the canvas out over the next chapter's still (at once under reduced motion)
          shown = false;
          lastLp = '';
          setState();
          hideUntil = now + (reduced ? 0 : FADE_MS);
          setTimeout(() => schedule(), reduced ? 0 : FADE_MS + 16);
        } else if (now >= hideUntil) {
          takeShot(want, now);
          reveal();
        }
      }
      if (shot) {
        if (reduced) {
          // a cut, not a move: the shot is set once (takeShot); a chapter whose camera follows p in
          // steps (none yet) would be called here
          setLv(shot.impl.level?.(1, { reduced }) ?? 1);
        } else {
          if (camChapter !== shot || camP < 0) { camChapter = shot; camP = shot.p; camV = 0; camAt = now; }
          const moving = spring(shot.p, now);
          shot.impl.camera(viewer, camP, { reduced });
          setLv(shot.impl.level?.(camP, { reduced }) ?? 1);
          // keep stepping until the camera has caught up with the scroll; then nothing more is drawn
          if (moving) schedule();
        }
      }
    } else {
      camP = -1;
    }
    setState();

    // the stills' light level, straight from the scroll; not written while the live car hides them (a
    // style change every frame for images nobody sees)
    if (!(inStory && shown && !lost)) {
      const lp = (want.impl.level?.(Math.max(0, want.p), { reduced }) ?? 1).toFixed(3);
      if (lp !== lastLp) { lastLp = lp; stageEl.style.setProperty('--lp', lp); }
    }
  }

  // the live car's light level, for what CSS does with it (the car and its tag fade up from the page, story.css)
  function setLv(level) {
    const lv = level.toFixed(3);
    if (lv !== lastLv) { lastLv = lv; stageEl.style.setProperty('--lv', lv); }
  }

  addEventListener('scroll', () => schedule(), { passive: true });
  addEventListener('resize', () => schedule(true));
  new ResizeObserver(() => schedule(true)).observe(document.body);
  reducedQuery.addEventListener('change', () => {
    reduced = reducedQuery.matches;
    story.toggleAttribute('data-reduced', reduced);
    for (const c of chapters) { c.p = -1; c.impl.setReduced?.(reduced); }
    if (inStory && shot) takeShot(shot, performance.now());
    schedule();
  });
  story.toggleAttribute('data-reduced', reduced);
  schedule(true);
}
