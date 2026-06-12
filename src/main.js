import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import confetti from 'canvas-confetti';
import './style.css';
import { createCheckins, createStreak, createTripLog } from './gamification.js';
import { computeProgress, renderPassport, haversineKm } from './passport.js';
import { createContributions, KINDS, shrinkImage } from './contributions.js';
import { supabase } from './supabase.js';
import { initAuth, getUser, syncCheckins, pushCheckin, renderAuthModal } from './auth.js';
import { renderAdmin } from './admin.js';
import { openWall, closeWall } from './wall.js';
import { playIntro } from './intro.js';

const state = {
  band: null,
  places: null,
  trips: [],
  trip: null, // { def, index } while a guided trip is running
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
  const [band, placesJson, artistsJson, tripsJson] = await Promise.all([
    loadJSON('/data/band.json'),
    loadJSON('/data/places.json'),
    loadJSON('/data/artists.json'),
    loadJSON('/data/trips.json').catch(() => ({ trips: [] })),
  ]);
  let places = placesJson;
  let artists = artistsJson.artists;
  let trips = tripsJson.trips || [];
  if (supabase) {
    const [placesRes, artistsRes, tripsRes] = await Promise.all([
      supabase.from('places').select('*').eq('band_slug', band.slug),
      supabase.from('artists').select('*').eq('band_slug', band.slug),
      supabase.from('trips').select('*').eq('band_slug', band.slug).order('position'),
    ]);
    if (tripsRes.data?.length) trips = tripsRes.data;
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
  return { band, places, artists, trips };
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
    promoteId: 'id',
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
      'circle-radius': ['+',
        ['case', ['==', ['get', 'visited'], true], 9.5, 7.5],
        ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 0]],
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

  // Floating tooltip + hover glow on points; story count on clusters.
  const tip = document.createElement('div');
  tip.className = 'map-tip';
  document.getElementById('app').appendChild(tip);
  let hoveredId = null;
  const setHover = (id, on) =>
    map.setFeatureState({ source: 'places', id }, { hover: on });
  const showTip = (e, text) => {
    tip.textContent = text;
    tip.style.left = `${e.point.x}px`;
    tip.style.top = `${e.point.y - 14}px`;
    tip.classList.add('map-tip-show');
  };
  const hideTip = () => {
    tip.classList.remove('map-tip-show');
    if (hoveredId !== null) { setHover(hoveredId, false); hoveredId = null; }
  };
  map.on('mousemove', 'points', (e) => {
    const p = e.features[0].properties;
    if (hoveredId !== null && hoveredId !== p.id) setHover(hoveredId, false);
    hoveredId = p.id;
    setHover(hoveredId, true);
    showTip(e, `${p.title} · ${p.year}`);
  });
  map.on('mouseleave', 'points', hideTip);
  map.on('mousemove', 'clusters', (e) =>
    showTip(e, `${e.features[0].properties.point_count} stories — tap to open`));
  map.on('mouseleave', 'clusters', () => tip.classList.remove('map-tip-show'));

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

function memoriesHTML(placeId) {
  const list = state.contributions.forPlace(placeId);
  return `
    <section class="memories">
      <div class="memories-head">
        <h3>Fan memories${list.length ? ` (${list.length})` : ''}</h3>
        <button class="btn-mini" id="add-memory-btn">+ ${state.band.gamification.contribution?.label || 'Add a memory'}</button>
      </div>
      ${list.length ? `<div class="memories-list">
        ${list.map((c) => `
          <article class="memory">
            <span class="memory-kind">${KINDS[c.kind]?.icon || '💭'} ${KINDS[c.kind]?.label || ''}</span>
            ${c.text ? `<p>${c.text}</p>` : ''}
            ${c.mediaUrl ? `<img src="${c.mediaUrl}" alt="" loading="lazy">` : ''}
            ${c.url ? `<a href="${c.url}" target="_blank" rel="noopener">${c.url.replace(/^https?:\/\//, '').slice(0, 44)}…</a>` : ''}
          </article>`).join('')}
      </div>` : `<p class="memories-empty">Been here? Got a photo, a ticket stub, a story? Be the first to add one.</p>`}
    </section>`;
}

function featureById(id) {
  return state.places.features.find((f) => f.properties.id === id);
}

function openSheet(feature, zoomOverride) {
  stopSpin();
  const p = feature.properties;
  state.selectedId = p.id;
  const cat = state.band.categories[p.category] || {};
  const visited = state.checkins.has(p.id);
  const isVerified = state.checkins.isVerified(p.id);
  const artist = p.artistId ? state.artists.get(p.artistId) : null;
  const body = $('sheet-body');
  body.innerHTML = `
    <span class="sheet-cat-bar" style="background:linear-gradient(90deg, ${cat.color}, transparent)"></span>
    <span class="sheet-watermark" style="color:${cat.color}" aria-hidden="true">${p.year}</span>
    <div class="sheet-meta">
      <span class="chip-dot" style="background:${cat.color}"></span>
      <span>${cat.label || ''}</span>
      <span class="sheet-year">${p.year}</span>
      ${p.approx ? '<span class="sheet-approx">approximate location</span>' : ''}
      ${isVerified ? '<span class="sheet-approx sheet-verified">📍 verified visit</span>' : ''}
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
    ${memoriesHTML(p.id)}
    <div class="sheet-actions">
      <button class="btn btn-primary" id="checkin-btn">
        ${visited ? '✓ Visited' : state.band.gamification.checkinLabel}
      </button>
      <button class="btn" id="share-btn">Share</button>
    </div>
  `;
  body.querySelector('#checkin-btn').addEventListener('click', () => handleCheckin(feature));
  body.querySelector('#share-btn').addEventListener('click', () => shareFeature(p));
  body.querySelector('#add-memory-btn').addEventListener('click', () => openMemoryForm(feature));
  $('sheet').classList.add('sheet-open');
  state.map.flyTo({
    center: feature.geometry.coordinates,
    zoom: zoomOverride ?? Math.max(state.map.getZoom(), 6),
    padding: { bottom: 260 },
    duration: zoomOverride ? 1600 : 900,
  });
}

/* ---------- Search ---------- */

function openSearch() {
  $('search').hidden = false;
  $('search-input').value = '';
  $('search-results').innerHTML = '';
  $('search-input').focus();
}

function closeSearch() {
  $('search').hidden = true;
  $('search-input').blur();
}

function runSearch(query) {
  const q = query.trim().toLowerCase();
  const box = $('search-results');
  if (q.length < 2) { box.innerHTML = ''; return; }
  const scored = state.places.features.map((f) => {
    const p = f.properties;
    const title = p.title.toLowerCase();
    const cat = (state.band.categories[p.category]?.label || '').toLowerCase();
    let score = 0;
    if (title.startsWith(q)) score = 3;
    else if (title.includes(q)) score = 2;
    else if (cat.includes(q) || String(p.year) === q || (p.summary || '').toLowerCase().includes(q)) score = 1;
    return { f, score };
  }).filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.f.properties.year - b.f.properties.year)
    .slice(0, 8);

  box.innerHTML = scored.map(({ f }) => {
    const p = f.properties;
    const cat = state.band.categories[p.category] || {};
    return `
      <button class="search-result" data-id="${p.id}">
        <span class="chip-dot" style="background:${cat.color}"></span>
        <span class="search-result-title">${p.title}</span>
        <span class="search-result-meta">${cat.label || ''} · ${p.year}</span>
      </button>`;
  }).join('') || '<p class="search-empty">Nothing found — try a place, album or year.</p>';

  for (const btn of box.querySelectorAll('.search-result')) {
    btn.addEventListener('click', () => {
      const feature = featureById(btn.dataset.id);
      closeSearch();
      if (feature) openSheet(feature, Math.max(state.map.getZoom(), 8));
    });
  }
}

/* ---------- Keyboard ---------- */

function isTyping() {
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
}

// Drag the handle down to dismiss the sheet (mobile-natural gesture).
function bindSheetSwipe() {
  const sheet = $('sheet');
  const handleZone = sheet.querySelector('.sheet-handle');
  let startY = null;
  handleZone.addEventListener('pointerdown', (e) => {
    startY = e.clientY;
    sheet.style.transition = 'none';
    handleZone.setPointerCapture(e.pointerId);
  });
  handleZone.addEventListener('pointermove', (e) => {
    if (startY === null) return;
    const dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const release = (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    startY = null;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dy > 80) closeSheet();
  };
  handleZone.addEventListener('pointerup', release);
  handleZone.addEventListener('pointercancel', release);
}

function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('search').hidden) return closeSearch();
      if ($('modal').classList.contains('modal-open')) return $('modal').classList.remove('modal-open');
      if (document.getElementById('wall').classList.contains('wall-open')) return closeWall();
      if (state.trip) return exitTrip();
      return closeSheet();
    }
    if (isTyping()) {
      if (e.key === 'Enter' && document.activeElement === $('search-input')) {
        $('search-results').querySelector('.search-result')?.click();
      }
      return;
    }
    if (e.key === '/') { e.preventDefault(); openSearch(); }
    if (state.trip) {
      if (e.key === 'ArrowRight') goToStop(state.trip.index + 1);
      if (e.key === 'ArrowLeft') goToStop(state.trip.index - 1);
    }
  });
}

/* ---------- Spinning globe opening view ---------- */

// Centre the opening globe on where the story actually lives: the median of
// all plotted points (median resists outliers like a one-off gig in Rio).
function computeStartView() {
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const coords = state.places.features.map((f) => f.geometry.coordinates);
  return {
    center: [median(coords.map((c) => c[0])), median(coords.map((c) => c[1]))],
    zoom: state.band.map.startZoom ?? 2.1,
  };
}

let spinning = false;
function spinStep() {
  if (!spinning) return;
  const center = state.map.getCenter();
  center.lng += 5; // gentle: a full rotation takes ~5 minutes
  state.map.easeTo({ center, duration: 4000, easing: (n) => n });
}
function startSpin() {
  spinning = true;
  spinStep();
}
function stopSpin() {
  spinning = false;
}

/* ---------- Trips (guided journeys) ---------- */

// Auto-advance: optional hands-free playback with a configurable dwell time.
let tripTimer = null;
function autoplaySeconds() {
  return Number(localStorage.getItem(`wite:${state.band.slug}:autoplay`) ?? 8);
}
function scheduleAdvance() {
  clearTimeout(tripTimer);
  if (!state.trip?.playing) return;
  tripTimer = setTimeout(() => goToStop(state.trip.index + 1), state.trip.seconds * 1000);
}
function setTripPlaying(playing) {
  if (!state.trip) return;
  state.trip.playing = playing;
  $('trip-play').textContent = playing ? '⏸' : '▶';
  if (playing) scheduleAdvance();
  else clearTimeout(tripTimer);
}

function tripFeatures(trip) {
  return trip.stops.map(featureById).filter(Boolean);
}

function ensureTripLayer() {
  const map = state.map;
  if (map.getSource('trip')) return;
  map.addSource('trip', {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } },
  });
  map.addLayer({
    id: 'trip-line',
    type: 'line',
    source: 'trip',
    paint: {
      'line-color': currentTheme().accent,
      'line-width': 2.5,
      'line-dasharray': [0.8, 1.6],
      'line-opacity': 0.85,
    },
  }, map.getLayer('clusters') ? 'clusters' : undefined);
}

// "Marching ants" glow along the active trip route.
const DASH_FRAMES = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5],
  [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5],
];
let dashTimer = null;
function startTripDash() {
  stopTripDash();
  let frame = 0;
  dashTimer = setInterval(() => {
    if (!state.map.getLayer('trip-line')) return;
    frame = (frame + 1) % DASH_FRAMES.length;
    state.map.setPaintProperty('trip-line', 'line-dasharray', DASH_FRAMES[frame]);
  }, 90);
}
function stopTripDash() {
  clearInterval(dashTimer);
  dashTimer = null;
}

function drawTripLine(trip) {
  ensureTripLayer();
  state.map.getSource('trip').setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: tripFeatures(trip).map((f) => f.geometry.coordinates) },
  });
}

function startTrip(trip) {
  stopSpin();
  const seconds = autoplaySeconds();
  state.trip = { def: trip, index: 0, seconds: seconds || 8, playing: seconds > 0 };
  document.body.dataset.trip = '1';
  drawTripLine(trip);
  startTripDash();
  $('trip-bar').hidden = false;
  $('trip-title').textContent = `${trip.emoji} ${trip.title}`;
  $('trip-play').textContent = state.trip.playing ? '⏸' : '▶';
  goToStop(0);
}

function goToStop(index) {
  const trip = state.trip;
  if (!trip) return;
  const features = tripFeatures(trip.def);
  if (index >= features.length) {
    const before = snapshotProgress();
    state.tripLog.markDone(trip.def.id);
    state.streak.record();
    const after = snapshotProgress();
    confetti({ particleCount: 160, spread: 90, origin: { y: 0.6 }, zIndex: 100 });
    celebrateDiff(before, after, (gained) =>
      `🧭 Trip complete: ${trip.def.title}${gained ? ` (+${gained} pts)` : ''}`);
    exitTrip();
    updateProgress();
    return;
  }
  trip.index = Math.max(0, index);
  const feature = features[trip.index];
  $('trip-step').textContent = `Stop ${trip.index + 1} of ${features.length} — ${feature.properties.year}`;
  openSheet(feature, 9);
  scheduleAdvance();
}

function exitTrip() {
  clearTimeout(tripTimer);
  state.trip = null;
  delete document.body.dataset.trip;
  stopTripDash();
  $('trip-bar').hidden = true;
  state.map.getSource('trip')?.setData(
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
  closeSheet();
}

function openTrips() {
  const current = autoplaySeconds();
  openModal((card, close) => {
    card.innerHTML = `
      <h2>Take a trip</h2>
      <p class="modal-text dim">Guided journeys through the story — pick one and sit back.</p>
      <div class="admin-row">
        <span>Auto-advance</span>
        <select id="trip-auto">
          ${[[0, "Off — I'll click"], [6, 'Every 6 seconds'], [8, 'Every 8 seconds'],
             [12, 'Every 12 seconds'], [20, 'Every 20 seconds']]
            .map(([v, label]) => `<option value="${v}" ${v === current ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
      <div class="trip-list">
        ${state.trips.map((t) => {
          const stops = tripFeatures(t);
          const visited = stops.filter((f) => state.checkins.has(f.properties.id)).length;
          return `
            <button class="trip-card" data-id="${t.id}">
              <span class="trip-emoji">${t.emoji}</span>
              <span class="trip-card-body">
                <strong>${t.title}</strong>
                <p>${t.description}</p>
                <small>${stops.length} stops · ${visited}/${stops.length} visited</small>
              </span>
            </button>`;
        }).join('')}
      </div>`;
    card.querySelector('#trip-auto').addEventListener('change', (e) => {
      localStorage.setItem(`wite:${state.band.slug}:autoplay`, e.target.value);
    });
    for (const btn of card.querySelectorAll('.trip-card')) {
      btn.addEventListener('click', () => {
        const trip = state.trips.find((t) => t.id === btn.dataset.id);
        close();
        if (trip) startTrip(trip);
      });
    }
  });
}

class HomeControl {
  constructor(onClick) { this._onClick = onClick; }
  onAdd() {
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Reset view';
    btn.setAttribute('aria-label', 'Reset map to start');
    btn.textContent = '⌂';
    btn.className = 'home-ctrl';
    btn.addEventListener('click', this._onClick);
    this._container.appendChild(btn);
    return this._container;
  }
  onRemove() { this._container.remove(); }
}

function progressExtras() {
  return {
    verified: state.checkins.verifiedSet(),
    contributions: state.contributions.count(),
    mediaContributions: state.contributions.mediaCount(),
    streakBest: state.streak.best(),
    streakNow: state.streak.current(),
    completedTrips: state.tripLog.asSet(),
    tripDefs: state.trips,
  };
}

function snapshotProgress() {
  return computeProgress(state.checkins.asSet(), state.places, state.band, progressExtras());
}

function celebrateDiff(before, after, fallbackMsg) {
  const newBadges = after.badges.filter((b, i) => b.earned && !before.badges[i].earned);
  if (newBadges.length) {
    confetti({ particleCount: 120, spread: 75, origin: { y: 0.7 }, zIndex: 100 });
    toast(`🏅 Badge unlocked: ${newBadges.map((b) => b.label).join(' + ')}`);
  } else {
    toast(fallbackMsg(after.points - before.points));
  }
  if (after.level !== before.level) {
    setTimeout(() => {
      confetti({ particleCount: 200, spread: 100, origin: { y: 0.6 }, zIndex: 100 });
      toast(`⬆ Level up: ${after.level.label}`);
    }, 2700);
  }
}

// GPS verification: quietly checks whether the fan is actually standing there.
function tryVerifyLocation(feature) {
  const radius = state.band.gamification.verified?.radiusKm || 1;
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const km = haversineKm(
          [pos.coords.longitude, pos.coords.latitude],
          feature.geometry.coordinates,
        );
        resolve(km <= radius);
      },
      () => resolve(false),
      { timeout: 5000, maximumAge: 300000 },
    );
  });
}

async function handleCheckin(feature) {
  const p = feature.properties;
  const before = snapshotProgress();
  const nowVisited = state.checkins.toggle(p.id);
  if (!nowVisited) {
    pushCheckin(state.band.slug, p.id, false);
    refreshMapData();
    updateProgress();
    openSheet(feature);
    return;
  }
  state.streak.record();
  const onSite = !state.checkins.isVerified(p.id) && await tryVerifyLocation(feature);
  if (onSite) state.checkins.markVerified(p.id);
  pushCheckin(state.band.slug, p.id, true, state.checkins.isVerified(p.id));
  refreshMapData();
  updateProgress();
  openSheet(feature);
  const after = snapshotProgress();
  celebrateDiff(before, after, (gained) => onSite
    ? `📍 Verified pilgrimage! +${gained} pts at ${p.title}`
    : `+${gained} pts — checked in at ${p.title}`);
  if (onSite) confetti({ particleCount: 80, spread: 60, origin: { y: 0.75 }, zIndex: 100 });
}

function openMemoryForm(feature) {
  const p = feature.properties;
  openModal((card, close) => {
    card.innerHTML = `
      <h2>Add to ${p.title}</h2>
      <p class="modal-text dim">Memories, photos, ticket stubs, videos, articles — anything that belongs here.</p>
      <div class="admin-row">
        <select id="mem-kind">
          ${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v.icon} ${v.label}</option>`).join('')}
        </select>
      </div>
      <textarea id="mem-text" rows="3" placeholder="What happened here, for you?"
        style="width:100%;background:color-mix(in srgb, var(--text) 7%, transparent);border:1px solid var(--line);border-radius:12px;padding:11px 13px;color:var(--text);font:inherit;font-size:14px"></textarea>
      <div class="admin-row" id="mem-file-row">
        <label class="btn" style="text-align:center">📷 Add a photo / scan
          <input type="file" id="mem-file" accept="image/*" hidden>
        </label>
      </div>
      <div class="admin-row" id="mem-url-row" hidden>
        <input type="text" id="mem-url" placeholder="https:// link to the video or article">
      </div>
      <img id="mem-preview" hidden style="max-width:100%;border-radius:12px;margin-bottom:10px">
      <div class="sheet-actions">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-primary" data-save>Share it</button>
      </div>`;
    let mediaUrl = null;
    const kindSel = card.querySelector('#mem-kind');
    const syncRows = () => {
      const k = kindSel.value;
      card.querySelector('#mem-url-row').hidden = !(k === 'video' || k === 'article');
      card.querySelector('#mem-file-row').hidden = (k === 'video' || k === 'article');
    };
    kindSel.addEventListener('change', syncRows);
    syncRows();
    card.querySelector('#mem-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      mediaUrl = await shrinkImage(file);
      const img = card.querySelector('#mem-preview');
      img.src = mediaUrl;
      img.hidden = false;
    });
    card.querySelector('[data-cancel]').addEventListener('click', close);
    card.querySelector('[data-save]').addEventListener('click', () => {
      const text = card.querySelector('#mem-text').value.trim();
      const url = card.querySelector('#mem-url').value.trim();
      if (!text && !mediaUrl && !url) { toast('Add a few words, a photo or a link first'); return; }
      const before = snapshotProgress();
      state.contributions.add({ placeId: p.id, kind: kindSel.value, text, mediaUrl, url: url || null });
      state.streak.record();
      close();
      openSheet(feature);
      const after = snapshotProgress();
      celebrateDiff(before, after, (gained) => `+${gained} pts — thank you for sharing`);
      updateProgress();
    });
  });
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
  const progress = snapshotProgress();
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
  const { band, places, artists, trips } = await loadData();
  state.band = band;
  state.places = places;
  state.trips = trips;
  state.artists = new Map(artists.map((a) => [a.id, a]));
  state.checkins = createCheckins(band.slug);
  state.streak = createStreak(band.slug);
  state.tripLog = createTripLog(band.slug);
  state.contributions = createContributions(band.slug);
  state.contributions.loadRemote(places.features.map((f) => f.properties.id)).catch(() => {});
  state.mode = localStorage.getItem(`wite:${band.slug}:mode`) || band.defaultMode || 'dark';

  applyTheme(band, state.mode);
  playIntro(band); // runs over the top while the map loads beneath
  $('mode-btn').textContent = state.mode === 'dark' ? '◐' : '◑';
  buildFilters();
  buildTimeline();
  initAuth(onSessionChange);
  updateProgress();

  const startView = computeStartView();
  const map = new maplibregl.Map({
    container: 'map',
    style: currentTheme().mapStyle,
    center: startView.center,
    zoom: startView.zoom,
    attributionControl: { compact: true, customAttribution: band.map.attributionExtra },
  });
  state.map = map;
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), 'bottom-right');
  map.addControl(new HomeControl(() => {
    if (state.trip) exitTrip();
    closeSheet();
    closeWall();
    spinning = true; // resume the idle globe after the flight home
    map.flyTo({ ...startView, duration: 1600 });
  }), 'bottom-right');

  // The idle globe spins gently until the user takes over.
  map.on('moveend', () => { if (spinning) spinStep(); });
  map.getCanvas().addEventListener('pointerdown', stopSpin);
  map.on('wheel', stopSpin);
  if (!location.hash) map.once('load', startSpin);
  map.on('click', (e) => {
    // Only close the sheet when the click wasn't on a point/cluster
    const hits = map.queryRenderedFeatures(e.point, { layers: ['points', 'clusters'].filter((l) => map.getLayer(l)) });
    if (!hits.length) closeSheet();
  });

  // Re-added after every style change (mode toggle swaps the whole style).
  map.on('style.load', () => {
    map.setProjection({ type: 'globe' });
    addDataLayers();
    if (state.trip) drawTripLine(state.trip.def); // survive mode toggles
  });
  bindMapInteractions();
  // Belt-and-braces: some embedded webviews don't fire MapLibre's own observer
  window.addEventListener('resize', () => map.resize());

  $('progress-pill').addEventListener('click', openPassport);
  $('account-btn').addEventListener('click', openAccount);
  $('mode-btn').addEventListener('click', () =>
    setMode(state.mode === 'dark' ? 'light' : 'dark'));
  $('trips-btn').addEventListener('click', openTrips);
  $('trip-prev').addEventListener('click', () => goToStop(state.trip.index - 1));
  $('trip-next').addEventListener('click', () => goToStop(state.trip.index + 1));
  $('trip-play').addEventListener('click', () => setTripPlaying(!state.trip.playing));
  $('trip-exit').addEventListener('click', exitTrip);
  $('search-btn').addEventListener('click', () =>
    $('search').hidden ? openSearch() : closeSearch());
  $('search-input').addEventListener('input', (e) => runSearch(e.target.value));
  bindKeyboard();
  bindSheetSwipe();
  $('trip-info').addEventListener('click', () => goToStop(state.trip.index));

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
