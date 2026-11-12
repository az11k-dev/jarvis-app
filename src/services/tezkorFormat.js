// Pure helpers for the Uzum Tezkor service: text matching, and turning raw
// API objects into the short summaries the model reads. No React Native
// imports, so `npm test` can run this file in plain Node.

const sum = (price) =>
  price && typeof price.value === 'number'
    ? Math.round(price.value / 100)
    : null;

export const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    // o'zbek, o‘zbek and oʻzbek are one word
    .replace(/['’‘ʻʼ`]/g, '');

const words = (s) =>
  normalize(s)
    .split(/[^a-zа-яўқғҳ0-9]+/)
    .filter(Boolean);

/**
 * Search keys for `query`. A long word becomes a prefix («бургеры» →
 * «бурге», so it finds «Бургер»); a short one keeps its length and allows
 * only a short ending («плов» finds «плова», «чай» does not find «чайхана»).
 */
export function stems(query) {
  return words(query)
    .filter((w) => w.length >= 3)
    .map((w) =>
      w.length <= 4
        ? { prefix: w, maxLength: w.length + (w.length === 3 ? 1 : 2) }
        : { prefix: w.slice(0, w.length - (w.length >= 7 ? 2 : 1)) }
    );
}

const hasKey = (textWords, key) =>
  textWords.some(
    (w) =>
      w.startsWith(key.prefix) && (!key.maxLength || w.length <= key.maxLength)
  );

/** How many of `keys` appear in `text` as whole words (by prefix). */
export function matchCount(text, keys) {
  if (!keys.length) return 0;
  const textWords = words(text);
  return keys.filter((k) => hasKey(textWords, k)).length;
}

export const matches = (text, keys) => matchCount(text, keys) > 0;

/**
 * Items matching the most keys: all of «пицца пепперони» when something has
 * both words, otherwise whatever has one of them.
 */
export function bestMatches(items, keys, textOf) {
  if (!keys.length) return [];
  let best = 0;
  const scored = items.map((item) => {
    const score = matchCount(textOf(item), keys);
    if (score > best) best = score;
    return { item, score };
  });
  return best ? scored.filter((s) => s.score === best).map((s) => s.item) : [];
}

export const shorten = (s, n) => {
  const t = String(s || '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const toMinutes = (utc, offsetSec) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(utc || ''));
  if (!m) return null;
  const local =
    Number(m[1]) * 60 + Number(m[2]) + Math.round((offsetSec || 0) / 60);
  return ((local % 1440) + 1440) % 1440;
};

// Vendor hours come as UTC ("07:30Z"); show them in the vendor's time zone.
export function localTime(utc, offsetSec) {
  const minutes = toMinutes(utc, offsetSec);
  if (minutes === null) return null;
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Whether a closed vendor opens later today or only tomorrow. */
export function opensDay(utc, offsetSec, now = Date.now()) {
  const opens = toMinutes(utc, offsetSec);
  if (opens === null) return null;
  const d = new Date(now + (offsetSec || 0) * 1000);
  const current = d.getUTCHours() * 60 + d.getUTCMinutes();
  return opens > current ? 'today' : 'tomorrow';
}

export function dish(p, { maxDescriptionChars = 100 } = {}) {
  return {
    // For open_tezkor: the site opens straight on this dish.
    product_id: p.id,
    name: p.name,
    price_sum: sum(p.price),
    // Shop products carry the size in the name; a second, often wrong, number
    // only confuses.
    ...(p.weight >= 20 && !/\d/.test(p.name || '')
      ? { weight_g: p.weight }
      : {}),
    ...(p.description
      ? { description: shorten(p.description, maxDescriptionChars) }
      : {}),
    // Sizes or add-ons chosen on the site can raise the price.
    ...(p.optionGroups?.length ? { has_options: true } : {}),
    ...(p.restriction?.stockQTY === 0 ? { sold_out: true } : {}),
  };
}

export function vendorSummary(v, { now = Date.now() } = {}) {
  const info = v.info || {};
  const offer = v.offer || {};
  const open = v.status === 'active';
  const brand = info.name || info.vendorName;
  const fee = v.receiving?.delivery?.price;
  const regularFee =
    fee &&
    typeof fee.originalValue === 'number' &&
    fee.originalValue > fee.value
      ? Math.round(fee.originalValue / 100)
      : null;
  return {
    vendor_id: info.id,
    name: brand,
    // "EVOS 024 (Боровский)": which branch delivers, not for reading aloud.
    ...(info.vendorName && info.vendorName !== brand
      ? { branch: info.vendorName }
      : {}),
    type: info.category === 'rte' ? 'restaurant' : 'shop',
    open,
    ...(open
      ? {}
      : {
          opens_at: localTime(v.schedule?.startTime, info.timeZoneOffset),
          opens_day: opensDay(v.schedule?.startTime, info.timeZoneOffset, now),
        }),
    rating: info.rating?.grade || null,
    distance_m: Number(info.distanceToClient) || null,
    delivery_minutes:
      offer.minDeliveryTime && offer.maxDeliveryTime
        ? `${offer.minDeliveryTime}-${offer.maxDeliveryTime}`
        : null,
    delivery_price_sum: sum(fee),
    // Set when the price above is a promotion (often for a first order).
    ...(regularFee ? { delivery_regular_price_sum: regularFee } : {}),
    min_order_sum: sum({ value: offer.minOrderAmount }),
    kitchens: v.kitchens || [],
  };
}

const vendorNameText = (info = {}) =>
  `${info.name || ''} ${info.vendorName || ''} ${String(info.keywords || '').replace(/,/g, ' ')}`;

/**
 * Search results as vendor summaries with their matching dishes. Open
 * places first, then a place the user named, then places with a matching
 * dish; otherwise Tezkor's own order.
 */
export function rankSearch(found, query, limits, opts) {
  const keys = stems(query);
  return found
    .map((item, rank) => {
      const products = item.products || [];
      const hits = bestMatches(products, keys, (p) => p.name);
      const nameMatch = matches(vendorNameText(item.vendor?.info), keys);
      return {
        rank,
        ...vendorSummary(item.vendor || {}, opts),
        ...(nameMatch ? { name_matches_query: true } : {}),
        dishes: (hits.length ? hits : products.slice(0, 2))
          .slice(0, limits.maxDishes)
          .map((p) => dish(p, limits)),
        dishes_match_query: hits.length > 0,
      };
    })
    .sort(
      (x, y) =>
        Number(y.open) - Number(x.open) ||
        Number(!!y.name_matches_query) - Number(!!x.name_matches_query) ||
        Number(y.dishes_match_query) - Number(x.dishes_match_query) ||
        x.rank - y.rank
    )
    .slice(0, limits.maxVendors)
    .map(({ rank, ...v }) => v);
}

/**
 * Dishes of one menu: those matching `query` (by name, description or
 * category), or without a query a few from every category in menu order.
 */
export function pickMenu(products, categories, query, limits) {
  const byId = new Map((categories || []).map((c) => [c.id, c]));
  const categoryOf = (p) => byId.get(p.categories?.[0]);
  const counts = new Map();
  for (const p of products) {
    const name = categoryOf(p)?.name;
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  }
  const ordered = [...byId.values()]
    .filter((c) => counts.has(c.name))
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const keys = stems(query);
  let picked;
  if (keys.length) {
    // By name first, then by category («напитки»), then by description.
    const fields = [
      (p) => p.name,
      (p) => categoryOf(p)?.name || '',
      (p) => p.description || '',
    ];
    const text = (p) => fields.map((f) => f(p)).join(' ');
    const where = (p) => {
      const i = fields.findIndex((f) => matches(f(p), keys));
      return i < 0 ? fields.length : i;
    };
    picked = bestMatches(products, keys, text).sort(
      (x, y) => where(x) - where(y)
    );
  } else {
    // Round-robin, so a 100-dish menu is not just its first category.
    const queues = ordered.map((c) =>
      products.filter((p) => categoryOf(p)?.id === c.id)
    );
    const loose = products.filter((p) => !categoryOf(p));
    if (loose.length) queues.push(loose);
    picked = [];
    for (let i = 0; picked.length < limits.maxMenuItems; i++) {
      const row = queues.map((q) => q[i]).filter(Boolean);
      if (!row.length) break;
      picked.push(...row);
    }
  }
  return {
    categories: ordered.map((c) => ({
      name: c.name,
      dishes: counts.get(c.name),
    })),
    total_dishes: products.length,
    ...(keys.length ? { matching: picked.length } : {}),
    dishes: picked.slice(0, limits.maxMenuItems).map((p) => ({
      ...dish(p, limits),
      category: categoryOf(p)?.name || null,
    })),
  };
}

/**
 * The geocoder hit to deliver to: the first one inside Tezkor's delivery
 * zone. `others` are further in-zone hits the user may have meant.
 */
export function pickAddress(hits) {
  const usable = (hits || []).filter((h) => h?.lat && h?.long);
  const inZone = usable.filter(
    (h) => !h.hints?.deliveryZone?.outOfDeliveryZone
  );
  const toAddress = (h) => ({
    title: h.details?.name || h.title,
    full_title: h.title,
    lat: String(h.lat),
    long: String(h.long),
    accuracy: h.accuracy,
  });
  return {
    chosen: inZone[0] ? toAddress(inZone[0]) : null,
    others: inZone.slice(1, 3).map((h) => h.title),
    outOfZone: !inZone.length && usable[0] ? usable[0].title : null,
  };
}

// What people say → what Tezkor calls the kitchen.
const KITCHEN_ALIASES = [
  [/узбек|национал|миллий|milliy|ozbek|uzbek/, 'Milliy Taom'],
  [/фастфуд|фаст фуд|fast ?food/, 'Бургеры'],
  [/ролл|япон/, 'Суши'],
  [/шаурм|донер/, 'Лаваш'],
  [/сладк|торт/, 'Десерты'],
  [/куриц|крыл/, 'Курочка'],
];

/** Ids of Tezkor's kitchen filters that `kitchen` names. */
export function findKitchenIds(kitchen, filters) {
  const text = normalize(kitchen);
  if (!text.trim()) return [];
  const aliased = KITCHEN_ALIASES.filter(([re]) => re.test(text)).map(
    ([, name]) => name
  );
  const keys = stems(text);
  return (filters || [])
    .filter(
      (f) =>
        aliased.includes(f.name) ||
        matches(f.name, keys) ||
        matches(text, stems(f.name))
    )
    .map((f) => String(f.id));
}

/** Vendors whose name or keywords match `query` (a place, not a kitchen). */
export const vendorsNamed = (vendors, query) => {
  const keys = stems(query);
  return vendors.filter((v) => matches(vendorNameText(v.info), keys));
};
