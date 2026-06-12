// Cinematic opener: a cloud of scattered particles condenses into a slowly
// turning globe while the title fades in, then the whole thing dissolves to
// reveal the map. Plays once per browser session, is tap-skippable, lazy-loads
// three.js, and quietly does nothing under prefers-reduced-motion or if WebGL
// is unavailable.

function cssColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export async function playIntro(band) {
  if (sessionStorage.getItem('wite:intro-played')) return;
  sessionStorage.setItem('wite:intro-played', '1');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const overlay = document.createElement('div');
  overlay.className = 'intro';
  overlay.innerHTML = `
    <canvas class="intro-canvas"></canvas>
    <div class="intro-titles">
      <h1>${band.appTitle}</h1>
      <p>${band.tagline}</p>
    </div>
    <span class="intro-skip">tap to skip</span>`;
  document.body.appendChild(overlay);

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    overlay.classList.add('intro-out');
    setTimeout(() => overlay.remove(), 650);
  };
  overlay.addEventListener('pointerdown', finish);
  const failsafe = setTimeout(finish, 6000);

  try {
    const THREE = await import('three');
    const canvas = overlay.querySelector('.intro-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight, false);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 400);
    camera.position.z = 95;

    const COUNT = 2600;
    const start = new Float32Array(COUNT * 3);
    const target = new Float32Array(COUNT * 3);
    const positions = new Float32Array(COUNT * 3);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < COUNT; i++) {
      // chaos: a huge loose cloud
      start[i * 3] = (Math.random() - 0.5) * 320;
      start[i * 3 + 1] = (Math.random() - 0.5) * 320;
      start[i * 3 + 2] = (Math.random() - 0.5) * 320;
      // order: a fibonacci-sphere globe
      const y = 1 - (i / (COUNT - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = golden * i;
      target[i * 3] = Math.cos(theta) * r * 34;
      target[i * 3 + 1] = y * 34;
      target[i * 3 + 2] = Math.sin(theta) * r * 34;
    }
    positions.set(start);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const sprite = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.4, 'rgba(255,255,255,.5)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: cssColor('--accent2') || '#8a7bd8',
      size: 1.5, transparent: true, opacity: 0.9,
      map: sprite, blending: THREE.AdditiveBlending,
      sizeAttenuation: true, depthWrite: false,
    }));
    scene.add(points);

    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const t0 = performance.now();
    const CONDENSE_MS = 2100;
    const HOLD_MS = 900;

    let raf;
    const animate = (now) => {
      if (finished) { cleanup(); return; }
      const t = Math.min(1, (now - t0) / CONDENSE_MS);
      const k = ease(t);
      for (let i = 0; i < COUNT * 3; i++) {
        positions[i] = start[i] + (target[i] - start[i]) * k;
      }
      geometry.attributes.position.needsUpdate = true;
      points.rotation.y += 0.0022;
      renderer.render(scene, camera);
      if (now - t0 > CONDENSE_MS + HOLD_MS) { finish(); cleanup(); return; }
      raf = requestAnimationFrame(animate);
    };
    const cleanup = () => {
      cancelAnimationFrame(raf);
      clearTimeout(failsafe);
      geometry.dispose();
      points.material.dispose();
      sprite.dispose();
      renderer.dispose();
    };
    raf = requestAnimationFrame(animate);
  } catch {
    finish();
  }
}
