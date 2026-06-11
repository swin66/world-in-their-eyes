// Local-first check-in store. The map UI always reads/writes here instantly;
// auth.js pushes the same changes to Supabase when someone is signed in.
export function createCheckins(bandSlug) {
  const key = `wite:${bandSlug}:checkins`;

  const load = () => {
    try { return new Set(JSON.parse(localStorage.getItem(key)) || []); }
    catch { return new Set(); }
  };
  const save = () => localStorage.setItem(key, JSON.stringify([...visited]));

  const visited = load();

  return {
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
