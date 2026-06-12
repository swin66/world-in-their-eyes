// Fan contributions: memories, photos, video links, ticket stubs, articles.
// Local-first (instant, free); when Supabase is configured and the user is
// signed in, each contribution is also pushed to the `memories` table where
// it awaits moderation. Other fans' approved contributions are merged in for
// display — your own (local) ones drive your points.
import { supabase } from './supabase.js';
import { getUser } from './auth.js';

export const KINDS = {
  memory: { label: 'Memory', icon: '💭' },
  photo: { label: 'Photo', icon: '📷' },
  video: { label: 'Video link', icon: '🎬' },
  ticket: { label: 'Ticket stub', icon: '🎟️' },
  article: { label: 'News article', icon: '📰' },
};

// Downscale photos so localStorage stays comfortable on the free tier.
export function shrinkImage(file, max = 900) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function createContributions(bandSlug) {
  const key = `wite:${bandSlug}:contributions`;
  const load = () => {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch { return []; }
  };
  let items = load();
  let remote = []; // other fans' approved contributions (display only)
  const save = () => {
    try { localStorage.setItem(key, JSON.stringify(items)); }
    catch { /* quota — oldest photo data gets dropped */
      const trimmed = items.map((c) => ({ ...c, mediaUrl: undefined }));
      localStorage.setItem(key, JSON.stringify(trimmed));
    }
  };

  const pushRemote = async (c) => {
    const user = getUser();
    if (!supabase || !user) return;
    await supabase.from('memories').insert({
      user_id: user.id,
      place_id: c.placeId,
      kind: c.kind,
      body: c.text || null,
      photo_url: c.mediaUrl && !c.mediaUrl.startsWith('data:') ? c.mediaUrl : null,
      link_url: c.url || null,
    });
  };

  return {
    count: () => items.length,
    mediaCount: () => items.filter((c) => c.mediaUrl || c.url).length,
    all: () => items,
    forPlace: (placeId) => [
      ...items.filter((c) => c.placeId === placeId),
      ...remote.filter((c) => c.placeId === placeId),
    ],
    add(data) {
      const item = { ...data, id: crypto.randomUUID(), createdAt: Date.now() };
      items.push(item);
      save();
      pushRemote(item).catch(() => {});
      return item;
    },
    async loadRemote(placeIds) {
      if (!supabase) return;
      const { data } = await supabase
        .from('memories')
        .select('id, place_id, kind, body, photo_url, link_url')
        .in('place_id', placeIds)
        .eq('approved', true)
        .limit(500);
      remote = (data || []).map((r) => ({
        id: `remote-${r.id}`, placeId: r.place_id, kind: r.kind || 'memory',
        text: r.body, mediaUrl: r.photo_url, url: r.link_url, remote: true,
      }));
    },
  };
}
