// Which place categories are actually time-anchored "events" (gigs, milestones,
// releases, video shoots) rather than physical/ongoing places. Events live in a
// separate DB table but are merged back into the map feature set at load time,
// so rendering/filtering treat them uniformly — this is the single source of
// truth for the split (loader + admin both import it).
export const EVENT_CATEGORIES = ['gig', 'milestone', 'release', 'video'];

export function isEventCategory(category) {
  return EVENT_CATEGORIES.includes(category);
}
