import { json, error, checkAccess, fetchLimited } from '../lib/http.js';
import { normalizeSpec, buildPrompt } from '../lib/prompt.js';
import { availableProviders, renderWith } from '../lib/providers.js';
import { toJpeg, uploadPublic } from '../lib/media.js';

const MAX_B64 = 3_000_000; // per image, keeps the request under Vercel's 4.5MB body limit

export async function POST(request) {
  const denied = checkAccess(request);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return error('בקשה לא תקינה'); }
  const { photo, guide, productImageUrl, width, height } = body || {};
  if (!isB64(photo) || !isB64(guide)) return error('חסרה תמונה');
  if (photo.length > MAX_B64 || guide.length > MAX_B64) return error('התמונה גדולה מדי', 413);
  const w = Number(width) || 1536, h = Number(height) || 2048;

  const spec = normalizeSpec(body.spec);
  const images = [{ mime: 'image/jpeg', data: photo }, { mime: 'image/jpeg', data: guide }];
  let productImage = null;
  if (productImageUrl) {
    productImage = await loadProductImage(productImageUrl).catch((e) => { console.warn('product image skipped:', e.message); return null; });
    if (productImage) images.push(productImage);
  }
  const prompt = buildPrompt(spec, { hasProductImage: Boolean(productImage) });

  const providers = availableProviders();
  if (!providers.length) {
    // Demo mode: no API key configured. Echo the sketch so the UI flow can be tested end to end.
    return json({ image: `data:image/jpeg;base64,${guide}`, provider: 'mock', model: 'mock', prompt, mock: true });
  }
  const providerId = providers.some((p) => p.id === body.provider) ? body.provider
    : providers.find((p) => p.id === process.env.DEFAULT_PROVIDER)?.id || providers[0].id;

  let out;
  try {
    out = await renderWith(providerId, { prompt, images, width: w, height: h });
  } catch (e) {
    console.error(e);
    return error(e.message || 'שגיאה ביצירת ההדמיה', e.status || 502);
  }

  let buf = Buffer.from(out.data, 'base64');
  let mime = out.mime;
  const jpg = await toJpeg(buf, { quality: 90 });
  if (jpg) { buf = jpg; mime = 'image/jpeg'; }
  const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
  const url = await uploadPublic(`renders/shower-${Date.now()}.${ext}`, buf, mime);

  return json({
    image: `data:${mime};base64,${buf.toString('base64')}`,
    url,
    provider: providerId,
    model: out.model,
    prompt,
  });
}

function isB64(s) {
  return typeof s === 'string' && s.length > 100 && /^[A-Za-z0-9+/=]+$/.test(s.slice(0, 200));
}

function allowedHosts() {
  const hosts = new Set(['cdn.shopify.com']);
  if (process.env.CATALOG_URL) {
    const h = new URL(process.env.CATALOG_URL).hostname;
    hosts.add(h);
    hosts.add(h.replace(/^www\./, ''));
    hosts.add(`www.${h.replace(/^www\./, '')}`);
  }
  for (const h of (process.env.ALLOWED_IMAGE_HOSTS || '').split(',')) if (h.trim()) hosts.add(h.trim().toLowerCase());
  return hosts;
}

async function loadProductImage(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('bad protocol');
  if (!allowedHosts().has(u.hostname.toLowerCase())) throw new Error(`host not allowed: ${u.hostname}`);
  const { res, buf } = await fetchLimited(u.href, { maxBytes: 10 * 1024 * 1024, timeoutMs: 12000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = (res.headers.get('content-type') || '').split(';')[0];
  if (!/^image\/(jpeg|png|webp|avif|gif)$/.test(type)) throw new Error(`unsupported type ${type}`);
  const jpg = await toJpeg(buf, { quality: 85, maxSide: 1024 });
  if (jpg) return { mime: 'image/jpeg', data: jpg.toString('base64') };
  if (/^image\/(jpeg|png|webp)$/.test(type)) return { mime: type, data: buf.toString('base64') };
  throw new Error('cannot convert image');
}
