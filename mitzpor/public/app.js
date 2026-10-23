// ליל המצפור: שיחה של דקה עם נוגה, ואז פוסטר.
// החיבור ל-OpenAI נפתח כבר בזמן שהטלפון מצלצל, כך שכשעונים היא מדברת מיד.
'use strict';

const qs = new URLSearchParams(location.search);
const DEBUG = qs.has('debug');
const $ = (id) => document.getElementById(id);

let EV = { title: 'ליל המצפור', presenter: 'OBSESSION', callSeconds: 60, lineup: [] };

const LS = {
  get(k, d) { try { const v = localStorage.getItem('mitzpor.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mitzpor.' + k, JSON.stringify(v)); } catch {} },
};

// ---------- מצב שיחה ----------
let S;
function freshState() {
  return {
    pc: null, dc: null, mic: null, audioEl: null, callId: '',
    connected: false, answered: false, ended: false,
    ringStart: 0, declined: 0, t0: 0,
    responding: false, wantResponse: false, herSpeaking: false, userSpeaking: false,
    name: '', obsession: '', gender: 'unknown',
    endData: null, pendingEnd: false,
    silenceTimer: null, silenceNudges: 0,
    timers: [], questions: [], transcript: [], flags: [], handledCalls: new Set(),
    captionWords: 0,
  };
}

function log(...a) {
  if (!DEBUG) return;
  const d = $('debug'); d.hidden = false;
  d.textContent += a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n';
  d.scrollTop = d.scrollHeight;
}

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
}

function fail(msg) {
  cleanup();
  $('err-msg').textContent = msg;
  show('s-error');
}

// ---------- שמיים ----------
(function skyLoop() {
  const c = $('sky'), ctx = c.getContext('2d');
  let stars = [];
  function resize() {
    c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
    stars = Array.from({ length: Math.round(innerWidth * innerHeight / 2600) }, () => ({
      x: Math.random() * c.width, y: Math.random() * c.height * 0.9, r: (Math.random() * 1.2 + 0.3) * devicePixelRatio,
      p: Math.random() * 6.28, s: 0.5 + Math.random() * 1.5,
    }));
  }
  resize(); addEventListener('resize', resize);
  (function frame(t) {
    ctx.clearRect(0, 0, c.width, c.height);
    const g = ctx.createLinearGradient(0, c.height * 0.6, 0, c.height);
    g.addColorStop(0, 'rgba(60,15,60,0)'); g.addColorStop(1, 'rgba(110,30,70,.35)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
    for (const s of stars) {
      ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(s.p + t / 1000 * s.s));
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  })(0);
})();

// ---------- הקשר מהטלפון ----------
async function collectContext() {
  const now = new Date();
  const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? 'אייפון' : /iPad/.test(ua) ? 'אייפד' : /Android/.test(ua) ? 'אנדרואיד' : 'מחשב';
  const ctx = {
    localTime: now.toTimeString().slice(0, 5),
    weekday: days[now.getDay()],
    device,
    previousCalls: LS.get('calls', 0),
    previousName: LS.get('name', ''),
    previousObsession: LS.get('obsession', ''),
  };
  try {
    if (navigator.getBattery) {
      const b = await Promise.race([navigator.getBattery(), new Promise((_, r) => setTimeout(r, 400))]);
      ctx.battery = Math.round(b.level * 100); ctx.charging = b.charging;
    }
  } catch {}
  return ctx;
}

// ---------- ערוץ האירועים ----------
function sendEvt(obj) {
  if (S.dc && S.dc.readyState === 'open') { S.dc.send(JSON.stringify(obj)); log('→', obj.type); }
}

// הוראת במה: נכנסת לשיחה כהודעת מערכת. היא לא מוקראת.
function stage(text, respond) {
  sendEvt({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: '[במה] ' + text }] } });
  if (respond) requestResponse();
}

function requestResponse() {
  if (S.ended) return;
  if (S.responding || S.userSpeaking) { S.wantResponse = true; return; }
  S.wantResponse = false;
  S.responding = true; S.pendingCreate = true; // נעילה מיידית, response.created יאשר
  sendEvt({ type: 'response.create' });
}

function onEvent(e) {
  let m; try { m = JSON.parse(e.data); } catch { return; }
  const t = m.type;
  if (DEBUG && !/delta$/.test(t)) log('←', t);

  switch (t) {
    case 'input_audio_buffer.speech_started':
      S.userSpeaking = true; clearSilence(); $('you').classList.add('on'); SFX.duckWind(true);
      break;
    case 'input_audio_buffer.speech_stopped':
      S.userSpeaking = false; $('you').classList.remove('on'); SFX.duckWind(false);
      if (S.wantResponse && !S.responding) requestResponse();
      break;
    case 'response.created':
      S.responding = true; S.pendingCreate = false; clearSilence();
      break;
    case 'response.output_audio_transcript.delta':
    case 'response.audio_transcript.delta':
      captionAdd(m.delta || '');
      break;
    case 'response.output_audio_transcript.done':
    case 'response.audio_transcript.done':
      herSaid(m.transcript || '');
      break;
    case 'conversation.item.input_audio_transcription.completed':
      if (m.transcript) { S.transcript.push({ who: 'player', t: secs(), text: m.transcript.trim() }); log('player:', m.transcript); }
      break;
    case 'output_audio_buffer.started':
      S.herSpeaking = true; $('status').textContent = '';
      if (S.firstAudioAt === undefined) S.firstAudioAt = secs();
      break;
    case 'output_audio_buffer.stopped':
    case 'output_audio_buffer.cleared':
      S.herSpeaking = false;
      afterHerAudio();
      break;
    case 'response.done':
      S.responding = false;
      handleResponseDone(m.response || {});
      break;
    case 'error':
      log('ERROR', m.error);
      S.flags.push({ t: secs(), type: 'api_error', msg: (m.error && m.error.message) || '' });
      // בקשת תגובה שנדחתה לא תשאיר את המנעול סגור
      if (S.pendingCreate) { S.pendingCreate = false; S.responding = false; }
      break;
  }
}

function handleResponseDone(resp) {
  const out = resp.output || [];
  let spoke = false, needFollowUp = false;
  for (const item of out) {
    if (item.type === 'message') spoke = true;
    if (item.type !== 'function_call' || S.handledCalls.has(item.call_id)) continue;
    S.handledCalls.add(item.call_id);
    let args = {}; try { args = JSON.parse(item.arguments || '{}'); } catch {}
    log('tool', item.name, args);
    if (item.name === 'remember') {
      if (args.name) S.name = clean(args.name, 24);
      if (args.obsession) S.obsession = clean(args.obsession, 48);
      if (args.gender && args.gender !== 'unknown') S.gender = args.gender;
      const known = [S.name && `שם: ${S.name}`, S.obsession && `אובססיה: ${S.obsession}`, S.gender !== 'unknown' && `מין: ${S.gender === 'male' ? 'זכר' : 'נקבה'}`].filter(Boolean).join(', ');
      sendEvt({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify({ saved: true, known_now: known, rule: 'אסור לשאול שוב על מה שידוע' }) } });
      needFollowUp = true;
    } else if (item.name === 'end_call') {
      S.endData = args;
      S.pendingEnd = true;
      sendEvt({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: item.call_id, output: '{"ok":true}' } });
    }
  }
  // אם היא רק קראה ל-remember בלי לדבר, צריך לבקש ממנה להמשיך, אחרת יש שקט
  if (needFollowUp && !spoke && !S.pendingEnd) requestResponse();
  else if (S.wantResponse) requestResponse();

  if (S.pendingEnd) {
    // אם האודיו כבר נגמר (או שאין אירועי באפר), נסגור אחרי רגע
    if (!S.herSpeaking) setTimeout(() => { if (!S.herSpeaking) finish('end_call'); }, spoke ? 1600 : 500);
    setTimeout(() => finish('end_call_timeout'), 9000);
  } else if (!S.herSpeaking) {
    // אין אירועי output_audio_buffer בחלק מהגרסאות: נתחיל שעון שקט מכאן
    armSilence(2500);
  }
}

function afterHerAudio() {
  if (S.pendingEnd) { setTimeout(() => finish('end_call'), 450); return; }
  captionFadeSoon();
  armSilence(0);
}

// ---------- שקט ----------
function clearSilence() { if (S.silenceTimer) clearTimeout(S.silenceTimer); S.silenceTimer = null; }
function armSilence(extra) {
  clearSilence();
  if (S.ended || !S.answered) return;
  S.silenceTimer = setTimeout(() => {
    if (S.ended || S.userSpeaking || S.responding || S.herSpeaking) return;
    S.silenceNudges++;
    S.flags.push({ t: secs(), type: 'silence', n: S.silenceNudges });
    if (S.silenceNudges <= 2) stage('השחקן שותק כבר כמה שניות. תגיבי לשקט עצמו בצורה חיה ומצחיקה ותמשיכי הלאה. אל תחזרי על השאלה הקודמת מילה במילה.', true);
    else stage('השחקן כנראה לא מדבר. תסגרי בחן במשפט אחד, תמציאי לו אובססיה לפי מה שיש, ותקראי ל-end_call.', true);
  }, 5200 + extra);
}

// ---------- כתוביות + זיהוי חזרות ----------
function captionAdd(delta) {
  const cap = $('caption');
  if (cap.classList.contains('fade') || S.captionWords > 28) { cap.textContent = ''; cap.classList.remove('fade'); S.captionWords = 0; }
  const span = document.createElement('span'); span.textContent = delta; cap.appendChild(span);
  S.captionWords += (delta.match(/\s/g) || []).length;
}
let fadeT;
function captionFadeSoon() { clearTimeout(fadeT); fadeT = setTimeout(() => $('caption').classList.add('fade'), 1800); }

const norm = (s) => s.replace(/[֑-ׇ]/g, '').replace(/[^א-תa-z0-9\s]/gi, ' ').toLowerCase().split(/\s+/).filter(w => w.length > 1);

function herSaid(text) {
  text = text.trim(); if (!text) return;
  S.transcript.push({ who: 'noga', t: secs(), text });
  log('noga:', text);
  const questions = text.split(/(?<=\?)/).filter(q => q.includes('?')).map(q => q.trim());
  for (const q of questions) {
    const w = new Set(norm(q));
    if (w.size < 2) continue;
    // שאלה על שם או אובססיה שכבר ידועים
    if (S.name && /(איך קוראים|מה השם|שמך|השם שלך)/.test(q)) flagRepeat(q, 'name_again');
    else if (S.obsession && /(מה האובססיה|האובססיה שלך\s*\?|מה ה?אובססיה)/.test(q)) flagRepeat(q, 'obsession_again');
    else {
      for (const prev of S.questions) {
        const inter = [...w].filter(x => prev.has(x)).length;
        const jac = inter / (w.size + prev.size - inter);
        if (jac >= 0.5) { flagRepeat(q, 'repeat_question'); break; }
      }
    }
    S.questions.push(w);
  }
  const words = text.split(/\s+/).length;
  if (words > 45) S.flags.push({ t: secs(), type: 'monologue', words });
}

function flagRepeat(q, type) {
  S.flags.push({ t: secs(), type, q });
  stage(`שאלת עכשיו שאלה שכבר נשאלה ("${q.slice(0, 60)}"). אל תחכי לתשובה עליה ואל תשאלי אותה שוב. אם הוא עונה, "נו ברור, רק בודקת שאתה ער" ותמשיכי הלאה.`, false);
}

// ---------- זמן ----------
const secs = () => (S.t0 ? Math.round((performance.now() - S.t0) / 100) / 10 : 0);
const fmt = (s) => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

function startClock() {
  const total = EV.callSeconds || 60;
  const tick = () => {
    if (S.ended) return;
    const s = secs();
    $('call-timer').textContent = fmt(s);
    $('time-bar').style.width = Math.min(100, (s / total) * 100) + '%';
    requestAnimationFrame(tick);
  };
  tick();
  const at = (sec, fn) => S.timers.push(setTimeout(fn, sec * 1000));
  at(total * 0.42, () => {
    if (!S.name) stage('עוד אין לך שם. אם הוא לא אמר, תני לו כינוי ותקראי ל-remember. לא לשאול שוב.', false);
  });
  at(total - 22, () => {
    stage(S.obsession
      ? 'נשארו בערך 20 שניות. עוברים להזמנה: מה רואים מהמצפור הלילה, והמילה הסודית.'
      : 'נשארו בערך 20 שניות ועוד אין אובססיה. תמציאי לו אחת לפי מה שהוא אמר, תקראי ל-remember ותעברי להזמנה.', false);
  });
  at(total - 7, () => {
    stage('נגמר הזמן. בתור הבא שלך: פרידה במשפט אחד קצר ("שולחת לך את הפוסטר") ומיד end_call. בלי שאלות.', !S.userSpeaking && !S.responding && !S.herSpeaking);
  });
  at(total + 7, () => {
    if (S.ended || S.pendingEnd) return;
    S.flags.push({ t: secs(), type: 'overtime' });
    stage('עכשיו. משפט פרידה של שלוש מילים ו-end_call.', true);
  });
  at(total + 16, () => finish('hard_limit'));
}

// ---------- רמת קול לאווטאר ----------
function meter(stream) {
  try {
    const ac = SFX.ctx; if (!ac) return;
    const an = ac.createAnalyser(); an.fftSize = 512;
    ac.createMediaStreamSource(stream).connect(an); // לא מחובר ליציאה, רק מודד
    const buf = new Uint8Array(an.fftSize);
    const pulse = $('pulse');
    (function loop() {
      if (S.ended) return;
      an.getByteTimeDomainData(buf);
      let sum = 0; for (const v of buf) sum += (v - 128) * (v - 128);
      const rms = Math.sqrt(sum / buf.length) / 128;
      pulse.style.setProperty('--lvl', (1 + Math.min(0.35, rms * 2.2)).toFixed(3));
      requestAnimationFrame(loop);
    })();
  } catch {}
}

// ---------- זרימה ----------
async function enter() {
  S = freshState();
  SFX.unlock();

  // את האלמנט שמנגן אותה מפעילים כבר עכשיו, בתוך הלחיצה, כדי שאייפון יסכים לנגן אחר כך
  S.pc = new RTCPeerConnection();
  const tr = S.pc.addTransceiver('audio', { direction: 'sendrecv' });
  S.audioEl = new Audio();
  S.audioEl.autoplay = true; S.audioEl.setAttribute('playsinline', '');
  S.audioEl.srcObject = new MediaStream([tr.receiver.track]);
  S.audioEl.play().catch(() => {});

  try {
    S.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    return fail('בלי מיקרופון נוגה לא יכולה לשמוע אותך. צריך לאשר גישה למיקרופון בדפדפן ולנסות שוב.');
  }
  const track = S.mic.getAudioTracks()[0];
  track.enabled = false; // היא לא שומעת כלום עד שעונים
  await tr.sender.replaceTrack(track);

  ring();
  connect().catch(err => { log('connect failed', String(err)); if (!S.ended) fail(err.userMessage || 'נוגה לא עונה כרגע. נסו שוב עוד רגע.'); });
}

function ring() {
  show('s-ring');
  $('ring-label').textContent = S.declined ? 'נוגה מתקשרת שוב' : 'שיחה נכנסת';
  S.ringStart = performance.now();
  SFX.startRing();
  // בפעם השלישית המצפור לא מקבל "לא" כתשובה
  if (S.declined >= 2) S.timers.push(setTimeout(() => { if (!S.answered && !S.ended) answer(true); }, 3200));
}

function decline() {
  if (S.answered) return;
  SFX.stopRing(); SFX.hangupTone();
  S.declined++;
  $('ring-label').textContent = 'השיחה נדחתה';
  document.querySelector('#s-ring .avatar').classList.remove('ringing');
  S.timers.push(setTimeout(() => {
    document.querySelector('#s-ring .avatar').classList.add('ringing');
    ring();
  }, S.declined === 1 ? 2200 : 1500));
}

async function connect() {
  const ctx = await collectContext();
  S.dc = S.pc.createDataChannel('oai-events');
  S.dc.onmessage = onEvent;
  S.dc.onopen = () => { S.connected = true; log('dc open'); if (S.answered) goLive(); };
  S.pc.onconnectionstatechange = () => {
    log('pc', S.pc.connectionState);
    if (S.pc.connectionState === 'failed' && !S.ended) {
      if (S.answered && secs() > 20) finish('dropped'); else fail('הקו נפל. נסו שוב.');
    }
  };
  const offer = await S.pc.createOffer();
  await S.pc.setLocalDescription(offer);
  const r = await fetch('/api/call', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sdp: offer.sdp, ctx }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j.error || 'http ' + r.status);
    err.userMessage = j.error === 'no_key' ? 'השרת עוד לא מחובר לנוגה (חסר מפתח). אפשר לראות פוסטר לדוגמה.' : (j.message || 'נוגה לא עונה כרגע. נסו שוב עוד רגע.');
    throw err;
  }
  S.callId = j.callId || '';
  if (j.callSeconds) EV.callSeconds = j.callSeconds;
  await S.pc.setRemoteDescription({ type: 'answer', sdp: j.sdp });
  S.ctx = ctx;
}

function answer(auto) {
  if (S.answered || S.ended) return;
  S.answered = true;
  S.ringSeconds = Math.round((performance.now() - S.ringStart) / 1000);
  S.autoAnswered = !!auto;
  SFX.stopRing(); SFX.pickup();
  S.audioEl.play().catch(() => {});
  S.mic.getAudioTracks()[0].enabled = true;
  $('caption').textContent = '';
  $('status').textContent = S.connected ? '' : 'מתחבר…';
  show('s-call');
  S.t0 = performance.now();
  startClock();
  SFX.startWind();
  meter(S.audioEl.srcObject);
  if (S.connected) goLive();
}

function goLive() {
  if (S.live || S.ended) return;
  S.live = true;
  $('status').textContent = '';
  let hook;
  if (S.autoAnswered) hook = `הוא דחה אותך ${S.declined} פעמים, אז "פרצת" לו לשיחה בעצמך. תפתחי בזה, בגאווה ובצחוק: "אל תדאג, ענינו בשבילך".`;
  else if (S.declined) hook = `הוא דחה את השיחה ${S.declined === 1 ? 'פעם אחת' : S.declined + ' פעמים'} לפני שענה. תפתחי בזה, נעלבת-בצחוק.`;
  else if (S.ringSeconds >= 6) hook = `הוא נתן לטלפון לצלצל ${S.ringSeconds} שניות לפני שענה. אפשר לפתוח בזה ("התלבטת, אה?") או בפתיח שלך, מה שיותר חי.`;
  else if (S.ringSeconds <= 1) hook = 'הוא ענה מיד, בתוך שנייה. אפשר לפתוח בזה ("וואו, מהר. חיכית לי?") או בפתיח שלך.';
  else hook = 'תפתחי לפי הפתיח שלך.';
  stage(`השחקן ענה לשיחה עכשיו. ${hook} תתחילי לדבר מיד, מאמצע הסצנה שלך. משפט או שניים, ואז לשאול איך קוראים לו (אלא אם את כבר יודעת).`, true);
}

function finish(reason) {
  if (S.ended) return;
  S.ended = true;
  log('finish', reason);
  const duration = fmt(secs());
  const d = S.endData || {};
  const words = ['כוכב', 'רוח', 'משקפת', 'ירח', 'גובה', 'לילה', 'אורות', 'סוד'];
  const data = {
    name: clean(d.name || S.name || '', 22) || 'אורח/ת המצפור',
    obsession: clean(d.obsession || S.obsession || '', 44) || 'לנתק שיחות באמצע',
    line: clean(d.poster_line || '', 70) || 'מי שעונה למצפור, עולה למצפור.',
    word: clean(d.secret_word || '', 14).split(/\s+/)[0] || words[Math.floor(Math.random() * words.length)],
    callNo: String(Math.floor(1000 + Math.random() * 9000)),
    duration,
  };
  LS.set('calls', LS.get('calls', 0) + 1);
  if (S.name || d.name) LS.set('name', data.name);
  if (S.obsession || d.obsession) LS.set('obsession', data.obsession);

  try {
    navigator.sendBeacon('/api/log', new Blob([JSON.stringify({
      callId: S.callId, reason, duration: secs(), firstAudioAt: S.firstAudioAt, ringSeconds: S.ringSeconds, declined: S.declined,
      ctx: S.ctx, state: { name: S.name, obsession: S.obsession, gender: S.gender }, endData: S.endData,
      flags: S.flags, transcript: S.transcript,
    })], { type: 'application/json' }));
  } catch {}

  cleanup();
  SFX.hangupTone();
  showPoster(data);
}

function cleanup() {
  if (!S) return;
  S.ended = true;
  clearSilence();
  S.timers.forEach(clearTimeout);
  SFX.stopRing(); SFX.stopWind();
  try { S.dc && S.dc.close(); } catch {}
  try { S.pc && S.pc.close(); } catch {}
  try { S.mic && S.mic.getTracks().forEach(t => t.stop()); } catch {}
  try { if (S.audioEl) { S.audioEl.pause(); S.audioEl.srcObject = null; } } catch {}
  if (S.callId) fetch('/api/hangup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callId: S.callId }), keepalive: true }).catch(() => {});
}

function clean(s, n) {
  return String(s || '').replace(/[<>{}\[\]"״"]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
}

// ---------- פוסטר ----------
let lastPoster = null;
async function showPoster(data) {
  show('s-end');
  $('ended-time').textContent = data.duration;
  $('poster-wrap').classList.remove('in'); $('end-actions').classList.remove('in');
  await Poster.draw($('poster'), data, EV);
  lastPoster = data;
  requestAnimationFrame(() => { $('poster-wrap').classList.add('in'); $('end-actions').classList.add('in'); });
  if (EV.ticketsUrl) { $('btn-tickets').href = EV.ticketsUrl; $('btn-tickets').hidden = false; }
}

async function posterFile() {
  const blob = await Poster.toBlob($('poster'));
  return new File([blob], `lel-hamitzpor-${lastPoster ? lastPoster.callNo : 'poster'}.png`, { type: 'image/png' });
}

async function sharePoster() {
  const file = await posterFile();
  const shareData = { files: [file], title: EV.title, text: `${EV.title} · ${EV.presenter}` };
  if (navigator.canShare && navigator.canShare(shareData)) {
    try { await navigator.share(shareData); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  savePoster(file);
}

async function savePoster(file) {
  file = file instanceof File ? file : await posterFile();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function demo() {
  S = S || freshState();
  showPoster({
    name: 'דניאל', obsession: 'לסדר את המקרר לפי צבעים', line: 'הראשון שהודה בזה בלי להתבייש. כמעט.',
    word: 'מנגו', callNo: '0423', duration: '00:58',
  });
}

// ---------- חיבורים ----------
fetch('/api/event').then(r => r.json()).then(j => {
  EV = { ...EV, ...j };
  document.querySelectorAll('[data-ev]').forEach(el => { const v = EV[el.dataset.ev]; if (v) el.textContent = v; });
  document.title = EV.title;
}).catch(() => {});

$('btn-enter').addEventListener('click', enter);
$('btn-answer').addEventListener('click', () => answer(false));
$('btn-decline').addEventListener('click', decline);
$('btn-hangup').addEventListener('click', () => {
  if (!S.ended) { S.flags.push({ t: secs(), type: 'player_hung_up' }); finish('player_hangup'); }
});
$('btn-share').addEventListener('click', sharePoster);
$('btn-save').addEventListener('click', savePoster);
$('btn-again').addEventListener('click', () => { show('s-enter'); });
$('btn-retry').addEventListener('click', () => { show('s-enter'); });
$('btn-demo').addEventListener('click', demo);

if (qs.has('demo')) setTimeout(demo, 300);
