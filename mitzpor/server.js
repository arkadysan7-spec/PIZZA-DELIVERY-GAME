// שרת ליל המצפור. בלי תלויות: Node 22 בלבד.
// הדפדפן שולח הצעת WebRTC (SDP) + הקשר, השרת מצרף את ההנחיות הסודיות ואת המפתח ומעביר ל-OpenAI.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildInstructions, TOOLS } = require('./lib/prompt');

// טעינת .env פשוטה, אם קיים
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const CFG = {
  port: Number(process.env.PORT) || 3000,
  apiKey: process.env.OPENAI_API_KEY || '',
  model: process.env.REALTIME_MODEL || 'gpt-realtime',
  voice: process.env.VOICE || 'marin',
  speed: Number(process.env.VOICE_SPEED) || 1.08,
  transcribeModel: process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
  callSeconds: Number(process.env.CALL_SECONDS) || 60,
  // כולל זמן צלצול (החיבור נפתח כבר בזמן שהטלפון מצלצל)
  hardLimitSeconds: Number(process.env.HARD_LIMIT_SECONDS) || 150,
  maxConcurrent: Number(process.env.MAX_CONCURRENT) || 40,
  perIpPer10Min: Number(process.env.CALLS_PER_IP_PER_10MIN) || 6,
  logCalls: process.env.LOG_CALLS === '1',
  vad: process.env.VAD || 'server', // server | semantic
};

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const EVENT_FILE = path.join(__dirname, 'event.json');

function loadEvent() {
  // נקרא מחדש בכל שיחה, כך שאפשר לעדכן פרטי אירוע בלי להפעיל מחדש
  try { return JSON.parse(fs.readFileSync(EVENT_FILE, 'utf8')); }
  catch (e) { console.error('event.json לא תקין:', e.message); return { title: 'ליל המצפור', presenter: 'OBSESSION' }; }
}

// ---------- הגבלות ----------
const activeCalls = new Map(); // callId -> { timer, started }
const ipHits = new Map();      // ip -> [timestamps]

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  return (xf ? String(xf).split(',')[0] : req.socket.remoteAddress || '').trim();
}

function rateLimited(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if (hits.length >= CFG.perIpPer10Min) { ipHits.set(ip, hits); return true; }
  hits.push(now);
  ipHits.set(ip, hits);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of ipHits) if (!hits.some(t => now - t < 10 * 60 * 1000)) ipHits.delete(ip);
}, 60 * 1000).unref();

// ---------- OpenAI ----------
function sessionConfig(instructions, minimal) {
  const turn = CFG.vad === 'semantic'
    ? { type: 'semantic_vad', eagerness: 'high', create_response: true, interrupt_response: true }
    : { type: 'server_vad', threshold: 0.55, prefix_padding_ms: 300, silence_duration_ms: 550, create_response: true, interrupt_response: true };
  const s = {
    type: 'realtime',
    model: CFG.model,
    instructions,
    tools: TOOLS,
    tool_choice: 'auto',
    audio: {
      input: { turn_detection: turn },
      output: { voice: CFG.voice },
    },
  };
  if (!minimal) {
    s.audio.input.noise_reduction = { type: 'near_field' };
    s.audio.input.transcription = { model: CFG.transcribeModel, language: 'he' };
    s.audio.output.speed = CFG.speed;
  }
  return s;
}

async function openCall(sdp, instructions, minimal) {
  const fd = new FormData();
  fd.set('sdp', sdp);
  fd.set('session', JSON.stringify(sessionConfig(instructions, minimal)));
  const r = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    headers: { Authorization: `Bearer ${CFG.apiKey}` },
    body: fd,
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, text, location: r.headers.get('location') || '' };
}

async function hangup(callId, why) {
  const c = activeCalls.get(callId);
  if (!c) return;
  clearTimeout(c.timer);
  activeCalls.delete(callId);
  console.log(`[call ${callId.slice(-8)}] end (${why}) after ${Math.round((Date.now() - c.started) / 1000)}s, active=${activeCalls.size}`);
  try {
    await fetch(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(callId)}/hangup`, {
      method: 'POST', headers: { Authorization: `Bearer ${CFG.apiKey}` },
    });
  } catch (e) { /* השיחה כבר סגורה בצד השני – לא נורא */ }
}

// ---------- HTTP ----------
function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit = 200 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', ch => { size += ch.length; if (size > limit) { reject(new Error('too big')); req.destroy(); } else chunks.push(ch); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleCall(req, res) {
  if (!CFG.apiKey) return send(res, 503, { error: 'no_key', message: 'חסר OPENAI_API_KEY בשרת' });
  const ip = clientIp(req);
  if (rateLimited(ip)) return send(res, 429, { error: 'rate', message: 'יותר מדי שיחות. נסו שוב בעוד כמה דקות.' });
  if (activeCalls.size >= CFG.maxConcurrent) return send(res, 503, { error: 'busy', message: 'הקו עמוס, נסו שוב בעוד דקה.' });

  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'bad_json' }); }
  if (typeof body.sdp !== 'string' || !body.sdp.startsWith('v=')) return send(res, 400, { error: 'bad_sdp' });

  const instructions = buildInstructions(loadEvent(), body.ctx, { callSeconds: CFG.callSeconds });

  let r = await openCall(body.sdp, instructions, false);
  if (!r.ok && r.status === 400) {
    // אם שדה אופציונלי כלשהו לא נתמך בגרסת ה-API הנוכחית – ננסה שוב עם הגדרה מינימלית
    console.warn('OpenAI 400, retrying minimal session:', r.text.slice(0, 300));
    r = await openCall(body.sdp, instructions, true);
  }
  if (!r.ok) {
    console.error('OpenAI error', r.status, r.text.slice(0, 500));
    return send(res, 502, { error: 'upstream', status: r.status, message: 'נוגה לא זמינה כרגע' });
  }

  const callId = (r.location.match(/calls\/([^/?#]+)/) || [])[1] || '';
  if (callId) {
    const timer = setTimeout(() => hangup(callId, 'hard-limit'), CFG.hardLimitSeconds * 1000);
    timer.unref();
    activeCalls.set(callId, { timer, started: Date.now() });
    console.log(`[call ${callId.slice(-8)}] start ip=${ip} active=${activeCalls.size}`);
  }
  send(res, 200, { sdp: r.text, callId, callSeconds: CFG.callSeconds });
}

async function handleHangup(req, res) {
  let body = {};
  try { body = JSON.parse(await readBody(req, 4096)); } catch {}
  if (typeof body.callId === 'string' && activeCalls.has(body.callId)) await hangup(body.callId, 'client');
  send(res, 200, { ok: true });
}

async function handleLog(req, res) {
  let raw;
  try { raw = await readBody(req, 100 * 1024); } catch { return send(res, 413, { error: 'too_big' }); }
  if (CFG.logCalls) {
    try {
      const entry = JSON.parse(raw);
      entry.at = new Date().toISOString();
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.appendFileSync(path.join(DATA_DIR, 'calls.jsonl'), JSON.stringify(entry) + '\n');
    } catch {}
  }
  send(res, 200, { ok: true });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2',
};

function serveStatic(req, res, urlPath) {
  let p = decodeURIComponent(urlPath);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'POST' && url.pathname === '/api/call') return await handleCall(req, res);
    if (req.method === 'POST' && url.pathname === '/api/hangup') return await handleHangup(req, res);
    if (req.method === 'POST' && url.pathname === '/api/log') return await handleLog(req, res);
    if (req.method === 'GET' && url.pathname === '/api/event') {
      const ev = loadEvent();
      return send(res, 200, {
        presenter: ev.presenter, title: ev.title, subtitle: ev.subtitle, date: ev.date, doors: ev.doors,
        location: ev.location, lineup: ev.lineup || [], ticketsUrl: ev.ticketsUrl, officialPosterImage: ev.officialPosterImage,
        callSeconds: CFG.callSeconds, live: !!CFG.apiKey,
      });
    }
    if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true, active: activeCalls.size });
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url.pathname);
    send(res, 405, 'method not allowed', 'text/plain');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'server' });
  }
});

server.listen(CFG.port, () => {
  console.log(`ליל המצפור על http://localhost:${CFG.port}  model=${CFG.model} voice=${CFG.voice} key=${CFG.apiKey ? 'yes' : 'NO (demo only)'}`);
});
