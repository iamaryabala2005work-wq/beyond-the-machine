// Studio light for any car: a soft room reflection, a key light that leans toward the pointer, a low
// cyan rim from behind (the page's accent), and a contact shadow on the ground. The lights sit in the
// camera's frame, so the highlights stay where the visitor expects them while the car turns.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const DEG = Math.PI / 180;

export function createLighting({ scene, renderer, box, accent, reducedMotion }) {
  // the room reflection is rendered on the GPU, so it is the one thing a lost WebGL context cannot give back
  // by itself (three.js re-uploads meshes and textures from their CPU copies): rebuild() draws it again
  let env = null;
  function buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = env;
  }
  buildEnvironment();
  scene.environmentIntensity = 0.55;

  const size = box.getSize(new THREE.Vector3());
  const reach = size.length() * 1.6;

  const key = new THREE.DirectionalLight(0xf2f6fa, 2.4);
  const rim = new THREE.DirectionalLight(new THREE.Color(accent), 1.6);
  scene.add(key, key.target, rim, rim.target);

  // contact shadow: a soft dark ellipse under the car, drawn once into a small canvas
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.85)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.45)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(c);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x * 1.5, size.z * 1.25),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  shadow.renderOrder = -1;
  scene.add(shadow);

  // the story's silhouette light (setSilhouette), off in the hero: a cool light from high behind the car
  // that draws its roofline against a dark page, and a soft cool glow on the floor under it, drawn once
  // like the shadow and laid under it so the tyres still sit in shade
  // both stay in the scene at zero when off: adding or hiding a light recompiles every material's shader,
  // a stall on entering the story; an intensity of 0 costs nothing
  const roof = new THREE.DirectionalLight(0xcfe6ff, 0);
  scene.add(roof, roof.target);
  const gc = document.createElement('canvas');
  gc.width = gc.height = 128;
  const gg = gc.getContext('2d');
  const glowGrad = gg.createRadialGradient(64, 64, 0, 64, 64, 64);
  glowGrad.addColorStop(0, 'rgba(150,205,230,0.55)');
  glowGrad.addColorStop(0.45, 'rgba(120,180,210,0.2)');
  glowGrad.addColorStop(1, 'rgba(120,180,210,0)');
  gg.fillStyle = glowGrad;
  gg.fillRect(0, 0, 128, 128);
  const glowTex = new THREE.CanvasTexture(gc);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x * 1.8, size.z * 1.7),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0, toneMapped: false }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.001;
  glow.renderOrder = -2;
  scene.add(glow);
  let silhouette = 0;

  // pointer in the stage, 0..1; the light eases toward it (reduced motion: it stays at rest)
  const rest = { x: 0.5, y: 0.42 };
  const goal = { ...rest };
  const now = { ...rest };

  function place(azimuth) {
    const kx = (now.x - 0.5) * 70 * DEG;
    const ky = (0.5 - now.y) * 30 * DEG;
    key.position.setFromSphericalCoords(reach, (55 * DEG) - ky, azimuth - 35 * DEG + kx);
    rim.position.setFromSphericalCoords(reach, 78 * DEG, azimuth + Math.PI - kx * 0.5);
    // high and behind, a little to the side: it grazes the roof and the shoulders the camera sees edge-on
    roof.position.setFromSphericalCoords(reach, 28 * DEG, azimuth + Math.PI + 25 * DEG);
  }

  return {
    setPointer(x, y) {
      if (reducedMotion) return false;
      goal.x = x; goal.y = y;
      return true;
    },
    release() { goal.x = rest.x; goal.y = rest.y; return !reducedMotion; },
    // returns true while the light is still travelling
    update(azimuth) {
      const k = 0.12;
      now.x += (goal.x - now.x) * k;
      now.y += (goal.y - now.y) * k;
      place(azimuth);
      return Math.abs(goal.x - now.x) + Math.abs(goal.y - now.y) > 0.002;
    },
    // how much of the studio light falls on the car, 0..1 (1 = as in the hero). The story dims it for
    // its darker chapters; the cyan rim stays as it is, so a dimmed car still shows its outline.
    // Returns true when it changed, so the caller draws a frame.
    setKey(level) {
      const k = Math.min(1, Math.max(0, level));
      const keyI = 2.4 * k, envI = 0.55 * (0.25 + 0.75 * k);
      if (Math.abs(key.intensity - keyI) < 1e-3 && Math.abs(scene.environmentIntensity - envI) < 1e-3) return false;
      key.intensity = keyI;
      scene.environmentIntensity = envI;
      return true;
    },
    // the story's silhouette light, 0..1 (see above). Returns true when it changed, so the caller draws a frame.
    setSilhouette(level) {
      const k = Math.min(1, Math.max(0, level));
      if (Math.abs(k - silhouette) < 1e-3) return false;
      silhouette = k;
      roof.intensity = 3.2 * k;
      glow.material.opacity = 0.7 * k;
      return true;
    },
    // after a context restore. The old reflection lived only in the lost context, so it is dropped, not
    // disposed (disposing would hand stale GL objects to the new context).
    rebuild: buildEnvironment,
    dispose() {
      env.dispose();
      shadowTex.dispose();
      glowTex.dispose();
      glow.geometry.dispose();
      glow.material.dispose();
      shadow.geometry.dispose();
      shadow.material.dispose();
    },
  };
}
