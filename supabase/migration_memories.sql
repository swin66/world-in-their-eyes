-- Migration: fan memories / submissions table.
-- Run in Supabase SQL Editor. Safe to re-run.

create table if not exists public.memories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  place_id   text not null,
  kind       text not null default 'memory'
             check (kind in ('memory','photo','video','ticket','article')),
  body       text,
  photo_url  text,
  link_url   text,
  approved   boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.memories enable row level security;

drop policy if exists "read approved memories" on public.memories;
create policy "read approved memories" on public.memories for select
  using (approved or auth.uid() = user_id or public.app_role() in ('admin','editor'));

drop policy if exists "submit memories" on public.memories;
create policy "submit memories" on public.memories for insert
  with check (auth.uid() = user_id);

drop policy if exists "delete own memories" on public.memories;
create policy "delete own memories" on public.memories for delete
  using (auth.uid() = user_id);

drop policy if exists "moderate memories" on public.memories;
create policy "moderate memories" on public.memories for all
  using (public.app_role() in ('admin','editor'));
