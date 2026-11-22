// The story: full-screen chapters over one pinned stage (index.html #story, src/styles/story.css).
//
// Scroll is always the browser's. Nothing here prevents a wheel or a touch, snaps, smooths or locks the
// page; it only reads where the page is and places things to match. One passive scroll listener and one
// animation frame per scroll frame. Chapter offsets are measured on resize, never during a scroll, so a
// scroll frame reads scrollY and does no layout work.
//
// The car: the hero's live 3D canvas (src/vehicle) is the only one. When the story's stage pins (its top
// reaches the top of the screen, the hero now out of sight), the canvas's slot moves into the stage and
// the camera switches to story mode: the chapters place it from their progress. Scrolling back above the
// story moves the slot home and puts the hero's camera back exactly as the visitor left it. Moving a
// canvas keeps its WebGL context, so the page never holds a second one. While the story has the car,
// the hero's background light holds still (stage.js).
//
// Each chapter's progress p runs 0..1 while its frame is pinned. It is written to the chapter's --p (the
// CSS reveals read it) and handed to the chapter's script for what CSS cannot do (a count, the camera).
//
// Reduced motion: nothing is scrubbed. The camera cuts to a chapter's shot once its p passes 0.15, the
// words fade in over 150 ms at their thresholds, and numbers show their final value.
import { createPower } from './chapters/power.js';

const CHAPTERS = { power: createPower };
const CUT_AT = 0.15;      // reduced motion: where a chapter's shot replaces the one before it
const LEAVE_SLACK = 24;   // px above the story's top before the car goes back to the hero (no flicker at the edge)

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

  function setState() {
    const state = !viewer || lost ? 'poster' : inStory ? 'live' : 'waiting';
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
    hero.dataset.vehicleStory = '';
    viewer.setMode('story');
    slot.append(host);
    lastShot = null;
    setState();
  }
  function leave() {
    inStory = false;
    homeMarker.after(host);
    viewer.setFrameShift(null);
    viewer.setKey(1);
    viewer.setMode('orbit');
    viewer.restore(snap);
    snap = null;
    delete hero.dataset.vehicleStory;
    setState();
  }

  // ---- measuring (on resize only)
  let storyTop = 0;
  function measure() {
    const y = scrollY;
    storyTop = story.getBoundingClientRect().top + y;
    for (const c of chapters) {
      const r = c.el.getBoundingClientRect();
      c.top = r.top + y;
      c.span = Math.max(1, c.el.offsetHeight - c.frame.offsetHeight); // the scroll distance the frame stays pinned
      c.p = -1; // force a fresh update
    }
  }

  // ---- the frame
  function schedule(remeasure = false) {
    if (remeasure) needMeasure = true;
    if (!ticking) ticking = requestAnimationFrame(tick);
  }
  function tick() {
    ticking = 0;
    if (needMeasure) { measure(); needMeasure = false; }
    const y = scrollY;

    if (viewer) {
      if (!inStory && y >= storyTop) enter();
      else if (inStory && y < storyTop - LEAVE_SLACK) leave();
    }

    // the chapter on screen drives the camera: the last one whose top has been reached (the first before that)
    let active = chapters[0];
    for (const c of chapters) {
      const p = Math.min(1, Math.max(0, (y - c.top) / c.span));
      if (y >= c.top) active = c;
      if (p === c.p) continue;
      c.p = p;
      c.el.style.setProperty('--p', p.toFixed(4));
      c.impl.update(p, { reduced });
    }

    if (inStory && !lost) {
      const i = chapters.indexOf(active);
      const p = active.p;
      if (reduced) {
        // a cut, not a move: the shot before this chapter until it is well under way
        const c = p >= CUT_AT || i === 0 ? active : chapters[i - 1];
        if (c !== lastShot) { lastShot = c; c.impl.camera(viewer, 1, { reduced, cut: true }); }
      } else {
        active.impl.camera(viewer, p, { reduced });
      }
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
