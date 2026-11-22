// Chapter III, Power: 1,600 hp on E85, and a light reveal.
//
// entry        the mark, figure and unit come in as the chapter rises (CSS, from --e; blur on desktop only)
// car          still. It holds the manifest's "power" shot (a low rear three-quarter) for the whole chapter,
//              framed per layout (power-look.js); it is posed before it is ever seen (story.js fades the
//              live canvas in only once it has drawn this pose; until then the stage shows a still of it)
// light        the reveal: at the start the car is a silhouette (no key light, almost no room light, only
//              the roofline rim, the floor glow and the tail lights); scrolling brings the light up until
//              the car is lit as in the hero at the end; scrolling back returns it to shadow. story.js eases
//              the level through its damped spring, so the light glides rather than steps. Brightness only:
//              no light is added or removed, so no shader recompiles; frames are drawn only while it moves.
// p 0.1..0.85  the figure counts 0 to 1,600 on a quadratic ease-out: even enough to take several swipes
//              on a phone, slowing into its last hundreds; scrolling back counts it down
// p 0.86..0.95 the petrol line rises in (CSS)
// Reduced motion: the car lit, the figure at 1,600, nothing animated.
import { FRAME, lightAt, levelAt } from './power-look.js';

const TARGET = 1600;
const COUNT = [0.1, 0.85];  // the share of the chapter the count runs over
const LATE = 0.86;          // the petrol line

const easeOut = (t) => 1 - (1 - t) ** 2;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const fmt = new Intl.NumberFormat('en-US');
const splitQuery = matchMedia('(min-width: 900px)');
const wideQuery = matchMedia('(min-width: 1200px)');

export function createPower(el) {
  const count = el.querySelector('[data-count]');
  let shown = '';

  function show(n) {
    const text = fmt.format(n);
    if (text !== shown) { shown = text; count.textContent = text; }
  }

  return {
    update(p, { reduced }) {
      show(reduced ? TARGET : Math.round(TARGET * easeOut(clamp01((p - COUNT[0]) / (COUNT[1] - COUNT[0])))));
      // reduced motion: the petrol line fades in at its threshold (the rest at entry, story.js data-entered)
      el.toggleAttribute('data-late', p >= LATE);
    },
    // how far the light is up at progress p (story.js also shows it on the stage's stills, --lp)
    level: (p, { reduced }) => (reduced ? 1 : levelAt(p)),
    // p is the eased progress (story.js); the pose is the same at every p
    camera(viewer, p, { reduced }) {
      const f = !splitQuery.matches ? FRAME.stack : wideQuery.matches ? FRAME.split : FRAME.splitNarrow;
      const base = viewer.shot('power');
      const shot = { ...base, zoom: (base.zoom ?? 1) * f.zoom };
      viewer.setFrameShift(f.y, f.x);
      const light = lightAt(reduced ? 1 : levelAt(p));
      viewer.setKey(light.key);
      viewer.setSilhouette(light.silhouette);
      viewer.pose(shot, shot, 0);
    },
  };
}
