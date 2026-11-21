/**
 * Taxi deep links, kept free of React Native so they can be unit tested.
 *
 * Both apps open with the route filled in and the prices for each class
 * shown; the user taps «Заказать» / «Request Ride» there, since that charges
 * their card or account.
 *
 * - Yandex Go (ru.yandex.taxi): the documented
 *   `yandextaxi://route?start-lat=&start-lon=&end-lat=&end-lon=`.
 * - WB Taxi (uz.wildberries.taxi.client, a Citymobil build): only
 *   `wb-taxi://ride` is exported; it reads `from=lat,lon` and `to=lat,lon`
 *   (found in the app's DeeplinkUtils / OrderDeeplinkInteractor). Without
 *   `from` either app starts from where the phone is.
 */

import { distanceM } from './placesFormat.js';

export const TAXI_SERVICES = {
  yandex: {
    name: 'Yandex Go',
    package: 'ru.yandex.taxi',
  },
  wb: {
    name: 'WB Taxi',
    package: 'uz.wildberries.taxi.client',
  },
};

/** «яндекс», "Yandex Go", «вб», "wildberries" → 'yandex' | 'wb' | null. */
export function taxiService(name) {
  const s = String(name || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (/yandex|яндекс|yango|^go$/.test(s)) return 'yandex';
  if (/\bwb\b|вб|вайлдберриз|wildberries|^w\s*b|^вэ\s*бэ/.test(s)) return 'wb';
  return null;
}

const coord = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(6).replace(/\.?0+$/, '') : null;
};

/** Point as {lat, long} (strings or numbers) → [lat, lon] or null. */
function point(p) {
  if (!p) return null;
  const lat = coord(p.lat);
  const lon = coord(p.long);
  return lat && lon ? [lat, lon] : null;
}

/**
 * The deep link that opens `service` with a route from `from` (null: where
 * the phone is) to `to` (null: the app asks where).
 */
export function taxiLink(service, from, to) {
  const a = point(from);
  const b = point(to);
  if (service === 'yandex') {
    const q = [];
    if (a) q.push(`start-lat=${a[0]}`, `start-lon=${a[1]}`);
    if (b) q.push(`end-lat=${b[0]}`, `end-lon=${b[1]}`);
    return `yandextaxi://route${q.length ? `?${q.join('&')}` : ''}`;
  }
  if (service === 'wb') {
    const q = [];
    if (a) q.push(`from=${a[0]},${a[1]}`);
    if (b) q.push(`to=${b[0]},${b[1]}`);
    return `wb-taxi://ride${q.length ? `?${q.join('&')}` : ''}`;
  }
  throw new Error(`Unknown taxi service ${service}`);
}

/** Where the app can be installed when its link has no handler. */
export const storeLink = (service) =>
  `market://details?id=${TAXI_SERVICES[service].package}`;

// A ride stays within this distance of the user (the city and its suburbs).
export const NEARBY_M = 80000;

/**
 * The best geocoder hit (they come best first) within NEARBY_M of `ref`
 * ({lat, long}), or null. The geocoder has no location bias: «аэропорт»
 * alone finds Medina and Moscow before Tashkent.
 */
export const nearbyHit = (hits, ref) =>
  (hits || []).find(
    (h) =>
      h?.lat &&
      h?.long &&
      distanceM(ref.lat, ref.long, h.lat, h.long) <= NEARBY_M
  ) || null;
