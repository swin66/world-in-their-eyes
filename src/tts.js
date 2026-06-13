// ElevenLabs TTS with IndexedDB cache.
// Audio blobs are stored keyed by `${bandSlug}:${cacheKey}:${lang}` so repeated
// reads of the same card don't incur API costs.

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
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function cachePut(key, blob) {
  try {
    const db = await openDB();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, key);
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
      if (!res.ok) { onError?.(`TTS error ${res.status}`); return false; }
      blob = await res.blob();
      await cachePut(cacheKey, blob);
    } catch (err) {
      onError?.(err.message);
      return false;
    }
  }

  _blobUrl = URL.createObjectURL(blob);
  _audio = new Audio(_blobUrl);
  _audio.onended = () => {
    stopSpeaking();
    onEnd?.();
  };
  _audio.onerror = () => {
    stopSpeaking();
    onError?.('Playback failed');
  };
  _audio.play();
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
