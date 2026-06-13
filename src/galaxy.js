// Background behind the globe.
// If band.backgroundImage is set: shows a B&W band photo with a Star Wars
// perspective tilt (slopes away at the top like the opening crawl).
// Otherwise: animated star-field canvas.

export function initGalaxy(band) {
  const bg = document.createElement('div');
  bg.id = 'galaxy-bg';

  const mapEl = document.getElementById('map');
  mapEl.parentNode.insertBefore(bg, mapEl);

  if (band?.backgroundImage) {
    return initPhotoBackground(bg, band.backgroundImage);
  }
  return initStarfield(bg);
}

function initPhotoBackground(bg, src) {
  bg.innerHTML = `
    <div class="galaxy-field">
      <img class="galaxy-photo" src="${src}" alt="" aria-hidden="true">
      <div class="galaxy-photo-vignette"></div>
    </div>`;
  return () => bg.remove();
}

function initStarfield(bg) {
  const field = document.createElement('div');
  field.className = 'galaxy-field';
  const canvas = document.createElement('canvas');
  field.appendChild(canvas);
  bg.appendChild(field);

  const COUNT = 320;
  const stars = Array.from({ length: COUNT }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: Math.random() ** 1.8 * 1.6 + 0.25,
    baseOpacity: Math.random() * 0.65 + 0.2,
    phase: Math.random() * Math.PI * 2,
    twinkleSpeed: Math.random() * 0.6 + 0.15,
    drift: Math.random() * 0.00004 + 0.00001,
    blue: Math.random() > 0.75,
  }));

  let w = 0, h = 0, raf = null;

  function resize() {
    w = canvas.width = window.innerWidth * 1.3;
    h = canvas.height = window.innerHeight * 1.5;
  }

  function draw(t) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

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
      s.y -= s.drift;
      if (s.y < -0.02) s.y = 1.02;
      const twinkle = 0.5 + 0.5 * Math.sin(time * s.twinkleSpeed + s.phase);
      const opacity = s.baseOpacity * (0.4 + 0.6 * twinkle);
      ctx.globalAlpha = opacity;
      ctx.fillStyle = s.blue ? '#c8d8ff' : '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
      ctx.fill();
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
