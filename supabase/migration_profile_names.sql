-- Migration: populate profiles.display_name and let staff read it, so the
-- tour-guide approval queue can show real applicant names instead of user IDs.
-- Safe to re-run.

-- ─── Populate display_name on signup from the OAuth/email metadata ────────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end; $$;
revoke execute on function public.handle_new_user() from public;

-- ─── Backfill existing profiles that have no name yet ─────────────────────────
update public.profiles p
set display_name = coalesce(
  nullif(u.raw_user_meta_data->>'full_name', ''),
  nullif(u.raw_user_meta_data->>'name', ''),
  split_part(u.email, '@', 1)
)
from auth.users u
where u.id = p.id
  and (p.display_name is null or p.display_name = '');

-- ─── Let admins/editors and band reps read profiles (for review queues) ───────
-- band_roles has a permissive public-read policy, so this subquery does not
-- recurse into profiles' own RLS.
drop policy if exists "staff read profiles" on public.profiles;
create policy "staff read profiles" on public.profiles for select
  using (
    public.app_role() in ('admin','editor')
    or exists (
      select 1 from public.band_roles
      where user_id = auth.uid() and role = 'band_rep'
    )
  );
