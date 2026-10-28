import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addressFromComponents } from '../address.mjs';
import { weddingEvent, createCalendarFile, googleCalendarUrl } from '../calendar.mjs';

const part = (type, longText, shortText) => ({ types: [type], longText, shortText });

test('UK postal town, county, building and flat are preserved', () => {
  const address = addressFromComponents([
    part('street_number', '10'), part('route', 'Test Road'), part('subpremise', 'Flat 2'), part('premise', 'Lake House'),
    part('postal_town', 'Nottingham'), part('locality', 'West Bridgford'), part('administrative_area_level_2', 'Nottinghamshire'),
    part('administrative_area_level_1', 'England'), part('postal_code', 'NG2 1AA'), part('country', 'United Kingdom', 'GB'),
  ]);
  assert.deepEqual(address, { line1: '10 Test Road', line2: 'Flat 2, Lake House', city: 'Nottingham', region: 'Nottinghamshire', postcode: 'NG2 1AA', country: 'United Kingdom' });
});

test('a named rural premise without a street number is retained', () => {
  const address = addressFromComponents([part('premise', 'Test Cottage'), part('postal_town', 'Test Town'), part('country', 'United Kingdom', 'GB')]);
  assert.equal(address.line1, 'Test Cottage');
  assert.equal(address.line2, '');
});

test('international state and extended postal codes map correctly', () => {
  const address = addressFromComponents([
    part('street_number', '123'), part('route', 'Test Street'), part('locality', 'Test City'),
    part('administrative_area_level_1', 'California'), part('postal_code', '90210'), part('postal_code_suffix', '1234'), part('country', 'United States', 'US'),
  ]);
  assert.equal(address.region, 'California'); assert.equal(address.postcode, '90210-1234');
});

test('international addresses without postcodes are allowed', () => {
  const address = addressFromComponents([part('route', 'Test Street'), part('locality', 'Hong Kong'), part('country', 'Hong Kong', 'HK')]);
  assert.equal(address.postcode, ''); assert.equal(address.city, 'Hong Kong');
});

test('postcode-only and empty predictions cannot replace entered address fields', () => {
  for (const components of [undefined, [], [part('postal_code', 'NG1 1AA'), part('country', 'United Kingdom', 'GB')]]) {
    assert.equal(addressFromComponents(components), null);
  }
});

test('calendar event is exactly one all-day September 11, without a timezone conversion', () => {
  const file = createCalendarFile();
  assert.ok(file.includes('DTSTART;VALUE=DATE:20270911\r\n'));
  assert.ok(file.includes('DTEND;VALUE=DATE:20270912\r\n'));
  assert.ok(!file.includes('TZID'));
  assert.ok(!file.includes('ATTENDEE'));
  assert.ok(!file.includes('invite='));
  assert.ok(file.includes(`UID:${weddingEvent.uid}\r\n`));
});

test('calendar uses CRLF and RFC 5545 UTF-8-safe line folding', () => {
  const file = createCalendarFile();
  assert.ok(!/(?<!\r)\n/.test(file));
  for (const line of file.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  const unfolded = file.replace(/\r\n /g, '');
  assert.ok(unfolded.includes(weddingEvent.description));
  assert.ok(!unfolded.includes('\uFFFD'));
});

test('Google Calendar has the same all-day date range and no invitation token', () => {
  const url = new URL(googleCalendarUrl());
  assert.equal(url.origin, 'https://calendar.google.com');
  assert.equal(url.searchParams.get('dates'), '20270911/20270912');
  assert.equal(url.searchParams.get('text'), weddingEvent.title);
  assert.equal(url.searchParams.get('text'), 'Save the Date: Becky & Alex');
  assert.equal(url.searchParams.get('location'), 'Nottinghamshire');
  assert.ok(!url.searchParams.has('invite'));
});

test('the downloadable calendar matches the event offered by the page', async () => {
  const file = await readFile(new URL('../assets/becky-alex-wedding.ics', import.meta.url), 'utf8');
  assert.equal(file, createCalendarFile());
});
