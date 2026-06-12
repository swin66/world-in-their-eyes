// Local-first check-in store. The map UI always reads/writes here instantly;
// auth.js pushes the same changes to Supabase when someone is signed in.
export function createCheckins(bandSlug) {
  const key = `wite:${bandSlug}:checkins`;
  const verifiedKey = `wite:${bandSlug}:verified`;

  const load = (k) => {
    try { return new Set(JSON.parse(localStorage.getItem(k)) || []); }
    catch { return new Set(); }
  };
  const save = () => localStorage.setItem(key, JSON.stringify([...visited]));
  const saveVerified = () => localStorage.setItem(verifiedKey, JSON.stringify([...verified]));

  const visited = load(key);
  const verified = load(verifiedKey);

  return {
    verifiedSet: () => new Set(verified),
    isVerified: (id) => verified.has(id),
    markVerified(id) { verified.add(id); saveVerified(); },
    has: (id) => visited.has(id),
    count: () => visited.size,
    list: () => [...visited],
    asSet: () => new Set(visited),
    toggle(id) {
      const nowVisited = !visited.has(id);
      if (nowVisited) visited.add(id);
      else visited.delete(id);
      save();
      return nowVisited;
    },
    // Replace local state with a merged server+local set (after sign-in sync).
    merge(ids) {
      for (const id of ids) visited.add(id);
      save();
    },
  };
}

// Daily activity streak: any check-in or contribution counts for the day.
// `best` persists so streak badges, once earned, stay earned.
export function createStreak(bandSlug) {
  const key = `wite:${bandSlug}:streak`;
  let data;
  try { data = JSON.parse(localStorage.getItem(key)) || {}; }
  catch { data = {}; }
  data = { count: 0, best: 0, last: null, ...data };
  const save = () => localStorage.setItem(key, JSON.stringify(data));
  const day = (offset = 0) => new Date(Date.now() + offset).toISOString().slice(0, 10);

  return {
    record() {
      const today = day();
      if (data.last === today) return data.count;
      data.count = data.last === day(-864e5) ? data.count + 1 : 1;
      data.last = today;
      data.best = Math.max(data.best, data.count);
      save();
      return data.count;
    },
    current() {
      return data.last === day() || data.last === day(-864e5) ? data.count : 0;
    },
    best: () => data.best,
  };
}
