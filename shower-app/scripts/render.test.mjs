// /api/render with the upstream model APIs stubbed (no network, no credits).
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { POST } from '../api/render.js';

const jpg = (await sharp({ create: { width: 300, height: 400, channels: 3, background: '#ccc' } }).jpeg().toBuffer()).toString('base64');
const png = (await sharp({ create: { width: 600, height: 800, channels: 3, background: '#39f' } }).png().toBuffer()).toString('base64');
const realFetch = globalThis.fetch;

function req(body, headers = {}) {
  return new Request('http://x/api/render', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
const body = { photo: jpg, guide: jpg, width: 1536, height: 2048, spec: { layout: 'fixed', finish: 'chrome' } };

test.afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'APP_ACCESS_CODE', 'DEFAULT_PROVIDER']) delete process.env[k];
});

test('mock mode without keys returns the sketch', async () => {
  const r = await (await POST(req(body))).json();
  assert.equal(r.mock, true);
  assert.match(r.prompt, /polished chrome/);
});

test('access code enforced', async () => {
  process.env.APP_ACCESS_CODE = 'secret';
  assert.equal((await POST(req(body))).status, 401);
  assert.equal((await POST(req(body, { 'x-access-code': 'secret' }))).status, 200);
});

test('gemini request shape + JPEG output', async () => {
  process.env.GEMINI_API_KEY = 'g-key';
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), init, body: JSON.parse(init.body) };
    return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } }] });
  };
  const res = await POST(req(body));
  const r = await res.json();
  assert.equal(res.status, 200, r.error);
  assert.match(seen.url, /gemini-3-pro-image-preview:generateContent$/);
  assert.equal(seen.init.headers['x-goog-api-key'], 'g-key');
  assert.deepEqual(seen.body.generationConfig.imageConfig, { aspectRatio: '3:4', imageSize: '2K' });
  assert.equal(seen.body.contents[0].parts.filter((p) => p.inline_data).length, 2);
  assert.match(r.image, /^data:image\/jpeg;base64,/);
  assert.equal(r.provider, 'gemini');
});

test('openai request shape', async () => {
  process.env.OPENAI_API_KEY = 'o-key';
  let form;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.openai.com/v1/images/edits');
    assert.equal(init.headers.authorization, 'Bearer o-key');
    form = init.body;
    return Response.json({ data: [{ b64_json: png }], output_format: 'png' });
  };
  const r = await (await POST(req({ ...body, provider: 'openai' }))).json();
  assert.equal(r.provider, 'openai');
  assert.equal(form.get('quality'), 'high');
  assert.equal(form.get('size'), '1024x1536');
  assert.equal(form.get('input_fidelity'), 'high');
  assert.equal(form.getAll('image[]').length, 2);
});

test('product image host must be allow-listed (SSRF guard)', async () => {
  process.env.GEMINI_API_KEY = 'g-key';
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } }] });
  };
  const r = await (await POST(req({ ...body, productImageUrl: 'http://169.254.169.254/latest/meta-data' }))).json();
  assert.equal(calls.length, 1); // only the model call
  assert.doesNotMatch(r.prompt, /Image 3/);
});

test('upstream error surfaces as 502 with message', async () => {
  process.env.GEMINI_API_KEY = 'g-key';
  globalThis.fetch = async () => Response.json({ error: { message: 'quota exceeded' } }, { status: 403 });
  const res = await POST(req(body));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /quota exceeded/);
});
