import { Linking } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { TEZKOR } from '../config/jarvis';
import { withTimeout } from '../utils/timeout';

// Uzum Tezkor has no public API. This talks to the same JSON API the
// uzumtezkor.uz web app uses. Search and menus work with a guest token;
// prices come in tiyin (1/100 sum).

export class TezkorError extends Error {}

// ── session (guest token, reused across launches) ─────────────────────────

const sessionFile = () => new File(Paths.document, 'tezkor-session.json');
let session = null; // { accessToken, expiresAt }

async function loadSession() {
  if (session) return session;
  try {
    const file = sessionFile();
    if (file.exists) session = JSON.parse(await file.text());
  } catch {
    session = null;
  }
  return session;
}

async function requestGuestToken(signal) {
  const res = await fetchJson(
    '/api/v1/auth/guest',
    { params: { client_id: TEZKOR.clientId, realm: 'user' } },
    { signal, auth: false }
  );
  session = {
    accessToken: res.access_token,
    // Renew a minute early so a token never expires mid-request.
    expiresAt: Date.now() + (Number(res.expires_in) || 3600) * 1000 - 60000,
  };
  try {
    await sessionFile().write(JSON.stringify(session));
  } catch (e) {
    console.warn('Could not save the Tezkor session:', e);
  }
  return session;
}

async function accessToken(signal, { renew = false } = {}) {
  const s = await loadSession();
  if (!renew && s?.accessToken && s.expiresAt > Date.now()) {
    return s.accessToken;
  }
  return (await requestGuestToken(signal)).accessToken;
}

// ── HTTP ──────────────────────────────────────────────────────────────────

function queryString(params = {}) {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

async function fetchJson(path, { params, method = 'GET', body } = {}, opts) {
  const { signal, auth = true, retried = false } = opts || {};
  const headers = {
    Accept: 'application/json',
    'Accept-Language': TEZKOR.language,
    'X-Platform': 'web',
  };
  if (auth) {
    headers.authorization = `Bearer ${await accessToken(signal, { renew: retried })}`;
  }
  if (body) headers['Content-Type'] = 'application/json';

  const t = withTimeout(signal, TEZKOR.timeoutMs);
  let res;
  try {
    res = await fetch(`${TEZKOR.baseUrl}${path}${queryString(params)}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: t.signal,
    });
  } catch (e) {
    signal?.throwIfAborted?.();
    throw new TezkorError(
      t.signal.aborted ? 'Uzum Tezkor did not answer in time.' : e.message
    );
  } finally {
    t.cleanup();
  }

  // An expired or revoked guest token: get a new one once.
  if (res.status === 401 && auth && !retried) {
    return fetchJson(
      path,
      { params, method, body },
      { ...opts, retried: true }
    );
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const message =
      data?.communication?.subtitle ||
      data?.message ||
      `Uzum Tezkor error ${res.status}`;
    throw new TezkorError(message);
  }
  return data;
}

// ── delivery address ──────────────────────────────────────────────────────

const addressFile = () => new File(Paths.document, 'tezkor-address.json');
let address; // undefined = not loaded yet, null = none set

async function loadAddress() {
  if (address !== undefined) return address;
  try {
    const file = addressFile();
    address = file.exists ? JSON.parse(await file.text()) : null;
  } catch {
    address = null;
  }
  return address;
}

/** Finds `query` on the map and saves it as the delivery address. */
export async function setAddress(query, { signal } = {}) {
  const text = String(query || '').trim();
  if (!text) return { error: 'Say the address.' };
  const res = await fetchJson(
    '/api/v1/geo/addresses',
    { params: { query: text, limit: 1 } },
    { signal }
  );
  const found = res?.data?.[0];
  if (!found?.lat || !found?.long) {
    return { error: 'Address not found.', query: text };
  }
  address = {
    title: found.details?.name || found.title,
    full_title: found.title,
    lat: String(found.lat),
    long: String(found.long),
    accuracy: found.accuracy,
  };
  await addressFile().write(JSON.stringify(address));
  return {
    status: 'saved',
    address: address.full_title,
    // "street" means the house number was not found exactly.
    exact: found.accuracy === 'house' || found.accuracy === 'precise',
  };
}

async function requireAddress() {
  const a = await loadAddress();
  if (!a) {
    throw new TezkorError(
      'No delivery address set. Ask the user for their address (street, house, city) and call tezkor_set_address.'
    );
  }
  return a;
}

// ── formatting ────────────────────────────────────────────────────────────

const sum = (price) =>
  price && typeof price.value === 'number'
    ? Math.round(price.value / 100)
    : null;

const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е');

// Word stems, so «плова» still finds «Плов» and «бургеры» finds «Бургер».
function stems(query) {
  return normalize(query)
    .split(/[^a-zа-яўқғҳ0-9]+/)
    .filter((w) => w.length >= 3)
    .map((w) => (w.length > 4 ? w.slice(0, Math.max(3, w.length - 2)) : w));
}

const matches = (text, keys) =>
  keys.length > 0 && keys.some((k) => normalize(text).includes(k));

const shorten = (s, n) => {
  const t = String(s || '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// Vendor hours come as UTC ("07:30Z"); show them in the vendor's time zone.
function localTime(utc, offsetSec) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(utc || ''));
  if (!m) return null;
  const minutes =
    (((Number(m[1]) * 60 + Number(m[2]) + Math.round((offsetSec || 0) / 60)) %
      1440) +
      1440) %
    1440;
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function dish(p) {
  return {
    product_id: p.id,
    name: p.name,
    price_sum: sum(p.price),
    ...(p.weight
      ? { weight: `${p.weight} ${p.unit === 'pcs' ? 'g' : p.unit}` }
      : {}),
    ...(p.description
      ? { description: shorten(p.description, TEZKOR.maxDescriptionChars) }
      : {}),
  };
}

function vendorSummary(v) {
  const info = v.info || {};
  const offer = v.offer || {};
  const open = v.status === 'active';
  return {
    vendor_id: info.id,
    name: info.vendorName || info.name,
    type: info.category === 'rte' ? 'restaurant' : 'shop',
    open,
    ...(open
      ? {}
      : { opens_at: localTime(v.schedule?.startTime, info.timeZoneOffset) }),
    rating: info.rating?.grade || null,
    distance_m: Number(info.distanceToClient) || null,
    delivery_minutes:
      offer.minDeliveryTime && offer.maxDeliveryTime
        ? `${offer.minDeliveryTime}-${offer.maxDeliveryTime}`
        : null,
    delivery_price_sum: sum(v.receiving?.delivery?.price),
    min_order_sum: sum({ value: offer.minOrderAmount }),
    kitchens: v.kitchens || [],
  };
}

// ── search and menus ──────────────────────────────────────────────────────

/** Restaurants and shops near the delivery address that have `query`. */
export async function searchFood(query, { signal } = {}) {
  const text = String(query || '').trim();
  if (!text) return { error: 'Say what to look for.' };
  const a = await requireAddress();
  const res = await fetchJson(
    '/api/v1/vendors/catalog/search',
    { params: { pattern: text, lat: a.lat, long: a.long } },
    { signal }
  );
  const found = (res?.result || [])
    .filter((r) => r.type === 'searchResult')
    .flatMap((r) => r.vendors || []);
  const keys = stems(text);
  const vendors = found
    .map((item, rank) => {
      const products = item.products || [];
      const hits = products.filter((p) => matches(p.name, keys));
      return {
        rank,
        ...vendorSummary(item.vendor || {}),
        dishes: (hits.length ? hits : products.slice(0, 2))
          .slice(0, TEZKOR.maxDishes)
          .map(dish),
        dishes_match_query: hits.length > 0,
      };
    })
    // Open places first, then those with a matching dish, otherwise keep
    // Tezkor's own ranking.
    .sort(
      (x, y) =>
        Number(y.open) - Number(x.open) ||
        Number(y.dishes_match_query) - Number(x.dishes_match_query) ||
        x.rank - y.rank
    )
    .slice(0, TEZKOR.maxVendors)
    .map(({ rank, ...v }) => v);

  return {
    delivery_address: a.title,
    query: text,
    // Only places that have the query; other restaurants may be open too
    // (tezkor_restaurants lists them).
    places_with_query: found.length,
    places_with_query_open_now: found.filter(
      (i) => i.vendor?.status === 'active'
    ).length,
    vendors,
  };
}

/**
 * Restaurants (or shops) delivering to the address, as on the Tezkor home
 * screen, optionally only one kitchen («Бургеры», «Milliy Taom»).
 */
export async function listRestaurants(
  { kitchen = '', type = 'restaurant', openOnly = true } = {},
  { signal } = {}
) {
  const a = await requireAddress();
  const res = await fetchJson(
    '/api/v1/vendors',
    {
      params: {
        lat: a.lat,
        long: a.long,
        category: type === 'shop' ? 'grocery' : 'rte',
        limit: 200,
        offset: 0,
      },
    },
    { signal }
  );
  const all = (res?.vendors || []).map((v) => vendorSummary(v.vendor || v));
  const keys = stems(kitchen);
  const inKitchen = keys.length
    ? all.filter((v) => matches(`${v.kitchens.join(' ')} ${v.name}`, keys))
    : all;
  const open = inKitchen.filter((v) => v.open);
  const listed = openOnly ? open : inKitchen;
  // Closed ones are listed by how soon they open.
  const sorted = openOnly
    ? listed
    : [...listed].sort(
        (x, y) =>
          Number(y.open) - Number(x.open) ||
          String(x.opens_at || '99').localeCompare(String(y.opens_at || '99'))
      );
  return {
    delivery_address: a.title,
    ...(kitchen ? { kitchen } : {}),
    total: inKitchen.length,
    open_now: open.length,
    ...(openOnly && !open.length
      ? {
          next_to_open: inKitchen
            .filter((v) => v.opens_at)
            .sort((x, y) => x.opens_at.localeCompare(y.opens_at))
            .slice(0, 3)
            .map((v) => ({ name: v.name, opens_at: v.opens_at })),
        }
      : {}),
    restaurants: sorted.slice(0, TEZKOR.maxRestaurants),
    kitchens: [...new Set(all.flatMap((v) => v.kitchens))],
  };
}

/** One restaurant's menu, optionally only dishes matching `query`. */
export async function vendorMenu(vendorId, query, { signal } = {}) {
  const id = String(vendorId || '').trim();
  if (!id) return { error: 'vendor_id is required.' };
  const a = await requireAddress();
  const res = await fetchJson(
    `/api/v2/vendors/${encodeURIComponent(id)}/catalog`,
    { params: { lat: a.lat, long: a.long } },
    { signal }
  );
  const categories = new Map(
    (res?.categories || []).map((c) => [c.id, c.name])
  );
  const keys = stems(query);
  const all = res?.products || [];
  const picked = keys.length
    ? all.filter((p) => matches(p.name, keys) || matches(p.description, keys))
    : all;
  return {
    vendor: vendorSummary(res?.vendor || {}),
    categories: [...categories.values()],
    total_dishes: all.length,
    ...(keys.length ? { matching: picked.length } : {}),
    dishes: picked.slice(0, TEZKOR.maxMenuItems).map((p) => ({
      ...dish(p),
      category: categories.get(p.categories?.[0]) || null,
    })),
  };
}

/**
 * Opens the Uzum Tezkor website so the user can log in and place the order
 * there. JARVIS can't log in or pay itself (Uzum's login is gated to their
 * own apps, and card details are the user's to enter), so ordering happens
 * on the real site, where the user stays logged in. Opens a specific
 * restaurant when `vendorId` is given, otherwise the home screen.
 */
export async function openTezkor({ vendorId } = {}) {
  const id = String(vendorId || '').trim();
  const path = id ? `/restaurants/${encodeURIComponent(id)}` : '';
  await Linking.openURL(`${TEZKOR.baseUrl}/${TEZKOR.language}${path}`);
}
