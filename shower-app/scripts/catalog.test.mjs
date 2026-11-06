// Scraper tests against local fixture sites (WooCommerce Store API, generic sitemap + JSON-LD).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { scrapeCatalog } from '../lib/catalog.js';

function serve(routes) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      const r = routes[url.pathname];
      if (!r) { res.writeHead(404); return res.end('nope'); }
      res.writeHead(200, { 'content-type': r.type });
      res.end(typeof r.body === 'function' ? r.body(url) : r.body);
    }).listen(0, '127.0.0.1', () => resolve({ srv, origin: `http://127.0.0.1:${srv.address().port}` }));
  });
}

test('WooCommerce Store API', async () => {
  const products = [{
    id: 11, name: 'מקלחון חזית לנישה &#8211; דגם אורן', permalink: 'https://shop/p/oren',
    images: [{ src: 'https://shop/img/oren.jpg' }],
    short_description: '<p>זכוכית מחוסמת 8 מ"מ, רוחב 100-160 ס"מ, גובה 195 ס"מ</p>',
    description: '', categories: [{ name: 'מקלחונים לנישה' }],
    attributes: [{ name: 'גימור', terms: [{ name: 'שחור מט' }, { name: 'כרום' }, { name: 'ניקל' }] }],
    prices: { price: '249000', currency_minor_unit: 2 },
  }];
  const { srv, origin } = await serve({ '/wp-json/wc/store/v1/products': { type: 'application/json', body: JSON.stringify(products) } });
  try {
    const r = await scrapeCatalog(origin);
    assert.equal(r.source, 'woocommerce');
    const p = r.products[0];
    assert.equal(p.name, 'מקלחון חזית לנישה – דגם אורן');
    assert.equal(p.type, 'niche');
    assert.deepEqual(p.glassThicknessMm, [8]);
    assert.deepEqual(p.finishes, ['black_matte', 'chrome', 'nickel']);
    assert.deepEqual(p.dimensions.widthCm, { min: 100, max: 160 });
    assert.equal(p.dimensions.heightCm.max, 195);
    assert.match(p.price, /2,490|2490/);
  } finally { srv.close(); }
});

test('generic site: sitemap + JSON-LD product pages', async () => {
  let origin;
  const page = (name, extra) => `<!doctype html><html><head>
    <meta property="og:type" content="product"><meta property="og:image" content="/img/${name}.jpg">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"Product","name":"${name}","image":["/img/${name}-1.jpg"],"description":"${extra}","offers":{"price":"1890"}}]}</script>
    </head><body><main><h1>${name}</h1><p>${extra}</p></main></body></html>`;
  const { srv, origin: o } = await serve({
    '/sitemap.xml': { type: 'application/xml', body: () => `<urlset><url><loc>${origin}/product/walkin-black</loc></url><url><loc>${origin}/product/corner-90</loc></url><url><loc>${origin}/about</loc></url></urlset>` },
    '/product/walkin-black': { type: 'text/html', body: page('מחיצת Walk-in שחורה', 'מחיצה קבועה, זכוכית 10 מ״מ, פרופיל שחור מט, 120X200') },
    '/product/corner-90': { type: 'text/html', body: page('מקלחון פינתי 90', 'מקלחון פינתי 90x90x190, עובי זכוכית 6 מ"מ, כרום') },
  });
  origin = o;
  try {
    const r = await scrapeCatalog(origin);
    assert.equal(r.source, 'generic');
    assert.equal(r.products.length, 2);
    const w = r.products.find((p) => p.type === 'walkin');
    assert.deepEqual(w.glassThicknessMm, [10]);
    assert.deepEqual(w.finishes, ['black_matte']);
    assert.equal(w.dimensions.heightCm.max, 200);
    assert.ok(w.images[0].endsWith('-1.jpg'));
    const c = r.products.find((p) => p.type === 'corner');
    assert.deepEqual(c.glassThicknessMm, [6]);
    assert.deepEqual(c.finishes, ['chrome']);
    assert.deepEqual(c.dimensions.widthCm, { min: 90, max: 90 });
  } finally { srv.close(); }
});
