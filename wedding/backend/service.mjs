import { Sheets } from './sheets.mjs';
import { HttpError, sha256, resolveInvitation, publicInvitation, validateReply, buildWrites } from './logic.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

async function body(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'Please send a JSON request.');
  if (!request.body) throw new HttpError(400, 'Please check your reply.');
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 16384) { await reader.cancel(); throw new HttpError(413, 'Your reply is too long.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.length; });
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(400, 'Please check your reply.'); }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || 'https://w5y.me').split(',').map((value) => value.trim());
    // CORS is a browser boundary; the high-entropy token is the actual authorisation.
    if (!origin || !allowed.includes(origin)) return json({ error: 'Origin not allowed.' }, 403);
    let response;
    const path = new URL(request.url).pathname;
    if (!['/invitation', '/response'].includes(path)) response = json({ error: 'Not found.' }, 404);
    else if (request.method === 'OPTIONS') response = new Response(null, { status: 204 });
    else if (request.method !== 'POST') response = json({ error: 'Method not allowed.' }, 405);
    else {
      try {
        // One durable coordinator serialises sheet reads/writes across all isolates.
        const id = env.RSVP_STORE.idFromName('wedding-sheet');
        response = await env.RSVP_STORE.get(id).fetch(request);
      } catch {
        console.error(JSON.stringify({ event: 'rsvp_coordinator_unavailable', status: 503 }));
        response = json({ error: 'The invitation service is temporarily unavailable. Please try again.' }, 503);
      }
    }
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Vary', 'Origin');
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
  },
};

export class WeddingStoreCore {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.sheets = new Sheets(env);
    this.queue = Promise.resolve();
  }

  fetch(request) {
    const job = this.queue.then(() => this.handle(request));
    this.queue = job.catch(() => {});
    return job;
  }

  async handle(request) {
    try {
      const input = await body(request);
      if (typeof input.invite !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.invite)) throw new HttpError(401, 'Send us a WhatsApp for access.');
      const data = await this.sheets.read();
      const group = await resolveInvitation(data, input.invite);
      if (new URL(request.url).pathname === '/invitation') return json(publicInvitation(group));
      const reply = validateReply(group, input);
      const fingerprint = await sha256(JSON.stringify(reply));
      const receiptKey = `receipt:${reply.submissionId}`;
      const receipt = await this.ctx.storage.get(receiptKey);
      if (receipt) {
        if (receipt.householdId !== group.householdId || receipt.fingerprint !== fingerprint) throw new HttpError(409, 'This reply has changed. Please submit it again.');
        return json({ saved: true });
      }
      if (group.response?.['Submission ID'] !== reply.submissionId) await this.sheets.write(buildWrites(data, group, reply));
      await this.ctx.storage.put(receiptKey, { householdId: group.householdId, fingerprint });
      return json({ saved: true });
    } catch (problem) {
      // Do not log tokens, addresses, guest names, Google responses or credentials.
      const status = problem instanceof HttpError ? problem.status : 503;
      if (status >= 500) console.error(JSON.stringify({ event: 'rsvp_service_error', status }));
      const message = problem instanceof HttpError && !problem.message.startsWith('Invitation setup') ? problem.message
        : 'We’re checking the details of your invitation. Please send us a WhatsApp or try again later.';
      return json({ error: message }, status);
    }
  }
}
