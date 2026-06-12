// Backdrop for the story wall: the viewer sits inside a slowly rotating
// sphere of band-themed icons (configured per band via band.json wallIcons —
// roses and synths for Depeche Mode) over a faint dust layer for depth.
// three.js is lazy-loaded only when a wall opens, so the main bundle stays
// lean and the map never pays for it.

let fx = null;

function cssColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const DEFAULT_ICONS = ['♪', '♫', '🎹', '💿', '🎤', '🎧'];

export async function startWallFX(container, band) {
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

  const randomShellPositions = (count, radiusMin, radiusMax) => {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = radiusMin + Math.random() * (radiusMax - radiusMin);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    return positions;
  };

  const glyphTexture = (char) => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.font = '96px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // plain glyphs (♪) render in the theme text colour; emoji keep their own
    g.fillStyle = cssColor('--text') || '#fff';
    g.fillText(char, 64, 70);
    return new THREE.CanvasTexture(c);
  };

  const group = new THREE.Group();
  const disposables = [];

  // Faint dust for depth behind the icons.
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position',
    new THREE.BufferAttribute(randomShellPositions(700, 45, 85), 3));
  const dustMaterial = new THREE.PointsMaterial({
    color: cssColor('--accent2') || '#8a7bd8',
    size: 0.4, transparent: true, opacity: 0.35,
    sizeAttenuation: true, depthWrite: false,
  });
  group.add(new THREE.Points(dustGeometry, dustMaterial));
  disposables.push(dustGeometry, dustMaterial);

  // Band icons: one drifting constellation per glyph.
  const icons = band?.wallIcons?.length ? band.wallIcons : DEFAULT_ICONS;
  const layers = [];
  for (const char of icons) {
    const texture = glyphTexture(char);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',
      new THREE.BufferAttribute(randomShellPositions(26, 26, 65), 3));
    const material = new THREE.PointsMaterial({
      map: texture, size: 6.5, transparent: true, opacity: 0.5,
      sizeAttenuation: true, depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    points.rotation.set(Math.random(), Math.random() * Math.PI * 2, 0);
    group.add(points);
    layers.push({ points, speed: 0.0003 + Math.random() * 0.0005 });
    disposables.push(texture, geometry, material);
  }
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
    group.rotation.y += 0.0004;
    for (const layer of layers) layer.points.rotation.y += layer.speed;
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
      for (const d of disposables) d.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

export function stopWallFX() {
  fx?.dispose();
  fx = null;
}
