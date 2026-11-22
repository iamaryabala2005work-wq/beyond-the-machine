// Chapter V, Yours: choose the paint, and turn the car yourself.
//
// entry        the mark and the word come in as the chapter rises (CSS, from --e; blur on desktop only)
// swatches     one outlined pill per paint in the manifest (variants.paint: a dot and a name), arriving
//              over p 0..0.2 (CSS). Choosing one repaints the live car over 600 ms (viewer.setPaint:
//              uniform values only, so no shader recompiles) and the mono readout names the finish. The
//              choice is kept (paint.js) and put back on the car when it next enters the story, and the
//              close (Chapter VI) shows the car in it.
// car          the manifest's "yours" shot, fitted into the band between the words and the swatches so
//              that no heading of the car ever reaches either (fit.js); the band is measured on resize.
//              It turns TURN degrees across the chapter (yours-look.js), eased by story.js's spring, and a
//              drag or a sideways swipe turns it too (the rig's turn mode): the page's turn adds to the
//              visitor's. The pose is set while the canvas is hidden (story.js), never swung into view. The
//              turn ends on Chapter VI's heading (the full side view), and VI takes the live car on from
//              wherever it is (story.js: pose(), resume()), so the two chapters show one car throughout.
// still        the stage's stand-in for the live car (story.js) is a render of this shot in the paint the
//              live car wears (one still per paint, paint.js), so a change of chapter never shows the car
//              in another colour.
// no 3D        the swatches stay as labelled chips, not buttons, with the note "Preview needs the 3D
//              model", and the still keeps the default paint: there is no live car to have chosen.
// Reduced motion: no turntable, and a paint change is instant.
import { turnAt, LIGHT, STILL_PAD } from './yours-look.js';
import { paintChoice, showStill, placeStill } from '../paint.js';

const DEG = Math.PI / 180;
const GAP = 16;     // px kept clear between the car and the words above it
const GAP_FOOT = 28; // and above the finish and the swatches (the car's ground shadow reaches past its wheels)

export function createYours(el, { stage }) {
  const frame = el.querySelector('.chapter__frame');
  const head = el.querySelector('[data-yours-head]');
  const controls = el.querySelector('[data-yours-controls]');
  const group = el.querySelector('[data-swatches]');
  const readout = el.querySelector('[data-finish]');
  const note = el.querySelector('[data-yours-note]');
  const still = stage.querySelector('[data-still="yours"]');
  let viewer = null;      // the live car, while there is one (not in poster mode)
  let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let paints = [];        // { id, label, color, default }
  let current = null;
  let rect = null;        // the free band, as fractions of the frame
  let lastFit = null, lastTurn = 0;

  // ---- the swatches: from the live car's manifest, or (no 3D) the manifest itself; the page's own
  // markup is the list until then
  function render(list) {
    if (!list.length) return;
    paints = list;
    current ??= (list.find((v) => v.id === paintChoice.get()) ?? list.find((v) => v.default) ?? list[0]).id;
    group.replaceChildren(...list.map((v) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn--outline yours__swatch';
      b.dataset.paint = v.id;
      const dot = document.createElement('span');
      dot.className = 'yours__dot';
      dot.style.setProperty('--dot', v.color);
      dot.setAttribute('aria-hidden', 'true');
      b.append(dot, v.label);
      return b;
    }));
    sync();
  }
  function sync() {
    const live = Boolean(viewer);
    for (const b of group.children) {
      b.disabled = !live;
      if (live) b.setAttribute('aria-pressed', String(b.dataset.paint === current));
      else b.removeAttribute('aria-pressed');
    }
    note.hidden = live;
    el.toggleAttribute('data-preview', live);
    const v = paints.find((x) => x.id === current);
    if (v && readout.textContent !== v.label) readout.textContent = v.label;
    // the still wears the live car's paint; with no live car, the default
    const shown = live ? current : (paints.find((x) => x.default) ?? paints[0])?.id;
    showStill(still, shown);
  }
  group.addEventListener('click', (e) => {
    const b = e.target.closest('[data-paint]');
    if (!b || b.disabled || !viewer) return;
    current = b.dataset.paint;
    viewer.setPaint(current, { instant: reduced });
    paintChoice.set(current);
    sync();
  });
  // with no live car, the list still comes from the manifest (the markup's copy is the no-script one)
  const manifestUrl = document.querySelector('[data-vehicle-model]')?.dataset.vehicleModel;
  const idle = window.requestIdleCallback ?? ((f) => setTimeout(f, 200));
  if (manifestUrl) idle(() => fetch(manifestUrl).then((r) => r.json()).then((m) => {
    if (paints.length) return; // the live car's list came first
    render((m.variants?.paint ?? []).map((v) => ({ id: v.id, label: v.label, color: v.set?.color, default: Boolean(v.default) })));
  }).catch(() => {}));

  // ---- the free band: under the words, over the swatches, inside the page's side gutters
  function measure() {
    const f = frame.getBoundingClientRect();
    const h = head.getBoundingClientRect();
    const c = controls.getBoundingClientRect();
    const cs = getComputedStyle(controls);
    const W = Math.max(1, f.width), H = Math.max(1, f.height);
    const left = c.left - f.left + parseFloat(cs.paddingLeft);
    const right = c.right - f.left - parseFloat(cs.paddingRight);
    const top = h.bottom - f.top + GAP;
    const bottom = c.top - f.top - GAP_FOOT;
    rect = { left: left / W, right: right / W, top: top / H, bottom: Math.max(top + 1, bottom) / H };
    // the still, fitted into the band as the live car is (its picture is the fitted box plus STILL_PAD)
    placeStill(still, left, top, right, Math.max(top + 1, bottom), STILL_PAD);
  }

  return {
    update() {},
    measure,
    level: () => 1,
    // the car is the visitor's to turn here (story.js puts the rig in turn mode and lets the canvas
    // take pointer input)
    handsOn: true,
    // the stage's state (story.js): 'poster' means no live car
    state(state, handle) {
      const next = state === 'poster' ? null : handle;
      if (next === viewer) return;
      viewer = next;
      if (viewer) render(viewer.paints());
      sync();
    },
    // the car has moved into the story: the visitor's earlier choice goes back on, unseen (the canvas is
    // still hidden)
    enter(handle) {
      const id = paintChoice.get();
      if (id && handle.paints().some((v) => v.id === id)) { handle.setPaint(id, { instant: true }); current = id; }
      else current = handle.paint();
      sync();
    },
    setReduced(r) { reduced = r; },
    // the pose the car is in now, for the chapter that continues from this one (Chapter VI glides from it,
    // story.js): the heading wherever the page and the visitor's hand have it
    pose(v) {
      const base = v.shot('yours');
      const fit = lastFit ?? { zoom: base.zoom ?? 1, y: 0, x: 0 };
      return { shot: { ...base, azimuth: v.azimuth() / DEG, zoom: fit.zoom }, shift: [fit.y, fit.x], key: LIGHT.key, silhouette: LIGHT.silhouette };
    },
    // the car handed back from Chapter VI, which has brought it back to exactly that pose: the turntable
    // goes on from there (no new pose, so nothing moves)
    resume(v) {
      if (!lastFit) return;
      v.setFrameShift(lastFit.y, lastFit.x);
      v.setKey(LIGHT.key);
      v.setSilhouette(LIGHT.silhouette);
      v.setSweep(0, 0);
      v.setMode('turn');
    },
    camera(v, p, { reduced: r, fresh }) {
      if (!rect) measure();
      const base = v.shot('yours');
      const fit = v.fitShot(base, rect);
      if (!fit) return;
      const turn = r ? 0 : turnAt(p);
      if (fresh || fit !== lastFit) {
        // a new pose (entering, or a new size): set it in story mode, then hand the car over. On a new
        // size the heading stays where the visitor and the page had it.
        const azimuth = fresh ? base.azimuth + turn : v.azimuth() / DEG;
        v.setMode('story');
        v.setFrameShift(fit.y, fit.x);
        v.setKey(LIGHT.key);
        v.setSilhouette(LIGHT.silhouette);
        v.setSweep(0, 0);
        const shot = { ...base, azimuth, zoom: fit.zoom };
        v.pose(shot, shot, 0);
        v.setMode('turn');
        lastFit = fit;
        lastTurn = turn;
        return;
      }
      if (turn !== lastTurn) { v.turnBy((turn - lastTurn) * DEG); lastTurn = turn; }
    },
  };
}
