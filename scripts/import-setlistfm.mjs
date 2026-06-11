// Imports a band's full concert history from setlist.fm, grouped by venue,
// as draft "gig" places. Free API key: https://api.setlist.fm/docs/1.0/index.html
//
// Usage:
//   SETLISTFM_API_KEY=... node scripts/import-setlistfm.mjs "Depeche Mode" [--pages 20] [--merge]
//
// Without --merge, writes public/data/imports/concerts.json for review.
// With --merge, appends new venues into public/data/places.json (dedupes by id).
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const API = 'https://api.setlist.fm/rest/1.0';
const key = process.env.SETLISTFM_API_KEY;
const artistName = process.argv[2];
const pagesArg = process.argv.indexOf('--pages');
const maxPages = pagesArg > -1 ? Number(process.argv[pagesArg + 1]) : 20;
const merge = process.argv.includes('--merge');

if (!key || !artistName) {
  console.error('Usage: SETLISTFM_API_KEY=... node scripts/import-setlistfm.mjs "Artist Name" [--pages N] [--merge]');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (path) => {
  const res = await fetch(`${API}${path}`, {
    headers: { 'x-api-key': key, Accept: 'application/json' },
  });
  if (res.status === 429) { await sleep(5000); return get(path); }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.json();
};

console.log(`Searching setlist.fm for "${artistName}"…`);
const search = await get(`/search/artists?artistName=${encodeURIComponent(artistName)}&sort=relevance`);
const artist = search.artist?.[0];
if (!artist) { console.error('Artist not found.'); process.exit(1); }
console.log(`Found ${artist.name} (${artist.mbid})`);

// venueId → aggregate
const venues = new Map();
let total = 0;
for (let page = 1; page <= maxPages; page++) {
  let data;
  try {
    data = await get(`/artist/${artist.mbid}/setlists?p=${page}`);
  } catch (err) {
    if (String(err).includes('404')) break; // past the last page
    throw err;
  }
  const setlists = data.setlist || [];
  if (!setlists.length) break;
  for (const sl of setlists) {
    const v = sl.venue;
    if (!v?.city?.coords) continue;
    const year = Number(sl.eventDate.split('-')[2]);
    const entry = venues.get(v.id) || {
      name: v.name, city: v.city.name, country: v.city.country?.name,
      lng: v.city.coords.long, lat: v.city.coords.lat,
      count: 0, firstYear: year, lastYear: year,
    };
    entry.count += 1;
    entry.firstYear = Math.min(entry.firstYear, year);
    entry.lastYear = Math.max(entry.lastYear, year);
    venues.set(v.id, entry);
    total += 1;
  }
  console.log(`Page ${page}: ${total} concerts across ${venues.size} venues so far`);
  await sleep(1100); // setlist.fm rate limit: ~1 req/sec
}

const features = [...venues.entries()].map(([id, v]) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
  properties: {
    id: `gig-${id}`,
    title: `${v.name}, ${v.city}`,
    category: 'gig',
    year: v.firstYear,
    approx: true,
    summary: v.count === 1
      ? `Played here in ${v.firstYear}.`
      : `${v.count} shows here, ${v.firstYear}–${v.lastYear}.`,
    story: `${artist.name} played ${v.name} in ${v.city}${v.country ? `, ${v.country}` : ''} ` +
      `${v.count === 1 ? `in ${v.firstYear}` : `${v.count} times between ${v.firstYear} and ${v.lastYear}`}. ` +
      'Imported from setlist.fm — add memories, refine the pin, or run npm run enrich.',
  },
}));

if (merge) {
  const places = JSON.parse(await readFile('public/data/places.json', 'utf8'));
  const existing = new Set(places.features.map((f) => f.properties.id));
  const fresh = features.filter((f) => !existing.has(f.properties.id));
  places.features.push(...fresh);
  await writeFile('public/data/places.json', JSON.stringify(places, null, 2));
  console.log(`Merged ${fresh.length} new venues into places.json (${features.length - fresh.length} already present).`);
} else {
  await mkdir('public/data/imports', { recursive: true });
  await writeFile('public/data/imports/concerts.json',
    JSON.stringify({ type: 'FeatureCollection', features }, null, 2));
  console.log(`Wrote ${features.length} venues (${total} concerts) to public/data/imports/concerts.json`);
  console.log('Review it, then re-run with --merge to fold into places.json.');
}
