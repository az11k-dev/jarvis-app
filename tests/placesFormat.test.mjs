import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeLocation,
  distanceM,
  findPlace,
  nearestPlace,
  pickPlace,
  placeKey,
  publicPlace,
} from '../src/services/placesFormat.js';

test('home and work have many names', () => {
  for (const n of [
    'дом',
    'Домой',
    'мой дом',
    'home',
    'my home',
    'uyga',
    'на дом',
  ]) {
    assert.equal(placeKey(n), 'home', n);
  }
  for (const n of [
    'работа',
    'на работу',
    'офис',
    'Work',
    'the office',
    'ishxona',
  ]) {
    assert.equal(placeKey(n), 'work', n);
  }
});

test('other names are kept as said, lowercased', () => {
  assert.equal(placeKey(' «Дача» '), 'дача');
  assert.equal(placeKey('Ёлка'), 'елка');
  assert.equal(placeKey('дом мамы'), 'дом мамы');
  assert.equal(placeKey(''), '');
});

test('a place is found by any of its names', () => {
  const places = [{ key: 'home' }, { key: 'дача' }];
  assert.equal(findPlace(places, 'домой'), places[0]);
  assert.equal(findPlace(places, 'Дача'), places[1]);
  assert.equal(findPlace(places, 'работа'), null);
  assert.equal(findPlace(places, ''), null);
});

const hit = (title, outOfZone, extra = {}) => ({
  title,
  lat: 41.3,
  long: 69.2,
  accuracy: 'house',
  hints: { deliveryZone: { outOfDeliveryZone: outOfZone } },
  ...extra,
});

test('pickPlace prefers a hit Tezkor delivers to', () => {
  const p = pickPlace([hit('Far', true), hit('Near', false)]);
  assert.equal(p.full_title, 'Near');
  assert.equal(p.tezkor_delivers, true);
  assert.equal(p.lat, '41.3');
});

test('pickPlace keeps a place Tezkor does not deliver to', () => {
  const p = pickPlace([hit('Samarkand', true)]);
  assert.equal(p.full_title, 'Samarkand');
  assert.equal(p.tezkor_delivers, false);
});

test('pickPlace ignores hits without coordinates', () => {
  assert.equal(pickPlace([{ title: 'x' }]), null);
  assert.equal(pickPlace(undefined), null);
});

test('publicPlace shows the note only when there is one', () => {
  assert.deepEqual(publicPlace({ key: 'home', full_title: 'A', lat: '1' }), {
    name: 'home',
    address: 'A',
  });
  assert.equal(
    publicPlace({ key: 'w', full_title: 'B', note: 'этаж 3' }).note,
    'этаж 3'
  );
});

test('describeLocation builds a readable address', () => {
  assert.equal(
    describeLocation({
      street: 'Amir Temur',
      streetNumber: '1',
      city: 'Tashkent',
    }),
    'Amir Temur, 1, Tashkent'
  );
  assert.equal(
    describeLocation({ name: 'Park', region: 'Tashkent', city: null }),
    'Park, Tashkent'
  );
  assert.equal(
    describeLocation({
      name: '69WC+HRH',
      district: 'Bektemir',
      city: 'Tashkent',
    }),
    'Bektemir, Tashkent'
  );
  assert.equal(describeLocation({}), null);
  assert.equal(describeLocation(null), null);
});

test('distanceM measures metres between points', () => {
  assert.equal(distanceM(41.3, 69.2, 41.3, 69.2), 0);
  // 0.01° of latitude is about 1.11 km
  const d = distanceM(41.3, 69.2, 41.31, 69.2);
  assert.ok(d > 1100 && d < 1120, String(d));
});

test('nearestPlace picks the closest saved place', () => {
  const places = [
    { key: 'work', lat: '41.40', long: '69.20' },
    { key: 'home', lat: '41.30', long: '69.20' },
  ];
  const near = nearestPlace(places, 41.301, 69.2);
  assert.equal(near.name, 'home');
  assert.ok(near.distance_m < 150);
  assert.equal(nearestPlace([], 41.3, 69.2), null);
});
