// The poster renderer's page (scripts/posters/render.html), loaded by scripts/render-posters.mjs in a
// headless browser through Vite. It draws the car with the site's own code: the manifest's model, hidden
// parts and finishes (model.js), the studio light (lighting.js) and the camera framing (camera-rig.js),
// so a poster is the car exactly as the live viewer draws it, from any shot.
import * as THREE from 'three';
import { loadManifest, loadModel } from '/src/vehicle/viewer/model.js';
import { createLighting } from '/src/vehicle/viewer/lighting.js';
import { createRig } from '/src/vehicle/viewer/camera-rig.js';
import { fitTurntable } from '/src/vehicle/viewer/fit.js';

let ready = null;

async function setup(manifestUrl) {
  const manifest = await loadManifest(manifestUrl);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);
  document.body.append(renderer.domElement);
  const anisotropy = renderer.capabilities.getMaxAnisotropy() || 1;
  const model = await loadModel(manifest, 'desktop', null, { anisotropy });
  const scene = new THREE.Scene();
  scene.add(model.root);
  const accent = '#7fe0ee'; // the page's --p-accent, as the viewer reads it from the stage
  const lighting = createLighting({ scene, renderer, box: model.box, accent, reducedMotion: true, root: model.root });
  // the contact shadow: the one mesh the lighting adds (a cut-out poster leaves it out; CSS draws its own)
  const shadow = scene.children.find((o) => o.isMesh && o.material?.isMeshBasicMaterial);
  const camera = new THREE.PerspectiveCamera(manifest.camera?.fov ?? 26, 1, 0.05, 200);
  // a poster may frame closer or steeper than a visitor can turn the car: the rig's limits are opened
  const config = { ...(manifest.camera ?? {}), limits: { polarMin: 1, polarMax: 179, zoomMin: 0.05, zoomMax: 20 } };
  const stage = document.createElement('div');
  const rig = createRig({ camera, canvas: renderer.domElement, stage, box: model.box, config, reducedMotion: true, onChange() {} });
  return { manifest, renderer, scene, camera, rig, lighting, shadow, model };
}

// one poster: returns a PNG data URL of width x height (x scale), transparent where there is no car.
// offset [x, y] shifts the car in the frame as the viewer's setFrameShift does (x of the width, positive
// right; y of the height, positive down); light { key, silhouette, warmth } sets the story's light levels.
// fitRect { left, top, right, bottom } (fractions of the frame): instead of the shot's zoom and the offset,
// fit the car into that rect at every heading as the live viewer does (fit.js, Chapter V), or at the
// shot's own heading alone with fitSteps 1 (Chapter VI); the result is then { png, box } with the fitted
// box in fractions of the frame. paint: a variants.paint id to draw the car in (the default otherwise).
window.renderPoster = async ({ manifestUrl, shot, width, height, scale = 1, shadow = true, offset = null, light = null, fitRect = null, fitSteps = 16, paint = null }) => {
  ready ??= setup(manifestUrl);
  const s = await ready;
  applyPaint(s, paint);
  s.renderer.setPixelRatio(scale);
  s.renderer.setSize(width, height, false);
  s.camera.aspect = width / height;
  if (offset) s.camera.setViewOffset(width, height, -width * offset[0], -height * offset[1], width, height);
  else s.camera.clearViewOffset();
  s.camera.updateProjectionMatrix();
  s.lighting.setKey(light?.key ?? 1);
  s.lighting.setSilhouette(light?.silhouette ?? 0);
  s.lighting.setWarmth(light?.warmth ?? 0);
  s.rig.resize(s.camera.aspect);
  let box = null;
  if (fitRect) {
    const cam = s.camera.clone();
    cam.clearViewOffset();
    cam.updateProjectionMatrix();
    const fit = fitTurntable({ cam, place: s.rig.placeAt, points: s.model.points, shot, rect: fitRect, steps: fitSteps });
    s.camera.setViewOffset(width, height, -width * fit.x, -height * fit.y, width, height);
    s.camera.updateProjectionMatrix();
    shot = { ...shot, zoom: fit.zoom };
    box = fit.box;
  }
  s.rig.pose(shot, shot, 0);
  s.lighting.update(s.rig.azimuth());
  if (s.shadow) s.shadow.visible = shadow;
  s.renderer.render(s.scene, s.camera); // compiles the shaders
  s.renderer.render(s.scene, s.camera);
  const png = s.renderer.domElement.toDataURL('image/png');
  return fitRect ? { png, box } : png;
};
// the paint as the live viewer sets it (viewer.js setPaint): the variant's values on the materials
// materials.paint matches, the default variant when none is named
function applyPaint(s, id) {
  const list = s.manifest.variants?.paint ?? [];
  const v = list.find((x) => x.id === id) ?? list.find((x) => x.default) ?? list[0];
  if (!v) return;
  for (const m of s.model.paint) {
    if (v.set.color) m.color.set(v.set.color);
    for (const k of ['metalness', 'roughness', 'clearcoatRoughness']) if (k in v.set) m[k] = v.set[k];
  }
}
window.posterReady = true;
