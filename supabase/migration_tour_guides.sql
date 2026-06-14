-- Migration: Tour Guide role + tour ownership & monetisation scaffolding.
-- Self-contained and safe to re-run. Run in the Supabase SQL editor.
--
-- Adds a per-band 'guide' role, lets guides own & price their tours, and
-- generalises the application queue so people can apply to be a guide too.

-- ─── trips: create if missing (schema.sql may not have been applied) ──────────
create table if not exists public.trips (
  id          text primary key,
  band_slug   text not null,
  emoji       text,
  title       text not null,
  description text,
  badge       text,
  stops       jsonb not null default '[]'::jsonb,
  position    int not null default 0
);
alter table public.trips enable row level security;

drop policy if exists "public read trips" on public.trips;
create policy "public read trips" on public.trips for select using (true);

drop policy if exists "editor write trips" on public.trips;
create policy "editor write trips" on public.trips for all
  using (public.app_role() in ('admin','editor'))
  with check (public.app_role() in ('admin','editor'));

-- ─── band_roles: allow the 'guide' role ───────────────────────────────────────
alter table public.band_roles drop constraint if exists band_roles_role_check;
alter table public.band_roles
  add constraint band_roles_role_check check (role in ('band_rep','mod','guide'));

-- ─── trips: ownership + monetisation columns ──────────────────────────────────
alter table public.trips add column if not exists author_id   uuid references auth.users(id) on delete set null;
alter table public.trips add column if not exists author_name text;
alter table public.trips add column if not exists price_cents int not null default 0;
alter table public.trips add column if not exists currency    text not null default 'GBP';
alter table public.trips add column if not exists published    boolean not null default false;

-- Guides manage only their own tours (in addition to the admin/editor policy).
drop policy if exists "guides write own trips" on public.trips;
create policy "guides write own trips" on public.trips for all
  using (
    author_id = auth.uid() and exists (
      select 1 from public.band_roles r
      where r.user_id = auth.uid()
        and r.band_slug = trips.band_slug
        and r.role = 'guide'
    )
  )
  with check (author_id = auth.uid());

-- ─── applications: support guide applications too ─────────────────────────────
alter table public.band_rep_applications
  add column if not exists requested_role text not null default 'band_rep';
alter table public.band_rep_applications drop constraint if exists band_rep_applications_requested_role_check;
alter table public.band_rep_applications
  add constraint band_rep_applications_requested_role_check
  check (requested_role in ('band_rep','guide'));

-- Band reps can review/grant guide roles for their own band (mirrors the
-- existing "band_rep manages mods" policy, for role = 'guide').
drop policy if exists "band_rep manages guides" on public.band_roles;
create policy "band_rep manages guides"
  on public.band_roles for all
  using (
    band_roles.role = 'guide' and
    exists (
      select 1 from public.band_roles my_role
      where my_role.user_id = auth.uid()
        and my_role.band_slug = band_roles.band_slug
        and my_role.role = 'band_rep'
    )
  );

-- Band reps can review applications for their own band (previously admin-only).
drop policy if exists "band_rep reviews applications" on public.band_rep_applications;
create policy "band_rep reviews applications"
  on public.band_rep_applications for all
  using (
    exists (
      select 1 from public.band_roles my_role
      where my_role.user_id = auth.uid()
        and my_role.band_slug = band_rep_applications.band_slug
        and my_role.role = 'band_rep'
    )
  );

-- ─── Done ─────────────────────────────────────────────────────────────────────
-- Grant a guide directly (skipping the application flow):
--   INSERT INTO public.band_roles (user_id, band_slug, role)
--   VALUES ((SELECT id FROM auth.users WHERE email='guide@example.com'),
--           'depeche-mode', 'guide');
