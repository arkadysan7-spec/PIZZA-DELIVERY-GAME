import { json } from '../lib/http.js';
import { availableProviders } from '../lib/providers.js';
import { blobEnabled } from '../lib/media.js';

export function GET() {
  const providers = availableProviders();
  const def = providers.find((p) => p.id === process.env.DEFAULT_PROVIDER)?.id || providers[0]?.id || 'mock';
  return json({
    accessCodeRequired: Boolean(process.env.APP_ACCESS_CODE),
    providers,
    defaultProvider: def,
    mock: providers.length === 0,
    cloudLinks: blobEnabled(),
    catalogConfigured: Boolean(process.env.CATALOG_URL),
  }, 200, { 'cache-control': 'no-store' });
}
