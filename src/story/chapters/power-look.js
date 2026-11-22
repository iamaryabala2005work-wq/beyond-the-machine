// Chapter III's look, in one place: how the car is framed and how it is lit at a given point of the chapter.
// Read by the chapter (power.js) and by the poster renderer (scripts/render-posters.mjs), which draws the
// stills the stage shows before the live car arrives and when there is no 3D, so the two always match.
// Pure data and arithmetic: no DOM, so Node can import it too.

// framing per layout: x moves the car right (a fraction of the width), y lowers it (of the height), zoom
// scales the manifest's "power" shot distance (above 1 = further away, a smaller car). The car holds this
// framing for the whole chapter: the camera never moves, only the light does.
export const FRAME = {
  split: { x: 0.17, y: 0.04, zoom: 1.2 },        // from 1200px: the car in the right half, beside the words
  splitNarrow: { x: 0.21, y: 0.04, zoom: 1.4 },  // 900-1199px: smaller and further right, clear of the figure
  stack: { x: 0, y: 0.2, zoom: 1.0 },            // below: the car in the lower half, under the words
};

// the light reveal, from L = 0 (nothing: every light, the floor glow and the car's own lamps off, so the
// car is black on black) to L = 1 (lit as in the hero). The roofline light and the floor glow come up
// first (full by L 0.4), so the car's outline and its tail lights are the first things out of the dark.
export function lightAt(L) {
  return { key: L, silhouette: 0.35 * Math.min(1, L / 0.4) };
}

// how far the light is up at chapter progress p: black until 10% (where the count starts), then up in
// step with the count, slow at first, to full only at the very end
export const DARK_UNTIL = 0.1;
export function levelAt(p) {
  const t = Math.min(1, Math.max(0, (p - DARK_UNTIL) / (0.98 - DARK_UNTIL)));
  return t ** 1.4;
}

// the stills scripts/render-posters.mjs makes of this chapter: per layout, the size it is drawn at (the
// stage's shape on such a screen). Only the lit end: the start of the reveal is the empty page.
export const POSTERS = {
  stack: { size: [780, 1688], frame: FRAME.stack },   // a phone, 390 x 844 at 2x
  split: { size: [1920, 1200], frame: FRAME.split },  // a desktop, 16:10
};
