// Theme generator: turn an album cover (or any image) into an app theme.
//
// Fully client-side — no paid image/AI API — to fit the free-tier budget. We
// downscale the image onto a canvas, read the pixels, find the most prominent
// vibrant colours, and derive matching dark + light palettes (accent, accent2,
// bg, surface, text) that the rest of the app already understands.

/* ---------- colour maths ---------- */

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return [h, s, l];
}

function hslToHex(h, s, l) {
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/* ---------- pixel extraction ---------- */

// Load an image (URL or object URL) and return its downscaled pixel buffer.
// Remote URLs need CORS; if the canvas is tainted, getImageData throws and we
// surface a friendly error so the caller can suggest uploading the file.
function loadPixels(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const cx = canvas.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0, size, size);
      try {
        resolve(cx.getImageData(0, 0, size, size).data);
      } catch {
        reject(new Error('Could not read this image (cross-origin). Try uploading the file instead.'));
      }
    };
    img.onerror = () => reject(new Error('Could not load that image.'));
    img.src = src;
  });
}

// Bucket pixels into a coarse colour histogram, returning prominent colours
// sorted by a vibrancy-weighted frequency.
function prominentColours(data) {
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 125) continue; // skip transparent
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // Quantise to 5 bits/channel to merge near-identical colours.
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const e = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
    e.r += r; e.g += g; e.b += b; e.n += 1;
    buckets.set(key, e);
  }
  const colours = [...buckets.values()].map((e) => {
    const r = e.r / e.n, g = e.g / e.n, b = e.b / e.n;
    const [h, s, l] = rgbToHsl(r, g, b);
    // Vibrancy: favour saturated, mid-light colours over muddy/extreme ones.
    const vibrancy = s * (1 - Math.abs(l - 0.5) * 1.2);
    return { r, g, b, h, s, l, n: e.n, weight: e.n * (0.25 + vibrancy) };
  });
  return colours.sort((a, b) => b.weight - a.weight);
}

/* ---------- theme synthesis ---------- */

// Smallest angular distance between two hues (0–180°).
function hueDist(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Pick a second accent: the most prominent saturated colour whose hue is
// meaningfully different from the first (falls back to the next colour).
function pickSecondAccent(colours, firstHue) {
  const far = colours.find((c) => c.s > 0.2 && hueDist(c.h, firstHue) > 25);
  return far || colours[1] || colours[0];
}

// Build dark + light palettes from prominent colours. Returns objects keyed by
// accent, accent2, bg, surface, text (matching the app's THEME_KEYS).
export function themesFromColours(colours) {
  if (!colours.length) return null;
  const vivid = colours.filter((c) => c.s > 0.18);
  const a1 = vivid[0] || colours[0];
  const a2 = pickSecondAccent(vivid.length ? vivid : colours, a1.h);
  const hue = a1.h;

  // Keep accents readable on both backgrounds by clamping lightness.
  const accentDark = hslToHex(a1.h, Math.max(0.5, a1.s), Math.min(0.68, Math.max(0.52, a1.l)));
  const accent2Dark = hslToHex(a2.h, Math.max(0.45, a2.s), Math.min(0.66, Math.max(0.5, a2.l)));
  const accentLight = hslToHex(a1.h, Math.max(0.55, a1.s), Math.min(0.5, Math.max(0.36, a1.l)));
  const accent2Light = hslToHex(a2.h, Math.max(0.5, a2.s), Math.min(0.5, Math.max(0.36, a2.l)));

  return {
    dark: {
      accent: accentDark,
      accent2: accent2Dark,
      bg: hslToHex(hue, 0.14, 0.06),
      surface: hslToHex(hue, 0.13, 0.11),
      text: hslToHex(hue, 0.10, 0.93),
    },
    light: {
      accent: accentLight,
      accent2: accent2Light,
      bg: hslToHex(hue, 0.28, 0.965),
      surface: hslToHex(hue, 0.18, 0.995),
      text: hslToHex(hue, 0.30, 0.12),
    },
  };
}

// One-shot: image source → { dark, light } palettes. Throws on load/CORS error.
export async function generateThemeFromImage(src) {
  const data = await loadPixels(src);
  const themes = themesFromColours(prominentColours(data));
  if (!themes) throw new Error('No usable colours found in that image.');
  return themes;
}
