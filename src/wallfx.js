// Planetarium backdrop for the story wall: the viewer sits inside a slowly
// rotating sphere of glowing particles, looking out at the stories.
// three.js is lazy-loaded only when a wall opens, so the main bundle stays
// lean and the map never pays for it.

let fx = null;

function cssColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export async function startWallFX(container) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  stopWallFX();
  const THREE = await import('three');
  if (!container.classList.contains('wall-open')) return; // closed during load

  const canvas = document.createElement('canvas');
  canvas.className = 'wall-fx';
  container.prepend(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 200);
  camera.position.set(0, 0, 0.1); // inside the sphere, looking out

  // Soft round sprite so points glow instead of rendering as squares.
  const spriteCanvas = document.createElement('canvas');
  spriteCanvas.width = spriteCanvas.height = 64;
  const ctx = spriteCanvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const sprite = new THREE.CanvasTexture(spriteCanvas);

  // Shells of points (accent + neutral) at varied radii for depth.
  const makeShell = (count, radiusMin, radiusMax, color, size, opacity) => {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = radiusMin + Math.random() * (radiusMax - radiusMin);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color, size, transparent: true, opacity, sizeAttenuation: true, depthWrite: false,
      map: sprite, blending: THREE.AdditiveBlending,
    });
    return new THREE.Points(geometry, material);
  };

  const group = new THREE.Group();
  group.add(makeShell(900, 30, 70, cssColor('--accent2') || '#8a7bd8', 0.9, 0.85));
  group.add(makeShell(500, 25, 65, cssColor('--accent') || '#e3342f', 0.8, 0.6));
  group.add(makeShell(1400, 35, 80, cssColor('--text') || '#f2f0eb', 0.55, 0.4));
  scene.add(group);

  let targetX = 0;
  let targetY = 0;
  const onPointer = (e) => {
    targetY = (e.clientX / innerWidth - 0.5) * 0.35;
    targetX = (e.clientY / innerHeight - 0.5) * 0.25;
  };
  container.addEventListener('pointermove', onPointer);

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  let raf;
  const animate = () => {
    group.rotation.y += 0.00045;
    group.rotation.z += 0.0001;
    camera.rotation.x += (targetX - camera.rotation.x) * 0.04;
    camera.rotation.y += (-targetY - camera.rotation.y) * 0.04;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(animate);
  };
  animate();

  fx = {
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      container.removeEventListener('pointermove', onPointer);
      for (const shell of group.children) {
        shell.geometry.dispose();
        shell.material.dispose();
      }
      sprite.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

export function stopWallFX() {
  fx?.dispose();
  fx = null;
}
