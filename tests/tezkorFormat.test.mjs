import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bestMatches,
  dish,
  findKitchenIds,
  localTime,
  matches,
  opensDay,
  pickAddress,
  pickMenu,
  rankSearch,
  stems,
  vendorSummary,
} from '../src/services/tezkorFormat.js';

const LIMITS = { maxVendors: 6, maxDishes: 4, maxMenuItems: 6 };
const has = (text, query) => matches(text, stems(query));

test('a query word finds its other forms', () => {
  assert.ok(has('Плов Свадебный', 'плова'));
  assert.ok(has('Бургер с сыром', 'бургеры'));
  assert.ok(has('Кусочек пиццы', 'пицца'));
  assert.ok(has('Ёжик', 'ежик'));
  assert.ok(has('O‘zbegim', "o'zbegim"));
});

test('a query word does not match inside or at the start of another word', () => {
  assert.ok(!has('Чайхана', 'чай'));
  assert.ok(!has('Случай', 'чай'));
  assert.ok(!has('Сет Oshin', 'osh'));
  assert.ok(!has('Колбаса Oshpaz', 'osh'));
  assert.ok(!has('Кофе Lavazza Oro', 'lavash'));
  assert.ok(has('Osh Box', 'osh'));
});

test('words under three letters are ignored', () => {
  assert.deepEqual(stems('в и на'), []);
  assert.ok(!matches('anything', []));
});

test('bestMatches prefers items with every word', () => {
  const items = ['Пицца Пепперони', 'Пицца Барбекю', 'Суп'];
  assert.deepEqual(
    bestMatches(items, stems('пицца пепперони'), (x) => x),
    ['Пицца Пепперони']
  );
  assert.deepEqual(
    bestMatches(items, stems('пицца гавайская'), (x) => x),
    ['Пицца Пепперони', 'Пицца Барбекю']
  );
});

test('vendor hours are shown in the vendor time zone', () => {
  assert.equal(localTime('07:30Z', 18000), '12:30');
  assert.equal(localTime('21:00Z', 18000), '02:00');
  assert.equal(localTime('', 18000), null);
});

test('a closed vendor opens today or tomorrow', () => {
  const at = (hhmm) => Date.parse(`2026-11-11T${hhmm}:00Z`);
  // opens 12:00 local (UTC+5)
  assert.equal(opensDay('07:00Z', 18000, at('03:00')), 'today'); // 08:00 local
  assert.equal(opensDay('07:00Z', 18000, at('14:00')), 'tomorrow'); // 19:00 local
});

const vendor = (over = {}) => ({
  status: 'active',
  info: {
    id: 'v1',
    name: 'EVOS',
    vendorName: 'EVOS 024 (Боровский)',
    category: 'rte',
    timeZoneOffset: 18000,
    distanceToClient: '801',
    rating: { grade: '4.6' },
    ...over.info,
  },
  offer: { minDeliveryTime: 40, maxDeliveryTime: 55, minOrderAmount: 2000000 },
  receiving: { delivery: { price: { value: 0, originalValue: 320200 } } },
  schedule: { startTime: '04:00Z' },
  kitchens: ['Лаваш'],
  ...over,
});

test('vendor summary: brand name, branch, promotional delivery price', () => {
  const v = vendorSummary(vendor());
  assert.equal(v.name, 'EVOS');
  assert.equal(v.branch, 'EVOS 024 (Боровский)');
  assert.equal(v.delivery_price_sum, 0);
  assert.equal(v.delivery_regular_price_sum, 3202);
  assert.equal(v.min_order_sum, 20000);
  assert.equal(v.delivery_minutes, '40-55');
  assert.equal(v.open, true);
  assert.ok(!('opens_at' in v));
});

test('vendor summary: really free delivery has no regular price', () => {
  const v = vendorSummary(
    vendor({ receiving: { delivery: { price: { value: 0 } } } })
  );
  assert.equal(v.delivery_price_sum, 0);
  assert.ok(!('delivery_regular_price_sum' in v));
});

test('vendor summary: a closed vendor says when it opens', () => {
  const v = vendorSummary(vendor({ status: 'close' }), {
    now: Date.parse('2026-11-11T14:00:00Z'),
  });
  assert.equal(v.open, false);
  assert.equal(v.opens_at, '09:00');
  assert.equal(v.opens_day, 'tomorrow');
});

test('dish: price in sum, options, no weight when the name has the size', () => {
  const d = dish({
    id: 'p1',
    name: 'Лаваш',
    price: { value: 3100000 },
    weight: 253,
    optionGroups: [{}],
  });
  assert.deepEqual(d, {
    product_id: 'p1',
    name: 'Лаваш',
    price_sum: 31000,
    weight_g: 253,
    has_options: true,
  });
  assert.ok(
    !(
      'weight_g' in
      dish({ name: 'Молоко 1 л', price: { value: 1 }, weight: 1000 })
    )
  );
});

test('search: open first, then the named place, then matching dishes', () => {
  const item = (id, name, status, products) => ({
    vendor: vendor({ status, info: { id, name, vendorName: name } }),
    products: products.map((n) => ({ name: n, price: { value: 100 } })),
  });
  const found = [
    item('a', 'Oshin Sushi', 'active', ['Сет Oshin']),
    item('b', 'Closed Osh', 'close', ['Osh']),
    item('c', 'Salt shop', 'active', ['Соль Osh Tuzi']),
    item('d', 'Osh Markazi', 'active', ['Салат']),
  ];
  const out = rankSearch(found, 'osh', LIMITS);
  assert.deepEqual(
    out.map((v) => v.vendor_id),
    ['d', 'c', 'a', 'b']
  );
  assert.equal(out[0].name_matches_query, true);
  assert.equal(out[0].dishes_match_query, false);
  assert.equal(out[2].dishes_match_query, false); // «Oshin» is not «osh»
});

const CATEGORIES = [
  { id: 'c2', name: 'Напитки', order: 20 },
  { id: 'c1', name: 'Лаваши', order: 10 },
  { id: 'c3', name: 'Пусто', order: 30 },
];
const PRODUCTS = [
  { name: 'Лаваш M', categories: ['c1'], price: { value: 100 } },
  { name: 'Лаваш L', categories: ['c1'], price: { value: 100 } },
  { name: 'Pepsi', categories: ['c2'], price: { value: 100 } },
  {
    name: 'Комбо',
    description: 'Лаваш и напиток',
    categories: ['c1'],
    price: { value: 100 },
  },
];

test('menu overview takes dishes from every category in menu order', () => {
  const m = pickMenu(PRODUCTS, CATEGORIES, '', { maxMenuItems: 3 });
  assert.deepEqual(m.categories, [
    { name: 'Лаваши', dishes: 3 },
    { name: 'Напитки', dishes: 1 },
  ]);
  assert.deepEqual(
    m.dishes.map((d) => d.name),
    ['Лаваш M', 'Pepsi', 'Лаваш L']
  );
  assert.equal(m.total_dishes, 4);
});

test('menu query matches the category and lists name matches first', () => {
  const drinks = pickMenu(PRODUCTS, CATEGORIES, 'напитки', LIMITS);
  assert.deepEqual(
    drinks.dishes.map((d) => d.name),
    ['Pepsi', 'Комбо']
  );
  const lavash = pickMenu(PRODUCTS, CATEGORIES, 'лаваш', LIMITS);
  assert.equal(lavash.matching, 3);
  assert.equal(lavash.dishes[2].name, 'Комбо');
});

test('address: the first hit inside the delivery zone wins', () => {
  const hit = (title, out) => ({
    title,
    lat: '41.3',
    long: '69.2',
    accuracy: 'precise',
    details: { name: title },
    ...(out ? { hints: { deliveryZone: { outOfDeliveryZone: true } } } : {}),
  });
  const mixed = pickAddress([hit('far', true), hit('near'), hit('near 2')]);
  assert.equal(mixed.chosen.full_title, 'near');
  assert.deepEqual(mixed.others, ['near 2']);
  const none = pickAddress([hit('Москва', true)]);
  assert.equal(none.chosen, null);
  assert.equal(none.outOfZone, 'Москва');
  assert.deepEqual(pickAddress([]), {
    chosen: null,
    others: [],
    outOfZone: null,
  });
});

test('kitchen names and what people call them', () => {
  const filters = [
    { id: '42', name: 'Milliy Taom' },
    { id: '33', name: 'Бургеры' },
    { id: '36', name: 'Суши' },
  ];
  assert.deepEqual(findKitchenIds('что-нибудь узбекское', filters), ['42']);
  assert.deepEqual(findKitchenIds('бургер', filters), ['33']);
  assert.deepEqual(findKitchenIds('роллы', filters), ['36']);
  assert.deepEqual(findKitchenIds('KFC', filters), []);
  assert.deepEqual(findKitchenIds('', filters), []);
});
