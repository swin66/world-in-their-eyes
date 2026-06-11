-- World in Their Eyes — database schema for Supabase (free tier)
-- Run this in the Supabase SQL editor of a new project, then `npm run seed`.

create table public.bands (
  slug text primary key,
  name text not null,
  config jsonb not null default '{}'::jsonb
);

create table public.artists (
  id text primary key,
  band_slug text not null references public.bands(slug) on delete cascade,
  name text not null,
  relation text,
  blurb text
);

create table public.places (
  id text primary key,
  band_slug text not null references public.bands(slug) on delete cascade,
  title text not null,
  category text not null,
  year int not null,
  summary text,
  story text,
  lng double precision not null,
  lat double precision not null,
  approx boolean not null default false,
  artist_id text references public.artists(id),
  created_at timestamptz not null default now()
);

create table public.checkins (
  user_id uuid not null references auth.users(id) on delete cascade,
  band_slug text not null,
  place_id text not null references public.places(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

-- Phase 3: fan-submitted memories/photos per place (moderated).
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  place_id text not null references public.places(id) on delete cascade,
  body text,
  photo_url text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

-- User roles: admin (full control incl. theme/config) > editor (content) > fan.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'fan' check (role in ('admin', 'editor', 'fan')),
  display_name text,
  created_at timestamptz not null default now()
);

-- Auto-create a fan profile on signup.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end; $$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role lookup that bypasses RLS (avoids recursive policy checks).
create function public.app_role() returns text
language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() $$;

-- Row Level Security
alter table public.bands enable row level security;
alter table public.artists enable row level security;
alter table public.places enable row level security;
alter table public.checkins enable row level security;
alter table public.memories enable row level security;

alter table public.profiles enable row level security;

-- Content is public to read; admins/editors manage it in-app
-- (the seed script uses the service role, which bypasses RLS).
create policy "public read bands" on public.bands for select using (true);
create policy "public read artists" on public.artists for select using (true);
create policy "public read places" on public.places for select using (true);
create policy "admin write bands" on public.bands for update
  using (public.app_role() = 'admin');
create policy "editor write places" on public.places for all
  using (public.app_role() in ('admin', 'editor'))
  with check (public.app_role() in ('admin', 'editor'));
create policy "editor write artists" on public.artists for all
  using (public.app_role() in ('admin', 'editor'))
  with check (public.app_role() in ('admin', 'editor'));

-- Profiles: users see their own; admins see and manage everyone's.
create policy "own profile read" on public.profiles for select
  using (auth.uid() = id or public.app_role() = 'admin');
create policy "admin manage roles" on public.profiles for update
  using (public.app_role() = 'admin');

-- Bootstrap: after your own first sign-in, promote yourself in the SQL editor:
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'you@example.com');

-- Users own their check-ins.
create policy "own checkins read" on public.checkins for select using (auth.uid() = user_id);
create policy "own checkins insert" on public.checkins for insert with check (auth.uid() = user_id);
create policy "own checkins delete" on public.checkins for delete using (auth.uid() = user_id);

-- Memories: approved ones are public, authors see and manage their own.
create policy "read approved memories" on public.memories for select
  using (approved or auth.uid() = user_id);
create policy "submit memories" on public.memories for insert with check (auth.uid() = user_id);
create policy "delete own memories" on public.memories for delete using (auth.uid() = user_id);
