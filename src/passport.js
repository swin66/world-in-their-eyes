// Points, levels and badges — computed from the visited set + band config.
// Distance from the band's home town earns bigger points: a pilgrimage to
// Johannesburg should count for more than a stroll through Basildon.

export function haversineKm([lng1, lat1], [lng2, lat2]) {
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

// extras: { verified: Set, contributions, mediaContributions, streakBest, streakNow }
export function computeProgress(visited, places, band, extras = {}) {
  const home = band.map.center;
  const gam = band.gamification;
  const verified = extras.verified || new Set();
  const multiplier = gam.verified?.multiplier || 1;
  let points = 0;
  const byCategory = {};
  for (const f of places.features) {
    const p = f.properties;
    byCategory[p.category] ??= { total: 0, visited: 0 };
    byCategory[p.category].total += 1;
    if (visited.has(p.id)) {
      byCategory[p.category].visited += 1;
      points += pointsFor(f, home) * (verified.has(p.id) ? multiplier : 1);
    }
  }
  const contributions = extras.contributions || 0;
  const mediaContributions = extras.mediaContributions || 0;
  points += contributions * (gam.contribution?.points || 0)
    + mediaContributions * (gam.contribution?.mediaBonus || 0);
  const completedTrips = extras.completedTrips || new Set();
  points += completedTrips.size * (gam.tripPoints || 0);

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
    ...(gam.contributionBadges || []).map((b) => ({
      id: b.id,
      label: b.label,
      desc: `Share ${b.threshold} memor${b.threshold > 1 ? 'ies' : 'y'}, photo${b.threshold > 1 ? 's' : ''} or finds`,
      earned: contributions >= b.threshold,
    })),
    ...(gam.streakBadges || []).map((b) => ({
      id: b.id,
      label: b.label,
      desc: `${b.days}-day activity streak`,
      earned: (extras.streakBest || 0) >= b.days,
    })),
    ...(gam.verified?.badges || []).map((b) => ({
      id: b.id,
      label: b.label,
      desc: `Check in on location ${b.threshold > 1 ? `${b.threshold} times` : 'once'} (GPS-verified)`,
      earned: verified.size >= b.threshold,
    })),
    ...(extras.tripDefs || []).filter((t) => t.badge).map((t) => ({
      id: `trip-${t.id}`,
      label: t.badge,
      desc: `Complete the “${t.title}” trip`,
      earned: completedTrips.has(t.id),
    })),
  ];

  const levels = gam.levels || [];
  let level = levels[0] || { label: '—', points: 0 };
  let nextLevel = null;
  for (const l of levels) {
    if (points >= l.points) level = l;
    else { nextLevel = l; break; }
  }

  return {
    points, level, nextLevel, badges, byCategory,
    visitedCount: visited.size,
    verifiedCount: verified.size,
    contributions,
    streakNow: extras.streakNow || 0,
  };
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
    <div class="passport-stats">
      <span>🔥 ${progress.streakNow} day streak</span>
      <span>✍️ ${progress.contributions} shared</span>
      <span>📍 ${progress.verifiedCount} verified</span>
    </div>
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
