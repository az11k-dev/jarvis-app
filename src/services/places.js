import * as Location from 'expo-location';
import { File, Paths } from 'expo-file-system';
import {
  describeLocation,
  findPlace,
  nearestPlace,
  pickPlace,
  placeKey,
  publicPlace,
} from './placesFormat';
import { currentPosition } from './sos';
import { geocode } from './tezkor';

/**
 * The user's saved places («дом», «работа», «дача»…): an address with its
 * coordinates, saved once and used by name afterwards: where food is
 * delivered now, and where a taxi goes from or to later.
 */

const file = () => new File(Paths.document, 'places.json');
let places = null; // [{ key, title, full_title, lat, long, accuracy, tezkor_delivers, note }]

async function load() {
  if (places) return places;
  try {
    const f = file();
    places = f.exists ? JSON.parse(await f.text()).places || [] : [];
  } catch {
    places = [];
  }
  return places;
}

const save = () => file().write(JSON.stringify({ places }));

export async function listPlaces() {
  return (await load()).map(publicPlace);
}

/** The saved place `name` refers to («домой» → home), or null. */
export async function getPlace(name) {
  return findPlace(await load(), name);
}

/** Where the phone is now, as a place (address from the phone's geocoder). */
async function placeHere() {
  const pos = await currentPosition();
  if (!pos)
    return { error: 'Location is unavailable (no permission or no fix).' };
  let title = null;
  try {
    const [hit] = await Location.reverseGeocodeAsync({
      latitude: pos.latitude,
      longitude: pos.longitude,
    });
    title = describeLocation(hit);
  } catch {
    // An address is nice to have; the coordinates are what matter.
  }
  const coords = `${pos.latitude.toFixed(5)}, ${pos.longitude.toFixed(5)}`;
  return {
    title: title || coords,
    full_title: title || coords,
    lat: String(pos.latitude),
    long: String(pos.longitude),
    accuracy: 'gps',
    ...(pos.stale ? { stale: true } : {}),
  };
}

/**
 * Saves (or replaces) the place `name`: `address` is looked up on the map,
 * or with `here` the phone's current location is used.
 */
export async function savePlace(
  { name, address, here, note },
  { signal } = {}
) {
  const key = placeKey(name);
  if (!key) return { error: 'Say what to call the place (home, work…).' };
  const text = String(address || '').trim();

  let found;
  if (here) {
    found = await placeHere();
    if (found.error) return found;
  } else {
    if (!text)
      return { error: 'Say the address, or save where the phone is now.' };
    found = pickPlace(await geocode(text, { signal }));
    if (!found) return { error: 'Address not found.', query: text };
  }

  const all = await load();
  const replaced = all.find((p) => p.key === key);
  const { stale, ...where } = found;
  const place = {
    key,
    ...where,
    ...(String(note || '').trim() ? { note: String(note).trim() } : {}),
  };
  places = [...all.filter((p) => p.key !== key), place];
  await save();
  return {
    status: replaced ? 'updated' : 'saved',
    ...publicPlace(place),
    ...(found.accuracy && !['house', 'precise', 'gps'].includes(found.accuracy)
      ? { exact: false }
      : {}),
    ...(stale ? { warning: 'Old location fix; may be inaccurate.' } : {}),
    ...(found.tezkor_delivers === false ? { tezkor_delivers: false } : {}),
  };
}

export async function removePlace(name) {
  const all = await load();
  const place = findPlace(all, name);
  if (!place) {
    return { error: 'No such saved place.', places: all.map(publicPlace) };
  }
  places = all.filter((p) => p !== place);
  await save();
  return {
    status: 'removed',
    name: place.key,
    places: places.map(publicPlace),
  };
}

// Within this distance the user is "at" a saved place (GPS drifts indoors).
const AT_PLACE_M = 150;

/**
 * Where the phone is now: an address, a map link, and the nearest saved
 * place (and whether the user is at it).
 */
export async function whereAmI() {
  const here = await placeHere();
  if (here.error) return here;
  const near = nearestPlace(await load(), here.lat, here.long);
  return {
    address: here.full_title,
    map: `https://maps.google.com/?q=${here.lat},${here.long}`,
    ...(near
      ? {
          nearest_saved_place: near.name,
          distance_m: near.distance_m,
          at_saved_place: near.distance_m <= AT_PLACE_M,
        }
      : {}),
    ...(here.stale ? { warning: 'Old location fix; may be inaccurate.' } : {}),
  };
}
