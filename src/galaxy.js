// Animated star-field rendered behind the globe.
// Stars twinkle and drift slowly upward to give a "travelling through space" feel.
// The CSS perspective tilt on the container creates the Star-Wars-crawl receding effect.

const COUNT = 320;

export function initGalaxy() {
  const bg = document.createElement('div');
  bg.id = 'galaxy-bg';

  const field = document.createElement('div');
  field.className = 'galaxy-field';

  const canvas = document.createElement('canvas');
  bg.appendChild(field);
  field.appendChild(canvas);

  // Insert before #map so the map canvas sits on top
  const mapEl = document.getElementById('map');
  mapEl.parentNode.insertBefore(bg, mapEl);

  // Random star data
  const stars = Array.from({ length: COUNT }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: Math.random() ** 1.8 * 1.6 + 0.25,  // power-law: many tiny, few bright
    baseOpacity: Math.random() * 0.65 + 0.2,
    phase: Math.random() * Math.PI * 2,
    twinkleSpeed: Math.random() * 0.6 + 0.15,
    drift: Math.random() * 0.00004 + 0.00001,  // slow upward drift rate
    blue: Math.random() > 0.75,  // some stars are slightly blue-white
  }));

  let w = 0, h = 0, raf = null;

  function resize() {
    // canvas is inside .galaxy-field which is oversized; use window dims
    w = canvas.width = window.innerWidth * 1.3;
    h = canvas.height = window.innerHeight * 1.5;
  }

  function draw(t) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    // Faint nebula glow clusters
    const g1 = ctx.createRadialGradient(w * 0.35, h * 0.42, 0, w * 0.35, h * 0.42, w * 0.38);
    g1.addColorStop(0, 'rgba(70, 30, 120, 0.08)');
    g1.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w, h);

    const g2 = ctx.createRadialGradient(w * 0.72, h * 0.55, 0, w * 0.72, h * 0.55, w * 0.3);
    g2.addColorStop(0, 'rgba(20, 50, 110, 0.07)');
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);

    const time = t / 1000;

    for (const s of stars) {
      // Drift upward (wrap around)
      s.y -= s.drift;
      if (s.y < -0.02) s.y = 1.02;

      const twinkle = 0.5 + 0.5 * Math.sin(time * s.twinkleSpeed + s.phase);
      const opacity = s.baseOpacity * (0.4 + 0.6 * twinkle);
      ctx.globalAlpha = opacity;
      ctx.fillStyle = s.blue ? '#c8d8ff' : '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
      ctx.fill();

      // Halo on larger stars
      if (s.r > 1.1) {
        ctx.globalAlpha = opacity * 0.25;
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener('resize', resize);
  raf = requestAnimationFrame(draw);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    bg.remove();
  };
}
