import { HttpError } from './logic.mjs';

const headers = {
  Guests: ['Guest ID', 'Household ID', 'Display name', 'Guest type', 'Plus-one for guest ID', 'Plus-one offered', 'Attendance', 'Updated at', 'Setup notes'],
  Invites: ['Household ID', 'Attendees', 'Greeting', 'Token hash', 'Link issued at', 'Link revoked?', 'Setup notes'],
  Responses: ['Household ID', 'Response', 'Postal recipient', 'Address line 1', 'Address line 2', 'Town / city', 'Region', 'Postcode', 'Country', 'Updated at', 'Submission ID'],
};

const encode = (value) => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const encodeJson = (value) => encode(new TextEncoder().encode(JSON.stringify(value)));

export class Sheets {
  constructor(env, fetcher = fetch) {
    this.env = env;
    // workerd's global fetch requires its global receiver, unlike Node's fetch.
    this.fetcher = fetcher.bind(globalThis);
    this.accessToken = null;
    this.expires = 0;
  }

  async token() {
    if (this.accessToken && Date.now() < this.expires) return this.accessToken;
    const { GOOGLE_CLIENT_EMAIL: email, GOOGLE_PRIVATE_KEY: privateKey } = this.env;
    if (!email || !privateKey) throw new HttpError(503, 'The invitation service isn’t ready yet. Please send us a WhatsApp.');
    const pem = privateKey.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
    const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${encodeJson({ alg: 'RS256', typ: 'JWT' })}.${encodeJson({ iss: email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
    const response = await this.fetcher('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${encode(signature)}` }), signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new HttpError(503, 'The invitation service is temporarily unavailable. Please try again.');
    const result = await response.json();
    if (!result.access_token) throw new HttpError(503, 'The invitation service is temporarily unavailable.');
    this.accessToken = result.access_token;
    this.expires = Date.now() + (result.expires_in - 120) * 1000;
    return this.accessToken;
  }

  async request(path, options = {}) {
    const response = await this.fetcher(`https://sheets.googleapis.com/v4/spreadsheets/${this.env.SPREADSHEET_ID}${path}`, {
      ...options, headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(12000),
    });
    if (response.status === 401) { this.accessToken = null; this.expires = 0; }
    if (!response.ok) throw new HttpError(503, 'We couldn’t reach the guest list. Please try again.');
    return response.json();
  }

  async read() {
    const metadata = await this.request('?fields=sheets(properties(sheetId,title,gridProperties(rowCount)))');
    const sheets = Object.fromEntries(metadata.sheets.map((sheet) => [sheet.properties.title, sheet.properties]));
    if (Object.keys(headers).some((title) => !sheets[title])) throw new HttpError(503, 'The guest-list tabs need checking.');
    const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE' });
    for (const [title, end] of [['Guests', 'R'], ['Invites', 'G'], ['Responses', 'K']]) params.append('ranges', `${title}!A1:${end}${sheets[title].gridProperties.rowCount}`);
    const result = await this.request(`/values:batchGet?${params}`);
    const tables = {};
    Object.keys(headers).forEach((title, index) => {
      const values = result.valueRanges[index]?.values || [];
      const offset = title === 'Guests' ? 9 : 0;
      if (headers[title].some((header, column) => values[0]?.[offset + column] !== header)) throw new HttpError(503, 'The guest-list columns need checking.');
      tables[title] = values.slice(1).map((row, rowIndex) => ({ _row: rowIndex + 1, ...Object.fromEntries(headers[title].map((header, column) => [header, row[offset + column] ?? ''])) })).filter((row) => headers[title].some((header) => row[header] !== '' && row[header] !== false));
    });
    return { guests: tables.Guests, invites: tables.Invites, responses: tables.Responses, guestSheetId: sheets.Guests.sheetId, responseSheetId: sheets.Responses.sheetId, responseRowCount: sheets.Responses.gridProperties.rowCount };
  }

  async write(requests) {
    // One atomic Sheets batch: guest statuses, optional names, household response/address.
    await this.request(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) });
  }
}
