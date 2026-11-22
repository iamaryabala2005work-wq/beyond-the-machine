// Model pipeline: one source GLB in, two web GLBs out (desktop and mobile), the same for any car.
//
//   node scripts/build-model.mjs <source.glb> <public/vehicle/models/<id>>
//   npm run model   (the current stand-in)
//
// Steps: optional simplification of the dense parts the manifest names, stored tangents dropped, dedup, prune, WebP textures
// (desktop 1024 px; mobile 512 px except the ambient-occlusion maps, kept at 1024), meshopt geometry compression.
//
// Each file is named after its content (model-mobile.<hash>.glb), so it can be cached for a year
// (vercel.json); the script writes the new names into the manifest's "src" and deletes that tier's older
// builds. The manifest itself is revalidated on every visit, so a new build reaches visitors at once.
//
// The body is never simplified (it bends the reflections on the paint). Only the parts named in the
// manifest's build.simplify.match (node names: wipers, tyre tread, brake pads...) are thinned, by
// build.simplify.error (a fraction of each part's size), more on mobile.
//
// It never joins, flattens, instances or palettes: those merge meshes and materials, and the viewer finds
// wheels, paint and glass by their names through the manifest.
//
// Before anything is built, the manifest's paint variants (variants.paint, Chapter V) are checked: a
// variant may set only color, metalness, roughness and clearcoatRoughness, the values the viewer blends
// as uniforms. Anything else (a texture, transmission, iridescence, clearcoat to or from 0...) changes
// which shader the paint needs, and a swatch would stall the page recompiling it. A bad variant stops
// the build. To check a manifest without building:
//   node scripts/build-model.mjs --check <public/vehicle/models/<id>>
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, meshopt, weldPrimitive, simplifyPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const checkOnly = process.argv[2] === '--check';
const [src, outDir] = checkOnly ? [null, process.argv[3]] : process.argv.slice(2);
if ((!src && !checkOnly) || !outDir) {
  console.error('usage: node scripts/build-model.mjs <source.glb> <out-dir>\n       node scripts/build-model.mjs --check <out-dir>');
  process.exit(1);
}
const manifestPath = join(outDir, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

// ---- the paint variants: only values the viewer can change without a new shader
const VARIANT_KEYS = new Set(['color', 'metalness', 'roughness', 'clearcoatRoughness']);
function checkPaintVariants(m) {
  const list = m.variants?.paint;
  if (list === undefined) return [];
  const errors = [];
  if (!Array.isArray(list) || !list.length) return ['variants.paint must be a non-empty list'];
  const base = m.materials?.paint?.set ?? {};
  if (!m.materials?.paint?.match) errors.push('variants.paint needs materials.paint.match: the material the variants apply to');
  // the paint's clearcoat as the file and the finish leave it, which every variant shares
  const coat = base.clearcoat;
  if (coat !== undefined && !(coat > 0)) errors.push(`materials.paint.set.clearcoat is ${coat}: a clearcoated paint (clearcoat above 0) is what the variants are tuned for`);
  const ids = new Set();
  let defaults = 0;
  for (const [i, v] of list.entries()) {
    const at = `variants.paint[${i}]${v?.id ? ` (${v.id})` : ''}`;
    if (!v?.id || !v?.label) errors.push(`${at}: needs an id and a label`);
    if (ids.has(v?.id)) errors.push(`${at}: the id is used twice`);
    ids.add(v?.id);
    if (v?.default) defaults++;
    for (const [k, value] of Object.entries(v?.set ?? {})) {
      if (k === 'clearcoat') {
        // named here on its own: the switch between none and some is the costly one
        if ((value > 0) !== ((coat ?? 0) > 0)) errors.push(`${at}: sets clearcoat ${value}, ${value > 0 ? 'from' : 'to'} 0 (the paint's is ${coat ?? 0}); that recompiles the paint's shader`);
        else errors.push(`${at}: sets clearcoat; a variant may set only ${[...VARIANT_KEYS].join(', ')}`);
      } else if (!VARIANT_KEYS.has(k)) {
        errors.push(`${at}: sets ${k}; a variant may set only ${[...VARIANT_KEYS].join(', ')} (anything else can recompile the paint's shader)`);
      } else if (k === 'color' ? !/^#[0-9a-f]{6}$/i.test(value) : !(typeof value === 'number' && value >= 0 && value <= 1)) {
        errors.push(`${at}: ${k} ${JSON.stringify(value)} is not ${k === 'color' ? 'a #rrggbb colour' : 'a number from 0 to 1'}`);
      }
    }
    for (const k of VARIANT_KEYS) if (!(k in (v?.set ?? {}))) errors.push(`${at}: leaves out ${k}; every variant sets all four, so a change back is exact`);
  }
  if (defaults > 1) errors.push('variants.paint: more than one variant is marked default');
  // the finish itself must not set what the variants own, or the two would disagree about the default
  for (const k of VARIANT_KEYS) if (k in base) errors.push(`materials.paint.set.${k}: the default variant sets the paint's ${k}; leave it out of the finish`);
  return errors;
}
const variantErrors = checkPaintVariants(manifest);
if (variantErrors.length) {
  console.error(`${manifestPath}: paint variants refused\n  - ${variantErrors.join('\n  - ')}`);
  process.exit(1);
}
console.log(`${manifestPath}: ${manifest.variants?.paint?.length ?? 0} paint variants, none recompiles a shader`);
if (checkOnly) process.exit(0);
mkdirSync(outDir, { recursive: true });
const build = manifest.build ?? {};
// the URL the site serves outDir at (public/ is the site root)
const publicDir = resolve('public');
const urlBase = resolve(outDir).startsWith(publicDir + sep) ? '/' + relative(publicDir, resolve(outDir)).split(sep).join('/') : null;

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const tiers = [
  { tier: 'desktop', size: 1024, aoSize: 1024, errorScale: 1 },
  // mobile: 512 px, but the ambient-occlusion maps stay at 1024 px. The car's AO map is shared by 25
  // materials and at 512 px it blurred every panel gap.
  { tier: 'mobile', size: 512, aoSize: 1024, errorScale: 3 },
];
const urls = {};

// Texture slots a manifest finish switches off ("map": null ...) are never drawn by the viewer, so they
// are left out of the file. The first finish whose "match" fits a material applies, as in the viewer.
const SLOTS = { map: 'BaseColor', normalMap: 'Normal', emissiveMap: 'Emissive', aoMap: 'Occlusion' };
const finishesOff = Object.values(manifest.materials ?? {}).map((f) => {
  const set = f.set ?? {};
  const off = Object.keys(SLOTS).filter((k) => set[k] === null).map((k) => SLOTS[k]);
  if (set.metalnessMap === null && set.roughnessMap === null) off.push('MetallicRoughness');
  return { re: new RegExp(f.match), off };
});
function dropSwitchedOffTextures(doc) {
  let dropped = 0;
  for (const mat of doc.getRoot().listMaterials()) {
    const finish = finishesOff.find((f) => f.re.test(mat.getName()));
    for (const slot of finish?.off ?? []) {
      if (mat[`get${slot}Texture`]()) { mat[`set${slot}Texture`](null); dropped++; }
    }
  }
  return dropped;
}

for (const { tier, size, aoSize, errorScale } of tiers) {
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
  const dropped = dropSwitchedOffTextures(doc); // prune() then removes the textures nothing uses any more
  await doc.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [aoSize, aoSize], slots: /^occlusionTexture$/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], slots: /^(?!occlusionTexture$)/ }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  const bytes = await io.writeBinary(doc);
  const file = `model-${tier}.${createHash('sha256').update(bytes).digest('hex').slice(0, 8)}.glb`;
  // this tier's older builds (hashed, and the unhashed name used before hashing) go
  for (const old of readdirSync(outDir)) {
    if (old !== file && new RegExp(`^model-${tier}(\\.[0-9a-f]{8})?\\.glb$`).test(old)) unlinkSync(join(outDir, old));
  }
  writeFileSync(join(outDir, file), bytes);
  urls[tier] = urlBase ? `${urlBase}/${file}` : file;
  console.log(`${tier}: ${join(outDir, file)} ${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB (${thinned} parts simplified, ${dropped} switched-off texture slots left out)`);
}

// point the manifest at the new files; everything else in it stays as written
if (existsSync(manifestPath)) {
  manifest.src = { ...manifest.src, ...urls };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`manifest: ${manifestPath} src updated`);
} else {
  console.log(`no manifest in ${outDir}; write one with "src": ${JSON.stringify(urls)}`);
}
