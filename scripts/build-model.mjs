// Model pipeline: one source GLB in, two web GLBs out (desktop and mobile), the same for any car.
//
//   node scripts/build-model.mjs <source.glb> <public/vehicle/models/<id>>
//   npm run model   (the current stand-in)
//
// Steps: optional simplification of the dense parts the manifest names, stored tangents dropped, dedup, prune, WebP textures
// (1024 px on both tiers), meshopt geometry compression.
//
// The body is never simplified (it bends the reflections on the paint). Only the parts named in the
// manifest's build.simplify.match (node names: wipers, tyre tread, brake pads...) are thinned, by
// build.simplify.error (a fraction of each part's size), more on mobile.
//
// It never joins, flattens, instances or palettes: those merge meshes and materials, and the viewer finds
// wheels, paint and glass by their names through the manifest.
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, meshopt, weldPrimitive, simplifyPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [src, outDir] = process.argv.slice(2);
if (!src || !outDir) {
  console.error('usage: node scripts/build-model.mjs <source.glb> <out-dir>');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const manifestPath = join(outDir, 'manifest.json');
const build = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).build ?? {} : {};

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const tiers = [
  { tier: 'desktop', size: 1024, errorScale: 1 },
  // mobile keeps desktop's 1024 px textures: phones sit close to the eye at 2-3x density, and the shared
  // ambient-occlusion map (25 materials) at 512 px blurred every panel gap. It costs ~0.15 MB of download.
  { tier: 'mobile', size: 1024, errorScale: 3 },
];

for (const { tier, size, errorScale } of tiers) {
  const doc = await io.read(src);
  let thinned = 0;
  if (build.simplify?.match) {
    const re = new RegExp(build.simplify.match);
    const error = (build.simplify.error ?? 0.002) * errorScale;
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh || !re.test(node.getName())) continue;
      for (const prim of mesh.listPrimitives()) {
        weldPrimitive(prim);
        simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: 0, error, lockBorder: true });
      }
      thinned++;
    }
  }
  // three.js derives tangents for normal maps in the shader, so the stored ones are dead weight
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) prim.setAttribute('TANGENT', null);
  await doc.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size] }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  const out = join(outDir, `model-${tier}.glb`);
  await io.write(out, doc);
  console.log(`${tier}: ${out} ${(statSync(out).size / 1024 / 1024).toFixed(2)} MB (${thinned} parts simplified)`);
}
