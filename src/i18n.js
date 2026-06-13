// UI string table — extend languages here; place content translation goes in
// places.json under an optional `i18n: { fr: { title, summary, story } }` block.

const STRINGS = {
  en: {
    name: 'English', flag: '🇬🇧',
    visited: '✓ Visited',
    share: 'Share',
    listen: '🔊 Listen',
    stopAudio: '⏹ Stop',
    addMemory: 'Add a memory',
    fanMemories: 'Fan memories',
    beFirst: 'Been here? Got a photo, a ticket stub, a story? Be the first to add one.',
    allYears: 'All years',
    searchPlaceholder: 'Search places, releases, gigs… ( / )',
    searchEmpty: 'Nothing found — try a place, album or year.',
    storiesTap: 'stories — tap to open',
    approxLocation: 'approximate location',
    verifiedVisit: '📍 verified visit',
    deepCut: '💡 Deep cut',
    didYouKnow: '💡 Did you know?',
    takeATrip: 'Take a trip',
    tripBlurb: 'Guided journeys through the story — pick one and sit back.',
    sideshows: 'Sideshows',
    sideshowBlurb: 'Not on the map — guided exhibits of gear, artwork and ideas.',
    autoAdvance: 'Auto-advance',
    autoOff: "Off — I'll click",
    stops: 'stops',
    cards: 'cards',
    visited_count: (v, t) => `${v}/${t} visited`,
  },
  fr: {
    name: 'Français', flag: '🇫🇷',
    visited: '✓ Visité',
    share: 'Partager',
    listen: '🔊 Écouter',
    stopAudio: '⏹ Arrêter',
    addMemory: 'Ajouter un souvenir',
    fanMemories: 'Souvenirs des fans',
    beFirst: 'Vous y êtes allé·e ? Photo, ticket, anecdote ? Soyez le premier à partager.',
    allYears: 'Toutes les années',
    searchPlaceholder: 'Chercher des lieux, sorties, concerts…',
    searchEmpty: 'Rien trouvé — essayez un lieu, un album ou une année.',
    storiesTap: 'histoires — touchez pour ouvrir',
    approxLocation: 'emplacement approximatif',
    verifiedVisit: '📍 visite vérifiée',
    deepCut: '💡 Pour initiés',
    didYouKnow: '💡 Le saviez-vous ?',
    takeATrip: 'Prendre un voyage',
    tripBlurb: 'Parcours guidés à travers l\'histoire — choisissez et profitez.',
    sideshows: 'Expositions',
    sideshowBlurb: 'Hors carte — expositions sur le matériel, l\'art et les idées.',
    autoAdvance: 'Avance auto',
    autoOff: "Désactivé — je cliquerai",
    stops: 'arrêts',
    cards: 'cartes',
    visited_count: (v, t) => `${v}/${t} visités`,
  },
  de: {
    name: 'Deutsch', flag: '🇩🇪',
    visited: '✓ Besucht',
    share: 'Teilen',
    listen: '🔊 Anhören',
    stopAudio: '⏹ Stopp',
    addMemory: 'Erinnerung hinzufügen',
    fanMemories: 'Fan-Erinnerungen',
    beFirst: 'Waren Sie dabei? Foto, Ticket, Geschichte? Teilen Sie als Erster.',
    allYears: 'Alle Jahre',
    searchPlaceholder: 'Orte, Veröffentlichungen, Konzerte suchen…',
    searchEmpty: 'Nichts gefunden — Ort, Album oder Jahr eingeben.',
    storiesTap: 'Geschichten — antippen',
    approxLocation: 'ungefährer Standort',
    verifiedVisit: '📍 verifizierter Besuch',
    deepCut: '💡 Tiefgreifend',
    didYouKnow: '💡 Wussten Sie das?',
    takeATrip: 'Eine Reise machen',
    tripBlurb: 'Geführte Reisen durch die Geschichte — einfach zurücklehnen.',
    sideshows: 'Ausstellungen',
    sideshowBlurb: 'Nicht auf der Karte — Ausstellungen über Equipment, Kunst und Ideen.',
    autoAdvance: 'Auto-Weiter',
    autoOff: "Aus — ich klicke",
    stops: 'Halte',
    cards: 'Karten',
    visited_count: (v, t) => `${v}/${t} besucht`,
  },
  es: {
    name: 'Español', flag: '🇪🇸',
    visited: '✓ Visitado',
    share: 'Compartir',
    listen: '🔊 Escuchar',
    stopAudio: '⏹ Detener',
    addMemory: 'Añadir recuerdo',
    fanMemories: 'Recuerdos de fans',
    beFirst: '¿Estuviste aquí? ¿Foto, entrada, anécdota? Sé el primero en compartirlo.',
    allYears: 'Todos los años',
    searchPlaceholder: 'Buscar lugares, discos, conciertos…',
    searchEmpty: 'Nada encontrado — prueba un lugar, álbum o año.',
    storiesTap: 'historias — toca para abrir',
    approxLocation: 'ubicación aproximada',
    verifiedVisit: '📍 visita verificada',
    deepCut: '💡 Para conocedores',
    didYouKnow: '💡 ¿Sabías que…?',
    takeATrip: 'Hacer un viaje',
    tripBlurb: 'Recorridos guiados por la historia — elige uno y disfruta.',
    sideshows: 'Exposiciones',
    sideshowBlurb: 'Fuera del mapa — exposiciones de equipo, arte e ideas.',
    autoAdvance: 'Avance auto',
    autoOff: "Apagado — haré clic",
    stops: 'paradas',
    cards: 'tarjetas',
    visited_count: (v, t) => `${v}/${t} visitados`,
  },
};

const SUPPORTED = Object.keys(STRINGS);

function detect() {
  const saved = localStorage.getItem('wite:lang');
  if (saved && SUPPORTED.includes(saved)) return saved;
  const browser = navigator.language.slice(0, 2).toLowerCase();
  return SUPPORTED.includes(browser) ? browser : 'en';
}

let _lang = detect();

export const getLang = () => _lang;
export const getLangs = () => STRINGS;
export const getSupportedLangs = () => SUPPORTED;

export function setLang(l, bandLanguages) {
  const allowed = bandLanguages?.length ? bandLanguages.filter((x) => SUPPORTED.includes(x)) : SUPPORTED;
  _lang = allowed.includes(l) ? l : allowed[0] ?? 'en';
  localStorage.setItem('wite:lang', _lang);
}

export function t(key) {
  return STRINGS[_lang]?.[key] ?? STRINGS.en[key] ?? key;
}

// Retrieve a translated field from a data object.
// Checks obj.i18n[lang][field], then obj.i18n.en[field], then obj[field].
export function tf(obj, field) {
  return obj?.i18n?.[_lang]?.[field]
    ?? obj?.i18n?.en?.[field]
    ?? obj?.[field]
    ?? '';
}
