// Renders the site's still images of the car from the 3D model itself, so no photograph of a real car (and
// no maker's badge) is ever on the page:
//   public/vehicle/posters/hero-{960,1600,2400}.webp   the hero poster: the first paint, the fallback when
//                                                      there is no 3D, the story's fallback and the scan mask
//   public/vehicle/posters/detail-{800,1400}.webp      the close view in the specifications section
//   public/vehicle/posters/power-{stack,split}-lit.webp
//                                                      Chapter III's stage at the end of its light reveal (the
//                                                      start is the black page), per layout
//                                                      (src/story/chapters/power-look.js)
//   public/vehicle/posters/yours-<paint>-{800,1600}.webp
//                                                      Chapter V's car at the start of its turntable, once
//                                                      per paint, cut to the box the live car is fitted
//                                                      into (src/story/chapters/yours-look.js)
//   public/vehicle/posters/close-<paint>-{800,1600}.webp
//                                                      Chapter VI's final shot, once per paint, cut the same
//                                                      way (src/story/chapters/close-look.js)
//   public/share.jpg                                   the link-preview card
// The shots come from the manifest's "posters" block (model-agnostic: a new car brings its own), and the
// car is drawn by the viewer's own model, light and camera code (scripts/posters/render.js), in a headless
// browser served by Vite. After a render, public/vehicle/posters/posters.json records the inputs' hash
// (scripts/posters/stamp.mjs); `vite build` re-runs this script whenever that hash is out of date.
//
//   npm run posters            render (needs Google Chrome, or a Playwright Chromium: npx playwright install chromium)
//   npm run posters -- --check exit 1 when the posters are out of date, without rendering
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { STAMP, manifestUrl, postersHash, stampedHash } from './posters/stamp.mjs';
import { POSTERS as POWER, lightAt } from '../src/story/chapters/power-look.js';
import { LIGHT as YOURS_LIGHT, STILL as YOURS_STILL, STILL_PAD } from '../src/story/chapters/yours-look.js';
import { LIGHT as CLOSE_LIGHT, STILL as CLOSE_STILL, STILL_PAD as CLOSE_PAD } from '../src/story/chapters/close-look.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const OUT = 'public/vehicle/posters';
const SCALE = 2; // rendered at twice the largest size and scaled down: smooth edges on the cut-out
const WEBP = { quality: 80, alphaQuality: 88, effort: 6, smartSubsample: true };
// the close view is mostly fine paint flake, which costs bytes and is not read at its full detail
const WEBP_DETAIL = { ...WEBP, quality: 64, alphaQuality: 70 };

const inputs = postersHash();
if (process.argv.includes('--check')) {
  const fresh = stampedHash() === inputs;
  console.log(fresh ? 'posters: up to date' : 'posters: out of date (run npm run posters)');
  process.exit(fresh ? 0 : 1);
}

const url = manifestUrl();
const manifest = JSON.parse(await readFile(`${root}public${url}`, 'utf8'));
const posters = manifest.posters;
if (!posters?.hero) throw new Error(`${url} has no "posters.hero" shot`);

// a browser with WebGL: the installed Google Chrome, else Playwright's Chromium, else $CHROME_PATH
async function launch() {
  const args = ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];
  const tries = [
    process.env.CHROME_PATH && { executablePath: process.env.CHROME_PATH },
    { channel: 'chrome' },
    {},
  ].filter(Boolean);
  let last;
  for (const t of tries) {
    try { return await chromium.launch({ ...t, args }); } catch (err) { last = err; }
  }
  throw new Error(`no browser to render the posters with. Install Google Chrome, run "npx playwright install chromium", or set CHROME_PATH.\n${last?.message ?? ''}`);
}

// the bounds of what is drawn (alpha above a threshold), in pixels
async function alphaBounds(png, threshold = 16) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('the render is empty: the shot does not see the car');
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

// configFile: false: the site's vite.config.js (which checks the posters) is not loaded by this server
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'mpa',
  server: { port: 0, strictPort: false }, optimizeDeps: { entries: ['scripts/posters/render.html'] } });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await launch();
const written = {};
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[render page]', e.message));
  await page.goto(`${base}/scripts/posters/render.html`);
  await page.waitForFunction(() => window.posterReady === true, null, { timeout: 60000 });
  const render = async (shot, width, height, shadow, extra = {}) => {
    const dataUrl = await page.evaluate((o) => window.renderPoster(o), { manifestUrl: url, shot, width, height, scale: SCALE, shadow, ...extra });
    return Buffer.from(dataUrl.split(',')[1], 'base64');
  };
  await mkdir(`${root}${OUT}`, { recursive: true });

  // the hero: a cut-out. Rendered roomy, cut to the car, centred on a canvas of the poster's size (the
  // page lays it out with object-fit: contain). No ground shadow: the stage's CSS draws one under the image.
  {
    const p = posters.hero;
    const [W, H] = p.size;
    const png = await render(p.shot, W, Math.round(W * 0.75), false);
    const b = await alphaBounds(png);
    const rw = W * SCALE, rh = Math.round(W * 0.75) * SCALE;
    if (b.left === 0 || b.top === 0 || b.left + b.width >= rw || b.top + b.height >= rh) {
      throw new Error('posters.hero: the shot crops the car; raise its zoom');
    }
    const pad = Math.round(Math.max(b.width, b.height) * 0.01);
    const cut = await sharp(png).extract({ left: Math.max(0, b.left - pad), top: Math.max(0, b.top - pad),
      width: b.width + 2 * pad, height: b.height + 2 * pad }).png().toBuffer();
    const master = await sharp(cut).resize({ width: W * SCALE, height: H * SCALE, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    for (const w of p.widths) {
      const file = `${OUT}/hero-${w}.webp`;
      const info = await sharp(master).resize({ width: w }).webp(WEBP).toFile(`${root}${file}`);
      written[file] = info.size;
    }
    written.heroMaster = master;
  }

  // the detail: a close view framed by its shot, edge to edge, with the car's own ground shadow
  if (posters.detail) {
    const p = posters.detail;
    const [W, H] = p.size;
    const raw = await render(p.shot, W, H, true);
    // the ground shadow fades out over the last quarter instead of stopping at the frame's edge
    const fade = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}"><defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0.72" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#f)"/></svg>`);
    const png = await sharp(raw).composite([{ input: fade, blend: 'dest-in' }]).png().toBuffer();
    for (const w of p.widths) {
      const file = `${OUT}/detail-${w}.webp`;
      const info = await sharp(png).resize({ width: w }).webp(WEBP_DETAIL).toFile(`${root}${file}`);
      written[file] = info.size;
    }
  }

  // Chapter III's stage: the car as the chapter frames and lights it at the end of the light reveal (the
  // page fades it up from black, so the start needs no image). Drawn at the stage's own shape, edge to edge, so the page lays them over the stage
  // exactly where the live car will be.
  {
    const base = manifest.camera?.shots?.power;
    if (!base) throw new Error(`${url} has no camera.shots.power`);
    const { compact, ...wide } = base;
    for (const [layout, { size: [W, H], frame }] of Object.entries(POWER)) {
      const s = layout === 'stack' && compact ? { ...wide, ...compact } : wide;
      const shot = { ...s, zoom: (s.zoom ?? 1) * frame.zoom };
      for (const [end, L] of [['lit', 1]]) {
        const png = await render(shot, W / SCALE, H / SCALE, true, { offset: [frame.x, frame.y], light: lightAt(L) });
        const file = `${OUT}/power-${layout}-${end}.webp`;
        const info = await sharp(png).resize({ width: W }).webp(WEBP).toFile(`${root}${file}`);
        written[file] = info.size;
      }
    }
  }

  // a chapter's fitted still, once per paint: fitted as the live chapter fits the car (fit.js: at every
  // heading for Chapter V, at the shot's own for Chapter VI), then cut to that box plus pad of it on each
  // side for the ground shadow. Every paint gives the same box, so one width and height serve them all.
  const paints = (manifest.variants?.paint ?? []).map((v) => v.id);
  if (!paints.length) paints.push(null);
  async function fittedStills(name, { shot, size: [W, H], widths }, pad, light, fitSteps) {
    if (!shot) throw new Error(`${url} has no camera.shots.${name}`);
    const m = pad + 0.04; // the box sits in the middle with room around it for the pad
    let shape = null;
    for (const paint of paints) {
      const { png: dataUrl, box } = await page.evaluate((o) => window.renderPoster(o), { manifestUrl: url, shot, width: W, height: H, scale: SCALE,
        shadow: true, light, paint, fitSteps, fitRect: { left: m, top: m, right: 1 - m, bottom: 1 - m } });
      const png = Buffer.from(dataUrl.split(',')[1], 'base64');
      const bw = (box.right - box.left) * W * SCALE, bh = (box.bottom - box.top) * H * SCALE;
      const crop = { left: Math.round(box.left * W * SCALE - bw * pad), top: Math.round(box.top * H * SCALE - bh * pad),
        width: Math.round(bw * (1 + 2 * pad)), height: Math.round(bh * (1 + 2 * pad)) };
      if (crop.left < 0 || crop.top < 0 || crop.left + crop.width > W * SCALE || crop.top + crop.height > H * SCALE) {
        throw new Error(`${name} still: the padded box leaves the render; lower its STILL_PAD`);
      }
      const cut = await sharp(png).extract(crop).png().toBuffer();
      for (const w of widths) {
        const file = `${OUT}/${name}-${paint ?? 'default'}-${w}.webp`;
        const info = await sharp(cut).resize({ width: w }).webp(WEBP).toFile(`${root}${file}`);
        written[file] = info.size;
      }
      shape = [crop.width, crop.height];
    }
    shapes[name] = shape;
  }
  const shapes = {};
  await fittedStills('yours', { shot: manifest.camera?.shots?.yours, ...YOURS_STILL }, STILL_PAD, YOURS_LIGHT, 16);
  await fittedStills('close', { shot: manifest.camera?.shots?.close, ...CLOSE_STILL }, CLOSE_PAD, CLOSE_LIGHT, 1);
  written.shapes = shapes;

  // the link-preview card: the new hero poster on the site's ground, the title and the concept label
  {
    const card = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    const carUrl = `data:image/webp;base64,${(await sharp(written.heroMaster).resize({ width: 1600 }).webp(WEBP).toBuffer()).toString('base64')}`;
    await card.goto(`${base}/scripts/posters/share.html`);
    await card.evaluate((src) => window.setCar(src), carUrl);
    const shot = await card.screenshot({ type: 'png' });
    const info = await sharp(shot).jpeg({ quality: 84, mozjpeg: true }).toFile(`${root}public/share.jpg`);
    written['public/share.jpg'] = info.size;
  }
  delete written.heroMaster;
  for (const [name, shape] of Object.entries(written.shapes)) console.log(`${name} stills: ${shape.join(' x ')} (index.html's width and height on the ${name} still must keep this shape)`);
  delete written.shapes;
} finally {
  await browser.close();
  await server.close();
}

const files = Object.fromEntries(Object.entries(written).map(([f, n]) => [f.replace(/^public/, ''), n]));
await writeFile(`${root}${STAMP}`, JSON.stringify({
  $comment: 'Written by scripts/render-posters.mjs. "inputs" is the hash of what the posters are made from (scripts/posters/stamp.mjs); vite build re-renders when it no longer matches.',
  inputs, manifest: url, files,
}, null, 2) + '\n');
for (const [f, n] of Object.entries(files)) console.log(`${f}  ${(n / 1024).toFixed(1)} KB`);
console.log(`posters: rendered (inputs ${inputs})`);
