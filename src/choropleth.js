// Subtle data-driven country tint ("where the band's world is").
//
// Default metric: how many of the band's mapped places fall inside each
// country — free, already present, and self-updating as gigs/places import.
// A band can override this by shipping an `audience` map in band.json
// ({ "DE": 1200000, "US": 980000, ... } — any units, e.g. Spotify streams
// or fan counts); when present it takes precedence over place density.
//
// The fill is intentionally restrained: one band-accent hue, opacity on a
// sqrt curve so a single event still registers faintly and the busiest
// country never shouts. Slots in beneath the map's labels.

let countriesGeo = null;

async function loadCountries() {
  if (countriesGeo) return countriesGeo;
  const res = await fetch('/data/world-countries.json');
  countriesGeo = await res.json();
  return countriesGeo;
}

// --- Point-in-polygon (ray casting, handles holes + MultiPolygon) ---

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(pt, polygon) {
  // polygon = [outerRing, hole1, hole2, ...]
  if (!pointInRing(pt, polygon[0])) return false;
  for (let h = 1; h < polygon.length; h++) {
    if (pointInRing(pt, polygon[h])) return false; // inside a hole
  }
  return true;
}

function bboxOf(feature) {
  if (feature._bbox) return feature._bbox;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const polys =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  for (const poly of polys) {
    for (const [x, y] of poly[0]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  feature._bbox = [minX, minY, maxX, maxY];
  return feature._bbox;
}

function countryAt(pt, features) {
  const [x, y] = pt;
  for (const f of features) {
    const [minX, minY, maxX, maxY] = bboxOf(f);
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    const polys =
      f.geometry.type === 'Polygon'
        ? [f.geometry.coordinates]
        : f.geometry.coordinates;
    for (const poly of polys) {
      if (pointInPolygon(pt, poly)) return f.properties.iso;
    }
  }
  return null;
}

// Build a { iso: value } intensity map, either from band.audience or by
// tallying the band's place coordinates into countries.
function buildValues(band, placeFeatures, countries) {
  if (band?.audience && Object.keys(band.audience).length) {
    return { values: { ...band.audience }, metric: 'audience' };
  }
  const values = {};
  for (const f of placeFeatures) {
    const c = f.geometry?.coordinates;
    if (!c || f.properties?.point_count) continue; // skip clusters
    const iso = countryAt(c, countries.features);
    if (iso) values[iso] = (values[iso] || 0) + 1;
  }
  return { values, metric: 'places' };
}

// Attach a 0..1 `intensity` (sqrt-scaled) + raw `value` to each country.
function decorate(countries, values) {
  const max = Math.max(1, ...Object.values(values));
  const denom = Math.sqrt(max);
  for (const f of countries.features) {
    const v = values[f.properties.iso] || 0;
    f.properties.value = v;
    f.properties.intensity = v > 0 ? Math.sqrt(v) / denom : 0;
  }
  return countries;
}

// First symbol (label) layer — we insert the fill just beneath it so all
// place/country labels stay legible on top of the tint.
function firstLabelLayer(map) {
  const layers = map.getStyle()?.layers || [];
  const sym = layers.find((l) => l.type === 'symbol');
  return sym?.id;
}

export async function addChoropleth(map, band, placeFeatures, accent) {
  if (map.getSource('audience')) return;
  const countries = await loadCountries();
  const { values, metric } = buildValues(band, placeFeatures, countries);
  if (!Object.keys(values).length) return; // nothing to show
  decorate(countries, values);

  map.addSource('audience', { type: 'geojson', data: countries });

  const before = firstLabelLayer(map);
  map.addLayer(
    {
      id: 'audience-fill',
      type: 'fill',
      source: 'audience',
      filter: ['>', ['get', 'intensity'], 0],
      paint: {
        'fill-color': accent,
        // Subtle: caps at ~0.3 even for the busiest country.
        'fill-opacity': [
          'interpolate', ['linear'], ['get', 'intensity'],
          0, 0,
          1, 0.3,
        ],
      },
    },
    before,
  );
  // Faint edge only on countries with data, for a touch of definition.
  map.addLayer(
    {
      id: 'audience-line',
      type: 'line',
      source: 'audience',
      filter: ['>', ['get', 'intensity'], 0],
      paint: {
        'line-color': accent,
        'line-width': 0.6,
        'line-opacity': [
          'interpolate', ['linear'], ['get', 'intensity'],
          0, 0,
          1, 0.35,
        ],
      },
    },
    before,
  );
  return metric;
}

export function removeChoropleth(map) {
  for (const id of ['audience-fill', 'audience-line']) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource('audience')) map.removeSource('audience');
}
