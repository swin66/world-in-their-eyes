-- Migration: fix "permission denied for function app_role" in the moderation panel.
--
-- app_role() and has_band_role() are SECURITY DEFINER, but they are invoked from
-- RLS policies — and Postgres requires the *calling* role (authenticated/anon) to
-- hold EXECUTE on a function to call it, regardless of SECURITY DEFINER. An earlier
-- migration revoked EXECUTE from PUBLIC, which silently broke every policy that
-- references these helpers (memories moderation, band_roles, trips, …).
--
-- Safe to re-run.

grant execute on function public.app_role() to authenticated, anon;
grant execute on function public.has_band_role(text, text) to authenticated, anon;
