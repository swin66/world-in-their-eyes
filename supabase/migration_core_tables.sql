-- Migration: core content tables (bands, artists, places, checkins).
-- Brings projects that only ran the patch migrations up to the full backend.
-- Self-contained and idempotent — safe to re-run. Run BEFORE the seed file.

-- ─── bands ────────────────────────────────────────────────────────────────────
create table if not exists public.bands (
  slug   text primary key,
  name   text not null,
  config jsonb not null default '{}'::jsonb
);
alter table public.bands enable row level security;
drop policy if exists "public read bands" on public.bands;
create policy "public read bands" on public.bands for select using (true);
drop policy if exists "admin write bands" on public.bands;
create policy "admin write bands" on public.bands for all
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

-- ─── artists ──────────────────────────────────────────────────────────────────
create table if not exists public.artists (
  id        text primary key,
  band_slug text not null,
  name      text not null,
  relation  text,
  blurb     text
);
alter table public.artists enable row level security;
drop policy if exists "public read artists" on public.artists;
create policy "public read artists" on public.artists for select using (true);
drop policy if exists "editor write artists" on public.artists;
create policy "editor write artists" on public.artists for all
  using (public.app_role() in ('admin','editor'))
  with check (public.app_role() in ('admin','editor'));

-- ─── places ───────────────────────────────────────────────────────────────────
create table if not exists public.places (
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
alter table public.places enable row level security;
drop policy if exists "public read places" on public.places;
create policy "public read places" on public.places for select using (true);
drop policy if exists "editor write places" on public.places;
create policy "editor write places" on public.places for all
  using (public.app_role() in ('admin','editor'))
  with check (public.app_role() in ('admin','editor'));

-- ─── checkins ─────────────────────────────────────────────────────────────────
create table if not exists public.checkins (
  user_id    uuid not null references auth.users(id) on delete cascade,
  band_slug  text not null,
  place_id   text not null,
  verified   boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);
alter table public.checkins enable row level security;
drop policy if exists "own checkins read" on public.checkins;
create policy "own checkins read" on public.checkins for select using (auth.uid() = user_id);
drop policy if exists "own checkins insert" on public.checkins;
create policy "own checkins insert" on public.checkins for insert with check (auth.uid() = user_id);
drop policy if exists "own checkins delete" on public.checkins;
create policy "own checkins delete" on public.checkins for delete using (auth.uid() = user_id);
