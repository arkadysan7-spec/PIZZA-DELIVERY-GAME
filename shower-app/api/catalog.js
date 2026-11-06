import { json } from '../lib/http.js';
import { scrapeCatalog } from '../lib/catalog.js';
import { DEMO_CATALOG } from '../lib/demo-catalog.js';

let memo = null; // warm-instance cache: { at, payload }
const TTL = 6 * 3600 * 1000;

export async function GET(request) {
  const url = new URL(request.url);
  const refresh = url.searchParams.has('refresh');
  const site = process.env.CATALOG_URL;
  const cdn = { 'cache-control': 'public, s-maxage=21600, stale-while-revalidate=86400' };

  if (!site) return json({ source: 'demo', products: DEMO_CATALOG, note: 'CATALOG_URL לא הוגדר – מוצג קטלוג הדגמה' }, 200, cdn);
  if (!refresh && memo && Date.now() - memo.at < TTL) return json(memo.payload, 200, cdn);

  const logs = [];
  try {
    const result = await scrapeCatalog(site, (m) => logs.push(m));
    if (!result.products.length) {
      return json({ source: 'demo', products: DEMO_CATALOG, note: 'לא נמצאו מוצרים באתר – מוצג קטלוג הדגמה', logs }, 200, { 'cache-control': 'no-store' });
    }
    const payload = { ...result, fetchedAt: new Date().toISOString() };
    memo = { at: Date.now(), payload };
    return json(payload, 200, refresh ? { 'cache-control': 'no-store' } : cdn);
  } catch (e) {
    return json({ source: 'demo', products: DEMO_CATALOG, note: `שגיאה בגריפה: ${e.message}`, logs }, 200, { 'cache-control': 'no-store' });
  }
}
