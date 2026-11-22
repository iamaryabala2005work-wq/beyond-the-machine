// Chapter I, The Name: a car named for a father.
//
// entry        the mark comes in as the chapter rises (CSS, from --e). The stage rises with the frame, so the
//              car arrives already in place under the words and nothing crosses it.
// word         JESKO, letter by letter over p 0.04..0.44: each letter fades and rises (CSS, from --p; a
//              blur clears on desktop only, none on the mobile tier). Scrolling back takes them away again.
// lines        three short lines, one at a time over p 0.48..0.76, then the mono date mark at 0.8. The words
//              are Koenigsegg's own press release's, closely paraphrased (cited at the foot).
// car          the manifest's "name" shot, a low front view facing the visitor, fitted into the free band
//              (under the words on phones and narrow screens, beside them from 900px) at that one heading
//              (fit.js), with a very slow push-in across the chapter (name-look.js: from 90% of its fitted
//              size to all of it, so it never grows past the band). story.js eases it through its damped
//              spring; frames are drawn only while it moves. Posed while the canvas is hidden (story.js),
//              never swung into view.
// light        the only warm-lit chapter: an amber key, the rest of the car and the scene in deep shadow
//              (lighting.js setWarmth). Colour and brightness only: no light added or removed, no shader
//              recompiles. As the frame lets go, the car fades to the page before the next chapter's words
//              rise to where it sits (presence(), story.js --lx). Coming in, it waits until every picture
//              of the car above the story (the hero's stage, the specifications' close view) has left the
//              screen, then fades up over a short stretch of scroll: one car on screen at a time.
// still        the stage's stand-in until the live car is in place, and with no 3D: a warm render of this
//              shot in the paint the live car wears (default Midnight), placed and scaled with the push-in
//              exactly where the live car lands.
// Reduced motion: the whole word, all the lines and the lit car, at the end of the push-in; nothing moves.
import { LIGHT, STILL_PAD, PUSH, pushAt, presenceAt } from './name-look.js';
import { paintChoice, showStill, placeStill } from '../paint.js';

const GAP = 28;        // px kept clear between the car and the words above it (stacked) or beside it (split)
const GAP_FOOT = 20;   // px kept clear above the source line
const FOOT = 64;       // px kept clear at the stage's foot, from 640px, for the stand-in tag in its corner
const MAX_H = 0.5;     // split: of the frame's height at most for the car's band
const CLEAR = 0.05;    // of the screen's height: how far past the screen's top the last picture of the car
                       // above the story must be before this one starts to come (a fast flick can run a
                       // frame ahead of the page's own tick)
const ARRIVE = 0.08;   // of the screen's height: the scroll over which the car then fades up
const splitQuery = matchMedia('(min-width: 900px)');
const phoneQuery = matchMedia('(max-width: 639px)');

export function createName(el, { stage }) {
  const frame = el.querySelector('.chapter__frame');
  const head = el.querySelector('[data-name-head]');
  const col = el.querySelector('[data-name-col]');
  const foot = el.querySelector('[data-name-foot]');
  const still = stage.querySelector('[data-still="name"]');
  let rect = null, rectStart = null; // the band at the end of the push-in and at its start, fractions of the frame
  let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lastScale = '';
  // the pictures of the car above the story, and how far down the page the lowest of them ends (measured
  // on resize; a scroll frame only compares it with scrollY)
  const story = el.closest('[data-story]');
  const above = [...document.querySelectorAll('[data-vehicle-stage], img[data-source="stand-in"]')].filter((n) => !story?.contains(n));
  let clearAt = 0, vh = 1;

  // the still wears the live car's paint (the visitor's Chapter V choice), else the default
  const follow = () => showStill(still, paintChoice.get() ?? still?.dataset.stillDefault);
  paintChoice.on(follow);
  (window.requestIdleCallback ?? ((f) => setTimeout(f, 200)))(follow);

  function measure() {
    const f = frame.getBoundingClientRect();
    const h = head.getBoundingClientRect();
    const s = foot.getBoundingClientRect();
    const cs = getComputedStyle(frame);
    const gut = parseFloat(getComputedStyle(head).paddingLeft) || 16;
    const W = Math.max(1, f.width), H = Math.max(1, f.height);
    let l, t, r, b;
    if (splitQuery.matches) {
      // beside the words: from the column's widest line to the gutter, between the mark's top and the foot
      // (the column is as wide as its widest line, story.css)
      l = col.getBoundingClientRect().right - f.left + GAP * 2;
      r = W - gut;
      t = h.top - f.top;
      b = H - parseFloat(cs.paddingBottom) - FOOT;
      if (b - t > H * MAX_H) { const mid = (t + b) / 2 + H * 0.04; t = mid - (H * MAX_H) / 2; b = mid + (H * MAX_H) / 2; }
    } else {
      // under the words, over the source line (and, from 640px, clear of the tag in the corner)
      l = gut;
      r = W - gut;
      t = h.bottom - f.top + GAP;
      b = s.top - f.top - GAP_FOOT;
      if (!phoneQuery.matches) b = Math.min(b, H - parseFloat(cs.paddingBottom) - FOOT);
    }
    b = Math.max(t + 1, b);
    rect = { left: l / W, right: r / W, top: t / H, bottom: b / H };
    // the start of the push-in: the same band, shrunk about its centre
    const cx = (rect.left + rect.right) / 2, cy = (rect.top + rect.bottom) / 2;
    const hw = ((rect.right - rect.left) / 2) * PUSH, hh = ((rect.bottom - rect.top) / 2) * PUSH;
    rectStart = { left: cx - hw, right: cx + hw, top: cy - hh, bottom: cy + hh };
    placeStill(still, l, t, r, b, STILL_PAD);
    lastScale = '';
    // the scroll position at which the last of them has left the top of the screen
    vh = Math.max(1, innerHeight);
    clearAt = Math.max(0, ...above.map((n) => n.getBoundingClientRect().bottom + scrollY));
  }
  // 0 while a picture of the car above the story is on screen, then up to 1 over ARRIVE of a screen
  function arrival(r) {
    const t = (scrollY - clearAt - vh * CLEAR) / (vh * ARRIVE);
    if (r) return t >= 0 ? 1 : 0;
    const k = Math.min(1, Math.max(0, t));
    return k * k * (3 - 2 * k);
  }

  // the still follows the push-in by scale, about its own centre (which is the band's)
  function scaleStill(p) {
    const k = (reduced ? 1 : pushAt(p)).toFixed(4);
    if (k === lastScale || !still) return;
    lastScale = k;
    still.style.scale = k;
  }

  return {
    update(p) { scaleStill(p); },
    measure,
    level: () => 1,
    // how much of the car is there (story.js writes it to the stage as --lx): once the pictures above the
    // story have gone, and until the frame lets go. Reduced motion: cuts, no fades, at the same points.
    presence: (x, { reduced: r }) => arrival(r) * (r ? (x < 0.15 ? 1 : 0) : presenceAt(x)),
    setReduced(r) { reduced = r; lastScale = ''; },
    camera(v, p, { reduced: r }) {
      if (!rect) measure();
      const base = v.shot('name');
      const a = v.fitShot(base, rectStart, { steps: 1 });
      const b = v.fitShot(base, rect, { steps: 1 });
      if (!a || !b) return;
      // the car's size goes with 1 / zoom: blend that, so the push-in is even
      const t = r ? 1 : Math.min(1, Math.max(0, p));
      const zoom = 1 / (1 / a.zoom + (1 / b.zoom - 1 / a.zoom) * t);
      v.setFrameShift(a.y + (b.y - a.y) * t, a.x + (b.x - a.x) * t);
      v.setKey(LIGHT.key);
      v.setSilhouette(LIGHT.silhouette);
      v.setWarmth?.(LIGHT.warmth);
      const shot = { ...base, zoom };
      v.pose(shot, shot, 0);
    },
  };
}
