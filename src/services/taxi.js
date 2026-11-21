import { Linking } from 'react-native';
import * as Screen from '../../modules/jarvis-screen';
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
import { mergeClasses, parseRide } from './taxiScreen';
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
    return true;
  } catch {
    await Linking.openURL(storeLink(service));
    return false;
  }
}

// ── reading the app (accessibility service) ───────────────────────────────

// Native wait: JS timers can stall while the taxi app is in front.
const sleep = (ms) => Screen.sleep(ms);
// Behind a fully opaque cover the taxi apps stop loading (see behindCover).
const COVER_ALPHA = 0xff;
/** A line in the cover's task log. */
const step = (line) => Screen.coverLog(line);
const sum = (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} SUM`;
const log = (...a) => __DEV__ && console.log('[taxi]', ...a);

/**
 * What the taxi app shows: classes with prices, the addresses, the order
 * button. Polls until the prices appear (the app computes them after the
 * route loads) or `timeoutMs` runs out; null if they never do.
 */
async function readRide(service, { timeoutMs = 25000, signal } = {}) {
  const pkg = TAXI_SERVICES[service].package;
  const until = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < until) {
    signal?.throwIfAborted?.();
    const nodes = await Screen.dump(pkg);
    const ride = parseRide(service, nodes || []);
    log(`dump: ${nodes?.length} nodes, ${ride?.classes.length ?? 0} classes`);
    if (ride?.classes.some((c) => c.price)) {
      // Prices settle a moment after they first appear.
      if (last && sameRide(last, ride)) return ride;
      last = ride;
      await sleep(700);
    } else {
      last = null;
      await sleep(1000);
    }
  }
  return last;
}

const sameRide = (a, b) =>
  a.classes.map((c) => `${c.name}${c.price}`).join() ===
  b.classes.map((c) => `${c.name}${c.price}`).join();

/** A card cut off by the row's right edge: more classes lie beyond it. */
const moreToTheRight = (ride) => {
  const last = ride?.classes[ride.classes.length - 1];
  return !!(
    ride?.row &&
    last &&
    last.x + last.w >= ride.row.x + ride.row.w - 4
  );
};

/** Swipes the class row left (dir 1) or right (dir -1). */
const swipeRow = (row, dir) =>
  Screen.swipe(
    row.x + row.w * (dir > 0 ? 0.85 : 0.15),
    row.x + row.w * (dir > 0 ? 0.15 : 0.85),
    row.y + row.h / 2
  );

const readNow = async (service) =>
  parseRide(service, (await Screen.dump(TAXI_SERVICES[service].package)) || []);

/**
 * Swipes the row back to its start — until a swipe changes nothing, since
 * the first card's padding differs per app — and returns the ride there.
 */
async function toRowStart(service, ride) {
  let now = ride;
  for (let i = 0; now?.row && i < 4; i++) {
    await swipeRow(now.row, -1);
    await sleep(700);
    const next = await readNow(service);
    if (!next || sameRide(next, now)) break;
    now = next;
  }
  return now;
}

/**
 * Walks the class row from its start to its end — it only shows three or
 * four classes at a time — calling `visit(ride)` on each view until it
 * returns something truthy, which is returned with that view.
 */
async function walkRow(service, ride, visit) {
  let now = await toRowStart(service, ride);
  for (let i = 0; ; i++) {
    const found = visit(now);
    if (found || !moreToTheRight(now) || i >= 4) return { found, now };
    await swipeRow(now.row, 1);
    await sleep(900);
    const next = await readNow(service);
    if (!next || sameRide(next, now)) return { found: null, now };
    now = next;
  }
}

/** Every class the app offers, in the row's order. */
async function allClasses(service, ride) {
  const lists = [];
  await walkRow(service, ride, (r) => {
    lists.push(r.classes);
  });
  return mergeClasses(lists);
}

/**
 * Runs `work` in the taxi app behind JARVIS's cover screen, so the user
 * never sees the swiping: covers the screen, brings the app to the front
 * (or lets `open` do it), then returns to JARVIS. `work` returns
 * { result, showApp }; showApp leaves the app visible for the user.
 */
async function behindCover(service, text, work, open) {
  const pkg = TAXI_SERVICES[service].package;
  const name = TAXI_SERVICES[service].name;
  Screen.cover(text, name, COVER_ALPHA);
  let showApp = false;
  try {
    if (open) {
      step(`Sending route to ${name}`);
      const opened = await open();
      if (!opened) {
        showApp = true; // the Play Store page
        return { result: null, opened };
      }
    } else if (!Screen.onTop(pkg)) {
      step(`Resuming ${name}`);
      Screen.bringToFront(pkg);
    }
    for (let i = 0; i < 30 && !Screen.onTop(pkg); i++) await sleep(200);
    step(`Link established · ${name}`);
    const out = await work();
    showApp = !!out.showApp;
    return out;
  } finally {
    await sleep(700); // let the last log line be read
    if (!showApp) {
      Screen.bringToFront();
      await sleep(600);
    }
    Screen.uncover();
  }
}

/** The ride as JARVIS should hear it: no coordinates or pixels. */
const speakable = (ride, classes = ride.classes) => ({
  pickup: ride.pickup,
  destination: ride.destination,
  ...(ride.trip_time ? { trip_time: ride.trip_time } : {}),
  ...(ride.payment ? { payment: ride.payment } : {}),
  classes: classes.map(({ name, price, eta, selected, from }) => ({
    name,
    ...(from
      ? { price_from_sum: price, several_classes: true }
      : { price_sum: price }),
    ...(eta ? { car_in: eta } : {}),
    ...(selected ? { selected: true } : {}),
  })),
});

// The order waiting for the user's yes: { id, turn, at, service, name, price }.
// Like Telegram's delete-for-everyone, it can only be confirmed in the user's
// very next turn, and only if the screen still shows that class and price.
let pending = null;
let nextId = 1;
const CONFIRM_TTL_MS = 2 * 60 * 1000;

export function discardTaxiOrder() {
  pending = null;
}

function prepareOrder(service, ride, turn) {
  const chosen = ride.classes.find((c) => c.selected);
  if (!chosen?.price || !ride.order || chosen.from) {
    pending = null;
    return {
      next: 'Nothing can be ordered yet: no single class is selected in the app. Say the classes and prices and ask which one to order; then taxi_class.',
    };
  }
  pending = {
    id: String(nextId++),
    turn,
    at: Date.now(),
    service,
    name: chosen.name,
    price: chosen.price,
  };
  return {
    action_id: pending.id,
    next: `Not ordered yet. Say the class and price and ask «Заказать <class> за <price>?» (not «Заказываю»: nothing is ordered yet); call taxi_confirm only if the user's next reply says yes.`,
  };
}

/**
 * order_taxi: opens the app with the route; when the screen can be read,
 * waits for the prices and returns them with an order ready to confirm.
 */
export async function orderTaxi(args, { signal, turn } = {}) {
  const ride = await prepareTaxi(args, { signal });
  if (!ride.url) return { output: ride.output };
  if (!Screen.isEnabled()) {
    return {
      output: {
        ...ride.output,
        screen_reading: 'off',
        next: 'JARVIS cannot read prices or order: «JARVIS: taxi» is off in Accessibility settings. The user taps the order button; offer to open that setting (taxi_screen_setup).',
      },
      after: () => openTaxi(ride.url, ride.service),
    };
  }
  pending = null;
  log('opening', ride.url);
  const { result, opened } = await behindCover(
    ride.service,
    'Checking taxi prices…',
    async () => {
      step('Waiting for the fare engine');
      const shown = await readRide(ride.service, { signal });
      if (!shown) {
        step('No prices on screen');
        return { result: null, showApp: true };
      }
      if (shown.destination) step(`Route locked · ${shown.destination}`);
      step('Scanning service classes');
      const classes = await allClasses(ride.service, shown);
      const cheapest = Math.min(...classes.map((c) => c.price));
      step(`${classes.length} classes · from ${sum(cheapest)}`);
      return { result: { shown, classes } };
    },
    () => openTaxi(ride.url, ride.service)
  );
  if (opened === false) {
    return {
      output: {
        error: `${TAXI_SERVICES[ride.service].name} is not installed; its Play Store page is open.`,
      },
    };
  }
  if (!result) {
    return {
      output: {
        ...ride.output,
        status: 'opened',
        error:
          'The app is open but no prices appeared (maybe it needs login or an address). The user looks at the screen.',
      },
    };
  }
  return {
    output: {
      app: ride.output.app,
      status: 'showing_prices',
      ...speakable(result.shown, result.classes),
      ...prepareOrder(ride.service, result.shown, turn),
    },
  };
}

/** Lowercase, ё→е, no punctuation: «Комфорт+» and "comfort plus" compare. */
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\+/g, ' плюс ')
    .replace(/plus/g, 'плюс')
    .replace(/[^a-zа-я0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** taxi_class: taps the class the user named and reads its price back. */
export async function chooseTaxiClass(name, opts = {}) {
  if (!Screen.isEnabled()) return { error: 'Screen reading is off.' };
  const service = await preferredService(); // the app opened last
  const { result } = await behindCover(
    service,
    'Choosing the class…',
    async () => ({
      result: await selectClass(service, name, opts),
    })
  );
  return result;
}

async function selectClass(service, name, { signal, turn }) {
  const ride = await readRide(service, { timeoutMs: 5000, signal });
  if (!ride) return { error: 'No taxi prices on screen. Order a taxi first.' };
  const wanted = norm(name);
  const find = (r) =>
    r?.classes.find((c) => norm(c.name) === wanted) ||
    r?.classes.find((c) => norm(c.name).startsWith(wanted)) ||
    r?.classes.find((c) => norm(c.name).includes(wanted));
  let card = find(ride);
  if (!card) {
    const { found, now } = await walkRow(service, ride, find);
    card = found && now.classes.includes(found) ? found : null;
  }
  if (!card) {
    return {
      error: `No class «${name}» in the app.`,
      ...speakable(ride, await allClasses(service, ride)),
    };
  }
  if (!card.selected) {
    step(`Selecting ${card.name}`);
    await Screen.tap(card.x + card.w / 2, card.y + card.h / 2);
  }
  // The app takes a moment (WB over a second) to move the selection.
  const isCard = (c) => c?.selected && norm(c.name) === norm(card.name);
  let now = null;
  for (let i = 0; i < 12; i++) {
    signal?.throwIfAborted?.();
    await sleep(500);
    now = await readNow(service);
    if (now?.classes.some(isCard)) break;
  }
  // Settled: the price shown once the selection has moved.
  if (now?.classes.some(isCard)) {
    now = (await readRide(service, { timeoutMs: 5000, signal })) || now;
  }
  const chosen = now?.classes.find((c) => c.selected);
  if (!chosen || norm(chosen.name) !== norm(card.name)) {
    pending = null;
    return { error: `Could not select «${card.name}».` };
  }
  step(`${chosen.name} selected · ${sum(chosen.price)}`);
  return {
    status: 'selected',
    ...speakable(now),
    ...prepareOrder(service, now, turn),
  };
}

/**
 * taxi_confirm: presses «Заказать» / «Request Ride» — only in the turn
 * right after the price was read, and only if the screen still shows that
 * class at that price.
 */
export async function confirmTaxiOrder(actionId, { signal, turn } = {}) {
  const order = pending;
  if (!order || order.id !== String(actionId)) {
    return { error: 'No taxi order is waiting for confirmation.' };
  }
  if (turn === order.turn) {
    return {
      error:
        'Not confirmed yet. Say the class and price and wait for the user.',
    };
  }
  pending = null;
  if (turn !== order.turn + 1 || Date.now() - order.at > CONFIRM_TTL_MS) {
    return {
      error:
        'Expired: the user did not confirm right after hearing the price. Read the prices again (order_taxi) if they still want it.',
    };
  }
  const { result } = await behindCover(
    order.service,
    'Ordering the taxi…',
    async () => {
      const r = await pressOrder(order, { signal, turn });
      // Pressed: leave the app up so the user sees the car (or what the
      // app still needs).
      return { result: r, showApp: !!r.status };
    }
  );
  return result;
}

async function pressOrder(order, { signal, turn }) {
  step(`Verifying ${order.name} · ${sum(order.price)}`);
  // Back in front, the app needs a moment to show the order button again.
  let ride = null;
  for (let i = 0; i < 16 && !ride?.order; i++) {
    signal?.throwIfAborted?.();
    if (i) await sleep(500);
    ride = await readNow(order.service);
  }
  if (ride?.order) {
    ride = (await readRide(order.service, { timeoutMs: 5000, signal })) || ride;
  }
  // The selected card may be scrolled out of the row: find it.
  if (ride?.order && !ride.classes.some((c) => c.selected)) {
    ride = (
      await walkRow(order.service, ride, (r) =>
        r.classes.find((c) => c.selected)
      )
    ).now;
  }
  const chosen = ride?.classes.find((c) => c.selected);
  if (!chosen || !ride.order) {
    log(
      'confirm: screen not ready',
      JSON.stringify({
        classes: ride?.classes.map(
          (c) => `${c.name} ${c.price} ${c.w}${c.selected ? '*' : ''}`
        ),
        order: ride?.order,
      })
    );
    return { error: 'The taxi screen changed; nothing was ordered.' };
  }
  if (norm(chosen.name) !== norm(order.name) || chosen.price !== order.price) {
    return {
      error: 'The price changed; nothing was ordered.',
      ...speakable(ride),
      ...prepareOrder(order.service, ride, turn),
    };
  }
  const o = ride.order;
  step(`Pressing «${o.label}»`);
  if (!(await Screen.tap(o.x + o.w / 2, o.y + o.h / 2))) {
    return { error: 'Could not press the order button; nothing was ordered.' };
  }
  // The app takes a few seconds (WB over 2.5) to swap the button for the
  // ride screen.
  let after = null;
  for (let i = 0; i < 16; i++) {
    await sleep(600);
    after = await readNow(order.service);
    if (!after?.order) break;
  }
  step(after?.order ? 'App needs attention' : 'Order placed · finding a car');
  return {
    status: after?.order ? 'pressed_but_screen_unchanged' : 'ordered',
    class: order.name,
    price_sum: order.price,
    ...(after?.order
      ? {
          warning:
            'The order button is still on screen: the app may need something (payment, confirmation). The user should look.',
        }
      : {}),
  };
}

export function openScreenSettings() {
  return Screen.openSettings()
    ? {
        status: 'settings_open',
        next: 'Tell the user to turn on «JARVIS: taxi».',
      }
    : { error: 'Could not open the settings.' };
}
