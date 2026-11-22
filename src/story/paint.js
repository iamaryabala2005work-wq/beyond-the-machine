// The visitor's paint, shared by the chapters that show it: chosen in Chapter V (yours.js), carried into
// the close (close.js). Kept in localStorage (inside try/catch: private mode or storage turned off keeps
// it for the visit only). Until a choice is made it is null, and each chapter shows the default paint.
//
// Also the stills of a painted car: each chapter that has one renders it once per paint
// (scripts/render-posters.mjs: /vehicle/posters/<chapter>-<paint>-<width>.webp), so a still of the car in
// the visitor's paint is a render of the model in that paint, never a tinted picture.
const STORE = 'btm.paint';
let current = read();
const listeners = new Set();

function read() {
  try { return localStorage.getItem(STORE); } catch { return null; }
}

export const paintChoice = {
  get: () => current,
  // keep: false for a choice put back on the car rather than made (not written again)
  set(id, { keep = true } = {}) {
    if (!id) return;
    if (keep) { try { localStorage.setItem(STORE, id); } catch { /* the choice lasts the visit */ } }
    if (id === current) return;
    current = id;
    listeners.forEach((f) => f(id));
  },
  on(f) { listeners.add(f); return () => listeners.delete(f); },
};

// shows a chapter's still in paint id: img carries data-still-base (/vehicle/posters/close) and
// data-still-widths (800,1600). The new picture is loaded and decoded first and only then swapped in, so
// the stage never shows a gap; if it cannot load, the one shown stays.
export function showStill(img, id) {
  if (!img || !id || img.dataset.stillPaint === id) return;
  const base = img.dataset.stillBase;
  const widths = (img.dataset.stillWidths ?? '').split(',').filter(Boolean);
  if (!base || !widths.length) return;
  const was = img.dataset.stillPaint;
  img.dataset.stillPaint = id;
  const srcset = widths.map((w) => `${base}-${id}-${w}.webp ${w}w`).join(', ');
  const src = `${base}-${id}-${widths[widths.length - 1]}.webp`;
  const next = new Image();
  next.sizes = img.sizes;
  next.srcset = srcset;
  next.src = src;
  next.decode().then(() => {
    if (img.dataset.stillPaint !== id) return; // another paint was asked for meanwhile
    img.srcset = srcset;
    img.src = src;
  }).catch(() => { if (img.dataset.stillPaint === id) img.dataset.stillPaint = was ?? ''; });
}

// places a still whose picture is a fitted box plus pad of it on each side, so that box lands on the
// rect (l, t, r, b in px of the stage) as the live car is fitted there; centred in the rect
export function placeStill(img, l, t, r, b, pad) {
  if (!img) return;
  const iw = Number(img.getAttribute('width')) || 16, ih = Number(img.getAttribute('height')) || 9;
  // the picture's shape without its pad is the box's
  const bw = iw / (1 + 2 * pad), bh = ih / (1 + 2 * pad);
  const k = Math.min((r - l) / bw, (b - t) / bh);
  const w = bw * k, h = bh * k;
  const bx = l + (r - l - w) / 2, by = t + (b - t - h) / 2;
  Object.assign(img.style, { left: `${bx - w * pad}px`, top: `${by - h * pad}px`, width: `${w * (1 + 2 * pad)}px`, height: `${h * (1 + 2 * pad)}px` });
}
