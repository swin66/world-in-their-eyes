-- Migration: per-band roles (band_rep / mod) and band-rep applications.
-- Run in Supabase SQL Editor after schema.sql is already applied.
-- The existing profiles.role ('admin'|'editor'|'fan') is unchanged:
--   admin  = platform superadmin (can approve band reps, manage everything)
--   editor = legacy content editor
--   fan    = default signed-in user
--
-- New per-band roles are stored in band_roles (not in profiles):
--   band_rep  = owns/manages a specific band atlas
--   mod       = moderates content for a specific band

-- ─── band_roles ────────────────────────────────────────────────────────────────
create table if not exists public.band_roles (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  band_slug   text not null references public.bands(slug) on delete cascade,
  role        text not null check (role in ('band_rep','mod')),
  granted_by  uuid references public.profiles(id),
  granted_at  timestamptz not null default now(),
  primary key (user_id, band_slug)
);

alter table public.band_roles enable row level security;

-- Anyone can read who has what role (used to show rep badge in UI).
create policy "public read band roles"
  on public.band_roles for select using (true);

-- Only platform admins can grant/revoke band_rep; band_reps can grant/revoke mod.
create policy "admin manages all band roles"
  on public.band_roles for all
  using (public.app_role() = 'admin');

create policy "band_rep manages mods"
  on public.band_roles for all
  using (
    band_roles.role = 'mod' and
    exists (
      select 1 from public.band_roles my_role
      where my_role.user_id = auth.uid()
        and my_role.band_slug = band_roles.band_slug
        and my_role.role = 'band_rep'
    )
  );

-- ─── band_rep_applications ─────────────────────────────────────────────────────
-- Users who want to become band rep submit a justification.
-- Platform admins review and approve/reject.
create table if not exists public.band_rep_applications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  band_slug     text not null references public.bands(slug) on delete cascade,
  justification text not null,
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected')),
  reviewed_by   uuid references public.profiles(id),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (user_id, band_slug)
);

alter table public.band_rep_applications enable row level security;

create policy "users submit own application"
  on public.band_rep_applications for insert
  with check (auth.uid() = user_id);

create policy "users read own application"
  on public.band_rep_applications for select
  using (auth.uid() = user_id);

create policy "admins manage all applications"
  on public.band_rep_applications for all
  using (public.app_role() = 'admin');

-- ─── How to approve a band rep ─────────────────────────────────────────────────
-- 1. User applies via the app (band_rep_applications row created).
-- 2. Admin reviews in the app's admin panel, clicks Approve.
--    The app calls roles.js reviewApplication(), which:
--      a. Sets band_rep_applications.status = 'approved'
--      b. Upserts a band_roles row with role = 'band_rep'
--
-- To promote someone directly (bypass the application flow):
--   insert into public.band_roles (user_id, band_slug, role, granted_by)
--   values (
--     (select id from auth.users where email = 'rep@example.com'),
--     'depeche-mode',
--     'band_rep',
--     (select id from auth.users where email = 'admin@example.com')
--   );
