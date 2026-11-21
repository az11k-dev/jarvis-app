/**
 * Reads a taxi app's screen from the accessibility dump (modules/jarvis-screen
 * `dump()`: nodes with text, desc, id and screen bounds). Pure, so the
 * parsers are tested on real dumps in tests/fixtures/taxi.
 *
 * parseRide(service, nodes) → null when no class is on screen, else
 * {
 *   classes: [{ name, price, eta, selected, x, y, w, h }],  // price in sum
 *   pickup, destination, trip_time, payment,                  // strings or null
 *   order: { label, price, x, y, w, h } | null,               // the order button
 *   row: { x, y, w, h } | null,                               // the class row
 * }
 * Off-screen classes are missing; the row can be swiped to reveal them.
 */

/** «65 000 сўм», "sum29,000", «29 000 сум» → 65000 / 29000; null if none. */
export function parsePrice(s) {
  const m =
    /(?:sum|сум|сўм)\s*(\d[\d\s,.  ]*\d|\d)/i.exec(s || '') ||
    /(\d[\d\s,.  ]*\d|\d)\s*(?:sum|сум|сўм)/i.exec(s || '');
  if (!m) return null;
  const n = Number(m[1].replace(/\D/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** «Pickup 8 min», «5 min», «Подача 7 мин» → "8 min" / "7 мин". */
const eta = (s) =>
  /(\d+)\s*(min|мин)/i
    .exec(s || '')
    ?.slice(1, 3)
    .join(' ');

const inside = (n, box) => {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  return (
    cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h
  );
};

const bounds = ({ x, y, w, h }) => ({ x, y, w, h });

/** The widest card, if it is clearly wider than the others. */
function widest(cards) {
  const sorted = [...cards].sort((a, b) => b.w - a.w);
  return sorted.length &&
    (sorted.length === 1 || sorted[0].w > sorted[1].w * 1.3)
    ? sorted[0]
    : null;
}

// ── WB Taxi (Citymobil): classic views with resource ids ─────────────────

function parseWb(nodes) {
  const byId = (id) => nodes.filter((n) => n.id === id);
  const first = (id, box) =>
    byId(id)
      .find((n) => !box || inside(n, box))
      ?.text?.trim() || null;

  const cards = byId('content_container').map((card) => ({
    card,
    name: first('caption', card),
    price: parsePrice(first('total_price', card)),
    cashback: !!first('cashback_count', card),
  }));
  // «Multi» (several classes at once) has no price of its own.
  const priced = cards.filter((c) => c.name && c.price);
  if (!priced.length) return null;

  // The selected card is the wide one with the cashback badge.
  const wide = widest(priced.map((c) => c.card));
  const chosen =
    priced.find((c) => c.cashback) || priced.find((c) => c.card === wide);
  const pickupBox = byId('pick_up_marker')[0];
  const dropBox = byId('drop_off_marker')[0];
  const pickupItem = byId('pick_up_address_item')[0];
  const dropItem = byId('drop_off_address_item')[0];
  const button = byId('main_button')[0];

  return {
    classes: priced.map((c) => ({
      name: c.name,
      price: c.price,
      eta: c === chosen && pickupBox ? first('subtitle', pickupBox) : null,
      selected: c === chosen,
      ...bounds(c.card),
    })),
    pickup: pickupItem ? first('address_label', pickupItem) : null,
    destination: dropItem ? first('address_label', dropItem) : null,
    trip_time: dropBox ? first('subtitle', dropBox) : null,
    payment: first('payment_label'),
    order: button
      ? { label: first('title', button), price: null, ...bounds(button) }
      : null,
    row: byId('tariffs_list')[0] ? bounds(byId('tariffs_list')[0]) : null,
  };
}

// ── Yandex Go: Compose, everything is in content descriptions ────────────

// «Start service class, High demand, discounted price: sum29,000 , regular
// price: sum36,000 , Pickup 8 min». The name is what comes before the
// first comma, minus the «service class» words.
const CLASS_WORDS = /\s*(service class|класс обслуживания|тариф)\s*$/i;
const ORDER = /^(request|order|заказать|вызвать)\b/i;

function parseYandex(nodes) {
  const classNodes = nodes.filter(
    (n) =>
      n.desc &&
      n.click &&
      parsePrice(n.desc) &&
      !ORDER.test(n.desc) &&
      CLASS_WORDS.test(n.desc.split(',')[0])
  );
  if (!classNodes.length) return null;

  const orderNode = nodes.find((n) => n.desc && ORDER.test(n.desc.trim()));
  const orderPrice = orderNode ? parsePrice(orderNode.desc) : null;
  const classes = classNodes.map((n) => ({
    name: n.desc.split(',')[0].replace(CLASS_WORDS, '').trim(),
    price: parsePrice(n.desc),
    eta: eta(n.desc.split(',').slice(1).join(',')) || null,
    // «Fastest … From sum31,500»: several classes at once, no single price.
    ...(/\b(from|от)\s*(sum|сум|сўм)?\s*\d/i.test(n.desc)
      ? { from: true }
      : {}),
    selected: false,
    ...bounds(n),
  }));
  // The order button repeats the selected class's price; the selected card
  // is also the wide one.
  const byPrice = classes.filter((c) => c.price === orderPrice);
  const chosen =
    byPrice.length === 1 ? byPrice[0] : widest(classes) || byPrice[0];
  if (chosen) chosen.selected = true;

  // The two address rows: full-width buttons whose description starts with
  // a comma («, Kokand Darvoza 34, », «, Terminal 2, Departures , • 28 min»).
  const rows = nodes.filter((n) => n.desc && /^\s*,/.test(n.desc) && n.w > 900);
  const address = (n) =>
    n?.desc
      .split('•')[0]
      .replace(/^[\s,]+|[\s,]+$/g, '')
      .replace(/\s+,/g, ',') || null;
  const payment = nodes.find((n) =>
    /^(change payment method|способ оплаты|изменить способ оплаты)/i.test(
      n.desc || ''
    )
  );
  const row = nodes.find(
    (n) => n.scroll && classNodes.some((c) => inside(c, n))
  );

  return {
    classes,
    pickup: address(rows[0]),
    destination: address(rows[1]),
    trip_time: eta(rows[1]?.desc.split('•')[1]) || null,
    payment: payment?.desc.split(',').slice(1).join(',').trim() || null,
    order: orderNode
      ? {
          label: orderNode.desc.split(',')[0].trim(),
          price: orderPrice,
          ...bounds(orderNode),
        }
      : null,
    row: row ? bounds(row) : null,
  };
}

// The apps write «5 min», «65 000 сўм» with non-breaking spaces.
const clean = (s) =>
  s == null ? s : String(s).replace(/[\u00a0\u2007\u202f]/g, ' ');

export function parseRide(service, nodes) {
  if (!Array.isArray(nodes) || !nodes.length) return null;
  const all = nodes.map((n) => ({
    ...n,
    text: clean(n.text),
    desc: clean(n.desc),
  }));
  if (service === 'wb') return parseWb(all);
  if (service === 'yandex') return parseYandex(all);
  return null;
}

/** Classes from several reads of a swiped row, by name, first seen wins. */
export function mergeClasses(lists) {
  const seen = new Map();
  for (const list of lists) {
    for (const c of list || []) if (!seen.has(c.name)) seen.set(c.name, c);
  }
  return [...seen.values()];
}
