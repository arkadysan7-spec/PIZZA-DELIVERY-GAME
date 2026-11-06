// Bundles public/ into ONE self-contained HTML page that runs without the server (static demo).
// Used for a shareable preview link. Usage: node scripts/build-demo.mjs <out.html>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (f) => readFileSync(path.join(pub, f), 'utf8');
const out = process.argv[2] || 'demo.html';

const svgData = (f) => `data:image/svg+xml;base64,${Buffer.from(read(f)).toString('base64')}`;
const strip = (src) => src.replace(/^import .*$/gm, '').replace(/^export (?=const|function|async|let)/gm, '');
const catalog = strip(read('demo-catalog.js')).replace(/'demo\/([\w-]+\.svg)'/g, (_, f) => `'${svgData(`demo/${f}`)}'`);
const bundle = [catalog, strip(read('sketch.js')), strip(read('db.js')), strip(read('app.js'))].join('\n;\n');

const html = read('index.html');
const body = html.slice(html.indexOf('<header'), html.indexOf('<script type="module"'));
const page = `<title>הדמיית מקלחונים</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${read('styles.css')}
</style>
<script>window.__STATIC_DEMO = true;</script>
<div dir="rtl" lang="he">
${body}
</div>
<script type="module">
${bundle}
</script>
`;
writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
