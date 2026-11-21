import { Linking } from 'react-native';
import * as Location from 'expo-location';
import { File, Paths } from 'expo-file-system';
import { getPlace } from './places';
import { currentPosition } from './sos';
import {
  nearbyHit,
  storeLink,
  TAXI_SERVICES,
  taxiLink,
  taxiService,
} from './taxiFormat';
import { geocode } from './tezkor';

/**
 * Taxi: opens Yandex Go or WB Taxi with the route filled in. The user
 * confirms the class and taps «Заказать» in the app, which charges their
 * card; the apps offer no way for a third party to place the order.
 */

const file = () => new File(Paths.document, 'taxi.json');
let lastService = null;
const GPS_TIMEOUT_MS = 5000;
const DEFAULT_CITY = 'Ташкент';

async function preferredService() {
  if (lastService) return lastService;
  try {
    const f = file();
    if (f.exists) lastService = JSON.parse(await f.text()).service || null;
  } catch {
    // No saved preference.
  }
  return lastService || 'yandex';
}

function rememberService(service) {
  lastService = service;
  try {
    file().write(JSON.stringify({ service }));
  } catch {
    // Only a default for next time.
  }
}

/** The city around `ref` («Ташкент»), for addresses said without one. */
async function cityAt(ref) {
  try {
    const [hit] = await Location.reverseGeocodeAsync({
      latitude: Number(ref.lat),
      longitude: Number(ref.long),
    });
    return hit?.city || hit?.subregion || hit?.region || DEFAULT_CITY;
  } catch {
    return DEFAULT_CITY;
  }
}

/**
 * A saved place by name, else the address looked up on the map near
 * `reference()` (where the user is, or home): «аэропорт» alone is retried
 * as «Ташкент, аэропорт», since the geocoder prefers airports abroad.
 */
async function resolvePoint(text, reference, { signal }) {
  const saved = await getPlace(text);
  if (saved) {
    return {
      title: saved.title,
      lat: saved.lat,
      long: saved.long,
      place: saved.key,
      ...(saved.note ? { note: saved.note } : {}),
    };
  }
  let hit;
  const hits = await geocode(text, { signal });
  const ref = await reference();
  if (ref) {
    hit = nearbyHit(hits, ref);
    if (!hit) {
      const city = await cityAt(ref);
      hit = nearbyHit(await geocode(`${city}, ${text}`, { signal }), ref);
    }
  } else {
    hit = hits.find((h) => h?.lat && h?.long);
  }
  if (!hit) return null;
  return {
    title: hit.title,
    lat: String(hit.lat),
    long: String(hit.long),
    ...(hit.accuracy === 'street' ? { exact: false } : {}),
  };
}

/**
 * Prepares the ride: `to` and `from` are saved place names or addresses;
 * an empty `from` starts where the phone is, an empty `to` lets the user
 * pick in the app. Returns the tool output and the deep link to open.
 */
export async function prepareTaxi({ service, from, to }, { signal } = {}) {
  const key = taxiService(service) || (await preferredService());
  const fromText = String(from || '').trim();
  const toText = String(to || '').trim();

  // One GPS fix, only when something needs it.
  let herePromise;
  const here = () =>
    (herePromise ||= currentPosition(GPS_TIMEOUT_MS).then((p) =>
      p ? { lat: p.latitude, long: p.longitude } : null
    ));
  let refPromise;
  const reference = () =>
    (refPromise ||= here().then(async (h) => h || (await getPlace('home'))));

  const point = (text) => resolvePoint(text, reference, { signal });

  let start = fromText ? await point(fromText) : null;
  if (fromText && !start) {
    return { output: { error: 'Pickup address not found.', query: fromText } };
  }
  const end = toText ? await point(toText) : null;
  if (toText && !end) {
    return {
      output: {
        error: 'Destination not found near you.',
        query: toText,
      },
    };
  }

  // Yandex names the GPS pickup itself; WB shows «Unknown address» unless
  // it is given the coordinates.
  if (!fromText && key === 'wb') start = await here();

  rememberService(key);
  const brief = ({ lat, long, ...rest }) => rest;
  return {
    output: {
      status: 'opening_after_reply',
      app: TAXI_SERVICES[key].name,
      from: fromText ? brief(start) : 'current location',
      to: end ? brief(end) : 'user picks in the app',
    },
    url: taxiLink(key, start, end),
    service: key,
  };
}

/** Opens the taxi app, or its store page when it isn't installed. */
export async function openTaxi(url, service) {
  try {
    await Linking.openURL(url);
  } catch {
    await Linking.openURL(storeLink(service));
  }
}
