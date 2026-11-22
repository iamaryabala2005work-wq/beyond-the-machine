// Chapter V's look, in one place: the turntable, the light and the still. Read by the chapter (yours.js)
// and by the poster renderer (scripts/render-posters.mjs), which draws the still the stage shows before
// the live car is in place and when there is no 3D, so the two always match. Pure data and arithmetic: no
// DOM, so Node can import it too.

// the turntable: the car starts at the manifest's "yours" shot (the hero's three-quarter) and turns
// TURN degrees as the chapter scrolls by, slowly and evenly. Reduced motion: it stays at the start.
export const TURN = 60;
export const turnAt = (p) => TURN * Math.min(1, Math.max(0, p));

// the light: as Chapter III leaves it (lit as in the hero, with the story's roofline light and floor
// glow), so the change from Power to Yours is a change of angle only
export const LIGHT = { key: 1, silhouette: 0.35 };

// The still: the car at the turntable's start, cut to the box the live car is fitted into (the union of
// where it lands at every heading, fit.js) plus STILL_PAD of that box's size on each side for the ground
// shadow. The page fits the box into the same free band as the live car (yours.js), so the still lands
// exactly where the live car does. One image serves every layout: its shape is that box's.
export const STILL_PAD = 0.12;
export const STILL = { size: [1600, 900], widths: [800, 1600] }; // rendered at this canvas, then cut
