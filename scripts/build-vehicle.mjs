// Builds the temporary vehicle images from the master cut-out in assets-src/.
// The master is a Wikimedia Commons photograph (CC BY-SA 4.0, see public/credits.html), cut out with
// macOS Vision (tools/lift.swift), graded toward graphite and with a third-party sticker softened
// (tools/patch.swift). When the GLB arrives (Phase 3) this script also renders the poster from it.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const SRC = 'assets-src/jesko-absolut-cutout.png';
const OUT = 'public/vehicle';
await mkdir(OUT, { recursive: true });

// 1. the hero cut-out at three widths (transparent WebP)
for (const w of [960, 1600, 2400]) {
  const info = await sharp(SRC).resize({ width: w }).webp({ quality: 82, alphaQuality: 90, effort: 6 })
    .toFile(`${OUT}/jesko-absolut-${w}.webp`);
  console.log(`hero ${w}: ${info.width}x${info.height} ${(info.size / 1024).toFixed(0)} KB`);
}

// 2. the front-quarter detail for the specs section: headlight, front wheel and splitter
const detail = { left: 1050, top: 667, width: 1900, height: 1267 };
for (const w of [800, 1400]) {
  const info = await sharp(SRC).extract(detail).resize({ width: w }).webp({ quality: 82, alphaQuality: 90, effort: 6 })
    .toFile(`${OUT}/jesko-absolut-front-${w}.webp`);
  console.log(`detail ${w}: ${info.width}x${info.height} ${(info.size / 1024).toFixed(0)} KB`);
}
