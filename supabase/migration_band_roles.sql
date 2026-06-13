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

-- ─── profiles (create if schema.sql wasn't run first) ─────────────────────────
create table if not exists public.profiles (
  id      uuid primary key references auth.users(id) on delete cascade,
  role    text not null default 'fan' check (role in ('admin','editor','fan')),
  display_name text,
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy if not exists "own profile read" on public.profiles
  for select using (auth.uid() = id);

-- Auto-create profile on signup (idempotent)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── app_role() helper (idempotent — safe to run even if already defined) ──────
-- Returns the current user's platform role from profiles, or 'fan' as default.
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'fan'
  )
$$;

-- ─── band_roles ────────────────────────────────────────────────────────────────
create table if not exists public.band_roles (
  user_id     uuid not null references auth.users(id) on delete cascade,
  band_slug   text not null,
  role        text not null check (role in ('band_rep','mod')),
  granted_by  uuid references auth.users(id),
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
  user_id       uuid not null references auth.users(id) on delete cascade,
  band_slug     text not null references public.bands(slug) on delete cascade,
  justification text not null,
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected')),
  reviewed_by   uuid references auth.users(id),
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
