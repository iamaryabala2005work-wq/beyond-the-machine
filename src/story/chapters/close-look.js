// Chapter VI's look, in one place: the final shot, its light and its light sweep, and the still. Read by
// the chapter (close.js) and by the poster renderer (scripts/render-posters.mjs), which draws the stills
// the stage shows before the live car is in place and when there is no 3D, so the two always match. Pure
// data and arithmetic: no DOM, so Node can import it too.

// the shot is the manifest's "close" (a wide, low, pure side view). The car is not turned here, so it is
// fitted at that one heading (fit.js with steps 1), into the band under the chapter mark.

// the light: a little under the hero's, so the sweep reads as it passes; the story's roofline light and
// floor glow stay as Chapters III and V leave them. Reduced motion: no sweep, the car fully lit.
export const LIGHT = { key: 0.62, silhouette: 0.35 };
export const LIGHT_REDUCED = { key: 1, silhouette: 0.35 };

// the sweep across the chapter's progress p: it travels across the frame from SWEEP[0] to SWEEP[1]
// (eased at both ends, so it starts and stops softly), and is brightest half way, dark at both ends, so
// the car at p 0 and p 1 is exactly the still
export const SWEEP = [0.06, 0.94];
const smooth = (t) => t * t * (3 - 2 * t);
export function sweepAt(p) {
  const t = Math.min(1, Math.max(0, (p - SWEEP[0]) / (SWEEP[1] - SWEEP[0])));
  return { t: smooth(t), level: Math.sin(Math.PI * t) ** 1.5 };
}

// The stills: one per paint (the visitor's Chapter V choice carries into the close), the car at the shot
// cut to its fitted box plus STILL_PAD of that box on each side for the ground shadow. The page fits the
// box into the same band as the live car (close.js), so the still lands exactly where the live car does.
// Renders of the model in that paint, not a tinted picture: what they show is what the 3D car shows.
export const STILL_PAD = 0.1;
export const STILL = { size: [1600, 900], widths: [800, 1600] };
