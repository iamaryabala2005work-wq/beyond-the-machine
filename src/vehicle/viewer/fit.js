// Fitting a car into a part of the screen, at every heading it can be turned to.
//
// Chapter V lets the visitor turn the car all the way round (and the page turns it too), so its framing
// cannot be tuned for one angle: the car must stay inside the free band between the chapter's words and
// its swatches whichever way it faces. fitTurntable() looks at the car from `steps` headings around it at
// the shot's height, takes the union of everything it covers on screen (from points sampled off the
// car's own meshes, model.js, so the box follows the silhouette rather than the bounding box's corners),
// and returns the zoom that makes that union fit the rect and the frame shift that centres it there.
//
// Used by the live viewer (viewer.js fitShot) and by the poster renderer (scripts/posters/render.js), so
// a still of the chapter and the live car land in the same place. Pure three.js maths: no DOM, no frame.
import * as THREE from 'three';

const ITERATIONS = 4;

// cam: a camera with the canvas's fov and aspect (it is moved; pass a clone). place(cam, shot): puts it
// at a shot (camera-rig.js placeAt). points: Float32Array of xyz. shot: { azimuth, polar, zoom, target }.
// rect: { left, top, right, bottom } as fractions of the canvas (0..1, y down).
// Returns { zoom, x, y, box }: x, y the frame shift (fractions of the width and height, positive right
// and down, as viewer.setFrameShift takes them), box the union's place on screen once shifted.
export function fitTurntable({ cam, place, points, shot, rect, steps = 16 }) {
  const v = new THREE.Vector3();
  const rw = rect.right - rect.left, rh = rect.bottom - rect.top;
  let zoom = shot.zoom ?? 1;
  let b = null;
  for (let i = 0; i < ITERATIONS; i++) {
    b = union(cam, place, points, { ...shot, zoom }, steps, v);
    // what is seen scales with 1 / distance, near enough; a few rounds take up the perspective's share
    const s = Math.max((b.right - b.left) / rw, (b.bottom - b.top) / rh);
    zoom *= s;
    if (Math.abs(s - 1) < 0.002) break;
  }
  b = union(cam, place, points, { ...shot, zoom }, steps, v);
  const x = (rect.left + rect.right) / 2 - (b.left + b.right) / 2;
  const y = (rect.top + rect.bottom) / 2 - (b.top + b.bottom) / 2;
  return { zoom, x, y, box: { left: b.left + x, right: b.right + x, top: b.top + y, bottom: b.bottom + y } };
}

// where the car is on screen from one shot, as fractions of the canvas (no frame shift)
export function bounds(cam, place, points, shot, v = new THREE.Vector3()) {
  place(cam, shot);
  const b = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (let i = 0; i < points.length; i += 3) {
    v.set(points[i], points[i + 1], points[i + 2]).project(cam);
    const x = (v.x + 1) / 2, y = (1 - v.y) / 2;
    if (x < b.left) b.left = x; if (x > b.right) b.right = x;
    if (y < b.top) b.top = y; if (y > b.bottom) b.bottom = y;
  }
  return b;
}

function union(cam, place, points, shot, steps, v) {
  const u = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (let k = 0; k < steps; k++) {
    const b = bounds(cam, place, points, { ...shot, azimuth: (shot.azimuth ?? 0) + (360 * k) / steps }, v);
    u.left = Math.min(u.left, b.left); u.right = Math.max(u.right, b.right);
    u.top = Math.min(u.top, b.top); u.bottom = Math.max(u.bottom, b.bottom);
  }
  return u;
}

