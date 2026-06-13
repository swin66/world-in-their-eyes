// ElevenLabs TTS with IndexedDB cache.
// Blobs are stored as ArrayBuffers to survive the IndexedDB round-trip without
// losing their MIME type (Blob.type is not preserved in all browsers/versions).

const DB_NAME = 'wite-tts-cache';
const STORE = 'audio';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheGet(key) {
  try {
    const db = await openDB();
    const buf = await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
    return buf ? new Blob([buf], { type: 'audio/mpeg' }) : null;
  } catch { return null; }
}

async function cachePut(key, arrayBuffer) {
  try {
    const db = await openDB();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(arrayBuffer, key);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch { /* non-fatal */ }
}

let _audio = null;
let _blobUrl = null;

export function stopSpeaking() {
  if (_audio) { _audio.pause(); _audio.src = ''; _audio = null; }
  if (_blobUrl) { URL.revokeObjectURL(_blobUrl); _blobUrl = null; }
}

export function isSpeaking() {
  return !!_audio && !_audio.paused && !_audio.ended;
}

// --- Voice preferences (per language, stored in localStorage) ---

const LS_VOICES = 'wite:tts:voices';
const LS_AUTOPLAY = 'wite:tts:autoplay';

export function getVoiceForLang(lang, bandTts) {
  const overrides = JSON.parse(localStorage.getItem(LS_VOICES) || '{}');
  return overrides[lang] ?? bandTts?.voices?.[lang] ?? bandTts?.voiceId ?? null;
}

export function setVoiceForLang(lang, voiceId) {
  const overrides = JSON.parse(localStorage.getItem(LS_VOICES) || '{}');
  overrides[lang] = voiceId;
  localStorage.setItem(LS_VOICES, JSON.stringify(overrides));
}

export function getAutoplay() {
  return localStorage.getItem(LS_AUTOPLAY) === 'true';
}

export function setAutoplay(on) {
  localStorage.setItem(LS_AUTOPLAY, on ? 'true' : 'false');
}

// Fetch the caller's available voices from ElevenLabs.
export async function fetchVoices(apiKey) {
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.voices || []).sort((a, b) => a.name.localeCompare(b.name));
  } catch { return []; }
}

// --- Speak ---

export async function speak({ text, apiKey, voiceId, model = 'eleven_multilingual_v2', cacheKey, onEnd, onError }) {
  stopSpeaking();
  if (!apiKey || !voiceId || !text) return false;

  let blob = await cacheGet(cacheKey);

  if (!blob) {
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: model,
          voice_settings: { stability: 0.45, similarity_boost: 0.75 },
        }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => res.status);
        onError?.(`TTS ${res.status}: ${msg}`);
        return false;
      }
      const buf = await res.arrayBuffer();
      await cachePut(cacheKey, buf);
      blob = new Blob([buf], { type: 'audio/mpeg' });
    } catch (err) {
      onError?.(err.message);
      return false;
    }
  }

  _blobUrl = URL.createObjectURL(blob);
  _audio = new Audio(_blobUrl);
  _audio.onended = () => { stopSpeaking(); onEnd?.(); };
  _audio.onerror = (e) => {
    stopSpeaking();
    onError?.(`Playback failed (${_audio?.error?.code ?? e.type})`);
  };
  try {
    await _audio.play();
  } catch (err) {
    stopSpeaking();
    onError?.(err.message);
    return false;
  }
  return true;
}

export async function clearCache() {
  try {
    const db = await openDB();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = resolve;
    });
  } catch { /* non-fatal */ }
}
