// Shared helpers for the API functions (Web-standard Request/Response).

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function error(message, status = 400, extra = {}) {
  return json({ error: message, ...extra }, status);
}

/** Returns an error Response when the access code is configured and missing/wrong, else null. */
export function checkAccess(request) {
  const expected = process.env.APP_ACCESS_CODE;
  if (!expected) return null;
  const got = request.headers.get('x-access-code') || '';
  if (!timingSafeEqual(got, expected)) return error('קוד גישה שגוי', 401, { code: 'bad_access_code' });
  return null;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const UA = 'Mozilla/5.0 (compatible; ShowerVisualizerBot/0.1; catalog sync)';

/** fetch with timeout + byte cap. Returns {res, buf} or throws. */
export async function fetchLimited(url, { timeoutMs = 15000, maxBytes = 8 * 1024 * 1024, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': UA, ...headers } });
    const reader = res.body?.getReader();
    const chunks = [];
    let total = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { ctrl.abort(); throw new Error(`response too large: ${url}`); }
        chunks.push(value);
      }
    }
    return { res, buf: Buffer.concat(chunks) };
  } finally {
    clearTimeout(t);
  }
}

export async function fetchText(url, opts) {
  const { res, buf } = await fetchLimited(url, opts);
  return { res, text: buf.toString('utf8') };
}
