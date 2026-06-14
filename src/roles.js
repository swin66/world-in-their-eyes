// RBAC helpers for per-band role checking.
//
// Role hierarchy (highest → lowest):
//   superadmin   platform-wide, stored in profiles.role
//   band_rep     owns a specific band (one per band), stored in band_roles
//   mod          moderates a specific band, stored in band_roles
//   fan          default for any signed-in user
//   (null)       not signed in

import { supabase } from './supabase.js';

// Injected by auth.js on session change to avoid a circular import.
let _getUser = () => null;
export function _setGetUser(fn) { _getUser = fn; }

const _cache = {};

export function clearRoleCache() {
  for (const k of Object.keys(_cache)) delete _cache[k];
}

// Returns this user's role for a specific band ('band_rep' | 'mod' | null).
export async function getBandRole(bandSlug) {
  const user = _getUser();
  if (!user || !supabase) return null;
  const key = `${user.id}:${bandSlug}`;
  if (_cache[key] !== undefined) return _cache[key];
  const { data } = await supabase
    .from('band_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('band_slug', bandSlug)
    .maybeSingle();
  _cache[key] = data?.role ?? null;
  return _cache[key];
}

export function canEdit(platformRole, bandRole) {
  return platformRole === 'superadmin' || bandRole === 'band_rep';
}

export function canModerate(platformRole, bandRole) {
  return platformRole === 'superadmin' || bandRole === 'band_rep' || bandRole === 'mod';
}

export function isGuide(bandRole) {
  return bandRole === 'guide';
}

// Submit a role application (band_rep or guide) for rep/admin review.
export async function applyForRole(bandSlug, requestedRole, justification) {
  const user = _getUser();
  if (!supabase || !user) return { error: 'Not signed in' };
  const { error } = await supabase.from('band_rep_applications').upsert({
    user_id: user.id,
    band_slug: bandSlug,
    requested_role: requestedRole,
    justification,
    status: 'pending',
  }, { onConflict: 'user_id,band_slug' });
  return { error: error?.message ?? null };
}

// Back-compat wrapper.
export async function applyForBandRep(bandSlug, justification) {
  return applyForRole(bandSlug, 'band_rep', justification);
}

// Admin / band rep: fetch pending applications for a band.
// (No profiles embed — profiles RLS only exposes a user's own row, and there's
// no FK from applications→profiles for PostgREST to embed through anyway.)
export async function getPendingApplications(bandSlug) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('band_rep_applications')
    .select('*')
    .eq('band_slug', bandSlug)
    .eq('status', 'pending')
    .order('created_at');
  return error ? [] : (data ?? []);
}

// Admin / band rep: the current tour guides for a band.
export async function getBandGuides(bandSlug) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('band_roles')
    .select('user_id, granted_at')
    .eq('band_slug', bandSlug)
    .eq('role', 'guide')
    .order('granted_at');
  return error ? [] : (data ?? []);
}

// Admin / band rep: count guides for a band (cheap, head-only).
export async function countBandGuides(bandSlug) {
  if (!supabase) return 0;
  const { count } = await supabase
    .from('band_roles')
    .select('user_id', { count: 'exact', head: true })
    .eq('band_slug', bandSlug)
    .eq('role', 'guide');
  return count ?? 0;
}

// Map a set of user IDs → display names (requires the "staff read profiles"
// policy; falls back to an empty map for non-staff or on error).
export async function getProfileNames(userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!supabase || !ids.length) return {};
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name')
    .in('id', ids);
  if (error) return {};
  return Object.fromEntries((data ?? []).map((p) => [p.id, p.display_name]));
}

// Revoke a specific band role (e.g. remove someone as a guide).
export async function revokeBandRole(userId, bandSlug, role) {
  if (!supabase) return { error: 'No backend' };
  const { error } = await supabase.from('band_roles')
    .delete()
    .eq('user_id', userId).eq('band_slug', bandSlug).eq('role', role);
  return { error: error?.message ?? null };
}

// Superadmin: approve or reject an application.
export async function reviewApplication(id, decision, reviewerId) {
  if (!supabase) return { error: 'No backend' };
  const { data: app, error } = await supabase
    .from('band_rep_applications')
    .update({ status: decision, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) return { error: error.message };

  if (decision === 'approved' && app) {
    const { error: grantErr } = await supabase.from('band_roles').upsert({
      user_id: app.user_id,
      band_slug: app.band_slug,
      role: app.requested_role || 'band_rep',
      granted_by: reviewerId,
    }, { onConflict: 'user_id,band_slug' });
    if (grantErr) return { error: grantErr.message };
  }
  return { error: null };
}

// Grant or revoke mod role for a specific user+band.
export async function setModRole(userId, bandSlug, grant, grantedBy) {
  if (!supabase) return;
  if (grant) {
    await supabase.from('band_roles').upsert(
      { user_id: userId, band_slug: bandSlug, role: 'mod', granted_by: grantedBy },
      { onConflict: 'user_id,band_slug' },
    );
  } else {
    await supabase.from('band_roles').delete()
      .eq('user_id', userId).eq('band_slug', bandSlug);
  }
}
