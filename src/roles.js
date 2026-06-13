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

// Submit a band-rep application for superadmin review.
export async function applyForBandRep(bandSlug, justification) {
  const user = _getUser();
  if (!supabase || !user) return { error: 'Not signed in' };
  const { error } = await supabase.from('band_rep_applications').upsert({
    user_id: user.id,
    band_slug: bandSlug,
    justification,
    status: 'pending',
  }, { onConflict: 'user_id,band_slug' });
  return { error: error?.message ?? null };
}

// Superadmin: fetch pending applications for a band.
export async function getPendingApplications(bandSlug) {
  if (!supabase) return [];
  const { data } = await supabase
    .from('band_rep_applications')
    .select('*, profiles(full_name, avatar_url)')
    .eq('band_slug', bandSlug)
    .eq('status', 'pending')
    .order('created_at');
  return data ?? [];
}

// Superadmin: approve or reject an application.
export async function reviewApplication(id, decision, reviewerId) {
  if (!supabase) return;
  const { data: app } = await supabase
    .from('band_rep_applications')
    .update({ status: decision, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (decision === 'approved' && app) {
    await supabase.from('band_roles').upsert({
      user_id: app.user_id,
      band_slug: app.band_slug,
      role: 'band_rep',
      granted_by: reviewerId,
    }, { onConflict: 'user_id,band_slug' });
  }
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
