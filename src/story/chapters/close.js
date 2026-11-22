// Chapter VI, Close: the final shot, then the release.
//
// entry        the chapter mark comes in only once the frame is nearly up (CSS, from --e): on its way up
//              it would cross the car, which is already in place on the pinned stage
// car          the manifest's "close" shot, a wide, low, pure side view, in the paint the visitor chose in
//              Chapter V (paint.js; the live car already wears it, so nothing changes on screen), fitted
//              at that one heading into the band under the mark and over the stage's foot (fit.js).
//              The same live car comes on from Chapter V: as this frame rises in, the camera glides from
//              where V left it (V's turntable ends on this heading; the framing, the height and the light
//              ease across) to this shot, through story.js's spring, and holds it once the frame lands.
//              No still and no fade on the way, so one car is on screen throughout. Arriving any other way
//              (a jump), the shot is set while the canvas is hidden.
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
// The last frame of a film: the whole car, nose to tail, with clear black round it at any window shape.
const SIDE = 0.10;     // of the width clear each side, from 640px (never less than the page's gutter)
const SIDE_PHONE = 0.07; // the same on phones, where the wide car is small against the tall screen anyway
const MAX_H = 0.42;    // of the frame's height at most for the car's band, from 640px: a short window shrinks
                       // the car rather than filling up with it
const LOW = 0.03;      // phones: the band starts this share lower, so the car sits a little under the middle
                       // of the tall frame (a low horizon) and leaves less black under it as it scrolls away
const phoneQuery = matchMedia('(max-width: 639px)');
// the glide from Chapter V's pose over the entry: none until q JOIN_FROM (story.js hands the car back to
// V below its JOIN_BACK, -0.95), all of it by q GLIDE_TO, before the frame lands; eased at both ends
const JOIN_FROM = -0.95, GLIDE_TO = -0.12;
const glide = (q) => { const t = Math.min(1, Math.max(0, (q - JOIN_FROM) / (GLIDE_TO - JOIN_FROM))); return t * t * (3 - 2 * t); };

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
    const phone = phoneQuery.matches;
    const side = Math.max(parseFloat(getComputedStyle(head).paddingLeft) || 0, W * (phone ? SIDE_PHONE : SIDE));
    let bottom = H - parseFloat(cs.paddingBottom) - (phone ? 0 : FOOT);
    let top = h.bottom - f.top + GAP;
    if (phone) top += (bottom - top) * LOW;
    else if (bottom - top > H * MAX_H) {
      // a band taller than the car may be: the car keeps to MAX_H, centred where the band was
      const mid = (top + bottom) / 2;
      top = mid - (H * MAX_H) / 2;
      bottom = mid + (H * MAX_H) / 2;
    }
    bottom = Math.max(top + 1, bottom);
    rect = { left: side / W, right: (W - side) / W, top: top / H, bottom: bottom / H };
    placeStill(still, side, top, W - side, bottom, STILL_PAD);
  }

  let from = null; // the pose Chapter V left the live car in, while this chapter glides on from it

  return {
    update() {},
    measure,
    level: () => 1,
    // the live car comes on from Chapter V as it is (story.js): no reshoot, no still
    from: 'yours',
    join(pose) { from = pose ?? null; },
    // q: -1..0 while the chapter rises in (its entry), then p. The car glides from V's pose to this shot
    // over the entry (eased; none of it before q JOIN_FROM, so story.js can hand it back from there), and
    // is on the shot by the time the frame lands; the sweep runs over p.
    camera(v, q, { reduced, fresh }) {
      if (!rect) measure();
      if (fresh) from = null; // posed while hidden: straight onto the shot
      const base = v.shot('close');
      const fit = v.fitShot(base, rect, { steps: 1 });
      if (!fit) return;
      const light = reduced ? LIGHT_REDUCED : LIGHT;
      const shot = { ...base, zoom: fit.zoom };
      const k = from ? glide(q) : 1;
      const mix = (a, b) => a + (b - a) * k;
      if (k < 1) {
        v.setFrameShift(mix(from.shift[0], fit.y), mix(from.shift[1], fit.x));
        v.setKey(mix(from.key, light.key));
        v.setSilhouette(mix(from.silhouette, light.silhouette));
        v.pose(from.shot, shot, k);
      } else {
        v.setFrameShift(fit.y, fit.x);
        v.setKey(light.key);
        v.setSilhouette(light.silhouette);
        v.pose(shot, shot, 0);
      }
      const s = reduced || q <= 0 ? { t: 0, level: 0 } : sweepAt(q);
      v.setSweep(s.t, s.level);
    },
  };
}
