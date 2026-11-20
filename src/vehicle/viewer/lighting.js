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

  // pointer in the stage, 0..1; the light eases toward it (reduced motion: it stays at rest)
  const rest = { x: 0.5, y: 0.42 };
  const goal = { ...rest };
  const now = { ...rest };

  function place(azimuth) {
    const kx = (now.x - 0.5) * 70 * DEG;
    const ky = (0.5 - now.y) * 30 * DEG;
    key.position.setFromSphericalCoords(reach, (55 * DEG) - ky, azimuth - 35 * DEG + kx);
    rim.position.setFromSphericalCoords(reach, 78 * DEG, azimuth + Math.PI - kx * 0.5);
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
    // after a context restore. The old reflection lived only in the lost context, so it is dropped, not
    // disposed (disposing would hand stale GL objects to the new context).
    rebuild: buildEnvironment,
    dispose() {
      env.dispose();
      shadowTex.dispose();
      shadow.geometry.dispose();
      shadow.material.dispose();
    },
  };
}
