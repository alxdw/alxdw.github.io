// Offline: generates a token/hash pair for ONE household. Does not edit the sheet.
// Keep output private: the URL grants access to that household's response/address.
import { randomBytes, createHash } from 'node:crypto';

const householdId = process.argv[2];
if (!/^H\d{4}$/.test(householdId || '')) {
  console.error('Usage: node wedding/tools/create-link.mjs H0001');
  process.exit(1);
}
const token = randomBytes(32).toString('base64url');
console.log(JSON.stringify({
  householdId,
  url: `https://w5y.me/wedding/save-the-date/?invite=${token}`,
  tokenHash: createHash('sha256').update(token).digest('hex'),
  issuedAt: new Date().toISOString(),
}, null, 2));
