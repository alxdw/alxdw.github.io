import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash, randomUUID, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const require = createRequire(import.meta.url);

test('compiled Worker saves, reloads, retries and declines against an isolated Sheets fixture', { timeout: 60000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'wedding-runtime-'));
  const build = join(temporary, 'build');
  let runtime;
  try {
    const wrangler = resolve(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js');
    await promisify(execFile)(process.execPath, [wrangler, 'deploy', '--dry-run', '--outdir', build, '--config', fileURLToPath(new URL('../wrangler.toml', import.meta.url))], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(temporary, 'logs'), XDG_CONFIG_HOME: join(temporary, 'config') },
    });
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    const guestHeaders = ['Guest ID', 'Household ID', 'Display name', 'Guest type', 'Plus-one for guest ID', 'Plus-one offered', 'Attendance', 'Updated at', 'Setup notes'];
    const inviteHeaders = ['Household ID', 'Attendees', 'Greeting', 'Token hash', 'Link issued at', 'Link revoked?', 'Setup notes'];
    const responseHeaders = ['Household ID', 'Response', 'Postal recipient', 'Address line 1', 'Address line 2', 'Town / city', 'Region', 'Postcode', 'Country', 'Updated at', 'Submission ID'];
    const legacy = () => Array(9).fill('');
    const tables = {
      Guests: [[...legacy(), ...guestHeaders],
        [...legacy(), 'G1', 'H0001', 'Jamie', 'Named guest', '', 'Yes', 'Not responded', '', ''],
        [...legacy(), 'G2', 'H0001', 'Morgan', 'Named guest', '', 'No', 'Not responded', '', ''],
        [...legacy(), 'G3', 'H0001', '', 'Plus-one', 'G1', 'Needs review', 'Not responded', '', '']],
      Invites: [inviteHeaders, ['H0001', 'Jamie & Morgan', 'For Jamie & Morgan', hash, '', false, '']],
      Responses: [responseHeaders],
    };
    const sheetIds = { Guests: 100, Invites: 101, Responses: 102 };
    let writes = 0;
    let failNextWrite = false;
    const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    const compiledPath = resolve(build, 'worker.js');
    runtime = new Miniflare(convertV4MiniflareOptions({
      name: 'wedding-fixture', rootPath: build, modulesRoot: build, logRequests: false,
      modules: [{ type: 'ESModule', path: compiledPath, contents: await readFile(compiledPath, 'utf8') }],
      compatibilityDate: '2026-10-28',
      durableObjects: { RSVP_STORE: { className: 'WeddingStore', useSQLite: true } },
      bindings: { SPREADSHEET_ID: 'fixture-only', ALLOWED_ORIGINS: 'https://w5y.me', GOOGLE_CLIENT_EMAIL: 'fixture@example.test', GOOGLE_PRIVATE_KEY: privateKey },
      // No network access to Google or any real guest list is possible in this fixture.
      outboundService: async (request) => {
        const url = new URL(request.url);
        if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'fixture-access', expires_in: 3600 });
        assert.equal(url.hostname, 'sheets.googleapis.com');
        assert.ok(url.pathname.includes('/fixture-only'));
        if (url.pathname.endsWith('/values:batchGet')) return Response.json({ valueRanges: url.searchParams.getAll('ranges').map((range) => ({ range, values: tables[range.split('!')[0]] })) });
        if (url.pathname.endsWith(':batchUpdate')) {
          if (failNextWrite) { failNextWrite = false; return Response.json({ error: 'fixture failure' }, { status: 503 }); }
          const requests = (await request.json()).requests;
          const next = structuredClone(tables);
          for (const { updateCells: write } of requests) {
            assert.ok(write);
            const name = Object.keys(sheetIds).find((name) => sheetIds[name] === write.range.sheetId);
            for (let i = 0; i < write.rows.length; i++) {
              const row = write.range.startRowIndex + i;
              next[name][row] ||= [];
              for (let j = 0; j < write.rows[i].values.length; j++) next[name][row][write.range.startColumnIndex + j] = write.rows[i].values[j].userEnteredValue.stringValue;
            }
          }
          Object.assign(tables, next); writes++;
          return Response.json({ replies: requests.map(() => ({})) });
        }
        return Response.json({ sheets: Object.entries(sheetIds).map(([title, sheetId]) => ({ properties: { title, sheetId, gridProperties: { rowCount: 1000 } } })) });
      },
    }));
    const call = async (path, payload) => {
      const response = await runtime.dispatchFetch(`https://fixture.example/${path}`, { method: 'POST', headers: { Origin: 'https://w5y.me', 'Content-Type': 'application/json' }, body: JSON.stringify({ invite: token, ...payload }) });
      return { status: response.status, body: await response.json() };
    };
    const initial = await call('invitation', {});
    assert.equal(initial.status, 200); assert.equal(initial.body.guests.length, 2);
    assert.equal((await call('invitation', { invite: 'A'.repeat(43) })).status, 401);
    const reply = { submissionId: randomUUID(), answer: 'yes', guestIds: ['G1'], plusOnes: [{ id: 'G3', name: '' }], address: { recipient: 'Jamie', line1: '1 Test Lane', line2: '', city: 'Nottingham', region: '', postcode: 'NG1 1AA', country: 'United Kingdom' } };
    assert.equal((await call('response', reply)).body.saved, true);
    assert.equal(tables.Responses[1][1], 'Partial');
    assert.equal(tables.Guests[1][15], 'Attending'); assert.equal(tables.Guests[2][15], 'Declined'); assert.equal(tables.Guests[3][15], 'Attending');
    assert.equal((await call('response', reply)).body.saved, true); assert.equal(writes, 1);
    const returning = await call('invitation', {});
    assert.equal(returning.body.response.address.line1, '1 Test Lane'); assert.equal(returning.body.response.plusOnes[0].name, '');
    failNextWrite = true;
    const decline = { submissionId: randomUUID(), answer: 'no', guestIds: [], plusOnes: [], address: null };
    assert.equal((await call('response', decline)).status, 503); assert.equal(writes, 1);
    assert.equal((await call('response', decline)).body.saved, true); assert.equal(writes, 2);
    assert.equal(tables.Responses[1][1], 'No'); assert.equal(tables.Responses[1][3], '');
    assert.equal((await call('invitation', {})).body.response.address, null);
  } finally {
    await runtime?.dispose();
    await rm(temporary, { recursive: true, force: true });
  }
});
