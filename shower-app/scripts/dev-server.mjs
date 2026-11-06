// Local dev server mimicking Vercel: static files from /public, Web-handler functions from /api.
// Usage: node scripts/dev-server.mjs  (reads .env.local / .env if present)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['.env.local', '.env']) {
  const p = path.join(root, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const port = Number(process.env.PORT) || 3000;

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const file = path.join(root, 'api', `${url.pathname.slice(5).replace(/[^a-z0-9-]/gi, '')}.js`);
      if (!existsSync(file)) return send(res, 404, 'not found');
      const mod = await import(pathToFileURL(file).href);
      const handler = mod[req.method];
      if (!handler) return send(res, 405, 'method not allowed');
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      return res.end(Buffer.from(await response.arrayBuffer()));
    }
    let file = path.join(root, 'public', decodeURIComponent(url.pathname));
    if (!file.startsWith(path.join(root, 'public'))) return send(res, 403, 'forbidden');
    if ((await stat(file).catch(() => null))?.isDirectory()) file = path.join(file, 'index.html');
    const body = await readFile(file).catch(() => null);
    if (!body) return send(res, 404, 'not found');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    console.error(e);
    send(res, 500, String(e.message));
  }
}).listen(port, () => console.log(`http://localhost:${port}`));

function send(res, status, text) { res.writeHead(status, { 'content-type': 'text/plain' }); res.end(text); }
