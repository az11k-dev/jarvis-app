import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  mergeClasses,
  parsePrice,
  parseRide,
} from '../src/services/taxiScreen.js';

// Real accessibility dumps from the phone (2026-11-21), route home → TAS.
const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/taxi/${name}.json`, import.meta.url))
  );
const brief = (ride) =>
  ride.classes.map((c) => `${c.name} ${c.price}${c.selected ? ' *' : ''}`);

test('prices in sum, any spacing', () => {
  assert.equal(parsePrice('65 000 сўм'), 65000);
  assert.equal(parsePrice('32,000 sum'), 32000);
  assert.equal(
    parsePrice('discounted price: sum29,000 , regular price: sum36,000'),
    29000
  );
  assert.equal(parsePrice('29 000 сум'), 29000);
  assert.equal(parsePrice('Pickup 5 min'), null);
  assert.equal(parsePrice(null), null);
});

test('WB Taxi: classes, the selected one, addresses, order button', () => {
  const ride = parseRide('wb', fixture('wb-standard'));
  assert.deepEqual(brief(ride), [
    'Standard 65000 *',
    'Comfort 73000',
    'Comfort + 77500',
  ]);
  assert.equal(ride.classes[0].eta, '5 min');
  assert.equal(ride.pickup, 'Мусаффо Маскан жилой комплекс 36');
  assert.equal(
    ride.destination,
    'Ташкент, международный аэропорт им. Ислама Каримова'
  );
  assert.equal(ride.trip_time, '27 min');
  assert.equal(ride.payment, '•••• 6758');
  assert.equal(ride.order.label, 'Request Ride');
  assert.deepEqual({ x: ride.order.x, y: ride.order.y }, { x: 63, y: 2190 });
  assert.equal(ride.row.w, 1080);
});

test('WB Taxi: another class selected', () => {
  const ride = parseRide('wb', fixture('wb-comfort'));
  assert.deepEqual(brief(ride), [
    'Standard 65000',
    'Comfort 73000 *',
    'Comfort + 77500',
  ]);
});

test('Yandex Go: classes from descriptions, discounted price', () => {
  const ride = parseRide('yandex', fixture('yandex-start'));
  assert.deepEqual(brief(ride), [
    'Carpool 22000',
    'Start 29000 *',
    'Comfort 32000',
    'Comfort+ 43000',
  ]);
  assert.equal(ride.classes[1].eta, '8 min');
  assert.equal(ride.pickup, 'Kokand Darvoza 34');
  assert.equal(ride.destination, 'Terminal 2, Departures');
  assert.equal(ride.trip_time, '28 min');
  assert.equal(ride.payment, 'Cash');
  assert.equal(ride.order.label, 'Request');
  assert.equal(ride.order.price, 29000);
  assert.ok(ride.row, 'the class row is found');
});

test('Yandex Go: Comfort selected, a class half off-screen', () => {
  const ride = parseRide('yandex', fixture('yandex-comfort'));
  assert.deepEqual(brief(ride), [
    'Carpool 22000',
    'Start 29000',
    'Comfort 32000 *',
    'Comfort+ 43000',
    'Electric 52500',
  ]);
});

test('nothing to read', () => {
  assert.equal(parseRide('yandex', []), null);
  assert.equal(
    parseRide('wb', [{ text: 'Loading', x: 0, y: 0, w: 1, h: 1 }]),
    null
  );
  assert.equal(parseRide('uber', fixture('wb-standard')), null);
});

test('merging swiped reads keeps the first sighting', () => {
  const a = [
    { name: 'Start', price: 1 },
    { name: 'Comfort', price: 2 },
  ];
  const b = [
    { name: 'Comfort', price: 9 },
    { name: 'Business', price: 3 },
  ];
  assert.deepEqual(
    mergeClasses([a, b]).map((c) => `${c.name}${c.price}`),
    ['Start1', 'Comfort2', 'Business3']
  );
});

test('Yandex Go: «Fastest» spans several classes and blocks ordering', () => {
  const card = (desc, x, w) => ({ desc, click: true, x, y: 1963, w, h: 226 });
  const ride = parseRide('yandex', [
    card('Business service class, 58,000 sum, Pickup 11 min', 217, 226),
    card('Fastest service class, From sum31,500 , Pickup 2 min', 736, 302),
    {
      desc: 'Select at least two service classes',
      x: 168,
      y: 2232,
      w: 744,
      h: 147,
    },
  ]);
  assert.deepEqual(
    ride.classes.map((c) => [c.name, c.price, !!c.from, c.selected]),
    [
      ['Business', 58000, false, false],
      ['Fastest', 31500, true, true],
    ]
  );
  assert.equal(ride.order, null);
});
