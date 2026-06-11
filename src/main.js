import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import confetti from 'canvas-confetti';
import './style.css';
import { createCheckins } from './gamification.js';
import { computeProgress, renderPassport } from './passport.js';
import { supabase } from './supabase.js';
import { initAuth, getUser, syncCheckins, pushCheckin, renderAuthModal } from './auth.js';
import { renderAdmin } from './admin.js';
import { openWall, closeWall } from './wall.js';

const state = {
  band: null,
  places: null,
  artists: new Map(),
  activeCategories: new Set(),
  minYear: 0,
  maxYear: 9999,
  mode: 'dark',
  selectedId: null,
  map: null,
};

const $ = (id) => document.getElementById(id);

async function loadJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return res.json();
}

// Prefer database content when Supabase is configured and seeded;
// otherwise fall back to the static JSON shipped with the site.
async function loadData() {
  const [band, placesJson, artistsJson] = await Promise.all([
    loadJSON('/data/band.json'),
    loadJSON('/data/places.json'),
    loadJSON('/data/artists.json'),
  ]);
  let places = placesJson;
  let artists = artistsJson.artists;
  if (supabase) {
    const [placesRes, artistsRes] = await Promise.all([
      supabase.from('places').select('*').eq('band_slug', band.slug),
      supabase.from('artists').select('*').eq('band_slug', band.slug),
    ]);
    if (placesRes.data?.length) {
      places = {
        type: 'FeatureCollection',
        features: placesRes.data.map((r) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
          properties: {
            id: r.id, title: r.title, category: r.category, year: r.year,
            summary: r.summary, story: r.story, approx: r.approx || undefined,
            artistId: r.artist_id || undefined,
          },
        })),
      };
    }
    if (artistsRes.data?.length) artists = artistsRes.data;
  }
  return { band, places, artists };
}

/* ---------- Theming ---------- */

function currentTheme() {
  return state.band.themes[state.mode] || state.band.themes.dark;
}

function applyTheme(band, mode) {
  const theme = band.themes[mode] || band.themes.dark;
  const root = document.documentElement;
  for (const key of ['accent', 'accent2', 'bg', 'surface', 'text']) {
    root.style.setProperty(`--${key}`, theme[key]);
  }
  root.dataset.mode = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.bg);
  document.title = `${band.appTitle} — ${band.name}`;
  $('band-title').textContent = band.appTitle;
  $('band-tagline').textContent = band.tagline;
  $('brand-mark').style.background = `linear-gradient(135deg, ${theme.accent}, ${theme.accent2})`;
}

function setMode(mode) {
  state.mode = mode;
  localStorage.setItem(`wite:${state.band.slug}:mode`, mode);
  applyTheme(state.band, mode);
  state.map?.setStyle(currentTheme().mapStyle); // layers re-added on style.load
  $('mode-btn').textContent = mode === 'dark' ? '◐' : '◑';
}

/* ---------- Filtering ---------- */

function visibleFeatures() {
  return state.places.features.filter((f) => {
    const p = f.properties;
    if (p.year < state.minYear || p.year > state.maxYear) return false;
    if (state.activeCategories.size && !state.activeCategories.has(p.category)) return false;
    return true;
  });
}

// The map renders from this collection; `visited` and `color` are baked in so
// the WebGL layers can style points without DOM work (no marker lag).
function mapCollection() {
  return {
    type: 'FeatureCollection',
    features: visibleFeatures().map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        visited: state.checkins.has(f.properties.id),
        color: state.band.categories[f.properties.category]?.color || '#999',
      },
    })),
  };
}

function refreshMapData() {
  state.map?.getSource('places')?.setData(mapCollection());
}

/* ---------- Map layers (WebGL — markers move with the map) ---------- */

function addDataLayers() {
  const map = state.map;
  const theme = currentTheme();
  if (map.getSource('places')) return;
  map.addSource('places', {
    type: 'geojson',
    data: mapCollection(),
    cluster: true,
    clusterMaxZoom: 17,
    clusterRadius: 44,
  });
  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: 'places',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': theme.accent2,
      'circle-radius': ['step', ['get', 'point_count'], 17, 5, 21, 15, 27],
      'circle-stroke-width': 2.5,
      'circle-stroke-color': theme.surface,
      'circle-opacity': 0.92,
    },
  });
  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: 'places',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': '{point_count_abbreviated}',
      'text-size': 13,
      'text-font': ['Noto Sans Bold'],
      'text-allow-overlap': true,
    },
    paint: { 'text-color': '#ffffff' },
  });
  map.addLayer({
    id: 'points',
    type: 'circle',
    source: 'places',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['case', ['==', ['get', 'visited'], true], 9.5, 7.5],
      'circle-stroke-width': 2.5,
      'circle-stroke-color': ['case', ['==', ['get', 'visited'], true], '#ffffff', theme.bg],
    },
  });
  map.addLayer({
    id: 'points-visited',
    type: 'symbol',
    source: 'places',
    filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'visited'], true]],
    layout: {
      'text-field': '✓',
      'text-size': 10,
      'text-font': ['Noto Sans Bold'],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': theme.bg },
  });
}

function bindMapInteractions() {
  const map = state.map;

  map.on('click', 'points', (e) => {
    const props = e.features[0].properties;
    const feature = state.places.features.find((f) => f.properties.id === props.id);
    if (feature) openSheet(feature);
  });

  map.on('click', 'clusters', async (e) => {
    const cluster = e.features[0];
    const source = map.getSource('places');
    const clusterId = cluster.properties.cluster_id;
    const expansionZoom = await source.getClusterExpansionZoom(clusterId);
    // If expanding barely helps, this is a hotspot: many stories in one spot.
    if (expansionZoom > 15 || expansionZoom > map.getMaxZoom() - 1) {
      const leaves = await source.getClusterLeaves(clusterId, 200, 0);
      const ids = new Set(leaves.map((l) => l.properties.id));
      const features = state.places.features.filter((f) => ids.has(f.properties.id));
      openWall(features, state, { onSelect: openSheet, toast });
    } else {
      map.easeTo({ center: cluster.geometry.coordinates, zoom: expansionZoom + 0.5, duration: 600 });
    }
  });

  for (const layer of ['points', 'clusters']) {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  }
}

/* ---------- UI ---------- */

function buildFilters() {
  const nav = $('filters');
  nav.innerHTML = '';
  for (const [key, cat] of Object.entries(state.band.categories)) {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.dataset.category = key;
    btn.innerHTML = `<span class="chip-dot" style="background:${cat.color}"></span>${cat.label}`;
    btn.addEventListener('click', () => {
      if (state.activeCategories.has(key)) state.activeCategories.delete(key);
      else state.activeCategories.add(key);
      btn.classList.toggle('chip-active');
      refreshMapData();
    });
    nav.appendChild(btn);
  }
}

function buildTimeline() {
  const { yearStart, yearEnd } = state.band;
  const from = $('timeline-from');
  const to = $('timeline-to');
  const fill = $('timeline-fill');
  const label = $('timeline-label');
  from.min = to.min = yearStart;
  from.max = to.max = yearEnd;
  from.value = yearStart;
  to.value = yearEnd;
  const span = yearEnd - yearStart;
  const update = (e) => {
    let lo = Number(from.value);
    let hi = Number(to.value);
    if (lo > hi) {
      if (e?.target === from) { hi = lo; to.value = hi; }
      else { lo = hi; from.value = lo; }
    }
    state.minYear = lo;
    state.maxYear = hi;
    label.textContent = lo <= yearStart && hi >= yearEnd ? 'All years' : `${lo} – ${hi}`;
    fill.style.left = `${((lo - yearStart) / span) * 100}%`;
    fill.style.right = `${((yearEnd - hi) / span) * 100}%`;
    refreshMapData();
  };
  from.addEventListener('input', update);
  to.addEventListener('input', update);
  update();
}

function openSheet(feature) {
  const p = feature.properties;
  state.selectedId = p.id;
  const cat = state.band.categories[p.category] || {};
  const visited = state.checkins.has(p.id);
  const artist = p.artistId ? state.artists.get(p.artistId) : null;
  const body = $('sheet-body');
  body.innerHTML = `
    <div class="sheet-meta">
      <span class="chip-dot" style="background:${cat.color}"></span>
      <span>${cat.label || ''}</span>
      <span class="sheet-year">${p.year}</span>
      ${p.approx ? '<span class="sheet-approx">approximate location</span>' : ''}
    </div>
    <h2>${p.title}</h2>
    <p class="sheet-summary">${p.summary}</p>
    <p class="sheet-story">${p.story}</p>
    ${artist ? `
      <aside class="artist-card">
        <span class="artist-relation">${artist.relation}</span>
        <strong>${artist.name}</strong>
        <p>${artist.blurb}</p>
      </aside>` : ''}
    <div class="sheet-actions">
      <button class="btn btn-primary" id="checkin-btn">
        ${visited ? '✓ Visited' : state.band.gamification.checkinLabel}
      </button>
      <button class="btn" id="share-btn">Share</button>
    </div>
  `;
  body.querySelector('#checkin-btn').addEventListener('click', () => handleCheckin(feature));
  body.querySelector('#share-btn').addEventListener('click', () => shareFeature(p));
  $('sheet').classList.add('sheet-open');
  state.map.flyTo({
    center: feature.geometry.coordinates,
    zoom: Math.max(state.map.getZoom(), 6),
    padding: { bottom: 260 },
    duration: 900,
  });
}

function handleCheckin(feature) {
  const p = feature.properties;
  const before = computeProgress(state.checkins.asSet(), state.places, state.band);
  const nowVisited = state.checkins.toggle(p.id);
  pushCheckin(state.band.slug, p.id, nowVisited);
  refreshMapData();
  updateProgress();
  openSheet(feature);
  if (!nowVisited) return;
  const after = computeProgress(state.checkins.asSet(), state.places, state.band);
  const newBadges = after.badges.filter((b, i) => b.earned && !before.badges[i].earned);
  if (newBadges.length) {
    confetti({ particleCount: 120, spread: 75, origin: { y: 0.7 }, zIndex: 100 });
    toast(`🏅 Badge unlocked: ${newBadges.map((b) => b.label).join(' + ')}`);
  } else {
    const gained = after.points - before.points;
    toast(`+${gained} pts — checked in at ${p.title}`);
  }
  if (after.level !== before.level) {
    setTimeout(() => {
      confetti({ particleCount: 200, spread: 100, origin: { y: 0.6 }, zIndex: 100 });
      toast(`⬆ Level up: ${after.level.label}`);
    }, 2700);
  }
}

function closeSheet() {
  $('sheet').classList.remove('sheet-open');
  state.selectedId = null;
}

async function shareFeature(p) {
  const text = `${p.title} (${p.year}) — ${p.summary} #${state.band.name.replaceAll(' ', '')}`;
  const url = `${location.origin}${location.pathname}#${p.id}`;
  if (navigator.share) {
    try { await navigator.share({ title: p.title, text, url }); } catch { /* cancelled */ }
  } else {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast('Link copied to clipboard');
  }
}

function updateProgress() {
  const total = state.places.features.length;
  const count = state.checkins.count();
  $('progress-count').textContent = `${count}/${total}`;
  const pct = total ? (count / total) * 100 : 0;
  $('progress-ring').style.background =
    `conic-gradient(var(--accent) ${pct}%, color-mix(in srgb, var(--text) 15%, transparent) ${pct}%)`;
  const user = getUser();
  $('account-btn').textContent = user
    ? (user.email?.[0] || '☻').toUpperCase()
    : '☻';
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('toast-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('toast-show'), 2600);
}

function openModal(render) {
  const modal = $('modal');
  const card = $('modal-card');
  const close = () => modal.classList.remove('modal-open');
  render(card, close);
  modal.classList.add('modal-open');
  modal.onclick = (e) => { if (e.target === modal) close(); };
}

function openPassport() {
  const progress = computeProgress(state.checkins.asSet(), state.places, state.band);
  openModal((card, close) => {
    renderPassport(card, progress, state.band, state.places.features.length, {
      onClose: close,
      onShare: async () => {
        const text = `My ${state.band.name} pilgrimage: level “${progress.level.label}”, ` +
          `${progress.visitedCount}/${state.places.features.length} places, ${progress.points} pts. ` +
          `Can you beat it?`;
        if (navigator.share) {
          try { await navigator.share({ title: state.band.appTitle, text, url: location.origin }); } catch { /* cancelled */ }
        } else {
          await navigator.clipboard.writeText(`${text} ${location.origin}`);
          toast('Copied — paste it anywhere');
        }
      },
    });
  });
}

function openAccount() {
  openModal((card, close) => renderAuthModal(card, state.band, {
    onClose: close,
    onAdmin: () => openModal((c, cl) => renderAdmin(c, state, {
      onClose: cl, toast, setMode, refreshData: refreshMapData,
    })),
  }));
}

async function onSessionChange(user) {
  updateProgress();
  if (!user) return;
  const merged = await syncCheckins(state.band.slug, state.checkins.list());
  if (merged) {
    state.checkins.merge(merged);
    refreshMapData();
    updateProgress();
    toast('Progress synced to your account');
  }
}

/* ---------- Boot ---------- */

async function init() {
  const { band, places, artists } = await loadData();
  state.band = band;
  state.places = places;
  state.artists = new Map(artists.map((a) => [a.id, a]));
  state.checkins = createCheckins(band.slug);
  state.mode = localStorage.getItem(`wite:${band.slug}:mode`) || band.defaultMode || 'dark';

  applyTheme(band, state.mode);
  $('mode-btn').textContent = state.mode === 'dark' ? '◐' : '◑';
  buildFilters();
  buildTimeline();
  initAuth(onSessionChange);
  updateProgress();

  const map = new maplibregl.Map({
    container: 'map',
    style: currentTheme().mapStyle,
    center: band.map.center,
    zoom: band.map.zoom,
    attributionControl: { compact: true, customAttribution: band.map.attributionExtra },
  });
  state.map = map;
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), 'bottom-right');
  map.on('click', (e) => {
    // Only close the sheet when the click wasn't on a point/cluster
    const hits = map.queryRenderedFeatures(e.point, { layers: ['points', 'clusters'].filter((l) => map.getLayer(l)) });
    if (!hits.length) closeSheet();
  });

  // Re-added after every style change (mode toggle swaps the whole style).
  map.on('style.load', () => {
    map.setProjection({ type: 'globe' });
    addDataLayers();
  });
  bindMapInteractions();

  $('progress-pill').addEventListener('click', openPassport);
  $('account-btn').addEventListener('click', openAccount);
  $('mode-btn').addEventListener('click', () =>
    setMode(state.mode === 'dark' ? 'light' : 'dark'));

  // Deep link: /#place-id opens that place
  const hashId = location.hash.slice(1);
  if (hashId) {
    const feature = places.features.find((f) => f.properties.id === hashId);
    if (feature) map.once('load', () => openSheet(feature));
  }
}

window.__wite = state; // debug handle

init().catch((err) => {
  console.error(err);
  toast('Something went wrong loading the map data.');
});
