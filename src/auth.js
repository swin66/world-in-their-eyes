import { supabase } from './supabase.js';
import { getBandRole, applyForRole, clearRoleCache, _setGetUser } from './roles.js';

// Account UI + check-in sync. All functions are safe to call in local mode
// (no Supabase configured): they no-op and the UI explains the situation.

let currentUser = null;
let currentRole = null; // 'admin' | 'editor' | 'fan' | null (signed out)

// Wire getUser into roles.js (avoids circular import)
_setGetUser(() => currentUser);

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
    clearRoleCache();
    fetchRole().then((role) => { currentRole = role; });
    onSessionChange(currentUser);
  });
}

export async function signOut() {
  clearRoleCache();
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

export async function renderAuthModal(container, band, { onClose, onAdmin }) {
  if (!supabase) {
    container.innerHTML = `
      <h2>Your pilgrimage, saved here</h2>
      <p class="modal-text">Accounts aren't switched on yet — check-ins and badges
      are stored safely on this device for now.</p>
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
    const bandRole = await getBandRole(band.slug);
    const isGuideRole = bandRole === 'guide';
    const roleLabel = bandRole === 'band_rep' ? '★ Band Rep'
      : bandRole === 'mod' ? '⚑ Mod'
      : isGuideRole ? '🎫 Tour Guide'
      : currentRole === 'admin' ? '⬡ Admin'
      : null;

    const avatar = currentUser.user_metadata?.avatar_url;
    container.innerHTML = `
      <div class="auth-profile">
        ${avatar ? `<img class="auth-avatar" src="${avatar}" alt="">` : '<div class="auth-avatar auth-avatar--placeholder">☻</div>'}
        <div>
          <strong>${name}</strong>
          ${roleLabel ? `<span class="role-pill">${roleLabel}</span>` : ''}
        </div>
      </div>
      <p class="modal-text dim">Check-ins sync to your account automatically.</p>
      ${!bandRole && !canAdmin ? `
        <details class="auth-rep-apply">
          <summary>Apply to be band rep for ${band.name}</summary>
          <p class="modal-text dim" style="margin-top:8px">Band reps are verified fans or representatives who manage the atlas content. Tell us why you should be the rep for ${band.name}:</p>
          <textarea id="rep-justification" rows="3" placeholder="Your connection to the band, credentials, what you'd contribute…" style="width:100%;margin-top:8px;padding:10px;background:var(--surface);border:1px solid var(--line);border-radius:10px;color:var(--text);font:inherit;font-size:13px;resize:vertical"></textarea>
          <button class="btn btn-primary" id="rep-apply-btn" style="margin-top:8px;width:100%">Submit application</button>
          <p class="modal-text dim" id="rep-apply-status"></p>
        </details>
        <details class="auth-rep-apply">
          <summary>Apply to be a tour guide for ${band.name}</summary>
          <p class="modal-text dim" style="margin-top:8px">Tour guides craft custom guided tours — an expert's deep cut, a local's insider route. Tell us your angle and what fans would get:</p>
          <textarea id="guide-justification" rows="3" placeholder="Your expertise, local knowledge, the kind of tours you'd create…" style="width:100%;margin-top:8px;padding:10px;background:var(--surface);border:1px solid var(--line);border-radius:10px;color:var(--text);font:inherit;font-size:13px;resize:vertical"></textarea>
          <button class="btn btn-primary" id="guide-apply-btn" style="margin-top:8px;width:100%">Submit application</button>
          <p class="modal-text dim" id="guide-apply-status"></p>
        </details>` : ''}
      <div class="sheet-actions">
        ${canAdmin ? '<button class="btn" data-admin>Admin panel</button>' : ''}
        ${isGuideRole ? '<button class="btn btn-primary" data-admin>Create tours</button>' : ''}
        <button class="btn" data-signout>Sign out</button>
        <button class="btn btn-primary" data-close>Done</button>
      </div>`;

    container.querySelector('[data-admin]')?.addEventListener('click', onAdmin);
    container.querySelector('[data-signout]').addEventListener('click', async () => {
      await signOut(); onClose();
    });
    container.querySelector('[data-close]').addEventListener('click', onClose);
    const wireApply = (btnId, taId, statusId, requestedRole) => {
      container.querySelector(`#${btnId}`)?.addEventListener('click', async () => {
        const justification = container.querySelector(`#${taId}`)?.value?.trim();
        const status = container.querySelector(`#${statusId}`);
        if (!justification) { status.textContent = 'Please write a few words first.'; return; }
        const btn = container.querySelector(`#${btnId}`);
        btn.disabled = true; btn.textContent = 'Submitting…';
        const { error } = await applyForRole(band.slug, requestedRole, justification);
        if (error) {
          status.textContent = `Error: ${error}`;
          btn.disabled = false; btn.textContent = 'Submit application';
        } else {
          status.textContent = '✓ Application submitted — a rep or admin will review it soon.';
          btn.remove();
        }
      });
    };
    wireApply('rep-apply-btn', 'rep-justification', 'rep-apply-status', 'band_rep');
    wireApply('guide-apply-btn', 'guide-justification', 'guide-apply-status', 'guide');
    return;
  }

  // ── Signed out ──────────────────────────────────────────────────────────────
  const providers = (band.auth?.providers || ['google']).filter((p) => PROVIDER_LABELS[p]);
  container.innerHTML = `
    <h2>Sign in to ${band.name}</h2>
    <p class="modal-text dim">Save your pilgrimage progress across every device.</p>
    <div class="auth-providers">
      ${providers.map((p) => `
        <button class="btn auth-provider auth-provider--${p}" data-provider="${p}">
          <span class="auth-provider-icon">${providerIcon(p)}</span>
          Continue with ${PROVIDER_LABELS[p]}
        </button>`).join('')}
    </div>
    <div class="auth-divider"><span>or use email</span></div>
    <form class="auth-email" id="auth-email-form">
      <input type="email" id="auth-email" placeholder="you@example.com" required autocomplete="email" />
      <button class="btn btn-primary" type="submit">Send me a magic link</button>
    </form>
    <p class="modal-text dim" id="auth-status"></p>
    <p class="auth-small">By signing in you agree to fan-use only. No spam, ever.</p>`;

  for (const btn of container.querySelectorAll('.auth-provider')) {
    btn.addEventListener('click', () => {
      supabase.auth.signInWithOAuth({
        provider: btn.dataset.provider,
        options: { redirectTo: location.origin + location.search },
      });
    });
  }
  container.querySelector('#auth-email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = container.querySelector('#auth-email').value;
    const status = container.querySelector('#auth-status');
    const submitBtn = e.target.querySelector('[type=submit]');
    submitBtn.disabled = true; submitBtn.textContent = 'Sending…';
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + location.search },
    });
    submitBtn.textContent = 'Send me a magic link'; submitBtn.disabled = false;
    status.textContent = error ? `Error: ${error.message}` : '✓ Check your inbox — link expires in 1 hour.';
  });
}

function providerIcon(p) {
  return { google: 'G', apple: '⌘', github: '⌥', facebook: 'f', spotify: '♫' }[p] ?? '→';
}
