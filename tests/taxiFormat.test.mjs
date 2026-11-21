import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  nearbyHit,
  storeLink,
  taxiLink,
  taxiService,
} from '../src/services/taxiFormat.js';

const home = { lat: '41.311100', long: '69.2797' };
const airport = { lat: 41.2579, long: 69.2812 };

test('service names in Russian and English', () => {
  for (const n of ['yandex', 'Yandex Go', 'Яндекс', 'яндекс такси', 'Yango'])
    assert.equal(taxiService(n), 'yandex', n);
  for (const n of ['wb', 'WB Taxi', 'вб', 'Вайлдберриз', 'wildberries'])
    assert.equal(taxiService(n), 'wb', n);
  for (const n of ['', null, 'uber', 'такси'])
    assert.equal(taxiService(n), null);
});

test('Yandex Go route link', () => {
  assert.equal(
    taxiLink('yandex', home, airport),
    'yandextaxi://route?start-lat=41.3111&start-lon=69.2797&end-lat=41.2579&end-lon=69.2812'
  );
  // No pickup: the app starts where the phone is.
  assert.equal(
    taxiLink('yandex', null, airport),
    'yandextaxi://route?end-lat=41.2579&end-lon=69.2812'
  );
  assert.equal(taxiLink('yandex', null, null), 'yandextaxi://route');
});

test('WB Taxi ride link', () => {
  assert.equal(
    taxiLink('wb', home, airport),
    'wb-taxi://ride?from=41.3111,69.2797&to=41.2579,69.2812'
  );
  assert.equal(
    taxiLink('wb', null, airport),
    'wb-taxi://ride?to=41.2579,69.2812'
  );
});

test('bad coordinates are left out, unknown service throws', () => {
  assert.equal(
    taxiLink('wb', { lat: 'x', long: '1' }, airport),
    'wb-taxi://ride?to=41.2579,69.2812'
  );
  assert.throws(() => taxiLink('uber', home, airport));
});

test('store fallback', () => {
  assert.equal(
    storeLink('wb'),
    'market://details?id=uz.wildberries.taxi.client'
  );
});

test('geocoder hits far from the user are skipped', () => {
  const tashkent = { lat: 41.3111, long: 69.2797 };
  // What the geocoder answers to «аэропорт» alone.
  const abroad = [
    { title: 'Саудовская Аравия, Медина, Аэропорт', lat: 24.54, long: 39.68 },
    { title: 'Россия, Москва, район Аэропорт', lat: 55.8, long: 37.54 },
  ];
  assert.equal(nearbyHit(abroad, tashkent), null);
  // «Ташкент, аэропорт»: the best match comes first, even if not the closest.
  const local = [
    {
      title: 'аэропорт Ташкент имени Ислама Каримова',
      lat: 41.2618,
      long: 69.2672,
    },
    { title: 'улица Аэропорт', lat: 41.3069, long: 69.3905 },
  ];
  assert.equal(nearbyHit([...abroad, ...local], tashkent), local[0]);
  assert.equal(nearbyHit([{ title: 'no coords' }], tashkent), null);
});
