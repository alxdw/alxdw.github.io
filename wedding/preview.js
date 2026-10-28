// Loaded only on loopback hosts with ?preview=1. No real guest data or API writes.
let response = null;
export async function previewApi(path, body) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) throw new Error('Preview is local-only.');
  if (path === 'invitation') return {
    householdId: 'PREVIEW', greeting: 'FOR JAMIE & MORGAN',
    guests: [
      { id: 'preview-jamie', name: 'Jamie', plusOne: { id: 'preview-plus-one', name: '' } },
      { id: 'preview-morgan', name: 'Morgan', plusOne: null },
    ], response,
  };
  if (path === 'response') {
    await new Promise((resolve) => setTimeout(resolve, 450));
    response = body;
    return { saved: true };
  }
  throw new Error('Unknown preview action');
}
