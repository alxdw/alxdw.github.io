import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, randomBytes } from 'node:crypto';
import { sha256, resolveInvitation, publicInvitation, validateReply, buildWrites } from '../logic.mjs';
import worker, { WeddingStoreCore as WeddingStore } from '../service.mjs';
import { Sheets } from '../sheets.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const token = randomBytes(32).toString('base64url');
const submissionId = '1b611344-cf71-400a-8ada-75f653ea74ee';
const address = { recipient: 'Jamie & Morgan', line1: '1 Test Lane', line2: '', city: 'Nottingham', region: '', postcode: 'NG1 1AA', country: 'United Kingdom' };
async function fixture() {
  return {
    guestSheetId: 0, responseSheetId: 22, responseRowCount: 1000,
    invites: [{ _row: 1, 'Household ID': 'H0001', 'Token hash': await sha256(token), Greeting: 'For Jamie & Morgan', 'Link revoked?': false }],
    guests: [
      { _row: 1, 'Guest ID': 'G1', 'Household ID': 'H0001', 'Display name': 'Jamie', 'Guest type': 'Named guest', 'Plus-one offered': 'Yes', Attendance: 'Not responded' },
      { _row: 2, 'Guest ID': 'G2', 'Household ID': 'H0001', 'Display name': 'Morgan', 'Guest type': 'Named guest', 'Plus-one offered': 'No', Attendance: 'Not responded' },
      { _row: 3, 'Guest ID': 'G3', 'Household ID': 'H0001', 'Display name': '', 'Guest type': 'Plus-one', 'Plus-one for guest ID': 'G1', Attendance: 'Not responded' },
      { _row: 4, 'Guest ID': 'OTHER', 'Household ID': 'H0002', 'Display name': 'Someone else', 'Guest type': 'Named guest', 'Plus-one offered': 'No' },
    ], responses: [],
  };
}
function yes(overrides = {}) { return { answer: 'yes', submissionId, guestIds: ['G1', 'G2'], plusOnes: [], address: { ...address }, ...overrides }; }
const no = () => ({ answer: 'no', submissionId, guestIds: [], plusOnes: [], address: null });
const request = (path, payload) => new Request(`https://rsvp.example/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://w5y.me' }, body: JSON.stringify({ invite: token, ...payload }) });

test('invitation exposes only that household, never hashes or other guests', async () => {
  const data = await fixture();
  const result = publicInvitation(await resolveInvitation(data, token));
  assert.equal(result.guests.length, 2);
  assert.equal(result.guests[0].plusOne.id, 'G3');
  assert.equal(result.guests[1].plusOne, null);
  assert.equal(result.response, null);
  assert.ok(!JSON.stringify(result).includes('Someone else'));
  assert.ok(!JSON.stringify(result).includes(await sha256(token)));
});

test('missing, forged and revoked tokens fail closed', async () => {
  const data = await fixture();
  for (const value of ['', 'a'.repeat(43), null]) await assert.rejects(resolveInvitation(data, value), { status: 401 });
  data.invites[0]['Link revoked?'] = true;
  await assert.rejects(resolveInvitation(data, token), { status: 401 });
});

test('unreviewed eligibility and duplicate guest/household IDs block access', async () => {
  for (const mutate of [
    (data) => { data.guests[0]['Plus-one offered'] = 'Needs review'; },
    (data) => { data.guests.push({ ...data.guests[0] }); },
    (data) => { data.invites.push({ ...data.invites[0], 'Token hash': 'other' }); },
    (data) => { data.guests[2]['Plus-one for guest ID'] = 'OTHER'; },
  ]) {
    const data = await fixture(); mutate(data);
    await assert.rejects(resolveInvitation(data, token), { status: 503 });
  }
});

test('an optional plus-one name is valid; partial named attendance is explicit', async () => {
  const group = await resolveInvitation(await fixture(), token);
  const partial = validateReply(group, yes({ guestIds: ['G1'], plusOnes: [{ id: 'G3', name: '' }] }));
  assert.equal(partial.summary, 'Partial');
  assert.equal(partial.plusOnes[0].name, '');
  assert.equal(validateReply(group, yes()).summary, 'Yes'); // unused plus-one is not a decline
});

test('cannot add another household, duplicate guests or an ineligible/absent-parent plus-one', async () => {
  const group = await resolveInvitation(await fixture(), token);
  for (const payload of [
    yes({ guestIds: ['OTHER'] }), yes({ guestIds: ['G1', 'G1'] }), yes({ guestIds: [] }),
    yes({ plusOnes: [{ id: 'OTHER', name: 'Extra' }] }),
    yes({ guestIds: ['G2'], plusOnes: [{ id: 'G3', name: 'Extra' }] }),
  ]) assert.throws(() => validateReply(group, payload), { status: 400 });
});

test('declines need no address; UK acceptance needs postcode; international postcode is optional', async () => {
  const group = await resolveInvitation(await fixture(), token);
  assert.equal(validateReply(group, no()).summary, 'No');
  assert.throws(() => validateReply(group, { ...no(), address }), { status: 400 });
  assert.throws(() => validateReply(group, yes({ address: { ...address, postcode: '' } })), { status: 400 });
  assert.equal(validateReply(group, yes({ address: { ...address, country: 'Ireland', postcode: '' } })).summary, 'Yes');
  assert.throws(() => validateReply(group, yes({ address: { ...address, line1: ' ' } })), { status: 400 });
});

test('atomic writes update only household rows; input resembling formulas stays literal text', async () => {
  const data = await fixture();
  const group = await resolveInvitation(data, token);
  const reply = validateReply(group, yes({ guestIds: ['G1'], plusOnes: [{ id: 'G3', name: '=IMPORTXML("example")' }] }));
  const writes = buildWrites(data, group, reply, '2026-10-28T12:00:00.000Z');
  assert.equal(writes.filter((entry) => entry.updateCells?.range.sheetId === 0).length, 4);
  assert.ok(!writes.some((entry) => entry.updateCells?.range.startRowIndex === 4));
  assert.equal(writes.find((entry) => entry.updateCells?.range.startColumnIndex === 11).updateCells.rows[0].values[0].userEnteredValue.stringValue, '=IMPORTXML("example")');
  assert.equal(writes.at(-1).updateCells.rows[0].values[1].userEnteredValue.stringValue, 'Partial');
});

test('response allocation skips existing rows and extends a full grid in the same batch', async () => {
  const data = await fixture();
  data.responses = [{ _row: 999, 'Household ID': 'H0002' }];
  const group = await resolveInvitation(data, token);
  const writes = buildWrites(data, group, validateReply(group, no()));
  assert.deepEqual(writes.at(-2), { appendDimension: { sheetId: 22, dimension: 'ROWS', length: 100 } });
  assert.equal(writes.at(-1).updateCells.range.startRowIndex, 1000);
});

test('returning guest gets saved selection/address; decline clears public address', async () => {
  const data = await fixture();
  data.guests[0].Attendance = 'Attending';
  data.responses = [{ _row: 1, 'Household ID': 'H0001', Response: 'Partial', 'Postal recipient': address.recipient, 'Address line 1': address.line1 }];
  let result = publicInvitation(await resolveInvitation(data, token));
  assert.deepEqual(result.response.guestIds, ['G1']);
  assert.equal(result.response.address.line1, address.line1);
  data.responses[0].Response = 'No';
  result = publicInvitation(await resolveInvitation(data, token));
  assert.equal(result.response.address, null);
});

test('coordinator serialises concurrent saves and deduplicates retries', async () => {
  const data = await fixture();
  const receipts = new Map();
  const store = new WeddingStore({ storage: { get: async (key) => receipts.get(key), put: async (key, value) => receipts.set(key, value) } }, {});
  let active = 0, peak = 0, writes = 0;
  store.sheets = {
    read: async () => { active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 5)); active--; return data; },
    write: async () => { writes++; },
  };
  const replies = await Promise.all([store.fetch(request('response', yes())), store.fetch(request('response', yes()))]);
  assert.deepEqual(replies.map((result) => result.status), [200, 200]);
  assert.equal(writes, 1);
  assert.equal(peak, 1);
  const changed = await store.fetch(request('response', yes({ guestIds: ['G1'] })));
  assert.equal(changed.status, 409);
});

test('write failure never produces a success receipt; private errors are not exposed', async () => {
  const data = await fixture();
  let receiptWrites = 0;
  const store = new WeddingStore({ storage: { get: async () => undefined, put: async () => { receiptWrites++; } } }, {});
  store.sheets = { read: async () => data, write: async () => { throw new Error('PRIVATE_TOKEN_AND_ADDRESS'); } };
  const response = await store.fetch(request('response', yes()));
  assert.equal(response.status, 503);
  assert.equal(receiptWrites, 0);
  assert.ok(!(await response.text()).includes('PRIVATE_TOKEN'));
});

test('CORS preflight is narrow; unknown origins, routes and oversized payloads are rejected', async () => {
  const env = { ALLOWED_ORIGINS: 'https://w5y.me' };
  const preflight = await worker.fetch(new Request('https://rsvp.example/response', { method: 'OPTIONS', headers: { Origin: 'https://w5y.me' } }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://w5y.me');
  const foreign = await worker.fetch(new Request('https://rsvp.example/response', { method: 'OPTIONS', headers: { Origin: 'https://elsewhere.example' } }), env);
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers.get('Access-Control-Allow-Origin'), null);
  const store = new WeddingStore({}, {});
  const oversized = await store.fetch(request('response', { padding: 'a'.repeat(17000) }));
  assert.equal(oversized.status, 413);
});

test('Google service-account JWT is signed correctly and access tokens are reused', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keys.privateKey);
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString('base64')}\n-----END PRIVATE KEY-----`;
  let calls = 0;
  const client = new Sheets({ GOOGLE_CLIENT_EMAIL: 'test@example.test', GOOGLE_PRIVATE_KEY: pem }, async (url, options) => {
    calls++;
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    const jwt = options.body.get('assertion');
    const [header, claims, signature] = jwt.split('.');
    assert.equal(JSON.parse(Buffer.from(claims, 'base64url')).scope, 'https://www.googleapis.com/auth/spreadsheets');
    assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', keys.publicKey, Buffer.from(signature, 'base64url'), new TextEncoder().encode(`${header}.${claims}`)), true);
    return Response.json({ access_token: 'test-access', expires_in: 3600 });
  });
  assert.equal(await client.token(), 'test-access');
  assert.equal(await client.token(), 'test-access');
  assert.equal(calls, 1);
});

test('Sheets adapter respects actual sheet IDs, bounded ranges and row offsets', async () => {
  const guestHeaders = ['Guest ID', 'Household ID', 'Display name', 'Guest type', 'Plus-one for guest ID', 'Plus-one offered', 'Attendance', 'Updated at', 'Setup notes'];
  const inviteHeaders = ['Household ID', 'Attendees', 'Greeting', 'Token hash', 'Link issued at', 'Link revoked?', 'Setup notes'];
  const responseHeaders = ['Household ID', 'Response', 'Postal recipient', 'Address line 1', 'Address line 2', 'Town / city', 'Region', 'Postcode', 'Country', 'Updated at', 'Submission ID'];
  const calls = [];
  const client = new Sheets({ SPREADSHEET_ID: 'test-sheet' }, async (url, options) => {
    calls.push({ url, options });
    if (url.includes(':batchUpdate')) return Response.json({ replies: [] });
    if (url.includes('/values:batchGet')) return Response.json({ valueRanges: [
      { values: [[...Array(9).fill('Legacy'), ...guestHeaders], [...Array(9).fill(''), 'G7', 'H0001', 'Jamie', 'Named guest', '', 'No', 'Not responded']] },
      { values: [inviteHeaders, ['H0001', 'Jamie', '', await sha256(token), '', false]] },
      { values: [responseHeaders] },
    ] });
    return Response.json({ sheets: ['Guests', 'Invites', 'Responses'].map((title, index) => ({ properties: { title, sheetId: index + 100, gridProperties: { rowCount: 123 } } })) });
  });
  client.accessToken = 'test-access'; client.expires = Date.now() + 60000;
  const data = await client.read();
  assert.equal(data.guestSheetId, 100);
  assert.equal(data.responseSheetId, 102);
  assert.equal(data.guests[0]._row, 1);
  assert.equal(data.guests[0]['Guest ID'], 'G7');
  assert.equal(data.invites[0]['Link revoked?'], false);
  assert.deepEqual(new URL(calls[1].url).searchParams.getAll('ranges'), ['Guests!A1:R123', 'Invites!A1:G123', 'Responses!A1:K123']);
  const group = await resolveInvitation(data, token);
  await client.write(buildWrites(data, group, validateReply(group, no())));
  const write = JSON.parse(calls[2].options.body);
  assert.equal(write.requests[0].updateCells.range.startRowIndex, 1);
  assert.equal(write.requests[0].updateCells.range.startColumnIndex, 15);
  assert.equal(write.requests.at(-1).updateCells.range.sheetId, 102);
});

test('Google fetch preserves the receiver required by the Worker runtime', async () => {
  const client = new Sheets({ SPREADSHEET_ID: 'test-sheet' }, async function () {
    assert.equal(this, globalThis);
    return Response.json({ ok: true });
  });
  client.accessToken = 'test-access'; client.expires = Date.now() + 60000;
  assert.deepEqual(await client.request('?fields=properties'), { ok: true });
});
