export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function setup(message) { throw new HttpError(503, `Invitation setup needs attention: ${message}`); }
const truthy = (value) => value === true || String(value).toLowerCase() === 'true';

export async function resolveInvitation(data, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(401, 'Send us a WhatsApp for access.');
  const hash = await sha256(token);
  const matches = data.invites.filter((row) => row['Token hash'] === hash);
  if (!matches.length || truthy(matches[0]['Link revoked?'])) throw new HttpError(401, 'Send us a WhatsApp for access.');
  if (matches.length !== 1) setup('duplicate invitation token.');
  const invite = matches[0];
  const householdId = invite['Household ID'];
  if (!householdId || data.invites.filter((row) => row['Household ID'] === householdId).length !== 1) setup('household IDs must be unique.');
  const guests = data.guests.filter((row) => row['Household ID'] === householdId);
  if (!guests.length) setup('no guests assigned.');
  for (const guest of guests) {
    if (!guest['Guest ID'] || data.guests.filter((row) => row['Guest ID'] === guest['Guest ID']).length !== 1) setup('guest IDs must be unique.');
    if (!['Named guest', 'Plus-one'].includes(guest['Guest type'])) setup('guest type is missing.');
  }
  const named = guests.filter((row) => row['Guest type'] === 'Named guest');
  const extras = guests.filter((row) => row['Guest type'] === 'Plus-one');
  if (!named.length) setup('no named guests assigned.');
  for (const guest of named) {
    if (!String(guest['Display name'] || '').trim()) setup('guest display name is missing.');
    if (!['Yes', 'No'].includes(guest['Plus-one offered'])) setup('plus-one eligibility has not been reviewed.');
    const slots = extras.filter((row) => row['Plus-one for guest ID'] === guest['Guest ID']);
    if (slots.length > 1 || (guest['Plus-one offered'] === 'Yes' && slots.length !== 1)) setup('an offered plus-one needs exactly one guest slot.');
  }
  if (extras.some((row) => !named.some((guest) => guest['Guest ID'] === row['Plus-one for guest ID']))) setup('plus-one parent is missing.');
  const responses = data.responses.filter((row) => row['Household ID'] === householdId);
  if (responses.length > 1) setup('duplicate household responses.');
  return { invite, householdId, guests, named, extras, response: responses[0] || null };
}

export function publicInvitation(group) {
  const { householdId, invite, named, extras, response } = group;
  return {
    householdId,
    greeting: String(invite.Greeting || ''),
    guests: named.map((guest) => {
      const slot = extras.find((row) => row['Plus-one for guest ID'] === guest['Guest ID']);
      return { id: guest['Guest ID'], name: guest['Display name'], plusOne: guest['Plus-one offered'] === 'Yes' ? { id: slot['Guest ID'], name: slot['Display name'] || '' } : null };
    }),
    response: response && ['Yes', 'Partial', 'No'].includes(response.Response) ? {
      answer: response.Response === 'No' ? 'no' : 'yes',
      guestIds: named.filter((guest) => guest.Attendance === 'Attending').map((guest) => guest['Guest ID']),
      plusOnes: extras.filter((guest) => guest.Attendance === 'Attending').map((guest) => ({ id: guest['Guest ID'], name: guest['Display name'] || '' })),
      address: response.Response === 'No' ? null : {
        recipient: response['Postal recipient'] || '', line1: response['Address line 1'] || '',
        line2: response['Address line 2'] || '', city: response['Town / city'] || '', region: response.Region || '',
        postcode: response.Postcode || '', country: response.Country || '',
      },
    } : null,
  };
}

function text(value, max, label, required = false) {
  if (typeof value !== 'string') throw new HttpError(400, `Please check ${label}.`);
  const result = value.trim();
  if ((required && !result) || result.length > max || /[\u0000-\u001f\u007f]/.test(result)) throw new HttpError(400, `Please check ${label}.`);
  return result;
}

export function validateReply(group, input) {
  if (!['yes', 'no'].includes(input.answer)) throw new HttpError(400, 'Please choose your response.');
  if (typeof input.submissionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.submissionId)) throw new HttpError(400, 'Please try submitting your reply again.');
  if (!Array.isArray(input.guestIds) || !Array.isArray(input.plusOnes) || input.guestIds.length > group.named.length || input.plusOnes.length > group.extras.length) throw new HttpError(400, 'Please check your guest selection.');
  if (new Set(input.guestIds).size !== input.guestIds.length) throw new HttpError(400, 'Please check your guest selection.');
  if (input.answer === 'no') {
    if (input.guestIds.length || input.plusOnes.length || input.address !== null) throw new HttpError(400, 'A decline cannot include attending guests or an address.');
    return { submissionId: input.submissionId, answer: 'no', guestIds: [], plusOnes: [], address: null, summary: 'No' };
  }
  if (!input.guestIds.length || input.guestIds.some((id) => !group.named.some((guest) => guest['Guest ID'] === id))) throw new HttpError(400, 'Please select a guest on your invitation.');
  const plusOnes = input.plusOnes.map((person) => {
    if (!person || typeof person !== 'object') throw new HttpError(400, 'Please check your guest selection.');
    const slot = group.extras.find((guest) => guest['Guest ID'] === person.id);
    const parent = group.named.find((guest) => guest['Guest ID'] === slot?.['Plus-one for guest ID']);
    if (!parent || parent['Plus-one offered'] !== 'Yes' || !input.guestIds.includes(parent['Guest ID'])) throw new HttpError(400, 'That additional guest is not included on your invitation.');
    return { id: person.id, name: text(person.name, 100, 'your guest’s name') };
  });
  if (new Set(plusOnes.map((person) => person.id)).size !== plusOnes.length) throw new HttpError(400, 'Please check your additional guests.');
  if (!input.address || typeof input.address !== 'object') throw new HttpError(400, 'Please add your postal address.');
  const address = {};
  for (const [field, max, required] of [['recipient', 200, true], ['line1', 200, true], ['line2', 200, false], ['city', 100, true], ['region', 100, false], ['postcode', 30, false], ['country', 100, true]]) {
    address[field] = text(input.address[field], max, `your ${field === 'line1' ? 'address' : field}`, required);
  }
  if (/^(united kingdom|uk|gb|great britain)$/i.test(address.country) && !address.postcode) throw new HttpError(400, 'Please add your postcode.');
  return { submissionId: input.submissionId, answer: 'yes', guestIds: [...input.guestIds], plusOnes, address, summary: input.guestIds.length === group.named.length ? 'Yes' : 'Partial' };
}

export function buildWrites(data, group, reply, now = new Date().toISOString()) {
  const writes = [];
  for (const guest of group.guests) {
    const plus = reply.plusOnes.find((person) => person.id === guest['Guest ID']);
    const status = guest['Guest type'] === 'Plus-one'
      ? plus ? 'Attending' : 'Not attending'
      : reply.guestIds.includes(guest['Guest ID']) ? 'Attending' : 'Declined';
    writes.push(cellWrite(data.guestSheetId, guest._row, 15, [status, now]));
    // Preserve the last supplied plus-one name on declines. Blank is valid on acceptance.
    if (plus) writes.push(cellWrite(data.guestSheetId, guest._row, 11, [plus.name]));
  }
  const address = reply.address || {};
  const values = [group.householdId, reply.summary, address.recipient || '', address.line1 || '', address.line2 || '', address.city || '', address.region || '', address.postcode || '', address.country || '', now, reply.submissionId];
  let row = group.response?._row;
  if (row === undefined) {
    // Never overwrite an unrelated/incomplete existing response row.
    row = Math.max(1, ...data.responses.map((entry) => entry._row + 1));
    if (row >= data.responseRowCount) writes.push({ appendDimension: { sheetId: data.responseSheetId, dimension: 'ROWS', length: 100 } });
  }
  writes.push(cellWrite(data.responseSheetId, row, 0, values));
  return writes;
}

function cellWrite(sheetId, row, column, values) {
  return { updateCells: {
    range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: column, endColumnIndex: column + values.length },
    rows: [{ values: values.map((value) => ({ userEnteredValue: { stringValue: String(value) } })) }],
    fields: 'userEnteredValue',
  } };
}
