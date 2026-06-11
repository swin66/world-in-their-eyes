// Points, levels and badges — computed from the visited set + band config.
// Distance from the band's home town earns bigger points: a pilgrimage to
// Johannesburg should count for more than a stroll through Basildon.

function haversineKm([lng1, lat1], [lng2, lat2]) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function pointsFor(feature, home) {
  const km = haversineKm(home, feature.geometry.coordinates);
  if (km > 2000) return 25;
  if (km > 500) return 15;
  return 10;
}

export function computeProgress(visited, places, band) {
  const home = band.map.center;
  const gam = band.gamification;
  let points = 0;
  const byCategory = {};
  for (const f of places.features) {
    const p = f.properties;
    byCategory[p.category] ??= { total: 0, visited: 0 };
    byCategory[p.category].total += 1;
    if (visited.has(p.id)) {
      byCategory[p.category].visited += 1;
      points += pointsFor(f, home);
    }
  }

  const badges = [
    ...gam.badges.map((b) => ({
      id: b.id,
      label: b.label,
      desc: `Visit ${b.threshold} place${b.threshold > 1 ? 's' : ''}`,
      earned: visited.size >= b.threshold,
    })),
    ...(gam.categoryBadges || []).map((b) => {
      const cat = byCategory[b.category] || { total: 0, visited: 0 };
      const label = band.categories[b.category]?.label || b.category;
      return {
        id: `cat-${b.category}`,
        label: b.label,
        desc: `Visit all ${cat.total} ${label} places`,
        earned: cat.total > 0 && cat.visited === cat.total,
      };
    }),
  ];

  const levels = gam.levels || [];
  let level = levels[0] || { label: '—', points: 0 };
  let nextLevel = null;
  for (const l of levels) {
    if (points >= l.points) level = l;
    else { nextLevel = l; break; }
  }

  return { points, level, nextLevel, badges, byCategory, visitedCount: visited.size };
}

export function renderPassport(container, progress, band, total, { onClose, onShare }) {
  const { points, level, nextLevel, badges, visitedCount } = progress;
  const pct = nextLevel
    ? Math.min(100, ((points - level.points) / (nextLevel.points - level.points)) * 100)
    : 100;
  container.innerHTML = `
    <h2>Pilgrimage Passport</h2>
    <div class="passport-level">
      <div>
        <span class="passport-level-label">Level</span>
        <strong>${level.label}</strong>
      </div>
      <div class="passport-points">${points} pts</div>
    </div>
    <div class="level-bar"><span style="width:${pct}%"></span></div>
    <p class="modal-text dim">${nextLevel
      ? `${nextLevel.points - points} pts to “${nextLevel.label}”`
      : 'Top level reached. Total devotion.'} · ${visitedCount}/${total} places</p>
    <div class="badge-grid">
      ${badges.map((b) => `
        <div class="badge ${b.earned ? 'badge-earned' : ''}" title="${b.desc}">
          <span class="badge-icon">${b.earned ? '🏅' : '🔒'}</span>
          <span class="badge-label">${b.label}</span>
        </div>`).join('')}
    </div>
    <div class="sheet-actions">
      <button class="btn" data-share>Share</button>
      <button class="btn btn-primary" data-close>Keep exploring</button>
    </div>`;
  container.querySelector('[data-close]').addEventListener('click', onClose);
  container.querySelector('[data-share]').addEventListener('click', onShare);
}
