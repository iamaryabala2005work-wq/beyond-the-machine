// What the posters are made from, as one hash. scripts/render-posters.mjs writes it into
// public/vehicle/posters/posters.json after a render; the site build (vite.config.js, postersUpToDate)
// compares it with the current inputs and re-renders when they differ, so a new model, a new manifest
// (its finishes, hidden parts, shots) or a change to the code that draws the car never ships with
// posters of the old one.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root));

// the code that decides how the car looks in a poster
const CODE = [
  'scripts/render-posters.mjs',
  'scripts/posters/render.html',
  'scripts/posters/render.js',
  'scripts/posters/share.html',
  'src/vehicle/viewer/model.js',
  'src/vehicle/viewer/lighting.js',
  'src/vehicle/viewer/camera-rig.js',
  'src/story/chapters/power-look.js',
  'src/story/chapters/yours-look.js',
  'src/vehicle/viewer/fit.js',
];
export const STAMP = 'public/vehicle/posters/posters.json';

// the manifest the hero stage names (index.html data-vehicle-model), as a public URL
export function manifestUrl() {
  return read('index.html').toString().match(/data-vehicle-model="([^"]+)"/)?.[1];
}

export function postersHash() {
  const url = manifestUrl();
  const manifest = JSON.parse(read(`public${url}`));
  const h = createHash('sha256');
  h.update(url);
  // the model files are content-hashed in their names, so the manifest's text covers the model too;
  // the desktop file is the one rendered, read here as well so a file replaced in place still counts
  h.update(JSON.stringify(manifest));
  h.update(read(`public${manifest.src.desktop}`));
  for (const f of CODE) h.update(f).update(read(f));
  return h.digest('hex').slice(0, 16);
}

export function stampedHash() {
  const file = new URL(STAMP, root);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')).inputs ?? null; } catch { return null; }
}
