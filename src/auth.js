import { supabase } from './supabase.js';

// Account UI + check-in sync. All functions are safe to call in local mode
// (no Supabase configured): they no-op and the UI explains the situation.

let currentUser = null;
let currentRole = null; // 'admin' | 'editor' | 'fan' | null (signed out)

export function getUser() {
  return currentUser;
}

// In local mode (no Supabase) everyone is effectively the site owner, so the
// admin tools open in preview mode and save by downloading config files.
export function getRole() {
  return supabase ? currentRole : 'local-admin';
}

async function fetchRole() {
  if (!supabase || !currentUser) return null;
  const { data } = await supabase
    .from('profiles').select('role').eq('id', currentUser.id).single();
  return data?.role ?? 'fan';
}

export function initAuth(onSessionChange) {
  if (!supabase) return;
  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user ?? null;
    currentRole = null;
    fetchRole().then((role) => { currentRole = role; });
    onSessionChange(currentUser);
  });
}

export async function signOut() {
  await supabase?.auth.signOut();
}

// Merge local check-ins with the user's server-side ones, push anything the
// server is missing, and return the merged set of place ids.
export async function syncCheckins(bandSlug, localIds) {
  if (!supabase || !currentUser) return null;
  const { data, error } = await supabase
    .from('checkins')
    .select('place_id')
    .eq('user_id', currentUser.id)
    .eq('band_slug', bandSlug);
  if (error) {
    console.warn('checkin sync failed', error);
    return null;
  }
  const remote = new Set((data || []).map((r) => r.place_id));
  const toPush = localIds.filter((id) => !remote.has(id));
  if (toPush.length) {
    await supabase.from('checkins').upsert(
      toPush.map((place_id) => ({ user_id: currentUser.id, band_slug: bandSlug, place_id })),
    );
  }
  return new Set([...remote, ...localIds]);
}

export async function pushCheckin(bandSlug, placeId, visited, verified = false) {
  if (!supabase || !currentUser) return;
  if (visited) {
    await supabase.from('checkins').upsert({
      user_id: currentUser.id,
      band_slug: bandSlug,
      place_id: placeId,
      verified,
    });
  } else {
    await supabase.from('checkins').delete()
      .eq('user_id', currentUser.id)
      .eq('place_id', placeId);
  }
}

const PROVIDER_LABELS = { google: 'Google', apple: 'Apple', facebook: 'Facebook', spotify: 'Spotify', github: 'GitHub' };

export function renderAuthModal(container, band, { onClose, onAdmin }) {
  if (!supabase) {
    container.innerHTML = `
      <h2>Your pilgrimage, saved here</h2>
      <p class="modal-text">Accounts aren't switched on yet, so your check-ins and badges
      are stored safely on this device. Once cloud accounts launch you'll be able to sign
      in and keep your progress everywhere.</p>
      <div class="sheet-actions">
        <button class="btn" data-admin>Admin tools</button>
        <button class="btn btn-primary" data-close>Got it</button>
      </div>`;
    container.querySelector('[data-close]').addEventListener('click', onClose);
    container.querySelector('[data-admin]').addEventListener('click', onAdmin);
    return;
  }

  if (currentUser) {
    const name = currentUser.user_metadata?.full_name || currentUser.email || 'Devotee';
    const canAdmin = currentRole === 'admin' || currentRole === 'editor';
    container.innerHTML = `
      <h2>Signed in</h2>
      <p class="modal-text">${name}${currentRole ? `<span class="role-pill">${currentRole}</span>` : ''}</p>
      <p class="modal-text dim">Your check-ins sync to your account automatically.</p>
      <div class="sheet-actions">
        ${canAdmin ? '<button class="btn" data-admin>Admin tools</button>' : ''}
        <button class="btn" data-signout>Sign out</button>
        <button class="btn btn-primary" data-close>Done</button>
      </div>`;
    container.querySelector('[data-admin]')?.addEventListener('click', onAdmin);
    container.querySelector('[data-signout]').addEventListener('click', async () => {
      await signOut();
      onClose();
    });
    container.querySelector('[data-close]').addEventListener('click', onClose);
    return;
  }

  const providers = (band.auth?.providers || []).filter((p) => PROVIDER_LABELS[p]);
  container.innerHTML = `
    <h2>Sign in</h2>
    <p class="modal-text dim">Keep your pilgrimage progress on every device.</p>
    <div class="auth-providers">
      ${providers.map((p) => `<button class="btn auth-provider" data-provider="${p}">Continue with ${PROVIDER_LABELS[p]}</button>`).join('')}
    </div>
    <div class="auth-divider"><span>or</span></div>
    <form class="auth-email" id="auth-email-form">
      <input type="email" id="auth-email" placeholder="you@example.com" required autocomplete="email" />
      <button class="btn btn-primary" type="submit">Email me a magic link</button>
    </form>
    <p class="modal-text dim" id="auth-status"></p>`;

  for (const btn of container.querySelectorAll('.auth-provider')) {
    btn.addEventListener('click', () => {
      supabase.auth.signInWithOAuth({
        provider: btn.dataset.provider,
        options: { redirectTo: location.origin },
      });
    });
  }
  container.querySelector('#auth-email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = container.querySelector('#auth-email').value;
    const status = container.querySelector('#auth-status');
    status.textContent = 'Sending…';
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin },
    });
    status.textContent = error ? `Hmm: ${error.message}` : '✓ Check your inbox for the sign-in link.';
  });
}
