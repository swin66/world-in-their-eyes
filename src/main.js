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
import { openSideshow } from './sideshow.js';
import { maybeOnboard } from './onboarding.js';
import { getLang, getLangs, getSupportedLangs, setLang, t, tf } from './i18n.js';
import { speak, stopSpeaking, isSpeaking, clearCache, getVoiceForLang, setVoiceForLang, getAutoplay, setAutoplay, fetchVoices } from './tts.js';
import { initGalaxy } from './galaxy.js';

const ELEVENLABS_KEY = import.meta.env.VITE_ELEVENLABS_KEY || '';

const state = {
  band: null,
  places: null,
  trips: [],
  sideshows: [],
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
  const [band, placesJson, artistsJson, tripsJson, sideshowsJson] = await Promise.all([
    loadJSON('/data/band.json'),
    loadJSON('/data/places.json'),
    loadJSON('/data/artists.json'),
    loadJSON('/data/trips.json').catch(() => ({ trips: [] })),
    loadJSON('/data/sideshows.json').catch(() => ({ sideshows: [] })),
  ]);
  let places = placesJson;
  let artists = artistsJson.artists;
  let trips = tripsJson.trips || [];
  const sideshows = sideshowsJson.sideshows || [];
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
  return { band, places, artists, trips, sideshows };
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
        ['case', ['==', ['get', 'visited'], true], 13, 10],
        ['case', ['boolean', ['feature-state', 'hover'], false], 3, 0]],
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
      pushCamHistory();
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
        <h3>${t('fanMemories')}${list.length ? ` (${list.length})` : ''}</h3>
        <button class="btn-mini" id="add-memory-btn">+ ${state.band.gamification.contribution?.label || t('addMemory')}</button>
      </div>
      ${list.length ? `<div class="memories-list">
        ${list.map((c) => `
          <article class="memory">
            <span class="memory-kind">${KINDS[c.kind]?.icon || '💭'} ${KINDS[c.kind]?.label || ''}</span>
            ${c.text ? `<p>${c.text}</p>` : ''}
            ${c.mediaUrl ? `<img src="${c.mediaUrl}" alt="" loading="lazy">` : ''}
            ${c.url ? `<a href="${c.url}" target="_blank" rel="noopener">${c.url.replace(/^https?:\/\//, '').slice(0, 44)}…</a>` : ''}
          </article>`).join('')}
      </div>` : `<p class="memories-empty">${t('beFirst')}</p>`}
    </section>`;
}

function featureById(id) {
  return state.places.features.find((f) => f.properties.id === id);
}

function buzz(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

function openSheet(feature, zoomOverride, slideDir = 0, skipFly = false) {
  stopSpin();
  const p = feature.properties;
  state.selectedId = p.id;
  const cat = state.band.categories[p.category] || {};
  const visited = state.checkins.has(p.id);
  const isVerified = state.checkins.isVerified(p.id);
  const artist = p.artistId ? state.artists.get(p.artistId) : null;
  const body = $('sheet-body');
  const heroImg = p.image || p.images?.[0];
  const ttsAvailable = !!(ELEVENLABS_KEY && state.band.tts && getVoiceForLang(getLang(), state.band.tts));
  body.innerHTML = `
    ${heroImg ? `<img class="sheet-hero" src="${heroImg}" alt="${tf(p, 'title')}" loading="lazy">` : ''}
    <span class="sheet-cat-bar" style="background:linear-gradient(90deg, ${cat.color}, transparent)"></span>
    <span class="sheet-watermark" style="color:${cat.color}" aria-hidden="true">${p.year}</span>
    <div class="sheet-meta">
      <span class="chip-dot" style="background:${cat.color}"></span>
      <span>${cat.label || ''}</span>
      <span class="sheet-year">${p.year}</span>
      ${p.approx ? `<span class="sheet-approx">${t('approxLocation')}</span>` : ''}
      ${isVerified ? `<span class="sheet-approx sheet-verified">${t('verifiedVisit')}</span>` : ''}
    </div>
    <div class="sheet-title-row">
      <h2>${tf(p, 'title') || p.title}</h2>
      ${ttsAvailable ? `
        <button class="tts-fab" id="listen-btn" aria-label="Listen">
          <span class="tts-fab-icon">▶</span>
          <span class="audio-wave" id="audio-wave">
            <span></span><span></span><span></span><span></span>
          </span>
        </button>` : ''}
    </div>
    <p class="sheet-summary">${tf(p, 'summary') || p.summary}</p>
    <p class="sheet-story">${tf(p, 'story') || p.story}</p>
    ${triviaHTML(p)}
    ${artist ? `
      <aside class="artist-card">
        <span class="artist-relation">${artist.relation}</span>
        <strong>${artist.name}</strong>
        <p>${artist.blurb}</p>
      </aside>` : ''}
    ${memoriesHTML(p.id)}
    <div class="sheet-actions">
      <button class="btn btn-primary" id="checkin-btn">
        ${visited ? t('visited') : state.band.gamification.checkinLabel}
      </button>
      <button class="btn" id="share-btn">${t('share')}</button>
    </div>
  `;
  body.querySelector('#checkin-btn').addEventListener('click', () => handleCheckin(feature));
  body.querySelector('#share-btn').addEventListener('click', () => shareFeature(p));
  body.querySelector('#add-memory-btn').addEventListener('click', () => openMemoryForm(feature));
  const listenBtn = body.querySelector('#listen-btn');
  const audioWave = body.querySelector('#audio-wave');

  const setTtsState = (state) => {
    if (!listenBtn) return;
    const icon = listenBtn.querySelector('.tts-fab-icon');
    if (state === 'loading') { icon.textContent = '⏳'; listenBtn.disabled = true; audioWave?.classList.remove('playing'); }
    else if (state === 'playing') { icon.textContent = '⏸'; listenBtn.disabled = false; audioWave?.classList.add('playing'); }
    else { icon.textContent = '▶'; listenBtn.disabled = false; audioWave?.classList.remove('playing'); }
  };

  const triggerSpeak = () => {
    if (isSpeaking()) { stopSpeaking(); setTtsState('idle'); return; }
    setTtsState('loading');
    const voiceId = getVoiceForLang(getLang(), state.band.tts);
    const text = [
      tf(p, 'title') || p.title,
      tf(p, 'summary') || p.summary,
      tf(p, 'story') || p.story,
    ].filter(Boolean).join('. ');
    speak({
      text,
      apiKey: ELEVENLABS_KEY,
      voiceId,
      model: state.band.tts?.model,
      cacheKey: `${state.band.slug}:${p.id}:${getLang()}:${voiceId}`,
      onEnd: () => setTtsState('idle'),
      onError: (msg) => { toast(`🔇 ${msg}`); setTtsState('idle'); },
    }).then((ok) => { if (ok) setTtsState('playing'); else setTtsState('idle'); });
  };

  if (listenBtn) listenBtn.addEventListener('click', triggerSpeak);
  if (ttsAvailable && getAutoplay()) triggerSpeak();
  if (slideDir) {
    body.classList.remove('stop-anim');
    void body.offsetWidth; // restart animation between consecutive stops
    body.style.setProperty('--stop-dx', slideDir > 0 ? '28px' : '-28px');
    body.classList.add('stop-anim');
  }
  $('sheet').classList.add('sheet-open');
  if (!skipFly) {
    pushCamHistory();
    state.map.flyTo({
      center: feature.geometry.coordinates,
      zoom: zoomOverride ?? Math.max(state.map.getZoom(), 6),
      padding: { bottom: 260 },
      duration: zoomOverride ? 1600 : 900,
    });
  }
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
  startPings();
}
function stopSpin() {
  spinning = false;
  stopPings();
}

// Sonar pings: while the globe idles, random places pulse expanding rings —
// little "something happened here" heartbeats that invite a closer look.
let pingTimer = null;
let pingTicker = null;
let pings = [];

function ensurePingLayer() {
  const map = state.map;
  if (map.getSource('pings')) return;
  map.addSource('pings', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'pings',
    type: 'circle',
    source: 'pings',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'p'], 0, 2, 1, 30],
      'circle-color': 'transparent',
      'circle-stroke-width': ['interpolate', ['linear'], ['get', 'p'], 0, 2.5, 1, 0.5],
      'circle-stroke-color': currentTheme().accent,
      'circle-stroke-opacity': ['interpolate', ['linear'], ['get', 'p'], 0, 0.85, 1, 0],
    },
  }, state.map.getLayer('clusters') ? 'clusters' : undefined);
}

function startPings() {
  stopPings();
  ensurePingLayer();
  pingTimer = setInterval(() => {
    const features = state.places.features;
    const pick = features[Math.floor(Math.random() * features.length)];
    pings.push({ coords: pick.geometry.coordinates, born: performance.now() });
  }, 800);
  pingTicker = setInterval(() => {
    const now = performance.now();
    pings = pings.filter((ping) => now - ping.born < 1600);
    state.map.getSource('pings')?.setData({
      type: 'FeatureCollection',
      features: pings.map((ping) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: ping.coords },
        properties: { p: (now - ping.born) / 1600 },
      })),
    });
  }, 50);
}

function stopPings() {
  clearInterval(pingTimer);
  clearInterval(pingTicker);
  pingTimer = pingTicker = null;
  pings = [];
  state.map?.getSource('pings')?.setData({ type: 'FeatureCollection', features: [] });
}

/* ---------- Trips (guided journeys) ---------- */

// Auto-advance: optional hands-free playback with a configurable dwell time.
let tripTimer = null;
let tripArriveTimer = null;
function autoplaySeconds() {
  return Number(localStorage.getItem(`wite:${state.band.slug}:autoplay`) ?? 8);
}
function resetCountdown() {
  $('trip-countdown').classList.remove('trip-countdown-run');
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
  syncTripCountdown();
  if (playing) scheduleAdvance();
  else clearTimeout(tripTimer);
}

function tripFeatures(trip) {
  return trip.stops.map(featureById).filter(Boolean);
}

function ensureTripLayer() {
  const map = state.map;
  if (map.getSource('trip')) return;
  // lineMetrics lets us run a gradient (and a travelling pulse) along the arc.
  map.addSource('trip', {
    type: 'geojson',
    lineMetrics: true,
    data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } },
  });
  // Soft glow underlay.
  map.addLayer({
    id: 'trip-glow',
    type: 'line',
    source: 'trip',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': currentTheme().accent2,
      'line-width': 9,
      'line-opacity': 0.18,
      'line-blur': 6,
    },
  }, map.getLayer('clusters') ? 'clusters' : undefined);
  // Main arc with an accent→accent2 gradient running its length.
  map.addLayer({
    id: 'trip-line',
    type: 'line',
    source: 'trip',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-width': 2.6,
      'line-gradient': [
        'interpolate', ['linear'], ['line-progress'],
        0, currentTheme().accent,
        1, currentTheme().accent2,
      ],
    },
  }, map.getLayer('clusters') ? 'clusters' : undefined);
  // Pulsing "you are here" ring at the current stop (animated in the dash tick).
  map.addSource('trip-here', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'trip-here',
    type: 'circle',
    source: 'trip-here',
    paint: {
      'circle-radius': 8,
      'circle-color': 'transparent',
      'circle-stroke-color': currentTheme().accent,
      'circle-stroke-width': 2.5,
      'circle-stroke-opacity': 0.8,
    },
  });
}

let tripHereCoords = null;
function setTripHere(coords) {
  tripHereCoords = coords;
  state.map.getSource('trip-here')?.setData({
    type: 'FeatureCollection',
    features: coords ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: coords } }] : [],
  });
}

// Slerp between two lng/lat points along the globe's surface, so the route
// bows over the sphere instead of cutting a flat chord across it.
function greatCircle(a, b, segments = 48) {
  const toRad = Math.PI / 180;
  const [lng1, lat1] = a.map((v) => v * toRad);
  const [lng2, lat2] = b.map((v) => v * toRad);
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2));
  if (d === 0) return [a, b];
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
    const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    pts.push([
      Math.atan2(y, x) / toRad,
      Math.atan2(z, Math.sqrt(x * x + y * y)) / toRad,
    ]);
  }
  return pts;
}

function arcThroughStops(trip) {
  const coords = tripFeatures(trip).map((f) => f.geometry.coordinates);
  const path = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const seg = greatCircle(coords[i], coords[i + 1]);
    path.push(...(i === 0 ? seg : seg.slice(1)));
  }
  return path;
}

// A bright comet travels along the arc — slower and more deliberate than the
// old marching ants, with a soft trailing fade.
let dashRaf = null;
function startTripDash() {
  stopTripDash();
  const map = state.map;
  const t0 = performance.now();
  const PERIOD = 4200; // ms for the pulse to traverse the whole route
  const tick = (now) => {
    if (!map.getLayer('trip-line')) { dashRaf = requestAnimationFrame(tick); return; }
    const base = currentTheme().accent;
    const glow = currentTheme().accent2;
    const head = ((now - t0) % PERIOD) / PERIOD;
    const tail = 0.18; // length of the glowing comet trailing the head

    // Build strictly-ascending colour stops for a white comet riding the arc.
    const stops = new Map();
    stops.set(0, base);
    const lo = head - tail;
    if (lo > 0) { stops.set(lo, base); }
    stops.set(head, '#ffffff');
    stops.set(1, glow);
    const sorted = [...stops.entries()].sort((a, b) => a[0] - b[0]);
    const expr = ['interpolate', ['linear'], ['line-progress']];
    let prev = -1;
    for (const [pos, color] of sorted) {
      const p = Math.min(1, Math.max(0, pos));
      if (p <= prev) continue; // guarantee strictly ascending
      expr.push(p, color);
      prev = p;
    }
    map.setPaintProperty('trip-line', 'line-gradient', expr);

    // Pulse the current-stop ring: radius expands, opacity fades, on a loop.
    if (tripHereCoords && map.getLayer('trip-here')) {
      const pulse = ((now - t0) % 1700) / 1700;
      map.setPaintProperty('trip-here', 'circle-radius', 8 + pulse * 24);
      map.setPaintProperty('trip-here', 'circle-stroke-opacity', 0.85 * (1 - pulse));
    }
    dashRaf = requestAnimationFrame(tick);
  };
  dashRaf = requestAnimationFrame(tick);
}
function stopTripDash() {
  cancelAnimationFrame(dashRaf);
  dashRaf = null;
}

function drawTripLine(trip) {
  ensureTripLayer();
  state.map.getSource('trip').setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: arcThroughStops(trip) },
  });
}

function syncTripCountdown() {
  const cd = $('trip-countdown');
  cd.classList.remove('trip-countdown-run');
  if (!state.trip?.playing) return;
  void cd.offsetWidth; // restart the CSS animation
  cd.style.animationDuration = `${state.trip.seconds}s`;
  cd.classList.add('trip-countdown-run');
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
  $('trip-progress').innerHTML = tripFeatures(trip).map(() => '<span></span>').join('');
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
  const dir = index > trip.index ? 1 : index < trip.index ? -1 : 0;
  const fromCoords = features[trip.index]?.geometry.coordinates;
  trip.index = Math.max(0, index);
  const feature = features[trip.index];
  $('trip-stop-title').textContent = feature.properties.title;
  $('trip-step').textContent = `${trip.index + 1} / ${features.length} · ${feature.properties.year}`;
  [...$('trip-progress').children].forEach((seg, i) =>
    seg.classList.toggle('trip-seg-done', i <= trip.index));
  setTripHere(feature.geometry.coordinates);
  openSheet(feature, 9, dir, true); // camera handled by flyToStop below
  const flightMs = flyToStop(feature, fromCoords);
  // Hold the countdown + auto-advance until the camera actually arrives, so a
  // long flight never eats into reading time.
  clearTimeout(tripArriveTimer);
  resetCountdown(); // empty the bar while travelling
  tripArriveTimer = setTimeout(() => {
    syncTripCountdown();
    scheduleAdvance();
  }, flightMs);
}

// Fly to the next stop with a distance-aware arc: long hops take longer and
// pull the camera back so you see the leap across the globe, rather than
// whizzing over blank map.
function flyToStop(feature, fromCoords) {
  const to = feature.geometry.coordinates;
  const d = fromCoords ? haversineKm(fromCoords, to) : 0;
  const duration = Math.min(4200, Math.max(1100, 800 + d * 0.5));
  // Pull back for longer hops; very long hops show a near-global view mid-arc.
  const zoom = d > 4000 ? 5.5 : d > 1500 ? 7 : d > 400 ? 8.4 : 9;
  const curve = d > 1500 ? 1.9 : 1.5; // higher curve = more zoom-out arc
  stopSpin();
  pushCamHistory();
  state.map.flyTo({
    center: to, zoom, curve, duration,
    padding: { bottom: 260 },
    essential: true,
  });
  return duration;
}

function exitTrip() {
  clearTimeout(tripTimer);
  clearTimeout(tripArriveTimer);
  state.trip = null;
  delete document.body.dataset.trip;
  stopTripDash();
  $('trip-bar').hidden = true;
  state.map.getSource('trip')?.setData(
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
  setTripHere(null);
  closeSheet();
}

function openTrips() {
  const current = autoplaySeconds();
  openModal((card, close) => {
    card.innerHTML = `
      <h2>${t('takeATrip')}</h2>
      <p class="modal-text dim">${t('tripBlurb')}</p>
      <div class="admin-row">
        <span>${t('autoAdvance')}</span>
        <select id="trip-auto">
          ${[[0, t('autoOff')], [6, 'Every 6 seconds'], [8, 'Every 8 seconds'],
             [12, 'Every 12 seconds'], [20, 'Every 20 seconds']]
            .map(([v, label]) => `<option value="${v}" ${v === current ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
      <div class="trip-list">
        ${state.trips.map((trip) => {
          const stops = tripFeatures(trip);
          const visitedCount = stops.filter((f) => state.checkins.has(f.properties.id)).length;
          return `
            <button class="trip-card" data-id="${trip.id}">
              <span class="trip-emoji">${trip.emoji}</span>
              <span class="trip-card-body">
                <strong>${trip.title}</strong>
                <p>${trip.description}</p>
                <small>${stops.length} ${t('stops')} · ${visitedCount}/${stops.length} visited</small>
              </span>
            </button>`;
        }).join('')}
      </div>
      ${state.sideshows.length ? `
        <h2 style="margin-top:20px">${t('sideshows')}</h2>
        <p class="modal-text dim">${t('sideshowBlurb')}</p>
        <div class="trip-list">
          ${state.sideshows.map((s) => `
            <button class="trip-card trip-card--sideshow" data-sideshow="${s.id}">
              <span class="trip-emoji sideshow-entry-emoji">${s.emoji}</span>
              <span class="trip-card-body">
                <span class="sideshow-entry-tag">✦ Exhibit</span>
                <strong>${s.title}${state.sideshowLog.has(s.id) ? ' ✓' : ''}</strong>
                <p>${s.description}</p>
                <small>${s.cards.length} ${t('cards')}</small>
              </span>
            </button>`).join('')}
        </div>` : ''}`;
    card.querySelector('#trip-auto').addEventListener('change', (e) => {
      localStorage.setItem(`wite:${state.band.slug}:autoplay`, e.target.value);
    });
    for (const btn of card.querySelectorAll('.trip-card[data-id]')) {
      btn.addEventListener('click', () => {
        const trip = state.trips.find((t) => t.id === btn.dataset.id);
        close();
        if (trip) startTrip(trip);
      });
    }
    for (const btn of card.querySelectorAll('.trip-card[data-sideshow]')) {
      btn.addEventListener('click', () => {
        const show = state.sideshows.find((s) => s.id === btn.dataset.sideshow);
        close();
        if (show) startSideshow(show);
      });
    }
  });
}

function startSideshow(show) {
  const ttsConfig = state.band.tts && ELEVENLABS_KEY ? {
    apiKey: ELEVENLABS_KEY,
    voices: state.band.tts.voices,
    voiceId: state.band.tts.voiceId,
    model: state.band.tts.model,
    bandSlug: state.band.slug,
  } : null;
  openSideshow(show, {
    ttsConfig,
    onComplete: (def) => {
      const before = snapshotProgress();
      state.sideshowLog.markDone(def.id);
      state.streak.record();
      const after = snapshotProgress();
      confetti({ particleCount: 140, spread: 85, origin: { y: 0.6 }, zIndex: 100 });
      celebrateDiff(before, after, (gained) =>
        `✦ Sideshow complete: ${def.title}${gained ? ` (+${gained} pts)` : ''}`);
      updateProgress();
    },
  });
}

// Camera history — push before any intentional flyTo so the back button works.
const _camHistory = [];
function pushCamHistory() {
  const map = state.map;
  if (!map) return;
  _camHistory.push({ center: map.getCenter(), zoom: map.getZoom() });
  if (_camHistory.length > 20) _camHistory.shift();
}
function popCamHistory() {
  return _camHistory.pop() ?? null;
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

class BackControl {
  onAdd() {
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Previous view';
    btn.setAttribute('aria-label', 'Go back to previous zoom');
    btn.textContent = '↺';
    btn.className = 'home-ctrl';
    btn.addEventListener('click', () => {
      const prev = popCamHistory();
      if (prev) state.map.easeTo({ ...prev, duration: 600, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
    });
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
    completedSideshows: state.sideshowLog.asSet(),
    sideshowDefs: state.sideshows,
  };
}

function snapshotProgress() {
  return computeProgress(state.checkins.asSet(), state.places, state.band, progressExtras());
}

function celebrateDiff(before, after, fallbackMsg) {
  const newBadges = after.badges.filter((b, i) => b.earned && !before.badges[i].earned);
  if (newBadges.length) {
    confetti({ particleCount: 120, spread: 75, origin: { y: 0.7 }, zIndex: 100 });
    buzz([20, 30, 20, 30, 80]);
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
  buzz(onSite ? [30, 50, 30] : 15);
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
  stopSpeaking();
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
  openModal((card, close) => {
    renderAuthModal(card, state.band, {
      onClose: close,
      onAdmin: () => openModal((c, cl) => renderAdmin(c, state, {
        onClose: cl, toast, setMode, refreshData: refreshMapData,
      })),
    });
    injectFanLevel(card);
  });
}

/* ---------- Fan level (profile) + level-tuned trivia ---------- */

function fanLevels() {
  return state.band.fanLevels || [];
}
function getFanLevel() {
  const ids = fanLevels().map((l) => l.id);
  const saved = localStorage.getItem(`wite:${state.band.slug}:fanlevel`);
  return ids.includes(saved) ? saved : (state.band.defaultFanLevel || ids[1] || ids[0]);
}
function setFanLevel(id) {
  localStorage.setItem(`wite:${state.band.slug}:fanlevel`, id);
  // Refresh the open place card's trivia in place (no camera move).
  if (state.selectedId) {
    const f = featureById(state.selectedId);
    if (f) openSheet(f, null, 0, true);
  }
}
// Pick the trivia line for the user's level, falling back to the nearest
// lower tier — so a devotee without a devotee-line still sees a fact, but a
// curious newcomer is never shown the deep-cut spoilers.
function pickTrivia(p) {
  if (!p.trivia) return null;
  const order = fanLevels().map((l) => l.id);
  const idx = order.indexOf(getFanLevel());
  for (let i = idx; i >= 0; i--) {
    if (p.trivia[order[i]]) return { level: order[i], text: p.trivia[order[i]] };
  }
  return null;
}
function triviaHTML(p) {
  const trivia = pickTrivia(p);
  if (!trivia) return '';
  const label = trivia.level === 'devotee' ? t('deepCut') : t('didYouKnow');
  return `<aside class="sheet-trivia">
    <span class="trivia-label">${label}</span>
    <p>${trivia.text}</p>
  </aside>`;
}

function injectFanLevel(card) {
  const levels = fanLevels();
  if (!levels.length) return;
  const cur = getFanLevel();
  const blurb = (id) => `${levels.find((l) => l.id === id)?.blurb || ''} Trivia on each place tunes to your level.`;
  const wrap = document.createElement('div');
  wrap.className = 'fanlevel';
  wrap.innerHTML = `
    <span class="fanlevel-label">I'm a…</span>
    <div class="fanlevel-opts">
      ${levels.map((l) => `<button class="fanlevel-opt ${l.id === cur ? 'on' : ''}" data-level="${l.id}">${l.label}</button>`).join('')}
    </div>
    <p class="modal-text dim fanlevel-blurb">${blurb(cur)}</p>`;
  const h2 = card.querySelector('h2');
  if (h2) h2.after(wrap); else card.prepend(wrap);
  for (const btn of wrap.querySelectorAll('.fanlevel-opt')) {
    btn.addEventListener('click', () => {
      setFanLevel(btn.dataset.level);
      wrap.querySelectorAll('.fanlevel-opt').forEach((b) => b.classList.toggle('on', b === btn));
      wrap.querySelector('.fanlevel-blurb').textContent = blurb(btn.dataset.level);
    });
  }
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
  const { band, places, artists, trips, sideshows } = await loadData();
  state.band = band;
  state.places = places;
  state.trips = trips;
  state.sideshows = sideshows;
  state.artists = new Map(artists.map((a) => [a.id, a]));
  state.checkins = createCheckins(band.slug);
  state.streak = createStreak(band.slug);
  state.tripLog = createTripLog(band.slug);
  state.sideshowLog = createTripLog(`${band.slug}:sideshow`);
  state.contributions = createContributions(band.slug);
  state.contributions.loadRemote(places.features.map((f) => f.properties.id)).catch(() => {});
  state.mode = localStorage.getItem(`wite:${band.slug}:mode`) || band.defaultMode || 'dark';

  applyTheme(band, state.mode);
  initGalaxy();
  const introWillPlay = !sessionStorage.getItem('wite:intro-played');
  playIntro(band); // runs over the top while the map loads beneath
  setTimeout(() => maybeOnboard(band), introWillPlay ? 4400 : 1200);
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
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
  map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), 'bottom-left');
  map.addControl(new BackControl(), 'bottom-left');
  map.addControl(new HomeControl(() => {
    if (state.trip) exitTrip();
    closeSheet();
    closeWall();
    spinning = true; // resume the idle globe after the flight home
    map.flyTo({ ...startView, duration: 1600, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
  }), 'bottom-left');

  // The idle globe spins gently until the user takes over.
  let spinKicked = false;
  map.on('moveend', () => { if (spinning) spinStep(); });
  map.getCanvas().addEventListener('pointerdown', stopSpin);
  map.on('wheel', stopSpin);
  map.on('click', (e) => {
    // Only close the sheet when the click wasn't on a point/cluster
    const hits = map.queryRenderedFeatures(e.point, { layers: ['points', 'clusters'].filter((l) => map.getLayer(l)) });
    if (!hits.length) closeSheet();
  });

  // Re-added after every style change (mode toggle swaps the whole style).
  map.on('style.load', () => {
    map.setProjection({ type: 'globe' });
    addDataLayers();
    applyMapLanguage(getLang());
    if (state.trip) { drawTripLine(state.trip.def); setTripHere(tripHereCoords); startTripDash(); } // survive mode toggles
    // Kick off the idle spin once, as soon as the style+layers are ready
    // (more reliable than waiting on 'load', which can stall on slow tiles).
    if (!spinKicked && !state.trip && !location.hash) { spinKicked = true; startSpin(); }
    else if (spinning) startPings();
  });
  bindMapInteractions();
  // Belt-and-braces: some embedded webviews don't fire MapLibre's own observer
  window.addEventListener('resize', () => map.resize());

  $('progress-pill').addEventListener('click', openPassport);
  $('account-btn').addEventListener('click', openAccount);
  $('mode-btn').addEventListener('click', () =>
    setMode(state.mode === 'dark' ? 'light' : 'dark'));
  $('lang-btn').addEventListener('click', () => openLangPicker());
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

/* ---------- Language picker ---------- */

const OUR_LAYERS = new Set(['cluster-count', 'points-visited']);

function applyMapLanguage(lang) {
  const map = state.map;
  if (!map) return;
  map.getStyle()?.layers.forEach((layer) => {
    if (layer.type === 'symbol' && layer.layout?.['text-field'] && !OUR_LAYERS.has(layer.id)) {
      map.setLayoutProperty(layer.id, 'text-field',
        ['coalesce', ['get', `name:${lang}`], ['get', 'name']]);
    }
  });
}

function openLangPicker() {
  const allowed = (state.band.languages || getSupportedLangs()).filter((l) => getLangs()[l]);
  const ttsOn = !!(ELEVENLABS_KEY && state.band.tts);

  openModal((card, close) => {
    const renderCard = () => {
      const cur = getLang();
      card.innerHTML = `
        <h2>🌐 Language & Voice</h2>
        <p class="modal-text dim">UI language, map labels and audio narration.</p>
        <div class="lang-grid">
          ${allowed.map((l) => {
            const info = getLangs()[l];
            return `<button class="lang-opt ${l === cur ? 'lang-opt--on' : ''}" data-lang="${l}">
              <span class="lang-flag">${info.flag}</span>
              <span>${info.name}</span>
            </button>`;
          }).join('')}
        </div>
        ${ttsOn ? `
        <div class="tts-settings">
          <div class="admin-row">
            <span>🔊 Auto-play narration</span>
            <label class="toggle">
              <input type="checkbox" id="autoplay-toggle" ${getAutoplay() ? 'checked' : ''}>
              <span class="toggle-track"></span>
            </label>
          </div>
          <div class="admin-row" style="align-items:flex-start;flex-direction:column;gap:8px">
            <span style="font-size:13px;opacity:.7">Voice for <strong>${getLangs()[cur].flag} ${getLangs()[cur].name}</strong></span>
            <button class="btn" id="pick-voice-btn" style="width:100%;text-align:left">
              ${getVoiceLabel(cur)} <span style="opacity:.5;float:right">▾ change</span>
            </button>
          </div>
        </div>` : ''}`;

      for (const btn of card.querySelectorAll('.lang-opt')) {
        btn.addEventListener('click', () => {
          setLang(btn.dataset.lang, state.band.languages);
          applyMapLanguage(getLang());
          if (state.selectedId) {
            const f = featureById(state.selectedId);
            if (f) openSheet(f, null, 0, true);
          }
          toast(`${getLangs()[getLang()].flag} ${getLangs()[getLang()].name}`);
          renderCard(); // re-render to update "voice for X" label
        });
      }

      card.querySelector('#autoplay-toggle')?.addEventListener('change', (e) => {
        setAutoplay(e.target.checked);
      });

      card.querySelector('#pick-voice-btn')?.addEventListener('click', () => {
        openVoicePicker(getLang(), () => renderCard());
      });
    };

    renderCard();
  });
}

function getVoiceLabel(lang) {
  const vid = getVoiceForLang(lang, state.band.tts);
  const cached = _voiceCache.find((v) => v.voice_id === vid);
  return cached ? `${cached.name}` : vid ? `${vid.slice(0, 12)}…` : 'Not set';
}

let _voiceCache = [];

function openVoicePicker(lang, onPick) {
  openModal((card, close) => {
    card.innerHTML = `<h2>🎙 Choose a voice</h2><p class="modal-text dim">Loading your ElevenLabs voices…</p>`;
    fetchVoices(ELEVENLABS_KEY).then((voices) => {
      _voiceCache = voices;
      const cur = getVoiceForLang(lang, state.band.tts);
      if (!voices.length) {
        card.innerHTML += `<p class="modal-text dim">No voices found. Check your API key.</p>`;
        return;
      }
      const list = document.createElement('div');
      list.className = 'voice-list';
      list.innerHTML = voices.map((v) => {
        const accent = v.labels?.accent || '';
        const desc = [accent, v.labels?.gender, v.labels?.age].filter(Boolean).join(' · ');
        return `<button class="voice-opt ${v.voice_id === cur ? 'voice-opt--on' : ''}" data-vid="${v.voice_id}">
          <strong>${v.name}</strong>
          ${desc ? `<span class="voice-desc">${desc}</span>` : ''}
        </button>`;
      }).join('');
      card.querySelector('p').remove();
      card.appendChild(list);
      for (const btn of list.querySelectorAll('.voice-opt')) {
        btn.addEventListener('click', () => {
          setVoiceForLang(lang, btn.dataset.vid);
          clearCache(); // old cached audio used the old voice — invalidate
          close();
          onPick?.();
          toast(`Voice set to ${voices.find((v) => v.voice_id === btn.dataset.vid)?.name}`);
        });
      }
    });
  });
}

window.__wite = state; // debug handle

init().catch((err) => {
  console.error(err);
  toast('Something went wrong loading the map data.');
});
