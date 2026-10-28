import { DurableObject } from 'cloudflare:workers';
import handler, { WeddingStoreCore } from './service.mjs';

export default handler;

// Keep Cloudflare's runtime adapter separate from the portable, tested service.
export class WeddingStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.service = new WeddingStoreCore(ctx, env);
  }

  fetch(request) { return this.service.fetch(request); }
}
