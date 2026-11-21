// Pure helpers for saved places (no React Native imports, so Node tests
// can load them).

// What people call their home and work, in Russian, English and Uzbek, and
// the grammatical forms they come in («домой», «на работу», «uyga»).
const ALIASES = [
  [/^(дом|дома|домой|доме|home|uy|uyga|uyim|uyda|xonadon)$/, 'home'],
  [
    /^(работа|работу|работе|работы|офис|офиса|офисе|work|office|ish|ishga|ishxona|ishxonaga|ofis)$/,
    'work',
  ],
];

const FILLERS = /^(мой|моя|моё|мое|на|в|во|my|the|to|at)\s+/;

/**
 * The key a place is saved under: 'home' and 'work' for their many names,
 * otherwise the name itself, lowercased («Дача» → «дача»).
 */
export function placeKey(name) {
  let text = String(name || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'.,!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  while (FILLERS.test(text)) text = text.replace(FILLERS, '');
  for (const [re, key] of ALIASES) if (re.test(text)) return key;
  return text;
}

/** The saved place `name` refers to, or null. */
export function findPlace(places, name) {
  const key = placeKey(name);
  if (!key) return null;
  return (places || []).find((p) => p.key === key) || null;
}

/** A place as the model sees it. */
export const publicPlace = (p) => ({
  name: p.key,
  address: p.full_title,
  ...(p.note ? { note: p.note } : {}),
});

/**
 * The geocoder hit to save as a place: the first one in Tezkor's delivery
 * zone, or failing that the first one at all (a place is useful for taxis
 * even where Tezkor does not deliver).
 */
export function pickPlace(hits) {
  const usable = (hits || []).filter((h) => h?.lat && h?.long);
  const inZone = usable.find((h) => !h.hints?.deliveryZone?.outOfDeliveryZone);
  const hit = inZone || usable[0];
  if (!hit) return null;
  return {
    title: hit.details?.name || hit.title,
    full_title: hit.title,
    lat: String(hit.lat),
    long: String(hit.long),
    accuracy: hit.accuracy,
    tezkor_delivers: !!inZone,
  };
}

// Google's Plus Codes («69WC+HRH»): what the phone's geocoder gives as the
// name of a spot with no street address. Meaningless when spoken.
const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]*$/i;

/** A readable address from expo-location's reverse geocoding. */
export function describeLocation(r) {
  if (!r) return null;
  const street = [r.street, r.streetNumber].filter(Boolean).join(', ');
  const name = PLUS_CODE.test(String(r.name || '').trim()) ? null : r.name;
  const parts = [street || name, r.district, r.city || r.region].filter(
    Boolean
  );
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  return unique.length ? unique.join(', ') : null;
}

/** Distance in metres between two points given in degrees. */
export function distanceM(lat1, lon1, lat2, lon2) {
  const rad = (d) => (Number(d) * Math.PI) / 180;
  const a =
    Math.sin((rad(lat2) - rad(lat1)) / 2) ** 2 +
    Math.cos(rad(lat1)) *
      Math.cos(rad(lat2)) *
      Math.sin((rad(lon2) - rad(lon1)) / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(a)));
}

/** The saved place nearest to a point, with its distance, or null. */
export function nearestPlace(places, lat, long) {
  let best = null;
  for (const p of places || []) {
    const d = distanceM(lat, long, p.lat, p.long);
    if (!best || d < best.distance_m) best = { name: p.key, distance_m: d };
  }
  return best;
}
