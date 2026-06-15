// Per-user theme override. A fan can generate their own palette (from an image)
// that layers on top of the band's theme, stored locally on their device. Kept
// in its own module so both main.js (apply) and auth.js (UI) can use it without
// a circular import.

const KEYS = ['accent', 'accent2', 'bg', 'surface', 'text'];
const key = (slug) => `wite:${slug}:userTheme`;

export function loadUserTheme(slug) {
  try { return JSON.parse(localStorage.getItem(key(slug)) || 'null'); }
  catch { return null; }
}

export function saveUserTheme(slug, themes) {
  localStorage.setItem(key(slug), JSON.stringify(themes));
}

export function clearUserTheme(slug) {
  localStorage.removeItem(key(slug));
}

// Override the live CSS variables for the current mode from a saved user theme.
// Returns true if an override was applied. Call after the band theme is applied.
export function applyUserTheme(slug, mode) {
  const t = loadUserTheme(slug)?.[mode];
  if (!t) return false;
  const root = document.documentElement;
  for (const k of KEYS) if (t[k]) root.style.setProperty(`--${k}`, t[k]);
  if (t.bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.bg);
  if (t.accent && t.accent2) {
    const mark = document.getElementById('brand-mark');
    if (mark) mark.style.background = `linear-gradient(135deg, ${t.accent}, ${t.accent2})`;
  }
  return true;
}
