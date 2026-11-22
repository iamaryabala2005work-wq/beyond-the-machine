// Chapter VI, Close: the final shot, then the release.
//
// entry        the chapter mark comes in only once the frame is nearly up (CSS, from --e): on its way up
//              it would cross the car, which is already in place on the pinned stage
// car          the manifest's "close" shot, a wide, low, pure side view, in the paint the visitor chose in
//              Chapter V (paint.js; the live car already wears it, so nothing changes on screen), fitted
//              at that one heading into the band under the mark and over the stage's foot (fit.js). The
//              camera does not move. Its pose is set while the canvas is hidden (story.js), never swung
//              into view.
// light        a little under the hero's, and a slow light sweep travels across the body with the scroll
//              (close-look.js): one soft light moving round the car's flank, dark at both ends, so the car
//              at rest is the still. story.js eases it through its damped spring; frames are drawn only
//              while it moves. Position and brightness only: no shader recompiles.
// release      the chapter is the story's last: once it has scrolled by, the pinned stage lets go and the
//              car scrolls up and away with it. Off screen, the viewer's IntersectionObserver stops every
//              frame (viewer.js); nothing here draws.
// still        the stage's stand-in until the live car is in place, and with no 3D: a render of this shot
//              in the visitor's paint (default Midnight), placed where the live car lands. No sweep on it.
// Reduced motion: no sweep, and the car fully lit in the chosen paint.
import { LIGHT, LIGHT_REDUCED, sweepAt, STILL_PAD } from './close-look.js';
import { paintChoice, showStill, placeStill } from '../paint.js';

const GAP = 24;        // px kept clear between the car and the mark above it
const FOOT = 64;       // px kept clear at the stage's foot, from 640px, for the stand-in tag in its corner
const SIDE = 0.06;     // of the width at least, each side: a wide shot, with air round it
const SIDE_PHONE = 12; // px each side on phones: the car a little wider than the page's gutters, as large as it can be
const LOW = 0.08;      // phones: the band starts this share lower, so the car sits a little under the middle
                       // of the tall frame (a low horizon) and leaves less black under it as it scrolls away
const phoneQuery = matchMedia('(max-width: 639px)');

export function createClose(el, { stage }) {
  const frame = el.querySelector('.chapter__frame');
  const head = el.querySelector('[data-close-head]');
  const still = stage.querySelector('[data-still="close"]');
  let rect = null; // the band the car is fitted into, as fractions of the frame

  // the still follows the choice: the visitor's (the live car wears it), else the default
  const paint = () => paintChoice.get() ?? still?.dataset.stillDefault;
  const follow = () => showStill(still, paint());
  paintChoice.on(follow);
  (window.requestIdleCallback ?? ((f) => setTimeout(f, 200)))(follow);

  function measure() {
    const f = frame.getBoundingClientRect();
    const h = head.getBoundingClientRect();
    const cs = getComputedStyle(frame);
    const W = Math.max(1, f.width), H = Math.max(1, f.height);
    const side = phoneQuery.matches ? SIDE_PHONE : Math.max(parseFloat(getComputedStyle(head).paddingLeft) || 0, W * SIDE);
    const bottom = H - parseFloat(cs.paddingBottom) - (phoneQuery.matches ? 0 : FOOT);
    let top = h.bottom - f.top + GAP;
    if (phoneQuery.matches) top += (bottom - top) * LOW;
    rect = { left: side / W, right: (W - side) / W, top: top / H, bottom: Math.max(top + 1, bottom) / H };
    placeStill(still, side, top, W - side, Math.max(top + 1, bottom), STILL_PAD);
  }

  return {
    update() {},
    measure,
    level: () => 1,
    camera(v, p, { reduced }) {
      if (!rect) measure();
      const base = v.shot('close');
      const fit = v.fitShot(base, rect, { steps: 1 });
      if (!fit) return;
      const light = reduced ? LIGHT_REDUCED : LIGHT;
      v.setFrameShift(fit.y, fit.x);
      v.setKey(light.key);
      v.setSilhouette(light.silhouette);
      const shot = { ...base, zoom: fit.zoom };
      v.pose(shot, shot, 0);
      const s = reduced ? { t: 0, level: 0 } : sweepAt(p);
      v.setSweep(s.t, s.level);
    },
  };
}
