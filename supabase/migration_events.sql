-- Migration: split time-anchored "events" out of the places table.
--
-- Many rows in `places` are really events (gigs, milestones, releases, video
-- shoots) rather than physical locations. This creates a parallel `events` table
-- (same shape as places) and moves those rows across. They keep their ids, so
-- existing check-ins / memories (which store place_id as plain text, no FK) keep
-- resolving — the app merges events back into the map feature set at load time.
--
-- Safe to re-run.

-- ─── events table (mirror of places) ─────────────────────────────────────────
create table if not exists public.events (
  id         text primary key,
  band_slug  text not null,
  title      text not null,
  category   text not null,
  year       int not null,
  summary    text,
  story      text,
  lng        double precision not null,
  lat        double precision not null,
  approx     boolean not null default false,
  artist_id  text references public.artists(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.events enable row level security;
drop policy if exists "public read events" on public.events;
create policy "public read events" on public.events for select using (true);
drop policy if exists "editor write events" on public.events;
create policy "editor write events" on public.events for all
  using (public.app_role() in ('admin','editor'))
  with check (public.app_role() in ('admin','editor'));

-- ─── move event-category rows from places → events ───────────────────────────
insert into public.events
  (id, band_slug, title, category, year, summary, story, lng, lat, approx, artist_id, created_at)
select id, band_slug, title, category, year, summary, story, lng, lat, approx, artist_id, created_at
from public.places
where category in ('gig','milestone','release','video')
on conflict (id) do nothing;

delete from public.places
where category in ('gig','milestone','release','video');
