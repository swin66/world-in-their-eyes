-- Migration: per-band roles (band_rep / mod) and band-rep applications.
-- Fully self-contained — safe to run even if schema.sql was never applied.
-- Safe to re-run: uses CREATE IF NOT EXISTS and DROP … IF EXISTS for policies.

-- ─── profiles (create if missing) ─────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  role         text not null default 'fan' check (role in ('admin','editor','fan')),
  display_name text,
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles
  for select using (auth.uid() = id);

-- Auto-create profile row on signup (idempotent)
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

-- ─── app_role() helper ─────────────────────────────────────────────────────────
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'fan'
  )
$$;

-- ─── band_roles ────────────────────────────────────────────────────────────────
create table if not exists public.band_roles (
  user_id    uuid not null references auth.users(id) on delete cascade,
  band_slug  text not null,
  role       text not null check (role in ('band_rep','mod')),
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, band_slug)
);
alter table public.band_roles enable row level security;

drop policy if exists "public read band roles" on public.band_roles;
create policy "public read band roles"
  on public.band_roles for select using (true);

drop policy if exists "admin manages all band roles" on public.band_roles;
create policy "admin manages all band roles"
  on public.band_roles for all
  using (public.app_role() = 'admin');

-- SECURITY DEFINER helper: checks a band role without re-entering band_roles'
-- RLS (a plain subquery here would cause infinite recursion).
create or replace function public.has_band_role(slug text, want text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.band_roles
    where user_id = auth.uid() and band_slug = slug and role = want
  );
$$;

drop policy if exists "band_rep manages mods" on public.band_roles;
create policy "band_rep manages mods"
  on public.band_roles for all
  using (band_roles.role = 'mod' and public.has_band_role(band_roles.band_slug, 'band_rep'));

-- ─── band_rep_applications ─────────────────────────────────────────────────────
create table if not exists public.band_rep_applications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  band_slug     text not null,
  justification text not null,
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected')),
  reviewed_by   uuid references auth.users(id),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (user_id, band_slug)
);
alter table public.band_rep_applications enable row level security;

drop policy if exists "users submit own application" on public.band_rep_applications;
create policy "users submit own application"
  on public.band_rep_applications for insert
  with check (auth.uid() = user_id);

drop policy if exists "users read own application" on public.band_rep_applications;
create policy "users read own application"
  on public.band_rep_applications for select
  using (auth.uid() = user_id);

drop policy if exists "admins manage all applications" on public.band_rep_applications;
create policy "admins manage all applications"
  on public.band_rep_applications for all
  using (public.app_role() = 'admin');

-- ─── Done ──────────────────────────────────────────────────────────────────────
-- Promote yourself to admin after signing in once:
--   UPDATE public.profiles SET role = 'admin'
--   WHERE id = (SELECT id FROM auth.users WHERE email = 'you@example.com');
--
-- To directly grant band rep (skipping the application flow):
--   INSERT INTO public.band_roles (user_id, band_slug, role)
--   VALUES (
--     (SELECT id FROM auth.users WHERE email = 'rep@example.com'),
--     'depeche-mode', 'band_rep'
--   );
