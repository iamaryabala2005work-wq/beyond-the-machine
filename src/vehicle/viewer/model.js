// Loads a car GLB and applies its manifest: orientation, grounding, hidden parts, material finishes.
// Nothing here knows which car it is; every name comes from the manifest.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// three.js sanitises node names on load ("License Plate" becomes "License_Plate"); manifests use the file's names
const nodeName = (n) => THREE.PropertyBinding.sanitizeNodeName(n);
const FORWARD_TURN = { '+z': 0, '-z': Math.PI, '+x': -Math.PI / 2, '-x': Math.PI / 2 };

export async function loadManifest(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`manifest ${url}: ${res.status}`);
  return res.json();
}

export async function loadModel(manifest, tier, onProgress, { anisotropy = 1 } = {}) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const url = manifest.src[tier] ?? manifest.src.desktop;
  const gltf = await loader.loadAsync(url, (e) => {
    if (e.lengthComputable && e.total) onProgress?.(e.loaded / e.total);
  });
  const car = gltf.scene;

  // face the car down +z, then centre it on the origin with its wheels on y = 0
  car.rotation.y = FORWARD_TURN[manifest.orientation?.forward ?? '+z'] ?? 0;
  car.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(car);
  const centre = box.getCenter(new THREE.Vector3());
  car.position.set(-centre.x, -box.min.y, -centre.z);

  const root = new THREE.Group();
  root.name = manifest.id;
  root.add(car);

  const hidden = new Set((manifest.hide ?? []).map(nodeName));
  const finishes = Object.values(manifest.materials ?? {}).map((f) => ({ re: new RegExp(f.match), set: f.set ?? {} }));
  const done = new Set();
  car.traverse((o) => {
    if (hidden.has(o.name)) o.visible = false;
    if (!o.isMesh) return;
    for (const m of [o.material].flat()) {
      if (done.has(m)) continue;
      done.add(m);
      const finish = finishes.find((f) => f.re.test(m.name));
      if (finish) applyFinish(m, finish.set);
      // transmission costs a second render pass each frame; the mobile tier never pays it
      if (tier === 'mobile' && m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = Math.min(m.opacity, 0.45); }
      // sharper textures on surfaces seen at an angle (hood, floor, tyres); set before the first upload
      for (const v of Object.values(m)) if (v?.isTexture && v.anisotropy < anisotropy) v.anisotropy = anisotropy;
    }
  });

  root.updateMatrixWorld(true);
  return { root, box: new THREE.Box3().setFromObject(root), parts: indexParts(car, manifest.parts ?? {}) };
}

function applyFinish(material, set) {
  for (const [key, value] of Object.entries(set)) {
    if (key === 'color') material.color?.set(value);
    else if (key in material) material[key] = value;
  }
  material.needsUpdate = true;
}

// parts by role, for later phases (wheels, doors); missing names are simply absent
function indexParts(car, parts) {
  const out = {};
  for (const [role, names] of Object.entries(parts)) out[role] = names.map((n) => car.getObjectByName(nodeName(n))).filter(Boolean);
  return out;
}

export function disposeObject(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry?.dispose();
    for (const m of [o.material].flat()) {
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose();
    }
  });
}
