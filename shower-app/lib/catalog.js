// Scrape the business website into a normalised product catalog.
// Strategy order: Shopify JSON → WooCommerce Store API → sitemap + JSON-LD/OpenGraph product pages.

import { fetchText } from './http.js';
import { normalizeProduct, stripHtml } from './extract.js';

const MAX_PAGES = 60; // product pages fetched in the generic strategy

export async function scrapeCatalog(siteUrl, log = () => {}) {
  const base = new URL(siteUrl);
  base.hash = '';
  const origin = base.origin;

  for (const [name, fn] of [['shopify', shopify], ['woocommerce', woocommerce], ['generic', generic]]) {
    try {
      const raw = await fn(origin, base.href, log);
      if (raw?.length) {
        const products = dedupe(raw.map(normalizeProduct)).filter((p) => p.images.length || p.url);
        if (products.length) return { source: name, origin, products };
      }
    } catch (e) {
      log(`${name} failed: ${e.message}`);
    }
  }
  return { source: 'none', origin, products: [] };
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

async function getJson(url) {
  const { res, text } = await fetchText(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  if (!/json/.test(res.headers.get('content-type') || '') && !/^\s*[[{]/.test(text)) throw new Error(`not json: ${url}`);
  return JSON.parse(text);
}

// ---------- Shopify ----------
async function shopify(origin) {
  const out = [];
  for (let page = 1; page <= 4; page++) {
    const data = await getJson(`${origin}/products.json?limit=250&page=${page}`);
    if (!Array.isArray(data.products) || !data.products.length) break;
    for (const p of data.products) {
      out.push({
        id: `shopify-${p.id}`,
        name: p.title,
        url: `${origin}/products/${p.handle}`,
        images: (p.images || []).map((i) => i.src),
        text: `${stripHtml(p.body_html)}\n${(p.tags || []).join(', ')}\n${p.product_type || ''}`,
        categories: p.product_type,
        attributes: (p.options || []).map((o) => ({ name: o.name, values: o.values || [] })),
        price: p.variants?.[0]?.price ? `₪${p.variants[0].price}` : null,
      });
    }
    if (data.products.length < 250) break;
  }
  return out;
}

// ---------- WooCommerce (Store API, public, no auth) ----------
async function woocommerce(origin) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    let data;
    try {
      data = await getJson(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
    } catch (e) {
      if (page === 1) data = await getJson(`${origin}/wp-json/wc/store/products?per_page=100&page=${page}`);
      else throw e;
    }
    if (!Array.isArray(data) || !data.length) break;
    for (const p of data) {
      const minor = p.prices?.currency_minor_unit ?? 2;
      out.push({
        id: `woo-${p.id}`,
        name: stripHtml(p.name),
        url: p.permalink,
        images: (p.images || []).map((i) => i.src),
        text: `${stripHtml(p.short_description)}\n${stripHtml(p.description)}`,
        categories: (p.categories || []).map((c) => c.name).join(' '),
        attributes: (p.attributes || []).map((a) => ({ name: a.name, values: (a.terms || []).map((t) => t.name) })),
        price: p.prices?.price ? `₪${(Number(p.prices.price) / 10 ** minor).toLocaleString('he-IL')}` : null,
      });
    }
    if (data.length < 100) break;
  }
  return out;
}

// ---------- Generic: sitemap / homepage links → product pages ----------
async function generic(origin, startUrl, log) {
  const urls = new Set();
  for (const sm of ['/product-sitemap.xml', '/sitemap.xml', '/sitemap_index.xml']) {
    try {
      await collectSitemap(`${origin}${sm}`, urls, 0);
      if (urls.size) break;
    } catch { /* try next */ }
  }
  if (!urls.size) {
    const { text } = await fetchText(startUrl);
    for (const m of text.matchAll(/href=["']([^"'#]+)["']/g)) {
      try {
        const u = new URL(m[1], startUrl);
        if (u.origin === origin) urls.add(u.href);
      } catch { /* ignore */ }
    }
  }
  const productish = [...urls].filter((u) => /product|מוצר|%d7%9e%d7%95%d7%a6%d7%a8|shower|מקלחון|%d7%9e%d7%a7%d7%9c%d7%97%d7%95%d7%9f/i.test(u));
  const candidates = (productish.length ? productish : [...urls]).slice(0, MAX_PAGES);
  log(`generic: ${candidates.length} candidate pages`);

  const out = [];
  const queue = [...candidates];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        const p = await parseProductPage(url);
        if (p) out.push(p);
      } catch { /* skip page */ }
    }
  }));
  return out;
}

async function collectSitemap(url, urls, depth) {
  const { res, text } = await fetchText(url);
  if (!res.ok) throw new Error(String(res.status));
  const locs = [...text.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([^<\]]+)/g)].map((m) => m[1].trim());
  if (/<sitemapindex/i.test(text) && depth < 2) {
    const children = locs.filter((l) => /product|מוצר/i.test(decodeURIComponent(l)));
    for (const c of (children.length ? children : locs).slice(0, 5)) await collectSitemap(c, urls, depth + 1);
  } else {
    locs.forEach((l) => urls.add(l));
  }
}

export async function parseProductPage(url) {
  const { res, text: html } = await fetchText(url);
  if (!res.ok || !/html/.test(res.headers.get('content-type') || 'html')) return null;

  let product = null;
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const found = findLdProduct(JSON.parse(m[1].trim()));
      if (found) { product = found; break; }
    } catch { /* bad json-ld */ }
  }
  const og = (prop) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)`, 'i'))?.[1];
  const ogType = og('og:type');
  if (!product && !/product/i.test(ogType || '')) return null;

  const images = [];
  const pushImg = (v) => {
    if (!v) return;
    if (Array.isArray(v)) return v.forEach(pushImg);
    const s = typeof v === 'string' ? v : v.url || v.contentUrl;
    if (s) images.push(new URL(s, url).href);
  };
  pushImg(product?.image);
  pushImg(og('og:image'));

  // Visible text of the main content, for dimension/thickness/finish extraction.
  const body = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html.match(/<body[\s\S]*<\/body>/i)?.[0] || html;
  const offers = Array.isArray(product?.offers) ? product.offers[0] : product?.offers;
  return {
    id: product?.sku || url,
    name: stripHtml(product?.name || og('og:title') || ''),
    url,
    images,
    text: `${stripHtml(product?.description || '')}\n${stripHtml(body).slice(0, 4000)}`,
    attributes: [],
    price: offers?.price ? `₪${offers.price}` : null,
  };
}

function findLdProduct(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) { const f = findLdProduct(n); if (f) return f; }
    return null;
  }
  const t = node['@type'];
  if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) return node;
  if (node['@graph']) return findLdProduct(node['@graph']);
  return null;
}
