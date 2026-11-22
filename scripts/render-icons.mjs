// The favicon set, from the site's J mark (public/favicon.svg: the Geist "J" outlined on the accent tile,
// the same mark as the nav's .mark--initial, with no font needed to draw it):
//   public/favicon.ico            16, 32 and 48 px, for browsers and crawlers that ask for /favicon.ico
//   public/apple-touch-icon.png   180 px, full bleed (iOS rounds the corners itself)
//
//   node scripts/render-icons.mjs
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const svg = await readFile(`${root}public/favicon.svg`, 'utf8');
const png = (s, size) => sharp(Buffer.from(s), { density: 72 * size / 24 * 4 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

// .ico: a directory of PNG images (supported everywhere .ico is read since Windows Vista)
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((s) => png(svg, s)));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(s, e); head.writeUInt8(s, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(images[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
await writeFile(`${root}public/favicon.ico`, Buffer.concat([head, ...images]));

// the touch icon: the tile without its rounding, and the J a little smaller inside it (iOS crops to a squircle)
const touch = svg.replace(/<rect[^>]*\/>/, '<rect width="24" height="24" fill="#7fe0ee"/>')
  .replace('<path', '<path transform="translate(12 12) scale(.86) translate(-12 -12)"');
await writeFile(`${root}public/apple-touch-icon.png`, await sharp(await png(touch, 180)).flatten({ background: '#7fe0ee' }).png({ compressionLevel: 9 }).toBuffer());
console.log('icons: public/favicon.ico (16, 32, 48), public/apple-touch-icon.png (180)');
