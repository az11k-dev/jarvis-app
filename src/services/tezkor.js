import { Linking } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { TEZKOR } from '../config/jarvis';
import { withTimeout } from '../utils/timeout';
import {
  findKitchenIds,
  pickAddress,
  pickMenu,
  rankSearch,
  vendorSummary,
  vendorsNamed,
} from './tezkorFormat';

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

let tokenRequest = null; // one request even when two tools ask at once

function requestGuestToken(signal) {
  tokenRequest ||= fetchGuestToken(signal).finally(() => {
    tokenRequest = null;
  });
  return tokenRequest;
}

async function fetchGuestToken(signal) {
  const res = await fetchJson(
    '/api/v1/auth/guest',
    { params: { client_id: TEZKOR.clientId, realm: 'user' } },
    { signal, auth: false }
  );
  if (!res?.access_token) throw unexpected();
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

// A changed API must read as an error, never as "nothing found".
const unexpected = () =>
  new TezkorError('Uzum Tezkor answered in an unexpected format.');

function list(value) {
  if (!Array.isArray(value)) throw unexpected();
  return value;
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

/**
 * Finds `query` on the map and saves it as the delivery address. Places
 * Tezkor does not deliver to are not saved.
 */
export async function setAddress(query, { signal } = {}) {
  const text = String(query || '').trim();
  if (!text) return { error: 'Say the address.' };
  let res;
  try {
    res = await fetchJson(
      '/api/v1/geo/addresses',
      { params: { query: text, limit: 5 } },
      { signal }
    );
  } catch (e) {
    // The geocoder answers an unknown place with an error, not an empty list.
    if (e instanceof TezkorError && /geocode|address/i.test(e.message)) {
      return { error: 'Address not found.', query: text };
    }
    throw e;
  }
  const { chosen, others, outOfZone } = pickAddress(res?.data);
  if (!chosen) {
    return outOfZone
      ? {
          error: 'Uzum Tezkor does not deliver to this address. Not saved.',
          found: outOfZone,
        }
      : { error: 'Address not found.', query: text };
  }
  address = chosen;
  await addressFile().write(JSON.stringify(address));
  return {
    status: 'saved',
    address: address.full_title,
    // "street" means the house number was not found exactly.
    exact: chosen.accuracy === 'house' || chosen.accuracy === 'precise',
    // Other places with this name; the user may have meant one of them.
    ...(others.length ? { other_matches: others } : {}),
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
  const found = list(res?.result)
    .filter((r) => r.type === 'searchResult')
    .flatMap((r) => r.vendors || []);
  return {
    delivery_address: a.title,
    query: text,
    // Only places that have the query; other restaurants may be open too
    // (tezkor_restaurants lists them).
    places_with_query: found.length,
    places_with_query_open_now: found.filter(
      (i) => i.vendor?.status === 'active'
    ).length,
    vendors: rankSearch(found, text, TEZKOR),
  };
}

const kitchenFilters = new Map(); // category → Tezkor's kitchen filters

async function fetchVendors(a, category, params, signal) {
  const res = await fetchJson(
    '/api/v1/vendors',
    {
      params: { lat: a.lat, long: a.long, category, offset: 0, ...params },
    },
    { signal }
  );
  list(res?.vendors);
  if (res.filters?.kitchens) kitchenFilters.set(category, res.filters.kitchens);
  return res;
}

/**
 * Restaurants (or shops) delivering to the address, as on the Tezkor home
 * screen, optionally only one kitchen («Бургеры», «Milliy Taom») or place
 * name. Tezkor returns at most `listLimit` places per request and has no
 * working paging, so a kitchen is filtered on their side and the totals
 * come from their count.
 */
export async function listRestaurants(
  { kitchen = '', type = 'restaurant', openOnly = true } = {},
  { signal } = {}
) {
  const a = await requireAddress();
  const category = type === 'shop' ? 'grocery' : 'rte';
  const wanted = String(kitchen || '').trim();

  let res;
  let raw;
  let total;
  if (wanted) {
    if (!kitchenFilters.has(category)) {
      await fetchVendors(a, category, { limit: 1 }, signal);
    }
    const ids = findKitchenIds(wanted, kitchenFilters.get(category));
    if (ids.length) {
      res = await fetchVendors(
        a,
        category,
        { limit: TEZKOR.listLimit, kitchenIDs: ids.join(',') },
        signal
      );
      raw = res.vendors;
      total = Number(res.total) || raw.length;
    } else {
      // Not a kitchen: a place name («KFC»), looked up among the nearest.
      res = await fetchVendors(
        a,
        category,
        { limit: TEZKOR.listLimit },
        signal
      );
      raw = vendorsNamed(
        res.vendors.map((v) => v.vendor || v),
        wanted
      );
      total = raw.length;
    }
  } else {
    res = await fetchVendors(a, category, { limit: TEZKOR.homeLimit }, signal);
    raw = res.vendors;
    total = Number(res.total) || raw.length;
  }

  const all = raw.map((v) => vendorSummary(v.vendor || v));
  const open = all.filter((v) => v.open);
  // Tezkor lists closed places last, so a page of only open ones means
  // there are more open ones than we received.
  const complete = all.length >= total || open.length < all.length;
  // Closed ones are listed by how soon they open.
  const soonest = (x, y) =>
    String(x.opens_day || '').localeCompare(String(y.opens_day || '')) ||
    String(x.opens_at || '99').localeCompare(String(y.opens_at || '99'));
  const opening = (limit) =>
    all
      .filter((v) => !v.open && v.opens_at)
      .sort(soonest)
      .slice(0, limit)
      .map((v) => ({
        name: v.name,
        opens_at: v.opens_at,
        opens_day: v.opens_day,
      }));
  return {
    delivery_address: a.title,
    ...(wanted ? { kitchen: wanted } : {}),
    total,
    ...(complete
      ? { open_now: open.length }
      : { open_now_at_least: open.length }),
    ...(openOnly && !open.length ? { next_to_open: opening(3) } : {}),
    restaurants: open.slice(0, TEZKOR.maxRestaurants),
    // Closed places get their own short list, or the open ones crowd them out.
    ...(openOnly ? {} : { closed: opening(TEZKOR.maxRestaurants) }),
    kitchens: (kitchenFilters.get(category) || []).map((k) => k.name),
  };
}

/**
 * One restaurant's or shop's menu, optionally only what matches `query`.
 * A shop's catalog has thousands of products and comes without them, so a
 * shop is searched on Tezkor's side and needs a query.
 */
export async function vendorMenu(vendorId, query, { signal } = {}) {
  const id = String(vendorId || '').trim();
  if (!id) return { error: 'vendor_id is required.' };
  const text = String(query || '').trim();
  const a = await requireAddress();
  const place = { lat: a.lat, long: a.long };
  const base = `/api/v2/vendors/${encodeURIComponent(id)}/catalog`;
  const res = await fetchJson(base, { params: place }, { signal });
  const vendor = vendorSummary(res?.vendor || {});
  const categories = list(res?.categories);
  const products = res?.products || [];

  const searchInside = async () => {
    const found = await fetchJson(
      `/api/v1/vendors/${encodeURIComponent(id)}/catalog/search`,
      { params: { pattern: text, ...place } },
      { signal }
    );
    return {
      products: found?.products || [],
      categories: found?.categories || [],
    };
  };

  // Tezkor's search is fuzzy («молоко» also brings milk chocolate): keep
  // the products that really have the words when there are any.
  const nearest = (found) => {
    const exact = pickMenu(found.products, found.categories, text, TEZKOR);
    const { dishes, matching } = exact.matching
      ? exact
      : {
          ...pickMenu(found.products, found.categories, '', TEZKOR),
          matching: found.products.length,
        };
    return { matching, dishes };
  };

  if (products.length) {
    const menu = pickMenu(products, categories, text, TEZKOR);
    if (!text || menu.matching) return { vendor, ...menu };
    // Nothing by name: let Tezkor's own (fuzzy) search try.
    const found = await searchInside();
    return {
      vendor,
      ...nearest(found),
      categories: menu.categories,
      total_dishes: products.length,
    };
  }

  const sections = categories
    .filter((c) => !c.parent)
    .sort((x, y) => (x.order || 0) - (y.order || 0))
    .map((c) => c.name.trim());
  if (!text) {
    return {
      vendor,
      sections,
      note: 'A shop is too big to list: call again with query set to a product or a section.',
    };
  }
  let found = await searchInside();
  if (!found.products.length) {
    // The query may be a section name («Хлеб»): list that section.
    const section = categories.find(
      (c) => c.name.trim().toLowerCase() === text.toLowerCase()
    );
    if (section) {
      const inSection = await fetchJson(
        `${base}/${encodeURIComponent(section.id)}`,
        { params: place },
        { signal }
      );
      found = { products: inSection?.products || [], categories };
    }
  }
  return {
    vendor,
    query: text,
    ...nearest(found),
    ...(found.products.length ? {} : { sections }),
  };
}

/** The saved delivery address as the user knows it, or null. */
export async function deliveryAddress() {
  return (await loadAddress())?.full_title || null;
}

/**
 * Opens the Uzum Tezkor website so the user can place the order there.
 * JARVIS can't log in or pay itself (Uzum's login is gated to their own
 * apps, and card details are the user's to enter), so ordering happens on
 * the real site, where the user stays logged in. Opens a restaurant when
 * `vendorId` is given, on the dish itself (with its «Добавить» button) when
 * `productId` is given too; otherwise the home screen.
 *
 * The site keeps its own delivery address and refuses a restaurant that
 * does not deliver there («Ресторан недоступен»), so it must be the same
 * address as the one saved here.
 */
export async function openTezkor({ vendorId, productId } = {}) {
  const id = String(vendorId || '').trim();
  const product = String(productId || '').trim();
  const path = id ? `/restaurants/${encodeURIComponent(id)}` : '';
  const query =
    id && product ? `?product_id=${encodeURIComponent(product)}` : '';
  await Linking.openURL(`${TEZKOR.baseUrl}/${TEZKOR.language}${path}${query}`);
}
