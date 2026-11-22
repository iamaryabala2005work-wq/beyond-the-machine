// Chapter III, Power: 1,600 hp on E85, counted by the scroll.
//
// p 0..0.25   the figure sharpens out of a blur (CSS, from --p)
// p 0.1..0.7  the figure counts 0 to 1,600 on an ease-out, so it slows into its last hundreds; scrolling
//             back counts it down
// p 0.7..1    the petrol line rises in (CSS)
// camera      the manifest's "power" shot (a low rear three-quarter), pushing in to 0.885 of its zoom
//             (the storyboard's 1.3 to 1.15) over the whole chapter, the car mostly in shadow
// composition the words never cross the car: from 900px they hold a left column and the car is framed in
//             the right half; below that the words sit at the top and the car below them. The push-in is
//             sized so the car's end framing still leaves clear space under (or beside) the figure.
// light       a cool rim along the roofline and a soft floor glow (setSilhouette) keep the silhouette
//             readable while the studio light stays low
// Reduced motion: the figure shows 1,600, the camera holds the shot without the push-in.
const TARGET = 1600;
const PUSH = 1.15 / 1.3;   // the push-in, as a share of the shot's own zoom (any car, any shot)
const KEY = [0.32, 0.5];   // the studio light over the chapter: mostly shadow, a little more as it goes
// framing per layout: x moves the car right (a fraction of the width), y lowers it (of the height),
// zoom scales the shot's distance (above 1 = further away, a smaller car)
const FRAME = {
  split: { x: 0.17, y: 0.04, zoom: 1.2 },   // from 1200px: the car in the right half, beside the words
  splitNarrow: { x: 0.21, y: 0.04, zoom: 1.4 }, // 900-1199px: smaller and further right, clear of the figure
  stack: { x: 0, y: 0.2, zoom: 1.0 },     // below: the car in the lower half, under the words
};
const SILHOUETTE = [0.75, 1];             // the rim and floor glow over the chapter

const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
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
      show(reduced ? TARGET : Math.round(TARGET * easeOut(clamp01((p - 0.1) / 0.6))));
      // reduced motion: the words fade in at their thresholds instead of following --p
      el.toggleAttribute('data-in', p > 0);
      el.toggleAttribute('data-late', p >= 0.7);
    },
    camera(viewer, p, { reduced }) {
      const f = !splitQuery.matches ? FRAME.stack : wideQuery.matches ? FRAME.split : FRAME.splitNarrow;
      const base = viewer.shot('power');
      const shot = { ...base, zoom: (base.zoom ?? 1) * f.zoom };
      const close = { ...shot, zoom: shot.zoom * PUSH };
      viewer.setFrameShift(f.y, f.x);
      if (reduced) {
        viewer.setKey(KEY[1]);
        viewer.setSilhouette(SILHOUETTE[1]);
        viewer.pose(shot, shot, 0);
        return;
      }
      viewer.setKey(KEY[0] + (KEY[1] - KEY[0]) * p);
      viewer.setSilhouette(SILHOUETTE[0] + (SILHOUETTE[1] - SILHOUETTE[0]) * p);
      viewer.pose(shot, close, easeInOut(p));
    },
  };
}
