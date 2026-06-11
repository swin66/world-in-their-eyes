// Seeds the Supabase database from the static JSON in public/data/.
// Usage:
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... npm run seed
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Project Settings → API).');
  process.exit(1);
}
const db = createClient(url, key);

const band = JSON.parse(await readFile('public/data/band.json', 'utf8'));
const places = JSON.parse(await readFile('public/data/places.json', 'utf8'));
const { artists } = JSON.parse(await readFile('public/data/artists.json', 'utf8'));

const fail = (label) => (res) => {
  if (res.error) { console.error(`${label}:`, res.error.message); process.exit(1); }
  return res;
};

fail('bands')(await db.from('bands').upsert({ slug: band.slug, name: band.name, config: band }));

fail('artists')(await db.from('artists').upsert(
  artists.map((a) => ({ ...a, band_slug: band.slug })),
));

fail('places')(await db.from('places').upsert(
  places.features.map((f) => ({
    id: f.properties.id,
    band_slug: band.slug,
    title: f.properties.title,
    category: f.properties.category,
    year: f.properties.year,
    summary: f.properties.summary,
    story: f.properties.story,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    approx: Boolean(f.properties.approx),
    artist_id: f.properties.artistId || null,
  })),
));

console.log(`Seeded: 1 band, ${artists.length} artists, ${places.features.length} places.`);
