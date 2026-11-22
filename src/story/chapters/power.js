// Chapter III, Power: 1,600 hp on E85, counted by the scroll.
//
// p 0..0.25   the figure sharpens out of a blur (CSS, from --p)
// p 0.1..0.7  the figure counts 0 to 1,600 on an ease-out, so it slows into its last hundreds; scrolling
//             back counts it down
// p 0.7..1    the petrol line rises in (CSS)
// camera      the manifest's "power" shot (a low rear three-quarter), pushing in to 0.885 of its zoom
//             (the storyboard's 1.3 to 1.15) over the whole chapter, the car mostly in shadow
// Reduced motion: the figure shows 1,600, the camera holds the shot without the push-in.
const TARGET = 1600;
const PUSH = 1.15 / 1.3;   // the push-in, as a share of the shot's own zoom (any car, any shot)
const KEY = [0.32, 0.5];   // the studio light over the chapter: mostly shadow, a little more as it goes
const FRAME = { wide: 0.17, compact: 0.14 }; // the car sits low in the frame, under the figure (positive lowers it)

const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const fmt = new Intl.NumberFormat('en-US');
const compactQuery = matchMedia('(max-width: 639px)');

export function createPower(el) {
  const count = el.querySelector('[data-count]');
  let shown = '';

  function show(n) {
    const text = fmt.format(n);
    if (text !== shown) { shown = text; count.textContent = text; }
  }

  return {
    update(p, { reduced }) {
      show(reduced ? TARGET : Math.round(TARGET * easeOut(clamp01((p - 0.1) / 0.6))));
      // reduced motion: the words fade in at their thresholds instead of following --p
      el.toggleAttribute('data-in', p > 0);
      el.toggleAttribute('data-late', p >= 0.7);
    },
    camera(viewer, p, { reduced }) {
      const shot = viewer.shot('power');
      const close = { ...shot, zoom: (shot.zoom ?? 1) * PUSH };
      viewer.setFrameShift(compactQuery.matches ? FRAME.compact : FRAME.wide);
      if (reduced) {
        viewer.setKey(KEY[1]);
        viewer.pose(shot, shot, 0);
        return;
      }
      viewer.setKey(KEY[0] + (KEY[1] - KEY[0]) * p);
      viewer.pose(shot, close, easeInOut(p));
    },
  };
}
