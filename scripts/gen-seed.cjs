// Generates supabase/seed_<slug>.sql from a band's JSON data files.
// Usage: node scripts/gen-seed.cjs depeche-mode
const fs = require('fs');
const path = require('path');

const slug = process.argv[2] || 'depeche-mode';
const dir = path.join('public/data/bands', slug);
const band = JSON.parse(fs.readFileSync(path.join(dir, 'band.json'), 'utf8'));
const places = JSON.parse(fs.readFileSync(path.join(dir, 'places.json'), 'utf8')).features;
const artists = JSON.parse(fs.readFileSync(path.join(dir, 'artists.json'), 'utf8')).artists;
const trips = JSON.parse(fs.readFileSync(path.join(dir, 'trips.json'), 'utf8')).trips;

const esc = (s) => String(s).split("'").join("''");
const q = (v) => (v === null || v === undefined) ? 'null' : "'" + esc(v) + "'";
const j = (v) => "'" + esc(JSON.stringify(v)) + "'::jsonb";
const num = (v) => (v === null || v === undefined || v === '') ? 'null' : Number(v);
const bool = (v) => (v ? 'true' : 'false');

const artistIds = new Set(artists.map((a) => a.id));
const out = [];
out.push('-- Seed: ' + band.name + ' — generated from the JSON data files.');
out.push('-- Run AFTER migration_core_tables.sql. Idempotent (upserts by id).');
out.push('');

out.push('insert into public.bands (slug, name, config) values');
out.push('  (' + [q(slug), q(band.name), j(band)].join(', ') + ')');
out.push('on conflict (slug) do update set name = excluded.name, config = excluded.config;');
out.push('');

out.push('insert into public.artists (id, band_slug, name, relation, blurb) values');
out.push(artists.map((a) =>
  '  (' + [q(a.id), q(slug), q(a.name), q(a.relation), q(a.blurb)].join(', ') + ')').join(',\n'));
out.push('on conflict (id) do update set name=excluded.name, relation=excluded.relation, blurb=excluded.blurb;');
out.push('');

out.push('insert into public.places (id, band_slug, title, category, year, summary, story, lng, lat, approx, artist_id) values');
out.push(places.map((f) => {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  const aid = (p.artistId && artistIds.has(p.artistId)) ? q(p.artistId) : 'null';
  return '  (' + [q(p.id), q(slug), q(p.title), q(p.category), num(p.year),
    q(p.summary), q(p.story), num(lng), num(lat), bool(p.approx), aid].join(', ') + ')';
}).join(',\n'));
out.push('on conflict (id) do update set title=excluded.title, category=excluded.category, year=excluded.year, summary=excluded.summary, story=excluded.story, lng=excluded.lng, lat=excluded.lat, approx=excluded.approx, artist_id=excluded.artist_id;');
out.push('');

out.push('insert into public.trips (id, band_slug, emoji, title, description, badge, stops, position) values');
out.push(trips.map((t, i) =>
  '  (' + [q(t.id), q(slug), q(t.emoji), q(t.title), q(t.description), q(t.badge), j(t.stops || []), i].join(', ') + ')').join(',\n'));
out.push('on conflict (id) do update set emoji=excluded.emoji, title=excluded.title, description=excluded.description, badge=excluded.badge, stops=excluded.stops, position=excluded.position;');
out.push('');

const file = path.join('supabase', `seed_${slug}.sql`);
fs.writeFileSync(file, out.join('\n'));
console.log(`Wrote ${file}  (bands:1 artists:${artists.length} places:${places.length} trips:${trips.length})`);
