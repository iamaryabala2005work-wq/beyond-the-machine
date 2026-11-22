// Chapter I's look, in one place: the shot's push-in, the warm light, and the still. Read by the chapter
// (name.js) and by the poster renderer (scripts/render-posters.mjs), which draws the stills the stage shows
// before the live car is in place and when there is no 3D, so the two always match. Pure data and
// arithmetic: no DOM, so Node can import it too.

// the shot is the manifest's "name" (a low front view, the car facing the visitor). The car is not turned
// here, so it is fitted at that one heading (fit.js with steps 1) into the chapter's free band.

// the push-in: across the chapter the car grows from PUSH of its fitted size to all of it, evenly, so the
// camera creeps toward it and never past the band it is fitted into. Reduced motion: it stays at the end.
export const PUSH = 0.9;
export const pushAt = (p) => PUSH + (1 - PUSH) * Math.min(1, Math.max(0, p));

// the light: the only warm-lit chapter, so it reads as a memory. One amber key from the side, the room
// reflection and the cyan rim almost gone (lighting.js setWarmth), no roofline light or floor glow.
// LIGHT is the full warm look; the key's level rises to it with the word (levelAt).
export const LIGHT = { key: 1, silhouette: 0, warmth: 1 };

// The word and the light, in step. J comes in with the mark as the chapter rises (story.css, from its
// entry), and the chapter starts fully black: key, room fill, rim, floor glow and the car's own lamps all
// at 0, and the canvas transparent (story.css, from --lv). Then E, S, K and O arrive one by one over the
// pinned scroll, each over LETTER of p, LETTER_STEP apart from WORD_FROM, and the warm light rises with
// them: a quarter of the way up as each letter completes, all of it as the O does (p 0.42), before the
// lines begin (0.48). Scrolling back takes it back to black. story.css reads the same numbers.
export const WORD_FROM = 0.03, LETTER = 0.12, LETTER_STEP = 0.09, LETTERS = 4;
export const WORD_TO = WORD_FROM + LETTER_STEP * (LETTERS - 1) + LETTER; // 0.42
export function levelAt(p) {
  return Math.min(1, Math.max(0, (p - WORD_FROM) / (WORD_TO - WORD_FROM)));
}

// as the chapter's frame lets go (its exit x), the car goes dark before the next chapter's words rise
// to where it sits: fully there at x 0, gone by x GONE_BY (Chapter II's words begin at its entry 0.24,
// and its entry is this chapter's exit). Eased at both ends.
export const GONE_BY = 0.22;
export function presenceAt(x) {
  const t = Math.min(1, Math.max(0, x / GONE_BY));
  return 1 - t * t * (3 - 2 * t);
}

// The stills: one per paint (the visitor's Chapter V choice is on the live car when they scroll back up),
// the car at the shot cut to its fitted box plus STILL_PAD of that box on each side for the ground
// shadow. The page fits the box into the same band as the live car (name.js) and scales it with the
// push-in, so the still lands exactly where the live car does.
export const STILL_PAD = 0.1;
export const STILL = { size: [1600, 1200], widths: [800, 1600] };
