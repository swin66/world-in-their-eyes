-- Fix: "infinite recursion detected in policy for relation band_roles".
--
-- The band_rep management policies queried public.band_roles from *within*
-- band_roles' own RLS policies, so every check re-entered the table forever
-- (PostgREST returns HTTP 500). That broke band_roles, band_rep_applications
-- and trips for everyone.
--
-- Fix: route the "does this user hold role X for this band?" check through a
-- SECURITY DEFINER helper, which runs with the owner's rights and bypasses RLS,
-- breaking the recursion. Re-create the affected policies to use it.
-- Idempotent; safe to re-run.

create or replace function public.has_band_role(slug text, want text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.band_roles
    where user_id = auth.uid() and band_slug = slug and role = want
  );
$$;

-- ─── band_roles ───────────────────────────────────────────────────────────────
drop policy if exists "band_rep manages mods" on public.band_roles;
create policy "band_rep manages mods" on public.band_roles for all
  using (band_roles.role = 'mod' and public.has_band_role(band_roles.band_slug, 'band_rep'));

drop policy if exists "band_rep manages guides" on public.band_roles;
create policy "band_rep manages guides" on public.band_roles for all
  using (band_roles.role = 'guide' and public.has_band_role(band_roles.band_slug, 'band_rep'));

-- ─── band_rep_applications ────────────────────────────────────────────────────
drop policy if exists "band_rep reviews applications" on public.band_rep_applications;
create policy "band_rep reviews applications" on public.band_rep_applications for all
  using (public.has_band_role(band_rep_applications.band_slug, 'band_rep'));

-- ─── trips ────────────────────────────────────────────────────────────────────
drop policy if exists "guides write own trips" on public.trips;
create policy "guides write own trips" on public.trips for all
  using (author_id = auth.uid() and public.has_band_role(trips.band_slug, 'guide'))
  with check (author_id = auth.uid());
