// The "story wall": a full-screen immersive view of every event, release and
// memory at one hotspot. Cards float in on a subtle 3D curve; tapping one
// opens the detail sheet on top.

function wallTitle(features) {
  // Hotspots often share a location name ("Hansa Studios, Berlin") — use the
  // most common trailing segment (city / venue) as the headline.
  const counts = new Map();
  for (const f of features) {
    const parts = f.properties.title.split(',');
    const key = (parts[parts.length - 1] || f.properties.title).trim();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best;
}

export function closeWall() {
  document.getElementById('wall')?.classList.remove('wall-open');
}

export function openWall(features, state, { onSelect }) {
  const wall = document.getElementById('wall');
  const sorted = [...features].sort((a, b) => a.properties.year - b.properties.year);
  const years = sorted.map((f) => f.properties.year);
  const span = years[0] === years[years.length - 1]
    ? years[0] : `${years[0]} – ${years[years.length - 1]}`;

  wall.innerHTML = `
    <header class="wall-header">
      <div>
        <h2>${wallTitle(sorted)}</h2>
        <p>${sorted.length} stories · ${span}</p>
      </div>
      <button class="wall-close" aria-label="Close">✕</button>
    </header>
    <div class="wall-scroll">
      <div class="wall-grid">
        ${sorted.map((f, i) => {
          const p = f.properties;
          const cat = state.band.categories[p.category] || {};
          const visited = state.checkins.has(p.id);
          return `
            <button class="wall-card" data-id="${p.id}" style="--stagger:${i * 55}ms; --cat:${cat.color}">
              <span class="wall-card-meta">
                <span class="chip-dot" style="background:${cat.color}"></span>
                ${cat.label || ''} · ${p.year}
                ${visited ? '<span class="wall-visited">✓</span>' : ''}
              </span>
              <strong>${p.title}</strong>
              <p>${p.summary}</p>
            </button>`;
        }).join('')}
      </div>
    </div>`;

  wall.querySelector('.wall-close').addEventListener('click', closeWall);
  for (const card of wall.querySelectorAll('.wall-card')) {
    card.addEventListener('click', () => {
      const feature = sorted.find((f) => f.properties.id === card.dataset.id);
      if (feature) onSelect(feature);
    });
  }
  wall.classList.add('wall-open');
}
